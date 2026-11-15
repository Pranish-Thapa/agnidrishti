import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Crosshair,
  Focus,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { StatusBadge } from '../ui/StatusBadge'
import { LogoMark } from '../ui/LogoMark'
import { getDistrictFeature, type RegionGeometry } from '../../lib/geo'
import { palette, withAlpha } from '../../lib/palette'
import { studyAreaBoundarySources, studyAreas, type StudyArea } from '../../lib/regions'
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
  years: string[]
  provider: ProviderId
  districtSummaries: (DistrictYearSummary | null)[] | null
  onSelectDistrict: (id: string) => void
  onYearChange: (year: string) => void
  onProviderChange: (provider: ProviderId) => void
  initialExpanded?: boolean
}

type ViewMode = 'district' | 'hotspots' | 'both'

const MAX_ZOOM = 15
// Six study areas span Nepal to Indonesia; the overview needs continental zoom.
const MIN_ZOOM = 3

/**
 * District fill channels mirror the rest of the app: warm signal for raw
 * MODIS, the cool observation scale for VIIRS, and the amber estimate channel
 * for the provisional harmonized layer.
 */
const SIGNAL_COLORS: Record<LayerId, string> = {
  modis: palette.terracotta.soft,
  viirs: palette.observation.DEFAULT,
  harmonized: palette.amber.DEFAULT,
}

const viewModes: Array<{ id: ViewMode; label: string }> = [
  { id: 'district', label: 'Area fill' },
  { id: 'hotspots', label: 'Hotspots' },
  { id: 'both', label: 'Both' },
]

function districtStyle(
  districtId: string,
  summaries: (DistrictYearSummary | null)[] | null,
  selectedId: string,
  layer: LayerId,
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
  const signal = SIGNAL_COLORS[layer] ?? palette.amber.DEFAULT
  const intensity = Math.sqrt(Math.min(summary.total, maxTotal) / maxTotal)
  return {
    color: selected ? palette.bone : withAlpha(signal, 0.85),
    weight: selected ? 2.5 : 1.5,
    fillColor: withAlpha(signal, 0.2 + 0.6 * intensity),
    fillOpacity: 0.55,
  }
}

function markerRadius(frp: number | null): number {
  if (frp === null || frp <= 0) return 3
  return Math.min(3 + 1.15 * Math.sqrt(frp), 11)
}

function popupHtml(record: HotspotRecord): string {
  const rows: Array<[string, string]> = [
    ['Platform', record.platform],
    ['Acquired (UTC)', `${record.acqDate}${record.acqTime ? ` ${record.acqTime}` : ''}`],
    ['Coordinates', `${record.latitude.toFixed(4)}, ${record.longitude.toFixed(4)}`],
    ['Brightness (K)', record.brightness.toFixed(1)],
  ]
  if (record.frp !== null) rows.push(['FRP (MW)', record.frp.toFixed(1)])
  if (record.confidence !== null) rows.push(['Confidence', String(record.confidence)])
  if (record.daynight) {
    rows.push(['Pass', record.daynight === 'D' ? 'Day' : 'Night'])
  }
  rows.push(['Study area', record.districtId])
  rows.push(['Source', 'NASA FIRMS'])
  return `<div class="agnidrishti-popup">${rows
    .map(
      ([label, value]) =>
        `<div class="agnidrishti-popup-row"><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join('')}<p class="agnidrishti-popup-note">One hotspot detection — not a unique fire.</p></div>`
}

/** Ray-casting point-in-polygon over GeoJSON Polygon/MultiPolygon rings. */
function pointInDistrict(lat: number, lng: number, geometry: RegionGeometry): boolean {
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
  years,
  provider,
  districtSummaries,
  onSelectDistrict,
  onYearChange,
  onProviderChange,
  initialExpanded,
}: MapPanelProps) {
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const collapsedHostRef = useRef<HTMLDivElement | null>(null)
  const expandedHostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const districtLayerRef = useRef<L.GeoJSON | null>(null)
  const hotspotLayerRef = useRef<L.LayerGroup | null>(null)
  const rendererRef = useRef<L.Canvas | null>(null)

  const [expanded, setExpanded] = useState(initialExpanded ?? false)
  const [viewMode, setViewMode] = useState<ViewMode>('both')
  const [hotspots, setHotspots] = useState<(HotspotDataset | null)[] | null>(null)
  const [hotspotsLoading, setHotspotsLoading] = useState(false)
  const [hotspotsError, setHotspotsError] = useState(false)
  const [selectedHotspot, setSelectedHotspot] = useState<HotspotRecord | null>(null)
  const [infoOpen, setInfoOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  const showHotspots = viewMode === 'hotspots' || viewMode === 'both'
  const markerFamily = useMemo(() => markerPlatforms(layer), [layer])

  const featureCollection = useMemo(() => {
    const features = studyAreas
      .map((s) => getDistrictFeature(s.id))
      .filter((f): f is NonNullable<ReturnType<typeof getDistrictFeature>> => Boolean(f))
    return { type: 'FeatureCollection' as const, features }
  }, [])

  // Latest callbacks/state in refs so Leaflet handlers never go stale.
  const selectRef = useRef(onSelectDistrict)
  selectRef.current = onSelectDistrict
  const areaRef = useRef(area)
  areaRef.current = area
  const layerRef = useRef(layer)
  layerRef.current = layer
  const summariesRef = useRef(districtSummaries)
  summariesRef.current = districtSummaries
  const hotspotSelectRef = useRef<(r: HotspotRecord) => void>(() => {})
  hotspotSelectRef.current = setSelectedHotspot

  // ---- search (real: matches district name, province, p-code) ----
  const query = searchQuery.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!query) return []
    return studyAreas.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.province.toLowerCase().includes(query) ||
        s.pcode.toLowerCase().includes(query),
    )
  }, [query])

  const selectDistrict = (id: string) => {
    onSelectDistrict(id)
    setSearchQuery('')
    setSearchFocused(false)
  }

  // ---- Initialize Leaflet once (container starts in the collapsed host) ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      scrollWheelZoom: false,
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

  // ---- Move the Leaflet container between hosts on expand/collapse ----
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const target = expanded ? expandedHostRef.current : collapsedHostRef.current
    if (target && node.parentElement !== target) {
      target.appendChild(node)
    }
    // invalidateSize alone does not repaint canvas layers: the Canvas
    // renderer only redraws on moveend, which never fires when the center is
    // unchanged. A same-view setView forces the full resize + repaint.
    const invalidate = () => {
      const map = mapRef.current
      if (!map) return
      map.invalidateSize({ pan: false })
      map.setView(map.getCenter(), map.getZoom(), { animate: false })
    }
    const raf = requestAnimationFrame(() => invalidate())
    const t1 = window.setTimeout(invalidate, 260)
    const t2 = window.setTimeout(invalidate, 700)
    // The container changes width whenever it is re-parented or the viewport
    // changes; Leaflet only re-measures when told to, so watch it directly.
    let resizeFrame = 0
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame)
            resizeFrame = requestAnimationFrame(invalidate)
          })
    observer?.observe(node)
    if (!expanded) {
      return () => {
        cancelAnimationFrame(raf)
        cancelAnimationFrame(resizeFrame)
        observer?.disconnect()
        window.clearTimeout(t1)
        window.clearTimeout(t2)
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
      cancelAnimationFrame(resizeFrame)
      observer?.disconnect()
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      requestAnimationFrame(() => invalidate())
      window.setTimeout(invalidate, 300)
    }
  }, [expanded])

  // ---- District polygons + choropleth ----
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
          layerRef.current,
        ),
      onEachFeature: (feature, layerInstance) => {
        const props = feature.properties as { id: string; name: string }
        layerInstance.bindTooltip(
          `<strong>${props.name}</strong><br/>${props.id === areaRef.current.id ? 'Currently selected' : 'Click to select'}`,
          { sticky: true, className: 'agnidrishti-tooltip' },
        )
      },
    }).addTo(map)
    districtLayerRef.current = layer
  }, [featureCollection])

  useEffect(() => {
    districtLayerRef.current?.setStyle((feature) =>
      districtStyle(
        (feature?.properties as { id: string } | undefined)?.id ?? '',
        districtSummaries,
        area.id,
        layer,
      ),
    )
  }, [area.id, districtSummaries, layer])

  // ---- District selection via map click (canvas sits above the SVG paths) ----
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onClick = (event: L.LeafletMouseEvent) => {
      for (const feature of featureCollection.features) {
        if (pointInDistrict(event.latlng.lat, event.latlng.lng, feature.geometry)) {
          const id = (feature.properties as { id: string }).id
          if (studyAreas.some((s) => s.id === id)) {
            selectRef.current(id as string)
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

  // ---- Fit helpers ----
  const fitBoundsOf = (features: typeof featureCollection.features) => {
    const map = mapRef.current
    if (!map || features.length === 0) return
    const bounds = L.geoJSON({
      type: 'FeatureCollection',
      features: features as unknown as GeoJSON.Feature[],
    } as unknown as GeoJSON.GeoJsonObject).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [18, 18], maxZoom: 10, animate: !reduceMotion })
    }
  }
  const fitToDistrict = () => {
    fitBoundsOf(featureCollection.features.filter((f) => f.properties.id === area.id))
  }
  const fitAllDistricts = () => {
    fitBoundsOf(featureCollection.features)
  }
  const resetView = () => {
    const map = mapRef.current
    if (!map) return
    const target = featureCollection.features.find((f) => f.properties.id === area.id)
    const bounds = target
      ? L.geoJSON(target as unknown as GeoJSON.GeoJsonObject).getBounds()
      : null
    if (bounds?.isValid()) {
      map.setView(bounds.getCenter(), 9, { animate: !reduceMotion })
    } else {
      fitToDistrict()
    }
  }

  const zoom = (delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.setZoom(map.getZoom() + delta)
  }

  // ---- Start on an all-six overview; zoom to an area after a selection ----
  const hasFittedOverviewRef = useRef(false)
  useEffect(() => {
    if (hasFittedOverviewRef.current) {
      fitToDistrict()
      return
    }
    // The card can mount before Leaflet measures the host. Fitting at that
    // moment produces a wildly zoomed view, so retry until the host has size.
    const attemptOverview = () => {
      const map = mapRef.current
      const host = containerRef.current
      if (!map || !host) return
      // getSize() can be a stale cache from the first layout pass; measure the
      // host directly and refresh Leaflet before computing the fit.
      const rect = host.getBoundingClientRect()
      if (rect.width < 80 || rect.height < 80) return
      map.invalidateSize({ pan: false })
      fitAllDistricts()
      hasFittedOverviewRef.current = true
    }
    attemptOverview()
    const t1 = window.setTimeout(attemptOverview, 350)
    const t2 = window.setTimeout(attemptOverview, 1000)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.id])

  // ---- Point-level detections: loaded only when the hotspot layer is active ----
  useEffect(() => {
    if (!showHotspots || !year) {
      setHotspots(null)
      setHotspotsError(false)
      return
    }
    const controller = new AbortController()
    setHotspotsLoading(true)
    setHotspotsError(false)
    loadHotspots(provider, year, [area.id], controller.signal)
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
  }, [showHotspots, provider, year, area.id])

  // ---- Hotspot markers ----
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
        const color = PLATFORM_COLORS[record.platform] ?? palette.amber.DEFAULT
        const baseRadius = markerRadius(record.frp)
        const marker = L.circleMarker([record.latitude, record.longitude], {
          renderer,
          radius: baseRadius,
          color: withAlpha(palette.ink[950], 0.55),
          weight: 1,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: 0.82,
        })
        // Zoom-aware sizing: shrink dots when zoomed out so 18k overlapping
        // detections read as a density field, grow them when zoomed in so
        // individual markers distinguish. Canvas redraw is batched.
        ;(marker as unknown as { _baseRadius: number })._baseRadius = baseRadius
        marker.on('click', () => hotspotSelectRef.current(record))
        marker.bindPopup(popupHtml(record), {
          className: 'agnidrishti-leaflet-popup',
          maxWidth: 250,
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

    const rescale = () => {
      const z = map.getZoom()
      const scale = Math.max(0.55, Math.min(1.15, z / 10))
      group.eachLayer((layer) => {
        const m = layer as L.CircleMarker & { _baseRadius?: number }
        if (m._baseRadius) m.setStyle({ radius: Math.max(1.6, m._baseRadius * scale) })
      })
    }
    rescale()
    map.on('zoomend', rescale)
    group.on('remove', () => map.off('zoomend', rescale))
  }, [showHotspots, hotspots, markerFamily, layer])

  const summaryForSelected = districtSummaries?.find((s) => s?.districtId === area.id) ?? null

  // Legend counts describe the markers actually drawn for the active layer,
  // while `total` is the full per-family count from the export. The two differ
  // when a large region-year was capped for map legibility.
  const platformLegend = useMemo(() => {
    if (!hotspots) return null
    const counts: Record<string, number> = {}
    let plotted = 0
    let total = 0
    for (const dataset of hotspots) {
      if (!dataset) continue
      for (const record of dataset.records) {
        if (!markerFamily.includes(record.platform)) continue
        counts[record.platform] = (counts[record.platform] ?? 0) + 1
        plotted += 1
      }
      for (const [platform, count] of Object.entries(dataset.platformCounts)) {
        if (!markerFamily.includes(platform)) continue
        total += count
      }
    }
    return { counts, plotted, total }
  }, [hotspots, markerFamily])

  const hotspotDisplay = platformLegend
    ? {
        shown: platformLegend.plotted,
        total: platformLegend.total,
        capped: platformLegend.plotted < platformLegend.total,
      }
    : null

  const displayedHotspotCount =
    viewMode === 'district' ? null : (hotspotDisplay?.shown ?? platformLegend?.total ?? null)

  const layerExplanation =
    viewMode === 'district'
      ? `Area fill intensity aggregates the ${layerLabel} total per study area for ${year ?? 'the selected year'} (${provider === 'sp' ? 'Standard Processing' : 'Near Real-Time'}). No hotspot markers are shown in this mode.`
      : viewMode === 'hotspots'
        ? 'Each dot is one verified NASA FIRMS hotspot detection, coloured by platform and sized by FRP. A detection is not a unique fire.'
        : 'Area fill intensity aggregates activity per study area; the dots are the underlying verified detections. On the harmonized layer the dots are the raw MODIS observations feeding the provisional estimate — harmonized values are never drawn as observed hotspots.'

  // ---- Floating control group ----
  const controlGroup = (
    <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-sand/[0.16] bg-ink-950/75 shadow-instrument-sm backdrop-blur-md">
      {[
        { label: 'Zoom map in', icon: <Plus size={15} strokeWidth={1.8} />, action: () => zoom(1) },
        { label: 'Zoom map out', icon: <Minus size={15} strokeWidth={1.8} />, action: () => zoom(-1) },
        { label: 'Reset to default view', icon: <Crosshair size={14} strokeWidth={1.8} />, action: resetView },
        { label: 'Fit all study areas', icon: <Layers size={14} strokeWidth={1.8} />, action: fitAllDistricts },
        { label: 'Fit map to selected area', icon: <Focus size={14} strokeWidth={1.8} />, action: fitToDistrict },
        { label: 'Collapse map', icon: <Minimize2 size={14} strokeWidth={1.8} />, action: () => setExpanded(false) },
      ].map((item, index) => (
        <button
          key={item.label}
          type="button"
          onClick={item.action}
          aria-label={item.label}
          title={item.label}
          className={`flex h-9 w-9 items-center justify-center text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone ${
            index > 0 ? 'border-t border-sand/[0.12]' : ''
          }`}
        >
          {item.icon}
        </button>
      ))}
    </div>
  )

  // ---- Layer-mode segmented control ----
  const layerModeControl = (
    <div
      className="flex gap-1 rounded-xl border border-sand/[0.14] bg-ink-950/60 p-1 backdrop-blur-md"
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
            className={`rounded-lg px-3 py-1 text-meta font-medium transition-[background-color,box-shadow,color] ${
              active
                ? 'state-selected text-bone'
                : 'text-ash-light hover:bg-sand/[0.06] hover:text-bone'
            }`}
          >
            {mode.label}
          </button>
        )
      })}
    </div>
  )

  // ---- Legend (expanded) ----
  const expandedLegend = (
    <div className="pointer-events-none max-w-[240px] rounded-xl border border-sand/[0.14] bg-ink-950/80 px-3 py-2.5 shadow-instrument-sm backdrop-blur-md">
      <p className="font-mono text-support tracking-[0.02em] text-ash-light">
        {layerLabel} · {provider === 'sp' ? 'SP' : 'NRT'} · {year ?? '—'}
      </p>
      {(viewMode === 'district' || viewMode === 'both') && (
        <div className="mt-1.5 flex items-center gap-1.5">
          {[0.1, 0.35, 0.6, 0.8].map((a) => (
            <span
              key={a}
              className="h-2.5 w-5 border border-sand/10"
              style={{ background: withAlpha(SIGNAL_COLORS[layer] ?? palette.amber.DEFAULT, a) }}
              aria-hidden="true"
            />
          ))}
          <span className="whitespace-nowrap font-mono text-support tracking-[0.02em] text-ash-dark">
            study-area total
          </span>
        </div>
      )}
      {(viewMode === 'hotspots' || viewMode === 'both') && (
        <div className="mt-1.5">
          {hotspotsLoading ? (
            <p className="font-mono text-support tracking-[0.02em] text-ash-dark">loading detections…</p>
          ) : platformLegend && platformLegend.plotted > 0 ? (
            <div className="space-y-1">
              {markerFamily
                .filter((p) => (platformLegend.counts[p] ?? 0) > 0)
                .map((p) => (
                  <div key={p} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full border border-ink/60"
                      style={{ background: PLATFORM_COLORS[p] ?? palette.amber.DEFAULT }}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-support tracking-[0.02em] text-ash-light">
                      {p} · {(platformLegend.counts[p] ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              <p className="font-mono text-support tracking-[0.02em] text-ash-dark">
                dot size = FRP · detections, not fires
              </p>
              {hotspotDisplay?.capped && (
                <p className="font-mono text-support leading-relaxed tracking-[0.02em] text-ash-dark">
                  {hotspotDisplay.shown.toLocaleString()} of{' '}
                  {hotspotDisplay.total.toLocaleString()} shown · highest FRP (map legibility)
                </p>
              )}
            </div>
          ) : (
            <p className="font-mono text-support leading-relaxed tracking-[0.02em] text-ash-dark">
              {hotspotsError
                ? 'point records unavailable'
                : platformLegend && platformLegend.total > 0
                  ? `no ${layerLabel} detections in the capped map display`
                  : 'no point records for this selection'}
            </p>
          )}
        </div>
      )}
      {layer === 'harmonized' && (viewMode === 'hotspots' || viewMode === 'both') && (
        <p className="mt-1 font-mono text-support tracking-[0.02em] text-ash-dark">
          markers = raw MODIS inputs to the estimate
        </p>
      )}
    </div>
  )

  // ---- Bottom info panel (expanded) ----
  const coverageText = summaryForSelected
    ? `${summaryForSelected.weeksWithDetections}/${summaryForSelected.weekCells.length} covered weeks with detections · ${summaryForSelected.observedWeeks} weeks observed`
    : 'No aggregated coverage for this selection yet'

  const bottomPanel = (
    <div className="pointer-events-auto mx-2 mb-2 rounded-xl border border-sand/[0.16] bg-ink-950/[0.4] shadow-[0_-6px_24px_rgba(0,0,0,0.45)] backdrop-blur-md sm:mx-3 sm:mb-3">
      <button
        type="button"
        onClick={() => setInfoOpen((v) => !v)}
        aria-expanded={infoOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="text-support font-medium text-bone">{area.name}</span>
          <span className="font-mono text-support tracking-[0.02em] text-ash-dark">
            {year ?? '—'} · {provider === 'sp' ? 'SP' : 'NRT'} · {layerLabel}
          </span>
          {displayedHotspotCount !== null && (
            <span className="font-mono text-support tracking-[0.02em] text-ember">
              {hotspotDisplay?.capped
                ? `${hotspotDisplay.shown.toLocaleString()} of ${hotspotDisplay.total.toLocaleString()} hotspots shown`
                : `${displayedHotspotCount.toLocaleString()} hotspots shown`}
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-support tracking-[0.02em] text-ash-light">
          {infoOpen ? 'Hide details ▾' : 'Details ▴'}
        </span>
      </button>
      {infoOpen && (
        <div className="max-h-[36vh] overflow-y-auto border-t border-sand/[0.1] px-4 py-3">
          {selectedHotspot && (
            <div className="mb-3 rounded-lg border border-ember/30 bg-ember/[0.06] px-3 py-2.5">
              <p className="font-mono text-support tracking-[0.02em] text-ember">
                Selected hotspot · NASA FIRMS
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {[
                  ['Platform', selectedHotspot.platform],
                  ['Acquired (UTC)', `${selectedHotspot.acqDate} ${selectedHotspot.acqTime ?? ''}`],
                  ['Coordinates', `${selectedHotspot.latitude.toFixed(4)}, ${selectedHotspot.longitude.toFixed(4)}`],
                  ['Brightness (K)', selectedHotspot.brightness.toFixed(1)],
                  ['FRP (MW)', selectedHotspot.frp !== null ? selectedHotspot.frp.toFixed(1) : null],
                  ['Confidence', selectedHotspot.confidence !== null ? String(selectedHotspot.confidence) : null],
                  ['Pass', selectedHotspot.daynight === 'D' ? 'Day' : selectedHotspot.daynight === 'N' ? 'Night' : null],
                  ['Study area', selectedHotspot.districtId],
                ]
                  .filter(([, v]) => v !== null)
                  .map(([label, value]) => (
                    <div key={label as string}>
                      <p className="font-mono text-support tracking-[0.02em] text-ash-dark">{label}</p>
                      <p className="text-meta text-bone">{value}</p>
                    </div>
                  ))}
              </div>
              <p className="mt-2 text-support leading-relaxed text-ash-dark">
                One hotspot detection — not a unique fire. Source: NASA FIRMS.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="font-mono text-support tracking-[0.02em] text-ash-dark">Coverage</p>
              <p className="mt-1 text-support leading-relaxed text-ash-light">{coverageText}</p>
            </div>
            <div>
              <p className="font-mono text-support tracking-[0.02em] text-ash-dark">Active layer</p>
              <p className="mt-1 text-support leading-relaxed text-ash-light">
                {viewModes.find((m) => m.id === viewMode)?.label} · {layerLabel}
              </p>
            </div>
            <div>
              <p className="font-mono text-support tracking-[0.02em] text-ash-dark">Boundaries</p>
              <p className="mt-1 text-support leading-relaxed text-ash-dark">
                {studyAreaBoundarySources.map((src) => `${src.source} (${src.license}, ${src.boundaryYear})`).join('; ')} · Tiles © OpenStreetMap
              </p>
            </div>
          </div>
          <p className="mt-3 text-support leading-relaxed text-ash">{layerExplanation}</p>
          <p className="mt-1.5 text-support leading-relaxed text-ash-dark">
            Missing observations are never treated as zero; August–December were not requested in the
            historical acquisition. Detections are hotspot observations, not unique fires.
          </p>
        </div>
      )}
    </div>
  )

  // ---- Expanded overlay (portal to body; the Leaflet container is moved in) ----
  const expandedOverlay = expanded
    ? createPortal(
          <div className="fixed inset-0 z-[1200] flex flex-col bg-ink map-panel-expanded">
            {/* Map host — the Leaflet container is moved in here */}
            <div ref={expandedHostRef} className="absolute inset-0 overflow-hidden" />

            {/* Floating top bar */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[1100] p-2 sm:p-3">
              <div className="instrument-bar pointer-events-auto mx-auto flex max-w-[1300px] flex-wrap items-center gap-2 rounded-2xl px-3 py-2">
                <div className="flex items-center gap-2 pr-1">
                  <LogoMark className="h-6 w-6 text-sand" />
                  <span className="hidden font-display text-body leading-none text-bone sm:inline">
                    Agnidrishti <span className="text-ash-dark">· map</span>
                  </span>
                </div>

                {/* Search */}
                <div className="relative min-w-[150px] flex-1 sm:max-w-[240px]">
                  <Search
                    size={14}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ash-dark"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && searchQuery) {
                        e.stopPropagation()
                        setSearchQuery('')
                      }
                      if (e.key === 'Enter' && searchResults.length > 0) {
                        selectDistrict(searchResults[0].id)
                      }
                    }}
                    placeholder="Search study area"
                    aria-label="Search study area or province"
                    className="h-8 w-full rounded-lg border border-sand/[0.16] bg-ink-900 pl-8 pr-3 text-support text-bone placeholder:text-ash-dark focus:border-ember/60 focus:outline-none"
                  />
                  {searchFocused && query.length > 0 && (
                    <div className="absolute left-0 right-0 top-[36px] overflow-hidden rounded-lg border border-sand/[0.16] bg-ink-950/[0.7] shadow-xl backdrop-blur-md">
                      {searchResults.length > 0 ? (
                        searchResults.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onMouseDown={() => selectDistrict(s.id)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-sand/[0.07]"
                          >
                            <span>
                              <span className="block text-support text-bone">{s.name}</span>
                              <span className="block font-mono text-support tracking-[0.02em] text-ash-dark">
                                {s.province} · {s.pcode}
                              </span>
                            </span>
                            <span className="font-mono text-support tracking-[0.02em] text-ember">
                              select
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2.5 text-meta text-ash-dark">
                          No study area matches “{searchQuery}”. The map covers six study areas in
                          Nepal, Thailand, Indonesia and Myanmar.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Year + provider */}
                <div className="flex items-center gap-1.5">
                  <label className="sr-only" htmlFor="map-year-expanded">
                    Year
                  </label>
                  <select
                    id="map-year-expanded"
                    value={year ?? ''}
                    onChange={(e) => onYearChange(e.target.value)}
                    className="h-8 rounded-lg border border-sand/[0.16] bg-ink-900 px-2 font-mono text-meta text-bone focus:border-ember/60 focus:outline-none"
                    aria-label="Year"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="map-provider-expanded">
                    Processing type
                  </label>
                  <select
                    id="map-provider-expanded"
                    value={provider}
                    onChange={(e) => onProviderChange(e.target.value as ProviderId)}
                    className="h-8 rounded-lg border border-sand/[0.16] bg-ink-900 px-2 font-mono text-meta text-bone focus:border-ember/60 focus:outline-none"
                    aria-label="Processing type"
                  >
                    <option value="sp">SP</option>
                    <option value="nrt">NRT</option>
                  </select>
                </div>

                {layerModeControl}

                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Exit expanded map"
                  title="Exit expanded map (Esc)"
                  className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sand/[0.16] bg-ink-950/60 text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone"
                >
                  <X size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>

            {/* Right floating control group (lower on mobile: the top bar wraps) */}
            <div className="absolute right-2 top-[118px] z-[1100] sm:right-3 sm:top-[74px]">
              {controlGroup}
            </div>

            {/* District quick-select chips */}
            <div className="absolute left-2 top-[118px] z-[1100] flex flex-col gap-1.5 sm:left-3 sm:top-[74px]">
              {studyAreas.map((s) => {
                const active = s.id === area.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectDistrict(s.id)}
                    className={`pointer-events-auto rounded-full border px-3 py-1 text-left text-meta font-medium shadow-md backdrop-blur-md transition-[background-color,color,border-color] ${
                      active
                        ? 'border-bone/50 bg-ink-950/85 text-bone'
                        : 'border-sand/[0.16] bg-ink-950/80 text-ash-light hover:border-sand/30 hover:text-bone'
                    }`}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>

            {/* Legend and attribution stack above the info panel, so the panel can
                expand without covering them. */}
            <div className="absolute inset-x-0 bottom-0 z-[1100]">
              <div className="mx-2 mb-2 flex items-end justify-between gap-3 sm:mx-3 sm:mb-3">
                <div className="pointer-events-none hidden max-w-[240px] sm:block">
                  {expandedLegend}
                </div>
                <div className="pointer-events-none ml-auto hidden rounded bg-ink-950/80 px-2 py-0.5 font-mono text-meta text-ash-dark sm:block">
                  ©{' '}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                    className="pointer-events-auto underline decoration-sand/30"
                  >
                    OpenStreetMap
                  </a>{' '}
                  contributors · OCHA COD-AB · geoBoundaries
                </div>
              </div>
              {bottomPanel}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <section aria-labelledby="map-heading" className="card overflow-hidden">
      {expandedOverlay}
      <div className="flex items-start justify-between gap-4 border-b border-sand/[0.08] px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="eyebrow text-ash">Selected study area</p>
          <h2 id="map-heading" className="mt-2 font-display text-xl text-bone">
            {area.name} {area.adminLevelLabel.toLowerCase()}
          </h2>
          <p className="mt-1 font-mono text-meta tracking-[0.03em] text-ash-dark">
            {area.province} · {area.pcode}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge tone="neutral">Geographic view</StatusBadge>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={expanded}
            aria-label="Expand map to full screen"
            title="Expand to full screen"
            className="flex items-center gap-1.5 rounded-full border border-sand/[0.14] bg-ink-950/60 px-3 py-1.5 text-meta font-medium text-ash-light transition-[background-color,color,border-color] hover:border-observation/35 hover:bg-observation/[0.07] hover:text-bone"
          >
            <Maximize2 size={12} strokeWidth={1.7} />
            Expand
          </button>
        </div>
      </div>

      <div className="border-b border-sand/[0.08] bg-ink-900/60 px-4 py-2.5 sm:px-5">
        <div
          className="flex gap-1 rounded-xl border border-sand/[0.1] bg-ink-950/40 p-1"
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
                className={`min-h-[32px] flex-1 whitespace-nowrap rounded-lg px-3 text-meta transition-[background-color,box-shadow,color] duration-200 ${
                  active
                    ? 'state-selected text-bone'
                    : 'text-ash-light hover:bg-sand/[0.05] hover:text-bone'
                }`}
              >
                {mode.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Collapsed map host — the Leaflet container lives here when not expanded */}
      <div className="relative">
        <div ref={collapsedHostRef} className="relative h-[380px] w-full overflow-hidden sm:h-[420px] lg:h-[440px] xl:h-[480px]">
          <div
            ref={containerRef}
            role="application"
            aria-label={`Geographic map of the six study areas. ${area.name} ${area.adminLevelLabel.toLowerCase()} is highlighted. Area fill intensity shows the ${layerLabel} total for ${year ?? 'the selected year'}; fire hotspot markers show real NASA FIRMS detections when the Hotspots layer is active. OpenStreetMap tiles; OCHA COD-AB and geoBoundaries boundaries.`}
            className="map-surface absolute inset-0 w-full"
          />
        </div>
        {expanded && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/85 px-6 text-center">
            <p className="text-support leading-relaxed text-ash">
              The map is open in expanded mode. Use{' '}
              <span className="text-bone">Exit</span> in the top bar (or press Esc) to return here —
              your area, year, provider and layer selection is preserved.
            </p>
          </div>
        )}

        {/* District quick-select chips */}
        <div className="absolute left-3 top-3 z-[500] flex flex-col gap-1">
          {studyAreas.map((s) => {
            const active = s.id === area.id
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectDistrict(s.id)}
                className={`rounded-full border px-3 py-1 text-left text-meta font-medium backdrop-blur-[2px] transition-[background-color,color,border-color] ${
                  active
                    ? 'border-bone/50 bg-ink-950/85 text-bone'
                    : 'border-sand/[0.14] bg-ink-950/70 text-ash-light hover:border-sand/30 hover:text-bone'
                }`}
              >
                {s.name}
              </button>
            )
          })}
        </div>

        {/* Zoom controls */}
        <div className="absolute right-3 top-3 z-[500] flex flex-col overflow-hidden rounded-xl border border-sand/[0.16] bg-ink-950/[0.2] shadow-md backdrop-blur-md">
          <button
            type="button"
            onClick={() => zoom(1)}
            aria-label="Zoom map in"
            className="flex h-9 w-9 items-center justify-center text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone"
          >
            <Plus size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => zoom(-1)}
            aria-label="Zoom map out"
            className="flex h-9 w-9 items-center justify-center border-t border-sand/[0.12] text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone"
          >
            <Minus size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={fitToDistrict}
            aria-label="Fit map to selected area"
            title="Fit map to selected area"
            className="flex h-9 w-9 items-center justify-center border-t border-sand/[0.12] text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone"
          >
            <Focus size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={expanded}
            aria-label="Expand map"
            title="Expand map to full screen"
            className="flex h-9 w-9 items-center justify-center border-t border-sand/[0.12] text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone"
          >
            <Maximize2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Legend — kept below the map so the minimized view stays unobstructed. */}
      <div className="border-t border-sand/[0.08] bg-ink-900/60 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="font-mono text-support tracking-[0.02em] text-ash-light">
            {layerLabel} · {provider === 'sp' ? 'SP' : 'NRT'} · {year ?? '—'}
          </p>
          {(viewMode === 'district' || viewMode === 'both') && (
            <div className="flex items-center gap-1.5">
              {[0.1, 0.35, 0.6, 0.8].map((a) => (
                <span
                  key={a}
                  className="h-2.5 w-5 border border-sand/10"
                  style={{ background: withAlpha(SIGNAL_COLORS[layer] ?? palette.amber.DEFAULT, a) }}
                  aria-hidden="true"
                />
              ))}
              <span className="ml-1 font-mono text-support tracking-[0.02em] text-ash-dark">
                study-area total
              </span>
            </div>
          )}
          {(viewMode === 'hotspots' || viewMode === 'both') && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {hotspotsLoading ? (
                <span className="font-mono text-support tracking-[0.02em] text-ash-dark">
                  loading detections…
                </span>
              ) : platformLegend && platformLegend.plotted > 0 ? (
                markerFamily
                  .filter((p) => (platformLegend.counts[p] ?? 0) > 0)
                  .map((p) => (
                    <span key={p} className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-ink/60"
                        style={{ background: PLATFORM_COLORS[p] ?? palette.amber.DEFAULT }}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-support tracking-[0.02em] text-ash-light">
                        {p} · {(platformLegend.counts[p] ?? 0).toLocaleString()}
                      </span>
                    </span>
                  ))
              ) : (
                <span className="font-mono text-support leading-relaxed tracking-[0.02em] text-ash-dark">
                  {hotspotsError
                    ? 'point records unavailable'
                    : platformLegend && platformLegend.total > 0
                      ? `no ${layerLabel} detections in the capped map display`
                      : 'no point records for this selection'}
                </span>
              )}
              {hotspotDisplay?.capped && (hotspotDisplay.shown > 0) && (
                <span className="w-full font-mono text-support leading-relaxed tracking-[0.02em] text-ash-dark">
                  {hotspotDisplay.shown.toLocaleString()} of{' '}
                  {hotspotDisplay.total.toLocaleString()} plotted · highest FRP, for legibility
                </span>
              )}
            </div>
          )}
        </div>
        <p className="mt-1.5 font-mono text-support leading-relaxed tracking-[0.02em] text-ash-dark">
          {viewMode === 'hotspots' || viewMode === 'both'
            ? 'Dot size = FRP · detections, not fires'
            : 'Area fill intensity aggregates activity per study area'}
          {layer === 'harmonized' && viewMode !== 'district'
            ? ' · markers are the raw MODIS inputs to the estimate'
            : ''}
        </p>
      </div>

      <div className="space-y-1.5 border-t border-sand/[0.08] px-5 py-4 sm:px-6">
        <p className="text-support leading-relaxed text-ash">
          {viewMode !== 'district' && (
            <>
              <span className="text-ash-light">Hotspot markers</span> are real NASA FIRMS detections
              with verified coordinates — one dot per detection, coloured by platform, sized by FRP.
              A detection is <span className="text-ash-light">not a unique fire</span>.{' '}
            </>
          )}
          {viewMode !== 'hotspots' && (
            <>
              <span className="text-ash-light">Fill intensity</span> shows each study area's aggregated{' '}
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
        <p className="text-support leading-relaxed text-ash-dark">
          Boundary geometry: {studyAreaBoundarySources.map((src) => `${src.source} (${src.license}, ${src.boundaryYear})`).join('; ')}. Tiles © OpenStreetMap contributors. Expand for
          the full-screen map with search, hotspot details and the information panel.
        </p>
      </div>
    </section>
  )
}
