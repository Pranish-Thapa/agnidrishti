import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { getDistrictFeature } from '../../lib/geo'
import { palette, withAlpha } from '../../lib/palette'
import { PLATFORM_COLORS } from '../../lib/points'
import { LogoMark } from '../ui/LogoMark'
import {
  FWI_CATEGORY_COLORS,
  FWI_CATEGORY_LABELS,
  type CommunityData,
  type FwiCategory,
} from '../../lib/community'
import type { StudyArea } from '../../lib/regions'

type CommunityMapProps = {
  selectedDistrict: string
  onSelectDistrict: (id: string) => void
  communityByDistrict: Record<string, CommunityData | null>
  areas: readonly StudyArea[]
  /** Only Nepal has a validated fire-danger model; other regions hide the layer. */
  dangerAvailable?: boolean
}

type CommunityLayer = 'historical' | 'recent' | 'danger'

const MAX_ZOOM = 15
const MIN_ZOOM = 3

const LAYERS: Array<{
  id: CommunityLayer
  label: string
  description: string
}> = [
  {
    id: 'historical',
    label: 'Where fires happen',
    description:
      'Districts shaded by how often hotspots were observed in their peak historical month.',
  },
  {
    id: 'recent',
    label: 'Recent detections',
    description:
      'Verified satellite hotspot detections from the last 7 days. Each dot is one observation, not a confirmed fire.',
  },
  {
    id: 'danger',
    label: 'Fire danger today',
    description:
      'Current weather-driven fire danger. This describes how easily a fire could spread, not where one will start.',
  },
]

type HistoricalMetric = {
  rate: number
  monthLabel: string
  years: number
}

function fwiCategoryOf(data: CommunityData | null): FwiCategory | null {
  const cat = data?.fwi?.current?.fwi_category
  return (cat as FwiCategory) ?? null
}

function historicalMetricOf(data: CommunityData | null): HistoricalMetric | null {
  const peak = data?.historical.peak_month
  if (!peak || peak.snpp_detections_per_observed_day === null) return null
  return {
    rate: peak.snpp_detections_per_observed_day,
    monthLabel: peak.label,
    years: peak.years_supporting,
  }
}

function historicalIntensity(
  districtId: string,
  communityByDistrict: Record<string, CommunityData | null>,
  areas: readonly StudyArea[],
): number | null {
  const values = areas
    .map((area) => historicalMetricOf(communityByDistrict[area.id] ?? null))
    .filter((metric): metric is HistoricalMetric => metric !== null)
    .map((metric) => metric.rate)
  const metric = historicalMetricOf(communityByDistrict[districtId] ?? null)
  if (!metric || values.length === 0) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return 0.55
  return (metric.rate - min) / (max - min)
}

function districtStyle(
  districtId: string,
  communityByDistrict: Record<string, CommunityData | null>,
  selectedId: string,
  layer: CommunityLayer,
  areas: readonly StudyArea[],
): L.PathOptions {
  const selected = districtId === selectedId

  if (layer === 'historical') {
    const intensity = historicalIntensity(districtId, communityByDistrict, areas)
    return {
      color: selected ? palette.bone : withAlpha(palette.amber.DEFAULT, 0.55),
      weight: selected ? 3 : 1.5,
      fillColor: withAlpha(palette.amber.DEFAULT, 1),
      fillOpacity:
        intensity === null ? 0.05 : 0.16 + 0.58 * Math.max(0, Math.min(1, intensity)),
    }
  }

  if (layer === 'danger') {
    const category = fwiCategoryOf(communityByDistrict[districtId] ?? null)
    if (!category) {
      return {
        color: withAlpha(palette.sand, selected ? 0.7 : 0.25),
        weight: selected ? 3 : 1.5,
        fillColor: withAlpha(palette.sand, 0.05),
        fillOpacity: 0.4,
      }
    }
    const color = FWI_CATEGORY_COLORS[category]
    return {
      color: selected ? palette.bone : withAlpha(color, 0.85),
      weight: selected ? 3 : 1.5,
      fillColor: withAlpha(color, 1),
      fillOpacity: 0.38,
    }
  }

  return {
    color: selected ? palette.bone : withAlpha(palette.sand, 0.34),
    weight: selected ? 3 : 1.4,
    fillColor: withAlpha(palette.sand, 0.04),
    fillOpacity: 0.35,
  }
}

export function CommunityMap({
  selectedDistrict,
  onSelectDistrict,
  communityByDistrict,
  areas,
  dangerAvailable = true,
}: CommunityMapProps) {
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inlineHostRef = useRef<HTMLDivElement | null>(null)
  const expandedHostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const districtLayerRef = useRef<L.GeoJSON | null>(null)
  const hotspotLayerRef = useRef<L.LayerGroup | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [layer, setLayer] = useState<CommunityLayer>('historical')
  const availableLayers = useMemo(
    () => (dangerAvailable ? LAYERS : LAYERS.filter((item) => item.id !== 'danger')),
    [dangerAvailable],
  )

  useEffect(() => {
    if (!dangerAvailable && layer === 'danger') setLayer('historical')
  }, [dangerAvailable, layer])

  const selectRef = useRef(onSelectDistrict)
  selectRef.current = onSelectDistrict
  const communityRef = useRef(communityByDistrict)
  communityRef.current = communityByDistrict
  const selectedRef = useRef(selectedDistrict)
  selectedRef.current = selectedDistrict
  const layerRef = useRef(layer)
  layerRef.current = layer

  const areasRef = useRef(areas)
  areasRef.current = areas
  const features = useMemo(
    () => areas.map((a) => getDistrictFeature(a.id)).filter(Boolean),
    [areas],
  )
  const featureCollection = useMemo(
    () => ({ type: 'FeatureCollection' as const, features }),
    [features],
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      scrollWheelZoom: false,
      doubleClickZoom: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: MAX_ZOOM }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      districtLayerRef.current = null
      hotspotLayerRef.current = null
    }
  }, [])

  // Move container between inline and expanded hosts.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const target = expanded ? expandedHostRef.current : inlineHostRef.current
    if (target && node.parentElement !== target) {
      target.appendChild(node)
    }
    const invalidate = () => {
      const map = mapRef.current
      if (!map) return
      map.invalidateSize({ pan: false })
      map.setView(map.getCenter(), map.getZoom(), { animate: false })
    }
    const raf = requestAnimationFrame(() => invalidate())
    const t1 = window.setTimeout(invalidate, 260)
    const t2 = window.setTimeout(invalidate, 700)
    if (!expanded) {
      return () => {
        cancelAnimationFrame(raf)
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
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      requestAnimationFrame(() => invalidate())
      window.setTimeout(invalidate, 300)
    }
  }, [expanded])

  // District polygons: historical activity, recent detections, or fire danger.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (districtLayerRef.current) {
      districtLayerRef.current.remove()
      districtLayerRef.current = null
    }
    const layerAtBuild = layerRef.current
    const layerInstance = L.geoJSON(featureCollection as unknown as GeoJSON.GeoJsonObject, {
      style: (feature) =>
        districtStyle(
          (feature?.properties as { id: string } | undefined)?.id ?? '',
          communityRef.current,
          selectedRef.current,
          layerRef.current,
          areasRef.current,
        ),
      onEachFeature: (feature, featureLayer) => {
        featureLayer.on('popupopen', () => {
          const props = feature.properties as { id: string; name: string }
          featureLayer.setPopupContent(popupFor(props, layerRef.current))
        })
        featureLayer.bindPopup(popupFor(feature.properties as { id: string; name: string }, layerAtBuild), {
          className: 'agnidrishti-leaflet-popup',
          maxWidth: 280,
        })
        featureLayer.on('click', () => {
          const props = feature.properties as { id: string; name: string }
          if (areasRef.current.some((s) => s.id === props.id)) selectRef.current(props.id)
        })
      },
    }).addTo(map)
    districtLayerRef.current = layerInstance
  }, [featureCollection])

  useEffect(() => {
    districtLayerRef.current?.setStyle((feature) =>
      districtStyle(
        (feature?.properties as { id: string } | undefined)?.id ?? '',
        communityByDistrict,
        selectedDistrict,
        layer,
        areas,
      ),
    )
  }, [selectedDistrict, communityByDistrict, layer, areas])

  function popupFor(
    props: { id: string; name: string },
    activeLayer: CommunityLayer,
  ): string {
    const data = communityRef.current[props.id] ?? null
    if (activeLayer === 'historical') {
      const metric = historicalMetricOf(data)
      return `<div class="agnidrishti-popup">
        <div class="agnidrishti-popup-row"><span>District</span><strong>${props.name}</strong></div>
        ${
          metric
            ? `<div class="agnidrishti-popup-row"><span>Peak month</span><strong>${metric.monthLabel}</strong></div>
               <div class="agnidrishti-popup-row"><span>Observed there</span><strong>${metric.rate.toLocaleString(
                 undefined,
                 { maximumFractionDigits: 1 },
               )}/day</strong></div>
               <div class="agnidrishti-popup-row"><span>Years of record</span><strong>${metric.years}</strong></div>`
            : '<div class="agnidrishti-popup-row"><span>Historical activity</span><strong>no data</strong></div>'
        }
        <p class="agnidrishti-popup-note">District-level summary, not exact fire locations. “Per day” means per observed day.</p>
      </div>`
    }
    if (activeLayer === 'danger') {
      const category = data?.fwi?.current?.fwi_category
      const fwiValue = data?.fwi?.current?.fwi
      return `<div class="agnidrishti-popup">
        <div class="agnidrishti-popup-row"><span>District</span><strong>${props.name}</strong></div>
        ${
          category
            ? `<div class="agnidrishti-popup-row"><span>Fire danger</span><strong>${FWI_CATEGORY_LABELS[
                category as FwiCategory
              ]}</strong></div>`
            : '<div class="agnidrishti-popup-row"><span>Fire danger</span><strong>no data</strong></div>'
        }
        ${
          fwiValue !== null && fwiValue !== undefined
            ? `<div class="agnidrishti-popup-row"><span>Fire Weather Index</span><strong>${fwiValue}</strong></div>`
            : ''
        }
        <p class="agnidrishti-popup-note">Weather-driven index, uncalibrated for this study area. It is not an ignition prediction.</p>
      </div>`
    }
    return `<div class="agnidrishti-popup">
      <div class="agnidrishti-popup-row"><span>District</span><strong>${props.name}</strong></div>
      <div class="agnidrishti-popup-row"><span>Recent hotspots</span><strong>${data?.current_observations.recent_week_detections ?? 'no data'}</strong></div>
      <div class="agnidrishti-popup-row"><span>Active days</span><strong>${data?.current_observations.recent_week_active_days ?? '—'}</strong></div>
      <p class="agnidrishti-popup-note">Verified NASA FIRMS detections from the last 7 days; one dot is one observation, not a unique fire.</p>
    </div>`
  }

  // Recent hotspot markers (verified point observations only).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (hotspotLayerRef.current) {
      hotspotLayerRef.current.remove()
      hotspotLayerRef.current = null
    }
    // Recent markers belong to the activity views. The danger view is a
    // weather-driven surface and must not imply that a dot marks danger.
    if (layer === 'danger') return
    const group = L.layerGroup()
    for (const data of Object.values(communityByDistrict)) {
      if (!data) continue
      for (const record of data.current_observations.recent_week_records) {
        const color = PLATFORM_COLORS[record.platform] ?? palette.amber.DEFAULT
        const marker = L.circleMarker([record.latitude, record.longitude], {
          radius:
            record.frp !== null && record.frp > 0
              ? Math.min(3.5 + 1.15 * Math.sqrt(record.frp), 12)
              : 3.5,
          color: withAlpha(palette.ink[950], 0.6),
          weight: 1.2,
          opacity: 0.95,
          fillColor: color,
          fillOpacity: 0.9,
        })
        marker.bindPopup(
          `<div class="agnidrishti-popup">
            <div class="agnidrishti-popup-row"><span>Platform</span><strong>${record.platform}</strong></div>
            <div class="agnidrishti-popup-row"><span>Observed (UTC)</span><strong>${record.acq_date} ${record.acq_time ?? ''}</strong></div>
            <div class="agnidrishti-popup-row"><span>Coordinates</span><strong>${record.latitude.toFixed(4)}, ${record.longitude.toFixed(4)}</strong></div>
            <div class="agnidrishti-popup-row"><span>Brightness (K)</span><strong>${record.brightness.toFixed(1)}</strong></div>
            ${record.frp !== null ? `<div class="agnidrishti-popup-row"><span>Fire radiative power (MW)</span><strong>${record.frp.toFixed(1)}</strong></div>` : ''}
            ${record.confidence !== null ? `<div class="agnidrishti-popup-row"><span>Confidence</span><strong>${String(record.confidence)}</strong></div>` : ''}
            <div class="agnidrishti-popup-row"><span>District</span><strong>${record.district_id.replace('NP-', '')}</strong></div>
            <p class="agnidrishti-popup-note">One hotspot detection — not a unique fire. Source: NASA FIRMS.</p>
          </div>`,
          { className: 'agnidrishti-leaflet-popup', maxWidth: 280 },
        )
        group.addLayer(marker)
      }
    }
    group.addTo(map)
    hotspotLayerRef.current = group
  }, [communityByDistrict, layer])

  const fitAll = () => {
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

  const fitAllRef = useRef(fitAll)
  fitAllRef.current = fitAll
  useEffect(() => {
    fitAllRef.current()
  }, [])

  const controlGroup = (
    <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-sand/[0.16] bg-ink-950/80 shadow-instrument-sm backdrop-blur-md">
      {[
        {
          label: 'Zoom map in',
          icon: <Plus size={17} strokeWidth={1.8} />,
          action: () => mapRef.current?.setZoom(mapRef.current.getZoom() + 1),
        },
        {
          label: 'Zoom map out',
          icon: <Minus size={17} strokeWidth={1.8} />,
          action: () => mapRef.current?.setZoom(mapRef.current.getZoom() - 1),
        },
        { label: 'Fit all districts', icon: <Maximize2 size={15} strokeWidth={1.8} />, action: fitAll },
      ].map((item, index) => (
        <button
          key={item.label}
          type="button"
          onClick={item.action}
          aria-label={item.label}
          title={item.label}
          className={`flex h-10 w-10 items-center justify-center text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone ${
            index > 0 ? 'border-t border-sand/[0.12]' : ''
          }`}
        >
          {item.icon}
        </button>
      ))}
    </div>
  )

  const activeLayer = availableLayers.find((item) => item.id === layer) ?? availableLayers[0]

  const legend =
    layer === 'historical' ? (
      <div className="pointer-events-none max-w-[280px] rounded-xl border border-sand/[0.16] bg-ink-950/90 px-4 py-3 backdrop-blur-md">
        <p className="text-support font-medium text-bone">Historical fire activity</p>
        <div
          className="mt-2 h-2.5 w-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${withAlpha(palette.amber.DEFAULT, 0.16)}, ${withAlpha(
              palette.amber.DEFAULT,
              0.78,
            )})`,
          }}
          aria-hidden="true"
        />
        <div className="mt-1 flex justify-between text-support text-ash">
          <span>Lower</span>
          <span>Higher</span>
        </div>
        <p className="mt-2 text-support leading-relaxed text-ash">
          Peak-month hotspot detections per observed day, among these study areas. Area totals —
          not exact fire locations.
        </p>
        <p className="mt-2 text-support font-medium text-ash">Recent detections (last 7 days)</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-support text-ash">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: PLATFORM_COLORS.Terra }}
              aria-hidden="true"
            />
            MODIS Terra / Aqua
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: PLATFORM_COLORS['Suomi-NPP'] }}
              aria-hidden="true"
            />
            VIIRS
          </span>
        </div>
        <p className="mt-1.5 text-support text-ash">Bold outline = selected district.</p>
      </div>
    ) : layer === 'danger' ? (
      <div className="pointer-events-none max-w-[300px] rounded-xl border border-sand/[0.16] bg-ink-950/90 px-4 py-3 backdrop-blur-md">
        <p className="text-support font-medium text-bone">Fire danger today</p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {(Object.keys(FWI_CATEGORY_COLORS) as FwiCategory[]).map((cat) => (
            <div key={cat} className="flex flex-col items-center gap-1">
              <span
                className="h-2.5 w-full rounded-sm"
                style={{ background: FWI_CATEGORY_COLORS[cat] }}
                aria-hidden="true"
              />
              <span className="text-support leading-tight text-ash">{FWI_CATEGORY_LABELS[cat]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-support leading-relaxed text-ash">
          Weather-driven index, not an ignition prediction. Uncalibrated for this study area.
        </p>
      </div>
    ) : (
      <div className="pointer-events-none max-w-[290px] rounded-xl border border-sand/[0.16] bg-ink-950/90 px-4 py-3 backdrop-blur-md">
        <p className="text-support font-medium text-bone">Recent detections</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-support text-ash">
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full border border-ink-950/60"
              style={{ background: PLATFORM_COLORS.Terra }}
              aria-hidden="true"
            />
            MODIS Terra / Aqua
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full border border-ink-950/60"
              style={{ background: PLATFORM_COLORS['Suomi-NPP'] }}
              aria-hidden="true"
            />
            VIIRS
          </span>
        </div>
        <p className="mt-1.5 text-support leading-relaxed text-ash">
          NASA FIRMS hotspots from the last 7 days. A dot is one thermal-anomaly observation, not a
          confirmed fire. Dot size follows fire radiative power where available.
        </p>
      </div>
    )

  const expandedOverlay = expanded
    ? createPortal(
        <div className="fixed inset-0 z-[1200] flex flex-col bg-ink map-panel-expanded">
          <div ref={expandedHostRef} className="absolute inset-0 overflow-hidden" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1100] p-2 sm:p-3">
            <div className="instrument-bar pointer-events-auto mx-auto flex max-w-[1300px] flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5">
              <div className="flex items-center gap-2 pr-1">
                <LogoMark className="h-6 w-6 text-sand" />
                <span className="hidden font-display text-base text-bone sm:inline">
                  Community <span className="text-ash">· fire activity map</span>
                </span>
              </div>
              <span className="rounded-full border border-sand/[0.16] bg-ink-900 px-3 py-1 text-meta text-ash-light">
                {activeLayer.label}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Exit expanded map"
                title="Exit expanded map (Esc)"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-sand/[0.16] bg-ink-950/60 text-ash-light transition-colors hover:bg-sand/[0.09] hover:text-bone"
              >
                <X size={17} strokeWidth={1.8} />
              </button>
            </div>
          </div>
          <div className="absolute right-2 top-[74px] z-[1100] sm:right-3 sm:top-[80px]">{controlGroup}</div>
          <div className="pointer-events-none absolute bottom-3 left-2 z-[1100] hidden sm:left-3 sm:block">{legend}</div>
          <div className="pointer-events-none absolute bottom-3 right-2 z-[1100] rounded bg-ink-950/85 px-2 py-1 text-meta text-ash">
            © OpenStreetMap contributors · OCHA COD-AB (HDX) · NASA FIRMS
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <section aria-labelledby="community-map-heading" className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sand/[0.08] px-5 py-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow text-ash">Fire activity map</p>
          <h2 id="community-map-heading" className="mt-2 font-display text-2xl text-bone">
            Where fires are observed
          </h2>
          <p className="mt-2 text-body-sm leading-relaxed text-ash">{activeLayer.description}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand map to full screen"
          className="flex items-center gap-2 rounded-full border border-sand/[0.14] bg-ink-950/60 px-4 py-2 text-support font-medium text-ash-light transition-[background-color,color,border-color] hover:border-observation/35 hover:bg-observation/[0.07] hover:text-bone"
        >
          <Maximize2 size={14} strokeWidth={1.7} />
          Expand
        </button>
      </div>

      <div role="group" aria-label="Map layer" className="flex flex-wrap gap-2 px-5 pt-5 sm:px-6">
        {availableLayers.map((item) => {
          const active = item.id === layer
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setLayer(item.id)}
              className={`min-h-[42px] rounded-full border px-4 text-support font-medium transition-[background-color,border-color,color] ${
                active
                  ? 'border-ember/50 bg-ember/[0.14] text-bone'
                  : 'border-sand/[0.16] bg-ink-900/60 text-ash-light hover:border-sand/30 hover:text-bone'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="relative mt-5">
        <div ref={inlineHostRef} className="relative h-[420px] w-full overflow-hidden sm:h-[480px]">
          <div
            ref={containerRef}
            role="application"
            aria-label={`Fire activity map for the selected district. Current layer: ${activeLayer.label}.`}
            className="map-surface absolute inset-0 w-full"
          />
        </div>
        {expanded && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/85 px-6 text-center">
            <p className="text-body-sm leading-relaxed text-ash">
              The map is open in expanded mode. Press Esc or use the Exit button to return.
            </p>
          </div>
        )}

        <div className="absolute right-3 top-3 z-[500]">{controlGroup}</div>
      </div>

      <div className="border-t border-sand/[0.08] px-5 py-4 sm:px-6">
        <div className="max-w-2xl">{legend}</div>
        <p className="mt-4 text-support leading-relaxed text-ash">
          Area shading is a study-area-level summary; it does not show exact fire locations. Dots
          are verified NASA FIRMS hotspot detections from the last 7 days — one observation is not
          a unique fire. Smaller-area selection is unavailable because the observations are
          summarized at study-area level.
        </p>
      </div>
      {expandedOverlay}
    </section>
  )
}
