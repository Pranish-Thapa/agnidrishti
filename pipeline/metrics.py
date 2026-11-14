"""Evaluation metrics and uncertainty estimation for harmonization experiments.

All metrics treat predicted and reference arrays as paired samples of
detection counts. VIIRS reference values are NOT ground truth; metrics
quantify agreement with the VIIRS-equivalent reference scale only.

Bootstrap uncertainty uses a moving-block (circular) bootstrap over calendar
month blocks so that temporal dependence within a fire season is respected
rather than assuming independent observations.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def mae(pred: np.ndarray, ref: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - ref)))


def rmse(pred: np.ndarray, ref: np.ndarray) -> float:
    return float(np.sqrt(np.mean((pred - ref) ** 2)))


def log_rmse(pred: np.ndarray, ref: np.ndarray) -> float:
    return float(np.sqrt(np.mean((np.log1p(pred) - np.log1p(ref)) ** 2)))


def mean_bias(pred: np.ndarray, ref: np.ndarray) -> float:
    """Mean of (pred - ref); negative values mean under-estimation."""

    return float(np.mean(pred - ref))


def pearson(pred: np.ndarray, ref: np.ndarray) -> float | None:
    if len(pred) < 2:
        return None
    if float(np.std(pred)) == 0.0 or float(np.std(ref)) == 0.0:
        return None
    return float(np.corrcoef(pred, ref)[0, 1])


def lin_ccc(pred: np.ndarray, ref: np.ndarray) -> float | None:
    """Lin's Concordance Correlation Coefficient.

    CCC = 2 * rho * sd_pred * sd_ref / (sd_pred^2 + sd_ref^2 + (mean_pred - mean_ref)^2)

    Unlike Pearson, CCC penalizes scale and offset differences, so a series
    that is correlated but biased does not score perfectly.
    """

    if len(pred) < 2:
        return None
    var_pred = float(np.var(pred))
    var_ref = float(np.var(ref))
    mean_diff = float(np.mean(pred) - np.mean(ref))
    denom = var_pred + var_ref + mean_diff**2
    if denom == 0.0:
        return None
    rho = pearson(pred, ref)
    if rho is None:
        return None
    return float(2.0 * rho * math.sqrt(var_pred) * math.sqrt(var_ref) / denom)


def all_metrics(pred: np.ndarray, ref: np.ndarray) -> dict[str, Any]:
    return {
        "n": int(len(pred)),
        "mae": round(mae(pred, ref), 4),
        "rmse": round(rmse(pred, ref), 4),
        "log_rmse": round(log_rmse(pred, ref), 4),
        "mean_bias": round(mean_bias(pred, ref), 4),
        "pearson": round(pearson(pred, ref), 4) if pearson(pred, ref) is not None else None,
        "ccc": round(lin_ccc(pred, ref), 4) if lin_ccc(pred, ref) is not None else None,
    }


def moving_block_bootstrap(
    pred: np.ndarray,
    ref: np.ndarray,
    blocks: np.ndarray,
    *,
    statistic=mae,
    iterations: int = 1000,
    seed: int = 2026,
    ci: float = 0.90,
) -> dict[str, Any]:
    """Moving-block bootstrap over pre-defined blocks (calendar months).

    Whole month blocks are resampled with replacement, preserving within-month
    temporal dependence. Returns the point estimate and a percentile CI.
    """

    rng = np.random.default_rng(seed)
    unique_blocks = np.unique(blocks)
    point = statistic(pred, ref)
    block_indices = {block: np.where(blocks == block)[0] for block in unique_blocks}

    samples = np.empty(iterations)
    n_blocks = len(unique_blocks)
    for i in range(iterations):
        chosen = rng.choice(n_blocks, size=n_blocks, replace=True)
        indices = np.concatenate([block_indices[unique_blocks[j]] for j in chosen])
        samples[i] = statistic(pred[indices], ref[indices])

    alpha = (1.0 - ci) / 2.0
    return {
        "point": round(float(point), 4),
        "ci_lower": round(float(np.quantile(samples, alpha)), 4),
        "ci_upper": round(float(np.quantile(samples, 1.0 - alpha)), 4),
        "iterations": iterations,
        "confidence_level": ci,
        "blocks": int(n_blocks),
        "seed": seed,
    }


def error_distribution(pred: np.ndarray, ref: np.ndarray) -> dict[str, Any]:
    errors = pred - ref
    return {
        "mean": round(float(np.mean(errors)), 4),
        "std": round(float(np.std(errors)), 4),
        "p05": round(float(np.quantile(errors, 0.05)), 4),
        "p25": round(float(np.quantile(errors, 0.25)), 4),
        "median": round(float(np.median(errors)), 4),
        "p75": round(float(np.quantile(errors, 0.75)), 4),
        "p95": round(float(np.quantile(errors, 0.95)), 4),
        "max_abs": round(float(np.max(np.abs(errors))), 4),
    }
