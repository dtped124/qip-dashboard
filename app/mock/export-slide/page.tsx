'use client';

/**
 * 匯出投影片版面示意圖（mockup）
 * - 上方：P Chart 管制圖顯示最近 25 個月，變動管制限隨 n_i 呈階梯狀
 * - 下方：月份數值表顯示最近 13 個月（年/月/分子/分母/比率）
 * - 不硬對齊；兩區塊各自獨立
 */

interface MonthData {
  year: number;
  month: number;
  num: number;
  den: number;
}

// 25 個月示意資料；分母刻意給些變化，展現 P Chart 管制限隨 n_i 變動
const SAMPLE_25: MonthData[] = [
  { year: 113, month: 3,  num: 6,  den: 12 },
  { year: 113, month: 4,  num: 5,  den: 10 },
  { year: 113, month: 5,  num: 8,  den: 14 },
  { year: 113, month: 6,  num: 4,  den: 8  },
  { year: 113, month: 7,  num: 7,  den: 11 },
  { year: 113, month: 8,  num: 9,  den: 13 },
  { year: 113, month: 9,  num: 3,  den: 9  },
  { year: 113, month: 10, num: 10, den: 15 },
  { year: 113, month: 11, num: 6,  den: 10 },
  { year: 113, month: 12, num: 8,  den: 12 },
  { year: 114, month: 1,  num: 5,  den: 11 },
  { year: 114, month: 2,  num: 7,  den: 13 },
  // ↓ 以下 13 筆 = 表格顯示區間
  { year: 114, month: 3,  num: 9,  den: 12 },
  { year: 114, month: 4,  num: 4,  den: 10 },
  { year: 114, month: 5,  num: 0,  den: 0  }, // NA
  { year: 114, month: 6,  num: 0,  den: 0  }, // NA
  { year: 114, month: 7,  num: 8,  den: 11 },
  { year: 114, month: 8,  num: 10, den: 13 },
  { year: 114, month: 9,  num: 2,  den: 7  },
  { year: 114, month: 10, num: 5,  den: 9  },
  { year: 114, month: 11, num: 11, den: 14 },
  { year: 114, month: 12, num: 6,  den: 8  },
  { year: 115, month: 1,  num: 0,  den: 0  }, // NA
  { year: 115, month: 2,  num: 3,  den: 9  },
  { year: 115, month: 3,  num: 7,  den: 10 },
];

const TABLE_MONTHS = 13;
const SAMPLE_TABLE = SAMPLE_25.slice(-TABLE_MONTHS);

const INDICATOR_TITLE = 'HA01-09 抵達急診 60 分鐘（含）內接受 IV-tPA 治療';
const CAMPUS = '新竹院區';
const PEER = 68.5;

function ratioPct(d: MonthData): number | null {
  return d.den > 0 ? (d.num / d.den) * 100 : null;
}

function fmtMonth(d: MonthData): string {
  return `${d.year}.${String(d.month).padStart(2, '0')}`;
}

export default function ExportSlideMockup() {
  // 16:9 投影片
  const W = 1280;
  const H = 720;

  // === 計算 P Chart 參數（pooled p̄） ===
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

  // Y 軸：涵蓋所有 UCL 與 0
  const maxUcl = Math.max(...limits.map((l) => l.ucl ?? 0));
  const yMin = 0;
  const yMax = Math.ceil((maxUcl + 10) / 10) * 10; // 向上取整到 10 的倍數
  const yScale = (v: number) => chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  // 折線資料點
  const chartPoints = SAMPLE_25.map((d, i) => ({
    i,
    d,
    x: cx(i),
    y: ratioPct(d) === null ? null : yScale(ratioPct(d) as number),
  }));

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

  // 階梯狀變動管制限：每月在整個欄寬內橫向，相鄰月跳階
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
  const tickStep = yMax <= 100 ? 20 : yMax <= 150 ? 30 : 40;
  const yTicks: number[] = [];
  for (let t = 0; t <= yMax; t += tickStep) yTicks.push(t);

  // X 軸刻度：每 6 個月
  const xTicks = SAMPLE_25
    .map((d, i) => ({ i, label: fmtMonth(d) }))
    .filter((t) => t.i % 6 === 0 || t.i === SAMPLE_25.length - 1);

  // === 表格版面 ===
  const TABLE_TOP = CHART_TOP + CHART_HEIGHT + 50;
  const TABLE_LEFT = 70;
  const TABLE_RIGHT = 100;
  const TABLE_W = W - TABLE_LEFT - TABLE_RIGHT;
  const LABEL_COL_W = 100;
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
        <div className="font-bold text-gray-800 mb-1">匯出投影片版面示意圖 v3</div>
        <div>P Chart 變動管制限：UCL/LCL 隨每月分母 n_i 呈階梯狀（分母越小、管制限越寬）。</div>
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
                {t}
              </text>
            </g>
          ))}

          {/* CL（中心線） */}
          <line
            x1={chartX}
            x2={chartX + chartW}
            y1={yScale(CL)}
            y2={yScale(CL)}
            stroke="#374151"
            strokeDasharray="5 4"
          />
          <text x={chartX + chartW + 4} y={yScale(CL) + 4} fontSize={11} fill="#374151">
            CL {CL.toFixed(1)}
          </text>

          {/* 同儕值 */}
          <line
            x1={chartX}
            x2={chartX + chartW}
            y1={yScale(PEER)}
            y2={yScale(PEER)}
            stroke="#2563EB"
            strokeDasharray="2 3"
          />
          <text x={chartX + chartW + 4} y={yScale(PEER) + 4} fontSize={11} fill="#2563EB">
            同儕 {PEER.toFixed(1)}
          </text>

          {/* 階梯狀 2σ（淡橘） */}
          <path d={ucl2Path} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />
          <path d={lcl2Path} stroke="#FB923C" strokeWidth={1} fill="none" strokeDasharray="3 3" />

          {/* 階梯狀 3σ（紅） */}
          <path d={uclPath} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />
          <path d={lclPath} stroke="#DC2626" strokeWidth={1.5} fill="none" strokeDasharray="5 3" />

          {/* 資料折線 */}
          {dataPath.length > 0 && <path d={dataPath.join(' ')} stroke="#111827" strokeWidth={2} fill="none" />}

          {/* 資料點 */}
          {chartPoints.map((p) => {
            if (p.y == null) return null;
            return <circle key={p.i} cx={p.x} cy={p.y} r={3.5} fill="#16A34A" stroke="#fff" strokeWidth={1} />;
          })}

          {/* UCL/LCL 文字標註（取最右邊有效月份的值） */}
          {(() => {
            const lastValid = [...limits].reverse().find((l) => l.ucl != null);
            if (!lastValid || lastValid.ucl == null || lastValid.lcl == null) return null;
            return (
              <>
                <text x={chartX + chartW + 4} y={yScale(lastValid.ucl) + 4} fontSize={11} fill="#DC2626">
                  UCL
                </text>
                <text x={chartX + chartW + 4} y={yScale(lastValid.lcl) + 4} fontSize={11} fill="#DC2626">
                  LCL
                </text>
              </>
            );
          })()}

          {/* X 軸 */}
          <line x1={chartX} x2={chartX + chartW} y1={chartY + chartH} y2={chartY + chartH} stroke="#9CA3AF" />
          {xTicks.map((t) => (
            <g key={t.i}>
              <line x1={cx(t.i)} x2={cx(t.i)} y1={chartY + chartH} y2={chartY + chartH + 4} stroke="#9CA3AF" />
              <text x={cx(t.i)} y={chartY + chartH + 18} fontSize={10} fill="#6B7280" textAnchor="middle">
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

          {['年', '月', '分子', '分母', '% (D2N<60min)'].map((label, r) => (
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
                <text x={tColX(i)} y={tTextY(4)} fontSize={12} fill={r == null ? '#9CA3AF' : '#111827'} textAnchor="middle">
                  {r == null ? 'NA' : r === Math.floor(r) ? `${r.toFixed(0)}` : `${r.toFixed(1)}`}
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
        <div className="font-semibold mb-1">修正重點：</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>UCL/LCL 改為階梯狀變動管制限（隨每月 n_i 變動），這才是 P Chart 該有的樣子</li>
          <li>2σ 淡橘、3σ 紅色；CL 以 pooled p̄ 計算</li>
          <li>分母 = 0（NA）時該月無管制限，折線斷開</li>
          <li>Y 軸依 max UCL 自動放大，確保所有管制限完整顯示</li>
        </ul>
      </div>
    </div>
  );
}
