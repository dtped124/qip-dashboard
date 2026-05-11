import type { Campus, IndicatorData, IndicatorUnit, IndicatorStatus } from '@/lib/types';
import { lastCompleteQuarter, previousQuarter } from '@/lib/aggregation';

// ===== 匯出用資料結構 =====

export interface ScorecardRow {
  no: number;
  code: string;
  name: string;
  category: string;
  unit: IndicatorUnit;

  curRatio: number | null;
  curNum: number | null;
  curDen: number | null;

  prevRatio: number | null;
  prevNum: number | null;
  prevDen: number | null;

  delta: number | null;
  spcTrend: '穩定' | '波動';

  yearAvg: number | null;
  yearAvgNum: number | null;
  yearAvgDen: number | null;

  peerValue: number | null;
}

export interface ScorecardSlide {
  campus: Campus;
  rows: ScorecardRow[];
  quarterLabel: string;
  prevQuarterLabel: string;
  yearAvgLabel: string;
  peerLabel: string;
  slideIndex: number;
  totalSlides: number;
}

// ===== 常數 =====

const ROWS_PER_SLIDE = 12;

const CATEGORY_DISPLAY: Record<string, string> = {
  '整體照護': '整體綜合\n急性照護',
  '加護照護': '加護病房\n照護',
  '手術照護': '手術照護',
  '產科照護': '產科照護',
  '急診照護': '急診照護',
  '重點照護': '重點照護',
  '感染管制': '感染管制',
  '用藥安全': '用藥安全',
  '呼吸照護': '呼吸照護',
  '經營管理': '經營管理',
};

const PEER_LABEL: Record<Campus, string> = {
  '新竹': '醫學中心\n同儕值',
  '竹北': '區域\n同儕值',
  '竹東': '地區\n同儕值',
};

// ===== 內部工具 =====

function parseLatestMonth(s: string | null): { year: number; month: number } | null {
  if (!s) return null;
  const m1 = s.match(/^(\d+)\.(\d+)$/);
  if (m1) return { year: parseInt(m1[1]), month: parseInt(m1[2]) };
  const m2 = s.match(/^(\d+)年(\d+)月$/);
  if (m2) return { year: parseInt(m2[1]), month: parseInt(m2[2]) };
  return null;
}

/**
 * 取得「最近一個完整季」的當季與上一季資訊。
 * 範例：latestMonth=4 → 當季 Q1（完整），上一季 Q4 of 去年
 */
function quarterInfo(year: number, month: number) {
  const cur = lastCompleteQuarter(year, month);
  const prev = previousQuarter(cur.year, cur.quarter);
  return {
    q: cur.quarter,
    curYear: cur.year,
    curStart: cur.startMonth,
    curEnd: cur.endMonth,
    prevQ: prev.quarter,
    prevYear: prev.year,
    prevStart: prev.startMonth,
  };
}

function aggregateQuarter(
  monthlyData: { year: number; month: number; value: number | null; numerator?: number; denominator?: number }[],
  year: number,
  startMonth: number,
  upToMonth: number,
  unit: IndicatorUnit,
): { ratio: number | null; num: number | null; den: number | null } {
  const endMonth = Math.min(startMonth + 2, upToMonth);
  let totalNum = 0;
  let totalDen = 0;
  let hasData = false;
  let sumVal = 0;
  let valCount = 0;

  for (let m = startMonth; m <= endMonth; m++) {
    const dp = monthlyData.find(d => d.year === year && d.month === m);
    if (!dp || dp.value === null) continue;

    if ((unit === 'percent' || unit === 'permille') && dp.numerator != null && dp.denominator != null && dp.denominator > 0) {
      totalNum += dp.numerator;
      totalDen += dp.denominator;
      hasData = true;
    } else if (dp.value !== null) {
      sumVal += dp.value;
      valCount++;
    }
  }

  if (hasData && totalDen > 0) {
    const multiplier = unit === 'permille' ? 1000 : 100;
    return { ratio: (totalNum / totalDen) * multiplier, num: totalNum, den: totalDen };
  }
  if (valCount > 0) {
    // count 單位（事件數）→ 季為 3 個月加總；其他連續值（ratio、平均數）→ 取月平均
    const value = unit === 'count' ? sumVal : sumVal / valCount;
    return { ratio: value, num: null, den: null };
  }
  return { ratio: null, num: null, den: null };
}

function aggregateYear(
  monthlyData: { year: number; month: number; value: number | null; numerator?: number; denominator?: number }[],
  year: number,
  unit: IndicatorUnit,
): { ratio: number | null; num: number | null; den: number | null } {
  let totalNum = 0;
  let totalDen = 0;
  let hasData = false;
  let sumVal = 0;
  let valCount = 0;

  for (let m = 1; m <= 12; m++) {
    const dp = monthlyData.find(d => d.year === year && d.month === m);
    if (!dp || dp.value === null) continue;

    if ((unit === 'percent' || unit === 'permille') && dp.numerator != null && dp.denominator != null && dp.denominator > 0) {
      totalNum += dp.numerator;
      totalDen += dp.denominator;
      hasData = true;
    } else if (dp.value !== null) {
      sumVal += dp.value;
      valCount++;
    }
  }

  if (hasData && totalDen > 0) {
    const multiplier = unit === 'permille' ? 1000 : 100;
    return { ratio: (totalNum / totalDen) * multiplier, num: totalNum, den: totalDen };
  }
  if (valCount > 0) {
    // count 單位（事件數）→ 年為 12 個月加總；其他連續值（ratio、平均數）→ 取月平均
    const value = unit === 'count' ? sumVal : sumVal / valCount;
    return { ratio: value, num: null, den: null };
  }
  return { ratio: null, num: null, den: null };
}

function computeDelta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  if (Math.abs(prev) < 0.0001) return cur > 0.0001 ? 100 : cur < -0.0001 ? -100 : 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function spcTrend(status: IndicatorStatus): '穩定' | '波動' {
  return status === 'alert' ? '波動' : '穩定';
}

// ===== 主函式 =====

export function buildQuarterlyScorecard(
  allData: Record<string, IndicatorData[]>,
): ScorecardSlide[] {
  const campuses: Campus[] = ['新竹', '竹北', '竹東'];
  const slides: ScorecardSlide[] = [];

  // 找出全域最新月份
  let latestYear = 0;
  let latestMonth = 0;
  campuses.forEach(campus => {
    (allData[campus] || []).forEach(ind => {
      const parsed = parseLatestMonth(ind.latestMonth);
      if (parsed) {
        if (parsed.year > latestYear || (parsed.year === latestYear && parsed.month > latestMonth)) {
          latestYear = parsed.year;
          latestMonth = parsed.month;
        }
      }
    });
  });

  if (latestYear === 0) return [];

  const qi = quarterInfo(latestYear, latestMonth);
  const quarterLabel = `${qi.curYear}.Q${qi.q}`;
  const prevQuarterLabel = `${qi.prevYear}.Q${qi.prevQ}`;
  const prevFullYear = qi.curYear - 1;
  const yearAvgLabel = `${prevFullYear}年\n平均值`;

  for (const campus of campuses) {
    const indicators = (allData[campus] || []).slice().sort((a, b) => a.meta.code.localeCompare(b.meta.code));

    const rows: ScorecardRow[] = indicators.map((ind, idx) => {
      const unit = ind.meta.unit;
      // 當季與上一季皆已是「完整季」，整季三個月都聚合
      const cur = aggregateQuarter(ind.monthlyData, qi.curYear, qi.curStart, qi.curEnd, unit);
      const prev = aggregateQuarter(ind.monthlyData, qi.prevYear, qi.prevStart, qi.prevStart + 2, unit);

      // 年平均：優先用 yearlySummaries, 否則從 monthlyData 聚合
      let yearData: { ratio: number | null; num: number | null; den: number | null };
      const ys = ind.yearlySummaries.find(s => s.year === prevFullYear);
      if (ys && ys.average !== null) {
        const yearAgg = aggregateYear(ind.monthlyData, prevFullYear, unit);
        yearData = { ratio: ys.average, num: yearAgg.num, den: yearAgg.den };
      } else {
        yearData = aggregateYear(ind.monthlyData, prevFullYear, unit);
      }

      return {
        no: idx + 1,
        code: ind.meta.code,
        name: ind.meta.name,
        category: CATEGORY_DISPLAY[ind.meta.category] ?? ind.meta.category,
        unit,
        curRatio: cur.ratio,
        curNum: cur.num,
        curDen: cur.den,
        prevRatio: prev.ratio,
        prevNum: prev.num,
        prevDen: prev.den,
        delta: computeDelta(cur.ratio, prev.ratio),
        spcTrend: spcTrend(ind.status),
        yearAvg: yearData.ratio,
        yearAvgNum: yearData.num,
        yearAvgDen: yearData.den,
        peerValue: ind.peerValue,
      };
    });

    // 分頁：每張投影片 12 列
    const totalSlides = Math.max(1, Math.ceil(rows.length / ROWS_PER_SLIDE));
    for (let i = 0; i < totalSlides; i++) {
      const pageRows = rows.slice(i * ROWS_PER_SLIDE, (i + 1) * ROWS_PER_SLIDE);
      slides.push({
        campus,
        rows: pageRows,
        quarterLabel,
        prevQuarterLabel,
        yearAvgLabel,
        peerLabel: PEER_LABEL[campus],
        slideIndex: i,
        totalSlides,
      });
    }
  }

  return slides;
}
