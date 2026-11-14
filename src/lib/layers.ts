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

export type WeekCell = {
  week: ObservationWeek
  value: number | null
  kind: WeekCellKind
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
  // reference recorded observations this week).
  const viirsObserved = (snpp?.days_observed ?? 0) > 0
  if (!modisObserved || !viirsObserved || !factors) {
    return { week, value: null, kind: 'no_co_observation' }
  }
  const monthOfYear = week.week_start.slice(5, 7)
  let total = 0
  let anyFactor = false
  for (const platform of ['Terra', 'Aqua'] as const) {
    const detections = modis[platform]?.detections
    if (detections === undefined || detections === null) continue
    const { ratio } = getFactor(factors, districtId, platform, monthOfYear)
    if (ratio === null) continue
    anyFactor = true
    total += detections * ratio
  }
  if (!anyFactor) {
    return { week, value: null, kind: 'no_co_observation' }
  }
  return { week, value: total, kind: 'estimate' }
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
