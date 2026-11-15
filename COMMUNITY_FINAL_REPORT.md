# COMMUNITY FIRE INTELLIGENCE — FINAL REPORT

Date: 2026-11-14 · Project: Agnidrishti · **No commits or pushes made** (all changes local only)

---

## 1. Summary

The Community Fire Intelligence feature transforms Agnidrishti into a community-facing platform.
Users select a district and see: historical fire patterns from real NASA FIRMS data, current
near-real-time hotspot detections, weather-based fire-danger assessment (Canadian FWI), a rule-
based explanation of what the data means, and verified links to official safety resources.

The feature is implemented at `/community` as a new major section, integrated into the existing
navbar and routing. It does not modify any existing scientific calculation, harmonization method,
or explorer functionality.

## 2. Work packages completed

| WP | Status | Deliverables |
|---|---|---|
| WP0 | ✅ | Baseline confirmed: 76 pytest + 7 vitest, clean tree at 51ed3a7 |
| WP1 | ✅ | Open-Meteo verified (archive + forecast); NASA POWER assessed (not needed for MVP); FIRMS existing |
| WP2 | ✅ | `build_historical_patterns()` — SNPP-only monthly climatology, peak/low months, year totals |
| WP3 | ✅ | NRT records loaded from existing points export; freshness + coverage in exports |
| WP4 | ✅ | `fetch_archive_weather()` + `fetch_forecast_weather()` per district centroid (Open-Meteo) |
| WP5 | ✅ | `compute_fwi_sequence()` — full Canadian FWI (FFMC/DMC/DC/ISI/BUI/FWI) from daily weather |
| WP6 | ✅ (honest) | `build_outlook()` — LOYO logistic regression, AUC 0.645 vs climatology 0.755 → not validated |
| WP7 | ✅ | `build_explanations()` — 5 rule-based explanation topics with evidence blocks |
| WP8 | ✅ | BIPAD, SERVIR-HKH, NASA FIRMS, emergency 112 — reachability checked |
| WP9 | ✅ | `/community` page: 9 sections, CommunityMap, location selector, responsive |
| WP10 | ✅ | 92 pytest (16 new) + 7 vitest + typecheck + lint + build; 3 doc files |

## 3. Work packages not completed / deferred

| WP | Reason |
|---|---|
| B6 2001–2011 extension | Requires ~430 new download chunks and MAP_KEY; documented as roadmap |
| C2 Seasonal percentile | Needs cross-year data loading in Explorer; documented as future work |
| C4 Chitwan diagnostic | Needs pair-level day/night + FRP-band extension; documented |
| C7 Scatter view | Data-ready (out-of-fold records exported) but not rendered; lower priority |
| Vegetation/dryness indices | NDVI/EVI requires NASA Earthdata credentials; not available in this session |
| Municipality-level selection | Requires municipality boundaries not present in current OCHA dataset |
| Automatic scheduled refresh | Would require external cron service; documented as manual command |

## 4. Data sources integrated

| Source | What was fetched | Status |
|---|---|---|
| NASA FIRMS SP/NRT | Already acquired (124,506 district records, 17 NRT) | ✅ Existing |
| Open-Meteo ERA5 archive | 2012–2026 daily weather per district centroid | ✅ Fetched and cached |
| Open-Meteo forecast | 7-day daily forecast per district centroid | ✅ Fetched and cached |
| NASA POWER | Assessed but not needed (Open-Meteo covers the same variables) | Not integrated |
| MODIS vegetation (NDVI) | Requires NASA Earthdata credentials | Not integrated (future work) |
| BIPAD / SERVIR-HKH | Links verified (BIPAD ✓, SERVIR ✗ unreachable) | Linked, not data-integrated |

## 5. Model performance and validation

| Metric | Value | Interpretation |
|---|---|---|
| Mean LOYO AUC | 0.645 | Moderate discrimination |
| Mean climatology AUC | 0.755 | Seasonal baseline is better |
| Skill over climatology | **−0.11** | Weather does NOT add information beyond season |
| Validated threshold | AUC ≥ 0.65 AND skill ≥ 0.05 | Pre-set before evaluation |
| Verdict | **not_validated** | No fire-activity prediction is shown |

The FWI assessment remains available as a weather-based danger indicator. The honest fallback is
the scientifically correct outcome: monthly climatology is the dominant predictor at district
resolution, and weather features do not add information beyond season.

## 6. Tests performed

| Test | Result |
|---|---|
| pytest pipeline/tests -q | **92 passed** (76 existing + 16 new) |
| npx vitest run | **7 passed** |
| npm run typecheck | ✓ (0 errors) |
| npm run lint | ✓ (0 warnings) |
| npm run build | ✓ (dist 41 MB incl. 18 MB point data) |
| Browser /community | ✓ (all 7 sections render, 3 data files loaded, 0 failed requests, no overflow) |
| Browser desktop 1440px | ✓ |
| Browser mobile 390px | ✓ (no overflow) |
| FWI hand-derived vector | ✓ (temp 20, rh 50, ws 10, rain 0, prev 80 → 85.51) |

## 7. Files created

| File | Purpose |
|---|---|
| `pipeline/community.py` | Weather fetch, FWI computation, historical analysis, outlook model, explanation engine |
| `pipeline/tests/test_community.py` | 16 tests |
| `src/lib/community.ts` | Typed loaders + types for community JSON |
| `src/components/community/CommunityMap.tsx` | Leaflet map: FWI choropleth + NRT markers |
| `src/pages/CommunityPage.tsx` | Full /community page with 9 sections |
| `COMMUNITY_INTELLIGENCE_DOCUMENTATION.md` | Scientific + technical documentation |
| `COMMUNITY_PROGRESS.md` | Work-package progress tracker |
| `COMMUNITY_FINAL_REPORT.md` | This file |

## 8. Files modified

| File | Change |
|---|---|
| `pipeline/__main__.py` | Added `community-update` CLI |
| `src/App.tsx` | Added /community route + metadata |
| `src/lib/site.ts` | Added "Community" nav link |

## 9. Git status

```
Modified: pipeline/__main__.py, src/App.tsx, src/lib/site.ts
New: pipeline/community.py, pipeline/tests/test_community.py,
     src/lib/community.ts, src/components/community/CommunityMap.tsx,
     src/pages/CommunityPage.tsx, public/data/community/ (5 files),
     COMMUNITY_INTELLIGENCE_DOCUMENTATION.md, COMMUNITY_PROGRESS.md,
     COMMUNITY_FINAL_REPORT.md
No commits made. No pushes made. Working tree contains all changes for user review.
```

## 10. Remaining limitations

1. **No validated fire-activity prediction** — the weather model did not demonstrate skill beyond climatology at district resolution. This is the scientifically correct result.
2. **FWI is uncalibrated for Nepal** — the Canadian FWI system uses daily-value approximations and has not been validated against Nepali fire regime data.
3. **No vegetation/dryness satellite data** — NDVI/EVI would require NASA Earthdata credentials not available in this session.
4. **District-centroid weather** — weather is from a single point per district, not spatially resolved.
5. **Only Jan–Jul acquired** — August–December not in the record.
6. **No official evacuation or facility data** — only links to official portals are provided.
7. **No automatic refresh** — the community data must be manually refreshed via `community-update`.
