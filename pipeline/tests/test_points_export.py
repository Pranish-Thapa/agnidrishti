"""Tests for the streaming point-level export.

The export must write one file per region-year, must not lose or duplicate
records when a region is covered by two acquisition scopes, and must bound its
memory by flushing a year once no later entry can still contribute to it.
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline import config, points

MODIS_HEADER = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
    "instrument,confidence,version,bright_t31,frp,daynight,type"
)


def _row(latitude: float, longitude: float, day: str) -> str:
    return f"{latitude},{longitude},304.1,4.4,1.9,{day},618,Terra,MODIS,58,6.03,288.8,56.6,D,0"


def _write_csv(path: Path, rows: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(MODIS_HEADER + "\n" + "\n".join(rows) + "\n", encoding="utf-8")


def _entry(entry_id: str, storage_path: str, region_id: str | None, start: str, end: str) -> dict:
    return {
        "entry_id": entry_id,
        "provider": "area-api",
        "product": "SP",
        "acquisition_batch": "pre2012" if region_id else None,
        "region_id": region_id,
        "sensor_id": "modis",
        "source_identifier": "MODIS_SP",
        "storage_path": storage_path,
        "date_window": {"start": start, "end": end},
        "status": "downloaded",
        "global_rows": 1,
    }


def _isolated_repo(tmp_path: Path, monkeypatch) -> dict[str, Path]:
    paths = {
        "repo": tmp_path,
        "raw": tmp_path / "raw",
        "public": tmp_path / "public",
        "manifests": tmp_path / "manifests",
    }
    monkeypatch.setattr(config, "REPO_ROOT", paths["repo"])
    monkeypatch.setattr(config, "RAW_DIR", paths["raw"])
    monkeypatch.setattr(config, "PUBLIC_DATA_DIR", paths["public"])
    monkeypatch.setattr(config, "MANIFEST_DIR", paths["manifests"])
    monkeypatch.setattr(config, "DOWNLOAD_MANIFEST", paths["manifests"] / "download_manifest.json")
    monkeypatch.setattr(points, "POINTS_DIR", paths["public"] / "points")
    paths["manifests"].mkdir(parents=True, exist_ok=True)
    return paths


def _seed(paths: dict[str, Path], monkeypatch) -> None:
    pre = paths["raw"] / "regions" / "NP-BANKE" / "modis" / "MODIS_SP" / "modis_2001-03-01_2001-03-05.csv"
    _write_csv(pre, [_row(28.0, 81.7, "2001-03-02")])
    legacy = paths["raw"] / "modis" / "MODIS_SP" / "modis_2020-03-01_2020-03-05.csv"
    _write_csv(legacy, [_row(28.0, 81.7, "2020-03-02"), _row(28.01, 81.71, "2020-03-03")])
    manifest = {
        "manifest_version": 1,
        "entries": [
            _entry(
                "pre2012:NP-BANKE:modis:2001-03-01:2001-03-05",
                "raw/regions/NP-BANKE/modis/MODIS_SP/modis_2001-03-01_2001-03-05.csv",
                "NP-BANKE",
                "2001-03-01",
                "2001-03-05",
            ),
            _entry(
                "area:modis:2020-03-01:2020-03-05",
                "raw/modis/MODIS_SP/modis_2020-03-01_2020-03-05.csv",
                None,
                "2020-03-01",
                "2020-03-05",
            ),
        ],
    }
    config.DOWNLOAD_MANIFEST.write_text(json.dumps(manifest), encoding="utf-8")


def test_streaming_export_writes_both_periods_without_duplicates(tmp_path, monkeypatch):
    paths = _isolated_repo(tmp_path, monkeypatch)
    _seed(paths, monkeypatch)

    result = points._export_sp_streaming(paths["public"] / "points" / "sp")

    assert result["record_count"] == 3
    assert result["files"] == 2  # one region-year file per year
    payload_2001 = json.loads(
        (paths["public"] / "points" / "sp" / "NP-BANKE" / "2001.json").read_text(encoding="utf-8")
    )
    payload_2020 = json.loads(
        (paths["public"] / "points" / "sp" / "NP-BANKE" / "2020.json").read_text(encoding="utf-8")
    )
    assert payload_2001["record_count"] == 1
    assert payload_2001["platform_counts"] == {"Terra": 1}
    assert payload_2020["record_count"] == 2
    assert payload_2020["platform_counts"] == {"Terra": 2}


def test_streaming_export_handles_year_straddling_chunk(tmp_path, monkeypatch):
    paths = _isolated_repo(tmp_path, monkeypatch)
    straddle = paths["raw"] / "regions" / "NP-BANKE" / "modis" / "MODIS_SP" / "modis_2011-12-29_2012-01-02.csv"
    _write_csv(straddle, [_row(28.0, 81.7, "2011-12-30"), _row(28.0, 81.7, "2012-01-01")])
    config.DOWNLOAD_MANIFEST.write_text(
        json.dumps(
            {
                "manifest_version": 1,
                "entries": [
                    _entry(
                        "pre2012:NP-BANKE:modis:2011-12-29:2012-01-02",
                        "raw/regions/NP-BANKE/modis/MODIS_SP/modis_2011-12-29_2012-01-02.csv",
                        "NP-BANKE",
                        "2011-12-29",
                        "2012-01-02",
                    )
                ],
            }
        ),
        encoding="utf-8",
    )

    result = points._export_sp_streaming(paths["public"] / "points" / "sp")

    assert result["record_count"] == 2
    assert result["files"] == 2
    for year, expected in (("2011", 1), ("2012", 1)):
        payload = json.loads(
            (paths["public"] / "points" / "sp" / "NP-BANKE" / f"{year}.json").read_text(encoding="utf-8")
        )
        assert payload["record_count"] == expected
