# Agnidrishti — Demo Script & Judging Notes

## The one-line story

> Satellites changed, so the fire record changed. Agnidrishti measures that observation gap on
> real NASA data, tests three ways to correct it, and tells you — honestly — when the evidence
> is not good enough to trust the correction.

## Demonstration narrative (5–7 minutes)

### 1. The problem (landing page — `/`)
- Hero: *"Did the fires increase, or did the satellites get better?"*
- MODIS (1 km, morning + early-afternoon overpasses) and VIIRS (375 m, afternoon) do not detect
  fires the same way. A naive combined record mixes landscape change with instrument change.
- On our real data: on identical district-days, VIIRS recorded a mean of **8.3 detections** while
  MODIS Terra recorded **0.49** and Aqua **0.58** — a ~14–17× scale gap that has nothing to do
  with actual fire behaviour.

### 2. The data (`/explorer`)
- Product selector: **Standard Processing (2012–2026)** vs Near real-time.
- District buttons: Banke / Bardiya / Chitwan (real OCHA boundaries, P-codes shown).
- Year selector: 2012–2026 from the observation index.
- **Weekly calendar heatmap** (Year × Week): each cell is an ISO week of real FIRMS detections.
  Try 2016 + VIIRS raw — the April 2016 fire season is unmistakable (peak week 1,297 detections).
- Click any week: weekly detail with per-platform counts (Terra / Aqua / Suomi-NPP separately),
  observation coverage (e.g. `7/7 days obs`), and — on the harmonized layer — a VIIRS-equivalent
  estimate with the reliability stratum shown as a badge.
- Switch to the **Harmonized layer**: weeks without MODIS–VIIRS co-observation are left empty.
  The caption states that estimates are provisional (court verdict inconclusive).

### 3. The solution (`/methodology`)
- The observation problem, the reference-scale approach, the three correction methods with their
  formulas and documented assumptions/risks.
- **Results section (live data, not hand-entered):** the Method Court table —
  monthly shrinkage CCC 0.625, ratio 0.620, quantile mapping 0.516 — and the verdict banner:
  **inconclusive**. Confidence intervals overlap and performance is unstable across districts
  (Chitwan CCC 0.19–0.34). No winner is forced.
- Reliability strata: 2 reliable / 4 use-with-caution / 15 insufficient / 15 unavailable —
  thresholds are documented criteria (n ≥ 30, CCC ≥ 0.50, bias CI contains 0), not vibes.

### 4. The proof (talk track)
- Blocked temporal validation: entire years (2019, 2022) held out with a 30-day purge; identical
  evaluation samples for all methods; moving-block bootstrap (calendar-month blocks) CIs.
- **Independent audit:** metrics re-derived with a separate implementation — zero discrepancies;
  training/validation separation, leakage and sensor-identity checks all pass; tamper detection
  is itself tested.
- **Seam audit:** raw VIIRS/MODIS scale step at the record start is 8–50×; after harmonization
  (refitted *without* the audit window — out-of-sample) 0.8–2.2, which is 81–97% closed on the log
  scale. Reduced, never eliminated, and explicitly *diagnostic* — the page lists the confounds
  (real fire change, weather, overpasses, clouds, product versions — including the MODIS
  6.03→61.03 version seam we found inside the record).
- **Lights-out backtest:** withheld years are reconstructed from MODIS alone; monthly fire-season
  profiles survive (r ≈ 0.97–1.00); quantile mapping over-smooths (variation ratio 0.26–0.43) —
  reported, not hidden.

### 5. The limitation (close with it)
- August–December was not acquired (out of acquisition plan, not FIRMS-unavailable) — the
  coverage matrix calls those months `not_requested`, never zero.
- 15 of 36 reliability strata are `insufficient_evidence`; the UI never displays a value for
  them.
- No fire prediction. No impact statistics. No NASA endorsement. Detections ≠ unique fires.

## Screenshot checklist

| # | Shot | Route / state | Shows |
| --- | --- | --- | --- |
| 1 | Hero | `/` desktop 1440px | Problem framing |
| 2 | Explorer + calendar | `/explorer`, year 2016, VIIRS raw | Real weekly fire season |
| 3 | Weekly detail | Same, click week of 2016-04-11 | Per-platform counts, coverage |
| 4 | Harmonized layer | Year 2026, harmonized, click a high week | Estimate + reliability badge + caveat |
| 5 | Empty/edge state | Harmonized, NRT product | Honest unavailability |
| 6 | Method Court table | `/methodology#results` | Live metrics + inconclusive banner |
| 7 | Reliability strata | `/methodology#results` | Documented criteria categories |
| 8 | Mobile explorer | 390px, calendar visible | Responsive, no page overflow |
| 9 | Readiness panel | `/explorer`, right column | Pipeline + reliability counts |

## Reproducibility (one-liner per stage)

```bash
.venv/Scripts/python.exe -m pipeline historical-analysis   # coverage + readiness
.venv/Scripts/python.exe -m pipeline experiments           # methods + court + seam + lights-out
.venv/Scripts/python.exe -m pipeline validate              # independent audit + reliability
.venv/Scripts/python.exe -m pipeline export-frontend       # publish UI artifacts
npm run build && npm run preview                           # serve the app
```

Every JSON output carries `contract_version`, `generated_at` and provenance (source datasets,
sensor ids, grid definition, configuration, sample sizes).

## Judging Q&A

- **Why is the harmonized number sometimes higher than the VIIRS count for the same week?**
  It is a scale conversion, not a prediction: the fitted factor converts MODIS detections to the
  VIIRS-equivalent scale using the whole overlap record, so an individual week can sit above the
  observed VIIRS value. The uncertainty and the inconclusive verdict are shown next to it.
- **Which method won?** None — the court could not distinguish them (overlapping CIs, district
  instability). The calendar's harmonized layer uses the top-ranked method and is labelled
  provisional.
- **Is VIIRS truth?** No. It is the finer-scale reference observation; it has its own detection
  limits (clouds, overpasses, sizing).
- **Why no August–December?** Out of the acquisition plan for this build; the coverage matrix
  keeps those months explicitly `not_requested` and no claim extends to them.
