type StatusBadgeProps = {
  children: string
  tone?: 'planned' | 'active' | 'neutral'
  className?: string
}

const toneStyles = {
  planned: 'border-sand/20 bg-sand/[0.06] text-ash-light',
  active: 'border-ember/30 bg-ember/[0.1] text-amber-soft',
  neutral: 'border-observation/20 bg-observation/[0.06] text-observation-soft',
} as const

export function StatusBadge({ children, tone = 'planned', className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-meta font-medium leading-none tracking-[0.01em] ${toneStyles[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
