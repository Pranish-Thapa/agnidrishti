import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { layers, providers, type LayerId, type ProviderId } from '../../lib/explorer'
import { studyAreas, type StudyArea, type StudyAreaId } from '../../lib/regions'

type ExplorerControlsProps = {
  area: StudyArea
  provider: ProviderId
  years: string[]
  year: string | null
  layer: LayerId
  onProviderChange: (value: ProviderId) => void
  onAreaChange: (value: StudyAreaId) => void
  onYearChange: (value: string) => void
  onLayerChange: (value: LayerId) => void
}

export function ExplorerControls({
  area,
  provider,
  years,
  year,
  layer,
  onProviderChange,
  onAreaChange,
  onYearChange,
  onLayerChange,
}: ExplorerControlsProps) {
  const reduceMotion = useReducedMotion()

  return (
    <div className="border-b border-sand/10 pb-8">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-start lg:gap-8">
        <div className="min-w-0 lg:col-span-8">
          <span className="eyebrow mb-2.5 block text-ash-dark">Study area</span>
          <div
            role="group"
            aria-label="Select a Nepal study area"
            className="grid grid-cols-3 gap-1 border border-sand/[0.14] bg-ink-900 p-1"
          >
            {studyAreas.map((item) => {
              const active = area.id === item.id

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onAreaChange(item.id)}
                  className={`group relative min-h-[58px] min-w-0 rounded-[1px] px-2.5 py-2.5 text-left transition-colors duration-200 sm:px-3.5 ${
                    active ? 'state-selected' : 'hover:bg-sand/[0.05]'
                  }`}
                >
                  <span
                    className={`block truncate text-[12px] font-medium leading-tight transition-colors sm:text-[13px] ${
                      active ? 'text-bone' : 'text-ash-light group-hover:text-bone'
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`mt-1 block font-mono text-[8px] uppercase leading-[1.35] tracking-[0.08em] transition-colors sm:text-[9px] sm:tracking-[0.1em] ${
                      active ? 'text-ember/90' : 'text-ash-dark'
                    }`}
                  >
                    {item.province}
                  </span>
                </button>
              )
            })}
          </div>

          <motion.p
            key={area.id}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            aria-live="polite"
            className="mt-3 max-w-[620px] text-[11px] leading-relaxed text-ash"
          >
            <span className="text-ash-light">{area.name}:</span> {area.description} Real processed
            observations are shown in the calendar; the map remains boundary context.
          </motion.p>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-4 lg:max-w-[230px] lg:justify-self-end">
          <div>
            <label htmlFor="provider-select" className="eyebrow mb-2.5 block text-ash-dark">
              Data product
            </label>
            <div className="relative">
              <select
                id="provider-select"
                value={provider}
                onChange={(event) => onProviderChange(event.target.value as ProviderId)}
                className="h-11 w-full appearance-none rounded-[2px] border border-sand/[0.14] bg-ink-900 pl-3.5 pr-10 font-mono text-[13px] text-bone transition-colors hover:border-sand/30 focus:border-ember/60 focus:outline-none"
              >
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={15}
                strokeWidth={1.6}
                aria-hidden="true"
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ash"
              />
            </div>
          </div>

          <div>
            <label htmlFor="year-select" className="eyebrow mb-2.5 block text-ash-dark">
              Year
            </label>
            <div className="relative">
              <select
                id="year-select"
                value={year ?? ''}
                onChange={(event) => onYearChange(event.target.value)}
                disabled={years.length === 0}
                className="h-11 w-full appearance-none rounded-[2px] border border-sand/[0.14] bg-ink-900 pl-3.5 pr-10 font-mono text-[13px] text-bone transition-colors hover:border-sand/30 focus:border-ember/60 focus:outline-none disabled:opacity-40"
              >
                {years.length === 0 && <option value="">—</option>}
                {years.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={15}
                strokeWidth={1.6}
                aria-hidden="true"
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ash"
              />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-ash-dark">
              {years.length > 0
                ? `${years[0]}–${years[years.length - 1]} available for this product.`
                : 'Years appear once the observation index loads.'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-7 grid gap-3 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-2">
          <span className="eyebrow block text-ash-dark">Data layer</span>
        </div>
        <div className="min-w-0 lg:col-span-10">
          <div
            className="flex w-full gap-1 overflow-x-auto border border-sand/[0.14] bg-ink-900 p-1"
            role="group"
            aria-label="Select data layer"
          >
            {layers.map((item) => {
              const active = layer === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onLayerChange(item.id)}
                  className={`min-h-[36px] flex-1 whitespace-nowrap rounded-[1px] px-4 text-[11px] transition-colors duration-200 ${
                    active
                      ? 'state-selected text-bone'
                      : 'text-ash-light hover:bg-sand/[0.05] hover:text-bone'
                  }`}
                >
                  {item.label}
                  <span className="ml-2 hidden font-mono text-[8px] uppercase tracking-[0.1em] text-ash sm:inline">
                    {item.note}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
