import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { Logo } from '../ui/Logo'
import { navLinks, site } from '../../lib/site'

const menuList: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
}

const menuItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
  },
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const reduceMotion = useReducedMotion()
  const isHome = pathname === '/'

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const solid = !isHome || scrolled || menuOpen

  return (
    <>
      <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
        solid
          ? 'border-b border-sand/10 bg-ink-950/95 backdrop-blur-md'
          : 'border-b border-transparent bg-gradient-to-b from-ink-950/70 to-transparent'
      }`}
    >
      <div className="container-page flex h-[72px] items-center justify-between gap-6 md:h-[80px]">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-8 lg:flex">
          {navLinks.map((link) => {
            const isActive =
              link.to === '/' ? pathname === '/' : pathname.startsWith(link.to)

            return (
              <NavLink
                key={link.to}
                to={link.to}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-2 text-[13px] transition-colors duration-300 ${
                  isActive ? 'text-bone' : 'text-ash-light hover:text-bone'
                }`}
              >
                {link.label}
                {isActive ? (
                  <motion.span
                    layoutId="nav-active-underline"
                    className="absolute -bottom-0.5 left-0 h-px w-full bg-ember"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
                    }
                    aria-hidden="true"
                  />
                ) : null}
              </NavLink>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/explorer"
            className="group hidden min-h-[40px] items-center gap-2 rounded-[2px] border border-sand/30 px-4 text-[12px] font-medium text-bone transition-colors duration-300 hover:border-ember/60 hover:bg-ember/[0.06] sm:inline-flex"
          >
            Open Explorer
            <ArrowUpRight
              size={14}
              strokeWidth={1.8}
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[2px] border border-sand/20 text-bone transition-colors hover:border-sand/40 lg:hidden"
          >
            {menuOpen ? <X size={18} strokeWidth={1.6} /> : <Menu size={18} strokeWidth={1.6} />}
          </button>
        </div>
      </div>
    </header>

    <AnimatePresence>
        {menuOpen ? (
          <motion.div
            id="mobile-menu"
            initial={reduceMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-0 top-[72px] z-40 overflow-y-auto bg-ink-950 md:top-[80px] lg:hidden"
          >
            <div className="container-page flex min-h-full flex-col pb-10 pt-10">
              <motion.nav
                aria-label="Mobile"
                className="flex flex-col"
                variants={menuList}
                initial={reduceMotion ? false : 'hidden'}
                animate="visible"
              >
                {navLinks.map((link, index) => {
                  const isActive =
                    link.to === '/' ? pathname === '/' : pathname.startsWith(link.to)

                  return (
                    <motion.div key={link.to} variants={menuItem}>
                      <NavLink
                        to={link.to}
                        aria-current={isActive ? 'page' : undefined}
                        className={`group flex items-baseline gap-5 border-b border-sand/10 py-5 ${
                          isActive ? 'text-bone' : 'text-ash-light'
                        }`}
                      >
                        <span className="font-mono text-[10px] tracking-[0.16em] text-ember">
                          0{index + 1}
                        </span>
                        <span className="display text-4xl leading-none transition-colors group-hover:text-ember-soft sm:text-5xl">
                          {link.label}
                        </span>
                        {isActive ? (
                          <span
                            className="ml-auto h-1 w-1 rounded-full bg-ember"
                            aria-hidden="true"
                          />
                        ) : null}
                      </NavLink>
                    </motion.div>
                  )
                })}
              </motion.nav>

              <div className="mt-auto pt-12">
                <Link
                  to="/explorer"
                  className="group flex min-h-[50px] w-full items-center justify-between border border-ember/50 bg-ember px-5 text-[13px] font-medium text-ink-950 transition-colors hover:bg-ember-soft"
                >
                  Open Explorer
                  <ArrowUpRight
                    size={16}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </Link>
                <div className="mt-8 flex items-end justify-between gap-6">
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.22em] text-bone">
                      {site.wordmark}
                    </p>
                    <p className="mt-2 font-display text-lg italic text-ash">{site.tagline}</p>
                  </div>
                  <p className="max-w-[150px] text-right font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-ash-dark">
                    {site.challengeShort}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
