/**
 * Typed loader for the Community Fire Intelligence contract exported by
 * `python -m pipeline community-update` into `public/data/community/`.
 *
 * The fire-activity outlook is present ONLY when the leave-one-year-out
 * validation demonstrated genuine skill beyond the monthly climatology
 * baseline AND the current date falls inside the validated January-July
 * season. Otherwise outlook.status is not_validated or
 * validated_but_out_of_season and no activity prediction is displayed.
 */

export type FwiCategory = 'low' | 'moderate' | 'high' | 'very_high' | 'extreme'

export type MonthlyClimatologyRow = {
  month: number
  label: string
  status: string
  snpp_detections_per_observed_day: number | null
  years_supporting: number
  observed_days: number
  detection_days: number
  above_overall_mean?: boolean
}

export type YearTotalRow = {
  year: string
  snpp_detections: number
  observed_days: number
  note: string
}

/**
 * Pre-VIIRS MODIS view (2000-2011). Kept separate from `historical` because
 * MODIS and VIIRS are different detection scales; these rates are never
 * converted to a VIIRS-equivalent value and are not comparable to the
 * Suomi-NPP climatology above.
 */
export type ModisLongTermRow = {
  month: number
  label: string
  terra_detections_per_observed_day: number | null
  aqua_detections_per_observed_day: number | null
  terra_observed_days: number
  aqua_observed_days: number
  years_supporting: number
}

export type ModisLongTerm = {
  period: { start: string | null; end: string | null }
  monthly: ModisLongTermRow[]
  peak_month_terra: {
    month: number
    label: string
    terra_detections_per_observed_day: number
  } | null
  peak_month_aqua: {
    month: number
    label: string
    aqua_detections_per_observed_day: number
  } | null
  basis: { platforms: string; reason: string; record_note: string }
}

export type HistoricalPatterns = {
  monthly_climatology: MonthlyClimatologyRow[]
  peak_month: {
    month: number
    label: string
    snpp_detections_per_observed_day: number
    years_supporting: number
    observed_days: number
    detection_days: number
  } | null
  low_month: {
    month: number
    label: string
    snpp_detections_per_observed_day: number
    years_supporting: number
    observed_days: number
    detection_days: number
  } | null
  overall_rate_per_observed_day: number | null
  year_totals: YearTotalRow[]
  basis: { platform: string; reason: string; record_note: string }
}

export type NrtRecord = {
  latitude: number
  longitude: number
  acq_date: string
  acq_time: string | null
  platform: string
  brightness: number
  frp: number | null
  confidence: number | string | null
  daynight: 'D' | 'N' | null
  district_id: string
}

export type CurrentObservations = {
  nrt_records: NrtRecord[]
  recent_week_records: NrtRecord[]
  recent_week_detections: number
  recent_week_active_days: number
  observation_freshness: string
  note: string
}

export type WeatherRow = {
  date: string
  temperature_2m_max: number
  temperature_2m_min: number
  relative_humidity_2m_mean: number
  precipitation_sum: number
  wind_speed_10m_max: number
}

export type FwiOutput = {
  date: string
  ffmc: number
  dmc: number
  dc: number
  isi: number
  bui: number
  fwi: number
  fwi_category: FwiCategory
  state_reset_after_gap?: boolean
}

export type OutlookDay = {
  date: string
  probability_of_active_day: number
  fwi: number | null
  fwi_category: string | null
}

export type OutlookStatus = 'validated' | 'validated_but_out_of_season' | 'not_validated'

export type Outlook = {
  status: OutlookStatus
  season_note: string
  feature_names: string[]
  training_days: number
  validation_years: number[]
  folds: Array<{
    held_out_year: number
    pairs: number
    active_days: number
    auc: number | null
    climatology_auc: number | null
    brier: number
    climatology_brier: number
  }>
  metrics: {
    mean_auc: number | null
    mean_climatology_auc: number | null
    skill_over_climatology: number | null
    validated_thresholds: { auc_min: number; skill_min: number }
  }
  outlook_days: OutlookDay[]
  model: string
  target: string
  caveats: string[]
}

export type Explanation = {
  topic: string
  text: string
  evidence: Record<string, unknown>
}

export type SafetySource = {
  name: string
  url: string | null
  note: string
  kind: string
  verified_reachable: boolean | null
}

export type CommunityData = {
  contract_version: string
  generated_at: string
  district_id: string
  district: {
    name: string
    province: string
    pcode: string
    centroid: { latitude: number; longitude: number }
  }
  historical: HistoricalPatterns
  historical_modis_long_term?: ModisLongTerm
  current_observations: CurrentObservations
  weather_recent_30d: WeatherRow[]
  weather_forecast_7d: WeatherRow[]
  fwi: {
    current: FwiOutput | null
    forecast_7d: (FwiOutput | null)[]
    approximations: string[]
    calibration: string
  }
  outlook: Outlook
  explanations: Explanation[]
  safety_sources: SafetySource[]
  limitations: string[]
  provenance: Record<string, string>
}

export type CommunityIndex = {
  contract_version: string
  generated_at: string
  districts: Array<{
    district_id: string
    name: string
    province: string
    generated_at: string
    outlook_status: string
    nrt_records: number
    fwi_category: string | null
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isCommunityData(value: unknown): value is CommunityData {
  if (!isRecord(value)) return false
  return (
    typeof value.contract_version === 'string' &&
    typeof value.district_id === 'string' &&
    isRecord(value.district) &&
    isRecord(value.historical) &&
    isRecord(value.outlook) &&
    Array.isArray(value.explanations)
  )
}

export function isCommunityIndex(value: unknown): value is CommunityIndex {
  if (!isRecord(value)) return false
  return typeof value.generated_at === 'string' && Array.isArray(value.districts)
}

async function loadJson<T>(
  path: string,
  guard: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T | null> {
  try {
    const response = await fetch(path, { signal })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`)
    const payload: unknown = await response.json()
    if (!guard(payload)) throw new Error(`Invalid community data shape: ${path}`)
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return null
  }
}

export function loadCommunityDistrict(
  districtId: string,
  signal?: AbortSignal,
): Promise<CommunityData | null> {
  return loadJson(
    `${import.meta.env.BASE_URL}data/community/${districtId}.json`,
    isCommunityData,
    signal,
  )
}

export function loadCommunityIndex(signal?: AbortSignal): Promise<CommunityIndex | null> {
  return loadJson(
    `${import.meta.env.BASE_URL}data/community/index.json`,
    isCommunityIndex,
    signal,
  )
}

export const FWI_CATEGORY_LABELS: Record<FwiCategory, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
  extreme: 'Extreme',
}

export const FWI_CATEGORY_COLORS: Record<FwiCategory, string> = {
  low: '#2F7D6A',
  moderate: '#EAB308',
  high: '#F59E0B',
  very_high: '#EA580C',
  extreme: '#DC2626',
}
