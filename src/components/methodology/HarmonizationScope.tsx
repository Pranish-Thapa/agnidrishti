/**
 * Plain-language explanation of what "harmonized" means in this project,
 * including how pre-2012 values are gated by the transferability tests. Facts
 * come from the published inventory and experiment artifacts; nothing here is
 * a hand-entered backcast claim.
 */
export function HarmonizationScope({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-labelledby="harmonization-explained-heading"
      className={`card ${compact ? 'mt-6 px-5 py-5' : 'mt-4 px-5 py-5 sm:px-6 sm:py-6'}`}
    >
      <p className="eyebrow text-ash">Plain-language method note</p>
      <h2
        id="harmonization-explained-heading"
        className={`mt-2 font-display text-bone ${compact ? 'text-xl' : 'text-2xl'}`}
      >
        What does &ldquo;harmonized&rdquo; mean — and what happens before 2012?
      </h2>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="text-body-sm font-medium text-bone">Two sensors, two sensitivities</h3>
          <p className="mt-1.5 text-support leading-relaxed text-ash">
            MODIS (Terra and Aqua) detects hotspots at roughly 1 km resolution and has the long
            historical record. VIIRS (Suomi-NPP) detects them at roughly 375 m and is more sensitive
            to small or cooler fires. The same landscape can therefore produce different counts
            depending on which sensor is overhead.
          </p>
        </div>
        <div>
          <h3 className="text-body-sm font-medium text-bone">What was compared</h3>
          <p className="mt-1.5 text-support leading-relaxed text-ash">
            Region-day detection counts from MODIS and VIIRS inside all six study areas, using the
            post-2012 overlap (VIIRS starts on 20 January 2012). The two sensors overlap for the
            acquired 2012+ period, so calibration and post-2012 output cover the same days.
          </p>
        </div>
        <div>
          <h3 className="text-body-sm font-medium text-bone">What the estimate is</h3>
          <p className="mt-1.5 text-support leading-relaxed text-ash">
            A harmonized value is <strong className="text-ash-light">MODIS detections × a monthly
            shrinkage factor</strong>, expressed on the VIIRS scale. It is a modelled
            VIIRS-equivalent estimate: not an observed VIIRS count, not a new fire, and not ground
            truth. Raw MODIS and raw VIIRS layers remain available in the Explorer for comparison.
          </p>
        </div>
        <div>
          <h3 className="text-body-sm font-medium text-bone">What happens before 2012</h3>
          <p className="mt-1.5 text-support leading-relaxed text-ash">
            MODIS Terra was acquired from November 2000 and Aqua from May 2002 for every study
            area. Because no VIIRS exists beside those years, the correction&rsquo;s
            transferability is tested inside the 2012+ overlap with blocked year splits, a purge
            gap and leave-one-year-out folds. Each region, platform and calendar month is decided
            SUPPORTED, LIMITED or UNSUPPORTED. Estimates are shown only where the decision allows
            them; everywhere else the raw MODIS record is kept on its native scale.
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-sand/[0.1] bg-sand/10 sm:grid-cols-4">
        {[
          ['First MODIS Terra observation', '1 Nov 2000'],
          ['First MODIS Aqua observation', '4 May 2002'],
          ['First VIIRS observation', '20 Jan 2012'],
          ['Method Court verdict', 'Inconclusive'],
        ].map(([label, value]) => (
          <div key={label} className="bg-ink-850 px-4 py-3">
            <p className="data-label">{label}</p>
            <p className="mt-1 text-body-sm font-medium text-bone">{value}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-support leading-relaxed text-ash-dark">
        The post-2012 record covers January–July 2012–2026 (January–June each year, plus July 2026
        only). August–December 2012+ was not requested from FIRMS, so it supports no claim; the
        pre-2012 acquisition covers full calendar years. 2000–2001 is Terra-only. Every region has
        its own decision per platform and month, so harmonized availability differs by region —
        Thailand, Indonesia and Myanmar are never assumed to behave like Nepal.
      </p>
    </section>
  )
}
