import { PageHeader } from '../components/ui/PageHeader'
import { Reveal } from '../components/ui/Reveal'
import { ButtonLink } from '../components/ui/ButtonLink'
import { StatusBadge } from '../components/ui/StatusBadge'
import { SectionLabel } from '../components/ui/SectionLabel'
import { site } from '../lib/site'

const roadmap = [
  {
    phase: '01 · Foundation',
    title: 'Product and documentation',
    status: 'Complete',
    tone: 'active' as const,
    description:
      'Landing page, application shell, historical explorer and methodology documentation ship together.',
  },
  {
    phase: '02 · Data pipeline',
    title: 'Acquisition to comparison series',
    status: 'Complete',
    tone: 'active' as const,
    description:
      'Historical Standard Processing 2000-2026 (MODIS before 2012; MODIS and VIIRS after), normalization, QC, exact boundary assignment, ISO weeks, three fitted correction methods and blocked pre-2012 transferability tests.',
  },
  {
    phase: '03 · Validation',
    title: 'Independent audit',
    status: 'Audited',
    tone: 'neutral' as const,
    description:
      'Method Court, seam audit, lights-out backtest and reliability strata published as machine-readable outputs.',
  },
] as const

export function AboutPage() {
  return (
    <>
      <PageHeader
        index="03"
        label="About the project"
        title={
          <>
            A clearer signal from a <span className="text-amber-soft">changing record.</span>
          </>
        }
        intro={
          <p>
            Agnidrishti is a satellite-aware fire activity calendar built for the NASA Space Apps
            Challenge 2026. It exists to answer a deceptively simple question: did the fires
            increase, or did the satellites get better?
          </p>
        }
        aside={
          <div className="card w-full max-w-[300px] p-5">
            <p className="eyebrow text-ash">Challenge</p>
            <p className="mt-4 font-display text-2xl leading-snug text-bone">{site.challenge}</p>
            <p className="mt-3 font-mono text-meta tracking-[0.02em] text-sand/80">
              NASA Space Apps Challenge 2026
            </p>
          </div>
        }
      />

      <section className="section-y">
        <div className="container-page">
          <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <Reveal>
                <SectionLabel index="01" label="What Agnidrishti is" />
              </Reveal>
              <Reveal delay={0.08}>
                <p className="display mt-7 max-w-[720px] text-[clamp(2rem,3.8vw,3.4rem)] leading-[1.12] text-bone">
                  A fire record is only as trustworthy as our understanding of the eyes that
                  produced it.
                </p>
              </Reveal>
              <Reveal delay={0.14}>
                <div className="mt-8 max-w-[600px] space-y-5 body-copy">
                  <p>
                    Satellites have observed fire on Earth for decades. Over that time, the
                    instruments, algorithms and products behind the record have changed. A longer
                    series can therefore contain sharp increases in detected hotspots that reflect
                    better observation rather than more burning.
                  </p>
                  <p>
                    Agnidrishti collects MODIS and VIIRS fire observations, aligns historical MODIS
                    detections to a VIIRS-equivalent scale using their overlap period, and tests
                    whether the resulting trends and unusual periods remain credible. The product
                    is designed to show its uncertainty, not hide it behind a smooth line.
                  </p>
                </div>
              </Reveal>
            </div>

            <div className="lg:col-span-5">
              <Reveal delay={0.1}>
                <div className="card">
                  <div className="border-b border-sand/[0.08] px-5 py-4">
                    <p className="eyebrow text-ash">The scientific question</p>
                  </div>
                  <div className="p-5 sm:p-7">
                    <p className="font-display text-[2rem] leading-[1.2] text-bone">
                      “Did the fires increase, or did the satellites get better?”
                    </p>
                    <p className="mt-5 text-support leading-relaxed text-ash">
                      The question is not whether a count changed. It is whether the change belongs
                      to the landscape or to the observation system.
                    </p>
                  </div>
                  <div className="border-t border-sand/[0.08] px-5 py-4">
                    <p className="font-mono text-meta tracking-[0.02em] text-sand/80">
                      See the fire. Verify the signal.
                    </p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>

          <Reveal>
            <div className="mt-20 grid gap-8 border-y border-sand/[0.12] py-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-3">
                <p className="eyebrow text-sand/80">The challenge</p>
              </div>
              <div className="lg:col-span-9">
                <p className="max-w-[820px] font-display text-[clamp(1.6rem,2.8vw,2.4rem)] leading-[1.22] text-bone">
                  Harmonization of MODIS and VIIRS Hot Spots asks how two observation records can
                  be made comparable without pretending their differences do not exist.
                </p>
                <p className="mt-5 max-w-[650px] text-body-sm leading-[1.8] text-ash">
                  Agnidrishti responds with a transparent workflow: keep the raw records separate,
                  learn from the overlap, compare multiple correction methods, and test whether the
                  harmonized signal survives the places where it is most fragile.
                </p>
              </div>
            </div>
          </Reveal>

          <div className="mt-20">
            <Reveal>
              <SectionLabel index="02" label="Project status" />
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="display mt-6 max-w-[650px] text-[clamp(2.2rem,4.2vw,3.6rem)] leading-[1.05] text-bone">
                Built in the open, <span className="text-observation-soft">verified in stages.</span>
              </h2>
            </Reveal>

            <div className="mt-10 grid gap-px overflow-hidden rounded-panel border border-sand/[0.1] bg-sand/10 md:grid-cols-3">
              {roadmap.map((step) => (
                <article key={step.title} className="bg-ink-850 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-mono text-meta tracking-[0.02em] text-ember">
                      {step.phase}
                    </p>
                    <StatusBadge tone={step.tone}>{step.status}</StatusBadge>
                  </div>
                  <h3 className="mt-4 font-display text-2xl text-bone">{step.title}</h3>
                  <p className="mt-3 text-support leading-relaxed text-ash">{step.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-20 grid gap-10 border-t border-sand/[0.12] pt-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Reveal>
                <p className="eyebrow text-ash">Independence and attribution</p>
                <p className="mt-5 max-w-[420px] text-body-sm leading-[1.8] text-ash">
                  Agnidrishti is an independent project created for the NASA Space Apps Challenge
                  2026. It is not affiliated with or endorsed by NASA. No team members or
                  institutional affiliations are listed until they are confirmed.
                </p>
              </Reveal>
            </div>
            <div className="lg:col-span-7">
              <Reveal delay={0.08}>
                <div className="rounded-r-xl border-l-2 border-ember/50 pl-5">
                  <p className="max-w-[620px] font-display text-[clamp(1.6rem,2.6vw,2.2rem)] leading-[1.25] text-bone/90">
                    The aim is not to make the past look certain. It is to make the uncertainty
                    legible enough to act on.
                  </p>
                </div>
                <div className="mt-8 flex flex-wrap gap-3">
                  <ButtonLink to="/explorer">Explore the record</ButtonLink>
                  <ButtonLink to="/methodology" variant="secondary">
                    Read the methodology
                  </ButtonLink>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
