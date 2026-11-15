# COMMUNITY FIRE INTELLIGENCE — DOCUMENTATION

## Feature overview

Agnidrishti's Community Fire Intelligence feature lets a user select one of three Nepali study
districts (Banke, Bardiya, Chitwan) and see: historical fire patterns from real NASA FIRMS data,
current near-real-time hotspot detections, weather-based fire-danger assessment (Canadian FWI
system), a rule-based explanation of what the data means, and verified links to official
community-safety information.

The feature is an additional major section at `/community`. It does not replace or modify the
existing harmonization methodology, explorer, or methodology pages.

## Architecture

```
Open-Meteo ERA5 archive ──→ pipeline/community.py ──→ public/data/community/{district}.json
Open-Meteo forecast API ──→                        ──→ public/data/community/index.json
NASA FIRMS SP aggregates ──→                       ──→
NASA FIRMS NRT points ────→                        ──→
                                                        ↓
                                              React /community page
                                              (CommunityPage.tsx + CommunityMap.tsx)
```

No backend server. The pipeline fetches weather, computes fire-danger indices and validated
analyses, and exports a JSON contract that the React frontend loads.

## Data sources

| Source | What it provides | Resolution | Licensing | API key | Notes |
|---|---|---|---|---|---|
| NASA FIRMS (SP) | Historical hotspot detections | ~375 m (VIIRS) / ~1 km (MODIS) | Public (NASA LANCE/EOSDIS) | MAP_KEY for Area API | Already acquired; Jan–Jul 2012–2026 |
| NASA FIRMS (NRT) | Near-real-time detections | Same | Public | None for 7-day snapshots | 7-day global window; already acquired |
| Open-Meteo ERA5 archive | Daily max temp, mean RH, total precip, max wind | District centroid (~9 km grid) | CC-BY 4.0 | None | Historical 1940–present; one API call per district |
| Open-Meteo forecast API | 7-day daily forecast | Same | CC-BY 4.0 | None | Updated every 6 hours by Open-Meteo |
| OCHA COD-AB Nepal | Admin-2 district boundaries | Polygon | CC BY-IGO | None | Already integrated |

## Scientific methods

### Canadian Fire Weather Index (FWI) System

The FWI system (Van Wagner 1987) is computed from daily weather inputs using the exact formulas
from the canonical cffdrs implementation. Components: FFMC (fine fuel moisture), DMC (duff
moisture), DC (drought code), ISI (initial spread index), BUI (buildup index), FWI (fire weather
index). Starting values: FFMC 85, DMC 6, DC 15. The system runs sequentially, with each day's
codes depending on the previous day's codes.

**Approximations for this application** (documented in every export):
- Daily max temperature instead of the noon temperature
- Daily mean relative humidity instead of the afternoon value
- Daily max wind speed instead of the noon wind speed

**Limitations**: The FWI is NOT calibrated for Nepal's fuel types, monsoon climatology, or fire
regime. It describes how weather conditions would support fire spread if fuel were available —
it is not an ignition probability and not a fire prediction.

### Fire-activity outlook model

An L2-regularized logistic regression (numpy only, no black-box dependency) predicts the
probability of a district-day having ≥1 VIIRS-family hotspot detection, using daily weather
features (temperature, RH, wind, 24h/7d/30d rainfall antecedents, FWI codes, day-of-year encoding).

**Validation**: Leave-one-year-out over 2012–2025 (14 folds, 2,731 training days). Metrics: AUC,
Brier score, monthly climatology baseline comparison. Pre-set skill thresholds: AUC ≥ 0.65 AND
skill over climatology ≥ 0.05.

**Honest result**: The model achieved mean AUC 0.645 vs climatology 0.755 (skill −0.11). The
climatology baseline outperformed the weather model because monthly seasonality is the dominant
predictor at district resolution. The outlook is therefore reported as `not_validated` and no
fire-activity prediction is shown. The FWI assessment remains available as a weather-based danger
indicator.

### Historical patterns

Monthly climatology is computed from the Suomi-NPP record only (the only platform with a full
2012–2026 record). Detections are normalized by observed days to avoid coverage bias. The peak
and low months are identified and reported with years supporting.

## Map layers

| Layer | What it shows | Source |
|---|---|---|
| FWI choropleth | District fill colored by FWI category | Computed from Open-Meteo weather |
| NRT hotspot markers | Individual verified detections (colored by platform, sized by FRP) | NASA FIRMS NRT |

The map does NOT show: evacuation routes, emergency facilities, or officially declared danger
zones (no verified dataset was available for integration).

## Data refresh

```bash
.venv/Scripts/python.exe -m pipeline community-update
```

This command fetches the latest Open-Meteo forecast, recomputes FWI from the running weather
series, rebuilds the outlook validation, and exports to `public/data/community/`. The frontend
loads the updated JSON on the next page load.

## Safety limitations

- Agnidrishti is NOT an emergency service. Follow instructions from local authorities.
- No verified evacuation-centre or route dataset was available for integration.
- Official warnings must come from BIPAD, district authorities, or Nepal emergency services.
- The FWI is an uncalibrated index, not a fire-safety rating for Nepal.
- Satellite detections are thermal anomalies, not confirmed ground fires.

## Known issues

1. SERVIR-HKH URL (rds.icimod.org) was unreachable at last check; the link is included but marked.
2. The weather model did not demonstrate skill beyond climatology at district resolution —
   this is a scientific finding, not a bug.
3. Weather data is from district centroids, not point-specific measurements.
4. Only January–July is acquired; August–December fire activity is not captured.
5. The FWI uses daily weather approximations instead of the standard noon observations.
