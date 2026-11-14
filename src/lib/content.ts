export type PhaseStatus =
  | 'Foundation ready'
  | 'Planned'
  | 'Awaiting data'
  | 'In development'
  | 'Implemented · diagnostic'
  | 'Computed · inconclusive'
  | 'Computed'

export const capabilities = [
  {
    index: '01',
    title: 'Seam Audit',
    question: 'Did the satellite transition create an artificial jump?',
    description:
      'A diagnostic analysis compares raw MODIS, raw VIIRS and harmonized series at the start of the joint record, refitted without the audit window so it is a genuine prediction test. Raw scale steps of 8–50× shrink to roughly 0.8–2.2 — 81–97% closed on the log scale — reduced, never eliminated. The audit is diagnostic; it cannot prove causality.',
    status: 'Implemented · diagnostic' as PhaseStatus,
    schematic: 'seam',
  },
  {
    index: '02',
    title: 'Method Court',
    question: 'Do different correction methods tell the same story?',
    description:
      'Three harmonization approaches were fitted on identical training years and evaluated on identical held-out samples, with bootstrap uncertainty. Independent review added two baselines: a single constant multiplier does as well as month- or district-specific machinery (paired CCC difference −0.03, indistinguishable), while MODIS adds real information beyond the season (0.26 → 0.63). No winner is declared.',
    status: 'Computed · no method beats the baseline' as PhaseStatus,
    schematic: 'methods',
  },
  {
    index: '03',
    title: 'Lights-Out Backtest',
    question: 'What happens when a satellite disappears?',
    description:
      'Whole years are withheld from fitting and the harmonized record must reconstruct them from MODIS alone. Monthly fire-season profiles are preserved (r ≈ 0.97–1.00), while one method over-smooths real variation — reported honestly.',
    status: 'Computed' as PhaseStatus,
    schematic: 'backtest',
  },
] as const

export const principles = [
  {
    index: '01',
    title: 'VIIRS-equivalent reference scale',
    description:
      'Historical MODIS observations are evaluated against a common, finer-scale reference rather than being compared as raw counts.',
  },
  {
    index: '02',
    title: 'Overlap-period validation',
    description:
      'Where both sensors observe at the same time, that overlap becomes the testing ground for any correction.',
  },
  {
    index: '03',
    title: 'Multiple correction methods',
    description:
      'A trend should not depend on a single modelling choice. Methods are compared, not blended into one untested answer.',
  },
  {
    index: '04',
    title: 'Uncertainty-aware results',
    description:
      'Estimates are presented with their uncertainty, so a change can be judged against the confidence of the record.',
  },
  {
    index: '05',
    title: 'Transparent data provenance',
    description:
      'Sensor, product, processing version and time period remain visible. A number without its lineage is not evidence.',
  },
  {
    index: '06',
    title: 'Clear limitations',
    description:
      'What the record cannot resolve is stated plainly. Missing observations are never treated as an absence of fire.',
  },
] as const

export const methods = [
  {
    id: 'ratio',
    index: '01',
    name: 'Ratio-based correction',
    status: 'Computed · no method beats the baseline' as PhaseStatus,
    summary:
      'Estimate the ratio between MODIS and VIIRS detections during the overlap period, then apply a scaled correction to earlier MODIS observations.',
    formula: 'H\u209C = D\u209C × (V\u2092 / M\u2092)',
    assumption:
      'Detection ratios remain reasonably stable across the period being adjusted.',
    risk:
      'A single ratio can hide seasonal, regional or intensity-dependent differences between sensors.',
  },
  {
    id: 'quantile',
    index: '02',
    name: 'Quantile mapping',
    status: 'Computed · no method beats the baseline' as PhaseStatus,
    summary:
      'Match the distribution of MODIS detections to the VIIRS reference distribution observed during the overlap, then apply that mapping to the historical record.',
    formula: 'H\u209C = F\u1D65\u207B\u00B9( F\u2098(D\u209C) )',
    assumption:
      'The statistical relationship learned during the overlap remains applicable outside it.',
    risk:
      'Distribution matching can overcorrect sparse strata and may not preserve local or extreme events.',
  },
  {
    id: 'shrinkage',
    index: '03',
    name: 'Monthly shrinkage',
    status: 'Computed · no method beats the baseline' as PhaseStatus,
    summary:
      'Estimate monthly correction factors and shrink unstable estimates toward a longer-period baseline, weighted by sample size and uncertainty.',
    formula: 'r\u2098* = λ\u2098r\u2098 + (1 − λ\u2098)r\u0304',
    assumption:
      'Borrowing strength across months stabilizes noisy correction factors without erasing seasonal structure.',
    risk:
      'The shrinkage strength is a judgement. Too much smoothing can suppress real seasonal differences.',
  },
] as const

export const validationChecks = [
  {
    title: 'Overlap holdout',
    status: 'Computed' as PhaseStatus,
    description:
      'Fit corrections on part of the overlap period and test them on observations the method has not seen.',
  },
  {
    title: 'Seam discontinuity test',
    status: 'Computed' as PhaseStatus,
    description:
      'Measure whether the transition still produces a step change after harmonization, relative to the uncertainty of the series.',
  },
  {
    title: 'Method agreement',
    status: 'Computed' as PhaseStatus,
    description:
      'Compare trends and anomaly rankings across the ratio, quantile and monthly-shrinkage approaches.',
  },
  {
    title: 'Lights-out reconstruction',
    status: 'Computed' as PhaseStatus,
    description:
      'Withhold one sensor and test whether the harmonized record can reconstruct the missing observations.',
  },
] as const

export const limitations = [
  {
    title: 'No ground truth',
    description:
      'Satellite detections are observations, not a complete census of fire. Harmonized values are an improved basis for comparison, not ground truth.',
  },
  {
    title: 'Detection is not uniform',
    description:
      'Cloud cover, smoke, terrain, view angle, overpass time and fire size all affect whether a hotspot is detected.',
  },
  {
    title: 'Sensors change over time',
    description:
      'Instrument degradation, orbit drift and product reprocessing can alter detection behaviour within a single mission.',
  },
  {
    title: 'Algorithms change too',
    description:
      'A satellite transition is not the only seam. Retrieval algorithm versions and quality filtering can create their own discontinuities.',
  },
  {
    title: 'Sparse strata remain hard',
    description:
      'Regions and seasons with few overlapping detections provide weaker evidence for any correction factor.',
  },
  {
    title: 'Residual uncertainty remains',
    description:
      'Harmonization reduces a known inconsistency. It cannot remove all observational bias or recover fires that were never detected.',
  },
] as const

export const explorerYears = ['2025', '2024', '2023', '2022', '2021', '2020'] as const

export const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const
