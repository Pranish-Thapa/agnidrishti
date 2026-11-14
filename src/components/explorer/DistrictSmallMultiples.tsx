import { palette, withAlpha } from '../../lib/palette'
import type { DistrictYearSummary } from '../../lib/layers'

type DistrictSmallMultiplesProps = {
  summaries: (DistrictYearSummary | null)[] | null
  layerLabel: string
  year: string | null
  provider: 'sp' | 'nrt'
}

const TERRACOTTA = palette.terracotta.DEFAULT
const AMBER = palette.amber.DEFAULT

/**
 * C3: three mini calendars side by side — the same layer and year across all
 * three districts, so the district differences (including Chitwan's sparser
 * record) are visible instead of only stated.
 */
export function DistrictSmallMultiples({ summaries, layerLabel, year, provider }: DistrictSmallMultiplesProps) {
  if (!summaries || summaries.every((s) => s === null)) return null

  const maxWeek = Math.max(
    1,
    ...(summaries ?? []).flatMap((s) => (s?.weekCells ?? []).map((c) => c.value ?? 0)),
  )

  return (
    <section aria-labelledby="small-multiples-heading" className="mt-6 border border-sand/[0.12] bg-ink-850">
      <div className="border-b border-sand/10 px-5 py-4">
        <p className="eyebrow text-ash-dark">District comparison</p>
        <h2 id="small-multiples-heading" className="mt-2 font-display text-xl text-bone">
          Same year, same layer, three districts
        </h2>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ash-dark">
          {layerLabel} · {provider === 'sp' ? 'Standard Processing' : 'Near Real-Time'} · {year ?? '—'}.
          Differences between the three mini calendars are real district differences — Chitwan's
          weaker validation evidence is documented on the methodology page.
        </p>
      </div>
      <div className="grid gap-px bg-sand/[0.08] sm:grid-cols-3">
        {summaries.map((summary, index) => {
          const area = ['Banke', 'Bardiya', 'Chitwan'][index]
          const cells = summary?.weekCells ?? []
          return (
            <div key={area} className="bg-ink-900 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-medium text-bone">{area}</p>
                <p className="font-mono text-[9px] text-ash-dark">
                  {summary ? summary.total.toLocaleString() : 'no data'}
                </p>
              </div>
              <div className="mt-3 grid grid-flow-col grid-rows-7 gap-[2px]" aria-hidden="true">
                {cells.map((cell) => {
                  const intensity =
                    cell.value !== null
                      ? Math.sqrt(Math.min(cell.value, maxWeek) / maxWeek)
                      : 0
                  return (
                    <span
                      key={cell.week.week_start}
                      className="block aspect-square w-full"
                      style={{
                        background:
                          cell.value !== null && cell.value > 0
                            ? withAlpha(intensity > 0.55 ? AMBER : TERRACOTTA, 0.3 + 0.6 * intensity)
                            : 'rgba(232, 216, 189, 0.04)',
                      }}
                    />
                  )
                })}
              </div>
              <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
                {summary
                  ? `${summary.weeksWithDetections}/${cells.length} weeks with detections`
                  : '—'}
              </p>
            </div>
          )
        })}
      </div>
      <p className="border-t border-sand/10 px-5 py-3 text-[10px] leading-relaxed text-ash-dark">
        Mini calendars use the same colour scale; column width varies with the number of covered ISO
        weeks per district-year. Missing weeks are excluded, not zero-filled.
      </p>
    </section>
  )
}
