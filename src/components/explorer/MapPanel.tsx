import { useEffect, useMemo, useRef } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Maximize2 } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { StatusBadge } from '../ui/StatusBadge'
import { getDistrictFeature } from '../../lib/geo'
import { palette, withAlpha } from '../../lib/palette'
import { studyAreaBoundarySource, studyAreas, type StudyArea, type StudyAreaId } from '../../lib/regions'
import type { DistrictYearSummary } from '../../lib/layers'
import type { ProviderId } from '../../lib/explorer'

type MapPanelProps = {
  area: StudyArea
  layerLabel: string
  year: string | null
  provider: ProviderId
  /** Per-district aggregates for the active provider/year/layer; null where no data. */
  districtSummaries: (DistrictYearSummary | null)[] | null
  onSelectDistrict: (id: StudyAreaId) => void
}

const TERRACOTTA = palette.terracotta.DEFAULT
const MAX_ZOOM = 12
const MIN_ZOOM = 7

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

export function MapPanel({ area, layerLabel, year, provider, districtSummaries, onSelectDistrict }: MapPanelProps) {
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const districtLayerRef = useRef<L.GeoJSON | null>(null)

  const featureCollection = useMemo(() => {
    const features = studyAreas
      .map((s) => getDistrictFeature(s.id))
      .filter((f): f is NonNullable<ReturnType<typeof getDistrictFeature>> => Boolean(f))
    return { type: 'FeatureCollection' as const, features }
  }, [])

  // Keep latest callbacks in refs so map handlers never go stale.
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
      scrollWheelZoom: false, // keep page scrolling predictable; zoom via buttons or double-click
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: MAX_ZOOM }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      districtLayerRef.current = null
    }
  }, [])

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

  return (
    <section aria-labelledby="map-heading" className="border border-sand/[0.12] bg-ink-850">
      <div className="flex items-start justify-between gap-4 border-b border-sand/10 px-5 py-4">
        <div>
          <p className="eyebrow text-ash-dark">Selected study area</p>
          <h2 id="map-heading" className="mt-2 font-display text-xl text-bone">
            {area.name} district
          </h2>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-ash-dark">
            {area.province} · {area.pcode}
          </p>
        </div>
        <StatusBadge tone="neutral">Geographic view</StatusBadge>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          role="application"
          aria-label={`Geographic map of the Nepal study areas. ${area.name} district is highlighted. District fill intensity shows the ${layerLabel} total for ${year ?? 'the selected year'}. OpenStreetMap tiles; OCHA COD-AB boundaries.`}
          className="map-surface h-[320px] w-full sm:h-[360px]"
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

        {/* Attribution (OSM policy): visible directly on the map */}
        <div className="pointer-events-none absolute bottom-1 right-1 z-[500] bg-ink-950/70 px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.08em] text-ash-dark">
          ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto underline decoration-sand/30"
          >
            OpenStreetMap
          </a>{' '}
          contributors
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

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-8 left-3 z-[500] max-w-[62%] border border-sand/10 bg-ink-950/80 px-2.5 py-2 backdrop-blur-[2px]">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash-light">
            {layerLabel} · {provider === 'sp' ? 'SP' : 'NRT'} · {year ?? '—'}
          </p>
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
              low → high
            </span>
          </div>
          <p className="mt-1 font-mono text-[8px] uppercase leading-relaxed tracking-[0.1em] text-ash-dark">
            District totals — not fire locations
          </p>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-sand/10 px-5 py-3.5">
        <p className="text-[11px] leading-relaxed text-ash">
          Fill intensity shows each district's aggregated <span className="text-ash-light">{layerLabel}</span>{' '}
          total for {year ?? 'the selected year'} ({provider === 'sp' ? 'Standard Processing' : 'Near Real-Time'}).
          Click a district on the map or use the buttons to select it.
          {summaryForSelected && year
            ? ` ${area.name} ${year}: ${summaryForSelected.total.toLocaleString()} total across ${summaryForSelected.weekCells.length} covered weeks; ${summaryForSelected.weeksWithDetections} week(s) recorded detections.`
            : ' No aggregated total for this selection yet.'}
        </p>
        <p className="text-[10px] leading-relaxed text-ash-dark">
          Aggregated district totals are not individual fire locations, and the harmonized layer is
          a provisional estimate — never hotspot positions. Boundary geometry:{' '}
          {studyAreaBoundarySource.label} ({studyAreaBoundarySource.license},{' '}
          {studyAreaBoundarySource.boundaryYear}). Tiles © OpenStreetMap contributors.
        </p>
      </div>
    </section>
  )
}
