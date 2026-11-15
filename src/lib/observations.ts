export type SensorId = "modis" | "viirs_snpp" | "viirs_noaa20" | "viirs_noaa21";

export type ObservationStatus = "observed" | "observed_zero" | "missing" | "unavailable";

export type WeekStatus = ObservationStatus | "incomplete";

export type FrpSummary = {
  n: number;
  sum: number;
  mean: number;
  min: number | null;
  max: number | null;
};

export type PlatformAggregate = {
  status: ObservationStatus;
  detections: number | null;
  cells: number | null;
  cell_days: number | null;
  occupied_cells?: number | null;
  frp: FrpSummary | null;
  days_observed?: number;
};

export type SensorDayBlock = {
  platforms: Record<string, PlatformAggregate>;
};

export type ObservationDay = {
  date: string;
  status: ObservationStatus;
  by_sensor: Record<SensorId, SensorDayBlock>;
};

export type ObservationWeek = {
  iso_year: number;
  iso_week: number;
  week_start: string;
  week_end: string;
  days_in_week: number;
  status: WeekStatus;
  by_sensor: Record<SensorId, { platforms: Record<string, PlatformAggregate & { days_observed?: number }> }>;
};

export type RegionDataStatus = 'available' | 'not_acquired' | 'unknown'

export type ObservationDataset = {
  contract_version: string;
  district_id: string;
  region_id?: string;
  district: {
    name: string;
    full_name?: string;
    country?: string;
    admin_level_label?: string;
    province: string;
    pcode: string | null;
  };
  year: string;
  generated_at: string;
  provider: string;
  product: string;
  sensors: SensorId[];
  days: ObservationDay[];
  weeks: ObservationWeek[];
  processing_status?: {
    status: RegionDataStatus;
    reason?: string;
    records?: number;
  };
};

export type StudyAreaIndexEntry = {
  district_id: string;
  region_id?: string;
  name: string;
  full_name?: string;
  country?: string;
  country_code?: string;
  admin_level?: number;
  admin_level_label?: string;
  province: string;
  pcode: string | null;
  scale_class?: string;
  area_km2?: number | null;
  years: string[];
  bbox: number[] | null;
  status: RegionDataStatus;
  status_reason?: string | null;
};

export type SensorDescriptor = {
  sensor_id: SensorId;
  label: string;
  instrument: string;
  platforms: string[];
  confidence_kind: string;
  confidence_scale: string;
  brightness_fields: string[];
};

export type ObservationIndex = {
  contract_version: string;
  generated_at: string;
  provider: { id: string; product: string };
  study_areas: StudyAreaIndexEntry[];
  regions?: string[];
  regions_with_observations?: string[];
  region_status?: Record<string, { status: RegionDataStatus; reason?: string; records?: number }>;
  sensors: SensorDescriptor[];
  years: string[];
  paths: {
    district_year: string;
    metadata: string;
  };
  quality_summary: {
    raw_record_count: number | null;
    valid_record_count: number | null;
    final_retained_record_count: number | null;
    outside_study_area_count: number | null;
    duplicate_count: number | null;
  };
  limitations: string[];
  citations: string[];
};

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isObservationIndex(value: unknown): value is ObservationIndex {
  if (!isRecord(value)) return false;
  return (
    typeof value.contract_version === "string" &&
    typeof value.generated_at === "string" &&
    Array.isArray(value.study_areas) &&
    Array.isArray(value.sensors) &&
    Array.isArray(value.years)
  );
}

export function isObservationDataset(value: unknown): value is ObservationDataset {
  if (!isRecord(value)) return false;
  return (
    typeof value.contract_version === "string" &&
    typeof value.district_id === "string" &&
    typeof value.year === "string" &&
    Array.isArray(value.days) &&
    Array.isArray(value.weeks)
  );
}

export async function loadObservationIndex(
  provider: "nrt" | "sp" = "nrt",
  signal?: AbortSignal
): Promise<ObservationIndex | null> {
  try {
    const response = await fetch(`${DATA_BASE}/${provider}/index.json`, { signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to load observation index: ${response.status}`);
    const payload: unknown = await response.json();
    if (!isObservationIndex(payload)) throw new Error("Invalid observation index shape");
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

export async function loadDistrictYear(
  districtId: string,
  year: string,
  provider: "nrt" | "sp" = "nrt",
  signal?: AbortSignal
): Promise<ObservationDataset | null> {
  try {
    const response = await fetch(`${DATA_BASE}/${provider}/${districtId}/${year}.json`, { signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to load district year: ${response.status}`);
    const payload: unknown = await response.json();
    if (!isObservationDataset(payload)) throw new Error("Invalid district dataset shape");
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

/** Region-named alias. Observation files keep the historical `district_id` key. */
export const loadRegionYear = loadDistrictYear;

export function studyAreaIndexEntry(
  index: ObservationIndex | null,
  regionId: string
): StudyAreaIndexEntry | null {
  return index?.study_areas.find((entry) => entry.district_id === regionId) ?? null;
}

/** Years with an acquired file for this region and provider. Empty = missing coverage. */
export function availableYearsFor(index: ObservationIndex | null, regionId: string): string[] {
  return studyAreaIndexEntry(index, regionId)?.years ?? [];
}
