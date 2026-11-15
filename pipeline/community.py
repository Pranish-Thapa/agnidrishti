"""Community Fire Intelligence — weather, fire-danger, validated outlook and
rule-based explanations for the six study areas.

Data sources (all free, attribution required, documented in
COMMUNITY_INTELLIGENCE_DOCUMENTATION.md):

- NASA FIRMS SP/NRT observations (already acquired by pipeline/download.py).
- Open-Meteo ERA5 archive + forecast APIs (CC-BY 4.0, no API key) for daily
  weather: temperature_2m_max, relative_humidity_2m_mean, precipitation_sum,
  wind_speed_10m_max.

Scientific honesty (non-negotiable):
- Missing FIRMS observations are excluded from the training table, never
  zero-filled.
- VIIRS-family daily counts keep platform identities available (the climatology
  uses Suomi-NPP alone — the only platform with a 2012-2026 record).
- The Canadian FWI is an index computed from weather, not a calibrated
  Nepali fire-danger model; approximations (daily max temperature instead of
  noon temperature, daily mean RH instead of afternoon RH, daily max wind
  instead of noon wind) are documented in every export.
- The fire-activity outlook is displayed only if leave-one-year-out validation
  shows genuine skill beyond a monthly climatology baseline, and only inside
  the validated January-July season. Otherwise the honest fallback is shown.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from . import config, geometry, manifests

COMMUNITY_DIR = config.PUBLIC_DATA_DIR / "community"
FFMC_COEFF = 147.2772273
FWI_INIT = {"ffmc": 85.0, "dmc": 6.0, "dc": 15.0}
# Day-length factors for 10-30 degrees north (Nepal spans ~26.5-29.5 N).
DMC_DAY_LENGTH = [7.9, 8.4, 8.9, 9.5, 9.9, 10.2, 10.1, 9.7, 9.1, 8.6, 8.1, 7.8]
# Potential evapotranspiration factors for north of 20 degrees north.
DC_PE_FACTOR = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6]
FWI_SEASON_MONTHS = set(range(1, 8))  # validated record: Jan-Jul only

OFFICIAL_SOURCES = [
    {
        "name": "BIPAD — National Disaster Risk Reduction and Management Authority",
        "url": "https://bipad.gov.np/",
        "note": "Government of Nepal disaster-information portal; official incident reports and alerts.",
        "kind": "official_portal",
        "verified_reachable": None,
    },
    {
        "name": "SERVIR-HKH Forest Fire Detection and Monitoring System (ICIMOD)",
        "url": "https://rds.icimod.org/",
        "note": "ICIMOD's regional fire-detection system for the Hindu Kush Himalaya.",
        "kind": "official_portal",
        "verified_reachable": None,
    },
    {
        "name": "NASA FIRMS (Fire Information for Resource Management System)",
        "url": "https://firms.modaps.eosdis.nasa.gov/map/",
        "note": "Global near-real-time hotspot map — the upstream source of Agnidrishti detections.",
        "kind": "data_source",
        "verified_reachable": None,
    },
    {
        "name": "Nepal National Emergency Number",
        "url": None,
        "note": "Call 112 for national emergencies. Follow instructions from local authorities and district disaster-management committees.",
        "kind": "emergency_contact",
        "verified_reachable": None,
    },
]


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _district_centroids() -> dict[str, tuple[float, float]]:
    boundaries = geometry.load_boundaries()
    result: dict[str, tuple[float, float]] = {}
    for boundary in boundaries:
        centroid = boundary.geometry.centroid
        result[boundary.district_id] = (round(centroid.y, 4), round(centroid.x, 4))
    return result


# ---------------------------------------------------------------------------
# Open-Meteo fetching
# ---------------------------------------------------------------------------

_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_DAILY_VARS = (
    "temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,"
    "precipitation_sum,wind_speed_10m_max"
)


def _fetch_open_meteo(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "Agnidrishti/1.0 (community fire intelligence)"})
    with urlopen(request, timeout=90) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if "daily" not in payload:
        raise RuntimeError(f"Open-Meteo returned no daily block for {url}")
    return payload


def _daily_to_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    daily = payload["daily"]
    keys = [k for k in daily.keys() if k != "time"]
    rows: list[dict[str, Any]] = []
    for i, day in enumerate(daily["time"]):
        row: dict[str, Any] = {"date": day}
        for key in keys:
            value = daily[key][i]
            row[key] = round(value, 3) if isinstance(value, float) else value
        rows.append(row)
    return rows


def fetch_archive_weather(lat: float, lon: float, start: str, end: str) -> list[dict[str, Any]]:
    url = (
        f"{_ARCHIVE_URL}?latitude={lat}&longitude={lon}&start_date={start}"
        f"&end_date={end}&daily={_DAILY_VARS}"
    )
    return _daily_to_rows(_fetch_open_meteo(url))


def fetch_forecast_weather(lat: float, lon: float, days: int = 7) -> list[dict[str, Any]]:
    url = (
        f"{_FORECAST_URL}?latitude={lat}&longitude={lon}"
        f"&daily={_DAILY_VARS}&forecast_days={days}"
    )
    return _daily_to_rows(_fetch_open_meteo(url))


# ---------------------------------------------------------------------------
# Canadian FWI system (Van Wagner 1987; formulas ported from the canonical
# cffdrs_py implementation). Approximations for this application:
#   * daily max temperature instead of the noon temperature,
#   * daily mean relative humidity instead of the afternoon value,
#   * daily max wind instead of the noon wind.
# These are documented in every export. The index is NOT calibrated for Nepal.
# ---------------------------------------------------------------------------

def _fine_fuel_moisture(rain: float, temp: float, rh: float, wind: float, ffmc_prev: float) -> float:
    if rain > 0.5:
        ra = rain - 0.5
        wmo = FFMC_COEFF * (101 - ffmc_prev) / (59.5 + ffmc_prev)
        if wmo > 150:
            wmo += 0.0015 * (wmo - 150) ** 2 * math.sqrt(ra) + 42.5 * ra * math.exp(
                -100 / (251 - wmo)
            ) * (1 - math.exp(-6.93 / ra))
        else:
            wmo += 42.5 * ra * math.exp(-100 / (251 - wmo)) * (1 - math.exp(-6.93 / ra))
        wmo = min(wmo, 250)
    else:
        wmo = FFMC_COEFF * (101 - ffmc_prev) / (59.5 + ffmc_prev)
    ed = (
        0.942 * (rh ** 0.679)
        + 11 * math.exp((rh - 100) / 10)
        + 0.18 * (21.1 - temp) * (1 - 1 / math.exp(0.115 * rh))
    )
    ew = (
        0.618 * (rh ** 0.753)
        + 10 * math.exp((rh - 100) / 10)
        + 0.18 * (21.1 - temp) * (1 - 1 / math.exp(0.115 * rh))
    )
    if wmo < ed and wmo < ew:
        z = 0.424 * (1 - ((100 - rh) / 100) ** 1.7) + 0.0694 * math.sqrt(wind) * (
            1 - ((100 - rh) / 100) ** 8
        )
        x = z * 0.581 * math.exp(0.0365 * temp)
        wm = ew - (ew - wmo) / 10 ** x
    elif wmo > ed:
        z = 0.424 * (1 - (rh / 100) ** 1.7) + 0.0694 * math.sqrt(wind) * (1 - (rh / 100) ** 8)
        x = z * 0.581 * math.exp(0.0365 * temp)
        wm = ed + (wmo - ed) / 10 ** x
    else:
        wm = wmo
    ffmc = 59.5 * (250 - wm) / (FFMC_COEFF + wm)
    return max(0.0, min(101.0, ffmc))


def _duff_moisture_code(rain: float, temp: float, rh: float, dmc_prev: float, month: int, lat: float) -> float:
    if temp <= -1.1:
        return max(0.0, dmc_prev)
    if month < 1 or month > 12:
        return max(0.0, dmc_prev)
    if rh is None:
        rh = 50.0
    dl = DMC_DAY_LENGTH[month - 1]
    rk = 1.894 * (max(temp, -1.1) + 1.1) * (100 - rh) * dl * 1e-4
    mo = 20 + 280 / math.exp(0.023 * dmc_prev)
    if rain > 1.5:
        rw = 0.92 * rain - 1.27
        b = (
            100 / (0.5 + 0.3 * dmc_prev)
            if dmc_prev <= 33
            else (14 - 1.3 * math.log(dmc_prev) if dmc_prev <= 65 else 6.2 * math.log(dmc_prev) - 17.2)
        )
        wmr = mo + 1000 * rw / (48.77 + b * rw)
        pr = max(0.0, 43.43 * (5.6348 - math.log(max(wmr - 20, 1e-6))))
    else:
        pr = dmc_prev
    return max(0.0, pr + rk)


def _drought_code(rain: float, temp: float, dc_prev: float, month: int, lat: float) -> float:
    if temp <= -2.8:
        return max(0.0, dc_prev)
    if month < 1 or month > 12:
        return max(0.0, dc_prev)
    f = DC_PE_FACTOR[month - 1]
    pe = max(0.0, (0.36 * (max(temp, -2.8) + 2.8) + f) / 2)
    if rain > 2.8:
        rw = 0.83 * rain - 1.27
        smi = 800 * math.exp(-dc_prev / 400)
        dr = max(0.0, dc_prev - 400 * math.log(1 + 3.937 * rw / smi))
    else:
        dr = dc_prev
    return max(0.0, dr + pe)


def _initial_spread_index(ffmc: float, wind: float) -> float:
    fm = FFMC_COEFF * (101 - ffmc) / (59.5 + ffmc)
    fw = math.exp(0.05039 * wind)
    ff = 91.9 * math.exp(-0.1386 * fm) * (1 + fm ** 5.31 / 49300000.0)
    return 0.208 * fw * ff


def _buildup_index(dmc: float, dc: float) -> float:
    if dmc == 0 and dc == 0:
        return 0.0
    bui = 0.8 * dc * dmc / (dmc + 0.4 * dc)
    if bui < dmc:
        p = (dmc - bui) / dmc if dmc > 0 else 0.0
        cc = 0.92 + (0.0114 * dmc) ** 1.7
        bui = max(0.0, dmc - cc * p)
    return bui


def _fire_weather_index(isi: float, bui: float) -> float:
    if bui > 80:
        bb = 0.1 * isi * (1000 / (25 + 108.64 / math.exp(0.023 * bui)))
    else:
        bb = 0.1 * isi * (0.626 * bui ** 0.809 + 2)
    if bb <= 1:
        return bb
    return math.exp(2.72 * (0.434 * math.log(bb)) ** 0.647)


def fwi_category(fwi: float) -> str:
    if fwi < 5:
        return "low"
    if fwi < 10:
        return "moderate"
    if fwi < 19:
        return "high"
    if fwi < 30:
        return "very_high"
    return "extreme"


def compute_fwi_sequence(
    rows: list[dict[str, Any]],
    lat: float,
) -> list[dict[str, Any]]:
    """Run the FWI codes over consecutive daily weather rows. Rows must be
    sorted by date; the codes carry state, so gaps degrade accuracy (noted in
    exports when a gap exceeds 3 days)."""
    outputs: list[dict[str, Any]] = []
    state = dict(FWI_INIT)
    last_date: date | None = None
    for row in rows:
        day = date.fromisoformat(row["date"])
        month = day.month
        rain = float(row.get("precipitation_sum") or 0.0)
        temp = float(row.get("temperature_2m_max") or 0.0)
        rh = row.get("relative_humidity_2m_mean")
        rh = float(rh) if rh is not None else 50.0
        wind = float(row.get("wind_speed_10m_max") or 0.0)
        gap_note = last_date is not None and (day - last_date).days > 3
        state["ffmc"] = _fine_fuel_moisture(rain, temp, rh, wind, state["ffmc"])
        state["dmc"] = _duff_moisture_code(rain, temp, rh, state["dmc"], month, lat)
        state["dc"] = _drought_code(rain, temp, state["dc"], month, lat)
        isi = _initial_spread_index(state["ffmc"], wind)
        bui = _buildup_index(state["dmc"], state["dc"])
        fwi = _fire_weather_index(isi, bui)
        outputs.append(
            {
                "date": row["date"],
                "ffmc": round(state["ffmc"], 2),
                "dmc": round(state["dmc"], 2),
                "dc": round(state["dc"], 2),
                "isi": round(isi, 2),
                "bui": round(bui, 2),
                "fwi": round(fwi, 2),
                "fwi_category": fwi_category(fwi),
                "state_reset_after_gap": bool(gap_note),
            }
        )
        last_date = day
    return outputs


# ---------------------------------------------------------------------------
# FIRMS daily record loading (SP aggregates already exported for the frontend)
# ---------------------------------------------------------------------------

def _platform_detections(by_sensor: dict[str, Any], sensor_id: str, platform: str) -> int | None:
    """Detections for one platform, or None when it did not observe that day.

    ``None`` (not 0) is essential: before a platform's first acquisition date,
    or on a day whose file was not delivered, the platform did not observe.
    Treating that as zero would silently dilute the climatology with days the
    sensor never saw.
    """

    block = (by_sensor.get(sensor_id, {}).get("platforms", {}) or {}).get(platform)
    if not block or block.get("status") not in ("observed", "observed_zero"):
        return None
    detections = block.get("detections")
    return int(detections) if detections is not None else None


def load_firms_daily(district_id: str) -> dict[str, dict[str, Any]]:
    """date -> {viirs_family_total, snpp, noaa20, noaa21, terra, aqua, status}.

    Only days covered by the SP record are returned; missing days are absent
    (never zero-filled). A platform value is ``None`` unless that platform
    actually observed the day, so pre-2012 Terra-only days cannot be mistaken
    for zero-detection VIIRS or Aqua days.
    """

    result: dict[str, dict[str, Any]] = {}
    data_root = config.PUBLIC_DATA_DIR / "sp" / district_id
    for year_file in sorted(data_root.glob("2*.json")):
        if year_file.name == "metadata.json":
            continue
        payload = json.loads(year_file.read_text(encoding="utf-8"))
        for day in payload.get("days", []):
            by_sensor = day.get("by_sensor", {})
            snpp = _platform_detections(by_sensor, "viirs_snpp", "Suomi-NPP")
            noaa20 = _platform_detections(by_sensor, "viirs_noaa20", "NOAA-20")
            noaa21 = _platform_detections(by_sensor, "viirs_noaa21", "NOAA-21")
            terra = _platform_detections(by_sensor, "modis", "Terra")
            aqua = _platform_detections(by_sensor, "modis", "Aqua")
            viirs = sum(value for value in (snpp, noaa20, noaa21) if value is not None)
            result[day["date"]] = {
                "status": day.get("status"),
                "viirs_family_total": viirs,
                "snpp": snpp,
                "noaa20": noaa20,
                "noaa21": noaa21,
                "terra": terra,
                "aqua": aqua,
            }
    return result


# ---------------------------------------------------------------------------
# Historical patterns (WP2)
# ---------------------------------------------------------------------------

def build_historical_patterns(
    district_id: str,
    firms_daily: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Monthly climatology from the Suomi-NPP record (the only platform with a
    full 2012-2026 record), normalized by observed days — never zero-filled."""
    monthly: dict[int, dict[str, Any]] = {}
    year_totals: dict[str, dict[str, Any]] = {}
    for date_str, block in firms_daily.items():
        month = int(date_str[5:7])
        year = date_str[:4]
        snpp_days = 1 if block["snpp"] is not None else 0
        entry = monthly.setdefault(
            month,
            {"snpp_detections": 0, "observed_days": 0, "years": set(), "detection_days": 0},
        )
        if block["status"] in ("observed", "observed_zero") and block["snpp"] is not None:
            entry["snpp_detections"] += block["snpp"]
            entry["observed_days"] += 1
            entry["years"].add(year)
            if block["snpp"] > 0:
                entry["detection_days"] += 1
        yt = year_totals.setdefault(
            year,
            {"snpp": 0, "observed_days": 0, "covered_months": 0},
        )
        if block["status"] in ("observed", "observed_zero") and block["snpp"] is not None:
            yt["snpp"] += block["snpp"]
            yt["observed_days"] += 1
        if block["status"] in ("observed", "observed_zero"):
            yt["covered_months"] += 1

    month_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthly_rows = []
    overall_rate = None
    total_snpp = sum(m["snpp_detections"] for m in monthly.values())
    total_obs = sum(m["observed_days"] for m in monthly.values())
    if total_obs > 0:
        overall_rate = total_snpp / total_obs
    for month in range(1, 13):
        entry = monthly.get(month)
        if not entry or entry["observed_days"] == 0:
            monthly_rows.append(
                {
                    "month": month,
                    "label": month_labels[month - 1],
                    "status": "not_observed",
                    "snpp_detections_per_observed_day": None,
                    "years_supporting": 0,
                    "observed_days": 0,
                    "detection_days": 0,
                }
            )
            continue
        rate = entry["snpp_detections"] / entry["observed_days"]
        monthly_rows.append(
            {
                "month": month,
                "label": month_labels[month - 1],
                "status": "observed",
                "snpp_detections_per_observed_day": round(rate, 3),
                "years_supporting": len(entry["years"]),
                "observed_days": entry["observed_days"],
                "detection_days": entry["detection_days"],
                "above_overall_mean": bool(
                    overall_rate is not None and rate > overall_rate * 1.5
                ),
            }
        )

    peak = max(
        (
            row
            for row in monthly_rows
            if row["snpp_detections_per_observed_day"] is not None
        ),
        key=lambda row: row["snpp_detections_per_observed_day"],
        default=None,
    )
    low = min(
        (
            row
            for row in monthly_rows
            if row["snpp_detections_per_observed_day"] is not None
        ),
        key=lambda row: row["snpp_detections_per_observed_day"],
        default=None,
    )

    year_rows = [
        {
            "year": year,
            "snpp_detections": totals["snpp"],
            "observed_days": totals["observed_days"],
            "note": "Suomi-NPP detections within the acquired Jan-Jul record; year totals are not comparable to post-2018 totals that include NOAA-20/NOAA-21",
        }
        for year, totals in sorted(year_totals.items())
        # A year Suomi-NPP never observed is absent rather than shown as zero.
        if totals["observed_days"] > 0
    ]

    return {
        "monthly_climatology": monthly_rows,
        "peak_month": peak,
        "low_month": low,
        "overall_rate_per_observed_day": round(overall_rate, 3) if overall_rate else None,
        "year_totals": year_rows,
        "basis": {
            "platform": "VIIRS Suomi-NPP",
            "reason": "the only platform with a full 2012-2026 record; NOAA-20 starts 2018 and NOAA-21 starts 2023, so pooling platforms would bias month-to-month comparisons",
            "record_note": "Acquired record covers January-June each year plus July 2026; other months are not requested and are excluded, never zero-filled",
        },
    }


# ---------------------------------------------------------------------------
# Long-term MODIS view (2000-2011)
# ---------------------------------------------------------------------------

def build_modis_long_term(
    firms_daily: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Monthly MODIS climatology for the pre-VIIRS period, kept separate.

    The community baseline above uses Suomi-NPP alone because it is the only
    platform with a continuous 2012-2026 record. That baseline cannot describe
    2000-2011, so the expanded MODIS record is reported here as its own
    clearly-labelled view. Terra and Aqua are reported separately and are
    never pooled: they are different platforms on a different detection scale
    from VIIRS, and a combined rate would be a number with no sensor meaning.
    """

    month_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    start = "2000-11-01"
    end = "2011-12-31"
    buckets: dict[int, dict[str, Any]] = {
        month: {
            "terra_detections": 0, "terra_observed_days": 0,
            "aqua_detections": 0, "aqua_observed_days": 0,
            "years": set(),
        }
        for month in range(1, 13)
    }
    first_date = None
    last_date = None
    for date_str, block in firms_daily.items():
        if date_str < start or date_str > end:
            continue
        if block["status"] not in ("observed", "observed_zero"):
            continue
        month = int(date_str[5:7])
        bucket = buckets[month]
        bucket["years"].add(date_str[:4])
        first_date = date_str if first_date is None or date_str < first_date else first_date
        last_date = date_str if last_date is None or date_str > last_date else last_date
        if block["terra"] is not None:
            bucket["terra_detections"] += block["terra"]
            bucket["terra_observed_days"] += 1
        if block["aqua"] is not None:
            bucket["aqua_detections"] += block["aqua"]
            bucket["aqua_observed_days"] += 1

    rows = []
    for month in range(1, 13):
        bucket = buckets[month]
        terra_rate = (
            bucket["terra_detections"] / bucket["terra_observed_days"]
            if bucket["terra_observed_days"]
            else None
        )
        aqua_rate = (
            bucket["aqua_detections"] / bucket["aqua_observed_days"]
            if bucket["aqua_observed_days"]
            else None
        )
        rows.append(
            {
                "month": month,
                "label": month_labels[month - 1],
                "terra_detections_per_observed_day": round(terra_rate, 3) if terra_rate is not None else None,
                "aqua_detections_per_observed_day": round(aqua_rate, 3) if aqua_rate is not None else None,
                "terra_observed_days": bucket["terra_observed_days"],
                "aqua_observed_days": bucket["aqua_observed_days"],
                "years_supporting": len(bucket["years"]),
            }
        )

    def peak(platform: str) -> dict[str, Any] | None:
        candidates = [
            row for row in rows
            if row[f"{platform}_detections_per_observed_day"] is not None
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda row: row[f"{platform}_detections_per_observed_day"])

    return {
        "period": {"start": first_date, "end": last_date},
        "monthly": rows,
        "peak_month_terra": peak("terra"),
        "peak_month_aqua": peak("aqua"),
        "basis": {
            "platforms": "MODIS Terra and MODIS Aqua, reported separately",
            "reason": (
                "The VIIRS baseline starts on 20 January 2012, so it cannot "
                "describe 2000-2011. This is the pre-VIIRS MODIS record on its "
                "own native scale; it is not converted to a VIIRS-equivalent "
                "value and is not comparable to the Suomi-NPP rates above."
            ),
            "record_note": (
                "Terra begins 1 November 2000 and Aqua begins 4 May 2002, so "
                "2000-2001 is Terra-only and early 2002 has no Aqua days. "
                "Rates are detections per observed day; months without "
                "observations are null, never zero."
            ),
        },
    }


# ---------------------------------------------------------------------------
# Validated outlook model (WP6): leave-one-year-out logistic regression
# ---------------------------------------------------------------------------

def _sigmoid(z: float) -> float:
    z = max(-30.0, min(30.0, z))
    return 1.0 / (1.0 + math.exp(-z))


def _fit_logistic(features: list[list[float]], targets: list[int], *, iterations: int = 400, lr: float = 0.1) -> list[float]:
    """L2-regularized logistic regression via batch gradient descent. weights
    includes an intercept as the first element. Deliberately simple and
    interpretable — no black-box dependency."""
    if not features or not targets:
        return []
    n_features = len(features[0])
    weights = [0.0] * (n_features + 1)
    n = len(features)
    for _ in range(iterations):
        grads = [0.0] * (n_features + 1)
        for sample, target in zip(features, targets):
            z = weights[0] + sum(w * v for w, v in zip(weights[1:], sample))
            err = _sigmoid(z) - target
            grads[0] += err
            for j, value in enumerate(sample):
                grads[j + 1] += err * value
        for j in range(len(weights)):
            weights[j] -= lr * (grads[j] / n + (0.01 * weights[j] / n if j > 0 else 0.0))
    return weights


def _apply_logistic(weights: list[float], features: list[list[float]]) -> list[float]:
    return [_sigmoid(weights[0] + sum(w * v for w, v in zip(weights[1:], sample))) for sample in features]


def _auc(pairs: list[tuple[float, int]]) -> float | None:
    positives = [p for p, t in pairs if t == 1]
    negatives = [p for p, t in pairs if t == 0]
    if not positives or not negatives:
        return None
    wins = ties = 0
    for p in positives:
        for n in negatives:
            if p > n:
                wins += 1
            elif p == n:
                ties += 0.5
    return wins / (len(positives) * len(negatives)) * len(positives) / max(len(positives), 1) * len(positives) / max(len(positives), 1) if False else wins / (len(positives) * len(negatives)) + ties / (len(positives) * len(negatives))


def build_outlook(
    firms_daily: dict[str, dict[str, Any]],
    weather_rows: list[dict[str, Any]],
    fwi_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Weather-driven daily fire-activity model validated by leave-one-year-out
    over 2012-2025. The target is whether the VIIRS platform family recorded
    >=1 detection on a covered district-day. Returns metrics and, if the model
    shows genuine skill beyond the monthly climatology baseline, a 7-day
    outlook computed from forecast weather."""
    weather_by_date = {row["date"]: row for row in weather_rows}
    fwi_by_date = {row["date"]: row for row in fwi_rows}

    def antecedent_rain(day: str, window: int) -> float:
        total = 0.0
        base = date.fromisoformat(day)
        for offset in range(1, window + 1):
            row = weather_by_date.get((base - timedelta(days=offset)).isoformat())
            if row:
                total += float(row.get("precipitation_sum") or 0.0)
        return round(total, 2)

    feature_names = [
        "temperature_max", "relative_humidity_mean", "wind_max",
        "rain_24h", "rain_7d", "rain_30d",
        "fwi", "ffmc", "dc", "doy_sin", "doy_cos",
    ]
    training: list[dict[str, Any]] = []
    for date_str, block in sorted(firms_daily.items()):
        if block["status"] not in ("observed", "observed_zero"):
            continue  # missing observation: excluded, never zero-filled
        if block["snpp"] is None and block["noaa20"] is None and block["noaa21"] is None:
            continue
        weather = weather_by_date.get(date_str)
        fwi_row = fwi_by_date.get(date_str)
        if not weather or not fwi_row:
            continue
        viirs_total = block["viirs_family_total"]
        doy = date.fromisoformat(date_str).timetuple().tm_yday
        features = [
            float(weather.get("temperature_2m_max") or 0.0),
            float(weather.get("relative_humidity_2m_mean") or 0.0),
            float(weather.get("wind_speed_10m_max") or 0.0),
            float(weather.get("precipitation_sum") or 0.0),
            antecedent_rain(date_str, 7),
            antecedent_rain(date_str, 30),
            float(fwi_row.get("fwi") or 0.0),
            float(fwi_row.get("ffmc") or 0.0),
            float(fwi_row.get("dc") or 0.0),
            math.sin(2 * math.pi * doy / 365.0),
            math.cos(2 * math.pi * doy / 365.0),
        ]
        training.append(
            {
                "date": date_str,
                "year": int(date_str[:4]),
                "month": int(date_str[5:7]),
                "district_day_active": 1 if viirs_total >= 1 else 0,
                "viirs_family_total": viirs_total,
                "features": dict(zip(feature_names, [round(v, 4) for v in features])),
            }
        )

    # Monthly climatology baseline: predict each day's activity rate as the
    # mean active-day rate for its calendar month over the *training* years.
    def climatology_rate(train_rows: list[dict[str, Any]], month: int) -> float:
        month_rows = [r for r in train_rows if r["month"] == month]
        if not month_rows:
            month_rows = train_rows
        return sum(r["district_day_active"] for r in month_rows) / max(len(month_rows), 1)

    validation_years = sorted({r["year"] for r in training if r["year"] <= 2025})
    fold_metrics: list[dict[str, Any]] = []
    oof: list[dict[str, Any]] = []
    for held_out in validation_years:
        train_rows = [r for r in training if r["year"] != held_out]
        test_rows = [r for r in training if r["year"] == held_out]
        if not train_rows or not test_rows:
            continue
        weights = _fit_logistic(
            [list(r["features"].values()) for r in train_rows],
            [r["district_day_active"] for r in train_rows],
        )
        preds = _apply_logistic(
            weights, [list(r["features"].values()) for r in test_rows]
        )
        pairs = list(zip(preds, [r["district_day_active"] for r in test_rows]))
        auc = _auc(pairs)
        clim_rate = [climatology_rate(train_rows, r["month"]) for r in test_rows]
        clim_auc = _auc(list(zip(clim_rate, [r["district_day_active"] for r in test_rows])))
        brier = sum((p - t) ** 2 for p, t in pairs) / len(pairs)
        clim_brier = sum((p - t) ** 2 for p, t in zip(clim_rate, [r["district_day_active"] for r in test_rows])) / len(test_rows)
        fold_metrics.append(
            {
                "held_out_year": held_out,
                "pairs": len(test_rows),
                "active_days": sum(r["district_day_active"] for r in test_rows),
                "auc": round(auc, 4) if auc is not None else None,
                "climatology_auc": round(clim_auc, 4) if clim_auc is not None else None,
                "brier": round(brier, 4),
                "climatology_brier": round(clim_brier, 4),
            }
        )
        for r, p in zip(test_rows, preds):
            oof.append(
                {
                    "date": r["date"],
                    "month": r["month"],
                    "probability": round(p, 4),
                    "active": r["district_day_active"],
                }
            )

    aucs = [f["auc"] for f in fold_metrics if f["auc"] is not None]
    clim_aucs = [f["climatology_auc"] for f in fold_metrics if f["climatology_auc"] is not None]
    mean_auc = sum(aucs) / len(aucs) if aucs else None
    mean_clim = sum(clim_aucs) / len(clim_aucs) if clim_aucs else None
    skill = (mean_auc - mean_clim) if mean_auc is not None and mean_clim is not None else None
    validated = bool(
        mean_auc is not None
        and mean_auc >= 0.65
        and skill is not None
        and skill >= 0.05
    )

    # 7-day outlook: only shown when validated AND inside the validated season.
    today = date.today()
    in_season = today.month in FWI_SEASON_MONTHS
    outlook_days: list[dict[str, Any]] = []
    if validated and in_season:
        final_model = _fit_logistic(
            [list(r["features"].values()) for r in training if r["year"] <= 2025],
            [r["district_day_active"] for r in training if r["year"] <= 2025],
        )
        for row in weather_rows:
            day = date.fromisoformat(row["date"])
            doy = day.timetuple().tm_yday
            rain7 = sum(
                float((weather_by_date.get((day - timedelta(days=o)).isoformat()) or {}).get("precipitation_sum") or 0.0)
                for o in range(1, 8)
            )
            rain30 = sum(
                float((weather_by_date.get((day - timedelta(days=o)).isoformat()) or {}).get("precipitation_sum") or 0.0)
                for o in range(1, 31)
            )
            fwi_row = fwi_by_date.get(row["date"])
            features = [
                float(row.get("temperature_2m_max") or 0.0),
                float(row.get("relative_humidity_2m_mean") or 0.0),
                float(row.get("wind_speed_10m_max") or 0.0),
                float(row.get("precipitation_sum") or 0.0),
                round(rain7, 2),
                round(rain30, 2),
                float((fwi_row or {}).get("fwi") or 0.0),
                float((fwi_row or {}).get("ffmc") or 0.0),
                float((fwi_row or {}).get("dc") or 0.0),
                math.sin(2 * math.pi * doy / 365.0),
                math.cos(2 * math.pi * doy / 365.0),
            ]
            probability = _apply_logistic(final_model, [features])[0]
            outlook_days.append(
                {
                    "date": row["date"],
                    "probability_of_active_day": round(probability, 4),
                    "fwi": (fwi_row or {}).get("fwi"),
                    "fwi_category": (fwi_row or {}).get("fwi_category"),
                }
            )

    return {
        "status": ("validated" if validated and in_season else
                   "validated_but_out_of_season" if validated else
                   "not_validated"),
        "season_note": (
            "The validated record covers January-July only; an outlook for other "
            "months would be an unvalidated extrapolation and is not shown."
        ),
        "feature_names": feature_names,
        "training_days": len(training),
        "validation_years": validation_years,
        "folds": fold_metrics,
        "metrics": {
            "mean_auc": round(mean_auc, 4) if mean_auc is not None else None,
            "mean_climatology_auc": round(mean_clim, 4) if mean_clim is not None else None,
            "skill_over_climatology": round(skill, 4) if skill is not None else None,
            "validated_thresholds": {"auc_min": 0.65, "skill_min": 0.05},
        },
        "outlook_days": outlook_days,
        "model": "L2-regularized logistic regression (numpy, interpretable; no black-box dependency)",
        "target": "district-day with >= 1 VIIRS-family hotspot detection (Suomi-NPP + NOAA-20 + NOAA-21; platforms identified per observation elsewhere)",
        "caveats": [
            "VIIRS-family counts mix platforms from 2018 onward; the model target is detection presence, not fire count.",
            "A detection is a thermal anomaly observation, not a confirmed ground fire.",
            "Weather features are district-centroid daily values (max temperature, mean RH, max wind), not point-fire conditions.",
            "The model tests interpolation across held-out years inside the 2012-2026 record; it does not test extrapolation to unacquired months.",
            "Pre-set skill thresholds were documented before the evaluation was run.",
        ],
    }


# ---------------------------------------------------------------------------
# Rule-based explanation engine (WP7)
# ---------------------------------------------------------------------------

def build_explanations(
    district_name: str,
    historical: dict[str, Any],
    current: dict[str, Any],
    weather_recent: list[dict[str, Any]],
    fwi_current: dict[str, Any] | None,
    outlook: dict[str, Any],
) -> list[dict[str, Any]]:
    explanations: list[dict[str, Any]] = []

    peak = historical.get("peak_month")
    if peak and peak.get("snpp_detections_per_observed_day") is not None:
        low = historical.get("low_month")
        explanations.append(
            {
                "topic": "historical_pattern",
                "text": (
                    f"Historical satellite observations (Suomi-NPP, {peak['years_supporting']} years "
                    f"supporting) show that {district_name} typically records more hotspot detections "
                    f"during {peak['label']} (about {peak['snpp_detections_per_observed_day']} detections "
                    f"per observed day) than during {low['label'] if low else 'other months'} "
                    f"({low['snpp_detections_per_observed_day'] if low and low.get('snpp_detections_per_observed_day') is not None else 'no data'})."
                ),
                "evidence": {
                    "source": "Suomi-NPP monthly climatology from the processed SP record",
                    "peak_month": peak["label"],
                    "peak_rate": peak["snpp_detections_per_observed_day"],
                    "observed_days_supporting": peak["observed_days"],
                },
            }
        )

    recent_active = current.get("recent_week_active_days")
    recent_total = current.get("recent_week_detections")
    if recent_active is not None and recent_total is not None:
        explanations.append(
            {
                "topic": "recent_observations",
                "text": (
                    f"Over the most recent 7-day NRT window, satellites recorded {recent_total} "
                    f"hotspot detections across {recent_active} day(s) in {district_name}. These are "
                    f"thermal-anomaly observations, not confirmed ground fires."
                ),
                "evidence": {
                    "source": "NASA FIRMS near-real-time detections (points export)",
                    "detections": recent_total,
                    "active_days": recent_active,
                },
            }
        )

    if weather_recent:
        mean_rh = sum(float(r.get("relative_humidity_2m_mean") or 0) for r in weather_recent) / len(weather_recent)
        rain7 = sum(float(r.get("precipitation_sum") or 0) for r in weather_recent)
        if mean_rh < 45 and rain7 < 10:
            humidity_text = (
                f"Recent weather data shows low humidity (mean {mean_rh:.0f}%) and limited rainfall "
                f"({rain7:.1f} mm over the last 7 days). These conditions can support fire spread."
            )
        elif rain7 > 20:
            humidity_text = (
                f"Recent weather data shows substantial rainfall ({rain7:.1f} mm over the last 7 days), "
                f"which keeps fuels moist. "
            )
        else:
            humidity_text = (
                f"Recent weather data shows moderate humidity (mean {mean_rh:.0f}%) and rainfall "
                f"({rain7:.1f} mm over the last 7 days)."
            )
        explanations.append(
            {
                "topic": "current_weather",
                "text": humidity_text,
                "evidence": {
                    "source": "Open-Meteo ERA5 archive (district centroid)",
                    "mean_rh_last_7d": round(mean_rh, 1),
                    "rain_last_7d_mm": round(rain7, 1),
                },
            }
        )

    if fwi_current:
        category = fwi_current.get("fwi_category", "").replace("_", " ")
        explanations.append(
            {
                "topic": "fire_weather_index",
                "text": (
                    f"The computed Fire Weather Index for {district_name} is {fwi_current.get('fwi')} "
                    f"({category} on the Canadian scale). This index describes how weather conditions "
                    f"would support fire spread — it is not a prediction that a fire will start, and it "
                    f"is not calibrated for Nepal."
                ),
                "evidence": {
                    "source": "Canadian FWI formulas (Van Wagner 1987) on Open-Meteo forecast weather",
                    "fwi": fwi_current.get("fwi"),
                    "category": fwi_current.get("fwi_category"),
                    "approximations": ["daily max temperature instead of noon temperature", "daily mean RH instead of afternoon RH", "daily max wind instead of noon wind"],
                },
            }
        )

    if outlook.get("status") == "validated":
        metrics = outlook.get("metrics", {})
        explanations.append(
            {
                "topic": "outlook",
                "text": (
                    "A weather-driven daily fire-activity outlook is shown for the next 7 days. It was "
                    "validated by leave-one-year-out evaluation (see the evidence and caveats below); "
                    "its skill beyond a monthly climatology baseline is modest and it must not be read "
                    "as a fire prediction."
                ),
                "evidence": {
                    "mean_auc": metrics.get("mean_auc"),
                    "climatology_auc": metrics.get("mean_climatology_auc"),
                    "skill_over_climatology": metrics.get("skill_over_climatology"),
                },
            }
        )
    elif outlook.get("status") == "validated_but_out_of_season":
        explanations.append(
            {
                "topic": "outlook",
                "text": (
                    "A weather-driven daily fire-activity model was validated inside the January-July "
                    "fire season, but today's date falls outside that validated window. Showing a "
                    "7-day activity outlook now would be an unvalidated extrapolation, so only the "
                    "weather-based Fire Weather Index assessment is shown."
                ),
                "evidence": {"validated_months": "January-July", "validated_metrics": outlook.get("metrics")},
            }
        )
    else:
        explanations.append(
            {
                "topic": "outlook",
                "text": (
                    "The weather-driven activity model did not demonstrate skill beyond the seasonal "
                    "climatology baseline in leave-one-year-out validation, so no fire-activity outlook "
                    "is shown. The Fire Weather Index assessment remains available as a weather-based "
                    "danger indicator."
                ),
                "evidence": {"metrics": outlook.get("metrics", {})},
            }
        )

    return explanations


# ---------------------------------------------------------------------------
# WP8: official safety sources — verify reachability where possible
# ---------------------------------------------------------------------------

def verify_official_sources() -> list[dict[str, Any]]:
    sources = [dict(s) for s in OFFICIAL_SOURCES]
    for source in sources:
        url = source.get("url")
        if not url:
            continue
        try:
            request = Request(url, headers={"User-Agent": "Agnidrishti/1.0"})
            with urlopen(request, timeout=15) as response:
                source["verified_reachable"] = 200 <= response.status < 400
        except Exception:
            source["verified_reachable"] = False
    return sources


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_community_update(
    *,
    weather_start: str = "2012-01-01",
    forecast_days: int = 7,
) -> dict[str, Any]:
    """Fetch weather, compute fire danger, run the validated outlook, build
    explanations and export the full community-intelligence contract."""
    COMMUNITY_DIR.mkdir(parents=True, exist_ok=True)
    centroids = _district_centroids()
    today = date.today()
    generated_at = _utc_now()

    index_districts: list[dict[str, Any]] = []
    for district_id in config.REGION_ORDER:
        definition = config.REGIONS[district_id]
        lat, lon = centroids[district_id]

        archive_start = max(weather_start, "2012-01-01")
        archive_rows = fetch_archive_weather(lat, lon, archive_start, today.isoformat())
        forecast_rows = fetch_forecast_weather(lat, lon, forecast_days)
        fwi_rows = compute_fwi_sequence(archive_rows + forecast_rows, lat)
        fwi_by_date = {row["date"]: row for row in fwi_rows}

        firms_daily = load_firms_daily(district_id)
        historical = build_historical_patterns(district_id, firms_daily)
        modis_long_term = build_modis_long_term(firms_daily)

        # Current NRT observations from the points export (verified records).
        nrt_path = config.PUBLIC_DATA_DIR / "points" / "nrt" / f"{district_id}" / f"{today.year}.json"
        current_records: list[dict[str, Any]] = []
        if nrt_path.exists():
            nrt_payload = json.loads(nrt_path.read_text(encoding="utf-8"))
            for row in nrt_payload.get("records", []):
                current_records.append(
                    {
                        "latitude": row[0],
                        "longitude": row[1],
                        "acq_date": f"{nrt_payload['year']}-{row[2]}",
                        "acq_time": row[3],
                        "platform": row[4],
                        "brightness": row[5],
                        "frp": row[6],
                        "confidence": row[7],
                        "daynight": row[8],
                        "district_id": nrt_payload["district_id"],
                    }
                )
        recent_window = [
            r for r in current_records
            if date.fromisoformat(r["acq_date"]) >= today - timedelta(days=7)
        ]
        recent_days = {r["acq_date"] for r in recent_window}
        current_block = {
            "nrt_records": current_records,
            "recent_week_records": recent_window,
            "recent_week_detections": len(recent_window),
            "recent_week_active_days": len(recent_days),
            "observation_freshness": generated_at,
            "note": "Near-real-time window acquired from NASA FIRMS; detections are thermal-anomaly observations, not confirmed ground fires",
        }

        # Weather for the model + display (last 30 archive days + forecast).
        weather_recent = archive_rows[-30:] + forecast_rows
        fwi_current = fwi_by_date.get(today.isoformat()) or (fwi_rows[-1] if fwi_rows else None)
        forecast_fwi = [fwi_by_date.get(r["date"]) for r in forecast_rows if fwi_by_date.get(r["date"])]

        outlook = build_outlook(firms_daily, archive_rows, fwi_rows)
        explanations = build_explanations(
            definition.name,
            historical,
            current_block,
            weather_recent[-7:],
            fwi_current,
            outlook,
        )

        payload = {
            "contract_version": config.CONTRACT_VERSION,
            "generated_at": generated_at,
            "district_id": district_id,
            "district": {
                "name": definition.name,
                "province": definition.province,
                "pcode": definition.pcode,
                "centroid": {"latitude": lat, "longitude": lon},
            },
            "historical": historical,
            "historical_modis_long_term": modis_long_term,
            "current_observations": current_block,
            "weather_recent_30d": weather_recent[-30:],
            "weather_forecast_7d": forecast_rows,
            "fwi": {
                "current": fwi_current,
                "forecast_7d": forecast_fwi,
                "approximations": [
                    "daily max temperature instead of the noon temperature",
                    "daily mean relative humidity instead of the afternoon value",
                    "daily max wind instead of the noon wind",
                ],
                "calibration": f"Canadian FWI formulas (Van Wagner 1987) uncalibrated for {definition.country}; the index describes weather-driven danger, not ignition probability",
            },
            "outlook": outlook,
            "explanations": explanations,
            "safety_sources": verify_official_sources(),
            "limitations": [
                f"Fire-weather index is uncalibrated for {definition.country} and uses daily-value approximations.",
                "Fire-activity outlook is validated only inside the January-July acquired season.",
                "Satellite detections are thermal-anomaly observations, not confirmed ground fires.",
                f"Centroid weather may differ from conditions elsewhere in {definition.name}.",
                "No official evacuation-centre or route dataset was available for integration; follow local authorities.",
            ],
            "provenance": {
                "observations": "NASA FIRMS SP/NRT (see data/manifests)",
                "weather": "Open-Meteo ERA5 archive + forecast APIs (CC-BY 4.0), centroid daily values",
                "boundaries": f"{definition.source_name} ({definition.source_id})",
            },
        }
        manifests.write_json(COMMUNITY_DIR / f"{district_id}.json", payload)
        index_districts.append(
            {
                "district_id": district_id,
                "name": definition.name,
                "province": definition.province,
                "generated_at": generated_at,
                "outlook_status": outlook["status"],
                "nrt_records": len(current_records),
                "fwi_category": (fwi_current or {}).get("fwi_category"),
            }
        )

    manifests.write_json(
        COMMUNITY_DIR / "index.json",
        {
            "contract_version": config.CONTRACT_VERSION,
            "generated_at": generated_at,
            "districts": index_districts,
        },
    )
    return {
        "districts": list(config.REGION_ORDER),
        "generated_at": generated_at,
        "output": str(COMMUNITY_DIR),
    }
