# AGNIDRISHTI — FINAL FEATURE IMPROVEMENT REPORT

Date: 2026-11-14 · Scope: feature-quality improvement pass per the task directive
Baseline inputs: AGNIDRISHTI_COMPLETE_FEATURE_GUIDE.md, FINAL_FEATURE_AUDIT.md, TASK_STATUS.md,
FINAL_REPORT.md, README.md, DEMO.md + live inspection of the running application.
Verification: **76/76 pytest · typecheck ✓ · lint 0 warnings ✓ · production build ✓
(dist 23 MB, JS 585 KB / 181 KB gzip) · real-browser verification on desktop 1440px and mobile 390px.**

---

## A. Feature-by-feature results

| Feature | Classification | What changed |
| --- | --- | --- |
| **Geographic Fire Map** | **IMPROVED** (was PARTIAL) | Replaced the inline boundary-only SVG with a real **Leaflet + OpenStreetMap** map: dark-styled tiles, actual OCHA COD-AB district polygons as interactive GeoJSON layers, district choropleth from real aggregated yearly data, click-to-select on the map, quick-select buttons, zoom in/out/fit-to-district, legend, on-map attribution, coverage sentence. Fully synchronized with provider/year/layer selection. Verified live at desktop + mobile. |
| **Critical Period Identification** | **IMPROVED** | Beyond the peak week: rank among observed weeks, median observed week, weeks with any detections (%), weeks below a quarter of the peak, observation coverage, and an explicit "why this week is highlighted" explanation. Label preserved: **"Descriptive — not a statistical anomaly test"**. |
| **Seam Audit visualization** | **IMPROVED** (was summary-cards only) | New Methodology section: per-district/per-platform before-and-after bar pairs (raw scale step vs post-correction step) with real values ("raw 23.2× → 1.12× after ratio · 99.5% of the gap closed"), residual-mismatch explanation, MODIS 6.03→61.03 version seam, "DIAGNOSTIC · NOT PROOF OF CAUSATION" badge. Rendered verbatim from `data/experiments/seam_audit/seam_audit.json` — no frontend recalculation. |
| **Lights-Out Backtest visualization** | **IMPROVED** (was summary-cards only) | New Methodology section: reference-vs-reconstructed monthly profile bars for each held-out year (2019, 2022), profile correlation, variation ratio with over-smoothing explanation, per-method comparison note, "HELD-OUT VALIDATION" badge. Rendered verbatim from `lights_out.json`. |
| **Reliability & uncertainty experience** | **IMPROVED** | Category definitions (reliable / caution / insufficient / unavailable) added to both the ReadinessPanel and the Methodology reliability block; explicit Chitwan-weaker note (CCC 0.19–0.34 vs ~0.5–0.63); "reliable stratum ≠ validated method; court remains inconclusive" stated in both places. Thresholds unchanged. |
| **Explorer & coverage UX** | **IMPROVED** | NRT footnote explaining the 7-day snapshot window; map-calendar-detail synchronization verified through actual interaction; single shared metric module (`src/lib/layers.ts`) guarantees calendar and map can never disagree for the same week. |
| **Harmonization methods** | PASS (unchanged) | Verified implementations intact; formulas in AGNIDRISHTI_COMPLETE_FEATURE_GUIDE.md match code. |
| **Method Court** | PASS (unchanged) | Court table + inconclusive verdict verified live; verdict untouched. |
| **Fire Activity Calendar** | PASS (verified after refactor) | Metric computation refactored into the shared `src/lib/layers.ts` — behaviour identical (regression-checked in browser: same weekly values, layers, hatch/zero distinction). |
| **Landing page** | PASS (unchanged) | Hero video, nav, CTAs verified again in this pass. |
| **Methodology core explanations** | PASS (enhanced) | Existing sections kept; new seam/lights sections slot into the Results & reliability area. |
| **Data pipeline & integrity** | PASS (unchanged) | Only `validation.py` extended to *publish* existing experiment outputs to the frontend contract; no scientific computation changed; 76/76 tests pass. |
| **Production build** | PASS | dist 23 MB; JS 585 KB / 181 KB gzip (Leaflet adds ~160 KB raw — documented). |
| **Responsive design** | PASS | 390px: map renders with tiles, quick-select buttons reachable, zero page-level overflow. |

No feature regressed to FAIL or NOT IMPLEMENTED. Nothing was classified NOT TESTED — every
modified surface was verified in the browser.

## B. Problems discovered & how they were solved

1. **Map was boundary-only SVG** (the directive's top priority). *Fix:* Leaflet 1.9.4 + OSM tiles
   (free, no API key), OCHA GeoJSON rendered via `L.geoJSON` with interactive selection, choropleth
   from real aggregated data.
2. **Only point-level data is aggregated** — no verified per-fire coordinates are exposed to the
   frontend, and fabricating them is forbidden. *Fix:* honest **district-level choropleth** with
   "District totals — not fire locations" on the legend and in the caption. Hotspot markers are
   explicitly not shown.
3. **Frontend had no access to seam/lights-out outputs.** *Fix:* `pipeline/validation.py` now
   publishes verbatim summaries of those experiment outputs inside
   `public/data/experiments/summary.json` (`seam_audit`, `lights_out`, court `by_district`);
   regenerated via `python -m pipeline validate`. No recalculation anywhere.
4. **Duplicated week-metric logic** between calendar and (new) map could drift. *Fix:* extracted
   `src/lib/layers.ts` (`computeWeekCell`, `aggregateDistrictYear`) as the single source of truth;
   CalendarPanel refactored onto it with identical behaviour.
5. **Leaflet type quirks:** default import made `L.control` non-callable and the generic control
   API didn't fit → namespace import (`import * as L`) and a JSX attribution overlay (also better
   for OSM policy visibility). Dark-tile CSS filter + custom tooltip styling added to `index.css`.
6. **Stale-callback risk in map handlers** → props kept in refs (`selectRef`/`areaRef`/
   `summariesRef`) so Leaflet handlers always act on current state.

## C. Files modified / created

| File | Change |
| --- | --- |
| `src/components/explorer/MapPanel.tsx` | **Rewritten** — Leaflet map (tiles, OCHA GeoJSON, choropleth, selection, zoom/fit, legend, attribution, coverage info) |
| `src/lib/layers.ts` | **Created** — shared week/year metric computation |
| `src/pages/ExplorerPage.tsx` | Loads all three district-year datasets for the choropleth; passes summaries + `onSelectDistrict` |
| `src/lib/experiments.ts` | New types: `SeamAuditSummary`, `LightsOutSummary`, `by_district` on court |
| `src/components/methodology/ResultsSection.tsx` | Seam Audit + Lights-Out visual sections; reliability definitions; Chitwan note |
| `src/components/explorer/CriticalPeriodsPanel.tsx` | Distribution comparison + why-highlighted explanation |
| `src/components/explorer/CalendarPanel.tsx` | Refactored onto shared helper; NRT window footnote |
| `src/components/explorer/ReadinessPanel.tsx` | Reliability category definitions |
| `src/index.css` | Dark Leaflet styling, tooltip class |
| `pipeline/validation.py` | Frontend summary now publishes verbatim seam + lights-out summaries |
| `package.json` | `leaflet` + `@types/leaflet` added |
| `public/data/experiments/summary.json` | Regenerated (now carries seam_audit / lights_out / court by_district) |

## D. Data sources used (all existing, nothing re-downloaded)

`public/data/sp/{district}/{year}.json` (choropleth aggregates + calendar),
`public/data/experiments/{summary,harmonization_factors}.json`,
`data/experiments/{seam_audit,lights_out,method_comparison}/` (published verbatim),
`src/data/nepal-study-areas.json` (real OCHA boundaries), OpenStreetMap raster tiles (© OSM
contributors, free, no key).

## E. Scientific integrity audit of the new work

- Choropleth shows **aggregated district totals**; legend and caption state "not fire locations";
  no coordinates invented; harmonized totals labelled provisional wherever selectable.
- No platform merged without a label (MODIS raw = "Terra + Aqua · sensor-native"; VIIRS raw =
  "Suomi-NPP"); harmonized = "VIIRS-equivalent · provisional".
- Missing ≠ zero preserved in map aggregation (weeks without observations contribute no value).
- No threshold, parameter or scientific result was altered; the pipeline change is publication-only.
- Seam/lights sections carry the diagnostic/held-out badges and residual/over-smoothing caveats.

## F. Tests performed

`pytest pipeline/tests -q` → **76 passed** · `npm run typecheck` ✓ · `npm run lint` (0 warnings) ✓ ·
`npm run build` ✓. Browser (desktop 1440 + mobile 390): map tiles load (0 failed requests),
3 district polygons render, quick-select + map-click selection updates calendar/map/caption in
sync, zoom in/out and fit verified via tile reload, legend/attribution visible, methodology seam
bars + lights-out profiles render real values, critical-periods new rows render, reduced-motion
propagates to map fit animation (code-verified), no console/network errors observed.

## G. Remaining limitations (documented, honest)

1. Map choropleth is district-level by design — per-hotspot markers would require exposing point
   records to the frontend, deliberately not done (fabrication risk + honesty).
2. Seam/lights tables are rendered for the baseline method ranking (shrinkage) as the headline
   comparison; full per-method detail stays in the JSON outputs.
3. Leaflet adds ~160 KB raw (~49 KB gzip) to the bundle.
4. Reduced-motion map behaviour is code-verified (fitBounds `animate: false`); the harness cannot
   emulate the OS media query.

## H. Launch commands & recommended demo sequence

```bash
cd C:\Users\acer\agnidrishti
npm run dev        # http://127.0.0.1:5173
# or: npm run build && npm run preview   # http://127.0.0.1:4173
```

Demo: Landing → Explorer (map: point out OCHA boundaries + choropleth legend "district totals,
not fire locations"; click Bardiya on the map) → 2016 VIIRS raw → peak week detail → Harmonized
layer (provisional caption + stratum badge) → Record highlights (descriptive, not anomaly tests)
→ Our Method → court table (inconclusive) → Seam Audit bars → Lights-Out profiles → reliability
grid → close on the limitations statement.

**Verdict: every directive phase implemented, verified in the browser, and reported. The
application remains a scientific record-integrity tool with a genuinely geographic map — not a
generic wildfire dashboard.**
