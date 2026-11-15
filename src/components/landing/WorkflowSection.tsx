import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { SectionLabel } from '../ui/SectionLabel'
import { Reveal } from '../ui/Reveal'
import { palette, withAlpha } from '../../lib/palette'

const ease = [0.22, 1, 0.36, 1] as const

const bone = palette.bone
const accent = palette.amber.DEFAULT
const channel = palette.observation.DEFAULT
const secondary = palette.ash.DEFAULT
const muted = palette.ash.dark

const stageList: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
}

const stageItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease },
  },
}

const stageRule: Variants = {
  hidden: { scaleX: 0 },
  visible: {
    scaleX: 1,
    transition: { duration: 0.8, ease },
  },
}

const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

const draw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: { pathLength: 1, opacity: 1 },
}

const growBar: Variants = {
  hidden: { scaleX: 0, opacity: 0 },
  visible: { scaleX: 1, opacity: 1 },
}

const stages = [
  {
    index: '01',
    title: 'Observe',
    description:
      'Collect and organize fire observations from MODIS and VIIRS, keeping their sensor identity, time and quality information intact.',
    meta: 'Satellite hot spot detections',
  },
  {
    index: '02',
    title: 'Harmonize',
    description:
      'Compare overlapping observations and test correction methods that bring the historical record onto a consistent, VIIRS-equivalent scale.',
    meta: 'Overlap-calibrated reference',
  },
  {
    index: '03',
    title: 'Verify',
    description:
      'Test whether apparent changes and unusual periods remain credible after harmonization, including under withheld-sensor conditions.',
    meta: 'Seam, method and backtest checks',
  },
] as const

export function WorkflowSection() {
  const reduceMotion = useReducedMotion()

  return (
    <section
      id="workflow"
      className="surface-forest scroll-mt-20 border-t border-sand/10 section-y md:scroll-mt-24"
    >
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-16">
          <div className="lg:col-span-7">
            <Reveal>
              <SectionLabel index="02" label="The workflow" />
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="display mt-7 max-w-[720px] text-[clamp(2.6rem,5vw,4.6rem)] leading-[1] text-bone">
                From raw detections to a more{' '}
                <span className="text-observation-soft">trustworthy history.</span>
              </h2>
            </Reveal>
          </div>
          <div className="lg:col-span-5 lg:pb-2">
            <Reveal delay={0.14}>
              <p className="max-w-[460px] body-copy">
                The goal is not to make the line smoother. It is to make the comparison between
                decades defensible, then to show where the evidence is still weak.
              </p>
            </Reveal>
          </div>
        </div>

        <motion.div
          className="mt-16 grid gap-10 md:grid-cols-3 md:gap-8 lg:mt-20"
          initial={reduceMotion ? false : 'hidden'}
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={stageList}
        >
          {stages.map((stage) => (
            <motion.article
              key={stage.index}
              variants={stageItem}
              className="group relative pt-6"
            >
              <motion.span
                variants={stageRule}
                className="absolute -top-px left-0 h-px w-full origin-left bg-sand/20"
                aria-hidden="true"
              />
              <span
                className="absolute -top-px left-0 h-px w-0 bg-ember transition-all duration-700 group-hover:w-full"
                aria-hidden="true"
              />
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-mono text-meta tracking-[0.18em] text-ember">{stage.index}</p>
                <p className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                  {stage.meta}
                </p>
              </div>
              <h3 className="display mt-5 text-4xl text-bone">{stage.title}</h3>
              <p className="mt-4 max-w-[340px] text-body-sm leading-[1.8] text-ash">
                {stage.description}
              </p>
            </motion.article>
          ))}
        </motion.div>

        <Reveal delay={0.06}>
          <div className="mt-16 grid gap-8 border-y border-sand/[0.12] py-8 lg:grid-cols-12 lg:items-center lg:gap-12">
            <div className="lg:col-span-5">
              <p className="eyebrow text-sand/80">Conceptual record structure</p>
              <p className="mt-4 max-w-[420px] font-display text-2xl leading-snug text-bone/90">
                The overlap period is the only place the two records can be compared directly.
              </p>
            </div>
            <div className="lg:col-span-7">
              <div className="space-y-5 sm:hidden">
                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-mono text-meta tracking-[0.02em] text-ash-light">
                      MODIS record
                    </span>
                    <span className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                      Longer span
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full bg-sand/25" />
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-mono text-meta tracking-[0.02em] text-observation-soft">
                      VIIRS record
                    </span>
                    <span className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                      Finer reference
                    </span>
                  </div>
                  <div className="mt-2 flex h-1.5">
                    <span className="w-[44%]" />
                    <span className="w-[56%] bg-observation/70" />
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-mono text-meta tracking-[0.02em] text-sand/90">
                      Overlap window
                    </span>
                    <span className="font-mono text-meta tracking-[0.02em] text-ash-dark">
                      Shared observations
                    </span>
                  </div>
                  <div className="mt-2 flex h-1.5">
                    <span className="w-[44%]" />
                    <span className="w-[56%] border-x border-sand/60 bg-sand/20" />
                  </div>
                </div>
                <p className="pt-1 font-mono text-meta tracking-[0.02em] text-ash-dark">
                  Illustrative timeline — not to scale
                </p>
              </div>

              <motion.svg
                viewBox="0 0 620 150"
                role="img"
                aria-label="Schematic timeline showing the MODIS record, the VIIRS record and their overlap period."
                className="hidden h-auto w-full sm:block"
                initial={reduceMotion ? false : 'hidden'}
                whileInView="visible"
                viewport={{ once: true, amount: 0.4 }}
              >
                <title>MODIS and VIIRS overlap</title>
                <motion.rect
                  x="70"
                  y="22"
                  width="500"
                  height="16"
                  fill={withAlpha(bone, 0.035)}
                  variants={growBar}
                  transition={{ duration: 0.7, ease }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'left' }}
                />
                <motion.rect
                  x="315"
                  y="22"
                  width="255"
                  height="16"
                  fill={withAlpha(channel, 0.14)}
                  variants={growBar}
                  transition={{ duration: 0.7, delay: 0.16, ease }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'left' }}
                />
                <motion.line
                  x1="70"
                  y1="76"
                  x2="568"
                  y2="76"
                  stroke={withAlpha(bone, 0.38)}
                  variants={draw}
                  transition={{ duration: 0.8, delay: 0.24, ease }}
                />
                <motion.line
                  x1="315"
                  y1="52"
                  x2="568"
                  y2="52"
                  stroke={withAlpha(channel, 0.85)}
                  variants={draw}
                  transition={{ duration: 0.7, delay: 0.36, ease }}
                />
                <motion.g variants={fade} transition={{ duration: 0.5, delay: 0.5 }}>
                  <line
                    x1="315"
                    y1="52"
                    x2="315"
                    y2="76"
                    stroke={withAlpha(bone, 0.18)}
                    strokeDasharray="2 4"
                  />
                  <line x1="440" y1="22" x2="440" y2="38" stroke={withAlpha(channel, 0.75)} />
                  <line
                    x1="440"
                    y1="38"
                    x2="440"
                    y2="60"
                    stroke={withAlpha(channel, 0.35)}
                    strokeDasharray="2 4"
                  />
                  <circle cx="70" cy="76" r="3" fill={accent} />
                  <circle cx="568" cy="76" r="3" fill={accent} />
                  <circle cx="315" cy="52" r="3" fill={channel} />
                </motion.g>
                <motion.g variants={fade} transition={{ duration: 0.5, delay: 0.62 }}>
                  <text
                    x="70"
                    y="98"
                    fill={secondary}
                    fontFamily="IBM Plex Mono, monospace"
                    fontSize="13"
                    letterSpacing="1.2"
                  >
                    MODIS RECORD
                  </text>
                  <text
                    x="315"
                    y="44"
                    fill={channel}
                    fontFamily="IBM Plex Mono, monospace"
                    fontSize="13"
                    letterSpacing="1.2"
                  >
                    VIIRS RECORD
                  </text>
                  <text
                    x="330"
                    y="112"
                    fill={channel}
                    fontFamily="IBM Plex Mono, monospace"
                    fontSize="13"
                    letterSpacing="1.2"
                  >
                    OVERLAP WINDOW
                  </text>
                  <line x1="315" y1="118" x2="568" y2="118" stroke={withAlpha(channel, 0.4)} />
                  <text
                    x="70"
                    y="142"
                    fill={muted}
                    fontFamily="IBM Plex Mono, monospace"
                    fontSize="13"
                    letterSpacing="1.1"
                  >
                    ILLUSTRATIVE TIMELINE — NOT TO SCALE
                  </text>
                </motion.g>
              </motion.svg>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
