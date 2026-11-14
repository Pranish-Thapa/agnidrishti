/**
 * Agnidrishti colour tokens.
 *
 * Single source of truth for the brand palette. Tailwind colours are generated
 * from this module, and SVG illustrations import the same values so no
 * component invents its own hex codes.
 *
 * Palette narrative
 *   ink      charcoal with a cold forest undertone — page ground
 *   forest   deep and muted forest — secondary surfaces and selected sections
 *   terracotta  burnt earth — rules, selected states, "raw" series
 *   amber    warm light — interactive accents and highlights
 *   sand     dry grass and paper — secondary information
 *   bone     warm ivory — primary text
 *   ash      muted stone — supporting text
 */
export const palette = {
  ink: {
    DEFAULT: '#0A1211',
    950: '#0A1211',
    900: '#0D1716',
    850: '#111D1B',
    800: '#152321',
    700: '#1B2C29',
    600: '#243734',
  },
  forest: {
    deep: '#0F1E1D',
    DEFAULT: '#172B2B',
    muted: '#34483D',
    soft: '#3F5648',
  },
  terracotta: {
    DEFAULT: '#A65D3F',
    soft: '#BC7150',
    deep: '#84462E',
  },
  amber: {
    DEFAULT: '#D28A4C',
    soft: '#E3A56C',
    deep: '#B06F3A',
  },
  sand: '#E8D8BD',
  bone: '#F2E8D8',
  ash: {
    DEFAULT: '#B9B2A5',
    light: '#D3CCBD',
    dark: '#938E83',
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
