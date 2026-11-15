import { principles } from '../../lib/content'
import { SectionLabel } from '../ui/SectionLabel'
import { Reveal } from '../ui/Reveal'

export function CredibilitySection() {
  return (
    <section id="credibility" className="surface-muted-forest scroll-mt-20 border-t border-sand/10 section-y md:scroll-mt-24">
      <div className="container-page">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <Reveal>
                <SectionLabel index="04" label="Scientific credibility" />
              </Reveal>
              <Reveal delay={0.08}>
                <h2 className="display mt-7 max-w-[480px] text-[clamp(2.6rem,4.6vw,4.4rem)] leading-[1] text-bone">
                  Not just a smoother graph.{' '}
                  <span className="text-amber-soft">A tested signal.</span>
                </h2>
              </Reveal>
              <Reveal delay={0.14}>
                <p className="mt-7 max-w-[450px] body-copy">
                  A harmonized record is only useful if its assumptions are visible and its
                  weaknesses survive scrutiny. These principles define what Agnidrishti must show,
                  not just what it must calculate.
                </p>
              </Reveal>

              <Reveal delay={0.2}>
                <blockquote className="mt-9 border-l border-ember/60 pl-5">
                  <p className="max-w-[420px] text-body-sm leading-[1.8] text-bone/85">
                    Harmonized detections are not ground truth. They are an improved basis for
                    comparing satellite observations across time.
                  </p>
                </blockquote>
              </Reveal>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {principles.map((principle, index) => (
                <Reveal key={principle.index} delay={0.04 * index}>
                  <article className="group h-full rounded-xl border border-sand/[0.09] bg-ink-900/35 px-5 py-5 transition-colors hover:border-sand/[0.18] hover:bg-ink-900/55">
                    <p className="font-mono text-meta tracking-[0.12em] text-amber-soft/80">
                      {principle.index}
                    </p>
                    <h3 className="mt-2.5 text-body font-medium leading-snug text-bone">
                      {principle.title}
                    </h3>
                    <p className="mt-2.5 text-support leading-[1.75] text-ash">
                      {principle.description}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </div>

        <Reveal>
          <div className="mt-20 grid border-y border-sand/[0.12] md:grid-cols-2">
            <div className="py-8 md:pr-12">
              <p className="eyebrow text-ember/90">What it is</p>
              <p className="mt-4 max-w-[460px] font-display text-2xl leading-[1.25] text-bone/90">
                An improved basis for comparing satellite observations across time.
              </p>
            </div>
            <div className="border-t border-sand/[0.12] py-8 md:border-l md:border-t-0 md:pl-12">
              <p className="eyebrow text-sand/75">What it is not</p>
              <p className="mt-4 max-w-[480px] text-body-sm leading-[1.8] text-ash">
                Ground truth, a complete census of every fire, or a tool for predicting exact
                ignition locations. Missing observations are never treated as zero fire activity.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
