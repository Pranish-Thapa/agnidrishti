import type { ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import { palette, withAlpha } from '../../lib/palette'

type CapabilitySchematicProps = {
  variant: 'seam' | 'methods' | 'backtest'
}

const mono = 'IBM Plex Mono, monospace'
const ease = [0.22, 1, 0.36, 1] as const

const bone = palette.bone
const ash = palette.ash.light
const accent = palette.amber.DEFAULT
const raw = palette.terracotta.soft
const adjusted = palette.sand
const axis = withAlpha(bone, 0.11)
const faint = withAlpha(bone, 0.08)

const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

const rise: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: { opacity: 1, y: 0 },
}

const draw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: { pathLength: 1, opacity: 1 },
}

const pop: Variants = {
  hidden: { opacity: 0, scale: 0.4 },
  visible: { opacity: 1, scale: 1 },
}

const markerOrigin = { transformBox: 'fill-box', transformOrigin: 'center' } as const

function SchematicFrame({
  children,
  label,
  title,
}: {
  children: ReactNode
  label: string
  title: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.svg
      viewBox="0 0 300 150"
      role="img"
      aria-label={label}
      className="h-auto w-full"
      initial={reduceMotion ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, amount: 0.4 }}
    >
      <title>{title}</title>
      {children}
    </motion.svg>
  )
}

export function CapabilitySchematic({ variant }: CapabilitySchematicProps) {
  if (variant === 'seam') {
    return (
      <SchematicFrame
        label="Schematic of a raw detection series stepping up at a satellite transition while an adjusted series remains continuous."
        title="Seam Audit schematic"
      >
        <motion.g variants={fade} transition={{ duration: 0.45 }}>
          <line x1="18" y1="118" x2="282" y2="118" stroke={axis} />
          <line x1="18" y1="32" x2="18" y2="118" stroke={axis} />
        </motion.g>

        <motion.line
          x1="148"
          y1="28"
          x2="148"
          y2="118"
          stroke={withAlpha(accent, 0.5)}
          strokeDasharray="3 5"
          variants={fade}
          transition={{ duration: 0.5, delay: 0.08 }}
        />
        <motion.text
          x="153"
          y="26"
          fill={accent}
          fontFamily={mono}
          fontSize="10"
          letterSpacing="1"
          variants={fade}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          TRANSITION
        </motion.text>

        <motion.polyline
          points="18,91 58,82 94,86 126,76 148,78 154,47 198,44 236,39 282,36"
          fill="none"
          stroke={withAlpha(raw, 0.92)}
          strokeWidth="1.4"
          strokeDasharray="4 4"
          variants={fade}
          transition={{ duration: 0.55, delay: 0.2 }}
        />
        <motion.polyline
          points="18,95 58,87 94,91 126,83 148,85 154,78 198,73 236,69 282,66"
          fill="none"
          stroke={withAlpha(adjusted, 0.9)}
          strokeWidth="1.6"
          variants={draw}
          transition={{ duration: 0.85, delay: 0.42, ease }}
        />
        <motion.circle
          cx="154"
          cy="47"
          r="2.5"
          fill={raw}
          variants={pop}
          transition={{ duration: 0.35, delay: 0.78, ease }}
          style={markerOrigin}
        />
        <motion.circle
          cx="198"
          cy="73"
          r="2.5"
          fill={adjusted}
          variants={pop}
          transition={{ duration: 0.35, delay: 0.94, ease }}
          style={markerOrigin}
        />
        <motion.text
          x="184"
          y="30"
          fill={raw}
          fontFamily={mono}
          fontSize="10"
          letterSpacing="0.8"
          variants={fade}
          transition={{ duration: 0.4, delay: 0.9 }}
        >
          RAW
        </motion.text>
        <motion.text
          x="198"
          y="64"
          fill={adjusted}
          fontFamily={mono}
          fontSize="10"
          letterSpacing="0.8"
          variants={fade}
          transition={{ duration: 0.4, delay: 1.04 }}
        >
          ADJUSTED
        </motion.text>
      </SchematicFrame>
    )
  }

  if (variant === 'methods') {
    return (
      <SchematicFrame
        label="Schematic comparing three correction methods, each showing a peak at a similar position."
        title="Method Court schematic"
      >
        <motion.g variants={fade} transition={{ duration: 0.5 }}>
          <rect x="178" y="24" width="48" height="98" fill={withAlpha(accent, 0.055)} />
          <line
            x1="178"
            y1="24"
            x2="178"
            y2="122"
            stroke={withAlpha(accent, 0.2)}
            strokeDasharray="2 4"
          />
          <line
            x1="226"
            y1="24"
            x2="226"
            y2="122"
            stroke={withAlpha(accent, 0.2)}
            strokeDasharray="2 4"
          />
        </motion.g>

        {[0, 1, 2].map((row) => {
          const base = 42 + row * 34
          return (
            <motion.g
              key={row}
              variants={rise}
              transition={{ duration: 0.55, delay: 0.14 + row * 0.13, ease }}
            >
              <line x1="28" y1={base} x2="274" y2={base} stroke={faint} />
              <polyline
                points={`28,${base} 70,${base + 2} 108,${base - 4} 148,${base + 3} 178,${base - 7} 202,${base - 20} 226,${base - 4} 252,${base + 4} 274,${base + 2}`}
                fill="none"
                stroke={row === 1 ? withAlpha(adjusted, 0.8) : withAlpha(bone, 0.32)}
                strokeWidth="1.3"
              />
              <circle cx="202" cy={base - 20} r="2.2" fill={accent} />
              <text
                x="28"
                y={base - 8}
                fill={ash}
                fontFamily={mono}
                fontSize="10"
                letterSpacing="0.8"
              >
                {['RATIO', 'QUANTILE', 'SHRINKAGE'][row]}
              </text>
            </motion.g>
          )
        })}

        <motion.text
          x="166"
          y="138"
          fill={accent}
          fontFamily={mono}
          fontSize="10"
          letterSpacing="0.8"
          variants={fade}
          transition={{ duration: 0.5, delay: 0.58 }}
        >
          AGREEMENT WINDOW
        </motion.text>
      </SchematicFrame>
    )
  }

  return (
    <SchematicFrame
      label="Schematic of a record with a withheld segment reconstructed across the gap."
      title="Lights-Out Backtest schematic"
    >
      <motion.line
        x1="18"
        y1="112"
        x2="282"
        y2="112"
        stroke={axis}
        variants={draw}
        transition={{ duration: 0.6, ease }}
      />
      <motion.rect
        x="118"
        y="54"
        width="68"
        height="58"
        fill={withAlpha(accent, 0.04)}
        variants={fade}
        transition={{ duration: 0.5, delay: 0.18 }}
      />
      <motion.g variants={fade} transition={{ duration: 0.5, delay: 0.24 }}>
        <line
          x1="118"
          y1="54"
          x2="118"
          y2="112"
          stroke={withAlpha(accent, 0.35)}
          strokeDasharray="3 4"
        />
        <line
          x1="186"
          y1="54"
          x2="186"
          y2="112"
          stroke={withAlpha(accent, 0.35)}
          strokeDasharray="3 4"
        />
      </motion.g>

      <motion.polyline
        points="18,92 48,88 78,90 106,84 118,84"
        fill="none"
        stroke={withAlpha(adjusted, 0.75)}
        strokeWidth="1.4"
        variants={draw}
        transition={{ duration: 0.55, delay: 0.2, ease }}
      />
      <motion.polyline
        points="118,84 140,79 164,76 186,79 210,72 242,68 282,62"
        fill="none"
        stroke={withAlpha(adjusted, 0.75)}
        strokeWidth="1.4"
        variants={draw}
        transition={{ duration: 0.65, delay: 0.5, ease }}
      />
      <motion.polyline
        points="118,84 144,85 170,80 186,79"
        fill="none"
        stroke={withAlpha(raw, 0.95)}
        strokeWidth="1.5"
        strokeDasharray="3 3"
        variants={fade}
        transition={{ duration: 0.5, delay: 0.76 }}
      />

      <motion.g
        variants={fade}
        transition={{ duration: 0.5, delay: 0.7 }}
        style={markerOrigin}
      >
        {[18, 48, 78, 106, 118, 186, 210, 242, 282].map((x, index) => (
          <circle
            key={`${x}-${index}`}
            cx={x}
            cy={[92, 88, 90, 84, 84, 79, 72, 68, 62][index]}
            r="2"
            fill={x >= 118 && x <= 186 ? withAlpha(raw, 0.9) : withAlpha(adjusted, 0.55)}
          />
        ))}
      </motion.g>

      <motion.text
        x="152"
        y="48"
        fill={accent}
        fontFamily={mono}
        fontSize="10"
        letterSpacing="1"
        variants={fade}
        transition={{ duration: 0.45, delay: 0.62 }}
      >
        WITHHELD
      </motion.text>
      <motion.text
        x="188"
        y="92"
        fill={raw}
        fontFamily={mono}
        fontSize="10"
        letterSpacing="0.8"
        variants={fade}
        transition={{ duration: 0.45, delay: 0.95 }}
      >
        RECONSTRUCTION
      </motion.text>
    </SchematicFrame>
  )
}
