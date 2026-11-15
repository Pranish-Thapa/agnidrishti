import { useEffect, useState } from 'react'
import { loadBackcast, type BackcastArtifact, type BackcastPlatform } from '../../lib/backcast'
import { studyAreas } from '../../lib/regions'
import { StatusBadge } from '../ui/StatusBadge'

const tone: Record<string, 'active' | 'planned' | 'neutral'> = {
  SUPPORTED: 'active',
  LIMITED: 'planned',
  UNSUPPORTED: 'neutral',
}

const monthLabel = (month: string) =>
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    Number(month) - 1
  ] ?? month

function decisionSummary(info: BackcastPlatform | undefined): string {
  if (!info) return 'Not evaluated'
  const months = [...info.supported_months, ...info.limited_months].sort()
  if (months.length === 0) return `${info.decision} · no month supported`
  return `${info.decision} · ${months.map(monthLabel).join(', ')}`
}

/**
 * Pre-2012 transferability panel. It shows the actual decisions produced by
 * `python -m pipeline backcast`; nothing here is hand-entered. A region whose
 * evidence is unsupported keeps raw MODIS and is labelled as such.
 */
export function TransferabilitySection() {
  const [artifact, setArtifact] = useState<BackcastArtifact | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    loadBackcast(controller.signal)
      .then(setArtifact)
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  if (loading) {
    return <div className="h-16 animate-pulse rounded-lg bg-sand/[0.05]" aria-hidden="true" />
  }
  if (!artifact) {
    return (
      <p className="text-support leading-relaxed text-ash">
        The pre-2012 transferability artifact is not available in this build. No historical
        VIIRS-equivalent estimates are shown without it; raw MODIS remains available.
      </p>
    )
  }

  const anyInconclusive = Object.values(artifact.regions).some((platforms) =>
    Object.values(platforms).some((info) => info && !info.confident_winner),
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden rounded-panel border border-sand/[0.1] bg-sand/10 sm:grid-cols-3">
        {[
          ['Calibration window', `${artifact.calibration_period.start} → ${artifact.calibration_period.end ?? '—'}`],
          ['Reference', 'VIIRS Suomi-NPP (scale, not ground truth)'],
          ['Method', `${artifact.method} · ${artifact.calibration_version}`],
        ].map(([label, value]) => (
          <div key={label} className="bg-ink-850 p-4">
            <p className="font-mono text-meta tracking-[0.02em] text-ash-dark">{label}</p>
            <p className="mt-2 text-support leading-relaxed text-ash-light">{value}</p>
          </div>
        ))}
      </div>

      <div
        className="card overflow-x-auto"
        role="region"
        aria-label="Pre-2012 backcast decisions by region and platform"
        tabIndex={0}
      >
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr className="border-b border-sand/10 bg-sand/[0.03]">
              <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-dark">
                Study area
              </th>
              <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-light">
                Terra
              </th>
              <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-light">
                Aqua
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand/[0.08]">
            {studyAreas.map((area) => {
              const terra = artifact.regions[area.id]?.Terra
              const aqua = artifact.regions[area.id]?.Aqua
              return (
                <tr key={area.id}>
                  <td className="px-4 py-3 text-support text-ash-light">{area.name}</td>
                  {[terra, aqua].map((info, index) => (
                    <td key={index} className="px-4 py-3 align-top">
                      <StatusBadge tone={tone[info?.decision ?? 'UNSUPPORTED'] ?? 'neutral'}>
                        {info?.decision ?? 'NOT EVALUATED'}
                      </StatusBadge>
                      <p className="mt-2 text-support leading-relaxed text-ash">
                        {decisionSummary(info)}
                      </p>
                      {info && (
                        <p className="mt-1 font-mono text-meta text-ash-dark">
                          held-out CCC {info.transferability.forward_ccc?.toFixed(2) ?? '—'} /{' '}
                          {info.transferability.backward_ccc?.toFixed(2) ?? '—'} (early→late /
                          late→early)
                        </p>
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-r-lg border-l-2 border-ember/50 pl-4">
        <p className="text-body-sm leading-[1.8] text-bone/85">
          {anyInconclusive
            ? 'No single harmonization method can be confidently identified as the most reliable for every region. The Method Court and the blocked transferability tests are reported separately.'
            : 'A regional method separated from the alternatives on identical held-out blocks; the regional decision is shown above rather than a universal winner.'}
        </p>
        <p className="mt-2 text-support leading-relaxed text-ash">
          The post-2012 reference record covers January–June (plus July 2026). July–December
          historical months therefore have no overlap evidence and remain raw MODIS; no
          VIIRS-equivalent value is manufactured to fill them. 2000–2001 is Terra-only, and no
          Aqua calibration is applied where Aqua did not observe.
        </p>
      </div>
    </div>
  )
}
