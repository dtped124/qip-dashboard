'use client';

/**
 * 月報指標卡投影片 — 單一 SVG（viewBox 1280×720）
 *
 * 三院區並排 × 每院區 12 張小卡。純 <rect>/<path>/<text>，不用 foreignObject
 * （canvas 序列化時 foreignObject 會掉字）。
 *
 * 尺寸：預設只設 viewBox，由外層 className/style 控制縮放（預覽用）；
 * 匯出時傳 width/height = 1280/720 讓序列化後的 SVG 有明確像素尺寸。
 */

import type { CSSProperties } from 'react';
import type { MonthlyCard, MonthlyCardSlideData, YoyTone } from '@/lib/export/buildMonthlyCards';
import { SERIES_LEN } from '@/lib/export/buildMonthlyCards';

const FONT = '"Microsoft JhengHei", "PingFang TC", sans-serif';

export const MONTHLY_SLIDE_W = 1280;
export const MONTHLY_SLIDE_H = 720;

// 版面
const MARGIN_X = 24;
const COL_W = 392;
const COL_GAP = 28;
const CARD_W = 128;
const CARD_H = 144;
const CARD_GAP_X = 4;
const CARD_GAP_Y = 4;
const CARD_TOP = 96;
const COLS_PER_CAMPUS = 3;

// sparkline（卡片座標系）
const SPARK_X = 8;
const SPARK_Y = 102;
const SPARK_W = 112;
const SPARK_H = 34;

// 顏色
const C_NAVY = '#1E3A5F';
const C_ALERT = '#DC2626';
const C_ALERT_BG = '#FFF7F7';
const C_BORDER = '#D1D5DB';
const C_BAND = '#E5E7EB';
const C_CL = '#9CA3AF';
const C_LINE = '#2563EB';
const C_END = '#1D4ED8';
const TONE_COLOR: Record<YoyTone, string> = {
  bad: '#A32D2D',
  good: '#3B6D11',
  neutral: '#6B7280',
  na: '#9CA3AF',
};

// ===== 文字寬度估算（SVG 無自動折行） =====

function charWidth(ch: string, size: number): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x2e80 || (code >= 0xff00 && code <= 0xffef)) return size; // CJK / 全形
  if (ch === ' ') return size * 0.3;
  if (/[0-9A-Z‰%]/.test(ch)) return size * 0.62;
  return size * 0.5;
}

function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of Array.from(s)) w += charWidth(ch, size);
  return bold ? w * 1.06 : w;
}

/** 以 token 為單位貪婪折行（token 不可拆）；超過 maxLines 時最後一行截斷加「…」 */
function wrapTokens(
  tokens: string[],
  size: number,
  maxW: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  let i = 0;
  for (; i < tokens.length; i++) {
    const w = textWidth(tokens[i], size);
    if (curW + w > maxW && cur) {
      lines.push(cur);
      cur = '';
      curW = 0;
      if (lines.length === maxLines) break;
    }
    cur += tokens[i];
    curW += w;
  }
  if (lines.length < maxLines) {
    if (cur) lines.push(cur);
    return { lines, truncated: false };
  }
  // 還有剩字 → 最後一行截斷加「…」
  let last = lines[maxLines - 1];
  const ellipsisW = charWidth('…', size);
  while (last && textWidth(last, size) + ellipsisW > maxW) last = Array.from(last).slice(0, -1).join('');
  lines[maxLines - 1] = `${last}…`;
  return { lines, truncated: true };
}

export interface WrappedName {
  lines: string[];
  size: number;
}

// 結尾的括號後綴（最後一個「(…)」），如「(不含PAC)」
const SUFFIX_RE = /^(.+?)(\([^()]*\)|（[^（）]*）)$/;

/**
 * 卡片標題折行。
 * 1. 2 行 @11px 放得下 → 照放（其他指標行為不變）。
 * 2. 放不下且有括號後綴 → 後綴視為不可拆、不可截斷的整體：
 *    先試 3 行 @10px 完整顯示全名；仍放不下才截括號前的主文加「…」再接完整後綴。
 * 3. 放不下且無括號後綴 → 2 行 @11px，最後一行截斷加「…」（原行為）。
 */
export function wrapName(name: string, maxW: number): WrappedName {
  const plain = wrapTokens(Array.from(name), 11, maxW, 2);
  if (!plain.truncated) return { lines: plain.lines, size: 11 };

  const m = name.match(SUFFIX_RE);
  if (!m) return { lines: plain.lines, size: 11 };

  const body = Array.from(m[1]);
  const suffix = m[2];
  const SIZE = 10;
  const MAX_LINES = 3;

  const full = wrapTokens([...body, suffix], SIZE, maxW, MAX_LINES);
  if (!full.truncated) return { lines: full.lines, size: SIZE };

  for (let k = body.length - 1; k >= 0; k--) {
    const r = wrapTokens([...body.slice(0, k), '…', suffix], SIZE, maxW, MAX_LINES);
    if (!r.truncated) return { lines: r.lines, size: SIZE };
  }
  return { lines: [suffix], size: SIZE };
}

/** 標題行的基線：11px 兩行 / 10px 三行 */
function nameBaseline(size: number, i: number): number {
  return size === 10 ? 15 + i * 12 : 18 + i * 13;
}

// ===== Sparkline =====

/** 逐月界限中連續（非 null）區段的索引；null 處斷開 */
function bandRuns(ucl: (number | null)[], lcl: (number | null)[]): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  ucl.forEach((u, i) => {
    if (u === null || lcl[i] === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else {
      cur.push(i);
    }
  });
  if (cur.length) runs.push(cur);
  return runs;
}

function Sparkline({ card }: { card: MonthlyCard }) {
  const { series, band, alertMonths } = card;
  const xAt = (i: number) => SPARK_X + (i * SPARK_W) / (SERIES_LEN - 1);

  // y 軸範圍：資料 ∪ 灰帶，但灰帶過寬（例如小分母 p-chart）時限制在資料範圍外 1.5 倍內，避免折線被壓扁
  const vals = series.filter((v): v is number => v !== null);
  let lo = vals.length ? Math.min(...vals) : 0;
  let hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || Math.max(Math.abs(hi), 1) * 0.2;
  let dLo = lo;
  let dHi = hi;
  if (band) {
    const ucls = band.kind === 'fixed' ? [band.ucl] : band.ucl.filter((v): v is number => v !== null);
    const lcls = band.kind === 'fixed' ? [band.lcl] : band.lcl.filter((v): v is number => v !== null);
    dHi = Math.max(dHi, ...ucls, band.cl);
    dLo = Math.min(dLo, ...lcls, band.cl);
  }
  dHi = Math.min(dHi, hi + 1.5 * span);
  dLo = Math.max(dLo, lo - 1.5 * span);
  if (lo >= 0) dLo = Math.max(dLo, 0);
  if (dHi - dLo < 1e-9) {
    dHi = dLo + 1;
  }
  lo = dLo;
  hi = dHi;
  // CL 落在裁切後的可視範圍外就不畫虛線（灰帶仍裁切畫）
  const clVisible = band !== null && band.cl >= lo && band.cl <= hi;

  const yAt = (v: number) => {
    const t = (v - lo) / (hi - lo);
    const y = SPARK_Y + SPARK_H - t * SPARK_H;
    return Math.min(SPARK_Y + SPARK_H, Math.max(SPARK_Y, y));
  };

  // 折線：null 斷開
  const segments: { x: number; y: number }[][] = [];
  let curSeg: { x: number; y: number }[] = [];
  series.forEach((v, i) => {
    if (v === null) {
      if (curSeg.length) segments.push(curSeg);
      curSeg = [];
    } else {
      curSeg.push({ x: xAt(i), y: yAt(v) });
    }
  });
  if (curSeg.length) segments.push(curSeg);

  return (
    <g>
      {/* 灰帶 */}
      {band && band.kind === 'fixed' && (
        <rect
          x={SPARK_X}
          y={yAt(band.ucl)}
          width={SPARK_W}
          height={Math.max(0, yAt(band.lcl) - yAt(band.ucl))}
          fill={C_BAND}
        />
      )}
      {band && band.kind === 'variable' &&
        bandRuns(band.ucl, band.lcl).map((run, ri) =>
          run.length === 1 ? (
            <rect
              key={`b${ri}`}
              x={xAt(run[0]) - 1}
              y={yAt(band.ucl[run[0]] as number)}
              width={2}
              height={Math.max(0, yAt(band.lcl[run[0]] as number) - yAt(band.ucl[run[0]] as number))}
              fill={C_BAND}
            />
          ) : (
            <polygon
              key={`b${ri}`}
              points={[
                ...run.map(i => `${xAt(i).toFixed(2)},${yAt(band.ucl[i] as number).toFixed(2)}`),
                ...run.map(i => `${xAt(i).toFixed(2)},${yAt(band.lcl[i] as number).toFixed(2)}`).reverse(),
              ].join(' ')}
              fill={C_BAND}
            />
          ),
        )}
      {/* CL 虛線 */}
      {band && clVisible && (
        <line
          x1={SPARK_X}
          x2={SPARK_X + SPARK_W}
          y1={yAt(band.cl)}
          y2={yAt(band.cl)}
          stroke={C_CL}
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      )}
      {/* 折線（單點孤立段用小圓點） */}
      {segments.map((seg, si) =>
        seg.length === 1 ? (
          <circle key={si} cx={seg[0].x} cy={seg[0].y} r={1.5} fill={C_LINE} />
        ) : (
          <polyline
            key={si}
            points={seg.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
            fill="none"
            stroke={C_LINE}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ),
      )}
      {/* 末點 */}
      {series[SERIES_LEN - 1] !== null && (
        <circle cx={xAt(SERIES_LEN - 1)} cy={yAt(series[SERIES_LEN - 1] as number)} r={3.4} fill={C_END} />
      )}
      {/* 管制圖警示點 */}
      {series.map((v, i) =>
        v !== null && alertMonths[i] ? (
          <circle key={`a${i}`} cx={xAt(i)} cy={yAt(v)} r={2.6} fill="#DC2626" />
        ) : null,
      )}
    </g>
  );
}

// ===== 單張卡 =====

function Card({ card, x, y }: { card: MonthlyCard; x: number; y: number }) {
  const PAD = 8;
  const { lines: nameLines, size: nameSize } = wrapName(card.name, CARD_W - PAD * 2);

  if (card.notApplicable || card.noData) {
    return (
      <g transform={`translate(${x},${y})`}>
        <rect
          x={1}
          y={1}
          width={CARD_W - 2}
          height={CARD_H - 2}
          rx={8}
          fill="#FAFAFA"
          stroke="#D1D5DB"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        {nameLines.map((ln, i) => (
          <text key={i} x={PAD} y={nameBaseline(nameSize, i)} fontSize={nameSize} fill="#C4C8CF">
            {ln}
          </text>
        ))}
        <text x={CARD_W / 2} y={CARD_H / 2 + 8} fontSize={13} fill="#B0B5BD" textAnchor="middle">
          {card.notApplicable ? '不適用' : '無資料'}
        </text>
      </g>
    );
  }

  const valueW = textWidth(card.valueText, 21, true);
  const triX = PAD + valueW + 8;

  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        x={1}
        y={1}
        width={CARD_W - 2}
        height={CARD_H - 2}
        rx={8}
        fill={card.isAlert ? C_ALERT_BG : '#FFFFFF'}
        stroke={card.isAlert ? C_ALERT : C_BORDER}
        strokeWidth={2}
      />

      {/* 1. 指標名稱 */}
      {nameLines.map((ln, i) => (
        <text key={i} x={PAD} y={nameBaseline(nameSize, i)} fontSize={nameSize} fill="#374151">
          {ln}
        </text>
      ))}

      {/* 2. 本月值 + 警示三角 */}
      <text x={PAD} y={58} fontSize={21} fontWeight="700" fill="#111827">
        {card.valueText}
      </text>
      {card.isAlert && (
        <g>
          <path d={`M${triX},56 L${triX + 7},43 L${triX + 14},56 Z`} fill={C_ALERT} />
          <rect x={triX + 6.2} y={47.5} width={1.6} height={4.6} fill="#FFFFFF" />
          <rect x={triX + 6.2} y={52.9} width={1.6} height={1.6} fill="#FFFFFF" />
        </g>
      )}

      {/* 3. 上月 */}
      <text x={PAD} y={75} fontSize={10.5} fill="#8B93A1">
        {card.prevText}
      </text>

      {/* 4. 去年差 */}
      <text x={PAD} y={91} fontSize={10.5} fontWeight="600" fill={TONE_COLOR[card.yoyTone]}>
        {card.yoyText}
      </text>

      {/* 5. Sparkline */}
      <Sparkline card={card} />
    </g>
  );
}

// ===== 投影片 =====

interface Props {
  slide: MonthlyCardSlideData;
  /** 匯出時傳 1280/720；預覽省略，改由 className/style 控制 */
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
}

function LegendItem({ x, swatch, label }: { x: number; swatch: 'alert' | 'plain' | 'band'; label: string }) {
  const y = 30;
  return (
    <g>
      {swatch === 'alert' && <rect x={x} y={y - 11} width={16} height={12} rx={3} fill={C_ALERT_BG} stroke={C_ALERT} strokeWidth={1.6} />}
      {swatch === 'plain' && <rect x={x} y={y - 11} width={16} height={12} rx={3} fill="#FFFFFF" stroke={C_BORDER} strokeWidth={1.6} />}
      {swatch === 'band' && <rect x={x} y={y - 11} width={16} height={12} fill={C_BAND} />}
      <text x={x + 22} y={y} fontSize={13} fill="#4B5563">
        {label}
      </text>
    </g>
  );
}

export function MonthlyCardSlide({ slide, width, height, className, style }: Props) {
  // 圖例由右往左排
  const legend = [
    { swatch: 'alert' as const, label: '紅框＝管制圖異常' },
    { swatch: 'plain' as const, label: '灰框＝無訊號' },
    { swatch: 'band' as const, label: '灰帶＝CL ± 3σ' },
  ];
  const legendX: number[] = [];
  let cursor = MONTHLY_SLIDE_W - MARGIN_X;
  for (let i = legend.length - 1; i >= 0; i--) {
    const w = 22 + textWidth(legend[i].label, 13);
    cursor -= w;
    legendX[i] = cursor;
    cursor -= 20;
  }

  const titleW = textWidth(slide.title, 26, true);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${MONTHLY_SLIDE_W} ${MONTHLY_SLIDE_H}`}
      width={width}
      height={height}
      className={className ? `mcs-slide ${className}` : 'mcs-slide'}
      style={{ background: '#fff', fontFamily: FONT, display: 'block', ...style }}
    >
      <defs>
        <style>{`.mcs-slide text { font-family: ${FONT}; }`}</style>
      </defs>
      <rect x={0} y={0} width={MONTHLY_SLIDE_W} height={MONTHLY_SLIDE_H} fill="#FFFFFF" />

      {/* ===== 標頭 ===== */}
      <text x={MARGIN_X} y={38} fontSize={26} fontWeight="800" fill={C_NAVY}>
        {slide.title}
      </text>
      <text x={MARGIN_X + titleW + 16} y={38} fontSize={15} fill="#6B7280">
        {`${slide.year} 年 ${slide.month} 月 ｜ ${slide.categorySummary}`}
      </text>
      {legend.map((l, i) => (
        <LegendItem key={l.label} x={legendX[i]} swatch={l.swatch} label={l.label} />
      ))}

      {/* ===== 三院區欄 ===== */}
      {slide.columns.map((col, ci) => {
        const colX = MARGIN_X + ci * (COL_W + COL_GAP);
        return (
          <g key={col.campus}>
            <text x={colX + COL_W / 2} y={82} fontSize={19} fontWeight="700" fill="#1F2937" textAnchor="middle">
              {col.label}
            </text>
            {col.cards.map((card, i) => {
              const r = Math.floor(i / COLS_PER_CAMPUS);
              const c = i % COLS_PER_CAMPUS;
              return (
                <Card
                  key={`${card.code}-${i}`}
                  card={card}
                  x={colX + c * (CARD_W + CARD_GAP_X)}
                  y={CARD_TOP + r * (CARD_H + CARD_GAP_Y)}
                />
              );
            })}
          </g>
        );
      })}

      {/* ===== 頁碼 ===== */}
      <text x={MONTHLY_SLIDE_W - MARGIN_X} y={MONTHLY_SLIDE_H - 12} fontSize={11} fill="#9CA3AF" textAnchor="end">
        {slide.pageIndex + 1} / {slide.totalPages}
      </text>
    </svg>
  );
}
