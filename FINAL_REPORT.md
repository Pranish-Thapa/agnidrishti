# AGNIDRISHTI — FINAL CHANGE REPORT

Date: 2026-11-14 · Scope: prompt.txt Tasks 04B, 05, 06, 07 + mandatory download gate
Verification baseline: 76/76 pytest · typecheck ✓ · eslint 0 warnings ✓ · production build ✓
· browser-verified production app (desktop 1440px, mobile 390px, all routes)

---

## 0. DOWNLOAD COMPLETION GATE (no code changes — verification only)

- Confirmed both background `download-historical` processes reached terminal state.
- Verified `download_manifest.json`: 1,672 unique area-api entries from 1,679 raw appends
  (7 duplicates from two concurrent downloader runs; deduplicated at load time — the manifest
  file itself was never rewritten).
- Per-sensor chunk coverage: modis 589 · viirs_snpp 589 · viirs_noaa20 339 · viirs_noaa21 151.
  Zero missing date windows, zero error entries.
- All 1,668 files re-verified: present, byte size matches, SHA-256 matches (80.3 MB).
- The 4 overlapping 2026-03-10→14 chunks are Task-03 demo windows; processing dedupe handles them.
- Nothing was re-downloaded; no credentials exposed.

## 1. TASK 04B — HISTORICAL PROCESSING & CALIBRATION READINESS

### Code changes
| File | Change |
|---|---|
| `pipeline/historical.py` | **Created** (~700 lines): manifest chunk discovery/dedupe, Phase 1 inventory, quality investigation, platform-pair overlap with day/night overpass evidence, 0.1° grid spatial comparability, 6-state year-month coverage matrices, calibration readiness report, single-pass record loader, orchestration |
| `pipeline/__main__.py` | Added `historical-inventory` and `historical-analysis` subcommands; `json` + `manifests` imports |
| `pipeline/tests/test_historical.py` | **Created** — 18 tests: window expansion, manifest dedupe, missing-window detection, coverage status vocabulary, no-zero-fill, overlap math, per-district overlap, comparable cell-days, platform identity, FRP missing, readiness thresholds, no-fitted-corrections, reproducibility |
| `pipeline/tests/test_sp.py` | Updated stale assertion: SP years now 2012–2026 (15 years) |

Bug fixes made during implementation: double-normalization call removed; O(months × records)
scan replaced with a pre-computed monthly index; empty-file SHA collisions no longer reported as
data duplicates; Terra's bimodal overpass mean replaced with day/night split statistics.

### Outputs generated (`data/processed/historical/`)
`inventory.json` · `data_quality.json` · `sensor_overlap.json` · `spatial_comparability.json` ·
`coverage_matrices.json` · `calibration_readiness.json` · `analysis_manifest.json`.
Re-ran unchanged `process --provider area-api`: 1,019,718 raw → 597 duplicates removed →
**124,506 district records** (Banke 40,587 / Bardiya 44,622 / Chitwan 39,297); public SP slices
regenerated (`public/data/sp/{district}/{2012..2026}.json`, 13 MB).

### Key results
- FRP present on 100% of records; confidence fields type-correct (MODIS numeric 0–100, VIIRS
  categorical l/n/h); district share of bbox 12.2% matches the geometric expectation exactly.
- Comparable cell-days: 3,777 (district sums reconcile to bbox).
- Readiness: all 3 districts sufficient; suitable months concentrate Feb–May; candidate training
  years 2013–2026, holdouts 2019/2022; Terra/Aqua fully separable; 6 bias risks documented.

## 2. TASK 05 — HARMONIZATION EXPERIMENTS

### Code changes
| File | Change |
|---|---|
| `pipeline/metrics.py` | **Created**: MAE, RMSE, log-RMSE, mean bias, Pearson, Lin's CCC, all_metrics, moving-block (circular) bootstrap over calendar-month blocks with fixed seed, error distribution |
| `pipeline/experiments.py` | **Created** (~1,050 lines): experiment config (serialized a-priori), pair construction (district-day, both-observing, recorded zeros kept), blocked train/validation split with 30-day purge, Method 1 ratio (district-month → district → global fallback hierarchy), Method 2 quantile mapping (zeros preserved, capped at training support, monthly mappings only with n ≥ 30), Method 3 monthly shrinkage (r*_m = λ·r_m + (1−λ)·r_d, λ = n_m/(n_m+20)), grouped evaluation diagnostics, Method Court with a-priori selection rule, Seam Audit (scale step + version eras), Lights-Out Backtest, reproducible JSON outputs, human-readable report |
| `pipeline/tests/test_experiments.py` | **Created** — 22 tests |
| `pipeline/__main__.py` | Added `experiments` subcommand |

Critical bug found and fixed during the run: monthly factors were keyed by full year-month
(`2019-04`), so validation-year months never matched training keys and ratio/shrinkage collapsed
to identical district ratios. Re-keyed to **calendar month-of-year** across all six touchpoints
(fit/apply × 3 methods + seam audit pairs). After the fix the methods differentiate properly.

### Outputs generated (`data/experiments/`)
`config/experiment_config.json`; `fitted_models/{ratio,quantile_mapping,monthly_shrinkage}.json`;
`validation/{...}.json` (per-method, with bootstrap CIs and grouped diagnostics);
`metrics/summary.json`; `method_comparison/method_court.json`; `seam_audit/seam_audit.json`;
`lights_out/lights_out.json`; `reports/summary.md`.

### Key results
- 16,386 pairs = 13,854 train + 2,172 validation + 360 purge-gap (2020/2023 Jan 1-30,
  excluded from both; leakage protection).
- Raw scale gap: VIIRS 8.27 vs Terra 0.49 / Aqua 0.58 per district-day.
- Court ranking: shrinkage CCC 0.625 > ratio 0.620 > quantile 0.516 → **inconclusive**
  (CIs overlap; district CCC spread 0.295 > 0.25). No winner declared — by rule, not omission.
- Seam audit: raw step 8–50× → 0.8–2.1 after harmonization (diagnostic; MODIS 6.03→61.03
  product-version seam identified inside the record; confounds listed).
- Lights-out: monthly profile r ≈ 0.97–1.00; quantile over-smooths (variation 0.26–0.43).

## 3. TASK 06 — INDEPENDENT VALIDATION & RELIABILITY AUDIT

### Code changes
| File | Change |
|---|---|
| `pipeline/validation.py` | **Created** (~1,000 lines): *deliberately independent* metric implementations (not importing `pipeline.metrics`), integrity audit (separation, purge, leakage, court-sample identity, zero-fill check, sensor-scope identity), metric recalculation with discrepancy detection, 7-variant sensitivity analysis, leave-one-year-out temporal robustness (15 folds), district + grid-cell spatial robustness, reliability classification with documented thresholds, failure-mode harness, scientific claims audit, final reliability report, frontend contract export |
| `pipeline/tests/test_validation.py` | **Created** — 10 tests |
| `pipeline/__main__.py` | Added `validate` subcommand |

### Outputs generated
`data/validation/{independent_audit, sensitivity_analysis, temporal_robustness,
spatial_robustness, cell_error_analysis, reliability, failure_modes, claims_audit,
reliability_report}.json`; frontend contract `public/data/experiments/summary.json`.

### Key results
- Independent audit **passed**: 0 metric discrepancies, 0 train/val overlap, purge respected,
  court sample identical, 6/6 district|platform scopes present, recorded zeros preserved
  (1,404 zero-days kept as observations). Tamper detection proven by test.
- Sensitivity: shrinkage stays top in 5/7 variants (ratio leads under holdout-2025 and raised
  denominators) → the inconclusive verdict is *confirmed as correct*.
- LOYO: CCC 0.37 (2020) – 0.71 (2017); no year below the caution floor.
- Spatial: Banke 0.62 / Bardiya 0.63 / **Chitwan 0.34** best-CCC; high-error cells concentrate
  in high-activity cells; sparse cells flagged insufficient.
- Reliability strata: **2 reliable / 4 caution / 15 insufficient / 15 unavailable**
  (criteria: reliable = n ≥ 30 ∧ CCC ≥ 0.50 ∧ bias CI ∋ 0; caution = n ≥ 10 ∧ CCC ≥ 0.30).
- Failure modes: all 6 cases fail-safe (fallback, identity, cap, ignore, honest-empty).
- Claims audit: 1 supported, 1 supported-with-qualification, 8 claim classes marked
  must-never-be-made (ground truth, winner, bias removal, unique fires, zero-fill, district
  equality, causality, prediction, endorsement).

## 4. TASK 07 — FINAL PRODUCT INTEGRATION

### Pipeline
| File | Change |
|---|---|
| `pipeline/experiments.py` | Added `export_frontend_artifacts()` |
| `pipeline/__main__.py` | Added `export-frontend` subcommand |
| `public/data/experiments/harmonization_factors.json` | Generated: district → platform → month-of-year shrinkage factors, each with evidence status; artifact explicitly `method_status: provisional`, `court_verdict: inconclusive` |

### Frontend — new
| File | Purpose |
|---|---|
| `src/lib/experiments.ts` | Typed loaders + runtime guards for court summary, reliability grid, factors; `getFactor()` keeps every ratio paired with its evidence status |
| `src/components/methodology/ResultsSection.tsx` | Live Method Court table, inconclusive banner, reliability category counts, scope reminder — rendered from `summary.json`, nothing hand-entered |

### Frontend — rewritten
| File | Change |
|---|---|
| `src/pages/ExplorerPage.tsx` | Real data integration: provider (SP default / NRT) → observation index → years → district-year dataset; experiment artifacts loaded once; loading/empty/unavailable states; "Build status" aside reflects connected + provisional-harmonized state |
| `src/components/explorer/CalendarPanel.tsx` | **Year × Week heatmap** (53 ISO-week cells, month tick labels, sqrt colour ramp terracotta→amber, hatch for unobserved, internal scroll on mobile); three layers: Harmonized (VIIRS-equivalent estimate from real fitted factors, co-observation required, empty otherwise), MODIS raw (Terra+Aqua, labelled), VIIRS raw (Suomi-NPP); **weekly detail panel** (dates, status + days, per-platform detections with days-observed, harmonized estimate, reliability stratum badge, not-unique-fires caveat); selection resets on dataset change; aria labels per cell |
| `src/components/explorer/ExplorerControls.tsx` | Added Data product selector (SP/NRT) and live year selector driven by the observation index; layer notes updated; copy updated to connected state |
| `src/components/explorer/ReadinessPanel.tsx` | Live pipeline status rows (boundaries, provider coverage with record counts, selected slice, court verdict, audit) + reliability strata counts grid |
| `src/components/explorer/CriticalPeriodsPanel.tsx` | Replaced "awaiting" placeholders with **descriptive-only** record highlights (highest recorded week, observation coverage) — explicitly not anomaly tests; links to methodology |
| `src/components/explorer/DataNotice.tsx` | Rewritten: observations connected; detections ≠ unique fires; missing ≠ zero; harmonized layer exploratory |
| `src/components/explorer/MapPanel.tsx` | Caption updated: boundary context only; observation surface is the calendar |

### Frontend — updated
| File | Change |
|---|---|
| `src/lib/explorer.ts` | Added `providers` (SP/NRT) with notes; layer labels ("Harmonized — VIIRS-equivalent · provisional", "MODIS raw — Terra + Aqua", "VIIRS raw — Suomi-NPP") |
| `src/lib/content.ts` | PhaseStatus extended (`Implemented · diagnostic`, `Computed · inconclusive`, `Computed`); Seam Audit / Method Court / Lights-Out capabilities and the three methods updated to computed statuses with honest result-bearing descriptions; validation checks marked Computed |
| `src/pages/MethodologyPage.tsx` | Header aside: "Computed & audited. Verdict: inconclusive."; implemented/not-claimed banner reflects reality; TOC + new `#results` section (index 05) using ResultsSection; subsequent indices renumbered; data sources show connected products and attribution; "no validation has been run" paragraph replaced |

### Documentation
| File | Change |
|---|---|
| `README.md` | Rewritten for the final state: pipeline command reference, acquired record, reproducible scientific workflow, headline-results table, full project structure, limitations, deployment note |
| `DEMO.md` | **Created**: 5–7 minute demo narrative, screenshot checklist (9 shots), reproducibility one-liners, judging Q&A |
| `TASK_STATUS.md` | Created at the gate and maintained after every phase; final status: all tasks VERIFIED COMPLETE |

## 5. VERIFICATION PERFORMED (all actually executed)

- `pytest pipeline/tests -q` → **76 passed** (18 historical + 22 experiments + 10 validation
  + 26 pre-existing; 2 stale tests updated where the new reality legitimately changed).
- `npm run typecheck` ✓ · `npm run lint` (0 warnings) ✓ · `npm run build` ✓
  (423 KB JS / 131 KB gzip; dist 127 MB only due to the archived 103 MB hero .mov — documented).
- **Browser verification of the production build** (in-app browser against `npm run preview`):
  home hero; `/explorer` — 2026 harmonized estimates render, week click → detail (Terra 61 /
  Aqua 73 / SNPP 1,075 / estimate 2,475.1 with "reliable" badge), year switch to 2016 (real fire
  season: peak week 1,297 detections), layer switches, provider combobox; `/methodology` live
  court table + reliability counts; `/about`; 404 route; direct navigation to every route works;
  mobile 390px: **no page-level horizontal overflow**, calendar scrolls internally; desktop
  1440px screenshots captured.

## 6. SCIENTIFIC INTEGRITY LEDGER

Honoured throughout: sensors/platforms never merged in fitting; VIIRS = reference scale, never
ground truth; recorded zeros preserved, missing never zero-filled; validation years excluded
from fitting with a purge gap, identical samples for all methods; metrics independently
recomputed; no winner forced (verdict inconclusive, confirmed by sensitivity analysis);
diagnostics labelled diagnostic; Aug–Dec claims never made; no prediction/impact/endorsement
claims; every output carries contract_version, generated_at and provenance.

## 7. KNOWN LIMITATIONS (documented in-app and in data)

1. Court verdict inconclusive → harmonized layer is provisional by design.
2. Chitwan strata mostly use-with-caution/insufficient; never displayed as reliable values.
3. Aug–Dec not acquired (`not_requested` in matrices; FIRMS holds the data).
4. NRT slice covers a single 7-day window (2026-11-07→13).
5. Conditional-on-co-observation calibration under-represents fires MODIS misses entirely.
6. Residual scale steps (0.8–2.1) remain after harmonization.
7. dist/ is 127 MB from the archived hero .mov (move it out of `public/` to slim the deploy).
