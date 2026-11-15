import json
from pathlib import Path

import pytest

from pipeline import config, geometry, normalize

RAW = config.RAW_DIR


@pytest.mark.skipif(not any(config.RAW_DIR.glob("**/*.csv")), reason="no raw FIRMS data")
def test_real_headers_and_assignment():
    # Pick MODIS file
    modis_files = list((config.RAW_DIR / "modis").glob("*.csv"))
    assert modis_files
    records = normalize.normalize_file(modis_files[0], "modis")
    assert len(records) > 0
    # essential fields present
    assert all(r.get("latitude") is not None for r in records[:10])
    # PIP assignment sanity: representative point of Banke inside Banke
    boundaries = geometry.load_boundaries()
    index = geometry.DistrictIndex(boundaries)
    banke = next(b for b in boundaries if b.district_id == "NP-BANKE")
    rp = banke.geometry.representative_point()
    assert index.assign(rp.x, rp.y).district_id == "NP-BANKE"


def test_cross_layer_district_ids():
    study = json.loads(config.STUDY_AREA_BOUNDARIES.read_text())
    ids = {f["properties"]["district_id"] for f in study["features"]}
    assert ids == set(config.REGIONS)
    display = json.loads(config.DISPLAY_BOUNDARIES.read_text())
    # display may be list of features or object; handle both
    if isinstance(display, dict):
        display_ids = {f["properties"].get("id") or f["properties"].get("district_id") for f in display.get("features", [])}
    else:
        display_ids = set()
    # display uses region ids NP-BANKE etc? check file content
    text = config.DISPLAY_BOUNDARIES.read_text()
    for district_id in config.REGIONS:
        assert district_id in text
