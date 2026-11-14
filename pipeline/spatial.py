"""Spatial assignment and 0.1 degree cell-day aggregation."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from . import config, geometry


def assign_study_areas(records: list[dict[str, Any]], index: geometry.DistrictIndex) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    assigned: list[dict[str, Any]] = []
    outside_count = 0
    touch_count = 0
    district_counts: dict[str, int] = {district_id: 0 for district_id in config.DISTRICT_ORDER}
    for record in records:
        assignment = index.assign(record["longitude"], record["latitude"])
        record["district_id"] = assignment.district_id
        record["boundary_touch"] = assignment.boundary_touch
        record["candidate_districts"] = list(assignment.candidate_ids)
        if assignment.district_id is None:
            outside_count += 1
            continue
        if assignment.boundary_touch:
            touch_count += 1
        district_counts[assignment.district_id] = district_counts.get(assignment.district_id, 0) + 1
        assigned.append(record)
    summary = {
        "outside_study_area_count": outside_count,
        "boundary_touch_count": touch_count,
        "assigned_by_district": district_counts,
    }
    return assigned, summary


def _grid_index(value: float) -> int:
    import math

    # Floor toward negative infinity for correct 0.1 bins.
    return int(math.floor(value / config.GRID_DEGREES))


def _cell_center(index: int) -> float:
    return round((index + 0.5) * config.GRID_DEGREES, 6)


def build_cell_days(records: list[dict[str, Any]]) -> dict[tuple[str, str, str, str], list[dict[str, Any]]]:
    # key: (district_id, sensor_id, platform, date)
    grouped: dict[tuple[str, str, str, str], dict[tuple[int, int], dict[str, Any]]] = defaultdict(lambda: defaultdict(dict))
    for record in records:
        key = (record["district_id"], record["sensor_id"], record["platform"], record["acq_date"])
        lat_index = _grid_index(record["latitude"])
        lon_index = _grid_index(record["longitude"])
        cell_key = (lat_index, lon_index)
        cell = grouped[key][cell_key]
        if not cell:
            cell.update(
                {
                    "cell_id": f"lat{lat_index}_lon{lon_index}",
                    "lat_index": lat_index,
                    "lon_index": lon_index,
                    "center_latitude": _cell_center(lat_index),
                    "center_longitude": _cell_center(lon_index),
                    "detections": 0,
                    "frp_values": [],
                    "daynight": defaultdict(int),
                }
            )
        cell["detections"] += 1
        if record.get("frp") is not None:
            cell["frp_values"].append(record["frp"])
        if record.get("daynight"):
            cell["daynight"][record["daynight"]] += 1

    result: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    for key, cells in grouped.items():
        cell_list: list[dict[str, Any]] = []
        for (lat_index, lon_index), cell in cells.items():
            frp_values = cell.pop("frp_values")
            cell["daynight"] = dict(cell["daynight"])
            if frp_values:
                cell["frp"] = {
                    "n": len(frp_values),
                    "sum": round(sum(frp_values), 4),
                    "mean": round(sum(frp_values) / len(frp_values), 4),
                    "min": round(min(frp_values), 4),
                    "max": round(max(frp_values), 4),
                }
            else:
                cell["frp"] = None
            cell["cell_days"] = 1
            cell_list.append(cell)
        result[key] = sorted(cell_list, key=lambda item: (item["lat_index"], item["lon_index"]))
    return result
