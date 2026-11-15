export const providers = [
  {
    id: 'sp' as const,
    label: 'Standard Processing',
    note: 'Historical 2000–2026 · per-region coverage',
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
    note: 'VIIRS-equivalent · per-region decision',
  },
  { id: 'modis', label: 'MODIS raw', note: 'Terra + Aqua · sensor-native' },
  { id: 'viirs', label: 'VIIRS raw', note: 'Suomi-NPP · sensor-native' },
] as const

export type LayerId = (typeof layers)[number]['id']
