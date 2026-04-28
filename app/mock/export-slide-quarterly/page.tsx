'use client';

/**
 * 匯出投影片版面示意圖（quarterly mockup） — HA01-01 住院死亡率
 * - P Chart 季資料：分子=該季死亡人數總和，分母=該季出院總人次總和
 * - 上方：管制圖最近 25 季（~6.25 年）
 * - 下方：月份數值表最近 13 季（~3.25 年）
 */

interface QuarterData {
  year: number;
  quarter: number; // 1-4
  num: number;     // 該季死亡人數加總
  den: number;     // 該季出院人次加總
}

// 25 季示意資料（109.Q1 – 115.Q1），分母 ~3000/季，死亡率 ~2%
const SAMPLE_25: QuarterData[] = [
  { year: 109, quarter: 1, num: 56, den: 2950 },
  { year: 109, quarter: 2, num: 62, den: 3010 },
  { year: 109, quarter: 3, num: 58, den: 2980 },
  { year: 109, quarter: 4, num: 65, den: 3050 },
  { year: 110, quarter: 1, num: 60, den: 2920 },
  { year: 110, quarter: 2, num: 55, den: 3100 },
  { year: 110, quarter: 3, num: 72, den: 3080 },
  { year: 110, quarter: 4, num: 64, den: 2950 },
  { year: 111, quarter: 1, num: 59, den: 3020 },
  { year: 111, quarter: 2, num: 67, den: 3140 },
  { year: 111, quarter: 3, num: 53, den: 2900 },
  { year: 111, quarter: 4, num: 61, den: 3060 },
  // ↓ 以下 13 筆 = 表格顯示區間
  { year: 112, quarter: 1, num: 70, den: 3120 },
  { year: 112, quarter: 2, num: 58, den: 2980 },
  { year: 112, quarter: 3, num: 75, den: 3170 },
  { year: 112, quarter: 4, num: 62, den: 3040 },
  { year: 113, quarter: 1, num: 57, den: 2950 },
  { year: 113, quarter: 2, num: 63, den: 3000 },
  { year: 113, quarter: 3, num: 68, den: 3100 },
  { year: 113, quarter: 4, num: 60, den: 3010 },
  { year: 114, quarter: 1, num: 66, den: 3070 },
  { year: 114, quarter: 2, num: 99, den: 3055 }, // ← 觸發 UCL
  { year: 114, quarter: 3, num: 56, den: 2980 },
  { year: 114, quarter: 4, num: 64, den: 3060 },
  { year: 115, quarter: 1, num: 69, den: 3115 },
];

const TABLE_QUARTERS = 13;
const SAMPLE_TABLE = SAMPLE_25.slice(-TABLE_QUARTERS);

const INDICATOR_TITLE = 'HA01-01 住院死亡率（含病危自動出院）｜季資料';
const CAMPUS = '新竹院區';
const PEER = 1.95;
const DIRECTION_LABEL = '↓ 越低越好';

function ratioPct(d: QuarterData): number | null {
  return d.den > 0 ? (d.num / d.den) * 100 : null;
}

function fmtQ(d: QuarterData): string {
  return `${d.year}.Q${d.quarter}`;
}

export default function ExportSlideQuarterlyMockup() {
  const W = 1280;
  const H = 720;

  // P Chart 參數
  const valid = SAMPLE_25.filter((d) => d.den > 0);
  const totalNum = valid.reduce((s, d) => s + d.num, 0);
  const totalDen = valid.reduce((s, d) => s + d.den, 0);
  const pBar = totalNum / totalDen;
  const CL = pBar * 100;

  interface Limit { d: QuarterData; ucl: number | null; lcl: number | null; ucl2: number | null; lcl2: number | null; }
  const limits: Limit[] = SAMPLE_25.map((d) => {
    if (d.den === 0) return { d, ucl: null, lcl: null, ucl2: null, lcl2: null };
    const sig3 = 3 * Math.sqrt((pBar * (1 - pBar)) / d.den) * 100;
    const sig2 = 2 * Math.sqrt((pBar * (1 - pBar)) / d.den) * 100;
    return {
      d,
      ucl: CL + sig3,
      lcl: Math.max(0, CL - sig3),
      ucl2: CL + sig2,
      lcl2: Math.max(0, CL - sig2),
    };
  });

  const CHART_TOP = 86;
  const CHART_LEFT = 70;
  const CHART_RIGHT = 110;
  const CHART_HEIGHT = 360;
  const chartX = CHART_LEFT;
  const chartY = CHART_TOP;
  const chartW = W - CHART_LEFT - CHART_RIGHT;
  const chartH = CHART_HEIGHT;
  const colW = chartW / SAMPLE_25.length;
  const cx = (i: number) => chartX + (i + 0.5) * colW;

  const allVals = [
    ...valid.map((d) => ratioPct(d) as number),
    ...limits.flatMap((l) => [l.ucl, l.lcl].filter((v): v is number => v != null)),
    PEER,
  ];
  const dataMax = Math.max(...allVals);
  const yMin = 0;
  const yMax = Math.ceil((dataMax + 0.3) * 2) / 2;
  const yScale = (v: number) => chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  // NA 月份不畫點、折線斷開（同月版本規則）
  const chartPoints = SAMPLE_25.map((d, i) => {
    const r = ratioPct(d);
    const lim = limits[i];
    const isAnomaly = r != null && lim.ucl != null && r > lim.ucl;
    const isNA = r === null;
    return {
      i,
      d,
      x: cx(i),
      y: isNA ? null : yScale(r as number),
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

  const naColumns = SAMPLE_25.map((d, i) => ({ i, isNA: d.den === 0 })).filter((c) => c.isNA);

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
      if (prevY === null) {
        segs.push(`M ${x1} ${y}`);
      } else if (prevY !== y) {
        segs.push(`L ${x1} ${y}`);
      }
      segs.push(`L ${x2} ${y}`);
      prevY = y;
    });
    return segs.join(' ');
  }

  const uclPath = buildSteppedPath(limits.map((l) => l.ucl));
  const lclPath = buildSteppedPath(limits.map((l) => l.lcl));
  const ucl2Path = buildSteppedPath(limits.map((l) => l.ucl2));
  const lcl2Path = buildSteppedPath(limits.map((l) => l.lcl2));

  // Y 軸刻度
  const tickCount = 5;
  const yTicks: number[] = [];
  for (let i = 0; i <= tickCount; i++) yTicks.push((yMax / tickCount) * i);

  // X 軸刻度：每季都標示
  const xTicks = SAMPLE_25.map((d, i) => ({ i, label: fmtQ(d), d }));

  // 年度交界（quarter=1 表新年第一季）
  const yearBoundaries: number[] = [];
  for (let i = 1; i < SAMPLE_25.length; i++) {
    if (SAMPLE_25[i].year !== SAMPLE_25[i - 1].year) yearBoundaries.push(i);
  }

  // 表格
  const TABLE_TOP = CHART_TOP + CHART_HEIGHT + 60;
  const TABLE_LEFT = 70;
  const TABLE_RIGHT = 110;
  const TABLE_W = W - TABLE_LEFT - TABLE_RIGHT;
  const LABEL_COL_W = 120;
  const TABLE_DATA_W = TABLE_W - LABEL_COL_W;
  const TABLE_COL_W = TABLE_DATA_W / TABLE_QUARTERS;
  const TABLE_ROW_H = 32;
  const ROWS = 5;
  const tRowY = (r: number) => TABLE_TOP + r * TABLE_ROW_H;
  const tTextY = (r: number) => tRowY(r) + TABLE_ROW_H / 2 + 5;
  const tColX = (i: number) => TABLE_LEFT + LABEL_COL_W + (i + 0.5) * TABLE_COL_W;

  const yearGroups: { year: number; startIdx: number; endIdx: number }[] = [];
  SAMPLE_TABLE.forEach((d, i) => {
    const last = yearGroups[yearGroups.length - 1];
    if (last && last.year === d.year) last.endIdx = i;
    else yearGroups.push({ year: d.year, startIdx: i, endIdx: i });
  });

  return (
    <div className="min-h-screen bg-slate-200 p-8 flex flex-col items-center gap-4">
      <div className="text-sm text-gray-600 max-w-4xl">
        <div className="font-bold text-gray-800 mb-1">匯出投影片示意圖（季） — HA01-01</div>
        <div>P Chart 季資料：分子分母在每季加總後重算比率；25 季 ≈ 6 年歷史。X 軸標籤短，可水平擺放。</div>
      </div>

      <div className="bg-white shadow-xl" style={{ width: W, height: H }}>
        <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg">
          <text x={40} y={40} fontSize={22} fontWeight="bold" fill="#1F2937">{INDICATOR_TITLE}</text>
          <text x={40} y={66} fontSize={14} fill="#6B7280">
            {CAMPUS} ｜ P Chart ｜ n = {valid.length} ｜ 變動管制限 ｜ 最近 25 季
          </text>
          <text x={W - 40} y={40} fontSize={13} fill="#6B7280" textAnchor="end">{DIRECTION_LABEL}</text>
          <line x1={40} y1={76} x2={W - 40} y2={76} stroke="#E5E7EB" strokeWidth={1} />

          {/* 管制圖背景 */}
          <rect x={chartX} y={chartY} width={chartW} height={chartH} fill="#FAFAFA" />

          {/* NA 欄 */}
          {naColumns.map((c) => (
            <g key={`na-${c.i}`}>
              <rect x={chartX + c.i * colW} y={chartY} width={colW} height={chartH} fill="#E5E7EB" opacity={0.5} />
              <text x={chartX + (c.i + 0.5) * colW} y={chartY + chartH / 2 + 4} fontSize={10} fill="#6B7280" textAnchor="middle">NA</text>
            </g>
          ))}

          {/* Y 軸格線 + 刻度 */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={chartX} x2={chartX + chartW} y1={yScale(t)} y2={yScale(t)} stroke="#E5E7EB" strokeDasharray="3 3" />
              <text x={chartX - 8} y={yScale(t) + 4} fontSize={11} fill="#6B7280" textAnchor="end">{t.toFixed(1)}</text>
            </g>
          ))}
          <text x={chartX - 8} y={chartY - 6} fontSize={11} fill="#9CA3AF" textAnchor="end">%</text>

          {/* CL */}
          <line x1={chartX} x2={chartX + chartW} y1={yScale(CL)} y2={yScale(CL)} stroke="#374151" strokeDasharray="5 4" />
          <text x={chartX + chartW + 4} y={yScale(CL) + 4} fontSize={11} fill="#374151">CL {CL.toFixed(2)}</text>

          {/* 同儕 */}
          <line x1={chartX} x2={chartX + chartW} y1={yScale(PEER)} y2={yScale(PEER)} stroke="#2563EB" strokeDasharray="2 3" />
          <text x={chartX + chartW + 4} y={yScale(PEER) + 4} fontSize={11} fill="#2563EB">同儕 {PEER.toFixed(2)}</text>

          {/* 變動管制限 */}
          <path d={ucl2Path} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={lcl2Path} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={uclPath} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />
          <path d={lclPath} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />

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

          {/* UCL/LCL 標註（最右邊有效季） */}
          {(() => {
            const lastValid = [...limits].reverse().find((l) => l.ucl != null);
            if (!lastValid || lastValid.ucl == null || lastValid.lcl == null) return null;
            return (
              <>
                <text x={chartX + chartW + 4} y={yScale(lastValid.ucl) + 4} fontSize={11} fill="#DC2626">UCL {lastValid.ucl.toFixed(2)}</text>
                <text x={chartX + chartW + 4} y={yScale(lastValid.lcl) + 4} fontSize={11} fill="#DC2626">LCL {lastValid.lcl.toFixed(2)}</text>
              </>
            );
          })()}

          {/* X 軸 */}
          <line x1={chartX} x2={chartX + chartW} y1={chartY + chartH} y2={chartY + chartH} stroke="#9CA3AF" />
          {yearBoundaries.map((i) => (
            <line key={`yb-${i}`} x1={chartX + i * colW} x2={chartX + i * colW} y1={chartY} y2={chartY + chartH} stroke="#9CA3AF" strokeDasharray="2 2" />
          ))}
          {xTicks.map((t) => (
            <g key={t.i}>
              <line x1={cx(t.i)} x2={cx(t.i)} y1={chartY + chartH} y2={chartY + chartH + 4} stroke="#9CA3AF" />
              <text x={cx(t.i)} y={chartY + chartH + 18} fontSize={10} fill="#6B7280" textAnchor="middle">{t.label}</text>
            </g>
          ))}

          {/* 表格 */}
          <text x={TABLE_LEFT} y={TABLE_TOP - 10} fontSize={13} fontWeight="bold" fill="#374151">近 13 季數值</text>
          <rect x={TABLE_LEFT} y={TABLE_TOP} width={TABLE_W} height={TABLE_ROW_H * ROWS} fill="none" stroke="#374151" />
          {Array.from({ length: ROWS - 1 }).map((_, r) => (
            <line key={`hr-${r}`} x1={TABLE_LEFT} x2={TABLE_LEFT + TABLE_W} y1={tRowY(r + 1)} y2={tRowY(r + 1)} stroke="#D1D5DB" />
          ))}
          <rect x={TABLE_LEFT} y={TABLE_TOP} width={LABEL_COL_W} height={TABLE_ROW_H * ROWS} fill="#F9FAFB" />
          <line x1={TABLE_LEFT + LABEL_COL_W} x2={TABLE_LEFT + LABEL_COL_W} y1={TABLE_TOP} y2={TABLE_TOP + ROWS * TABLE_ROW_H} stroke="#374151" />

          {['年', '季', '分子（死亡）', '分母（出院）', '% 死亡率'].map((label, r) => (
            <text key={label} x={TABLE_LEFT + LABEL_COL_W - 8} y={tTextY(r)} fontSize={12} fill="#374151" textAnchor="end" fontWeight={r <= 1 ? 'bold' : 'normal'}>
              {label}
            </text>
          ))}

          {yearGroups.map((g) => {
            const x1 = TABLE_LEFT + LABEL_COL_W + g.startIdx * TABLE_COL_W;
            const x2 = TABLE_LEFT + LABEL_COL_W + (g.endIdx + 1) * TABLE_COL_W;
            return (
              <g key={`y-${g.year}`}>
                <rect x={x1} y={tRowY(0)} width={x2 - x1} height={TABLE_ROW_H} fill="#EFF6FF" />
                <text x={(x1 + x2) / 2} y={tTextY(0)} fontSize={13} fontWeight="bold" fill="#1E3A8A" textAnchor="middle">{g.year} 年</text>
                {g.startIdx > 0 && <line x1={x1} x2={x1} y1={TABLE_TOP} y2={TABLE_TOP + ROWS * TABLE_ROW_H} stroke="#374151" strokeWidth={1.5} />}
              </g>
            );
          })}

          {SAMPLE_TABLE.map((d, i) => {
            const r = ratioPct(d);
            const idx25 = SAMPLE_25.findIndex((x) => x.year === d.year && x.quarter === d.quarter);
            const lim = limits[idx25];
            const isAnomaly = r != null && lim.ucl != null && r > lim.ucl;
            return (
              <g key={`c-${i}`}>
                <text x={tColX(i)} y={tTextY(1)} fontSize={12} fill="#111827" textAnchor="middle" fontWeight="bold">Q{d.quarter}</text>
                <text x={tColX(i)} y={tTextY(2)} fontSize={12} fill="#111827" textAnchor="middle">{d.num}</text>
                <text x={tColX(i)} y={tTextY(3)} fontSize={12} fill="#111827" textAnchor="middle">{d.den}</text>
                <text x={tColX(i)} y={tTextY(4)} fontSize={12} fill={isAnomaly ? '#DC2626' : r == null ? '#9CA3AF' : '#111827'} fontWeight={isAnomaly ? 'bold' : 'normal'} textAnchor="middle">
                  {r == null ? 'NA' : r.toFixed(2)}
                </text>
              </g>
            );
          })}

          <text x={W - 40} y={H - 20} fontSize={11} fill="#9CA3AF" textAnchor="end">新竹臺大分院 QIP 監測指標系統</text>
        </svg>
      </div>

      <div className="text-xs text-gray-600 max-w-4xl">
        <div className="font-semibold mb-1">月版本 vs 季版本差異：</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>X 軸標籤改為「{`<年>.Q<季>`}」如 113.Q1，標籤短可水平、不需旋轉</li>
          <li>分母 = 該季 3 個月分母加總（~3000/季 vs 月版 ~1000/月）→ 管制限更窄、階梯更平緩</li>
          <li>表格列改為「年 / 季 / 分子 / 分母 / 比率」，覆蓋約 3 年</li>
          <li>114.Q2 為示意異常季（99/3055 = 3.24% 超過 UCL）</li>
          <li>對任何指標，月版 vs 季版只是資料源切換 — 同一份匯出邏輯可服務兩種模式</li>
        </ul>
      </div>
    </div>
  );
}
