# AGNIDRISHTI — TASK STATUS

## DOWNLOAD COMPLETION GATE — VERIFIED COMPLETE (2026-11-14)

- Background `python -m pipeline download-historical` processes reached terminal state
  (two concurrent instances ran 01:10–~01:45 NST; both exited cleanly; no active writers).
- `data/manifests/download_manifest.json`: 1672 unique `entry_id`s from 1679 raw appends
  (7 duplicates from the concurrent runs; deduplicated by keeping latest status).
- Per-sensor area-api chunk coverage (expected windows fully present, 0 missing, 0 errors):
  - modis: 589 chunks (545 downloaded, 44 downloaded_empty)
  - viirs_snpp: 589 chunks (565 downloaded, 24 downloaded_empty)
  - viirs_noaa20: 339 chunks (325 downloaded, 14 downloaded_empty)
  - viirs_noaa21: 151 chunks (145 downloaded, 6 downloaded_empty)
- All 1668 files verified: present, byte size matches manifest, SHA-256 matches manifest (80.3 MB).
- Extra overlapping chunk per sensor (2026-03-10→14) is from the Task 03 SP demo run; harmless.
- `downloaded_empty` = zero detections inside the bbox for that window: a genuine result,
  never treated as missing data.
- No MAP_KEY exposure in any log, manifest URL (all redacted with `***`), or output.

## TASK 04B — HISTORICAL DATA PROCESSING & CALIBRATION READINESS — VERIFIED COMPLETE (2026-11-14)

### Phase 1 — Inventory (VERIFIED)
- `data/processed/historical/inventory.json`: per-sensor files, rows, actual first/last
  observation dates, months covered, empty files, checksum dedupe (0 genuine duplicates),
  schema consistency (1 header per sensor family, 1668 files).
- modis 67,111 rows · viirs_snpp 503,792 · viirs_noaa20 306,213 · viirs_noaa21 142,602
  (1,019,718 bbox rows; 2012-01-20 → 2026-07-31 actual observations).
- 0 requested dates without a delivered file; `downloaded_empty` chunks preserved as
  genuine no-detection observations.

### Phase 2 — Historical processing (VERIFIED)
- `python -m pipeline process --provider area-api` re-run unchanged: 1,019,718 raw →
  597 duplicates removed → 124,506 district records (Banke 40,587 / Bardiya 44,622 /
  Chitwan 39,297); NRT kept separate under `data/processed/nrt` + `public/data/nrt`.
- Public SP slices regenerated: `public/data/sp/{district}/{2012..2026}.json` (13 MB).

### Phases 3–7 — Analysis outputs (VERIFIED)
- `data_quality.json`: FRP 100% present; MODIS confidence numeric 0-100 vs VIIRS
  categorical l/n/h; day/night overpass evidence per platform (Terra day ≈10:30 local,
  Aqua ≈13:10, VIIRS ≈12:55); district share of bbox 12.2% matches area expectation;
  grid consistency sample clean; low-detection question investigated geometrically.
- `sensor_overlap.json`: platform-pair co-detection days + monthly matrices + overpass
  evidence with day/night split; simultaneity caveat documented.
- `spatial_comparability.json`: 3,777 comparable cell-days (district sums match bbox);
  shared-grid ≠ physical equivalence documented.
- `coverage_matrices.json`: 6-state matrices (observed/insufficient/incomplete/missing/
  not_requested/unavailable) × 4 sensors × 3 districts × 180 months; never zero-filled.
- `calibration_readiness.json`: overlap sufficient (all 3 districts); suitable months
  concentrate in Feb–May fire season (Banke 18 / Bardiya 29 / Chitwan 42); candidate
  training years 2013–2026, holdouts 2019–2024; Terra/Aqua separable; 6 bias risks listed.
- `analysis_manifest.json`: provenance for all outputs.

### Phase 9 — Tests & build (VERIFIED)
- `pipeline/tests/test_historical.py` added (18 tests): chunk discovery, manifest dedupe,
  partial-download detection, coverage status vocabulary, no-zero-fill, overlap math,
  per-district overlap, comparable cell-days, platform identity preservation, FRP missing,
  readiness thresholds, no-fitted-corrections, reproducibility.
- `pipeline/tests/test_sp.py` updated: SP years now 2012–2026 (was stale `["2026"]`).
- pytest: 44 passed. `npm run typecheck` ✓. `npm run lint` 0 warnings ✓. `npm run build` ✓.

### Known limitations
- Aug–Dec months deliberately not acquired (out of acquisition plan; not FIRMS-unavailable).
- Comparable cell-days are a lower bound on co-observation (overpass timing, clouds).
- Coverage thresholds (≥6 co-detection days/month) are provisional; Task 05 may refine.

Next: TASK 05 — MODIS–VIIRS harmonization experiments.

## TASK 05 — HARMONIZATION EXPERIMENTS — VERIFIED COMPLETE (2026-11-14)

### Comparison framework (Phase 2)
- Unit: district-day counts where both MODIS and VIIRS SNPP delivered files
  (recorded zeros kept; missing files excluded, never zero-filled).
- Reference = VIIRS Suomi-NPP (reference scale, NOT ground truth); Terra and
  Aqua fitted and applied as separate platforms. 16,386 pairs total.

### Methods (Phases 3–5)
- `pipeline/metrics.py`: MAE, RMSE, log-RMSE, mean bias, Pearson, Lin's CCC,
  moving-block bootstrap (calendar-month blocks, seeded), error distribution.
- `pipeline/experiments.py`:
  - **Ratio**: district-month sum ratios (calendar-month factors across years),
    documented fallback district-month → district-pooled → global; zero/weak
    denominators never produce extreme factors.
  - **Quantile mapping**: empirical nonzero-count mapping per district/platform;
    recorded zeros preserved (no fabricated detections); cap at training
    VIIRS maximum; monthly mappings only with sufficient sample.
  - **Monthly shrinkage**: r*_m = λ_m·r_m + (1−λ_m)·r_d, λ_m = n_m/(n_m+20);
    zero-evidence months collapse to the pooled district ratio.
- Config: validation years 2019 & 2022 (whole blocks), purge 30 days,
  k=20, thresholds documented a priori in `data/experiments/config/`.

### Fair validation (Phase 6–7)
- 16,386 total pairs = 13,854 training + 2,172 validation + 360 purge-gap pairs
  (2020-01-01..30 and 2023-01-01..30, excluded from both phases for leakage protection).
- Metrics + 90% moving-block bootstrap CIs + by year/month/district/platform/
  activity-band diagnostics.

### Method Court (Phase 8) — result: INCONCLUSIVE (honest)
- Ranking: monthly_shrinkage (CCC 0.625) > ratio (0.620) > quantile_mapping
  (0.516), but bootstrap CIs overlap (CCC & MAE) and district CCC spread
  0.295 > 0.25 (unstable across districts). No winner declared; evidence and
  selection rule saved in `method_comparison/method_court.json`.
- Raw scale gap documented: VIIRS ref mean 8.27/district-day vs Terra 0.49,
  Aqua 0.58.
- Notable: Chitwan weaker for ALL methods (CCC 0.19–0.34) — honest district
  instability carried forward to Task 06.

### Seam Audit (Phase 9)
- Raw scale step at VIIRS record start: 8–50× (VIIRS/raw MODIS); after
  harmonization 0.8–2.1 (ratio & shrinkage ~97–99% step reduction; quantile
  72–92%). No method fully removes the mismatch — reported honestly.
- Intra-MODIS product-version seam found: 6.03 (2012–2022) vs 61.03 (2023+).
- Explicitly diagnostic, not causal; confounds listed; pre-2012 era outside
  acquired record documented.

### Lights-Out Backtest (Phase 10)
- Held-out years reconstructed without any validation-year fitting: monthly
  profile correlation 0.97–1.00 (patterns preserved); quantile mapping
  over-smooths (variation ratio 0.26–0.43); ratio/shrinkage 0.77–1.31.
- Error-vs-coverage relationship reported per month.

### Outputs (Phase 11)
- `data/experiments/{config,fitted_models,validation,metrics,uncertainty,
  method_comparison,seam_audit,lights_out,reports}` — all JSON with full
  provenance; `reports/summary.md` mirrors results with limitations.

### Tests (Phase 12)
- `pipeline/tests/test_experiments.py` (22 tests): ratio fallbacks, zero
  denominators, quantile zero-preservation & caps, sparse handling, shrinkage
  lambda behavior, blocked split + purge, leakage prevention, metric values,
  CCC-vs-Pearson, bootstrap determinism, court fairness, reproducibility,
  sensor identity preservation.
- pytest: 66 passed. typecheck ✓ lint ✓ build ✓.

### Known limitations
- No method selected by the court — evidence does not support one (Task 06
  must treat all three as candidates).
- Aug–Dec outside acquired record; no seasonal claims beyond Jan–Jul.
- Conditional-on-co-observation calibration: fires MODIS misses entirely are
  under-represented in the fitted relationship.

Next: TASK 06 — independent scientific validation & reliability audit.

## TASK 06 — INDEPENDENT SCIENTIFIC VALIDATION & RELIABILITY AUDIT — VERIFIED COMPLETE (2026-11-14)

### Phase 1 — Independent results audit (PASSED)
- `pipeline/validation.py` re-implements all metrics independently of
  `pipeline.metrics` and recomputes every court metric from saved fitted
  models: **0 discrepancies**.
- Integrity checks passed: train/validation separation (0 overlap), purge
  zones respected, validation years exact, identical court sample, recorded
  zeros preserved (1,404 modis-zero / reference-zero days kept as recorded
  observations), sensor identity present for all 6 district|platform scopes.
- Tamper-detection verified by test (fake MAE → flagged).

### Phase 2 — Sensitivity analysis (7 variants)
- monthly_shrinkage stays top in 5/7 variants; ratio overtakes under
  holdout-2025 and raised denominator floors → **the Task 05 inconclusive
  verdict is confirmed as correct** (no method is robustly best).

### Phase 3 — Temporal robustness (leave-one-year-out, 15 folds)
- CCC per year 0.37 (2020) to 0.71 (2017); no year below the caution floor.
- Per-year variability documented; no general reliability claim possible.

### Phase 4 — Spatial robustness
- Banke 0.62 / Bardiya 0.63 / **Chitwan 0.34** best-CCC (724 validation pairs
  each). Cell-level error analysis: 100 validation cell-days; high-error
  cells concentrate in high-activity cells; cells with <10 validation days
  flagged insufficient.

### Phase 5 — Reliability framework (documented criteria, not labels)
- Strata (district × month-of-year): **2 reliable / 4 use-with-caution /
  15 insufficient-evidence / 15 unavailable**. Criteria: reliable = n≥30,
  CCC≥0.50, bias CI includes 0; caution = n≥10, CCC≥0.30.
- `data/validation/reliability.json` full grid; frontend contract copy at
  `public/data/experiments/summary.json`.

### Phase 6 — Failure modes (all fail-safe)
- Missing dates → documented fallback; empty district → finite identity;
  unseen values → capped at training support; unexpected fields → ignored;
  missing reference sensor → honest empty sample; coverage change → matrix
  statuses (never zeros).

### Phase 7 — Claims audit
- `claims_audit.json`: 1 supported, 1 supported-with-qualification,
  8 claim classes marked must-never-be-made (ground truth, winner,
  bias-removal, unique fires, zero-filling, district equality, causality,
  prediction, NASA endorsement). Task 07 applies these to the UI copy.

### Phase 8 — Final report
- `data/validation/reliability_report.json`: verification verdict,
  robustness summaries, reliability criteria/categories, conditions for use,
  conditions requiring reanalysis.

### Phase 10 — Tests
- `pipeline/tests/test_validation.py` (10 tests): independent metric
  cross-check, tamper detection, purge-zone leak detection, reliability
  thresholds, insufficient-stays-insufficient, sensitivity structure,
  failure-mode fail-safety, claims-audit coverage.
- pytest: **76 passed**. typecheck ✓ lint ✓ build ✓.

### Known limitations
- Chitwan remains use-with-caution/insufficient at most strata.
- Reliability grid reflects the acquired record (Jan–Jul only).

Next: TASK 07 — final product integration, production polish & presentation.

## TASK 07 — FINAL PRODUCT INTEGRATION — VERIFIED COMPLETE (2026-11-14)

### Phase 1 — Audit
Completion checklist produced from actual repo state; placeholders identified and replaced.

### Phase 2 — Real data integration
- Explorer now loads live data via `src/lib/observations.ts` (provider SP default, NRT switch):
  index -> years -> district-year dataset. Loading / empty / unavailable states throughout.
- New `src/lib/experiments.ts`: typed loaders for `/data/experiments/summary.json` and
  `harmonization_factors.json` with runtime shape guards.
- New pipeline command `export-frontend` publishes harmonization factors (monthly shrinkage,
  explicitly marked provisional/inconclusive).

### Phases 3–5 — Explorer and scientific features
- **Year × Week calendar heatmap** (53 ISO-week cells, month labels, sqrt-scaled colour ramp,
  hatched unobserved weeks): layers = Harmonized (provisional VIIRS-equivalent estimate from real
  fitted factors, co-observation required, no estimates invented), MODIS raw (Terra+Aqua,
  labelled), VIIRS raw (Suomi-NPP reference).
- **Weekly detail panel**: dates, week status + days covered, per-platform detections with
  days-observed, harmonized estimate, reliability stratum badge, "not unique fires" caveat.
- **Record highlights** panel: descriptive statistics only, explicitly not anomaly tests.
- **Readiness panel**: live pipeline status + reliability strata counts.
- **Map** remains boundary context (no fabricated markers); caption updated honestly.
- **Methodology page**: new "Results & reliability" section rendering the live Method Court
  table, inconclusive banner, reliability category counts; statuses updated (implemented vs
  not-claimed); data sources show connected products; section indices fixed.
- **Landing/copy** (`content.ts`): capabilities updated to Implemented·diagnostic / Computed·
  inconclusive / Computed with honest descriptions; validation checks marked Computed.

### Phase 10 — Verification (all executed)
- pytest: 76 passed. typecheck / lint (0 warnings) / production build: pass.
- **Browser verification actually performed** (in-app browser, production build via
  `npm run preview`): home, /explorer (week click -> detail with real values, year switch 2016,
  layer switch, provider combobox), /methodology results table, /about, 404 route, mobile 390px
  (no page-level horizontal overflow; calendar scrolls internally), desktop 1440px screenshots.
- Direct navigation to every route verified working in the production build.

### Phase 11 — Documentation
- README rewritten for the final state (pipeline commands, scientific workflow, headline
  results, structure, limitations).
- DEMO.md: guided demonstration script, screenshot checklist, judging Q&A, reproducibility.

### Remaining limitations (documented in-app)
- Court verdict inconclusive; harmonized layer provisional by design.
- Chitwan strata mostly use-with-caution/insufficient; shown as such.
- Aug–Dec not acquired; NRT slice is a single 7-day window (2026-11-07→13).
- 103 MB hero .mov moved to media_archive/ (outside public/); dist videos ~10 MB.

## PROJECT STATUS: ALL PROMPT.TXT TASKS (04B, 05, 06, 07) VERIFIED COMPLETE

## TASK 08 — FINAL PRE-SUBMISSION AUDIT — VERIFIED COMPLETE (2026-11-14)

### 1. Pair-count discrepancy — RESOLVED (no data was missing)
16,386 total = 13,854 training + 2,172 validation + **360 purge-gap pairs**
(2020-01-01..30 and 2023-01-01..30 — the 30 days after each held-out year, excluded from BOTH
phases for leakage protection; 60 dates × 3 districts × 2 platforms). Verified by recomputation.
Fixed reporting in: `metrics/summary.json` (now emits `purge_pairs` + reconciliation note),
frontend `public/data/experiments/summary.json`, methodology Results section (renders the full
reconciliation), `reports/summary.md`, TASK_STATUS.md, FINAL_REPORT.md.

### 2. Reliability badge audit — RESOLVED
Weekly-detail badge now reads `data stratum: reliable` (was bare `reliable`), and the caveat
explicitly states the badge describes the observational evidence for that district × month and
does NOT validate the harmonization method, whose verdict remains inconclusive. The inconclusive
verdict stays visible in: harmonized-layer caption, methodology banner + court badge, README,
ReadinessPanel.

### 3. Production size — RESOLVED (127 MB → 23 MB)
103 MB hero `.mov` moved from `public/videos/` to `media_archive/` (outside `public/`, still
preserved). App only ever served WebM/MP4/poster; no code change needed. README hero-media
section + deployment note updated. Rebuilt and browser-verified: hero video plays identically
on desktop 1440px.

### 4. Coverage messaging — RESOLVED
CalendarPanel (SP product) now carries a coverage footnote: Jan–Jun 2012–2026 + Jul 2026;
August–December "**not requested**" — acquisition scope, never evidence of no fires; in-coverage
months without detections marked insufficient, not zero. DataNotice carries the same distinction.

### 5. Scientific/UI consistency audit — PASS
Grepped all UI/copy: every "ground truth" mention is a negation; all winner language states none
was declared; NASA mentions are attribution + non-endorsement disclaimers only; anomaly language
is disclaimed; missing ≠ zero holds in code (status vocabulary) and copy; sensor identities stay
separate end-to-end; every displayed value traces to published JSON.

### 6. Presentation review — PASS
README/DEMO verified against actual implementation; screenshot checklist routes/states are real;
Q&A answers match behavior (incl. the new purge explanation for judges).

### 7. Final verification — ALL PASS
pytest 76/76 · typecheck ✓ · lint 0 warnings ✓ · build ✓ · dist **23 MB** (was 127 MB).
Browser: landing (hero video ✓ desktop), Explorer (week detail + badge + coverage note ✓),
Methodology (reconciliation + inconclusive ✓), About ✓, 404 ✓ ("Route not found" page renders
with links home), mobile 390px: no horizontal overflow.

### Remaining known limitations (unchanged, documented)
Court verdict inconclusive (harmonized layer provisional); Chitwan strata caution/insufficient;
Aug–Dec not acquired; NRT = one 7-day window; co-observation-conditioned calibration; residual
scale steps 0.8–2.1.

## PROJECT STATUS: TASK 08 COMPLETE — READY FOR SUBMISSION

## TASK 09 — COMPLETE END-TO-END FEATURE VERIFICATION — VERIFIED COMPLETE (2026-11-14)

Full report: FINAL_FEATURE_AUDIT.md. 26 feature areas tested against the production build and
real datasets: 25 PASS, 0 FAIL, 1 PARTIAL (documented), 0 untested.

- Phase 1 data integrity: all contracts v1.0.0; counts reconcile (124,506 = sum of districts;
  frontend == quality report); weekly↔daily 0/27 mismatches; credential scan clean; manifest
  URLs redacted.
- Browser (desktop 1440, laptop 1366, mobile 390): landing (video playing, 0 failed requests),
  Explorer interaction matrix (providers/years/districts/layers), weekly detail values == JSON
  (83/64/1,297), readiness + reliability + coverage messaging verified, methodology court table,
  About, 404, history navigation, no page-level overflow at any viewport.
- Defect found & fixed: raw-layer weekly detail labelled the harmonized stat "Not observed / no
  data" → now "Not computed — switch to the Harmonized layer"; regression-verified live.
- Suite re-run after the fix: 76 pytest ✓ typecheck ✓ lint ✓ build ✓ (dist 23 MB).
- Reduced motion: code-verified only (harness cannot emulate the media query) — documented.
- Verdict: READY FOR SUBMISSION.

## PROJECT STATUS: ALL TASKS (04B, 05, 06, 07, 08, 09) VERIFIED COMPLETE

## TASK 10 — FEATURE QUALITY IMPROVEMENT PASS — VERIFIED COMPLETE (2026-11-14)

Full report: FINAL_FEATURE_IMPROVEMENT_REPORT.md.

- **Geographic Fire Map (top priority)**: rewritten from boundary-only SVG to a real Leaflet +
  OpenStreetMap map — dark-styled tiles, interactive OCHA COD-AB district polygons, district
  choropleth from real aggregated yearly data, map-click + quick-select district selection,
  zoom in/out/fit-to-district, legend, on-map attribution, coverage sentence. Synchronized with
  provider/year/layer. No fabricated hotspot coordinates; legend states "district totals — not
  fire locations".
- **Critical periods**: distribution comparison added (rank, median, positive weeks %, below-quarter
  count, coverage) + why-highlighted explanation; label kept "Descriptive — not a statistical
  anomaly test".
- **Seam Audit + Lights-Out visualizations**: new Methodology sections rendering verbatim
  experiment outputs (published via validation.py into summary.json): before/after scale-step
  bars per district/platform, held-out-year reference-vs-reconstruction profiles, over-smoothing
  explanation. Diagnostic/held-out badges preserved.
- **Reliability experience**: category definitions in ReadinessPanel + Methodology; Chitwan
  weaker-evidence note; stratum-vs-method distinction stated in both places. Thresholds unchanged.
- **Single source of truth**: `src/lib/layers.ts` shared by calendar + map (identical week metrics).
- **Explorer UX**: NRT 7-day-window footnote.
- Verification: 76/76 pytest · typecheck ✓ · lint ✓ · build ✓ (dist 23 MB; JS 585 KB / 181 KB
  gzip incl. Leaflet) · browser-verified desktop 1440 + mobile 390 (map interaction, sync,
  methodology charts, zero overflow, zero failed requests).

## PROJECT STATUS: TASKS 04B–10 ALL VERIFIED COMPLETE

## TASK 11 — GEOGRAPHIC FIRE MAP IMPROVEMENT — VERIFIED COMPLETE (2026-11-14)

- **Full-screen map**: expand button → fixed overlay (Escape/Exit to close), body scroll lock,
  Leaflet invalidateSize on enter AND exit (canvas resize bug found & fixed: the pre-existing
  expanded-size canvas covered the header after collapsing).
- **Real hotspot markers**: new pipeline export `pipeline/points.py` (CLI `export-points`) publishes
  verified point-level FIRMS detections (lat/lon/date/time/platform/brightness/FRP/confidence/
  day-night) per provider/district/year → public/data/points/ (124,506 SP + 17 NRT records, 48
  files, 18 MB). Markers rendered on a Leaflet canvas renderer, coloured per platform, sized by
  FRP, popups with verified attributes (popup record cross-checked 1:1 against exported data).
- **Layer modes**: District activity / Hotspots / Both with dynamic legend; markers respect
  provider/year/layer; harmonized estimates never drawn as observed hotspots (raw MODIS inputs
  shown instead, labelled).
- **Fixes during verification**: canvas default 0.1 padding escaped the container clip and covered
  panel controls (removed padding + enforced overflow clipping); hotspot canvas intercepted
  district-polygon clicks (map click + point-in-polygon district selection implemented).
- Verification: 76/76 pytest · typecheck ✓ · lint ✓ · build ✓ · browser-verified (markers render,
  popup matches dataset exactly, full-screen cycle, NRT vs SP separation incl. honest NOAA-20/21-only
  window, district click selection, mobile 390 no overlap/overflow).

## PROJECT STATUS: TASKS 04B–11 ALL VERIFIED COMPLETE

## TASK 12 — CLAUDE EVALUATION IMPLEMENTATION — VERIFIED COMPLETE (2026-11-14)

Independent evaluation findings verified first-hand, then implemented per
AGNIDRISHTI_CLAUDE_EVALUATION_IMPLEMENTATION_PLAN.md. Full report:
AGNIDRISHTI_CLAUDE_EVALUATION_IMPLEMENTATION_REPORT.md.

- **A1 fixed**: Harmonized layer now AVERAGES per-platform estimates (was 1.99x VIIRS, now 0.995x
  over 1,206 co-observed weeks). 7 vitest regression tests added.
- **A2 fixed**: low-evidence stratum cells dimmed with a marker; late-December ISO weeks use the
  midpoint month; wording corrected everywhere.
- **A3 fixed**: NOAA-20 sensitivity variant rebuilt for real (pairs rebuilt against NOAA-20).
- **A4 added**: constant-ratio + seasonal-climatology baselines in the Method Court with paired
  block-bootstrap CCC differences. Verified result: the constant baseline (CCC 0.653) is NOT beaten
  by any method (shrinkage diff -0.028, CI [-0.048, +0.043]) — the court now says exactly that.
- **A5 fixed**: seam audit out-of-sample (2012 excluded from refit) + log-scale reduction reported.
- **B2 added**: weekly-scale validation (shrinkage 0.884 / ratio 0.882; Terra 0.847 / Aqua 0.936) —
  now the headline beside the daily figures.
- **B4/B5**: reliability regraded from pooled out-of-fold predictions (7 reliable / 6 caution /
  8 insufficient / 15 unavailable) + per-stratum held-out error intervals shown in the weekly detail.
- **B3/C6/C1/C3**: comparison overlay chart, show-the-arithmetic panel, weekly CSV download,
  district small multiples.
- **B7/B1**: pairs.csv committed + --from-pairs reproduces the court from a bare clone; CI workflow;
  **live URL deployed**: https://pranish-thapa.github.io/agnidrishti/ (verified in browser).
- **D1/D2/A6**: plain-language labels, docs/ tidy, MIT LICENSE, AI disclosure, all claim mismatches
  corrected (5-of-7, 98%-closed, under-represented, 0.1° role, never-displayed).
- Deferred (documented): B6 extension, C2 seasonal percentile, C4 Chitwan diagnostic, C7 scatter.
- Verification: 76 pytest + 7 vitest + typecheck + lint + build + live-site browser checks
  (0 failed requests, 10 data files loaded, routing + data paths correct on Pages).

## PROJECT STATUS: TASKS 04B–12 ALL VERIFIED COMPLETE

## TASK 13 — EXPANDED GEOGRAPHIC MAP REDESIGN — VERIFIED COMPLETE (2026-11-14)

- **Full-screen map redesigned as a standalone mapping application** (portal overlay, Leaflet
  container moved between hosts, invalidateSize + same-view setView on enter/exit — canvas
  repaint issue diagnosed and fixed).
- **Floating top bar**: identity, working search (district/province/p-code), functional year +
  SP/NRT selectors, layer modes, exit.
- **Floating control group**: zoom in/out, reset view, fit all districts, fit selected district.
- **Bottom info panel**: collapsible; district/year/provider, genuine hotspot count, coverage,
  layer explanation; updates on district and hotspot selection.
- **Hotspot interaction**: popups with verified attributes (platform/date/time/coords/brightness/
  FRP/confidence/pass/district + NASA FIRMS source); zoom-aware dot sizing; bottom panel updates
  on marker click (record cross-checked 1:1 against exported dataset).
- **Desktop + mobile verified**: no overlap, no overflow, controls within reach on mobile,
  panel collapsible; canvas repaint verified on enter and exit.
- Verification: 76 pytest + 7 vitest + typecheck + lint + build ✓; console/network clean.
