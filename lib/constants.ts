import { Category, IndicatorMeta, IndicatorUnit, IndicatorStatus, Campus } from './types';

export const CATEGORY_COLORS: Record<Category, string> = {
  '整體照護': '#3B82F6',
  '加護照護': '#EF4444',
  '手術照護': '#F97316',
  '產科照護': '#EC4899',
  '急診照護': '#8B5CF6',
  '重點照護': '#06B6D4',
  '感染管制': '#10B981',
  '用藥安全': '#F59E0B',
  '呼吸照護': '#6366F1',
  '經營管理': '#6B7280',
};

export const CATEGORY_ORDER: Category[] = [
  '整體照護', '加護照護', '手術照護', '產科照護',
  '急診照護', '感染管制', '重點照護', '用藥安全',
  '呼吸照護', '經營管理',
];

export const STATUS_CONFIG: Record<IndicatorStatus, {
  color: string;
  text: string;
  textColor: string;
  bgLight: string;
  dotColor: string;
}> = {
  excellent: { color: 'bg-blue-500',    text: '卓越', textColor: 'text-blue-700',    bgLight: 'bg-blue-50',    dotColor: '#2563EB' },
  good:      { color: 'bg-green-500',   text: '良好', textColor: 'text-green-700',   bgLight: 'bg-green-50',   dotColor: '#16A34A' },
  watch:     { color: 'bg-yellow-500',  text: '留意', textColor: 'text-yellow-700',  bgLight: 'bg-yellow-50',  dotColor: '#CA8A04' },
  warning:   { color: 'bg-orange-500',  text: '注意', textColor: 'text-orange-700',  bgLight: 'bg-orange-50',  dotColor: '#EA580C' },
  alert:     { color: 'bg-red-500',     text: '警示', textColor: 'text-red-700',     bgLight: 'bg-red-50',     dotColor: '#DC2626' },
  neutral:   { color: 'bg-gray-400',    text: '監測', textColor: 'text-gray-600',    bgLight: 'bg-gray-50',    dotColor: '#9CA3AF' },
};

export const YEAR_COLORS: Record<number, string> = {
  115: '#3B82F6',
  114: '#60A5FA',
  113: '#93C5FD',
  112: '#BFDBFE',
  111: '#DBEAFE',
  110: '#EFF6FF',
};

/**
 * 季指標月份對應
 * Excel 中季指標存於月份 1, 4, 7, 10（每季起始月）
 */
export const QUARTERLY_MONTHS = [1, 4, 7, 10] as const;

/** 月份 → 季度（1-4） */
export function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

// 管制圖色彩
export const CONTROL_CHART_COLORS = {
  zoneNormal:  'rgba(22, 163, 74, 0.08)',   // 1σ 內
  zoneCaution: 'rgba(234, 88, 12, 0.08)',   // 1σ-2σ
  zoneDanger:  'rgba(220, 38, 38, 0.08)',   // 2σ-3σ
  cl:          '#6B7280',                    // 中心線
  ucl:         '#DC2626',                    // 管制上限
  lcl:         '#DC2626',                    // 管制下限
  sigma2:      '#EA580C',                    // 2σ 線
  peer:        '#2563EB',                    // 同儕值
  dataLine:    '#1C1917',                    // 數據線
};

// 完整指標元資料
const all3: Campus[] = ['竹北', '竹東', '新竹'];
const zhubeiHsinchu: Campus[] = ['竹北', '新竹'];
const zhudongHsinchu: Campus[] = ['竹東', '新竹'];
const hsinchu: Campus[] = ['新竹'];

export const INDICATOR_META: Record<string, Omit<IndicatorMeta, 'code'>> = {
  // 整體照護 — binomial_rate（分子=事件數 / 分母=總人次）
  'HA01-01': { name: '住院死亡率(含病危自動出院)', category: '整體照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['住院死亡千分率'], isActive: true, dataNature: 'binomial_rate' },
  'HA01-02': { name: '出院14天內因相同或相關病情非計畫性再住院率', category: '整體照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['非計畫再住院率', '14天再住院'], isActive: true, dataNature: 'binomial_rate' },
  'HA01-03': { name: '急性病床住院案件住院日數超過30日比率', category: '整體照護', unit: 'percent', isQuarterly: true, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['住院超過30日', '住院日數超過三十日', '住院日數超過30日', '住院超過30天'], isActive: true, dataNature: 'binomial_rate' },

  // 加護照護 — percent: binomial_rate, permille: poisson_rate
  'HA02-01': { name: '48小時(含)內加護病房重返率', category: '加護照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['ICU重返率', '加護病房重返'], isActive: true, dataNature: 'binomial_rate' },
  'HA02-02': { name: '加護病房死亡率(含病危自動出院)', category: '加護照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['ICU死亡率'], isActive: true, dataNature: 'binomial_rate' },
  'HA02-11': { name: '加護病房呼吸器相關肺炎(‰)', category: '加護照護', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['VAP', '呼吸器相關肺炎'], isActive: true, dataNature: 'poisson_rate' },
  'HA02-12': { name: '加護病房留置導尿管相關尿路感染(‰)', category: '加護照護', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['CAUTI', '導尿管感染'], isActive: true, dataNature: 'poisson_rate' },
  'HA02-13': { name: '加護病房中心導管相關血流感染(‰)', category: '加護照護', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['CLABSI', '中心導管感染'], isActive: true, dataNature: 'poisson_rate' },

  // 手術照護 — binomial_rate
  'HA03-01': { name: '手術後48小時內死亡率(含病危自動出院)', category: '手術照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['手術死亡率'], isActive: true, dataNature: 'binomial_rate' },
  'HA03-02': { name: '所有手術病人住院期間非計畫相關重返手術室', category: '手術照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['非計畫重返手術室', '手術病人住院期間非計畫相關重返手術室'], isActive: true, dataNature: 'binomial_rate' },
  'HA03-03': { name: '所有住院病人手術部位感染', category: '手術照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['手術部位感染率', 'SSI'], isActive: true, dataNature: 'binomial_rate' },
  'HA03-04': { name: '預防性抗生素在手術劃刀前1小時給予比率', category: '手術照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: all3, source: 'preset', aliases: ['預防性抗生素給予率'], isActive: true, dataNature: 'binomial_rate' },

  // 產科照護 — binomial_rate
  'HA04-01': { name: '總剖腹產率', category: '產科照護', unit: 'percent', isQuarterly: false, direction: 'monitor', isReverse: false, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA04-02': { name: '初次剖腹產率', category: '產科照護', unit: 'percent', isQuarterly: false, direction: 'monitor', isReverse: false, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },

  // 急診照護 — binomial_rate
  'HA05-01': { name: '急診轉住院比率', category: '急診照護', unit: 'percent', isQuarterly: false, direction: 'monitor', isReverse: false, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA05-02': { name: '急診會診超過30分鐘比率', category: '急診照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA05-03': { name: '緊急重大外傷手術於30分鐘內進入開刀房比率', category: '急診照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },

  // 感染管制 — poisson_rate（事件/住院人日）
  'HA07-01': { name: '醫療照護相關感染(‰)', category: '感染管制', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['醫療照護相關感染密度'], isActive: true, dataNature: 'poisson_rate' },

  // 重點照護 — percent: binomial_rate, count: continuous
  'HA06-01': { name: '全院腹膜透析病人比率', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA06-11': { name: '急性心肌梗塞-STEMI到急診90分鐘內施予緊急PCI比率', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhubeiHsinchu, source: 'preset', aliases: ['STEMI PCI'], isActive: true, dataNature: 'binomial_rate' },
  'HA06-13': { name: '急性心肌梗塞住院中死亡率(含病危自動出院)', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: zhubeiHsinchu, source: 'preset', aliases: ['AMI死亡率'], isActive: true, dataNature: 'binomial_rate' },
  'HA06-32': { name: '急性心肌梗塞出院時給予乙型阻斷劑比率', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA06-21': { name: '急性缺血性中風接受IV-tPA治療比率', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhubeiHsinchu, source: 'preset', aliases: ['tPA治療比率'], isActive: true, dataNature: 'binomial_rate' },
  'HA06-23': { name: '急性缺血性中風抵達急診60分鐘內接受IV-tPA治療比率', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA06-24': { name: '急性缺血性腦中風接受IV-tPA治療發生症狀性腦出血比率', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'lower', isReverse: false, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA06-25': { name: '急性缺血性中風發作2小時內抵達急診且3小時內施打IV-tPA', category: '重點照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhubeiHsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },
  'HA06-31': { name: '接受安寧共同照護個案數', category: '重點照護', unit: 'count', isQuarterly: false, direction: 'higher', isReverse: true, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'continuous' },

  // 用藥安全 — continuous（件數）
  'HA08-01': { name: '藥物不良反應通報件數', category: '用藥安全', unit: 'count', isQuarterly: false, direction: 'higher', isReverse: true, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'continuous' },

  // 呼吸照護 — permille: poisson_rate, percent: binomial_rate
  'HA09-01': { name: '慢性呼吸照護病房中心導管相關血流感染(‰)', category: '呼吸照護', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: zhudongHsinchu, source: 'preset', aliases: ['亞急性呼吸照護病房中心導管相關血流感染'], isActive: true, dataNature: 'poisson_rate' },
  'HA09-02': { name: '慢性呼吸照護病房呼吸器相關肺炎(‰)', category: '呼吸照護', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: zhudongHsinchu, source: 'preset', aliases: ['亞急性呼吸照護病房呼吸器相關肺炎'], isActive: true, dataNature: 'poisson_rate' },
  'HA09-03': { name: '慢性呼吸照護病房留置導尿管相關尿路感染(‰)', category: '呼吸照護', unit: 'permille', isQuarterly: false, direction: 'lower', isReverse: false, campuses: zhudongHsinchu, source: 'preset', aliases: ['慢性呼吸照護病房留置導尿管尿管尿路感染', '亞急性呼吸照護病房留置導尿管相關尿路感染'], isActive: true, dataNature: 'poisson_rate' },
  'HA09-04': { name: '慢性呼吸照護病房呼吸器脫離成功率', category: '呼吸照護', unit: 'percent', isQuarterly: false, direction: 'higher', isReverse: true, campuses: zhudongHsinchu, source: 'preset', aliases: ['呼吸器脫離率', '亞急性呼吸照護病房呼吸器脫離成功率'], isActive: true, dataNature: 'binomial_rate' },
  'HA09-05': { name: '亞急性呼吸照護病房氣切比率', category: '呼吸照護', unit: 'percent', isQuarterly: false, direction: 'monitor', isReverse: false, campuses: hsinchu, source: 'preset', aliases: [], isActive: true, dataNature: 'binomial_rate' },

  // 經營管理 — count: continuous, percent: binomial_rate, ratio: continuous
  'HA10-01': { name: '異常事件通報件數', category: '經營管理', unit: 'count', isQuarterly: false, direction: 'higher', isReverse: true, campuses: all3, source: 'preset', aliases: ['異常事件通報數'], isActive: true, dataNature: 'continuous' },
  'HA10-02': { name: '醫院員工遭受暴力事件數', category: '經營管理', unit: 'count', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'continuous' },
  'HA10-03': { name: '醫院員工發生職業災害件數', category: '經營管理', unit: 'count', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: [], isActive: true, dataNature: 'continuous' },
  'HA10-04': { name: '急性一般病床開放率', category: '經營管理', unit: 'percent', isQuarterly: false, direction: 'monitor', isReverse: false, campuses: all3, source: 'preset', aliases: ['病床開放率'], isActive: true, dataNature: 'binomial_rate' },
  'HA10-09': { name: '急性一般病床全日平均護病比', category: '經營管理', unit: 'ratio', isQuarterly: false, direction: 'lower', isReverse: false, campuses: all3, source: 'preset', aliases: ['護病比'], isActive: true, dataNature: 'continuous' },
};

// 110年無指標代碼，需透過名稱比對
export const NAME_TO_CODE: Record<string, string> = {
  '住院死亡率(含病危自動出院)': 'HA01-01',
  '出院14天內因相同或相關病情非計畫性再住院率': 'HA01-02',
  '急性病床住院案件住院日數超過30日比率': 'HA01-03',
  '48小時(含)內加護病房重返率': 'HA02-01',
  '加護病房死亡率(含病危自動出院)': 'HA02-02',
  '加護病房呼吸器相關肺炎': 'HA02-11',
  '加護病房留置導尿管相關尿路感染': 'HA02-12',
  '加護病房中心導管相關血流感染': 'HA02-13',
  '手術後48小時內死亡率(含病危自動出院)': 'HA03-01',
  '所有手術病人住院期間非計畫相關重返手術室': 'HA03-02',
  '所有住院病人手術部位感染': 'HA03-03',
  '預防性抗生素在手術劃刀前1小時給予比率': 'HA03-04',
  '總剖腹產率': 'HA04-01',
  '初次剖腹產率': 'HA04-02',
  '急診轉住院比率': 'HA05-01',
  '急診會診超過30分鐘比率': 'HA05-02',
  '緊急重大外傷手術於30分鐘內進入開刀房比率': 'HA05-03',
  '醫療照護相關感染': 'HA07-01',
  '全院腹膜透析病人比率': 'HA06-01',
  '急性心肌梗塞-STEMI到急診90分鐘內施予緊急經': 'HA06-11',
  '急性心肌梗塞住院中死亡率(含病危自動出院)': 'HA06-13',
  '急性心肌梗塞出院時給予乙型阻斷劑比率': 'HA06-32',
  '急性缺血性中風接受靜脈血栓溶解劑(IV-tPA)治': 'HA06-21',
  '急性缺血性中風抵達急診60分鐘(含)內接受靜脈血栓': 'HA06-23',
  '急性缺血性腦中風病人接受靜脈血栓溶解劑(IV-tP': 'HA06-24',
  '急性缺血性中風發作2小時（含）內抵達急診，且在發作': 'HA06-25',
  '接受安寧共同照護個案數': 'HA06-31',
  '藥物不良反應通報件數': 'HA08-01',
  '異常事件通報件數': 'HA10-01',
  '醫院員工遭受暴力事件數': 'HA10-02',
  '醫院員工發生職業災害件數': 'HA10-03',
  '急性一般病床開放率': 'HA10-04',
  '急性一般病床全日平均護病比': 'HA10-09',
  '慢性呼吸照護病房中心導管相關血流感染': 'HA09-01',
  '慢性呼吸照護病房呼吸器相關肺炎': 'HA09-02',
  '慢性呼吸照護病房留置導尿管相關尿路感染': 'HA09-03',
  '慢性呼吸照護病房呼吸器脫離成功率': 'HA09-04',
};

// TCPI 代碼 → QIP 指標代碼對應表（精確匹配，基於實際 TCPI 報表）
export const TCPI_CODE_TO_QIP: Record<string, string> = {
  'Hosp-Mort-01': 'HA01-01',   // 住院死亡率 (含病危自動出院)
  'Hosp-UnR-01':  'HA01-02',   // 出院14天內非計畫性再住院
  'ICU-UnR-03':   'HA02-01',   // 48小時(含)內非計畫性重返加護病房(以轉出人次為分母)
  'ICU-Mort-01':  'HA02-02',   // 加護病房死亡率 (含病危自動出院)
  'Sc-UnR-01':    'HA03-02',   // 所有手術病人住院期間非計畫相關重返手術室
  'SC-Infe-18':   'HA03-03',   // 所有住院手術病人手術部位感染
  'SC-AntiP-01b': 'HA03-04',   // 劃刀前60分鐘內接受預防性抗生素（對應 QIP 的「1小時」）
  'Obs-01':       'HA04-01',   // 總剖腹產率
  'Obs-02':       'HA04-02',   // 初次剖腹產率
  'AMI-07':       'HA06-11',   // STEMI到急診90分鐘內施予PCI
  'STK-03':       'HA06-21',   // 急性缺血性中風接受IV-tPA治療
  // === 以下為新竹（醫學中心）專用配對，竹北/竹東不適用 ===
  'AMI-15':       'HA06-13',   // 急性心肌梗塞住院中死亡率(含病危自動出院)
  'STK-04':       'HA06-23',   // 急性缺血性中風病人於到院2天內接受tPA
  'STK-05':       'HA06-24',   // 急性缺血性中風病人接受抗血栓治療
  'STK-02':       'HA06-25',   // 急性缺血性中風病人出院時接受抗血栓治療
  'AMI-24':       'HA06-32',   // 急性心肌梗塞出院時開立乙型阻斷劑
  'RCC-BSI-04':   'HA09-01',   // 亞急性呼吸照護病房中心導管相關血流感染
  'RCC-VAP-04':   'HA09-02',   // 亞急性呼吸照護病房呼吸器相關肺炎
  'RCC-UTI-03':   'HA09-03',   // 亞急性呼吸照護病房留置導尿管相關尿路感染
  'RCC-Integ01':  'HA09-04',   // 亞急性呼吸照護病房呼吸器脫離成功率
  'RCC-Integ04':  'HA09-05',   // 亞急性呼吸照護病房氣切比率
};

// TCPI 名稱 → QIP 指標代碼（名稱模糊匹配用，作為 code 匹配的補充）
export const TCPI_NAME_TO_QIP: Record<string, string> = {
  '住院死亡率 (含病危自動出院)': 'HA01-01',
  '住院死亡率(含病危自動出院)': 'HA01-01',
  '住院病人死亡率': 'HA01-01',
  '出院14天內因相同或相關病情非計畫性再住院': 'HA01-02',
  '出院14天內非計畫性再住院率': 'HA01-02',
  '48小時(含)內非計畫性重返加護病房(以轉出人次為分母)': 'HA02-01',
  '加護病房48小時內非計畫重返率': 'HA02-01',
  '加護病房死亡率 (含病危自動出院)': 'HA02-02',
  '加護病房死亡率(含病危自動出院)': 'HA02-02',
  '加護病房病人死亡率': 'HA02-02',
  '所有手術病人住院期間非計畫相關重返手術室': 'HA03-02',
  '所有住院手術病人非計畫重返手術室比率': 'HA03-02',
  '所有住院手術病人手術部位感染': 'HA03-03',
  '所有住院手術病人手術部位感染率': 'HA03-03',
  '所有接受預防性抗生素的手術病人在劃刀前60分鐘內接受預防性抗生素': 'HA03-04',
  '手術前一小時(含)內預防性抗生素給予率': 'HA03-04',
  '總剖腹產率': 'HA04-01',
  '初次剖腹產率': 'HA04-02',
  'STEMI到急診90分鐘內施予直接經皮冠狀動脈介入術比率': 'HA06-11',
  '急性心肌梗塞到院後90分鐘內接受心導管介入治療比率': 'HA06-11',
  '急性缺血性中風接受靜脈血栓溶解劑(IV-tPA)治療': 'HA06-21',
  '急性缺血性中風接受靜脈血栓溶解劑治療比率': 'HA06-21',
  // 新竹專用配對
  '急性心肌梗塞住院中死亡率(含病危自動出院)': 'HA06-13',
  '急性心肌梗塞住院中死亡率': 'HA06-13',
  '急性缺血性中風病人於到院2天內接受tPA': 'HA06-23',
  '急性缺血性中風病人接受抗血栓治療': 'HA06-24',
  '急性缺血性中風病人出院時接受抗血栓治療': 'HA06-25',
  '急性心肌梗塞出院時開立乙型阻斷劑': 'HA06-32',
  '呼吸照護病房中心導管相關血流感染': 'HA09-01',
  '呼吸照護病房呼吸器相關肺炎': 'HA09-02',
  '呼吸照護病房留置導尿管相關尿路感染': 'HA09-03',
  '呼吸照護病房呼吸器脫離成功率': 'HA09-04',
  '呼吸照護病房氣切比率': 'HA09-05',
};

// QIP → TCPI 反向查表（使用 code 表生成）
export const QIP_TO_TCPI_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(TCPI_CODE_TO_QIP).map(([tcpi, qip]) => [qip, tcpi])
);

// 有 TCPI 標竿的 QIP 指標列表（用於 UI 顯示）
export const QIP_WITH_TCPI = [
  // 三院區共用
  'HA01-01', 'HA01-02', 'HA02-01', 'HA02-02',
  'HA03-02', 'HA03-03', 'HA03-04',
  'HA04-01', 'HA04-02',
  'HA06-11', 'HA06-21',
  // 新竹（醫學中心）專用
  'HA06-13', 'HA06-23', 'HA06-24', 'HA06-25', 'HA06-32',
  'HA09-01', 'HA09-02', 'HA09-03', 'HA09-04', 'HA09-05',
] as const;

// 僅新竹（醫學中心）適用的 TCPI 配對
// 這些指標的 QIP 定義僅在醫學中心層級與 TCPI 定義一致，竹北/竹東不適用
export const HSINCHU_ONLY_TCPI: ReadonlySet<string> = new Set([
  'HA06-13',  // 急性心肌梗塞住院中死亡率(含病危自動出院) ↔ AMI-15
  'HA06-23',  // 急性缺血性中風病人於到院2天內接受tPA ↔ STK-04
  'HA06-24',  // 急性缺血性中風病人接受抗血栓治療 ↔ STK-05
  'HA06-25',  // 急性缺血性中風病人出院時接受抗血栓治療 ↔ STK-02
  'HA06-32',  // 急性心肌梗塞出院時開立乙型阻斷劑 ↔ AMI-24
  'HA09-01',  // 亞急性呼吸照護病房中心導管相關血流感染 ↔ RCC-BSI-04
  'HA09-02',  // 亞急性呼吸照護病房呼吸器相關肺炎 ↔ RCC-VAP-04
  'HA09-03',  // 亞急性呼吸照護病房留置導尿管相關尿路感染 ↔ RCC-UTI-03
  'HA09-04',  // 亞急性呼吸照護病房呼吸器脫離成功率 ↔ RCC-Integ01
  'HA09-05',  // 亞急性呼吸照護病房氣切比率 ↔ RCC-Integ04
]);

// 新竹（醫學中心）不適用 TCPI 標竿的指標（定義不一致，無法對應）
export const HSINCHU_TCPI_EXCLUDE: ReadonlySet<string> = new Set([
  'HA02-11',  // 加護病房呼吸器相關肺炎 — TCPI 依 ICU 科別拆分，定義不同
  'HA02-12',  // 加護病房留置導尿管相關尿路感染 — 同上
  'HA02-13',  // 加護病房中心導管相關血流感染率 — 同上
  'HA05-01',  // 急診轉住院比率 — 定義不符
  'HA05-02',  // 急診會診超過30分鐘比率 — 定義不符
  'HA05-03',  // 緊急重大外傷手術於30分鐘內進入開刀房比率 — 定義不符
  'HA06-01',  // 全院腹膜透析病人比率 — 定義不符
  'HA07-01',  // 醫療照護相關感染(‰) — 定義不符
]);

// 注意：以下 QIP 指標在 TCPI 無直接對應（所有院區皆無法配對）
// HA01-03: 住院日數超過30日比率 — TCPI 無
// HA02-11~13: 加護病房 VAP/CAUTI/CLABSI — TCPI 依 ICU 科別拆分，無全院合併值
// HA03-01: 手術後48小時內死亡率 — TCPI 無直接對應
// HA05-01~03: 急診指標 — TCPI 無
// HA06-01: 腹膜透析 — TCPI 無
// HA06-31: 安寧照護個案數 — 絕對數，TCPI 無
// HA07-01: 全院醫療照護相關感染密度 — 定義不一致
// HA08-01, HA10-01~09: 無 TCPI 對應

export function formatValue(value: number | null, unit: IndicatorUnit): string {
  if (value === null) return '-';
  switch (unit) {
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'permille':
      return `${value.toFixed(2)}‰`;
    case 'count':
      return Math.round(value).toString();
    case 'ratio':
      return value.toFixed(2);
  }
}
