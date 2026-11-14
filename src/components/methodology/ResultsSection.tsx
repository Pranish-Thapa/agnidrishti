import { useEffect, useState } from 'react'
import { StatusBadge } from '../ui/StatusBadge'
import {
  loadExperimentSummary,
  type CourtMetrics,
  type ExperimentSummary,
} from '../../lib/experiments'

const methodLabels: Record<string, string> = {
  ratio: 'Ratio-based correction',
  quantile_mapping: 'Quantile mapping',
  monthly_shrinkage: 'Monthly shrinkage',
}

const metricHeaders: Array<[keyof CourtMetrics, string]> = [
  ['mae', 'MAE'],
  ['rmse', 'RMSE'],
  ['mean_bias', 'Bias'],
  ['pearson', 'Pearson'],
  ['ccc', 'CCC'],
]

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number(value).toFixed(3)
}

export function ResultsSection() {
  const [summary, setSummary] = useState<ExperimentSummary | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadExperimentSummary(controller.signal).then(setSummary)
    return () => controller.abort()
  }, [])

  if (!summary) {
    return (
      <div className="border border-sand/[0.12] bg-ink-850 p-5">
        <p className="text-[12px] leading-relaxed text-ash-dark">
          Experiment summary is not available in this deployment. Run{' '}
          <code className="font-mono text-[11px] text-ash-light">python -m pipeline validate</code>{' '}
          to publish it.
        </p>
      </div>
    )
  }

  const { court, validation, reliability } = summary
  const decision = court.decision

  return (
    <div className="space-y-8">
      {/* Method Court */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-xl text-bone">Method Court — validation metrics</h3>
          <StatusBadge tone={decision.outcome === 'selected' ? 'active' : 'neutral'}>
            {decision.outcome === 'inconclusive' ? 'Verdict: inconclusive' : decision.outcome}
          </StatusBadge>
        </div>
        <p className="mt-2 max-w-[640px] text-[12px] leading-relaxed text-ash">
          All three methods were fitted on identical training years ({validation.validation_years.join(', ')}{' '}
          held out with a {validation.purge_days}-day purge) and evaluated on the identical
          validation sample of {validation.validation_pairs.toLocaleString()} district-days. The
          remaining {validation.purge_pairs?.toLocaleString() ?? '360'} of{' '}
          {validation.total_pairs?.toLocaleString() ?? '16,386'} pairs are purge-gap days
          excluded from both phases to prevent temporal leakage. No winner is declared: the
          confidence intervals of the leading methods overlap and performance is unstable across
          districts.
        </p>
        <div className="mt-4 overflow-x-auto border border-sand/10" role="region" aria-label="Method Court metrics table" tabIndex={0}>
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-sand/10 bg-sand/[0.03]">
                <th className="px-4 py-3 font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-ash-dark">
                  Method
                </th>
                {metricHeaders.map(([key, label]) => (
                  <th key={key} className="px-4 py-3 font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-ash-dark">
                    {label}
                  </th>
                ))}
                <th className="px-4 py-3 font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-ash-dark">
                  n
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/[0.08] text-[12px]">
              {court.ranking.map((method, rank) => {
                const metrics = court.metrics[method]
                return (
                  <tr key={method}>
                    <th className="px-4 py-3.5 text-left font-normal text-ash-light">
                      <span className="font-mono text-[9px] text-ash-dark">{rank + 1}.</span>{' '}
                      {methodLabels[method] ?? method}
                    </th>
                    {metricHeaders.map(([key]) => (
                      <td key={key} className="px-4 py-3.5 font-mono text-[11px] text-ash-light">
                        {formatMetric(metrics[key])}
                      </td>
                    ))}
                    <td className="px-4 py-3.5 font-mono text-[11px] text-ash-dark">{metrics.n}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ash-dark">
          {decision.note ?? decision.justification}
        </p>
      </div>

      {/* Reliability */}
      <div>
        <h3 className="font-display text-xl text-bone">Reliability strata (district × month)</h3>
        <p className="mt-2 max-w-[640px] text-[12px] leading-relaxed text-ash">
          Derived from documented criteria (sample size, agreement, bias), not arbitrary labels. A
          stratum marked insufficient is never displayed as a value in the explorer.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-px border border-sand/10 bg-sand/10 sm:grid-cols-4">
          {(
            [
              ['reliable', 'Reliable'],
              ['use_with_caution', 'Use with caution'],
              ['insufficient_evidence', 'Insufficient evidence'],
              ['unavailable', 'Unavailable'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="bg-ink-850 p-4">
              <p className="font-display text-3xl leading-none text-bone">
                {reliability.category_counts[key] ?? 0}
              </p>
              <p className="mt-2 text-[11px] leading-snug text-ash">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 text-[11px] leading-relaxed text-ash-dark">
          <p><span className="text-ash-light">Reliable</span> — enough comparable observations (&ge; 30) and strong agreement (CCC &ge; 0.50) to trust the estimate for that district-month.</p>
          <p><span className="text-ash-light">Use with caution</span> — some evidence (&ge; 10 pairs, CCC &ge; 0.30); treat the number as indicative.</p>
          <p><span className="text-ash-light">Insufficient evidence</span> — too few observations to say anything; never shown as a value.</p>
          <p><span className="text-ash-light">Unavailable</span> — the sensor did not cover that month at all.</p>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ash-dark">
          District evidence is not equal: Chitwan's validation CCC (0.19–0.34 across methods) is well
          below Banke and Bardiya (~0.5–0.63), so Chitwan strata grade lower in the grid. A
          "reliable" stratum describes the observational evidence for that district-month — it does
          not validate the harmonization method itself, whose Method Court verdict remains
          inconclusive.
          {reliability.weak_years.length > 0 &&
            ` Leave-one-year-out audit flagged these years below the caution threshold: ${reliability.weak_years.join(', ')}.`}
        </p>
      </div>

      {/* Seam Audit */}
      {summary.seam_audit && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-xl text-bone">Seam Audit — the observation gap</h3>
            <StatusBadge tone="neutral">Diagnostic · not proof of causation</StatusBadge>
          </div>
          <p className="mt-2 max-w-[640px] text-[12px] leading-relaxed text-ash">
            At the very start of the joint record (Feb–Apr 2012), VIIRS recorded{' '}
            <strong className="text-ash-light">many times more detections</strong> than MODIS in the
            same districts. Each pair of bars shows one district's MODIS platform: the long bar is
            the raw VIIRS/MODIS scale step; the short bar is what remains after harmonization.
          </p>
          <div className="mt-4 space-y-2">
            {summary.seam_audit.scale_step_analysis.map((row) => {
              const afterEntry = Object.entries(row).find(([k]) => k.startsWith('scale_step_after_'))
              const after = (afterEntry?.[1] ?? null) as number | null
              const methodName = afterEntry?.[0]?.replace('scale_step_after_', '')
              const reductionEntry = Object.entries(row).find(([k]) => k.startsWith('step_reduction_'))
              const reduction = (reductionEntry?.[1] ?? null) as number | null
              const raw = row.raw_scale_step_viirs_over_modis
              const widthRaw = Math.min(100, (raw / 50) * 100)
              const widthAfter = after ? Math.min(100, (after / 50) * 100) : 0
              return (
                <div
                  key={`${row.district_id}-${row.modis_platform}`}
                  className="border border-sand/[0.08] bg-ink-900 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ash-light">
                      {row.district_id.replace('NP-', '')} · MODIS {row.modis_platform}
                    </p>
                    <p className="font-mono text-[9px] text-ash-dark">
                      raw {raw.toFixed(1)}x → {after?.toFixed(2)}x after {methodName ?? 'harmonization'}
                      {reduction !== null && reduction !== undefined
                        ? ` · ${reduction.toFixed(1)}% of the gap closed`
                        : ''}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1" aria-hidden="true">
                    <div className="h-2.5 w-full bg-sand/[0.05]">
                      <div
                        className="h-full"
                        style={{ width: `${widthRaw}%`, background: 'rgba(166, 93, 63, 0.75)' }}
                      />
                    </div>
                    <div className="h-2.5 w-full bg-sand/[0.05]">
                      <div
                        className="h-full"
                        style={{ width: `${Math.max(widthAfter, 1)}%`, background: 'rgba(210, 138, 76, 0.85)' }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 border-l border-sand/50 pl-4">
            <p className="text-[12px] leading-relaxed text-ash">
              A residual step of roughly 0.8–2.1 remains even after the best correction: harmonization
              reduces the observation gap, it does not eliminate sensor differences. Weather, real fire
              change, overpass timing, clouds and product versions are alternative contributors — this
              audit can never prove that a satellite transition caused a recorded change. In the
              acquired record the MODIS product version itself also changes (6.03 → 61.03, 2022→2023),
              a second seam inside a single mission.
            </p>
          </div>
        </div>
      )}

      {/* Lights-Out Backtest */}
      {summary.lights_out && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-xl text-bone">
              Lights-Out Backtest — rebuilding withheld years
            </h3>
            <StatusBadge tone="active">Held-out validation</StatusBadge>
          </div>
          <p className="mt-2 max-w-[640px] text-[12px] leading-relaxed text-ash">
            The methods were fitted with <strong className="text-ash-light">no access to 2019 and
            2022</strong>, then asked to rebuild those years from MODIS alone. The paired bars show
            the reference VIIRS monthly totals (amber) against the reconstruction (terracotta) for
            the top-ranked method, per held-out year.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Object.entries(summary.lights_out.by_method[summary.court.ranking[0]] ?? {}).map(
              ([year, block]) => {
                const maxV =
                  Math.max(
                    ...block.monthly_profile.map((r) =>
                      Math.max(r.reference_total, r.reconstructed_total),
                    ),
                  ) || 1
                return (
                  <div key={year} className="border border-sand/[0.08] bg-ink-900 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ash-light">
                        Held-out year {year}
                      </p>
                      <p className="font-mono text-[9px] text-ash-dark">
                        CCC {block.overall.ccc?.toFixed(3)} · MAE {block.overall.mae?.toFixed(2)}
                      </p>
                    </div>
                    <div className="mt-3 flex h-24 items-end gap-1" aria-hidden="true">
                      {block.monthly_profile.map((row) => (
                        <div key={row.month} className="flex min-w-0 flex-1 flex-col justify-end gap-px">
                          <div
                            className="w-full bg-amber/[0.85]"
                            style={{ height: `${(row.reference_total / maxV) * 100}%` }}
                          />
                          <div
                            className="w-full bg-terracotta/[0.7]"
                            style={{ height: `${(row.reconstructed_total / maxV) * 100}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.1em] text-ash-dark">
                      profile r = {block.profile_correlation?.toFixed(3)} · variation ratio{' '}
                      {block.variation_ratio_pred_over_ref?.toFixed(2)} (≈1 preserves real swings;
                      far below 1 = over-smoothed)
                    </p>
                  </div>
                )
              },
            )}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ash">
            Across methods: profile correlation 0.97–1.00 — the seasonal shape survives. Quantile
            mapping has the lowest MAE but the lowest variation ratio too (0.26–0.43): it flattens
            real swings, which is exactly why low error alone did not win the Method Court. Ratio and
            monthly shrinkage keep variation close to the reference (0.77–1.31). These are held-out
            results only; training-period performance is never shown as validation.
          </p>
        </div>
      )}

      {/* Scope limitation */}
      <div className="border-l border-sand/50 pl-4">
        <p className="text-[12px] leading-relaxed text-ash">
          Scope reminder: the harmonized record covers January–June 2012–2026 plus July 2026.
          August–December was not acquired and supports no claim. VIIRS is the reference scale, not
          ground truth; harmonized values are VIIRS-equivalent estimates with residual bias
          reported above. Detections are not unique fires.
        </p>
      </div>
    </div>
  )
}
