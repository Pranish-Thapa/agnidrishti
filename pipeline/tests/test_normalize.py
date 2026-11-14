import csv
from pathlib import Path

from pipeline import config, normalize

FIXTURES = Path(__file__).parent / "fixtures"


def test_modis_normalization():
    records = normalize.normalize_file(FIXTURES / "modis_sample.csv", "modis")
    assert len(records) == 4
    assert records[0]["platform"] == "Terra"
    assert records[0]["acq_time"] == "13:25"
    assert records[0]["confidence"] == 80
    assert records[0]["valid"] is True
    # invalid coordinate
    assert "latitude_out_of_range" in records[1]["issues"]
    assert records[1]["valid"] is False
    # missing time
    assert "missing_or_invalid_time" in records[2]["issues"]
    assert records[2]["acq_time"] is None
    # duplicate row is still normalized as valid here; QC handles dedup
    assert records[3]["valid"] is True


def test_viirs_time_padding_and_platforms():
    records = normalize.normalize_file(FIXTURES / "viirs_sample.csv", "viirs_snpp")
    # satellite code N20/N21 won't map for snpp sensor -> unknown
    assert records[0]["platform"] == "Suomi-NPP"
    assert records[0]["acq_time"] == "00:05"
    assert records[1]["acq_time"] == "23:59"
    assert records[2]["acq_time"] == "00:05"
    # N20 unknown for snpp sensor
    assert records[1]["platform"] == "unknown"
    assert "unknown_satellite_code" in records[1]["issues"]


def test_essential_field_missing_counts():
    records = normalize.normalize_file(FIXTURES / "modis_sample.csv", "modis")
    assert records[2]["latitude"] is not None
    assert records[2]["acq_date"] == "2024-03-01"
