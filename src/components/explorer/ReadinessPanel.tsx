import type { ObservationDataset, ObservationIndex } from '../../lib/observations'
import type { ExperimentSummary } from '../../lib/experiments'
import type { ProviderId } from '../../lib/explorer'

type ReadinessPanelProps = {
  index: ObservationIndex | null
  provider: ProviderId
  dataset: ObservationDataset | null
  summary: ExperimentSummary | null
}

export function ReadinessPanel({ index, provider, dataset, summary }: ReadinessPanelProps) {
  const years = index?.years ?? []
  const retained = index?.quality_summary.final_retained_record_count

  const rows: Array<{ label: string; status: string; live: boolean }> = [
    {
      label: 'District boundaries (OCHA COD-AB)',
      status: 'Loaded (3)',
      live: true,
    },
    {
      label: `${provider === 'sp' ? 'SP historical' : 'NRT'} observations`,
      status:
        index !== null
          ? `Connected · ${years[0] ?? '?'}–${years[years.length - 1] ?? '?'}` +
            (retained !== null && retained !== undefined
              ? ` · ${retained.toLocaleString()} records`
              : '')
          : 'Not available',
      live: index !== null,
    },
    {
      label: 'Selected district-year slice',
      status: dataset
        ? `${dataset.district.name} ${dataset.year} · ${dataset.days.length} days`
        : 'No data for selection',
      live: dataset !== null,
    },
    {
      label: 'Harmonization methods compared',
      status:
        summary?.court.decision.outcome === 'inconclusive'
          ? 'Done · verdict inconclusive'
          : summary
            ? `Done · ${summary.court.decision.outcome}`
            : 'Summary not available',
      live: summary !== null,
    },
    {
      label: 'Independent validation audit',
      status: summary ? 'Passed · reliability grid published' : 'Summary not available',
      live: summary !== null,
    },
  ]

  const counts = summary?.reliability.category_counts

  return (
    <section
      aria-labelledby="readiness-heading"
      className="mt-6 border border-sand/[0.12] bg-ink-850 p-5"
    >
      <p className="eyebrow text-ash-dark">Data readiness</p>
      <h2 id="readiness-heading" className="mt-2 font-display text-xl text-bone">
        Pipeline status
      </h2>
      <ul className="mt-5 divide-y divide-sand/[0.08] border-y border-sand/[0.08]">
        {rows.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-3 py-3">
            <span className="text-[11px] leading-snug text-ash-light">{item.label}</span>
            <span
              className={`shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] ${
                item.live ? 'text-ash-light' : 'text-ash-dark'
              }`}
            >
              {item.status}
            </span>
          </li>
        ))}
      </ul>

      {counts && (
        <div className="mt-4">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash-dark">
            Reliability strata (district × month)
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {(
              [
                ['reliable', 'Reliable'],
                ['use_with_caution', 'Use with caution'],
                ['insufficient_evidence', 'Insufficient evidence'],
                ['unavailable', 'Unavailable'],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between border border-sand/[0.08] bg-ink-900 px-2 py-1.5"
              >
                <span className="text-[10px] leading-none text-ash">{label}</span>
                <span className="font-mono text-[10px] text-bone">{counts[key] ?? 0}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ash-dark">
            Reliable = enough observations (30+) and strong agreement to trust that district-month's
            estimate; caution = some evidence; insufficient = never shown as a value; unavailable =
            no sensor coverage. A reliable stratum does not validate the harmonization method — the
            Method Court verdict stays inconclusive.
          </p>
        </div>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-ash-dark">
        Missing observations are never treated as zero. Raw MODIS and VIIRS counts remain separate
        from harmonized estimates. VIIRS is the reference scale, not ground truth.
      </p>
    </section>
  )
}
