import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { computeWeekCell, weekStratum, type WeekCell } from '../../lib/layers'
import type { HarmonizationFactors, ReliabilityGrid } from '../../lib/experiments'
import type { BackcastArtifact } from '../../lib/backcast'
import type { ObservationDataset } from '../../lib/observations'
import type { LayerId } from '../../lib/explorer'
import { palette } from '../../lib/palette'

type ComparisonChartProps = {
  dataset: ObservationDataset
  districtName: string
  layer: LayerId
  factors: HarmonizationFactors | null
  backcast?: BackcastArtifact | null
  reliabilityGrid: ReliabilityGrid | null
}

const COLORS = {
  Terra: palette.terracotta.soft,
  Aqua: palette.amber.soft,
  'Suomi-NPP': palette.observation.DEFAULT,
  estimate: palette.amber.DEFAULT,
}

const W = 1240
const H = 280
const PAD = { top: 20, right: 16, bottom: 36, left: 56 }

/**
 * Weekly overlay (B3): one chart that shows the whole problem and the fix —
 * raw Terra, raw Aqua, raw VIIRS (the reference) and the averaged harmonized
 * estimate for the selected district-year. Gaps = weeks without observation.
 */
export function ComparisonChart({ dataset, districtName, layer, factors, backcast, reliabilityGrid }: ComparisonChartProps) {
  const cells = useMemo<WeekCell[]>(
    () =>
      dataset.weeks.map((w) =>
        computeWeekCell(w, layer, dataset.district_id, factors, backcast),
      ),
    [dataset, layer, factors, backcast],
  )

  const series = useMemo(() => {
    const build = (pick: (c: WeekCell) => number | null): Array<[number, number | null]> =>
      cells.map((c, i) => [i, pick(c)])
    return {
      terra: build((c) =>
        (c.week.by_sensor.modis?.platforms['Terra']?.days_observed ?? 0) > 0
          ? (c.week.by_sensor.modis?.platforms['Terra']?.detections ?? 0)
          : null,
      ),
      aqua: build((c) =>
        (c.week.by_sensor.modis?.platforms['Aqua']?.days_observed ?? 0) > 0
          ? (c.week.by_sensor.modis?.platforms['Aqua']?.detections ?? 0)
          : null,
      ),
      snpp: build((c) =>
        (c.week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']?.days_observed ?? 0) > 0
          ? (c.week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']?.detections ?? 0)
          : null,
      ),
      estimate: build((c) => (c.kind === 'estimate' ? c.value : null)),
    }
  }, [cells])

  const maxValue = useMemo(() => {
    const all = [
      ...series.terra.map(([, v]) => v ?? 0),
      ...series.aqua.map(([, v]) => v ?? 0),
      ...series.snpp.map(([, v]) => v ?? 0),
      ...(layer === 'harmonized' ? series.estimate.map(([, v]) => v ?? 0) : []),
    ]
    return Math.max(1, ...all)
  }, [series, layer])

  const scale = (v: number) =>
    PAD.top + (H - PAD.top - PAD.bottom) * (1 - Math.sqrt(Math.min(v, maxValue) / maxValue))

  const x = (i: number) =>
    PAD.left + (i / Math.max(1, cells.length - 1)) * (W - PAD.left - PAD.right)

  const polyline = (points: Array<[number, number | null]>) =>
    points
      .map(([i, v], idx) => {
        if (v === null) return null
        const prefix =
          idx === 0 || points[idx - 1][1] === null ? 'M' : 'L'
        return `${prefix}${x(i).toFixed(1)},${scale(v).toFixed(1)}`
      })
      .filter(Boolean)
      .join(' ')

  const monthTicks = useMemo(() => {
    const ticks: Array<{ index: number; label: string }> = []
    let lastMonth = ''
    cells.forEach((c, i) => {
      const m = c.week.week_start.slice(5, 7)
      if (m !== lastMonth) {
        ticks.push({
          index: i,
          label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
            Number(m) - 1
          ],
        })
        lastMonth = m
      }
    })
    return ticks
  }, [cells])

  // C1: weekly CSV download built from the same computed values.
  const downloadCsv = () => {
    const header = [
      'week_start',
      'week_end',
      'status',
      'terra_detections',
      'aqua_detections',
      'viirs_snpp_detections',
      layer === 'harmonized' ? 'harmonized_viirs_equivalent' : `${layer}_total`,
      'evidence_level',
    ].join(',')
    const rows = cells.map((c) => {
      const stratum = weekStratum(reliabilityGrid, dataset.district_id, c.week)
      return [
        c.week.week_start,
        c.week.week_end,
        c.week.status,
        c.week.by_sensor.modis?.platforms['Terra']?.detections ?? 0,
        c.week.by_sensor.modis?.platforms['Aqua']?.detections ?? 0,
        c.week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']?.detections ?? 0,
        c.value === null ? '' : String(Math.round(c.value * 100) / 100),
        stratum?.category ?? '',
      ].join(',')
    })
    const csv = [
      `# Agnidrishti weekly fire signal - ${districtName} ${dataset.year} (${dataset.product})`,
      `# layer=${layer}; detections are hotspot observations, not unique fires`,
      '# evidence levels from the pooled out-of-fold reliability grid',
      header,
      ...rows,
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agnidrishti-weekly-${dataset.district_id}-${dataset.year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const gridLines = [0.25, 0.5, 0.75].map((f) => ({
    y: PAD.top + (H - PAD.top - PAD.bottom) * (1 - f),
    label: Math.round(maxValue * f).toLocaleString(),
  }))

  return (
    <section aria-labelledby="comparison-heading" className="card mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/10 px-5 py-4">
        <div>
          <p className="data-label">Raw vs corrected</p>
          <h2 id="comparison-heading" className="mt-1.5 font-display text-xl text-bone">
            One view of the problem and the fix
          </h2>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="flex items-center gap-1.5 rounded-full border border-sand/[0.14] bg-ink-950/70 px-3 py-1.5 text-meta font-medium text-ash-light transition-[background-color,color,border-color] hover:border-observation/35 hover:bg-observation/[0.07] hover:text-bone"
        >
          <Download size={12} strokeWidth={1.7} />
          Download weekly CSV
        </button>
      </div>

      <div className="px-5 py-4">
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Weekly time series for ${districtName} ${dataset.year}: raw Terra, Aqua and VIIRS detections${
              layer === 'harmonized' ? ', and the averaged harmonized estimate' : ''
            }.`}
            className="min-w-[640px] w-full"
          >
            {gridLines.map((g) => (
              <g key={g.y}>
                <line x1={PAD.left} x2={W - PAD.right} y1={g.y} y2={g.y} stroke="rgb(168 182 206 / 0.09)" />
                <text x={PAD.left - 6} y={g.y + 3} textAnchor="end" fontSize="14" fill={palette.ash.dark}>
                  {g.label}
                </text>
              </g>
            ))}

            {monthTicks.map((t) => (
              <text key={t.index} x={x(t.index)} y={H - 8} textAnchor="middle" fontSize="14" fill={palette.ash.dark}>
                {t.label}
              </text>
            ))}

            <path d={polyline(series.terra)} fill="none" stroke={COLORS.Terra} strokeWidth="1.6" />
            <path d={polyline(series.aqua)} fill="none" stroke={COLORS.Aqua} strokeWidth="1.6" />
            <path d={polyline(series.snpp)} fill="none" stroke={COLORS['Suomi-NPP']} strokeWidth="2" />

            {layer === 'harmonized' && (
              <path
                d={polyline(series.estimate)}
                fill="none"
                stroke={COLORS.estimate}
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            )}

            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={scale(0)}
              y2={scale(0)}
              stroke="rgb(168 182 206 / 0.16)"
            />
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-support text-ash-light">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ background: COLORS['Suomi-NPP'] }} aria-hidden="true" />
            VIIRS Suomi-NPP (reference)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ background: COLORS.Terra }} aria-hidden="true" />
            MODIS Terra
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ background: COLORS.Aqua }} aria-hidden="true" />
            MODIS Aqua
          </span>
          {layer === 'harmonized' && (
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${COLORS.estimate} 0 4px, transparent 4px 7px)`,
                }}
                aria-hidden="true"
              />
              Harmonized estimate (provisional, averaged)
            </span>
          )}
        </div>
        <p className="mt-2 text-support leading-relaxed text-ash-dark">
          Weekly hotspot detections inside the district — not unique fires. Gaps are weeks without
          observation, never zeros. The VIIRS line is the reference scale the harmonized estimate is
          built against; on this chart the corrected estimate tracks it instead of sitting 14x below.
        </p>
      </div>
    </section>
  )
}
