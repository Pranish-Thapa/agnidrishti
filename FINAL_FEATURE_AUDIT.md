# AGNIDRISHTI — COMPLETE END-TO-END FEATURE AUDIT

Date: 2026-11-14 · Build: production (`npm run build`, dist = **23 MB**) · Server: `npm run preview`
Method: real browser interaction (in-app Chromium) + programmatic data cross-checks + full test suite.
Every result below was actually executed; none is inferred from code alone unless explicitly marked
"code-verified".

## A. Executive summary

| Metric | Count |
| --- | --- |
| Feature areas tested | **26** |
| Passed | **25** |
| Failed | **0** |
| Partially working (documented, safe) | **1** |
| Not tested | **0** |
| Genuine defects found | **1** (fixed, regression-verified live) |
| Test suite | 76/76 pytest · typecheck ✓ · lint 0 warnings ✓ · build ✓ |

## B. Feature-by-feature results

| Feature | Status | Evidence | Issues |
| --- | --- | --- | --- |
| **Phase 1 — Data integrity** | PASS | All 7 published contracts v1.0.0 with timestamps; SP counts reconcile end-to-end (124,506 = 40,587+44,622+39,297, frontend metadata == quality report for all 3 districts); all index year files exist (2012–2026); credential scan of `dist/` + source: **0 leaks**; all manifest URLs redacted | — |
| **Sensor identity preservation** | PASS | Daily contract exposes `Terra`/`Aqua` separately; SNPP/NOAA-20/NOAA-21 separate in contract + index; weekly↔daily reconciliation 0/27 mismatches (2016 Banke SNPP) | — |
| **Landing page** | PASS | Title/tagline correct; hero `<video>` playing (readyState 4, webm served); nav links `/ /explorer /methodology /about`; CTA navigates to `/explorer`; **0 failed network requests** | — |
| **Landing capability claims vs data** | PASS | "8–50×" ↔ JSON 8.41–49.86; "0.8–2.1" ↔ 0.807–2.096; lights-out "r ≈ 0.97–1.00" ✓; quantile over-smoothing "0.26–0.43" ✓; all verdicts hedged (diagnostic, inconclusive) | — |
| **Explorer providers** | PASS | SP loads (Connected · 2012–2026); NRT loads (2 ISO-week cells for the 7-day window, honest empty harmonized); switching swaps datasets with no stale cells | — |
| **Explorer years** | PASS | 2012 renders 24 cells (partial year from Jan 20); 2019: 26 cells (ISO week starting 2018-12-31); 2022: 27 cells; no unsupported year shown as observed | — |
| **Explorer districts** | PASS | Banke/Bardiya/Chitwan each load distinct data (first-week estimates differ: 0/13.33/9.47); map heading follows selection; boundary SVG path changes per district | — |
| **Calendar heatmap** | PASS | ISO weeks render per year; colour intensity tracks values; unobserved weeks hatched; weekly totals reconcile with daily data exactly | — |
| **Layer switching** | PASS | Harmonized → estimates with "provisional" caption; MODIS raw 2022: 4 non-zero weeks; VIIRS raw: 9 (VIIRS detects more — scientifically consistent); layer switch updates cells + detail | — |
| **Weekly detail** | PASS | Week 2016-W15 (Banke): Terra 83 / Aqua 64 / SNPP 1,297 — **exactly matches JSON cross-check**; coverage "7/7 days"; `data stratum: reliable` badge; stratum-vs-method caveat present | — |
| **Missing ≠ zero** | PASS | Status vocabulary distinct in contract; calendar leaves no-observation weeks empty/hatched; copy states it in DataNotice, coverage footnote, weekly caveat | — |
| **Map** | PASS | Real OCHA SVG polygons (path length > 100 chars); aria-label "…No fire detections are shown."; boundary-context caption; OCHA/HDX/CC-BY attribution; zoom controls present | — |
| **Critical periods panel** | PASS | "Descriptive · not anomaly tests"; highest recorded week (301 Chitwan / 1,075 Banke) matches JSON; "Diagnostic only" seam row; "Inconclusive" method row; no causal/predictive claims | — |
| **Methodology page** | PASS | All 3 methods documented; court table renders live JSON metrics; "Verdict: inconclusive"; purge reconciliation sentence; reliability grid; scope reminder; "not ground truth"; "No winner is declared" | — |
| **Readiness panel** | PASS | Live rows: "SP historical observations CONNECTED · 2012–2026 · 124,506 RECORDS" (== quality report); "DONE · VERDICT INCONCLUSIVE"; "PASSED · RELIABILITY GRID PUBLISHED"; strata 2/4/15/15 == reliability.json | — |
| **Reliability labelling** | PASS | Badge reads `data stratum: <category>`; caveat: "does not validate the harmonization method, whose Method Court verdict remains inconclusive"; insufficient/unavailable never rendered as values | — |
| **Coverage messaging** | PASS | Calendar footnote + DataNotice: Aug–Dec "**not requested** … acquisition scope, never evidence that no fires occurred"; NRT limited to its 7-day window; six-state vocabulary in coverage_matrices.json | — |
| **About page** | PASS | Loads, non-blank; "not affiliated with or endorsed by NASA" | — |
| **404 route** | PASS | "404 / Route not found / This trail goes cold." with working links home/Explorer | — |
| **Navigation & history** | PASS | Direct navigation to all routes; internal nav; `history.back()` returns correctly; refresh works (SPA fallback verified earlier); no blank screens | — |
| **Responsive 1440×900** | PASS | No overflow on all 3 routes; 0 controls offscreen | — |
| **Responsive 1366×768** | PASS | No overflow on all 3 routes; 0 controls offscreen | — |
| **Responsive 390×844** | PASS | No page-level overflow on all routes; the only offscreen elements are 16 week-cells **inside** the calendar's internal scroll container (all reachable by scroll); year select + 3 district buttons usable | — |
| **Reduced motion** | PASS (code-verified) | `useReducedMotion` honoured in App, HeroMedia, MapPanel, ExplorerControls, Reveal; `prefers-reduced-motion` media query in index.css. Not browser-emulated in this audit — the emulation API is unavailable in the test harness | Honesty note |
| **Performance/build** | PASS | dist **23 MB** (was 127 MB); `.mov` archived outside `public/`; only MP4/WebM/poster deployed; 0 failed requests on landing | — |
| **Pair-count reconciliation** | PASS | 16,386 = 13,854 train + 2,172 validation + **360 purge-gap** (2020-01-01..30, 2023-01-01..30; leakage protection, excluded from both). Machine-readable in both summary JSONs; rendered on Methodology page | — |
| **Seam Audit / Lights-Out UI** | **PARTIAL** (documented, safe) | Analytical pipelines + JSON outputs complete and verified; findings are displayed as qualified capability cards on the landing page (numbers match JSON); the full per-district/per-period tables remain in `data/experiments/*.json` rather than rendered as page sections | Optional future enhancement; deliberately not added per "no new features" instruction |

## C. Bugs discovered and fixed

| Bug | Root cause | Fix |
| --- | --- | --- |
| On raw layers, the weekly-detail "Harmonized estimate" stat read "Not observed / no data", implying missing data | `mutedText` only distinguished the co-observation case; the raw-layer case fell through to the generic text | Pass layer-aware text: "Not computed — switch to the Harmonized layer" (`CalendarPanel.tsx`). Rebuilt, regression-verified live in the browser |

Note: three apparent test-check "failures" during the audit (readiness `spConnected`, critical-periods `seamDiagnostic`, week-detail platform labels) were **audit-script artifacts** — `innerText` returns CSS-uppercase-transformed text and my regexes were case-sensitive. The underlying UI was verified correct by reading the actual rendered text. No code change required.

## D. Remaining issues (none blocking)

1. Seam Audit / Lights-Out appear as verified summary cards, not full data tables in the UI (data is in JSON; adding tables would be a new feature — out of scope).
2. Reduced-motion verified at code level only (no emulation available in harness).
3. Standing scientific limitations (unchanged, documented in-app): inconclusive court verdict; Chitwan weaker strata; Aug–Dec not requested; NRT single window; co-observation-conditioned calibration; residual scale steps 0.8–2.1.

## E. Final verification

```
pytest pipeline/tests -q  → 76 passed
npm run typecheck         → pass
npm run lint              → 0 warnings
npm run build             → ✓ (index-DMByIrON.js, 424 KB / 131 KB gzip)
dist size                 → 23 MB (videos: mp4 5.7 MB + webm 4.1 MB + poster)
Browser                   → 0 failed network requests on landing; all routes render; all
                            interactions executed against the production build
```

## F. Submission verdict

**READY FOR SUBMISSION.**

Every major feature was tested against the real production build and real datasets; the single
defect found was fixed and regression-verified; all sample counts reconcile; all scientific
framing survives the integrity audit; the one partial item (Seam/Lights-Out data tables) is
documented and does not affect any claim the application makes.
