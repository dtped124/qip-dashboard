'use client';

/**
 * 季度分析投影片版面 — 單一 SVG 1280×720
 *
 * 採用與 SlideLayout (管制圖) 相同的 SVG 架構：
 * - 純 <rect>/<line>/<text>，位置精確到像素
 * - text 用 textAnchor + dominantBaseline 對齊（不會有 html2canvas 的對齊誤差）
 * - 透過 XMLSerializer → Blob → Image → Canvas → PNG
 */

import type { ScorecardSlide, ScorecardRow } from '@/lib/export/buildQuarterlyScorecard';

const HEADER_BG = '#F5C77E';
const CATEGORY_BG = '#FAEACA';
const CURRENT_BLUE = '#1B5FAD';
const ROW_BORDER = '#9E9E9E';
const ALERT_RED = '#c0392b';
const FONT = '"Microsoft JhengHei", "PingFang TC", sans-serif';

const W = 1280;
const H = 720;

const TABLE_LEFT = 24;
const TABLE_TOP = 70;

const ROW_H = 47;
const HEADER_H = 44;

// 欄寬（單位 px）
const COLS = {
  category: 78,
  no: 38,
  name: 380,
  cur: 108,
  prev: 108,
  delta: 70,
  spc: 64,
  yearAvg: 120,
  peer: 96,
  view: 70,
};

// 計算每欄的左 x 與右 x
function colXs() {
  const keys = Object.keys(COLS) as (keyof typeof COLS)[];
  const xs: Record<keyof typeof COLS, { left: number; right: number; width: number }> = {} as never;
  let cursor = TABLE_LEFT;
  for (const k of keys) {
    const w = COLS[k];
    xs[k] = { left: cursor, right: cursor + w, width: w };
    cursor += w;
  }
  return { xs, totalRight: cursor };
}

function formatRatio(value: number | null, unit: string): string {
  if (value === null) return '—';
  const suffix = unit === 'permille' ? '‰' : unit === 'percent' ? '%' : '';
  if (value % 1 === 0) return `${value}${suffix}`;
  return `${value.toFixed(2)}${suffix}`;
}

function formatND(num: number | null, den: number | null): string {
  if (num === null || den === null) return '';
  return `(${num}/${den})`;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return '—';
  if (Math.abs(delta) < 0.1) return '0%';
  const sign = delta > 0 ? '+' : '−';
  const abs = Math.abs(delta);
  if (abs >= 100) return `${sign}${Math.round(abs)}%`;
  return `${sign}${abs.toFixed(1)}%`;
}

function formatPeer(value: number | null, unit: string): string {
  if (value === null) return 'NR';
  const suffix = unit === 'permille' ? '‰' : unit === 'percent' ? '%' : '';
  if (value % 1 === 0) return `${value}${suffix}`;
  return `${value.toFixed(2)}${suffix}`;
}

function groupByCategory(rows: ScorecardRow[]) {
  const groups: { category: string; rows: ScorecardRow[]; startIdx: number }[] = [];
  rows.forEach((r, i) => {
    const last = groups[groups.length - 1];
    if (last && last.category === r.category) last.rows.push(r);
    else groups.push({ category: r.category, rows: [r], startIdx: i });
  });
  return groups;
}

interface Props {
  slide: ScorecardSlide;
}

export function QuarterlyScorecardSlide({ slide }: Props) {
  const { xs, totalRight } = colXs();
  const groups = groupByCategory(slide.rows);
  const tableW = totalRight - TABLE_LEFT;
  const bodyTop = TABLE_TOP + HEADER_H;
  const bodyBottom = bodyTop + slide.rows.length * ROW_H;

  // 表頭欄位：垂直置中於 header 區
  const headerCenterY = TABLE_TOP + HEADER_H / 2;

  return (
    <svg width={W} height={H} xmlns="http://www.w3.org/2000/svg" style={{ background: '#fff', fontFamily: FONT }}>
      <defs>
        <style>{`text { font-family: ${FONT}; }`}</style>
      </defs>

      {/* ===== 標題列 ===== */}
      <text x={TABLE_LEFT} y={36} fontSize={26} fontWeight="800" fill="#1a1a1a">
        {slide.campus}院區　季度品質指標分析
      </text>
      <text x={TABLE_LEFT + 320} y={36} fontSize={16} fontWeight="600" fill="#555">
        {slide.prevQuarterLabel} → {slide.quarterLabel}
      </text>

      {/* ===== Header 背景（橘黃） ===== */}
      <rect x={TABLE_LEFT} y={TABLE_TOP} width={tableW} height={HEADER_H} fill={HEADER_BG} />

      {/* ===== Body 構面欄背景（淺橘） ===== */}
      {groups.map((g, gi) => (
        <rect
          key={`cat-bg-${gi}`}
          x={xs.category.left}
          y={bodyTop + g.startIdx * ROW_H}
          width={COLS.category}
          height={ROW_H * g.rows.length}
          fill={CATEGORY_BG}
        />
      ))}

      {/* ===== 外框 ===== */}
      <rect
        x={TABLE_LEFT}
        y={TABLE_TOP}
        width={tableW}
        height={HEADER_H + slide.rows.length * ROW_H}
        fill="none"
        stroke={ROW_BORDER}
        strokeWidth={1}
      />

      {/* ===== 直線（欄分隔線） ===== */}
      {(['no', 'name', 'cur', 'prev', 'delta', 'spc', 'yearAvg', 'peer', 'view'] as const).map((k) => (
        <line
          key={`vline-${k}`}
          x1={xs[k].left}
          y1={TABLE_TOP}
          x2={xs[k].left}
          y2={bodyBottom}
          stroke={ROW_BORDER}
          strokeWidth={1}
        />
      ))}

      {/* ===== 橫線 =====
          - header/body 分隔線：跨整個表格
          - 群組之間的列分隔線：跨整個表格（含構面欄）
          - 群組內的列分隔線：從 NO 欄開始（不切割構面欄，模擬 rowSpan 合併）
      */}
      <line x1={TABLE_LEFT} y1={bodyTop} x2={totalRight} y2={bodyTop} stroke={ROW_BORDER} strokeWidth={1} />
      {slide.rows.map((_, i) => {
        const y = bodyTop + (i + 1) * ROW_H;
        if (i === slide.rows.length - 1) return null; // 最底由外框畫
        // 下一列是否為新群組起點
        const isGroupBoundary = groups.some(g => g.startIdx === i + 1);
        const x1 = isGroupBoundary ? TABLE_LEFT : xs.no.left;
        return (
          <line
            key={`hline-${i}`}
            x1={x1}
            y1={y}
            x2={totalRight}
            y2={y}
            stroke={ROW_BORDER}
            strokeWidth={1}
          />
        );
      })}

      {/* ===== Header 文字 ===== */}
      <text x={(xs.category.left + xs.category.right) / 2} y={headerCenterY} fontSize={16} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">構面</text>
      <text x={(xs.no.left + xs.no.right) / 2} y={headerCenterY} fontSize={16} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">NO</text>
      <text x={(xs.name.left + xs.name.right) / 2} y={headerCenterY} fontSize={16} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">指標名稱</text>
      <text x={(xs.cur.left + xs.cur.right) / 2} y={headerCenterY} fontSize={16} fontWeight="800" fill={CURRENT_BLUE} textAnchor="middle" dominantBaseline="middle">{slide.quarterLabel}</text>
      <text x={(xs.prev.left + xs.prev.right) / 2} y={headerCenterY} fontSize={16} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">{slide.prevQuarterLabel}</text>

      {/* 兩行表頭：季增減 (%) / 趨勢 SPC */}
      <text x={(xs.delta.left + xs.delta.right) / 2} y={headerCenterY - 8} fontSize={14} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">季增減</text>
      <text x={(xs.delta.left + xs.delta.right) / 2} y={headerCenterY + 9} fontSize={14} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">(%)</text>
      <text x={(xs.spc.left + xs.spc.right) / 2} y={headerCenterY - 8} fontSize={14} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">SPC</text>
      <text x={(xs.spc.left + xs.spc.right) / 2} y={headerCenterY + 9} fontSize={14} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">趨勢</text>

      {/* 多行 yearAvg / peer */}
      {slide.yearAvgLabel.split('\n').map((line, i, arr) => {
        const offset = (i - (arr.length - 1) / 2) * 17;
        return (
          <text key={i} x={(xs.yearAvg.left + xs.yearAvg.right) / 2} y={headerCenterY + offset} fontSize={15} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">
            {line}
          </text>
        );
      })}
      {slide.peerLabel.split('\n').map((line, i, arr) => {
        const offset = (i - (arr.length - 1) / 2) * 17;
        return (
          <text key={i} x={(xs.peer.left + xs.peer.right) / 2} y={headerCenterY + offset} fontSize={15} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">
            {line}
          </text>
        );
      })}
      <text x={(xs.view.left + xs.view.right) / 2} y={headerCenterY} fontSize={16} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">檢視</text>

      {/* ===== 構面欄文字（每組置中於 group 區塊） ===== */}
      {groups.map((g, gi) => {
        const cx = (xs.category.left + xs.category.right) / 2;
        const cy = bodyTop + g.startIdx * ROW_H + (g.rows.length * ROW_H) / 2;
        const lines = g.category.split('\n');
        return (
          <g key={`cat-${gi}`}>
            {lines.map((line, i) => {
              const offset = (i - (lines.length - 1) / 2) * 19;
              return (
                <text key={i} x={cx} y={cy + offset} fontSize={16} fontWeight="800" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">
                  {line}
                </text>
              );
            })}
          </g>
        );
      })}

      {/* ===== Body 資料列 ===== */}
      {slide.rows.map((r, i) => {
        const rowCenterY = bodyTop + i * ROW_H + ROW_H / 2;

        // 「比率 + (分子/分母)」雙行顯示
        const renderRatioCell = (
          xCol: { left: number; right: number },
          ratio: number | null,
          num: number | null,
          den: number | null,
          color: string,
        ) => {
          const cx = (xCol.left + xCol.right) / 2;
          const nd = formatND(num, den);
          if (nd) {
            return (
              <>
                <text x={cx} y={rowCenterY - 9} fontSize={16} fontWeight="700" fill={color} textAnchor="middle" dominantBaseline="middle">
                  {formatRatio(ratio, r.unit)}
                </text>
                <text x={cx} y={rowCenterY + 10} fontSize={12} fontWeight="600" fill={color} textAnchor="middle" dominantBaseline="middle">
                  {nd}
                </text>
              </>
            );
          }
          return (
            <text x={cx} y={rowCenterY} fontSize={16} fontWeight="700" fill={color} textAnchor="middle" dominantBaseline="middle">
              {formatRatio(ratio, r.unit)}
            </text>
          );
        };

        return (
          <g key={r.code}>
            {/* NO */}
            <text x={(xs.no.left + xs.no.right) / 2} y={rowCenterY} fontSize={15} fontWeight="600" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">
              {r.no}
            </text>

            {/* 指標名稱（靠左） */}
            <text x={xs.name.left + 10} y={rowCenterY} fontSize={14} fontWeight="700" fill="#1a1a1a" textAnchor="start" dominantBaseline="middle">
              {r.name}
            </text>

            {/* 當季（藍） */}
            {renderRatioCell(xs.cur, r.curRatio, r.curNum, r.curDen, CURRENT_BLUE)}

            {/* 上季 */}
            {renderRatioCell(xs.prev, r.prevRatio, r.prevNum, r.prevDen, '#1a1a1a')}

            {/* 季增減 */}
            <text x={(xs.delta.left + xs.delta.right) / 2} y={rowCenterY} fontSize={15} fontWeight="700" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">
              {formatDelta(r.delta)}
            </text>

            {/* 趨勢 SPC */}
            <text x={(xs.spc.left + xs.spc.right) / 2} y={rowCenterY} fontSize={15} fontWeight="700" fill={r.spcTrend === '波動' ? ALERT_RED : '#1a1a1a'} textAnchor="middle" dominantBaseline="middle">
              {r.spcTrend}
            </text>

            {/* 年平均值 */}
            {renderRatioCell(xs.yearAvg, r.yearAvg, r.yearAvgNum, r.yearAvgDen, '#1a1a1a')}

            {/* 同儕值 */}
            <text x={(xs.peer.left + xs.peer.right) / 2} y={rowCenterY} fontSize={16} fontWeight="700" fill="#1a1a1a" textAnchor="middle" dominantBaseline="middle">
              {formatPeer(r.peerValue, r.unit)}
            </text>

            {/* 檢視欄留白 */}
          </g>
        );
      })}

      {/* ===== 頁碼 ===== */}
      <text x={W - 24} y={H - 8} fontSize={11} fill="#888" textAnchor="end" dominantBaseline="middle">
        {slide.campus}院區 · {slide.slideIndex + 1} / {slide.totalSlides} · 共 {slide.rows.length} 項
      </text>
    </svg>
  );
}
