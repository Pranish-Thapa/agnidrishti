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
    train, heldout = experiments.train_validation_split(pairs)
    fitted = {m: experiments.METHODS[m][0](train) for m in experiments.METHODS}
    temporal = {"weak_years": []}
    reliability = validation.classify_reliability(pairs, fitted, temporal)
    grid = reliability["grid"]["NP-BANKE"]
    # Fire-season months with 30 validation pairs and strong agreement.
    april = grid["04"]
    assert april["category"] in ("reliable", "use_with_caution")
    assert april["validation_pairs"] == 30
    # Months outside the acquired record are unavailable, never zero.
    assert grid["08"]["category"] == "unavailable"
    assert reliability["category_counts"]["unavailable"] >= 1


def test_reliability_insufficient_stays_insufficient():
    # Sparse stratum (2 pairs) must not be promoted even with perfect agreement.
    pairs = [
        make_pair(f"{y}-04-15", 1.0, 3.0)
        for y in (2014, 2015, 2016, 2019, 2022)
    ]
    train, heldout = experiments.train_validation_split(pairs)
    fitted = {m: experiments.METHODS[m][0](train) for m in experiments.METHODS}
    reliability = validation.classify_reliability(pairs, fitted, {"weak_years": []})
    assert reliability["grid"]["NP-BANKE"]["04"]["category"] == "insufficient_evidence"


# ---------------------------------------------------------------------------
# Sensitivity analysis structure
# ---------------------------------------------------------------------------


def test_sensitivity_reports_ranking_and_stability():
    pairs = [
        make_pair(f"{y}-0{m}-15", float(m), float(m * 4))
        for y in (2014, 2015, 2016, 2019, 2022)
        for m in range(1, 7)
    ]
    report = validation.run_sensitivity_analysis(pairs)
    assert report["baseline_ranking"]
    assert "holdout_2023" in report["variants"]
    assert "reference_noaa20" in report["variants"]
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
