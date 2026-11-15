import boundaries from '../data/study-areas.json'

export type Position = [number, number]

export type RegionGeometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

export type RegionFeature = {
  type: 'Feature'
  id: string
  properties: {
    id: string
    regionId: string
    name: string
    fullName: string
    country: string
    countryCode: string
    adminLevel: number
    adminLevelLabel: string
    parent: string
    scaleClass: string
    areaKm2: number | null
    pcode: string | null
    sourceIdLabel: string
    boundaryYear: number
    source: string
    sourceUrl: string
    license: string
    bbox: readonly [number, number, number, number]
  }
  geometry: RegionGeometry
}

type BoundaryCollection = {
  type: 'FeatureCollection'
  features: RegionFeature[]
}

const collection = boundaries as unknown as BoundaryCollection

export function getRegionFeature(id: string): RegionFeature | undefined {
  return collection.features.find(
    (feature) => feature.properties.regionId === id || feature.properties.id === id,
  )
}

/** @deprecated Use getRegionFeature. Retained for older call sites. */
export const getDistrictFeature = getRegionFeature

export function regionFeatures(): readonly RegionFeature[] {
  return collection.features
}

function forEachPosition(geometry: RegionGeometry, visit: (position: Position) => void) {
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring) => ring.forEach(visit))
    return
  }

  geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach(visit)))
}

type Projected = { x: number; y: number }

function projectMercator([lon, lat]: Position): Projected {
  const clampedLat = Math.max(-85, Math.min(85, lat))
  const radians = (clampedLat * Math.PI) / 180

  return {
    x: (lon * Math.PI) / 180,
    y: Math.log(Math.tan(Math.PI / 4 + radians / 2)),
  }
}

type BuildRegionPathOptions = {
  width?: number
  height?: number
  padding?: number
}

/**
 * Projects a real study-area boundary into a fitted SVG path.
 *
 * The geometry source is authoritative WGS84 longitude/latitude geometry
 * (OCHA COD-AB for Nepal, geoBoundaries ADM1 for Thailand, Indonesia and
 * Myanmar). Mercator projection is used only for display; no coordinates are
 * altered or invented.
 */
export function buildRegionPath(
  geometry: RegionGeometry,
  { width = 800, height = 600, padding = 46 }: BuildRegionPathOptions = {},
) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  forEachPosition(geometry, (position) => {
    const projected = projectMercator(position)
    minX = Math.min(minX, projected.x)
    minY = Math.min(minY, projected.y)
    maxX = Math.max(maxX, projected.x)
    maxY = Math.max(maxY, projected.y)
  })

  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const toScreen = ([lon, lat]: Position) => {
    const projected = projectMercator([lon, lat])
    return {
      x: width / 2 + (projected.x - centerX) * scale,
      y: height / 2 - (projected.y - centerY) * scale,
    }
  }

  const ringToPath = (ring: Position[]) => {
    return ring
      .map((position, index) => {
        const point = toScreen(position)
        return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
      })
      .join(' ')
      .concat(' Z')
  }

  const rings: Position[][] =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.coordinates.flatMap((polygon) => polygon)

  return {
    path: rings.map(ringToPath).join(' '),
    center: { x: width / 2, y: height / 2 },
    width,
    height,
  }
}

/** @deprecated Use buildRegionPath. */
export const buildDistrictPath = buildRegionPath

export type RegionBounds = [number, number, number, number]

/** Union bounds of the supplied regions (or all six by default). */
export function regionUnionBounds(features: readonly RegionFeature[] = collection.features): RegionBounds {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const feature of features) {
    const [w, s, e, n] = feature.properties.bbox
    west = Math.min(west, w)
    south = Math.min(south, s)
    east = Math.max(east, e)
    north = Math.max(north, n)
  }
  return [west, south, east, north]
}
