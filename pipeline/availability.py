"""Discovery of FIRMS coverage through the documented data-availability endpoint."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from . import config, http, manifests


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _read_availability_csv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for raw in reader:
        normalized = {str(key).strip().lower(): (value or "").strip() for key, value in raw.items() if key is not None}
        if not any(normalized.values()):
            continue
        rows.append(normalized)
    return rows


def run_availability(
    *,
    map_key: str | None = None,
    downloader: http.Downloader | None = None,
    today: date | None = None,
) -> dict:
    config.ensure_directories()
    today = today or datetime.now(timezone.utc).date()
    checked_at = _utc_now()

    source_identifiers = [sensor.sp_identifier for sensor in config.SENSORS.values()]
    report: dict[str, Any] = {
        "checked_at": checked_at,
        "endpoint_template": config.FIRMS_AVAILABILITY_URL,
        "required_env_var": config.MAP_KEY_ENV,
        "setup_url": "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
        "status": "not_queried",
        "sources": [],
        "reference_coverage": config.REFERENCE_COVERAGE,
        "reference_coverage_checked_on": config.REFERENCE_COVERAGE_CHECKED_ON,
        "reference_coverage_url": config.REFERENCE_COVERAGE_URL,
        "notes": [
            "Archive-page coverage statements are reference points only and are not API-verified.",
            "The availability endpoint reports a first/last window per source; internal gaps are not exposed.",
        ],
    }

    if not map_key:
        report["status"] = "credential_required"
        for source_identifier in source_identifiers:
            report["sources"].append(
                {
                    "source_identifier": source_identifier,
                    "status": "not_queried",
                    "reason": f"Missing {config.MAP_KEY_ENV}; query {config.FIRMS_AVAILABILITY_URL.format(map_key='***', sensor=source_identifier)}",
                }
            )
        manifests.write_json(config.PROCESSED_DIR / "availability.json", report)
        _write_markdown(report, config.PROCESSED_DIR / "availability.md")
        return report

    downloader = downloader or http.Downloader(secrets=[map_key], throttle_seconds=1.5)
    report["status"] = "queried"
    for source_identifier in source_identifiers:
        url = config.FIRMS_AVAILABILITY_URL.format(map_key=map_key, sensor=source_identifier)
        try:
            text = downloader.get_text(url)
        except http.DownloadError as error:
            report["sources"].append(
                {
                    "source_identifier": source_identifier,
                    "status": "error",
                    "error": str(error),
                    "url": http.describe_url(url),
                }
            )
            continue

        raw_path = config.AVAILABILITY_DIR / f"{source_identifier}_{today.isoformat()}.csv"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(text, encoding="utf-8")

        rows = _read_availability_csv(text)
        windows: list[dict[str, str]] = []
        for row in rows:
            available_from = (
                row.get("available_from")
                or row.get("first_available")
                or row.get("min_date")
                or ""
            )
            available_to = (
                row.get("available_to")
                or row.get("last_available")
                or row.get("max_date")
                or ""
            )
            windows.append(
                {
                    "available_from": available_from,
                    "available_to": available_to,
                    "raw": row,
                }
            )

        first_available = None
        last_available = None
        for window in windows:
            start = _parse_date(window["available_from"])
            end = _parse_date(window["available_to"])
            if start is not None and (first_available is None or start < first_available):
                first_available = start
            if end is not None and (last_available is None or end > last_available):
                last_available = end

        currently_available = bool(last_available and (today - last_available).days <= 7)
        report["sources"].append(
            {
                "source_identifier": source_identifier,
                "status": "queried",
                "raw_path": config.relative(raw_path),
                "row_count": len(rows),
                "windows": windows,
                "first_available": first_available.isoformat() if first_available else None,
                "last_available": last_available.isoformat() if last_available else None,
                "currently_available_within_7_days": currently_available,
                "coverage_gaps_detected": len(windows) > 1,
                "coverage_gaps_note": (
                    "Multiple non-contiguous windows reported by the endpoint."
                    if len(windows) > 1
                    else "Single contiguous window reported; internal gaps are not exposed by this endpoint."
                ),
            }
        )

    manifests.write_json(config.PROCESSED_DIR / "availability.json", report)
    _write_markdown(report, config.PROCESSED_DIR / "availability.md")
    return report


def _write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = ["# FIRMS data availability", "", f"Checked at: {report['checked_at']}", ""]
    lines.append(f"Status: {report['status']}")
    lines.append("")
    for source in report["sources"]:
        lines.append(f"## {source['source_identifier']}")
        lines.append(f"- status: {source['status']}")
        if "first_available" in source:
            lines.append(f"- first_available: {source['first_available']}")
            lines.append(f"- last_available: {source['last_available']}")
            lines.append(f"- currently_available_within_7_days: {source['currently_available_within_7_days']}")
        if "reason" in source:
            lines.append(f"- reason: {source['reason']}")
        if "error" in source:
            lines.append(f"- error: {source['error']}")
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
