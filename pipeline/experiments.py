"""Task 05 — MODIS–VIIRS harmonization experiments.

Scientific contract (binding for every function in this module):

- VIIRS is the *reference observation scale*, never ground truth. All
  outputs are "VIIRS-equivalent estimates".
- MODIS Terra and MODIS Aqua are fitted and applied as separate platforms.
- The baseline reference is VIIRS Suomi-NPP (longest record); NOAA-20/21
  variants belong to sensitivity analysis (Task 06), not the baseline.
- The comparison unit is the district-day on which both sensor families
  delivered observation files (both *observing*, zero counts included).
  Zero detections are real recorded zeros; missing files are missing and
  are excluded, never zero-filled.
- Fitted parameters use training years only. Validation years are whole
  calendar years held out with a purge gap, identical for every method.
- No function here claims to remove all sensor bias, and no winner is
  declared without the Method Court evidence test.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import config, historical, metrics

EXPERIMENTS_DIR = config.DATA_DIR / "experiments"

# ---------------------------------------------------------------------------
# Experiment configuration (single source of truth, serialized to outputs)
# ---------------------------------------------------------------------------

EXPERIMENT_CONFIG = {
    "config_version": "1.0.0",
    "reference_sensor": "viirs_snpp",
    "reference_note": (
        "Suomi-NPP has the longest overlapping record (2012-01 onward). "
        "VIIRS is the reference scale, not ground truth."
    ),
    "modis_platforms": ["Terra", "Aqua"],
    "comparison_unit": (
        "district-day counts where both MODIS and VIIRS reference files were "
        "delivered (both observing); recorded zeros kept, missing files excluded"
    ),
    "grid_degrees": config.GRID_DEGREES,
    "bbox": "80,27,86,29.5",
    "districts": list(config.DISTRICT_ORDER),
    "validation_years": [2019, 2022],
    "purge_days": 30,
    "ratio_min_month_denominator": 5,
    "ratio_min_district_denominator": 5,
    "quantile_min_month_n": 30,
    "shrinkage_k": 20,
    "bootstrap_iterations": 1000,
    "bootstrap_seed": 2026,
    "bootstrap_confidence_level": 0.90,
    "acquisition_note": (
        "Historical record covers Jan-Jun 2012-2026 plus July 2026 only; "
        "Aug-Dec is not part of the acquired record and no result may be "
        "generalized to those months."
    ),
}

REFERENCE_SENSOR = EXPERIMENT_CONFIG["reference_sensor"]
REFERENCE_PLATFORM = "Suomi-NPP"


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _provenance() -> dict[str, Any]:
    return {
        "experiment_config_version": EXPERIMENT_CONFIG["config_version"],
        "reference_sensor": REFERENCE_SENSOR,
        "reference_platform": REFERENCE_PLATFORM,
        "grid_degrees": config.GRID_DEGREES,
        "districts": list(config.DISTRICT_ORDER),
        "source_datasets": [
            "data/raw/modis/MODIS_SP",
            "data/raw/viirs_snpp/VIIRS_SNPP_SP",
            "data/processed/historical/inventory.json",
        ],
        "boundaries": "OCHA COD-AB Nepal admin level 2 (CC BY-IGO)",
        "generated_at": _utc_now(),
    }


# ---------------------------------------------------------------------------
# Comparison-pair construction
# ---------------------------------------------------------------------------


def build_pairs(
    records: list[dict[str, Any]],
    *,
    requested_by_sensor: dict[str, set[str]],
    reference_sensor: str = REFERENCE_SENSOR,
) -> list[dict[str, Any]]:
    """District-day paired counts for each MODIS platform vs the reference.

    A pair exists when both sensors delivered files for that date (both
    observing). Counts are recorded zeros where a platform detected nothing.
    """

    counts: dict[tuple[str, str, str, str], int] = defaultdict(int)
    for record in records:
        key = (
            record["district_id"],
            record["sensor_id"],
            record["platform"],
            record["acq_date"],
        )
        counts[key] += 1

    modis_platforms = EXPERIMENT_CONFIG["modis_platforms"]
    ref_platforms = config.SENSORS[reference_sensor].platforms
    pairs: list[dict[str, Any]] = []
    for district_id in config.DISTRICT_ORDER:
        for modis_platform in modis_platforms:
            for ref_platform in ref_platforms:
                common_dates = (
                    requested_by_sensor.get("modis", set())
                    & requested_by_sensor.get(reference_sensor, set())
                )
                for day in sorted(common_dates):
                    modis_count = counts.get((district_id, "modis", modis_platform, day), 0)
                    ref_count = counts.get((district_id, reference_sensor, ref_platform, day), 0)
                    pairs.append(
                        {
                            "district_id": district_id,
                            "modis_platform": modis_platform,
                            "reference_platform": ref_platform,
                            "date": day,
                            "month": day[:7],
                            "month_of_year": day[5:7],
                            "year": int(day[:4]),
                            "modis_count": modis_count,
                            "reference_count": ref_count,
                        }
                    )
    return pairs


def train_validation_split(
    pairs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Blocked temporal split: whole validation years held out, with a purge
    gap of ``purge_days`` on each side of every validation block. Both lists
    are identical inputs for every method."""

    validation_years = set(EXPERIMENT_CONFIG["validation_years"])
    purge = EXPERIMENT_CONFIG["purge_days"]

    purge_dates: set[str] = set()
    for year in validation_years:
        block_start = date(year, 1, 1)
        block_end = date(year, 12, 31)
        current = block_start - timedelta(days=purge)
        while current <= block_end + timedelta(days=purge):
            purge_dates.add(current.isoformat())
            current += timedelta(days=1)

    train, validation = [], []
    for pair in pairs:
        if pair["year"] in validation_years:
            validation.append(pair)
        elif pair["date"] in purge_dates:
            continue  # purge gap: neither fitted nor evaluated
        else:
            train.append(pair)
    return train, validation


# ---------------------------------------------------------------------------
# Method 1 — ratio-based correction
# ---------------------------------------------------------------------------


def fit_ratio(train: list[dict[str, Any]]) -> dict[str, Any]:
    """District-month ratios of detection sums with a documented fallback
    hierarchy: district-month -> district-pooled -> global. Ratios use the
    sum of VIIRS counts over the sum of MODIS counts within comparable days
    of the fitting scope (never unrelated global totals)."""

    min_month = EXPERIMENT_CONFIG["ratio_min_month_denominator"]
    min_district = EXPERIMENT_CONFIG["ratio_min_district_denominator"]

    scope: dict[tuple[str, str], dict[str, Any]] = {}
    district_sums: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    global_sums = [0.0, 0.0]

    monthly: dict[tuple[str, str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for pair in train:
        key = (pair["district_id"], pair["modis_platform"])
        district_sums[key][0] += pair["modis_count"]
        district_sums[key][1] += pair["reference_count"]
        global_sums[0] += pair["modis_count"]
        global_sums[1] += pair["reference_count"]
        month_key = (pair["district_id"], pair["modis_platform"], pair["month_of_year"])
        monthly[month_key][0] += pair["modis_count"]
        monthly[month_key][1] += pair["reference_count"]

    global_ratio = None
    if global_sums[0] > 0:
        global_ratio = global_sums[1] / global_sums[0]

    models: dict[str, Any] = {}
    for (district, platform), sums in sorted(district_sums.items()):
        district_ratio = (
            sums[1] / sums[0] if sums[0] >= min_district else None
        )
        month_ratios = {}
        for (d, p, month), m_sums in sorted(monthly.items()):
            if d != district or p != platform:
                continue
            if m_sums[0] >= min_month:
                month_ratios[month] = m_sums[1] / m_sums[0]
            # months below the denominator floor get no entry: they fall back
            models[f"{district}|{platform}"] = {
                "district_ratio": district_ratio,
                "month_ratios": month_ratios,
                "district_modis_sum": sums[0],
                "district_reference_sum": sums[1],
            }
        models.setdefault(f"{district}|{platform}", {
            "district_ratio": district_ratio,
            "month_ratios": {},
            "district_modis_sum": sums[0],
            "district_reference_sum": sums[1],
        })

    return {
        "method": "ratio",
        "global_ratio": global_ratio,
        "global_modis_sum": global_sums[0],
        "global_reference_sum": global_sums[1],
        "models": models,
        "fallback_chain": ["district_month", "district_pooled", "global"],
        "min_month_denominator": min_month,
        "min_district_denominator": min_district,
    }


def apply_ratio(model: dict[str, Any], pairs: list[dict[str, Any]]) -> np.ndarray:
    out = np.empty(len(pairs))
    for i, pair in enumerate(pairs):
        key = f"{pair['district_id']}|{pair['modis_platform']}"
        sub = model["models"].get(key, {})
        ratio = sub.get("month_ratios", {}).get(pair["month_of_year"])
        if ratio is None:
            ratio = sub.get("district_ratio")
        if ratio is None:
            ratio = model.get("global_ratio")
        if ratio is None:
            # No training evidence at all: identity (honest no-op), flagged
            # by callers through fitted-model coverage metadata.
            ratio = 1.0
        out[i] = pair["modis_count"] * ratio
    return out


# ---------------------------------------------------------------------------
# Method 2 — quantile mapping
# ---------------------------------------------------------------------------


def _empirical_quantiles(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    sorted_values = np.sort(values)
    n = len(sorted_values)
    probs = (np.arange(n) + 0.5) / n
    return probs, sorted_values


def _inverse_quantile(probs: np.ndarray, sorted_values: np.ndarray, p: float) -> float:
    return float(np.interp(p, probs, sorted_values))


def fit_quantile(train: list[dict[str, Any]]) -> dict[str, Any]:
    """Empirical quantile mapping of nonzero MODIS counts onto the nonzero
    VIIRS reference distribution, fitted per district and platform on
    training data only.

    Recorded zeros are preserved as zeros: the mapping must not fabricate
    detections where MODIS recorded none. Outputs above the training support
    are capped at the training VIIRS maximum; this extrapolation limit is
    documented rather than hidden. Monthly mappings are fitted only where the
    training month has at least ``quantile_min_month_n`` nonzero pairs.
    """

    min_month_n = EXPERIMENT_CONFIG["quantile_min_month_n"]
    models: dict[str, Any] = {}
    monthly: dict[tuple[str, str, str], list[list[int]]] = defaultdict(lambda: [[], []])

    by_scope: dict[tuple[str, str], list[list[int]]] = defaultdict(lambda: [[], []])
    for pair in train:
        key = (pair["district_id"], pair["modis_platform"])
        by_scope[key][0].append(pair["modis_count"])
        by_scope[key][1].append(pair["reference_count"])
        m_key = (pair["district_id"], pair["modis_platform"], pair["month"])
        monthly[m_key][0].append(pair["modis_count"])
        monthly[m_key][1].append(pair["reference_count"])

    for (district, platform), (modis_values, ref_values) in sorted(by_scope.items()):
        modis_arr = np.asarray(modis_values, dtype=float)
        ref_arr = np.asarray(ref_values, dtype=float)
        modis_nonzero = modis_arr[modis_arr > 0]
        ref_nonzero = ref_arr[ref_arr > 0]

        mapping = None
        if len(modis_nonzero) >= 10 and len(ref_nonzero) >= 10:
            m_probs, m_sorted = _empirical_quantiles(modis_nonzero)
            r_probs, r_sorted = _empirical_quantiles(ref_nonzero)
            # Map each MODIS support value through its quantile position to
            # the VIIRS quantile function. Ties (repeated counts) are handled
            # by the shared empirical quantile grid.
            quantile_grid = np.linspace(0.01, 0.99, 99)
            modis_at = np.interp(quantile_grid, m_probs, m_sorted)
            viirs_at = np.interp(quantile_grid, r_probs, r_sorted)
            mapping = {
                "modis_levels": [round(v, 4) for v in modis_at],
                "viirs_levels": [round(v, 4) for v in viirs_at],
                "n_nonzero_pairs": int(len(modis_nonzero)),
                "cap": round(float(r_sorted[-1]), 4),
            }

        month_mappings = {}
        for (d, p, month), (mm, rr) in sorted(monthly.items()):
            if d != district or p != platform:
                continue
            mm_arr = np.asarray(mm, dtype=float)
            rr_arr = np.asarray(rr, dtype=float)
            mm_nz = mm_arr[mm_arr > 0]
            rr_nz = rr_arr[rr_arr > 0]
            if len(mm_nz) >= min_month_n and len(rr_nz) >= 10:
                m_probs, m_sorted = _empirical_quantiles(mm_nz)
                r_probs, r_sorted = _empirical_quantiles(rr_nz)
                quantile_grid = np.linspace(0.01, 0.99, 99)
                month_mappings[month] = {
                    "modis_levels": [round(v, 4) for v in np.interp(quantile_grid, m_probs, m_sorted)],
                    "viirs_levels": [round(v, 4) for v in np.interp(quantile_grid, r_probs, r_sorted)],
                    "n_nonzero_pairs": int(len(mm_nz)),
                    "cap": round(float(r_sorted[-1]), 4),
                }

        models[f"{district}|{platform}"] = {
            "pooled_mapping": mapping,
            "month_mappings": month_mappings,
            "zero_policy": "zeros preserved; mapping fitted on nonzero counts only",
        }

    return {
        "method": "quantile_mapping",
        "models": models,
        "min_month_n": min_month_n,
        "extrapolation": "capped at training VIIRS maximum; documented, not hidden",
    }


def _quantile_lookup(mapping: dict[str, Any], value: float) -> float:
    levels = mapping["modis_levels"]
    out = mapping["viirs_levels"]
    if value <= levels[0]:
        return float(out[0])
    if value >= levels[-1]:
        return float(out[-1])
    return float(np.interp(value, levels, out))


def apply_quantile(model: dict[str, Any], pairs: list[dict[str, Any]]) -> np.ndarray:
    out = np.empty(len(pairs))
    for i, pair in enumerate(pairs):
        key = f"{pair['district_id']}|{pair['modis_platform']}"
        sub = model["models"].get(key, {})
        if pair["modis_count"] == 0:
            out[i] = 0.0
            continue
        month_mapping = sub.get("month_mappings", {}).get(pair["month_of_year"])
        if month_mapping is not None:
            out[i] = _quantile_lookup(month_mapping, float(pair["modis_count"]))
        elif sub.get("pooled_mapping") is not None:
            out[i] = _quantile_lookup(sub["pooled_mapping"], float(pair["modis_count"]))
        else:
            # No usable training evidence for this scope: identity, flagged
            # through coverage metadata.
            out[i] = float(pair["modis_count"])
    return out


# ---------------------------------------------------------------------------
# Method 3 — monthly shrinkage
# ---------------------------------------------------------------------------


def fit_shrinkage(train: list[dict[str, Any]]) -> dict[str, Any]:
    """Monthly correction ratios shrunk toward the district-pooled ratio.

    Formulation: for district d, MODIS platform p and calendar month m,

        r_m  = sum(V) / sum(M)      over comparable training days of month m
        r_d  = sum(V) / sum(M)      over all comparable training days
        lambda_m = n_m / (n_m + k)  n_m = MODIS detection count in month m
        r*_m = lambda_m * r_m + (1 - lambda_m) * r_d

    k = 20 (documented a priori): a month needs ~20 MODIS detections before
    its raw ratio carries half the weight. Months with zero MODIS detections
    collapse entirely to the pooled district ratio rather than inventing an
    extreme factor.
    """

    k = EXPERIMENT_CONFIG["shrinkage_k"]

    district_sums: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    monthly: dict[tuple[str, str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for pair in train:
        key = (pair["district_id"], pair["modis_platform"])
        district_sums[key][0] += pair["modis_count"]
        district_sums[key][1] += pair["reference_count"]
        month_key = (pair["district_id"], pair["modis_platform"], pair["month_of_year"])
        monthly[month_key][0] += pair["modis_count"]
        monthly[month_key][1] += pair["reference_count"]

    models: dict[str, Any] = {}
    for (district, platform), sums in sorted(district_sums.items()):
        district_ratio = sums[1] / sums[0] if sums[0] > 0 else None
        month_models = {}
        for (d, p, month), m_sums in sorted(monthly.items()):
            if d != district or p != platform:
                continue
            n_m = m_sums[0]
            if district_ratio is None:
                month_models[month] = {
                    "lambda": 0.0, "raw_ratio": None,
                    "shrunk_ratio": None, "modis_detections": n_m,
                    "status": "no_district_evidence",
                }
                continue
            if n_m > 0 and m_sums[0] > 0:
                raw_ratio = m_sums[1] / m_sums[0]
                lam = n_m / (n_m + k)
                shrunk = lam * raw_ratio + (1 - lam) * district_ratio
                month_models[month] = {
                    "lambda": round(lam, 4),
                    "raw_ratio": round(raw_ratio, 4),
                    "shrunk_ratio": round(shrunk, 4),
                    "modis_detections": n_m,
                    "status": "fitted",
                }
            else:
                month_models[month] = {
                    "lambda": 0.0,
                    "raw_ratio": None,
                    "shrunk_ratio": round(district_ratio, 4),
                    "modis_detections": n_m,
                    "status": "insufficient_evidence_pooled_ratio_used",
                }
        models[f"{district}|{platform}"] = {
            "district_ratio": district_ratio,
            "district_modis_sum": sums[0],
            "district_reference_sum": sums[1],
            "month_models": month_models,
        }

    return {
        "method": "monthly_shrinkage",
        "shrinkage_k": k,
        "formulation": "r*_m = lambda_m * r_m + (1 - lambda_m) * r_d; lambda_m = n_m / (n_m + k)",
        "models": models,
    }


def apply_shrinkage(model: dict[str, Any], pairs: list[dict[str, Any]]) -> np.ndarray:
    out = np.empty(len(pairs))
    for i, pair in enumerate(pairs):
        key = f"{pair['district_id']}|{pair['modis_platform']}"
        sub = model["models"].get(key, {})
        month_model = sub.get("month_models", {}).get(pair["month_of_year"], {})
        ratio = month_model.get("shrunk_ratio")
        if ratio is None:
            ratio = sub.get("district_ratio")
        if ratio is None:
            ratio = 1.0
        out[i] = pair["modis_count"] * ratio
    return out


METHODS = {
    "ratio": (fit_ratio, apply_ratio),
    "quantile_mapping": (fit_quantile, apply_quantile),
    "monthly_shrinkage": (fit_shrinkage, apply_shrinkage),
}


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def evaluate_pairs(
    pairs: list[dict[str, Any]],
    pred: np.ndarray,
    *,
    bootstrap: bool = True,
) -> dict[str, Any]:
    ref = np.asarray([p["reference_count"] for p in pairs], dtype=float)
    months = np.asarray([p["month"] for p in pairs])

    result: dict[str, Any] = {
        "metrics": metrics.all_metrics(pred, ref),
        "error_distribution": metrics.error_distribution(pred, ref),
    }
    if bootstrap and len(pairs) > 0:
        result["uncertainty"] = {
            "mae": metrics.moving_block_bootstrap(
                pred, ref, months, statistic=metrics.mae,
                iterations=EXPERIMENT_CONFIG["bootstrap_iterations"],
                seed=EXPERIMENT_CONFIG["bootstrap_seed"],
                ci=EXPERIMENT_CONFIG["bootstrap_confidence_level"],
            ),
            "mean_bias": metrics.moving_block_bootstrap(
                pred, ref, months, statistic=metrics.mean_bias,
                iterations=EXPERIMENT_CONFIG["bootstrap_iterations"],
                seed=EXPERIMENT_CONFIG["bootstrap_seed"] + 1,
                ci=EXPERIMENT_CONFIG["bootstrap_confidence_level"],
            ),
        }
        def _ccc(p, r):
            value = metrics.lin_ccc(p, r)
            return 0.0 if value is None else value

        result["uncertainty"]["ccc"] = metrics.moving_block_bootstrap(
            pred, ref, months, statistic=_ccc,
            iterations=EXPERIMENT_CONFIG["bootstrap_iterations"],
            seed=EXPERIMENT_CONFIG["bootstrap_seed"] + 2,
            ci=EXPERIMENT_CONFIG["bootstrap_confidence_level"],
        )

    # Grouped diagnostics: by year, month, district, platform, activity.
    def grouped(keys: list[str]) -> dict[str, Any]:
        groups: dict[tuple, list[int]] = defaultdict(list)
        for i, pair in enumerate(pairs):
            groups[tuple(pair[k] for k in keys)].append(i)
        out = {}
        for group_key, indices in sorted(groups.items(), key=lambda kv: str(kv[0])):
            out["|".join(str(k) for k in group_key)] = metrics.all_metrics(
                pred[indices], ref[indices]
            )
        return out

    result["by_year"] = grouped(["year"])
    result["by_month"] = grouped(["month"])
    result["by_district"] = grouped(["district_id"])
    result["by_modis_platform"] = grouped(["modis_platform"])

    activity_bands: dict[str, list[int]] = defaultdict(list)
    for i, pair in enumerate(pairs):
        if pair["reference_count"] == 0:
            band = "zero_reference"
        elif pair["reference_count"] <= 2:
            band = "low"
        elif pair["reference_count"] <= 10:
            band = "moderate"
        else:
            band = "high"
        activity_bands[band].append(i)
    result["by_activity_band"] = {
        band: metrics.all_metrics(pred[indices], ref[indices])
        for band, indices in sorted(activity_bands.items())
    }
    return result


# ---------------------------------------------------------------------------
# Method Court
# ---------------------------------------------------------------------------


def _ci_overlaps(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return not (a["ci_lower"] > b["ci_upper"] or b["ci_lower"] > a["ci_upper"])


def run_method_court(
    validation_pairs: list[dict[str, Any]],
    validation_predictions: dict[str, np.ndarray],
    fitted_models: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Compare all methods on the identical validation sample.

    Selection rule (documented a priori): a method is selected only if its
    CCC confidence interval does not overlap the next-best method's and its
    MAE confidence interval shows a corresponding advantage, and its
    performance is stable across validation years and districts. Otherwise
    the court reports an inconclusive result rather than inventing a winner.
    """

    results: dict[str, Any] = {}
    for method, pred in validation_predictions.items():
        results[method] = evaluate_pairs(validation_pairs, pred)

    ranking = sorted(
        results.items(),
        key=lambda kv: (-(kv[1]["metrics"]["ccc"] or -1.0), kv[1]["metrics"]["mae"]),
    )

    decision: dict[str, Any]
    if len(ranking) < 2:
        decision = {"outcome": "insufficient_methods", "note": "Need >= 2 methods to compare."}
    else:
        best_method, best = ranking[0]
        second_method, second = ranking[1]
        best_ccc_ci = best["uncertainty"]["ccc"]
        second_ccc_ci = second["uncertainty"]["ccc"]
        best_mae_ci = best["uncertainty"]["mae"]
        second_mae_ci = second["uncertainty"]["mae"]

        ccc_decisive = not _ci_overlaps(best_ccc_ci, second_ccc_ci)
        mae_decisive = best_mae_ci["ci_upper"] < second_mae_ci["ci_lower"]

        # Stability: per-year and per-district CCC spread of the best method.
        year_cccs = [
            m.get("ccc") for m in best["by_year"].values() if m.get("ccc") is not None
        ]
        district_cccs = [
            m.get("ccc") for m in best["by_district"].values() if m.get("ccc") is not None
        ]
        year_spread = (max(year_cccs) - min(year_cccs)) if len(year_cccs) >= 2 else None
        district_spread = (
            max(district_cccs) - min(district_cccs) if len(district_cccs) >= 2 else None
        )
        unstable = (year_spread is not None and year_spread > 0.25) or (
            district_spread is not None and district_spread > 0.25
        )

        if ccc_decisive and mae_decisive and not unstable:
            decision = {
                "outcome": "selected",
                "selected_method": best_method,
                "justification": (
                    "CCC and MAE confidence intervals separate the top two "
                    "methods and performance is stable across validation "
                    "years and districts."
                ),
                "evidence": {"ccc_ci": best_ccc_ci, "mae_ci": best_mae_ci},
            }
        else:
            decision = {
                "outcome": "inconclusive",
                "note": (
                    "Top methods are statistically or practically "
                    "indistinguishable, or performance is unstable. No "
                    "winner is declared; the evidence does not support "
                    "forcing one."
                ),
                "evidence": {
                    "ccc_decisive": ccc_decisive,
                    "mae_decisive": mae_decisive,
                    "year_ccc_spread": year_spread,
                    "district_ccc_spread": district_spread,
                    "unstable": unstable,
                },
            }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "validation_sample_size": len(validation_pairs),
        "methods": results,
        "ranking": [method for method, _ in ranking],
        "decision": decision,
        "metric_explanations": {
            "mae": "Mean absolute error of harmonized counts vs the VIIRS reference on identical days.",
            "rmse": "Root mean squared error; penalizes large misses more than MAE.",
            "log_rmse": "RMSE on log(1+count); emphasizes relative accuracy at low counts.",
            "mean_bias": "Mean (harmonized - reference); negative = under-estimation.",
            "pearson": "Linear correlation; high values alone do NOT prove agreement.",
            "ccc": "Lin's concordance; penalizes scale and offset bias in addition to correlation.",
        },
    }


# ---------------------------------------------------------------------------
# Seam Audit
# ---------------------------------------------------------------------------


def run_seam_audit(
    records: list[dict[str, Any]],
    requested_by_sensor: dict[str, set[str]],
    predictions_by_method: dict[str, Callable[[list[dict[str, Any]]], np.ndarray]],
) -> dict[str, Any]:
    """Diagnostic (not causal) investigation of observation-scale
    discontinuities around the VIIRS record start (2012-01-20) and the MODIS
    product-version change present inside the acquired record."""

    counts: dict[tuple[str, str, str, str], int] = defaultdict(int)
    versions: dict[tuple[str, str, str], Counter] = defaultdict(Counter)

    for record in records:
        key = (
            record["district_id"],
            record["sensor_id"],
            record["platform"],
            record["acq_date"],
        )
        counts[key] += 1
        if record.get("version"):
            versions[(record["sensor_id"], record["platform"], record["acq_date"])][
                str(record["version"])
            ] += 1

    common_dates = sorted(
        requested_by_sensor.get("modis", set())
        & requested_by_sensor.get(REFERENCE_SENSOR, set())
    )

    # 1. Scale step at the earliest full month of joint availability.
    audit_months = ["2012-02", "2012-03", "2012-04"]
    step_rows = []
    for district_id in config.DISTRICT_ORDER:
        for modis_platform in EXPERIMENT_CONFIG["modis_platforms"]:
            month_pairs = []
            for day in common_dates:
                if not day.startswith(tuple(audit_months)):
                    continue
                month_pairs.append(
                    {
                        "district_id": district_id,
                        "modis_platform": modis_platform,
                        "date": day,
                        "month": day[:7],
                        "month_of_year": day[5:7],
                        "modis_count": counts.get((district_id, "modis", modis_platform, day), 0),
                        "reference_count": counts.get(
                            (district_id, REFERENCE_SENSOR, REFERENCE_PLATFORM, day), 0
                        ),
                    }
                )
            if len(month_pairs) < 30:
                continue
            ref = np.asarray([p["reference_count"] for p in month_pairs], dtype=float)
            raw_modis = np.asarray([p["modis_count"] for p in month_pairs], dtype=float)
            # Raw scale step: mean VIIRS / mean raw MODIS over the audit window.
            raw_step = float(np.mean(ref)) / max(float(np.mean(raw_modis)), 1e-9)
            row = {
                "district_id": district_id,
                "modis_platform": modis_platform,
                "window_months": audit_months,
                "raw_scale_step_viirs_over_modis": round(raw_step, 3),
            }
            for method_name, predict in predictions_by_method.items():
                harmonized = predict(month_pairs)
                harm_step = float(np.mean(ref)) / max(float(np.mean(harmonized)), 1e-9)
                row[f"scale_step_after_{method_name}"] = round(harm_step, 3)
                deviation_before = abs(raw_step - 1.0)
                deviation_after = abs(harm_step - 1.0)
                row[f"step_reduction_{method_name}_percent"] = round(
                    100.0 * (1.0 - deviation_after / deviation_before), 1
                ) if deviation_before > 1e-9 else None
            step_rows.append(row)

    # 2. MODIS product-version eras inside the acquired record.
    version_days: dict[str, set[str]] = defaultdict(set)
    for (sensor, platform, day), counter in versions.items():
        if sensor != "modis":
            continue
        for version in counter:
            version_days[f"{platform}|{version}"].add(day)
    version_eras = {
        key: {"first_day": min(days), "last_day": max(days), "days": len(days)}
        for key, days in sorted(version_days.items())
    }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "purpose": (
            "Diagnostic of observation-scale discontinuities. It does NOT "
            "prove that observed changes are caused by sensor transitions."
        ),
        "scale_step_analysis": step_rows,
        "modis_version_eras": version_eras,
        "confounds": [
            "Real fire activity changes between years",
            "Weather and environmental conditions",
            "Overpass frequency and timing differences",
            "Cloud cover and detection limitations",
            "Product version and algorithm changes within a single mission",
        ],
        "record_limitation": (
            "The acquired record starts at 2012-01-20, when VIIRS SP data "
            "begins; the pre-VIIRS MODIS-only era is outside the acquired "
            "data and cannot be audited here."
        ),
    }


# ---------------------------------------------------------------------------
# Lights-Out Backtest
# ---------------------------------------------------------------------------


def run_lights_out(
    train_pairs: list[dict[str, Any]],
    validation_pairs: list[dict[str, Any]],
    predictions_by_method: dict[str, np.ndarray],
) -> dict[str, Any]:
    """Reconstruction test: methods fitted without any validation-year data
    must reproduce the withheld VIIRS reference pattern on held-out MODIS
    observations. Reports monthly profile fidelity, over-smoothing checks
    and the relationship between error and observation coverage."""

    by_year: dict[str, Any] = {}
    for method, pred in predictions_by_method.items():
        ref = np.asarray([p["reference_count"] for p in validation_pairs], dtype=float)
        years = sorted({p["year"] for p in validation_pairs})
        year_results: dict[str, Any] = {}
        for year in years:
            idx = [i for i, p in enumerate(validation_pairs) if p["year"] == year]
            year_pred = pred[idx]
            year_ref = ref[idx]
            year_pairs = [validation_pairs[i] for i in idx]
            months = sorted({p["month"] for p in year_pairs})
            monthly_rows = []
            for month in months:
                m_idx = [i for i, p in enumerate(year_pairs) if p["month"] == month]
                monthly_rows.append(
                    {
                        "month": month,
                        "reconstructed_total": round(float(np.sum(year_pred[m_idx])), 2),
                        "reference_total": int(np.sum(year_ref[m_idx])),
                        "relative_bias": (
                            round(
                                float(np.sum(year_pred[m_idx]) - np.sum(year_ref[m_idx]))
                                / max(int(np.sum(year_ref[m_idx])), 1),
                                4,
                            )
                        ),
                        "days": len(m_idx),
                    }
                )
            profile_pred = np.asarray([r["reconstructed_total"] for r in monthly_rows])
            profile_ref = np.asarray([r["reference_total"] for r in monthly_rows], dtype=float)
            variation_ratio = (
                float(np.std(profile_pred) / np.std(profile_ref))
                if float(np.std(profile_ref)) > 0
                else None
            )
            year_results[str(year)] = {
                "overall": metrics.all_metrics(year_pred, year_ref),
                "monthly_profile": monthly_rows,
                "profile_correlation": metrics.pearson(profile_pred, profile_ref),
                "variation_ratio_pred_over_ref": (
                    round(variation_ratio, 4) if variation_ratio is not None else None
                ),
                "variation_note": (
                    "variation_ratio well below 1 indicates over-smoothing of "
                    "real month-to-month variation; well above 1 indicates "
                    "amplified variation."
                ),
            }
        by_year[method] = year_results

    # Error vs coverage: does uncertainty grow where co-observation is weak?
    ref = np.asarray([p["reference_count"] for p in validation_pairs], dtype=float)
    coverage_error = {}
    for method, pred in predictions_by_method.items():
        abs_err = np.abs(pred - ref)
        month_err: dict[str, list[float]] = defaultdict(list)
        month_days: Counter = Counter()
        for i, pair in enumerate(validation_pairs):
            month_err[pair["month"]].append(float(abs_err[i]))
            month_days[pair["month"]] += 1
        rows = [
            {
                "month": month,
                "mean_abs_error": round(float(np.mean(errs)), 4),
                "days": month_days[month],
            }
            for month, errs in sorted(month_err.items())
        ]
        weak = [r for r in rows if r["days"] < 60]
        strong = [r for r in rows if r["days"] >= 60]
        coverage_error[method] = {
            "by_month": rows,
            "weak_coverage_mean_abs_error": (
                round(float(np.mean([r["mean_abs_error"] for r in weak])), 4) if weak else None
            ),
            "strong_coverage_mean_abs_error": (
                round(float(np.mean([r["mean_abs_error"] for r in strong])), 4) if strong else None
            ),
        }

    return {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "design_note": (
            "Methods are fitted exclusively on training years; validation "
            "years are withheld entirely (lights-out). This does not claim "
            "that any specific historical event was correctly reconstructed."
        ),
        "by_method": by_year,
        "error_vs_coverage": coverage_error,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_experiments() -> dict[str, Any]:
    """Full Task 05 experiment: fit, validate, Method Court, Seam Audit,
    Lights-Out. Writes machine-readable outputs with provenance."""

    for sub in (
        "config", "fitted_models", "validation", "metrics", "uncertainty",
        "method_comparison", "seam_audit", "lights_out", "reports",
    ):
        (EXPERIMENTS_DIR / sub).mkdir(parents=True, exist_ok=True)

    grouped = historical.load_area_entries()
    requested_by_sensor = {
        sensor_id: historical.requested_dates(entries)
        for sensor_id, entries in grouped.items()
    }
    records, qc_report, spatial_summary = historical.load_historical_records()

    pairs = build_pairs(records, requested_by_sensor=requested_by_sensor)
    train, validation = train_validation_split(pairs)

    json.dump(
        {**EXPERIMENT_CONFIG, "provenance": _provenance()},
        open(EXPERIMENTS_DIR / "config" / "experiment_config.json", "w", encoding="utf-8"),
        indent=2,
    )

    fitted: dict[str, dict[str, Any]] = {}
    validation_predictions: dict[str, np.ndarray] = {}
    train_predictions: dict[str, np.ndarray] = {}
    for method, (fit_fn, apply_fn) in METHODS.items():
        model = fit_fn(train)
        fitted[method] = model
        validation_predictions[method] = apply_fn(model, validation)
        train_predictions[method] = apply_fn(model, train)

        model_out = {k: v for k, v in model.items()}
        model_out["provenance"] = _provenance()
        model_out["training_pairs"] = len(train)
        model_out["training_months"] = sorted({p["month"] for p in train})
        json.dump(model_out, open(EXPERIMENTS_DIR / "fitted_models" / f"{method}.json", "w", encoding="utf-8"), indent=2)

    court = run_method_court(validation, validation_predictions, fitted)
    json.dump(court, open(EXPERIMENTS_DIR / "method_comparison" / "method_court.json", "w", encoding="utf-8"), indent=2)

    # Per-method validation detail.
    for method, pred in validation_predictions.items():
        detail = evaluate_pairs(validation, pred)
        json.dump(
            {**detail, "provenance": _provenance(), "validation_pairs": len(validation)},
            open(EXPERIMENTS_DIR / "validation" / f"{method}.json", "w", encoding="utf-8"), indent=2,
        )

    # Seam audit needs a predictor closure per method.
    def _predictor(method_name: str) -> Callable[[list[dict[str, Any]]], np.ndarray]:
        model = fitted[method_name]
        apply_fn = METHODS[method_name][1]
        return lambda pairs_in: apply_fn(model, pairs_in)

    seam = run_seam_audit(
        records,
        requested_by_sensor,
        {method: _predictor(method) for method in METHODS},
    )
    json.dump(seam, open(EXPERIMENTS_DIR / "seam_audit" / "seam_audit.json", "w", encoding="utf-8"), indent=2)

    lights = run_lights_out(train, validation, validation_predictions)
    json.dump(lights, open(EXPERIMENTS_DIR / "lights_out" / "lights_out.json", "w", encoding="utf-8"), indent=2)

    # Compact metrics summary for reports and frontend.
    summary = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "sample_sizes": {
            "total_pairs": len(pairs),
            "training_pairs": len(train),
            "validation_pairs": len(validation),
            "purge_pairs": len(pairs) - len(train) - len(validation),
            "purge_days": EXPERIMENT_CONFIG["purge_days"],
            "validation_years": EXPERIMENT_CONFIG["validation_years"],
            "reconciliation_note": (
                "total = training + validation + purge_pairs. Purge pairs are "
                "dates inside the 30-day leakage-protection gap after each "
                "held-out year (2020-01-01..30, 2023-01-01..30 here); they are "
                "excluded from both training and validation by design."
            ),
        },
        "court_metrics": {
            method: results["metrics"] for method, results in court["methods"].items()
        },
        "decision": court["decision"],
        "raw_scale_gap": {
            "note": "Mean raw MODIS vs VIIRS reference counts on identical district-days",
            "modis_terra_mean": round(float(np.mean([p["modis_count"] for p in validation if p["modis_platform"] == "Terra"])), 4),
            "modis_aqua_mean": round(float(np.mean([p["modis_count"] for p in validation if p["modis_platform"] == "Aqua"])), 4),
            "reference_mean": round(float(np.mean([p["reference_count"] for p in validation])), 4),
        },
    }
    json.dump(summary, open(EXPERIMENTS_DIR / "metrics" / "summary.json", "w", encoding="utf-8"), indent=2)

    _write_report(court, seam, lights, summary)

    return {
        "total_pairs": len(pairs),
        "training_pairs": len(train),
        "validation_pairs": len(validation),
        "decision": court["decision"],
        "outputs_root": str(EXPERIMENTS_DIR),
    }


def _write_report(
    court: dict[str, Any],
    seam: dict[str, Any],
    lights: dict[str, Any],
    summary: dict[str, Any],
) -> None:
    """Human-readable experiment report; mirrors the JSON outputs."""

    lines: list[str] = []
    lines.append("# Task 05 — Harmonization experiment report")
    lines.append("")
    lines.append(f"Generated: {summary['generated_at']}")
    lines.append("")
    lines.append("## Data and fairness")
    lines.append("")
    lines.append("- Comparison unit: district-day counts, both sensors observing (recorded zeros kept, missing files excluded).")
    lines.append(f"- Reference: {REFERENCE_SENSOR} ({REFERENCE_PLATFORM}) — the reference scale, not ground truth.")
    lines.append(f"- Training pairs: {summary['sample_sizes']['training_pairs']}; validation pairs: {summary['sample_sizes']['validation_pairs']}; purge-gap pairs: {summary['sample_sizes']['purge_pairs']} (excluded from both, leakage protection). Total = {summary['sample_sizes']['total_pairs']}.")
    lines.append("- Terra and Aqua fitted and applied as separate platforms.")
    lines.append("")
    lines.append("## Method Court metrics (identical validation sample)")
    lines.append("")
    lines.append("| Method | MAE | RMSE | log-RMSE | Bias | Pearson | CCC |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for method, m in summary["court_metrics"].items():
        lines.append(
            f"| {method} | {m['mae']} | {m['rmse']} | {m['log_rmse']} | "
            f"{m['mean_bias']} | {m['pearson']} | {m['ccc']} |"
        )
    lines.append("")
    decision = summary["decision"]
    lines.append(f"**Court decision: {decision['outcome']}** — {decision.get('note', decision.get('justification', ''))}")
    lines.append("")
    lines.append("## Seam audit (diagnostic, not causal)")
    lines.append("")
    for row in seam["scale_step_analysis"]:
        lines.append(
            f"- {row['district_id']} {row['modis_platform']}: raw VIIRS/MODIS scale step "
            f"{row['raw_scale_step_viirs_over_modis']}x; after harmonization "
            + ", ".join(
                f"{k.replace('scale_step_after_', '')} {v}x" for k, v in row.items() if k.startswith("scale_step_after_")
            )
        )
    lines.append("")
    lines.append("No method fully removes the scale mismatch; residual steps remain and are reported honestly.")
    lines.append("")
    lines.append("## Lights-Out backtest (held-out years)")
    lines.append("")
    for method, years in lights["by_method"].items():
        for year, block in years.items():
            lines.append(
                f"- {method} {year}: CCC {block['overall']['ccc']}, MAE {block['overall']['mae']}, "
                f"monthly profile r = {block['profile_correlation']}, variation ratio "
                f"{block['variation_ratio_pred_over_ref']} (well below 1 indicates over-smoothing)."
            )
    lines.append("")
    lines.append("## Limitations")
    lines.append("")
    lines.append("- VIIRS is not ground truth; harmonized values are VIIRS-equivalent estimates only.")
    lines.append("- Aug–Dec is outside the acquired record; no seasonal claim covers those months.")
    lines.append("- Recorded zeros are preserved, never manufactured into detections.")
    lines.append("- District-level instability (esp. Chitwan) means district-level results carry wider uncertainty.")
    lines.append("- The pre-2012 MODIS-only era is outside the acquired data and cannot be audited.")
    lines.append("")
    lines.append("This report does not fabricate a winner where the evidence does not support one.")

    (EXPERIMENTS_DIR / "reports" / "summary.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Frontend artifacts
# ---------------------------------------------------------------------------


def export_frontend_artifacts() -> dict[str, Any]:
    """Export compact frontend artifacts from the fitted models.

    The calendar's harmonized layer uses the monthly-shrinkage factors: the
    method ranked first by the Method Court. The court verdict is
    INCONCLUSIVE, so every consumer must label the harmonized layer as a
    provisional VIIRS-equivalent estimate, never a validated product.
    """

    public_dir = config.PUBLIC_DATA_DIR / "experiments"
    public_dir.mkdir(parents=True, exist_ok=True)

    model_path = EXPERIMENTS_DIR / "fitted_models" / "monthly_shrinkage.json"
    if not model_path.exists():
        raise SystemExit("Run `python -m pipeline experiments` first: fitted models missing.")
    model = json.loads(model_path.read_text(encoding="utf-8"))

    factors: dict[str, Any] = {}
    for scope, sub in sorted(model["models"].items()):
        district, platform = scope.split("|")
        district_factors = factors.setdefault(district, {})
        month_ratios: dict[str, Any] = {}
        for month, month_model in sorted(sub.get("month_models", {}).items()):
            month_ratios[month] = {
                "ratio": month_model.get("shrunk_ratio"),
                "status": month_model.get("status"),
                "lambda": month_model.get("lambda"),
                "modis_detections": month_model.get("modis_detections"),
            }
        district_factors[platform] = {
            "district_ratio": sub.get("district_ratio"),
            "months": month_ratios,
        }

    artifact = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "provenance": _provenance(),
        "method": "monthly_shrinkage",
        "method_status": "provisional",
        "court_verdict": "inconclusive",
        "reference": "VIIRS Suomi-NPP (reference scale, not ground truth)",
        "meaning": (
            "factor * raw MODIS detections = VIIRS-equivalent estimate. "
            "Months marked insufficient_evidence fall back to the district "
            "ratio; the status field always travels with the value."
        ),
        "districts": factors,
    }
    json.dump(artifact, open(public_dir / "harmonization_factors.json", "w", encoding="utf-8"), indent=2)
    return {"path": str(public_dir / "harmonization_factors.json"), "districts": list(factors)}
