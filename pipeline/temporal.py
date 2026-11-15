"""Temporal aggregation into daily and ISO-weekly observations."""

from __future__ import annotations

from collections import defaultdict, Counter
from datetime import date, timedelta
from typing import Any

from . import config


def iso_week(date_str: str) -> tuple[int, int, str]:
    parsed = date.fromisoformat(date_str)
    iso_year, iso_week, _ = parsed.isocalendar()
    monday = parsed - timedelta(days=parsed.weekday())
    return iso_year, iso_week, monday.isoformat()


def _frp_from_cells(cells: list[dict[str, Any]]) -> dict[str, Any] | None:
    values: list[float] = []
    for cell in cells:
        frp = cell.get("frp")
        if frp:
            values.extend([frp["sum"]] if False else [])
    # Reconstruct from cell summaries instead.
    n = sum((cell.get("frp") or {}).get("n", 0) for cell in cells)
    if n == 0:
        return None
    total = sum((cell.get("frp") or {}).get("sum", 0.0) for cell in cells)
    minimum = min((cell.get("frp") or {}).get("min", 0.0) for cell in cells if cell.get("frp"))
    maximum = max((cell.get("frp") or {}).get("max", 0.0) for cell in cells if cell.get("frp"))
    return {
        "n": n,
        "sum": round(total, 4),
        "mean": round(total / n, 4),
        "min": round(minimum, 4),
        "max": round(maximum, 4),
    }


def build_daily(
    district_id: str,
    all_dates: list[str],
    sensor_coverage: dict[str, dict[str, Any]],
    cell_days: dict[tuple[str, str, str, str], list[dict[str, Any]]],
    *,
    region_dates: dict[str, set[str]] | None = None,
) -> list[dict[str, Any]]:
    """Build one observation day per date in ``all_dates``.

    ``region_dates`` scopes acquisition per study area: a date a region did not
    acquire is *missing* for that region even when another region acquired it.
    Without it (legacy callers/tests) the sensor-level date union is used.

    A platform is marked ``unavailable`` before its documented first date, so
    Terra-only years are never reported as Aqua zero-detection days.
    """

    days: list[dict[str, Any]] = []
    for date_str in sorted(all_dates):
        by_sensor: dict[str, Any] = {}
        reporting_platform_exists = False
        any_sensor_has_date = False
        for sensor_id, coverage in sensor_coverage.items():
            if region_dates is not None:
                acquired = region_dates.get(sensor_id) or set()
                if date_str not in acquired:
                    continue
            elif date_str not in (coverage.get("dates") or []):
                continue
            any_sensor_has_date = True
            platforms_out: dict[str, Any] = {}
            for platform, pinfo in (coverage.get("platforms") or {}).items():
                cells = cell_days.get((district_id, sensor_id, platform, date_str), [])
                detections = sum(cell.get("detections", 0) for cell in cells)
                occupied_cells = len(cells)
                cell_day_count = len(cells)  # one per cell per day
                frp = _frp_from_cells(cells)
                platform_reporting = bool(pinfo.get("reporting"))
                first_date = (config.PLATFORM_FIRST_DATE.get(sensor_id) or {}).get(platform)
                if first_date and date_str < first_date:
                    platform_status = "unavailable"
                    platform_reporting = False
                elif platform_reporting:
                    reporting_platform_exists = True
                    platform_status = "observed_zero" if detections == 0 else "observed"
                else:
                    platform_status = "unavailable"
                platforms_out[platform] = {
                    "status": platform_status,
                    "detections": detections if platform_reporting else None,
                    "cells": occupied_cells if platform_reporting else None,
                    "cell_days": cell_day_count if platform_reporting else None,
                    "frp": frp if platform_reporting else None,
                }
            if platforms_out:
                by_sensor[sensor_id] = {"platforms": platforms_out}

        if not any_sensor_has_date:
            status = "missing"
        elif reporting_platform_exists:
            # district-day observed if any platform has detections
            has_detection = False
            for sensor_block in by_sensor.values():
                for platform_block in (sensor_block.get("platforms") or {}).values():
                    if platform_block.get("detections"):
                        has_detection = True
            status = "observed" if has_detection else "observed_zero"
        else:
            status = "unavailable"

        days.append(
            {
                "date": date_str,
                "status": status,
                "by_sensor": by_sensor,
            }
        )
    return days


def build_weekly(days: list[dict[str, Any]], *, cell_days=None, district_id: str | None = None) -> list[dict[str, Any]]:
    # Group days by ISO week; aggregate per sensor/platform.
    weeks: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for day in days:
        iso_year, iso_week_num, week_start = iso_week(day["date"])
        weeks[(iso_year, iso_week_num)].append((week_start, day))

    result: list[dict[str, Any]] = []
    for (iso_year, iso_week_num), items in sorted(weeks.items()):
        week_start = items[0][0]
        week_days = [item[1] for item in items]
        # week status
        statuses = {day["status"] for day in week_days}
        if "missing" in statuses or "unavailable" in statuses:
            if all(s in ("observed", "observed_zero") for s in statuses):
                week_status = "observed"
            elif any(s in ("missing", "unavailable") for s in statuses):
                # partial coverage
                if any(s in ("observed", "observed_zero") for s in statuses):
                    week_status = "incomplete"
                else:
                    week_status = "unavailable" if all(s == "unavailable" for s in statuses) else "missing"
            else:
                week_status = "observed"
        elif "incomplete" in statuses:
            week_status = "incomplete"
        else:
            week_status = "observed"

        # If not all 7 days present, incomplete (unless unavailable).
        if len(week_days) < 7 and week_status == "observed":
            week_status = "incomplete"

        # Aggregate per sensor/platform
        by_sensor: dict[str, Any] = {}
        sensors_seen: set[str] = set()
        for day in week_days:
            for sensor_id, block in (day.get("by_sensor") or {}).items():
                sensors_seen.add(sensor_id)
        for sensor_id in sensors_seen:
            platforms_out: dict[str, Any] = {}
            platforms_seen: set[str] = set()
            for day in week_days:
                block = (day.get("by_sensor") or {}).get(sensor_id)
                if not block:
                    continue
                for platform in (block.get("platforms") or {}):
                    platforms_seen.add(platform)
            platform_occupied: dict[str, set[str]] = {p: set() for p in platforms_seen}
            if cell_days and district_id:
                for day in week_days:
                    for platform in platforms_seen:
                        cells = (cell_days or {}).get((district_id, sensor_id, platform, day["date"]), [])
                        for cell in cells:
                            platform_occupied[platform].add(cell["cell_id"])

            for platform in platforms_seen:
                detections = 0
                cell_days_count = 0
                frp_n = 0
                frp_sum = 0.0
                frp_min = None
                frp_max = None
                platform_days = 0
                platform_reporting = False
                for day in week_days:
                    block = (day.get("by_sensor") or {}).get(sensor_id)
                    if not block:
                        continue
                    pblock = (block.get("platforms") or {}).get(platform)
                    if not pblock:
                        continue
                    if pblock.get("status") == "unavailable":
                        continue
                    platform_reporting = True
                    platform_days += 1
                    dets = pblock.get("detections") or 0
                    detections += dets
                    cell_days_count += pblock.get("cell_days") or 0
                    frp = pblock.get("frp")
                    if frp:
                        frp_n += frp.get("n", 0)
                        frp_sum += frp.get("sum", 0.0)
                        if frp_min is None or frp.get("min", 0) < frp_min:
                            frp_min = frp.get("min")
                        if frp_max is None or frp.get("max", 0) > frp_max:
                            frp_max = frp.get("max")
                if platform_reporting:
                    frp_summary = None
                    if frp_n > 0:
                        frp_summary = {
                            "n": frp_n,
                            "sum": round(frp_sum, 4),
                            "mean": round(frp_sum / frp_n, 4),
                            "min": round(frp_min, 4) if frp_min is not None else None,
                            "max": round(frp_max, 4) if frp_max is not None else None,
                        }
                    platforms_out[platform] = {
                        "status": "observed" if detections > 0 else "observed_zero",
                        "detections": detections,
                        "cells": None,
                        "cell_days": cell_days_count,
                        "occupied_cells": len(platform_occupied.get(platform, ())),
                        "frp": frp_summary,
                        "days_observed": platform_days,
                    }
            if platforms_out:
                by_sensor[sensor_id] = {"platforms": platforms_out}

        # occupied cells per week = distinct cells? We only have counts. Set occupied_cells
        # by counting distinct cell ids across the week. Not available here; leave as cell_days proxy.
        # Recompute occupied cells properly below is not possible without cell ids. Keep cell_days.

        result.append(
            {
                "iso_year": iso_year,
                "iso_week": iso_week_num,
                "week_start": week_start,
                "week_end": (date.fromisoformat(week_start) + timedelta(days=6)).isoformat(),
                "days_in_week": len(week_days),
                "status": week_status,
                "by_sensor": by_sensor,
            }
        )
    return result
