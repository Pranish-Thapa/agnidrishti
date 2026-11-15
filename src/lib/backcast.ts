/**
 * Pre-2012 backcast artifact (`public/data/experiments/backcast.json`).
 *
 * The pipeline tests whether a MODIS-to-VIIRS relationship fitted on the
 * post-2012 overlap transfers to earlier years. Every platform and calendar
 * month carries an explicit decision:
 *
 *   SUPPORTED  - the estimate is supported by blocked transferability tests
 *   LIMITED    - only the listed months/conditions are supported
 *   UNSUPPORTED - raw MODIS must stay on its native scale
 *
 * A month is `unsupported` when there is no overlap evidence for it. The
 * post-2012 reference record covers January-June, so July-December stays raw.
 */

export type BackcastDecision = 'SUPPORTED' | 'LIMITED' | 'UNSUPPORTED'

export type BackcastMonthStatus = 'supported' | 'limited' | 'unsupported'

export type BackcastMonth = {
  status: BackcastMonthStatus
  factor: number | null
  validation_pairs: number
  reason: string | null
  uncertainty: {
    mae?: { point: number; ci_lower: number; ci_upper: number } | null
  } | null
}

export type BackcastPlatform = {
  decision: BackcastDecision
  reason: string
  years: number[]
  validation_pairs: number
  confident_winner: boolean
  best_method: string | null
  method_statement: string
  supported_months: string[]
  limited_months: string[]
  months: Record<string, BackcastMonth>
  transferability: {
    forward_ccc: number | null
    backward_ccc: number | null
  }
}

export type BackcastArtifact = {
  contract_version: string
  generated_at: string
  calibration_version: string
  calibration_period: { start: string; end: string | null; note?: string }
  method: string
  court_verdict: 'inconclusive' | 'regional_winner'
  reference: string
  terminology: string
  regions: Record<string, Partial<Record<'Terra' | 'Aqua', BackcastPlatform>>>
  limitations: string[]
}

/** First day of the VIIRS Suomi-NPP reference record. */
export const BACKCAST_CUTOFF = '2012-01-20'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isBackcastArtifact(value: unknown): value is BackcastArtifact {
  if (!isRecord(value)) return false
  return (
    typeof value.contract_version === 'string' &&
    typeof value.calibration_version === 'string' &&
    isRecord(value.regions)
  )
}

export async function loadBackcast(signal?: AbortSignal): Promise<BackcastArtifact | null> {
  const path = `${import.meta.env.BASE_URL}data/experiments/backcast.json`
  try {
    const response = await fetch(path, { signal })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`)
    const payload: unknown = await response.json()
    if (!isBackcastArtifact(payload)) throw new Error(`Invalid artifact shape: ${path}`)
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return null
  }
}

/** Month-of-year evidence for one region/platform, or null when absent. */
export function backcastMonth(
  artifact: BackcastArtifact | null,
  regionId: string,
  platform: 'Terra' | 'Aqua',
  monthOfYear: string,
): BackcastMonth | null {
  if (!artifact) return null
  const platformInfo = artifact.regions[regionId]?.[platform]
  const month = platformInfo?.months?.[monthOfYear]
  return month ?? null
}

/** A platform contributes an estimate only when its month is supported. */
export function isBackcastEligible(month: BackcastMonth | null): boolean {
  return Boolean(month && month.factor !== null && (month.status === 'supported' || month.status === 'limited'))
}

export function isPreBackcastPeriod(weekStart: string): boolean {
  return weekStart < BACKCAST_CUTOFF
}
