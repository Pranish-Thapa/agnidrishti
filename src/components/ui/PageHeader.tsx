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
        className="pointer-events-none absolute inset-0 bg-blueprint opacity-[0.4] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
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
        <div className="mt-8 grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <motion.div variants={item}>
              <h1 className="display max-w-[820px] text-[clamp(2.9rem,6vw,5.5rem)] leading-[0.96] text-bone">
                {title}
              </h1>
            </motion.div>
            <motion.div variants={item} className="mt-6 max-w-2xl body-copy">
              {intro}
            </motion.div>
          </div>
          {aside ? (
            <motion.div variants={item} className="lg:col-span-4 lg:justify-self-end">
              {aside}
            </motion.div>
          ) : null}
        </div>
      </motion.div>
    </header>
  )
}
