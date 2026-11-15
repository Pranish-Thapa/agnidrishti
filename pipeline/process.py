"""End-to-end processing: raw FIRMS files -> processed JSON + public slices.

The acquisition manifest is region-scoped: files downloaded with an explicit
``region_id`` cover that study area only, while legacy Nepal files (requested
on the shared Nepal bounding box) cover the three Nepal districts. Processing
therefore runs one *scope* at a time, which both respects per-region coverage
and keeps memory bounded: a region that did not acquire a date is marked
missing for that date instead of inheriting another region's observation.

Raw MODIS and VIIRS records are never combined. A platform is marked
``unavailable`` before its documented first date (Terra 2000-11, Aqua 2002-05),
so Terra-only years cannot masquerade as Aqua zero-detection days.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import config, geometry, manifests, normalize, qc, spatial, temporal, export

LEGACY_NEPAL_SCOPE = "__NPL_LEGACY__"
GLOBAL_SCOPE = "__GLOBAL__"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_download_entries(provider: str) -> list[dict[str, Any]]:
    manifest = manifests.load_manifest(config.DOWNLOAD_MANIFEST)
    entries = [e for e in manifest.get("entries", []) if e.get("provider") == provider]
    valid = []
    seen = set()
    for entry in reversed(entries):
        if entry.get("status", "").startswith("error"):
            continue
        rel = entry.get("storage_path")
        if not rel:
            continue
        path = config.REPO_ROOT / rel
        if not path.exists():
            continue
        key = (entry.get("sensor_id"), rel)
        if key in seen:
            continue
        seen.add(key)
        valid.append((entry, path))
    valid.reverse()
    return valid


def _global_reporting(entries_with_paths: list[tuple[dict, Path]]) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
    # sensor_id -> global record count; sensor_id -> platform -> count
    counts: dict[str, int] = {sid: 0 for sid in config.SENSOR_ORDER}
    platforms: dict[str, dict[str, int]] = {sid: {} for sid in config.SENSOR_ORDER}
    for entry, path in entries_with_paths:
        sensor_id = entry["sensor_id"]
        try:
            records = normalize.normalize_file(path, sensor_id)
        except Exception:
            continue
        counts[sensor_id] += len(records)
        for record in records:
            platform = record.get("platform", "unknown")
            platforms[sensor_id][platform] = platforms[sensor_id].get(platform, 0) + 1
    return counts, platforms


def _expand_window(window: dict[str, Any]) -> set[str]:
    start, end = window.get("start"), window.get("end")
    if not start or not end:
        return set()
    current = date.fromisoformat(start)
    last = date.fromisoformat(end)
    if current > last:
        return set()
    dates: set[str] = set()
    while current <= last:
        dates.add(current.isoformat())
        current += timedelta(days=1)
    return dates


def _span_dates(dates: set[str]) -> list[str]:
    """Every calendar date between the earliest and latest acquired date.

    Interior dates that were not acquired appear as ``missing`` rather than
    being silently dropped, so a failed download chunk stays visible.
    """

    if not dates:
        return []
    start = date.fromisoformat(min(dates))
    last = date.fromisoformat(max(dates))
    out: list[str] = []
    current = start
    while current <= last:
        out.append(current.isoformat())
        current += timedelta(days=1)
    return out


def _scope_key(entry: dict[str, Any], provider: str) -> str:
    if provider == "nrt":
        return GLOBAL_SCOPE
    region_id = entry.get("region_id")
    return str(region_id) if region_id else LEGACY_NEPAL_SCOPE


def _scope_region_ids(scope: str) -> list[str]:
    if scope == GLOBAL_SCOPE:
        return list(config.REGION_ORDER)
    if scope == LEGACY_NEPAL_SCOPE:
        return [rid for rid in config.REGION_ORDER if config.REGIONS[rid].country_code == "NPL"]
    return [scope] if scope in config.REGIONS else []


def _scope_region_dates(
    entries: list[tuple[dict, Path]],
    region_ids: list[str],
) -> dict[str, dict[str, set[str]]]:
    """region -> sensor -> acquired dates (from delivered chunk windows)."""

    region_dates: dict[str, dict[str, set[str]]] = {
        rid: {sid: set() for sid in config.SENSOR_ORDER} for rid in region_ids
    }
    for entry, _ in entries:
        sensor_id = entry["sensor_id"]
        dates = _expand_window(entry.get("date_window") or {})
        if not dates:
            continue
        for rid in region_ids:
            region_dates[rid].setdefault(sensor_id, set()).update(dates)
    return region_dates


def _merge_cell_days(
    target: dict[tuple[str, str, str, str], list[dict[str, Any]]],
    batch: dict[tuple[str, str, str, str], list[dict[str, Any]]],
    region_id: str,
) -> None:
    for key, cells in batch.items():
        if key[0] != region_id:
            continue
        if key not in target:
            target[key] = cells
            continue
        # Overlapping windows are uncommon; merge by cell id without loss.
        existing = {cell["cell_id"]: cell for cell in target[key]}
        for cell in cells:
            if cell["cell_id"] in existing:
                continue
            existing[cell["cell_id"]] = cell
        target[key] = sorted(existing.values(), key=lambda item: (item["lat_index"], item["lon_index"]))


def _empty_qc_report() -> dict[str, Any]:
    return {
        "raw_record_count": 0,
        "invalid_coordinate_count": 0,
        "missing_essential_field_count": defaultdict(int),
        "invalid_timestamp_count": 0,
        "duplicate_count": 0,
        "excluded_by_confidence_count": 0,
        "excluded_by_static_source_mask_count": 0,
        "valid_record_count": 0,
        "outside_study_area_count": 0,
        "final_retained_record_count": 0,
        "unknown_satellite_count": 0,
        "boundary_touch_count": 0,
        "frp_missing_count": 0,
        "duplicate_key": "sensor_id, platform, acq_date, acq_time, latitude, longitude",
        "deduplication_scope": "within sensor and platform only; MODIS/VIIRS are never merged",
        "confidence_filtering": "disabled (no threshold applied; all confidence levels retained)",
        "assigned_by_district": defaultdict(int),
    }


def _accumulate_qc(total: dict[str, Any], batch: dict[str, Any]) -> None:
    for key in (
        "raw_record_count",
        "invalid_coordinate_count",
        "invalid_timestamp_count",
        "duplicate_count",
        "valid_record_count",
        "outside_study_area_count",
        "final_retained_record_count",
        "unknown_satellite_count",
        "boundary_touch_count",
        "frp_missing_count",
    ):
        total[key] = total.get(key, 0) + int(batch.get(key) or 0)
    for field, count in (batch.get("missing_essential_field_count") or {}).items():
        total["missing_essential_field_count"][field] += int(count)


def _group_batches(entries: list[tuple[dict, Path]]) -> list[list[tuple[dict, Path]]]:
    """Group entries by the year their window starts, keeping files intact."""

    buckets: dict[str, list[tuple[dict, Path]]] = defaultdict(list)
    for entry, path in entries:
        window = entry.get("date_window") or {}
        start = str(window.get("start") or "unknown")
        buckets[start[:4]].append((entry, path))
    return [buckets[key] for key in sorted(buckets)]


def run_processing(
    *,
    provider: str,
    boundaries_path: Path | None = None,
    into_public: bool = True,
) -> dict[str, Any]:
    config.ensure_directories()
    slug = "nrt" if provider == "nrt" else "sp"
    processed_root = config.PROCESSED_DIR / slug
    processed_root.mkdir(parents=True, exist_ok=True)
    entries_with_paths = _load_download_entries(provider)
    if not entries_with_paths:
        raise RuntimeError(
            f"No downloaded raw files found for provider '{provider}'. "
            "Run the download step first."
        )

    boundaries = geometry.load_boundaries(boundaries_path)
    index = geometry.DistrictIndex(boundaries)

    # Global per-sensor record totals. NRT uses them to decide whether a
    # sensor is reporting; area-api reporting is defined by delivered files.
    if provider == "nrt":
        global_counts, global_platforms = _global_reporting(entries_with_paths)
    else:
        global_counts = {sid: 0 for sid in config.SENSOR_ORDER}
        global_platforms = {sid: {} for sid in config.SENSOR_ORDER}
        seen_files: set[str] = set()
        for entry, _ in entries_with_paths:
            rel = entry.get("storage_path")
            if rel in seen_files:
                continue
            seen_files.add(rel)
            global_counts[entry["sensor_id"]] += int(entry.get("global_rows") or 0)

    # Sensor-level coverage is the union of acquired windows. It is metadata
    # and the basis for the overlap statement; per-region scoping happens in
    # build_daily via region_dates.
    sensor_entries: dict[str, list[dict[str, Any]]] = {sid: [] for sid in config.SENSOR_ORDER}
    for entry, _ in entries_with_paths:
        sensor_entries[entry["sensor_id"]].append(entry)

    sensor_coverage: dict[str, dict[str, Any]] = {}
    all_dates_set: set[str] = set()
    for sensor_id in config.SENSOR_ORDER:
        entries = sensor_entries[sensor_id]
        if not entries:
            continue
        date_set: set[str] = set()
        for entry in entries:
            date_set.update(_expand_window(entry.get("date_window") or {}))
        if provider == "nrt":
            reporting = global_counts.get(sensor_id, 0) > 0
        else:
            reporting = True

        platforms_info: dict[str, Any] = {}
        for platform in config.SENSORS[sensor_id].platforms:
            if provider == "nrt":
                platform_reporting = global_platforms.get(sensor_id, {}).get(platform, 0) > 0
            else:
                platform_reporting = True
            platforms_info[platform] = {
                "reporting": platform_reporting,
                "global_records": (
                    global_platforms.get(sensor_id, {}).get(platform, 0)
                    if platform_reporting
                    else 0
                ),
            }

        sensor_dates = sorted(date_set)
        if reporting:
            all_dates_set.update(sensor_dates)

        sensor_coverage[sensor_id] = {
            "sensor_id": sensor_id,
            "label": config.SENSORS[sensor_id].label,
            "instrument": config.SENSORS[sensor_id].instrument,
            "platforms": platforms_info,
            "platform_first_date": dict(config.PLATFORM_FIRST_DATE.get(sensor_id, {})),
            "product": "NRT" if provider == "nrt" else "SP",
            "source_identifier": (entries[0].get("source_identifier") if entries else None),
            "reporting": reporting,
            "unavailable_reason": None if reporting else "no records returned by the global snapshot; treated as unavailable, not zero",
            "dates": sensor_dates if reporting else [],
            "first_observation": None,
            "last_observation": None,
            "global_records": global_counts.get(sensor_id, 0),
            "district_records": 0,
            "windows": [
                {"start": e.get("date_window", {}).get("start"), "end": e.get("date_window", {}).get("end")}
                for e in entries
            ],
        }

    # Comparable period (overlap of reporting sensor date ranges) - provisional.
    reporting_sensors = [sid for sid, cov in sensor_coverage.items() if cov.get("reporting") and cov.get("dates")]
    if reporting_sensors:
        starts = [min(cov["dates"]) for cov in (sensor_coverage[s] for s in reporting_sensors)]
        ends = [max(cov["dates"]) for cov in (sensor_coverage[s] for s in reporting_sensors)]
        overlap = {"start": max(starts), "end": min(ends)}
        if overlap["start"] > overlap["end"]:
            overlap = None
    else:
        overlap = None
    sensor_coverage["_comparable_period"] = {
        "status": "provisional",
        "basis": "acquired standard-processing windows" if provider != "nrt" else "public NRT 7-day snapshot windows",
        "overlap": overlap,
        "note": "Provisional overlap of acquired sensor windows; MODIS-only years before 2012 have no VIIRS counterpart.",
    }

    # Group entries into independent acquisition scopes.
    scopes: dict[str, list[tuple[dict, Path]]] = defaultdict(list)
    for entry, path in entries_with_paths:
        scopes[_scope_key(entry, provider)].append((entry, path))

    qc_report = _empty_qc_report()
    district_days: dict[str, list[dict[str, Any]]] = {}
    district_weeks: dict[str, list[dict[str, Any]]] = {}
    built_regions: set[str] = set()
    sensor_first: dict[str, str] = {}
    sensor_last: dict[str, str] = {}
    sensor_assigned_counts: dict[str, int] = {sid: 0 for sid in config.SENSOR_ORDER}
    platform_raw_counts: dict[str, dict[str, int]] = {
        sid: dict.fromkeys(config.SENSORS[sid].platforms, 0) for sid in config.SENSOR_ORDER
    }
    region_year_counts: dict[str, dict[str, int]] = {
        rid: defaultdict(int) for rid in config.REGION_ORDER
    }
    region_sensor_counts: dict[str, dict[str, int]] = {
        rid: defaultdict(int) for rid in config.REGION_ORDER
    }
    region_detection_days: dict[str, set[str]] = {
        rid: set() for rid in config.REGION_ORDER
    }

    # Per-region accumulators shared across scopes. A study area can be covered
    # by both its own region-scoped chunks and the legacy shared-Nepal bbox
    # chunks, so the daily/weekly series are assembled once per region after
    # every scope has contributed. Giving each scope its own series would let
    # the last scope silently overwrite the other period.
    region_cell_days: dict[str, dict[tuple[str, str, str, str], list[dict[str, Any]]]] = {
        rid: {} for rid in config.REGION_ORDER
    }
    region_dates_all: dict[str, dict[str, set[str]]] = {
        rid: {sid: set() for sid in config.SENSOR_ORDER} for rid in config.REGION_ORDER
    }

    for scope, scope_entries in scopes.items():
        region_ids = _scope_region_ids(scope)
        if not region_ids:
            continue
        region_dates = _scope_region_dates(scope_entries, region_ids)
        for rid in region_ids:
            for sid in config.SENSOR_ORDER:
                region_dates_all[rid][sid].update(region_dates.get(rid, {}).get(sid, set()))

        for batch in _group_batches(scope_entries):
            records: list[dict[str, Any]] = []
            for entry, path in batch:
                sensor_id = entry["sensor_id"]
                for record in normalize.normalize_file(path, sensor_id):
                    record["_source_entry"] = entry.get("entry_id")
                    records.append(record)
            for record in records:
                platform = record.get("platform")
                if platform in platform_raw_counts.get(record["sensor_id"], {}):
                    platform_raw_counts[record["sensor_id"]][platform] += 1
            clean, batch_qc = qc.run_qc(records)
            assigned, spatial_summary = spatial.assign_study_areas(clean, index)
            batch_qc["outside_study_area_count"] = spatial_summary["outside_study_area_count"]
            batch_qc["boundary_touch_count"] = spatial_summary["boundary_touch_count"]
            _accumulate_qc(qc_report, batch_qc)
            for district_id, count in (spatial_summary.get("assigned_by_district") or {}).items():
                qc_report["assigned_by_district"][district_id] += count
            for record in assigned:
                day = record.get("acq_date")
                if day:
                    sensor_id = record["sensor_id"]
                    region_id = record.get("district_id")
                    sensor_assigned_counts[sensor_id] = sensor_assigned_counts.get(sensor_id, 0) + 1
                    if sensor_id not in sensor_first or day < sensor_first[sensor_id]:
                        sensor_first[sensor_id] = day
                    if sensor_id not in sensor_last or day > sensor_last[sensor_id]:
                        sensor_last[sensor_id] = day
                    if region_id:
                        region_year_counts[region_id][day[:4]] += 1
                        region_sensor_counts[region_id][sensor_id] += 1
                        region_detection_days[region_id].add(day)
            cell_days = spatial.build_cell_days(assigned)
            for rid in region_ids:
                _merge_cell_days(region_cell_days[rid], cell_days, rid)

    for rid in config.REGION_ORDER:
        dates = _span_dates(set().union(*region_dates_all[rid].values()))
        if not dates:
            continue
        acquired_any = any(region_dates_all[rid].get(sid) for sid in config.SENSOR_ORDER)
        if not acquired_any:
            continue
        days = temporal.build_daily(
            rid,
            dates,
            sensor_coverage,
            region_cell_days[rid],
            region_dates=region_dates_all[rid],
        )
        weeks = temporal.build_weekly(days, cell_days=region_cell_days[rid], district_id=rid)
        district_days[rid] = days
        district_weeks[rid] = weeks
        built_regions.add(rid)

    qc_report["final_retained_record_count"] = sum(qc_report["assigned_by_district"].values())

    for sensor_id, cov in sensor_coverage.items():
        if sensor_id == "_comparable_period":
            continue
        cov["first_observation"] = sensor_first.get(sensor_id)
        cov["last_observation"] = sensor_last.get(sensor_id)
        cov["district_records"] = sensor_assigned_counts.get(sensor_id, 0)
        cov["global_records"] = sum(platform_raw_counts.get(sensor_id, {}).values())
        for platform, pinfo in (cov.get("platforms") or {}).items():
            pinfo["global_records"] = platform_raw_counts.get(sensor_id, {}).get(platform, 0)

    # Region status: a region with files but zero detections is still observed
    # (observed_zero); a region with no files is not acquired.
    assigned_counts = qc_report.get("assigned_by_district", {})
    region_status: dict[str, dict[str, Any]] = {}
    for region_id in config.REGION_ORDER:
        if region_id not in built_regions:
            region_status[region_id] = {
                "status": "not_acquired",
                "reason": (
                    "No standard-processing files have been acquired for this region. "
                    "The region is shown with its boundary but no observations; this is "
                    "missing coverage, not zero fire activity."
                ),
                "records": 0,
            }
        else:
            region_status[region_id] = {
                "status": "available",
                "records": int(assigned_counts.get(region_id, 0)),
            }

    all_dates_sorted = sorted(all_dates_set)
    years_list = sorted({value[:4] for value in all_dates_sorted})

    qc_report["provider"] = provider
    qc_report["generated_at"] = _utc_now()
    qc_report["missing_essential_field_count"] = dict(qc_report["missing_essential_field_count"])
    qc_report["assigned_by_district"] = dict(qc_report["assigned_by_district"])
    qc_report["records_by_region"] = {
        rid: int(sum(region_year_counts[rid].values())) for rid in config.REGION_ORDER
    }
    qc_report["records_by_region_year"] = {
        rid: dict(sorted(region_year_counts[rid].items())) for rid in config.REGION_ORDER
    }
    qc_report["records_by_region_sensor"] = {
        rid: dict(sorted(region_sensor_counts[rid].items())) for rid in config.REGION_ORDER
    }
    qc_report["detection_days_by_region"] = {
        rid: len(region_detection_days[rid]) for rid in config.REGION_ORDER
    }
    qc_report["raw_totals_not_comparable_across_regions"] = True
    qc_report["note"] = (
        "Raw detection totals are not comparable across the six study areas: "
        "they differ in area by two orders of magnitude. Compare only after "
        "normalising by area and valid observation days."
    )

    generated_at = _utc_now()
    if into_public:
        export.export(
            district_days=district_days,
            district_weeks=district_weeks,
            sensor_coverage=sensor_coverage,
            qc_report=qc_report,
            boundaries=boundaries,
            provider=provider,
            product="NRT" if provider == "nrt" else "SP",
            generated_at=generated_at,
            processed_root=processed_root,
            public_root=config.PUBLIC_DATA_DIR / slug,
            region_status=region_status,
            years=years_list,
        )

    manifests.write_json(processed_root / "sensor_coverage.json", {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": generated_at,
        "provider": provider,
        "product": "NRT" if provider == "nrt" else "SP",
        "sensors": {k: v for k, v in sensor_coverage.items()},
    })

    manifests.save_manifest(config.MANIFEST_DIR / f"processing_manifest_{slug}.json", {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": generated_at,
        "provider": provider,
        "product": "NRT" if provider == "nrt" else "SP",
        "slug": slug,
        "years": years_list,
        "regions": list(config.REGION_ORDER),
        "regions_with_observations": sorted(district_days),
        "region_status": region_status,
        "sensors": list(config.SENSOR_ORDER),
        "quality_report": config.relative(processed_root / "quality_report.json"),
        "sensor_coverage": config.relative(processed_root / "sensor_coverage.json"),
        "public_index": config.relative(config.PUBLIC_DATA_DIR / slug / "index.json"),
    })
    return {
        "provider": provider,
        "regions": list(config.REGION_ORDER),
        "regions_with_observations": sorted(district_days),
        "region_status": region_status,
        "dates": all_dates_sorted,
        "record_count": qc_report["final_retained_record_count"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Process downloaded FIRMS data.")
    parser.add_argument("--provider", choices=["nrt", "area-api"], default="nrt")
    parser.add_argument("--boundaries", type=Path, default=None)
    parser.add_argument("--no-public", action="store_true")
    args = parser.parse_args()
    result = run_processing(provider=args.provider, boundaries_path=args.boundaries, into_public=not args.no_public)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
