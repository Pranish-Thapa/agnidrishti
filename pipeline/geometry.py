"""Exact district geometry assignment.

No bounding-box shortcut: districts are assigned with real point-in-polygon
tests (covers, including boundary). Bounding boxes are reported only as
diagnostics.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from shapely.geometry import Point, shape
from shapely.prepared import prep

from . import config, manifests


@dataclass(frozen=True)
class Boundary:
    district_id: str
    name: str
    province: str
    pcode: str
    source_name: str
    geometry: object
    bounds: tuple[float, float, float, float]
    provenance: dict
    simplified: bool


@dataclass(frozen=True)
class Assignment:
    district_id: str | None
    boundary_touch: bool
    candidate_ids: tuple[str, ...]


class MissingBoundaryError(RuntimeError):
    pass


def _feature_properties(feature: dict) -> dict:
    props = feature.get("properties") or {}
    return props


def load_boundaries(path: Path | None = None, *, prefer_source: bool = True) -> list[Boundary]:
    candidates: list[Path] = []
    if path is not None:
        candidates.append(path)
    if prefer_source:
        candidates.append(config.STUDY_AREA_BOUNDARIES)
    candidates.append(config.DISPLAY_BOUNDARIES)

    for candidate in candidates:
        if candidate is None or not candidate.exists():
            continue
        try:
            payload = manifests.read_json(candidate)
        except (OSError, ValueError):
            continue
        boundaries = _parse_feature_collection(payload, candidate)
        if boundaries:
            return boundaries

    raise MissingBoundaryError(
        "No usable study-area boundary file found. Expected "
        f"{config.STUDY_AREA_BOUNDARIES} (full resolution) or "
        f"{config.DISPLAY_BOUNDARIES} (display). Generate study areas with "
        "pipeline/boundaries.py from the OCHA COD-AB source archive."
    )


def _parse_feature_collection(payload: object, source_path: Path) -> list[Boundary]:
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        return []
    features = payload.get("features") or []
    boundaries: list[Boundary] = []
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            continue
        props = _feature_properties(feature)
        district_id = props.get("district_id")
        if not district_id:
            continue
        if district_id not in config.DISTRICTS:
            continue
        geometry = feature.get("geometry")
        if not geometry:
            continue
        geom = shape(geometry)
        if geom.is_empty:
            continue
        definition = config.DISTRICTS[district_id]
        provenance = props.get("provenance") or props.get("boundary_provenance") or {}
        simplified = bool(props.get("simplified", False))
        bounds = tuple(float(value) for value in geom.bounds)
        boundaries.append(
            Boundary(
                district_id=district_id,
                name=definition.name,
                province=definition.province,
                pcode=definition.pcode,
                source_name=definition.source_name,
                geometry=geom,
                bounds=bounds,
                provenance=provenance,
                simplified=simplified,
            )
        )
    return boundaries


class DistrictIndex:
    def __init__(self, boundaries: Iterable[Boundary]):
        ordered = sorted(boundaries, key=lambda item: item.district_id)
        self.boundaries = ordered
        self._prepared = [(boundary, prep(boundary.geometry)) for boundary in ordered]
        self._order = {boundary.district_id: index for index, boundary in enumerate(ordered)}
        xs = [value for boundary in ordered for value in (boundary.bounds[0], boundary.bounds[2])]
        ys = [value for boundary in ordered for value in (boundary.bounds[1], boundary.bounds[3])]
        self.union_bounds = (min(xs), min(ys), max(xs), max(ys)) if ordered else (0.0, 0.0, 0.0, 0.0)

    def assign(self, longitude: float, latitude: float) -> Assignment:
        point = Point(longitude, latitude)
        candidates: list[str] = []
        for boundary, prepared in self._prepared:
            if not prepared.intersects(point):
                # prepared.intersects uses prepared geometry; for a point this is the
                # equivalent of a bounding-box rejection before the exact test.
                continue
            if boundary.geometry.covers(point):
                candidates.append(boundary.district_id)

        if not candidates:
            return Assignment(district_id=None, boundary_touch=False, candidate_ids=())

        if len(candidates) == 1:
            return Assignment(
                district_id=candidates[0],
                boundary_touch=False,
                candidate_ids=tuple(candidates),
            )

        # Overlap case (should not occur for disjoint districts): choose by
        # configured district order and flag the touch.
        candidates.sort(key=lambda item: self._order.get(item, 999))
        return Assignment(
            district_id=candidates[0],
            boundary_touch=True,
            candidate_ids=tuple(candidates),
        )

    def bbox_contains(self, longitude: float, latitude: float) -> bool:
        west, south, east, north = self.union_bounds
        return west <= longitude <= east and south <= latitude <= north


def representative_points(boundaries: Iterable[Boundary]) -> dict[str, tuple[float, float]]:
    result: dict[str, tuple[float, float]] = {}
    for boundary in boundaries:
        point = boundary.geometry.representative_point()
        result[boundary.district_id] = (float(point.x), float(point.y))
    return result
