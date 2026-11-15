import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Navbar } from './components/layout/Navbar'
import { Footer } from './components/layout/Footer'
import { HomePage } from './pages/HomePage'
import { ExplorerPage } from './pages/ExplorerPage'
import { MethodologyPage } from './pages/MethodologyPage'
import { AboutPage } from './pages/AboutPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { CommunityPage } from './pages/CommunityPage'
function ScrollManager() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash)
      if (target) {
        target.scrollIntoView()
        return
      }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}

const routeMeta: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Agnidrishti — See the fire. Verify the signal.',
    description:
      'A satellite-aware fire activity calendar that separates real fire trends from changes in satellite observation. Built for the NASA Space Apps Challenge 2026.',
  },
  '/explorer': {
    title: 'Explorer — Agnidrishti',
    description:
      'Explore processed MODIS and VIIRS fire observations, the provisional harmonized estimate, and the evidence behind each weekly value.',
  },
  '/methodology': {
    title: 'Methodology — Agnidrishti',
    description:
      'How Agnidrishti harmonizes MODIS and VIIRS hot spot records, validates the corrected series, and keeps uncertainty visible.',
  },
  '/community': {
    title: 'Community Intelligence — Agnidrishti',    description:
      'Historical fire activity and recent satellite detections for six study areas across Nepal, Thailand, Indonesia and Myanmar. Fire-danger assessment is shown only where it has been validated.',
  },
  '/about': {
    title: 'About — Agnidrishti',
    description:
      'Agnidrishti is an independent NASA Space Apps Challenge 2026 project addressing the harmonization of MODIS and VIIRS hot spots.',
  },
}

function RouteMetadata() {
  const { pathname } = useLocation()

  useEffect(() => {
    const meta = routeMeta[pathname] ?? {
      title: 'Page not found — Agnidrishti',
      description: 'The requested page is not part of the current Agnidrishti build.',
    }

    document.title = meta.title
    const description = document.querySelector('meta[name="description"]')
    if (description) description.setAttribute('content', meta.description)
  }, [pathname])

  return null
}

export default function App() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()

  return (
    <div className="min-h-screen overflow-x-clip bg-ink">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-full bg-bone px-4 py-2 text-body-sm font-medium text-ink transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <ScrollManager />
      <RouteMetadata />
      <Navbar />

      <main id="main-content" tabIndex={-1} className="outline-none">
        <motion.div
          key={location.pathname}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
        >
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/explorer" element={<ExplorerPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </motion.div>
      </main>

      <Footer />
    </div>
  )
}
