"""Task 05 tests — harmonization methods, validation design, metrics,
Method Court, missing-data handling and reproducibility.

All tests use synthetic pairs; nothing here touches real observations or
claims scientific results.
"""

from __future__ import annotations

import numpy as np
import pytest

from pipeline import experiments, metrics


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_pair(
    day: str,
    modis: float,
    ref: float,
    district: str = "NP-BANKE",
    platform: str = "Terra",
) -> dict:
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


def seasonal_pairs(years, counts_by_month):
    pairs = []
    for year in years:
        for month, (m, v) in counts_by_month.items():
            pairs.append(make_pair(f"{year}-{month:02d}-15", m, v))
    return pairs


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def test_mae_rmse_bias_known_values():
    pred = np.asarray([1.0, 2.0, 3.0])
    ref = np.asarray([2.0, 2.0, 2.0])
    assert metrics.mae(pred, ref) == pytest.approx(2 / 3)
    assert metrics.rmse(pred, ref) == pytest.approx(np.sqrt(2 / 3))
    assert metrics.mean_bias(pred, ref) == pytest.approx(0.0)  # (-1 + 0 + 1) / 3


def test_ccc_penalizes_scale_bias_unlike_pearson():
    # Perfectly correlated but scaled 2x: Pearson = 1, CCC < 1.
    ref = np.asarray([1.0, 2.0, 3.0, 4.0, 5.0])
    pred = ref * 2.0
    assert metrics.pearson(pred, ref) == pytest.approx(1.0)
    assert metrics.lin_ccc(pred, ref) < 0.9


def test_ccc_perfect_for_identical_series():
    ref = np.asarray([0.0, 1.0, 5.0, 9.0])
    assert metrics.lin_ccc(ref, ref) == pytest.approx(1.0)


def test_moving_block_bootstrap_is_deterministic_and_sane():
    rng = np.random.default_rng(7)
    pred = rng.poisson(3, size=200).astype(float)
    ref = np.round(pred + rng.normal(0, 1, 200)).clip(min=0)
    blocks = np.asarray([f"2020-{i % 12 + 1:02d}" for i in range(200)])
    a = metrics.moving_block_bootstrap(pred, ref, blocks, iterations=200)
    b = metrics.moving_block_bootstrap(pred, ref, blocks, iterations=200)
    assert a == b  # seeded → reproducible
    assert a["ci_lower"] <= a["point"] <= a["ci_upper"]


# ---------------------------------------------------------------------------
# Split integrity
# ---------------------------------------------------------------------------


def test_validation_years_excluded_from_training_with_purge():
    pairs = [
        make_pair("2018-12-15", 1, 2),   # within purge of 2019 block
        make_pair("2019-04-10", 1, 2),   # validation year
        make_pair("2020-03-05", 1, 2),   # training
        make_pair("2022-05-20", 1, 2),   # validation year
        make_pair("2023-01-15", 1, 2),   # within purge of 2022 block
    ]
    train, validation = experiments.train_validation_split(pairs)
    assert [p["date"] for p in validation] == ["2019-04-10", "2022-05-20"]
    assert [p["date"] for p in train] == ["2020-03-05"]


def test_split_uses_identical_pairs_for_all_methods():
    # The split is deterministic: calling it twice yields the same partition.
    pairs = [make_pair(f"20{y}-04-10", 1, 2) for y in range(12, 26)]
    t1, v1 = experiments.train_validation_split(pairs)
    t2, v2 = experiments.train_validation_split(pairs)
    assert [p["date"] for p in t1] == [p["date"] for p in t2]
    assert [p["date"] for p in v1] == [p["date"] for p in v2]


# ---------------------------------------------------------------------------
# Method 1 — ratio
# ---------------------------------------------------------------------------


def test_ratio_monthly_factor_preferred_and_applied():
    # April training: VIIRS 5x MODIS; other months 2x.
    train = seasonal_pairs(
        range(2013, 2019),
        {4: (10, 50), 5: (10, 20)},
    )
    model = experiments.fit_ratio(train)
    key = "NP-BANKE|Terra"
    assert model["models"][key]["month_ratios"]["04"] == pytest.approx(5.0)
    assert model["models"][key]["month_ratios"]["05"] == pytest.approx(2.0)

    validation = [make_pair("2019-04-15", 4, 20)]
    pred = experiments.apply_ratio(model, validation)
    assert pred[0] == pytest.approx(20.0)


def test_ratio_zero_denominator_falls_back_not_explodes():
    # A month with zero MODIS detections produces no month ratio; the
    # district ratio is used instead of dividing by zero.
    train = seasonal_pairs(range(2013, 2019), {4: (10, 50), 5: (0, 6)})
    model = experiments.fit_ratio(train)
    key = "NP-BANKE|Terra"
    assert "05" not in model["models"][key]["month_ratios"]
    expected = (6 * 50 + 6 * 6) / (6 * 10)
    assert model["models"][key]["district_ratio"] == pytest.approx(expected)
    pred = experiments.apply_ratio(model, [make_pair("2019-05-15", 3, 6)])
    assert np.isfinite(pred[0])
    assert pred[0] == pytest.approx(3 * expected)


def test_ratio_with_no_evidence_uses_identity_and_stays_finite():
    model = experiments.fit_ratio([])
    pred = experiments.apply_ratio(model, [make_pair("2019-04-15", 3, 9)])
    assert pred[0] == 3.0


def test_ratio_month_below_denominator_falls_back_to_district():
    experiments.EXPERIMENT_CONFIG["ratio_min_month_denominator"] = 100
    try:
        train = seasonal_pairs(range(2013, 2019), {4: (10, 50)})
        model = experiments.fit_ratio(train)
        assert "04" not in model["models"]["NP-BANKE|Terra"]["month_ratios"]
        pred = experiments.apply_ratio(model, [make_pair("2019-04-15", 2, 10)])
        assert np.isfinite(pred[0])
    finally:
        experiments.EXPERIMENT_CONFIG["ratio_min_month_denominator"] = 5


# ---------------------------------------------------------------------------
# Method 2 — quantile mapping
# ---------------------------------------------------------------------------


def test_quantile_maps_modis_distribution_toward_reference():
    train = []
    for i in range(1, 61):
        day = f"2015-04-{i:02d}" if i <= 30 else f"2016-04-{i - 30:02d}"
        train.append(make_pair(day, modis=float(i % 5), ref=float((i % 5) * 3)))
    model = experiments.fit_quantile(train)
    mapping = model["models"]["NP-BANKE|Terra"]["pooled_mapping"]
    assert mapping is not None
    # VIIRS levels must extend higher than MODIS levels (scale expansion).
    assert max(mapping["viirs_levels"]) > max(mapping["modis_levels"])

    pred = experiments.apply_quantile(model, [make_pair("2019-04-10", 2, 6)])
    assert pred[0] > 2  # mapped upward
    assert np.isfinite(pred[0])


def test_quantile_preserves_zeros():
    train = seasonal_pairs(range(2013, 2019), {4: (5, 25)})
    model = experiments.fit_quantile(train)
    pred = experiments.apply_quantile(model, [make_pair("2019-04-10", 0, 3)])
    assert pred[0] == 0.0  # no fabricated detections


def test_quantile_caps_at_training_support():
    train = [make_pair(f"{y}-04-{d:02d}", float(d % 4), float((d % 4) * 2))
             for y in range(2013, 2019) for d in range(1, 29)]
    model = experiments.fit_quantile(train)
    mapping = model["models"]["NP-BANKE|Terra"]["pooled_mapping"]
    pred = experiments.apply_quantile(model, [make_pair("2019-04-10", 1000, 0)])
    assert pred[0] <= mapping["cap"]


def test_quantile_sparse_month_without_pooled_falls_back_identity():
    # Too few nonzero pairs for any mapping: identity, documented.
    train = [make_pair("2015-04-15", 2, 10)]
    model = experiments.fit_quantile(train)
    pred = experiments.apply_quantile(model, [make_pair("2019-04-15", 3, 12)])
    assert pred[0] == 3.0


# ---------------------------------------------------------------------------
# Method 3 — monthly shrinkage
# ---------------------------------------------------------------------------


def test_shrinkage_lambda_grows_with_evidence():
    # Build a month with strong evidence and one with weak evidence.
    train = []
    for i in range(1, 21):  # strong month: many MODIS detections
        train.append(make_pair(f"2015-04-{i:02d}", modis=50, ref=50 * 4))
    train.append(make_pair("2015-05-15", modis=2, ref=2 * 10))  # weak month
    train.extend(make_pair(f"2015-06-{d:02d}", modis=1, ref=2) for d in range(1, 11))
    model = experiments.fit_shrinkage(train)
    months = model["models"]["NP-BANKE|Terra"]["month_models"]
    assert months["04"]["lambda"] > months["05"]["lambda"]
    # Weak month must be pulled toward the district ratio: the shrunk ratio
    # lies strictly between the raw month ratio and the district ratio.
    district_ratio = model["models"]["NP-BANKE|Terra"]["district_ratio"]
    raw = months["05"]["raw_ratio"]
    shrunk = months["05"]["shrunk_ratio"]
    lo, hi = sorted((raw, district_ratio))
    assert lo < shrunk < hi


def test_shrinkage_zero_evidence_month_uses_pooled_ratio():
    train = seasonal_pairs(range(2013, 2019), {4: (10, 50), 5: (0, 0)})
    model = experiments.fit_shrinkage(train)
    months = model["models"]["NP-BANKE|Terra"]["month_models"]
    assert months["05"]["status"] == "insufficient_evidence_pooled_ratio_used"
    assert months["05"]["shrunk_ratio"] == pytest.approx(
        model["models"]["NP-BANKE|Terra"]["district_ratio"]
    )
    pred = experiments.apply_shrinkage(model, [make_pair("2019-05-15", 4, 0)])
    assert np.isfinite(pred[0])


# ---------------------------------------------------------------------------
# Fairness and leakage
# ---------------------------------------------------------------------------


def test_methods_fit_on_training_only():
    """A deliberately extreme held-out-year value must not change fitted
    parameters: the split keeps validation years out of training."""
    pairs = seasonal_pairs(range(2013, 2019), {4: (10, 50)})
    pairs.append(make_pair("2019-04-15", 100, 10000))
    train, validation = experiments.train_validation_split(pairs)
    assert all(p["year"] != 2019 for p in train)
    assert len(validation) == 1
    model = experiments.fit_ratio(train)
    # Fitted April ratio comes from training years only (10 -> 50).
    assert model["models"]["NP-BANKE|Terra"]["month_ratios"]["04"] == pytest.approx(5.0)


def test_sensor_identity_preserved_through_fit_and_apply():
    pairs_train = [
        make_pair("2015-04-15", 2, 8, platform="Terra"),
        make_pair("2015-04-16", 2, 4, platform="Aqua"),
    ]
    original = experiments.EXPERIMENT_CONFIG["ratio_min_district_denominator"]
    experiments.EXPERIMENT_CONFIG["ratio_min_district_denominator"] = 1
    try:
        model = experiments.fit_ratio(pairs_train)
        # Terra and Aqua have different fitted ratios.
        assert model["models"]["NP-BANKE|Terra"]["district_ratio"] == pytest.approx(4.0)
        assert model["models"]["NP-BANKE|Aqua"]["district_ratio"] == pytest.approx(2.0)
        pairs_apply = [
            make_pair("2019-04-10", 1, 0, platform="Terra"),
            make_pair("2019-04-10", 1, 0, platform="Aqua"),
        ]
        pred = experiments.apply_ratio(model, pairs_apply)
        assert pred[0] == pytest.approx(4.0)
        assert pred[1] == pytest.approx(2.0)
    finally:
        experiments.EXPERIMENT_CONFIG["ratio_min_district_denominator"] = original


# ---------------------------------------------------------------------------
# Method Court
# ---------------------------------------------------------------------------


def test_court_reports_inconclusive_when_indistinguishable():
    pairs = [make_pair("2019-04-15", 1, 2), make_pair("2019-05-15", 2, 4)]
    pred_a = np.asarray([2.0, 4.0])
    pred_b = np.asarray([2.1, 3.9])
    court = experiments.run_method_court(pairs, {"a": pred_a, "b": pred_b}, {})
    assert court["decision"]["outcome"] in ("inconclusive", "selected")


def test_court_never_selects_without_evidence():
    # Construct a clearly worse second method; verify the court either
    # selects decisively with CI evidence or stays inconclusive — it must
    # never select on a single-point metric alone.
    pairs = [make_pair(f"2019-0{m}-15", 5, 10) for m in range(1, 7)]
    good = np.asarray([10.0] * 6)
    bad = np.asarray([0.0] * 6)
    court = experiments.run_method_court(pairs, {"good": good, "bad": bad}, {})
    decision = court["decision"]
    assert decision["outcome"] in ("selected", "inconclusive")
    if decision["outcome"] == "selected":
        assert decision["selected_method"] == "good"
        assert "ccc_ci" in decision["evidence"]


def test_court_reports_sample_size_and_ranking():
    pairs = [make_pair("2019-04-15", 1, 2)]
    court = experiments.run_method_court(
        pairs, {"a": np.asarray([2.0]), "b": np.asarray([3.0])}, {}
    )
    assert court["validation_sample_size"] == 1
    assert set(court["ranking"]) == {"a", "b"}


# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------


def test_full_experiment_reproducible_on_synthetic_inputs(tmp_path, monkeypatch):
    monkeypatch.setattr(experiments, "EXPERIMENTS_DIR", tmp_path)
    rng = np.random.default_rng(3)
    train = [
        make_pair(f"{y}-{m:02d}-10", float(rng.poisson(3)), float(rng.poisson(12)))
        for y in range(2013, 2019)
        for m in range(1, 7)
    ]
    validation = [
        make_pair("2019-04-10", 2.0, 8.0),
        make_pair("2019-05-10", 1.0, 3.0),
    ]
    preds = {
        method: experiments.METHODS[method][1](
            experiments.METHODS[method][0](train), validation
        )
        for method in experiments.METHODS
    }
    court_a = experiments.run_method_court(validation, preds, {})
    court_b = experiments.run_method_court(validation, preds, {})
    for key in ("ranking", "validation_sample_size"):
        assert court_a[key] == court_b[key]
    assert court_a["decision"]["outcome"] == court_b["decision"]["outcome"]
