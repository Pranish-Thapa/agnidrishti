# AGNIDRISHTI — CLAUDE EVALUATION IMPLEMENTATION REPORT

Date: 2026-11-14 · Inputs: the two independent judge-style evaluation reports
Verification: **76/76 pytest · 7/7 vitest · typecheck ✓ · lint 0 warnings ✓ · build ✓
· live site deployed and browser-verified**

---

## 1. Verification of the evaluation's findings (first-hand, before any change)

The reports required first-hand confirmation. All four headline findings were reproduced:

| Finding | Re-verification |
|---|---|
| Harmonized layer ≈ 1.99× VIIRS | Confirmed: 1.99 over 1,206 co-observed weeks; Terra alone 1.013, Aqua alone 0.976; demo week 2,779.9 vs 1,297 |
| 784 of 1,206 estimate-weeks in "insufficient" strata | Confirmed (65%), plus 36 weeks mapping to *unavailable* strata via the late-December ISO-month lookup |
| NOAA-20 sensitivity variant is a no-op | Confirmed: `reference_sensor` accepted but never used |
| Court omits constant-ratio + seasonal baselines | Confirmed |

The evaluation's baseline numbers were also reproduced by the re-run court (constant ratio CCC
0.653 > shrinkage 0.625 > ratio 0.620 > quantile 0.516; shrinkage−ratio paired diff +0.005
[0.000–0.010]; shrinkage vs seasonal climatology +0.365 [0.313–0.439] robust).

## 2. Recommendation-by-recommendation disposition

### Critical (Category 1) — all implemented

| Rec | Status | What was done |
|---|---|---|
| **A1** stop summing Terra+Aqua in the Harmonized layer | ✅ IMPLEMENTED | `computeWeekCell` now **averages** per-platform estimates over platforms with observed days (sum read 1.99×; average reads **0.995×** the VIIRS reference over the same 1,206 weeks). `aggregateDistrictYear` inherits the fix; the map choropleth and ComparisonChart use the same values. Weekly detail shows the arithmetic (C6) |
| **A2** reliability claim vs code | ✅ IMPLEMENTED | Low-evidence stratum cells are now **dimmed (opacity 0.45) with a low-evidence dot** + "(low evidence)" in the aria-label; late-December ISO weeks now use the **week midpoint** month (36 weeks fixed); Methodology wording changed to "shown dimmed with a low-evidence marker and their typical held-out error" |
| **A3** NOAA-20 variant no-op | ✅ IMPLEMENTED (fixed, not removed) | `run_sensitivity_analysis` now rebuilds pairs against `viirs_noaa20` inside the variant; re-run: ratio CCC 0.632 / shrinkage 0.640 (differs from baseline 0.625/0.620 — genuinely different now) |
| **A4** baselines + paired test | ✅ IMPLEMENTED | `fit_constant`/`apply_constant` (global multiplier) + `fit_seasonal`/`apply_seasonal` (VIIRS climatology, no MODIS) fitted on the same training sample; `paired_block_bootstrap_diff` in `metrics.py` (2,000 resamples, month blocks); court shows baselines (never selectable), paired CCC differences with 90% CIs, and the verdict now reports `method_beats_baseline: {difference: −0.028, CI [−0.048, +0.043], robust: false}` |
| **A5** seam audit honesty | ✅ IMPLEMENTED | Out-of-sample refit (2012 excluded from training) + **log-scale reduction** alongside the linear figure + UI wording ("refitted without 2012", residual framed as factor-instability evidence) |
| **A6** claim mismatches | ✅ IMPLEMENTED | "5 of 7"→ removed (variant fixed & now real); "98% closed"→ log-scale; "under-represented misses"→ corrected mechanism (23.8% of pairs have VIIRS>0/MODIS=0 holding 25.7% of VIIRS detections — inflates the factor numerator; scaling cannot recover those days) in DEMO/briefing; "0.1° grid" role noted in the guide; "never displayed" wording fixed |

### High-priority (Category 2)

| Rec | Status | What was done |
|---|---|---|
| **B1** live demo URL | ✅ DEPLOYED | GitHub Pages: `BASE_PATH` in vite config, 404.html SPA fallback, router `basename`, base-aware data fetches; **https://pranish-thapa.github.io/agnidrishti/** live (200, assets 200, routes work, data loads, 0 failed requests); URL first in README |
| **B2** weekly validation headline | ✅ IMPLEMENTED | `evaluate_weekly` (ISO district-weeks, per platform); exported to summary.json; ResultsSection weekly block: shrinkage **0.884** / ratio **0.882**, **Terra 0.847 / Aqua 0.936** — matches the evaluation's own run (0.85/0.94) |
| **B3** overlay chart | ✅ IMPLEMENTED | `ComparisonChart.tsx`: SVG weekly overlay of Terra / Aqua / VIIRS reference (+ dashed averaged estimate on the harmonized layer), gaps for unobserved weeks, month ticks, legend |
| **B4** reliability regrade from pooled out-of-fold predictions | ✅ IMPLEMENTED | `run_temporal_robustness` now emits per-record out-of-fold predictions; `classify_reliability` grades from pooled LOYO evidence (thresholds unchanged); new counts **7 reliable / 6 caution / 8 insufficient / 15 unavailable** (was 2/4/15/15) |
| **B5** intervals on estimates | ✅ IMPLEMENTED | Per-stratum out-of-fold error stats (`mae`, `p90_abs_error`) exported in the grid and shown in the weekly detail ("±32.9 detections on a typical day; 9 of 10 days fall within ±97" for Banke-April) |
| **B7** reproducible from a clone | ✅ IMPLEMENTED | `pairs.csv` (16,387 lines incl. split labels) committed under `data/experiments/config/`; `experiments --from-pairs` reproduces the court exactly (verified: identical CCCs, provenance notes the source); CI workflow (`.github/workflows/ci.yml`) runs pytest + vitest + typecheck + lint + build + the from-pairs court with a drift check |

### Additional features (Category 3)

| Rec | Status | Notes |
|---|---|---|
| **C1** downloads | ✅ IMPLEMENTED | "Download weekly CSV" on the comparison chart (weekly values + per-platform counts + evidence level); JSON contracts referenced from the methodology provenance section |
| **C7** held-out scatter | ⏸ DEFERRED | Paired-comparison table + intervals cover the same evidence more compactly; scatter is data-ready (out-of-fold records exported) if wanted later |
| **C3** district small multiples | ✅ IMPLEMENTED | `DistrictSmallMultiples.tsx`: three mini calendars for the same year/layer with per-district totals and weeks-with-detections |
| **C2** seasonal percentile view | ⏸ DEFERRED | Requires cross-year data loading in the Explorer; documented as future work |
| **C4** Chitwan diagnostic | ⏸ DEFERRED | Needs pair-level day/night extension; "we do not know why yet" remains the honest answer |
| **B6** 2001–2011 extension | ⏸ DEFERRED TO ROADMAP | Per the evaluation: requires ~430 new download chunks and an unvalidatable stationarity assumption; documented as the top roadmap item |

### UI/UX (Category 4)

| Rec | Status |
|---|---|
| **D1** plain-language labels | ✅ "Avg error / Big-miss error / Agreement (CCC)" metric headers; "Single constant multiplier" and "Seasonal average (no MODIS)" baseline names; technical terms retained in tooltips/parentheses |
| **D4-lite** reduced motion | code-verified only (unchanged, documented) |

### Scientific integrity (Category 5)

All parameters untouched; verdict wording updated to the stronger honest statement; the
co-detection mechanism explanation corrected everywhere it appears; baselines can never be
selected; the fitted factors are unchanged (A4 added estimators, did not retune).

### Presentation (Category 7)

| Rec | Status |
|---|---|
| **D2** repo tidy | ✅ briefing + guide moved to `docs/`; local `C:\Users\...` path removed from README; **LICENSE** (MIT) added; AI-tooling disclosure added to README |
| **C7-2** demo update | ✅ DEMO.md: seam wording (out-of-sample, log scale), co-detection mechanism corrected, live URL emphasized |
| **C7-3** README | ✅ live URL first, weekly headline in the results table, corrected seam row |

## 3. Rejected recommendations (with reasons)

- Cell-level co-detection map (C5): evaluation itself says not worth it.
- 2001–2011 extension as a shipped feature: unvalidatable stationarity assumption; roadmap.
- Lazy-loading the map (D5): evaluation says no.
- Tuning any scientific parameter: would invalidate the court.
- New ML methods: unvalidatable with the current held-out data.

## 4. Files modified in this phase

| File | Change |
|---|---|
| `src/lib/layers.ts` | A1 averaging fix + `platformEstimates`/`estimateBasis` + `weekStratum` midpoint helper |
| `src/lib/layers.test.ts` | **New** — 7 vitest tests (A1 regression, zero preservation, single-platform basis, midpoint stratum) |
| `src/lib/points.ts`, `observations.ts`, `experiments.ts`, `main.tsx` | Base-aware fetches + router basename |
| `src/lib/experiments.ts` | Types: baselines, paired comparisons, weekly validation, seam OOS, intervals |
| `src/components/explorer/CalendarPanel.tsx` | Dimmed low-evidence cells + dot, midpoint stratum, arithmetic panel, interval display |
| `src/components/explorer/ComparisonChart.tsx` | **New** — weekly overlay chart + CSV download |
| `src/components/explorer/DistrictSmallMultiples.tsx` | **New** — district small multiples |
| `src/components/methodology/ResultsSection.tsx` | Baselines table, paired differences, weekly block, OOS seam wording, raw-MODIS correlation, plain-language labels, regrade basis |
| `src/components/explorer/ReadinessPanel.tsx` | Evidence-level definitions |
| `pipeline/experiments.py` | Baselines, weekly evaluation, court restructure, seam OOS, lights-out raw correlation, pair table, from-pairs |
| `pipeline/metrics.py` | `paired_block_bootstrap_diff` |
| `pipeline/validation.py` | Real NOAA-20 variant, out-of-fold collection, regraded reliability + intervals |
| `pipeline/__main__.py` | `--from-pairs`, `export-points` |
| `vite.config.ts`, `src/vite-env.d.ts` | BASE_PATH + vite env types |
| `.github/workflows/ci.yml` | **New** CI |
| `LICENSE` | **New** MIT |
| `docs/` | briefing + guide moved |
| `README.md`, `DEMO.md`, `src/lib/content.ts` | Claim corrections |
| `public/data/experiments/*`, `data/experiments/*`, `data/validation/*` | Regenerated with all new outputs |

## 5. Tests executed (actual results)

- `pytest pipeline/tests -q` → **76 passed** (includes updated reliability/sensitivity tests for the new implementations)
- `npx vitest run` → **7 passed** (new)
- `npm run typecheck` ✓ · `npm run lint` ✓ (0 warnings) · `npm run build` ✓
- Data-integrity: 1,668 chunks sha-verified earlier; counts reconcile (124,506; 16,386 = 13,854+2,172+360)
- Browser: live site verified (explorer rendered, 10 JSON loads, 0 failed requests, markers canvas, no overflow); local browser passes covered popups, full-screen cycle, dimmed cells, arithmetic panel
- CI will re-run all of the above on every push

## 6. Remaining / deferred

- B6 2001–2011 extension (roadmap), C2 seasonal percentile, C4 Chitwan diagnostic, C7 scatter (data-ready), reduced-motion browser emulation.
- The court verdict remains **"no method beats the simplest sufficient correction"** — that is the honest result, now quantified and visible in the UI.
