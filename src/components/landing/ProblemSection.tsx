import { SectionLabel } from '../ui/SectionLabel'
import { Reveal } from '../ui/Reveal'
import { ResolutionDiagram } from './ResolutionDiagram'

const sensors = [
  {
    name: 'MODIS',
    scale: '~1 km nominal pixel',
    description:
      'A longer historical record, but its coarser nominal pixel may miss smaller fires that newer sensors can resolve.',
  },
  {
    name: 'VIIRS',
    scale: '~375 m I-band pixel',
    description:
      'Greater ability to detect smaller and cooler hotspots, producing a different observation record from the same landscape.',
  },
] as const

export function ProblemSection() {
  return (
    <section id="the-problem" className="surface-depth scroll-mt-20 border-t border-sand/[0.07] section-y md:scroll-mt-24">
      <div className="container-page">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <Reveal>
              <SectionLabel index="01" label="The observation problem" />
            </Reveal>

            <Reveal delay={0.08}>
              <h2 className="display mt-7 text-[clamp(2.7rem,5.2vw,4.8rem)] leading-[0.98] text-bone">
                One planet.
                <br />
                <span className="text-observation-soft">Different eyes.</span>
              </h2>
            </Reveal>

            <Reveal delay={0.14}>
              <div className="mt-7 max-w-[520px] space-y-4 body-copy">
                <p>
                  MODIS and VIIRS do not see the same fire in the same way. Their pixels differ in
                  size, their sensors differ in sensitivity, and their records begin at different
                  points in time.
                </p>
                <p>
                  When one observation system gives way to another, the detected count can step up
                  or down even if the landscape has not changed. That step is a seam in the record.
                </p>
              </div>
            </Reveal>

            <div className="mt-10 space-y-2">
              {sensors.map((sensor, index) => (
                <Reveal key={sensor.name} delay={0.06 * index}>
                  <div className="grid grid-cols-[82px_1fr] gap-4 rounded-xl border border-sand/[0.09] bg-ink-900/45 px-4 py-4 transition-colors hover:border-sand/[0.16] sm:grid-cols-[112px_1fr] sm:gap-6 sm:px-5">
                    <div>
                      <span
                        className={`mb-2.5 block h-0.5 w-6 ${
                          sensor.name === 'MODIS' ? 'bg-terracotta-soft' : 'bg-observation'
                        }`}
                        aria-hidden="true"
                      />
                      <p className="font-mono text-support tracking-[0.06em] text-bone">{sensor.name}</p>
                      <p className="mt-1.5 text-meta leading-[1.4] text-sand/80">
                        {sensor.scale}
                      </p>
                    </div>
                    <p className="text-body-sm leading-relaxed text-ash">{sensor.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 lg:pt-14">
            <Reveal delay={0.1}>
              <ResolutionDiagram />
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-5 max-w-[560px] text-support leading-relaxed text-ash-dark">
                A finer pixel is not simply a better photograph. It changes the probability that a
                small, cool or short-lived fire will be detected at all.
              </p>
            </Reveal>
          </div>
        </div>

        <Reveal>
          <div className="mt-20 grid gap-7 border-y border-sand/[0.12] py-10 lg:grid-cols-12 lg:gap-12 lg:py-12">
            <div className="lg:col-span-3">
              <p className="eyebrow text-sand/80">The seam</p>
            </div>
            <div className="lg:col-span-9">
              <p className="max-w-[780px] font-display text-[clamp(1.6rem,2.8vw,2.45rem)] leading-[1.2] text-bone">
                A sudden increase in detected hotspots after a satellite transition does not
                automatically mean fire activity increased.
              </p>
              <p className="mt-5 max-w-[620px] text-body-sm leading-relaxed text-ash sm:text-sm">
                Finer pixels, greater sensitivity or a different retrieval algorithm can all lift
                the count without a single extra fire on the ground. The question is not whether
                the count changed. It is whether the change belongs to the fire or to the eyes
                observing it.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
