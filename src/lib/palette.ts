/**
 * Agnidrishti colour tokens — "Observation Deck" identity.
 *
 * Deep navy ground (the satellite's cold vantage point) with warm signal-orange
 * detections cutting through the dark, and a cool sky-blue observation channel
 * for VIIRS-scale values. The warm/cool split mirrors the app's core question:
 * separating the fire signal (warm) from the observation reference (cool).
 *
 * Palette narrative
 *   ink          deep navy-charcoal — the observation deck at night
 *   forest       progressive navy panels — instrument surfaces
 *   terracotta   deep signal orange — raw MODIS / danger scale
 *   amber        vivid signal orange — interactive accents, highlights
 *   observation  sky blue — the VIIRS reference scale (new channel)
 *   sand         cool blue-grey — rules and hairlines
 *   bone         cool off-white — primary readouts
 *   ash          blue-grey — secondary readouts
 */
export const palette = {
  ink: {
    DEFAULT: '#0B1120',
    950: '#070B14',
    900: '#0B1120',
    850: '#0F1729',
    800: '#131E36',
    700: '#1C2C4E',
    600: '#27395F',
  },
  forest: {
    deep: '#0A1322',
    DEFAULT: '#101B31',
    muted: '#1D3357',
    soft: '#294673',
  },
  terracotta: {
    DEFAULT: '#C2410C',
    soft: '#EA580C',
    deep: '#9A3412',
  },
  amber: {
    DEFAULT: '#F97316',
    soft: '#FB923C',
    deep: '#EA580C',
  },
  observation: {
    DEFAULT: '#38BDF8',
    soft: '#7DD3FC',
    deep: '#0284C7',
  },
  danger: {
    low: '#2F7D6A',
    moderate: '#EAB308',
    high: '#F59E0B',
    very_high: '#EA580C',
    extreme: '#DC2626',
  },
  sand: '#A8B6CE',
  bone: '#F1F5F9',
  ash: {
    DEFAULT: '#8496B3',
    light: '#ADBCCF',
    dark: '#6B7D9B',
  },
} as const

/** Convert a palette hex value into an rgba() string for SVG attributes. */
export function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
