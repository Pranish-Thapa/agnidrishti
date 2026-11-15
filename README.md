# Agnidrishti

**See the fire. Verify the signal.**

**Live demo: <https://pranish-thapa.github.io/agnidrishti/>**

A satellite-aware fire activity calendar for the NASA Space Apps Challenge 2026 challenge,
**“Harmonization of MODIS and VIIRS Hot Spots.”**

Agnidrishti integrates real processed NASA FIRMS observations for six high-fire study areas in
Nepal (Banke, Bardiya, Chitwan), Thailand (Chiang Mai), Indonesia (Riau) and Myanmar (Shan) with a
scientifically tested harmonization framework: three correction methods fitted on historical
Standard Processing data, validated on held-out years, and independently audited. Pre-2012 MODIS
Terra and Aqua data (2000–2011) are processed through the same pipeline. The core question —
whether a change in recorded fire activity is a real landscape trend or an artefact of changing
satellite observation — is answered with explicit evidence, uncertainty and honest limitations.

> **Scientific status:** the Method Court verdict is **inconclusive** — the evidence does not
> distinguish the three correction methods, so no winner is declared and the harmonized layer is
> labelled provisional everywhere it appears. Whether the correction transfers to pre-2012 years
> is tested separately with blocked year splits; each region, platform and calendar month is
> decided SUPPORTED / LIMITED / UNSUPPORTED, and only supported or limited months produce
> MODIS-derived VIIRS-equivalent estimates. VIIRS is the reference observation scale, **not
> ground truth**. Detections are hotspot observations, never unique fires. Missing observations
> are never treated as zero.

---

## Tooling disclosure

Built for the NASA Space Apps Challenge 2026 by Pranish Raj Thapa with AI coding agents
(ZCode/Claude) used for implementation, testing and documentation under human direction; all
scientific decisions, parameters and claims were reviewed and verified against the generated
outputs. Data sources are listed in the Methodology page and every output carries provenance.

---

## Stack

**Frontend:** React 18 + TypeScript, Vite 5, Tailwind CSS 3, React Router 6, Framer Motion 11,
Lucide React. Typography: Instrument Serif (display), IBM Plex Sans (body), IBM Plex Mono
(metadata).

**Pipeline:** Python 3.11, shapely, numpy. No heavy science stack required.

---

## Routes

| Route          | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `/`            | Landing page: the MODIS–VIIRS problem, workflow, capabilities, reliability  |
| `/explorer`    | Historical fire-activity explorer: district, year, product, weekly calendar |
| `/methodology` | Methods, validation design, live Method Court results, reliability strata   |
| `/about`       | Project intent, principles and roadmap                                      |
| `*`            | 404 page with working routes back into the site                             |

---

## Getting started

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Production checks:

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, zero warnings allowed
npm run build      # typecheck + vite production build
npm run preview    # serve dist at http://127.0.0.1:4173
```

Pipeline tests:

```bash
.venv/Scripts/python.exe -m pytest pipeline/tests -q   # 99 passing
```

---

## Data pipeline

Python pipeline under `pipeline/` acquires and processes NASA FIRMS data for the six study
areas. It keeps MODIS Terra, MODIS Aqua, VIIRS SNPP, NOAA-20 and NOAA-21 separate end-to-end
and never fills missing observations with zero.

```bash
.venv/Scripts/python.exe -m pipeline availability      # FIRMS coverage query (needs MAP_KEY)
.venv/Scripts/python.exe -m pipeline download-nrt      # public 7-day snapshots (no key)
.venv/Scripts/python.exe -m pipeline download-historical --sensors modis viirs_snpp viirs_noaa20 viirs_noaa21
.venv/Scripts/python.exe -m pipeline download-pre2012   # resumable MODIS 2000-2011 (needs MAP_KEY)
.venv/Scripts/python.exe -m pipeline process --provider area-api   # SP -> JSON contract
.venv/Scripts/python.exe -m pipeline historical-analysis           # Task 04B analysis suite
.venv/Scripts/python.exe -m pipeline experiments                   # Task 05 harmonization
.venv/Scripts/python.exe -m pipeline validate                      # Task 06 independent audit
.venv/Scripts/python.exe -m pipeline backcast                       # pre-2012 transferability decisions
.venv/Scripts/python.exe -m pipeline export-historical-estimates    # pre-2012 MODIS-derived estimates
.venv/Scripts/python.exe -m pipeline export-data-manifest           # provenance/coverage manifest
.venv/Scripts/python.exe -m pipeline export-frontend               # publish UI artifacts
.venv/Scripts/python.exe -m pytest pipeline/tests
```

Standard Processing (SP) acquisition requires a free FIRMS MAP_KEY in `.env`
(`FIRMS_MAP_KEY`, see `.env.example`); the availability report and NRT snapshots work without it.

### Acquired record

- **SP historical (2012 → present):** region-scoped Area API chunks of ≤5 days for each of the six
  study areas; the current record covers Jan–Jun 2012–2026 plus July 2026. Files, sizes and
  SHA-256 values are checked against `data/manifests/download_manifest.json`.
- **SP pre-2012:** MODIS Terra from 2000-11-01 and Aqua from 2002-05-04 through 2011-12-31,
  acquired per region in resumable 5-day chunks (`python -m pipeline download-pre2012`), sensor
  and platform preserved. 2000–2001 is Terra-only.
- **NRT:** public 7-day global snapshots, kept strictly separate from SP.
- **Boundaries:** OCHA COD-AB Nepal admin 2 (HDX, CC BY-IGO, 2024) and geoBoundaries ADM1 for
  Thailand, Indonesia and Myanmar; exact point-in-polygon assignment, no bounding-box shortcut.
- Aggregation: 0.1° grid cell-days, daily and ISO-week products, JSON contract v1.0.0 in
  `public/data/{nrt,sp}/`.

Exact per-region year lists are derived from `public/data/sp/index.json`, never from a
hard-coded start year. Raw files stay in `data/raw/` (never shipped to the frontend). The frontend
only reads `public/data/`.

---

## Scientific workflow (reproducible)

1. **Calibration readiness** (`historical-analysis`) — inventory, per-sensor coverage matrices
   with a six-state vocabulary (observed / insufficient / incomplete / missing / not_requested /
   unavailable), sensor-overlap analysis with overpass-time evidence, 0.1°-grid spatial
   comparability, calibration-readiness report. Outputs: `data/processed/historical/`.
2. **Harmonization experiments** (`experiments`) — ratio-based correction (district-month ratios
   with documented fallbacks), quantile mapping (zeros preserved, capped at training support),
   monthly shrinkage (`r*_m = λ_m·r_m + (1−λ_m)·r_d`, λ_m = n_m/(n_m+20)). Blocked temporal
   validation: whole years 2019 & 2022 held out, 30-day purge, identical sample for all methods.
   Metrics: MAE, RMSE, log-RMSE, bias, Pearson, Lin's CCC, moving-block bootstrap CIs.
   Outputs: `data/experiments/` with full provenance.
3. **Independent audit** (`validate`) — metrics recomputed with a deliberately separate
   implementation, leakage/separation/identity checks, seven sensitivity variants, leave-one-
   year-out temporal robustness, district and grid-cell spatial robustness, reliability strata
   (documented thresholds), failure-mode harness, scientific claims audit.
   Outputs: `data/validation/` and the frontend contract `public/data/experiments/summary.json`.
4. **Pre-2012 transferability** (`backcast`) — calibration uses post-2012 overlap only
   (`min_date=2012-01-20`), independently per region and MODIS platform. Blocked early→late and
   late→early year splits with a 30-day purge gap, plus leave-one-year-out folds; all three
   methods scored on identical held-out samples with bootstrap CIs; paired bootstrap comparison
   for method separation. Produces SUPPORTED / LIMITED / UNSUPPORTED per region × platform ×
   month. Outputs: `data/processed/historical/backcast_decisions.json` and
   `public/data/experiments/backcast.json`.
5. **Historical estimate export** (`export-historical-estimates`) — writes
   `public/data/historical/<REGION>/<YEAR>.json` containing raw MODIS counts beside
   "MODIS-derived VIIRS-equivalent estimates", only for supported/limited months, with method,
   calibration version, decision and uncertainty attached. Raw observations are never modified.

### Headline results (honest)

| Finding | Value |
| --- | --- |
| Raw scale gap (validation district-days) | VIIRS 8.27 vs Terra 0.49 / Aqua 0.58 per day |
| Method Court ranking | shrinkage 0.625 > ratio 0.620 > quantile 0.516 CCC — **inconclusive** |
| Seam audit | raw step 8–50× → 0.8–2.2 out-of-sample (81–97% closed on the log scale; diagnostic, not causal) |
| Lights-out backtest | monthly profile r ≈ 0.97–1.00; quantile over-smooths (variation 0.26–0.43) |
| Reliability strata | 2 reliable / 4 caution / 15 insufficient / 15 unavailable |
| Temporal robustness | leave-one-year-out CCC 0.37–0.71, no year below the caution floor |
| Known weak spot | Chitwan (CCC 0.19–0.34 across methods) — carried into every result view |

---

## Project structure

```text
src/
  App.tsx                     routing, scroll management, route metadata
  index.css                   design tokens, grain, grid, shared utilities
  components/
    hero/                     cinematic hero and video handling
    landing/                  problem, resolution diagram, workflow, capabilities
    explorer/                 controls, calendar heatmap, weekly detail, map, readiness
    methodology/              results section fed by public/data/experiments
    layout/                   navbar and footer
    ui/                       buttons, labels, badges, reveal, logo, page header
  data/regions.json           canonical six-study-area configuration (read by Python + TS)
  data/study-areas.json       generated study-area frontend payload
  lib/
    observations.ts           typed FIRMS JSON contract loader (NRT/SP)
    experiments.ts            typed court/reliability/factors loader
    backcast.ts               typed pre-2012 transferability decisions + gating
    content.ts                capabilities, methods, validation, limitations copy
    geo.ts / regions.ts / site.ts / palette.ts
  pages/                      Home, Explorer, Methodology, Community, About, NotFound
public/
  data/nrt/                   NRT slices (index, district-year, metadata)
  data/sp/                    SP slices 2000–2026 (index, district-year, metadata)
  data/historical/            pre-2012 MODIS-derived estimates, per region-year
  data/experiments/           court summary, reliability grid, harmonization factors, backcast
  videos/                     optimized hero media (mp4/webm/poster)
pipeline/                     acquisition, normalization, QC, spatial, temporal, export
  historical.py               historical analysis suite
  experiments.py              methods, Method Court, Seam Audit, Lights-Out
  backcast.py                 pre-2012 transferability tests and estimate export
  pre2012.py                  resumable pre-2012 MODIS acquisition
  metrics.py                  metrics + moving-block bootstrap
  validation.py               independent audit and reliability framework
  tests/                      pytest suite
scripts/prepare-boundaries.cjs  reproducible boundary extraction
data/
  raw/                        downloaded NASA files (never modified, never shipped)
  manifests/                  download/processing manifests (sha256 provenance)
  processed/                  analysis outputs (historical/, sp/, nrt/)
  experiments/                fitted models, validation, court, seam, lights-out
  validation/                 independent audit, sensitivity, robustness, reliability
```

---

## Study areas

| ID             | Name        | Country   | Admin level | Area (km²) |
| -------------- | ----------- | --------- | ----------- | ---------- |
| NP-BANKE       | Banke       | Nepal     | ADM2        | ~1,883     |
| NP-BARDIYA     | Bardiya     | Nepal     | ADM2        | ~2,004     |
| NP-CHITWAN     | Chitwan     | Nepal     | ADM2        | ~2,244     |
| TH-CHIANG-MAI  | Chiang Mai  | Thailand  | ADM1        | ~22,246    |
| ID-RIAU        | Riau        | Indonesia | ADM1        | ~90,204    |
| MM-SHAN        | Shan        | Myanmar   | ADM1        | ~156,131   |

These are selected high-fire study areas, **not a definitive ranking** of any country's most
fire-affected regions. The interface states this explicitly. Because the areas differ by almost
two orders of magnitude, cross-region comparisons are normalised by area and by valid observation
days; raw detection totals are never ranked against each other.

Boundary data: OCHA COD-AB Nepal admin 2 (HDX, CC BY-IGO, boundary year 2024) and geoBoundaries
ADM1 for Thailand, Indonesia and Myanmar (CC BY 3.0/4.0 IGO), simplified at ~90 m for display.
Regenerate with `node scripts/prepare-boundaries.cjs` and re-check
`data/boundaries/boundary_validation.json`.

---

## Scientific scope and limitations

**Implemented & verified:** acquisition with provenance, normalization, QC with within-sensor
dedupe, exact boundary assignment, 0.1° grid, daily/weekly products, typed frontend contract,
harmonization experiments with blocked validation, Method Court, Seam Audit, Lights-Out
backtest, independent audit, reliability strata, pre-2012 MODIS acquisition, blocked
transferability tests with per-region/platform/month decisions and separate MODIS-derived
estimate export, live results on the Methodology page.

**Not claimed:** ground truth; a validated winning method (verdict inconclusive); removal of all
sensor bias (residual scale steps remain); fire prediction; NASA endorsement; VIIRS-equivalent
estimates for months without overlap evidence (they stay raw MODIS); coverage for August–December
2012+ (deliberately not acquired; FIRMS holds the data — it is out of scope, not missing).

Full limitations are documented on the Methodology page, in `data/validation/claims_audit.json`
and in `TASK_STATUS.md`.

---

## Hero media and deployment note

The hero background is real fire footage (`Fire-Hero-bg.mov`, archived outside the repo in
`media_archive/` because of its size).
`HeroMedia.tsx` serves WebM first, falls back to MP4, uses the poster for first paint, and
removes the video entirely under `prefers-reduced-motion`.

| File | Purpose |
| --- | --- |
| `media_archive/fire-hero-bg.mov` | Original source, preserved unchanged, **not deployed** |
| `public/videos/fire-hero-bg.mp4` | H.264 MP4, 1280×720, muted, no audio |
| `public/videos/fire-hero-bg.webm` | VP9 WebM, 1280×720, muted, no audio |
| `public/videos/fire-hero-poster.jpg` | Poster frame |

The 103 MB original lives in `media_archive/`, outside `public/`, so it is **not** copied into
`dist/`. Browsers only ever request the MP4, WebM and poster (~10 MB combined).

## Demo & docs

See `DEMO.md` for the guided demonstration script and screenshot checklist, `docs/` for the
complete feature guide and the independent Claude briefing, `FINAL_*.md` for audit reports, and
`TASK_STATUS.md` for the full development log.
