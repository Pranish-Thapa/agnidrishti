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
        <div className="container-page flex flex-1 flex-col justify-center pb-14 pt-32 md:pb-20 md:pt-36 lg:pt-40">
          <motion.div
            initial={reduceMotion ? false : 'hidden'}
            animate="visible"
            variants={container}
            className="max-w-[1120px]"
          >
            <motion.div variants={label} className="flex items-center gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-ember" aria-hidden="true" />
              <p className="eyebrow text-sand/80">NASA Space Apps Challenge 2026</p>
            </motion.div>

            <motion.h1
              variants={heading}
              className="display mt-7 max-w-[1040px] text-[clamp(3.05rem,6.6vw,6.5rem)] leading-[0.96] text-bone text-shadow-hero"
            >
              Did the <em className="italic text-terracotta-soft">fires</em> increase,
              <br />
              or did the satellites <em className="italic text-ember-soft">get better?</em>
            </motion.h1>

            <motion.p
              variants={copy}
              className="mt-7 max-w-[560px] text-[15px] leading-[1.75] text-bone/70 sm:text-[17px] sm:leading-[1.8]"
            >
              Fire activity records span decades. But when satellites change, the story they tell
              can change too. Agnidrishti helps separate real fire trends from changes in
              observation.
            </motion.p>

            <motion.div variants={actions} className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/explorer"
                className="group inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-[2px] bg-ember px-6 text-[13px] font-medium text-ink-950 transition-all duration-300 hover:bg-ember-soft active:translate-y-px active:scale-[0.99] active:bg-ember-deep"
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
                to="/methodology"
                className="group inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-[2px] border border-sand/35 px-6 text-[13px] font-medium text-bone transition-all duration-300 hover:border-sand/65 hover:bg-sand/[0.07] active:translate-y-px active:scale-[0.99] active:bg-sand/[0.1]"
              >
                Understand Our Method
                <ArrowRight
                  size={15}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className="text-bone/60 transition-transform duration-300 group-hover:translate-x-1"
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
              <p className="text-[11px] font-medium tracking-[0.24em] text-bone">AGNIDRISHTI</p>
              <p className="mt-1.5 font-display text-lg italic text-bone/65">
                <span className="text-terracotta-soft">See the fire.</span>{' '}
                <span className="text-ember-soft">Verify the signal.</span>
              </p>
            </div>
            <a
              href="#the-problem"
              className="group inline-flex items-center gap-3 self-start font-mono text-[9px] uppercase tracking-[0.18em] text-sand/80 transition-colors hover:text-ember-soft sm:self-auto"
            >
              Scroll to examine the record
              <ArrowDown
                size={13}
                strokeWidth={1.6}
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-y-1"
              />
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
