import json
from pathlib import Path

from pipeline import config, download, normalize

FIXTURES = Path(__file__).parent / "fixtures"


def test_chunks_splitting():
    from datetime import date

    chunks = download._chunks(date(2026, 3, 10), date(2026, 3, 14), 5)
    assert chunks == [(date(2026, 3, 10), date(2026, 3, 14))]
    chunks2 = download._chunks(date(2026, 3, 10), date(2026, 3, 20), 5)
    assert len(chunks2) == 3
    assert chunks2[0] == (date(2026, 3, 10), date(2026, 3, 14))
    assert chunks2[1] == (date(2026, 3, 15), date(2026, 3, 19))


def test_sensor_source_identifiers():
    assert config.SENSORS["modis"].sp_identifier == "MODIS_SP"
    assert config.SENSORS["viirs_snpp"].sp_identifier == "VIIRS_SNPP_SP"
    assert config.SENSORS["viirs_noaa20"].sp_identifier == "VIIRS_NOAA20_SP"
    assert config.SENSORS["viirs_noaa21"].sp_identifier == "VIIRS_NOAA21_SP"


def test_sp_csv_normalization():
    # Create a small SP fixture with instrument field
    import tempfile, os
    header = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n"
    row = "27.8,83.2,297.5,0.4,0.4,2026-03-13,2039,N,VIIRS,n,2,282.0,0.85,N,0\n"
    tmp = FIXTURES / "sp_sample.csv"
    tmp.write_text(header + row, encoding="utf-8")
    try:
        records = normalize.normalize_file(tmp, "viirs_snpp")
        assert len(records) == 1
        assert records[0]["platform"] == "Suomi-NPP"
        assert records[0]["instrument"] == "VIIRS"
        assert records[0]["acq_time"] == "20:39"
        assert records[0]["valid"] is True
    finally:
        tmp.unlink(missing_ok=True)


def test_nrt_sp_separation_paths():
    nrt_index = config.PUBLIC_DATA_DIR / "nrt" / "index.json"
    sp_index = config.PUBLIC_DATA_DIR / "sp" / "index.json"
    assert nrt_index.exists()
    assert sp_index.exists()
    nrt = json.loads(nrt_index.read_text())
    sp = json.loads(sp_index.read_text())
    assert nrt["provider"]["id"] == "nrt"
    assert sp["provider"]["id"] == "area-api"
    assert nrt["study_areas"][0]["years"] == ["2026"]
    # Historical SP processing covers Jan-Jun 2012-2026 plus July 2026.
    assert sp["study_areas"][0]["years"][0] == "2012"
    assert sp["study_areas"][0]["years"][-1] == "2026"
    assert len(sp["study_areas"][0]["years"]) == 15


def test_sp_contract_days():
    payload = json.loads((config.PUBLIC_DATA_DIR / "sp" / "NP-BANKE" / "2026.json").read_text())
    assert payload["provider"] == "area-api"
    assert payload["product"] == "SP"
    valid = {"observed", "observed_zero", "missing", "unavailable"}
    for day in payload["days"]:
        assert day["status"] in valid


def test_sp_processed_manifest():
    m = json.loads((config.MANIFEST_DIR / "processing_manifest_sp.json").read_text())
    assert m["provider"] == "area-api"
    assert m["slug"] == "sp"
    assert "quality_report" in m
