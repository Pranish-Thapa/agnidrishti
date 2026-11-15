import regionConfig from '../data/regions.json'

/**
 * Central study-area configuration.
 *
 * The single source of truth is `src/data/regions.json`, which the Python
 * pipeline also reads (see `pipeline/config.py`). UI components must never
 * hard-code a region, its parent, its area or its boundary source: read it
 * from here so the six study areas stay consistent across the Explorer,
 * Community, maps, charts and documentation.
 *
 * To add a study area: add one entry to `src/data/regions.json`, point it at
 * an authoritative boundary source file, then run
 * `python -m pipeline boundaries`. See docs/REGIONAL_COVERAGE.md.
 */

export type ScaleClass = 'district' | 'province' | 'state' | 'region'

export type StudyAreaBoundary = {
  source: string
  datasetUrl: string
  license: string
  publisher: string
  boundaryYear: number
  adminLevel: number
  sourceId: string | null
  sourceIdLabel: string
  sourceRegionName: string
}

export type StudyArea = {
  id: string
  name: string
  fullName: string
  country: string
  countryCode: string
  adminLevel: number
  adminLevelLabel: string
  parent: string
  parentLabel: string
  scaleClass: ScaleClass
  areaKm2: number | null
  bbox: readonly [number, number, number, number] | null
  centroid: readonly [number, number] | null
  description: string
  boundary: StudyAreaBoundary
  /** Contract alias retained for observation paths and `district_id`. */
  boundaryId: string
  /** Parent administrative unit (backwards-compatible name). */
  province: string
  /** Authoritative source identifier (P-code or geoBoundaries shapeID). */
  pcode: string
}

type RawRegion = (typeof regionConfig)['regions'][number]

function toStudyArea(raw: RawRegion): StudyArea {
  const boundary = raw.boundary as RawRegion['boundary'] & {
    sourceIdLabel?: string
    sourceRegionName?: string
  }
  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.fullName,
    country: raw.country,
    countryCode: raw.countryCode,
    adminLevel: raw.adminLevel,
    adminLevelLabel: raw.adminLevelLabel,
    parent: raw.parent,
    parentLabel: raw.parentLabel,
    scaleClass: raw.scaleClass as ScaleClass,
    areaKm2: raw.areaKm2,
    bbox: raw.bbox as unknown as StudyArea['bbox'],
    centroid: raw.centroid as unknown as StudyArea['centroid'],
    description: raw.description,
    boundary: {
      source: boundary.source,
      datasetUrl: boundary.datasetUrl,
      license: boundary.license,
      publisher: boundary.publisher,
      boundaryYear: boundary.boundaryYear,
      adminLevel: boundary.adminLevel,
      sourceId: boundary.sourceId ?? null,
      sourceIdLabel: boundary.sourceIdLabel ?? 'Source ID',
      sourceRegionName: boundary.sourceRegionName ?? raw.name,
    },
    boundaryId: raw.id,
    province: raw.parent,
    pcode: boundary.sourceId ?? '',
  }
}

export const studyAreas: readonly StudyArea[] = regionConfig.regions.map(toStudyArea)

export const defaultStudyAreaId: string = studyAreas[0]?.id ?? 'NP-BANKE'

export function getStudyArea(id: string | null | undefined): StudyArea {
  return studyAreas.find((area) => area.id === id) ?? studyAreas[0]
}

export function studyAreaExists(id: string | null | undefined): boolean {
  return Boolean(id) && studyAreas.some((area) => area.id === id)
}

/** Human-readable administrative identity, e.g. "Nepal · District". */
export function studyAreaScopeLabel(area: StudyArea): string {
  return `${area.country} · ${area.adminLevelLabel}`
}

/** Parent identity for display under a region name. */
export function studyAreaParentLabel(area: StudyArea): string {
  return area.parent === area.country ? area.country : `${area.parent}, ${area.country}`
}

export function formatAreaKm2(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Area unavailable'
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} km²`
}

/**
 * Relative scale warning. The Nepal study areas are districts of roughly
 * 2,000 km²; the Thai/Indonesian/Myanmar study areas are provinces or states
 * one to two orders of magnitude larger. Raw detection totals are therefore
 * never comparable across them without area/observation-day normalisation.
 */
export function scaleComparisonNote(area: StudyArea): string | null {
  if (area.areaKm2 === null) return null
  const smallestNepal = Math.min(
    ...studyAreas.filter((item) => item.countryCode === 'NPL' && item.areaKm2).map((item) => item.areaKm2 as number),
  )
  const ratio = area.areaKm2 / smallestNepal
  if (ratio < 5) return null
  return `About ${Math.round(ratio)}× the area of a Nepal study district. Raw detection totals are not comparable across regions; use area- and observation-day-normalised comparisons.`
}

/** Distinct boundary attributions, deduplicated by source string. */
export const studyAreaBoundarySources: readonly StudyAreaBoundary[] = Array.from(
  new Map(studyAreas.map((area) => [area.boundary.source, area.boundary])).values(),
)

/**
 * Combined attribution line for multi-region maps. Each region keeps its own
 * licence; this string is a summary, not a replacement for per-region credit.
 */
export const studyAreaBoundarySource = {
  label: studyAreaBoundarySources.map((source) => source.source).join('; '),
  sources: studyAreaBoundarySources,
} as const

export const regionConfigVersion: string = regionConfig.contractVersion
