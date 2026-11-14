from pipeline import temporal

DAYS = [
    {"date": "2024-12-30", "status": "observed", "by_sensor": {}},
    {"date": "2024-12-31", "status": "observed_zero", "by_sensor": {}},
]


def test_iso_week_year_boundary():
    iso_year, iso_week, week_start = temporal.iso_week("2024-12-30")
    assert iso_year == 2025
    assert iso_week == 1
    assert week_start == "2024-12-30"


def test_missing_dates_not_zero_filled():
    # build_daily only includes dates passed in; missing dates are not injected as zeros.
    days = temporal.build_daily("NP-BANKE", ["2024-03-01"], {}, {})
    assert len(days) == 1
    assert days[0]["date"] == "2024-03-01"


def test_week_status_incomplete_when_partial():
    days = [
        {"date": "2024-03-04", "status": "observed", "by_sensor": {}},  # Monday
    ]
    weeks = temporal.build_weekly(days)
    assert weeks[0]["status"] == "incomplete"
    assert weeks[0]["days_in_week"] == 1
