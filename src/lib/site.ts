export const site = {
  name: 'Agnidrishti',
  wordmark: 'AGNIDRISHTI',
  tagline: 'See the fire. Verify the signal.',
  challenge: 'Harmonization of MODIS and VIIRS Hot Spots',
  challengeShort: 'NASA Space Apps Challenge 2026',
  description:
    'A satellite-aware fire activity calendar that reveals which fire trends are real and which may be caused by changing satellite observations.',
  question: 'Did the fires increase, or did the satellites get better?',
} as const

export const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'Explore', to: '/explorer' },
  { label: 'Our Method', to: '/methodology' },
  { label: 'Community', to: '/community' },
  { label: 'About', to: '/about' },
] as const

export const externalLinks = {
  spaceApps: 'https://www.spaceappschallenge.org/',
  firms: 'https://firms.modaps.eosdis.nasa.gov/',
} as const
