import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { Reveal } from '../components/ui/Reveal'
import { ExplorerControls } from '../components/explorer/ExplorerControls'
import { DataNotice } from '../components/explorer/DataNotice'
import { CalendarPanel } from '../components/explorer/CalendarPanel'
import { CriticalPeriodsPanel } from '../components/explorer/CriticalPeriodsPanel'
import { MapPanel } from '../components/explorer/MapPanel'
import { ReadinessPanel } from '../components/explorer/ReadinessPanel'
import { ComparisonChart } from '../components/explorer/ComparisonChart'
import { DistrictSmallMultiples } from '../components/explorer/DistrictSmallMultiples'
import { layers, type LayerId, type ProviderId } from '../lib/explorer'
import { aggregateDistrictYear, type DistrictYearSummary } from '../lib/layers'
import { defaultStudyAreaId, getStudyArea, studyAreas, type StudyAreaId } from '../lib/regions'
import {
  loadDistrictYear,
  loadObservationIndex,
  type ObservationDataset,
  type ObservationIndex,
} from '../lib/observations'
import {
  loadExperimentSummary,
  loadHarmonizationFactors,
  type ExperimentSummary,
  type HarmonizationFactors,
} from '../lib/experiments'

const studyAreasOrder = studyAreas.map((a) => a.id)

export function ExplorerPage() {
  const [provider, setProvider] = useState<ProviderId>('sp')
  const [areaId, setAreaId] = useState<StudyAreaId>(defaultStudyAreaId)
  const [year, setYear] = useState<string | null>(null)
  const [layer, setLayer] = useState<LayerId>('harmonized')

  const [index, setIndex] = useState<ObservationIndex | null>(null)
  const [dataset, setDataset] = useState<ObservationDataset | null>(null)
  const [summary, setSummary] = useState<ExperimentSummary | null>(null)
  const [factors, setFactors] = useState<HarmonizationFactors | null>(null)
  const [indexLoading, setIndexLoading] = useState(true)
  const [datasetLoading, setDatasetLoading] = useState(true)
  const [districtSummaries, setDistrictSummaries] = useState<(DistrictYearSummary | null)[] | null>(null)

  const area = getStudyArea(areaId)
  const activeLayer = layers.find((item) => item.id === layer) ?? layers[0]

  // Experiment artifacts are provider-independent and load once.
  useEffect(() => {
    const controller = new AbortController()
    loadExperimentSummary(controller.signal).then(setSummary)
    loadHarmonizationFactors(controller.signal).then(setFactors)
    return () => controller.abort()
  }, [])

  // Observation index per provider.
  useEffect(() => {
    const controller = new AbortController()
    setIndexLoading(true)
    setIndex(null)
    loadObservationIndex(provider, controller.signal)
      .then((payload) => {
        setIndex(payload)
        const years = payload?.years ?? []
        setYear(years.length > 0 ? years[years.length - 1] : null)
      })
      .finally(() => setIndexLoading(false))
    return () => controller.abort()
  }, [provider])

  // District-year summaries for all three districts (map choropleth). The
  // selected district's dataset is loaded separately for the detail panel.
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
        ds ? aggregateDistrictYear(ds, layer, factors) : null,
      )
      setDistrictSummaries(summaries)
    })
    return () => controller.abort()
  }, [provider, year, layer, factors])

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

  const years = useMemo(() => index?.years ?? [], [index])
  const reliabilityGrid = summary?.reliability.grid ?? null

  return (
    <>
      <PageHeader
        index="01"
        label="Nepal study areas"
        title={
          <>
            Explore Nepal&apos;s <em className="italic text-sand/85">fire history.</em>
          </>
        }
        intro={
          <>
            <p>
              Investigate historical fire activity across Banke, Bardiya and Chitwan, while
              accounting for differences in satellite observations.
            </p>
            <p className="mt-4 text-[12px] leading-relaxed text-ash-dark">
              These are selected high-fire study areas in Nepal, not a definitive ranking; other
              districts also experience substantial fire activity. Values shown are satellite
              hotspot detections — never unique fires, never zero-filled where unobserved.
            </p>
          </>
        }
        aside={
          <div className="w-full max-w-[300px] border border-sand/[0.12] bg-sand/[0.03] p-5">
            <p className="eyebrow text-ash-dark">Build status</p>
            <ul className="mt-4 space-y-2.5">
              <li className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ember" aria-hidden="true" />
                <span className="text-[12px] text-bone">
                  Historical SP observations connected (2012–2026)
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ember" aria-hidden="true" />
                <span className="text-[12px] text-bone">NRT snapshot connected</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sand/60" aria-hidden="true" />
                <span className="text-[12px] text-ash-light">
                  Harmonized layer provisional — court verdict inconclusive
                </span>
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-ash">
              Boundary context, weekly calendar and weekly detail run on processed FIRMS data.
              Missing observations are shown as missing, never as zero.
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
            onProviderChange={setProvider}
            onAreaChange={setAreaId}
            onYearChange={setYear}
            onLayerChange={setLayer}
          />

          <Reveal>
            <div className="mt-8">
              <DataNotice />
            </div>
          </Reveal>

          <div className="mt-8 grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-8">
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
                  reliabilityGrid={reliabilityGrid}
                  loading={indexLoading || datasetLoading}
                />
              </Reveal>
              {dataset && (
                <Reveal delay={0.04}>
                  <ComparisonChart
                    dataset={dataset}
                    districtName={area.name}
                    layer={layer}
                    factors={factors}
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

            <div className="min-w-0 lg:col-span-4">
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
                  onProviderChange={setProvider}
                />
              </Reveal>
              <Reveal delay={0.12}>
                <ReadinessPanel
                  index={index}
                  provider={provider}
                  dataset={dataset}
                  summary={summary}
                />
              </Reveal>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
