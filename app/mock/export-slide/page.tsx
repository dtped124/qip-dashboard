'use client';

/**
 * 匯出投影片版面示意圖（mockup） — HA01-01 住院死亡率(含病危自動出院)
 * - P Chart，分子=死亡人數，分母=出院總人次，方向=lower
 * - 上方：管制圖顯示最近 25 個月，變動管制限隨 n_i 呈階梯狀
 * - 下方：月份數值表顯示最近 13 個月
 */

interface MonthData {
  year: number;
  month: number;
  num: number; // 死亡人數
  den: number; // 出院總人次
}

// 25 個月示意資料（分母 ~900-1200，死亡率約 1.5-2.5%，114.07 設為偏高以展示 UCL 觸發）
const SAMPLE_25: MonthData[] = [
  { year: 113, month: 3,  num: 18, den: 1050 },
  { year: 113, month: 4,  num: 22, den: 980  },
  { year: 113, month: 5,  num: 17, den: 1120 },
  { year: 113, month: 6,  num: 25, den: 1010 },
  { year: 113, month: 7,  num: 20, den: 960  },
  { year: 113, month: 8,  num: 16, den: 1085 },
  { year: 113, month: 9,  num: 24, den: 1005 },
  { year: 113, month: 10, num: 21, den: 1140 },
  { year: 113, month: 11, num: 19, den: 1025 },
  { year: 113, month: 12, num: 26, den: 1090 },
  { year: 114, month: 1,  num: 28, den: 1160 },
  { year: 114, month: 2,  num: 15, den: 890  },
  // ↓ 以下 13 筆 = 表格顯示區間
  { year: 114, month: 3,  num: 23, den: 1105 },
  { year: 114, month: 4,  num: 19, den: 1050 },
  { year: 114, month: 5,  num: 17, den: 1030 },
  { year: 114, month: 6,  num: 22, den: 985  },
  { year: 114, month: 7,  num: 38, den: 1070 }, // ← 觸發 UCL（R1）
  { year: 114, month: 8,  num: 20, den: 1100 },
  { year: 114, month: 9,  num: 18, den: 1015 },
  { year: 114, month: 10, num: 24, den: 1130 },
  { year: 114, month: 11, num: 16, den: 980  },
  { year: 114, month: 12, num: 21, den: 1055 },
  { year: 115, month: 1,  num: 0,  den: 0    }, // NA 示意（資料未到）
  { year: 115, month: 2,  num: 14, den: 920  },
  { year: 115, month: 3,  num: 22, den: 1060 },
];

const TABLE_MONTHS = 13;
const SAMPLE_TABLE = SAMPLE_25.slice(-TABLE_MONTHS);

const INDICATOR_TITLE = 'HA01-01 住院死亡率（含病危自動出院）';
const CAMPUS = '新竹院區';
const PEER = 1.75; // 同儕值（示意）
const DIRECTION_LABEL = '↓ 越低越好';

function ratioPct(d: MonthData): number | null {
  return d.den > 0 ? (d.num / d.den) * 100 : null;
}

function fmtMonth(d: MonthData): string {
  return `${d.year}.${String(d.month).padStart(2, '0')}`;
}

export default function ExportSlideMockup() {
  const W = 1280;
  const H = 720;

  // === P Chart 參數 ===
  const valid = SAMPLE_25.filter((d) => d.den > 0);
  const totalNum = valid.reduce((s, d) => s + d.num, 0);
  const totalDen = valid.reduce((s, d) => s + d.den, 0);
  const pBar = totalNum / totalDen;
  const CL = pBar * 100;

  interface Limit { d: MonthData; ucl: number | null; lcl: number | null; ucl2: number | null; lcl2: number | null; }
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

  const allVals = [
    ...valid.map((d) => ratioPct(d) as number),
    ...limits.flatMap((l) => [l.ucl, l.lcl].filter((v): v is number => v != null)),
    PEER,
  ];
  const dataMax = Math.max(...allVals);
  const yMin = 0;
  const yMax = Math.ceil((dataMax + 0.5) * 2) / 2; // 向上取整到 0.5
  const yScale = (v: number) => chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  // 點與折線 — NA 月份（den=0）在管制圖上呈現為 0，折線連續不斷
  const chartPoints = SAMPLE_25.map((d, i) => {
    const r = ratioPct(d);
    const lim = limits[i];
    const isAnomaly = r != null && lim.ucl != null && r > lim.ucl;
    const isNA = r === null;
    const displayValue = isNA ? 0 : r; // NA → 0
    return {
      i,
      d,
      x: cx(i),
      y: yScale(displayValue as number),
      isAnomaly,
      isNA,
    };
  });

  const dataPath: string[] = chartPoints.map((p, idx) =>
    `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  );

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

  // X 軸刻度：每個月都標示
  const xTicks = SAMPLE_25.map((d, i) => ({ i, label: fmtMonth(d), d }));

  // 年度交界位置（供加強分隔線）
  const yearBoundaries: number[] = [];
  for (let i = 1; i < SAMPLE_25.length; i++) {
    if (SAMPLE_25[i].year !== SAMPLE_25[i - 1].year) yearBoundaries.push(i);
  }

  // === 表格 === （+60 預留旋轉 X 軸標籤空間）
  const TABLE_TOP = CHART_TOP + CHART_HEIGHT + 60;
  const TABLE_LEFT = 70;
  const TABLE_RIGHT = 100;
  const TABLE_W = W - TABLE_LEFT - TABLE_RIGHT;
  const LABEL_COL_W = 120;
  const TABLE_DATA_W = TABLE_W - LABEL_COL_W;
  const TABLE_COL_W = TABLE_DATA_W / TABLE_MONTHS;
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
        <div className="font-bold text-gray-800 mb-1">匯出投影片示意圖 — HA01-01</div>
        <div>P Chart，分母為出院總人次（~1000/月），管制限階梯相對平緩。114.07 死亡人數偏高觸發 UCL（R1 警示）。</div>
      </div>

      <div className="bg-white shadow-xl" style={{ width: W, height: H }}>
        <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg">
          {/* 標題 */}
          <text x={40} y={40} fontSize={22} fontWeight="bold" fill="#1F2937">
            {INDICATOR_TITLE}
          </text>
          <text x={40} y={66} fontSize={14} fill="#6B7280">
            {CAMPUS} ｜ P Chart ｜ n = {valid.length} ｜ 變動管制限 ｜ 最近 25 個月
          </text>
          <text x={W - 40} y={40} fontSize={13} fill="#6B7280" textAnchor="end">
            {DIRECTION_LABEL}
          </text>
          <line x1={40} y1={76} x2={W - 40} y2={76} stroke="#E5E7EB" strokeWidth={1} />

          {/* === 管制圖 === */}
          <rect x={chartX} y={chartY} width={chartW} height={chartH} fill="#FAFAFA" />

          {/* Y 軸格線 + 刻度 */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={chartX}
                x2={chartX + chartW}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="#E5E7EB"
                strokeDasharray="3 3"
              />
              <text x={chartX - 8} y={yScale(t) + 4} fontSize={11} fill="#6B7280" textAnchor="end">
                {t.toFixed(1)}
              </text>
            </g>
          ))}

          {/* Y 軸單位 */}
          <text x={chartX - 8} y={chartY - 6} fontSize={11} fill="#9CA3AF" textAnchor="end">
            %
          </text>

          {/* CL */}
          <line
            x1={chartX}
            x2={chartX + chartW}
            y1={yScale(CL)}
            y2={yScale(CL)}
            stroke="#374151"
            strokeDasharray="5 4"
          />
          <text x={chartX + chartW + 4} y={yScale(CL) + 4} fontSize={11} fill="#374151">
            CL {CL.toFixed(2)}
          </text>

          {/* 同儕 */}
          <line
            x1={chartX}
            x2={chartX + chartW}
            y1={yScale(PEER)}
            y2={yScale(PEER)}
            stroke="#2563EB"
            strokeDasharray="2 3"
          />
          <text x={chartX + chartW + 4} y={yScale(PEER) + 4} fontSize={11} fill="#2563EB">
            同儕 {PEER.toFixed(2)}
          </text>

          {/* 階梯狀 2σ / 3σ */}
          <path d={ucl2Path} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={lcl2Path} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={uclPath} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />
          <path d={lclPath} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />

          {/* 資料折線 */}
          {dataPath.length > 0 && (
            <path d={dataPath.join(' ')} stroke="#111827" strokeWidth={2} fill="none" />
          )}

          {/* 資料點（異常點紅色加大；NA 月份用空心灰點以示區別） */}
          {chartPoints.map((p) => {
            if (p.isAnomaly) {
              return (
                <g key={p.i}>
                  <circle cx={p.x} cy={p.y} r={8} fill="#DC2626" opacity={0.25} />
                  <circle cx={p.x} cy={p.y} r={5} fill="#DC2626" stroke="#fff" strokeWidth={1.5} />
                </g>
              );
            }
            if (p.isNA) {
              return (
                <circle key={p.i} cx={p.x} cy={p.y} r={3.5} fill="#fff" stroke="#9CA3AF" strokeWidth={1.5} />
              );
            }
            return <circle key={p.i} cx={p.x} cy={p.y} r={3.5} fill="#16A34A" stroke="#fff" strokeWidth={1} />;
          })}

          {/* UCL/LCL 右側標註 */}
          {(() => {
            const lastValid = [...limits].reverse().find((l) => l.ucl != null);
            if (!lastValid || lastValid.ucl == null || lastValid.lcl == null) return null;
            return (
              <>
                <text x={chartX + chartW + 4} y={yScale(lastValid.ucl) + 4} fontSize={11} fill="#DC2626">
                  UCL {lastValid.ucl.toFixed(2)}
                </text>
                <text x={chartX + chartW + 4} y={yScale(lastValid.lcl) + 4} fontSize={11} fill="#DC2626">
                  LCL {lastValid.lcl.toFixed(2)}
                </text>
              </>
            );
          })()}

          {/* X 軸 */}
          <line x1={chartX} x2={chartX + chartW} y1={chartY + chartH} y2={chartY + chartH} stroke="#9CA3AF" />
          {/* 年度交界加強分隔線（貫穿 plot 區） */}
          {yearBoundaries.map((i) => (
            <line
              key={`yb-${i}`}
              x1={chartX + i * colW}
              x2={chartX + i * colW}
              y1={chartY}
              y2={chartY + chartH}
              stroke="#9CA3AF"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
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

          {/* === 下方表格 === */}
          <text x={TABLE_LEFT} y={TABLE_TOP - 10} fontSize={13} fontWeight="bold" fill="#374151">
            近 13 個月數值
          </text>

          <rect x={TABLE_LEFT} y={TABLE_TOP} width={TABLE_W} height={TABLE_ROW_H * ROWS} fill="none" stroke="#374151" />

          {Array.from({ length: ROWS - 1 }).map((_, r) => (
            <line
              key={`hr-${r}`}
              x1={TABLE_LEFT}
              x2={TABLE_LEFT + TABLE_W}
              y1={tRowY(r + 1)}
              y2={tRowY(r + 1)}
              stroke="#D1D5DB"
            />
          ))}

          <rect x={TABLE_LEFT} y={TABLE_TOP} width={LABEL_COL_W} height={TABLE_ROW_H * ROWS} fill="#F9FAFB" />
          <line
            x1={TABLE_LEFT + LABEL_COL_W}
            x2={TABLE_LEFT + LABEL_COL_W}
            y1={TABLE_TOP}
            y2={TABLE_TOP + ROWS * TABLE_ROW_H}
            stroke="#374151"
          />

          {['年', '月', '分子（死亡）', '分母（出院）', '% 死亡率'].map((label, r) => (
            <text
              key={label}
              x={TABLE_LEFT + LABEL_COL_W - 8}
              y={tTextY(r)}
              fontSize={12}
              fill="#374151"
              textAnchor="end"
              fontWeight={r <= 1 ? 'bold' : 'normal'}
            >
              {label}
            </text>
          ))}

          {yearGroups.map((g) => {
            const x1 = TABLE_LEFT + LABEL_COL_W + g.startIdx * TABLE_COL_W;
            const x2 = TABLE_LEFT + LABEL_COL_W + (g.endIdx + 1) * TABLE_COL_W;
            return (
              <g key={`y-${g.year}`}>
                <rect x={x1} y={tRowY(0)} width={x2 - x1} height={TABLE_ROW_H} fill="#EFF6FF" />
                <text x={(x1 + x2) / 2} y={tTextY(0)} fontSize={13} fontWeight="bold" fill="#1E3A8A" textAnchor="middle">
                  {g.year} 年
                </text>
                {g.startIdx > 0 && (
                  <line x1={x1} x2={x1} y1={TABLE_TOP} y2={TABLE_TOP + ROWS * TABLE_ROW_H} stroke="#374151" strokeWidth={1.5} />
                )}
              </g>
            );
          })}

          {SAMPLE_TABLE.map((d, i) => {
            const r = ratioPct(d);
            // 找到對應在 25 點中的 index 判斷是否為異常
            const idx25 = SAMPLE_25.findIndex((x) => x.year === d.year && x.month === d.month);
            const lim = limits[idx25];
            const isAnomaly = r != null && lim.ucl != null && r > lim.ucl;
            return (
              <g key={`c-${i}`}>
                <text x={tColX(i)} y={tTextY(1)} fontSize={12} fill="#111827" textAnchor="middle" fontWeight="bold">
                  {d.month}月
                </text>
                <text x={tColX(i)} y={tTextY(2)} fontSize={12} fill="#111827" textAnchor="middle">
                  {d.num}
                </text>
                <text x={tColX(i)} y={tTextY(3)} fontSize={12} fill="#111827" textAnchor="middle">
                  {d.den}
                </text>
                <text
                  x={tColX(i)}
                  y={tTextY(4)}
                  fontSize={12}
                  fill={isAnomaly ? '#DC2626' : r == null ? '#9CA3AF' : '#111827'}
                  fontWeight={isAnomaly ? 'bold' : 'normal'}
                  textAnchor="middle"
                >
                  {r == null ? 'NA' : r.toFixed(2)}
                </text>
              </g>
            );
          })}

          <text x={W - 40} y={H - 20} fontSize={11} fill="#9CA3AF" textAnchor="end">
            新竹臺大分院 QIP 監測指標系統
          </text>
        </svg>
      </div>

      <div className="text-xs text-gray-600 max-w-4xl">
        <div className="font-semibold mb-1">HA01-01 示意版重點：</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>分母大（~1000/月） → 3σ 寬度約 ±{(3 * Math.sqrt(pBar * (1 - pBar) / 1000) * 100).toFixed(2)}%，管制限階梯很平緩</li>
          <li>CL p̄ = {CL.toFixed(2)}%（pooled：總死亡 {totalNum} ÷ 總出院 {totalDen}）</li>
          <li>114.07 死亡率 {((38 / 1070) * 100).toFixed(2)}% 超過 UCL → Rule 1 alert（紅點標示）</li>
          <li>表格 % 死亡率欄同步標紅異常月份</li>
          <li>方向「越低越好」→ 圖右上角標示 ↓</li>
        </ul>
      </div>
    </div>
  );
}
