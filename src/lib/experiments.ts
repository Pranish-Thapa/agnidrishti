/**
 * Typed loaders for the experiment artifacts published by the pipeline
 * (`public/data/experiments/`). Every harmonized value surfaced through
 * these types is a PROVISIONAL VIIRS-equivalent estimate: the Method Court
 * verdict is inconclusive and no method is a validated winner.
 */

export type CourtOutcome = 'selected' | 'inconclusive' | 'insufficient_methods'

export type CourtMetrics = {
  n: number
  mae: number | null
  rmse: number | null
  log_rmse: number | null
  mean_bias: number | null
  pearson: number | null
  ccc: number | null
  /** Baselines (constant ratio, seasonal climatology) can never be selected. */
  is_baseline?: boolean
}

export type PairedComparison = {
  point: number
  ci_lower: number
  ci_upper: number
  iterations: number
  confidence_level: number
  blocks: number
  seed: number
  interpretation?: string
}

export type WeeklyValidationBlock = {
  weekly_buckets: number
  overall: CourtMetrics
  by_modis_platform: Record<string, CourtMetrics>
}

export type CourtDecision = {
  outcome: CourtOutcome
  selected_method?: string
  justification?: string
  note?: string
  evidence?: Record<string, unknown>
}

export type ReliabilityCategory =
  | 'reliable'
  | 'use_with_caution'
  | 'insufficient_evidence'
  | 'unavailable'

export type ReliabilityStratum = {
  category: ReliabilityCategory
  validation_pairs: number
  best_method_metrics?: CourtMetrics
  /** B5: typical out-of-fold error for this stratum (daily counts). */
  interval?: {
    mae: number | null
    p90_abs_error: number | null
    note?: string
  } | null
}

export type ReliabilityGrid = Record<string, Record<string, ReliabilityStratum>>

export type SeamAuditRow = {
  district_id: string
  modis_platform: string
  window_months: string[]
  raw_scale_step_viirs_over_modis: number
  // Dynamic keys: scale_step_after_<method>, step_reduction_<method>_percent,
  // log_reduction_<method>_percent, oos_scale_step_after_<method>,
  // oos_step_reduction_<method>_percent, oos_log_reduction_<method>_percent
  [key: string]: unknown
}

export type SeamAuditSummary = {
  scale_step_analysis: SeamAuditRow[]
  modis_version_eras: Record<string, { first_day: string; last_day: string; days: number }>
  confounds: string[]
  record_limitation?: string
}

export type LightsOutYear = {
  overall: CourtMetrics
  profile_correlation: number | null
  raw_modis_profile_correlation?: number | null
  variation_ratio_pred_over_ref: number | null
  monthly_profile: Array<{
    month: string
    reconstructed_total: number
    reference_total: number
  }>
}

export type LightsOutSummary = {
  by_method: Record<string, Record<string, LightsOutYear>>
}

export type ExperimentSummary = {
  contract_version: string
  generated_at: string
  court: {
    ranking: string[]
    decision: CourtDecision
    metrics: Record<string, CourtMetrics>
    by_district?: Record<string, Record<string, CourtMetrics>>
    paired_comparisons?: Record<string, PairedComparison>
    metric_explanations: Record<string, string>
  }
  weekly_validation?: Record<string, WeeklyValidationBlock> | null
  reliability: {
    criteria: Record<string, { note?: string; min_stratum_pairs?: number; min_ccc?: number }>
    category_counts: Record<string, number>
    grid: ReliabilityGrid
    weak_years: string[]
    grading_basis?: string
  }
  seam_audit?: SeamAuditSummary | null
  lights_out?: LightsOutSummary | null
  validation: {
    total_pairs?: number
    training_pairs: number
    validation_pairs: number
    purge_pairs?: number
    validation_years: number[]
    purge_days: number
  }
  limitations: string[]
}

export type FactorMonth = {
  ratio: number | null
  status: string | null
  lambda: number | null
  modis_detections: number | null
}

export type PlatformFactors = {
  district_ratio: number | null
  months: Record<string, FactorMonth>
}

export type HarmonizationFactors = {
  contract_version: string
  generated_at: string
  method: string
  method_status: 'provisional'
  court_verdict: 'inconclusive'
  reference: string
  meaning: string
  districts: Record<string, Record<string, PlatformFactors>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isExperimentSummary(value: unknown): value is ExperimentSummary {
  if (!isRecord(value)) return false
  return (
    typeof value.contract_version === 'string' &&
    isRecord(value.court) &&
    isRecord(value.reliability) &&
    isRecord(value.validation)
  )
}

export function isHarmonizationFactors(value: unknown): value is HarmonizationFactors {
  if (!isRecord(value)) return false
  return (
    typeof value.contract_version === 'string' &&
    value.method_status === 'provisional' &&
    isRecord(value.districts)
  )
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
    if (!guard(payload)) throw new Error(`Invalid artifact shape: ${path}`)
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return null
  }
}

export function loadExperimentSummary(signal?: AbortSignal): Promise<ExperimentSummary | null> {
  return loadJson(`${import.meta.env.BASE_URL}data/experiments/summary.json`, isExperimentSummary, signal)
}

export function loadHarmonizationFactors(signal?: AbortSignal): Promise<HarmonizationFactors | null> {
  return loadJson(`${import.meta.env.BASE_URL}data/experiments/harmonization_factors.json`, isHarmonizationFactors, signal)
}

/**
 * Monthly-shrinkage factor for a district/platform/month-of-year.
 * Returns the ratio together with its evidence status; callers must keep
 * the two together in the UI.
 */
export function getFactor(
  factors: HarmonizationFactors,
  districtId: string,
  platform: 'Terra' | 'Aqua',
  monthOfYear: string,
): { ratio: number | null; status: string | null } {
  const sub = factors.districts[districtId]?.[platform]
  if (!sub) return { ratio: null, status: 'no_model' }
  const month = sub.months[monthOfYear]
  if (month && month.ratio !== null && month.ratio !== undefined) {
    return { ratio: month.ratio, status: month.status ?? 'fitted' }
  }
  if (sub.district_ratio !== null && sub.district_ratio !== undefined) {
    return { ratio: sub.district_ratio, status: 'district_ratio_fallback' }
  }
  return { ratio: null, status: 'no_model' }
}
