/**
 * Plain-language summaries for Community Fire Intelligence.
 *
 * Everything here is derived from the exported community contract. No value is
 * invented: months without adequate observation coverage are excluded from the
 * ranking, missing observations are never treated as zero, and the recent
 * activity comparison reports "insufficient" when the matching historical month
 * is not covered well enough to compare.
 */

import type {
  CurrentObservations,
  FwiCategory,
  HistoricalPatterns,
  MonthlyClimatologyRow,
  WeatherRow,
} from './community'

/** A month enters the historical ranking only with this much support. */
export const MIN_SUPPORTING_YEARS = 5
export const MIN_OBSERVED_DAYS = 100

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export type MonthCoverage = 'adequate' | 'limited' | 'not_observed'
export type ActivityBand = 'very_high' | 'high' | 'moderate' | 'lower' | 'none'

export type SeasonalMonth = {
  month: number
  label: string
  fullLabel: string
  coverage: MonthCoverage
  rate: number | null
  yearsSupporting: number
  observedDays: number
  detectionDays: number
  band: ActivityBand | null
}

export type SeasonalSummary = {
  months: SeasonalMonth[]
  /** Adequately covered months, highest observed rate first. */
  ranked: SeasonalMonth[]
  peak: SeasonalMonth | null
  /** Months labelled Very high or High historical activity. */
  topMonths: SeasonalMonth[]
  firstYear: number | null
  lastYear: number | null
  seasonSentence: string
  peakSentence: string
  coverageNote: string
}

export const ACTIVITY_BAND_LABELS: Record<ActivityBand, string> = {
  very_high: 'Very high historical activity',
  high: 'High historical activity',
  moderate: 'Moderate historical activity',
  lower: 'Lower historical activity',
  none: 'No hotspots observed',
}

export function monthCoverage(row: MonthlyClimatologyRow): MonthCoverage {
  if (row.status !== 'observed' || row.snpp_detections_per_observed_day === null) {
    return 'not_observed'
  }
  if (
    row.years_supporting >= MIN_SUPPORTING_YEARS &&
    row.observed_days >= MIN_OBSERVED_DAYS
  ) {
    return 'adequate'
  }
  return 'limited'
}

export function activityBand(rate: number, peakRate: number): ActivityBand {
  if (rate <= 0) return 'none'
  if (peakRate <= 0) return 'none'
  const ratio = rate / peakRate
  if (ratio >= 0.6) return 'very_high'
  if (ratio >= 0.3) return 'high'
  if (ratio >= 0.1) return 'moderate'
  return 'lower'
}

function joinNames(values: string[]): string {
  if (values.length === 0) return ''
  if (values.length === 1) return values[0]
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`
}

export function summarizeSeason(historical: HistoricalPatterns): SeasonalSummary {
  const adequate = historical.monthly_climatology.filter(
    (row) => monthCoverage(row) === 'adequate',
  )
  const peakRate = adequate.reduce(
    (max, row) => Math.max(max, row.snpp_detections_per_observed_day ?? 0),
    0,
  )

  const rowsByMonth = new Map(
    historical.monthly_climatology.map((row) => [row.month, row]),
  )
  const months: SeasonalMonth[] = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1
    const row = rowsByMonth.get(monthNumber)
    if (!row) {
      return {
        month: monthNumber,
        label: MONTH_NAMES[index].slice(0, 3),
        fullLabel: MONTH_NAMES[index],
        coverage: 'not_observed',
        rate: null,
        yearsSupporting: 0,
        observedDays: 0,
        detectionDays: 0,
        band: null,
      }
    }
    const coverage = monthCoverage(row)
    const rate = coverage === 'not_observed' ? null : row.snpp_detections_per_observed_day
    return {
      month: monthNumber,
      label: row.label,
      fullLabel: MONTH_NAMES[index] ?? row.label,
      coverage,
      rate,
      yearsSupporting: row.years_supporting,
      observedDays: row.observed_days,
      detectionDays: row.detection_days,
      band:
        coverage === 'adequate' && rate !== null
          ? activityBand(rate, peakRate)
          : null,
    }
  })

  const ranked = months
    .filter((row) => row.coverage === 'adequate' && row.rate !== null)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))

  const peak = ranked[0] ?? null
  const topMonths = ranked.filter(
    (row) => row.band === 'very_high' || row.band === 'high',
  )

  const years = historical.year_totals
    .map((row) => Number.parseInt(row.year, 10))
    .filter((year) => Number.isFinite(year))
  const firstYear = years.length > 0 ? Math.min(...years) : null
  const lastYear = years.length > 0 ? Math.max(...years) : null
  const yearRange =
    firstYear !== null && lastYear !== null
      ? firstYear === lastYear
        ? String(firstYear)
        : `${firstYear}–${lastYear}`
      : null

  const observedNames = months
    .filter((row) => row.coverage === 'adequate')
    .map((row) => row.fullLabel)
  const limitedNames = months
    .filter((row) => row.coverage === 'limited')
    .map((row) => row.fullLabel)
  const missingNames = months
    .filter((row) => row.coverage === 'not_observed')
    .map((row) => row.fullLabel)

  const seasonSentence =
    topMonths.length === 0
      ? 'No single month stands out in the available historical record.'
      : `Historically, most observed fire activity happens in ${joinNames(
          topMonths.map((row) => row.fullLabel),
        )}.`

  const peakSentence = peak
    ? `${peak.fullLabel} has the highest observed activity, at ${peak.rate?.toLocaleString(
        undefined,
        { maximumFractionDigits: 1 },
      )} hotspot detections per observed day.`
    : 'There is not enough historical information to identify a peak month.'

  const coverageParts = [
    yearRange
      ? `${historical.basis.platform} observations cover ${yearRange}. Ranked months: ${joinNames(
          observedNames,
        ) || 'none'}.`
      : 'No historical years are available.',
    limitedNames.length > 0
      ? `${joinNames(limitedNames)} ${
          limitedNames.length === 1 ? 'has' : 'have'
        } too few observations to rank.`
      : '',
    missingNames.length > 0
      ? `${joinNames(missingNames)} ${
          missingNames.length === 1 ? 'was' : 'were'
        } not acquired, so ${missingNames.length === 1 ? 'it is' : 'they are'} never treated as zero.`
      : '',
  ].filter(Boolean)

  return {
    months,
    ranked,
    peak,
    topMonths,
    firstYear,
    lastYear,
    seasonSentence,
    peakSentence,
    coverageNote: coverageParts.join(' '),
  }
}

export type ActivityComparison = 'higher' | 'around' | 'lower' | 'insufficient'

export type RecentActivitySummary = {
  detections: number
  activeDays: number
  windowDays: number
  comparison: ActivityComparison
  /** Share of observed days with at least one detection, historical month. */
  historicalShare: number | null
  /** Share of days in the recent window with at least one detection. */
  recentShare: number | null
  sameMonth: SeasonalMonth | null
}

/**
 * Compare the recent NRT window with the same calendar month in the historical
 * record. The comparison is intentionally conservative:
 * - it needs a month with adequate coverage;
 * - a baseline with no detectable days cannot support a ratio;
 * - thresholds are wide because recent detections pool three platforms while
 *   the historical baseline uses Suomi-NPP alone.
 */
export function compareRecentActivity(
  current: CurrentObservations,
  month: SeasonalMonth | null | undefined,
  windowDays = 7,
): RecentActivitySummary {
  const sameMonth = month ?? null
  const base: RecentActivitySummary = {
    detections: current.recent_week_detections,
    activeDays: current.recent_week_active_days,
    windowDays,
    comparison: 'insufficient',
    historicalShare: null,
    recentShare: null,
    sameMonth,
  }
  if (!sameMonth || sameMonth.coverage !== 'adequate') return base
  if (sameMonth.observedDays <= 0) return base

  const historicalShare = sameMonth.detectionDays / sameMonth.observedDays
  if (historicalShare <= 0) return { ...base, historicalShare }

  const recentShare = Math.min(1, current.recent_week_active_days / windowDays)
  const ratio = recentShare / historicalShare
  const comparison: ActivityComparison =
    ratio >= 1.5 ? 'higher' : ratio <= 0.67 ? 'lower' : 'around'

  return {
    ...base,
    comparison,
    historicalShare,
    recentShare,
  }
}

export const COMPARISON_LABELS: Record<ActivityComparison, string> = {
  higher: 'More active than usual',
  around: 'Around the usual level',
  lower: 'Less active than usual',
  insufficient: 'No usual-month comparison available',
}

export type RecentWeatherSummary = {
  days: number
  start: string
  end: string
  rainTotal: number
  meanHumidity: number
  maxTemperature: number
  meanTemperature: number
  maxWind: number
}

/**
 * Summarise the seven most recent *observed* days. Forecast rows are excluded
 * by the as-of date, and duplicate dates are collapsed (the export can contain
 * both the archive and forecast value for today).
 */
export function summarizeObservedWeather(
  rows: WeatherRow[],
  asOf: string,
): RecentWeatherSummary | null {
  const asOfDate = asOf.slice(0, 10)
  const byDate = new Map<string, WeatherRow>()
  for (const row of rows) {
    if (row.date > asOfDate) continue
    if (!byDate.has(row.date)) byDate.set(row.date, row)
  }
  const observed = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-7)
  if (observed.length === 0) return null

  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

  return {
    days: observed.length,
    start: observed[0].date,
    end: observed[observed.length - 1].date,
    rainTotal: observed.reduce((sum, row) => sum + row.precipitation_sum, 0),
    meanHumidity: mean(observed.map((row) => row.relative_humidity_2m_mean)),
    maxTemperature: Math.max(...observed.map((row) => row.temperature_2m_max)),
    meanTemperature: mean(observed.map((row) => row.temperature_2m_max)),
    maxWind: Math.max(...observed.map((row) => row.wind_speed_10m_max)),
  }
}

export const FWI_PLAIN: Record<FwiCategory, { title: string; sentence: string }> = {
  low: {
    title: 'Low fire danger',
    sentence: 'Weather conditions would make it difficult for a fire to spread.',
  },
  moderate: {
    title: 'Moderate fire danger',
    sentence: 'Weather conditions would make it moderately easy for a fire to spread.',
  },
  high: {
    title: 'High fire danger',
    sentence: 'Weather conditions would allow fires to spread easily.',
  },
  very_high: {
    title: 'Very high fire danger',
    sentence: 'Weather conditions would allow fires to spread very easily and burn intensely.',
  },
  extreme: {
    title: 'Extreme fire danger',
    sentence: 'Weather conditions are extremely favourable for fast, intense fire spread.',
  },
}

export const FWI_LABELS: Record<FwiCategory, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
  extreme: 'Extreme',
}
