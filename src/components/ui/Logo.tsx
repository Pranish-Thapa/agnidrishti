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
      <LogoMark
        className={
          isLarge
            ? 'h-10 w-10 text-bone transition-transform duration-500 group-hover:rotate-[-6deg]'
            : 'h-8 w-8 text-bone transition-transform duration-500 group-hover:rotate-[-6deg]'
        }
      />
      <span className="flex flex-col leading-none">
        <span
          className={
            isLarge
              ? 'text-[15px] font-medium tracking-[0.24em]'
              : 'text-[12px] font-medium tracking-[0.22em] sm:text-[13px]'
          }
        >
          {site.wordmark}
        </span>
        {showTagline ? (
          <span className="mt-1.5 hidden font-mono text-[8px] uppercase tracking-[0.19em] text-ash sm:block">
            {site.tagline}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
