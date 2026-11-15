import { useEffect, useMemo, useState } from 'react'
import { withAlpha, palette } from '../../lib/palette'

const TERRACOTTA = palette.terracotta.DEFAULT
const AMBER = palette.amber.DEFAULT
import type { HarmonizationFactors, ReliabilityGrid } from '../../lib/experiments'
import type { BackcastArtifact } from '../../lib/backcast'
import { computeWeekCell, weekStratum, type WeekCell } from '../../lib/layers'
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
  backcast?: BackcastArtifact | null
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
  backcast,
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
    return dataset.weeks.map((week) =>
      computeWeekCell(week, layer, dataset.district_id, factors, backcast),
    )
  }, [dataset, layer, factors, backcast])

  // Reliability stratum per cell (midpoint month lookup — fixes late-December
  // ISO weeks mapping onto the unavailable Aug-Dec strata).
  const strataByStart = useMemo(() => {
    const map: Record<
      string,
      {
        category: string
        validationPairs?: number
        interval?: { mae: number | null; p90_abs_error: number | null; note?: string } | null
      }
    > = {}
    if (!dataset || !reliabilityGrid) return map
    for (const week of dataset.weeks) {
      const s = weekStratum(reliabilityGrid, dataset.district_id, week)
      if (s) map[week.week_start] = s
    }
    return map
  }, [dataset, reliabilityGrid])

  const maxValue = useMemo(
    () => Math.max(1, ...cells.map((cell) => cell.value ?? 0)),
    [cells],
  )

  const monthRuns = useMemo(() => {
    const runs: Array<{ month: number; start: number; count: number; firstDay: string }> = []
    cells.forEach((cell, index) => {
      const month = Number(cell.week.week_start.slice(5, 7))
      const last = runs[runs.length - 1]
      if (last && last.month === month) {
        last.count += 1
      } else {
        runs.push({ month, start: index, count: 1, firstDay: cell.week.week_start.slice(8, 10) })
      }
    })
    return runs
  }, [cells])

  // Raw weekly total across all sensors, used only for coverage summaries.
  const weeklyTotals = useMemo(
    () =>
      (dataset?.weeks ?? []).map((week) =>
        Object.values(week.by_sensor).reduce(
          (total, sensor) =>
            total +
            Object.values(sensor.platforms).reduce((sum, platform) => sum + (platform.detections ?? 0), 0),
          0,
        ),
      ),
    [dataset],
  )

  const totalDetections = useMemo(
    () => weeklyTotals.reduce((sum, value) => sum + value, 0),
    [weeklyTotals],
  )

  const observedWeeks = useMemo(
    () => cells.filter((cell) => cell.value !== null).length,
    [cells],
  )

  // Busiest observed months by mean weekly detections, ignoring weeks with no
  // observation. Raw counts, not area-normalised: this is a within-area shape.
  const peakMonths = useMemo(() => {
    const byMonth = new Map<number, { sum: number; count: number }>()
    cells.forEach((cell, index) => {
      if (cell.value === null || cell.value <= 0) return
      const month = Number(cell.week.week_start.slice(5, 7))
      const entry = byMonth.get(month) ?? { sum: 0, count: 0 }
      entry.sum += weeklyTotals[index] ?? cell.value
      entry.count += 1
      byMonth.set(month, entry)
    })
    return [...byMonth.entries()]
      .map(([month, entry]) => ({ month, mean: entry.sum / entry.count }))
      .sort((a, b) => b.mean - a.mean)
      .slice(0, 2)
  }, [cells, weeklyTotals])

  const coverageWeeks = dataset?.weeks ?? []
  const coverageStart = coverageWeeks[0]?.week_start ?? null
  const coverageEnd = coverageWeeks[coverageWeeks.length - 1]?.week_end ?? null
  const observedDayStart = dataset?.days[0]?.date ?? null
  const observedDayEnd = dataset?.days[dataset.days.length - 1]?.date ?? null
  const currentDate = new Date()
  const currentYear = currentDate.getUTCFullYear()
  const currentMonthIndex = currentDate.getUTCMonth() + 1

  const selected = useMemo(
    () => cells.find((cell) => cell.week.week_start === selectedWeek) ?? null,
    [cells, selectedWeek],
  )

  const headingId = 'calendar-heading'
  const districtId = dataset?.district_id ?? ''
  const preBackcastYear = Number(year) < 2012

  return (
    <section aria-labelledby={headingId} className="card overflow-hidden">
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
          <StatusBadge tone="active">
            {dataset.product === 'NRT' ? 'Connected · NRT snapshot' : `Connected · ${dataset.product}`}
          </StatusBadge>
        ) : (
          <StatusBadge tone="planned">No data for this selection</StatusBadge>
        )}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-support text-ash-dark">
          <span aria-live="polite" className="text-ash">
            <span className="font-medium text-bone">{areaName}</span> · {province} · {year}
          </span>
          <span className="text-ash">{layerLabel}</span>
        </div>

        {dataset && (
          <div className="mt-4 grid gap-4 rounded-xl border border-sand/[0.1] bg-ink-900/55 px-4 py-4 sm:grid-cols-3">
            <div>
              <p className="data-label">Actual date range in this file</p>
              <p className="mt-1.5 text-body-sm font-medium text-bone">
                {formatDay(coverageStart)} – {formatDay(coverageEnd)}
              </p>
              <p className="mt-1 text-support text-ash">
                {cells.length} ISO weeks · {observedWeeks}{' '}
                {layer === 'harmonized' ? 'with estimates' : 'with observations'}
              </p>
            </div>
            <div>
              <p className="data-label">Busiest months this year</p>
              <p className="mt-1.5 text-body-sm font-medium text-bone">
                {peakMonths.length > 0
                  ? peakMonths.map((entry) => months[entry.month - 1]).join(' · ')
                  : 'No detections recorded'}
              </p>
              <p className="mt-1 text-support text-ash">
                By average weekly value for this layer; not a long-term ranking.
              </p>
            </div>
            <div>
              <p className="data-label">How to read it</p>
              <p className="mt-1.5 text-support leading-relaxed text-ash">
                Stronger colour = more detections.{' '}
                {layer === 'harmonized'
                  ? preBackcastYear
                    ? 'Hatched cells are months where the regional transferability test does not support an estimate — raw MODIS only, never zero.'
                    : 'Hatched cells have no MODIS–VIIRS co-observation — no estimate, never zero.'
                  : 'Hatched cells were not observed — never zero.'}
              </p>
            </div>
          </div>
        )}

        {!dataset && !loading && (
          <p className="mt-6 text-support leading-relaxed text-ash">
            No processed observations are available for this district, year and provider
            combination. This is an honest empty state: no values are invented. Try another year
            or provider.
          </p>
        )}

        {dataset && (
          <div className="mt-5 overflow-x-auto pb-1">
            <p className="mb-2 text-support text-ash-dark sm:hidden">
              Scroll sideways to see the full season.
            </p>
            <div className="min-w-[600px]">
              <div
                aria-hidden="true"
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${cells.length || 53}, minmax(0, 1fr))` }}
              >
                {monthRuns.map((run) => {
                  const isCurrentMonth =
                    Number(year) === currentYear && run.month === currentMonthIndex
                  return (
                    <div
                      key={`h-${run.month}`}
                      style={{ gridColumn: `${run.start + 1} / span ${run.count}` }}
                      className={`min-w-0 border-t-2 pt-1.5 ${
                        isCurrentMonth ? 'border-amber/70' : 'border-sand/15'
                      }`}
                    >
                      <p
                        className={`whitespace-nowrap text-support font-medium ${
                          isCurrentMonth ? 'text-amber-soft' : 'text-ash'
                        }`}
                      >
                        {run.count > 1 ? months[run.month - 1] : ''}
                      </p>
                      {isCurrentMonth && (
                        <p className="text-meta text-amber-soft">Current month</p>
                      )}
                    </div>
                  )
                })}
              </div>

              <div
                role="group"
                aria-label={`Weekly fire signal for ${areaName}, ${year}. ${layerLabel}.`}
                className="mt-2 grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${cells.length || 53}, minmax(0, 1fr))` }}
              >
                {cells.map((cell) => {
                  const key = cell.week.week_start
                  const intensity =
                    cell.value !== null ? Math.sqrt(Math.min(cell.value, maxValue) / maxValue) : 0
                  const background =
                    cell.value !== null && cell.value > 0
                      ? withAlpha(intensity > 0.55 ? AMBER : TERRACOTTA, 0.32 + 0.6 * intensity)
                      : undefined
                  const isSelected = key === selectedWeek
                  const isCurrentMonth =
                    Number(year) === currentYear &&
                    Number(key.slice(5, 7)) === currentMonthIndex
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedWeek(isSelected ? null : key)}
                      aria-pressed={isSelected}
                      aria-label={
                        `Week of ${cell.week.week_start}: ` +
                        (cell.value !== null
                          ? `${layer === 'harmonized' ? 'VIIRS-equivalent estimate' : 'detections'} ${Math.round(cell.value * 100) / 100}${
                              cell.kind === 'estimate' &&
                              strataByStart[cell.week.week_start]?.category === 'insufficient_evidence'
                                ? ' (low evidence)'
                                : ''
                            }`
                          : cell.kind === 'no_co_observation'
                            ? 'no co-observation; no estimate'
                            : cell.kind === 'backcast_unsupported'
                              ? 'no supported VIIRS-equivalent backcast; raw MODIS only'
                              : 'not observed')
                      }
                      title={`Week of ${cell.week.week_start}`}
                      className={`relative h-12 min-w-0 rounded-md border transition-[border-color,background-color] sm:h-14 ${
                        isSelected
                          ? 'border-bone ring-1 ring-bone/60'
                          : isCurrentMonth
                            ? 'border-amber/40 hover:border-amber/70'
                            : 'border-sand/10 hover:border-sand/40'
                      }`}
                      style={{
                        background:
                          background ??
                          (cell.value === 0 && cell.week.status === 'observed'
                            ? 'rgb(168 182 206 / 0.1)'
                            : cell.kind === 'no_co_observation' ||
                                cell.kind === 'backcast_unsupported'
                              ? 'rgb(168 182 206 / 0.06)'
                              : 'rgb(168 182 206 / 0.035)'),
                        opacity:
                          cell.kind === 'estimate' &&
                          strataByStart[cell.week.week_start]?.category === 'insufficient_evidence'
                            ? 0.45
                            : undefined,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="block h-full w-full"
                        style={{
                          backgroundImage:
                            cell.value === null && cell.week.status !== 'observed'
                              ? 'repeating-linear-gradient(45deg, rgb(168 182 206 / 0.16) 0 2px, transparent 2px 5px)'
                              : cell.kind === 'backcast_unsupported'
                                ? 'repeating-linear-gradient(45deg, rgb(168 182 206 / 0.16) 0 2px, transparent 2px 5px)'
                                : undefined,
                        }}
                      />
                      {cell.kind === 'estimate' &&
                        strataByStart[cell.week.week_start]?.category === 'insufficient_evidence' && (
                          <span
                            aria-hidden="true"
                            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full border border-sand/50"
                            title="Low-evidence week"
                          />
                        )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {dataset && (
          <div className="mt-4 border-t border-sand/10 pt-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-support text-ash">
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: withAlpha(AMBER, 0.92) }} aria-hidden="true" />
                More detections
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-[3px]" style={{ background: withAlpha(TERRACOTTA, 0.35) }} aria-hidden="true" />
                Fewer detections
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-3.5 w-3.5 rounded-[3px]"
                  style={{ background: 'rgb(168 182 206 / 0.1)', outline: '1px solid rgb(168 182 206 / 0.22)' }}
                  aria-hidden="true"
                />
                Observed zero
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-3.5 w-3.5 rounded-[3px]"
                  style={{
                    background: 'rgb(168 182 206 / 0.06)',
                    backgroundImage:
                      'repeating-linear-gradient(45deg, rgb(168 182 206 / 0.22) 0 2px, transparent 2px 5px)',
                    outline: '1px solid rgb(168 182 206 / 0.2)',
                  }}
                  aria-hidden="true"
                />
                {layer === 'harmonized'
                  ? preBackcastYear
                    ? 'No supported backcast'
                    : 'No co-observation'
                  : 'Not observed'}
              </span>
            </div>
            <p className="mt-2 text-support text-ash-dark">Reference scale: {layerNote}</p>
          </div>
        )}

        {dataset?.product === 'NRT' && (
          <div className="mt-4 rounded-xl border border-amber/25 bg-amber/[0.06] px-4 py-3">
            <p className="text-body-sm font-medium text-bone">
              Limited recent snapshot — not a fire season
            </p>
            <p className="mt-1.5 text-support leading-relaxed text-ash">
              Observed days {formatDay(observedDayStart)} to {formatDay(observedDayEnd)} (ISO weeks{' '}
              {formatDay(coverageStart)}–{formatDay(coverageEnd)}) ·{' '}
              {totalDetections.toLocaleString()} detections in this area&apos;s weekly cells.
              Acquired {formatTimestamp(dataset.generated_at)} UTC. A short window cannot describe a
              seasonal pattern, and an empty day does not mean conditions are safe.
            </p>
          </div>
        )}

        {dataset?.product === 'SP' && (
          <p className="mt-3 text-support leading-relaxed text-ash-dark">
            {preBackcastYear
              ? `This pre-2012 file covers ${formatDay(coverageStart)} to ${formatDay(coverageEnd)}. ` +
                (Number(year) <= 2001
                  ? 'Only MODIS Terra observed during this period; no Aqua calibration is applied where Aqua did not exist. '
                  : 'MODIS Terra and Aqua are kept separate. ') +
                'Raw MODIS detections are genuine observations.'
              : `This file covers ${formatDay(coverageStart)} to ${formatDay(coverageEnd)}; it is not a full-year series. Months outside that window were not acquired, so they have no cells — an acquisition gap, never evidence that no fire occurred.`}{' '}
            Inside the window, zero observed detections are shown as zero and weeks without a usable
            observation are hatched, never zero-filled.
          </p>
        )}

        {layer === 'harmonized' && dataset && (
          <p className="mt-3 text-support leading-relaxed text-ash-dark">
            {preBackcastYear
              ? 'Pre-2012 cells are MODIS-derived VIIRS-equivalent estimates only where the regional transferability decision supports that platform and month. They are not observed VIIRS counts, not ground truth, and are never produced where validation is unsupported. Months without post-2012 overlap evidence stay raw MODIS.'
              : 'Harmonized cells are provisional VIIRS-equivalent estimates of MODIS detections (method selected per region by the Method Court and transferability tests). They are not observed VIIRS counts and not ground truth. Weeks without MODIS–VIIRS co-observation are left empty rather than estimated.'}
          </p>
        )}

        {selected && dataset && (
          <div className="mt-5 overflow-hidden rounded-xl border border-sand/[0.14] bg-ink-900/80">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/10 px-4 py-3">
              <div>
                <p className="data-label">
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
                      : selected.kind === 'backcast_unsupported'
                        ? 'No supported backcast for this month — raw MODIS only'
                        : undefined
                }
              />
            </div>
            {(() => {
              const stratum = strataByStart[selected.week.week_start]
              const interval = stratum?.interval
              if (!interval || interval.mae === null || interval.mae === undefined) return null
              return (
                <div className="border-t border-sand/10 px-4 py-3">
                  <p className="data-label">
                    Typical held-out error in this stratum
                  </p>
                  <p className="mt-1.5 text-support leading-relaxed text-ash-light">
                    ±{Math.round(interval.mae * 10) / 10} detections on a typical day
                    {interval.p90_abs_error !== null && interval.p90_abs_error !== undefined
                      ? `; 9 of 10 days fall within ±${Math.round(interval.p90_abs_error * 10) / 10}`
                      : ''}
                    , measured against the VIIRS reference on out-of-fold district-days in this
                    district-month.
                  </p>
                </div>
              )
            })()}
            {selected.kind === 'estimate' && selected.platformEstimates && (
              <div className="border-t border-sand/10 px-4 py-3">
                <p className="data-label">
                  How this estimate is built
                </p>
                {selected.platformEstimates.map((e) => (
                  <div
                    key={e.platform}
                    className="mt-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-meta text-ash-light"
                  >
                    <span>
                      {e.platform}: {e.detections.toLocaleString()} × {e.factor.toFixed(2)}{' '}
                      <span className="text-ash-dark">
                        ({e.factorSource === 'fitted'
                          ? 'monthly factor'
                          : e.factorSource === 'district_ratio_fallback'
                            ? 'district fallback'
                            : e.factorSource === 'backcast_supported'
                              ? 'backcast factor · supported'
                              : 'backcast factor · limited'})
                      </span>
                    </span>
                    <span>= {Math.round(e.estimate * 10) / 10}</span>
                  </div>
                ))}
                <p className="mt-1.5 font-mono text-meta text-ash-dark">
                  Averaged across {selected.estimateBasis} MODIS platform
                  {selected.estimateBasis === 1 ? '' : 's'} → {Math.round((selected.value ?? 0) * 10) / 10}{' '}
                  VIIRS-equivalent
                </p>
              </div>
            )}
            <p className="border-t border-sand/10 px-4 py-3 text-support leading-relaxed text-ash-dark">
              Values are satellite hotspot detections recorded inside the district — not unique
              fires and not burned area. Missing observations are never treated as zero. Harmonized
              values are estimates, not observations. Before 2012 they exist only where the regional
              transferability decision supports the platform and calendar month; otherwise only raw
              MODIS is shown. The "data stratum" badge describes the observational evidence for this
              district × month (sample size and agreement); it does not validate the harmonization
              method, whose Method Court verdict remains inconclusive.
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

function formatDay(value: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function selectedReliability(
  grid: ReliabilityGrid | null,
  districtId: string,
  weekStart: string,
): string | null {
  // Midpoint month: a week starting 29-31 December belongs mostly to January.
  const start = new Date(weekStart)
  const mid = new Date(start.getTime() + 3.5 * 24 * 3600 * 1000)
  const month = String(mid.getUTCMonth() + 1).padStart(2, '0')
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
      <p className="data-label">{label}</p>
      {value && value.detections !== null && value.detections !== undefined ? (
        <>
          <p className={`mt-1.5 font-display text-2xl leading-none ${muted ? 'text-amber-soft' : 'text-bone'}`}>
            {value.detections.toLocaleString()}
          </p>
          <p className="mt-1 text-meta text-ash-dark">
            {unit}
            {value.days_observed !== undefined ? ` · ${value.days_observed}/7 days obs` : ''}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-meta leading-snug text-ash-dark">
          {mutedText ?? 'Not observed / no data'}
        </p>
      )}
    </div>
  )
}
