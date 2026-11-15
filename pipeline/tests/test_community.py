"""Community Fire Intelligence tests — FWI formulas, historical patterns,
outlook validation honesty, and rule-based explanations.

All tests use synthetic data except the FWI hand-derived vector, which was
computed independently from the canonical cffdrs formulas.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from pipeline import community


# ---------------------------------------------------------------------------
# FWI formulas (hand-derived independent vector + property tests)
# ---------------------------------------------------------------------------


def test_ffmc_hand_derived_vector():
    """temp=20, rh=50, ws=10 km/h, rain=0, ffmc_prev=80 -> FFMC = 85.51.

    Derived by hand from the canonical cffdrs equations."""
    value = community._fine_fuel_moisture(rain=0.0, temp=20.0, rh=50.0, wind=10.0, ffmc_prev=80.0)
    assert value == pytest.approx(85.51, abs=0.5)


def test_heavy_rain_lowers_ffmc():
    before = community._fine_fuel_moisture(0.0, 20.0, 50.0, 10.0, 80.0)
    after = community._fine_fuel_moisture(20.0, 20.0, 50.0, 10.0, 80.0)
    assert after < before


def test_drought_code_grows_dry_and_resets_after_rain():
    hot_dry = {"precipitation_sum": 0.0, "temperature_2m_max": 35.0}
    dc = 50.0
    for _ in range(10):
        dc = community._drought_code(hot_dry["precipitation_sum"], hot_dry["temperature_2m_max"], dc, month=4, lat=28.0)
    assert dc > 60  # ten dry hot April days build the drought code

    soaked = community._drought_code(25.0, 25.0, dc, month=4, lat=28.0)
    assert soaked < dc  # heavy rain reduces the code


def test_isi_increases_with_wind():
    low_wind = community._initial_spread_index(ffmc=90.0, wind=5.0)
    high_wind = community._initial_spread_index(ffmc=90.0, wind=30.0)
    assert high_wind > low_wind


def test_fwi_category_scale():
    assert community.fwi_category(3.0) == "low"
    assert community.fwi_category(7.0) == "moderate"
    assert community.fwi_category(15.0) == "high"
    assert community.fwi_category(25.0) == "very_high"
    assert community.fwi_category(40.0) == "extreme"


def test_fwi_sequence_running_state():
    rows = []
    day = date(2024, 3, 1)
    for _ in range(10):
        rows.append(
            {
                "date": day.isoformat(),
                "temperature_2m_max": 33.0,
                "temperature_2m_min": 18.0,
                "relative_humidity_2m_mean": 30.0,
                "precipitation_sum": 0.0,
                "wind_speed_10m_max": 12.0,
            }
        )
        day += timedelta(days=1)
    outputs = community.compute_fwi_sequence(rows, lat=28.0)
    assert len(outputs) == 10
    dcs = [o["dc"] for o in outputs]
    assert all(b >= a for a, b in zip(dcs, dcs[1:]))
    assert all(not o["state_reset_after_gap"] for o in outputs)
    assert outputs[-1]["dc"] > outputs[0]["dc"]
    assert outputs[-1]["ffmc"] > 80


# ---------------------------------------------------------------------------
# Historical patterns (WP2)
# ---------------------------------------------------------------------------


def make_firms_daily(date_str, snpp, noaa20=0, noaa21=0, terra=0, aqua=0, status="observed"):
    return {
        "status": status,
        "viirs_family_total": (snpp or 0) + noaa20 + noaa21,
        "snpp": snpp,
        "noaa20": noaa20,
        "noaa21": noaa21,
        "terra": terra,
        "aqua": aqua,
    }


def make_pre_viirs_day(date_str, terra=None, aqua=None, status="observed"):
    """A day with no VIIRS platform at all (pre-2012 MODIS-only record)."""
    return {
        "status": status,
        "viirs_family_total": 0,
        "snpp": None,
        "noaa20": None,
        "noaa21": None,
        "terra": terra,
        "aqua": aqua,
    }


def test_monthly_climatology_uses_snpp_only_and_normalizes():
    daily = {}
    daily["2024-04-01"] = make_firms_daily("2024-04-01", snpp=10)
    daily["2024-04-02"] = make_firms_daily("2024-04-02", snpp=0)
    # A day observed only by NOAA-20 (SNPP None) must NOT feed the SNPP rate
    daily["2024-04-03"] = make_firms_daily("2024-04-03", snpp=None, noaa20=50)
    daily["2024-08-15"] = make_firms_daily("2024-08-15", snpp=0)
    patterns = community.build_historical_patterns("NP-BANKE", daily)

    april = next(r for r in patterns["monthly_climatology"] if r["month"] == 4)
    assert april["snpp_detections_per_observed_day"] == 5.0
    assert april["observed_days"] == 2  # the SNPP-None day is excluded, not zero-filled
    august = next(r for r in patterns["monthly_climatology"] if r["month"] == 8)
    assert august["snpp_detections_per_observed_day"] == 0.0


def test_peak_month_identified():
    daily = {}
    for day in range(1, 29):
        daily[f"2024-04-{day:02d}"] = make_firms_daily(f"2024-04-{day:02d}", snpp=50)
        daily[f"2024-11-{day:02d}"] = make_firms_daily(f"2024-11-{day:02d}", snpp=1)
    patterns = community.build_historical_patterns("NP-BANKE", daily)
    assert patterns["peak_month"]["label"] == "Apr"


def test_platform_detections_none_when_platform_did_not_observe():
    observed = {"viirs_snpp": {"platforms": {"Suomi-NPP": {"status": "observed", "detections": 3}}}}
    zero = {"viirs_snpp": {"platforms": {"Suomi-NPP": {"status": "observed_zero", "detections": 0}}}}
    unavailable = {"viirs_snpp": {"platforms": {"Suomi-NPP": {"status": "unavailable", "detections": None}}}}
    assert community._platform_detections(observed, "viirs_snpp", "Suomi-NPP") == 3
    assert community._platform_detections(zero, "viirs_snpp", "Suomi-NPP") == 0
    assert community._platform_detections(unavailable, "viirs_snpp", "Suomi-NPP") is None
    assert community._platform_detections({}, "viirs_snpp", "Suomi-NPP") is None


def test_modis_long_term_uses_only_the_pre_viirs_period():
    daily = {
        "2005-03-01": make_firms_daily("2005-03-01", snpp=None, terra=8, aqua=2),
        "2005-03-02": make_firms_daily("2005-03-02", snpp=None, terra=0, aqua=0),
        "2015-03-01": make_firms_daily("2015-03-01", snpp=99, terra=1, aqua=1),
    }
    long_term = community.build_modis_long_term(daily)
    march = next(r for r in long_term["monthly"] if r["month"] == 3)
    assert march["terra_observed_days"] == 2
    assert march["terra_detections_per_observed_day"] == 4.0
    assert march["aqua_observed_days"] == 2
    assert long_term["period"] == {"start": "2005-03-01", "end": "2005-03-02"}


def test_modis_long_term_terra_only_before_aqua_exists():
    daily = {
        "2001-04-01": make_pre_viirs_day("2001-04-01", terra=4),
        "2001-04-02": make_pre_viirs_day("2001-04-02", terra=2),
    }
    long_term = community.build_modis_long_term(daily)
    april = next(r for r in long_term["monthly"] if r["month"] == 4)
    assert april["terra_observed_days"] == 2
    assert april["aqua_observed_days"] == 0
    assert april["aqua_detections_per_observed_day"] is None
    assert long_term["peak_month_aqua"] is None
    assert long_term["peak_month_terra"]["label"] == "Apr"


def test_modis_long_term_excludes_missing_days():
    daily = {
        "2004-05-01": make_firms_daily("2004-05-01", snpp=None, terra=6, status="observed"),
        "2004-05-02": make_firms_daily("2004-05-02", snpp=None, terra=0, status="missing"),
    }
    long_term = community.build_modis_long_term(daily)
    may = next(r for r in long_term["monthly"] if r["month"] == 5)
    assert may["terra_observed_days"] == 1
    assert may["terra_detections_per_observed_day"] == 6.0


def test_year_totals_omit_years_snpp_never_observed():
    """A pre-VIIRS year must not appear as a zero-detection SNPP total."""
    daily = {
        "2001-04-01": make_pre_viirs_day("2001-04-01", terra=5),
        "2024-04-01": make_firms_daily("2024-04-01", snpp=7),
    }
    patterns = community.build_historical_patterns("NP-BANKE", daily)
    assert [row["year"] for row in patterns["year_totals"]] == ["2024"]


# ---------------------------------------------------------------------------
# Outlook validation honesty (WP6)
# ---------------------------------------------------------------------------


def make_weather_and_firms(years, skillful=True):
    """Synthetic district-days: activity tracks low RH when skillful."""
    import random

    rng = random.Random(42 if skillful else 7)
    weather = []
    firms = {}
    day = date(years[0], 1, 1)
    end = date(years[-1], 6, 30)
    while day <= end:
        month = day.month
        if month == 7 or (month == 6 and day.day > 15):
            day += timedelta(days=1)
            continue  # monsoon: not acquired
        if skillful and month in (3, 4, 5):
            rh = 25 + rng.random() * 30
        else:
            rh = 40 + rng.random() * 40
        row = {
            "date": day.isoformat(),
            "temperature_2m_max": round(30.0 + rng.random() * 8, 1),
            "temperature_2m_min": 18.0,
            "relative_humidity_2m_mean": round(rh, 1),
            "precipitation_sum": 0.0 if rng.random() < 0.85 else round(rng.random() * 8, 1),
            "wind_speed_10m_max": round(8 + rng.random() * 12, 1),
        }
        weather.append(row)
        if rng.random() < 0.8:  # 80% coverage
            active = 1 if (row["relative_humidity_2m_mean"] < 35 and rng.random() < 0.8) else 0
            entry = make_firms_daily(row["date"], snpp=5 if active else 0)
            entry["status"] = "observed" if active else "observed_zero"
            firms[row["date"]] = entry
        day += timedelta(days=1)
    return weather, firms


def test_outlook_reports_honest_metrics():
    # skillful=False -> no correlated activity -> the model must NOT be declared
    # validated: either the AUC is undefined (no active days at all) or poor.
    weather, firms = make_weather_and_firms([2014, 2015, 2016], skillful=False)
    fwi_rows = community.compute_fwi_sequence(weather, lat=28.0)
    outlook = community.build_outlook(firms, weather, fwi_rows)
    assert outlook["status"] == "not_validated"
    mean_auc = outlook["metrics"]["mean_auc"]
    assert mean_auc is None or mean_auc < 0.65
    assert "caveats" in outlook and len(outlook["caveats"]) >= 3


def test_outlook_validated_flag_requires_explicit_thresholds():
    weather, firms = make_weather_and_firms([2014, 2015, 2016], skillful=True)
    fwi_rows = community.compute_fwi_sequence(weather, lat=28.0)
    outlook = community.build_outlook(firms, weather, fwi_rows)
    thresholds = outlook["metrics"]["validated_thresholds"]
    assert thresholds == {"auc_min": 0.65, "skill_min": 0.05}
    if outlook["status"] == "validated":
        assert outlook["metrics"]["mean_auc"] >= 0.65
        assert outlook["metrics"]["skill_over_climatology"] >= 0.05


def test_season_gate_documented():
    weather, firms = make_weather_and_firms([2014, 2015, 2016], skillful=True)
    fwi_rows = community.compute_fwi_sequence(weather, lat=28.0)
    outlook = community.build_outlook(firms, weather, fwi_rows)
    assert "season_note" in outlook
    assert "January-July" in outlook["season_note"]


def test_missing_days_excluded_from_training():
    weather, firms = make_weather_and_firms([2014, 2015], skillful=True)
    fwi_rows = community.compute_fwi_sequence(weather, lat=28.0)
    outlook = community.build_outlook(firms, weather, fwi_rows)
    covered = sum(
        1 for r in firms.values() if r["status"] in ("observed", "observed_zero")
    )
    assert outlook["training_days"] <= covered


def test_outlook_days_absent_when_not_validated():
    # Degenerate data: no skill -> no outlook days may be attached.
    weather, firms = make_weather_and_firms([2014, 2015], skillful=False)
    fwi_rows = community.compute_fwi_sequence(weather, lat=28.0)
    outlook = community.build_outlook(firms, weather, fwi_rows)
    if outlook["status"] == "not_validated":
        assert outlook["outlook_days"] == []


# ---------------------------------------------------------------------------
# Explanation engine (WP7)
# ---------------------------------------------------------------------------


def test_explanations_are_evidence_linked():
    historical = {
        "peak_month": {
            "label": "Apr", "snpp_detections_per_observed_day": 34.5,
            "years_supporting": 15, "observed_days": 450,
        },
        "low_month": {
            "label": "Aug", "snpp_detections_per_observed_day": 0.0,
            "years_supporting": 10, "observed_days": 100,
        },
        "overall_rate_per_observed_day": 5.0,
    }
    current = {"recent_week_detections": 9, "recent_week_active_days": 5}
    weather_recent = [
        {"relative_humidity_2m_mean": 30.0, "precipitation_sum": 0.0} for _ in range(7)
    ]
    fwi_current = {"fwi": 5.14, "fwi_category": "moderate"}
    outlook = {"status": "not_validated", "metrics": {"mean_auc": 0.6, "mean_climatology_auc": 0.7}}
    explanations = community.build_explanations(
        "Bardiya", historical, current, weather_recent, fwi_current, outlook
    )
    topics = [e["topic"] for e in explanations]
    assert "historical_pattern" in topics
    assert "recent_observations" in topics
    assert "current_weather" in topics
    assert "fire_weather_index" in topics
    assert "outlook" in topics
    for e in explanations:
        assert "evidence" in e and e["evidence"]


def test_explanations_do_not_claim_validated_outlook_when_absent():
    explanations = community.build_explanations(
        "Bardiya",
        {"peak_month": None, "low_month": None},
        {"recent_week_detections": None, "recent_week_active_days": None},
        [],
        None,
        {"status": "not_validated", "metrics": {}},
    )
    outlook_expl = next(e for e in explanations if e["topic"] == "outlook")
    assert "did not demonstrate skill" in outlook_expl["text"]


def test_official_sources_present():
    names = " ".join(s["name"] for s in community.OFFICIAL_SOURCES)
    assert "BIPAD" in names
    assert "FIRMS" in names
    for source in community.OFFICIAL_SOURCES:
        if source.get("url"):
            assert source["url"].startswith("https://")
