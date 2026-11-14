"""Quality control for normalized FIRMS records."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any


def run_qc(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    raw_count = len(records)
    invalid_coordinate_count = 0
    missing_essential: Counter[str] = Counter()
    invalid_timestamp_count = 0
    unknown_satellite_count = 0
    frp_missing_count = 0

    for record in records:
        for issue in record.get("issues", []):
            if "coordinate" in issue or "latitude_out_of_range" in issue or "longitude_out_of_range" in issue:
                invalid_coordinate_count += 1
                break
        if record.get("latitude") is None:
            missing_essential["latitude"] += 1
        if record.get("longitude") is None:
            missing_essential["longitude"] += 1
        if record.get("acq_date") is None:
            missing_essential["acq_date"] += 1
        if record.get("acq_time") is None:
            missing_essential["acq_time"] += 1
        if record.get("satellite_code") is None:
            missing_essential["satellite_code"] += 1
        if "missing_or_invalid_date" in record.get("issues", []) or "missing_or_invalid_time" in record.get("issues", []):
            invalid_timestamp_count += 1
        if "unknown_satellite_code" in record.get("issues", []) or "missing_satellite_code" in record.get("issues", []):
            unknown_satellite_count += 1
        if record.get("frp") is None:
            frp_missing_count += 1

    # Deduplication: exact duplicate detection key. No cross-sensor deduplication.
    seen: set[tuple[Any, ...]] = set()
    duplicate_count = 0
    for record in records:
        key = (
            record.get("sensor_id"),
            record.get("platform"),
            record.get("acq_date"),
            record.get("acq_time"),
            record.get("latitude"),
            record.get("longitude"),
        )
        if key in seen and record.get("valid"):
            record.setdefault("issues", []).append("duplicate")
            record["valid"] = False
            duplicate_count += 1
        else:
            seen.add(key)

    clean = [record for record in records if record.get("valid")]

    report = {
        "raw_record_count": raw_count,
        "invalid_coordinate_count": invalid_coordinate_count,
        "missing_essential_field_count": dict(missing_essential),
        "invalid_timestamp_count": invalid_timestamp_count,
        "duplicate_count": duplicate_count,
        "excluded_by_confidence_count": 0,
        "excluded_by_static_source_mask_count": 0,
        "valid_record_count": len(clean),
        "outside_study_area_count": 0,
        "final_retained_record_count": len(clean),
        "unknown_satellite_count": unknown_satellite_count,
        "boundary_touch_count": 0,
        "frp_missing_count": frp_missing_count,
        "duplicate_key": "sensor_id, platform, acq_date, acq_time, latitude, longitude",
        "deduplication_scope": "within sensor and platform only; MODIS/VIIRS are never merged",
        "confidence_filtering": "disabled (no threshold applied; all confidence levels retained)",
    }
    return clean, report
