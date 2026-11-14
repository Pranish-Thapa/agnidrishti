"""Acquisition and construction of the full-resolution study-area boundaries."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, http, manifests, geometry

ACQUIRED_AT_LABEL = "retrieved_at"


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


def build_study_areas(
    *,
    archive_path: Path,
    member: str | None = None,
    retrieved_at: str | None = None,
) -> dict:
    member = member or config.BOUNDARY_SOURCE["archive_member"]
    retrieved_at = retrieved_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    config.ensure_directories()

    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if member not in names:
            raise FileNotFoundError(f"Archive member {member!r} not found in {archive_path}")
        raw_member = archive.read(member)

    source_geojson = json.loads(raw_member.decode("utf-8"))
    if not isinstance(source_geojson, dict) or source_geojson.get("type") != "FeatureCollection":
        raise ValueError("Source boundary file is not a GeoJSON FeatureCollection")

    features_by_pcode: dict[str, dict] = {}
    for feature in source_geojson.get("features", []):
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties") or {}
        pcode = props.get("adm2_pcode") or props.get("ADM2_PCODE") or props.get("pcode")
        if pcode:
            features_by_pcode[str(pcode).strip()] = feature

    archive_sha = sha256_file(archive_path)
    member_sha = hashlib.sha256(raw_member).hexdigest()

    output_features: list[dict] = []
    missing: list[str] = []
    for district_id, definition in config.DISTRICTS.items():
        source_feature = features_by_pcode.get(definition.pcode)
        if source_feature is None:
            missing.append(definition.pcode)
            continue
        provenance = {
            "source": config.BOUNDARY_SOURCE["label"],
            "dataset_url": config.BOUNDARY_SOURCE["dataset_url"],
            "license": config.BOUNDARY_SOURCE["license"],
            "boundary_year": config.BOUNDARY_SOURCE["boundary_year"],
            "publisher": config.BOUNDARY_SOURCE["publisher"],
            "source_member": member,
            "archive_sha256": archive_sha,
            "member_sha256": member_sha,
            "retrieved_at": retrieved_at,
            "source_pcode": definition.pcode,
            "source_name": definition.source_name,
            "crs": config.PROJECT_CRS,
            "geometry_modified": False,
        }
        output_features.append(
            {
                "type": "Feature",
                "properties": {
                    "district_id": district_id,
                    "name": definition.name,
                    "province": definition.province,
                    "pcode": definition.pcode,
                    "source_name": definition.source_name,
                    "description": definition.description,
                    "provenance": provenance,
                    "simplified": False,
                },
                "geometry": source_feature.get("geometry"),
            }
        )

    if missing:
        raise RuntimeError(f"District pcodes not found in source archive: {missing}")

    output = {
        "type": "FeatureCollection",
        "name": "agnidrishti_study_areas",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "source": config.BOUNDARY_SOURCE["label"],
            "dataset_url": config.BOUNDARY_SOURCE["dataset_url"],
            "license": config.BOUNDARY_SOURCE["license"],
            "boundary_year": config.BOUNDARY_SOURCE["boundary_year"],
            "publisher": config.BOUNDARY_SOURCE["publisher"],
            "archive_sha256": archive_sha,
            "member_sha256": member_sha,
            "retrieved_at": retrieved_at,
            "crs": config.PROJECT_CRS,
            "districts": [definition.district_id for definition in config.DISTRICTS.values()],
            "geometry_modified": False,
            "simplified": False,
        },
        "features": output_features,
    }

    config.BOUNDARY_DIR.mkdir(parents=True, exist_ok=True)
    config.BOUNDARY_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    manifests.write_json(config.STUDY_AREA_BOUNDARIES, output)
    # Keep a copy of the extracted source member for audit.
    extracted_path = config.BOUNDARY_SOURCE_DIR / member
    extracted_path.write_bytes(raw_member)
    return {
        "status": "built",
        "output": config.relative(config.STUDY_AREA_BOUNDARIES),
        "districts": [feature["properties"]["district_id"] for feature in output_features],
        "archive_sha256": archive_sha,
        "member_sha256": member_sha,
    }


def ensure_study_areas(*, archive_path: Path | None = None, download: bool = False) -> Path:
    if config.STUDY_AREA_BOUNDARIES.exists():
        return config.STUDY_AREA_BOUNDARIES
    if download:
        info = download_source_archive()
        archive_path = config.BOUNDARY_SOURCE_DIR / "npl_admin_boundaries.geojson.zip"
    if archive_path is None or not archive_path.exists():
        raise MissingBoundaryError if False else RuntimeError(
            "Study-area boundaries are missing. Provide the OCHA COD-AB archive "
            f"and run: python -m pipeline boundaries --archive path/to/npl_admin_boundaries.geojson.zip"
        )
    build_study_areas(archive_path=archive_path)
    return config.STUDY_AREA_BOUNDARIES
