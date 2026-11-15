import { Link } from 'react-router-dom'
import { LogoMark } from './LogoMark'
import { site } from '../../lib/site'

type LogoProps = {
  showTagline?: boolean
  size?: 'default' | 'large'
}

export function Logo({ showTagline = true, size = 'default' }: LogoProps) {
  const isLarge = size === 'large'

  return (
    <Link
      to="/"
      aria-label={`${site.name} — home`}
      className="group inline-flex items-center gap-3 text-bone"
    >
      <span className="relative inline-flex items-center justify-center">
        <LogoMark
          className={
            isLarge
              ? 'h-10 w-10 text-bone transition-transform duration-500 group-hover:rotate-[-6deg]'
              : 'h-8 w-8 text-bone transition-transform duration-500 group-hover:rotate-[-6deg]'
          }
        />
      </span>
      <span className="flex flex-col leading-none">
        <span
          className={
            isLarge
              ? 'font-display text-body font-medium tracking-[0.16em]'
              : 'font-display text-body-sm font-medium tracking-[0.15em] sm:text-body-sm'
          }
        >
          {site.wordmark}
        </span>
        {showTagline ? (
          <span className="mt-1.5 hidden text-meta font-normal tracking-[0.02em] text-ash sm:block">
            {site.tagline}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
