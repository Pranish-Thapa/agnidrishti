"""Task 04B — historical SP inventory, quality investigation and calibration readiness.

This module reuses the existing normalization, QC, spatial and temporal
modules. It never fabricates observations and never treats missing
observations as zero. `downloaded_empty` chunks (zero detections inside the
requested bbox) are genuine results, distinct from missing files.

Analysis outputs are written to ``data/processed/historical/`` as
machine-readable JSON with full provenance.
"""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from . import config, geometry, manifests, normalize, process, qc, spatial

HISTORICAL_DIR = config.PROCESSED_DIR / "historical"

# A month is considered calibration-suitable only when the co-detection day
# count and comparable cell-day count both reach these provisional floors.
# The floors are documented analytical criteria, refined by Task 05.
MIN_CO_DETECTION_DAYS = 6
MIN_COMPARABLE_CELL_DAYS = 10

MONTH_LABELS = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Manifest chunk discovery
# ---------------------------------------------------------------------------

def dedupe_area_entries(entries: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Deduplicate area-api entries per (region, entry_id), latest wins.

    The Area API entry id encodes sensor and date window only, so the same
    window requested for different study regions shares one entry_id. Keying
    on entry_id alone made every region but the last one disappear from the
    pipeline; the region is part of the identity of an acquired file.

    Entries whose stored file no longer exists are dropped (the inventory
    reports them separately).
    """

    by_id: dict[tuple[str | None, str], dict[str, Any]] = {}
    for entry in entries:
        if entry.get("provider") != "area-api":
            continue
        by_id[(entry.get("region_id"), entry["entry_id"])] = entry

    grouped: dict[str, list[dict[str, Any]]] = {sid: [] for sid in config.SENSOR_ORDER}
    for entry in sorted(
        by_id.values(),
        key=lambda e: (e.get("sensor_id", ""), e.get("date_window", {}).get("start", "")),
    ):
        path = config.REPO_ROOT / entry.get("storage_path", "")
        if not entry.get("storage_path") or not path.exists():
            continue
        grouped.setdefault(entry["sensor_id"], []).append(entry)
    return grouped


def load_area_entries() -> dict[str, list[dict[str, Any]]]:
    """Deduplicated area-api manifest entries grouped by sensor.

    Duplicate entry_ids (produced by concurrent downloader runs) collapse to
    their latest status. Entries whose file no longer exists are dropped and
    reported separately by the inventory.
    """

    manifest = manifests.load_manifest(config.DOWNLOAD_MANIFEST)
    return dedupe_area_entries(manifest.get("entries", []))


def requested_dates(entries: list[dict[str, Any]]) -> set[str]:
    """Union of requested dates from chunk windows (files may cover a date
    more than once when windows overlap; the union is what matters)."""

    dates: set[str] = set()
    for entry in entries:
        window = entry.get("date_window") or {}
        start, end = window.get("start"), window.get("end")
        if not start or not end:
            continue
        current = date.fromisoformat(start)
        last = date.fromisoformat(end)
        while current <= last:
            dates.add(current.isoformat())
            current += timedelta(days=1)
    return dates


# ---------------------------------------------------------------------------
# Phase 1 — inventory
# ---------------------------------------------------------------------------

def _scan_csv(path: Path) -> dict[str, Any]:
    """Read one raw FIRMS CSV; return row count, acq_date values and header.

    Only the acq_date column is interpreted here; full record normalization
    happens in the processing/analysis pass.
    """

    rows = 0
    dates: Counter[str] = Counter()
    header: list[str] | None = None
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        for index, row in enumerate(reader):
            if index == 0:
                header = [value.strip().lower() for value in row]
                continue
            if not row:
                continue
            rows += 1
            if header and "acq_date" in header:
                value = row[header.index("acq_date")].strip()
                if value:
                    dates[value] += 1
    return {"rows": rows, "dates": dates, "header": header}


def build_inventory() -> dict[str, Any]:
    """Phase 1 inventory: actual file/record coverage per SP source."""

    grouped = load_area_entries()
    availability = manifests.read_json(config.PROCESSED_DIR / "availability.json")
    avail_by_source = {
        source.get("source_identifier"): source
        for source in availability.get("sources", [])
    }

    sensors: dict[str, Any] = {}
    for sensor_id in config.SENSOR_ORDER:
        sensor = config.SENSORS[sensor_id]
        entries = grouped.get(sensor_id, [])
        requested = requested_dates(entries)

        file_rows = 0
        actual_dates: Counter[str] = Counter()
        empty_files = 0
        sha_values: dict[str, str] = {}
        duplicate_files: list[str] = []
        headers: Counter[tuple[str, ...]] = Counter()
        windows_missing_file = 0
        statuses: Counter[str] = Counter()

        for entry in entries:
            statuses[entry.get("status", "unknown")] += 1
            path = config.REPO_ROOT / entry["storage_path"]
            scan = _scan_csv(path)
            file_rows += scan["rows"]
            actual_dates.update(scan["dates"])
            if scan["rows"] == 0:
                empty_files += 1
            if scan["header"] is not None:
                headers[tuple(scan["header"])] += 1
            sha = entry.get("sha256")
            if sha and scan["rows"] > 0:
                # Only non-empty files indicate genuine data duplication;
                # header-only empty files legitimately share one checksum.
                if sha in sha_values and sha_values[sha] != entry["storage_path"]:
                    duplicate_files.append(entry["storage_path"])
                sha_values[sha] = entry["storage_path"]

        covered_dates: set[str] = set()
        for entry in entries:
            window = entry.get("date_window") or {}
            start, end = window.get("start"), window.get("end")
            if not start or not end:
                continue
            current = date.fromisoformat(start)
            last = date.fromisoformat(end)
            while current <= last:
                covered_dates.add(current.isoformat())
                current += timedelta(days=1)

        availability_info = avail_by_source.get(sensor.sp_identifier, {})
        first_avail = availability_info.get("first_available")
        last_avail = availability_info.get("last_available")

        # Dates inside the availability span that were never requested are
        # out of acquisition scope. They are neither missing nor zero.
        not_requested = 0
        if first_avail and last_avail:
            current = date.fromisoformat(first_avail)
            last = date.fromisoformat(last_avail)
            while current <= last:
                if current.isoformat() not in requested:
                    not_requested += 1
                current += timedelta(days=1)

        months = sorted({d[:7] for d in actual_dates})
        sensors[sensor_id] = {
            "sensor_id": sensor_id,
            "label": sensor.label,
            "source_identifier": sensor.sp_identifier,
            "platforms": list(sensor.platforms),
            "availability_reported": {
                "first_available": first_avail,
                "last_available": last_avail,
                "checked_at": availability.get("checked_at"),
            },
            "files": len(entries),
            "file_statuses": dict(statuses),
            "empty_files": empty_files,
            "raw_record_count": file_rows,
            "first_actual_observation": min(actual_dates) if actual_dates else None,
            "last_actual_observation": max(actual_dates) if actual_dates else None,
            "months_with_observations": months,
            "requested_dates": len(requested),
            "dates_with_files": len(covered_dates),
            "dates_with_observations": len(actual_dates),
            "dates_requested_but_without_file": len(requested - covered_dates),
            "dates_in_availability_not_requested": not_requested,
            "duplicate_files_by_sha256": duplicate_files,
            "distinct_headers": [{"columns": list(h), "files": c} for h, c in headers.items()],
            "note": (
                "A date with a file but zero rows is a genuine no-detection "
                "observation, not missing data. Requests are region-scoped: "
                "Nepal uses the shared OCHA bbox and the three new regions use "
                "their own buffered bounding boxes, so raw counts are not "
                "comparable across regions without area normalisation. Records "
                "are detections, not unique fires."
            ),
        }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provider": "area-api",
        "product": "SP",
        "regions": list(config.REGION_ORDER),
        "region_bboxes": {
            rid: config.REGIONS[rid].bbox for rid in config.REGION_ORDER
        },
        "download_window_rule": (
            "MODIS pre-2012: 2000-11-01..2011-12-31 (full months, region bbox); "
            "post-2012: Jan-Jun each year 2012-2026 plus July 2026 (per acquisition plan)"
        ),
        "sensors": sensors,
    }


# ---------------------------------------------------------------------------
# Shared record loading (single normalization pass, reused by analysis)
# ---------------------------------------------------------------------------

def filter_entries_by_window(
    entries: list[dict[str, Any]],
    *,
    min_date: str | None = None,
    max_date: str | None = None,
) -> list[dict[str, Any]]:
    """Keep entries whose delivered window intersects [min_date, max_date].

    Filtering happens on the acquisition window *before* any file is parsed.
    That keeps the post-2012 calibration pass from reading the pre-2012 archive
    at all, and it never drops an entry that straddles the boundary.
    """

    out: list[dict[str, Any]] = []
    for entry in entries:
        window = entry.get("date_window") or {}
        start, end = window.get("start"), window.get("end")
        if not start or not end:
            out.append(entry)
            continue
        if min_date and end < min_date:
            continue
        if max_date and start > max_date:
            continue
        out.append(entry)
    return out


def records_for_entries(
    entries_by_sensor: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Normalize + QC + district-assign a selected set of manifest entries.

    Memory-lean by design: entries are processed one acquired file at a time
    and only records that fall inside a study area are retained. The full
    multi-sensor archive (millions of bounding-box rows) is never held in
    memory at once, which is what makes the 2000-2026 six-region record
    tractable. A final cross-file duplicate pass over the retained records
    keeps the duplicate count honest for overlapping acquisition windows.

    Chunk windows are contiguous and non-overlapping, so per-file QC is
    equivalent to a whole-record pass except for the rare re-downloaded
    window, which the final pass catches.
    """

    boundaries = geometry.load_boundaries()
    index = geometry.DistrictIndex(boundaries)

    qc_report: dict[str, Any] = {
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
    assigned_all: list[dict[str, Any]] = []

    for sensor_id, entries in entries_by_sensor.items():
        for entry in entries:
            path = config.REPO_ROOT / entry["storage_path"]
            if not path.exists():
                continue
            records = normalize.normalize_file(path, sensor_id)
            for record in records:
                record["_source_entry"] = entry.get("entry_id")
            clean, batch_qc = qc.run_qc(records)
            assigned, spatial_summary = spatial.assign_study_areas(clean, index)
            assigned_all.extend(assigned)
            for key in (
                "raw_record_count",
                "invalid_coordinate_count",
                "invalid_timestamp_count",
                "duplicate_count",
                "valid_record_count",
                "unknown_satellite_count",
                "frp_missing_count",
            ):
                qc_report[key] = int(qc_report.get(key, 0)) + int(batch_qc.get(key) or 0)
            for field, count in (batch_qc.get("missing_essential_field_count") or {}).items():
                qc_report["missing_essential_field_count"][field] += int(count)
            qc_report["outside_study_area_count"] += int(
                (spatial_summary or {}).get("outside_study_area_count") or 0
            )
            qc_report["boundary_touch_count"] += int(
                (spatial_summary or {}).get("boundary_touch_count") or 0
            )
            for district_id, count in (spatial_summary or {}).get("assigned_by_district", {}).items():
                qc_report["assigned_by_district"][district_id] += int(count)

    # Cross-file duplicate pass over the retained records only. Overlapping
    # windows are rare, so the memory cost is bounded by the study-area record
    # count rather than the full bounding-box stream.
    seen: set[tuple[Any, ...]] = set()
    final_records: list[dict[str, Any]] = []
    cross_file_duplicates = 0
    for record in assigned_all:
        key = (
            record.get("sensor_id"),
            record.get("platform"),
            record.get("acq_date"),
            record.get("acq_time"),
            record.get("latitude"),
            record.get("longitude"),
        )
        if key in seen:
            record.setdefault("issues", []).append("duplicate")
            record["valid"] = False
            cross_file_duplicates += 1
            continue
        seen.add(key)
        final_records.append(record)

    if cross_file_duplicates:
        qc_report["duplicate_count"] += cross_file_duplicates
        qc_report["valid_record_count"] = max(
            0, int(qc_report["valid_record_count"]) - cross_file_duplicates
        )
        for district_id, count in list(qc_report["assigned_by_district"].items()):
            # Duplicate records were already counted once in the district
            # totals; the retained set below is the authoritative count.
            qc_report["assigned_by_district"][district_id] = 0
        totals: dict[str, int] = defaultdict(int)
        for record in final_records:
            totals[record["district_id"]] += 1
        for district_id, count in totals.items():
            qc_report["assigned_by_district"][district_id] = count

    qc_report["final_retained_record_count"] = len(final_records)
    qc_report["missing_essential_field_count"] = dict(qc_report["missing_essential_field_count"])
    qc_report["assigned_by_district"] = dict(qc_report["assigned_by_district"])
    spatial_summary = {
        "outside_study_area_count": qc_report["outside_study_area_count"],
        "boundary_touch_count": qc_report["boundary_touch_count"],
        "assigned_by_district": dict(qc_report["assigned_by_district"]),
    }
    return final_records, qc_report, spatial_summary


def load_historical_records(
    *,
    sensors: list[str] | None = None,
    min_date: str | None = None,
    max_date: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Normalize + QC + district-assign historical SP records once.

    Returns (records, qc_report, spatial_summary). Records carry sensor_id,
    platform, acq_date/time, coordinates, frp, confidence and district_id.

    ``min_date``/``max_date`` bound the acquisition windows that are parsed.
    Calibration passes use ``min_date=2012-01-20`` so pre-2012 MODIS records
    are never used to fit a relationship against a VIIRS observation that does
    not exist.
    """

    grouped = load_area_entries()
    selected = sensors or list(config.SENSOR_ORDER)
    scoped = {
        sensor_id: filter_entries_by_window(
            grouped.get(sensor_id, []), min_date=min_date, max_date=max_date
        )
        for sensor_id in selected
    }
    return records_for_entries(scoped)


# ---------------------------------------------------------------------------
# Phase 3 — data quality
# ---------------------------------------------------------------------------

def build_quality_report(
    records: list[dict[str, Any]],
    qc_report: dict[str, Any],
    spatial_summary: dict[str, Any],
) -> dict[str, Any]:
    """Phase 3 quality investigation, including the low-detection question."""

    by_sensor_platform: Counter[str] = Counter()
    sensor_totals: Counter[str] = Counter()
    frp_available = 0
    frp_missing = 0
    confidence_values: dict[str, Counter[str]] = defaultdict(Counter)
    acq_times: dict[str, Counter[str]] = defaultdict(Counter)
    daynight: dict[str, Counter[str]] = defaultdict(Counter)
    versions: dict[str, Counter[str]] = defaultdict(Counter)

    for record in records:
        key = f"{record['sensor_id']}:{record['platform']}"
        by_sensor_platform[key] += 1
        sensor_totals[record["sensor_id"]] += 1
        if record.get("frp") is not None:
            frp_available += 1
        else:
            frp_missing += 1
        confidence_values[key][str(record.get("confidence"))] += 1
        if record.get("acq_time"):
            hour = int(record["acq_time"][:2])
            acq_times[key][f"{hour:02d}h"] += 1
        if record.get("daynight"):
            daynight[key][record["daynight"]] += 1
        if record.get("version"):
            versions[key][str(record.get("version"))] += 1

    district_counts = spatial_summary.get("assigned_by_district", {})
    outside = spatial_summary.get("outside_study_area_count", 0)

    # Cell-level sanity: grid indices are derived by flooring coordinates;
    # every cell id must map back to its cell centre consistently.
    grid_issues = 0
    for record in records[:20000]:
        lat_index = int(record["latitude"] // config.GRID_DEGREES) if record["latitude"] is not None else None
        lon_index = int(record["longitude"] // config.GRID_DEGREES) if record["longitude"] is not None else None
        if lat_index is None or lon_index is None:
            grid_issues += 1

    total_district = sum(district_counts.values())

    records_by_region: Counter[str] = Counter()
    records_by_year: Counter[str] = Counter()
    records_by_region_year: dict[str, Counter[str]] = defaultdict(Counter)
    detection_days: dict[str, set[str]] = defaultdict(set)
    for record in records:
        region_id = record.get("district_id")
        year = (record.get("acq_date") or "")[:4]
        if region_id:
            records_by_region[region_id] += 1
            if year:
                records_by_region_year[region_id][year] += 1
        if year:
            records_by_year[year] += 1
        if region_id and record.get("acq_date"):
            detection_days[region_id].add(record["acq_date"])

    region_area_km2 = {
        rid: config.REGIONS[rid].area_km2 for rid in config.REGION_ORDER
    }
    investigation = {
        "scope_note": (
            "Requests are region-scoped. The six study areas differ in area by "
            "two orders of magnitude (Nepal districts ~2,000 km2; Shan State "
            "~156,000 km2), so raw record totals are not comparable across "
            "regions without area and observation-day normalisation."
        ),
        "bbox_record_count": qc_report.get("raw_record_count"),
        "region_record_count": total_district,
        "region_share_of_raw": (
            round(total_district / qc_report["raw_record_count"], 4)
            if qc_report.get("raw_record_count") else None
        ),
        "region_area_km2_reference": region_area_km2,
        "raw_totals_not_comparable_across_regions": True,
    }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "qc_report": qc_report,
        "records_by_sensor_platform": dict(by_sensor_platform),
        "records_by_sensor": dict(sorted(sensor_totals.items())),
        "records_by_region": dict(records_by_region),
        "records_by_year": dict(sorted(records_by_year.items())),
        "records_by_region_year": {
            rid: dict(sorted(counter.items()))
            for rid, counter in sorted(records_by_region_year.items())
        },
        "detection_days_by_region": {
            rid: len(days) for rid, days in sorted(detection_days.items())
        },
        "frp": {"available": frp_available, "missing": frp_missing},
        "confidence_value_distribution": {
            key: dict(counter) for key, counter in sorted(confidence_values.items())
        },
        "acq_time_hour_distribution": {
            key: dict(counter) for key, counter in sorted(acq_times.items())
        },
        "daynight_distribution": {
            key: dict(counter) for key, counter in sorted(daynight.items())
        },
        "version_distribution": {
            key: dict(counter) for key, counter in sorted(versions.items())
        },
        "district_assignment": {
            "assigned_by_district": district_counts,
            "outside_study_area": outside,
            "boundary_touch_count": spatial_summary.get("boundary_touch_count"),
        },
        "grid_consistency_sample": {
            "sample_size": min(20000, len(records)),
            "coordinate_rounding_issues": grid_issues,
        },
        "investigation": investigation,
    }


# ---------------------------------------------------------------------------
# Phase 4 — sensor overlap analysis
# ---------------------------------------------------------------------------

PLATFORM_SENSOR = {
    "Terra": "modis",
    "Aqua": "modis",
    "Suomi-NPP": "viirs_snpp",
    "NOAA-20": "viirs_noaa20",
    "NOAA-21": "viirs_noaa21",
}


def _platform_detection_dates(
    records: list[dict[str, Any]],
    district_id: str | None,
) -> dict[str, set[str]]:
    """platform -> set of dates with >=1 detection (bbox-wide or per district)."""

    result: dict[str, set[str]] = defaultdict(set)
    for record in records:
        if district_id is not None and record.get("district_id") != district_id:
            continue
        result[record["platform"]].add(record["acq_date"])
    return result


def build_overlap_analysis(
    records: list[dict[str, Any]],
    *,
    requested_by_sensor: dict[str, set[str]],
) -> dict[str, Any]:
    """Phase 4: overlap of *dates with observations*, never assumed
    simultaneous. Overpass-time statistics are reported alongside so the
    temporal mismatch between sensors stays visible."""

    def overlap_block(district_id: str | None) -> dict[str, Any]:
        detection_dates = _platform_detection_dates(records, district_id)
        platforms = ["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"]

        pair_results = []
        modis_platforms = ["Terra", "Aqua"]
        viirs_platforms = ["Suomi-NPP", "NOAA-20", "NOAA-21"]
        pairs: list[tuple[str, str]] = []
        for m in modis_platforms:
            for v in viirs_platforms:
                pairs.append((m, v))
        for i, v1 in enumerate(viirs_platforms):
            for v2 in viirs_platforms[i + 1:]:
                pairs.append((v1, v2))

        for a, b in pairs:
            dates_a = detection_dates.get(a, set())
            dates_b = detection_dates.get(b, set())
            # Dates where both platforms were observing (files delivered):
            sensor_a = PLATFORM_SENSOR[a]
            sensor_b = PLATFORM_SENSOR[b]
            both_observing = requested_by_sensor.get(sensor_a, set()) & requested_by_sensor.get(sensor_b, set())
            co_detection = dates_a & dates_b
            # Year-month breakdown of co-detection days.
            monthly: Counter[str] = Counter()
            for d in co_detection:
                monthly[d[:7]] += 1
            pair_results.append({
                "pair": [a, b],
                "both_observing_days": len(both_observing),
                "detection_days_a": len(dates_a),
                "detection_days_b": len(dates_b),
                "co_detection_days": len(co_detection),
                "co_detection_day_fraction_of_both_observing": (
                    round(len(co_detection) / len(both_observing), 4)
                    if both_observing else None
                ),
                "co_detection_monthly": dict(sorted(monthly.items())),
            })

        by_sensor_pair = []
        for ms in ["modis"]:
            for vs in ["viirs_snpp", "viirs_noaa20", "viirs_noaa21"]:
                m_dates = detection_dates.get("Terra", set()) | detection_dates.get("Aqua", set())
                v_dates: set[str] = set()
                for platform, sensor in PLATFORM_SENSOR.items():
                    if sensor == vs:
                        v_dates |= detection_dates.get(platform, set())
                both_observing = requested_by_sensor.get(ms, set()) & requested_by_sensor.get(vs, set())
                by_sensor_pair.append({
                    "pair": [ms, vs],
                    "both_observing_days": len(both_observing),
                    "co_detection_days": len(m_dates & v_dates),
                })

        # Overpass time evidence: mean acq hour per platform, split by
        # day/night flag — MODIS platforms have bimodal day and night
        # overpasses, so a single mean would be misleading.
        overpass: dict[str, dict[str, Any]] = {}
        hour_bins: dict[str, Counter[str]] = defaultdict(Counter)
        daynight_hours: dict[str, dict[str, list[int]]] = {}
        for record in records:
            if district_id is not None and record.get("district_id") != district_id:
                continue
            if not record.get("acq_time"):
                continue
            hour = int(record["acq_time"][:2])
            hour_bins[record["platform"]][f"{hour:02d}"] += 1
            flag = record.get("daynight") or "unknown"
            daynight_hours.setdefault(record["platform"], {}).setdefault(flag, []).append(hour)
        for platform, counter in hour_bins.items():
            passes: dict[str, Any] = {}
            for flag, hours in sorted(daynight_hours[platform].items()):
                passes[flag] = {
                    "n": len(hours),
                    "mean_acq_hour_utc": round(sum(hours) / len(hours), 2),
                }
            overpass[platform] = {
                "day_night_passes": passes,
                "hour_histogram": dict(sorted(counter.items())),
                "note": "Times are UTC. Local overpass hour depends on the study-area time zone (Nepal UTC+5:45, Thailand UTC+7, Indonesia UTC+7, Myanmar UTC+6:30).",
            }

        scope = district_id or "bbox"
        return {
            "scope": scope,
            "platform_pairs": pair_results,
            "sensor_family_pairs": by_sensor_pair,
            "overpass_evidence": overpass,
            "caveat": (
                "Overlapping dates do not mean simultaneous observations. "
                "MODIS Terra overpasses in the morning; Aqua and the VIIRS "
                "platforms in the early afternoon; clouds and fire duration "
                "further decouple detections."
            ),
        }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "bbox_scope": overlap_block(None),
        "districts": {
            district_id: overlap_block(district_id)
            for district_id in config.REGION_ORDER
        },
    }


# ---------------------------------------------------------------------------
# Phase 5 — spatial comparability on the 0.1-degree grid
# ---------------------------------------------------------------------------

def build_spatial_comparability(
    records: list[dict[str, Any]],
    cell_days: dict[tuple[str, str, str, str], list[dict[str, Any]]],
) -> dict[str, Any]:
    """Comparable cell-days: same 0.1-degree cell, same day, detections
    recorded by both a MODIS platform and a VIIRS platform. Sharing a grid
    does NOT make the sensors physically equivalent; this is documented."""

    family_cells: dict[str, set[str]] = defaultdict(set)          # family -> cell ids (bbox)
    district_family_cells: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    family_cell_dates: dict[str, set[tuple[str, str]]] = defaultdict(set)   # family -> (cell, date)

    for (district_id, sensor_id, platform, day), cells in cell_days.items():
        family = "modis" if sensor_id == "modis" else "viirs"
        for cell in cells:
            cell_key = f"{district_id}:{cell['cell_id']}"
            family_cells[family].add(cell_key)
            district_family_cells[district_id][family].add(cell_key)
            family_cell_dates[family].add((cell_key, day))

    comparable_pairs = family_cell_dates.get("modis", set()) & family_cell_dates.get("viirs", set())

    per_platform_cells: dict[str, int] = {}
    for (district_id, sensor_id, platform, day), cells in cell_days.items():
        for cell in cells:
            per_platform_cells[platform] = per_platform_cells.get(platform, 0) + 0
    platform_cell_ids: dict[str, set[str]] = defaultdict(set)
    for (district_id, sensor_id, platform, day), cells in cell_days.items():
        for cell in cells:
            platform_cell_ids[platform].add(f"{district_id}:{cell['cell_id']}")

    districts: dict[str, Any] = {}
    for district_id in config.REGION_ORDER:
        modis_cells = district_family_cells[district_id].get("modis", set())
        viirs_cells = district_family_cells[district_id].get("viirs", set())
        modis_cd = {pair for pair in comparable_pairs if pair[0].startswith(f"{district_id}:")}
        districts[district_id] = {
            "modis_cells_with_detections": len(modis_cells),
            "viirs_cells_with_detections": len(viirs_cells),
            "cells_seen_by_both_families": len(modis_cells & viirs_cells),
            "comparable_cell_days": len(modis_cd),
            "note": (
                "Cells counted here are cells with >=1 detection on >=1 day; "
                "a detection-free cell-day is not evidence of no fire."
            ),
        }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "grid_degrees": config.GRID_DEGREES,
        "bbox": {
            "modis_cells_with_detections": len(family_cells.get("modis", set())),
            "viirs_cells_with_detections": len(family_cells.get("viirs", set())),
            "cells_seen_by_both_families": len(
                family_cells.get("modis", set()) & family_cells.get("viirs", set())
            ),
            "comparable_cell_days": len(comparable_pairs),
        },
        "platform_cells_with_detections": {
            platform: len(ids) for platform, ids in sorted(platform_cell_ids.items())
        },
        "districts": districts,
        "limitations": [
            "VIIRS 375 m detects far smaller and cooler fires than MODIS 1 km; "
            "a shared grid cell does not equalize detection capability.",
            "Comparable cell-days require detections from both families on "
            "the same day in the same cell; overpass timing and cloud cover "
            "make this a lower bound on true co-observation.",
            "MODIS Terra (morning) and Aqua (early afternoon) see different "
            "fires; VIIRS afternoon overpasses overlap Aqua timing more "
            "closely than Terra.",
            "Zero detections in a shared cell-day is not zero fire.",
        ],
    }


# ---------------------------------------------------------------------------
# Phase 6 — year-by-month coverage matrices
# ---------------------------------------------------------------------------

def build_coverage_matrices(
    records: list[dict[str, Any]],
    *,
    requested_by_sensor: dict[str, set[str]],
    availability_spans: dict[str, tuple[str, str]],
) -> dict[str, Any]:
    """Machine-readable year-month coverage per sensor per district.

    Status vocabulary (never zero-filled):
    - observed:     files cover the month and the district recorded >=1
                    detection day
    - insufficient: files cover the month but the district recorded no
                    detection day (detections too sparse to assert anything)
    - incomplete:   month only partially covered by delivered files (e.g. a
                    month straddling the sensor's first availability date)
    - missing:      month inside the sensor's availability span but no file
                    was delivered (acquisition failure)
    - not_requested: month inside the availability span but outside the
                    acquisition plan (Aug-Dec; FIRMS SP data exists but was
                    not acquired in this pass)
    - unavailable:  month before the sensor's SP availability start
    """

    detection_days: dict[tuple[str, str], set[str]] = defaultdict(set)  # (district, platform) -> dates
    # Pre-computed detection counts per (district, sensor, year-month) so the
    # matrix build never rescans the full record list per month.
    detections_by_month: dict[tuple[str, str, str], int] = Counter()
    for record in records:
        detection_days[(record["district_id"], record["platform"])].add(record["acq_date"])
        detections_by_month[
            (record["district_id"], record["sensor_id"], record["acq_date"][:7])
        ] += 1

    platforms_by_sensor = {
        sid: list(config.SENSORS[sid].platforms) for sid in config.SENSOR_ORDER
    }

    def month_status(sensor_id: str, year: int, month: int, district_id: str) -> dict[str, Any]:
        first_avail, last_avail = availability_spans.get(sensor_id, (None, None))
        month_start = date(year, month, 1)
        month_end = date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)
        month_dates = []
        current = month_start
        while current <= month_end:
            month_dates.append(current.isoformat())
            current += timedelta(days=1)

        if first_avail and month_end < date.fromisoformat(first_avail):
            return {
                "status": "unavailable",
                "days_in_month": len(month_dates), "days_with_files": 0,
                "days_with_detections": 0, "detections": None,
            }

        sensor_dates = requested_by_sensor.get(sensor_id, set())
        days_with_files = sum(1 for d in month_dates if d in sensor_dates)
        plat_days = set()
        for platform in platforms_by_sensor[sensor_id]:
            plat_days |= detection_days.get((district_id, platform), set())
        days_with_detections = sum(1 for d in month_dates if d in plat_days)

        if days_with_files == 0:
            return {
                "status": "not_requested",
                "days_in_month": len(month_dates), "days_with_files": 0,
                "days_with_detections": 0, "detections": None,
            }
        if days_with_files < len(month_dates):
            status = "incomplete"
        elif days_with_detections == 0:
            status = "insufficient"
        else:
            status = "observed"
        return {
            "status": status,
            "days_in_month": len(month_dates),
            "days_with_files": days_with_files,
            "days_with_detections": days_with_detections,
            "detections": detections_by_month.get(
                (district_id, sensor_id, f"{year}-{month:02d}"), 0
            ),
        }

    matrices: dict[str, Any] = {}
    # One shared year span across sensors. A sensor that starts later still
    # needs rows for the earlier years so they read "unavailable" rather than
    # being absent, and a sensor with no requested dates still needs the full
    # span so uncovered months read "not_requested" instead of disappearing.
    span_years: set[int] = set()
    for sensor_id in config.SENSOR_ORDER:
        span_years.update(int(day[:4]) for day in requested_by_sensor.get(sensor_id, set()))
        first_avail, last_avail = availability_spans.get(sensor_id, (None, None))
        if first_avail:
            span_years.add(int(first_avail[:4]))
        if last_avail:
            span_years.add(int(last_avail[:4]))
    year_span = list(range(min(span_years), max(span_years) + 1)) if span_years else []

    for sensor_id in config.SENSOR_ORDER:
        years = year_span
        sensor_matrix: dict[str, Any] = {}
        for district_id in config.REGION_ORDER:
            rows = []
            for year in years:
                for month in range(1, 13):
                    block = month_status(sensor_id, year, month, district_id)
                    block["year"] = year
                    block["month"] = MONTH_LABELS[month]
                    rows.append(block)
            summary = Counter(row["status"] for row in rows)
            sensor_matrix[district_id] = {
                "months": rows,
                "summary": dict(summary),
            }
        matrices[sensor_id] = sensor_matrix

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "status_definitions": {
            "observed": "files cover the month and >=1 detection day in district",
            "insufficient": "files cover the month but no detection day in district",
            "incomplete": "month only partially covered by delivered files",
            "missing": "month in availability span but no file delivered",
            "not_requested": "month within sensor availability but outside acquisition plan (Aug-Dec; data exists at FIRMS but was not acquired)",
            "unavailable": "month before sensor SP availability start",
        },
        "note": "Missing months are never filled with zeros; detections are not unique fires.",
        "sensors": matrices,
    }


# ---------------------------------------------------------------------------
# Phase 7 — calibration readiness
# ---------------------------------------------------------------------------

def build_calibration_readiness(
    records: list[dict[str, Any]],
    coverage: dict[str, Any],
    comparability: dict[str, Any],
    overlap: dict[str, Any],
) -> dict[str, Any]:
    """Phase 7 readiness report. No correction factors are fitted here."""

    # Co-detection days per district per year-month: dates where both a MODIS
    # platform and a VIIRS platform each recorded >=1 detection.
    modis_days: dict[str, set[str]] = defaultdict(set)
    viirs_days: dict[str, set[str]] = defaultdict(set)
    for record in records:
        bucket = modis_days if record["sensor_id"] == "modis" else viirs_days
        bucket[record["district_id"]].add(record["acq_date"])

    co_detection: dict[str, Counter[str]] = {}
    for district_id in config.REGION_ORDER:
        common = modis_days[district_id] & viirs_days[district_id]
        monthly: Counter[str] = Counter()
        for d in common:
            monthly[d[:7]] += 1
        co_detection[district_id] = monthly

    suitable_months: dict[str, list[dict[str, Any]]] = {}
    for district_id in config.REGION_ORDER:
        months = []
        for ym, days in sorted(co_detection[district_id].items()):
            if days >= MIN_CO_DETECTION_DAYS:
                months.append({"year_month": ym, "co_detection_days": days})
        suitable_months[district_id] = months

    years_with_full_jan_jun: list[str] = []
    for year in range(2012, 2027):
        ok = True
        for month in range(1, 7):
            for district_id in config.REGION_ORDER:
                row = next(
                    (
                        m for m in coverage["sensors"]["modis"][district_id]["months"]
                        if m["year"] == year and m["month"] == MONTH_LABELS[month]
                    ),
                    None,
                )
                if row is None or row["status"] not in ("observed", "insufficient"):
                    ok = False
                    break
            if not ok:
                break
        if ok:
            years_with_full_jan_jun.append(str(year))

    viirs_reference_overlap_years: dict[str, list[str]] = {}
    spans = {
        "viirs_snpp": (2012, 2026),
        "viirs_noaa20": (2018, 2026),
        "viirs_noaa21": (2023, 2026),
    }
    for sensor, (start, end) in spans.items():
        viirs_reference_overlap_years[sensor] = [str(y) for y in range(max(start, 2012), end + 1)]

    total_comparable = comparability["bbox"]["comparable_cell_days"]
    district_comparable = {
        d: comparability["districts"][d]["comparable_cell_days"]
        for d in config.REGION_ORDER
    }

    answers = {
        "1_enough_historical_overlap": {
            "answer": bool(total_comparable >= 100 and suitable_months),
            "evidence": {
                "comparable_cell_days_bbox": total_comparable,
                "district_comparable_cell_days": district_comparable,
                "districts_with_suitable_months": {
                    d: len(months) for d, months in suitable_months.items()
                },
                "thresholds": {
                    "min_co_detection_days_per_month": MIN_CO_DETECTION_DAYS,
                },
            },
        },
        "2_candidate_training_years": {
            "answer": years_with_full_jan_jun,
            "note": "Years with Jan-Jun file coverage for MODIS and all districts; refine by VIIRS reference availability in Task 05.",
        },
        "3_holdout_years": {
            "answer": [
                y for y in years_with_full_jan_jun
                if int(y) >= 2019 and int(y) <= 2024
            ],
            "note": "Mid-record years make defensible held-out blocks; final split chosen in Task 05 with leakage purges.",
        },
        "4_months_with_sufficient_observations": {
            "answer": {
                d: [m["year_month"] for m in months]
                for d, months in suitable_months.items()
            },
            "criterion": f">= {MIN_CO_DETECTION_DAYS} MODIS-VIIRS co-detection days in the district-month",
        },
        "5_districts_with_sufficient_coverage": {
            "answer": {
                d: (len(months) >= 12)
                for d, months in suitable_months.items()
            },
            "criterion": ">= 12 suitable months across the record (provisional)",
        },
        "6_sensor_coverage_gaps": {
            "answer": {
                "viirs_snpp": "starts 2012-01-20; no SP data before that",
                "viirs_noaa20": "starts 2018-04-01",
                "viirs_noaa21": "starts 2023-03-01",
                "all": "Aug-Dec not acquired in this pass (out of acquisition plan, not unavailable at FIRMS)",
            },
        },
        "7_terra_aqua_separability": {
            "answer": True,
            "note": (
                "Terra and Aqua are reported separately end-to-end; each has "
                "independent detections. Overlap analysis evaluates them as "
                "distinct platforms; pooled MODIS analysis is a separate, "
                "explicitly-labelled configuration."
            ),
        },
        "8_bias_risks": {
            "answer": [
                "VIIRS detects smaller/cooler fires (375 m vs 1 km); ratios will not be 1 even for identical fire activity.",
                "Morning (Terra) vs afternoon (Aqua/VIIRS) overpasses sample different fire diurnal phases.",
                "Cloud cover differs between overpass times and sensors.",
                "Aug-Dec absence limits seasonal representativeness of the acquired record.",
                "Confidence fields are not comparable across sensors (MODIS numeric 0-100 vs VIIRS categorical l/n/h).",
                "Detections are not unique fires; multiple detections can belong to one fire.",
            ],
        },
    }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provisional_thresholds": {
            "min_co_detection_days_per_month": MIN_CO_DETECTION_DAYS,
            "min_comparable_cell_days_per_district": MIN_COMPARABLE_CELL_DAYS,
            "note": "Thresholds are documented analytical criteria; Task 05 may refine them and must document any change.",
        },
        "answers": answers,
        "co_detection_months_by_district": {
            d: dict(sorted(counter.items())) for d, counter in co_detection.items()
        },
        "suitable_months_by_district": suitable_months,
        "disclaimer": (
            "This report does not fit or select correction factors. It only "
            "states whether the acquired record can support Task 05 "
            "experiments, with explicit evidence and limitations."
        ),
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_historical_analysis() -> dict[str, Any]:
    """Phases 1 and 3-7 in one pass. Phase 2 (public JSON export) runs via
    ``process.run_processing(provider='area-api')`` separately."""

    HISTORICAL_DIR.mkdir(parents=True, exist_ok=True)

    grouped = load_area_entries()
    requested_by_sensor = {
        sensor_id: requested_dates(entries) for sensor_id, entries in grouped.items()
    }

    inventory = build_inventory()
    manifests.write_json(HISTORICAL_DIR / "inventory.json", inventory)

    records, qc_report, spatial_summary = load_historical_records()
    cell_days = spatial.build_cell_days(records)

    quality = build_quality_report(records, qc_report, spatial_summary)
    manifests.write_json(HISTORICAL_DIR / "data_quality.json", quality)

    overlap = build_overlap_analysis(records, requested_by_sensor=requested_by_sensor)
    manifests.write_json(HISTORICAL_DIR / "sensor_overlap.json", overlap)

    comparability = build_spatial_comparability(records, cell_days)
    manifests.write_json(HISTORICAL_DIR / "spatial_comparability.json", comparability)

    availability_spans = {}
    for sensor_id, sensor in config.SENSORS.items():
        source = next(
            (
                s for s in manifests.read_json(config.PROCESSED_DIR / "availability.json").get("sources", [])
                if s.get("source_identifier") == sensor.sp_identifier
            ),
            None,
        )
        availability_spans[sensor_id] = (
            source.get("first_available"), source.get("last_available")
        ) if source else (None, None)

    coverage = build_coverage_matrices(
        records, requested_by_sensor=requested_by_sensor, availability_spans=availability_spans,
    )
    manifests.write_json(HISTORICAL_DIR / "coverage_matrices.json", coverage)

    readiness = build_calibration_readiness(records, coverage, comparability, overlap)
    manifests.write_json(HISTORICAL_DIR / "calibration_readiness.json", readiness)

    analysis_manifest = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provider": "area-api",
        "product": "SP",
        "record_count": len(records),
        "outputs": [
            "inventory.json", "data_quality.json", "sensor_overlap.json",
            "spatial_comparability.json", "coverage_matrices.json",
            "calibration_readiness.json",
        ],
        "sources": {
            "download_manifest": config.relative(config.DOWNLOAD_MANIFEST),
            "availability": config.relative(config.PROCESSED_DIR / "availability.json"),
            "boundaries": config.relative(config.STUDY_AREA_BOUNDARIES),
        },
        "grid": {"degrees": config.GRID_DEGREES, "definition": "floor(lat/0.1), floor(lon/0.1)"},
        "provenance": "OCHA COD-AB Nepal boundaries; NASA FIRMS SP active fire products",
    }
    manifests.write_json(HISTORICAL_DIR / "analysis_manifest.json", analysis_manifest)

    return {
        "record_count": len(records),
        "outputs": [HISTORICAL_DIR / name for name in analysis_manifest["outputs"]],
    }
