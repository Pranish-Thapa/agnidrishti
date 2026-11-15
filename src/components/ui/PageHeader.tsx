import type { ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { SectionLabel } from './SectionLabel'

type PageHeaderProps = {
  index: string
  label: string
  title: ReactNode
  intro: ReactNode
  aside?: ReactNode
}

const container: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
}

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
}

export function PageHeader({ index, label, title, intro, aside }: PageHeaderProps) {
  const reduceMotion = useReducedMotion()

  return (
    <header className="surface-header relative overflow-hidden border-b border-sand/10 pb-16 pt-32 md:pb-20 md:pt-40">
      <div
        className="pointer-events-none absolute inset-0 bg-blueprint opacity-[0.32] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px spectrum-rule opacity-70"
        aria-hidden="true"
      />
      <motion.div
        className="container-page relative"
        initial={reduceMotion ? false : 'hidden'}
        animate="visible"
        variants={container}
      >
        <motion.div variants={item}>
          <SectionLabel index={index} label={label} />
        </motion.div>
        <div className="mt-9 grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="min-w-0 lg:col-span-8">
            <motion.div variants={item}>
              <h1 className="display text-balance max-w-[880px] text-[clamp(2.8rem,5.6vw,5.4rem)] leading-[0.98] text-bone">
                {title}
              </h1>
            </motion.div>
            <motion.div variants={item} className="mt-6 max-w-2xl body-copy">
              {intro}
            </motion.div>
          </div>
          {aside ? (
            <motion.div variants={item} className="min-w-0 lg:col-span-4 lg:justify-self-end">
              {aside}
            </motion.div>
          ) : null}
        </div>
      </motion.div>
    </header>
  )
}
