/**
 * Prepare real Nepal district boundaries for Agnidrishti.
 *
 * Source
 *   HDX / OCHA COD-AB Nepal, administrative level 2 (`npl_admin2.geojson`)
 *   https://data.humdata.org/dataset/cod-ab-npl
 *   Licence: CC BY-IGO. Boundary year represented: 2024.
 *
 * Usage
 *   node scripts/prepare-boundaries.cjs path/to/npl_admin2.geojson
 *
 * The script selects the three study districts, applies Douglas-Peucker
 * simplification at roughly 90 m tolerance, and writes a small GeoJSON
 * FeatureCollection to src/data/nepal-study-areas.json.
 *
 * Geometry is never hand-drawn or guessed. To add a district, extend
 * DISTRICT_SELECTION below and re-run the script.
 */
const fs = require('node:fs')
const path = require('node:path')

const DISTRICT_SELECTION = [
  {
    sourceName: 'Banke',
    id: 'NP-BANKE',
    name: 'Banke',
    province: 'Lumbini Province',
    pcode: 'NP0557',
  },
  {
    sourceName: 'Bardiya',
    id: 'NP-BARDIYA',
    name: 'Bardiya',
    province: 'Lumbini Province',
    pcode: 'NP0558',
  },
  {
    sourceName: 'Chitawan',
    id: 'NP-CHITWAN',
    name: 'Chitwan',
    province: 'Bagmati Province',
    pcode: 'NP0335',
  },
]

const TOLERANCE = 0.0008 // degrees, approximately 90 m at Nepal's latitude

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]

  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1])
  }

  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
  const clamped = Math.max(0, Math.min(1, t))
  const x = start[0] + clamped * dx
  const y = start[1] + clamped * dy

  return Math.hypot(point[0] - x, point[1] - y)
}

function simplify(points, tolerance) {
  if (points.length < 3) return points

  let maxDistance = 0
  let index = 0

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1])
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }

  if (maxDistance > tolerance) {
    const left = simplify(points.slice(0, index + 1), tolerance)
    const right = simplify(points.slice(index), tolerance)
    return left.slice(0, -1).concat(right)
  }

  return [points[0], points[points.length - 1]]
}

function simplifyRing(ring, tolerance) {
  const simplified = simplify(ring, tolerance)
  const first = simplified[0]
  const last = simplified[simplified.length - 1]

  if (first[0] !== last[0] || first[1] !== last[1]) {
    simplified.push(first)
  }

  return simplified.map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))])
}

function simplifyGeometry(geometry, tolerance) {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => simplifyRing(ring, tolerance)),
    }
  }

  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => simplifyRing(ring, tolerance)),
      ),
    }
  }

  throw new Error(`Unsupported geometry type: ${geometry.type}`)
}

const sourcePath = process.argv[2]

if (!sourcePath) {
  console.error('Usage: node scripts/prepare-boundaries.cjs path/to/npl_admin2.geojson')
  process.exit(1)
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))

const features = DISTRICT_SELECTION.map((selection) => {
  const match = source.features.find(
    (feature) => feature.properties.adm2_name === selection.sourceName,
  )

  if (!match) {
    throw new Error(`Could not find ${selection.sourceName} in the source dataset`)
  }

  return {
    type: 'Feature',
    id: selection.id,
    properties: {
      id: selection.id,
      name: selection.name,
      province: selection.province,
      pcode: selection.pcode,
      boundaryYear: 2024,
      source: 'OCHA COD-AB Nepal / HDX',
      sourceUrl: 'https://data.humdata.org/dataset/cod-ab-npl',
      license: 'CC BY-IGO',
    },
    geometry: simplifyGeometry(match.geometry, TOLERANCE),
  }
})

const output = {
  type: 'FeatureCollection',
  name: 'agnidrishti-nepal-study-areas',
  crs: {
    type: 'name',
    properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
  },
  metadata: {
    source: 'OCHA COD-AB Nepal / HDX (npl_admin2)',
    sourceUrl: 'https://data.humdata.org/dataset/cod-ab-npl',
    license: 'CC BY-IGO',
    boundaryYear: 2024,
    simplification: `Douglas-Peucker, ${TOLERANCE} degrees (~90 m)`,
    note: 'District boundaries are administrative context, not fire detections.',
  },
  features,
}

const outputPath = path.join(__dirname, '..', 'src', 'data', 'nepal-study-areas.json')
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`)

const countPoints = (geometry) => {
  if (geometry.type === 'Polygon') return geometry.coordinates[0].length
  return geometry.coordinates.reduce((total, polygon) => total + polygon[0].length, 0)
}

const counts = features.map((feature) => {
  return `${feature.properties.name}: ${countPoints(feature.geometry)} points`
})

console.log(`Wrote ${outputPath}`)
console.log(counts.join('\n'))
