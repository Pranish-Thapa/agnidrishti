import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { layers, providers, type LayerId, type ProviderId } from '../../lib/explorer'
import { studyAreas, type StudyArea } from '../../lib/regions'

type ExplorerControlsProps = {
  area: StudyArea
  provider: ProviderId
  years: string[]
  year: string | null
  layer: LayerId
  /** Layers that have no fitted model for this area (e.g. harmonized outside Nepal). */
  unavailableLayers?: LayerId[]
  indexLoading: boolean
  onProviderChange: (value: ProviderId) => void
  onAreaChange: (value: string) => void
  onYearChange: (value: string) => void
  onLayerChange: (value: LayerId) => void
}

export function ExplorerControls({
  area,
  provider,
  years,
  year,
  layer,
  unavailableLayers = [],
  indexLoading,
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
          <span className="eyebrow mb-2.5 block text-ash">Study area</span>
          <div
            role="group"
            aria-label="Select a study area"
            className="grid grid-cols-3 gap-1 rounded-xl border border-sand/[0.12] bg-ink-900/75 p-1"
          >
            {studyAreas.map((item) => {
              const active = area.id === item.id

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onAreaChange(item.id)}
                  className={`group relative min-h-[62px] min-w-0 rounded-lg px-2.5 py-2.5 text-left transition-[background-color,box-shadow] duration-200 sm:px-3.5 ${
                    active ? 'state-selected' : 'hover:bg-sand/[0.05]'
                  }`}
                >
                  <span
                    className={`block truncate text-support font-medium leading-tight transition-colors sm:text-body-sm ${
                      active ? 'text-bone' : 'text-ash-light group-hover:text-bone'
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`mt-1 block text-meta leading-[1.35] transition-colors sm:text-meta ${
                      active ? 'text-amber-soft/90' : 'text-ash-dark'
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
            className="mt-3 max-w-[620px] text-support leading-relaxed text-ash"
          >
            <span className="text-ash-light">{area.name}:</span> {area.description} The calendar,
            weekly detail and map read from the processed observations for this selection.
          </motion.p>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-4 lg:max-w-[262px] lg:justify-self-end">
          <div>
            <label htmlFor="provider-select" className="eyebrow mb-2.5 block text-ash">
              Data product
            </label>
            <div className="relative">
              <select
                id="provider-select"
                value={provider}
                onChange={(event) => onProviderChange(event.target.value as ProviderId)}
                className="h-11 w-full appearance-none rounded-lg border border-sand/[0.14] bg-ink-900 pl-3.5 pr-10 font-mono text-body-sm text-bone transition-[border-color,background-color] hover:border-sand/30 focus:border-ember/60 focus:outline-none"
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
            <label htmlFor="year-select" className="eyebrow mb-2.5 block text-ash">
              Year
            </label>
            <div className="relative">
              <select
                id="year-select"
                value={year ?? ''}
                onChange={(event) => onYearChange(event.target.value)}
                disabled={years.length === 0}
                className="h-11 w-full appearance-none rounded-lg border border-sand/[0.14] bg-ink-900 pl-3.5 pr-10 font-mono text-body-sm text-bone transition-[border-color,background-color] hover:border-sand/30 focus:border-ember/60 focus:outline-none disabled:opacity-40"
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
            <p className="mt-2 text-support leading-relaxed text-ash-dark">
              {years.length > 0
                ? `${years[0]}–${years[years.length - 1]} acquired for this area and product.`
                : indexLoading
                  ? 'Loading the observation index…'
                  : 'No years acquired for this area and product.'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-7 grid gap-3 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-2">
          <span className="eyebrow block text-ash">Data layer</span>
        </div>
        <div className="min-w-0 lg:col-span-10">
          <div
            className="flex w-full gap-1 overflow-x-auto rounded-xl border border-sand/[0.12] bg-ink-900/75 p-1"
            role="group"
            aria-label="Select data layer"
          >
            {layers.map((item) => {
              const active = layer === item.id
              const unavailable = unavailableLayers.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  aria-disabled={unavailable}
                  disabled={unavailable}
                  title={
                    unavailable
                      ? 'The harmonized layer needs a fitted model or a pre-2012 transferability decision for this region.'
                      : undefined
                  }
                  onClick={() => onLayerChange(item.id)}
                  className={`min-h-[38px] flex-1 whitespace-nowrap rounded-lg px-4 text-support transition-[background-color,box-shadow,color] duration-200 ${
                    unavailable
                      ? 'cursor-not-allowed text-ash-dark opacity-50'
                      : active
                        ? 'state-selected text-bone'
                        : 'text-ash-light hover:bg-sand/[0.05] hover:text-bone'
                  }`}
                >
                  {item.label}
                  <span className="ml-2 hidden text-support text-ash sm:inline">
                    {unavailable ? 'No regional evidence' : item.note}
                  </span>
                </button>
              )
            })}
          </div>
          {unavailableLayers.length > 0 && (
            <p className="mt-2 text-support leading-relaxed text-ash-dark">
              Harmonized is unavailable for this area: there is no fitted calibration or
              pre-2012 transferability decision for it. Raw MODIS and VIIRS observations are shown
              unchanged, and no other region&rsquo;s factors are substituted.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
