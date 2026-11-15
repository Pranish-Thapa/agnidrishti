import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../ui/StatusBadge'
import type { ObservationDataset } from '../../lib/observations'

type CriticalPeriodsPanelProps = {
  dataset: ObservationDataset | null
}

/**
 * Descriptive highlights computed from the real selected dataset only.
 * These are NOT anomaly detections: no statistical test runs here, so no
 * "unusual activity" claim is made. The distribution comparison is purely
 * descriptive (ranks and medians), never a significance statement.
 */
export function CriticalPeriodsPanel({ dataset }: CriticalPeriodsPanelProps) {
  const stats = useMemo(() => {
    if (!dataset) return null
    // Reference-platform weekly detections across covered weeks with a value.
    // Suomi-NPP is preferred; before 2012 it did not exist, so those years use
    // the MODIS platforms that actually observed. The platform used is always
    // stated — a MODIS peak is never presented as a VIIRS result.
    const weekValues: {
      weekStart: string
      weekEnd: string
      detections: number
      platform: string
    }[] = []
    for (const week of dataset.weeks) {
      const snpp = week.by_sensor.viirs_snpp?.platforms['Suomi-NPP']
      const modis = week.by_sensor.modis?.platforms ?? {}
      const terra = modis['Terra']
      const aqua = modis['Aqua']
      const modisDays = (terra?.days_observed ?? 0) + (aqua?.days_observed ?? 0)
      if (snpp && (snpp.days_observed ?? 0) > 0) {
        weekValues.push({
          weekStart: week.week_start,
          weekEnd: week.week_end,
          detections: snpp.detections ?? 0,
          platform: 'Suomi-NPP',
        })
      } else if (modisDays > 0) {
        weekValues.push({
          weekStart: week.week_start,
          weekEnd: week.week_end,
          detections: (terra?.detections ?? 0) + (aqua?.detections ?? 0),
          platform: 'MODIS Terra+Aqua',
        })
      }
    }
    if (weekValues.length === 0) return null

    const platforms = Array.from(new Set(weekValues.map((entry) => entry.platform)))
    const platformLabel =
      platforms.length === 1
        ? platforms[0]
        : 'Suomi-NPP (MODIS where VIIRS did not observe)'
    const sorted = [...weekValues].sort((a, b) => a.detections - b.detections)
    const peak = weekValues.reduce((best, w) => (w.detections > best.detections ? w : best))
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2].detections
        : (sorted[sorted.length / 2 - 1].detections + sorted[sorted.length / 2].detections) / 2
    const weeksAboveZero = sorted.filter((w) => w.detections > 0).length
    // Descriptive rank of the peak among observed weeks (1 = highest).
    const rank = sorted.length - sorted.findIndex((w) => w.detections === peak.detections)
    const weeksBelowQuarter = sorted.filter((w) => w.detections < peak.detections / 4).length
    return {
      peak,
      median,
      observedWeeks: sorted.length,
      weeksAboveZero,
      rank,
      weeksBelowQuarter,
      sharePositive: Math.round((weeksAboveZero / sorted.length) * 100),
      platformLabel,
    }
  }, [dataset])

  const coverage = useMemo(() => {
    if (!dataset) return null
    const observedDays = dataset.days.filter(
      (day) => day.status === 'observed' || day.status === 'observed_zero',
    ).length
    return { observedDays, totalDays: dataset.days.length }
  }, [dataset])

  const rows: Array<[string, string]> = stats
    ? [
        [
          `Highest recorded week (${stats.platformLabel})`,
          `${stats.peak.detections.toLocaleString()} · ${stats.peak.weekStart} → ${stats.peak.weekEnd}`,
        ],
        [
          'Rank among observed weeks (descriptive)',
          `${stats.rank} of ${stats.observedWeeks} observed weeks`,
        ],
        [
          `Median observed week (${stats.platformLabel})`,
          `${Math.round(stats.median * 10) / 10} detections`,
        ],
        [
          'Weeks with any detections',
          `${stats.weeksAboveZero} of ${stats.observedWeeks} (${stats.sharePositive}%)`,
        ],
        [
          'Weeks below a quarter of the peak',
          `${stats.weeksBelowQuarter} of ${stats.observedWeeks}`,
        ],
        [
          'Observation coverage (this district-year)',
          coverage ? `${coverage.observedDays}/${coverage.totalDays} days observed` : '—',
        ],
        ['Seam audit', 'Diagnostic only · see methodology'],
        ['Method agreement', 'Inconclusive · see methodology'],
      ]
    : [
        ['Highest recorded week (reference platform)', 'No observations for this selection'],
        ['Observation coverage', coverage ? `${coverage.observedDays}/${coverage.totalDays} days` : '—'],
        ['Seam audit', 'Diagnostic only · see methodology'],
        ['Method agreement', 'Inconclusive · see methodology'],
      ]

  return (
    <section
      aria-labelledby="critical-heading"
      className="card mt-6 overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand/[0.08] px-5 py-4 sm:px-6">
        <h2 id="critical-heading" className="font-display text-xl text-bone">
          Record highlights
        </h2>
        <StatusBadge tone="neutral">Descriptive — not a statistical anomaly test</StatusBadge>
      </div>
      <div className="divide-y divide-sand/[0.08]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 px-5 py-3 sm:px-6"
          >
            <span className="text-support text-ash-light">{label}</span>
            <span className="text-right font-mono text-meta tracking-[0.02em] text-ash-dark">
              {value}
            </span>
          </div>
        ))}
      </div>
      <p className="border-t border-sand/[0.08] px-5 py-4 text-support leading-relaxed text-ash-dark sm:px-6">
        {stats
          ? `Why the peak week is highlighted: it recorded the largest ${stats.platformLabel} weekly total of the ${stats.observedWeeks} observed weeks — a descriptive rank, not the result of an outlier test. Weeks with observations but no detections are counted as real observed zeros; weeks without observations are excluded from these statistics entirely. Before 2012 the reference is MODIS, because Suomi-NPP did not yet exist.`
          : 'No statistical anomaly detection is claimed in this build. A high week is the highest recorded value, not proof of an exceptional fire season. Before 2012 the reference platform is MODIS, because Suomi-NPP did not yet exist.'}{' '}
        Validation findings and their limits are described on the{' '}
        <Link
          to="/methodology"
          className="text-ash-light underline decoration-sand/30 underline-offset-2 hover:text-bone"
        >
          methodology page
        </Link>
        .
      </p>
    </section>
  )
}
