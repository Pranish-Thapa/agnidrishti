"""Acquisition and construction of the six-region study-area boundaries.

The canonical region list lives in ``src/data/regions.json``. Each region
points at an authoritative source file (OCHA COD-AB for Nepal, geoBoundaries
ADM1 for the three new regions). This module extracts the matching feature by
its source identifier, validates the geometry, writes full-resolution
geometry for point-in-polygon assignment, and writes a simplified display
copy for the React application. No rectangle, hull or invented polygon is
ever substituted for a missing boundary.
"""

from __future__ import annotations

import hashlib
import json
import math
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from shapely.geometry import shape
from shapely.validation import make_valid

from . import config, http, manifests

ACQUIRED_AT_LABEL = "retrieved_at"

# Simplification tolerances (degrees) for the display copy only. The
# full-resolution geometry used for assignment is never simplified.
DISPLAY_TOLERANCE_DEGREES = 0.0012


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_source_archive(
    *,
    destination: Path | None = None,
    downloader: http.Downloader | None = None,
    force: bool = False,
) -> dict:
    """Download the OCHA COD-AB Nepal archive (legacy Nepal source)."""

    config.ensure_directories()
    destination = destination or (config.BOUNDARY_SOURCE_DIR / "npl_admin_boundaries.geojson.zip")
    destination.parent.mkdir(parents=True, exist_ok=True)

    if destination.exists() and not force:
        return {
            "status": "already_present",
            "path": config.relative(destination),
            "sha256": sha256_file(destination),
            "bytes": destination.stat().st_size,
        }

    downloader = downloader or http.Downloader(secrets=())
    result = downloader.download(config.BOUNDARY_SOURCE["download_url"], destination)
    return {
        "status": "downloaded",
        "path": config.relative(destination),
        "sha256": result.sha256,
        "bytes": result.bytes_written,
        "http_status": result.http_status,
        "last_modified": http.parse_last_modified(result.last_modified),
    }


def _spherical_ring_area_km2(coords: list[list[float]]) -> float:
    """Signed spherical ring area in km² (positive for counter-clockwise)."""

    if len(coords) < 3:
        return 0.0
    earth_radius_km = 6371.0088
    total = 0.0
    for index in range(len(coords) - 1):
        lon1, lat1 = coords[index][:2]
        lon2, lat2 = coords[index + 1][:2]
        total += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2))
        )
    return total * earth_radius_km * earth_radius_km / 2.0


def geodesic_area_km2(geom: Any) -> float:
    """Absolute spherical area of a Polygon/MultiPolygon in square kilometres."""

    polygons = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    total = 0.0
    for polygon in polygons:
        area = abs(_spherical_ring_area_km2(list(polygon.exterior.coords)))
        for interior in polygon.interiors:
            area -= abs(_spherical_ring_area_km2(list(interior.coords)))
        total += max(0.0, area)
    return round(total, 1)


def _find_source_feature(payload: dict, region: config.RegionDefinition) -> dict:
    features = payload.get("features") or []
    wanted_id = region.source_id
    wanted_name = region.source_name.strip().lower()

    for feature in features:
        props = feature.get("properties") or {}
        candidate_ids = [
            props.get("adm2_pcode"),
            props.get("ADM2_PCODE"),
            props.get("shapeID"),
            props.get("pcode"),
        ]
        if wanted_id and any(str(value).strip() == wanted_id for value in candidate_ids if value):
            return feature

    for feature in features:
        props = feature.get("properties") or {}
        candidate_names = [
            props.get("adm2_name"),
            props.get("shapeName"),
            props.get("name"),
            props.get("NAME_1"),
        ]
        if any(str(value).strip().lower() == wanted_name for value in candidate_names if value):
            return feature

    raise RuntimeError(
        f"Source feature not found for {region.region_id}: "
        f"id={wanted_id!r} name={region.source_name!r}"
    )


def _validate_geometry(region: config.RegionDefinition, geom: Any) -> dict[str, Any]:
    issues: list[str] = []
    source_valid = bool(geom.is_valid)
    if not source_valid:
        geom = make_valid(geom)
        issues.append("source geometry was invalid and was repaired with make_valid")
    if geom.is_empty:
        raise RuntimeError(f"Empty geometry for {region.region_id}")
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise RuntimeError(f"Unsupported geometry type for {region.region_id}: {geom.geom_type}")

    bounds = tuple(float(value) for value in geom.bounds)
    west, south, east, north = bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        issues.append("bounds outside valid longitude/latitude ranges")

    area = geodesic_area_km2(geom)
    if area <= 0:
        raise RuntimeError(f"Non-positive area for {region.region_id}")

    if region.bbox:
        stored = region.bbox
        tolerance = 0.02
        if any(abs(a - b) > tolerance for a, b in zip(bounds, stored)):
            issues.append(f"computed bounds {bounds} differ from configured {stored}")
    if region.area_km2:
        deviation = abs(area - region.area_km2) / region.area_km2
        if deviation > 0.25:
            issues.append(
                f"computed area {area} km² deviates {deviation:.1%} from configured {region.area_km2} km²"
            )

    return {
        "region_id": region.region_id,
        "geometry_type": geom.geom_type,
        "source_valid": source_valid,
        "valid_after_repair": bool(geom.is_valid),
        "is_simple": bool(geom.is_simple),
        "bounds": [round(value, 6) for value in bounds],
        "area_km2_computed": area,
        "area_km2_configured": region.area_km2,
        "centroid": [round(float(geom.centroid.x), 6), round(float(geom.centroid.y), 6)],
        "vertex_count": _vertex_count(geom),
        "issues": issues,
    }


def _vertex_count(geom: Any) -> int:
    polygons = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    return sum(
        len(polygon.exterior.coords) + sum(len(ring.coords) for ring in polygon.interiors)
        for polygon in polygons
    )


def _simplify_for_display(geom: Any) -> Any:
    simplified = geom.simplify(DISPLAY_TOLERANCE_DEGREES, preserve_topology=True)
    return simplified if not simplified.is_empty else geom


def _round_geometry(geom: Any, decimals: int = 5) -> dict:
    def rounded(coords: Any) -> Any:
        if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
            return [round(float(value), decimals) for value in coords]
        return [rounded(item) for item in coords]

    return {"type": geom.geom_type, "coordinates": rounded(list(geom.__geo_interface__["coordinates"]))}


def _source_properties(feature: dict, region: config.RegionDefinition) -> dict[str, Any]:
    props = feature.get("properties") or {}
    if props.get("adm2_name") is not None:
        return {
            "sourceName": props.get("adm2_name"),
            "sourceId": props.get("adm2_pcode"),
            "parentName": props.get("adm1_name"),
            "validOn": props.get("valid_on"),
            "sourceAreaKm2": props.get("area_sqkm"),
            "sourceCenter": [props.get("center_lon"), props.get("center_lat")],
        }
    return {
        "sourceName": props.get("shapeName"),
        "sourceId": props.get("shapeID"),
        "parentName": props.get("shapeGroup"),
        "validOn": props.get("shapeISO"),
        "sourceAreaKm2": None,
        "sourceCenter": None,
    }


def build_study_areas(
    *,
    retrieved_at: str | None = None,
    update_region_config: bool = True,
) -> dict:
    """Build full-resolution and display geometry for all configured regions."""

    retrieved_at = retrieved_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    config.ensure_directories()

    output_features: list[dict] = []
    display_features: list[dict] = []
    validations: list[dict] = []
    missing: list[str] = []
    config_updates: dict[str, dict[str, Any]] = {}

    for region_id in config.REGION_ORDER:
        region = config.REGIONS[region_id]
        source_file = config.REPO_ROOT / str(region.boundary.get("sourceFile") or "")
        if not source_file.exists():
            missing.append(f"{region_id}: {config.relative(source_file)}")
            continue

        payload = json.loads(source_file.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
            raise ValueError(f"Source boundary is not a GeoJSON FeatureCollection: {source_file}")

        feature = _find_source_feature(payload, region)
        raw_geometry = feature.get("geometry")
        if not raw_geometry:
            raise RuntimeError(f"Feature has no geometry for {region_id}")

        source_geom = shape(raw_geometry)
        validation = _validate_geometry(region, source_geom)
        geom = source_geom if source_geom.is_valid else make_valid(source_geom)
        validations.append(validation)

        source_hash = hashlib.sha256(
            json.dumps(feature, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        source_props = _source_properties(feature, region)
        provenance = {
            "source": region.boundary.get("source"),
            "dataset_url": region.boundary.get("datasetUrl"),
            "license": region.boundary.get("license"),
            "publisher": region.boundary.get("publisher"),
            "boundary_year": region.boundary.get("boundaryYear"),
            "admin_level": region.admin_level,
            "source_file": config.relative(source_file),
            "source_file_sha256": sha256_file(source_file),
            "source_feature_sha256": source_hash,
            "source_id": source_props.get("sourceId"),
            "source_id_label": region.boundary.get("sourceIdLabel"),
            "source_name": source_props.get("sourceName"),
            "source_parent_name": source_props.get("parentName"),
            "retrieved_at": retrieved_at,
            "crs": config.PROJECT_CRS,
            "geometry_modified": not validation["source_valid"],
            "simplified": False,
        }
        output_features.append(
            {
                "type": "Feature",
                "id": region_id,
                "properties": {
                    "region_id": region_id,
                    "district_id": region_id,
                    "name": region.name,
                    "full_name": region.full_name,
                    "country": region.country,
                    "country_code": region.country_code,
                    "admin_level": region.admin_level,
                    "admin_level_label": region.admin_level_label,
                    "parent": region.parent,
                    "scale_class": region.scale_class,
                    "area_km2": validation["area_km2_computed"],
                    "description": region.description,
                    "provenance": provenance,
                    "simplified": False,
                },
                "geometry": _round_geometry(geom, 6),
            }
        )

        display_geom = _simplify_for_display(geom)
        display_features.append(
            {
                "type": "Feature",
                "id": region_id,
                "properties": {
                    "id": region_id,
                    "regionId": region_id,
                    "name": region.name,
                    "fullName": region.full_name,
                    "country": region.country,
                    "countryCode": region.country_code,
                    "adminLevel": region.admin_level,
                    "adminLevelLabel": region.admin_level_label,
                    "parent": region.parent,
                    "scaleClass": region.scale_class,
                    "areaKm2": validation["area_km2_computed"],
                    "pcode": source_props.get("sourceId"),
                    "sourceIdLabel": region.boundary.get("sourceIdLabel"),
                    "boundaryYear": region.boundary.get("boundaryYear"),
                    "source": region.boundary.get("source"),
                    "sourceUrl": region.boundary.get("datasetUrl"),
                    "license": region.boundary.get("license"),
                    "bbox": [round(value, 5) for value in geom.bounds],
                },
                "geometry": _round_geometry(display_geom, 5),
            }
        )

        config_updates[region_id] = {
            "areaKm2": validation["area_km2_computed"],
            "bbox": [round(value, 4) for value in geom.bounds],
            "centroid": validation["centroid"],
            "sourceId": source_props.get("sourceId"),
        }

    if missing:
        raise RuntimeError(
            "Study-area source boundaries are missing for: " + "; ".join(missing)
        )

    output = {
        "type": "FeatureCollection",
        "name": "agnidrishti_study_areas",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "retrieved_at": retrieved_at,
            "crs": config.PROJECT_CRS,
            "regions": list(config.REGION_ORDER),
            "sources": {
                region_id: {
                    "source": config.REGIONS[region_id].boundary.get("source"),
                    "dataset_url": config.REGIONS[region_id].boundary.get("datasetUrl"),
                    "license": config.REGIONS[region_id].boundary.get("license"),
                    "boundary_year": config.REGIONS[region_id].boundary.get("boundaryYear"),
                }
                for region_id in config.REGION_ORDER
            },
            "geometry_modified": any(item["geometry_modified"] for item in [
                {"geometry_modified": not validation["source_valid"]} for validation in validations
            ]),
            "simplified": False,
        },
        "features": output_features,
    }

    display = {
        "type": "FeatureCollection",
        "name": "agnidrishti-study-areas",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "source": "Mixed authoritative sources; see per-feature properties",
            "crs": config.PROJECT_CRS,
            "simplification": f"Douglas-Peucker, {DISPLAY_TOLERANCE_DEGREES} degrees, display only",
            "note": "Display geometry only. Point-in-polygon assignment uses the full-resolution copy in data/boundaries/study_areas.geojson.",
        },
        "features": display_features,
    }

    manifests.write_json(config.STUDY_AREA_BOUNDARIES, output)
    manifests.write_json(config.DISPLAY_BOUNDARIES, display)
    manifests.write_json(
        config.BOUNDARY_DIR / "boundary_validation.json",
        {
            "contract_version": config.CONTRACT_VERSION,
            "generated_at": retrieved_at,
            "regions": validations,
            "note": "Geometry validation only; no boundary was approximated or invented.",
        },
    )

    if update_region_config:
        _update_region_config(config_updates)

    return {
        "status": "built",
        "output": config.relative(config.STUDY_AREA_BOUNDARIES),
        "display": config.relative(config.DISPLAY_BOUNDARIES),
        "regions": [feature["properties"]["region_id"] for feature in output_features],
        "validation": validations,
    }


def _update_region_config(updates: dict[str, dict[str, Any]]) -> None:
    """Fill computed extent/area/id fields back into the canonical config.

    Only null or materially different values are written; names, sources and
    descriptions are never modified.
    """

    path = config.REGIONS_CONFIG_PATH
    payload = json.loads(path.read_text(encoding="utf-8"))
    changed = False
    for raw in payload.get("regions", []):
        update = updates.get(str(raw.get("id")))
        if not update:
            continue
        for key in ("areaKm2", "bbox", "centroid"):
            value = update.get(key)
            if value is None:
                continue
            if raw.get(key) != value:
                raw[key] = value
                changed = True
        boundary = raw.setdefault("boundary", {})
        if update.get("sourceId") and boundary.get("sourceId") != update["sourceId"]:
            boundary["sourceId"] = update["sourceId"]
            changed = True
    if changed:
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )


def ensure_study_areas(*, archive_path: Path | None = None, download: bool = False) -> Path:
    if config.STUDY_AREA_BOUNDARIES.exists():
        try:
            payload = manifests.read_json(config.STUDY_AREA_BOUNDARIES)
            ids = {feature.get("properties", {}).get("region_id") for feature in payload.get("features", [])}
            if set(config.REGION_ORDER).issubset(ids):
                return config.STUDY_AREA_BOUNDARIES
        except (OSError, ValueError):
            pass

    if download:
        download_source_archive()
    if archive_path is not None:
        # Keep the legacy Nepal archive path reproducible: extract the admin-2
        # member next to the other source files, then build all regions.
        member = config.BOUNDARY_SOURCE["archive_member"]
        with zipfile.ZipFile(archive_path) as archive:
            raw = archive.read(member)
        (config.BOUNDARY_SOURCE_DIR / member).write_bytes(raw)

    build_study_areas()
    return config.STUDY_AREA_BOUNDARIES
