import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Logo } from '../ui/Logo'
import { externalLinks, navLinks, site } from '../../lib/site'

export function Footer() {
  return (
    <footer className="surface-footer border-t border-sand/10">
      <div className="container-page pb-8 pt-16 md:pt-20">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            <Logo size="large" showTagline={false} />
            <p className="mt-4 max-w-xs font-display text-2xl italic leading-snug text-sand/85">
              {site.tagline}
            </p>
            <p className="mt-6 max-w-xs text-[13px] leading-relaxed text-ash">
              {site.description}
            </p>
          </div>

          <div className="lg:col-span-2">
            <h2 className="eyebrow text-ash-dark">Navigate</h2>
            <ul className="mt-5 space-y-3">
              {navLinks.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-[13px] text-ash-light transition-colors duration-300 hover:text-bone"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h2 className="eyebrow text-ash-dark">Challenge</h2>
            <p className="mt-5 text-[13px] leading-relaxed text-ash-light">
              {site.challenge}
            </p>
            <p className="mt-2 text-[13px] text-ash">{site.challengeShort}</p>
            <a
              href={externalLinks.spaceApps}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-bone/80 underline decoration-sand/25 underline-offset-4 transition-colors hover:text-bone hover:decoration-ember/70"
            >
              Official challenge site
              <ArrowUpRight size={13} strokeWidth={1.7} aria-hidden="true" />
            </a>
          </div>

          <div className="lg:col-span-3">
            <h2 className="eyebrow text-ash-dark">Data sources</h2>
            <ul className="mt-5 space-y-2.5 text-[13px] leading-relaxed text-ash">
              <li>MODIS active fire detections</li>
              <li>VIIRS 375 m active fire detections</li>
            </ul>
            <p className="mt-4 text-[11px] leading-relaxed text-ash-dark">
              Product identifiers, processing versions and attribution will be published with the
              processed dataset. Sources are not yet connected in this build.
            </p>
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-sand/[0.08] pt-6 text-[11px] text-ash-dark md:flex-row md:items-center md:justify-between">
          <p>© 2026 Agnidrishti. An independent NASA Space Apps Challenge project.</p>
          <p>
            Not affiliated with or endorsed by NASA. Harmonized detections are not ground truth.
          </p>
        </div>
      </div>
    </footer>
  )
}
