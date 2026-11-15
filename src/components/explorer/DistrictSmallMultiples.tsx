import { palette, withAlpha } from '../../lib/palette'
import type { DistrictYearSummary } from '../../lib/layers'
import { studyAreas } from '../../lib/regions'

type DistrictSmallMultiplesProps = {
  summaries: (DistrictYearSummary | null)[] | null
  layerLabel: string
  year: string | null
  provider: 'sp' | 'nrt'
}

const TERRACOTTA = palette.terracotta.DEFAULT
const AMBER = palette.amber.DEFAULT

/**
 * C3: six mini calendars side by side — the same layer and year across all
 * study areas, so the differences (including Chitwan's sparser record) are
 * visible instead of only stated.
 */
export function DistrictSmallMultiples({ summaries, layerLabel, year, provider }: DistrictSmallMultiplesProps) {
  if (!summaries || summaries.every((s) => s === null)) return null

  const maxWeek = Math.max(
    1,
    ...(summaries ?? []).flatMap((s) => (s?.weekCells ?? []).map((c) => c.value ?? 0)),
  )

  return (
    <section aria-labelledby="small-multiples-heading" className="card mt-6 overflow-hidden">
      <div className="border-b border-sand/10 px-5 py-4">
        <p className="data-label">Same year · same layer · six study areas</p>
        <h2 id="small-multiples-heading" className="mt-1.5 font-display text-xl text-bone">
          Compare the selected study areas
        </h2>
        <p className="mt-1.5 text-support leading-relaxed text-ash-dark">
          Every panel shows the same dataset — {layerLabel},{' '}
          {provider === 'sp' ? 'Standard Processing' : 'Near Real-Time'}, {year ?? '—'} — for the six
          selected areas, so seasonal timing can be compared side by side. The numbers are raw
          hotspot totals for each area, not area-normalised. The areas differ in size by up to two
          orders of magnitude, so compare the shape of the season rather than the bar heights; do
          not read this as a danger ranking.
        </p>
      </div>
      <div className="grid gap-px bg-sand/[0.08] sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((summary, index) => {
          const area = studyAreas[index]?.name ?? `Region ${index + 1}`
          const cells = summary?.weekCells ?? []
          return (
            <div key={area} className="bg-ink-900 p-4">
              <div className="flex items-center justify-between">
                <p className="text-support font-medium text-bone">{area}</p>
                <p className="font-mono text-meta text-ash-dark">
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
                      className="block aspect-square w-full rounded-[2px]"
                      style={{
                        background:
                          cell.value !== null && cell.value > 0
                            ? withAlpha(intensity > 0.55 ? AMBER : TERRACOTTA, 0.3 + 0.6 * intensity)
                            : 'rgb(168 182 206 / 0.05)',
                      }}
                    />
                  )
                })}
              </div>
              <p className="mt-2 text-meta text-ash-dark">
                {summary
                  ? `${summary.weeksWithDetections}/${cells.length} weeks with detections`
                  : '—'}
              </p>
            </div>
          )
        })}
      </div>
      <p className="border-t border-sand/10 px-5 py-3 text-support leading-relaxed text-ash-dark">
        Mini calendars use the same colour scale; column width varies with the number of covered ISO
        weeks per study-area-year. Missing weeks are excluded, not zero-filled.
      </p>
    </section>
  )
}
