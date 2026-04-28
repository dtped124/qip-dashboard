'use client';

/**
 * 投影片版面共用元件 — 單一 SVG 1280×720
 *
 * 渲染兩種版型：
 * - P/U Chart：階梯狀變動管制限、5 列表格（年/月或季/分子/分母/比率）
 * - I-MR Chart：水平管制限、3 列表格（年/月或季/值）
 */

import type {
  IndicatorMeta,
  MonthlyDataPoint,
  ControlChartParams,
  AnomalyResult,
  Campus,
  IndicatorUnit,
} from '@/lib/types';

const VISIBLE_CHART_POINTS = 25;
const VISIBLE_TABLE_POINTS = 13;

interface Props {
  meta: IndicatorMeta;
  dataPoints: MonthlyDataPoint[]; // 已彙總（月或季）並排序
  controlChart: ControlChartParams;
  anomalies: AnomalyResult[];
  peerValue: number | null;
  campus: Campus;
  isQuarterly: boolean;
  width?: number;
  height?: number;
}

function unitSuffix(unit: IndicatorUnit): string {
  switch (unit) {
    case 'percent': return '%';
    case 'permille': return '‰';
    case 'count': return '件';
    case 'ratio': return '';
  }
}

function monthToQuarter(month: number): number {
  return Math.ceil(month / 3);
}

function fmtPeriod(year: number, month: number, isQuarterly: boolean): string {
  if (isQuarterly) return `${year}.Q${monthToQuarter(month)}`;
  return `${year}.${String(month).padStart(2, '0')}`;
}

function formatRatio(v: number | null, unit: IndicatorUnit): string {
  if (v == null) return 'NA';
  if (unit === 'count') return String(Math.round(v));
  if (unit === 'ratio') return v.toFixed(3);
  return v.toFixed(2);
}

export function SlideLayout({
  meta,
  dataPoints,
  controlChart,
  anomalies,
  peerValue,
  campus,
  isQuarterly,
  width = 1280,
  height = 720,
}: Props) {
  const W = width;
  const H = height;

  // 排序、取最近 N 筆
  const sorted = [...dataPoints].sort(
    (a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month)
  );
  const chartData = sorted.slice(-VISIBLE_CHART_POINTS);
  const tableData = sorted.slice(-VISIBLE_TABLE_POINTS);

  const isIMR = controlChart.chartType === 'I-MR';
  const hasVarLimits = !isIMR && (controlChart.variableLimits?.length ?? 0) > 0;
  const unit = meta.unit;
  const periodLabel = isQuarterly ? '季' : '月';

  // 建立變動限查找
  const limitsMap = new Map<string, { ucl: number; lcl: number; ucl2: number; lcl2: number; sampleSize: number }>();
  if (hasVarLimits && controlChart.variableLimits) {
    for (const vl of controlChart.variableLimits) {
      limitsMap.set(`${vl.year}_${vl.month}`, vl);
    }
  }

  // 異常 lookup
  const anomalyMap = new Map<string, AnomalyResult>();
  for (const a of anomalies) {
    if (a.year != null && a.month != null && a.direction === 'unfavorable') {
      anomalyMap.set(`${a.year}_${a.month}`, a);
    }
  }

  // 取分子分母：優先用 dp 上的欄位，缺了則由 variableLimits.sampleSize + value 回推
  // P/U Chart 計算時以 sampleSize 作為當月分母，回推 numerator = round(value/multiplier × sampleSize)
  function getNumDen(dp: MonthlyDataPoint): { num: number | null; den: number | null } {
    if (dp.numerator != null && dp.denominator != null) {
      return { num: dp.numerator, den: dp.denominator };
    }
    const vl = limitsMap.get(`${dp.year}_${dp.month}`);
    if (vl?.sampleSize && dp.value != null) {
      const multiplier = unit === 'permille' ? 1000 : 100;
      const den = vl.sampleSize;
      const num = Math.round((dp.value / multiplier) * den);
      return { num, den };
    }
    return { num: null, den: null };
  }

  // 判斷某月是否「無資料」：value 為 null，或分母為 0（0/0 月份）
  function isNoData(dp: MonthlyDataPoint): boolean {
    if (dp.value == null) return true;
    const { den } = getNumDen(dp);
    return den === 0;
  }

  // 圖表版面
  const CHART_TOP = 86;
  const CHART_LEFT = 70;
  const CHART_RIGHT = 110;
  const CHART_HEIGHT = 360;
  const chartX = CHART_LEFT;
  const chartY = CHART_TOP;
  const chartW = W - CHART_LEFT - CHART_RIGHT;
  const chartH = CHART_HEIGHT;
  const colW = chartData.length > 0 ? chartW / chartData.length : 0;
  const cx = (i: number) => chartX + (i + 0.5) * colW;

  // Y 軸範圍（排除無資料月份）
  const validValues = chartData
    .filter((dp) => !isNoData(dp))
    .map((dp) => dp.value as number);
  const allUcls: number[] = [];
  const allLcls: number[] = [];
  for (const dp of chartData) {
    const vl = limitsMap.get(`${dp.year}_${dp.month}`);
    if (hasVarLimits && vl) {
      allUcls.push(vl.ucl);
      allLcls.push(vl.lcl);
    } else if (isIMR || !hasVarLimits) {
      allUcls.push(controlChart.ucl);
      allLcls.push(controlChart.lcl);
    }
  }
  const candidates = [
    ...validValues,
    ...allUcls,
    ...allLcls,
    controlChart.cl,
    ...(peerValue !== null ? [peerValue] : []),
  ];
  const dataMax = candidates.length > 0 ? Math.max(...candidates) : 1;
  const dataMin = candidates.length > 0 ? Math.min(...candidates, 0) : 0;
  const range = Math.max(dataMax - dataMin, 1);
  const padding = range * 0.1;
  const yMin = Math.max(0, dataMin - padding);
  const yMax = dataMax + padding;
  const yScale = (v: number) =>
    chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  // Y 軸刻度（5 等分）
  const yTickCount = 5;
  const yTicks: number[] = [];
  for (let i = 0; i <= yTickCount; i++) {
    yTicks.push(yMin + ((yMax - yMin) / yTickCount) * i);
  }

  // 點與折線
  const chartPoints = chartData.map((dp, i) => {
    const v = dp.value;
    const isNA = isNoData(dp);
    const key = `${dp.year}_${dp.month}`;
    const isAnomaly = !isNA && anomalyMap.has(key);
    return {
      i,
      dp,
      x: cx(i),
      y: isNA ? null : yScale(v as number),
      isAnomaly,
      isNA,
    };
  });

  const dataPath: string[] = [];
  {
    let started = false;
    chartPoints.forEach((p) => {
      if (p.y == null) {
        started = false;
      } else if (!started) {
        dataPath.push(`M ${p.x} ${p.y}`);
        started = true;
      } else {
        dataPath.push(`L ${p.x} ${p.y}`);
      }
    });
  }

  const naColumns = chartData
    .map((dp, i) => ({ i, isNA: isNoData(dp) }))
    .filter((c) => c.isNA);

  // 階梯管制限路徑（P/U）
  function buildSteppedPath(values: (number | null)[]): string {
    const segs: string[] = [];
    let prevY: number | null = null;
    values.forEach((v, i) => {
      if (v === null) {
        prevY = null;
        return;
      }
      const y = yScale(v);
      const x1 = chartX + i * colW;
      const x2 = chartX + (i + 1) * colW;
      if (prevY === null) segs.push(`M ${x1} ${y}`);
      else if (prevY !== y) segs.push(`L ${x1} ${y}`);
      segs.push(`L ${x2} ${y}`);
      prevY = y;
    });
    return segs.join(' ');
  }

  // P/U 階梯
  const stepUcl = hasVarLimits
    ? buildSteppedPath(chartData.map((dp) => limitsMap.get(`${dp.year}_${dp.month}`)?.ucl ?? null))
    : '';
  const stepLcl = hasVarLimits
    ? buildSteppedPath(chartData.map((dp) => limitsMap.get(`${dp.year}_${dp.month}`)?.lcl ?? null))
    : '';
  const stepUcl2 = hasVarLimits
    ? buildSteppedPath(chartData.map((dp) => limitsMap.get(`${dp.year}_${dp.month}`)?.ucl2 ?? null))
    : '';
  const stepLcl2 = hasVarLimits
    ? buildSteppedPath(chartData.map((dp) => limitsMap.get(`${dp.year}_${dp.month}`)?.lcl2 ?? null))
    : '';

  // X 軸標籤
  const xLabels = chartData.map((dp) => fmtPeriod(dp.year, dp.month, isQuarterly));
  const xRotate = !isQuarterly; // 月份標籤需旋轉避免重疊

  const yearBoundaries: number[] = [];
  for (let i = 1; i < chartData.length; i++) {
    if (chartData[i].year !== chartData[i - 1].year) yearBoundaries.push(i);
  }

  // 表格版面
  const tableRows = isIMR ? 3 : 5; // 年, 月/季, [分子, 分母,] 值/比率
  const TABLE_ROW_H = isIMR ? 36 : 32;
  const TABLE_TOP = CHART_TOP + CHART_HEIGHT + 60;
  const TABLE_LEFT = 70;
  const TABLE_RIGHT = 110;
  const TABLE_W = W - TABLE_LEFT - TABLE_RIGHT;
  const LABEL_COL_W = 120;
  const TABLE_DATA_W = TABLE_W - LABEL_COL_W;
  const tableColW = tableData.length > 0 ? TABLE_DATA_W / tableData.length : 0;
  const tRowY = (r: number) => TABLE_TOP + r * TABLE_ROW_H;
  const tTextY = (r: number) => tRowY(r) + TABLE_ROW_H / 2 + 5;
  const tColX = (i: number) => TABLE_LEFT + LABEL_COL_W + (i + 0.5) * tableColW;

  const tableYearGroups: { year: number; startIdx: number; endIdx: number }[] = [];
  tableData.forEach((dp, i) => {
    const last = tableYearGroups[tableYearGroups.length - 1];
    if (last && last.year === dp.year) last.endIdx = i;
    else tableYearGroups.push({ year: dp.year, startIdx: i, endIdx: i });
  });

  // header 統計字串
  const stats = isIMR
    ? `n = ${controlChart.n} ｜ σ̂ = ${controlChart.sigma.toFixed(3)}`
    : `n = ${controlChart.n} ｜ 變動管制限`;

  const directionLabel =
    meta.direction === 'lower' ? '↓ 越低越好'
    : meta.direction === 'higher' ? '↑ 越高越好'
    : '→ 持續監測';

  // 表格列標籤
  const ratioRowLabel =
    unit === 'percent' ? '% 比率'
    : unit === 'permille' ? '‰ 比率'
    : '比率';
  const valueRowLabel = `值（${unitSuffix(unit) || '數值'}）`;

  // 最右邊有效管制限（用於右側標註）
  const lastValidLimit = (() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      const dp = chartData[i];
      const vl = limitsMap.get(`${dp.year}_${dp.month}`);
      if (hasVarLimits && vl) return { ucl: vl.ucl, lcl: vl.lcl };
    }
    if (!hasVarLimits) return { ucl: controlChart.ucl, lcl: controlChart.lcl };
    return null;
  })();

  return (
    <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg" style={{ background: '#fff' }}>
      {/* 標題列 */}
      <text x={40} y={40} fontSize={22} fontWeight="bold" fill="#1F2937">
        {meta.code} {meta.name}
      </text>
      <text x={40} y={66} fontSize={14} fill="#6B7280">
        {campus}院區 ｜ {isIMR ? 'I-MR Chart' : controlChart.chartType === 'P' ? 'P Chart' : 'U Chart'} ｜ {stats} ｜ 最近 25 {periodLabel}
      </text>
      <text x={W - 40} y={40} fontSize={13} fill="#6B7280" textAnchor="end">
        {directionLabel}
      </text>
      <line x1={40} y1={76} x2={W - 40} y2={76} stroke="#E5E7EB" strokeWidth={1} />

      {/* === 管制圖 === */}
      <rect x={chartX} y={chartY} width={chartW} height={chartH} fill="#FAFAFA" />

      {/* NA 欄位灰底 */}
      {naColumns.map((c) => (
        <g key={`na-${c.i}`}>
          <rect x={chartX + c.i * colW} y={chartY} width={colW} height={chartH} fill="#E5E7EB" opacity={0.5} />
          <text x={chartX + (c.i + 0.5) * colW} y={chartY + chartH / 2 + 4} fontSize={10} fill="#6B7280" textAnchor="middle">NA</text>
        </g>
      ))}

      {/* Y 軸格線 + 刻度 */}
      {yTicks.map((t, idx) => (
        <g key={idx}>
          <line x1={chartX} x2={chartX + chartW} y1={yScale(t)} y2={yScale(t)} stroke="#E5E7EB" strokeDasharray="3 3" />
          <text x={chartX - 8} y={yScale(t) + 4} fontSize={11} fill="#6B7280" textAnchor="end">
            {unit === 'count' ? Math.round(t) : t.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={chartX - 8} y={chartY - 6} fontSize={11} fill="#9CA3AF" textAnchor="end">
        {unitSuffix(unit) || ' '}
      </text>

      {/* I-MR：1σ 綠色背景帶 */}
      {isIMR && controlChart.sigma > 0 && (
        <rect
          x={chartX}
          y={yScale(controlChart.cl + controlChart.sigma)}
          width={chartW}
          height={Math.max(0, yScale(Math.max(yMin, controlChart.cl - controlChart.sigma)) - yScale(controlChart.cl + controlChart.sigma))}
          fill="#10B981"
          opacity={0.06}
        />
      )}

      {/* CL */}
      <line x1={chartX} x2={chartX + chartW} y1={yScale(controlChart.cl)} y2={yScale(controlChart.cl)} stroke="#374151" strokeDasharray="5 4" />
      <text x={chartX + chartW + 4} y={yScale(controlChart.cl) + 4} fontSize={11} fill="#374151">
        CL {formatRatio(controlChart.cl, unit)}
      </text>

      {/* 同儕 */}
      {peerValue !== null && (
        <>
          <line x1={chartX} x2={chartX + chartW} y1={yScale(peerValue)} y2={yScale(peerValue)} stroke="#2563EB" strokeDasharray="2 3" />
          <text x={chartX + chartW + 4} y={yScale(peerValue) + 4} fontSize={11} fill="#2563EB">
            同儕 {formatRatio(peerValue, unit)}
          </text>
        </>
      )}

      {/* 管制限：P/U 階梯，I-MR 水平 */}
      {hasVarLimits ? (
        <>
          <path d={stepUcl2} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={stepLcl2} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={stepUcl} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />
          <path d={stepLcl} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />
        </>
      ) : (
        <>
          <line x1={chartX} x2={chartX + chartW} y1={yScale(controlChart.ucl2)} y2={yScale(controlChart.ucl2)} stroke="#FB923C" strokeDasharray="3 3" />
          <line x1={chartX} x2={chartX + chartW} y1={yScale(controlChart.lcl2)} y2={yScale(controlChart.lcl2)} stroke="#FB923C" strokeDasharray="3 3" />
          <line x1={chartX} x2={chartX + chartW} y1={yScale(controlChart.ucl)} y2={yScale(controlChart.ucl)} stroke="#DC2626" strokeWidth={1.5} strokeDasharray="5 3" />
          <line x1={chartX} x2={chartX + chartW} y1={yScale(controlChart.lcl)} y2={yScale(controlChart.lcl)} stroke="#DC2626" strokeWidth={1.5} strokeDasharray="5 3" />
        </>
      )}

      {/* UCL/LCL 右側標註 */}
      {lastValidLimit && (
        <>
          <text x={chartX + chartW + 4} y={yScale(lastValidLimit.ucl) + 4} fontSize={11} fill="#DC2626">
            UCL {formatRatio(lastValidLimit.ucl, unit)}
          </text>
          <text x={chartX + chartW + 4} y={yScale(lastValidLimit.lcl) + 4} fontSize={11} fill="#DC2626">
            LCL {formatRatio(lastValidLimit.lcl, unit)}
          </text>
        </>
      )}

      {/* 折線 */}
      {dataPath.length > 0 && <path d={dataPath.join(' ')} stroke="#111827" strokeWidth={2} fill="none" />}

      {/* 資料點 */}
      {chartPoints.map((p) => {
        if (p.y == null) return null;
        if (p.isAnomaly) {
          return (
            <g key={p.i}>
              <circle cx={p.x} cy={p.y} r={8} fill="#DC2626" opacity={0.25} />
              <circle cx={p.x} cy={p.y} r={5} fill="#DC2626" stroke="#fff" strokeWidth={1.5} />
            </g>
          );
        }
        return <circle key={p.i} cx={p.x} cy={p.y} r={3.5} fill="#16A34A" stroke="#fff" strokeWidth={1} />;
      })}

      {/* X 軸 */}
      <line x1={chartX} x2={chartX + chartW} y1={chartY + chartH} y2={chartY + chartH} stroke="#9CA3AF" />
      {yearBoundaries.map((i) => (
        <line key={`yb-${i}`} x1={chartX + i * colW} x2={chartX + i * colW} y1={chartY} y2={chartY + chartH} stroke="#9CA3AF" strokeDasharray="2 2" />
      ))}
      {xLabels.map((label, i) => {
        const xLabelY = chartY + chartH + 10;
        return (
          <g key={`xt-${i}`}>
            <line x1={cx(i)} x2={cx(i)} y1={chartY + chartH} y2={chartY + chartH + 4} stroke="#9CA3AF" />
            {xRotate ? (
              <text
                x={cx(i)}
                y={xLabelY}
                fontSize={10}
                fill="#6B7280"
                textAnchor="end"
                transform={`rotate(-45 ${cx(i)} ${xLabelY})`}
              >
                {label}
              </text>
            ) : (
              <text x={cx(i)} y={chartY + chartH + 18} fontSize={10} fill="#6B7280" textAnchor="middle">
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* === 表格 === */}
      <text x={TABLE_LEFT} y={TABLE_TOP - 10} fontSize={13} fontWeight="bold" fill="#374151">
        近 {tableData.length} {periodLabel}數值
      </text>
      <rect x={TABLE_LEFT} y={TABLE_TOP} width={TABLE_W} height={TABLE_ROW_H * tableRows} fill="none" stroke="#374151" />
      {Array.from({ length: tableRows - 1 }).map((_, r) => (
        <line key={`hr-${r}`} x1={TABLE_LEFT} x2={TABLE_LEFT + TABLE_W} y1={tRowY(r + 1)} y2={tRowY(r + 1)} stroke="#D1D5DB" />
      ))}
      <rect x={TABLE_LEFT} y={TABLE_TOP} width={LABEL_COL_W} height={TABLE_ROW_H * tableRows} fill="#F9FAFB" />
      <line x1={TABLE_LEFT + LABEL_COL_W} x2={TABLE_LEFT + LABEL_COL_W} y1={TABLE_TOP} y2={TABLE_TOP + tableRows * TABLE_ROW_H} stroke="#374151" />

      {/* 列標籤 */}
      {(isIMR
        ? ['年', periodLabel, valueRowLabel]
        : ['年', periodLabel, '分子', '分母', ratioRowLabel]
      ).map((label, r) => (
        <text key={label} x={TABLE_LEFT + LABEL_COL_W - 8} y={tTextY(r)} fontSize={12} fill="#374151" textAnchor="end" fontWeight={r <= 1 ? 'bold' : 'normal'}>
          {label}
        </text>
      ))}

      {/* 年合併儲存格 */}
      {tableYearGroups.map((g) => {
        const x1 = TABLE_LEFT + LABEL_COL_W + g.startIdx * tableColW;
        const x2 = TABLE_LEFT + LABEL_COL_W + (g.endIdx + 1) * tableColW;
        return (
          <g key={`tg-${g.year}`}>
            <rect x={x1} y={tRowY(0)} width={x2 - x1} height={TABLE_ROW_H} fill="#EFF6FF" />
            <text x={(x1 + x2) / 2} y={tTextY(0)} fontSize={13} fontWeight="bold" fill="#1E3A8A" textAnchor="middle">
              {g.year} 年
            </text>
            {g.startIdx > 0 && (
              <line x1={x1} x2={x1} y1={TABLE_TOP} y2={TABLE_TOP + tableRows * TABLE_ROW_H} stroke="#374151" strokeWidth={1.5} />
            )}
          </g>
        );
      })}

      {/* 每欄資料 */}
      {tableData.map((dp, i) => {
        const v = dp.value;
        const isNA = isNoData(dp);
        const key = `${dp.year}_${dp.month}`;
        const isAnomaly = !isNA && anomalyMap.has(key);
        const periodCell = isQuarterly ? `Q${monthToQuarter(dp.month)}` : `${dp.month}月`;
        const ratioColor = isAnomaly ? '#DC2626' : isNA ? '#9CA3AF' : '#111827';
        const ratioFontWeight = isAnomaly ? 'bold' : 'normal';
        return (
          <g key={`tc-${i}`}>
            <text x={tColX(i)} y={tTextY(1)} fontSize={12} fill="#111827" textAnchor="middle" fontWeight="bold">
              {periodCell}
            </text>
            {isIMR ? (
              <text x={tColX(i)} y={tTextY(2)} fontSize={13} fill={ratioColor} fontWeight={ratioFontWeight} textAnchor="middle">
                {isNA ? 'NA' : formatRatio(v, unit)}
              </text>
            ) : (
              (() => {
                const { num, den } = getNumDen(dp);
                return (
                  <>
                    <text x={tColX(i)} y={tTextY(2)} fontSize={12} fill="#111827" textAnchor="middle">
                      {num ?? (isNA ? 'NA' : '-')}
                    </text>
                    <text x={tColX(i)} y={tTextY(3)} fontSize={12} fill="#111827" textAnchor="middle">
                      {den ?? (isNA ? 'NA' : '-')}
                    </text>
                    <text x={tColX(i)} y={tTextY(4)} fontSize={12} fill={ratioColor} fontWeight={ratioFontWeight} textAnchor="middle">
                      {isNA ? 'NA' : formatRatio(v, unit)}
                    </text>
                  </>
                );
              })()
            )}
          </g>
        );
      })}

      <text x={W - 40} y={H - 20} fontSize={11} fill="#9CA3AF" textAnchor="end">
        新竹臺大分院 QIP 監測指標系統
      </text>
    </svg>
  );
}
