'use client';

/** 評級徽章（達文西：警示/注意/留意/監測；良好/卓越待標竿啟用） */

import type { DavinciRating } from '../lib/types';

const STYLES: Record<DavinciRating, { bg: string; text: string; label: string }> = {
  alert:   { bg: 'bg-red-100',    text: 'text-red-700',    label: '警示' },
  warning: { bg: 'bg-orange-100', text: 'text-orange-700', label: '注意' },
  watch:   { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '留意' },
  neutral: { bg: 'bg-gray-100',   text: 'text-gray-500',   label: '監測' },
};

export function RatingBadge({ rating, small = false }: { rating: DavinciRating; small?: boolean }) {
  const s = STYLES[rating] ?? STYLES.neutral;
  return (
    <span className={`${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} rounded ${s.bg} ${s.text} shrink-0`}>
      {s.label}
    </span>
  );
}

export const RATING_CELL_COLORS: Record<DavinciRating, string> = {
  alert: 'bg-red-500',
  warning: 'bg-orange-400',
  watch: 'bg-yellow-300',
  neutral: 'bg-gray-200',
};

/** SPC 圖點色（與徽章/矩陣同一調色來源，調整評級色只改本檔） */
export const RATING_DOT_COLORS: Record<DavinciRating, string> = {
  alert: '#DC2626',
  warning: '#EA580C',
  watch: '#CA8A04',
  neutral: '#2563EB',
};
