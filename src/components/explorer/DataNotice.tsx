import { Info } from 'lucide-react'

export function DataNotice() {
  return (
    <div className="flex flex-col gap-4 border border-sand/20 bg-sand/[0.035] p-4 sm:flex-row sm:items-start sm:gap-5 sm:p-5">
      <Info
        size={17}
        strokeWidth={1.6}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-sand"
      />
      <div>
        <p className="text-[13px] font-medium text-bone">
          Real processed observations are connected. Read them with care.
        </p>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-ash">
          Calendar values come from processed NASA FIRMS MODIS and VIIRS standard-processing and
          near-real-time records for Banke, Bardiya and Chitwan. Values are hotspot detections —
          not unique fires, not burned area. Missing observations are shown as missing and never
          treated as zero. The harmonized layer is a provisional VIIRS-equivalent estimate whose
          validation could not distinguish the correction methods; treat it as exploratory, not
          authoritative. Historical coverage is January–June 2012–2026 plus July 2026;
          August–December were not requested in the acquisition and appear empty — an acquisition
          scope, never an absence of fire.
        </p>
      </div>
    </div>
  )
}
