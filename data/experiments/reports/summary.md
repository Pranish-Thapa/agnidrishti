# Task 05 — Harmonization experiment report

Generated: 2026-11-15T12:45:10Z

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
| constant_ratio | 7.9822 | 26.3603 | 1.0526 | 0.0932 | 0.6638 | 0.6529 |
| seasonal_climatology | 10.484 | 26.4933 | 1.4175 | -0.4993 | 0.3802 | 0.2598 |

### Weekly-scale validation (held-out)

| Method | weekly MAE | weekly RMSE | weekly CCC |
| --- | --- | --- | --- |
| ratio | 26.7606 | 79.2418 | 0.8817 |
| quantile_mapping | 37.2367 | 104.2847 | 0.6098 |
| monthly_shrinkage | 26.2289 | 78.0813 | 0.8844 |

### Paired CCC differences (moving-block bootstrap, 90% CI)

- monthly_shrinkage_minus_ratio: 0.0048 (CI 0.0002 to 0.0104)
- monthly_shrinkage_minus_quantile_mapping: 0.1088 (CI -0.0089 to 0.2599)
- monthly_shrinkage_minus_constant_ratio: -0.0282 (CI -0.0484 to 0.0434)
- monthly_shrinkage_minus_seasonal_climatology: 0.3649 (CI 0.3134 to 0.4386)

**Court decision: inconclusive** — Top methods are statistically or practically indistinguishable, or performance is unstable. No winner is declared; the evidence does not support forcing one.

## Seam audit (diagnostic, not causal)

Not run in `--from-pairs` mode: the seam audit needs the raw record stream, which the committed pair table does not carry. See the full pipeline output.

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
- The pre-2012 MODIS era has no contemporaneous VIIRS; estimates there are produced only where the blocked transferability tests support them (see backcast_decisions.json).

This report does not fabricate a winner where the evidence does not support one.