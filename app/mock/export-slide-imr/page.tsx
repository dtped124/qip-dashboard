'use client';

/**
 * 匯出投影片版面示意圖（I-MR mockup） — HA06-31 接受安寧共同照護個案數
 * - I-MR Chart：CL = X̄，σ̂ = MR̄ / d2，UCL/LCL 為水平直線（非階梯）
 * - 表格收斂為 3 列：年 / 月 / 值（無分子分母）
 * - 方向 = 越高越好（higher）→ 值低於 LCL 為不利異常
 */

interface MonthData {
  year: number;
  month: number;
  value: number | null; // count；null 表示無資料
}

const D2 = 1.128;

// 25 個月示意：個案數通常 10-25/月；114.10 = 1 → 低於 LCL 觸發 Rule 1（不利）
const SAMPLE_25: MonthData[] = [
  { year: 113, month: 3,  value: 12 },
  { year: 113, month: 4,  value: 14 },
  { year: 113, month: 5,  value: 11 },
  { year: 113, month: 6,  value: 15 },
  { year: 113, month: 7,  value: 18 },
  { year: 113, month: 8,  value: 13 },
  { year: 113, month: 9,  value: 16 },
  { year: 113, month: 10, value: 14 },
  { year: 113, month: 11, value: 17 },
  { year: 113, month: 12, value: 12 },
  { year: 114, month: 1,  value: 19 },
  { year: 114, month: 2,  value: 11 },
  // ↓ 表格顯示區間（最近 13 個月）
  { year: 114, month: 3,  value: 16 },
  { year: 114, month: 4,  value: 14 },
  { year: 114, month: 5,  value: 18 },
  { year: 114, month: 6,  value: 22 },
  { year: 114, month: 7,  value: 15 },
  { year: 114, month: 8,  value: 13 },
  { year: 114, month: 9,  value: 17 },
  { year: 114, month: 10, value: 1  }, // ← 異常（下降）
  { year: 114, month: 11, value: 14 },
  { year: 114, month: 12, value: 16 },
  { year: 115, month: 1,  value: null }, // NA 示意
  { year: 115, month: 2,  value: 18 },
  { year: 115, month: 3,  value: 15 },
];

const TABLE_MONTHS = 13;
const SAMPLE_TABLE = SAMPLE_25.slice(-TABLE_MONTHS);

const INDICATOR_TITLE = 'HA06-31 接受安寧共同照護個案數';
const CAMPUS = '新竹院區';
const PEER = 18.5;
const DIRECTION_LABEL = '↑ 越高越好';

function fmtMonth(d: MonthData): string {
  return `${d.year}.${String(d.month).padStart(2, '0')}`;
}

export default function ExportSlideImrMockup() {
  const W = 1280;
  const H = 720;

  // === I-MR Chart 參數 ===
  const validValues = SAMPLE_25.map((d) => d.value).filter((v): v is number => v != null);
  const n = validValues.length;
  const CL = validValues.reduce((a, b) => a + b, 0) / n;

  // Moving Range 只取相鄰兩個都有值的對
  const mrs: number[] = [];
  for (let i = 1; i < SAMPLE_25.length; i++) {
    const a = SAMPLE_25[i - 1].value;
    const b = SAMPLE_25[i].value;
    if (a != null && b != null) mrs.push(Math.abs(b - a));
  }
  const mrBar = mrs.length > 0 ? mrs.reduce((a, b) => a + b, 0) / mrs.length : 0;
  const sigma = mrBar / D2;
  const UCL = CL + 3 * sigma;
  const LCL = Math.max(0, CL - 3 * sigma);
  const UCL2 = CL + 2 * sigma;
  const LCL2 = Math.max(0, CL - 2 * sigma);

  // === 管制圖版面 ===
  const CHART_TOP = 86;
  const CHART_LEFT = 70;
  const CHART_RIGHT = 100;
  const CHART_HEIGHT = 360;
  const chartX = CHART_LEFT;
  const chartY = CHART_TOP;
  const chartW = W - CHART_LEFT - CHART_RIGHT;
  const chartH = CHART_HEIGHT;
  const colW = chartW / SAMPLE_25.length;
  const cx = (i: number) => chartX + (i + 0.5) * colW;

  const dataMax = Math.max(...validValues, UCL, PEER);
  const dataMin = Math.min(...validValues, LCL, 0);
  const yMin = Math.max(0, Math.floor(dataMin));
  const yMax = Math.ceil(dataMax + 2);
  const yScale = (v: number) => chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  const chartPoints = SAMPLE_25.map((d, i) => {
    const v = d.value;
    const isNA = v == null;
    let isAnomaly = false;
    if (v != null) {
      // direction='higher' → value < LCL 不利、value > UCL 卓越
      // 這裡示意只標 unfavorable
      isAnomaly = v < LCL;
    }
    return {
      i,
      d,
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

  const naColumns = SAMPLE_25.map((d, i) => ({ i, isNA: d.value == null })).filter((c) => c.isNA);

  // Y 軸刻度
  const tickStep = yMax > 30 ? 5 : yMax > 15 ? 5 : 3;
  const yTicks: number[] = [];
  for (let t = yMin; t <= yMax; t += tickStep) yTicks.push(t);

  const xTicks = SAMPLE_25.map((d, i) => ({ i, label: fmtMonth(d) }));
  const yearBoundaries: number[] = [];
  for (let i = 1; i < SAMPLE_25.length; i++) {
    if (SAMPLE_25[i].year !== SAMPLE_25[i - 1].year) yearBoundaries.push(i);
  }

  // === 表格 ===（3 列：年 / 月 / 值）
  const TABLE_TOP = CHART_TOP + CHART_HEIGHT + 60;
  const TABLE_LEFT = 70;
  const TABLE_RIGHT = 100;
  const TABLE_W = W - TABLE_LEFT - TABLE_RIGHT;
  const LABEL_COL_W = 100;
  const TABLE_DATA_W = TABLE_W - LABEL_COL_W;
  const TABLE_COL_W = TABLE_DATA_W / TABLE_MONTHS;
  const TABLE_ROW_H = 36;
  const ROWS = 3;
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
        <div className="font-bold text-gray-800 mb-1">匯出投影片示意圖（I-MR） — HA06-31</div>
        <div>I-MR Chart：UCL/LCL 為水平直線（CL ± 3σ̂，σ̂ = MR̄ / 1.128）。表格收斂為 3 列「年 / 月 / 值」，無分子分母。</div>
      </div>

      <div className="bg-white shadow-xl" style={{ width: W, height: H }}>
        <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg">
          <text x={40} y={40} fontSize={22} fontWeight="bold" fill="#1F2937">{INDICATOR_TITLE}</text>
          <text x={40} y={66} fontSize={14} fill="#6B7280">
            {CAMPUS} ｜ I-MR Chart ｜ n = {n} ｜ σ̂ = {sigma.toFixed(2)} ｜ 最近 25 個月
          </text>
          <text x={W - 40} y={40} fontSize={13} fill="#6B7280" textAnchor="end">{DIRECTION_LABEL}</text>
          <line x1={40} y1={76} x2={W - 40} y2={76} stroke="#E5E7EB" strokeWidth={1} />

          <rect x={chartX} y={chartY} width={chartW} height={chartH} fill="#FAFAFA" />

          {/* NA 欄位灰底 */}
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
              <text x={chartX - 8} y={yScale(t) + 4} fontSize={11} fill="#6B7280" textAnchor="end">{t}</text>
            </g>
          ))}
          <text x={chartX - 8} y={chartY - 6} fontSize={11} fill="#9CA3AF" textAnchor="end">件</text>

          {/* 1σ 綠色背景帶 */}
          <rect
            x={chartX}
            y={yScale(CL + sigma)}
            width={chartW}
            height={Math.max(0, yScale(Math.max(yMin, CL - sigma)) - yScale(CL + sigma))}
            fill="#10B981"
            opacity={0.06}
          />

          {/* CL */}
          <line x1={chartX} x2={chartX + chartW} y1={yScale(CL)} y2={yScale(CL)} stroke="#374151" strokeDasharray="5 4" />
          <text x={chartX + chartW + 4} y={yScale(CL) + 4} fontSize={11} fill="#374151">CL {CL.toFixed(2)}</text>

          {/* 同儕 */}
          <line x1={chartX} x2={chartX + chartW} y1={yScale(PEER)} y2={yScale(PEER)} stroke="#2563EB" strokeDasharray="2 3" />
          <text x={chartX + chartW + 4} y={yScale(PEER) + 4} fontSize={11} fill="#2563EB">同儕 {PEER.toFixed(1)}</text>

          {/* 2σ / 3σ 水平直線（I-MR 是固定限） */}
          <line x1={chartX} x2={chartX + chartW} y1={yScale(UCL2)} y2={yScale(UCL2)} stroke="#FB923C" strokeDasharray="3 3" />
          <line x1={chartX} x2={chartX + chartW} y1={yScale(LCL2)} y2={yScale(LCL2)} stroke="#FB923C" strokeDasharray="3 3" />
          <line x1={chartX} x2={chartX + chartW} y1={yScale(UCL)} y2={yScale(UCL)} stroke="#DC2626" strokeWidth={1.5} strokeDasharray="5 3" />
          <line x1={chartX} x2={chartX + chartW} y1={yScale(LCL)} y2={yScale(LCL)} stroke="#DC2626" strokeWidth={1.5} strokeDasharray="5 3" />

          <text x={chartX + chartW + 4} y={yScale(UCL) + 4} fontSize={11} fill="#DC2626">UCL {UCL.toFixed(2)}</text>
          <text x={chartX + chartW + 4} y={yScale(LCL) + 4} fontSize={11} fill="#DC2626">LCL {LCL.toFixed(2)}</text>

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
          {xTicks.map((t) => (
            <g key={t.i}>
              <line x1={cx(t.i)} x2={cx(t.i)} y1={chartY + chartH} y2={chartY + chartH + 4} stroke="#9CA3AF" />
              <text
                x={cx(t.i)}
                y={chartY + chartH + 10}
                fontSize={10}
                fill="#6B7280"
                textAnchor="end"
                transform={`rotate(-45 ${cx(t.i)} ${chartY + chartH + 10})`}
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* === 表格（3 列：年 / 月 / 值） === */}
          <text x={TABLE_LEFT} y={TABLE_TOP - 10} fontSize={13} fontWeight="bold" fill="#374151">近 13 個月數值</text>

          <rect x={TABLE_LEFT} y={TABLE_TOP} width={TABLE_W} height={TABLE_ROW_H * ROWS} fill="none" stroke="#374151" />
          {Array.from({ length: ROWS - 1 }).map((_, r) => (
            <line key={`hr-${r}`} x1={TABLE_LEFT} x2={TABLE_LEFT + TABLE_W} y1={tRowY(r + 1)} y2={tRowY(r + 1)} stroke="#D1D5DB" />
          ))}
          <rect x={TABLE_LEFT} y={TABLE_TOP} width={LABEL_COL_W} height={TABLE_ROW_H * ROWS} fill="#F9FAFB" />
          <line x1={TABLE_LEFT + LABEL_COL_W} x2={TABLE_LEFT + LABEL_COL_W} y1={TABLE_TOP} y2={TABLE_TOP + ROWS * TABLE_ROW_H} stroke="#374151" />

          {['年', '月', '值（件）'].map((label, r) => (
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
            const isAnomaly = d.value != null && d.value < LCL;
            const isNA = d.value == null;
            return (
              <g key={`c-${i}`}>
                <text x={tColX(i)} y={tTextY(1)} fontSize={12} fill="#111827" textAnchor="middle" fontWeight="bold">{d.month}月</text>
                <text
                  x={tColX(i)}
                  y={tTextY(2)}
                  fontSize={13}
                  fill={isAnomaly ? '#DC2626' : isNA ? '#9CA3AF' : '#111827'}
                  fontWeight={isAnomaly ? 'bold' : 'normal'}
                  textAnchor="middle"
                >
                  {isNA ? 'NA' : d.value}
                </text>
              </g>
            );
          })}

          <text x={W - 40} y={H - 20} fontSize={11} fill="#9CA3AF" textAnchor="end">新竹臺大分院 QIP 監測指標系統</text>
        </svg>
      </div>

      <div className="text-xs text-gray-600 max-w-4xl">
        <div className="font-semibold mb-1">I-MR 版本特徵：</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>UCL/LCL 為**水平直線**（不像 P/U 階梯）；CL = X̄ = {CL.toFixed(2)}, σ̂ = MR̄/d2 = {sigma.toFixed(2)}</li>
          <li>表格僅 3 列：年 / 月 / 值（件）— 無分子分母</li>
          <li>方向「越高越好」→ 114.10 = 1（&lt; LCL {LCL.toFixed(2)}）為不利異常（紅）</li>
          <li>1σ 綠色背景帶顯示「典型範圍」</li>
          <li>適用：HA06-31、HA08-01；fallback I-MR（如分母不足的 P/U）也用同版面</li>
        </ul>
      </div>
    </div>
  );
}
