import { ButtonLink } from '../ui/ButtonLink'
import { SectionLabel } from '../ui/SectionLabel'
import { Reveal } from '../ui/Reveal'

export function ClosingCta() {
  return (
    <section id="open-the-record" className="relative scroll-mt-20 overflow-hidden border-t border-sand/10 md:scroll-mt-24">
      <div
        className="absolute inset-0 bg-cover bg-[62%_42%]"
        style={{ backgroundImage: "url('/videos/fire-hero-poster.jpg')" }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 closing-shade" aria-hidden="true" />

      <div className="container-page relative py-28 md:py-36">
        <Reveal>
          <SectionLabel index="05" label="Open the record" />
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="display mt-7 max-w-[700px] text-[clamp(3rem,6.6vw,6rem)] leading-[0.98] text-bone text-shadow-hero">
            Look beyond
            <br />
            <span className="text-amber-soft">the numbers.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-6 max-w-[480px] text-body leading-[1.8] text-bone/70 sm:text-base">
            Explore fire activity through a record that accounts for the satellites observing it.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-9">
            <ButtonLink to="/explorer">Explore Agnidrishti</ButtonLink>
          </div>
          <p className="mt-5 max-w-[430px] text-support leading-relaxed text-sand/65">
            Explore the processed MODIS and VIIRS record, its harmonized estimate, and the evidence
            behind every displayed value.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
