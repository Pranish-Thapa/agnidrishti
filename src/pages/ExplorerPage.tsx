import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Reveal } from '../components/ui/Reveal'
import { ExplorerControls } from '../components/explorer/ExplorerControls'
import { CalendarPanel } from '../components/explorer/CalendarPanel'
import { CriticalPeriodsPanel } from '../components/explorer/CriticalPeriodsPanel'
import { MapPanel } from '../components/explorer/MapPanel'
import { ReadinessPanel } from '../components/explorer/ReadinessPanel'
import { ComparisonChart } from '../components/explorer/ComparisonChart'
import { DistrictSmallMultiples } from '../components/explorer/DistrictSmallMultiples'
import { HarmonizationScope } from '../components/methodology/HarmonizationScope'
import { MethodComparison } from '../components/methodology/MethodComparison'
import { layers, type LayerId, type ProviderId } from '../lib/explorer'
import { aggregateDistrictYear, type DistrictYearSummary } from '../lib/layers'
import { defaultStudyAreaId, getStudyArea, studyAreas } from '../lib/regions'
import {
  availableYearsFor,
  loadDistrictYear,
  loadObservationIndex,
  studyAreaIndexEntry,
  type ObservationDataset,
  type ObservationIndex,
} from '../lib/observations'
import {
  loadExperimentSummary,
  loadHarmonizationFactors,
  type ExperimentSummary,
  type HarmonizationFactors,
} from '../lib/experiments'
import { loadBackcast, type BackcastArtifact } from '../lib/backcast'

const studyAreasOrder = studyAreas.map((a) => a.id)

export function ExplorerPage() {
  const [provider, setProvider] = useState<ProviderId>('sp')
  const [areaId, setAreaId] = useState<string>(defaultStudyAreaId)
  const [year, setYear] = useState<string | null>(null)
  const [layer, setLayer] = useState<LayerId>('harmonized')

  const [index, setIndex] = useState<ObservationIndex | null>(null)
  const [dataset, setDataset] = useState<ObservationDataset | null>(null)
  const [summary, setSummary] = useState<ExperimentSummary | null>(null)
  const [factors, setFactors] = useState<HarmonizationFactors | null>(null)
  const [backcast, setBackcast] = useState<BackcastArtifact | null>(null)
  const [indexLoading, setIndexLoading] = useState(true)
  const [datasetLoading, setDatasetLoading] = useState(true)
  const [districtSummaries, setDistrictSummaries] = useState<(DistrictYearSummary | null)[] | null>(null)
  const [searchParams] = useSearchParams()
  const openExpandedMap = searchParams.get('map') === 'expanded'

  const area = getStudyArea(areaId)
  const activeLayer = layers.find((item) => item.id === layer) ?? layers[0]

  // Experiment artifacts are provider-independent and load once.
  useEffect(() => {
    const controller = new AbortController()
    loadExperimentSummary(controller.signal).then(setSummary)
    loadHarmonizationFactors(controller.signal).then(setFactors)
    loadBackcast(controller.signal).then(setBackcast)
    return () => controller.abort()
  }, [])

  // Observation index per provider.
  useEffect(() => {
    const controller = new AbortController()
    setIndexLoading(true)
    setIndex(null)
    loadObservationIndex(provider, controller.signal)
      .then(setIndex)
      .finally(() => setIndexLoading(false))
    return () => controller.abort()
  }, [provider])

  // Years are per region and provider: the index `years` array is the union
  // across study areas and would offer years this region never acquired.
  const areaIndex = useMemo(() => studyAreaIndexEntry(index, areaId), [index, areaId])
  const years = useMemo(() => availableYearsFor(index, areaId), [index, areaId])

  useEffect(() => {
    if (indexLoading) return
    setYear((current) =>
      current && years.includes(current) ? current : (years[years.length - 1] ?? null),
    )
  }, [indexLoading, years])

  // Study-area-year summaries for all six areas (map choropleth). The selected
  // area's dataset is loaded separately for the detail panel.
  useEffect(() => {
    if (year === null) {
      setDistrictSummaries(null)
      return
    }
    const controller = new AbortController()
    Promise.all(
      studyAreasOrder.map((id) => loadDistrictYear(id, year, provider, controller.signal)),
    ).then((datasets) => {
      if (controller.signal.aborted) return
      const summaries: (DistrictYearSummary | null)[] = datasets.map((ds) =>
        ds ? aggregateDistrictYear(ds, layer, factors, backcast) : null,
      )
      setDistrictSummaries(summaries)
    })
    return () => controller.abort()
  }, [provider, year, layer, factors, backcast])

  // District-year dataset.
  useEffect(() => {
    if (year === null) {
      setDataset(null)
      setDatasetLoading(false)
      return
    }
    const controller = new AbortController()
    setDatasetLoading(true)
    setDataset(null)
    loadDistrictYear(areaId, year, provider, controller.signal)
      .then(setDataset)
      .finally(() => setDatasetLoading(false))
    return () => controller.abort()
  }, [provider, areaId, year])

  // Harmonized values need either post-2012 fitted factors or a pre-2012
  // transferability decision for the selected region. Selecting a region with
  // neither would silently render an empty layer, so fall back to raw MODIS.
  const harmonizedAvailable =
    provider === 'sp' &&
    Boolean(factors?.districts[areaId] || backcast?.regions[areaId])
  useEffect(() => {
    if (layer !== 'harmonized') return
    if (provider === 'nrt') {
      setLayer('modis')
      return
    }
    if (factors && backcast && !harmonizedAvailable) setLayer('modis')
  }, [factors, backcast, harmonizedAvailable, layer, provider])

  const acquisitionNotice =
    !indexLoading && areaIndex?.status === 'not_acquired'
      ? `${provider === 'sp' ? 'Standard Processing' : 'Near Real-Time'} observations have not been acquired for ${area.name}. ${
          areaIndex.status_reason ?? 'The area is shown with its boundary only.'
        }`
      : null

  const reliabilityGrid = summary?.reliability.grid ?? null

  const earliestYear = useMemo(() => {
    const years = (index?.study_areas ?? []).flatMap((entry) => entry.years)
    return years.length > 0 ? years.reduce((a, b) => (a < b ? a : b)) : null
  }, [index])

  const backcastDecisions = useMemo(() => {
    if (!backcast) return { supported: 0, limited: 0, total: 0 }
    const all = Object.values(backcast.regions).flatMap((platforms) =>
      Object.values(platforms).filter((info): info is NonNullable<typeof info> => Boolean(info)),
    )
    return {
      supported: all.filter((info) => info.decision === 'SUPPORTED').length,
      limited: all.filter((info) => info.decision === 'LIMITED').length,
      total: all.length,
    }
  }, [backcast])

  return (
    <>
      <PageHeader
        index="01"
        label="Six study areas across Asia"
        title={
          <>
            Explore <span className="text-observation-soft">fire activity across Asia.</span>
          </>
        }
        intro={
          <>
            <p>
              Investigate historical fire activity across six study areas in Nepal, Thailand,
              Indonesia and Myanmar, while accounting for differences in satellite observations.
            </p>
            <p className="mt-4 text-support leading-relaxed text-ash-dark">
              These are selected high-fire study areas, not a definitive ranking; other districts
              and provinces also experience substantial fire activity. Values shown are satellite
              hotspot detections — never unique fires, never zero-filled where unobserved.
            </p>
          </>
        }
        aside={
          <div className="card w-full max-w-[320px] p-5">
            <p className="eyebrow text-ash">Build status</p>
            <ul className="mt-4 space-y-3">
              <li className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ember" aria-hidden="true" />
                <span className="text-support leading-snug text-bone">
                  Historical SP connected for all six study areas
                  {earliestYear ? ` (${earliestYear}–2026)` : ' (per-region years)'}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-observation" aria-hidden="true" />
                <span className="text-support leading-snug text-bone">
                  NRT snapshot connected for all six study areas
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sand/60" aria-hidden="true" />
                <span className="text-support leading-snug text-ash-light">
                  Harmonized layer per region —{' '}
                  {backcast
                    ? `${backcastDecisions.supported} supported · ${backcastDecisions.limited} limited · ${
                        backcastDecisions.total - backcastDecisions.supported - backcastDecisions.limited
                      } raw-only`
                    : 'court verdict inconclusive'}
                </span>
              </li>
            </ul>
            <p className="mt-4 border-t border-sand/10 pt-3 text-support leading-relaxed text-ash">
              The calendar, weekly detail and map run on processed FIRMS data. Missing observations
              are shown as missing, never as zero.
            </p>
          </div>
        }
      />

      <section className="section-y pt-12 md:pt-14">
        <div className="container-page">
          <ExplorerControls
            area={area}
            provider={provider}
            years={years}
            year={year}
            layer={layer}
            unavailableLayers={
              provider === 'nrt' || (factors && !harmonizedAvailable) ? ['harmonized'] : []
            }
            indexLoading={indexLoading}
            onProviderChange={setProvider}
            onAreaChange={setAreaId}
            onYearChange={setYear}
            onLayerChange={setLayer}
          />

          {acquisitionNotice && (
            <p
              role="status"
              className="mt-5 rounded-lg border border-amber/25 bg-amber/[0.06] px-4 py-3 text-support leading-relaxed text-ash"
            >
              <span className="font-medium text-bone">Missing coverage, not zero activity. </span>
              {acquisitionNotice}
            </p>
          )}

          <div className="mt-8 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-8 xl:col-span-7">
              <Reveal>
                <CalendarPanel
                  areaName={area.name}
                  province={area.province}
                  year={year ?? '—'}
                  layer={layer}
                  layerLabel={activeLayer.label}
                  layerNote={activeLayer.note}
                  dataset={dataset}
                  factors={factors}
                  backcast={backcast}
                  reliabilityGrid={reliabilityGrid}
                  loading={indexLoading || datasetLoading}
                />
              </Reveal>
              <Reveal delay={0.04}>
                <HarmonizationScope compact />
              </Reveal>
              <Reveal delay={0.05}>
                <MethodComparison summary={summary} areaId={area.id} compact />
              </Reveal>
              {dataset && (
                <Reveal delay={0.04}>
                  <ComparisonChart
                    dataset={dataset}
                    districtName={area.name}
                    layer={layer}
                    factors={factors}
                    backcast={backcast}
                    reliabilityGrid={reliabilityGrid}
                  />
                </Reveal>
              )}
              <Reveal delay={0.06}>
                <CriticalPeriodsPanel dataset={dataset} />
              </Reveal>
              <Reveal delay={0.08}>
                <DistrictSmallMultiples
                  summaries={districtSummaries}
                  layerLabel={activeLayer.label}
                  year={year}
                  provider={provider}
                />
              </Reveal>
            </div>

            <div className="min-w-0 lg:col-span-4 xl:col-span-5">
              <Reveal delay={0.08}>
                <MapPanel
                  area={area}
                  layerLabel={activeLayer.label}
                  layer={layer}
                  year={year}
                  years={years}
                  provider={provider}
                  districtSummaries={districtSummaries}
                  onSelectDistrict={setAreaId}
                  onYearChange={setYear}
                  initialExpanded={openExpandedMap}
                  onProviderChange={setProvider}
                />
              </Reveal>
              <Reveal delay={0.12}>
                <ReadinessPanel
                  index={index}
                  area={area}
                  provider={provider}
                  dataset={dataset}
                  summary={summary}
                  backcast={backcast}
                />
              </Reveal>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
