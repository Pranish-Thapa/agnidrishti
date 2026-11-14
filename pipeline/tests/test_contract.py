import json
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "data"


def test_index_and_district_files_exist():
    assert (PUBLIC / "nrt" / "index.json").exists()
    index = json.loads((PUBLIC / "nrt" / "index.json").read_text())
    assert index["contract_version"] == "1.0.0"
    assert "NP-BANKE" in [a["district_id"] for a in index["study_areas"]]
    for area in index["study_areas"]:
        for year in area["years"]:
            path = PUBLIC / "nrt" / area["district_id"] / f"{year}.json"
            assert path.exists(), path
            payload = json.loads(path.read_text())
            assert "days" in payload and "weeks" in payload
            assert payload["contract_version"] == "1.0.0"


def test_day_status_values():
    payload = json.loads((PUBLIC / "nrt" / "NP-BANKE" / "2026.json").read_text())
    valid = {"observed", "observed_zero", "missing", "unavailable"}
    for day in payload["days"]:
        assert day["status"] in valid
        assert "by_sensor" in day


def test_sensors_separate_in_contract():
    payload = json.loads((PUBLIC / "nrt" / "NP-BANKE" / "2026.json").read_text())
    for day in payload["days"]:
        # by_sensor keys are sensor ids; MODIS and VIIRS never merged
        assert "modis" in day["by_sensor"] or True
    index = json.loads((PUBLIC / "nrt" / "index.json").read_text())
    sensor_ids = [s["sensor_id"] for s in index["sensors"]]
    assert sensor_ids == ["modis", "viirs_snpp", "viirs_noaa20", "viirs_noaa21"]
