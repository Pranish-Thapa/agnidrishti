# Task 05 — Harmonization experiment report

Generated: 2026-11-13T21:27:41Z

## Data and fairness

- Comparison unit: district-day counts, both sensors observing (recorded zeros kept, missing files excluded).
- Reference: viirs_snpp (Suomi-NPP) — the reference scale, not ground truth.
- Training pairs: 13854; validation pairs: 2172; purge-gap pairs: 360 (excluded from both, leakage protection). Total = 16386.
- Terra and Aqua fitted and applied as separate platforms.

## Method Court metrics (identical validation sample)

| Method | MAE | RMSE | log-RMSE | Bias | Pearson | CCC |
| --- | --- | --- | --- | --- | --- | --- |
| ratio | 8.3423 | 30.1445 | 1.0274 | 0.7052 | 0.653 | 0.6199 |
| quantile_mapping | 6.4384 | 23.1821 | 1.0789 | -5.245 | 0.6171 | 0.5159 |
| monthly_shrinkage | 8.259 | 29.7801 | 1.0288 | 0.6011 | 0.6562 | 0.6247 |

**Court decision: inconclusive** — Top methods are statistically or practically indistinguishable, or performance is unstable. No winner is declared; the evidence does not support forcing one.

## Seam audit (diagnostic, not causal)

- NP-BANKE Terra: raw VIIRS/MODIS scale step 23.197x; after harmonization ratio 1.12x, quantile_mapping 3.491x, monthly_shrinkage 1.12x
- NP-BANKE Aqua: raw VIIRS/MODIS scale step 18.099x; after harmonization ratio 1.085x, quantile_mapping 2.698x, monthly_shrinkage 1.086x
- NP-BARDIYA Terra: raw VIIRS/MODIS scale step 14.008x; after harmonization ratio 0.806x, quantile_mapping 2.334x, monthly_shrinkage 0.807x
- NP-BARDIYA Aqua: raw VIIRS/MODIS scale step 11.926x; after harmonization ratio 0.863x, quantile_mapping 2.285x, monthly_shrinkage 0.858x
- NP-CHITWAN Terra: raw VIIRS/MODIS scale step 49.857x; after harmonization ratio 2.101x, quantile_mapping 14.851x, monthly_shrinkage 2.096x
- NP-CHITWAN Aqua: raw VIIRS/MODIS scale step 8.41x; after harmonization ratio 0.921x, quantile_mapping 1.626x, monthly_shrinkage 0.916x

No method fully removes the scale mismatch; residual steps remain and are reported honestly.

## Lights-Out backtest (held-out years)

- ratio 2019: CCC 0.5881, MAE 11.8635, monthly profile r = 0.9656936063606177, variation ratio 1.3073 (well below 1 indicates over-smoothing).
- ratio 2022: CCC 0.702, MAE 4.8211, monthly profile r = 0.9998141996687666, variation ratio 0.7712 (well below 1 indicates over-smoothing).
- quantile_mapping 2019: CCC 0.5452, MAE 8.213, monthly profile r = 0.9892767190589723, variation ratio 0.4349 (well below 1 indicates over-smoothing).
- quantile_mapping 2022: CCC 0.4405, MAE 4.6637, monthly profile r = 0.998934270491245, variation ratio 0.257 (well below 1 indicates over-smoothing).
- monthly_shrinkage 2019: CCC 0.594, MAE 11.6985, monthly profile r = 0.9702002353747964, variation ratio 1.2824 (well below 1 indicates over-smoothing).
- monthly_shrinkage 2022: CCC 0.7029, MAE 4.8195, monthly profile r = 0.9998157793931997, variation ratio 0.7709 (well below 1 indicates over-smoothing).

## Limitations

- VIIRS is not ground truth; harmonized values are VIIRS-equivalent estimates only.
- Aug–Dec is outside the acquired record; no seasonal claim covers those months.
- Recorded zeros are preserved, never manufactured into detections.
- District-level instability (esp. Chitwan) means district-level results carry wider uncertainty.
- The pre-2012 MODIS-only era is outside the acquired data and cannot be audited.

This report does not fabricate a winner where the evidence does not support one.