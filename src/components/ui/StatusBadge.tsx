type StatusBadgeProps = {
  children: string
  tone?: 'planned' | 'active' | 'neutral'
  className?: string
}

const toneStyles = {
  planned: 'border-sand/25 bg-sand/[0.055] text-sand/90',
  active: 'border-ember/30 bg-ember/[0.06] text-ember-soft',
  neutral: 'border-sand/[0.14] bg-sand/[0.04] text-ash-light',
} as const

const dotStyles = {
  planned: 'bg-sand',
  active: 'bg-ember',
  neutral: 'bg-ash',
} as const

export function StatusBadge({ children, tone = 'planned', className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] ${toneStyles[tone]} ${className}`}
    >
      <span className={`h-1 w-1 rounded-full ${dotStyles[tone]}`} aria-hidden="true" />
      {children}
    </span>
  )
}
