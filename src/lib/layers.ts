/**
 * Shared layer-metric computation for the calendar heatmap and the map
 * choropleth. Both surfaces must derive their numbers from this one module
 * so a week in the calendar and the same period on the map can never
 * disagree.
 *
 * The harmonized layer is a PROVISIONAL VIIRS-equivalent estimate of MODIS
 * detections using the monthly-shrinkage factors (Method Court verdict
 * inconclusive). Recorded zeros are real observations; missing files are
 * missing — never zero-filled.
 */

import type { LayerId } from './explorer'
import { getFactor, type HarmonizationFactors } from './experiments'
import type { ObservationDataset, ObservationWeek } from './observations'

export type WeekCellKind = 'estimate' | 'raw' | 'no_co_observation' | 'not_observed'

export type PlatformEstimate = {
  platform: string
  detections: number
  factor: number
  factorSource: 'fitted' | 'district_ratio_fallback'
  estimate: number
}

export type WeekCell = {
  week: ObservationWeek
  value: number | null
  kind: WeekCellKind
  /** Harmonized layer only: the arithmetic behind the estimate. */
  platformEstimates?: PlatformEstimate[]
  /** How many MODIS platforms contributed to the averaged estimate. */
  estimateBasis?: number
}

export function computeWeekCell(
  week: ObservationWeek,
  layer: LayerId,
  districtId: string,
  factors: HarmonizationFactors | null,
): WeekCell {
  const modis = week.by_sensor.modis?.platforms ?? {}
  const snpp = week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']
  const modisDetections = (modis['Terra']?.detections ?? 0) + (modis['Aqua']?.detections ?? 0)
  const modisObserved =
    (modis['Terra']?.days_observed ?? 0) + (modis['Aqua']?.days_observed ?? 0) > 0

  if (layer === 'modis') {
    return {
      week,
      value: modisObserved ? modisDetections : null,
      kind: modisObserved ? 'raw' : 'not_observed',
    }
  }
  if (layer === 'viirs') {
    const observed = (snpp?.days_observed ?? 0) > 0
    return {
      week,
      value: observed ? (snpp?.detections ?? 0) : null,
      kind: observed ? 'raw' : 'not_observed',
    }
  }

  // Harmonized: requires co-observation (both a MODIS platform and the VIIRS
  // reference recorded observations this week). Each platform's factor was
  // fitted to predict the FULL Suomi-NPP count by itself, so per-platform
  // estimates are AVERAGED over the platforms that observed — summing them
  // double-counts (historically 1.99x the reference).
  const viirsObserved = (snpp?.days_observed ?? 0) > 0
  if (!modisObserved || !viirsObserved || !factors) {
    return { week, value: null, kind: 'no_co_observation' }
  }
  const monthOfYear = week.week_start.slice(5, 7)
  const platformEstimates: PlatformEstimate[] = []
  for (const platform of ['Terra', 'Aqua'] as const) {
    const block = modis[platform]
    const days = block?.days_observed ?? 0
    const detections = block?.detections
    if (!block || days === 0 || detections === undefined || detections === null) continue
    const { ratio, status } = getFactor(factors, districtId, platform, monthOfYear)
    if (ratio === null) continue
    platformEstimates.push({
      platform,
      detections,
      factor: ratio,
      factorSource: status === 'fitted' ? 'fitted' : 'district_ratio_fallback',
      estimate: detections * ratio,
    })
  }
  if (platformEstimates.length === 0) {
    return { week, value: null, kind: 'no_co_observation' }
  }
  const total =
    platformEstimates.reduce((sum, e) => sum + e.estimate, 0) / platformEstimates.length
  return {
    week,
    value: total,
    kind: 'estimate',
    platformEstimates,
    estimateBasis: platformEstimates.length,
  }
}

/**
 * Reliability stratum for a week, looked up by the ISO week's MIDPOINT month.
 * Using week_start alone mapped weeks starting 29-31 December onto the
 * 'unavailable' August-December strata (36 co-observed weeks affected).
 */
export function weekStratum(
  grid: {
    [district: string]: {
      [month: string]: {
        category: string
        validation_pairs?: number
        interval?: { mae: number | null; p90_abs_error: number | null; note?: string } | null
      }
    }
  } | null,
  districtId: string,
  week: ObservationWeek,
): {
  category: string
  validationPairs?: number
  interval?: { mae: number | null; p90_abs_error: number | null; note?: string } | null
} | null {
  if (!grid) return null
  const start = new Date(week.week_start)
  const mid = new Date(start.getTime() + 3.5 * 24 * 3600 * 1000)
  const month = `${String(mid.getUTCMonth() + 1).padStart(2, '0')}`
  const stratum = grid[districtId]?.[month]
  if (!stratum) return null
  return {
    category: stratum.category,
    validationPairs: stratum.validation_pairs,
    interval: stratum.interval ?? null,
  }
}

export type DistrictYearSummary = {
  districtId: string
  /** Weeks the layer actually covers, with their aggregate value. */
  weekCells: WeekCell[]
  /** Sum over weeks with a real value (raw counts or estimates). */
  total: number
  /** Weeks whose value is > 0. */
  weeksWithDetections: number
  /** Sum of reference-platform days actually observed across weeks. */
  observedWeeks: number
}

export function aggregateDistrictYear(
  dataset: ObservationDataset,
  layer: LayerId,
  factors: HarmonizationFactors | null,
): DistrictYearSummary {
  const weekCells = dataset.weeks.map((week) =>
    computeWeekCell(week, layer, dataset.district_id, factors),
  )
  let total = 0
  let weeksWithDetections = 0
  let observedWeeks = 0
  for (const cell of weekCells) {
    if (cell.value !== null) {
      total += cell.value
      if (cell.value > 0) weeksWithDetections += 1
    }
    const snppDays =
      cell.week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']?.days_observed ?? 0
    const modisDays =
      (cell.week.by_sensor.modis?.platforms['Terra']?.days_observed ?? 0) +
      (cell.week.by_sensor.modis?.platforms['Aqua']?.days_observed ?? 0)
    if (snppDays > 0 || modisDays > 0) observedWeeks += 1
  }
  return {
    districtId: dataset.district_id,
    weekCells,
    total: Math.round(total * 10) / 10,
    weeksWithDetections,
    observedWeeks,
  }
}
