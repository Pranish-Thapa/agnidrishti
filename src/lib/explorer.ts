export const providers = [
  {
    id: 'sp' as const,
    label: 'Standard Processing',
    note: 'Historical 2012–2026',
  },
  {
    id: 'nrt' as const,
    label: 'Near real-time',
    note: 'Public 7-day snapshot',
  },
]

export type ProviderId = (typeof providers)[number]['id']

export const layers = [
  {
    id: 'harmonized',
    label: 'Harmonized',
    note: 'VIIRS-equivalent · provisional',
  },
  { id: 'modis', label: 'MODIS raw', note: 'Terra + Aqua · sensor-native' },
  { id: 'viirs', label: 'VIIRS raw', note: 'Suomi-NPP · sensor-native' },
] as const

export type LayerId = (typeof layers)[number]['id']
