import { useEffect, useMemo, useState } from 'react'
import { withAlpha, palette } from '../../lib/palette'

const TERRACOTTA = palette.terracotta.DEFAULT
const AMBER = palette.amber.DEFAULT
import type { HarmonizationFactors, ReliabilityGrid } from '../../lib/experiments'
import { computeWeekCell, type WeekCell } from '../../lib/layers'
import { months } from '../../lib/content'
import { StatusBadge } from '../ui/StatusBadge'
import type { LayerId } from '../../lib/explorer'
import type { ObservationDataset } from '../../lib/observations'

type CalendarPanelProps = {
  areaName: string
  province: string
  year: string
  layer: LayerId
  layerLabel: string
  layerNote: string
  dataset: ObservationDataset | null
  factors: HarmonizationFactors | null
  reliabilityGrid: ReliabilityGrid | null
  loading: boolean
}


export function CalendarPanel({
  areaName,
  province,
  year,
  layer,
  layerLabel,
  layerNote,
  dataset,
  factors,
  reliabilityGrid,
  loading,
}: CalendarPanelProps) {
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)

  // Changing district/provider/year swaps the dataset; clear the selection.
  useEffect(() => {
    setSelectedWeek(null)
  }, [dataset])

  const cells = useMemo<WeekCell[]>(() => {
    if (!dataset) return []
    return dataset.weeks.map((week) => computeWeekCell(week, layer, dataset.district_id, factors))
  }, [dataset, layer, factors])

  const maxValue = useMemo(
    () => Math.max(1, ...cells.map((cell) => cell.value ?? 0)),
    [cells],
  )

  const monthStarts = useMemo(() => {
    // Index of the first week-cell starting in each month, for labels.
    const starts: number[] = []
    let lastMonth = ''
    cells.forEach((cell, index) => {
      const month = cell.week.week_start.slice(5, 7)
      if (month !== lastMonth) {
        starts.push(index)
        lastMonth = month
      }
    })
    return starts
  }, [cells])

  const selected = useMemo(
    () => cells.find((cell) => cell.week.week_start === selectedWeek) ?? null,
    [cells, selectedWeek],
  )

  const headingId = 'calendar-heading'
  const districtId = dataset?.district_id ?? ''

  return (
    <section aria-labelledby={headingId} className="border border-sand/[0.12] bg-ink-850">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sand/10 px-5 py-4 sm:px-6">
        <div>
          <p className="eyebrow text-ash-dark">Activity calendar</p>
          <h2 id={headingId} className="mt-2 font-display text-2xl text-bone">
            Weekly fire signal · {year}
          </h2>
        </div>
        {loading ? (
          <StatusBadge tone="neutral">Loading…</StatusBadge>
        ) : dataset ? (
          <StatusBadge tone="active">{`Connected · ${dataset.product}`}</StatusBadge>
        ) : (
          <StatusBadge tone="planned">No data for this selection</StatusBadge>
        )}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ash-dark">
          <span aria-live="polite">
            {areaName} · {province} / {year}
          </span>
          <span>{layerLabel}</span>
        </div>

        {!dataset && !loading && (
          <p className="mt-6 text-[12px] leading-relaxed text-ash">
            No processed observations are available for this district, year and provider
            combination. This is an honest empty state: no values are invented. Try another year
            or provider.
          </p>
        )}

        {dataset && (
          <div className="mt-4 overflow-x-auto pb-1">
            <div className="min-w-[680px]">
              <div
                role="group"
                aria-label={`Weekly fire signal for ${areaName}, ${year}. ${layerLabel}.`}
                className="grid gap-[3px]"
                style={{ gridTemplateColumns: `repeat(${cells.length || 53}, minmax(0, 1fr))` }}
              >
                {cells.map((cell) => {
                  const key = cell.week.week_start
                  const intensity =
                    cell.value !== null ? Math.sqrt(Math.min(cell.value, maxValue) / maxValue) : 0
                  const background =
                    cell.value !== null && cell.value > 0
                      ? withAlpha(intensity > 0.55 ? AMBER : TERRACOTTA, 0.28 + 0.62 * intensity)
                      : undefined
                  const isSelected = key === selectedWeek
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedWeek(isSelected ? null : key)}
                      aria-pressed={isSelected}
                      aria-label={
                        `Week of ${cell.week.week_start}: ` +
                        (cell.value !== null
                          ? `${layer === 'harmonized' ? 'VIIRS-equivalent estimate' : 'detections'} ${Math.round(cell.value * 100) / 100}`
                          : cell.kind === 'no_co_observation'
                            ? 'no co-observation; no estimate'
                            : 'not observed')
                      }
                      title={`Week of ${cell.week.week_start}`}
                      className={`h-11 min-w-0 border transition-colors ${
                        isSelected ? 'border-bone' : 'border-sand/10 hover:border-sand/40'
                      }`}
                      style={{
                        background:
                          background ??
                          (cell.kind === 'no_co_observation'
                            ? 'rgba(232, 216, 189, 0.05)'
                            : 'rgba(232, 216, 189, 0.03)'),
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="block h-full w-full"
                        style={{
                          backgroundImage:
                            cell.value === null && cell.week.status !== 'observed'
                              ? 'repeating-linear-gradient(45deg, rgba(232,216,189,0.10) 0 2px, transparent 2px 5px)'
                              : undefined,
                        }}
                      />
                    </button>
                  )
                })}
              </div>

              <div
                aria-hidden="true"
                className="mt-1.5 grid gap-[3px] font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark"
                style={{ gridTemplateColumns: `repeat(${cells.length || 53}, minmax(0, 1fr))` }}
              >
                {cells.map((cell, index) => (
                  <span key={`m-${cell.week.week_start}`} className="overflow-visible whitespace-nowrap">
                    {monthStarts.includes(index) ? months[Number(cell.week.week_start.slice(5, 7)) - 1] : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {dataset && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-sand/10 pt-3 font-mono text-[8px] uppercase tracking-[0.12em] text-ash-dark">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5" style={{ background: withAlpha(AMBER, 0.9) }} aria-hidden="true" />
              higher
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5" style={{ background: withAlpha(TERRACOTTA, 0.35) }} aria-hidden="true" />
              lower
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5"
                style={{ background: 'rgba(232, 216, 189, 0.05)', outline: '1px solid rgba(232, 216, 189, 0.2)' }}
                aria-hidden="true"
              />
              {layer === 'harmonized' ? 'no co-observation' : 'not observed'}
            </span>
            <span className="ml-auto">Reference scale: {layerNote}</span>
          </div>
        )}

        {dataset?.product === 'NRT' && (
          <p className="mt-3 text-[11px] leading-relaxed text-ash-dark">
            Near Real-Time is the public 7-day global snapshot feed: only the acquired window has
            cells here, and its weeks reflect that short observation window — the window's emptiness
            or sparseness is real, not a malfunction.
          </p>
        )}

        {dataset?.product === 'SP' && (
          <p className="mt-3 text-[11px] leading-relaxed text-ash-dark">
            Historical coverage: January–June 2012–2026 plus July 2026. August–December were
            <strong className="text-ash"> not requested</strong> from FIRMS in this acquisition, so
            those months show no cells here — that is acquisition scope, never evidence that no
            fires occurred. Months inside coverage but without detections are marked
            insufficient, not zero.
          </p>
        )}

        {layer === 'harmonized' && dataset && (
          <p className="mt-3 text-[11px] leading-relaxed text-ash-dark">
            Harmonized cells are provisional VIIRS-equivalent estimates of MODIS detections
            (monthly shrinkage factors; Method Court verdict inconclusive). They are not observed
            VIIRS counts and not ground truth. Weeks without MODIS–VIIRS co-observation are left
            empty rather than estimated.
          </p>
        )}

        {selected && dataset && (
          <div className="mt-5 border border-sand/[0.14] bg-ink-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/10 px-4 py-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash-dark">
                  Week {selected.week.iso_year}-W{String(selected.week.iso_week).padStart(2, '0')}
                </p>
                <p className="mt-1 font-display text-lg text-bone">
                  {selected.week.week_start} → {selected.week.week_end}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const category = selectedReliability(reliabilityGrid, districtId, selected.week.week_start)
                  return category ? (
                    <StatusBadge tone="neutral">{`data stratum: ${category}`}</StatusBadge>
                  ) : null
                })()}
                <StatusBadge tone={selected.week.days_in_week < 7 ? 'planned' : 'neutral'}>
                  {`${selected.week.status} · ${selected.week.days_in_week}/7 days`}
                </StatusBadge>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-sand/[0.08] sm:grid-cols-4">
              <DetailStat
                label="MODIS Terra"
                value={selected.week.by_sensor.modis?.platforms['Terra']}
                unit="detections"
              />
              <DetailStat
                label="MODIS Aqua"
                value={selected.week.by_sensor.modis?.platforms['Aqua']}
                unit="detections"
              />
              <DetailStat
                label="VIIRS Suomi-NPP"
                value={selected.week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']}
                unit="detections"
              />
              <DetailStat
                label="Harmonized estimate"
                value={
                  selected.kind === 'estimate' && selected.value !== null
                    ? {
                        detections: Math.round(selected.value * 10) / 10,
                        days_observed: undefined,
                      }
                    : undefined
                }
                unit="VIIRS-equivalent"
                muted={selected.kind !== 'estimate'}
                mutedText={
                  layer !== 'harmonized'
                    ? 'Not computed — switch to the Harmonized layer'
                    : selected.kind === 'no_co_observation'
                      ? 'No MODIS–VIIRS co-observation this week'
                      : undefined
                }
              />
            </div>
            <p className="border-t border-sand/10 px-4 py-3 text-[10px] leading-relaxed text-ash-dark">
              Values are satellite hotspot detections recorded inside the district — not unique
              fires and not burned area. Missing observations are never treated as zero. Harmonized
              values are provisional estimates, not observations. The "data stratum" badge
              describes the observational evidence for this district × month (sample size and
              agreement); it does not validate the harmonization method, whose Method Court
              verdict remains inconclusive.
            </p>
          </div>
        )}

        {!dataset && loading && (
          <div className="mt-6 h-11 animate-pulse bg-sand/[0.05]" aria-hidden="true" />
        )}
      </div>
    </section>
  )
}

function selectedReliability(
  grid: ReliabilityGrid | null,
  districtId: string,
  weekStart: string,
): string | null {
  const month = weekStart.slice(5, 7)
  const stratum = grid?.[districtId]?.[month]
  return stratum ? stratum.category : null
}

function DetailStat({
  label,
  value,
  unit,
  muted,
  mutedText,
}: {
  label: string
  value: { detections: number | null; days_observed?: number } | undefined
  unit: string
  muted?: boolean
  mutedText?: string
}) {
  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash-dark">{label}</p>
      {value && value.detections !== null && value.detections !== undefined ? (
        <>
          <p className={`mt-1.5 font-display text-2xl leading-none ${muted ? 'text-amber-soft' : 'text-bone'}`}>
            {value.detections.toLocaleString()}
          </p>
          <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
            {unit}
            {value.days_observed !== undefined ? ` · ${value.days_observed}/7 days obs` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[11px] leading-snug text-ash-dark">
          {mutedText ?? 'Not observed / no data'}
        </p>
      )}
    </div>
  )
}
