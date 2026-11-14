import boundaries from '../data/nepal-study-areas.json'

export type Position = [number, number]

export type DistrictGeometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

export type DistrictFeature = {
  type: 'Feature'
  id: string
  properties: {
    id: string
    name: string
    province: string
    pcode: string
    boundaryYear: number
    source: string
    sourceUrl: string
    license: string
  }
  geometry: DistrictGeometry
}

type BoundaryCollection = {
  type: 'FeatureCollection'
  features: DistrictFeature[]
}

const collection = boundaries as unknown as BoundaryCollection

export function getDistrictFeature(id: string): DistrictFeature | undefined {
  return collection.features.find((feature) => feature.properties.id === id)
}

function forEachPosition(geometry: DistrictGeometry, visit: (position: Position) => void) {
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

type BuildDistrictPathOptions = {
  width?: number
  height?: number
  padding?: number
}

/**
 * Projects a real district boundary into a fitted SVG path.
 *
 * The geometry source is WGS84 longitude/latitude geometry from OCHA COD-AB
 * Nepal. Mercator projection is used only for display; no coordinates are
 * altered or invented.
 */
export function buildDistrictPath(
  geometry: DistrictGeometry,
  { width = 800, height = 600, padding = 46 }: BuildDistrictPathOptions = {},
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
