import type { ObservationDataset, ObservationIndex } from '../../lib/observations'
import { studyAreaIndexEntry } from '../../lib/observations'
import type { ExperimentSummary } from '../../lib/experiments'
import type { BackcastArtifact } from '../../lib/backcast'
import type { ProviderId } from '../../lib/explorer'
import { studyAreas, type StudyArea } from '../../lib/regions'

type ReadinessPanelProps = {
  index: ObservationIndex | null
  area: StudyArea
  provider: ProviderId
  dataset: ObservationDataset | null
  summary: ExperimentSummary | null
  backcast?: BackcastArtifact | null
}

export function ReadinessPanel({
  index,
  area,
  provider,
  dataset,
  summary,
  backcast,
}: ReadinessPanelProps) {
  const areaEntry = studyAreaIndexEntry(index, area.id)
  const years = areaEntry?.years ?? []
  const retained = index?.quality_summary.final_retained_record_count
  const areaYears =
    years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : 'no acquired years'

  const rows: Array<{ label: string; status: string; live: boolean }> = [
    {
      label: 'Study-area boundaries',
      status: `Loaded (${studyAreas.length})`,
      live: true,
    },
    {
      label: `${provider === 'sp' ? 'SP historical' : 'NRT'} · ${area.name}`,
      status:
        index === null
          ? 'Not available'
          : areaEntry?.status === 'available'
            ? `Connected · ${areaYears}` +
              (provider === 'sp' && retained !== null && retained !== undefined
                ? ` · ${retained.toLocaleString()} records`
                : '')
            : areaEntry?.status === 'not_acquired'
              ? 'Not acquired for this area'
              : 'Status unknown',
      live: areaEntry?.status === 'available',
    },
    {
      label: 'Selected area-year slice',
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

  const backcastRow = (platform: 'Terra' | 'Aqua') => {
    const info = backcast?.regions[area.id]?.[platform]
    if (!info) {
      return { label: `Pre-2012 backcast · ${platform}`, status: 'Not evaluated', live: false }
    }
    const monthCount = info.supported_months.length + info.limited_months.length
    return {
      label: `Pre-2012 backcast · ${platform}`,
      status: `${info.decision} · ${monthCount}/12 months · ${info.validation_pairs.toLocaleString()} pairs`,
      live: info.decision !== 'UNSUPPORTED',
    }
  }
  rows.push(backcastRow('Terra'), backcastRow('Aqua'))

  return (
    <section
      aria-labelledby="readiness-heading"
      className="card mt-6 p-5"
    >
      <p className="data-label">Data readiness</p>
      <h2 id="readiness-heading" className="mt-1.5 font-display text-xl text-bone">
        Pipeline status
      </h2>
      <ul className="mt-5 divide-y divide-sand/[0.08] border-y border-sand/[0.08]">
        {rows.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-3 py-3">
            <span className="text-support leading-snug text-ash-light">{item.label}</span>
            <span
              className={`shrink-0 text-right text-support leading-tight ${
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
          <p className="data-label">
            Reliability strata (area × month)
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
                className="flex items-center justify-between rounded-lg border border-sand/[0.08] bg-ink-900 px-2.5 py-2"
              >
                <span className="text-support leading-none text-ash">{label}</span>
                <span className="font-mono text-support text-bone">{counts[key] ?? 0}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-support leading-relaxed text-ash-dark">
            Reliable = enough observations (30+) and strong agreement to trust that area-month's
            estimate; caution = some evidence; insufficient = never shown as a value; unavailable =
            no sensor coverage. A reliable stratum does not validate the harmonization method — the
            Method Court verdict stays inconclusive. These strata are computed separately for each
            of the six study areas; a project-wide score is never substituted for a weak region.
          </p>
        </div>
      )}

      <p className="mt-4 text-support leading-relaxed text-ash-dark">
        Missing observations are never treated as zero. Raw MODIS and VIIRS counts remain separate
        from harmonized estimates. VIIRS is the reference scale, not ground truth.
      </p>
    </section>
  )
}
