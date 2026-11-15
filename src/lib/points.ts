/**
 * Typed loader for point-level NASA FIRMS hotspot detections exported by
 * `python -m pipeline export-points` into `public/data/points/`.
 *
 * Every record is one satellite hotspot detection that survived the full
 * normalize -> QC -> exact district polygon assignment chain. A detection is
 * NOT a unique fire, and coordinates are display-rounded to 4 decimals.
 */

import { studyAreas } from './regions'

export type HotspotRecord = {
  latitude: number
  longitude: number
  /** Full ISO date, reconstructed from the file's year + the MM-DD field. */
  acqDate: string
  /** UTC acquisition time (HH:MM) or null. */
  acqTime: string | null
  platform: string
  /** Primary thermal channel: MODIS `brightness`, VIIRS `bright_ti4`. */
  brightness: number
  /** Fire Radiative Power in MW, or null when absent. */
  frp: number | null
  /** MODIS numeric 0-100 or VIIRS categorical (l / n / h). */
  confidence: number | string | null
  daynight: 'D' | 'N' | null
  districtId: string
}

export type HotspotDataset = {
  provider: 'sp' | 'nrt'
  product: 'SP' | 'NRT'
  districtId: string
  year: string
  platformCounts: Record<string, number>
  /** Full number of detections recorded for this region-year. */
  recordCount: number
  /** How many detections the export includes for the map (memory bound). */
  displayedCount: number
  displayNote: string | null
  records: HotspotRecord[]
}

type RawPointsFile = {
  contract_version: string
  provider: string
  product: string
  district_id: string
  year: string
  platform_counts: Record<string, number>
  record_count: number
  displayed_count?: number
  display_note?: string
  records: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRawPointsFile(value: unknown): value is RawPointsFile {
  if (!isRecord(value)) return false
  return (
    typeof value.contract_version === 'string' &&
    typeof value.district_id === 'string' &&
    typeof value.year === 'string' &&
    Array.isArray(value.records) &&
    isRecord(value.platform_counts)
  )
}

function parseRow(row: unknown, districtId: string, year: string): HotspotRecord | null {
  if (!Array.isArray(row) || row.length < 9) return null
  const [lat, lon, datePart, time, platform, brightness, frp, confidence, daynight] = row as [
    number,
    number,
    string,
    string | null,
    string,
    number,
    number | null,
    number | string | null,
    string | null,
  ]
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  return {
    latitude: lat,
    longitude: lon,
    acqDate: `${year}-${datePart}`,
    acqTime: time ?? null,
    platform,
    brightness: brightness,
    frp: frp,
    confidence,
    daynight: daynight === 'D' || daynight === 'N' ? daynight : null,
    districtId,
  }
}

/**
 * Loads the point-level detections for one provider/year and the requested
 * study areas. Areas without an exported file resolve to null so the map can
 * state "no point records" honestly. The Explorer passes the selected area
 * only: loading every region's file pulled hundreds of megabytes.
 */
export async function loadHotspots(
  provider: 'sp' | 'nrt',
  year: string,
  regionIds: string[] = studyAreas.map((area) => area.id),
  signal?: AbortSignal,
): Promise<(HotspotDataset | null)[] | null> {
  try {
    const datasets = await Promise.all(
      regionIds.map(async (regionId): Promise<HotspotDataset | null> => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/points/${provider}/${regionId}/${year}.json`,
          { signal },
        )
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`Failed to load hotspots: ${response.status}`)
        const payload: unknown = await response.json()
        if (!isRawPointsFile(payload)) {
          throw new Error('Invalid point dataset shape')
        }
        const records = payload.records
          .map((row) => parseRow(row, payload.district_id, payload.year))
          .filter((r): r is HotspotRecord => r !== null)
        return {
          provider,
          product: payload.product as 'SP' | 'NRT',
          districtId: payload.district_id,
          year: payload.year,
          platformCounts: payload.platform_counts,
          recordCount: payload.record_count,
          displayedCount: payload.displayed_count ?? records.length,
          displayNote: payload.display_note ?? null,
          records,
        }
      }),
    )
    return datasets
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return null
  }
}

/**
 * Marker families per visualization layer. The harmonized layer shows the
 * raw MODIS detections that feed the provisional estimate — harmonized
 * values themselves are never rendered as observed hotspot positions.
 */
export function markerPlatforms(layer: 'harmonized' | 'modis' | 'viirs'): string[] {
  if (layer === 'modis') return ['Terra', 'Aqua']
  if (layer === 'harmonized') return ['Terra', 'Aqua']
  return ['Suomi-NPP', 'NOAA-20', 'NOAA-21']
}

/**
 * Marker colours follow the Observation Deck channels: warm signal for the
 * MODIS platforms and the cool sky-blue observation scale for VIIRS, matching
 * the legend used by the weekly comparison chart.
 */
export const PLATFORM_COLORS: Record<string, string> = {
  Terra: '#EA580C', // signal orange — MODIS Terra (morning overpass)
  Aqua: '#FB923C', // warm amber — MODIS Aqua (early-afternoon overpass)
  'Suomi-NPP': '#38BDF8', // sky blue — VIIRS reference platform
  'NOAA-20': '#7DD3FC', // light sky — VIIRS NOAA-20
  'NOAA-21': '#BAE6FD', // pale sky — VIIRS NOAA-21
}
