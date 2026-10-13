/**
 * Parameter lists for the static export (`NEXT_OUTPUT=export`, see next.config.mjs and
 * docs/DEVELOPMENT_GUIDE.md "靜態匯出（綠色版用）").
 *
 * A static export can only contain pages that exist at build time, so every dynamic route segment
 * ([code], [category], ...) needs an explicit list. These are plain constants copied from the sources
 * named below. KEEP IN SYNC BY HAND whenever those sources change (new campus, category, indicator
 * or Davinci indicator) and rebuild the export; an indicator missing here has no page in the portable
 * edition. Regular builds (`next build` / `next start` / Docker) never use these lists.
 */

/** True only while building the static export. Read at build time. */
export const IS_STATIC_EXPORT = process.env.NEXT_OUTPUT === 'export'

/**
 * Campus codes. Source: backend/apps/entry/management/commands/seed_entry_base.py (CAMPUSES).
 * Used by /entry/review/campus/[campus]/[category].
 */
export const CAMPUS_CODES = ['hsinchu', 'zhubei', 'zhudong'] as const

/**
 * Report category codes HA01-HA10. Source: seed_entry_base.py (CATEGORIES).
 * Used by /entry/[category] and /entry/review/campus/[campus]/[category].
 */
export const REPORT_CATEGORY_CODES = [
  'HA01', 'HA02', 'HA03', 'HA04', 'HA05', 'HA06', 'HA07', 'HA08', 'HA09', 'HA10',
] as const

/**
 * Dashboard category names (the display names, not HAxx). Source: CATEGORY_ORDER in lib/constants.ts.
 * Used by /category/[id].
 */
export const DASHBOARD_CATEGORY_NAMES = [
  '整體照護', '加護照護', '手術照護', '產科照護',
  '急診照護', '感染管制', '重點照護', '用藥安全',
  '呼吸照護', '經營管理',
] as const

/**
 * Preset indicator codes. Source: INDICATOR_META in backend/apps/indicators/constants.py (what
 * seed_indicators.py loads; same keys as INDICATOR_META in lib/constants.ts). 39 codes today
 * (the "55" in older comments is stale). Indicators added later through the UI are not here.
 * Used by /indicators/[code] and /entry/case-list/[indicator].
 */
export const INDICATOR_CODES = [
  'HA01-01', 'HA01-02', 'HA01-03', 'HA01-03-01',
  'HA02-01', 'HA02-02', 'HA02-11', 'HA02-12', 'HA02-13',
  'HA03-01', 'HA03-02', 'HA03-03', 'HA03-04',
  'HA04-01', 'HA04-02',
  'HA05-01', 'HA05-02', 'HA05-03',
  'HA06-01', 'HA06-11', 'HA06-13', 'HA06-21', 'HA06-23', 'HA06-24', 'HA06-25', 'HA06-31', 'HA06-32',
  'HA07-01',
  'HA08-01',
  'HA09-01', 'HA09-02', 'HA09-03', 'HA09-04', 'HA09-05',
  'HA10-01', 'HA10-02', 'HA10-03', 'HA10-04', 'HA10-09',
] as const

/**
 * Davinci indicator codes DV01-DV07. Source: DAVINCI_INDICATORS in backend/apps/davinci/constants.py.
 * Used by /davinci/[code].
 */
export const DAVINCI_CODES = ['DV01', 'DV02', 'DV03', 'DV04', 'DV05', 'DV06', 'DV07'] as const
