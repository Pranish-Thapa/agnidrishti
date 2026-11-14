"""End-to-end processing: raw FIRMS files -> processed JSON + public slices."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import config, geometry, manifests, normalize, qc, spatial, temporal, export


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

    # Normalize all entries.
    all_records: list[dict[str, Any]] = []
    for entry, path in entries_with_paths:
        sensor_id = entry["sensor_id"]
        records = normalize.normalize_file(path, sensor_id)
        for record in records:
            record["_source_entry"] = entry.get("entry_id")
        all_records.extend(records)

    # QC.
    clean_records, qc_report = qc.run_qc(all_records)

    # Spatial assignment.
    assigned_records, spatial_summary = spatial.assign_study_areas(clean_records, index)
    qc_report["outside_study_area_count"] = spatial_summary["outside_study_area_count"]
    qc_report["boundary_touch_count"] = spatial_summary["boundary_touch_count"]
    qc_report["assigned_by_district"] = spatial_summary["assigned_by_district"]
    qc_report["final_retained_record_count"] = len(assigned_records)

    # Cell-days.
    cell_days = spatial.build_cell_days(assigned_records)

    # Sensor coverage.
    global_counts, global_platforms = _global_reporting(entries_with_paths)
    # Determine requested date window per sensor from manifest entries.
    sensor_entries: dict[str, list[dict[str, Any]]] = {sid: [] for sid in config.SENSOR_ORDER}
    for entry, _ in entries_with_paths:
        sensor_entries[entry["sensor_id"]].append(entry)

    sensor_coverage: dict[str, dict[str, Any]] = {}
    all_dates_set: set[str] = set()
    for sensor_id in config.SENSOR_ORDER:
        entries = sensor_entries[sensor_id]
        if not entries:
            continue
        # union of date windows
        date_set: set[str] = set()
        for entry in entries:
            dw = entry.get("date_window") or {}
            start = dw.get("start")
            end = dw.get("end")
            if start and end:
                # generate dates
                from datetime import date as _date, timedelta as _td

                current = _date.fromisoformat(start)
                last = _date.fromisoformat(end)
                while current <= last:
                    date_set.add(current.isoformat())
                    current += _td(days=1)
        # reporting status: area-api always reporting if entries exist; nrt reporting if global records > 0
        if provider == "nrt":
            reporting = global_counts.get(sensor_id, 0) > 0
        else:
            reporting = True

        platforms_info: dict[str, Any] = {}
        for platform in config.SENSORS[sensor_id].platforms:
            # platform reporting: present in global platforms (nrt) or assumed reporting (area-api)
            if provider == "nrt":
                platform_reporting = global_platforms.get(sensor_id, {}).get(platform, 0) > 0
            else:
                platform_reporting = True
            platforms_info[platform] = {
                "reporting": platform_reporting,
                "global_records": global_platforms.get(sensor_id, {}).get(platform, 0) if platform_reporting else 0,
            }

        # For nrt, derive actual observed date range from global records? Use manifest window.
        # If reporting False, mark all dates unavailable and do not add to all_dates.
        if reporting:
            sensor_dates = sorted(date_set)
            all_dates_set.update(sensor_dates)
        else:
            sensor_dates = sorted(date_set)

        # first/last observation from assigned records (district-level) for this sensor
        sensor_assigned = [r for r in assigned_records if r["sensor_id"] == sensor_id]
        first_obs = min((r["acq_date"] for r in sensor_assigned), default=None)
        last_obs = max((r["acq_date"] for r in sensor_assigned), default=None)

        sensor_coverage[sensor_id] = {
            "sensor_id": sensor_id,
            "label": config.SENSORS[sensor_id].label,
            "instrument": config.SENSORS[sensor_id].instrument,
            "platforms": platforms_info,
            "product": "NRT" if provider == "nrt" else "SP",
            "source_identifier": (entries[0].get("source_identifier") if entries else None),
            "reporting": reporting,
            "unavailable_reason": None if reporting else "no records returned by the global snapshot; treated as unavailable, not zero",
            "dates": sensor_dates if reporting else [],
            "first_observation": first_obs,
            "last_observation": last_obs,
            "global_records": global_counts.get(sensor_id, 0),
            "district_records": len(sensor_assigned),
            "windows": [{"start": e.get("date_window", {}).get("start"), "end": e.get("date_window", {}).get("end")} for e in entries],
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
        "basis": "public NRT 7-day snapshot windows",
        "overlap": overlap,
        "note": "Provisional overlap of NRT snapshot windows; final harmonization period requires standard-processing availability.",
    }

    # Daily/weekly per district.
    district_days: dict[str, list[dict[str, Any]]] = {}
    district_weeks: dict[str, list[dict[str, Any]]] = {}
    all_dates_sorted = sorted(all_dates_set)
    for district_id in config.DISTRICT_ORDER:
        days = temporal.build_daily(district_id, all_dates_sorted, sensor_coverage, cell_days)
        weeks = temporal.build_weekly(days, cell_days=cell_days, district_id=district_id)
        district_days[district_id] = days
        district_weeks[district_id] = weeks

    # QC report additions.
    qc_report["provider"] = provider
    qc_report["generated_at"] = _utc_now()

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
        )

    # Save sensor_coverage without the private comparable key? Keep it; it's useful.
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
        "years": sorted({day["date"][:4] for days in district_days.values() for day in days}),
        "districts": list(config.DISTRICT_ORDER),
        "sensors": list(config.SENSOR_ORDER),
        "quality_report": config.relative(processed_root / "quality_report.json"),
        "sensor_coverage": config.relative(processed_root / "sensor_coverage.json"),
        "public_index": config.relative(config.PUBLIC_DATA_DIR / slug / "index.json"),
    })
    return {
        "provider": provider,
        "districts": list(config.DISTRICT_ORDER),
        "dates": all_dates_sorted,
        "record_count": len(assigned_records),
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
