'use client';

/**
 * 匯出投影片版面示意圖（mockup）
 * - 上方：管制圖顯示最近 25 個月（與前端 ControlChart 一致）
 * - 下方：月份數值表顯示最近 13 個月（年/月/分子/分母/比率）
 * - 不硬對齊；兩區塊各自獨立
 *
 * 資料取自 HA01-09 抵達急診60分鐘內接受 IV-tPA 的示意（為了視覺，往前補了 12 個月模擬值）
 */

interface MonthData {
  year: number;
  month: number;
  num: number;
  den: number;
}

// 最近 25 個月；後 13 筆對應照片中的表格資料
const SAMPLE_25: MonthData[] = [
  { year: 113, month: 3,  num: 2, den: 3 },
  { year: 113, month: 4,  num: 1, den: 2 },
  { year: 113, month: 5,  num: 3, den: 4 },
  { year: 113, month: 6,  num: 2, den: 4 },
  { year: 113, month: 7,  num: 1, den: 3 },
  { year: 113, month: 8,  num: 2, den: 2 },
  { year: 113, month: 9,  num: 0, den: 1 },
  { year: 113, month: 10, num: 4, den: 5 },
  { year: 113, month: 11, num: 2, den: 3 },
  { year: 113, month: 12, num: 3, den: 5 },
  { year: 114, month: 1,  num: 1, den: 2 },
  { year: 114, month: 2,  num: 2, den: 3 },
  // ↓ 以下 13 筆 = 表格顯示區間
  { year: 114, month: 3,  num: 5, den: 5 },
  { year: 114, month: 4,  num: 2, den: 4 },
  { year: 114, month: 5,  num: 0, den: 0 },
  { year: 114, month: 6,  num: 0, den: 0 },
  { year: 114, month: 7,  num: 2, den: 3 },
  { year: 114, month: 8,  num: 4, den: 4 },
  { year: 114, month: 9,  num: 0, den: 1 },
  { year: 114, month: 10, num: 1, den: 2 },
  { year: 114, month: 11, num: 3, den: 3 },
  { year: 114, month: 12, num: 1, den: 1 },
  { year: 115, month: 1,  num: 0, den: 0 },
  { year: 115, month: 2,  num: 0, den: 1 },
  { year: 115, month: 3,  num: 1, den: 2 },
];

const TABLE_MONTHS = 13;
const SAMPLE_TABLE = SAMPLE_25.slice(-TABLE_MONTHS);

const INDICATOR_TITLE = 'HA01-09 抵達急診 60 分鐘（含）內接受 IV-tPA 治療';
const CAMPUS = '新竹院區';
const CL = 56.3;
const UCL = 100;
const LCL = 12.6;
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

  // === 上方：管制圖 ===
  const CHART_TOP = 86;
  const CHART_LEFT = 70;
  const CHART_RIGHT = 90;
  const CHART_HEIGHT = 360;
  const chartX = CHART_LEFT;
  const chartY = CHART_TOP;
  const chartW = W - CHART_LEFT - CHART_RIGHT;
  const chartH = CHART_HEIGHT;
  const colW = chartW / SAMPLE_25.length;
  const cx = (i: number) => chartX + (i + 0.5) * colW;

  const yMin = 0;
  const yMax = 120;
  const yScale = (v: number) => chartY + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  const chartPoints = SAMPLE_25.map((d, i) => ({
    i,
    d,
    x: cx(i),
    y: ratioPct(d) === null ? null : yScale(ratioPct(d) as number),
  }));

  const pathSegs: string[] = [];
  let started = false;
  chartPoints.forEach((p) => {
    if (p.y == null) {
      started = false;
    } else if (!started) {
      pathSegs.push(`M ${p.x} ${p.y}`);
      started = true;
    } else {
      pathSegs.push(`L ${p.x} ${p.y}`);
    }
  });
  const pathD = pathSegs.join(' ');

  const yTicks = [0, 30, 60, 90, 120];

  // x 軸刻度（每 6 個月顯示一次）
  const xTicks = SAMPLE_25
    .map((d, i) => ({ i, label: fmtMonth(d) }))
    .filter((t) => t.i % 6 === 0 || t.i === SAMPLE_25.length - 1);

  // === 下方：表格 ===
  const TABLE_TOP = CHART_TOP + CHART_HEIGHT + 50;
  const TABLE_LEFT = 70;
  const TABLE_RIGHT = 90;
  const TABLE_W = W - TABLE_LEFT - TABLE_RIGHT;
  const LABEL_COL_W = 100;  // 左側「分子/分母/比率」標籤欄
  const TABLE_DATA_W = TABLE_W - LABEL_COL_W;
  const TABLE_COL_W = TABLE_DATA_W / TABLE_MONTHS;
  const TABLE_ROW_H = 32;
  const ROWS = 5; // 年, 月, 分子, 分母, 比率
  const tRowY = (r: number) => TABLE_TOP + r * TABLE_ROW_H;
  const tTextY = (r: number) => tRowY(r) + TABLE_ROW_H / 2 + 5;
  const tColX = (i: number) => TABLE_LEFT + LABEL_COL_W + (i + 0.5) * TABLE_COL_W;

  // 年分組
  const yearGroups: { year: number; startIdx: number; endIdx: number }[] = [];
  SAMPLE_TABLE.forEach((d, i) => {
    const last = yearGroups[yearGroups.length - 1];
    if (last && last.year === d.year) last.endIdx = i;
    else yearGroups.push({ year: d.year, startIdx: i, endIdx: i });
  });

  return (
    <div className="min-h-screen bg-slate-200 p-8 flex flex-col items-center gap-4">
      <div className="text-sm text-gray-600 max-w-4xl">
        <div className="font-bold text-gray-800 mb-1">匯出投影片版面示意圖 v2</div>
        <div>管制圖 25 點（與前端一致）／表格 13 點（最近 13 個月）／不硬對齊，兩區獨立。</div>
      </div>

      <div className="bg-white shadow-xl" style={{ width: W, height: H }}>
        <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg">
          {/* 標題 */}
          <text x={40} y={40} fontSize={22} fontWeight="bold" fill="#1F2937">
            {INDICATOR_TITLE}
          </text>
          <text x={40} y={66} fontSize={14} fill="#6B7280">
            {CAMPUS} ｜ P Chart ｜ 最近 25 個月
          </text>
          <line x1={40} y1={76} x2={W - 40} y2={76} stroke="#E5E7EB" strokeWidth={1} />

          {/* === 管制圖 === */}
          <rect x={chartX} y={chartY} width={chartW} height={chartH} fill="#FAFAFA" />

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

          <line x1={chartX} x2={chartX + chartW} y1={yScale(CL)} y2={yScale(CL)} stroke="#6B7280" strokeDasharray="4 4" />
          <text x={chartX + chartW + 4} y={yScale(CL) + 4} fontSize={11} fill="#6B7280">CL {CL.toFixed(1)}</text>

          <line x1={chartX} x2={chartX + chartW} y1={yScale(UCL)} y2={yScale(UCL)} stroke="#DC2626" strokeDasharray="4 4" />
          <text x={chartX + chartW + 4} y={yScale(UCL) + 4} fontSize={11} fill="#DC2626">UCL {UCL.toFixed(0)}</text>

          <line x1={chartX} x2={chartX + chartW} y1={yScale(LCL)} y2={yScale(LCL)} stroke="#DC2626" strokeDasharray="4 4" />
          <text x={chartX + chartW + 4} y={yScale(LCL) + 4} fontSize={11} fill="#DC2626">LCL {LCL.toFixed(1)}</text>

          <line x1={chartX} x2={chartX + chartW} y1={yScale(PEER)} y2={yScale(PEER)} stroke="#2563EB" strokeDasharray="2 2" />
          <text x={chartX + chartW + 4} y={yScale(PEER) + 4} fontSize={11} fill="#2563EB">同儕 {PEER.toFixed(1)}</text>

          {pathD && <path d={pathD} stroke="#111827" strokeWidth={2} fill="none" />}

          {chartPoints.map((p) => {
            if (p.y == null) return null;
            return <circle key={p.i} cx={p.x} cy={p.y} r={3.5} fill="#16A34A" stroke="#fff" strokeWidth={1} />;
          })}

          {/* X 軸刻度 */}
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

          {/* 表格外框 */}
          <rect x={TABLE_LEFT} y={TABLE_TOP} width={TABLE_W} height={TABLE_ROW_H * ROWS} fill="none" stroke="#374151" />

          {/* 橫線 */}
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

          {/* 左側標籤欄分隔線 */}
          <line x1={TABLE_LEFT + LABEL_COL_W} x2={TABLE_LEFT + LABEL_COL_W} y1={TABLE_TOP} y2={TABLE_TOP + ROWS * TABLE_ROW_H} stroke="#374151" />

          {/* 左側標籤背景 */}
          <rect x={TABLE_LEFT} y={TABLE_TOP} width={LABEL_COL_W} height={TABLE_ROW_H * ROWS} fill="#F9FAFB" />

          {/* 左側標籤文字 */}
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

          {/* 年標頭（合併儲存格） */}
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

          {/* 每月資料：月 / 分子 / 分母 / 比率 */}
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

          {/* 頁碼 */}
          <text x={W - 40} y={H - 20} fontSize={11} fill="#9CA3AF" textAnchor="end">
            新竹臺大分院 QIP 監測指標系統
          </text>
        </svg>
      </div>

      <div className="text-xs text-gray-600 max-w-4xl">
        <div className="font-semibold mb-1">下一步：pptx 匯出技術方案建議</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li><b>做法 A（推薦）</b>：前端 <code>pptxgenjs</code> 直接用「線 / 文字 / 表格」原生元件組裝投影片，匯出後可在 PowerPoint 中編輯。</li>
          <li><b>做法 B</b>：把這個 SVG 轉 PNG 塞進 pptx（<code>html-to-image</code> + <code>pptxgenjs</code>），快速但圖片無法再編輯。</li>
          <li><b>做法 C</b>：後端 Django 用 <code>python-pptx</code> 產生；優點是與匯出「DB dump」同一個按鈕，缺點是版型改動要動後端。</li>
          <li>I-MR 指標（HA06-31、HA08-01）沒有分子/分母 → 表格列收斂為「年 / 月 / 值」三列，另做一版 template。</li>
        </ul>
        <div className="mt-2">看完告訴我選哪個方案、以及版面要微調什麼。</div>
      </div>
    </div>
  );
}
