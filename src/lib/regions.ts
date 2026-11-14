export type StudyAreaId = 'NP-BANKE' | 'NP-BARDIYA' | 'NP-CHITWAN'

export type StudyArea = {
  id: StudyAreaId
  name: string
  province: string
  description: string
  boundaryId: StudyAreaId
  pcode: string
  availability: {
    boundary: 'available'
    observations: 'not-connected'
  }
}

/**
 * Central study-area configuration.
 *
 * Add a district here after adding its geometry to
 * src/data/nepal-study-areas.json. UI components read from this module,
 * so district facts are never scattered through the Explorer.
 */
export const studyAreas: readonly StudyArea[] = [
  {
    id: 'NP-BANKE',
    name: 'Banke',
    province: 'Lumbini Province',
    description:
      'A Terai district in Lumbini Province, bordering Bardiya to the west. Selected as a high-fire study area.',
    boundaryId: 'NP-BANKE',
    pcode: 'NP0557',
    availability: { boundary: 'available', observations: 'not-connected' },
  },
  {
    id: 'NP-BARDIYA',
    name: 'Bardiya',
    province: 'Lumbini Province',
    description:
      'A Terai district in Lumbini Province, west of Banke, containing Bardiya National Park. Selected as a high-fire study area.',
    boundaryId: 'NP-BARDIYA',
    pcode: 'NP0558',
    availability: { boundary: 'available', observations: 'not-connected' },
  },
  {
    id: 'NP-CHITWAN',
    name: 'Chitwan',
    province: 'Bagmati Province',
    description:
      'A Terai district in Bagmati Province, south-central Nepal, containing Chitwan National Park. Selected as a high-fire study area.',
    boundaryId: 'NP-CHITWAN',
    pcode: 'NP0335',
    availability: { boundary: 'available', observations: 'not-connected' },
  },
] as const

export const defaultStudyAreaId: StudyAreaId = 'NP-BANKE'

export function getStudyArea(id: string | null | undefined): StudyArea {
  return studyAreas.find((area) => area.id === id) ?? studyAreas[0]
}

export const studyAreaBoundarySource = {
  label: 'OCHA COD-AB Nepal / HDX',
  url: 'https://data.humdata.org/dataset/cod-ab-npl',
  license: 'CC BY-IGO',
  boundaryYear: 2024,
} as const
