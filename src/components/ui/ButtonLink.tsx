import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'quiet'
type Size = 'sm' | 'md'

const base =
  'group inline-flex items-center justify-center gap-2.5 rounded-full font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-300 active:translate-y-px active:scale-[0.99] focus-visible:outline-offset-4'

const variants: Record<Variant, string> = {
  primary:
    'bg-ember text-ink-950 shadow-[0_14px_34px_-20px_rgb(249_115_22/0.9)] hover:bg-amber-soft hover:shadow-[0_18px_40px_-18px_rgb(249_115_22/0.75)] active:bg-ember-deep',
  secondary:
    'border border-sand/25 bg-ink-950/25 text-bone backdrop-blur-sm hover:border-observation/45 hover:bg-observation/[0.07] active:bg-observation/10',
  quiet:
    'px-0 text-bone/80 underline decoration-sand/30 underline-offset-[6px] hover:text-bone hover:decoration-ember active:text-bone',
}

const sizes: Record<Size, string> = {
  sm: 'min-h-[38px] px-4 text-support',
  md: 'min-h-[47px] px-6 text-body-sm',
}

type ButtonLinkProps = {
  to: string
  children: ReactNode
  variant?: Variant
  size?: Size
  className?: string
  showArrow?: boolean
}

export function ButtonLink({
  to,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  showArrow = true,
}: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={`${base} ${variants[variant]} ${variant === 'quiet' ? '' : sizes[size]} ${className}`}
    >
      <span>{children}</span>
      {showArrow ? (
        <ArrowRight
          size={15}
          strokeWidth={1.8}
          aria-hidden="true"
          className="transition-transform duration-300 group-hover:translate-x-1"
        />
      ) : null}
    </Link>
  )
}
