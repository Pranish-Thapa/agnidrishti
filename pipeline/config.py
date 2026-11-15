"""Central configuration for the Agnidrishti NASA FIRMS pipeline.

Nothing scientific lives here except identifiers and definitions. Coverage
dates are *not* configured: they are discovered from the FIRMS availability
endpoint at run time (see ``availability.py``).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

REPO_ROOT = Path(__file__).resolve().parents[1]

# Single canonical six-region configuration, shared with the React application.
REGIONS_CONFIG_PATH = REPO_ROOT / "src" / "data" / "regions.json"

DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
BOUNDARY_DIR = DATA_DIR / "boundaries"
BOUNDARY_SOURCE_DIR = BOUNDARY_DIR / "source"
INTERMEDIATE_DIR = DATA_DIR / "intermediate"
PROCESSED_DIR = DATA_DIR / "processed"
MANIFEST_DIR = DATA_DIR / "manifests"
PUBLIC_DATA_DIR = REPO_ROOT / "public" / "data"

AVAILABILITY_DIR = RAW_DIR / "availability"

DOWNLOAD_MANIFEST = MANIFEST_DIR / "download_manifest.json"
PROCESSING_MANIFEST = MANIFEST_DIR / "processing_manifest.json"

# Full-resolution study-area geometry extracted from the OCHA COD-AB source.
STUDY_AREA_BOUNDARIES = BOUNDARY_DIR / "study_areas.geojson"
# Display geometry that the React application renders.
DISPLAY_BOUNDARIES = REPO_ROOT / "src" / "data" / "study-areas.json"
# Generated region metadata and processing status consumed by the frontend.
REGIONS_PUBLIC_METADATA = PUBLIC_DATA_DIR / "regions.json"

CONTRACT_VERSION = "1.0.0"
GRID_DEGREES = 0.1
WEEK_DEFINITION = "ISO 8601 weeks, Monday start, ISO week-year"
PROJECT_CRS = "OGC CRS84 / WGS84 longitude-latitude"

FIRMS_API_ROOT = "https://firms.modaps.eosdis.nasa.gov/api"
FIRMS_AVAILABILITY_URL = FIRMS_API_ROOT + "/data_availability/csv/{map_key}/{sensor}"
FIRMS_AREA_URL = (
    FIRMS_API_ROOT + "/area/csv/{map_key}/{source}/{bbox}/{day_range}/{start_date}"
)

# Maximum day range accepted by the FIRMS Area API (documented limit).
AREA_API_MAX_DAYS = 5

# OCHA COD-AB Nepal (administrative level 2), distributed by HDX.
BOUNDARY_SOURCE = {
    "label": "OCHA COD-AB Nepal, administrative level 2 (npl_admin2.geojson)",
    "dataset_url": "https://data.humdata.org/dataset/cod-ab-npl",
    "download_url": (
        "https://data.humdata.org/dataset/07db728a-4f0f-4e98-8eb0-8fa9df61f01c/"
        "resource/dea34e50-37d5-4e36-98ae-2b7b1b4c43de/download/"
        "npl_admin_boundaries.geojson.zip"
    ),
    "archive_member": "npl_admin2.geojson",
    "license": "CC BY-IGO",
    "boundary_year": 2024,
    "publisher": "OCHA / HDX",
}

CITATIONS = [
    "NASA FIRMS (Fire Information for Resource Management System), NASA LANCE/EOSDIS.",
    "Giglio, L., Schroeder, W., Hall, J.V. (MODIS Collection 6.1 active fire product).",
    "Schroeder, W., Oliva, P., Giglio, L., Csiszar, I.A. (VIIRS 375 m active fire product).",
    "OCHA COD-AB Nepal administrative boundaries, distributed by HDX (CC BY-IGO).",
    "geoBoundaries ADM1 boundaries for Thailand, Indonesia and Myanmar (CC BY 3.0 IGO / CC BY 4.0).",
]


@dataclass(frozen=True)
class SensorDefinition:
    """Static product facts. Coverage dates are discovered, never listed here."""

    sensor_id: str
    label: str
    instrument: str
    platforms: tuple[str, ...]
    satellite_codes: Mapping[str, str]
    confidence_kind: str
    confidence_scale: str
    brightness_fields: tuple[str, ...]
    sp_identifier: str
    nrt_identifier: str
    nrt_global_url: str

    @property
    def raw_dir(self) -> Path:
        return RAW_DIR / self.sensor_id


SENSORS: dict[str, SensorDefinition] = {
    "modis": SensorDefinition(
        sensor_id="modis",
        label="MODIS",
        instrument="MODIS",
        platforms=("Terra", "Aqua"),
        satellite_codes={"T": "Terra", "A": "Aqua", "Terra": "Terra", "Aqua": "Aqua"},
        confidence_kind="numeric",
        confidence_scale="MODIS numeric confidence 0-100 (not comparable to VIIRS categories)",
        brightness_fields=("brightness", "bright_t31"),
        sp_identifier="MODIS_SP",
        nrt_identifier="MODIS_NRT",
        nrt_global_url=(
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/"
            "MODIS_C6_1_Global_7d.csv"
        ),
    ),
    "viirs_snpp": SensorDefinition(
        sensor_id="viirs_snpp",
        label="VIIRS Suomi-NPP",
        instrument="VIIRS",
        platforms=("Suomi-NPP",),
        satellite_codes={"N": "Suomi-NPP"},
        confidence_kind="categorical",
        confidence_scale="VIIRS categorical confidence (low / nominal / high)",
        brightness_fields=("bright_ti4", "bright_ti5"),
        sp_identifier="VIIRS_SNPP_SP",
        nrt_identifier="VIIRS_SNPP_NRT",
        nrt_global_url=(
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
            "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv"
        ),
    ),
    "viirs_noaa20": SensorDefinition(
        sensor_id="viirs_noaa20",
        label="VIIRS NOAA-20",
        instrument="VIIRS",
        platforms=("NOAA-20",),
        satellite_codes={"N20": "NOAA-20"},
        confidence_kind="categorical",
        confidence_scale="VIIRS categorical confidence (low / nominal / high)",
        brightness_fields=("bright_ti4", "bright_ti5"),
        sp_identifier="VIIRS_NOAA20_SP",
        nrt_identifier="VIIRS_NOAA20_NRT",
        nrt_global_url=(
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
            "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv"
        ),
    ),
    "viirs_noaa21": SensorDefinition(
        sensor_id="viirs_noaa21",
        label="VIIRS NOAA-21",
        instrument="VIIRS",
        platforms=("NOAA-21",),
        satellite_codes={"N21": "NOAA-21"},
        confidence_kind="categorical",
        confidence_scale="VIIRS categorical confidence (low / nominal / high)",
        brightness_fields=("bright_ti4", "bright_ti5"),
        sp_identifier="VIIRS_NOAA21_SP",
        nrt_identifier="VIIRS_NOAA21_NRT",
        nrt_global_url=(
            "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
            "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv"
        ),
    ),
}

SENSOR_ORDER = tuple(SENSORS)

# Documented first date each platform's standard-processing active-fire record
# is available. A date before this is "platform not yet available", which is
# different from "observed, zero detections". MODIS Aqua begins with the Aqua
# platform (MYD14) in May 2002; Terra begins in November 2000. VIIRS dates are
# the archive start dates published by FIRMS.
PLATFORM_FIRST_DATE: dict[str, dict[str, str]] = {
    "modis": {"Terra": "2000-11-01", "Aqua": "2002-05-04"},
    "viirs_snpp": {"Suomi-NPP": "2012-01-20"},
    "viirs_noaa20": {"NOAA-20": "2018-04-01"},
    "viirs_noaa21": {"NOAA-21": "2023-03-01"},
}


@dataclass(frozen=True)
class RegionDefinition:
    """One study area, loaded from the single canonical regions.json.

    ``district_id`` and the ``province``/``pcode`` properties are retained for
    the observation contract, which still names the study-area key
    ``district_id``. New code should use ``region_id`` and the explicit
    country/admin-level fields.
    """

    region_id: str
    name: str
    full_name: str
    country: str
    country_code: str
    admin_level: int
    admin_level_label: str
    parent: str
    parent_label: str
    scale_class: str
    area_km2: float | None
    bbox: tuple[float, float, float, float] | None
    centroid: tuple[float, float] | None
    description: str
    boundary: dict
    source_name: str
    source_id: str | None

    @property
    def district_id(self) -> str:
        return self.region_id

    @property
    def province(self) -> str:
        # Backwards-compatible contract field: the parent administrative unit.
        return self.parent

    @property
    def pcode(self) -> str | None:
        return self.source_id

    @property
    def source_id_label(self) -> str:
        return str(self.boundary.get("sourceIdLabel") or "")

    @property
    def is_district(self) -> bool:
        return self.admin_level == 2


def _load_regions() -> dict[str, RegionDefinition]:
    payload = json.loads(REGIONS_CONFIG_PATH.read_text(encoding="utf-8"))
    regions: dict[str, RegionDefinition] = {}
    for raw in payload.get("regions", []):
        boundary = dict(raw.get("boundary") or {})
        bbox = raw.get("bbox")
        centroid = raw.get("centroid")
        region = RegionDefinition(
            region_id=str(raw["id"]),
            name=str(raw["name"]),
            full_name=str(raw.get("fullName") or raw["name"]),
            country=str(raw["country"]),
            country_code=str(raw["countryCode"]),
            admin_level=int(raw["adminLevel"]),
            admin_level_label=str(raw["adminLevelLabel"]),
            parent=str(raw.get("parent") or ""),
            parent_label=str(raw.get("parentLabel") or ""),
            scale_class=str(raw.get("scaleClass") or "region"),
            area_km2=float(raw["areaKm2"]) if raw.get("areaKm2") is not None else None,
            bbox=tuple(float(v) for v in bbox) if bbox else None,
            centroid=tuple(float(v) for v in centroid) if centroid else None,
            description=str(raw.get("description") or ""),
            boundary=boundary,
            source_name=str(boundary.get("sourceRegionName") or raw["name"]),
            source_id=(str(boundary["sourceId"]) if boundary.get("sourceId") else None),
        )
        if region.region_id in regions:
            raise ValueError(f"Duplicate region id in {REGIONS_CONFIG_PATH}: {region.region_id}")
        regions[region.region_id] = region
    if not regions:
        raise ValueError(f"No regions defined in {REGIONS_CONFIG_PATH}")
    return regions


REGIONS: dict[str, RegionDefinition] = _load_regions()
REGION_ORDER = tuple(REGIONS)


@dataclass(frozen=True)
class ProviderConfig:
    """A data acquisition provider.

    ``nrt`` is the public, credential-free 7-day global snapshot service.
    ``area-api`` is the documented FIRMS web service for standard processing
    (SP) data, which requires a free MAP_KEY.
    """

    provider_id: str
    label: str
    product: str
    requires_map_key: bool
    description: str


PROVIDERS: dict[str, ProviderConfig] = {
    "nrt": ProviderConfig(
        provider_id="nrt",
        label="FIRMS public global NRT snapshot",
        product="NRT",
        requires_map_key=False,
        description=(
            "Public 7-day global CSV snapshots of near real-time detections, one per "
            "sensor product. Real NASA files, but NRT rather than standard processing."
        ),
    ),
    "area-api": ProviderConfig(
        provider_id="area-api",
        label="FIRMS Area API (standard processing)",
        product="SP",
        requires_map_key=True,
        description=(
            "Documented FIRMS Area API returning standard-processing data for a bounding "
            "box, at most five days per request. Requires a free MAP_KEY."
        ),
    ),
}

# Archive-page coverage statements, kept only as documented reference points.
# They are NOT a substitute for querying /api/data_availability and are always
# reported separately from API-verified values.
REFERENCE_COVERAGE = [
    {
        "source_identifier": "MODIS_SP",
        "first_available_reference": "2000-11-01",
        "last_available_reference": None,
        "reference_note": "MODIS Collection 6.1, temporal coverage 1 November 2000 - present.",
    },
    {
        "source_identifier": "VIIRS_SNPP_SP",
        "first_available_reference": "2012-01-20",
        "last_available_reference": "2026-11-02",
        "reference_note": (
            "VIIRS S-NPP 375 m, temporal coverage 20 January 2012 - 2 November 2026 "
            "as stated on the FIRMS archive download page."
        ),
    },
    {
        "source_identifier": "VIIRS_NOAA20_SP",
        "first_available_reference": "2018-04-01",
        "last_available_reference": None,
        "reference_note": "VIIRS NOAA-20 375 m, temporal coverage 1 April 2018 - present.",
    },
    {
        "source_identifier": "VIIRS_NOAA21_SP",
        "first_available_reference": "2023-03-01",
        "last_available_reference": None,
        "reference_note": "VIIRS NOAA-21 375 m, temporal coverage 1 March 2023 - present.",
    },
]
REFERENCE_COVERAGE_CHECKED_ON = "2026-11-13"
REFERENCE_COVERAGE_URL = "https://firms.modaps.eosdis.nasa.gov/download/"

MAP_KEY_ENV = "FIRMS_MAP_KEY"
EARTHDATA_TOKEN_ENV = "EARTHDATA_TOKEN"


def load_env_file(path: Path | None = None) -> None:
    """Load ``.env`` placeholders into the process environment.

    Values are never logged. Existing environment variables win.
    """

    env_path = path or REPO_ROOT / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name and value and name not in os.environ:
            os.environ[name] = value


def map_key() -> str | None:
    load_env_file()
    value = os.environ.get(MAP_KEY_ENV, "").strip()
    return value or None


def earthdata_token() -> str | None:
    load_env_file()
    value = os.environ.get(EARTHDATA_TOKEN_ENV, "").strip()
    return value or None


def sensor_directory(sensor_id: str) -> Path:
    return RAW_DIR / sensor_id


def ensure_directories() -> None:
    for path in (
        RAW_DIR,
        BOUNDARY_DIR,
        INTERMEDIATE_DIR / "normalized",
        INTERMEDIATE_DIR / "filtered",
        INTERMEDIATE_DIR / "spatial",
        PROCESSED_DIR,
        MANIFEST_DIR,
        AVAILABILITY_DIR,
        PUBLIC_DATA_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def relative(path: Path) -> str:
    """Portable repository-relative path for manifests and reports."""

    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()
