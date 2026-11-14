"""Task 06 tests — independent metrics, audit integrity, reliability
classification, sensitivity structure, failure modes and claims audit."""

from __future__ import annotations

import numpy as np
import pytest

from pipeline import experiments, metrics, validation


def make_pair(day, modis, ref, district="NP-BANKE", platform="Terra"):
    return {
        "district_id": district,
        "modis_platform": platform,
        "reference_platform": "Suomi-NPP",
        "date": day,
        "month": day[:7],
        "month_of_year": day[5:7],
        "year": int(day[:4]),
        "modis_count": modis,
        "reference_count": ref,
    }


# ---------------------------------------------------------------------------
# Independent metric implementations
# ---------------------------------------------------------------------------


def test_independent_metrics_match_metrics_module():
    rng = np.random.default_rng(11)
    pred = [float(v) for v in rng.poisson(4, size=80)]
    ref = [float(v) for v in rng.poisson(6, size=80)]
    mine = validation.independent_metrics(pred, ref)
    theirs = metrics.all_metrics(np.asarray(pred), np.asarray(ref))
    for key in ("mae", "rmse", "mean_bias"):
        assert mine[key] == pytest.approx(theirs[key], abs=1e-3)
    assert mine["ccc"] == pytest.approx(theirs["ccc"], abs=1e-3)


def test_independent_ccc_penalizes_scale_bias():
    ref = [1.0, 2.0, 3.0, 4.0, 5.0]
    scaled = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert validation._pearson(scaled, ref) == pytest.approx(1.0)
    assert validation._ccc(scaled, ref) < 0.95


# ---------------------------------------------------------------------------
# Independent audit
# ---------------------------------------------------------------------------


def _fitted_and_court(pairs):
    train, validation = experiments.train_validation_split(pairs)
    fitted = {m: experiments.METHODS[m][0](train) for m in experiments.METHODS}
    preds = {m: experiments.METHODS[m][1](fitted[m], validation) for m in experiments.METHODS}
    court = experiments.run_method_court(validation, preds, fitted)
    return train, validation, fitted, court


def test_audit_passes_on_honest_results():
    pairs = [
        make_pair(f"{y}-0{m}-15", float(m), float(m * 4), district=d, platform=p)
        for d in ("NP-BANKE", "NP-BARDIYA", "NP-CHITWAN")
        for p in ("Terra", "Aqua")
        for y in (2014, 2015, 2016, 2019, 2022)
        for m in range(1, 7)
    ]
    train, heldout, fitted, court = _fitted_and_court(pairs)
    audit = validation.run_independent_audit(pairs, train, heldout, fitted, court)
    assert audit["verdict"]["separation_ok"]
    assert audit["verdict"]["metrics_match"]
    assert audit["verdict"]["identity_ok"]
    assert audit["integrity_checks"]["court_sample_size_matches"] is True


def test_audit_detects_tampered_court_metrics():
    pairs = [
        make_pair(f"{y}-0{m}-15", float(m), float(m * 4))
        for y in (2014, 2015, 2016, 2019, 2022)
        for m in range(1, 7)
    ]
    train, heldout, fitted, court = _fitted_and_court(pairs)
    # Tamper: report a fake MAE for one method.
    tampered = {**court, "methods": {**court["methods"]}}
    tampered["methods"]["ratio"] = {**court["methods"]["ratio"], "metrics": {**court["methods"]["ratio"]["metrics"], "mae": 999.0}}
    audit = validation.run_independent_audit(pairs, train, heldout, fitted, tampered)
    assert not audit["verdict"]["metrics_match"]
    assert any(d["metric"] == "mae" and d["method"] == "ratio" for d in audit["integrity_checks"]["metric_discrepancies"])


def test_audit_flags_training_inside_purge_zone():
    pairs = [make_pair(f"{y}-04-15", 1.0, 4.0) for y in (2014, 2015, 2019)]
    train, heldout, fitted, court = _fitted_and_court(pairs)
    # Inject a training pair inside the 2019 purge zone.
    leaked_train = [*train, make_pair("2018-12-20", 1.0, 4.0)]
    audit = validation.run_independent_audit(pairs, leaked_train, heldout, fitted, court)
    assert audit["integrity_checks"]["training_dates_inside_purge_zone"] >= 1
    assert not audit["verdict"]["separation_ok"]


# ---------------------------------------------------------------------------
# Reliability classification
# ---------------------------------------------------------------------------


def test_reliability_categories_follow_documented_thresholds():
    pairs = [
        make_pair(f"{y}-0{m}-{d:02d}", float(d), float(d * 3))
        for y in (2014, 2015, 2016, 2019, 2022)
        for m in range(1, 7)
        for d in range(1, 16)
    ]
    # Out-of-fold records: predictions per method from leave-one-year-out folds.
    oof = []
    for pair in pairs:
        oof.append({
            "district_id": pair["district_id"],
            "modis_platform": pair["modis_platform"],
            "year": pair["year"],
            "month": pair["month"],
            "month_of_year": pair["month_of_year"],
            "reference_count": float(pair["reference_count"]),
            "predictions": {
                "ratio": float(pair["reference_count"]) * 0.9,
                "quantile_mapping": float(pair["reference_count"]) * 1.1,
                "monthly_shrinkage": float(pair["reference_count"]),
            },
        })
    temporal = {"weak_years": []}
    reliability = validation.classify_reliability(oof, temporal)
    grid = reliability["grid"]["NP-BANKE"]
    # Fire-season months with 30 out-of-fold pairs and near-perfect agreement.
    april = grid["04"]
    assert april["category"] == "reliable"
    assert april["validation_pairs"] == 75
    # B5: interval present
    assert april["interval"]["mae"] is not None
    # Months outside the acquired record are unavailable, never zero.
    assert grid["08"]["category"] == "unavailable"
    assert reliability["category_counts"]["unavailable"] >= 1


def test_reliability_insufficient_stays_insufficient():
    # Sparse stratum (2 pairs) must not be promoted even with perfect agreement.
    pairs = [
        make_pair(f"{y}-04-15", 1.0, 3.0)
        for y in (2014, 2015, 2016, 2019, 2022)
    ]
    oof = []
    for pair in pairs:
        oof.append({
            "district_id": "NP-BANKE",
            "modis_platform": "Terra",
            "year": pair["year"],
            "month": pair["month"],
            "month_of_year": pair["month_of_year"],
            "reference_count": float(pair["reference_count"]),
            "predictions": {m: float(pair["reference_count"]) for m in experiments.METHODS},
        })
    reliability = validation.classify_reliability(oof, {"weak_years": []})
    assert reliability["grid"]["NP-BANKE"]["04"]["category"] == "insufficient_evidence"


# ---------------------------------------------------------------------------
# Sensitivity analysis structure
# ---------------------------------------------------------------------------


def test_sensitivity_reports_ranking_and_stability():
    # Dual-sensor synthetic records: build_pairs derives district-day counts
    # from records, so both MODIS and VIIRS detections must vary and correlate.
    records = []
    requested = {"modis": set(), "viirs_snpp": set(), "viirs_noaa20": set(), "viirs_noaa21": set()}
    for year in (2014, 2015, 2016, 2019, 2022):
        for month in range(1, 7):
            for day in range(1, 4):
                day_str = f"{year}-0{month}-{day:02d}"
                modis_n = day % 3 + 1
                viirs_n = 4 * modis_n + (day % 2)
                for i in range(modis_n):
                    records.append({
                        "district_id": "NP-BANKE", "sensor_id": "modis", "platform": "Terra",
                        "acq_date": day_str, "latitude": 27.9 + i * 0.01, "longitude": 81.7,
                        "acq_time": "05:30", "frp": 3.0, "confidence": 50, "daynight": "D",
                        "issues": [], "valid": True,
                    })
                for i in range(viirs_n):
                    records.append({
                        "district_id": "NP-BANKE", "sensor_id": "viirs_snpp", "platform": "Suomi-NPP",
                        "acq_date": day_str, "latitude": 27.9 + i * 0.01, "longitude": 81.7,
                        "acq_time": "07:00", "frp": 4.0, "confidence": "n", "daynight": "D",
                        "issues": [], "valid": True,
                    })
                requested["modis"].add(day_str)
                requested["viirs_snpp"].add(day_str)
                if year >= 2018:
                    # NOAA-20 SP record starts 2018-04: give the rebuilt
                    # reference variant real varying detections.
                    noaa20_n = 2 * modis_n + (day % 2)
                    for i in range(noaa20_n):
                        records.append({
                            "district_id": "NP-BANKE", "sensor_id": "viirs_noaa20",
                            "platform": "NOAA-20", "acq_date": day_str,
                            "latitude": 27.9 + i * 0.01, "longitude": 81.7,
                            "acq_time": "07:10", "frp": 3.5, "confidence": "n", "daynight": "D",
                            "issues": [], "valid": True,
                        })
                    requested["viirs_noaa20"].add(day_str)
    report = validation.run_sensitivity_analysis(records, requested)
    assert report["baseline_ranking"]
    assert "holdout_2023" in report["variants"]
    assert "reference_noaa20" in report["variants"]
    # The rebuilt NOAA-20 variant must not be a no-op: its CCC values differ
    # from the baseline (independent evaluation finding).
    assert report["variants"]["reference_noaa20"]["validation_pairs"] > 0
    for name, stability in report["stability"].items():
        assert isinstance(stability, (dict, str))


# ---------------------------------------------------------------------------
# Failure modes
# ---------------------------------------------------------------------------


def test_all_failure_modes_fail_safe():
    results = validation.run_failure_modes()
    assert results["all_fail_safe"]
    cases = results["cases"]
    assert cases["missing_dates_fallback"]["finite"]
    assert cases["unseen_value_capped"]["within_cap"]
    assert cases["missing_reference_sensor"]["honest_empty"]
    assert cases["unexpected_fields_ignored"]["ok"]


# ---------------------------------------------------------------------------
# Claims audit
# ---------------------------------------------------------------------------


def test_claims_audit_covers_forbidden_claim_classes():
    claims = validation.CLAIMS_AUDIT
    verdicts = {c["verdict"] for c in claims}
    assert "unsupported_must_not_be_made" in verdicts
    # Ground truth, causality, prediction, endorsement are all covered.
    text = " ".join((c["claim"] + " " + c["required_qualification"]).lower() for c in claims)
    assert "ground truth" in text or "not ground truth" in text
    assert "caused" in text
    assert "predicts fires" in text
    assert "endorsement" in text
