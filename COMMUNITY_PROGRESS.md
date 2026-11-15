# COMMUNITY FIRE INTELLIGENCE — PROGRESS

## Work Package Checklist

| WP | Description | Status | Notes |
|---|---|---|---|
| WP0 | Project inspection and baseline | ✅ DONE | Clean tree at 51ed3a7; 76 pytest + 7 vitest passing; architecture confirmed |
| WP1 | Data-source research and architecture | ✅ DONE | Open-Meteo verified (archive + forecast, CC-BY 4.0); NASA POWER assessed (not needed for MVP); FIRMS already integrated |
| WP2 | Historical fire pattern analysis | ✅ DONE | `build_historical_patterns` — SNPP-only monthly climatology, normalized by observed days, peak/low months, year totals |
| WP3 | Current observation intelligence | ✅ DONE | NRT records loaded from existing points export; freshness + coverage reported |
| WP4 | Environmental conditions | ✅ DONE | Open-Meteo ERA5 archive (30 days) + 7-day forecast per district centroid; temp/RH/wind/rain |
| WP5 | Fire-danger assessment | ✅ DONE | Canadian FWI formulas (Van Wagner 1987, ported from cffdrs_py); running codes with state; Nepal caveats documented |
| WP6 | Future forecasting | ✅ DONE (honest) | L2 logistic regression, LOYO over 14 years; AUC 0.645 vs climatology 0.755 → skill −0.11 → **not_validated**; FWI-only outlook shown |
| WP7 | Explanation engine | ✅ DONE | 5 rule-based explanations with evidence blocks; no LLM used |
| WP8 | Safety information | ✅ DONE | BIPAD, SERVIR-HKH, NASA FIRMS, emergency 112 — reachability verified; no invented facilities |
| WP9 | Frontend + map | ✅ DONE | `/community` page with 9 sections, CommunityMap (Leaflet, FWI choropleth, NRT markers), responsive |
| WP10 | Testing + docs | ✅ DONE | 92 pytest (76 existing + 16 new) + 7 vitest; typecheck/lint/build pass; 3 doc files created |

## Blockers

- SERVIR-HKH fire-detection URL (rds.icimod.org) unreachable from this session; link included but marked "not reachable at last check"
- Weather model did not demonstrate skill beyond climatology — honestly reported as `not_validated`

## Key Decisions

1. **Open-Meteo over NASA POWER**: Open-Meteo provides archive + forecast in one API with daily RH/precip/wind; NASA POWER lacks RH in daily aggregations and requires different endpoints for forecast vs historical.
2. **FWI over ML**: The evaluation's directive "start with a scientifically interpretable baseline" led to implementing the Canadian FWI as the fire-danger assessment; ML was tested but honestly reported as not validated.
3. **Suomi-NPP-only climatology**: Pooling VIIRS platforms would bias months (NOAA-20 starts 2018, NOAA-21 starts 2023); SNPP is the only consistent 2012–2026 record.
4. **No LLM for explanations**: All explanations are rule-based from validated analytical outputs, as required.
5. **November outlook withheld**: The model was validated only inside Jan–Jul; a November prediction would be extrapolation and is not shown.
