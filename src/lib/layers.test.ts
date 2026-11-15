import { describe, expect, it } from 'vitest'

import { aggregateDistrictYear, computeWeekCell, weekStratum } from './layers'
import type { HarmonizationFactors } from './experiments'
import type { BackcastArtifact } from './backcast'
import type { ObservationDataset, ObservationWeek } from './observations'

/**
 * Regression tests for the Harmonized layer.
 *
 * Historical defect (caught by an independent evaluation): the layer SUMMED
 * Terra's and Aqua's per-platform estimates, but each platform factor was
 * fitted to predict the full VIIRS reference count by itself — so the summed
 * display read ~1.99x the reference it claims to match. The layer must AVERAGE
 * the per-platform estimates over the platforms that actually observed.
 */

// A minimal factors artifact: each platform's factor predicts the full
// reference count (Terra x 2, Aqua x 2 — deliberately easy to check).
const factors: HarmonizationFactors = {
  contract_version: '1.0.0',
  generated_at: 'test',
  method: 'monthly_shrinkage',
  method_status: 'provisional',
  court_verdict: 'inconclusive',
  reference: 'test',
  meaning: 'test',
  districts: {
    'NP-BANKE': {
      Terra: {
        district_ratio: 2,
        months: { '04': { ratio: 2, status: 'fitted', lambda: 0.9, modis_detections: 100 } },
      },
      Aqua: {
        district_ratio: 2,
        months: { '04': { ratio: 2, status: 'fitted', lambda: 0.9, modis_detections: 100 } },
      },
    },
  },
}

function makeWeek(weekStart: string, terra: Partial<{ d: number; det: number }> | null, aqua: Partial<{ d: number; det: number }> | null, snppDays: number, snppDet: number): ObservationWeek {
  return {
    iso_year: Number(weekStart.slice(0, 4)),
    iso_week: 1,
    week_start: weekStart,
    week_end: weekStart,
    days_in_week: 7,
    status: 'observed',
    by_sensor: {
      modis: {
        platforms: {
          ...(terra
            ? { Terra: { status: 'observed', detections: terra.det ?? 0, cells: null, cell_days: 0, frp: null, days_observed: terra.d } }
            : {}),
          ...(aqua
            ? { Aqua: { status: 'observed', detections: aqua.det ?? 0, cells: null, cell_days: 0, frp: null, days_observed: aqua.d } }
            : {}),
        },
      },
      viirs_snpp: {
        platforms: {
          'Suomi-NPP': { status: 'observed', detections: snppDet, cells: null, cell_days: 0, frp: null, days_observed: snppDays },
        },
      },
      viirs_noaa20: {
        platforms: {
          'NOAA-20': { status: 'observed', detections: 0, cells: null, cell_days: 0, frp: null, days_observed: 0 },
        },
      },
      viirs_noaa21: {
        platforms: {
          'NOAA-21': { status: 'observed', detections: 0, cells: null, cell_days: 0, frp: null, days_observed: 0 },
        },
      },
    },
  } as ObservationWeek
}

describe('computeWeekCell — harmonized layer (A1 regression)', () => {
  it('AVERAGES per-platform estimates: (Terra + Aqua) / 2, never the sum', () => {
    // Both platforms observed: Terra 10 x 2 = 20, Aqua 10 x 2 = 20 -> mean 20,
    // which matches a reference count of 20 (each factor predicts it alone).
    const cell = computeWeekCell(makeWeek('2024-04-10', { d: 3, det: 10 }, { d: 4, det: 10 }, 7, 20), 'harmonized', 'NP-BANKE', factors)
    expect(cell.kind).toBe('estimate')
    expect(cell.value).toBe(20) // summed would be 40
    expect(cell.estimateBasis).toBe(2)
  })

  it('uses a single platform estimate when only one platform observed', () => {
    const cell = computeWeekCell(makeWeek('2024-04-10', { d: 3, det: 10 }, null, 7, 20), 'harmonized', 'NP-BANKE', factors)
    expect(cell.value).toBe(20)
    expect(cell.estimateBasis).toBe(1)
  })

  it('returns no_co_observation when the reference did not observe', () => {
    const week = makeWeek('2024-04-10', { d: 3, det: 10 }, { d: 3, det: 10 }, 0, 0)
    const cell = computeWeekCell(week, 'harmonized', 'NP-BANKE', factors)
    expect(cell.kind).toBe('no_co_observation')
    expect(cell.value).toBeNull()
  })

  it('keeps raw layers unscaled (MODIS raw = Terra + Aqua detections)', () => {
    const cell = computeWeekCell(makeWeek('2024-04-10', { d: 3, det: 10 }, { d: 4, det: 15 }, 7, 20), 'modis', 'NP-BANKE', factors)
    expect(cell.value).toBe(25)
    expect(cell.kind).toBe('raw')
  })
})

describe('weekStratum (A2: midpoint month lookup)', () => {
  const grid = {
    'NP-BANKE': {
      '01': { category: 'reliable', validation_pairs: 30 },
      '12': { category: 'unavailable' },
    },
  }

  it('maps a week starting 2018-12-31 to January (midpoint), not December', () => {
    const s = weekStratum(grid as never, 'NP-BANKE', makeWeek('2018-12-31', { d: 1, det: 0 }, { d: 1, det: 0 }, 1, 0))
    expect(s?.category).toBe('reliable')
  })

  it('maps a mid-December week to the December stratum', () => {
    const s = weekStratum(grid as never, 'NP-BANKE', makeWeek('2018-12-12', { d: 1, det: 0 }, { d: 1, det: 0 }, 1, 0))
    expect(s?.category).toBe('unavailable')
  })
})

describe('aggregateDistrictYear — harmonized totals inherit the averaging', () => {
  it('district total is ~1.0x the VIIRS reference on co-observed weeks (regression for the 1.99x defect)', () => {
    const weeks = [
      makeWeek('2024-04-10', { d: 3, det: 10 }, { d: 4, det: 10 }, 7, 20),
      makeWeek('2024-04-17', { d: 3, det: 5 }, { d: 4, det: 15 }, 7, 20),
    ]
    const dataset = {
      contract_version: '1.0.0',
      district_id: 'NP-BANKE',
      year: '2024',
      days: [],
      weeks,
    } as unknown as ObservationDataset
    const summary = aggregateDistrictYear(dataset, 'harmonized', factors)
    // Reference total across the two weeks = 40; averaged estimates = 20 + 20.
    expect(summary.total).toBe(40)
  })
})

/**
 * Pre-2012 gating. Before the VIIRS reference exists there is no
 * co-observation to require, so an estimate may only be produced where the
 * regional transferability decision supports that platform and calendar
 * month. Everything else stays raw MODIS — never zero, never estimated.
 */
const backcast: BackcastArtifact = {
  contract_version: '1.0.0',
  generated_at: 'test',
  calibration_version: '2012-overlap-v1',
  calibration_period: { start: '2012-01-20', end: '2026-07-31' },
  method: 'monthly_shrinkage',
  court_verdict: 'inconclusive',
  reference: 'test',
  terminology: 'test',
  regions: {
    'NP-BANKE': {
      Terra: {
        decision: 'LIMITED',
        reason: 'test',
        years: [2012, 2024],
        validation_pairs: 100,
        confident_winner: false,
        best_method: null,
        method_statement: 'test',
        supported_months: ['04'],
        limited_months: ['05'],
        months: {
          '04': {
            status: 'supported',
            factor: 2,
            validation_pairs: 100,
            reason: 'test',
            uncertainty: null,
          },
          '05': {
            status: 'limited',
            factor: 1.5,
            validation_pairs: 40,
            reason: 'test',
            uncertainty: null,
          },
          '07': {
            status: 'unsupported',
            factor: null,
            validation_pairs: 0,
            reason: 'test',
            uncertainty: null,
          },
        },
        transferability: { forward_ccc: 0.6, backward_ccc: 0.6 },
      },
      Aqua: {
        decision: 'LIMITED',
        reason: 'test',
        years: [2012, 2024],
        validation_pairs: 100,
        confident_winner: false,
        best_method: null,
        method_statement: 'test',
        supported_months: ['04'],
        limited_months: ['05'],
        months: {
          '04': {
            status: 'supported',
            factor: 2,
            validation_pairs: 100,
            reason: 'test',
            uncertainty: null,
          },
          '05': {
            status: 'limited',
            factor: 1.5,
            validation_pairs: 40,
            reason: 'test',
            uncertainty: null,
          },
          '07': {
            status: 'unsupported',
            factor: null,
            validation_pairs: 0,
            reason: 'test',
            uncertainty: null,
          },
        },
        transferability: { forward_ccc: 0.6, backward_ccc: 0.6 },
      },
    },
  },
  limitations: [],
}

describe('computeWeekCell — pre-2012 backcast gating', () => {
  it('produces an estimate in a supported month even though VIIRS never observed', () => {
    // Terra 10 x 2 = 20, Aqua 10 x 2 = 20 -> averaged 20. No co-observation
    // exists in 2005, so requiring one would make every historical week empty.
    const cell = computeWeekCell(
      makeWeek('2005-04-10', { d: 3, det: 10 }, { d: 4, det: 10 }, 0, 0),
      'harmonized',
      'NP-BANKE',
      factors,
      backcast,
    )
    expect(cell.kind).toBe('estimate')
    expect(cell.value).toBe(20)
    expect(cell.estimateBasis).toBe(2)
    expect(cell.platformEstimates?.every((e) => e.factorSource === 'backcast_supported')).toBe(true)
  })

  it('is raw-only (never zero) in an unsupported month', () => {
    const cell = computeWeekCell(
      makeWeek('2005-07-10', { d: 3, det: 10 }, { d: 4, det: 10 }, 0, 0),
      'harmonized',
      'NP-BANKE',
      factors,
      backcast,
    )
    expect(cell.kind).toBe('backcast_unsupported')
    expect(cell.value).toBeNull()
  })

  it('is raw-only when no backcast artifact is available', () => {
    const cell = computeWeekCell(
      makeWeek('2005-04-10', { d: 3, det: 10 }, { d: 4, det: 10 }, 0, 0),
      'harmonized',
      'NP-BANKE',
      factors,
      null,
    )
    expect(cell.kind).toBe('backcast_unsupported')
    expect(cell.value).toBeNull()
  })

  it('uses Terra alone in 2000-2001 where Aqua did not exist', () => {
    const cell = computeWeekCell(
      makeWeek('2001-04-10', { d: 3, det: 10 }, null, 0, 0),
      'harmonized',
      'NP-BANKE',
      factors,
      backcast,
    )
    expect(cell.kind).toBe('estimate')
    expect(cell.value).toBe(20)
    expect(cell.estimateBasis).toBe(1)
    expect(cell.platformEstimates?.map((e) => e.platform)).toEqual(['Terra'])
  })

  it('never applies a backcast factor at or after the cutoff', () => {
    // Supported month for the backcast, but the week is post-cutoff and the
    // reference did not observe -> no co-observation, not an estimate.
    const cell = computeWeekCell(
      makeWeek('2012-04-09', { d: 3, det: 10 }, { d: 4, det: 10 }, 0, 0),
      'harmonized',
      'NP-BANKE',
      factors,
      backcast,
    )
    expect(cell.kind).toBe('no_co_observation')
    expect(cell.value).toBeNull()
  })

  it('leaves the raw MODIS layer on its native scale before 2012', () => {
    const cell = computeWeekCell(
      makeWeek('2005-07-10', { d: 3, det: 10 }, { d: 4, det: 15 }, 0, 0),
      'modis',
      'NP-BANKE',
      factors,
      backcast,
    )
    expect(cell.kind).toBe('raw')
    expect(cell.value).toBe(25)
  })
})
