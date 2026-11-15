import { describe, expect, it } from 'vitest'

import type {
  CurrentObservations,
  HistoricalPatterns,
  MonthlyClimatologyRow,
  WeatherRow,
} from './community'
import {
  activityBand,
  compareRecentActivity,
  monthCoverage,
  summarizeObservedWeather,
  summarizeSeason,
} from './communitySummary'

function month(
  overrides: Partial<MonthlyClimatologyRow> & Pick<MonthlyClimatologyRow, 'month'>,
): MonthlyClimatologyRow {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    label: labels[overrides.month - 1],
    status: 'observed',
    snpp_detections_per_observed_day: 1,
    years_supporting: 15,
    observed_days: 400,
    detection_days: 100,
    ...overrides,
  }
}

function historical(rows: MonthlyClimatologyRow[]): HistoricalPatterns {
  return {
    monthly_climatology: rows,
    peak_month: null,
    low_month: null,
    overall_rate_per_observed_day: 4,
    year_totals: [
      { year: '2012', snpp_detections: 10, observed_days: 100, note: '' },
      { year: '2026', snpp_detections: 20, observed_days: 100, note: '' },
    ],
    basis: { platform: 'Suomi-NPP', reason: '', record_note: '' },
  }
}

function observations(activeDays: number, detections = activeDays * 2): CurrentObservations {
  return {
    nrt_records: [],
    recent_week_records: [],
    recent_week_detections: detections,
    recent_week_active_days: activeDays,
    observation_freshness: '2026-04-14T00:00:00Z',
    note: '',
  }
}

describe('month coverage', () => {
  it('treats unobserved months as not observed, not zero', () => {
    const row = month({
      month: 8,
      status: 'not_observed',
      snpp_detections_per_observed_day: null,
      years_supporting: 0,
      observed_days: 0,
      detection_days: 0,
    })
    expect(monthCoverage(row)).toBe('not_observed')
  })

  it('excludes months with too little support from the ranking', () => {
    const row = month({ month: 7, years_supporting: 1, observed_days: 31, detection_days: 0 })
    expect(monthCoverage(row)).toBe('limited')
  })
})

describe('seasonal summary', () => {
  it('ranks only adequately covered months and relabels relative activity', () => {
    const summary = summarizeSeason(
      historical([
        month({ month: 1, snpp_detections_per_observed_day: 0.2 }),
        month({ month: 3, snpp_detections_per_observed_day: 10 }),
        month({ month: 4, snpp_detections_per_observed_day: 40 }),
        month({ month: 5, snpp_detections_per_observed_day: 12 }),
        month({
          month: 8,
          status: 'not_observed',
          snpp_detections_per_observed_day: null,
          years_supporting: 0,
          observed_days: 0,
          detection_days: 0,
        }),
      ]),
    )

    expect(summary.ranked.map((row) => row.month)).toEqual([4, 5, 3, 1])
    expect(summary.peak?.month).toBe(4)
    expect(summary.months.find((row) => row.month === 8)?.coverage).toBe('not_observed')
    expect(summary.seasonSentence).toBe(
      'Historically, most observed fire activity happens in April and May.',
    )
    expect(summary.coverageNote).toContain('August')
    expect(summary.coverageNote).toContain('not acquired')
    expect(summary.coverageNote).toContain('never treated as zero')
  })

  it('reports honestly when no month has enough support', () => {
    const summary = summarizeSeason(
      historical([
        month({ month: 7, years_supporting: 1, observed_days: 31, detection_days: 0 }),
      ]),
    )
    expect(summary.peak).toBeNull()
    expect(summary.seasonSentence).toBe(
      'No single month stands out in the available historical record.',
    )
  })
})

describe('recent activity comparison', () => {
  const april = summarizeSeason(
    historical([
      month({ month: 4, snpp_detections_per_observed_day: 40, detection_days: 200, observed_days: 400 }),
    ]),
  ).ranked[0]

  it('returns insufficient when the month lacks adequate coverage', () => {
    const july = summarizeSeason(
      historical([
        month({ month: 7, years_supporting: 1, observed_days: 31, detection_days: 0 }),
      ]),
    ).months[6]
    expect(compareRecentActivity(observations(5), july).comparison).toBe('insufficient')
  })

  it('labels a high active-day share as more active than usual', () => {
    expect(compareRecentActivity(observations(6), april).comparison).toBe('higher')
  })

  it('labels a low active-day share as less active than usual', () => {
    expect(compareRecentActivity(observations(0), april).comparison).toBe('lower')
  })

  it('treats a share close to the usual level as around usual', () => {
    // Historical share = 300/400 = 0.75; recent 5/7 = 0.714 → ratio 0.95.
    expect(compareRecentActivity(observations(5), april).comparison).toBe('around')
  })
})

describe('activity bands', () => {
  it('uses peak-relative bands', () => {
    expect(activityBand(40, 40)).toBe('very_high')
    expect(activityBand(14, 40)).toBe('high')
    expect(activityBand(6, 40)).toBe('moderate')
    expect(activityBand(1, 40)).toBe('lower')
    expect(activityBand(0, 40)).toBe('none')
  })
})

describe('observed weather summary', () => {
  const row = (date: string, rain: number): WeatherRow => ({
    date,
    temperature_2m_max: 30,
    temperature_2m_min: 15,
    relative_humidity_2m_mean: 50,
    precipitation_sum: rain,
    wind_speed_10m_max: 8,
  })

  it('excludes forecast days and duplicate dates', () => {
    const summary = summarizeObservedWeather(
      [
        row('2026-04-13', 1),
        row('2026-04-14', 2),
        row('2026-04-14', 99),
        row('2026-04-15', 50),
      ],
      '2026-04-14T07:00:00Z',
    )
    expect(summary?.days).toBe(2)
    expect(summary?.rainTotal).toBe(3)
    expect(summary?.end).toBe('2026-04-14')
  })

  it('returns null when no observed day is available', () => {
    expect(summarizeObservedWeather([row('2026-04-20', 0)], '2026-04-14T07:00:00Z')).toBeNull()
  })
})
