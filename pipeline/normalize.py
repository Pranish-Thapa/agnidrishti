"""Normalization of raw FIRMS CSV rows into a common record schema."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from . import config


def _float(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _int_or_none(value: str | None) -> int | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _str_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_time(value: str | None) -> str | None:
    if value is None:
        return None
    digits = "".join(ch for ch in value.strip() if ch.isdigit())
    if not digits:
        return None
    if len(digits) <= 2:
        digits = digits.zfill(4)
    elif len(digits) == 3:
        digits = "0" + digits
    elif len(digits) > 4:
        digits = digits[-4:]
    if len(digits) != 4:
        return None
    hour = int(digits[:2])
    minute = int(digits[2:])
    if hour > 23 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def _parse_date(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def normalize_file(path: Path, sensor_id: str) -> list[dict[str, Any]]:
    sensor = config.SENSORS[sensor_id]
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for index, raw in enumerate(reader, start=2):
            normalized = {str(key).strip().lower(): (value if value is not None else "") for key, value in raw.items() if key is not None}
            issues: list[str] = []

            latitude = _float(normalized.get("latitude"))
            longitude = _float(normalized.get("longitude"))
            if latitude is None or longitude is None:
                issues.append("missing_or_invalid_coordinate")
            else:
                if not (-90.0 <= latitude <= 90.0):
                    issues.append("latitude_out_of_range")
                if not (-180.0 <= longitude <= 180.0):
                    issues.append("longitude_out_of_range")

            acq_date = _parse_date(normalized.get("acq_date"))
            if acq_date is None:
                issues.append("missing_or_invalid_date")

            acq_time = _normalize_time(normalized.get("acq_time"))
            if acq_time is None:
                issues.append("missing_or_invalid_time")

            satellite_code = _str_or_none(normalized.get("satellite"))
            platform = sensor.satellite_codes.get(satellite_code or "", "unknown")
            if satellite_code is None:
                issues.append("missing_satellite_code")
            elif platform == "unknown":
                issues.append("unknown_satellite_code")

            if sensor.confidence_kind == "numeric":
                confidence = _int_or_none(normalized.get("confidence"))
            else:
                confidence = _str_or_none(normalized.get("confidence"))

            brightness: dict[str, float | None] = {}
            for field_name in sensor.brightness_fields:
                brightness[field_name] = _float(normalized.get(field_name))

            frp = _float(normalized.get("frp"))
            scan = _float(normalized.get("scan"))
            track = _float(normalized.get("track"))

            daynight = _str_or_none(normalized.get("daynight"))
            source = _str_or_none(normalized.get("source") or normalized.get("instrument"))
            version = _str_or_none(normalized.get("version"))

            record = {
                "sensor_id": sensor_id,
                "instrument": sensor.instrument,
                "platform": platform,
                "satellite_code": satellite_code,
                "latitude": latitude,
                "longitude": longitude,
                "acq_date": acq_date,
                "acq_time": acq_time,
                "confidence_kind": sensor.confidence_kind,
                "confidence": confidence,
                "brightness": brightness,
                "frp": frp,
                "daynight": daynight,
                "source": source,
                "version": version,
                "scan": scan,
                "track": track,
                "source_file": str(path),
                "raw_row_number": index,
                "issues": issues,
                "valid": not issues,
            }
            if acq_date and acq_time:
                record["acq_datetime"] = f"{acq_date}T{acq_time}:00Z"
            else:
                record["acq_datetime"] = None
            records.append(record)
    return records
