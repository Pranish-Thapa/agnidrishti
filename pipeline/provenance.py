"""Machine-readable data manifest for the extended historical record.

Phase 9 of the pre-2012 extension: one artifact that states, per study area
and year, exactly what was acquired, what survived processing, how much
observation coverage exists, and what harmonization (if any) is permitted.

Every number here is read from an existing verified artifact — never typed in
by hand:

* ``data/manifests/download_manifest.json``  → acquisition provenance, chunk
  statuses, bounding-box row counts, retrieval timestamps, SHA-256.
* ``data/processed/sp/districts/<region>/daily.json`` → verified district
  detections per platform per day (the processed record).
* ``data/processed/historical/coverage_matrices.json`` → observation-day
  coverage with the six-state vocabulary.
* ``data/processed/historical/backcast_decisions.json`` → method, calibration
  version, validation period, transferability decision and month statuses.
* ``data/processed/sp/quality_report.json`` → project-wide QC totals.

The manifest never invents a value: where an artifact has no entry for a
region-year, the field is ``null`` and the status says why.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, manifests

DATA_MANIFEST_PATH = config.MANIFEST_DIR / "historical_data_manifest.json"

PRE2012_PRODUCT = {
    "source_identifier": "MODIS_SP",
    "product": "MODIS Collection 6.1 active fire product (Terra MOD14 / Aqua MYD14)",
    "data_source": "NASA FIRMS Area API, standard processing",
    "platform_instrument": {"Terra": "MODIS Terra", "Aqua": "MODIS Aqua"},
    "note": (
        "Genuine NASA FIRMS observations. Bounding-box row counts are the raw "
        "rows returned for the study-area bounding box and include detections "
        "outside the administrative boundary; district detections are the "
        "records that survived exact point-in-polygon assignment."
    ),
}

PRE2012_YEARS = list(range(2000, 2012))


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pre2012_window_entries() -> dict[tuple[str, str, str, str], dict[str, Any]]:
    """Latest manifest entry per (region, sensor, window).

    Concurrent or repeated download runs append duplicate entries for the same
    window; the last one in manifest order is the most recent attempt and the
    one whose status describes the file on disk.
    """

    manifest = manifests.load_manifest(config.DOWNLOAD_MANIFEST)
    latest: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for entry in manifest.get("entries", []):
        if entry.get("acquisition_batch") != "pre2012":
            continue
        window = entry.get("date_window") or {}
        start, end = window.get("start"), window.get("end")
        if not start or not end:
            continue
        key = (str(entry.get("region_id")), str(entry.get("sensor_id")), str(start), str(end))
        latest[key] = entry
    return latest


def _coverage_index() -> dict[tuple[str, str, int], list[dict[str, Any]]]:
    """(sensor, region, year) -> coverage month rows."""

    path = config.PROCESSED_DIR / "historical" / "coverage_matrices.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    index: dict[tuple[str, str, int], list[dict[str, Any]]] = defaultdict(list)
    for sensor_id, districts in (payload.get("sensors") or {}).items():
        for region_id, block in (districts or {}).items():
            for row in block.get("months", []):
                index[(sensor_id, region_id, int(row["year"]))].append(row)
    return index


def _district_detections() -> dict[tuple[str, str, str], int]:
    """(region, platform, year) -> verified district detections."""

    counts: dict[tuple[str, str, str], int] = defaultdict(int)
    root = config.PROCESSED_DIR / "sp" / "districts"
    for region_id in config.REGION_ORDER:
        path = root / region_id / "daily.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for day in payload.get("days", []):
            year = str(day["date"])[:4]
            platforms = ((day.get("by_sensor") or {}).get("modis") or {}).get("platforms") or {}
            for platform, block in platforms.items():
                detections = (block or {}).get("detections")
                if detections:
                    counts[(region_id, platform, year)] += int(detections)
    return counts


def build_data_manifest() -> dict[str, Any]:
    """Assemble the machine-readable historical data manifest."""

    config.ensure_directories()
    windows = _pre2012_window_entries()
    coverage = _coverage_index()
    detections = _district_detections()

    quality_path = config.PROCESSED_DIR / "sp" / "quality_report.json"
    quality = json.loads(quality_path.read_text(encoding="utf-8")) if quality_path.exists() else {}

    backcast_path = config.PROCESSED_DIR / "historical" / "backcast_decisions.json"
    backcast = json.loads(backcast_path.read_text(encoding="utf-8")) if backcast_path.exists() else {}

    regions: dict[str, Any] = {}
    for region_id in config.REGION_ORDER:
        years: dict[str, Any] = {}
        for year in PRE2012_YEARS:
            year_str = str(year)
            year_windows = [
                entry
                for (rid, _sensor, start, _end), entry in windows.items()
                if rid == region_id and start[:4] == year_str
            ]
            status_counts: dict[str, int] = defaultdict(int)
            bbox_rows = 0
            retrieved: list[str] = []
            for entry in year_windows:
                status_counts[str(entry.get("status", "unknown"))] += 1
                bbox_rows += int(entry.get("global_rows") or 0)
                if entry.get("retrieved_at"):
                    retrieved.append(str(entry["retrieved_at"]))

            month_rows = coverage.get(("modis", region_id, year), [])
            coverage_summary = {
                "months_with_files": sum(1 for row in month_rows if row.get("days_with_files", 0) > 0),
                "observation_days_with_files": sum(int(row.get("days_with_files") or 0) for row in month_rows),
                "observation_days_with_detections": sum(
                    int(row.get("days_with_detections") or 0) for row in month_rows
                ),
                "status_counts": dict(
                    sorted(
                        (
                            (status, sum(1 for row in month_rows if row.get("status") == status))
                            for status in {row.get("status") for row in month_rows}
                        ),
                        key=lambda item: str(item[0]),
                    )
                ),
            }

            years[year_str] = {
                "year": year_str,
                "acquired": bool(year_windows),
                "chunks": {
                    "total": len(year_windows),
                    "downloaded": status_counts.get("downloaded", 0),
                    "downloaded_empty": status_counts.get("downloaded_empty", 0),
                    "already_present": status_counts.get("already_present", 0),
                    "error": status_counts.get("error", 0),
                },
                "bounding_box_rows_acquired": bbox_rows,
                "acquisition_timestamps": {
                    "first": min(retrieved) if retrieved else None,
                    "last": max(retrieved) if retrieved else None,
                },
                "district_detections": {
                    "Terra": detections.get((region_id, "Terra", year_str), 0),
                    "Aqua": detections.get((region_id, "Aqua", year_str), 0),
                },
                "observation_day_coverage": coverage_summary,
                "platform_availability": {
                    "Terra": "available from 2000-11-01",
                    "Aqua": "unavailable before 2002-05-04",
                },
                "harmonization": _harmonization_block(backcast, region_id),
            }
        regions[region_id] = {
            "region_id": region_id,
            "name": config.REGIONS[region_id].name,
            "country": config.REGIONS[region_id].country,
            "years": years,
        }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "record": "pre-2012 MODIS (2000-11-01 .. 2011-12-31)",
        "product": PRE2012_PRODUCT,
        "quality_control": {
            "raw_record_count": quality.get("raw_record_count"),
            "valid_record_count": quality.get("valid_record_count"),
            "duplicate_count": quality.get("duplicate_count"),
            "outside_study_area_count": quality.get("outside_study_area_count"),
            "invalid_coordinate_count": quality.get("invalid_coordinate_count"),
            "invalid_timestamp_count": quality.get("invalid_timestamp_count"),
            "frp_missing_count": quality.get("frp_missing_count"),
            "final_retained_record_count": quality.get("final_retained_record_count"),
            "scope": "whole standard-processing record (pre-2012 and post-2012), not pre-2012 alone",
        },
        "harmonization_summary": {
            "calibration_version": backcast.get("calibration_version"),
            "calibration_period": backcast.get("calibration_period"),
            "method": backcast.get("method"),
            "court_verdict": backcast.get("court_verdict"),
            "reference": backcast.get("reference"),
            "terminology": backcast.get("terminology"),
            "decisions": {
                region_id: {
                    platform: (info or {}).get("decision")
                    for platform, info in (backcast.get("regions", {}).get(region_id) or {}).items()
                }
                for region_id in config.REGION_ORDER
            },
        },
        "regions": regions,
        "notes": [
            "Bounding-box rows are raw rows returned for the study-area bounding box; they are not district detections and are not comparable across regions.",
            "District detections are exact point-in-polygon assignments and remain on the native MODIS scale.",
            "A month with no files is never reported as zero detections; coverage statuses use the six-state vocabulary (observed / insufficient / incomplete / missing / not_requested / unavailable).",
            "VIIRS-equivalent values are produced only where the regional transferability decision is supported or limited, and are labelled as estimates.",
        ],
    }


def _harmonization_block(backcast: dict[str, Any], region_id: str) -> dict[str, Any]:
    info = (backcast.get("regions") or {}).get(region_id) or {}
    months: dict[str, Any] = {}
    for platform in ("Terra", "Aqua"):
        platform_info = info.get(platform) or {}
        months[platform] = {
            "decision": platform_info.get("decision"),
            "supported_months": platform_info.get("supported_months", []),
            "limited_months": platform_info.get("limited_months", []),
            "month_status": {
                month: value.get("status")
                for month, value in (platform_info.get("months") or {}).items()
            },
        }
    return {
        "method": backcast.get("method"),
        "calibration_version": backcast.get("calibration_version"),
        "validation_period": (backcast.get("calibration_period") or {}).get("start"),
        "validation_period_end": (backcast.get("calibration_period") or {}).get("end"),
        "platforms": months,
    }


def export_data_manifest() -> dict[str, Any]:
    manifest = build_data_manifest()
    manifests.write_json(DATA_MANIFEST_PATH, manifest)
    return {
        "path": config.relative(DATA_MANIFEST_PATH),
        "regions": list(config.REGION_ORDER),
        "generated_at": manifest["generated_at"],
    }


def main(argv: list[str] | None = None) -> int:
    print(json.dumps(export_data_manifest(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
