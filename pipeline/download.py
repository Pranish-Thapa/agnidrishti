"""Download orchestration for FIRMS NRT snapshots and Area API chunks."""

from __future__ import annotations

import json

import csv
import hashlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import config, http, manifests

NRT_RETRIEVAL_WINDOW_DAYS = 6


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _count_csv_rows(path: Path) -> int:
    count = 0
    with path.open("rb") as handle:
        for _ in handle:
            count += 1
    return max(0, count - 1)


def _date_range(start: date, end: date) -> list[str]:
    result: list[str] = []
    current = start
    while current <= end:
        result.append(current.isoformat())
        current += timedelta(days=1)
    return result


def download_nrt(
    *,
    sensors: list[str] | None = None,
    downloader: http.Downloader | None = None,
    force: bool = False,
    retrieved_at: str | None = None,
) -> dict:
    config.ensure_directories()
    retrieved_at = retrieved_at or _utc_now()
    today = _utc_today()
    window_start = today - timedelta(days=NRT_RETRIEVAL_WINDOW_DAYS)
    sensors = sensors or list(config.SENSOR_ORDER)
    downloader = downloader or http.Downloader(secrets=(), throttle_seconds=1.0)

    manifest = manifests.load_manifest(config.DOWNLOAD_MANIFEST)
    entries = manifest.setdefault("entries", [])
    results: list[dict[str, Any]] = []

    for sensor_id in sensors:
        sensor = config.SENSORS[sensor_id]
        url = sensor.nrt_global_url
        destination = config.RAW_DIR / sensor_id / f"{sensor_id}_global_7d_retrieved_{today.isoformat()}.csv"

        # If the file already exists locally and is non-empty, record it without
        # re-downloading (crash recovery).
        if (not force) and destination.exists() and destination.stat().st_size > 0:
            try:
                head = downloader.head(url)
                remote_modified = http.parse_last_modified(head.headers.get("last-modified"))
            except http.DownloadError:
                remote_modified = None
            global_rows = _count_csv_rows(destination)
            entry = {
                "entry_id": f"nrt:{sensor_id}:{http.file_sha256(destination)[:12]}",
                "provider": "nrt",
                "product": "NRT",
                "sensor_id": sensor_id,
                "source_identifier": sensor.nrt_identifier,
                "url": http.describe_url(url),
                "retrieved_at": retrieved_at,
                "http_status": 200,
                "bytes": destination.stat().st_size,
                "sha256": http.file_sha256(destination),
                "last_modified": remote_modified,
                "etag": None,
                "content_type": "text/csv",
                "resumed": False,
                "storage_path": config.relative(destination),
                "date_window": {"start": window_start.isoformat(), "end": today.isoformat()},
                "date_window_basis": "nominal 7-day snapshot window from retrieval date",
                "global_rows": global_rows,
                "status": "already_present",
            }
            entries.append(entry)
            results.append(entry)
            manifest["retrieved_at"] = retrieved_at
            manifest["provider"] = "nrt"
            manifests.save_manifest(config.DOWNLOAD_MANIFEST, manifest)
            continue

        # Skip if an identical, still-present file was already recorded.
        if not force:
            matching = [
                entry
                for entry in entries
                if entry.get("provider") == "nrt"
                and entry.get("sensor_id") == sensor_id
                and entry.get("url") == url
                and entry.get("storage_path")
                and (config.REPO_ROOT / entry["storage_path"]).exists()
            ]
            if matching:
                latest = matching[-1]
                head_status = "unknown"
                try:
                    head = downloader.head(url)
                    head_status = str(head.status)
                    remote_modified = http.parse_last_modified(head.headers.get("last-modified"))
                except http.DownloadError:
                    remote_modified = None
                if remote_modified and remote_modified == latest.get("last_modified"):
                    results.append({**latest, "status": "skipped_duplicate", "http_status_head": head_status})
                    continue

        try:
            result = downloader.download(url, destination, allow_empty=True)
        except http.DownloadError as error:
            entry = {
                "entry_id": f"nrt:{sensor_id}:{retrieved_at}",
                "provider": "nrt",
                "product": "NRT",
                "sensor_id": sensor_id,
                "source_identifier": sensor.nrt_identifier,
                "url": http.describe_url(url),
                "retrieved_at": retrieved_at,
                "status": "error",
                "error": str(error),
            }
            entries.append(entry)
            results.append(entry)
            manifest["retrieved_at"] = retrieved_at
            manifest["provider"] = "nrt"
            manifests.save_manifest(config.DOWNLOAD_MANIFEST, manifest)
            continue

        global_rows = _count_csv_rows(destination)
        entry = {
            "entry_id": f"nrt:{sensor_id}:{result.sha256[:12]}",
            "provider": "nrt",
            "product": "NRT",
            "sensor_id": sensor_id,
            "source_identifier": sensor.nrt_identifier,
            "url": http.describe_url(url),
            "retrieved_at": retrieved_at,
            "http_status": result.http_status,
            "bytes": result.bytes_written,
            "sha256": result.sha256,
            "last_modified": http.parse_last_modified(result.last_modified),
            "etag": result.etag,
            "content_type": result.content_type,
            "resumed": result.resumed,
            "storage_path": config.relative(destination),
            "date_window": {"start": window_start.isoformat(), "end": today.isoformat()},
            "date_window_basis": "nominal 7-day snapshot window from retrieval date",
            "global_rows": global_rows,
            "status": "downloaded_empty" if global_rows == 0 else "downloaded",
        }
        entries.append(entry)
        results.append(entry)
        manifest["retrieved_at"] = retrieved_at
        manifest["provider"] = "nrt"
        manifests.save_manifest(config.DOWNLOAD_MANIFEST, manifest)

    return {"provider": "nrt", "retrieved_at": retrieved_at, "entries": results}


def _chunks(start: date, end: date, size: int) -> list[tuple[date, date]]:
    result: list[tuple[date, date]] = []
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=size - 1), end)
        result.append((current, chunk_end))
        current = chunk_end + timedelta(days=1)
    return result


def download_area_api(
    *,
    start: str | date,
    end: str | date,
    bbox: str,
    sensors: list[str] | None = None,
    map_key: str | None = None,
    downloader: http.Downloader | None = None,
    force: bool = False,
    retrieved_at: str | None = None,
) -> dict:
    config.ensure_directories()
    map_key = map_key or config.map_key()
    if not map_key:
        raise RuntimeError(f"Missing {config.MAP_KEY_ENV}; required for the Area API provider.")

    start_date = start if isinstance(start, date) else date.fromisoformat(str(start))
    end_date = end if isinstance(end, date) else date.fromisoformat(str(end))
    if start_date > end_date:
        raise ValueError("start date must not be after end date")

    retrieved_at = retrieved_at or _utc_now()
    sensors = sensors or list(config.SENSOR_ORDER)
    downloader = downloader or http.Downloader(secrets=[map_key], throttle_seconds=1.5)

    manifest = manifests.load_manifest(config.DOWNLOAD_MANIFEST)
    entries = manifest.setdefault("entries", [])
    results: list[dict[str, Any]] = []

    for sensor_id in sensors:
        sensor = config.SENSORS[sensor_id]
        source = sensor.sp_identifier
        for chunk_start, chunk_end in _chunks(start_date, end_date, config.AREA_API_MAX_DAYS):
            days = (chunk_end - chunk_start).days + 1
            url = config.FIRMS_AREA_URL.format(
                map_key=map_key,
                source=source,
                bbox=bbox,
                day_range=days,
                start_date=chunk_start.isoformat(),
            )
            destination = (
                config.RAW_DIR
                / sensor_id
                / source
                / f"{sensor_id}_{chunk_start.isoformat()}_{chunk_end.isoformat()}.csv"
            )

            if not force:
                matching = [
                    entry
                    for entry in entries
                    if entry.get("provider") == "area-api"
                    and entry.get("sensor_id") == sensor_id
                    and entry.get("date_window", {}).get("start") == chunk_start.isoformat()
                    and entry.get("date_window", {}).get("end") == chunk_end.isoformat()
                    and entry.get("storage_path")
                    and (config.REPO_ROOT / entry["storage_path"]).exists()
                ]
                if matching:
                    latest = matching[-1]
                    try:
                        current_sha = http.file_sha256(config.REPO_ROOT / latest["storage_path"])
                    except OSError:
                        current_sha = None
                    if latest.get("sha256") and current_sha == latest["sha256"]:
                        results.append({**latest, "status": "skipped_duplicate"})
                        continue

            try:
                result = downloader.download(url, destination, allow_empty=True)
            except http.DownloadError as error:
                entry = {
                    "entry_id": f"area:{sensor_id}:{chunk_start.isoformat()}:{chunk_end.isoformat()}",
                    "provider": "area-api",
                    "product": "SP",
                    "sensor_id": sensor_id,
                    "source_identifier": source,
                    "url": http.redact(url, [map_key]),
                    "retrieved_at": retrieved_at,
                    "status": "error",
                    "error": str(error),
                    "date_window": {"start": chunk_start.isoformat(), "end": chunk_end.isoformat()},
                    "date_window_basis": "explicit Area API request window",
                }
                entries.append(entry)
                results.append(entry)
                continue

            # Validate that the response is CSV rather than an error string.
            preview = destination.read_text(encoding="utf-8", errors="replace")[:200].lstrip()
            if preview and not preview.lower().startswith("latitude"):
                # Could be a header-less empty response or an error message.
                if "invalid" in preview.lower() or "error" in preview.lower():
                    entry = {
                        "entry_id": f"area:{sensor_id}:{chunk_start.isoformat()}:{chunk_end.isoformat()}",
                        "provider": "area-api",
                        "product": "SP",
                        "sensor_id": sensor_id,
                        "source_identifier": source,
                        "url": http.redact(url, [map_key]),
                        "retrieved_at": retrieved_at,
                        "status": "error",
                        "error": f"Unexpected response: {preview[:120]}",
                        "date_window": {"start": chunk_start.isoformat(), "end": chunk_end.isoformat()},
                        "date_window_basis": "explicit Area API request window",
                    }
                    entries.append(entry)
                    results.append(entry)
                    destination.unlink(missing_ok=True)
                    continue

            global_rows = _count_csv_rows(destination)
            entry = {
                "entry_id": f"area:{sensor_id}:{chunk_start.isoformat()}:{chunk_end.isoformat()}",
                "provider": "area-api",
                "product": "SP",
                "sensor_id": sensor_id,
                "source_identifier": source,
                "url": http.redact(url, [map_key]),
                "retrieved_at": retrieved_at,
                "http_status": result.http_status,
                "bytes": result.bytes_written,
                "sha256": result.sha256,
                "last_modified": http.parse_last_modified(result.last_modified),
                "etag": result.etag,
                "content_type": result.content_type,
                "resumed": result.resumed,
                "storage_path": config.relative(destination),
                "date_window": {"start": chunk_start.isoformat(), "end": chunk_end.isoformat()},
                "date_window_basis": "explicit Area API request window",
                "global_rows": global_rows,
                "status": "downloaded_empty" if global_rows == 0 else "downloaded",
            }
            entries.append(entry)
            results.append(entry)

    manifest["retrieved_at"] = retrieved_at
    manifest["provider"] = "area-api"
    manifests.save_manifest(config.DOWNLOAD_MANIFEST, manifest)
    return {"provider": "area-api", "retrieved_at": retrieved_at, "entries": results}


def historical_windows(
    first_available: str,
    last_available: str,
    months: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7),
    include_july_only_in_last_year: bool = True,
) -> list[tuple[str, str]]:
    """Generate (start,end) 5-day-ready date windows for prioritized months.

    Returns individual day ranges? We return contiguous month spans; caller splits into 5-day chunks.
    """
    from datetime import date, timedelta

    first = date.fromisoformat(first_available)
    last = date.fromisoformat(last_available)
    windows: list[tuple[str, str]] = []
    year = first.year
    while year <= last.year:
        for month in months:
            if include_july_only_in_last_year and month == 7 and year != last.year:
                continue
            if month < 1 or month > 12:
                continue
            # month start
            try:
                month_start = date(year, month, 1)
            except ValueError:
                continue
            # month end
            if month == 12:
                month_end = date(year, 12, 31)
            else:
                month_end = date(year, month + 1, 1) - timedelta(days=1)
            start = max(month_start, first)
            end = min(month_end, last)
            if start > end:
                continue
            windows.append((start.isoformat(), end.isoformat()))
        year += 1
    return windows


def download_historical(
    *,
    sensors: list[str] | None = None,
    bbox: str = "80,27,86,29.5",
    map_key: str | None = None,
    months: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7),
    force: bool = False,
    availability_report: dict | None = None,
) -> dict:
    """Download historical SP data in <=5-day chunks, prioritizing Jan-Jun (+Jul 2026)."""
    config.ensure_directories()
    map_key = map_key or config.map_key()
    if not map_key:
        raise RuntimeError(f"Missing {config.MAP_KEY_ENV}; required for historical SP acquisition.")
    sensors = sensors or list(config.SENSOR_ORDER)
    # Load availability if not provided
    if availability_report is None:
        try:
            availability_report = json.load(open(config.PROCESSED_DIR / "availability.json", encoding="utf-8")) if (config.PROCESSED_DIR / "availability.json").exists() else None
        except Exception:
            availability_report = None

    # Build per-sensor availability map
    avail_map: dict[str, tuple[str, str]] = {}
    if availability_report:
        for src in availability_report.get("sources", []):
            sid = src.get("source_identifier")
            # map source identifier to sensor_id
            for sensor_id, sensor in config.SENSORS.items():
                if sensor.sp_identifier == sid:
                    fa = src.get("first_available")
                    la = src.get("last_available")
                    if fa and la:
                        avail_map[sensor_id] = (fa, la)
    # Fallback: use config reference coverage? No; require availability
    from datetime import date as _date

    for sensor_id in sensors:
        if sensor_id not in avail_map:
            raise RuntimeError(f"No availability data for {sensor_id}; run availability first.")
        first, last = avail_map[sensor_id]
        first = max(first, "2012-01-20")
        last = min(last, "2026-07-31")
        avail_map[sensor_id] = (first, last)

    downloader = http.Downloader(secrets=[map_key], throttle_seconds=1.5)
    all_results: list[dict] = []
    for sensor_id in sensors:
        first, last = avail_map[sensor_id]
        # Prioritize Jan-Jun all years; include July only in last available year
        wins = historical_windows(first, last, months=months, include_july_only_in_last_year=True)
        for (wstart, wend) in wins:
            # split into 5-day chunks
            from datetime import date, timedelta

            cur = date.fromisoformat(wstart)
            lastd = date.fromisoformat(wend)
            while cur <= lastd:
                cend = min(cur + timedelta(days=config.AREA_API_MAX_DAYS - 1), lastd)
                res = download_area_api(
                    start=cur.isoformat(),
                    end=cend.isoformat(),
                    bbox=bbox,
                    sensors=[sensor_id],
                    map_key=map_key,
                    downloader=downloader,
                    force=force,
                )
                all_results.extend(res.get("entries", []))
                cur = cend + timedelta(days=1)
    return {"provider": "area-api", "entries": all_results}
