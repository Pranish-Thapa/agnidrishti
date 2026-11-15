type LogoMarkProps = {
  className?: string
}

export function LogoMark({ className = 'h-8 w-8' }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Observation sweep: the cool VIIRS-equivalent channel. */}
      <path
        d="M4.5 27.5C8.3 17.3 15.3 11.7 24.1 11.7c4.3 0 7.7 1.5 10 4.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7.5 33.2c2.6-6.5 7.3-10.5 14.1-11.5"
        stroke="rgb(var(--observation-rgb))"
        strokeOpacity="0.55"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Signal: the warm detection at the centre of the observation. */}
      <circle cx="29" cy="16.2" r="2.7" className="fill-ember" />
      <circle
        cx="29"
        cy="16.2"
        r="6.4"
        stroke="rgb(var(--amber-rgb))"
        strokeOpacity="0.4"
        strokeWidth="1"
      />
    </svg>
  )
}
