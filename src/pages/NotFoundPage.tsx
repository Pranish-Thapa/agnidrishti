import { ButtonLink } from '../components/ui/ButtonLink'
import { SectionLabel } from '../components/ui/SectionLabel'

export function NotFoundPage() {
  return (
    <section className="flex min-h-[78vh] items-center border-b border-sand/[0.07] pb-20 pt-32">
      <div className="container-page">
        <SectionLabel index="404" label="Route not found" />
        <h1 className="display mt-7 max-w-[720px] text-[clamp(3rem,7vw,6rem)] leading-[0.96] text-bone">
          This trail goes <em className="italic text-sand/85">cold.</em>
        </h1>
        <p className="mt-6 max-w-[460px] body-copy">
          The page you were looking for is not part of the current Agnidrishti build. Return to the
          record or open the Explorer foundation.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink to="/">Back to home</ButtonLink>
          <ButtonLink to="/explorer" variant="secondary">
            Open Explorer
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}
