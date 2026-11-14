# AGNIDRISHTI — COMPLETE FEATURE GUIDE

*How the entire application works, from the user interface down to the satellite data pipeline.*
*Every figure in this document was verified against the project's generated output files on 2026-11-14.*


> **Post-evaluation correction (2026-11-14):** an independent evaluation found the original
> Harmonized layer summed Terra and Aqua estimates (each fitted to the full VIIRS count), reading
> ~1.99× the reference; this is now fixed by averaging. The Method Court now includes a
> constant-ratio baseline and a seasonal climatology (the constant beats all three methods — the
> verdict is 'no method beats the baseline'); the NOAA-20 sensitivity variant was rebuilt for
> real; the Seam Audit is reported out-of-sample on the log scale; reliability strata are graded
> from pooled out-of-fold predictions (7 reliable / 6 caution / 8 insufficient / 15 unavailable);
> and weekly-scale validation is now the headline (Terra 0.847 / Aqua 0.936). Figures in this
> document predate these corrections where they conflict.

---

# PART 1 — PROJECT OVERVIEW

## What Agnidrishti is

Agnidrishti ("fire vision") is a satellite-aware fire activity calendar built for the NASA Space
Apps Challenge 2026 challenge *"Harmonization of MODIS and VIIRS Hot Spots."* It is two things at
once:

1. **An interactive web application** (React) where you explore 14+ years of real satellite fire
   observations for three high-fire districts in Nepal — Banke, Bardiya and Chitwan — week by week.
2. **A scientific data pipeline** (Python) that downloads, cleans and analyses real NASA FIRMS
   satellite data, tests three statistical ways to make two different satellites comparable, and
   honestly reports how well that works.

## The problem it solves

Fire records that span many years are often built from more than one satellite. When a record
switches satellites, the record can appear to jump — more fires, or fewer — even when nothing on
the ground changed. Anyone interpreting the record (forest departments, researchers, conservation
parks) can be misled. Agnidrishti measures that observation gap on real data, tests corrections,
and tells you exactly how much you can trust the result.

## Why MODIS and VIIRS cannot simply be combined

- **Resolution:** MODIS "sees" in ~1 km pixels; VIIRS in ~375 m. A small fire that fills a sixth
  of a VIIRS pixel may be invisible inside a whole MODIS pixel diluted by cool surroundings.
- **Sensitivity:** VIIRS detects smaller and cooler fires that MODIS physically cannot resolve.
- **Overpasses:** MODIS Terra passes in the late morning (~10:30 local), Aqua in the early
  afternoon (~13:10); VIIRS passes around midday (~12:55) — different satellites see different
  moments of a fire's life, and clouds differ between passes.
- **Confidence fields are incomparable:** MODIS confidence is a number 0–100; VIIRS uses
  categories (l/n/h). You cannot even filter them the same way.

On this project's own data, on identical district-days, the average count was **VIIRS 8.27
detections vs MODIS Terra 0.49 and Aqua 0.58** — a ~14–17× scale gap with nothing to do with
actual fire behaviour.

## Why satellite transitions create artificial changes

If a historical record used MODIS up to some year and VIIRS after it, the recorded count would
step up ~10-fold or more at the switch — a purely instrumental artefact that looks exactly like a
fire-activity explosion. Agnidrishti's "Seam Audit" measures this step (see Part 2.6).

## What makes it different from a wildfire dashboard

A monitoring dashboard says "here are today's fires." Agnidrishti is a **record-integrity tool**:
it works on historical standard-processing archives, keeps every satellite platform separate,
shows what was *observed* vs *not observed* vs *not requested*, tests corrections with held-out
data, publishes uncertainty, and refuses to display values where evidence is insufficient. It
makes no claim of predicting fires, and it never treats VIIRS as truth.

## Who benefits

Forest-policy analysts comparing fire seasons across the 2012 sensor transition; protected-area
managers (Bardiya and Chitwan National Parks); researchers building long-term fire records;
anyone auditing whether a "trend" in a fire record is real or instrumental.

## The complete workflow (one paragraph)

NASA FIRMS distributes raw satellite detections as CSVs. A Python pipeline downloads those CSVs
in ≤5-day archive chunks (2012–2026), normalizes every row into a common schema, quality-controls
it (deduplication within a sensor, coordinate/time validation), assigns each detection to a
district by exact point-in-polygon tests, aggregates onto a 0.1° grid and into daily/ISO-weekly
summararies, and exports a versioned JSON contract that the React app fetches. In parallel,
analysis modules measure coverage, sensor overlap and comparability; a harmonization experiment
fits three correction methods on training years and evaluates them on held-out years; an
independent audit recomputes everything; and a reliability grid grades every district × month.
The UI then shows raw counts (real observations) and — clearly labelled as provisional — a
VIIRS-equivalent estimate of MODIS counts.

---

# PART 2 — EVERY MAJOR FEATURE

## 2.1 Historical Fire Activity Explorer (`/explorer`)

**What users can explore:** weekly fire-signal heatmaps for 2012–2026 across three districts,
with three data layers, weekly drill-down detail, boundary context maps and live pipeline status.

**District selection:** three buttons (`ExplorerControls.tsx`, `aria-pressed` toggles) bound to a
`StudyAreaId` state (`src/lib/regions.ts`). Changing district re-fetches that district's dataset
and resets the calendar selection; the map heading, live-region text and detail panel all follow.

**Year selection:** a dropdown whose options are **not hardcoded** — they come from the
observation index (`public/data/sp/index.json` → `index.years`), i.e. exactly the years the
pipeline actually produced (2012–2026 for SP; 2026 for NRT).

**Where observations come from:** NASA FIRMS standard-processing (SP) archives, downloaded as
1,668 CSV chunks (≤5 days each, bbox 80,27,86,29.5) → processed into per-district yearly JSON
files: `public/data/sp/{NP-BANKE|NP-BARDIYA|NP-CHITWAN}/{2012..2026}.json`.

**How the frontend retrieves data:** `src/lib/observations.ts` exposes `loadObservationIndex()`
and `loadDistrictYear()` — typed fetchers with runtime shape guards that return `null` on 404 so
missing data renders as an honest empty state, never as zeros. `ExplorerPage.tsx` chains
provider → index → year → district-year dataset with abortable fetches and loading states.

**How displayed figures are calculated:** a week's displayed number is the sum of that ISO week's
daily per-platform detection counts in the district. No scaling on raw layers. On the Harmonized
layer only, MODIS counts are multiplied by fitted month/district factors (see 2.2).

## 2.2 MODIS–VIIRS Harmonization (`pipeline/experiments.py`)

**What harmonization means:** transforming historical MODIS detection counts into a
**VIIRS-equivalent estimate** — "how many detections would VIIRS-like sensitivity have recorded?"
It is a scale conversion learned from the overlap period, *not* a reconstruction of true fires.

**Why necessary:** the ~14–17× raw scale gap (Part 1) makes raw series incomparable across the
record.

**Sensors involved:** MODIS Terra and Aqua each fitted separately; reference = VIIRS Suomi-NPP
(longest record, 2012→). NOAA-20/NOAA-21 exist in the data (kept separate) but are too short for
full historical correction; NOAA-20 appears only in a sensitivity variant.

**Why VIIRS is the reference:** finer resolution (375 m), more complete detection of small fires,
and it is the sensor that modern and future records will use. It is the *reference scale* —
explicitly **not ground truth** everywhere in the UI.

**How MODIS is adjusted:** `estimate = raw MODIS count × factor(district, platform, calendar
month)`. The three methods differ only in how the factor is computed.

### Method 1 — Ratio-based correction (`fit_ratio` / `apply_ratio`)

**Concept:** if VIIRS records ~R times as many detections as MODIS on comparable days, multiply
MODIS by R.

**Actual implementation:** ratios are computed from **sums over comparable district-days within
the training years**, per calendar month:

- `r_month = Σ VIIRS counts / Σ MODIS counts` for that district + platform + month-of-year
  (e.g. all Aprils of 2013–2018 pooled) — used only when the MODIS sum ≥ 5 (else unstable).
- Fallback chain: district-month → **district-pooled ratio** (all days) → **global ratio** (all
  districts/platforms). A month below the floor uses the district ratio; a district with no
  evidence uses the global ratio; with none at all, identity (×1).

**Illustrative example (numbers invented for clarity, not project results):** April training days
sum to 10 MODIS and 50 VIIRS detections → April factor = 5.0. A later April week with 4 MODIS
detections → estimate 20 VIIRS-equivalent. If May had zero MODIS in training, a May count uses
the district-wide ratio instead — never an invented May factor.

### Method 2 — Quantile mapping (`fit_quantile` / `apply_quantile`)

**Concept:** make the *distribution* of MODIS counts look like the VIIRS distribution, not just
the average.

**Actual implementation:** empirical quantile mapping fitted on **nonzero** training counts per
district+platform: a 99-point grid maps MODIS quantile positions to VIIRS quantile values.

- **Zeros are preserved:** a recorded MODIS zero stays zero — the mapping never fabricates
  detections where MODIS recorded none (this deliberately underestimates; it is documented).
- **Unseen values are capped** at the training VIIRS maximum and flagged as extrapolation.
- Monthly mappings only when a training month has ≥30 nonzero pairs; otherwise the pooled
  mapping is used; with no usable evidence, identity.

**Illustrative example:** if training MODIS nonzero counts span 1–5 and matching VIIRS quantiles
span 3–40, a MODIS count of 2 sitting at the 60th percentile maps to the 60th-percentile VIIRS
value (say 9). A MODIS count of 500 → capped at the training VIIRS max.

### Method 3 — Monthly shrinkage (`fit_shrinkage` / `apply_shrinkage`)

**Concept:** a month with little evidence should not get an extreme factor; blend a noisy monthly
ratio with the stable district-wide ratio, weighted by evidence.

**Formula (actual):**

```
r_m   = Σ V(month m) / Σ M(month m)          raw monthly ratio
r̄_d   = Σ V(all days) / Σ M(all days)       district-pooled ratio
λ_m   = n_m / (n_m + k)                     evidence weight, n_m = MODIS detections in month m
r*_m  = λ_m · r_m + (1 − λ_m) · r̄_d
```

with **k = 20** (chosen a priori and documented): a month needs ~20 MODIS detections before its
raw ratio carries half the weight. Months with zero MODIS detections collapse entirely to r̄_d
(status `insufficient_evidence_pooled_ratio_used` travels with the value).

**Why combine:** calendar-month factors capture seasonality (fire season vs monsoon), while the
pooled ratio keeps sparse months sane. λ grows toward 1 as n_m grows, so well-observed months
trust their own ratio.

**Illustrative example:** April has n_m = 200 → λ = 200/220 ≈ 0.91; raw April ratio 5, district
ratio 3 → r* ≈ 0.91×5 + 0.09×3 ≈ 4.8. A sparse month with n_m = 2 → λ ≈ 0.09; raw ratio 10 →
r* ≈ 0.09×10 + 0.91×3 ≈ 3.6 — pulled hard toward the district norm.

**Remaining limitations (all three methods):** they are conditioned on days/cells where
observations exist; fires MODIS misses entirely are under-represented; cloud/overpass differences
remain inside the counts; the relationship learned in 2012–2018 is assumed stable when applied
elsewhere; VIIRS-equivalent ≠ actual fires.

## 2.3 Interactive Fire Activity Calendar (`CalendarPanel.tsx`)

**Year × Week heatmap:** one button per ISO week (53 possible positions; the actual count varies
24–31 by year because the acquired record covers Jan–Jun + Jul 2026, and ISO week 1 of a year can
start in late December). Cells are CSS-grid columns with month tick labels underneath.

**Colour intensity:** `sqrt(count / max_count(year))` → alpha ramp of terracotta (lower) to amber
(higher). Square-root keeps small counts visible next to extreme fire-season weeks.

**Hatched cells:** weeks where the sensors did not record observations (no file delivered for
that date). The hatch pattern (`repeating-linear-gradient`) visually separates "we know nothing
about this week" from "observed, zero detections" (flat dark cell) — missing is never drawn as
zero.

**Three layers:**
- **Harmonized** — VIIRS-equivalent estimate of MODIS detections using the provisional monthly-
  shrinkage factors; shown only for weeks with MODIS–VIIRS **co-observation**, otherwise empty.
- **MODIS raw** — Terra + Aqua detections summed, labelled as such.
- **VIIRS raw** — Suomi-NPP detections only (the reference platform, kept single on purpose).

**Selecting a week** opens the detail panel: ISO week label (e.g. `2016-W15`), date range, week
status + days covered, per-platform counts with days-observed (`7/7 DAYS OBS`), the harmonized
estimate (or an honest "Not computed — switch to the Harmonized layer" / "No MODIS–VIIRS
co-observation this week"), the **data stratum** reliability badge, and the not-unique-fires
caveat.

**Missing vs zero:** the underlying contract distinguishes `observed`, `observed_zero`,
`missing`, `unavailable`, `incomplete`. Zeros are recorded observations; missing weeks render
hatched with no number.

## 2.4 Geographic Fire Map (`MapPanel.tsx`)

**Implementation:** an inline SVG (no map library). Real district polygons come from
`src/data/nepal-study-areas.json` — extracted from the OCHA COD-AB Nepal admin-2 archive (HDX,
CC BY-IGO, boundary year 2024, ~90 m simplification) by `scripts/prepare-boundaries.cjs`.
`src/lib/geo.ts` projects coordinates with Mercator and fits the polygon to the viewBox.

**Representation:** one filled-and-glowing SVG path per district; zoom in/out/fit buttons scale a
group transform (disabled transitions under reduced motion). The map is **boundary context only**:
its aria-label literally says "No fire detections are shown", the caption explains the calendar is
the observation surface, and no fabricated hotspot markers exist. Selection and data-state remain
consistent because both read the same `StudyArea` object.

## 2.5 Method Court (`run_method_court` in `experiments.py`; rendered by `ResultsSection.tsx`)

**Why it exists:** three defensible corrections exist; picking one by intuition would be exactly
the untested answer the challenge warns against.

**How methods are compared:** identical training pairs, identical validation pairs, identical
evaluation code. Training years = everything except **2019 and 2022** (whole years held out),
with a **30-day purge gap** on each side of every block (leakage protection). Validation = the
2,172 district-day pairs of the held-out years.

**Metrics (plain English):**
- **MAE** — on average how many detections the estimate misses by.
- **RMSE** — like MAE but punishes large misses much more.
- **log-RMSE** — error on log(1+count): judges *relative* accuracy at low counts.
- **Mean bias** — average (estimate − reference); negative = systematic under-estimation.
- **Pearson** — do the two move together? (High alone proves nothing: a 2× scaled copy scores 1.0.)
- **Lin's CCC** — Pearson penalized for scale and offset differences; agreement, not just
  correlation. **CCC is the primary metric.**

**Confidence intervals:** moving-block bootstrap (whole calendar-month blocks resampled, 1,000
iterations, fixed seed) — respects within-season temporal dependence instead of pretending days
are independent. 90% CIs reported for MAE, bias and CCC.

**Decision rule (documented a priori):** select a winner only if the top method's CCC CI separates
from the runner-up's AND its MAE CI shows a corresponding advantage AND per-year/per-district
spread ≤ 0.25. **Current verdict: inconclusive** — CIs overlap and district spread is 0.295, so
no winner is declared and the explorer's harmonized layer is labelled provisional.

## 2.6 Seam Audit (`run_seam_audit` in `experiments.py`; surfaced via capability cards)

**What a seam is:** a discontinuity in a fire record caused by the observation system changing
(satellite swap, resolution change, product version) rather than by fire behaviour.

**How it works here:** for the earliest full months of joint availability (Feb–Apr 2012), the
audit computes the scale step — mean VIIRS ÷ mean raw MODIS — per district and platform, then the
same ratio after each harmonization method. It also detects a second, intra-MODIS seam: the
product version changes from `6.03` to `61.03` between 2022 and 2023 in the downloaded record.

**What it tells us:** the raw step is **8.4×–49.9×**; after ratio/shrinkage harmonization it
falls to **0.81–2.10** (98–99% of the deviation removed); quantile mapping reaches 1.63–14.85
(72–92%). No method fully removes the mismatch — the residuals are published.

**Why diagnostic, not causal:** equal-day comparisons cannot exclude real fire change, weather,
overpass differences, clouds or algorithm versions as contributors. The output lists these
confounds explicitly, and notes the pre-2012 MODIS-only era is outside the acquired record.

## 2.7 Lights-Out Backtest (`run_lights_out` in `experiments.py`)

**What a backtest means:** pretend the reference sensor vanished; can the correction rebuild its
record from the remaining sensor alone?

**How observations are withheld:** the same training/validation machinery — methods fitted with
**zero** access to 2019/2022, then applied to those years' MODIS counts and compared with the
withheld VIIRS reference (2,172 district-days; also re-run per-year in a leave-one-year-out
design across all 15 years).

**Metrics:** overall MAE/CCC per year; **monthly profile correlation** (does the seasonal shape
survive?); **variation ratio** (std of reconstructed monthly totals ÷ std of reference totals —
far below 1 means over-smoothing).

**Actual results:** profile correlation **0.97–1.00** for every method and year — seasonal
patterns survive. Ratio and shrinkage keep realistic variation (0.77–1.31); **quantile mapping
over-smooths (0.26–0.43)** — it flattens real month-to-month swings. That is why a low MAE alone
does not make quantile mapping the winner; the Court weighs stability too.

## 2.8 Reliability and Uncertainty Assessment (`classify_reliability` in `validation.py`)

**How reliability is evaluated:** every district × calendar-month stratum is graded from
**documented thresholds**, not taste:
- **reliable** — ≥30 validation pairs, best-method CCC ≥ 0.50, bias CI contains 0
- **use_with_caution** — ≥10 pairs and CCC ≥ 0.30
- **insufficient_evidence** — below caution thresholds (never displayed as a value)
- **unavailable** — the month is outside the sensor's coverage entirely

Current counts: **2 reliable / 4 caution / 15 insufficient / 15 unavailable**.

**What affects reliability:** comparable-pair sample size, agreement (CCC), bias, coverage of the
month, and the leave-one-year-out audit (years 2013–2025 re-tested; CCC ranged 0.37–0.71, no year
below the caution floor).

**Why Chitwan is weaker:** its stratum CCCs are 0.19–0.34 vs ~0.62 for Banke/Bardiya across all
methods — the overlap evidence there is thinner and more scattered, so the estimate is less
trustworthy. The UI carries this: Chitwan strata grade lower and the caveat travels with values.

**Why a reliable stratum ≠ validated method:** the badge grades *observational evidence in that
district-month* (sample size + agreement). The method-level verdict lives with the Method Court —
and it is inconclusive. Both facts are shown together in the weekly detail.

## 2.9 Real NASA FIRMS Data Integration (`pipeline/`)

**What FIRMS provides:** NASA's Fire Information for Resource Management System distributes active-
fire (hotspot) detections from MODIS (MOD14/MYD14 C6.1) and VIIRS (VNP14IMG family) as CSVs —
latitude, longitude, brightness channels, acquisition date/time, satellite code, confidence, FRP,
day/night.

**SP vs NRT:** Standard Processing is the reprocessed, quality-controlled archive (years after the
fact) — what this project uses for history. Near Real-Time is the fast global 7-day feed — useful
for recency, lower processing rigour. The pipeline keeps them in strictly separate directories and
slices (`data/raw/...`, `public/data/{sp,nrt}/`).

**Datasets downloaded:** 1,668 SP chunks — MODIS_SP 589 (67,111 bbox rows), VIIRS_SNPP_SP 589
(503,792), VIIRS_NOAA20_SP 339 (306,213), VIIRS_NOAA21_SP 151 (142,602) — each verified by size +
SHA-256 against `data/manifests/download_manifest.json`; plus one NRT global snapshot per sensor.

**Normalization (`normalize.py`):** every row → common schema; date/time parsing (3 date formats,
4-digit time normalization); satellite code → platform mapping (T/A/N/N20/N21); per-sensor
confidence typing; FRP/scan/track capture; every anomaly recorded in an `issues` list.

**Cleaning (`qc.py`):** exact-duplicate removal **within sensor+platform only** (key: sensor,
platform, date, time, lat, lon — 597 removed; cross-sensor dedupe deliberately never done); 0
invalid coordinates/timestamps in the historical set; FRP present on 100% of retained records;
confidence filtering disabled (all levels retained, documented).

**Geographic filtering (`geometry.py` + `spatial.py`):** shapely point-in-polygon with prepared
geometries against the three district polygons (no bounding-box shortcut; touching-boundary cases
flagged). 894,615 in-bbox records fall outside the three districts and are counted, not silently
dropped.

**0.1° grid-cell-days (`spatial.build_cell_days`):** each detection is floored into a
0.1°×0.1° cell (`lat_idx = floor(lat/0.1)`); grouped by (district, sensor, platform, date) with
per-cell detection counts and FRP summaries — the "cell-day" is the comparable spatial-temporal
unit for harmonization.

**Daily/weekly outputs (`temporal.py`):** daily blocks per district with per-platform status
(observed/observed_zero/unavailable); ISO-week aggregation (Monday start, ISO week-year) with
week status (observed/incomplete/missing/unavailable) and `days_observed` per platform.

**Provenance (`manifests.py`):** download manifest (URL-redacted, sha256, date windows),
processing manifests, quality reports, analysis manifests — every output traceable to inputs and
timestamps.

## 2.10 Critical Period Identification (`CriticalPeriodsPanel.tsx`)

**What it does:** purely *descriptive* highlights from the selected district-year slice — the
highest recorded weekly detections (with the week's dates) and observation coverage
(`212/212 days observed`).

**What makes a period appear important:** simply being the maximum recorded value in that slice.

**Why not "anomalies":** no statistical test runs; a maximum is not an outlier test, and the
badge/caption say so (`DESCRIPTIVE · NOT ANOMALY TESTS`). Users may conclude "this was the busiest
recorded week here"; they may **not** conclude "this was an anomalous fire event" or "fires
increased because of X". Seam audit and method-agreement rows route to the methodology page.

---

# PART 3 — TECHNICAL ARCHITECTURE

**Frontend (React 18 + TypeScript + Vite 5 + Tailwind 3 + Framer Motion 11 + React Router 6).**

- `src/main.tsx` → `src/App.tsx`: routes (`/`, `/explorer`, `/methodology`, `/about`, `*`),
  per-route document titles/meta, scroll manager, skip-link, page transitions.
- `src/pages/ExplorerPage.tsx` — the stateful core: provider/year/district/layer state; three
  data effects (experiment artifacts once; observation index per provider; district-year dataset).
- `src/lib/observations.ts` — the **typed FIRMS contract**: `ObservationIndex`,
  `ObservationDataset`, day/week blocks, runtime shape guards (`isObservationIndex`), abortable
  loaders returning `null` on 404 (honest emptiness).
- `src/lib/experiments.ts` — typed loaders for court/reliability/factors artifacts + `getFactor()`
  which always pairs a ratio with its evidence status.
- `src/lib/regions.ts` / `geo.ts` / `palette.ts` / `content.ts` — district configuration,
  Mercator projection & SVG path building, design tokens, editorial copy with statuses.
- `src/components/explorer/*` — controls, calendar+detail, map, record highlights, readiness.
- `src/components/methodology/ResultsSection.tsx` — renders `summary.json` (court + reliability).
- Design system: `index.css` tokens + Tailwind config derived from `palette.ts`; Ember & Earth
  palette; Instrument Serif / IBM Plex.

**Python pipeline (no web server):**

- `pipeline/config.py` — single source of truth: paths, sensor definitions (platforms, confidence
  kind, brightness fields, SP/NRT identifiers), district definitions, providers, contract version,
  grid size.
- `pipeline/download.py` + `http.py` — throttled retrying downloader (secrets redacted to `***`,
  `.part` atomic writes, range-resume), NRT + Area API + historical window generation.
- `pipeline/normalize.py`, `qc.py`, `geometry.py`, `spatial.py`, `temporal.py`, `export.py` —
  the processing chain (Part 2.9).
- `pipeline/historical.py` — Task-04B analysis (inventory, quality, overlap, comparability,
  coverage matrices, readiness) with manifest dedupe.
- `pipeline/experiments.py` — Task-05 (pairs, split, three methods, court, seam, lights-out,
  frontend artifact export).
- `pipeline/metrics.py` — metrics + moving-block bootstrap.
- `pipeline/validation.py` — Task-06 (independent metrics re-implementation, integrity audit,
  sensitivity, LOYO, spatial/cell robustness, reliability, failure modes, claims audit).
- `pipeline/__main__.py` — CLI: `download-nrt`, `download-area`, `download-historical`,
  `process`, `historical-analysis`, `experiments`, `validate`, `export-frontend`, `availability`,
  `boundaries`.

**Storage layout:** `data/raw/` (untouched NASA CSVs, 156 MB) → `data/intermediate/` →
`data/processed/{nrt,sp,historical}/` → `public/data/{nrt,sp}/` (frontend slices) +
`public/data/experiments/` (court summary, reliability grid, harmonization factors) → `dist/`
(copied at build). `data/experiments/` and `data/validation/` hold full scientific outputs
(fitted models, per-method validation, seam, lights-out, audit reports). `media_archive/` holds
the undeployed 103 MB hero original.

**Testing:** 76 pytest tests in `pipeline/tests/` (test_historical 18, test_experiments 22,
test_validation 10, plus pre-existing contract/geometry/integration/normalize/qc/spatial/temporal
tests). Synthetic fixtures only — no test touches the real dataset or fabricates results. Frontend
quality gates: `tsc --noEmit`, strict eslint (0 warnings), production build; verified by real
browser passes (documented in FINAL_FEATURE_AUDIT.md).

**How it fits together:** the React app never imports Python results as code — it fetches JSON.
Changing any scientific assumption means re-running a pipeline command; the UI updates from the
new artifacts, and the same artifacts are what the tests and audit read.

---

# PART 4 — COMPLETE DATA FLOW (as actually implemented)

```
NASA FIRMS (live APIs)
   │  firms.modaps.eosdis.nasa.gov  — Area API (SP, ≤5-day chunks) + public 7-day NRT
   ▼
pipeline/download.py + http.py          data/raw/{modis,viirs_*}/…_SP/*.csv  (1,668 files, sha256)
   ▼
pipeline/normalize.py                   common record schema, issues[], acq_datetime
   ▼
pipeline/qc.py                          within-sensor dedupe (−597), validation  → 1,019,121 valid
   ▼
pipeline/geometry.py + spatial.py       exact point-in-polygon → 124,506 district records;
   │                                    0.1° grid cell-days
   ▼
pipeline/temporal.py + export.py        daily + ISO-week JSON contract →
   │                                    data/processed/sp/ + public/data/sp/{district}/{year}.json
   ▼
pipeline/historical.py                  inventory · quality · overlap · comparability ·
   │                                    coverage matrices · calibration readiness
   │                                    → data/processed/historical/*.json
   ▼
pipeline/experiments.py  (metrics.py)   pairs → blocked split → fit ratio/quantile/shrinkage →
   │                                    Method Court · Seam Audit · Lights-Out
   │                                    → data/experiments/** + fitted factors
   ▼
pipeline/validation.py                  independent metric re-computation · integrity audit ·
   │                                    sensitivity · LOYO · spatial robustness · reliability ·
   │                                    failure modes · claims audit → data/validation/*.json
   ▼
pipeline export-frontend / validate     public/data/experiments/{summary,harmonization_factors}.json
   ▼
React fetch (observations.ts, experiments.ts)   →   Explorer calendar/detail · Methodology results
   ▼
User interpretation (with reliability badges, uncertainty and scope caveats)
```

No stage fabricates data; no stage merges sensors; missing observations stay missing through every
arrow.

---

# PART 5 — ACTUAL PROJECT RESULTS (verified against generated files)

**Coverage (acquired record: Jan–Jun 2012–2026 + Jul 2026, bbox 80,27,86,29.5)**

| Source | Chunks | Months with observations | Empty files | First–last actual obs |
|---|---|---|---|---|
| MODIS SP | 589 | 90 | 44 | 2012-01-20 → 2026-06-28 |
| VIIRS SNPP SP | 589 | 91 | 24 | 2012-01-20 → 2026-07-03 |
| VIIRS NOAA-20 SP | 339 | 52 | 14 | 2018-04-01 → 2026-07-27 |
| VIIRS NOAA-21 SP | 151 | 23 | 6 | 2023-03-01 → 2026-07-05 |

"Empty file" = zero detections inside the bbox for that window — a genuine observation of
nothing detected, never missing data.

**District-level observations (SP):** 1,019,718 raw → 1,019,121 valid → **124,506 in-district**
(Banke 40,587 / Bardiya 44,622 / Chitwan 39,297). NRT snapshot: 949,442 global rows → **17**
in-district (a 7-day November window — detections genuinely rare then).

**Comparable cell-days (0.1° grid, both families detected, same cell-day):** **3,777** bbox-wide
(Banke 1,069 / Bardiya 1,322 / Chitwan 1,386 — sums reconcile).

**Harmonization sample sizes:** 16,386 pairs = 13,854 training + 2,172 validation (2019 & 2022
held out) + 360 purge-gap (excluded from both).

**Raw scale differences (validation district-days):** VIIRS 8.27 vs Terra 0.49 / Aqua 0.58 mean
counts.

**Method Court (identical 2,172-pair validation sample):**

| Method | MAE | RMSE | log-RMSE | Bias | Pearson | CCC |
|---|---|---|---|---|---|---|
| 1. Monthly shrinkage | 8.259 | 29.780 | 1.029 | +0.601 | 0.656 | **0.625** |
| 2. Ratio-based | 8.342 | 30.145 | 1.027 | +0.705 | 0.653 | 0.620 |
| 3. Quantile mapping | 6.438 | 23.182 | 1.079 | **−5.245** | 0.617 | 0.516 |

Per-district CCC (shrinkage): Banke 0.619 / Bardiya 0.632 / **Chitwan 0.337**.
**Verdict: inconclusive** — overlapping bootstrap CIs and district instability; no winner declared.

**Seam Audit:** raw VIIRS/MODIS scale step 8.41×–49.86× → 0.807×–2.096× after shrinkage/ratio;
quantile 1.63×–14.85×. Diagnostic only; MODIS 6.03→61.03 version seam found (2022→2023).

**Lights-Out:** profile correlation 0.97–1.00 (all methods, both held-out years); variation ratio
shrinkage 1.28/0.77, ratio 1.31/0.77, quantile 0.43/0.26 (over-smoothing).

**Independent validation:** audit passed (0 metric discrepancies, separation/purge/identity ✓);
sensitivity: shrinkage top in 5/7 variants (ratio leads under holdout-2025 and raised floors —
hence "inconclusive" is the right verdict); LOYO CCC 0.369–0.710, no weak years; all 6 failure
modes fail-safe; claims audit: 8 claim classes marked must-never-be-made.

**Reliability strata:** 2 reliable / 4 use_with_caution / 15 insufficient_evidence / 15
unavailable (36 district × month strata).

**Overpass evidence (mean UTC hour, detections):** Terra day 4.73 / Aqua day 7.44 / SNPP 7.19 /
NOAA-20 7.19 / NOAA-21 7.14 — i.e. Terra ~10:30 local, Aqua ~13:10, VIIRS ~12:55; VIIRS records
more night detections (19.7–20.1 UTC passes) than MODIS.

---

# PART 6 — LIMITATIONS AND SCIENTIFIC HONESTY

- **VIIRS is not ground truth** — it has its own clouds, overpasses, saturation and sizing
  behaviour; "VIIRS-equivalent" is a scale, not a reality claim.
- **Detections ≠ fires** — one fire can produce many detections (multiple passes, pixels, days);
  counts are hotspot observations.
- **MODIS misses what VIIRS sees** — 1 km pixels vs 375 m; small/cooler fires vanish in MODIS.
- **Co-observation conditioning** — factors are learned where both sensors recorded; the calibration
  never observes the fires MODIS missed entirely, so harmonized series under-count exactly where
  the correction matters most. Zeros are preserved (never manufactured) at the cost of documented
  under-estimation.
- **Aug–Dec not requested** — the acquisition plan took Jan–Jun (+Jul 2026). FIRMS holds those
  months; the coverage matrix calls them `not_requested`, and the UI says "acquisition scope,
  never an absence of fire."
- **Residual scale differences remain** — post-harmonization steps of 0.81–2.10 are published, not
  hidden; harmonization reduces a known inconsistency, it does not remove sensor bias.
- **Why inconclusive** — the leading methods' bootstrap CIs overlap, per-district spread (0.295)
  exceeds the stability threshold, and sensitivity variants flip the ranking twice. Forcing a
  winner would be manufacturing certainty.
- **Why some districts lack evidence** — Chitwan's co-detection record is thinner/more scattered
  (CCC 0.19–0.34); its strata grade caution/insufficient.
- **Cannot currently claim:** ground truth; a validated winning method; complete bias removal;
  fire prediction; impact statistics; unique-fire counts; NASA endorsement; anything about
  Aug–Dec; anything before 2012-01-20.

**Implemented vs future:** implemented — everything above. Future possibilities (not built):
rendering full seam/lights-out tables in-app, acquiring Aug–Dec, cell-level harmonization,
NOAA-20/21 reference variants as more record accrues, formal anomaly detection.

---

# PART 7 — PRESENTATION AND JUDGING PREPARATION

## A. 30-second explanation

"Fire records that span decades usually switch satellites, and when they do, the numbers jump —
not because fires changed, but because the instrument did. Agnidrishti takes real NASA MODIS and
VIIRS hotspot data for three fire-prone districts in Nepal, measures that observation gap
(~14× on our data), tests three statistical ways to put MODIS on a VIIRS-equivalent scale, and —
this is the part we're most proud of — tells you honestly that the evidence cannot yet pick a
best method, while showing exactly which district-months you can trust."

## B. 3-minute presentation

1. **Problem (45s):** show the hero. "Did fires increase, or did satellites get better?" Explain
   the 1 km vs 375 m resolution gap and the measured 8.27 vs 0.49/0.58 counts on identical days.
2. **Data (30s):** 1,668 verified NASA archive chunks, 2012–2026, four satellites kept separate,
   exact polygon assignment, 124,506 district detections, SHA-256 provenance.
3. **Explorer demo (60s):** 2016 VIIRS raw — the fire season leaps out; click the peak week
   (1,297 detections, 7/7 days); switch to Harmonized — provisional estimate with the data-stratum
   badge; note empty cells = co-observation requirement and Aug–Dec = not requested.
4. **Science (45s):** Methodology — three methods, identical held-out years, bootstrap CIs, court
   verdict **inconclusive**, reliability strata 2/4/15/15, Chitwan honestly weaker.
5. **Close (20s):** "We would rather show you an honest 'inconclusive' than a confident guess.
   That discipline is the product."

## C. Technical explanation (for expert judges)

Lead with the comparison unit: district-day paired counts on co-observed days, recorded zeros
kept, missing files excluded. Describe the three estimators precisely (Part 2.2 formulas),
blocked temporal validation with purge, moving-block bootstrap over month blocks, CCC as primary
metric, the a-priori court rule and its inconclusive outcome, the independent audit's separate
metric implementation, LOYO 0.37–0.71, sensitivity 5/7, reliability thresholds. Expect probes on
zero-inflation, the conditional-on-detection selection bias, and bootstrap block choice — answers
below.

## D. Feature demonstration script

1. `/` — hero + problem (say the two-sentence problem).
2. Click **Explore Fire Activity**.
3. Explorer, SP, **year 2016, VIIRS raw** → point at April 2016. Click **week of 2016-04-11**:
   "Terra 83, Aqua 64, Suomi-NPP 1,297 — same fires, three instruments."
4. Switch **Harmonized** layer → read the provisional caption aloud; click a high week; note the
   `data stratum` badge and the "does not validate the method" sentence.
5. Switch **NRT** product → honest near-empty calendar: "this is a 7-day window, and emptiness
   here is truthful, not a bug."
6. Scroll: coverage footnote (Aug–Dec **not requested**), record-highlights panel (descriptive,
   not anomaly tests), readiness panel (verdict inconclusive, strata counts).
7. **Our Method** → Results section: court table, inconclusive banner, reliability grid; limitations.
8. Mobile (390px): calendar scrolls internally, nothing overflows.

## E. Likely judging questions (25)

1. **Why do MODIS and VIIRS need harmonization?** Different pixel size (1 km vs 375 m) and
   sensitivity create a ~14–17× count gap on identical days (8.27 vs 0.49/0.58 measured); raw
   series across the transition mix instrument change with fire change.
2. **Why is VIIRS the reference?** Finer resolution detects smaller/cooler fires; it is the
   present-and-future sensor; and it has the longest overlap starting 2012-01-20. It is the
   *reference scale*, not truth.
3. **How does the ratio method work?** Sum VIIRS / sum MODIS over comparable training days per
   district-platform-calendar-month (floor: 5 MODIS detections), falling back to district ratio,
   then global; multiply historical MODIS by the factor.
4. **How does quantile mapping work?** Empirical quantiles of nonzero MODIS counts mapped onto
   nonzero VIIRS quantiles via a 99-point grid; zeros preserved; unseen values capped at the
   training VIIRS max.
5. **How does monthly shrinkage work?** r*ₘ = λₘrₘ + (1−λₘ)r̄_d with λₘ = nₘ/(nₘ+20); sparse
   months lean on the district ratio.
6. **Why will you not pick a winner?** Bootstrap CIs of the top two overlap, per-district CCC
   spread (0.295) exceeds the 0.25 stability rule, and 2 of 7 sensitivity variants flip the
   ranking. Declaring a winner would overstate the evidence.
7. **How is data leakage prevented?** Whole years 2019/2022 held out; 30-day purge on each side
   (the 360 excluded pairs); fitting functions never see validation dates; an independent audit
   re-checks separation and recomputes metrics with separate code.
8. **How is reliability calculated?** Stratum = district × month; reliable needs n ≥ 30, CCC ≥
   0.50 and bias CI containing 0; caution needs n ≥ 10, CCC ≥ 0.30; below that, insufficient;
   months without coverage are unavailable.
9. **Why does Chitwan perform differently?** Its co-detection record is thinner and more scattered
   (CCC 0.19–0.34 vs ~0.62); fewer comparable pairs and more variable fire/observation conditions.
10. **Does this predict wildfires?** No. It harmonizes historical observations; no forecasting
    component exists.
11. **Are these actual fire counts?** They are satellite hotspot detections — not unique fires,
    not burned area; the UI states this wherever numbers appear.
12. **What makes it scientifically useful?** A reproducible pipeline, provenance-complete outputs,
    honest coverage/uncertainty/reliability machinery, and a reusable framework for judging any
    MODIS↔VIIRS correction.
13. **Why keep Terra and Aqua separate?** Different overpass times (10:30 vs 13:10 local) see
    different fires; merging would create a hybrid instrument that never existed.
14. **Why not merge VIIRS platforms?** Same principle; SNPP is the only one with a full 2012+
    record, and NOAA-20/21 have different histories.
15. **What is a "comparable cell-day"?** Same 0.1° cell, same day, detections from both sensor
    families — 3,777 exist; a necessary but not sufficient condition for fair comparison.
16. **Why is CCC primary over Pearson?** CCC penalizes scale/offset bias; a perfectly correlated
    but 2× scaled series scores Pearson 1.0 but CCC < 0.9 — correlation alone hides the exact
    problem we study.
17. **Why moving-block bootstrap?** Fire counts autocorrelate within seasons; resampling whole
    calendar-month blocks preserves that dependence instead of assuming independent days.
18. **Why is the harmonized layer 'provisional'?** The court could not distinguish methods; the UI
    uses the top-ranked method (monthly shrinkage) with the verdict shown beside every estimate.
19. **What is the Seam Audit's evidence?** At the record start the raw step is 8.4–49.9×; after
    harmonization 0.81–2.10. Diagnostic only — weather, real fire change, overpasses and product
    versions (we found MODIS 6.03→61.03) are listed as alternative contributors.
20. **What did Lights-Out show?** Held-out-year seasonal profiles reconstructed at r 0.97–1.00;
    quantile mapping over-smooths (variation 0.26–0.43), which is why low MAE alone doesn't win.
21. **How do you handle duplicates?** Exact-key dedupe within sensor+platform only (597 removed);
    cross-sensor "duplicates" are physically meaningful (same fire, two satellites) and kept.
22. **Why are there empty months in 2016 if the year selector offers it?** Acquisition covered
    Jan–Jun (+Jul 2026). The matrix marks them `not_requested`; the UI calls it acquisition scope,
    never absence of fire.
23. **What about the 16,386 vs 16,026 discrepancy?** Reconciled: 360 purge-gap pairs (Jan 1–30 of
    2020 and 2023) are excluded from both training and validation by design; every report now
    shows the three-way split.
24. **Could you have used a different spatial grid?** Yes — 0.1° is documented and the pipeline
    reads it from config; grid sensitivity belongs in future work; the audit did test ratio-floor
    and reference variants.
25. **What would you do with more time?** Acquire Aug–Dec, render full seam/lights-out tables
    in-app, extend to all 773 Nepal districts, and revisit the court as record length grows.

---

# PART 8 — WHERE EVERYTHING LIVES (quick reference)

| You want to see… | Open… |
|---|---|
| The contract the UI fetches | `public/data/sp/NP-BANKE/2016.json`, `src/lib/observations.ts` |
| Court/reliability the UI renders | `public/data/experiments/summary.json`, `src/lib/experiments.ts`, `src/components/methodology/ResultsSection.tsx` |
| Harmonization factors behind the Harmonized layer | `public/data/experiments/harmonization_factors.json`, `getFactor()` |
| The three methods | `pipeline/experiments.py` (`fit_ratio`, `fit_quantile`, `fit_shrinkage`, `apply_*`) |
| The court rules | `run_method_court()` in `pipeline/experiments.py` |
| Seam / Lights-Out | `run_seam_audit()`, `run_lights_out()` → `data/experiments/{seam_audit,lights_out}/` |
| Independent audit | `pipeline/validation.py` → `data/validation/*.json` |
| Coverage matrices | `data/processed/historical/coverage_matrices.json` |
| Calibration readiness | `data/processed/historical/calibration_readiness.json` |
| Tests | `pipeline/tests/` (76 tests), plus typecheck/lint/build gates |
| Prior audits | `FINAL_REPORT.md`, `FINAL_FEATURE_AUDIT.md`, `TASK_STATUS.md` |

---

*End of guide. All figures traced to generated output files; no code or data was modified while
writing this document.*
