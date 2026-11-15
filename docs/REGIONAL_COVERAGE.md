# Regional coverage

Agnidrishti reports satellite hotspot detections for six study areas. The
canonical list is `src/data/regions.json`, read by both the Python pipeline
(`pipeline/config.py`) and the React application (`src/lib/regions.ts`). Do not
hard-code a region, its parent or its area in a component.

| Region id | Name | Admin level | Country | Boundary source |
| --- | --- | --- | --- | --- |
| `NP-BANKE` | Banke | District (ADM2) | Nepal | OCHA COD-AB, CC BY-IGO |
| `NP-BARDIYA` | Bardiya | District (ADM2) | Nepal | OCHA COD-AB, CC BY-IGO |
| `NP-CHITWAN` | Chitwan | District (ADM2) | Nepal | OCHA COD-AB, CC BY-IGO |
| `TH-CHIANG-MAI` | Chiang Mai | Province (ADM1) | Thailand | geoBoundaries, CC BY 3.0 IGO |
| `ID-RIAU` | Riau | Province (ADM1) | Indonesia | geoBoundaries, CC BY 3.0 IGO |
| `MM-SHAN` | Shan | State (ADM1) | Myanmar | geoBoundaries, CC BY 4.0 |

Areas differ in size from roughly 2,000 km² (Nepal districts) to 156,000 km²
(Shan State). Raw detection totals are not comparable across them without
area and observation-day normalisation; the Explorer states this next to the
comparison charts. The manifest and processed outputs carry
`raw_totals_not_comparable_across_regions: true` for the same reason.

## What is acquired

Standard-processing (SP) files are requested per region, so every region owns
its own acquisition window and its own file set.

| Sensor / platform | Archive starts | Source |
| --- | --- | --- |
| MODIS Terra | 2000-11-01 | FIRMS SP, `MODIS_SP` |
| MODIS Aqua | 2002-05-04 | FIRMS SP, `MODIS_SP` |
| VIIRS Suomi-NPP | 2012-01-20 | FIRMS SP, `VIIRS_SNPP_SP` |
| VIIRS NOAA-20 | 2018-04-01 | FIRMS SP, `VIIRS_NOAA20_SP` |
| VIIRS NOAA-21 | 2023-03-01 | FIRMS SP, `VIIRS_NOAA21_SP` |
| Any sensor | rolling 7 days | FIRMS NRT snapshot (separate provider) |

`pipeline/config.py::PLATFORM_FIRST_DATE` holds these dates. A day before a
platform's first date is **unavailable**, which is a different status from
**observed, zero detections**. The two are never collapsed.

Two acquisition batches exist:

- **2012 → present.** The original region-scoped batch (fire-season months,
  Jan–Jun plus July 2026 in the current record). Stored under
  `data/raw/regions/<REGION_ID>/<sensor>/<product>/` for Thailand, Indonesia
  and Myanmar; the three Nepal districts use the shared-Nepal bounding box and
  are stored under `data/raw/<sensor>/<product>/` with `region_id: null`
  (`LEGACY_NPL_SCOPE` in `pipeline/process.py`).
- **2000-11-01 → 2011-12-31.** `pipeline/pre2012.py`, resumed with
  `python -m pipeline download-pre2012 --workers 2`. Five-day FIRMS Area API
  chunks, sensor and platform preserved, keyed per region so one region's
  request is never counted as another's. Stored under the same per-region
  tree. Resumable: completed chunks are recorded in
  `data/manifests/download_manifest.json` with
  `acquisition_batch: "pre2012"` and are not requested again.

The 2000–2001 record is **Terra only**. No Aqua calibration is applied to a
day where Aqua did not exist, and the UI says so.

## Coverage status

The observation indexes carry a per-region `status`:

- `available` — at least one file was acquired and processed. Years are listed
  per region; a year absent from that list was not acquired, not a year of
  zero detections.
- `not_acquired` — no standard-processing file was acquired. The boundary is
  drawn, the calendar and fill stay empty, and the reason is shown in the UI.
  This is missing coverage, never zero activity.

The available years are always derived from verified metadata
(`public/data/sp/index.json` and the per-region daily files), never
from a hard-coded start year. A gap inside an acquired window is marked
missing; it is not filled with zeros.

## Pre-2012 estimates

MODIS is a different instrument from VIIRS, so a raw MODIS count is not a
VIIRS count. Before 2012 there is no contemporaneous VIIRS to validate a
correction against, so the correction's transferability is tested inside the
2012+ overlap instead:

- calibration and every validation fold use **post-2012 overlap only**
  (`min_date=2012-01-20`); pre-2012 records are never training data;
- each region and each MODIS platform is fitted and tested independently;
- tests are blocked by year with a 30-day purge gap: early→late,
  late→early, and leave-one-year-out. Random record-level splitting is never
  the only evidence;
- all three methods (ratio, quantile mapping, monthly shrinkage) are scored on
  the identical held-out sample with MAE, RMSE, log-RMSE, bias, Pearson, CCC
  and moving-block bootstrap intervals;
- the result is a decision per region, platform and calendar month:
  `SUPPORTED`, `LIMITED` or `UNSUPPORTED`.

`python -m pipeline backcast` writes
`data/processed/historical/backcast_decisions.json` and the compact public
artifact `public/data/experiments/backcast.json`. Where evidence is
inconclusive the artifact states, in words, that
"No single harmonization method can be confidently identified as the most
reliable for this region." No winner is invented.

Estimates are only produced where the decision allows them. They are written
to `public/data/historical/<REGION>/<YEAR>.json` by
`python -m pipeline export-historical-estimates`, which copies the raw MODIS
counts alongside every estimate and labels the output
"MODIS-derived VIIRS-equivalent estimate". A month with no overlap evidence
(e.g. July–December, absent from the post-2012 SP record) stays raw MODIS and
is marked unsupported. Raw observations are never overwritten.

## Regenerating

```bash
python -m pipeline boundaries                 # requires the source files below
python -m pipeline download-historical --regions TH-CHIANG-MAI ID-RIAU MM-SHAN
python -m pipeline download-pre2012 --workers 2
python -m pipeline process --provider area-api
python -m pipeline historical-analysis
python -m pipeline backcast
python -m pipeline export-historical-estimates
python -m pipeline export-data-manifest
python -m pipeline export-points
python -m pipeline export-frontend
python -m pipeline community-update
```

Boundary source files live in `data/boundaries/source/` and are not committed
(Nepal: OCHA COD-AB zip; Thailand/Indonesia/Myanmar: geoBoundaries ADM1
GeoJSON exports). Keep their provenance in `regions.json` when replacing them.

Map point exports are capped per region-year (`MAX_DISPLAY_POINTS` in
`pipeline/points.py`) so the geographic map stays loadable. The exported
`record_count` is always the full total; `displayed_count` says how many
markers the file contains, and the UI states the difference.
