"""Resumable pre-2012 MODIS acquisition for the six study areas.

This module is deliberately separate from ``download_historical`` because the
post-2012 acquisition is a January-July product while the historical request
covers every month. It uses the same FIRMS Area API, the same five-day chunk
limit and the same manifest contract as the rest of the pipeline.

Design:
* one manifest write per batch of completed chunks, not per request;
* atomic ``.part`` downloads via ``http.Downloader``;
* a chunk is skipped only when its manifest entry exists, has a non-empty
  stored CSV with a latitude header, and the recorded SHA-256 matches;
* failed chunks are recorded and can be retried by re-running the command;
* Terra and Aqua remain identifiable because MODIS_SP rows carry the
  satellite code; no platform is inferred or invented.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import config, download, http, manifests

PRE2012_START = "2000-11-01"
PRE2012_END = "2011-12-31"
PRE2012_SENSOR = "modis"
PRE2012_SOURCE = "MODIS_SP"
PRE2012_ENTRY_PREFIX = "pre2012"
DEFAULT_WORKERS = 2
# Global pacing. The FIRMS Area API allows 5000 transactions per 10 minutes,
# and a five-day bbox request counts as several transactions. 0.65 requests/s
# is ~390 requests per 10 minutes, comfortably inside the allowance.
MIN_REQUEST_INTERVAL = 1.55
# When the API reports a transaction-limit breach, pause every worker for the
# documented ten-minute window before retrying the same chunk.
LIMIT_COOLDOWN_SECONDS = 605.0
MAX_LIMIT_WAITS = 12
MANIFEST_FLUSH_EVERY = 25


class _RateLimiter:
    """Process-wide request pacing plus a shared cooldown gate."""

    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._next_at = 0.0
        self._cooldown_until = 0.0

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                if now < self._cooldown_until:
                    wait = self._cooldown_until - now
                else:
                    wait = max(0.0, self._next_at - now)
                    if wait <= 0:
                        self._next_at = now + self.min_interval
                        return
            time.sleep(min(wait, 5.0))

    def cool_down(self, seconds: float = LIMIT_COOLDOWN_SECONDS) -> None:
        with self._lock:
            target = time.monotonic() + seconds + random.uniform(0, 15)
            self._cooldown_until = max(self._cooldown_until, target)


_LIMITER = _RateLimiter(MIN_REQUEST_INTERVAL)


def _is_limit_error(error: http.DownloadError) -> bool:
    text = str(error).lower()
    return "transaction limit" in text or "exceeding allowed" in text


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _csv_row_count(path: Path) -> int:
    with path.open("rb") as handle:
        return max(0, sum(1 for _ in handle) - 1)


def _is_valid_csv(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            header = next(csv.reader(handle), None)
    except (OSError, UnicodeDecodeError, csv.Error):
        return False
    return bool(header) and [value.strip().lower() for value in header[:2]] == [
        "latitude",
        "longitude",
    ]


def _chunk_ranges(start: date, end: date) -> list[tuple[date, date]]:
    chunks: list[tuple[date, date]] = []
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=config.AREA_API_MAX_DAYS - 1), end)
        chunks.append((current, chunk_end))
        current = chunk_end + timedelta(days=1)
    return chunks


def _destination(region_id: str, start: date, end: date) -> Path:
    return (
        config.RAW_DIR
        / "regions"
        / region_id
        / PRE2012_SENSOR
        / PRE2012_SOURCE
        / f"{PRE2012_SENSOR}_{start.isoformat()}_{end.isoformat()}.csv"
    )


def _entry_key(entry: dict[str, Any]) -> tuple[str, str, str, str] | None:
    if entry.get("provider") != "area-api":
        return None
    if entry.get("sensor_id") != PRE2012_SENSOR:
        return None
    region_id = entry.get("region_id")
    window = entry.get("date_window") or {}
    if not region_id or not window.get("start") or not window.get("end"):
        return None
    return (str(region_id), PRE2012_SENSOR, str(window["start"]), str(window["end"]))


def _existing_index(entries: list[dict[str, Any]]) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    """Latest usable entry per region/sensor/window.

    Entries are considered usable only when the file still exists, is a real
    FIRMS CSV and the SHA-256 matches the manifest. This prevents a crashed or
    truncated download from being silently skipped on resume.
    """

    index: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for entry in entries:
        key = _entry_key(entry)
        if key is None or not entry.get("storage_path"):
            continue
        path = config.REPO_ROOT / entry["storage_path"]
        if not _is_valid_csv(path):
            continue
        recorded = entry.get("sha256")
        if recorded and _file_sha256(path) != recorded:
            continue
        index[key] = entry
    return index


def _download_one(
    *,
    region_id: str,
    start: date,
    end: date,
    bbox: str,
    map_key: str,
    force: bool,
    retrieved_at: str,
) -> dict[str, Any]:
    url = config.FIRMS_AREA_URL.format(
        map_key=map_key,
        source=PRE2012_SOURCE,
        bbox=bbox,
        day_range=(end - start).days + 1,
        start_date=start.isoformat(),
    )
    destination = _destination(region_id, start, end)
    # Pacing is handled by the process-wide limiter, not the per-download
    # throttle (each worker would otherwise get its own budget).
    downloader = http.Downloader(secrets=[map_key], throttle_seconds=0.0)
    entry_base = {
        "entry_id": f"{PRE2012_ENTRY_PREFIX}:{region_id}:{PRE2012_SENSOR}:{start.isoformat()}:{end.isoformat()}",
        "provider": "area-api",
        "product": "SP",
        "acquisition_batch": "pre2012",
        "region_id": region_id,
        "sensor_id": PRE2012_SENSOR,
        "source_identifier": PRE2012_SOURCE,
        "url": http.redact(url, [map_key]),
        "retrieved_at": retrieved_at,
        "date_window": {"start": start.isoformat(), "end": end.isoformat()},
        "date_window_basis": "explicit pre-2012 Area API request window",
    }

    if not force and _is_valid_csv(destination):
        return {
            **entry_base,
            "status": "already_present",
            "http_status": None,
            "bytes": destination.stat().st_size,
            "sha256": _file_sha256(destination),
            "global_rows": _csv_row_count(destination),
            "storage_path": config.relative(destination),
        }

    result = None
    error: http.DownloadError | None = None
    limit_waits = 0
    while True:
        _LIMITER.acquire()
        try:
            result = downloader.download(url, destination, allow_empty=True)
            break
        except http.DownloadError as exc:
            error = exc
            if _is_limit_error(exc) and limit_waits < MAX_LIMIT_WAITS:
                limit_waits += 1
                # Shared cooldown: every worker pauses for the documented
                # ten-minute allowance window, then this chunk is retried.
                _LIMITER.cool_down()
                continue
            return {**entry_base, "status": "error", "error": str(exc)}

    if error is not None and result is None:  # pragma: no cover - defensive
        return {**entry_base, "status": "error", "error": str(error)}

    if not _is_valid_csv(destination):
        preview = ""
        try:
            preview = destination.read_text(encoding="utf-8", errors="replace")[:200].lstrip()
        except OSError:
            pass
        destination.unlink(missing_ok=True)
        return {
            **entry_base,
            "status": "error",
            "error": f"Unexpected response: {preview[:160]}",
        }

    rows = _csv_row_count(destination)
    return {
        **entry_base,
        "status": "downloaded_empty" if rows == 0 else "downloaded",
        "http_status": result.http_status,
        "bytes": result.bytes_written,
        "sha256": result.sha256,
        "last_modified": http.parse_last_modified(result.last_modified),
        "etag": result.etag,
        "content_type": result.content_type,
        "resumed": result.resumed,
        "storage_path": config.relative(destination),
        "global_rows": rows,
    }


def download_pre2012(
    *,
    start: str = PRE2012_START,
    end: str = PRE2012_END,
    regions: list[str] | None = None,
    workers: int = DEFAULT_WORKERS,
    force: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    config.ensure_directories()
    map_key = config.map_key()
    if not map_key and not dry_run:
        raise RuntimeError(f"Missing {config.MAP_KEY_ENV}; required for the Area API.")

    first = date.fromisoformat(start)
    last = date.fromisoformat(end)
    if first > last:
        raise ValueError("start date must not be after end date")
    region_ids = regions or list(config.REGION_ORDER)
    unknown = [region_id for region_id in region_ids if region_id not in config.REGIONS]
    if unknown:
        raise ValueError(f"Unknown region ids: {unknown}")

    manifest = manifests.load_manifest(config.DOWNLOAD_MANIFEST)
    entries = manifest.setdefault("entries", [])
    existing_all = _existing_index(entries)
    existing = {
        key: entry
        for key, entry in existing_all.items()
        if first <= date.fromisoformat(key[2]) <= last
    }
    tasks: list[tuple[str, date, date, str]] = []
    for region_id in region_ids:
        bbox = download.region_bbox(region_id)
        for chunk_start, chunk_end in _chunk_ranges(first, last):
            key = (region_id, PRE2012_SENSOR, chunk_start.isoformat(), chunk_end.isoformat())
            if not force and key in existing:
                continue
            tasks.append((region_id, chunk_start, chunk_end, bbox))

    summary: dict[str, Any] = {
        "provider": "area-api",
        "acquisition_batch": "pre2012",
        "requested_period": {"start": first.isoformat(), "end": last.isoformat()},
        "regions": region_ids,
        "total_planned_chunks": len(tasks) + len(existing),
        "already_verified": len(existing),
        "pending_chunks": len(tasks),
        "dry_run": dry_run,
        "workers": max(1, workers),
        "retrieved_at": _utc_now(),
    }
    if dry_run:
        return summary

    retrieved_at = summary["retrieved_at"]
    log_path = config.DATA_DIR / "logs" / "pre2012_download.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_handle = log_path.open("a", encoding="utf-8")
    log_lock = threading.Lock()

    def log(message: str) -> None:
        line = f"{datetime.now(timezone.utc).isoformat()} {message}"
        with log_lock:
            print(message, flush=True)
            log_handle.write(line + "\n")
            log_handle.flush()

    statuses: dict[str, int] = {}
    completed = 0
    new_entries: list[dict[str, Any]] = []
    try:
        if tasks:
            log(
                f"pre2012: {len(tasks)} pending chunks across {len(region_ids)} regions "
                f"({first.isoformat()}..{last.isoformat()}), workers={max(1, workers)}"
            )
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            futures = {
                pool.submit(
                    _download_one,
                    region_id=region_id,
                    start=chunk_start,
                    end=chunk_end,
                    bbox=bbox,
                    map_key=map_key,
                    force=force,
                    retrieved_at=retrieved_at,
                ): (region_id, chunk_start, chunk_end)
                for region_id, chunk_start, chunk_end, bbox in tasks
            }
            for future in as_completed(futures):
                entry = future.result()
                new_entries.append(entry)
                status = str(entry.get("status", "unknown"))
                statuses[status] = statuses.get(status, 0) + 1
                completed += 1
                if completed % 25 == 0 or status == "error":
                    log(
                        f"pre2012 progress {completed}/{len(tasks)} "
                        f"{status} rows={entry.get('global_rows', 0)} "
                        f"{entry.get('region_id')} {entry.get('date_window', {}).get('start')}"
                    )
                if completed % MANIFEST_FLUSH_EVERY == 0:
                    entries.extend(new_entries)
                    new_entries.clear()
                    manifest["retrieved_at"] = retrieved_at
                    manifest["provider"] = "area-api"
                    manifests.save_manifest(config.DOWNLOAD_MANIFEST, manifest)
    finally:
        entries.extend(new_entries)
        manifest["retrieved_at"] = retrieved_at
        manifest["provider"] = "area-api"
        manifests.save_manifest(config.DOWNLOAD_MANIFEST, manifest)

    summary["statuses"] = statuses
    summary["completed_chunks"] = completed
    summary["errors"] = statuses.get("error", 0)
    try:
        log(f"pre2012 finished: {json.dumps(summary, sort_keys=True)}")
    finally:
        log_handle.close()
    return summary


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Resumable pre-2012 MODIS acquisition.")
    parser.add_argument("--start", default=PRE2012_START)
    parser.add_argument("--end", default=PRE2012_END)
    parser.add_argument("--regions", nargs="*", default=None)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    result = download_pre2012(
        start=args.start,
        end=args.end,
        regions=args.regions,
        workers=args.workers,
        force=args.force,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
