import { capabilities } from '../../lib/content'
import { SectionLabel } from '../ui/SectionLabel'
import { Reveal } from '../ui/Reveal'
import { StatusBadge } from '../ui/StatusBadge'
import { CapabilitySchematic } from './CapabilitySchematic'

export function CapabilitiesSection() {
  return (
    <section id="capabilities" className="surface-earth scroll-mt-20 border-t border-sand/[0.07] section-y md:scroll-mt-24">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div className="lg:col-span-7">
            <Reveal>
              <SectionLabel index="03" label="Core capabilities" />
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="display mt-7 max-w-[700px] text-[clamp(2.6rem,5vw,4.6rem)] leading-[1] text-bone">
                A trend has to earn{' '}
                <em className="italic text-sand/85">its confidence.</em>
              </h2>
            </Reveal>
          </div>
          <div className="lg:col-span-5 lg:pb-2">
            <Reveal delay={0.14}>
              <p className="max-w-[430px] body-copy">
                Three planned tests interrogate the transition itself, the methods used to correct
                it, and the record&apos;s reliability when observations disappear.
              </p>
            </Reveal>
          </div>
        </div>

        <div className="mt-14 border-b border-sand/[0.12] lg:mt-20">
          {capabilities.map((capability, index) => (
            <Reveal key={capability.title} delay={index * 0.04}>
              <article className="grid gap-7 border-t border-sand/[0.12] py-9 md:grid-cols-2 md:gap-x-10 lg:grid-cols-12 lg:gap-8 lg:py-11">
                <div className="flex items-start justify-between gap-4 lg:col-span-2 lg:block">
                  <p className="font-mono text-[11px] tracking-[0.18em] text-ember">
                    {capability.index}
                  </p>
                  <StatusBadge className="lg:mt-4" tone="planned">
                    {capability.status}
                  </StatusBadge>
                </div>

                <div className="lg:col-span-4">
                  <h3 className="display text-[2.1rem] leading-none text-bone sm:text-[2.5rem]">
                    {capability.title}
                  </h3>
                  <p className="mt-3 max-w-[330px] font-display text-[1.3rem] italic leading-[1.3] text-ash-light">
                    {capability.question}
                  </p>
                </div>

                <div className="lg:col-span-3">
                  <p className="max-w-[380px] text-[13px] leading-[1.8] text-ash">
                    {capability.description}
                  </p>
                </div>

                <div className="flex items-center border border-sand/[0.08] bg-forest-deep/60 p-3 md:col-span-2 lg:col-span-3 lg:p-4">
                  <CapabilitySchematic variant={capability.schematic} />
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="mt-6 max-w-[720px] text-[11px] leading-relaxed text-ash-dark">
            Capability status reflects this foundation build. The diagrams above are conceptual
            schematics, not validation results. Harmonization and backtesting calculations will be
            connected in a later development phase.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
