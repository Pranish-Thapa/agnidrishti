from pathlib import Path

from pipeline import normalize, qc

FIXTURES = Path(__file__).parent / "fixtures"


def test_qc_dedup_and_counts():
    records = normalize.normalize_file(FIXTURES / "modis_sample.csv", "modis")
    clean, report = qc.run_qc(records)
    assert report["raw_record_count"] == 4
    # one invalid coordinate + one missing time = 2 invalid; plus duplicate
    assert report["duplicate_count"] == 1
    # clean = valid non-duplicate: first row only (row4 duplicate of row1)
    assert len(clean) == 1
    assert report["valid_record_count"] == 1
    assert report["invalid_coordinate_count"] == 1
    assert report["invalid_timestamp_count"] == 1


def test_qc_no_cross_sensor_merge():
    # QC is per-call; sensors never merged inside one list unless caller mixes.
    # Here ensure duplicate key includes sensor_id.
    r1 = normalize.normalize_file(FIXTURES / "modis_sample.csv", "modis")
    r2 = normalize.normalize_file(FIXTURES / "viirs_sample.csv", "viirs_snpp")
    combined = r1 + r2
    clean, report = qc.run_qc(combined)
    # duplicate detection key includes sensor_id, so no false cross-sensor dedup
    assert report["duplicate_count"] == 1
