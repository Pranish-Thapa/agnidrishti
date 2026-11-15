import { Link } from 'react-router-dom'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { HeroMedia } from './HeroMedia'

const container: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.2,
    },
  },
}

const label: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
}

const heading: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.95, ease: [0.22, 1, 0.36, 1] },
  },
}

const copy: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1] },
  },
}

const actions: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
  },
}

export function Hero() {
  const reduceMotion = useReducedMotion()

  return (
    <section
      id="top"
      aria-label="Agnidrishti introduction"
      className="grain relative min-h-[100svh] overflow-hidden"
    >
      <HeroMedia />

      {reduceMotion ? null : (
        <motion.div
          initial={{ opacity: 0.82 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.15, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 z-[5] bg-ink"
          aria-hidden="true"
        />
      )}

      <div className="relative z-10 flex min-h-[100svh] flex-col">
        <div className="container-page flex flex-1 flex-col justify-center pb-12 pt-28 md:pb-16 md:pt-32 lg:pt-36">
          <motion.div
            initial={reduceMotion ? false : 'hidden'}
            animate="visible"
            variants={container}
            className="max-w-[1120px]"
          >
            <motion.div variants={label} className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-bone/20 bg-ink-950/[0.35] px-3.5 py-1.5 text-meta font-medium text-bone/85 backdrop-blur-md">
                <span className="h-1.5 w-1.5 rounded-full bg-ember" aria-hidden="true" />
                NASA Space Apps Challenge 2026
              </span>
              <span className="hidden items-center gap-2 text-meta text-bone/60 sm:inline-flex">
                <span className="h-px w-6 spectrum-rule" aria-hidden="true" />
                Harmonization of MODIS and VIIRS hot spots
              </span>
            </motion.div>

            <motion.h1
              variants={heading}
              className="display text-balance mt-7 max-w-[1020px] text-[clamp(2.85rem,5.7vw,5.6rem)] leading-[0.98] text-bone text-shadow-hero"
            >
              Did the <span className="text-amber-soft">fires</span> increase,
              <br />
              or did the satellites{' '}
              <span className="text-observation-soft">get better?</span>
            </motion.h1>

            <motion.p
              variants={copy}
              className="mt-7 max-w-[600px] text-body leading-[1.75] text-bone/75 sm:text-lg sm:leading-[1.8]"
            >
              Fire activity records span decades. But when satellites change, the story they tell
              can change too. Agnidrishti helps separate real fire trends from changes in
              observation.
            </motion.p>

            <motion.div variants={actions} className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/explorer"
                className="group inline-flex min-h-[50px] items-center justify-center gap-2.5 rounded-full bg-ember px-6 text-body-sm font-semibold text-ink-950 shadow-[0_18px_44px_-22px_rgb(249_115_22/0.95)] transition-[background-color,box-shadow,transform] duration-300 hover:bg-amber-soft active:translate-y-px active:scale-[0.99] active:bg-ember-deep"
              >
                Explore Fire Activity
                <ArrowRight
                  size={15}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-x-1"
                />
              </Link>
              <Link
                to="/explorer?map=expanded"
                className="group inline-flex min-h-[50px] items-center justify-center gap-2.5 rounded-full border border-bone/25 bg-ink-950/25 px-6 text-body-sm font-medium text-bone backdrop-blur-sm transition-[background-color,border-color,color] duration-300 hover:border-observation/50 hover:bg-observation/[0.08] active:translate-y-px active:scale-[0.99] active:bg-observation/10"
              >
                Explore the Fire Map
                <ArrowRight
                  size={15}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="text-observation-soft transition-transform duration-300 group-hover:translate-x-1"
                />
              </Link>
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8, ease: 'easeOut' }}
          className="container-page relative z-10"
        >
          <div className="flex flex-col gap-5 border-t border-sand/20 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-display text-meta font-medium tracking-[0.18em] text-bone">
                AGNIDRISHTI
              </p>
              <p className="mt-1.5 font-display text-lg leading-snug text-bone/70">
                <span className="text-amber-soft">See the fire.</span>{' '}
                <span className="text-observation-soft">Verify the signal.</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="flex items-center gap-2 text-meta text-sand/85">
                <span className="h-px w-4 bg-terracotta-soft" aria-hidden="true" />
                MODIS Terra / Aqua
              </span>
              <span className="flex items-center gap-2 text-meta text-sand/85">
                <span className="h-px w-4 bg-observation" aria-hidden="true" />
                VIIRS Suomi-NPP
              </span>
              <a
                href="#the-problem"
                className="group inline-flex items-center gap-2.5 text-meta font-medium text-sand/85 transition-colors hover:text-amber-soft"
              >
                Examine the record
                <ArrowDown
                  size={13}
                  strokeWidth={1.6}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-y-1"
                />
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
