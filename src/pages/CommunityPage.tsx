import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader'
import { Reveal } from '../components/ui/Reveal'
import { StatusBadge } from '../components/ui/StatusBadge'
import { CommunityMap } from '../components/community/CommunityMap'
import { palette } from '../lib/palette'
import {
  FWI_CATEGORY_COLORS,
  loadCommunityDistrict,
  type CommunityData,
  type FwiCategory,
  type NrtRecord,
} from '../lib/community'
import {
  ACTIVITY_BAND_LABELS,
  COMPARISON_LABELS,
  FWI_PLAIN,
  MONTH_NAMES,
  compareRecentActivity,
  summarizeObservedWeather,
  summarizeSeason,
  type ActivityBand,
  type RecentActivitySummary,
  type SeasonalMonth,
} from '../lib/communitySummary'
import { defaultStudyAreaId, studyAreas } from '../lib/regions'

const PAGE_INDEX = '03'

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return 'Loading…'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function monthNumberFromTimestamp(value: string | undefined): number {
  const month = value ? Number(value.slice(5, 7)) : Number.NaN
  if (Number.isFinite(month) && month >= 1 && month <= 12) return month
  return new Date().getMonth() + 1
}

function bandShortLabel(band: ActivityBand | null): string {
  if (band === 'very_high') return 'Very high'
  if (band === 'high') return 'High'
  if (band === 'moderate') return 'Moderate'
  if (band === 'lower') return 'Lower'
  if (band === 'none') return 'No hotspots'
  return ''
}

function bandColor(band: ActivityBand | null): string {
  if (band === 'very_high' || band === 'high') return palette.amber.DEFAULT
  if (band === 'moderate') return palette.terracotta.soft
  if (band === 'lower' || band === 'none') return palette.ash.dark
  return palette.sand
}

function recentActivitySentence(recent: RecentActivitySummary | null): string {
  if (!recent) return 'Recent satellite detections are loading.'
  if (recent.detections === 0) {
    return 'No hotspot detections were recorded in the last 7 days.'
  }
  return `${recent.detections.toLocaleString()} hotspot detection${
    recent.detections === 1 ? '' : 's'
  } across ${recent.activeDays} day${recent.activeDays === 1 ? '' : 's'} in the last 7 days.`
}

function comparisonExplanation(
  recent: RecentActivitySummary | null,
  month: SeasonalMonth | null,
): string {
  if (!recent || !month) return 'Waiting for the study-area record.'
  if (recent.comparison === 'higher') {
    return 'More days than usual had at least one detected hotspot.'
  }
  if (recent.comparison === 'around') {
    return 'The number of days with detected hotspots is close to the usual level for this month.'
  }
  if (recent.comparison === 'lower') {
    return 'Fewer days than usual had a detected hotspot. Fewer detections do not mean conditions are safe.'
  }
  if (month.coverage === 'not_observed') {
    return `${month.fullLabel} was not acquired in the historical record, so Agnidrishti cannot say whether recent activity is more or less than usual.`
  }
  if (month.coverage === 'limited') {
    return `Only ${month.yearsSupporting} year${
      month.yearsSupporting === 1 ? '' : 's'
    } of observations support ${month.fullLabel}, so a usual-month comparison is not reliable.`
  }
  return `Historical observations for ${month.fullLabel} recorded no days with a hotspot, so a ratio would be misleading.`
}

export function CommunityPage() {
  const [selectedId, setSelectedId] = useState(defaultStudyAreaId)
  const [dataByDistrict, setDataByDistrict] = useState<
    Record<string, CommunityData | null>
  >({})
  const [loading, setLoading] = useState(true)
  const [detailMonth, setDetailMonth] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all(
      studyAreas.map(async (area) => {
        const data = await loadCommunityDistrict(area.id, controller.signal)
        return [area.id, data] as const
      }),
    )
      .then((entries) => {
        if (controller.signal.aborted) return
        setDataByDistrict(Object.fromEntries(entries))
        setLoading(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    setDetailMonth(null)
  }, [selectedId])

  const data = dataByDistrict[selectedId] ?? null
  const district = studyAreas.find((area) => area.id === selectedId) ?? studyAreas[0]
  const isNepal = district.countryCode === 'NPL'
  const generatedAt = data?.generated_at
  const currentMonthNumber = monthNumberFromTimestamp(generatedAt)
  const season = useMemo(() => (data ? summarizeSeason(data.historical) : null), [data])
  const currentMonth = season?.months[currentMonthNumber - 1] ?? null
  const recent = useMemo(
    () =>
      data ? compareRecentActivity(data.current_observations, currentMonth) : null,
    [data, currentMonth],
  )
  const weather = useMemo(
    () => (data ? summarizeObservedWeather(data.weather_recent_30d, data.generated_at) : null),
    [data],
  )
  const fwiCurrent = data?.fwi.current ?? null
  const fwiCategory = (fwiCurrent?.fwi_category as FwiCategory | undefined) ?? null
  const fwiPlain = fwiCategory ? FWI_PLAIN[fwiCategory] : null
  const fwiColor = fwiCategory ? FWI_CATEGORY_COLORS[fwiCategory] : palette.sand
  const fwiForecast = ((data?.fwi.forecast_7d ?? []).filter(Boolean) as NonNullable<
    CommunityData['fwi']['forecast_7d'][number]
  >[]).slice(0, 7)
  // Fixed 0-30 scale (the top of the "very high" band) so a bar's height means the
  // same on every district and date, instead of being stretched to the week's peak.
  const FWI_SCALE_MAX = 30
  // Show the current month when it is covered; otherwise open on the busiest month
  // rather than on an empty "not observed" card.
  const defaultDetailMonth =
    currentMonth?.coverage === 'adequate' ? currentMonthNumber : (season?.peak?.month ?? currentMonthNumber)
  // Keep the calendar highlight and the detail card on the same month: when the
  // current month was not acquired, both fall back to the busiest covered month.
  const effectiveDetailMonth = detailMonth ?? defaultDetailMonth
  const selectedMonth =
    season?.months[effectiveDetailMonth - 1] ?? currentMonth
  const isCurrentMonthSelected = selectedMonth?.month === currentMonthNumber
  const isFallbackMonth = detailMonth === null && !isCurrentMonthSelected
  const outlook = data?.outlook
  const communityByDistrict = useMemo(() => dataByDistrict, [dataByDistrict])

  return (
    <>
      <PageHeader
        index={PAGE_INDEX}
        label="Community fire intelligence"
        title={
          <>
            What&apos;s happening <span className="text-amber-soft">in your area?</span>
          </>
        }
        intro={
          <>
            <p>
              Choose a study area to see when fires are usually observed, how conditions look now,
              and where recent satellite detections are. The science stays underneath; the answers
              stay simple.
            </p>
            <p className="mt-4 text-body-sm leading-relaxed text-ash">
              These are satellite observations of hotspots, not confirmed ground fires. Missing
              observations are shown as missing, never as zero.
            </p>
          </>
        }
      />

      {/* 1. Location selection */}
      <section className="section-y pt-10 md:pt-12" aria-label="Choose a study area">
        <div className="container-page">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <SectionHeading index="01" label="Choose a study area" />
              <h2 className="mt-3 font-display text-2xl text-bone sm:text-3xl">
                Start with where you are.
              </h2>
            </div>
            <p className="max-w-md text-body-sm leading-relaxed text-ash">
              Data is available for six high-fire study areas across Nepal, Thailand, Indonesia and
              Myanmar. Administrative boundaries are shown, not smaller neighbourhood areas.
            </p>
          </div>

          <div role="group" aria-label="Study areas" className="mt-6 grid gap-3 sm:grid-cols-3">
            {studyAreas.map((area) => {
              const active = selectedId === area.id
              const entry = dataByDistrict[area.id]
              const peakMonth = entry?.historical.peak_month
              const peak = peakMonth ? MONTH_NAMES[peakMonth.month - 1] : undefined
              return (
                <button
                  key={area.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(area.id)}
                  className={`rounded-panel border px-5 py-4 text-left transition-[background-color,color,border-color,box-shadow] ${
                    active
                      ? 'border-ember/45 bg-ink-850 text-bone shadow-instrument-sm'
                      : 'border-sand/[0.12] bg-ink-900/70 text-ash-light hover:border-sand/25 hover:text-bone'
                  }`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-display text-xl">{area.name}</span>
                    {active && (
                      <span className="text-meta font-medium text-amber-soft">Viewing</span>
                    )}
                  </span>
                  <span className="mt-1 block text-support text-ash">{area.province}</span>
                  <span className="mt-3 block text-support text-ash">
                    {peak ? `Usually busiest in ${peak}` : loading ? 'Loading study-area record…' : 'No historical peak available'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* 2. Current situation */}
      <section className="section-y pt-10 md:pt-14" aria-labelledby="current-situation">
        <div className="container-page">
          {!isNepal && (
            <Reveal>
              <p
                role="note"
                className="mb-6 rounded-lg border border-amber/25 bg-amber/[0.06] px-4 py-3 text-support leading-relaxed text-ash"
              >
                <span className="font-medium text-bone">Regional scope. </span>
                Fire-danger scores, activity forecasts and official emergency contacts were built
                and validated for Nepal&apos;s Terai. They have not been validated for{' '}
                {district.name}, so those values are disabled here rather than presented as
                meaningful assessments. Historical fire activity, recent satellite detections and
                observed weather remain available.
              </p>
            </Reveal>
          )}

          <Reveal>
            <SectionHeading index="02" label="Current situation" />
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <h2
                id="current-situation"
                className="max-w-2xl font-display text-2xl text-bone sm:text-3xl"
              >
                {isNepal
                  ? `How concerning is fire danger in ${district.name} right now?`
                  : `What has been observed recently in ${district.name}?`}
              </h2>
              <p className="text-support text-ash">
                {MONTH_NAMES[currentMonthNumber - 1]} {generatedAt?.slice(0, 4) ?? ''}
              </p>
            </div>
          </Reveal>

          <div className="mt-6 grid gap-4 lg:grid-cols-12">
            <Reveal className="lg:col-span-7">
              <div className="card h-full px-5 py-5 sm:px-6 sm:py-6">
                {data && (isNepal ? fwiPlain : recent) ? (
                  <>
                    {!isNepal && (
                      <div className="rounded-xl border border-amber/25 bg-amber/[0.06] px-4 py-4">
                        <p className="eyebrow text-ash">Regional fire-danger assessment</p>
                        <p className="mt-2 text-body font-medium text-bone">
                          Not yet validated for this area.
                        </p>
                        <p className="mt-2 text-support leading-relaxed text-ash">
                          No fire-danger score, probability or future outlook is shown, because the
                          only calibrated model in this project covers Nepal. A lack of danger
                          information is not evidence that conditions are safe.
                        </p>
                      </div>
                    )}

                    {isNepal && fwiPlain && (
                    <div className="flex items-start gap-4">
                      <span
                        className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full"
                        style={{ background: fwiColor }}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="eyebrow text-ash">Fire danger from current weather</p>
                        <h3 className="mt-2 font-display text-3xl text-bone sm:text-4xl">
                          {fwiPlain.title}
                        </h3>
                        <p className="mt-3 max-w-xl text-body leading-relaxed text-ash-light">
                          {fwiPlain.sentence}
                        </p>
                      </div>
                    </div>
                    )}

                    <div className="mt-6 rounded-xl border border-sand/[0.1] bg-ink-900/60 px-4 py-4">
                      <p className="data-label">What satellites saw recently</p>
                      <p className="mt-1.5 text-body-sm leading-relaxed text-bone">
                        {recentActivitySentence(recent)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-meta font-medium ${
                            recent?.comparison === 'higher'
                              ? 'border-ember/40 bg-ember/[0.12] text-amber-soft'
                              : recent?.comparison === 'lower'
                                ? 'border-observation/30 bg-observation/[0.08] text-observation-soft'
                                : recent?.comparison === 'around'
                                  ? 'border-sand/25 bg-sand/[0.06] text-bone'
                                  : 'border-sand/20 bg-sand/[0.04] text-ash-light'
                          }`}
                        >
                          {recent ? COMPARISON_LABELS[recent.comparison] : 'Loading…'}
                        </span>
                        {currentMonth && recent?.comparison !== 'insufficient' && (
                          <span className="text-support text-ash">
                            Compared with a usual {currentMonth.fullLabel}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-support leading-relaxed text-ash">
                        {comparisonExplanation(recent, currentMonth)}
                      </p>
                    </div>

                    {isNepal && fwiPlain && (
                      <>
                        <p className="mt-4 text-support leading-relaxed text-ash">
                          Few or no satellite detections do not mean conditions are safe. Fire
                          danger also depends on weather, dry fuels and wind.
                        </p>
                        <p className="mt-3 text-support text-ash">
                          Weather and danger data updated {formatTimestamp(generatedAt)} UTC.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <LoadingPanel label="Loading current conditions…" />
                )}
              </div>
            </Reveal>

            <Reveal className="lg:col-span-5" delay={0.04}>
              <div className="grid gap-4">
                <div className="card px-5 py-5">
                  <p className="eyebrow text-ash">Observed in the last 7 days</p>
                  {data && recent ? (
                    <>
                      <div className="mt-3 flex items-end gap-4">
                        <p className="font-display text-5xl leading-none text-bone">
                          {recent.detections}
                        </p>
                        <p className="pb-1 text-body-sm text-ash">
                          hotspot detection{recent.detections === 1 ? '' : 's'}
                          <br />
                          across {recent.activeDays} active day{recent.activeDays === 1 ? '' : 's'}
                        </p>
                      </div>
                      <p className="mt-4 text-support leading-relaxed text-ash">
                        These are thermal-anomaly observations from NASA FIRMS, not confirmed
                        ground fires.
                      </p>
                    </>
                  ) : (
                    <LoadingPanel label="Loading recent detections…" />
                  )}
                </div>

                <div className="card px-5 py-5">
                  <p className="eyebrow text-ash">Weather in the last 7 days</p>
                  {weather ? (
                    <dl className="mt-3 grid grid-cols-3 gap-3">
                      <WeatherStat label="Rain" value={`${fmt(weather.rainTotal, 1)} mm`} />
                      <WeatherStat
                        label="Humidity"
                        value={`${fmt(weather.meanHumidity, 0)}%`}
                      />
                      <WeatherStat label="Max temp" value={`${fmt(weather.maxTemperature, 1)}°C`} />
                    </dl>
                  ) : (
                    <p className="mt-3 text-support text-ash">No recent weather data is available.</p>
                  )}
                  <p className="mt-3 text-support leading-relaxed text-ash-dark">
                    District-centroid daily values from Open-Meteo ERA5. Local conditions can differ.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          {recent && currentMonth && recent.historicalShare !== null && (
            <Reveal delay={0.06}>
              <details className="mt-4 rounded-xl border border-sand/[0.1] bg-ink-900/50 px-4 py-3">
                <summary className="cursor-pointer text-support font-medium text-ash-light hover:text-bone">
                  How the usual-month comparison works
                </summary>
                <p className="mt-2 max-w-3xl text-support leading-relaxed text-ash">
                  The comparison uses the share of days with at least one detected hotspot. The
                  recent window combines three satellite platforms, while the historical baseline
                  uses Suomi-NPP alone, so treat the direction as approximate.
                </p>
              </details>
            </Reveal>
          )}
        </div>
      </section>

      {/* 3. Seasonal calendar */}
      <section className="section-y pt-10 md:pt-14" aria-labelledby="seasonal-calendar">
        <div className="container-page">
          <Reveal>
            <SectionHeading index="03" label="When fires are usually observed" />
            <h2
              id="seasonal-calendar"
              className="mt-3 max-w-3xl font-display text-2xl leading-tight text-bone sm:text-3xl"
            >
              {season?.seasonSentence ?? 'Reading the historical record…'}
            </h2>
            <p className="mt-3 max-w-2xl text-body leading-relaxed text-ash-light">
              {season?.peakSentence ?? 'The seasonal calendar will appear when the study-area record loads.'}
            </p>
          </Reveal>

          {season && (
            <>
              {data?.historical_modis_long_term?.peak_month_terra && (
                <Reveal delay={0.02}>
                  <p className="mt-3 max-w-2xl text-support leading-relaxed text-ash">
                    Long-term MODIS record ({data.historical_modis_long_term.period.start} to{' '}
                    {data.historical_modis_long_term.period.end}): Terra was usually busiest in{' '}
                    {data.historical_modis_long_term.peak_month_terra.label}. This is the pre-VIIRS
                    record on its own native scale — it is not converted to a VIIRS-equivalent value
                    and is not comparable with the Suomi-NPP rates above.
                  </p>
                </Reveal>
              )}
              <Reveal delay={0.04}>
                <div className="card mt-6 px-4 py-5 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-support font-medium text-bone">Historical fire calendar</p>
                    <p className="text-meta text-ash">Hotspot observations per observed day</p>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {season.months.map((month) => {
                      const active = month.month === effectiveDetailMonth
                      const current = month.month === currentMonthNumber
                      const hasRate = month.coverage === 'adequate' && month.rate !== null
                      const fill =
                        hasRate && month.rate !== null && season.peak?.rate
                          ? Math.max(8, (month.rate / season.peak.rate) * 100)
                          : 0
                      return (
                        <button
                          key={month.month}
                          type="button"
                          onClick={() => setDetailMonth(month.month)}
                          aria-pressed={active}
                          aria-current={current ? 'date' : undefined}
                          className={`relative flex min-h-[150px] flex-col rounded-xl border px-2.5 pb-3 pt-3 text-left transition-[border-color,background-color] ${
                            active
                              ? 'border-amber-soft/60 bg-amber/[0.09]'
                              : 'border-sand/[0.12] bg-ink-900/50 hover:border-sand/30'
                          } ${month.coverage !== 'adequate' ? 'border-dashed' : ''}`}
                        >
                          <span className="text-support font-medium text-bone">
                            {MONTH_NAMES[month.month - 1].slice(0, 3)}
                          </span>

                          <span className="mt-3 flex h-16 items-end">
                            <span
                              className="w-full rounded-t-[3px]"
                              style={{
                                height: hasRate ? `${fill}%` : '0%',
                                minHeight: hasRate ? 5 : 0,
                                background: hasRate ? bandColor(month.band) : 'transparent',
                                opacity: month.band === 'lower' ? 0.7 : 0.9,
                              }}
                              aria-hidden="true"
                            />
                          </span>

                          <span className="mt-2 block text-meta leading-tight text-ash">
                            {month.coverage === 'not_observed'
                              ? 'No data'
                              : month.coverage === 'limited'
                                ? 'Limited data'
                                : bandShortLabel(month.band)}
                          </span>
                          {hasRate && (
                            <span className="mt-1 block text-meta tabular-nums text-ash-dark">
                              {fmt(month.rate, 1)}/day
                            </span>
                          )}
                          {current && (
                            <span className="mt-1.5 flex items-center gap-1.5 text-meta font-medium text-amber-soft">
                              <span className="h-1.5 w-1.5 rounded-full bg-ember" aria-hidden="true" />
                              This month
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-sand/10 pt-4 text-meta text-ash">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-5 rounded-sm"
                        style={{ background: palette.amber.DEFAULT }}
                        aria-hidden="true"
                      />
                      Very high / high activity
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-5 rounded-sm"
                        style={{ background: palette.terracotta.soft }}
                        aria-hidden="true"
                      />
                      Moderate
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-5 rounded-sm"
                        style={{ background: palette.ash.dark }}
                        aria-hidden="true"
                      />
                      Lower
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-5 rounded-sm border border-dashed border-sand/40"
                        aria-hidden="true"
                      />
                      Not acquired / too few observations
                    </span>
                  </div>
                </div>
              </Reveal>

              <div className="mt-4 grid gap-4 lg:grid-cols-12">
                <Reveal className="lg:col-span-5" delay={0.06}>
                  <div className="card h-full px-5 py-5">
                    <p className="eyebrow text-ash">What this means</p>
                    <p className="mt-3 text-body leading-relaxed text-bone">
                      {season.coverageNote}
                    </p>
                    <p className="mt-3 text-support leading-relaxed text-ash">
                      Monthly values are normalized by the number of observed days, so a month with
                      more satellite passes is not automatically ranked higher. These labels describe
                      how often fires were observed — not how dangerous conditions are today.
                    </p>
                  </div>
                </Reveal>

                <Reveal className="lg:col-span-7" delay={0.08}>
                  <div className="card h-full px-5 py-5">
                    <p className="eyebrow text-ash">
                      {selectedMonth ? selectedMonth.fullLabel : 'Selected month'}
                      {isCurrentMonthSelected
                        ? ' · this month'
                        : isFallbackMonth
                          ? ' · busiest month'
                          : ''}
                    </p>
                    {selectedMonth ? (
                      <>
                        <p className="mt-3 font-display text-2xl text-bone">
                          {selectedMonth.coverage === 'adequate' && selectedMonth.band
                            ? ACTIVITY_BAND_LABELS[selectedMonth.band]
                            : selectedMonth.coverage === 'limited'
                              ? 'Limited historical data'
                              : 'Not observed in the historical record'}
                        </p>
                        <p className="mt-2 text-body-sm leading-relaxed text-ash-light">
                          {selectedMonth.coverage === 'adequate' && selectedMonth.rate !== null
                            ? `About ${fmt(selectedMonth.rate, 1)} hotspot detections per observed day across ${
                                selectedMonth.yearsSupporting
                              } years (${fmt(selectedMonth.observedDays)} observed days, ${
                                selectedMonth.detectionDays
                              } with at least one detection).`
                            : selectedMonth.coverage === 'limited'
                              ? `Only ${selectedMonth.yearsSupporting} year${
                                  selectedMonth.yearsSupporting === 1 ? '' : 's'
                                } and ${selectedMonth.observedDays} observed days support this month, so it is not ranked.`
                              : 'This month was not acquired, so no value is shown. Missing observations are never treated as zero.'}
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-support text-ash">No month selected.</p>
                    )}
                  </div>
                </Reveal>
              </div>

              {season.topMonths.length > 0 && (
                <Reveal delay={0.1}>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {season.ranked.slice(0, 4).map((month) => (
                      <div
                        key={month.month}
                        className="card-flat flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div>
                          <p className="font-display text-lg text-bone">{month.fullLabel}</p>
                          <p className="mt-0.5 text-meta leading-snug text-ash">
                            {month.band ? ACTIVITY_BAND_LABELS[month.band] : 'Not ranked'}
                          </p>
                        </div>
                        <span
                          className="h-8 w-1.5 shrink-0 rounded-full"
                          style={{ background: bandColor(month.band) }}
                          aria-hidden="true"
                        />
                      </div>
                    ))}
                  </div>
                </Reveal>
              )}
            </>
          )}
        </div>
      </section>

      {/* 4. Fire activity map */}
      <section className="section-y pt-10 md:pt-14" aria-labelledby="fire-activity-map">
        <div className="container-page">
          <Reveal>
            <SectionHeading index="04" label="Where fires are observed" />
            <h2
              id="fire-activity-map"
              className="mt-3 max-w-3xl font-display text-2xl leading-tight text-bone sm:text-3xl"
            >
              See the pattern behind the numbers.
            </h2>
            <p className="mt-3 max-w-2xl text-body leading-relaxed text-ash-light">
              Switch between historical activity, recent detections and current fire danger.
              District shading is a summary; dots are verified satellite observations.
            </p>
          </Reveal>
          <Reveal delay={0.06}>
            <div className="mt-6">
              <CommunityMap
                selectedDistrict={selectedId}
                onSelectDistrict={setSelectedId}
                communityByDistrict={communityByDistrict}
                areas={studyAreas}
                dangerAvailable={isNepal}
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 5. Upcoming outlook */}
      <section className="section-y pt-10 md:pt-14" aria-labelledby="upcoming-outlook">
        <div className="container-page">
          <Reveal>
            <SectionHeading index="05" label="Looking ahead" />
            <h2
              id="upcoming-outlook"
              className="mt-3 max-w-3xl font-display text-2xl leading-tight text-bone sm:text-3xl"
            >
              {isNepal
                ? 'What the next few days may bring.'
                : 'What the evidence supports looking ahead.'}
            </h2>
          </Reveal>

          <div className="mt-6 grid gap-4 lg:grid-cols-12">
            <Reveal className="lg:col-span-5">
              <div className="card h-full px-5 py-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="eyebrow text-ash">Fire-activity forecast</p>
                  <StatusBadge tone={isNepal && outlook?.status === 'validated' ? 'active' : 'neutral'}>
                    {!isNepal
                      ? 'Not validated for this area'
                      : outlook
                        ? outlookStatusLabel(outlook.status)
                        : 'Loading…'}
                  </StatusBadge>
                </div>

                {!isNepal ? (
                  <>
                    <p className="mt-3 font-display text-2xl leading-snug text-bone">
                      Regional fire-activity outlook is not yet validated for this area.
                    </p>
                    <p className="mt-3 text-body-sm leading-relaxed text-ash-light">
                      No probability or forecast is shown. The only validated outlook model covers
                      Nepal&apos;s Terai; it is deliberately not applied here.
                    </p>
                    <p className="mt-3 text-support leading-relaxed text-ash">
                      Historical activity and recent satellite detections remain available above.
                    </p>
                  </>
                ) : outlook?.status === 'validated' && outlook.outlook_days.length > 0 ? (
                  <>
                    <p className="mt-3 text-body leading-relaxed text-bone">
                      A validated short-term outlook is available for this study area.
                    </p>
                    <p className="mt-2 text-support leading-relaxed text-ash">
                      It estimates the chance of at least one satellite-detected hotspot on a day.
                      It is not a prediction that a fire will start, and it does not identify
                      ignition locations.
                    </p>
                    <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4">
                      {outlook.outlook_days.slice(0, 7).map((day) => (
                        <div
                          key={day.date}
                          className="rounded-lg border border-sand/[0.1] bg-ink-900 px-2 py-2 text-center"
                        >
                          <p className="text-meta text-ash-dark">{day.date.slice(5)}</p>
                          <p className="mt-1 font-display text-lg text-bone">
                            {(day.probability_of_active_day * 100).toFixed(0)}%
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-3 font-display text-2xl leading-snug text-bone">
                      Reliable fire-activity forecasting is not currently available for this area.
                    </p>
                    <p className="mt-3 text-body-sm leading-relaxed text-ash-light">
                      {outlook?.status === 'validated_but_out_of_season'
                        ? 'The activity model is validated only for January–July. Today falls outside that window, so no activity forecast is shown.'
                        : 'A weather-driven activity model was tested against the seasonal average. It did not perform well enough to justify a forecast, so none is shown.'}
                    </p>
                    <p className="mt-3 text-support leading-relaxed text-ash">
                      This is an honest scientific limitation, not a missing-data error. The
                      weather-based fire-danger indicator below remains available.
                    </p>
                  </>
                )}
              </div>
            </Reveal>

            <Reveal className="lg:col-span-7" delay={0.04}>
              <div className="card h-full px-5 py-5">
                <p className="eyebrow text-ash">Fire danger from weather · next 7 days</p>
                {!isNepal ? (
                  <>
                    <p className="mt-3 font-display text-2xl leading-snug text-bone">
                      Fire-danger forecast disabled for this area.
                    </p>
                    <p className="mt-3 text-body-sm leading-relaxed text-ash-light">
                      The seven-day fire-weather index is not calibrated or validated outside
                      Nepal&apos;s Terai, so no scores or bars are shown here. An absent forecast is
                      not evidence of safe conditions.
                    </p>
                    <p className="mt-3 text-support leading-relaxed text-ash">
                      Observed weather from the last seven days is still shown under current
                      conditions, without a danger category.
                    </p>
                  </>
                ) : fwiForecast.length > 0 ? (
                  <>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-meta text-ash">Fixed 0–30 fire-weather scale</p>
                      <p className="text-meta text-ash-dark">30 or above = extreme</p>
                    </div>
                    <div
                      className="mt-2 flex items-end gap-2"
                      role="img"
                      aria-label="Weather-driven fire danger for the next seven days, on a fixed zero to thirty scale"
                    >
                      {fwiForecast.map((row) => {
                        const category = row.fwi_category as FwiCategory | null
                        return (
                          <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                            <span className="text-support tabular-nums text-bone">{fmt(row.fwi, 1)}</span>
                            <div className="relative flex h-24 w-full items-end overflow-hidden rounded-t-[3px] bg-sand/[0.07]">
                              <span
                                className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-sand/[0.08]"
                                aria-hidden="true"
                              />
                              <span
                                className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-sand/[0.08]"
                                aria-hidden="true"
                              />
                              <span
                                className="relative w-full rounded-t-[3px]"
                                style={{
                                  height: `${Math.max(4, Math.min(100, (row.fwi / FWI_SCALE_MAX) * 100))}%`,
                                  background: category
                                    ? FWI_CATEGORY_COLORS[category]
                                    : palette.terracotta.DEFAULT,
                                }}
                              />
                            </div>
                            <span className="text-support text-ash">{row.date.slice(8, 10)}</span>
                            <span className="text-support text-ash-dark">
                              {new Date(`${row.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                                weekday: 'short',
                                timeZone: 'UTC',
                              })}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <p className="mt-3 text-support leading-relaxed text-ash">
                      {isNepal
                        ? (data?.fwi.calibration ??
                          'Weather-driven index; not an ignition prediction.')
                        : 'Weather-driven index; not an ignition prediction, and not calibrated for this study area.'}
                    </p>
                    <p className="mt-2 text-support leading-relaxed text-ash">
                      Bar height uses a fixed 0–30 index scale, so this week&apos;s values are not
                      stretched to fill the chart. This describes how readily fires could spread.
                      It does not predict whether a fire will start, and the index is not calibrated
                      for local fuel types in this study area.
                    </p>
                  </>
                ) : (
                  <p className="mt-3 text-support leading-relaxed text-ash">
                    No seven-day fire-weather data is available for this study area.
                  </p>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 6. What residents should know */}
      <section className="section-y pt-10 md:pt-14" aria-labelledby="resident-guidance">
        <div className="container-page">
          <Reveal>
            <SectionHeading index="06" label="What residents should know" />
            <h2
              id="resident-guidance"
              className="mt-3 max-w-3xl font-display text-2xl leading-tight text-bone sm:text-3xl"
            >
              Practical guidance for fire season.
            </h2>
          </Reveal>

          <div className="mt-6 grid gap-4 lg:grid-cols-12">
            <Reveal className="lg:col-span-7">
              <div className="card h-full px-5 py-5">
                <p className="text-body leading-relaxed text-bone">
                  Agnidrishti is an analysis and information tool. It is not an emergency service.
                  During a fire emergency, follow instructions from local authorities and
                  disaster-management agencies.
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <GuidanceItem
                    title="Avoid burning"
                    text="Do not burn vegetation or waste during dry, windy conditions."
                  />
                  <GuidanceItem
                    title="Report smoke"
                    text={
                      isNepal
                        ? 'Report smoke or open flames to local authorities. Call 112 for emergencies.'
                        : 'Report smoke or open flames to local authorities and local emergency services.'
                    }
                  />
                  <GuidanceItem
                    title="Create clearance"
                    text="Keep space clear around structures in forest-adjacent areas."
                  />
                </div>
                <p className="mt-4 text-support leading-relaxed text-ash">
                  These are general precautions for the fire season — not instructions for a
                  specific current emergency.
                </p>
              </div>
            </Reveal>

            <Reveal className="lg:col-span-5" delay={0.04}>
              <div className="card h-full px-5 py-5">
                <p className="eyebrow text-ash">Official information</p>
                <div className="mt-3 space-y-3">
                  {!isNepal && (
                    <p className="text-support leading-relaxed text-ash">
                      Official emergency contacts have not been curated for {district.name}. Follow
                      local authorities and national emergency services.
                    </p>
                  )}
                  {isNepal &&
                    (data?.safety_sources ?? []).map((source) => (
                    <div key={source.name} className="border-b border-sand/[0.08] pb-3 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-body-sm font-medium text-bone">{source.name}</p>
                        {source.verified_reachable === false && (
                          <span className="text-meta text-ash-dark">not reachable at last check</span>
                        )}
                      </div>
                      <p className="mt-1 text-support leading-relaxed text-ash">{source.note}</p>
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-block text-support text-amber-soft underline decoration-amber/30 underline-offset-4 transition-colors hover:text-bone"
                        >
                          Open official site
                        </a>
                      )}
                    </div>
                  ))}
                  {isNepal && !data && (
                    <p className="text-support text-ash">Loading official contacts…</p>
                  )}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 7. Data reliability and methodology */}
      <section className="section-y pt-10 md:pt-14" aria-labelledby="data-reliability">
        <div className="container-page pb-10">
          <Reveal>
            <SectionHeading index="07" label="Data reliability and methodology" />
            <h2
              id="data-reliability"
              className="mt-3 max-w-3xl font-display text-2xl leading-tight text-bone sm:text-3xl"
            >
              The fine print, available when you want it.
            </h2>
            <p className="mt-3 max-w-2xl text-body leading-relaxed text-ash-light">
              The main answers above use only the exported observations and weather calculations.
              No values are invented, and missing observations are never treated as zero.
            </p>
          </Reveal>

          <Reveal delay={0.04}>
            <details className="card mt-6 px-5 py-5">
              <summary className="cursor-pointer font-display text-xl text-bone marker:text-ember">
                Open data notes and methodology
              </summary>

              <div className="mt-5 space-y-6 text-body-sm leading-relaxed text-ash-light">
                <div>
                  <h3 className="text-body font-medium text-bone">What the data covers</h3>
                  <p className="mt-1.5">{season?.coverageNote}</p>
                  <p className="mt-2 text-ash">
                    {data?.historical.basis.record_note}
                  </p>
                  {data?.historical_modis_long_term && (
                    <p className="mt-2 text-ash">
                      {data.historical_modis_long_term.basis.platforms} cover{' '}
                      {data.historical_modis_long_term.period.start} to{' '}
                      {data.historical_modis_long_term.period.end}.{' '}
                      {data.historical_modis_long_term.basis.record_note}
                    </p>
                  )}
                  <p className="mt-2 text-ash">
                    Current weather and fire danger are area-centroid values. Satellite
                    detections are thermal anomalies; they are not ground-confirmed fires or burned
                    area.
                  </p>
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">How the seasonal ranking works</h3>
                  <p className="mt-1.5">
                    A month is ranked only when at least 5 years and 100 observed days support it.
                    Months that were not acquired are shown as “No data”, never as zero. Months with
                    too few observations are shown as “Limited data”.
                  </p>
                  <p className="mt-2 text-ash">
                    The labels compare each month with the study area&apos;s own highest month: 60% or
                    more of the peak is “Very high”, 30–60% is “High”, 10–30% is “Moderate”, and
                    below 10% is “Lower”. Rates are hotspot detections per observed day.
                  </p>
                  <p className="mt-2 text-ash">
                    This is a frequency ranking, not a fire-danger ranking. A month with fewer
                    observed fires can still have dangerous weather.
                  </p>
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">How the current assessment works</h3>
                  <p className="mt-1.5">
                    Current fire danger comes from the Canadian Fire Weather Index computed from
                    recent and forecast weather. It describes how readily fires could spread. It is
                    not an ignition prediction and is not calibrated for this study area.
                  </p>
                  <p className="mt-2 text-ash">
                    Recent activity comes from NASA FIRMS near-real-time records in the last 7 days.
                    The usual-month comparison uses the share of observed days with at least one
                    hotspot detection. Recent detections combine three platforms; the historical
                    baseline uses Suomi-NPP alone. When the current month was not acquired, the page
                    says that no usual-month comparison is available.
                  </p>
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">Why no fire-activity forecast is shown</h3>
                  <p className="mt-1.5">
                    {outlook
                      ? outlookExplanation(outlook.status)
                      : 'The outlook status is loading.'}
                  </p>
                  {outlook?.metrics.mean_auc !== null && outlook?.metrics.mean_auc !== undefined && (
                    <p className="mt-2 text-ash">
                      Mean validation score (AUC) {outlook.metrics.mean_auc.toFixed(3)} versus a
                      seasonal climatology baseline of{' '}
                      {outlook.metrics.mean_climatology_auc?.toFixed(3) ?? '—'}; skill over
                      climatology {outlook.metrics.skill_over_climatology?.toFixed(3) ?? '—'}. A
                      forecast is shown only when it clears the pre-set skill thresholds and the
                      date is inside the validated January–July season.
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">Year-by-year observation record</h3>
                  <p className="mt-1.5 text-ash">
                    These totals cover the acquired January–June record (plus July 2026). They are
                    not comparable to post-2018 totals that include NOAA-20 or NOAA-21.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[480px] border-collapse text-left text-support">
                      <thead>
                        <tr className="border-b border-sand/10 bg-sand/[0.03]">
                          <th className="px-3 py-2.5 font-medium text-ash">Year</th>
                          <th className="px-3 py-2.5 font-medium text-ash">Suomi-NPP detections</th>
                          <th className="px-3 py-2.5 font-medium text-ash">Observed days</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sand/[0.06]">
                        {(data?.historical.year_totals ?? []).map((row) => (
                          <tr key={row.year}>
                            <td className="px-3 py-2 text-bone">{row.year}</td>
                            <td className="px-3 py-2 font-mono text-ash-light">
                              {row.snpp_detections.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 font-mono text-ash-dark">{row.observed_days}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">Plain-language explanations and evidence</h3>
                  <div className="mt-3 space-y-3">
                    {(data?.explanations ?? []).map((explanation) => (
                      <div
                        key={explanation.topic}
                        className="rounded-xl border border-sand/[0.1] bg-ink-900/50 px-4 py-3"
                      >
                        <p className="text-meta font-medium uppercase tracking-[0.06em] text-ember">
                          {topicLabel(explanation.topic)}
                        </p>
                        <p className="mt-1.5 text-body-sm leading-relaxed text-ash-light">
                          {explanation.text}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-meta text-ash hover:text-bone">
                            Underlying evidence
                          </summary>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-support leading-relaxed text-ash-dark">
                            {JSON.stringify(explanation.evidence, null, 1)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">Recent detections in this study area</h3>
                  {data && data.current_observations.recent_week_records.length > 0 ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-support">
                        <thead>
                          <tr className="border-b border-sand/10">
                            <th className="py-2 pr-3 font-medium text-ash">Date</th>
                            <th className="py-2 pr-3 font-medium text-ash">Platform</th>
                            <th className="py-2 pr-3 font-medium text-ash">FRP (MW)</th>
                            <th className="py-2 font-medium text-ash">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sand/[0.06]">
                          {data.current_observations.recent_week_records.map(
                            (record: NrtRecord, index: number) => (
                              <tr key={`${record.acq_date}-${record.platform}-${index}`}>
                                <td className="py-2 pr-3 font-mono text-ash-light">{record.acq_date}</td>
                                <td className="py-2 pr-3 text-ash-light">{record.platform}</td>
                                <td className="py-2 pr-3 font-mono text-ash-light">
                                  {record.frp !== null ? record.frp.toFixed(1) : '—'}
                                </td>
                                <td className="py-2 text-ash-dark">
                                  {record.confidence !== null ? String(record.confidence) : '—'}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-ash">
                      No verified near-real-time detections are present in the acquired window for
                      this study area. This is real observation data, not a malfunction.
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">Known limitations</h3>
                  <ul className="mt-2 space-y-1.5 text-ash">
                    {(data?.limitations ?? [])
                      .filter((limitation) => isNepal || !/Nepal/i.test(limitation))
                      .map((limitation) => (
                        <li key={limitation.slice(0, 50)}>— {limitation}</li>
                      ))}
                    {isNepal ? (
                      <li>— The fire-weather index is not calibrated for Nepali fuel types and climatology.</li>
                    ) : (
                      <li>
                        — The fire-weather index, seasonal outlook and official contacts were neither
                        calibrated nor curated for this study area.
                      </li>
                    )}
                    <li>— No external burned-area or ground-truth cross-check has been performed.</li>
                    <li>— Smaller-area selection is unavailable because observations are summarized at study-area level.</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-body font-medium text-bone">Sources</h3>
                  <ul className="mt-2 space-y-1.5 text-ash">
                    <li>— Satellite observations: NASA FIRMS standard processing (SP) and near-real-time (NRT).</li>
                    <li>— Weather: Open-Meteo ERA5 archive and forecast APIs (CC-BY 4.0), study-area representative points.</li>
                    <li>
                      — Boundaries: OCHA COD-AB Nepal admin-2 (HDX, CC BY-IGO) and geoBoundaries ADM1
                      for Thailand, Indonesia and Myanmar (CC BY 4.0).
                    </li>
                    <li>— Fire Weather Index: Canadian FWI formulas (Van Wagner 1987), uncalibrated for these study areas.</li>
                  </ul>
                  <p className="mt-3 text-support leading-relaxed text-ash">
                    For the full satellite harmonization methodology, see the{' '}
                    <Link to="/methodology" className="link-quiet">
                      methodology page
                    </Link>{' '}
                    and the{' '}
                    <Link to="/explorer" className="link-quiet">
                      historical explorer
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </details>
          </Reveal>
        </div>
      </section>
    </>
  )
}

function outlookStatusLabel(status: string): string {
  if (status === 'validated') return 'Validated outlook'
  if (status === 'validated_but_out_of_season') return 'Outside validated season'
  return 'Not validated'
}

function outlookExplanation(status: string): string {
  if (status === 'validated_but_out_of_season') {
    return 'The activity model was validated inside the January–July fire season only. Today falls outside that window, so showing an activity outlook would be an unvalidated extrapolation.'
  }
  if (status === 'validated') {
    return 'A validated outlook is available for this study area and date. It is a probability of satellite-detected activity, not a prediction that a fire will start.'
  }
  return 'The weather-driven activity model did not demonstrate skill beyond the seasonal climatology baseline in leave-one-year-out validation, so no fire-activity prediction is shown.'
}

function topicLabel(topic: string): string {
  const labels: Record<string, string> = {
    historical_pattern: 'Historical pattern',
    recent_observations: 'Recent satellite observations',
    current_weather: 'Recent weather',
    fire_weather_index: 'Fire danger from weather',
    outlook: 'Fire-activity outlook',
  }
  return labels[topic] ?? topic
}

function SectionHeading({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-meta tracking-[0.14em] text-ember">{index}</span>
      <span className="h-px w-8 bg-sand/25" aria-hidden="true" />
      <span className="eyebrow">{label}</span>
    </div>
  )
}

function WeatherStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-support text-ash">{label}</dt>
      <dd className="mt-1 font-display text-lg leading-tight text-bone">{value}</dd>
    </div>
  )
}

function GuidanceItem({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-sand/[0.1] bg-ink-900/50 px-4 py-3">
      <p className="text-body-sm font-medium text-bone">{title}</p>
      <p className="mt-1.5 text-support leading-relaxed text-ash">{text}</p>
    </div>
  )
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-32 rounded bg-sand/[0.08]" />
      <div className="mt-3 h-3 w-2/3 rounded bg-sand/[0.06]" />
      <p className="mt-4 text-support text-ash">{label}</p>
    </div>
  )
}
