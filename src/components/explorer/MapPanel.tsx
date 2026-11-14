import { useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { StatusBadge } from '../ui/StatusBadge'
import { getDistrictFeature, type DistrictGeometry } from '../../lib/geo'
import { palette, withAlpha } from '../../lib/palette'
import { studyAreaBoundarySource, studyAreas, type StudyArea, type StudyAreaId } from '../../lib/regions'
import type { DistrictYearSummary } from '../../lib/layers'
import type { LayerId, ProviderId } from '../../lib/explorer'
import {
  loadHotspots,
  markerPlatforms,
  PLATFORM_COLORS,
  type HotspotDataset,
  type HotspotRecord,
} from '../../lib/points'

type MapPanelProps = {
  area: StudyArea
  layerLabel: string
  layer: LayerId
  year: string | null
  provider: ProviderId
  /** Per-district aggregates for the active provider/year/layer; null where no data. */
  districtSummaries: (DistrictYearSummary | null)[] | null
  onSelectDistrict: (id: StudyAreaId) => void
}

type ViewMode = 'district' | 'hotspots' | 'both'

const TERRACOTTA = palette.terracotta.DEFAULT
const MAX_ZOOM = 15
const MIN_ZOOM = 7

const viewModes: Array<{ id: ViewMode; label: string }> = [
  { id: 'district', label: 'District activity' },
  { id: 'hotspots', label: 'Hotspots' },
  { id: 'both', label: 'Both' },
]

/**
 * Choropleth intensity: sqrt-scaled like the calendar so one extreme district
 * cannot flatten the others. Intensity is computed against the largest
 * district total *within the same selection*, so colours compare districts,
 * not years. Districts without data render as muted outlines.
 */
function districtStyle(
  districtId: string,
  summaries: (DistrictYearSummary | null)[] | null,
  selectedId: string,
): L.PathOptions {
  const selected = districtId === selectedId
  const summary = summaries?.find((s) => s?.districtId === districtId) ?? null
  const maxTotal = Math.max(1, ...(summaries ?? []).map((s) => s?.total ?? 0))
  if (!summary || summary.total <= 0) {
    return {
      color: withAlpha(palette.sand, selected ? 0.55 : 0.25),
      weight: selected ? 2.5 : 1.5,
      fillColor: withAlpha(palette.sand, 0.05),
      fillOpacity: 0.5,
    }
  }
  const intensity = Math.sqrt(Math.min(summary.total, maxTotal) / maxTotal)
  return {
    color: selected ? palette.bone : withAlpha(TERRACOTTA, 0.85),
    weight: selected ? 2.5 : 1.5,
    fillColor: withAlpha(TERRACOTTA, 0.2 + 0.6 * intensity),
    fillOpacity: 0.55,
  }
}

/** Marker radius from FRP (MW): 3 px base, grows with sqrt(FRP), capped. */
function markerRadius(frp: number | null): number {
  if (frp === null || frp <= 0) return 3
  return Math.min(3 + 1.15 * Math.sqrt(frp), 11)
}

function popupHtml(record: HotspotRecord): string {
  const rows: Array<[string, string]> = [
    ['Platform', record.platform],
    ['Acquired (UTC)', `${record.acqDate}${record.acqTime ? ` ${record.acqTime}` : ''}`],
    ['Brightness (K)', record.brightness.toFixed(1)],
  ]
  if (record.frp !== null) rows.push(['FRP (MW)', record.frp.toFixed(1)])
  if (record.confidence !== null) rows.push(['Confidence', String(record.confidence)])
  if (record.daynight) {
    rows.push(['Pass', record.daynight === 'D' ? 'Day' : 'Night'])
  }
  rows.push(['District', record.districtId.replace('NP-', '')])
  return `<div class="agnidrishti-popup">${rows
    .map(
      ([label, value]) =>
        `<div class="agnidrishti-popup-row"><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join('')}<p class="agnidrishti-popup-note">One hotspot detection — not a unique fire.</p></div>`
}



/** Ray-casting point-in-polygon over GeoJSON Polygon/MultiPolygon rings. */
function pointInDistrict(lat: number, lng: number, geometry: DistrictGeometry): boolean {
  const polygons: number[][][][] =
    geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : (geometry.coordinates as number[][][][])
  let inside = false
  for (const polygon of polygons) {
    const outer = polygon[0]
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [xi, yi] = outer[i]
      const [xj, yj] = outer[j]
      const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (intersects) inside = !inside
    }
  }
  return inside
}

export function MapPanel({
  area,
  layerLabel,
  layer,
  year,
  provider,
  districtSummaries,
  onSelectDistrict,
}: MapPanelProps) {
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const districtLayerRef = useRef<L.GeoJSON | null>(null)
  const hotspotLayerRef = useRef<L.LayerGroup | null>(null)
  const rendererRef = useRef<L.Canvas | null>(null)

  const [expanded, setExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [hotspots, setHotspots] = useState<(HotspotDataset | null)[] | null>(null)
  const [hotspotsLoading, setHotspotsLoading] = useState(false)
  const [hotspotsError, setHotspotsError] = useState(false)

  const showHotspots = viewMode === 'hotspots' || viewMode === 'both'
  const markerFamily = useMemo(() => markerPlatforms(layer), [layer])
  const markerFamilyKey = markerFamily.join('|')

  const featureCollection = useMemo(() => {
    const features = studyAreas
      .map((s) => getDistrictFeature(s.id))
      .filter((f): f is NonNullable<ReturnType<typeof getDistrictFeature>> => Boolean(f))
    return { type: 'FeatureCollection' as const, features }
  }, [])

  // Keep latest callbacks/state in refs so map handlers never go stale.
  const selectRef = useRef(onSelectDistrict)
  selectRef.current = onSelectDistrict
  const areaRef = useRef(area)
  areaRef.current = area
  const summariesRef = useRef(districtSummaries)
  summariesRef.current = districtSummaries

  // Initialize the Leaflet map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      scrollWheelZoom: false, // page scrolling stays predictable; zoom via controls/double-click
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: MAX_ZOOM }).addTo(map)
    rendererRef.current = L.canvas()
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      districtLayerRef.current = null
      hotspotLayerRef.current = null
      rendererRef.current = null
    }
  }, [])

  // District selection via map click: the hotspot canvas renderer sits above
  // the district SVG paths and would swallow their click events, so clicks on
  // the map surface are resolved with a point-in-polygon test instead.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onClick = (event: L.LeafletMouseEvent) => {
      for (const feature of featureCollection.features) {
        if (pointInDistrict(event.latlng.lat, event.latlng.lng, feature.geometry)) {
          const id = (feature.properties as { id: string }).id
          if (studyAreas.some((s) => s.id === id)) {
            selectRef.current(id as StudyAreaId)
          }
          return
        }
      }
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [featureCollection])

  // District polygons: interactive selection + choropleth styling.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (districtLayerRef.current) {
      districtLayerRef.current.remove()
      districtLayerRef.current = null
    }
    const layer = L.geoJSON(featureCollection as unknown as GeoJSON.GeoJsonObject, {
      style: (feature) =>
        districtStyle(
          (feature?.properties as { id: string } | undefined)?.id ?? '',
          summariesRef.current,
          areaRef.current.id,
        ),
      onEachFeature: (feature, layerInstance) => {
        const props = feature.properties as { id: string; name: string }
        layerInstance.bindTooltip(
          `<strong>${props.name}</strong><br/>${props.id === areaRef.current.id ? 'Currently selected' : 'Click to select'}`,
          { sticky: true, className: 'agnidrishti-tooltip' },
        )
        layerInstance.on('click', () => {
          if (studyAreas.some((s) => s.id === props.id)) {
            selectRef.current(props.id as StudyAreaId)
          }
        })
      },
    }).addTo(map)
    districtLayerRef.current = layer
  }, [featureCollection])

  // Restyle the choropleth whenever selection or data changes (no rebuild).
  useEffect(() => {
    districtLayerRef.current?.setStyle((feature) =>
      districtStyle(
        (feature?.properties as { id: string } | undefined)?.id ?? '',
        districtSummaries,
        area.id,
      ),
    )
  }, [area.id, districtSummaries])

  // Fit the selected district on selection change (and initially).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const target = featureCollection.features.find((f) => f.properties.id === area.id)
    if (!target) return
    const bounds = L.geoJSON(target as unknown as GeoJSON.GeoJsonObject).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [14, 14], maxZoom: 10, animate: !reduceMotion })
    }
  }, [area.id, featureCollection, reduceMotion])

  // Point-level detections: loaded only when the hotspot layer is active.
  useEffect(() => {
    if (!showHotspots || !year) {
      setHotspots(null)
      setHotspotsError(false)
      return
    }
    const controller = new AbortController()
    setHotspotsLoading(true)
    setHotspotsError(false)
    loadHotspots(provider, year, controller.signal)
      .then((datasets) => {
        if (controller.signal.aborted) return
        setHotspots(datasets)
        setHotspotsError(datasets === null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setHotspotsError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setHotspotsLoading(false)
      })
    return () => controller.abort()
  }, [showHotspots, provider, year])

  // Hotspot markers: canvas circle markers, coloured per platform, sized by FRP.
  useEffect(() => {
    const map = mapRef.current
    const renderer = rendererRef.current
    if (!map || !renderer) return
    if (hotspotLayerRef.current) {
      hotspotLayerRef.current.remove()
      hotspotLayerRef.current = null
    }
    if (!showHotspots || !hotspots) return

    const family = markerPlatforms(layer)
    const group = L.layerGroup()
    for (const dataset of hotspots) {
      if (!dataset) continue
      for (const record of dataset.records) {
        if (!family.includes(record.platform)) continue
        const color = PLATFORM_COLORS[record.platform] ?? TERRACOTTA
        const marker = L.circleMarker([record.latitude, record.longitude], {
          renderer,
          radius: markerRadius(record.frp),
          color: withAlpha('#0A1211', 0.55), // dark stroke separates overlapping points
          weight: 1,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.82,
        })
        marker.bindPopup(popupHtml(record), {
          className: 'agnidrishti-leaflet-popup',
          maxWidth: 240,
        })
        marker.bindTooltip(`${record.platform} · ${record.acqDate}`, {
          direction: 'top',
          offset: [0, -4],
          className: 'agnidrishti-tooltip',
        })
        group.addLayer(marker)
      }
    }
    group.addTo(map)
    hotspotLayerRef.current = group
  }, [showHotspots, hotspots, markerFamilyKey, layer])

  // Full-screen mode: Escape to exit, lock body scroll, and make Leaflet
  // re-measure the container on BOTH enter and exit (toggling a class does
  // not fire window resize; without this the canvas keeps its expanded size
  // and covers the panel header after collapsing).
  useEffect(() => {
    const invalidate = () => mapRef.current?.invalidateSize({ pan: false })
    const raf = requestAnimationFrame(() => invalidate())
    const timeout = window.setTimeout(invalidate, 260)

    if (!expanded) {
      return () => {
        cancelAnimationFrame(raf)
        window.clearTimeout(timeout)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    const onResize = () => invalidate()
    window.addEventListener('resize', onResize)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
      window.clearTimeout(timeout)
      // Re-measure once more after unmounting the expanded styles so the
      // canvas shrinks back to the panel size.
      requestAnimationFrame(() => invalidate())
      window.setTimeout(invalidate, 260)
    }
  }, [expanded])

  const fitToDistrict = () => {
    const map = mapRef.current
    if (!map) return
    const target = featureCollection.features.find((f) => f.properties.id === area.id)
    if (!target) return
    const bounds = L.geoJSON(target as unknown as GeoJSON.GeoJsonObject).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [14, 14], maxZoom: 10, animate: !reduceMotion })
    }
  }

  const zoom = (delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.setZoom(map.getZoom() + delta)
  }

  const summaryForSelected = districtSummaries?.find((s) => s?.districtId === area.id) ?? null

  const platformLegend = useMemo(() => {
    if (!hotspots) return null
    const counts: Record<string, number> = {}
    let total = 0
    for (const dataset of hotspots) {
      if (!dataset) continue
      for (const [platform, count] of Object.entries(dataset.platformCounts)) {
        if (!markerFamily.includes(platform)) continue
        counts[platform] = (counts[platform] ?? 0) + count
        total += count
      }
    }
    return { counts, total }
  }, [hotspots, markerFamily])

  const sectionClasses = expanded
    ? 'fixed inset-0 z-[1200] flex flex-col bg-ink map-panel-expanded'
    : 'border border-sand/[0.12] bg-ink-850'

  return (
    <section aria-labelledby="map-heading" className={sectionClasses}>
      <div className="flex items-start justify-between gap-4 border-b border-sand/10 px-5 py-4">
        <div className="min-w-0">
          <p className="eyebrow text-ash-dark">Selected study area</p>
          <h2 id="map-heading" className="mt-2 font-display text-xl text-bone">
            {area.name} district
          </h2>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-ash-dark">
            {area.province} · {area.pcode}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge tone="neutral">Geographic view</StatusBadge>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Exit full-screen map' : 'Expand map to full screen'}
            title={expanded ? 'Exit full screen (Esc)' : 'Expand to full screen'}
            className="flex items-center gap-1.5 border border-sand/[0.14] bg-ink-950/70 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ash-light transition-colors hover:bg-sand/[0.075] hover:text-bone"
          >
            {expanded ? (
              <Minimize2 size={12} strokeWidth={1.7} />
            ) : (
              <Maximize2 size={12} strokeWidth={1.7} />
            )}
            {expanded ? 'Exit full screen' : 'Expand'}
          </button>
        </div>
      </div>

      {/* View-mode selector: district choropleth / hotspot markers / both */}
      <div
        className="flex gap-1 border-b border-sand/10 bg-ink-900 px-5 py-2.5"
        role="group"
        aria-label="Map visualization layers"
      >
        {viewModes.map((mode) => {
          const active = viewMode === mode.id
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={active}
              onClick={() => setViewMode(mode.id)}
              className={`flex-1 whitespace-nowrap px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] transition-colors ${
                active ? 'state-selected text-bone' : 'text-ash-light hover:bg-sand/[0.05] hover:text-bone'
              }`}
            >
              {mode.label}
            </button>
          )
        })}
      </div>

      <div className={expanded ? 'relative min-h-0 flex-1' : 'relative'}>
        <div
          ref={containerRef}
          role="application"
          aria-label={`Geographic map of the Nepal study areas. ${area.name} district is highlighted. District fill intensity shows the ${layerLabel} total for ${year ?? 'the selected year'}; ${
            viewMode === 'district'
              ? 'no hotspot markers shown'
              : 'fire hotspot markers show real NASA FIRMS detections'
          }. OpenStreetMap tiles; OCHA COD-AB boundaries.`}
          className={`map-surface w-full ${expanded ? 'h-full' : 'h-[320px] sm:h-[360px]'}`}
        />

        {/* District quick-select: makes the geographic feature discoverable */}
        <div className="absolute left-3 top-3 z-[500] flex flex-col gap-1">
          {studyAreas.map((s) => {
            const active = s.id === area.id
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectDistrict(s.id)}
                className={`border px-2.5 py-1 text-left font-mono text-[9px] uppercase tracking-[0.12em] backdrop-blur-[2px] transition-colors ${
                  active
                    ? 'border-bone/60 bg-ink-950/85 text-bone'
                    : 'border-sand/[0.14] bg-ink-950/70 text-ash-light hover:text-bone'
                }`}
              >
                {s.name}
              </button>
            )
          })}
        </div>

        {/* Zoom + fit controls */}
        <div className="absolute right-3 top-3 z-[500] flex flex-col border border-sand/[0.14] bg-ink-950/85 backdrop-blur-[2px]">
          <button
            type="button"
            onClick={() => zoom(1)}
            aria-label="Zoom map in"
            className="flex h-8 w-8 items-center justify-center text-ash-light transition-colors hover:bg-sand/[0.075] hover:text-bone"
          >
            <span aria-hidden="true" className="text-[14px] leading-none">+</span>
          </button>
          <button
            type="button"
            onClick={() => zoom(-1)}
            aria-label="Zoom map out"
            className="flex h-8 w-8 items-center justify-center border-t border-sand/[0.14] text-ash-light transition-colors hover:bg-sand/[0.075] hover:text-bone"
          >
            <span aria-hidden="true" className="text-[14px] leading-none">−</span>
          </button>
          <button
            type="button"
            onClick={fitToDistrict}
            aria-label="Fit map to selected district"
            className="flex h-8 w-8 items-center justify-center border-t border-sand/[0.14] text-ash-light transition-colors hover:bg-sand/[0.075] hover:text-bone"
          >
            <Maximize2 size={13} strokeWidth={1.7} />
          </button>
        </div>

        {/* Legend — adapts to the active visualization mode */}
        <div className="pointer-events-none absolute bottom-8 left-3 z-[500] max-w-[68%] border border-sand/10 bg-ink-950/85 px-2.5 py-2 backdrop-blur-[2px]">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash-light">
            {layerLabel} · {provider === 'sp' ? 'SP' : 'NRT'} · {year ?? '—'}
          </p>

          {(viewMode === 'district' || viewMode === 'both') && (
            <div className="mt-1.5 flex items-center gap-1.5">
              {[0.1, 0.35, 0.6, 0.8].map((a) => (
                <span
                  key={a}
                  className="h-2.5 w-5 border border-sand/10"
                  style={{ background: withAlpha(TERRACOTTA, a) }}
                  aria-hidden="true"
                />
              ))}
              <span className="ml-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
                district total
              </span>
            </div>
          )}

          {(viewMode === 'hotspots' || viewMode === 'both') && (
            <div className="mt-1.5">
              {hotspotsLoading ? (
                <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
                  loading detections…
                </p>
              ) : platformLegend && platformLegend.total > 0 ? (
                <div className="space-y-1">
                  {markerFamily
                    .filter((platform) => (platformLegend.counts[platform] ?? 0) > 0)
                    .map((platform) => (
                      <div key={platform} className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-ink/60"
                          style={{ background: PLATFORM_COLORS[platform] ?? TERRACOTTA }}
                          aria-hidden="true"
                        />
                        <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ash-light">
                          {platform} · {(platformLegend.counts[platform] ?? 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
                    dot size = FRP · detections, not fires
                  </p>
                </div>
              ) : (
                <p className="font-mono text-[8px] uppercase leading-relaxed tracking-[0.1em] text-ash-dark">
                  {hotspotsError
                    ? 'point records unavailable'
                    : 'no point records for this selection'}
                </p>
              )}
            </div>
          )}

          {(viewMode === 'hotspots' || viewMode === 'both') && (
            <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
              {layer === 'harmonized'
                ? 'markers = raw MODIS inputs to the estimate'
                : 'real NASA FIRMS detections'}
            </p>
          )}
        </div>
      </div>

      <div
        className={`space-y-1.5 border-t border-sand/10 px-5 py-3.5 ${
          expanded ? 'shrink-0 overflow-y-auto' : ''
        }`}
      >
        <p className="text-[11px] leading-relaxed text-ash">
          {viewMode !== 'district' && (
            <>
              <span className="text-ash-light">Hotspot markers</span> are real NASA FIRMS detections
              with verified coordinates — one dot per detection, coloured by platform, sized by FRP.
              A detection is <span className="text-ash-light">not a unique fire</span>.{' '}
            </>
          )}
          {viewMode !== 'hotspots' && (
            <>
              <span className="text-ash-light">Fill intensity</span> shows each district's aggregated{' '}
              <span className="text-ash-light">{layerLabel}</span> total for{' '}
              {year ?? 'the selected year'} (
              {provider === 'sp' ? 'Standard Processing' : 'Near Real-Time'}).{' '}
            </>
          )}
          {layer === 'harmonized' && viewMode !== 'district' && (
            <>
              On the harmonized layer markers show the{' '}
              <span className="text-ash-light">raw MODIS observations</span> feeding the provisional
              estimate — harmonized values are never drawn as observed hotspots.{' '}
            </>
          )}
          {viewMode !== 'hotspots' && summaryForSelected && year
            ? `${area.name} ${year}: ${summaryForSelected.total.toLocaleString()} total across ${summaryForSelected.weekCells.length} covered weeks.`
            : ''}
        </p>
        {viewMode !== 'district' && platformLegend && platformLegend.total > 0 && layer === 'viirs' && (
          <p className="text-[10px] leading-relaxed text-ash-dark">
            Markers show all VIIRS-family platforms individually ({markerFamily.join(', ')}); the
            calendar's VIIRS weekly metric uses the Suomi-NPP reference platform.
          </p>
        )}
        <p className="text-[10px] leading-relaxed text-ash-dark">
          Boundary geometry: {studyAreaBoundarySource.label} ({studyAreaBoundarySource.license},{' '}
          {studyAreaBoundarySource.boundaryYear}). Tiles © OpenStreetMap contributors. Click a
          marker for its verified attributes; press Esc or Exit to leave full screen.
        </p>
      </div>
    </section>
  )
}
