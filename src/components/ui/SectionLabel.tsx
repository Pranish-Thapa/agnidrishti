type SectionLabelProps = {
  index: string
  label: string
  className?: string
}

export function SectionLabel({ index, label, className = '' }: SectionLabelProps) {
  return (
    <div className={`flex items-center gap-3.5 ${className}`}>
      <span className="font-mono text-[10px] tracking-[0.16em] text-ember">{index}</span>
      <span className="h-px w-7 bg-sand/20" aria-hidden="true" />
      <span className="eyebrow">{label}</span>
    </div>
  )
}
