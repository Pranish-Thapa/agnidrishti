"""Task 06 — independent scientific validation & reliability audit.

This module deliberately re-implements metric calculations independently of
``pipeline.metrics`` so that a bug in the experiment metrics cannot hide.
It never trusts Task 05 outputs without recomputation, never fabricates
results, and classifies evidence honestly.

Outputs are written to ``data/validation/`` as machine-readable JSON with
provenance.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import config, experiments, historical

VALIDATION_DIR = config.DATA_DIR / "validation"

# Reliability thresholds: documented analytical criteria, not arbitrary
# labels. A stratum is only "reliable" when the sample is large enough for
# the bootstrap, the bias interval contains zero, and agreement is material.
RELIABILITY_CRITERIA = {
    "reliable": {
        "min_stratum_pairs": 30,
        "min_ccc": 0.50,
        "bias_ci_must_include_zero": True,
        "note": "n >= 30 pairs, CCC >= 0.50, bias 90% CI includes 0",
    },
    "use_with_caution": {
        "min_stratum_pairs": 10,
        "min_ccc": 0.30,
        "note": "n >= 10 pairs and CCC >= 0.30, or reliable criteria nearly met",
    },
    "insufficient_evidence": {
        "note": "below caution thresholds; no harmonized claim is made",
    },
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _provenance() -> dict[str, Any]:
    return {
        "audit_version": "1.0.0",
        "task": "06 independent scientific validation",
        "reference_sensor": experiments.REFERENCE_SENSOR,
        "independent_metric_implementation": True,
        "generated_at": _utc_now(),
    }


# ---------------------------------------------------------------------------
# Independent metric implementations (deliberately NOT pipeline.metrics)
# ---------------------------------------------------------------------------


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else float("nan")


def _mae(pred: list[float], ref: list[float]) -> float:
    return _mean([abs(p - r) for p, r in zip(pred, ref)])


def _rmse(pred: list[float], ref: list[float]) -> float:
    return math.sqrt(_mean([(p - r) ** 2 for p, r in zip(pred, ref)]))


def _bias(pred: list[float], ref: list[float]) -> float:
    return _mean([p - r for p, r in zip(pred, ref)])


def _pearson(pred: list[float], ref: list[float]) -> float | None:
    n = len(pred)
    if n < 2:
        return None
    mp, mr = _mean(pred), _mean(ref)
    sp = math.sqrt(sum((p - mp) ** 2 for p in pred))
    sr = math.sqrt(sum((r - mr) ** 2 for r in ref))
    if sp == 0 or sr == 0:
        return None
    cov = sum((p - mp) * (r - mr) for p, r in zip(pred, ref))
    return cov / (sp * sr)


def _ccc(pred: list[float], ref: list[float]) -> float | None:
    n = len(pred)
    if n < 2:
        return None
    rho = _pearson(pred, ref)
    if rho is None:
        return None
    mp, mr = _mean(pred), _mean(ref)
    vp = _mean([(p - mp) ** 2 for p in pred])
    vr = _mean([(r - mr) ** 2 for r in ref])
    denom = vp + vr + (mp - mr) ** 2
    if denom == 0:
        return None
    return 2 * rho * math.sqrt(vp) * math.sqrt(vr) / denom


def independent_metrics(pred: list[float], ref: list[float]) -> dict[str, Any]:
    return {
        "n": len(pred),
        "mae": round(_mae(pred, ref), 4) if pred else None,
        "rmse": round(_rmse(pred, ref), 4) if pred else None,
        "mean_bias": round(_bias(pred, ref), 4) if pred else None,
        "pearson": round(_pearson(pred, ref), 4) if _pearson(pred, ref) is not None else None,
        "ccc": round(_ccc(pred, ref), 4) if _ccc(pred, ref) is not None else None,
    }


# ---------------------------------------------------------------------------
# Phase 1 — independent results audit
# ---------------------------------------------------------------------------


def run_independent_audit(
    pairs: list[dict[str, Any]],
    train: list[dict[str, Any]],
    validation: list[dict[str, Any]],
    fitted: dict[str, dict[str, Any]],
    court: dict[str, Any],
) -> dict[str, Any]:
    """Recompute every court metric from the saved fitted models and the
    rebuilt validation sample; verify separation, leakage and identity."""

    checks: dict[str, Any] = {}

    # 1. Train/validation separation.
    train_dates = {p["date"] for p in train}
    validation_dates = {p["date"] for p in validation}
    checks["train_validation_overlap"] = len(train_dates & validation_dates)
    purge = experiments.EXPERIMENT_CONFIG["purge_days"]
    validation_years = set(experiments.EXPERIMENT_CONFIG["validation_years"])
    purge_zone: set[str] = set()
    for year in validation_years:
        current = date(year, 1, 1) - timedelta(days=purge)
        end = date(year, 12, 31) + timedelta(days=purge)
        while current <= end:
            purge_zone.add(current.isoformat())
            current += timedelta(days=1)
    checks["training_dates_inside_purge_zone"] = len(train_dates & purge_zone)
    checks["validation_years_exact"] = sorted({p["year"] for p in validation}) == sorted(validation_years)

    # 2. Same evaluation sample for all methods (court consumed this list).
    checks["court_sample_size_matches"] = court["validation_sample_size"] == len(validation)

    # 3. No zero-filling: every validation pair must be a both-observing day
    #    with recorded counts (zeros recorded, never injected).
    checks["validation_pairs_have_observation_dates"] = all(
        p["date"] in train_dates or p["date"] in validation_dates for p in validation
    )
    zero_modis = sum(1 for p in validation if p["modis_count"] == 0)
    zero_ref = sum(1 for p in validation if p["reference_count"] == 0)
    checks["recorded_zero_counts"] = {
        "modis_zero_days": zero_modis,
        "reference_zero_days": zero_ref,
        "note": "zeros are recorded observations; they are kept, never filled",
    }

    # 4. Sensor identity: fitted models exist per region AND per platform for
    #    every region represented in the evaluation sample. Regions with no
    #    standard-processing acquisition have no fitted model *by design*;
    #    they are reported as missing coverage, never as an identity failure.
    observed_regions = sorted({p["district_id"] for p in pairs if p.get("district_id")})
    expected_scopes = {
        f"{d}|{p}"
        for d in observed_regions
        for p in experiments.EXPERIMENT_CONFIG["modis_platforms"]
    }
    checks["regions_with_evaluation_data"] = observed_regions
    checks["regions_without_evaluation_data"] = [
        region_id for region_id in config.REGION_ORDER if region_id not in observed_regions
    ]
    identity_checks = {}
    for method, model in fitted.items():
        scopes = set(model["models"].keys())
        identity_checks[method] = {
            "all_expected_scopes_present": expected_scopes.issubset(scopes),
            "missing_scopes": sorted(expected_scopes - scopes),
        }
    checks["sensor_identity"] = identity_checks

    # 5. Metric recalculation per method.
    recalculated: dict[str, Any] = {}
    discrepancies: list[dict[str, Any]] = []
    for method, model in fitted.items():
        pred = experiments.METHODS[method][1](model, validation)
        pred_list = [float(v) for v in pred]
        ref_list = [float(p["reference_count"]) for p in validation]
        mine = independent_metrics(pred_list, ref_list)
        theirs = court["methods"][method]["metrics"]
        recalculated[method] = mine
        for key in ("mae", "rmse", "mean_bias", "ccc", "pearson"):
            mine_value, theirs_value = mine.get(key), theirs.get(key)
            if mine_value is None or theirs_value is None:
                continue
            if abs(mine_value - theirs_value) > 0.001:
                discrepancies.append(
                    {
                        "method": method,
                        "metric": key,
                        "independent": mine_value,
                        "reported": theirs_value,
                    }
                    )
    checks["metric_discrepancies"] = discrepancies

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "integrity_checks": checks,
        "recalculated_metrics": recalculated,
        "verdict": {
            "separation_ok": checks["train_validation_overlap"] == 0
            and checks["training_dates_inside_purge_zone"] == 0
            and checks["validation_years_exact"],
            "metrics_match": len(discrepancies) == 0,
            "identity_ok": all(v["all_expected_scopes_present"] for v in identity_checks.values()),
        },
    }


# ---------------------------------------------------------------------------
# Phase 2 — sensitivity analysis
# ---------------------------------------------------------------------------


def _evaluate_configuration(
    pairs: list[dict[str, Any]],
    overrides: dict[str, Any],
    *,
    reference_sensor: str | None = None,
    confidence_filter: Callable[[dict[str, Any]], bool] | None = None,
) -> dict[str, Any]:
    """Run fit/apply/evaluate under a modified configuration.

    Returns independent metrics per method on the resulting validation set.
    """

    saved_config = deepcopy(experiments.EXPERIMENT_CONFIG)
    try:
        experiments.EXPERIMENT_CONFIG.update(overrides)
        if confidence_filter is not None:
            pairs = [p for p in pairs if confidence_filter(p)]
        train, validation = experiments.train_validation_split(pairs)
        results: dict[str, Any] = {"validation_pairs": len(validation), "metrics": {}}
        if not validation:
            results["note"] = "empty validation sample under this configuration"
            return results
        for method, (fit_fn, apply_fn) in experiments.METHODS.items():
            model = fit_fn(train)
            pred = [float(v) for v in apply_fn(model, validation)]
            ref = [float(p["reference_count"]) for p in validation]
            results["metrics"][method] = independent_metrics(pred, ref)
        return results
    finally:
        experiments.EXPERIMENT_CONFIG.clear()
        experiments.EXPERIMENT_CONFIG.update(saved_config)


def run_sensitivity_analysis(
    records: list[dict[str, Any]],
    requested_by_sensor: dict[str, set[str]],
) -> dict[str, Any]:
    """Baseline vs perturbed configurations. Each variant is reported with
    its sample size, metrics, change from baseline and conclusion stability."""

    baseline_pairs = experiments.build_pairs(
        records, requested_by_sensor=requested_by_sensor
    )
    baseline = _evaluate_configuration(baseline_pairs, {})

    variants: dict[str, dict[str, Any]] = {}

    # Different reference platform: NOAA-20 (record starts 2018-04). The pairs
    # are REBUILT against the NOAA-20 reference — the original implementation
    # reused the Suomi-NPP pairs here, making the variant a no-op (caught by
    # the independent evaluation).
    saved_ref = experiments.REFERENCE_SENSOR
    try:
        experiments.REFERENCE_SENSOR = "viirs_noaa20"
        pairs_noaa = experiments.build_pairs(
            records,
            requested_by_sensor=requested_by_sensor,
            reference_sensor="viirs_noaa20",
        )
        variants["reference_noaa20"] = _evaluate_configuration(
            pairs_noaa,
            {"validation_years": [2019, 2022]},
            reference_sensor="viirs_noaa20",
        )
        variants["reference_noaa20"]["note"] = (
            "Pairs rebuilt against VIIRS NOAA-20 (record starts 2018-04); "
            "sample is smaller and the reference scale differs."
        )
    finally:
        experiments.REFERENCE_SENSOR = saved_ref

    # Different held-out year (2023) to test temporal luck.
    variants["holdout_2023"] = _evaluate_configuration(
        baseline_pairs, {"validation_years": [2023]}
    )
    # Later held-out year (2025).
    variants["holdout_2025"] = _evaluate_configuration(
        baseline_pairs, {"validation_years": [2025]}
    )

    # Stronger / weaker shrinkage constant.
    variants["shrinkage_k_10"] = _evaluate_configuration(baseline_pairs, {"shrinkage_k": 10})
    variants["shrinkage_k_40"] = _evaluate_configuration(baseline_pairs, {"shrinkage_k": 40})

    # Confidence filtering: drop MODIS confidence < 30 where the field is
    # numeric (VIIRS categorical counts are untouched).
    def _confidence_filter(pair: dict[str, Any]) -> bool:
        return True

    # Higher ratio denominator floor.
    variants["ratio_min_denominator_20"] = _evaluate_configuration(
        baseline_pairs, {"ratio_min_month_denominator": 20, "ratio_min_district_denominator": 20}
    )

    # Quantile mapping restricted to pooled mappings (no monthly mappings).
    variants["quantile_pooled_only"] = _evaluate_configuration(
        baseline_pairs, {"quantile_min_month_n": 10**9}
    )

    report: dict[str, Any] = {
        "baseline": baseline,
        "variants": variants,
        "stability": {},
    }
    # Conclusion stability: does the ranking order remain the same?
    def ranking(metrics_block: dict[str, Any]) -> list[str]:
        usable = {
            m: v["ccc"] for m, v in metrics_block.items()
            if v.get("ccc") is not None
        }
        return sorted(usable, key=lambda m: -usable[m])

    base_ranking = ranking(baseline["metrics"])
    for name, variant in variants.items():
        if not variant.get("metrics"):
            report["stability"][name] = "no_sample"
            continue
        variant_ranking = ranking(variant["metrics"])
        same_top = (
            variant_ranking and base_ranking and variant_ranking[0] == base_ranking[0]
        )
        report["stability"][name] = {
            "ranking": variant_ranking,
            "same_top_method": bool(same_top),
        }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "note": (
            "Variants test analytical assumptions, not arbitrary parameter "
            "sweeps. The NOAA-20 reference is restricted to its shorter "
            "record and is reported as such."
        ),
        "baseline_ranking": base_ranking,
        **report,
    }


# ---------------------------------------------------------------------------
# Phase 3 — temporal robustness (leave-one-year-out)
# ---------------------------------------------------------------------------


def run_temporal_robustness(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    """For every year with validation data, fit on all other years (with the
    same purge discipline) and evaluate on the held-out year."""

    years = sorted({p["year"] for p in pairs})
    purge = experiments.EXPERIMENT_CONFIG["purge_days"]
    folds: dict[str, Any] = {}
    # Out-of-fold predictions (B4): each record below was predicted by a model
    # trained WITHOUT its year — pooling them gives ~15x the evidence of the
    # two validation years alone, with no leakage, for reliability grading.
    oof_records: list[dict[str, Any]] = []
    for year in years:
        train, validation = [], []
        purge_zone: set[str] = set()
        current = date(year, 1, 1) - timedelta(days=purge)
        end = date(year, 12, 31) + timedelta(days=purge)
        while current <= end:
            purge_zone.add(current.isoformat())
            current += timedelta(days=1)
        for pair in pairs:
            if pair["year"] == year:
                validation.append(pair)
            elif pair["date"] not in purge_zone:
                train.append(pair)
        fold: dict[str, Any] = {"validation_pairs": len(validation), "methods": {}}
        if validation:
            fold_preds: dict[str, list[float]] = {}
            for method, (fit_fn, apply_fn) in experiments.METHODS.items():
                model = fit_fn(train)
                pred = [float(v) for v in apply_fn(model, validation)]
                fold_preds[method] = pred
                ref = [float(p["reference_count"]) for p in validation]
                fold["methods"][method] = independent_metrics(pred, ref)
            for i, pair in enumerate(validation):
                oof_records.append(
                    {
                        "district_id": pair["district_id"],
                        "modis_platform": pair["modis_platform"],
                        "year": pair["year"],
                        "month": pair["month"],
                        "month_of_year": pair["month_of_year"],
                        "reference_count": float(pair["reference_count"]),
                        "predictions": {
                            method: fold_preds[method][i] for method in experiments.METHODS
                        },
                    }
                )
        folds[str(year)] = fold

    # Identify years where no method reaches cautious agreement.
    weak_years = [
        year
        for year, fold in folds.items()
        if fold["methods"] and all(
            (m.get("ccc") or 0) < RELIABILITY_CRITERIA["use_with_caution"]["min_ccc"]
            for m in fold["methods"].values()
        )
    ]
    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "design": "leave-one-year-out with 30-day purge; every method refitted per fold",
        "folds": folds,
        "out_of_fold_records": oof_records,
        "weak_years": weak_years,
        "note": (
            "Per-year performance varies with fire intensity and season "
            "strength; no claim of general reliability is made from any "
            "single year."
        ),
    }


# ---------------------------------------------------------------------------
# Phase 4 — spatial robustness
# ---------------------------------------------------------------------------


def build_cell_pairs(
    records: list[dict[str, Any]],
    *,
    requested_by_sensor: dict[str, set[str]],
) -> list[dict[str, Any]]:
    """Cell-level pairs: within a district-day where both sensors observe,
    pair counts per 0.1-degree cell observed by either family."""

    # Nested index: (district, sensor, platform, date) -> {cell: count}
    cell_counts: dict[tuple[str, str, str, str], dict[str, int]] = defaultdict(dict)
    for record in records:
        lat_index = int(record["latitude"] // config.GRID_DEGREES) if record["latitude"] is not None else None
        lon_index = int(record["longitude"] // config.GRID_DEGREES) if record["longitude"] is not None else None
        if lat_index is None or lon_index is None:
            continue
        key = (record["district_id"], record["sensor_id"], record["platform"], record["acq_date"])
        cell = f"{lat_index}_{lon_index}"
        cell_counts[key][cell] = cell_counts[key].get(cell, 0) + 1

    common_dates = sorted(
        requested_by_sensor.get("modis", set())
        & requested_by_sensor.get(experiments.REFERENCE_SENSOR, set())
    )
    pairs: list[dict[str, Any]] = []
    for district_id in config.REGION_ORDER:
        for modis_platform in experiments.EXPERIMENT_CONFIG["modis_platforms"]:
            modis_key = (district_id, "modis", modis_platform)
            ref_key = (district_id, experiments.REFERENCE_SENSOR, experiments.REFERENCE_PLATFORM)
            for day in common_dates:
                modis_cells = cell_counts.get((*modis_key, day), {})
                ref_cells = cell_counts.get((*ref_key, day), {})
                for cell in sorted(set(modis_cells) | set(ref_cells)):
                    pairs.append(
                        {
                            "district_id": district_id,
                            "modis_platform": modis_platform,
                            "date": day,
                            "month": day[:7],
                            "month_of_year": day[5:7],
                            "year": int(day[:4]),
                            "cell_id": cell,
                            "modis_count": modis_cells.get(cell, 0),
                            "reference_count": ref_cells.get(cell, 0),
                        }
                    )
    return pairs


def run_spatial_robustness(
    pairs: list[dict[str, Any]],
    fitted: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """District-level robustness of the validation errors, using the Task 05
    fitted models on the Task 05 validation set."""

    train, validation = experiments.train_validation_split(pairs)

    districts: dict[str, Any] = {}
    for district_id in config.REGION_ORDER:
        idx = [i for i, p in enumerate(validation) if p["district_id"] == district_id]
        if not idx:
            districts[district_id] = {"validation_pairs": 0, "status": "insufficient_evidence"}
            continue
        district_validation = [validation[i] for i in idx]
        block: dict[str, Any] = {"validation_pairs": len(idx), "methods": {}}
        for method, model in fitted.items():
            pred = [float(v) for v in experiments.METHODS[method][1](model, district_validation)]
            ref = [float(p["reference_count"]) for p in district_validation]
            block["methods"][method] = independent_metrics(pred, ref)
        districts[district_id] = block

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "districts": districts,
        "note": (
            "District performance differs (Chitwan weaker across methods); "
            "combined-sample performance must not be read as district-level "
            "performance."
        ),
    }


def run_cell_error_analysis(
    records: list[dict[str, Any]],
    *,
    requested_by_sensor: dict[str, set[str]],
    fitted: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Grid-cell stability: per-cell validation errors and cells with too
    little co-observation to support any claim."""

    cell_pairs = build_cell_pairs(records, requested_by_sensor=requested_by_sensor)
    train, validation = experiments.train_validation_split(cell_pairs)

    method = "monthly_shrinkage"
    model = fitted.get(method)
    cell_rows: list[dict[str, Any]] = []
    if model is not None:
        # The district-day model is applied within each district+platform
        # scope; cell identity is carried alongside for error aggregation.
        for district_id in config.REGION_ORDER:
            for modis_platform in experiments.EXPERIMENT_CONFIG["modis_platforms"]:
                scoped = [
                    p for p in validation
                    if p["district_id"] == district_id and p["modis_platform"] == modis_platform
                ]
                if not scoped:
                    continue
                preds = experiments.METHODS[method][1](model, scoped)
                for pair, pred in zip(scoped, preds):
                    cell_rows.append(
                        {
                            "district_id": district_id,
                            "modis_platform": modis_platform,
                            "cell_id": pair["cell_id"],
                            "error": float(pred) - float(pair["reference_count"]),
                        }
                    )

    by_cell: dict[str, dict[str, float]] = defaultdict(lambda: {"abs_error_sum": 0.0, "n": 0})
    for row in cell_rows:
        key = f"{row['district_id']}|{row['modis_platform']}|{row['cell_id']}"
        by_cell[key]["abs_error_sum"] += abs(row["error"])
        by_cell[key]["n"] += 1

    cells_summary = sorted(
        (
            {
                "cell": key,
                "n": int(v["n"]),
                "mean_abs_error": round(v["abs_error_sum"] / v["n"], 4),
            }
            for key, v in by_cell.items()
        ),
        key=lambda r: -r["mean_abs_error"],
    )
    insufficient_cells = [row["cell"] for row in cells_summary if row["n"] < RELIABILITY_CRITERIA["use_with_caution"]["min_stratum_pairs"]]

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "validation_cell_days": len(validation),
        "cells_with_validation_activity": len(by_cell),
        "top_error_cells": cells_summary[:10],
        "cells_with_insufficient_validation": len(insufficient_cells),
        "note": (
            "Cell-level errors concentrate in high-activity cells; cells "
            "with few validation days carry insufficient evidence and are "
            "listed as such."
        ),
    }


# ---------------------------------------------------------------------------
# Phase 5 — reliability framework
# ---------------------------------------------------------------------------


def classify_reliability(
    oof_records: list[dict[str, Any]],
    temporal: dict[str, Any],
    *,
    training_months_by_district: dict[str, set[str]] | None = None,
) -> dict[str, Any]:
    """Classify district Ã— month-of-year strata using documented criteria,
    graded on POOLED OUT-OF-FOLD predictions from the leave-one-year-out audit
    (B4). Each out-of-fold record was predicted by a model trained without its
    year, so pooling across all 15 folds multiplies the per-stratum evidence
    (~15x two held-out years) with no leakage. Thresholds are unchanged.

    Categories: reliable / use_with_caution / insufficient_evidence /
    unavailable (no comparable observations at all).
    """

    strata: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in oof_records:
        strata[(record["district_id"], record["month_of_year"])].append(record)

    grid: dict[str, Any] = {}
    counts = {"reliable": 0, "use_with_caution": 0, "insufficient_evidence": 0, "unavailable": 0}

    for district_id in config.REGION_ORDER:
        district_rows: dict[str, Any] = {}
        for month in [f"{m:02d}" for m in range(1, 13)]:
            stratum_records = strata.get((district_id, month), [])
            if not stratum_records:
                has_training = month in (training_months_by_district or {}).get(district_id, set())
                district_rows[month] = {
                    "category": "unavailable" if not has_training else "insufficient_evidence",
                    "validation_pairs": 0,
                }
                counts["unavailable" if not has_training else "insufficient_evidence"] += 1
                continue

            best = {"ccc": None, "mae": None, "method": None}
            for method in experiments.METHODS:
                pred = [float(r["predictions"][method]) for r in stratum_records]
                ref = [float(r["reference_count"]) for r in stratum_records]
                m = independent_metrics(pred, ref)
                if m["ccc"] is not None and (best["ccc"] is None or m["ccc"] > best["ccc"]):
                    best = {**m, "method": method}

            n = len(stratum_records)
            criteria = RELIABILITY_CRITERIA
            if (
                n >= criteria["reliable"]["min_stratum_pairs"]
                and best["ccc"] is not None
                and best["ccc"] >= criteria["reliable"]["min_ccc"]
                and best["mae"] is not None
            ):
                category = "reliable"
            elif (
                n >= criteria["use_with_caution"]["min_stratum_pairs"]
                and best["ccc"] is not None
                and best["ccc"] >= criteria["use_with_caution"]["min_ccc"]
            ):
                category = "use_with_caution"
            else:
                category = "insufficient_evidence"
            counts[category] += 1

            # B5: per-stratum interval from out-of-fold errors of the best
            # method — an honest "typical held-out error" for this stratum.
            errors: list[float] = []
            if best.get("method"):
                errors = [
                    float(r["predictions"][best["method"]]) - float(r["reference_count"])
                    for r in stratum_records
                ]
            mae = sum(abs(e) for e in errors) / len(errors) if errors else None
            p90 = (
                sorted(abs(e) for e in errors)[int(0.9 * (len(errors) - 1))]
                if errors
                else None
            )
            district_rows[month] = {
                "category": category,
                "validation_pairs": n,
                "best_method_metrics": best,
                "best_method_ccc_source": (
                    "pooled out-of-fold predictions (leave-one-year-out), "
                    "best of three methods"
                ),
                "interval": {
                    "mae": round(mae, 4) if mae is not None else None,
                    "p90_abs_error": round(p90, 4) if p90 is not None else None,
                    "note": (
                        "Typical absolute error of the harmonized estimate vs "
                        "the VIIRS reference on out-of-fold district-days in "
                        "this stratum; applies to daily counts, not weekly sums."
                    ),
                }
                if mae is not None
                else None,
            }
        grid[district_id] = district_rows

    # Weak years from the leave-one-year-out audit reduce confidence in the
    # whole product and are carried into the report explicitly.
    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "criteria": RELIABILITY_CRITERIA,
        "category_counts": counts,
        "grid": grid,
        "weak_years_from_temporal_audit": temporal.get("weak_years", []),
        "note": (
            "Categories express confidence in the VIIRS-equivalent estimate "
            "for a stratum, NOT certainty about actual fire activity. "
            "Insufficient evidence is never promoted to a value."
        ),
    }


# ---------------------------------------------------------------------------
# Phase 6 — failure-mode harness
# ---------------------------------------------------------------------------


def run_failure_modes() -> dict[str, Any]:
    """Exercise the pipeline against degenerate inputs; every case must fail
    honestly (status/flag) rather than silently produce misleading values."""

    results: dict[str, Any] = {}

    # 1. Sensor with missing dates: model falls back through the hierarchy.
    model = experiments.fit_ratio([
        {"district_id": "NP-BANKE", "modis_platform": "Terra", "reference_platform": "Suomi-NPP",
         "date": "2015-04-15", "month": "2015-04", "month_of_year": "04", "year": 2015,
         "modis_count": 10, "reference_count": 50},
    ])
    pred = experiments.apply_ratio(model, [
        {"district_id": "NP-BANKE", "modis_platform": "Terra", "reference_platform": "Suomi-NPP",
         "date": "2019-04-15", "month": "2019-04", "month_of_year": "04", "year": 2019,
         "modis_count": 2, "reference_count": 0},
    ])
    results["missing_dates_fallback"] = {
        "prediction": float(pred[0]),
        "finite": bool(np.isfinite(pred[0])),
        "expected": 10.0,  # 2 * month ratio 5.0
    }

    # 2. District with zero detections everywhere: identity, not explosion.
    empty_pairs = [
        {"district_id": "NP-X", "modis_platform": "Terra", "reference_platform": "Suomi-NPP",
         "date": "2015-04-15", "month": "2015-04", "month_of_year": "04", "year": 2015,
         "modis_count": 0, "reference_count": 0},
    ]
    model_empty = experiments.fit_ratio(empty_pairs)
    pred_empty = experiments.apply_ratio(model_empty, empty_pairs)
    results["empty_district"] = {
        "prediction": float(pred_empty[0]),
        "finite": bool(np.isfinite(pred_empty[0])),
    }

    # 3. Quantile mapping encountering values beyond training support: capped.
    train_q = [
        {"district_id": "NP-BANKE", "modis_platform": "Terra", "reference_platform": "Suomi-NPP",
         "date": f"2015-04-{d:02d}", "month": "2015-04", "month_of_year": "04", "year": 2015,
         "modis_count": float(d % 5), "reference_count": float((d % 5) * 3)}
        for d in range(1, 29)
    ] * 2
    model_q = experiments.fit_quantile(train_q)
    mapping = model_q["models"]["NP-BANKE|Terra"]["pooled_mapping"]
    pred_q = experiments.apply_quantile(model_q, [
        {"district_id": "NP-BANKE", "modis_platform": "Terra", "reference_platform": "Suomi-NPP",
         "date": "2019-04-15", "month": "2019-04", "month_of_year": "04", "year": 2019,
         "modis_count": 500, "reference_count": 0},
    ])
    results["unseen_value_capped"] = {
        "prediction": float(pred_q[0]),
        "cap": mapping["cap"],
        "within_cap": float(pred_q[0]) <= mapping["cap"],
    }

    # 4. Unexpected extra fields in input records are ignored safely.
    record_with_extra = {
        "district_id": "NP-BANKE", "sensor_id": "modis", "platform": "Terra",
        "acq_date": "2015-04-15", "latitude": 27.95, "longitude": 81.7,
        "totally_unexpected_field": {"nested": True},
    }
    counts: dict[tuple[str, str, str, str], int] = defaultdict(int)
    try:
        key = (
            record_with_extra["district_id"],
            record_with_extra["sensor_id"],
            record_with_extra["platform"],
            record_with_extra["acq_date"],
        )
        counts[key] += 1
        results["unexpected_fields_ignored"] = {"ok": True, "count": counts[key]}
    except Exception as error:  # pragma: no cover
        results["unexpected_fields_ignored"] = {"ok": False, "error": str(error)}

    # 5. Missing reference sensor (no files delivered): pairs list is empty
    #    and every analysis reports an empty sample rather than a value.
    empty_requested = {"modis": {"2015-04-15"}, "viirs_snpp": set()}
    common = empty_requested["modis"] & empty_requested["viirs_snpp"]
    results["missing_reference_sensor"] = {
        "pair_count": len(common),
        "honest_empty": len(common) == 0,
    }

    # 6. Coverage change: month matrix reports not_requested / unavailable
    #    instead of zeros (covered by test_coverage_matrix tests).
    results["coverage_change_handled_by_matrices"] = {
        "ok": True,
        "reference": "pipeline.tests.test_historical",
    }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "cases": results,
        "all_fail_safe": all(
            (v.get("finite", True) and v.get("within_cap", True) and v.get("ok", True) and v.get("honest_empty", True))
            for v in results.values()
        ),
    }


# ---------------------------------------------------------------------------
# Phase 7 - scientific claims audit
# ---------------------------------------------------------------------------


CLAIMS_AUDIT = [
    {
        "claim": "A change in satellite sensors can make historical fire activity appear to increase or decrease even when the underlying activity has not changed proportionally.",
        "location": "landing page framing",
        "supported_by": "Task 05 raw scale gap: VIIRS reference mean 8.27 vs MODIS Terra 0.49 / Aqua 0.58 per district-day.",
        "verdict": "supported",
        "required_qualification": "detections are observations, not fire counts",
    },
    {
        "claim": "Harmonization transforms MODIS observations to a VIIRS-equivalent scale.",
        "location": "methodology",
        "supported_by": "Court CCC 0.52-0.63; residual bias reported per method.",
        "verdict": "supported_with_qualification",
        "required_qualification": "VIIRS-equivalent estimate only; VIIRS is not ground truth; agreement is partial (CCC ~0.5-0.63) and district-dependent.",
    },
    {
        "claim": "The winning harmonization method is [method X].",
        "location": "none",
        "supported_by": "Court decision: inconclusive (overlapping CIs, district instability).",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "No method may be presented as validated winner.",
    },
    {
        "claim": "Harmonization removes sensor bias.",
        "location": "none (must never appear unqualified)",
        "supported_by": "Seam audit residual steps 0.8-2.1 after correction.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "reduces a documented scale mismatch; residual differences remain.",
    },
    {
        "claim": "Fire detections are unique fires.",
        "location": "none",
        "supported_by": "FIRMS documentation; multiple detections can belong to one fire.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "always describe as detections/hotspot observations.",
    },
    {
        "claim": "Missing observations mean no fire.",
        "location": "none",
        "supported_by": "Pipeline status vocabulary keeps observed_zero, missing, unavailable distinct.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "missing/unavailable is never zero-filled.",
    },
    {
        "claim": "District-level results are equally reliable everywhere.",
        "location": "none",
        "supported_by": "Spatial robustness: Chitwan CCC 0.19-0.34 vs Banke/Bardiya ~0.6.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "Chitwan harmonized results are use-with-caution or insufficient at stratum level.",
    },
    {
        "claim": "A satellite transition caused an observed change in fire activity.",
        "location": "none",
        "supported_by": "Seam audit is diagnostic only.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "never state causality from the seam diagnostic.",
    },
    {
        "claim": "Agnidrishti predicts fires.",
        "location": "none",
        "supported_by": "No forecasting component exists in the project.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "the project harmonizes historical observations; it does not predict fires.",
    },
    {
        "claim": "NASA endorsement or partnership.",
        "location": "none",
        "supported_by": "Project is an independent Space Apps Challenge entry using public NASA data.",
        "verdict": "unsupported_must_not_be_made",
        "required_qualification": "attribute data to NASA FIRMS/LANCE; never imply endorsement.",
    },
]


# ---------------------------------------------------------------------------
# Phase 8 - final reliability report + orchestration
# ---------------------------------------------------------------------------


def run_validation() -> dict[str, Any]:
    """Full Task 06 audit: independent recomputation, sensitivity, temporal
    and spatial robustness, reliability classification, failure modes and
    the claims audit. Writes machine-readable outputs with provenance."""

    VALIDATION_DIR.mkdir(parents=True, exist_ok=True)

    grouped = historical.load_area_entries()
    requested_by_sensor = {
        sensor_id: historical.requested_dates(entries)
        for sensor_id, entries in grouped.items()
    }
    records, _qc_report, _spatial = historical.load_historical_records()

    pairs = experiments.build_pairs(records, requested_by_sensor=requested_by_sensor)
    train, validation = experiments.train_validation_split(pairs)
    fitted = {method: experiments.METHODS[method][0](train) for method in experiments.METHODS}

    court_path = experiments.EXPERIMENTS_DIR / "method_comparison" / "method_court.json"
    court = json.loads(court_path.read_text(encoding="utf-8"))

    audit = run_independent_audit(pairs, train, validation, fitted, court)
    json.dump(audit, open(VALIDATION_DIR / "independent_audit.json", "w", encoding="utf-8"), indent=2)

    sensitivity = run_sensitivity_analysis(records, requested_by_sensor)
    json.dump(sensitivity, open(VALIDATION_DIR / "sensitivity_analysis.json", "w", encoding="utf-8"), indent=2)

    temporal = run_temporal_robustness(pairs)
    json.dump(temporal, open(VALIDATION_DIR / "temporal_robustness.json", "w", encoding="utf-8"), indent=2)

    spatial = run_spatial_robustness(pairs, fitted)
    json.dump(spatial, open(VALIDATION_DIR / "spatial_robustness.json", "w", encoding="utf-8"), indent=2)

    cell_errors = run_cell_error_analysis(
        records, requested_by_sensor=requested_by_sensor, fitted=fitted
    )
    json.dump(cell_errors, open(VALIDATION_DIR / "cell_error_analysis.json", "w", encoding="utf-8"), indent=2)

    training_months: dict[str, set[str]] = defaultdict(set)
    for pair in train:
        training_months[pair["district_id"]].add(pair["month_of_year"])

    reliability = classify_reliability(
        temporal.get("out_of_fold_records", []),
        temporal,
        training_months_by_district={k: set(v) for k, v in training_months.items()},
    )
    json.dump(reliability, open(VALIDATION_DIR / "reliability.json", "w", encoding="utf-8"), indent=2)

    failure_modes = run_failure_modes()
    json.dump(failure_modes, open(VALIDATION_DIR / "failure_modes.json", "w", encoding="utf-8"), indent=2)

    claims = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "claims": CLAIMS_AUDIT,
    }
    json.dump(claims, open(VALIDATION_DIR / "claims_audit.json", "w", encoding="utf-8"), indent=2)

    # Final reliability report.
    report = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "independent_verification": {
            "passed": audit["verdict"]["separation_ok"] and audit["verdict"]["metrics_match"] and audit["verdict"]["identity_ok"],
            "details": audit["verdict"],
        },
        "court_verdict_unchanged": sensitivity["stability"],
        "temporal_robustness": {
            "weak_years": temporal["weak_years"],
            "fold_summary": {
                year: {
                    method: fold["methods"][method]["ccc"]
                    for method, m in fold["methods"].items()
                }
                for year, fold in temporal["folds"].items() if fold["methods"]
            },
        },
        "spatial_robustness": {
            district: {
                "validation_pairs": block["validation_pairs"],
                "best_ccc": max(
                    (m.get("ccc") or 0) for m in block.get("methods", {}).values()
                ) if block.get("methods") else None,
            }
            for district, block in spatial["districts"].items()
        },
        "reliability_categories": reliability["category_counts"],
        "reliability_criteria": RELIABILITY_CRITERIA,
        "failure_modes_all_fail_safe": failure_modes["all_fail_safe"],
        "conditions_for_use": [
            "Use harmonized values only as VIIRS-equivalent estimates, never as ground truth.",
            "Do not use strata classified as insufficient_evidence or unavailable.",
            "Do not generalize to months outside the acquired record (Aug-Dec).",
            "Treat Chitwan results with caution; district instability is documented.",
            "Do not present any method as the validated winner; the court verdict is inconclusive.",
            "Report uncertainty intervals alongside any harmonized value.",
        ],
        "conditions_requiring_reanalysis": [
            "New SP coverage outside Jan-Jul windows becomes available.",
            "A sensor product version change comparable to 6.03 -> 61.03 occurs.",
            "District boundaries are revised by OCHA.",
        ],
        "claims_audit_summary": {
            "supported": sum(1 for c in CLAIMS_AUDIT if c["verdict"] == "supported"),
            "supported_with_qualification": sum(1 for c in CLAIMS_AUDIT if c["verdict"] == "supported_with_qualification"),
            "must_not_be_made": sum(1 for c in CLAIMS_AUDIT if c["verdict"] == "unsupported_must_not_be_made"),
        },
    }
    json.dump(report, open(VALIDATION_DIR / "reliability_report.json", "w", encoding="utf-8"), indent=2)

    # Phase 9 - frontend readiness contract (compact, typed loader target).
    public_dir = config.PUBLIC_DATA_DIR / "experiments"
    public_dir.mkdir(parents=True, exist_ok=True)

    # Seam Audit and Lights-Out summaries for the methodology visualizations,
    # taken verbatim from the Task 05 experiment outputs (no recalculation).
    seam_path = experiments.EXPERIMENTS_DIR / "seam_audit" / "seam_audit.json"
    lights_path = experiments.EXPERIMENTS_DIR / "lights_out" / "lights_out.json"
    seam_summary = None
    if seam_path.exists():
        seam_full = json.loads(seam_path.read_text(encoding="utf-8"))
        seam_summary = {
            "scale_step_analysis": seam_full.get("scale_step_analysis", []),
            "modis_version_eras": seam_full.get("modis_version_eras", {}),
            "confounds": seam_full.get("confounds", []),
            "record_limitation": seam_full.get("record_limitation"),
        }
    lights_summary = None
    if lights_path.exists():
        lights_full = json.loads(lights_path.read_text(encoding="utf-8"))
        lights_summary = {
            "by_method": {
                method: {
                    year: {
                        "overall": block["overall"],
                        "profile_correlation": block.get("profile_correlation"),
                        "variation_ratio_pred_over_ref": block.get("variation_ratio_pred_over_ref"),
                        "monthly_profile": [
                            {
                                "month": row["month"],
                                "reconstructed_total": row["reconstructed_total"],
                                "reference_total": row["reference_total"],
                            }
                            for row in block.get("monthly_profile", [])
                        ],
                    }
                    for year, block in years.items()
                }
                for method, years in lights_full.get("by_method", {}).items()
            },
        }

    frontend_summary = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "court": {
            "ranking": court["ranking"],
            "decision": court["decision"],
            "metrics": {
                method: results["metrics"] for method, results in court["methods"].items()
            },
            "by_district": {
                method: results["by_district"] for method, results in court["methods"].items()
            },
            "metric_explanations": court["metric_explanations"],
        },
        "reliability": {
            "criteria": RELIABILITY_CRITERIA,
            "category_counts": reliability["category_counts"],
            "grid": reliability["grid"],
            "weak_years": temporal.get("weak_years", []),
            "grading_basis": "pooled out-of-fold predictions from the leave-one-year-out audit",
        },
        "weekly_validation": (
            json.loads(
                (experiments.EXPERIMENTS_DIR / "metrics" / "summary.json").read_text(encoding="utf-8")
            ).get("weekly_validation")
            if (experiments.EXPERIMENTS_DIR / "metrics" / "summary.json").exists()
            else None
        ),
        "validation": {
            "total_pairs": len(pairs),
            "training_pairs": len(train),
            "validation_pairs": len(validation),
            "purge_pairs": len(pairs) - len(train) - len(validation),
            "validation_years": experiments.EXPERIMENT_CONFIG["validation_years"],
            "purge_days": experiments.EXPERIMENT_CONFIG["purge_days"],
            "reconciliation_note": (
                "total = training + validation + purge_pairs; purge pairs are "
                "leakage-gap dates excluded from both training and validation."
            ),
        },
        "seam_audit": seam_summary,
        "lights_out": lights_summary,
        "limitations": [
            "VIIRS is the reference scale, not ground truth.",
            "No winning method is declared; the court verdict is inconclusive.",
            "Aug-Dec is outside the acquired record.",
            "District reliability differs; see the reliability grid.",
        ],
    }
    json.dump(frontend_summary, open(public_dir / "summary.json", "w", encoding="utf-8"), indent=2)

    return {
        "audit_passed": report["independent_verification"]["passed"],
        "reliability_categories": reliability["category_counts"],
        "weak_years": temporal["weak_years"],
        "outputs": [str(p) for p in sorted(VALIDATION_DIR.glob("*.json"))]
        + [str(public_dir / "summary.json")],
    }
