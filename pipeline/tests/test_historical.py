"""Task 04B tests — inventory, coverage, overlap, comparability, readiness.

Tests use synthetic records and temporary manifests; they never touch the
real downloaded dataset and never fabricate observations as scientific
results.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline import config, historical


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_record(
    sensor_id: str,
    platform: str,
    day: str,
    district_id: str = "NP-BANKE",
    lat: float = 27.95,
    lon: float = 81.7,
) -> dict:
    return {
        "sensor_id": sensor_id,
        "instrument": config.SENSORS[sensor_id].instrument,
        "platform": platform,
        "satellite_code": platform,
        "latitude": lat,
        "longitude": lon,
        "acq_date": day,
        "acq_time": "07:00",
        "acq_datetime": f"{day}T07:00:00Z",
        "confidence_kind": config.SENSORS[sensor_id].confidence_kind,
        "confidence": None,
        "brightness": {},
        "frp": 5.0,
        "daynight": "D",
        "source": None,
        "version": None,
        "scan": None,
        "track": None,
        "source_file": "synthetic",
        "raw_row_number": 2,
        "issues": [],
        "valid": True,
        "district_id": district_id,
        "boundary_touch": False,
        "candidate_districts": (district_id,),
    }


def chunk_entry(sensor_id: str, start: str, end: str, status: str = "downloaded") -> dict:
    return {
        "entry_id": f"area:{sensor_id}:{start}:{end}",
        "provider": "area-api",
        "product": "SP",
        "sensor_id": sensor_id,
        "date_window": {"start": start, "end": end},
        "storage_path": f"data/raw/{sensor_id}/{start}_{end}.csv",
        "status": status,
        "sha256": "a" * 64,
    }


def dates_from_windows(windows: list[tuple[str, str]]) -> set[str]:
    return historical.requested_dates(
        [
            {"date_window": {"start": start, "end": end}}
            for start, end in windows
        ]
    )


# ---------------------------------------------------------------------------
# Chunk discovery and partial-download detection
# ---------------------------------------------------------------------------


def test_requested_dates_expands_windows_inclusively():
    dates = dates_from_windows([("2024-03-01", "2024-03-05")])
    assert len(dates) == 5
    assert "2024-03-01" in dates and "2024-03-05" in dates


def test_requested_dates_merges_overlapping_windows():
    dates = dates_from_windows([("2024-03-01", "2024-03-10"), ("2024-03-06", "2024-03-14")])
    assert len(dates) == 14


def test_dedupe_area_entries_keeps_latest_status(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config, "REPO_ROOT", tmp_path)

    first = chunk_entry("modis", "2024-03-01", "2024-03-05", status="error")
    second = {**chunk_entry("modis", "2024-03-01", "2024-03-05"), "status": "downloaded"}
    third = chunk_entry("viirs_snpp", "2024-03-01", "2024-03-05")
    nrt = {"entry_id": "nrt:modis:x", "provider": "nrt", "sensor_id": "modis"}

    # Create only the file referenced by the second and third entries.
    (tmp_path / "data" / "raw" / "modis").mkdir(parents=True)
    (tmp_path / "data" / "raw" / "modis" / "2024-03-01_2024-03-05.csv").write_text("x")
    (tmp_path / "data" / "raw" / "viirs_snpp").mkdir(parents=True)
    (tmp_path / "data" / "raw" / "viirs_snpp" / "2024-03-01_2024-03-05.csv").write_text("x")

    grouped = historical.dedupe_area_entries([first, second, third, nrt])
    modis = grouped["modis"]
    assert len(modis) == 1
    assert modis[0]["status"] == "downloaded"  # latest entry wins
    assert len(grouped["viirs_snpp"]) == 1
    assert grouped["viirs_noaa20"] == []  # file missing -> dropped


def test_dedupe_keeps_same_window_for_different_regions(tmp_path: Path, monkeypatch):
    """One Area API window requested for two regions is two acquired files.

    Regression: entry_id encodes sensor and window only, so keying the
    dedupe on it alone silently dropped every region but one.
    """

    monkeypatch.setattr(config, "REPO_ROOT", tmp_path)

    def regional(region_id: str) -> dict:
        entry = chunk_entry("modis", "2024-03-01", "2024-03-05")
        return {
            **entry,
            "region_id": region_id,
            "storage_path": f"data/raw/regions/{region_id}/modis/{region_id}_2024-03-01.csv",
        }

    nepal = regional("NP-BANKE")
    thailand = regional("TH-CHIANG-MAI")
    for entry in (nepal, thailand):
        path = tmp_path / entry["storage_path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x")

    grouped = historical.dedupe_area_entries([nepal, thailand])
    assert [entry["region_id"] for entry in grouped["modis"]] == ["NP-BANKE", "TH-CHIANG-MAI"]


def test_missing_window_is_detectable():
    requested = dates_from_windows([("2024-03-01", "2024-03-31")])
    delivered = dates_from_windows([("2024-03-01", "2024-03-20")])
    missing = requested - delivered
    assert len(missing) == 11
    assert all(d > "2024-03-20" for d in missing)


# ---------------------------------------------------------------------------
# Coverage matrices
# ---------------------------------------------------------------------------


def _month_row(coverage, sensor, district, year, month):
    return next(
        m
        for m in coverage["sensors"][sensor][district]["months"]
        if m["year"] == year and m["month"] == month
    )


def test_coverage_matrix_status_vocabulary():
    records = [
        make_record("modis", "Terra", "2024-03-05"),
        make_record("modis", "Aqua", "2024-03-05"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-03-05"),
    ]
    requested = {
        "modis": dates_from_windows([("2024-03-01", "2024-03-31")]),
        "viirs_snpp": dates_from_windows([
            ("2024-03-01", "2024-03-31"),
            ("2012-01-20", "2012-01-31"),  # sensor SP availability starts mid-month
        ]),
        "viirs_noaa20": dates_from_windows([("2024-03-01", "2024-03-31")]),
        "viirs_noaa21": set(),
    }
    availability = {
        "modis": ("2000-11-01", "2026-08-31"),
        "viirs_snpp": ("2012-01-20", "2026-07-31"),
        "viirs_noaa20": ("2018-04-01", "2026-07-31"),
        "viirs_noaa21": ("2023-03-01", "2026-07-31"),
    }
    coverage = historical.build_coverage_matrices(
        records, requested_by_sensor=requested, availability_spans=availability
    )

    # observed: files cover the month and detections exist
    row = _month_row(coverage, "modis", "NP-BANKE", 2024, "Mar")
    assert row["status"] == "observed"
    assert row["detections"] == 2

    # insufficient: files cover the month but no district detections
    row = _month_row(coverage, "viirs_snpp", "NP-BARDIYA", 2024, "Mar")
    assert row["status"] == "insufficient"
    assert row["detections"] is None or row["detections"] == 0

    # not_requested: month with no delivered files inside availability span
    row = _month_row(coverage, "modis", "NP-BANKE", 2024, "Dec")
    assert row["status"] == "not_requested"

    # unavailable: month before sensor availability start
    row = _month_row(coverage, "viirs_noaa21", "NP-BANKE", 2020, "Mar")
    assert row["status"] == "unavailable"

    # incomplete: partial file coverage (sensor starts mid-month)
    row = _month_row(coverage, "viirs_snpp", "NP-BANKE", 2012, "Jan")
    assert row["status"] == "incomplete"
    assert 0 < row["days_with_files"] < row["days_in_month"]


def test_coverage_matrix_never_fills_missing_with_zero():
    records = [make_record("modis", "Terra", "2024-04-10")]
    requested = {"modis": dates_from_windows([("2024-04-01", "2024-04-30")])}
    availability = {"modis": ("2000-11-01", "2026-08-31")}
    # Only modis entries provided: viirs sensors have no requested dates at all.
    requested.setdefault("viirs_snpp", set())
    requested.setdefault("viirs_noaa20", set())
    requested.setdefault("viirs_noaa21", set())
    availability.setdefault("viirs_snpp", ("2012-01-20", "2026-07-31"))
    availability.setdefault("viirs_noaa20", ("2018-04-01", "2026-07-31"))
    availability.setdefault("viirs_noaa21", ("2023-03-01", "2026-07-31"))
    coverage = historical.build_coverage_matrices(
        records, requested_by_sensor=requested, availability_spans=availability
    )
    for sensor in ("viirs_snpp", "viirs_noaa20", "viirs_noaa21"):
        row = _month_row(coverage, sensor, "NP-BANKE", 2024, "Apr")
        assert row["detections"] is None  # never a fabricated zero


def test_coverage_matrix_reports_all_six_study_regions():
    records = [make_record("modis", "Terra", "2024-04-10", district_id=d)
               for d in config.REGION_ORDER]
    requested = {sid: set() for sid in config.SENSOR_ORDER}
    requested["modis"] = dates_from_windows([("2024-04-01", "2024-04-30")])
    availability = {sid: ("2000-11-01", "2026-08-31") for sid in config.SENSOR_ORDER}
    coverage = historical.build_coverage_matrices(
        records, requested_by_sensor=requested, availability_spans=availability
    )
    for district in config.REGION_ORDER:
        row = _month_row(coverage, "modis", district, 2024, "Apr")
        assert row["status"] == "observed"


# ---------------------------------------------------------------------------
# Overlap analysis
# ---------------------------------------------------------------------------


def test_overlap_counts_co_detection_not_mere_calendar_overlap():
    records = [
        # Both sensors detect on the 4th; only VIIRS on the 5th.
        make_record("modis", "Terra", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-05"),
    ]
    requested = {
        "modis": dates_from_windows([("2024-04-01", "2024-04-10")]),
        "viirs_snpp": dates_from_windows([("2024-04-01", "2024-04-10")]),
    }
    overlap = historical.build_overlap_analysis(records, requested_by_sensor=requested)
    pair = next(p for p in overlap["bbox_scope"]["platform_pairs"] if p["pair"] == ["Terra", "Suomi-NPP"])
    assert pair["both_observing_days"] == 10
    assert pair["co_detection_days"] == 1
    assert pair["co_detection_monthly"] == {"2024-04": 1}
    assert pair["detection_days_a"] == 1
    assert pair["detection_days_b"] == 2


def test_overlap_is_per_district():
    records = [
        make_record("modis", "Terra", "2024-04-04", district_id="NP-BANKE"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04", district_id="NP-BANKE"),
        make_record("modis", "Terra", "2024-04-06", district_id="NP-CHITWAN"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-06", district_id="NP-CHITWAN"),
    ]
    requested = {
        "modis": dates_from_windows([("2024-04-01", "2024-04-10")]),
        "viirs_snpp": dates_from_windows([("2024-04-01", "2024-04-10")]),
    }
    overlap = historical.build_overlap_analysis(records, requested_by_sensor=requested)
    assert overlap["districts"]["NP-BANKE"]["platform_pairs"][0]["co_detection_days"] == 1
    chitwan = next(
        p for p in overlap["districts"]["NP-CHITWAN"]["platform_pairs"]
        if p["pair"] == ["Terra", "Suomi-NPP"]
    )
    assert chitwan["co_detection_days"] == 1


def test_overlap_reports_overpass_evidence_with_day_night_split():
    records = [
        make_record("modis", "Terra", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04"),
    ]
    requested = {"modis": set(), "viirs_snpp": set()}
    overlap = historical.build_overlap_analysis(records, requested_by_sensor=requested)
    overpass = overlap["bbox_scope"]["overpass_evidence"]["Terra"]
    assert "D" in overpass["day_night_passes"]
    assert overpass["day_night_passes"]["D"]["mean_acq_hour_utc"] == 7.0


# ---------------------------------------------------------------------------
# Spatial comparability
# ---------------------------------------------------------------------------


def test_comparable_cell_days_require_both_families_same_cell_and_day():
    records = [
        # Same cell, same day, both families -> comparable.
        make_record("modis", "Terra", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04"),
        # VIIRS-only cell-day: must not count as comparable.
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-05"),
        # MODIS in another district only: not comparable.
        make_record("modis", "Aqua", "2024-04-04", district_id="NP-BARDIYA"),
    ]
    cell_days = {
        ("NP-BANKE", "modis", "Terra", "2024-04-04"): [{
            "cell_id": "lat279_lon817", "lat_index": 279, "lon_index": 817,
            "center_latitude": 27.95, "center_longitude": 81.75,
            "detections": 1, "frp": None, "cell_days": 1, "daynight": {"D": 1},
        }],
        ("NP-BANKE", "viirs_snpp", "Suomi-NPP", "2024-04-04"): [{
            "cell_id": "lat279_lon817", "lat_index": 279, "lon_index": 817,
            "center_latitude": 27.95, "center_longitude": 81.75,
            "detections": 1, "frp": None, "cell_days": 1, "daynight": {"D": 1},
        }],
        ("NP-BANKE", "viirs_snpp", "Suomi-NPP", "2024-04-05"): [{
            "cell_id": "lat279_lon817", "lat_index": 279, "lon_index": 817,
            "center_latitude": 27.95, "center_longitude": 81.75,
            "detections": 1, "frp": None, "cell_days": 1, "daynight": {"D": 1},
        }],
        ("NP-BARDIYA", "modis", "Aqua", "2024-04-04"): [{
            "cell_id": "lat280_lon817", "lat_index": 280, "lon_index": 817,
            "center_latitude": 28.05, "center_longitude": 81.75,
            "detections": 1, "frp": None, "cell_days": 1, "daynight": {"D": 1},
        }],
    }
    result = historical.build_spatial_comparability(records, cell_days)
    assert result["bbox"]["comparable_cell_days"] == 1
    assert result["districts"]["NP-BANKE"]["comparable_cell_days"] == 1
    assert result["districts"]["NP-BARDIYA"]["comparable_cell_days"] == 0


def test_comparability_documents_grid_limitations():
    records: list[dict] = []
    cell_days: dict = {}
    result = historical.build_spatial_comparability(records, cell_days)
    assert any("does not equalize" in item for item in result["limitations"])
    assert result["bbox"]["comparable_cell_days"] == 0


# ---------------------------------------------------------------------------
# District statistics
# ---------------------------------------------------------------------------


def test_quality_report_preserves_platform_identity():
    records = [
        make_record("modis", "Terra", "2024-04-04"),
        make_record("modis", "Aqua", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04"),
    ]
    qc_report = {
        "raw_record_count": 3,
        "duplicate_count": 0,
    }
    spatial_summary = {
        "assigned_by_district": {"NP-BANKE": 3, "NP-BARDIYA": 0, "NP-CHITWAN": 0},
        "outside_study_area_count": 0,
        "boundary_touch_count": 0,
    }
    report = historical.build_quality_report(records, qc_report, spatial_summary)
    assert report["records_by_sensor_platform"] == {
        "modis:Terra": 1,
        "modis:Aqua": 1,
        "viirs_snpp:Suomi-NPP": 1,
    }
    assert report["frp"] == {"available": 3, "missing": 0}


def test_quality_report_counts_frp_missing():
    records = [make_record("modis", "Terra", "2024-04-04")]
    records[0]["frp"] = None
    qc_report = {"raw_record_count": 1, "duplicate_count": 0}
    spatial_summary = {
        "assigned_by_district": {"NP-BANKE": 1, "NP-BARDIYA": 0, "NP-CHITWAN": 0},
        "outside_study_area_count": 0,
        "boundary_touch_count": 0,
    }
    report = historical.build_quality_report(records, qc_report, spatial_summary)
    assert report["frp"] == {"available": 0, "missing": 1}


# ---------------------------------------------------------------------------
# Calibration readiness
# ---------------------------------------------------------------------------


def _minimal_readiness_inputs(records):
    requested = {sid: set() for sid in config.SENSOR_ORDER}
    requested["modis"] = dates_from_windows([("2024-04-01", "2024-04-30")])
    requested["viirs_snpp"] = dates_from_windows([("2024-04-01", "2024-04-30")])
    availability = {sid: ("2000-11-01", "2026-07-31") for sid in config.SENSOR_ORDER}
    coverage = historical.build_coverage_matrices(
        records, requested_by_sensor=requested, availability_spans=availability
    )
    comparability = historical.build_spatial_comparability(records, {})
    overlap = historical.build_overlap_analysis(records, requested_by_sensor=requested)
    return coverage, comparability, overlap


def test_readiness_flags_suitable_month_only_above_threshold():
    records = [
        make_record("modis", "Terra", f"2024-04-{d:02d}") for d in range(1, 11)
    ] + [
        make_record("viirs_snpp", "Suomi-NPP", f"2024-04-{d:02d}") for d in range(1, 11)
    ]
    coverage, comparability, overlap = _minimal_readiness_inputs(records)
    readiness = historical.build_calibration_readiness(
        records, coverage, comparability, overlap
    )
    bardiya = [m["year_month"] for m in readiness["suitable_months_by_district"]["NP-BARDIYA"]]
    assert "2024-04" not in bardiya  # records are in Banke, not Bardiya
    banke = [m["year_month"] for m in readiness["suitable_months_by_district"]["NP-BANKE"]]
    assert "2024-04" in banke  # 10 co-detection days >= threshold 6


def test_readiness_does_not_fit_correction_factors():
    records = [
        make_record("modis", "Terra", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04"),
    ]
    coverage, comparability, overlap = _minimal_readiness_inputs(records)
    readiness = historical.build_calibration_readiness(
        records, coverage, comparability, overlap
    )
    text = json.dumps(readiness)
    assert "correction_factor" not in text
    assert readiness["answers"]["2_candidate_training_years"]["answer"] is not None


def test_readiness_reproducible():
    records = [
        make_record("modis", "Terra", "2024-04-04"),
        make_record("viirs_snpp", "Suomi-NPP", "2024-04-04"),
    ]
    coverage, comparability, overlap = _minimal_readiness_inputs(records)
    first = historical.build_calibration_readiness(records, coverage, comparability, overlap)
    second = historical.build_calibration_readiness(records, coverage, comparability, overlap)
    # Strip timestamps, compare the rest.
    first.pop("generated_at")
    second.pop("generated_at")
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
