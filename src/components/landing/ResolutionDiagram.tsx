import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { palette, withAlpha } from '../../lib/palette'

const ease = [0.22, 1, 0.36, 1] as const

const inkLine = withAlpha(palette.bone, 0.2)
const hairline = withAlpha(palette.bone, 0.09)
const frame = withAlpha(palette.bone, 0.46)
const label = withAlpha(palette.bone, 0.92)
const secondary = palette.ash.DEFAULT
const amber = palette.amber.DEFAULT

const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
}

const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

const draw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: { pathLength: 1, opacity: 1 },
}

const pop: Variants = {
  hidden: { opacity: 0, scale: 0.55 },
  visible: { opacity: 1, scale: 1 },
}

const markerOrigin = { transformBox: 'fill-box', transformOrigin: 'center' } as const

export function ResolutionDiagram() {
  const reduceMotion = useReducedMotion()

  return (
    <figure className="panel relative overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-sand/10 px-5 py-4 sm:px-6">
        <p className="mono-meta text-ash">Nominal pixel width at nadir</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-sand/80">
          Illustrative scale diagram
        </p>
      </div>

      <div className="relative bg-ink-900/60 px-4 py-5 sm:px-6 sm:py-7">
        <div
          className="pointer-events-none absolute inset-0 bg-blueprint-fine opacity-30"
          aria-hidden="true"
        />
        <motion.svg
          viewBox="0 0 620 410"
          role="img"
          aria-labelledby="resolution-title resolution-desc"
          className="relative mx-auto block h-auto w-full max-w-[620px]"
          initial={reduceMotion ? false : 'hidden'}
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
        >
          <title id="resolution-title">Relative nominal pixel sizes of MODIS and VIIRS</title>
          <desc id="resolution-desc">
            A MODIS pixel at roughly one kilometre is shown next to a VIIRS I-band pixel at roughly
            375 metres. The widths are drawn to relative scale. This is a schematic, not an
            observation.
          </desc>

          <motion.line
            x1="42"
            y1="318"
            x2="578"
            y2="318"
            stroke={inkLine}
            strokeWidth="1"
            variants={draw}
            transition={{ duration: 0.9, ease }}
          />

          <motion.g variants={rise} transition={{ duration: 0.7, delay: 0.08, ease }}>
            <rect
              x="62"
              y="88"
              width="232"
              height="230"
              fill={withAlpha(palette.bone, 0.018)}
              stroke={frame}
              strokeWidth="1.2"
            />
            {[0.25, 0.5, 0.75].map((fraction) => (
              <g key={`m-${fraction}`} stroke={hairline} strokeWidth="1">
                <line
                  x1={62 + 232 * fraction}
                  y1="88"
                  x2={62 + 232 * fraction}
                  y2="318"
                />
                <line
                  x1="62"
                  y1={88 + 230 * fraction}
                  x2="294"
                  y2={88 + 230 * fraction}
                />
              </g>
            ))}
          </motion.g>

          <motion.g variants={fade} transition={{ duration: 0.6, delay: 0.22 }}>
            <text
              x="62"
              y="64"
              fill={label}
              fontFamily="IBM Plex Mono, monospace"
              fontSize="18"
              letterSpacing="1.5"
            >
              MODIS
            </text>
            <text
              x="62"
              y="366"
              fill={secondary}
              fontFamily="IBM Plex Mono, monospace"
              fontSize="16"
              letterSpacing="1"
            >
              ~1 km
            </text>
          </motion.g>

          <motion.g variants={rise} transition={{ duration: 0.7, delay: 0.3, ease }}>
            <rect
              x="406"
              y="231"
              width="87"
              height="87"
              fill={withAlpha(amber, 0.035)}
              stroke={frame}
              strokeWidth="1.2"
            />
            <line x1="406" y1="274.5" x2="493" y2="274.5" stroke={hairline} />
            <line x1="449.5" y1="231" x2="449.5" y2="318" stroke={hairline} />
          </motion.g>

          <motion.g variants={fade} transition={{ duration: 0.6, delay: 0.44 }}>
            <text
              x="406"
              y="207"
              fill={label}
              fontFamily="IBM Plex Mono, monospace"
              fontSize="18"
              letterSpacing="1.5"
            >
              VIIRS
            </text>
            <text
              x="406"
              y="366"
              fill={secondary}
              fontFamily="IBM Plex Mono, monospace"
              fontSize="16"
              letterSpacing="1"
            >
              ~375 m
            </text>
          </motion.g>

          <motion.g
            variants={pop}
            transition={{ duration: 0.5, delay: 0.52, ease }}
            style={markerOrigin}
          >
            <circle cx="188" cy="208" r="17" fill={withAlpha(amber, 0.08)} />
            <circle cx="188" cy="208" r="8" fill={withAlpha(amber, 0.16)} />
            <circle cx="188" cy="208" r="3.4" fill={amber} />
            <line x1="188" y1="188" x2="188" y2="228" stroke={withAlpha(amber, 0.32)} />
            <line x1="168" y1="208" x2="208" y2="208" stroke={withAlpha(amber, 0.32)} />
          </motion.g>

          <motion.g
            variants={pop}
            transition={{ duration: 0.5, delay: 0.58, ease }}
            style={markerOrigin}
          >
            <circle cx="449.5" cy="274.5" r="10" fill={withAlpha(amber, 0.08)} />
            <circle cx="449.5" cy="274.5" r="2.8" fill={amber} />
            <line x1="449.5" y1="261" x2="449.5" y2="288" stroke={withAlpha(amber, 0.32)} />
            <line x1="436" y1="274.5" x2="463" y2="274.5" stroke={withAlpha(amber, 0.32)} />
          </motion.g>

          <motion.line
            x1="294"
            y1="318"
            x2="406"
            y2="318"
            stroke={withAlpha(palette.bone, 0.18)}
            strokeDasharray="3 5"
            variants={fade}
            transition={{ duration: 0.5, delay: 0.5 }}
          />
          <motion.text
            x="310"
            y="306"
            fill={secondary}
            fontFamily="IBM Plex Mono, monospace"
            fontSize="13"
            letterSpacing="1"
            variants={fade}
            transition={{ duration: 0.5, delay: 0.62 }}
          >
            relative width
          </motion.text>

          <motion.g variants={fade} transition={{ duration: 0.6, delay: 0.68 }}>
            <line x1="62" y1="392" x2="294" y2="392" stroke={withAlpha(palette.bone, 0.34)} />
            <line x1="62" y1="386" x2="62" y2="398" stroke={withAlpha(palette.bone, 0.34)} />
            <line x1="294" y1="386" x2="294" y2="398" stroke={withAlpha(palette.bone, 0.34)} />
            <text
              x="62"
              y="408"
              fill={secondary}
              fontFamily="IBM Plex Mono, monospace"
              fontSize="13"
              letterSpacing="1.2"
            >
              1 km reference
            </text>
          </motion.g>
        </motion.svg>
      </div>

      <figcaption className="border-t border-sand/10 px-5 py-4 text-[11px] leading-relaxed text-ash-dark sm:px-6">
        Pixel widths are drawn at true relative scale. By nominal area, roughly seven VIIRS I-band
        footprints fit within one 1 km MODIS pixel. This is a schematic, not an observation.
      </figcaption>
    </figure>
  )
}
