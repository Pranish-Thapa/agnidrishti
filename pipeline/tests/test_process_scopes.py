"""Regression tests for scope handling in ``pipeline.process``.

A study area can be covered by two different acquisition scopes: its own
region-scoped chunks (the pre-2012 MODIS acquisition) and the legacy chunks
requested on the shared Nepal bounding box (region_id null, post-2012). Both
scopes must contribute to ONE daily/weekly series per region. An earlier
implementation gave each scope its own series, so whichever scope ran last
silently discarded the other period.
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline import config, process

MODIS_HEADER = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
    "instrument,confidence,version,bright_t31,frp,daynight,type"
)


def _row(latitude: float, longitude: float, day: str, satellite: str = "Terra") -> str:
    return (
        f"{latitude},{longitude},304.1,4.4,1.9,{day},618,{satellite},MODIS,"
        "58,6.03,288.8,56.6,D,0"
    )


def _write_csv(path: Path, rows: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(MODIS_HEADER + "\n" + "\n".join(rows) + "\n", encoding="utf-8")


def _entry(
    entry_id: str,
    storage_path: str,
    region_id: str | None,
    start: str,
    end: str,
) -> dict:
    return {
        "entry_id": entry_id,
        "provider": "area-api",
        "product": "SP",
        "acquisition_batch": "pre2012" if region_id else None,
        "region_id": region_id,
        "sensor_id": "modis",
        "source_identifier": "MODIS_SP",
        "url": "https://example.invalid/redacted",
        "retrieved_at": "2026-11-15T00:00:00Z",
        "storage_path": storage_path,
        "date_window": {"start": start, "end": end},
        "status": "downloaded",
        "global_rows": 1,
    }


def _isolated_repo(tmp_path: Path, monkeypatch) -> dict[str, Path]:
    paths = {
        "repo": tmp_path,
        "raw": tmp_path / "raw",
        "processed": tmp_path / "data" / "processed",
        "public": tmp_path / "public",
        "manifests": tmp_path / "manifests",
    }
    monkeypatch.setattr(config, "REPO_ROOT", paths["repo"])
    monkeypatch.setattr(config, "RAW_DIR", paths["raw"])
    monkeypatch.setattr(config, "PROCESSED_DIR", paths["processed"])
    monkeypatch.setattr(config, "PUBLIC_DATA_DIR", paths["public"])
    monkeypatch.setattr(config, "MANIFEST_DIR", paths["manifests"])
    monkeypatch.setattr(config, "DOWNLOAD_MANIFEST", paths["manifests"] / "download_manifest.json")
    monkeypatch.setattr(config, "PROCESSING_MANIFEST", paths["manifests"] / "processing_manifest.json")
    monkeypatch.setattr(config, "INTERMEDIATE_DIR", tmp_path / "intermediate")
    monkeypatch.setattr(config, "BOUNDARY_DIR", tmp_path / "boundaries")
    paths["manifests"].mkdir(parents=True, exist_ok=True)
    return paths


def test_region_daily_series_merges_region_scoped_and_legacy_scopes(tmp_path, monkeypatch):
    paths = _isolated_repo(tmp_path, monkeypatch)

    pre_path = paths["raw"] / "regions" / "NP-BANKE" / "modis" / "MODIS_SP" / "modis_2001-03-01_2001-03-05.csv"
    _write_csv(pre_path, [_row(28.0, 81.7, "2001-03-02")])
    legacy_path = paths["raw"] / "modis" / "MODIS_SP" / "modis_2020-03-01_2020-03-05.csv"
    _write_csv(legacy_path, [_row(28.0, 81.7, "2020-03-02")])

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

    result = process.run_processing(provider="area-api", into_public=True)

    assert result["record_count"] == 2  # each file counted once, never per region

    daily = json.loads(
        (paths["processed"] / "sp" / "districts" / "NP-BANKE" / "daily.json").read_text(encoding="utf-8")
    )
    dates = {day["date"] for day in daily["days"]}
    assert "2001-03-02" in dates
    assert "2020-03-02" in dates

    by_date = {day["date"]: day for day in daily["days"]}
    pre = by_date["2001-03-02"]
    post = by_date["2020-03-02"]
    assert pre["by_sensor"]["modis"]["platforms"]["Terra"]["detections"] == 1
    assert post["by_sensor"]["modis"]["platforms"]["Terra"]["detections"] == 1
    # Aqua began in May 2002, so a March 2001 day must be unavailable for Aqua
    # rather than a fabricated zero-detection observation.
    assert pre["by_sensor"]["modis"]["platforms"]["Aqua"]["status"] == "unavailable"

    # Both periods must be published as year files for the frontend.
    assert (paths["public"] / "sp" / "NP-BANKE" / "2001.json").exists()
    assert (paths["public"] / "sp" / "NP-BANKE" / "2020.json").exists()


def test_weekly_series_spans_both_scopes(tmp_path, monkeypatch):
    paths = _isolated_repo(tmp_path, monkeypatch)

    pre_path = paths["raw"] / "regions" / "NP-BANKE" / "modis" / "MODIS_SP" / "modis_2005-03-01_2005-03-05.csv"
    _write_csv(pre_path, [_row(28.0, 81.7, "2005-03-02")])
    legacy_path = paths["raw"] / "modis" / "MODIS_SP" / "modis_2020-03-01_2020-03-05.csv"
    _write_csv(legacy_path, [_row(28.0, 81.7, "2020-03-02")])
    config.DOWNLOAD_MANIFEST.write_text(
        json.dumps(
            {
                "manifest_version": 1,
                "entries": [
                    _entry(
                        "pre2012:NP-BANKE:modis:2005-03-01:2005-03-05",
                        "raw/regions/NP-BANKE/modis/MODIS_SP/modis_2005-03-01_2005-03-05.csv",
                        "NP-BANKE",
                        "2005-03-01",
                        "2005-03-05",
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
        ),
        encoding="utf-8",
    )

    process.run_processing(provider="area-api", into_public=True)

    weekly = json.loads(
        (paths["processed"] / "sp" / "districts" / "NP-BANKE" / "weekly.json").read_text(encoding="utf-8")
    )
    starts = {week["week_start"] for week in weekly["weeks"]}
    assert any(start.startswith("2005-03") for start in starts)
    assert any(start.startswith("2020-03") for start in starts)
