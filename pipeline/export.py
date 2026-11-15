"""Export processed observations to the published JSON contract."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, manifests


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _boundary_summary(boundaries: list[Any]) -> dict[str, Any]:
    by_id = {b.district_id: b for b in boundaries}
    result: dict[str, Any] = {}
    for district_id, boundary in by_id.items():
        result[district_id] = {
            "source": boundary.provenance.get("source"),
            "dataset_url": boundary.provenance.get("dataset_url"),
            "license": boundary.provenance.get("license"),
            "boundary_year": boundary.provenance.get("boundary_year"),
            "publisher": boundary.provenance.get("publisher"),
            "pcode": boundary.pcode,
            "admin_level": boundary.provenance.get("admin_level"),
            "area_km2": config.REGIONS[district_id].area_km2,
            "crs": boundary.provenance.get("crs", config.PROJECT_CRS),
            "simplified": boundary.simplified,
            "bbox": [round(v, 6) for v in boundary.bounds],
            "archive_sha256": boundary.provenance.get("archive_sha256"),
            "member_sha256": boundary.provenance.get("member_sha256"),
            "retrieved_at": boundary.provenance.get("retrieved_at"),
        }
    return result


def export(
    *,
    district_days: dict[str, list[dict[str, Any]]],
    district_weeks: dict[str, list[dict[str, Any]]],
    sensor_coverage: dict[str, dict[str, Any]],
    qc_report: dict[str, Any],
    boundaries: list[Any],
    provider: str,
    product: str,
    generated_at: str | None = None,
    processed_root: Path | None = None,
    public_root: Path | None = None,
    region_status: dict[str, dict[str, Any]] | None = None,
    years: list[str] | None = None,
) -> dict[str, Any]:
    config.ensure_directories()
    generated_at = generated_at or _utc_now()
    boundary_summary = _boundary_summary(boundaries)
    region_status = region_status or {}
    years = years or sorted(
        {day["date"][:4] for days in district_days.values() for day in days}
    )

    processed_root = processed_root or config.PROCESSED_DIR
    public_root = public_root or config.PUBLIC_DATA_DIR
    public_root.mkdir(parents=True, exist_ok=True)
    processed_root.mkdir(parents=True, exist_ok=True)
    public_root.mkdir(parents=True, exist_ok=True)

    # Processed (full) outputs.
    for district_id, days in district_days.items():
        district_dir = processed_root / "districts" / district_id
        district_dir.mkdir(parents=True, exist_ok=True)
        manifests.write_json(
            district_dir / "daily.json",
            {
                "contract_version": config.CONTRACT_VERSION,
                "district_id": district_id,
                "generated_at": generated_at,
                "provider": provider,
                "product": product,
                "days": days,
            },
        )
        manifests.write_json(
            district_dir / "weekly.json",
            {
                "contract_version": config.CONTRACT_VERSION,
                "district_id": district_id,
                "generated_at": generated_at,
                "provider": provider,
                "product": product,
                "weeks": district_weeks[district_id],
            },
        )

    manifests.write_json(processed_root / "quality_report.json", qc_report)
    manifests.write_json(processed_root / "sensor_coverage.json", {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": generated_at,
        "provider": provider,
        "product": product,
        "sensors": sensor_coverage,
    })

    # Public (frontend) slices.
    sensors_public = [
        {
            "sensor_id": sid,
            "label": config.SENSORS[sid].label,
            "instrument": config.SENSORS[sid].instrument,
            "platforms": list(config.SENSORS[sid].platforms),
            "confidence_kind": config.SENSORS[sid].confidence_kind,
            "confidence_scale": config.SENSORS[sid].confidence_scale,
            "brightness_fields": list(config.SENSORS[sid].brightness_fields),
        }
        for sid in config.SENSOR_ORDER
    ]

    study_areas_public = []
    for district_id in config.REGION_ORDER:
        definition = config.REGIONS[district_id]
        boundary = boundary_summary.get(district_id, {})
        region_years = sorted(
            {day["date"][:4] for day in district_days.get(district_id, [])}
        )
        study_areas_public.append(
            {
                "district_id": district_id,
                "region_id": district_id,
                "name": definition.name,
                "full_name": definition.full_name,
                "country": definition.country,
                "country_code": definition.country_code,
                "admin_level": definition.admin_level,
                "admin_level_label": definition.admin_level_label,
                "province": definition.province,
                "pcode": definition.pcode,
                "scale_class": definition.scale_class,
                "area_km2": (
                    round(boundary["area_km2"], 1)
                    if boundary.get("area_km2")
                    else definition.area_km2
                ),
                "years": region_years,
                "bbox": boundary.get("bbox"),
                "status": region_status.get(district_id, {}).get("status", "unknown"),
                "status_reason": region_status.get(district_id, {}).get("reason"),
            }
        )

    # Per-region metadata + year files. Regions with no acquired files get an
    # index entry but no fabricated year files.
    for district_id in district_days:
        district_dir = public_root / district_id
        district_dir.mkdir(parents=True, exist_ok=True)
        boundary = boundary_summary.get(district_id, {})
        counts = qc_report.get("assigned_by_district", {}).get(district_id, 0)
        definition = config.REGIONS[district_id]
        metadata = {
            "contract_version": config.CONTRACT_VERSION,
            "district_id": district_id,
            "region_id": district_id,
            "name": definition.name,
            "full_name": definition.full_name,
            "country": definition.country,
            "country_code": definition.country_code,
            "admin_level": definition.admin_level,
            "admin_level_label": definition.admin_level_label,
            "province": definition.province,
            "pcode": definition.pcode,
            "scale_class": definition.scale_class,
            "area_km2": definition.area_km2,
            "description": definition.description,
            "processing_status": region_status.get(district_id, {"status": "available"}),
            "generated_at": generated_at,
            "provider": provider,
            "product": product,
            "boundary": boundary,
            "record_counts": {
                "assigned_records": counts,
            },
            "sensor_coverage": sensor_coverage,
            "quality_summary": {
                "raw_record_count": qc_report.get("raw_record_count"),
                "valid_record_count": qc_report.get("valid_record_count"),
                "final_retained_record_count": qc_report.get("final_retained_record_count"),
                "outside_study_area_count": qc_report.get("outside_study_area_count"),
                "duplicate_count": qc_report.get("duplicate_count"),
                "invalid_coordinate_count": qc_report.get("invalid_coordinate_count"),
                "invalid_timestamp_count": qc_report.get("invalid_timestamp_count"),
            },
            "limitations": [
                "Near real-time (NRT) 7-day global snapshot; not standard processing (SP).",
                "No ground truth; counts are satellite detections, not burned area.",
                "Missing observations are marked unavailable/missing, never zero-filled.",
                "Sensors are reported separately; MODIS and VIIRS are never combined.",
            ],
            "citations": config.CITATIONS,
        }
        manifests.write_json(district_dir / "metadata.json", metadata)

        days = district_days[district_id]
        weeks = district_weeks[district_id]
        region_years = sorted({day["date"][:4] for day in days})
        for year in region_years:
            year_days = [day for day in days if day["date"].startswith(year)]
            year_weeks = [week for week in weeks if str(week["iso_year"]) == year]
            manifests.write_json(
                district_dir / f"{year}.json",
                {
                    "contract_version": config.CONTRACT_VERSION,
                    "district_id": district_id,
                    "region_id": district_id,
                    "district": {
                        "name": definition.name,
                        "full_name": definition.full_name,
                        "country": definition.country,
                        "admin_level_label": definition.admin_level_label,
                        "province": definition.province,
                        "pcode": definition.pcode,
                    },
                    "year": year,
                    "generated_at": generated_at,
                    "provider": provider,
                    "product": product,
                    "sensors": [s["sensor_id"] for s in sensors_public],
                    "days": year_days,
                    "weeks": year_weeks,
                },
            )

    index = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": generated_at,
        "provider": {"id": provider, "product": product},
        "study_areas": study_areas_public,
        "regions": list(config.REGION_ORDER),
        "region_status": region_status,
        "sensors": sensors_public,
        "years": years,
        "paths": {
            "district_year": "data/{district_id}/{year}.json",
            "metadata": "data/{district_id}/metadata.json",
        },
        "quality_summary": {
            "raw_record_count": qc_report.get("raw_record_count"),
            "valid_record_count": qc_report.get("valid_record_count"),
            "final_retained_record_count": qc_report.get("final_retained_record_count"),
            "outside_study_area_count": qc_report.get("outside_study_area_count"),
            "duplicate_count": qc_report.get("duplicate_count"),
        },
        "limitations": [
            "Near real-time (NRT) 7-day global snapshot; not standard processing (SP).",
            "No ground truth; detections are not burned area.",
            "Missing observations are marked unavailable/missing, never zero-filled.",
        ],
        "citations": config.CITATIONS,
    }
    manifests.write_json(public_root / "index.json", index)

    # Processing manifest summary.
    processing_manifest = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": generated_at,
        "provider": provider,
        "product": product,
        "years": years,
        "regions": list(config.REGION_ORDER),
        "regions_with_observations": sorted(district_days),
        "region_status": region_status,
        "sensors": list(config.SENSOR_ORDER),
        "quality_report": config.relative(processed_root / "quality_report.json"),
        "sensor_coverage": config.relative(processed_root / "sensor_coverage.json"),
        "public_index": config.relative(public_root / "index.json"),
    }
    manifests.save_manifest(config.PROCESSING_MANIFEST, processing_manifest)
    return index
