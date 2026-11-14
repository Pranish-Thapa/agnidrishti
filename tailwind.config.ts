import type { Config } from 'tailwindcss'
import { palette } from './src/lib/palette'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: palette.ink,
        forest: palette.forest,
        /** Interactive accent: the palette's warm amber light. */
        ember: palette.amber,
        terracotta: palette.terracotta,
        sand: palette.sand,
        bone: palette.bone,
        ash: palette.ash,
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
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
