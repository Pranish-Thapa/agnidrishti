type SectionLabelProps = {
  index: string
  label: string
  className?: string
}

export function SectionLabel({ index, label, className = '' }: SectionLabelProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-ember/30 bg-ember/[0.09] px-1.5 font-mono text-meta leading-none text-ember">
        {index}
      </span>
      <span
        className="h-px w-8 bg-gradient-to-r from-ember/60 via-sand/30 to-observation/45"
        aria-hidden="true"
      />
      <span className="eyebrow">{label}</span>
    </div>
  )
}
