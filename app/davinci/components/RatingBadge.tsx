'use client';

/**
 * 達文西評級徽章 — 直接複用 QIP 的 StatusBadge（僅 import，不修改其原始檔），
 * 確保燈號視覺與 QIP 完全一致。
 * 達文西四級評級（alert/warning/watch/neutral）是 QIP 六級燈號的子集，
 * 型別鍵完全相同（良好/卓越待 Phase 5 標竿啟用）。
 */

import { StatusBadge } from '@/components/dashboard/StatusBadge';
import type { DavinciRating } from '../lib/types';

export function RatingBadge({ rating, small = false }: { rating: DavinciRating; small?: boolean }) {
  return <StatusBadge status={rating} size={small ? 'sm' : 'md'} />;
}

/** 矩陣格色 — 與 QIP StatusMatrix 的 statusColorClass 一致 */
export const RATING_CELL_COLORS: Record<DavinciRating, string> = {
  alert: 'bg-red-500',
  warning: 'bg-orange-400',
  watch: 'bg-yellow-400',
  neutral: 'bg-gray-200',
};

/** SPC 圖點色 — 與 QIP STATUS_CONFIG dotColor 一致 */
export const RATING_DOT_COLORS: Record<DavinciRating, string> = {
  alert: '#DC2626',
  warning: '#EA580C',
  watch: '#CA8A04',
  neutral: '#2563EB',   // 無訊號點用藍（趨勢線主色）
};
