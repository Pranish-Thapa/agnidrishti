import { StatusBadge } from '../ui/StatusBadge'
import type { CourtMetrics, ExperimentSummary } from '../../lib/experiments'
import { studyAreas } from '../../lib/regions'

const METHODS = [
  {
    id: 'ratio',
    label: 'Ratio-based correction',
    description: 'One VIIRS/MODIS ratio per district, applied to every month.',
  },
  {
    id: 'quantile_mapping',
    label: 'Quantile mapping',
    description: 'Matches the full distribution of MODIS counts to the VIIRS distribution.',
  },
  {
    id: 'monthly_shrinkage',
    label: 'Monthly shrinkage',
    description: 'A separate ratio per month, pulled toward the district ratio when a month is thin.',
  },
] as const

type MethodComparisonProps = {
  summary: ExperimentSummary | null
  /** Selected study area. Omit for the project-wide comparison. */
  areaId?: string
  compact?: boolean
  showRegionTable?: boolean
}

function metric(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? '—' : value.toFixed(digits)
}

function leader(
  metricKey: 'mae' | 'rmse' | 'ccc' | 'mean_bias',
  blocks: Array<{ id: string; metrics: CourtMetrics }>,
): string | null {
  const valid = blocks.filter((entry) => entry.metrics[metricKey] !== null)
  if (valid.length < 2) return null
  const sorted = [...valid].sort((a, b) => {
    const av = a.metrics[metricKey] as number
    const bv = b.metrics[metricKey] as number
    if (metricKey === 'ccc') return bv - av
    if (metricKey === 'mean_bias') return Math.abs(av) - Math.abs(bv)
    return av - bv
  })
  const best = sorted[0]
  const second = sorted[1]
  const bestValue = best.metrics[metricKey] as number
  const secondValue = second.metrics[metricKey] as number
  const decisive =
    metricKey === 'ccc'
      ? bestValue - secondValue >= 0.02
      : metricKey === 'mean_bias'
        ? Math.abs(secondValue) - Math.abs(bestValue) >= 0.1
        : secondValue - bestValue >= 0.1
  return decisive ? best.id : null
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="data-label">{label}</p>
      <p className="mt-1 font-mono text-support text-bone">{value}</p>
    </div>
  )
}

export function MethodComparison({
  summary,
  areaId,
  compact = false,
  showRegionTable = false,
}: MethodComparisonProps) {
  const area = areaId ? studyAreas.find((entry) => entry.id === areaId) : undefined
  // Regional evidence exists when this study area has its own by-region method
  // metrics. Validation is fitted per region, so a region is never shown
  // another region's ranking.
  const hasRegionalEvidence = Boolean(
    summary?.court.by_district?.monthly_shrinkage?.[areaId ?? ''],
  )
  const showComparison = !areaId || hasRegionalEvidence
  const areaHeldOut = areaId
    ? summary?.court.by_district?.monthly_shrinkage?.[areaId]?.n
    : undefined
  const evidence = summary?.court.decision.evidence as
    | {
        method_beats_baseline?: { difference: number; ci: [number, number] }
        district_ccc_spread?: number
      }
    | undefined
  const baselineDiff = evidence?.method_beats_baseline
  const cccSpread = evidence?.district_ccc_spread

  return (
    <section
      aria-labelledby="method-comparison-heading"
      className={`card ${compact ? 'mt-6 px-5 py-5' : 'mt-4 px-5 py-5 sm:px-6 sm:py-6'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-ash">Evidence, not a forced winner</p>
          <h2
            id="method-comparison-heading"
            className={`mt-2 font-display text-bone ${compact ? 'text-xl' : 'text-2xl'}`}
          >
            Which harmonization method performed best?
          </h2>
        </div>
        <StatusBadge tone="neutral">
          {showComparison && summary ? 'Verdict: inconclusive' : 'Insufficient evidence'}
        </StatusBadge>
      </div>

      <p className="mt-3 max-w-3xl text-support leading-relaxed text-ash">
        {area ? (
          <>
            Showing <strong className="text-ash-light">{area.name}</strong>.{' '}
          </>
        ) : null}
        The Method Court fitted each method on the same training data and scored it on the same
        held-out district-days. Lower error is better; higher agreement (CCC) is better; bias closer
        to zero is better. A method is only called best when those measures agree.
      </p>

      {!summary ? (
        <p className="mt-4 text-support leading-relaxed text-ash-dark">
          Validation results are not available in this deployment.
        </p>
      ) : !showComparison ? (
        <div className="mt-4 rounded-xl border border-sand/[0.14] bg-ink-900/60 px-4 py-4">
          <p className="text-body-sm font-medium text-bone">
            Not enough evidence to rank methods for {area?.name ?? 'this area'}.
          </p>
          <p className="mt-2 text-support leading-relaxed text-ash">
            No independent held-out validation exists for this region, so another region&apos;s
            ranking is deliberately not reused here. Historical MODIS and VIIRS observations are
            still shown in the Explorer; the harmonized layer is unavailable where no validation
            evidence exists.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {METHODS.map((method) => {
              const metrics = summary.court.metrics[method.id]
              if (!metrics) return null
              const blocks = METHODS.flatMap((entry) => {
                const metrics = summary.court.metrics[entry.id]
                return metrics ? [{ id: entry.id, metrics }] : []
              })
              const lowestMae = leader('mae', blocks)
              const highestCcc = leader('ccc', blocks)
              const smallestBias = leader('mean_bias', blocks)
              return (
                <div
                  key={method.id}
                  className="rounded-xl border border-sand/[0.12] bg-ink-900/60 px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-body-sm font-medium text-bone">{method.label}</p>
                    <StatusBadge tone="neutral">Inconclusive</StatusBadge>
                  </div>
                  <p className="mt-1.5 text-support leading-relaxed text-ash">
                    {method.description}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MetricCell label="MAE (detections)" value={metric(metrics.mae)} />
                    <MetricCell label="RMSE" value={metric(metrics.rmse)} />
                    <MetricCell label="Mean bias" value={metric(metrics.mean_bias)} />
                    <MetricCell label="Agreement (CCC)" value={metric(metrics.ccc, 3)} />
                  </div>
                  <p className="mt-2 text-support text-ash-dark">
                    log-RMSE {metric(metrics.log_rmse)} · Pearson {metric(metrics.pearson, 3)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {lowestMae === method.id && (
                      <span className="chip text-meta">Lowest MAE — one metric</span>
                    )}
                    {highestCcc === method.id && (
                      <span className="chip text-meta">Highest CCC</span>
                    )}
                    {smallestBias === method.id && (
                      <span className="chip text-meta">Smallest bias</span>
                    )}
                  </div>
                  {!compact && (
                    <p className="mt-2 text-support text-ash-dark">
                      n = {metrics.n.toLocaleString()} held-out district-days
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl border border-amber/25 bg-amber/[0.06] px-4 py-4">
            <p className="text-body-sm font-medium text-bone">
              No single method can be confidently identified as the most reliable.
            </p>
            <ul className="mt-2 space-y-1.5 text-support leading-relaxed text-ash">
              <li>
                — Quantile mapping has the lowest MAE ({metric(summary.court.metrics.quantile_mapping?.mae)})
                and RMSE, but the largest bias (
                {metric(summary.court.metrics.quantile_mapping?.mean_bias)}) and the weakest
                agreement (CCC {metric(summary.court.metrics.quantile_mapping?.ccc, 3)}).
              </li>
              <li>
                — Monthly shrinkage and ratio correction keep bias near zero and agree slightly
                better (CCC {metric(summary.court.metrics.monthly_shrinkage?.ccc, 3)} and{' '}
                {metric(summary.court.metrics.ratio?.ccc, 3)}), but their error is not decisively
                lower.
              </li>
              <li>
                — A constant-ratio baseline with no monthly model remains competitive.
                {baselineDiff ? (
                  <>
                    {' '}
                    Monthly shrinkage differs from that baseline by {metric(baselineDiff.difference, 3)}{' '}
                    (90% interval {metric(baselineDiff.ci[0], 3)} to {metric(baselineDiff.ci[1], 3)}).
                    The interval spans zero, so the two are statistically indistinguishable.
                  </>
                ) : null}
              </li>
              <li>
                — Performance is not stable across study areas
                {cccSpread !== undefined ? ` (CCC spread ${metric(cccSpread, 2)})` : ''}. A ranking
                that is true for Banke is not automatically true for Shan.
              </li>
            </ul>
            <p className="mt-3 text-support leading-relaxed text-ash">
              That is why the Explorer labels every harmonized value <em>provisional</em>. The
              calendar shows raw MODIS and VIIRS layers alongside the estimate, and each value
              carries its evidence status.
            </p>
          </div>

          {areaId && summary.court.by_district?.['monthly_shrinkage']?.[areaId] && (
            <div className="mt-4 overflow-x-auto">
              <p className="text-support font-medium text-bone">
                This study area, method by method
              </p>
              <table className="mt-2 w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-sand/[0.12]">
                    <th className="py-2 pr-4 font-mono text-meta font-normal text-ash-dark">
                      Method
                    </th>
                    <th className="py-2 pr-4 font-mono text-meta font-normal text-ash-dark">MAE</th>
                    <th className="py-2 pr-4 font-mono text-meta font-normal text-ash-dark">Bias</th>
                    <th className="py-2 font-mono text-meta font-normal text-ash-dark">CCC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand/[0.08]">
                  {METHODS.map((method) => {
                    const metrics = summary.court.by_district?.[method.id]?.[areaId]
                    if (!metrics) return null
                    return (
                      <tr key={method.id}>
                        <th className="py-2.5 pr-4 text-left text-support font-normal text-ash-light">
                          {method.label}
                        </th>
                        <td className="py-2.5 pr-4 font-mono text-support text-ash-light">
                          {metric(metrics.mae)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-support text-ash-light">
                          {metric(metrics.mean_bias)}
                        </td>
                        <td className="py-2.5 font-mono text-support text-ash-light">
                          {metric(metrics.ccc, 3)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-support text-ash-dark">
                Held-out sample: {areaHeldOut?.toLocaleString() ?? '—'} region-days across{' '}
                {summary.validation.validation_years.join(' and ')}, with a{' '}
                {summary.validation.purge_days}-day purge between training and validation.
              </p>
            </div>
          )}

          {showRegionTable && (
            <div className="mt-5 overflow-x-auto">
              <p className="text-support font-medium text-bone">By study area</p>
              <table className="mt-2 w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-sand/[0.12]">
                    <th className="py-2 pr-4 font-mono text-meta font-normal text-ash-dark">
                      Study area
                    </th>
                    <th className="py-2 pr-4 font-mono text-meta font-normal text-ash-dark">
                      Validation
                    </th>
                    <th className="py-2 font-mono text-meta font-normal text-ash-dark">
                      Method ranking
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand/[0.08]">
                  {studyAreas.map((entry) => {
                    const nepal = entry.countryCode === 'NPL'
                    return (
                      <tr key={entry.id}>
                        <th className="py-2.5 pr-4 text-left text-support font-normal text-ash-light">
                          {entry.name}
                          <span className="text-ash-dark"> · {entry.country}</span>
                        </th>
                        <td className="py-2.5 pr-4 text-support text-ash">
                          {nepal ? 'Held-out district-days' : 'No independent validation'}
                        </td>
                        <td className="py-2.5 text-support text-ash">
                          {nepal ? 'Inconclusive — no forced winner' : 'Not enough evidence to rank'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-support leading-relaxed text-ash-dark">
                Regional independence: the Nepal result is not transferred to Thailand, Indonesia or
                Myanmar. Those study areas have genuine historical observations but no validated
                harmonization model.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
