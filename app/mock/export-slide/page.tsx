'use client';

/**
 * 匯出投影片版面示意圖（mockup）
 * 目的：確認管制圖 + 月份對齊表格的視覺設計，尚未接資料也未做 pptx 匯出
 * 資料取自 HA01-09 抵達急診60分鐘內接受 IV-tPA 的示意
 */

interface MonthData {
  year: number;
  month: number;
  num: number;
  den: number;
}

const SAMPLE: MonthData[] = [
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

const INDICATOR_TITLE = 'HA01-09 抵達急診 60 分鐘（含）內接受 IV-tPA 治療';
const CAMPUS = '新竹院區';
const CL = 56.3;
const UCL = 100;
const LCL = 12.6;
const PEER = 68.5;

function ratioPct(d: MonthData): number | null {
  return d.den > 0 ? (d.num / d.den) * 100 : null;
}

export default function ExportSlideMockup() {
  // 投影片 16:9
  const W = 1280;
  const H = 720;

  // 版面邊距
  const PAD_TOP = 86;      // 標題列
  const PAD_LEFT = 110;    // 左側列標籤（年/月/分子/分母/%）
  const PAD_RIGHT = 110;   // 右側 CL/UCL 標註空間
  const TABLE_ROW_H = 28;
  const TABLE_ROWS = 5;    // 年, 月, 分子, 分母, 比率
  const TABLE_H = TABLE_ROW_H * TABLE_ROWS;
  const PAD_BOTTOM = TABLE_H + 28; // 留給表格與下方頁碼

  const plotX = PAD_LEFT;
  const plotY = PAD_TOP;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const colW = plotW / SAMPLE.length;
  const cx = (i: number) => plotX + (i + 0.5) * colW;

  // Y 軸尺度 0~120
  const yMin = 0;
  const yMax = 120;
  const yScale = (v: number) => plotY + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // 折線點
  const points = SAMPLE.map((d, i) => ({
    i,
    x: cx(i),
    y: ratioPct(d) === null ? null : yScale(ratioPct(d) as number),
    r: ratioPct(d),
  }));

  // 折線路徑（跳過 NA）
  const pathSegs: string[] = [];
  let started = false;
  points.forEach((p) => {
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

  // Y 軸刻度
  const yTicks = [0, 30, 60, 90, 120];

  // 年分組（合併相鄰同年的欄位）
  const yearGroups: { year: number; startIdx: number; endIdx: number }[] = [];
  SAMPLE.forEach((d, i) => {
    const last = yearGroups[yearGroups.length - 1];
    if (last && last.year === d.year) last.endIdx = i;
    else yearGroups.push({ year: d.year, startIdx: i, endIdx: i });
  });

  // 表格起始 Y（plot 底下）
  const tableTop = plotY + plotH;
  const rowY = (r: number) => tableTop + r * TABLE_ROW_H + TABLE_ROW_H / 2 + 5; // baseline 微調

  return (
    <div className="min-h-screen bg-slate-200 p-8 flex flex-col items-center gap-4">
      <div className="text-sm text-gray-600 max-w-4xl">
        <div className="font-bold text-gray-800 mb-1">匯出投影片版面示意圖</div>
        <div>單張投影片 16:9（1280×720）— 管制圖與月份表格對齊，欄寬等分；表格列：年 / 月 / 分子 / 分母 / 比率。</div>
        <div className="text-xs text-gray-500 mt-1">以下為示意，實際資料、配色、字型可再調整。</div>
      </div>

      <div className="bg-white shadow-xl" style={{ width: W, height: H }}>
        <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg">
          {/* 標題列 */}
          <text x={40} y={40} fontSize={22} fontWeight="bold" fill="#1F2937">
            {INDICATOR_TITLE}
          </text>
          <text x={40} y={66} fontSize={14} fill="#6B7280">
            {CAMPUS} ｜ P Chart ｜ 114.03 – 115.03（13 個月）
          </text>
          <line x1={40} y1={76} x2={W - 40} y2={76} stroke="#E5E7EB" strokeWidth={1} />

          {/* 圖表背景 */}
          <rect x={plotX} y={plotY} width={plotW} height={plotH} fill="#FAFAFA" />

          {/* Y 軸刻度 */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={plotX}
                x2={plotX + plotW}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="#E5E7EB"
                strokeDasharray="3 3"
              />
              <text x={plotX - 8} y={yScale(t) + 4} fontSize={11} fill="#6B7280" textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {/* CL / UCL / LCL 同儕線 */}
          <line x1={plotX} x2={plotX + plotW} y1={yScale(CL)} y2={yScale(CL)} stroke="#6B7280" strokeDasharray="4 4" />
          <text x={plotX + plotW + 4} y={yScale(CL) + 4} fontSize={11} fill="#6B7280">CL {CL.toFixed(1)}</text>

          <line x1={plotX} x2={plotX + plotW} y1={yScale(UCL)} y2={yScale(UCL)} stroke="#DC2626" strokeDasharray="4 4" />
          <text x={plotX + plotW + 4} y={yScale(UCL) + 4} fontSize={11} fill="#DC2626">UCL {UCL.toFixed(0)}</text>

          <line x1={plotX} x2={plotX + plotW} y1={yScale(LCL)} y2={yScale(LCL)} stroke="#DC2626" strokeDasharray="4 4" />
          <text x={plotX + plotW + 4} y={yScale(LCL) + 4} fontSize={11} fill="#DC2626">LCL {LCL.toFixed(1)}</text>

          <line x1={plotX} x2={plotX + plotW} y1={yScale(PEER)} y2={yScale(PEER)} stroke="#2563EB" strokeDasharray="2 2" />
          <text x={plotX + plotW + 4} y={yScale(PEER) + 4} fontSize={11} fill="#2563EB">同儕 {PEER.toFixed(1)}</text>

          {/* 每月欄位邊界（淡） */}
          {SAMPLE.map((_, i) => (
            <line
              key={`col-${i}`}
              x1={plotX + i * colW}
              x2={plotX + i * colW}
              y1={plotY}
              y2={plotY + plotH + TABLE_H}
              stroke="#E5E7EB"
              strokeWidth={1}
            />
          ))}
          <line x1={plotX + plotW} x2={plotX + plotW} y1={plotY} y2={plotY + plotH + TABLE_H} stroke="#E5E7EB" />

          {/* 折線 */}
          {pathD && <path d={pathD} stroke="#111827" strokeWidth={2} fill="none" />}

          {/* 數據點 */}
          {points.map((p) => {
            if (p.y == null) return null;
            return <circle key={p.i} cx={p.x} cy={p.y} r={4} fill="#16A34A" stroke="#fff" strokeWidth={1.5} />;
          })}

          {/* === 表格區 === */}
          {/* 表格邊框 */}
          <rect x={plotX} y={tableTop} width={plotW} height={TABLE_H} fill="none" stroke="#374151" strokeWidth={1} />
          {/* 橫線 */}
          {Array.from({ length: TABLE_ROWS - 1 }).map((_, r) => (
            <line
              key={`hr-${r}`}
              x1={plotX}
              x2={plotX + plotW}
              y1={tableTop + (r + 1) * TABLE_ROW_H}
              y2={tableTop + (r + 1) * TABLE_ROW_H}
              stroke="#D1D5DB"
            />
          ))}

          {/* 左側列標籤 */}
          {['年', '月', '分子', '分母', '% (D2N<60min)'].map((label, r) => (
            <text
              key={label}
              x={plotX - 8}
              y={rowY(r)}
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
            const x1 = plotX + g.startIdx * colW;
            const x2 = plotX + (g.endIdx + 1) * colW;
            return (
              <g key={`y-${g.year}`}>
                <rect x={x1} y={tableTop} width={x2 - x1} height={TABLE_ROW_H} fill="#EFF6FF" />
                <text x={(x1 + x2) / 2} y={rowY(0)} fontSize={13} fontWeight="bold" fill="#1E3A8A" textAnchor="middle">
                  {g.year} 年
                </text>
                {/* 年分組分隔線加粗 */}
                {g.startIdx > 0 && (
                  <line
                    x1={x1}
                    x2={x1}
                    y1={tableTop}
                    y2={tableTop + TABLE_H}
                    stroke="#374151"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            );
          })}

          {/* 月份 header */}
          {SAMPLE.map((d, i) => (
            <text key={`m-${i}`} x={cx(i)} y={rowY(1)} fontSize={12} fill="#111827" textAnchor="middle" fontWeight="bold">
              {d.month}月
            </text>
          ))}

          {/* 分子 / 分母 / 比率 */}
          {SAMPLE.map((d, i) => {
            const r = ratioPct(d);
            return (
              <g key={`c-${i}`}>
                <text x={cx(i)} y={rowY(2)} fontSize={12} fill="#111827" textAnchor="middle">
                  {d.num}
                </text>
                <text x={cx(i)} y={rowY(3)} fontSize={12} fill="#111827" textAnchor="middle">
                  {d.den}
                </text>
                <text x={cx(i)} y={rowY(4)} fontSize={12} fill={r == null ? '#9CA3AF' : '#111827'} textAnchor="middle">
                  {r == null ? 'NA' : r === Math.floor(r) ? `${r.toFixed(0)}` : `${r.toFixed(1)}`}
                </text>
              </g>
            );
          })}

          {/* 頁碼/備註 */}
          <text x={W - 40} y={H - 20} fontSize={11} fill="#9CA3AF" textAnchor="end">
            新竹臺大分院 QIP 監測指標系統 — 匯出自 114.12
          </text>
        </svg>
      </div>

      <div className="text-xs text-gray-600 max-w-4xl">
        <div className="font-semibold mb-1">設計決策點（想聽你的意見）：</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>欄寬：所有月份等寬；折線 x 座標 = 欄位中線，所以折線點一定對齊月份欄。</li>
          <li>表格列：年 → 月 → 分子 → 分母 → 比率（共 5 列）；年用合併儲存格並加深分隔線。</li>
          <li>NA 處理：分母為 0 時折線斷開，表格顯示 NA（灰色）。</li>
          <li>管制限/同儕值以虛線標示，右側文字標註。</li>
          <li>I-MR Chart 沒有分子/分母 → 表格只保留「年 / 月 / 值」三列（可另做一版）。</li>
          <li>月份數量大（如 25）→ 欄位變窄，數字要縮到 10px，可能需要垂直排列分子分母。</li>
        </ul>
      </div>
    </div>
  );
}
