# AGNIDRISHTI — CLAUDE EVALUATION IMPLEMENTATION PLAN

Source: `Agnidrishti independent judge-style evaluation.md` (Part 1) +
`Agnidrishti_evaluation_PART2_remaining_sections.md` (Part 2).
All Part-1 headline findings were **re-verified first-hand against this repository** before planning:

| Finding | Re-verification result |
|---|---|
| Harmonized layer ≈ 1.99× VIIRS | **Confirmed**: 1.99 over 1,206 co-observed weeks; Terra alone 1.013, Aqua alone 0.976; demo week 2,779.9 vs 1,297 |
| 784 of 1,206 estimate-weeks in "insufficient" strata | **Confirmed** (65%), plus 36 weeks mapping to *unavailable* strata via the late-December ISO-month lookup |
| NOAA-20 sensitivity variant is a no-op | **Confirmed**: `reference_sensor` accepted by `_evaluate_configuration` but never used |
| Court omits constant-ratio + seasonal baselines | **Confirmed** (no baselines in `run_method_court`) |
| Seam audit in-sample; "98% closed" is linear-scale | **Confirmed** (audit window Feb–Apr 2012 is inside the training years) |

Already implemented / not applicable (from the reports' own checks): no train-val leakage; LOYO
present; split reproducible (13,854 / 2,172 / 360); claims audit exists; coverage vocabulary solid.

## CATEGORY 1 — CRITICAL FIXES

| # | Task | Priority | Files | Depends | Complexity |
|---|---|---|---|---|---|
| C1-1 | **A1**: Fix Harmonized layer — average per-platform estimates over platforms with observed days instead of summing (each factor predicts the full SNPP count). Update `computeWeekCell` + `aggregateDistrictYear`. | P0 | `src/lib/layers.ts` | — | Low |
| C1-2 | **D3**: Vitest frontend test — summed/averaged harmonized ≈ 1.0× VIIRS on fixture weeks; zero-preservation; fallback behaviour. | P0 | `package.json`, `src/lib/layers.test.ts`, `vitest.config.ts` | C1-1 | Low-Med |
| C1-3 | **A2**: Reliability-aware calendar — cells in `insufficient_evidence` strata rendered dimmed with a low-evidence dot; week-month lookup uses the ISO-week **midpoint** (fixes 36 late-December weeks); wording updated ("shown dimmed with their evidence level", not "never displayed"). | P0 | `src/lib/layers.ts`, `CalendarPanel.tsx`, `ReadinessPanel.tsx`, `ResultsSection.tsx` | — | Medium |
| C1-4 | **A3**: Make the NOAA-20 sensitivity variant real — rebuild pairs with `viirs_noaa20` as reference inside the variant (records + requested dates passed through), or drop it. Implement properly. | P0 | `pipeline/validation.py` | — | Medium |
| C1-5 | **A6a**: Fix claim mismatches in docs/UI: "5 of 7"→real counts, "98% closed"→log-scale + residual, "under-represented misses"→correct mechanism (VIIRS-on-MODIS-zero days inflate the factor numerator; scaling cannot recover them), "0.1° grid" role, "never displayed" wording. | P0 | `DEMO.md`, `README.md`, `content.ts`, `ResultsSection.tsx`, briefing docs | — | Low |

## CATEGORY 2 — HIGH-PRIORITY IMPROVEMENTS

| # | Task | Priority | Files | Depends | Complexity |
|---|---|---|---|---|---|
| C2-1 | **A4**: Add baselines to the Method Court: `fit_constant` (single global multiplier) + seasonal climatology predictor (per calendar-month VIIRS mean, no MODIS input); paired month-block bootstrap of CCC differences in `metrics.py`; baselines reported in court output + UI. **No existing parameter changes.** | P0 | `pipeline/experiments.py`, `pipeline/metrics.py`, `validation.py`, `ResultsSection.tsx`, tests | — | Medium |
| C2-2 | **B2**: Weekly-scale validation — evaluate pairs grouped into ISO weeks; export weekly CCC per platform + overall into `summary.json`; present beside the daily headline in ResultsSection. | P0 | `pipeline/experiments.py` or `validation.py`, `ResultsSection.tsx` | — | Medium |
| C2-3 | **A5**: Seam audit out-of-sample — refit methods excluding the audit window years/months from training; report residual factors + log-scale reduction beside linear; reword "gap closed". | P1 | `pipeline/experiments.py`, `ResultsSection.tsx`, `content.ts` | — | Medium |
| C2-4 | **B4**: Regrade reliability from pooled leave-one-year-out out-of-fold predictions (≈7× more evidence per stratum than 2 held-out years); keep thresholds; regenerate grid. | P1 | `pipeline/validation.py` | — | Medium |
| C2-5 | **B5**: Per-stratum uncertainty intervals from out-of-fold errors → `summary.json` → weekly detail panel + dimmed low-evidence cells (with C1-3). | P1 | `pipeline/validation.py`, `src/lib/experiments.ts`, `CalendarPanel.tsx` | C2-4 | Medium |
| C2-6 | **B3**: ComparisonChart — SVG weekly overlay of Terra, Aqua, Suomi-NPP and the averaged harmonized estimate for the chosen district/year, hatched unobserved weeks. | P1 | new `src/components/explorer/ComparisonChart.tsx`, `ExplorerPage.tsx` | C1-1 | Medium |
| C2-7 | **C6**: Show-the-arithmetic panel in the weekly detail: per-platform raw count × factor (with fitted/fallback status) = estimate. | P1 | `CalendarPanel.tsx` | C1-1 | Low |
| C2-8 | **B1**: Deploy live URL to GitHub Pages (`base: '/agnidrishti/'`, 404.html SPA fallback, gh-pages branch, enable Pages); URL first in README. | P1 | `vite.config.ts`, workflow/script, `README.md` | — | Medium |
| C2-9 | **B7**: Commit the 16,386-row pair table + `--from-pairs` for the experiments CLI + CI workflow (pytest, typecheck, lint, build). | P2 | `pipeline/experiments.py`, `__main__.py`, `.github/workflows/ci.yml` | — | Medium |

## CATEGORY 3 — ADDITIONAL FEATURES

| # | Task | Priority | Files | Depends | Complexity |
|---|---|---|---|---|---|
| C3-1 | **C1**: Download CSV/JSON of the weekly series (with stratum grade + interval) from the Explorer; link the existing JSON datasets from Methodology. | P2 | `ExplorerPage.tsx`, new `src/lib/export.ts`, `MethodologyPage.tsx` | C2-5 | Low-Med |
| C3-2 | **C7**: Held-out observed-vs-estimated weekly scatter (SVG, 1:1 line) from pooled out-of-fold predictions; export data via summary.json. | P2 | `validation.py`, `ResultsSection.tsx` | C2-4 | Medium |
| C3-3 | **C3**: District small-multiples (three mini heatmaps for the chosen year/layer). | P2 | `ExplorerPage.tsx`, new component | — | Low-Med |
| C3-4 | **C2**: Seasonal percentile for weeks (deferred — needs cross-year data loading; documented as roadmap). | Deferred | — | — | Medium |
| C3-5 | **C4**: Chitwan day/night + FRP-band diagnostic (deferred — needs pair-level day/night extension). | Deferred | `pipeline/validation.py` | — | Medium |
| C3-6 | **B6**: 2001–2011 MODIS-only extension (deferred to roadmap: requires ~430 new download chunks, MAP_KEY availability, and a stationarity analysis; documented as the top roadmap item per the evaluation). | Deferred | `download.py` etc. | — | High |

## CATEGORY 4 — UI/UX IMPROVEMENTS

| # | Task | Priority | Files | Complexity |
|---|---|---|---|---|
| C4-1 | **D1**: Plain-language labels with technical tooltips ("agreement score (CCC)", "evidence level (stratum)", "overlap check (Seam Audit)"). | P1 | `ResultsSection.tsx`, `CalendarPanel.tsx`, `content.ts` | Low |
| C4-2 | Default Explorer layer stays Harmonized (now fixed) with corrected value ~VIIRS-scale; keep raw layers prominent. | P1 | verified in browser | Low |
| C4-3 | **D4-lite**: keep reduced-motion support (code-verified); skip colour-blindness simulation (declared untested). | P3 | — | — |

## CATEGORY 5 — SCIENTIFIC / DATA-QUALITY

| # | Task | Priority | Notes |
|---|---|---|---|
| C5-1 | Keep all fitted parameters untouched (evaluation: "do not tune parameters to improve court numbers"). | P0 | enforced |
| C5-2 | Court verdict wording: "no method beats the simplest sufficient correction; scaling works; month/district structure unproven; quantile mapping biased low" — replacing bare "inconclusive" where shown. | P0 | `ResultsSection.tsx`, `content.ts`, DEMO |
| C5-3 | Correct the co-detection explanation (VIIRS-on-MODIS-zero days hold 25.7% of VIIRS detections and inflate factor numerators; scaling cannot recover them). | P0 | DEMO, briefing, guide |

## CATEGORY 6 — TESTING & VERIFICATION

| # | Task | Priority |
|---|---|---|
| C6-1 | Vitest for `layers.ts` (C1-2) + keep 76 pytest green. | P0 |
| C6-2 | New pytest tests: baselines, paired bootstrap, NOAA-20 variant non-degeneracy, weekly evaluation, out-of-fold reliability. | P0 |
| C6-3 | Full verification: typecheck, lint, build, browser (desktop + mobile), data-integrity checks. | P0 |

## CATEGORY 7 — PRESENTATION & JUDGING

| # | Task | Priority |
|---|---|---|
| C7-1 | **D2**: repo tidy — briefing/guide into `docs/`, remove local video path from README, add LICENSE (MIT), note AI-assisted development. | P1 |
| C7-2 | Update DEMO.md to the evaluation's 6-minute sequence (raw 3-instrument week → held-out year → baselines → reliability grid), removing dead claims. | P1 |
| C7-3 | Update README headline with weekly CCC + live URL + corrected claims. | P1 |

## REJECTED / DEFERRED RECOMMENDATIONS (with reasons)

- **C5 cell-level co-detection map** — rejected per evaluation ("not worth adding": large change, modest payoff).
- **B6 2001–2011 extension as a shipped feature** — deferred to roadmap (download scale + unvalidatable stationarity assumption; evaluation sanctions presenting as roadmap).
- **Lazy-loading the map (D5)** — rejected per evaluation.
- **Tuning any scientific parameter** — rejected (would invalidate the court).
- **New ML methods** — rejected per evaluation (unvalidatable with current held-out data).
- **Live URL** — will attempt GitHub Pages; if Pages fails technically, document the exact deploy steps instead of claiming a live URL.

## EXECUTION ORDER

C1-1 → C1-2 → C1-3 → C2-1 (regenerate outputs) → C1-4 → C2-3 (regenerate) → C2-2/C2-4/C2-5 (regenerate) → C1-5/C5-2/C5-3 + C4-1 (copy) → C2-6 → C2-7 → C3-1 → C3-3 → C2-9 → D2/C7-* → B1 → full verification → report → push.
