import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH lets the GitHub Pages deploy build with /agnidrishti/ asset paths
// while local development keeps the root base.
const basePath = process.env.BASE_PATH || '/'

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    port: 5173,
  },
})
