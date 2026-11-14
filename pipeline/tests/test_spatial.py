import math

from pipeline import config, spatial

# Synthetic records mimicking normalized+valid records.
RECORDS = [
    {"district_id": "NP-BANKE", "sensor_id": "modis", "platform": "Terra",
     "latitude": 28.05, "longitude": 81.62, "acq_date": "2024-03-01", "frp": 12.5, "daynight": "D"},
    {"district_id": "NP-BANKE", "sensor_id": "modis", "platform": "Terra",
     "latitude": 28.06, "longitude": 81.63, "acq_date": "2024-03-01", "frp": 8.0, "daynight": "D"},
    {"district_id": "NP-BANKE", "sensor_id": "modis", "platform": "Aqua",
     "latitude": 28.05, "longitude": 81.62, "acq_date": "2024-03-01", "frp": None, "daynight": "N"},
]


def test_cell_days_one_per_cell():
    cell_days = spatial.build_cell_days(RECORDS)
    key = ("NP-BANKE", "modis", "Terra", "2024-03-01")
    cells = cell_days[key]
    # two records same 0.1 cell -> one cell, detections=2, cell_days=1
    assert len(cells) == 1
    assert cells[0]["detections"] == 2
    assert cells[0]["cell_days"] == 1


def test_sensors_not_merged():
    cell_days = spatial.build_cell_days(RECORDS)
    terra_key = ("NP-BANKE", "modis", "Terra", "2024-03-01")
    aqua_key = ("NP-BANKE", "modis", "Aqua", "2024-03-01")
    assert terra_key in cell_days
    assert aqua_key in cell_days
    # distinct keys, never merged
    assert terra_key != aqua_key


def test_grid_index_floor():
    assert spatial._grid_index(28.05) == 280
    assert spatial._grid_index(-0.05) == -1
