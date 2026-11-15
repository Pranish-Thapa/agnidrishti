import type { Config } from 'tailwindcss'
import { palette } from './src/lib/palette'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: palette.ink,
        forest: palette.forest,
        /** Interactive accent: the palette's warm signal orange. */
        ember: palette.amber,
        terracotta: palette.terracotta,
        /** VIIRS reference channel: the cool observation scale. */
        observation: palette.observation,
        danger: palette.danger,
        sand: palette.sand,
        bone: palette.bone,
        ash: palette.ash,
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      /**
       * Reading scale. Small type carries real information in this app, so the
       * floor for informational copy is 13px. `micro` is reserved for
       * decorative index numerals and attribution lines.
       */
      fontSize: {
        micro: ['0.8125rem', { lineHeight: '1.5' }],
        meta: ['0.875rem', { lineHeight: '1.55' }],
        support: ['0.9375rem', { lineHeight: '1.65' }],
        'body-sm': ['1rem', { lineHeight: '1.7' }],
        body: ['1rem', { lineHeight: '1.75' }],
        lead: ['1.125rem', { lineHeight: '1.7' }],
        '2xs': ['0.8125rem', { lineHeight: '1.5' }],
        xs: ['0.875rem', { lineHeight: '1.55' }],
        sm: ['0.9375rem', { lineHeight: '1.65' }],
        base: ['1rem', { lineHeight: '1.75' }],
        lg: ['1.125rem', { lineHeight: '1.6' }],
      },
      borderRadius: {
        panel: '14px',
      },
      boxShadow: {
        instrument: '0 24px 60px -32px rgb(3 7 18 / 0.85)',
        'instrument-sm': '0 16px 40px -28px rgb(3 7 18 / 0.8)',
      },
      maxWidth: {
        page: '1320px',
        prose: '68ch',
      },
      letterSpacing: {
        widest: '0.28em',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'line-draw': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        'soft-drift': {
          '0%, 100%': { transform: 'translateX(0)' },
          '50%': { transform: 'translateX(6px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.9s cubic-bezier(0.22, 1, 0.36, 1) both',
        'line-draw': 'line-draw 1.2s cubic-bezier(0.22, 1, 0.36, 1) both',
        'soft-drift': 'soft-drift 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
