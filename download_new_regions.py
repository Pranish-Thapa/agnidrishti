"""One-off helper: acquire missing historical SP chunks for the extra regions.

The FIRMS MAP key is read from the environment (or `.env`, via the pipeline
config) — never hard-code it in this file. Run from the repository root:

    # PowerShell:  $env:FIRMS_MAP_KEY = "..."
    # bash:        export FIRMS_MAP_KEY=...
    python download_new_regions.py [REGION_ID ...]

Defaults to TH-CHIANG-MAI, ID-RIAU and MM-SHAN. Re-running is safe: chunks
already present in the manifest are skipped.
"""

from __future__ import annotations

import datetime
import json
import sys
import time

from pipeline import config, download, http
from pipeline.download import historical_windows

REGIONS = ["TH-CHIANG-MAI", "ID-RIAU", "MM-SHAN"]
MIN_DATE = "2012-01-20"
MAX_DATE = "2026-07-31"


def main(argv: list[str]) -> int:
    regions = argv or REGIONS
    unknown = [region for region in regions if region not in config.REGIONS]
    if unknown:
        print(f"Unknown region ids: {unknown}", file=sys.stderr)
        return 2

    map_key = config.map_key()
    if not map_key:
        print(
            f"Missing {config.MAP_KEY_ENV}: set it in the environment or .env before running.",
            file=sys.stderr,
        )
        return 2

    availability = json.loads(config.PROCESSED_DIR.joinpath("availability.json").read_text())
    downloader = http.Downloader(secrets=[map_key], throttle_seconds=1.5)
    log_path = config.DATA_DIR / "logs" / "new_regions_download.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = log_path.open("a", encoding="utf-8")

    def logmsg(message: str) -> None:
        print(message, flush=True)
        log.write(message + "\n")
        log.flush()

    try:
        for region_id in regions:
            manifest = json.loads(config.DOWNLOAD_MANIFEST.read_text(encoding="utf-8"))
            existing = {
                (entry["sensor_id"], entry["date_window"]["start"], entry["date_window"]["end"])
                for entry in manifest["entries"]
                if entry.get("region_id") == region_id
            }
            missing: list[tuple[str, str, str]] = []
            for source in availability["sources"]:
                sensor_id = None
                for key, definition in config.SENSORS.items():
                    if definition.sp_identifier == source["source_identifier"]:
                        sensor_id = key
                if sensor_id not in ("modis", "viirs_snpp", "viirs_noaa20", "viirs_noaa21"):
                    continue
                first = max(source["first_available"], MIN_DATE)
                last = min(source["last_available"], MAX_DATE)
                for window_start, window_end in historical_windows(first, last):
                    current = datetime.date.fromisoformat(window_start)
                    window_last = datetime.date.fromisoformat(window_end)
                    while current <= window_last:
                        chunk_end = min(current + datetime.timedelta(days=4), window_last)
                        if (sensor_id, current.isoformat(), chunk_end.isoformat()) not in existing:
                            missing.append((sensor_id, current.isoformat(), chunk_end.isoformat()))
                        current = chunk_end + datetime.timedelta(days=1)

            logmsg(f"{region_id}: {len(missing)} missing chunks")
            bbox = download.region_bbox(region_id)
            for index, (sensor_id, start, end) in enumerate(missing, 1):
                try:
                    result = download.download_area_api(
                        start=start,
                        end=end,
                        bbox=bbox,
                        sensors=[sensor_id],
                        region_id=region_id,
                        map_key=map_key,
                        downloader=downloader,
                        force=False,
                    )
                    entry = result["entries"][0]
                    logmsg(
                        f"{region_id} {index}/{len(missing)} {sensor_id} {start} {end} "
                        f"{entry.get('status')} {entry.get('global_rows')}"
                    )
                except Exception as error:  # noqa: BLE001 - one chunk must not stop the run
                    logmsg(
                        f"{region_id} {index}/{len(missing)} {sensor_id} {start} {end} "
                        f"ERROR {error!r}"
                    )
                    time.sleep(2)
        logmsg("ALL DONE")
    finally:
        log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
