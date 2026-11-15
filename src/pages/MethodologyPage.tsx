import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Reveal } from '../components/ui/Reveal'
import { StatusBadge } from '../components/ui/StatusBadge'
import { limitations, methods, validationChecks } from '../lib/content'
import { ResultsSection } from '../components/methodology/ResultsSection'
import { HarmonizationScope } from '../components/methodology/HarmonizationScope'
import { TransferabilitySection } from '../components/methodology/TransferabilitySection'
import { externalLinks } from '../lib/site'

type MethodSectionProps = {
  id: string
  index: string
  title: string
  intro: ReactNode
  children: ReactNode
}

const toc = [
  ['observation', '01', 'The observation problem'],
  ['harmonization', '02', 'Why harmonization'],
  ['corrections', '03', 'Correction methods'],
  ['validation', '04', 'Overlap validation'],
  ['transferability', '05', 'Pre-2012 transferability'],
  ['results', '06', 'Results & reliability'],
  ['uncertainty', '07', 'Uncertainty'],
  ['limitations', '08', 'Known limitations'],
  ['provenance', '09', 'Data provenance'],
] as const

const sensorComparison = [
  {
    attribute: 'Nominal pixel',
    modis: 'Approximately 1 km',
    viirs: 'Approximately 375 m (I-band)',
  },
  {
    attribute: 'Record',
    modis: 'Longer historical span',
    viirs: 'Finer-scale reference record',
  },
  {
    attribute: 'Small-fire sensitivity',
    modis: 'May miss small or cooler hotspots',
    viirs: 'Better able to resolve small and cooler hotspots',
  },
  {
    attribute: 'Comparison role',
    modis: 'Historical series to be corrected',
    viirs: 'Reference scale for harmonization',
  },
] as const

const dataSources = [
  {
    input: 'MODIS active fire',
    product: 'MOD14 / MYD14 C6.1 via FIRMS SP (Terra from 2000-11; Aqua from 2002-05)',
    status: 'Connected · 2000–2026',
    muted: false,
  },
  {
    input: 'VIIRS 375 m active fire',
    product: 'VNP14IMG family via FIRMS SP (S-NPP from 2012; NOAA-20 from 2018; NOAA-21 from 2023)',
    status: 'Connected · 2012–2026 (reference)',
    muted: false,
  },
  {
    input: 'Attribution',
    product: 'NASA FIRMS / LANCE — data used as distributed; no NASA endorsement',
    status: 'Attributed',
    muted: false,
  },
] as const

function MethodSection({ id, index, title, intro, children }: MethodSectionProps) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-sand/[0.12] pt-10 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-3">
        <span className="font-mono text-meta tracking-[0.16em] text-ember">{index}</span>
        <span className="h-px w-7 bg-sand/20" aria-hidden="true" />
        <span className="eyebrow">Methodology</span>
      </div>
      <h2 className="display mt-4 text-[clamp(1.9rem,3.2vw,2.8rem)] leading-[1.05] text-bone">
        {title}
      </h2>
      <div className="mt-4 max-w-[680px] body-copy">{intro}</div>
      <div className="mt-8">{children}</div>
    </section>
  )
}

export function MethodologyPage() {
  return (
    <>
      <PageHeader
        index="02"
        label="Methodology"
        title={
          <>
            How the record is made <span className="text-observation-soft">comparable.</span>
          </>
        }
        intro={
          <p>
            MODIS and VIIRS do not measure fire in the same way. This page sets out the observation
            problem, the harmonization approaches that were tested and audited, and the limits of
            what a corrected record can honestly claim.
          </p>
        }
        aside={
          <div className="card w-full max-w-[300px] p-5">
            <p className="eyebrow text-ash-dark">Method status</p>
            <p className="mt-4 font-display text-2xl leading-snug text-bone">
              Computed &amp; audited. Verdict: inconclusive.
            </p>
            <p className="mt-3 text-support leading-relaxed text-ash">
              Three correction methods were fitted and validated on held-out years, then
              independently audited. The evidence does not distinguish them, so no winner is
              declared and the explorer&apos;s harmonized layer is labelled provisional.
            </p>
          </div>
        }
      />

      <div className="border-b border-sand/[0.08] bg-ink-900/60">
        <div className="container-page grid md:grid-cols-2 md:divide-x md:divide-sand/10">
          <div className="py-8 md:pr-10">
            <StatusBadge tone="active">Implemented &amp; verified</StatusBadge>
            <ul className="mt-4 space-y-2 text-support leading-relaxed text-ash-light">
              <li>— Historical SP acquisition: MODIS 2000–2011 plus 2012–2026, sensors kept separate</li>
              <li>— Processing: normalization, QC, exact polygon assignment, 0.1° grid, ISO weeks</li>
              <li>— Explorer calendar on real observations, with missing-data statuses</li>
              <li>— Three harmonization methods fitted, validated on held-out years</li>
              <li>— Blocked pre-2012 transferability tests; per-region/platform/month decisions</li>
              <li>— Independent audit of metrics, separation and leakage</li>
            </ul>
          </div>
          <div className="border-t border-sand/10 py-8 md:border-t-0 md:pl-10">
            <StatusBadge tone="neutral">Not claimed</StatusBadge>
            <ul className="mt-4 space-y-2 text-support leading-relaxed text-ash-light">
              <li>— A validated winning correction method (court verdict: inconclusive)</li>
              <li>— Ground truth, burned area or unique-fire counts</li>
              <li>— Anomaly detection or fire prediction</li>
              <li>— VIIRS-equivalent estimates in months without overlap evidence</li>
              <li>— Coverage claims for August–December post-2012 (not acquired)</li>
            </ul>
          </div>
        </div>
      </div>

      <section className="section-y">
        <div className="container-page grid gap-12 lg:grid-cols-12 lg:gap-16">
          <aside className="min-w-0 lg:col-span-3">
            <div className="lg:sticky lg:top-28">
              <p className="eyebrow text-ash-dark">On this page</p>
              <nav aria-label="Methodology sections" className="mt-4 border-t border-sand/10">
                {toc.map(([id, index, label]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="group flex items-baseline gap-3 border-b border-sand/[0.08] py-3 text-support text-ash transition-colors hover:text-bone"
                  >
                    <span className="font-mono text-meta tracking-[0.12em] text-ash-dark transition-colors group-hover:text-ember">
                      {index}
                    </span>
                    {label}
                  </a>
                ))}
              </nav>

              <div className="mt-8">
                <p className="eyebrow text-ash-dark">Status key</p>
                <div className="mt-3 space-y-2.5">
                  <StatusBadge tone="active">Computed &amp; audited</StatusBadge>
                  <StatusBadge tone="planned">Verdict inconclusive</StatusBadge>
                  <StatusBadge tone="neutral">Provisional estimate</StatusBadge>
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-16 lg:col-span-9">
            <Reveal>
              <MethodSection
                id="observation"
                index="01"
                title="Two sensors, two ways of seeing"
                intro={
                  <p>
                    A fire record is shaped by the instrument that produced it. MODIS and VIIRS
                    differ in spatial resolution, spectral response, saturation behaviour, overpass
                    time and retrieval algorithm. A raw comparison across the transition therefore
                    mixes a change in fire activity with a change in observation capability.
                  </p>
                }
              >
                <div
                  className="card hidden overflow-x-auto sm:block"
                  role="region"
                  aria-label="MODIS and VIIRS observation comparison"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-sand/10 bg-sand/[0.03]">
                        <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-dark">
                          Attribute
                        </th>
                        <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-light">
                          MODIS
                        </th>
                        <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-light">
                          VIIRS
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand/[0.08] text-support leading-relaxed">
                      {sensorComparison.map((row) => (
                        <tr key={row.attribute}>
                          <th className="px-4 py-3.5 text-left font-normal text-ash">
                            {row.attribute}
                          </th>
                          <td className="px-4 py-3.5 text-ash-light">{row.modis}</td>
                          <td className="px-4 py-3.5 text-ash-light">{row.viirs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card divide-y divide-sand/10 overflow-hidden sm:hidden">
                  {sensorComparison.map((row) => (
                    <div key={row.attribute} className="p-4">
                      <p className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                        {row.attribute}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-4">
                        <div>
                          <p className="font-mono text-meta tracking-[0.02em] text-ember/80">
                            MODIS
                          </p>
                          <p className="mt-1.5 text-support leading-relaxed text-ash-light">
                            {row.modis}
                          </p>
                        </div>
                        <div>
                          <p className="font-mono text-meta tracking-[0.02em] text-sand/90">
                            VIIRS
                          </p>
                          <p className="mt-1.5 text-support leading-relaxed text-ash-light">
                            {row.viirs}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-r-lg border-l-2 border-sand/30 pl-4">
                  <p className="text-support leading-relaxed text-ash">
                    A satellite transition is not the only seam. Sensor degradation, orbit drift,
                    product reprocessing, cloud cover and algorithm changes can each alter what the
                    record contains.
                  </p>
                </div>
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="harmonization"
                index="02"
                title="Why harmonization is necessary"
                intro={
                  <p>
                    Harmonization puts historical MODIS observations onto a VIIRS-equivalent scale
                    using the period in which both sensors observed. The result is an estimated
                    comparison series, not a replacement for either raw sensor record.
                  </p>
                }
              >
                <div className="grid gap-px overflow-hidden rounded-panel border border-sand/[0.1] bg-sand/10 sm:grid-cols-2">
                  {[
                    ['Reference', 'VIIRS-equivalent detection scale'],
                    ['Inputs', 'Separate MODIS and VIIRS hot spot records'],
                    ['Learning window', 'Overlap period with both sensors present'],
                    ['Output', 'Estimated comparable series with uncertainty'],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-ink-850 p-4">
                      <p className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                        {label}
                      </p>
                      <p className="mt-2 text-support leading-relaxed text-ash-light">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 space-y-4 text-body-sm leading-[1.8] text-ash">
                  <p>
                    The overlap is the only direct evidence we have about how the two observation
                    systems relate. Any correction learned from that window carries an assumption
                    into the rest of the record: that the learned relationship remains stable
                    enough to be useful.
                  </p>
                  <p>
                    Harmonization can reduce a known inconsistency. It cannot recover fires that
                    neither sensor observed, and it does not turn a detection into ground truth.
                  </p>
                </div>
                <HarmonizationScope />
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="corrections"
                index="03"
                title="Three correction methods, tested separately"
                intro={
                  <p>
                    Agnidrishti compares three approaches rather than committing to a single
                    correction. Each makes a different assumption, and each can fail in a different
                    way. The comparison is part of the evidence, not an afterthought.
                  </p>
                }
              >
                <div className="divide-y divide-sand/[0.12] border-y border-sand/[0.12]">
                  {methods.map((method) => (
                    <article key={method.id} className="py-7">
                      <div className="grid gap-5 lg:grid-cols-12 lg:gap-8">
                        <div className="lg:col-span-4">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-meta tracking-[0.16em] text-ember">
                              {method.index}
                            </span>
                            <StatusBadge tone="active">{method.status}</StatusBadge>
                          </div>
                          <h3 className="mt-3 font-display text-[1.8rem] leading-tight text-bone">
                            {method.name}
                          </h3>
                        </div>
                        <div className="lg:col-span-8">
                          <p className="text-body-sm leading-[1.8] text-ash-light">
                            {method.summary}
                          </p>
                          <div className="mt-4 rounded-lg border border-sand/10 bg-ink-900 px-4 py-3">
                            <p className="font-mono text-body tracking-wide text-bone/90">
                              {method.formula}
                            </p>
                            <p className="mt-1.5 font-mono text-meta tracking-[0.02em] text-ash-dark">
                              Conceptual notation — not a computed result
                            </p>
                          </div>
                          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                              <dt className="font-mono text-meta tracking-[0.02em] text-sand/80">
                                Assumption
                              </dt>
                              <dd className="mt-1.5 text-support leading-relaxed text-ash">
                                {method.assumption}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                                What can go wrong
                              </dt>
                              <dd className="mt-1.5 text-support leading-relaxed text-ash">
                                {method.risk}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="validation"
                index="04"
                title="Why overlap-period validation matters"
                intro={
                  <p>
                    A correction that fits one window is not automatically trustworthy outside it.
                    Validation asks whether the harmonized record survives holdout periods, seam
                    tests and method disagreement — before any trend is presented as credible.
                  </p>
                }
              >
                <div className="grid gap-px overflow-hidden rounded-panel border border-sand/[0.1] bg-sand/10 sm:grid-cols-2">
                  {validationChecks.map((check, index) => (
                    <div key={check.title} className="bg-ink-850 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-meta tracking-[0.14em] text-ember">
                          0{index + 1}
                        </span>
                        <StatusBadge tone="active">{check.status}</StatusBadge>
                      </div>
                      <h3 className="mt-3 text-body-sm font-medium text-bone">{check.title}</h3>
                      <p className="mt-2 text-support leading-relaxed text-ash">
                        {check.description}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-r-lg border-l-2 border-ember/50 pl-4">
                  <p className="text-body-sm leading-[1.8] text-bone/85">
                    Validation has been run on held-out years and independently audited. The
                    results, and the honest limits of what they support, are reported below.
                  </p>
                </div>
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="transferability"
                index="05"
                title="Can the correction be used before 2012?"
                intro={
                  <p>
                    A relationship fitted after 2012 cannot be assumed to hold in 2000–2011. The
                    pre-2012 archive is genuine MODIS data, but there is no contemporaneous VIIRS
                    to validate against. Transferability is therefore tested inside the overlap
                    window with blocked year splits, a purge gap, and the reverse direction — not
                    by randomly splitting records.
                  </p>
                }
              >
                <TransferabilitySection />
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="results"
                index="06"
                title="Results: what the evidence supports"
                intro={
                  <p>
                    The Method Court compared all three correction methods on identical held-out
                    samples. An independent audit re-derived every metric from the saved models and
                    verified training/validation separation. The findings below are the published,
                    machine-readable outputs of those runs — nothing on this page is hand-entered.
                  </p>
                }
              >
                <ResultsSection />
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="uncertainty"
                index="07"
                title="Why uncertainty must stay visible"
                intro={
                  <p>
                    A single harmonized line can look more certain than the evidence allows. The
                    interface must make room for intervals, method spread and residual seam risk,
                    rather than presenting one clean number as the answer.
                  </p>
                }
              >
                <div className="grid gap-6 sm:grid-cols-2">
                  {[
                    [
                      'Sampling uncertainty',
                      'Small samples and sparse overlapping observations make correction factors less stable.',
                    ],
                    [
                      'Method spread',
                      'When correction approaches disagree, the disagreement is information — not noise to hide.',
                    ],
                    [
                      'Residual seam',
                      'The transition may remain visible even after correction. That residual must be reported.',
                    ],
                    [
                      'Detection probability',
                      'A hotspot count is not the same as area burned, fire severity or every fire that occurred.',
                    ],
                  ].map(([title, description]) => (
                    <div key={title} className="border-t border-sand/[0.12] pt-4">
                      <h3 className="text-body-sm font-medium text-bone">{title}</h3>
                      <p className="mt-2 text-support leading-relaxed text-ash">{description}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-6 text-support leading-relaxed text-ash-dark">
                  The Method Court reports bootstrap uncertainty for every fitted method. Where an
                  interval is wide, or where the methods disagree, the harmonized layer stays
                  provisional rather than collapsing to one confident number.
                </p>
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="limitations"
                index="08"
                title="Known limitations"
                intro={
                  <p>
                    Limits are part of the method. These are the constraints that must remain
                    visible wherever the harmonized record is used.
                  </p>
                }
              >
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {limitations.map((limitation, index) => (
                    <article
                      key={limitation.title}
                      className="border-t border-sand/[0.12] py-5"
                    >
                      <p className="font-mono text-meta tracking-[0.14em] text-ember/80">
                        0{index + 1}
                      </p>
                      <h3 className="mt-2 text-body-sm font-medium text-bone">{limitation.title}</h3>
                      <p className="mt-2 text-support leading-relaxed text-ash">
                        {limitation.description}
                      </p>
                    </article>
                  ))}
                </div>
                <p className="mt-6 border-t border-sand/[0.12] pt-4 text-support leading-relaxed text-ash-dark">
                  Agnidrishti does not predict exact ignition locations, count every fire, or
                  replace on-the-ground monitoring. Missing observations are never treated as zero.
                </p>
              </MethodSection>
            </Reveal>

            <Reveal>
              <MethodSection
                id="provenance"
                index="09"
                title="Data provenance and connected sources"
                intro={
                  <p>
                    A detection without its sensor, product version and processing history is not
                    reproducible. Every processed record keeps that lineage attached.
                  </p>
                }
              >
                <div
                  className="card hidden overflow-x-auto sm:block"
                  role="region"
                  aria-label="Connected data sources and attribution"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-sand/10 bg-sand/[0.03]">
                        <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-dark">
                          Input
                        </th>
                        <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-dark">
                          Product family
                        </th>
                        <th className="px-4 py-3 font-mono text-meta font-normal tracking-[0.02em] text-ash-dark">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand/[0.08] text-support leading-relaxed">
                      {dataSources.map((source) => (
                        <tr key={source.input}>
                          <td className="px-4 py-3.5 text-ash-light">{source.input}</td>
                          <td className="px-4 py-3.5 text-ash">{source.product}</td>
                          <td
                            className={`px-4 py-3.5 font-mono text-meta tracking-[0.02em] ${
                              source.muted ? 'text-ash-dark' : 'text-sand/80'
                            }`}
                          >
                            {source.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card divide-y divide-sand/10 overflow-hidden sm:hidden">
                  {dataSources.map((source) => (
                    <div key={source.input} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-body-sm text-bone">{source.input}</p>
                        <span
                          className={`shrink-0 font-mono text-meta tracking-[0.02em] ${
                            source.muted ? 'text-ash-dark' : 'text-sand/80'
                          }`}
                        >
                          {source.status}
                        </span>
                      </div>
                      <p className="mt-2 text-support leading-relaxed text-ash">{source.product}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-sand/10 pt-4">
                  <p className="max-w-[520px] text-support leading-relaxed text-ash-dark">
                    These product families are connected and processed for the historical Standard
                    Processing record. The near-real-time view is a single public 7-day snapshot, not
                    a second historical archive.
                  </p>
                  <a
                    href={externalLinks.firms}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-meta text-bone/80 underline decoration-sand/25 underline-offset-4 transition-colors hover:text-bone hover:decoration-ember/70"
                  >
                    NASA FIRMS
                    <ArrowUpRight size={12} strokeWidth={1.7} aria-hidden="true" />
                  </a>
                </div>
              </MethodSection>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  )
}
