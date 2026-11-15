"""Pre-2012 transferability testing and backcast decisions.

The seven-year-plus pre-2012 MODIS archive is genuine, but a MODIS-to-VIIRS
relationship fitted after 2012 cannot be assumed to hold in 2000-2011. This
module tests that assumption explicitly instead of asserting it.

Design
------
* Calibration observations are restricted to the post-2012 overlap
  (``min_date = 2012-01-20``, the first Suomi-NPP acquisition day). Pre-2012
  records are never used to fit a relationship against VIIRS observations
  that do not exist.
* Every region and every MODIS platform is calibrated independently. No
  district's factors are borrowed for another region.
* Temporal transferability uses *blocked* year splits with a 30-day purge
  gap: early years -> late years, late years -> early years, and
  leave-one-year-out. Random record-level splits are never the only evidence.
* All three existing methods (ratio, quantile mapping, monthly shrinkage) are
  evaluated on the identical held-out sample with MAE, RMSE, log-RMSE, bias,
  Pearson, CCC and moving-block bootstrap intervals.
* A method is called a winner only when its CCC interval separates from every
  other method and it also holds an MAE advantage and is stable in both
  directions. Otherwise the report says, in words, that no single method can
  be confidently identified.
* The final decision is SUPPORTED / LIMITED / UNSUPPORTED per region,
  platform and calendar month. Months with no overlap evidence (July-December,
  because the post-2012 acquisition is January-June only) are UNSUPPORTED.

The raw MODIS observations are never modified here. Estimates are written to
separate files and always carry method, calibration version, validation
period, transferability status, region/platform identity and uncertainty.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from . import config, experiments, geometry, historical, metrics, manifests, normalize, qc, spatial

HISTORICAL_DIR = config.PROCESSED_DIR / "historical"
PUBLIC_BACKCAST = config.PUBLIC_DATA_DIR / "experiments" / "backcast.json"
PUBLIC_ESTIMATES_DIR = config.PUBLIC_DATA_DIR / "historical"

CALIBRATION_VERSION = "2012-overlap-v1"
CALIBRATION_START = "2012-01-20"
# The estimate export covers the acquired pre-2012 record only. The MODIS
# observations between 1 and 19 January 2012 belong to the standard-processing
# (SP) series and stay on their native scale there; exporting them here too
# would publish two overlapping representations of the same days.
ESTIMATES_END = "2012-01-01"

TRANSFER_CONFIG: dict[str, Any] = {
    "calibration_start": CALIBRATION_START,
    "purge_days": experiments.EXPERIMENT_CONFIG["purge_days"],
    "min_years": 3,
    "min_validation_pairs": 120,
    "min_month_pairs": 30,
    "forward_train_fraction": 0.6,
    "ccc_supported": 0.50,
    "ccc_limited": 0.20,
    "max_abs_bias_ratio_supported": 0.60,
    "max_direction_mae_ratio": 2.0,
    "bootstrap_iterations": 600,
    "bootstrap_seed": 2026,
    "bootstrap_confidence_level": 0.90,
    "reference_sensor": experiments.REFERENCE_SENSOR,
    "methods": list(experiments.METHODS),
}

NO_CONFIDENT_WINNER = (
    "No single harmonization method can be confidently identified as the most "
    "reliable for this region."
)


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def requested_dates_by_region(
    entries_by_sensor: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, set[str]]]:
    """requested[region][sensor] = dates that region acquired.

    Region-scoped entries apply to their own region. Legacy Nepal entries
    (``region_id`` null) were requested on the shared Nepal bounding box and
    cover all Nepal study areas; they are never assigned to Thailand,
    Indonesia or Myanmar.
    """

    nepal = [
        rid for rid in config.REGION_ORDER if config.REGIONS[rid].country_code == "NPL"
    ]
    out: dict[str, dict[str, set[str]]] = {
        rid: {sid: set() for sid in config.SENSOR_ORDER} for rid in config.REGION_ORDER
    }
    for sensor_id, entries in entries_by_sensor.items():
        for entry in entries:
            dates = historical.requested_dates([entry])
            region_id = entry.get("region_id")
            targets = [region_id] if region_id in config.REGIONS else nepal
            for rid in targets:
                out[rid].setdefault(sensor_id, set()).update(dates)
    return out


def counts_for_entries(
    entries_by_sensor: dict[str, list[dict[str, Any]]],
) -> dict[tuple[str, str, str, str], int]:
    """Stream files and count detections per (region, sensor, platform, day).

    Counting per acquisition file keeps memory bounded on the full 2000-2026
    archive while still applying normalization, QC and exact polygon
    assignment. Chunk windows do not overlap, so per-file deduplication is the
    same key the full-record pass uses.
    """

    index = geometry.DistrictIndex(geometry.load_boundaries())
    counts: dict[tuple[str, str, str, str], int] = defaultdict(int)
    for sensor_id, entries in entries_by_sensor.items():
        for entry in entries:
            path = config.REPO_ROOT / entry["storage_path"]
            if not path.exists():
                continue
            records = normalize.normalize_file(path, sensor_id)
            clean, _ = qc.run_qc(records)
            assigned, _ = spatial.assign_study_areas(clean, index)
            for record in assigned:
                region_id = record.get("district_id")
                day = record.get("acq_date")
                if region_id and day:
                    counts[(region_id, sensor_id, record["platform"], day)] += 1
    return counts


def pairs_from_counts(
    counts: dict[tuple[str, str, str, str], int],
    requested_by_region: dict[str, dict[str, set[str]]],
) -> list[dict[str, Any]]:
    """District-day pairs: both sensors delivered a file for that date."""

    reference_sensor = experiments.REFERENCE_SENSOR
    reference_platforms = config.SENSORS[reference_sensor].platforms
    pairs: list[dict[str, Any]] = []
    for region_id in config.REGION_ORDER:
        region_dates = requested_by_region.get(region_id, {})
        common = region_dates.get("modis", set()) & region_dates.get(
            reference_sensor, set()
        )
        for modis_platform in experiments.EXPERIMENT_CONFIG["modis_platforms"]:
            for reference_platform in reference_platforms:
                for day in sorted(common):
                    pairs.append(
                        {
                            "district_id": region_id,
                            "modis_platform": modis_platform,
                            "reference_platform": reference_platform,
                            "date": day,
                            "month": day[:7],
                            "month_of_year": day[5:7],
                            "year": int(day[:4]),
                            "modis_count": counts.get(
                                (region_id, "modis", modis_platform, day), 0
                            ),
                            "reference_count": counts.get(
                                (
                                    region_id,
                                    reference_sensor,
                                    reference_platform,
                                    day,
                                ),
                                0,
                            ),
                        }
                    )
    return pairs


def _purge_dates(test_dates: set[str], purge: int) -> set[str]:
    """Every date within ``purge`` days of a held-out date.

    Training records in this band are dropped, so no fitted month can leak
    across the boundary of a validation block.
    """

    blocked: set[str] = set()
    for value in test_dates:
        centre = date.fromisoformat(value)
        for delta in range(-purge, purge + 1):
            blocked.add((centre + timedelta(days=delta)).isoformat())
    return blocked


def _split(
    pairs: list[dict[str, Any]],
    train_years: set[int],
    test_years: set[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    test = [p for p in pairs if p["year"] in test_years]
    purge = _purge_dates({p["date"] for p in test}, TRANSFER_CONFIG["purge_days"])
    train = [
        p
        for p in pairs
        if p["year"] in train_years and p["date"] not in purge
    ]
    return train, test


def _evaluate(
    train: list[dict[str, Any]],
    test: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, np.ndarray]]:
    """Fit every method on ``train`` and score it on ``test``.

    Returns the serializable result and the held-out prediction vectors (which
    are kept out of the JSON artifacts).
    """

    if not train or not test:
        return (
            {"validation_pairs": len(test), "training_pairs": len(train), "methods": {}},
            {},
        )
    ref = np.asarray([p["reference_count"] for p in test], dtype=float)
    blocks = np.asarray([p["month"] for p in test])
    out: dict[str, Any] = {
        "training_pairs": len(train),
        "validation_pairs": len(test),
        "validation_years": sorted({p["year"] for p in test}),
        "methods": {},
    }
    predictions: dict[str, np.ndarray] = {}
    for name, (fit_fn, apply_fn) in experiments.METHODS.items():
        model = fit_fn(train)
        pred = np.asarray(apply_fn(model, test), dtype=float)
        predictions[name] = pred
        score = {
            "metrics": metrics.all_metrics(pred, ref),
            "uncertainty": {
                "mae": metrics.moving_block_bootstrap(
                    pred,
                    ref,
                    blocks,
                    statistic=metrics.mae,
                    iterations=TRANSFER_CONFIG["bootstrap_iterations"],
                    seed=TRANSFER_CONFIG["bootstrap_seed"],
                    ci=TRANSFER_CONFIG["bootstrap_confidence_level"],
                ),
                "ccc": metrics.moving_block_bootstrap(
                    pred,
                    ref,
                    blocks,
                    statistic=lambda p, r: 0.0 if metrics.lin_ccc(p, r) is None else metrics.lin_ccc(p, r),
                    iterations=TRANSFER_CONFIG["bootstrap_iterations"],
                    seed=TRANSFER_CONFIG["bootstrap_seed"] + 1,
                    ci=TRANSFER_CONFIG["bootstrap_confidence_level"],
                ),
                "mean_bias": metrics.moving_block_bootstrap(
                    pred,
                    ref,
                    blocks,
                    statistic=metrics.mean_bias,
                    iterations=TRANSFER_CONFIG["bootstrap_iterations"],
                    seed=TRANSFER_CONFIG["bootstrap_seed"] + 2,
                    ci=TRANSFER_CONFIG["bootstrap_confidence_level"],
                ),
            },
        }
        out["methods"][name] = score
    return out, predictions


def _median(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return round(float(np.median(clean)), 4)


def _paired_method_evidence(
    test: list[dict[str, Any]],
    predictions: dict[str, np.ndarray],
) -> dict[str, Any]:
    if not test or len(predictions) < 2:
        return {}
    ref = np.asarray([p["reference_count"] for p in test], dtype=float)
    blocks = np.asarray([p["month"] for p in test])
    ranking = sorted(
        predictions,
        key=lambda m: (-(metrics.lin_ccc(predictions[m], ref) or -1.0), metrics.mae(predictions[m], ref)),
    )
    best = ranking[0]
    evidence: dict[str, Any] = {"ranking": ranking}
    for other in ranking[1:]:
        evidence[f"{best}_minus_{other}"] = metrics.paired_block_bootstrap_diff(
            predictions[best],
            predictions[other],
            ref,
            blocks,
            iterations=TRANSFER_CONFIG["bootstrap_iterations"],
            seed=TRANSFER_CONFIG["bootstrap_seed"] + 3,
            ci=TRANSFER_CONFIG["bootstrap_confidence_level"],
        )
    return evidence


def _month_statuses(
    held_out: list[dict[str, Any]],
    predictions: dict[str, np.ndarray],
    factors: dict[str, Any],
) -> dict[str, Any]:
    """Per month-of-year status from held-out evidence plus final factors."""

    by_month: dict[str, list[int]] = defaultdict(list)
    for index, pair in enumerate(held_out):
        by_month[pair["month_of_year"]].append(index)
    out: dict[str, Any] = {}
    for month in [f"{m:02d}" for m in range(1, 13)]:
        indices = by_month.get(month, [])
        factor = (factors.get(month) or {}).get("shrunk_ratio")
        years = {held_out[i]["year"] for i in indices}
        if len(indices) < TRANSFER_CONFIG["min_month_pairs"] or len(years) < 2:
            out[month] = {
                "status": "unsupported",
                "factor": None,
                "validation_pairs": len(indices),
                "reason": (
                    "No post-2012 overlap evidence across at least two years for "
                    "this calendar month in this region/platform; a "
                    "VIIRS-equivalent estimate cannot be supported."
                ),
                "uncertainty": None,
            }
            continue
        ref = np.asarray([held_out[i]["reference_count"] for i in indices], dtype=float)
        pred = np.asarray([predictions["best"][i] for i in indices], dtype=float)
        ccc = metrics.lin_ccc(pred, ref)
        mae = metrics.mae(pred, ref)
        bias = metrics.mean_bias(pred, ref)
        ref_mean = float(np.mean(ref)) if len(ref) else 0.0
        bias_ratio = abs(bias) / ref_mean if ref_mean > 0 else None
        if ccc is None:
            status = "unsupported"
            reason = "Held-out predictions are constant or uncorrelated in this month."
        elif ccc >= TRANSFER_CONFIG["ccc_supported"] and (
            bias_ratio is None or bias_ratio <= TRANSFER_CONFIG["max_abs_bias_ratio_supported"]
        ):
            status = "supported"
            reason = "Held-out CCC and bias meet the pre-registered support thresholds for this month."
        elif ccc >= TRANSFER_CONFIG["ccc_limited"]:
            status = "limited"
            reason = (
                "Held-out agreement exists but is below the support threshold "
                "or has a material bias; estimates may be shown only with the "
                "limitation stated."
            )
        else:
            status = "unsupported"
            reason = "Held-out agreement is too weak to support a VIIRS-equivalent estimate in this month."
        out[month] = {
            "status": status,
            "factor": round(float(factor), 4) if factor is not None else None,
            "validation_pairs": len(indices),
            "metrics": {
                "mae": round(mae, 4),
                "bias": round(bias, 4),
                "ccc": round(ccc, 4) if ccc is not None else None,
                "bias_ratio": round(bias_ratio, 4) if bias_ratio is not None else None,
            },
            "reason": reason,
            "uncertainty": {
                "mae": metrics.moving_block_bootstrap(
                    pred,
                    ref,
                    np.asarray([held_out[i]["month"] for i in indices]),
                    statistic=metrics.mae,
                    iterations=TRANSFER_CONFIG["bootstrap_iterations"],
                    seed=TRANSFER_CONFIG["bootstrap_seed"] + 4,
                    ci=TRANSFER_CONFIG["bootstrap_confidence_level"],
                )
            },
        }
    return out


def _decision(
    *,
    years: list[int],
    n_pairs: int,
    folds: dict[str, Any],
    month_statuses: dict[str, Any],
) -> dict[str, Any]:
    """Apply the pre-registered decision rule, with the evidence attached."""

    statuses = [m["status"] for m in month_statuses.values()]
    supported_months = [m for m, v in month_statuses.items() if v["status"] == "supported"]
    limited_months = [m for m, v in month_statuses.items() if v["status"] == "limited"]

    if n_pairs < TRANSFER_CONFIG["min_validation_pairs"] or len(years) < TRANSFER_CONFIG["min_years"]:
        return {
            "decision": "UNSUPPORTED",
            "reason": (
                "Insufficient post-2012 overlap evidence for this region and "
                "platform. Raw MODIS observations remain available on their "
                "native scale; no VIIRS-equivalent values are produced."
            ),
            "supported_months": supported_months,
            "limited_months": limited_months,
        }

    def ccc_of(fold: dict[str, Any]) -> float | None:
        return ((fold.get("methods") or {}).get("monthly_shrinkage") or {}).get("metrics", {}).get("ccc")

    forward = ccc_of(folds.get("forward") or {})
    backward = ccc_of(folds.get("backward") or {})
    loo = folds.get("leave_one_year_out") or {}
    loo_cccs = [ccc_of(fold) for fold in (loo.get("folds") or {}).values()]
    median_loo = _median(loo_cccs)

    stable = (
        forward is not None
        and backward is not None
        and forward >= TRANSFER_CONFIG["ccc_limited"]
        and backward >= TRANSFER_CONFIG["ccc_limited"]
    )

    if not stable or median_loo is None:
        return {
            "decision": "UNSUPPORTED",
            "reason": (
                "Temporal transferability is not demonstrated: the relationship "
                "does not hold in both early-to-late and late-to-early blocked "
                "tests. Raw MODIS is retained; no VIIRS-equivalent values are "
                "produced."
            ),
            "supported_months": supported_months,
            "limited_months": limited_months,
            "evidence": {"forward_ccc": forward, "backward_ccc": backward, "median_loo_ccc": median_loo},
        }

    if not supported_months:
        return {
            "decision": "UNSUPPORTED",
            "reason": (
                "No calendar month has held-out agreement strong enough to "
                "support a VIIRS-equivalent estimate. Raw MODIS is retained on "
                "its native scale."
            ),
            "supported_months": [],
            "limited_months": limited_months,
            "evidence": {"forward_ccc": forward, "backward_ccc": backward, "median_loo_ccc": median_loo},
        }

    if median_loo >= TRANSFER_CONFIG["ccc_supported"] and stable and statuses.count("unsupported") == 0:
        decision = "SUPPORTED"
        reason = (
            "Blocked early-to-late and late-to-early tests, plus leave-one-year-out "
            "validation, meet the pre-registered support thresholds in every "
            "calendar month with overlap evidence."
        )
    else:
        decision = "LIMITED"
        reason = (
            "Evidence supports VIIRS-equivalent estimates only in the months "
            "listed as supported or limited. Months without overlap evidence "
            "remain raw MODIS."
        )

    return {
        "decision": decision,
        "reason": reason,
        "supported_months": supported_months,
        "limited_months": limited_months,
        "evidence": {
            "forward_ccc": forward,
            "backward_ccc": backward,
            "median_loo_ccc": median_loo,
        },
    }


def _method_statement(
    folds: dict[str, Any],
    method_comparison: dict[str, Any],
) -> tuple[bool, str, str | None]:
    """Return (confident_winner, statement, best_method)."""

    ccc_by_method: dict[str, list[float]] = defaultdict(list)
    mae_by_method: dict[str, list[float]] = defaultdict(list)
    for fold in folds.values():
        if not isinstance(fold, dict):
            continue
        for method, result in (fold.get("methods") or {}).items():
            ccc = (result.get("metrics") or {}).get("ccc")
            mae = (result.get("metrics") or {}).get("mae")
            if ccc is not None:
                ccc_by_method[method].append(float(ccc))
            if mae is not None:
                mae_by_method[method].append(float(mae))
    if len(ccc_by_method) < 2:
        return False, NO_CONFIDENT_WINNER, None

    ranking = sorted(
        ccc_by_method,
        key=lambda m: (-float(np.median(ccc_by_method[m])), float(np.median(mae_by_method[m]))),
    )
    best = ranking[0]
    second = ranking[1]
    median_ccc_gap = float(
        np.median(ccc_by_method[best]) - np.median(ccc_by_method[second])
    )
    if median_ccc_gap < 0.05:
        return False, NO_CONFIDENT_WINNER, None
    # A paired bootstrap on identical held-out blocks is the decisive test.
    diffs = [
        comparison
        for key, comparison in method_comparison.items()
        if key.startswith(f"{best}_minus_")
    ]
    if not diffs:
        return False, NO_CONFIDENT_WINNER, None
    separated = all(d.get("ci_lower", 0) > 0 for d in diffs)
    mae_better = float(np.median(mae_by_method[best])) <= float(np.median(mae_by_method[second]))
    if separated and mae_better and median_ccc_gap >= 0.05:
        return True, f"{best} separates from the other methods on identical held-out blocks.", best
    return False, NO_CONFIDENT_WINNER, None


def run_transferability(
    *,
    records: list[dict[str, Any]] | None = None,
    requested_by_sensor: dict[str, set[str]] | None = None,
    pairs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build pairs, run blocked transferability tests and decide per region."""

    if pairs is None:
        if records is None or requested_by_sensor is None:
            entries = historical.load_area_entries()
            scoped = {
                sensor_id: historical.filter_entries_by_window(
                    sensor_entries, min_date=CALIBRATION_START
                )
                for sensor_id, sensor_entries in entries.items()
            }
            requested_by_region = requested_dates_by_region(scoped)
            pairs = pairs_from_counts(
                counts_for_entries(scoped), requested_by_region
            )
        else:
            pairs = experiments.build_pairs(
                records, requested_by_sensor=requested_by_sensor
            )
    config.ensure_directories()
    HISTORICAL_DIR.mkdir(parents=True, exist_ok=True)

    regions: dict[str, Any] = {}
    for region_id in config.REGION_ORDER:
        regions[region_id] = {}
        for platform in experiments.EXPERIMENT_CONFIG["modis_platforms"]:
            region_pairs = [
                p
                for p in pairs
                if p["district_id"] == region_id and p["modis_platform"] == platform
            ]
            years = sorted({p["year"] for p in region_pairs})
            if not region_pairs:
                regions[region_id][platform] = {
                    "decision": "UNSUPPORTED",
                    "reason": "No post-2012 overlap pairs for this region and platform.",
                    "years": [],
                    "validation_pairs": 0,
                    "supported_months": [],
                    "limited_months": [],
                    "months": {},
                    "confident_winner": False,
                    "method_statement": NO_CONFIDENT_WINNER,
                }
                continue

            split_at = max(1, int(round(len(years) * TRANSFER_CONFIG["forward_train_fraction"])))
            split_at = min(split_at, len(years) - 1) if len(years) > 1 else 1
            train_years = set(years[:split_at])
            test_years = set(years[split_at:])
            forward_train, forward_test = _split(region_pairs, train_years, test_years)

            backward_train, backward_test = _split(region_pairs, test_years, train_years)

            forward_fold, _forward_preds = _evaluate(forward_train, forward_test)
            backward_fold, _backward_preds = _evaluate(backward_train, backward_test)
            folds: dict[str, Any] = {
                "forward": {
                    **forward_fold,
                    "train_years": sorted(train_years),
                    "test_years": sorted(test_years),
                },
                "backward": {
                    **backward_fold,
                    "train_years": sorted(test_years),
                    "test_years": sorted(train_years),
                },
            }

            # Leave-one-year-out, with the same purge discipline. Each row is
            # predicted by a model that never saw its year, so pooling the
            # folds gives far more held-out evidence than two block splits.
            loo_folds: dict[str, Any] = {}
            held_out_pairs: list[dict[str, Any]] = []
            held_out_preds: dict[str, list[float]] = {
                method: [] for method in experiments.METHODS
            }
            for year in years:
                train, test = _split(region_pairs, set(years) - {year}, {year})
                fold, preds = _evaluate(train, test)
                loo_folds[str(year)] = fold
                if not test:
                    continue
                held_out_pairs.extend(test)
                for method, values in preds.items():
                    held_out_preds[method].extend(float(v) for v in values)
            folds["leave_one_year_out"] = {
                "design": "leave-one-year-out with 30-day purge",
                "folds": {
                    year: {
                        "validation_pairs": fold.get("validation_pairs"),
                        "methods": fold.get("methods"),
                    }
                    for year, fold in loo_folds.items()
                },
            }

            # Final factors: fit on the full post-2012 overlap for this region.
            final_model = experiments.fit_shrinkage(region_pairs)
            fitted = (
                final_model.get("models", {}).get(f"{region_id}|{platform}", {})
                if isinstance(final_model, dict)
                else {}
            )
            factors = fitted.get("month_models", {})

            prediction_arrays: dict[str, np.ndarray] = {}
            for method, values in held_out_preds.items():
                if len(values) == len(held_out_pairs):
                    prediction_arrays[method] = np.asarray(values, dtype=float)
            if "monthly_shrinkage" in prediction_arrays:
                prediction_arrays["best"] = prediction_arrays["monthly_shrinkage"]

            if "best" in prediction_arrays and held_out_pairs:
                month_statuses = _month_statuses(held_out_pairs, prediction_arrays, factors)
            else:
                month_statuses = {
                    f"{m:02d}": {
                        "status": "unsupported",
                        "factor": None,
                        "validation_pairs": 0,
                        "reason": "No held-out overlap evidence.",
                        "uncertainty": None,
                    }
                    for m in range(1, 13)
                }

            method_comparison = _paired_method_evidence(
                held_out_pairs,
                {m: p for m, p in prediction_arrays.items() if m != "best"},
            )
            confident, statement, best_method = _method_statement(folds, method_comparison)

            decision = _decision(
                years=years,
                n_pairs=sum(fold.get("validation_pairs", 0) for fold in (folds["forward"], folds["backward"])),
                folds=folds,
                month_statuses=month_statuses,
            )

            regions[region_id][platform] = {
                **decision,
                "years": years,
                "validation_pairs": len(region_pairs),
                "forward": folds["forward"],
                "backward": folds["backward"],
                "leave_one_year_out": {
                    "folds": {
                        year: {
                            "validation_pairs": fold.get("validation_pairs"),
                            "methods": fold.get("methods"),
                        }
                        for year, fold in loo_folds.items()
                    }
                },
                "method_comparison": method_comparison,
                "confident_winner": confident,
                "best_method": best_method,
                "method_statement": statement,
                "months": month_statuses,
                "district_ratio": (fitted.get("district_ratio") if isinstance(fitted, dict) else None),
            }

    artifact = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "calibration_version": CALIBRATION_VERSION,
        "calibration_period": {
            "start": CALIBRATION_START,
            "end": max((p["date"] for p in pairs), default=None),
            "note": (
                "Only post-2012 overlap observations are used to fit or test the "
                "MODIS-to-VIIRS relationship. Pre-2012 records are never training data."
            ),
        },
        "method": "monthly_shrinkage",
        "method_status": "conditional",
        "court_verdict": "inconclusive" if any(
            not info.get("confident_winner", False)
            for region in regions.values()
            for info in region.values()
        ) else "regional_winner",
        "reference": "VIIRS Suomi-NPP (reference scale, not ground truth)",
        "config": TRANSFER_CONFIG,
        "terminology": (
            "A 'MODIS-derived VIIRS-equivalent estimate' is a transformed "
            "MODIS count. It is not a VIIRS detection."
        ),
        "regions": regions,
        "limitations": [
            "The post-2012 reference record covers January-June (plus July 2026) only, so July-December backcasting has no overlap calibration and is unsupported.",
            "VIIRS is a reference scale, not ground truth; no burned-area validation exists.",
            "2000-2001 has Terra only; no Aqua calibration is applied where Aqua did not observe.",
            "Raw MODIS detections are preserved and never overwritten by estimates.",
        ],
    }

    manifests.write_json(HISTORICAL_DIR / "backcast_decisions.json", artifact)
    manifests.write_json(PUBLIC_BACKCAST, _frontend_artifact(artifact))
    return artifact


def _frontend_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    """Compact public artifact: decisions, factors, uncertainty, provenance."""

    regions: dict[str, Any] = {}
    for region_id, platforms in artifact["regions"].items():
        regions[region_id] = {}
        for platform, info in platforms.items():
            regions[region_id][platform] = {
                "decision": info.get("decision"),
                "reason": info.get("reason"),
                "years": info.get("years", []),
                "validation_pairs": info.get("validation_pairs", 0),
                "confident_winner": info.get("confident_winner", False),
                "best_method": info.get("best_method"),
                "method_statement": info.get("method_statement"),
                "supported_months": info.get("supported_months", []),
                "limited_months": info.get("limited_months", []),
                "months": {
                    month: {
                        "status": value.get("status"),
                        "factor": value.get("factor"),
                        "validation_pairs": value.get("validation_pairs", 0),
                        "reason": value.get("reason"),
                        "uncertainty": value.get("uncertainty"),
                    }
                    for month, value in (info.get("months") or {}).items()
                },
                "transferability": {
                    "forward_ccc": ((info.get("forward") or {}).get("methods") or {})
                    .get("monthly_shrinkage", {})
                    .get("metrics", {})
                    .get("ccc"),
                    "backward_ccc": ((info.get("backward") or {}).get("methods") or {})
                    .get("monthly_shrinkage", {})
                    .get("metrics", {})
                    .get("ccc"),
                },
            }
    return {
        "contract_version": artifact["contract_version"],
        "generated_at": artifact["generated_at"],
        "calibration_version": artifact["calibration_version"],
        "calibration_period": artifact["calibration_period"],
        "method": artifact["method"],
        "court_verdict": artifact["court_verdict"],
        "reference": artifact["reference"],
        "terminology": artifact["terminology"],
        "regions": regions,
        "limitations": artifact["limitations"],
    }


def export_historical_estimates(
    *,
    backcast: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write separate pre-2012 MODIS-derived estimates next to raw MODIS.

    Estimates are produced only for a region/platform/month whose backcast
    status is ``supported`` or ``limited``. Raw counts are copied alongside so
    the difference between observation and estimate is explicit. Unsupported
    month/platform combinations stay raw-only.
    """

    if backcast is None:
        path = HISTORICAL_DIR / "backcast_decisions.json"
        if not path.exists():
            raise RuntimeError("Run backcast first: no backcast_decisions.json")
        backcast = json.loads(path.read_text(encoding="utf-8"))
    assert backcast is not None

    PUBLIC_ESTIMATES_DIR.mkdir(parents=True, exist_ok=True)
    index: dict[str, Any] = {
        "contract_version": config.CONTRACT_VERSION,
        "generated_at": _utc_now(),
        "calibration_version": backcast["calibration_version"],
        "calibration_period": backcast.get("calibration_period"),
        "terminology": backcast["terminology"],
        "regions": {},
    }

    processed = config.PROCESSED_DIR / "sp" / "districts"
    for region_id in config.REGION_ORDER:
        daily_path = processed / region_id / "daily.json"
        if not daily_path.exists():
            continue
        daily = json.loads(daily_path.read_text(encoding="utf-8"))

        # year -> month -> bucket. One daily.json holds the whole record, so
        # pre-2012 days must be grouped by year before writing.
        by_year: dict[str, dict[str, Any]] = defaultdict(
            lambda: defaultdict(
                lambda: {
                    "raw_modis": {"Terra": 0, "Aqua": 0},
                    "observed_platforms": {"Terra": False, "Aqua": False},
                    "observed_days": 0,
                    "estimate_days": 0,
                    "estimate": 0.0,
                }
            )
        )

        for day in daily.get("days", []):
            value = day.get("date")
            if not value or value >= ESTIMATES_END:
                continue
            year, month = value[:4], value[5:7]
            bucket = by_year[year][month]
            bucket["observed_days"] += 1
            platforms = ((day.get("by_sensor") or {}).get("modis") or {}).get("platforms") or {}
            estimates: list[float] = []
            for platform in ("Terra", "Aqua"):
                block = platforms.get(platform) or {}
                if block.get("status") not in ("observed", "observed_zero"):
                    continue
                bucket["observed_platforms"][platform] = True
                detections = block.get("detections")
                if detections is not None:
                    bucket["raw_modis"][platform] += int(detections)
                info = (backcast["regions"].get(region_id) or {}).get(platform) or {}
                month_info = (info.get("months") or {}).get(month) or {}
                if (
                    month_info.get("status") in ("supported", "limited")
                    and month_info.get("factor") is not None
                ):
                    estimates.append(float(detections or 0) * float(month_info["factor"]))
            if estimates:
                bucket["estimate_days"] += 1
                # Per-platform factors estimate the same VIIRS daily count;
                # averaging avoids double counting when Terra and Aqua both
                # observed.
                bucket["estimate"] += sum(estimates) / len(estimates)

        for year, months_by_month in sorted(by_year.items()):
            months: dict[str, Any] = {}
            total_estimate = 0.0
            for month in [f"{m:02d}" for m in range(1, 13)]:
                bucket = months_by_month.get(month)
                if not bucket:
                    months[month] = {
                        "status": "no_observations",
                        "raw_modis": {"Terra": None, "Aqua": None},
                        "estimate": None,
                        "observed_days": 0,
                    }
                    continue
                month_states = [
                    ((backcast["regions"].get(region_id) or {}).get(p) or {})
                    .get("months", {})
                    .get(month, {})
                    .get("status")
                    for p in ("Terra", "Aqua")
                ]
                status = (
                    "supported"
                    if "supported" in month_states
                    else "limited"
                    if "limited" in month_states
                    else "unsupported"
                )
                estimate = (
                    round(bucket["estimate"], 2) if bucket["estimate_days"] else None
                )
                if estimate is not None:
                    total_estimate += estimate
                months[month] = {
                    "status": status,
                    "raw_modis": {
                        platform: (
                            bucket["raw_modis"][platform]
                            if bucket["observed_platforms"][platform]
                            else None
                        )
                        for platform in ("Terra", "Aqua")
                    },
                    "estimate": estimate,
                    "observed_days": bucket["observed_days"],
                    "estimate_days": bucket["estimate_days"],
                }

            payload = {
                "contract_version": config.CONTRACT_VERSION,
                "generated_at": _utc_now(),
                "region_id": region_id,
                "year": year,
                "calibration_version": backcast["calibration_version"],
                "calibration_period": backcast.get("calibration_period"),
                "method": backcast["method"],
                "label": "MODIS-derived VIIRS-equivalent estimate",
                "years_with_aqua": year >= "2002",
                "months": months,
                "annual_estimate": round(total_estimate, 2) if total_estimate else None,
                "note": (
                    "Estimates exist only where the regional backcast decision "
                    "supports them. Raw MODIS counts are preserved. Months marked "
                    "unsupported remain raw MODIS only and are never zero-filled."
                ),
            }
            manifests.write_json(PUBLIC_ESTIMATES_DIR / region_id / f"{year}.json", payload)
            entry = index["regions"].setdefault(
                region_id,
                {
                    "years": [],
                    "decisions": {
                        platform: (backcast["regions"].get(region_id) or {})
                        .get(platform, {})
                        .get("decision")
                        for platform in ("Terra", "Aqua")
                    },
                },
            )
            entry["years"].append(year)

    manifests.write_json(PUBLIC_ESTIMATES_DIR / "index.json", index)
    return {"path": str(PUBLIC_ESTIMATES_DIR), "regions": list(index["regions"])}
