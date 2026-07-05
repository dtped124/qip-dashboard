/** 達文西前端共用 UI 常數與格式化（消除跨元件重複，audit 後整併） */

import type { DavinciPeriodKey } from './types';

/** 單位顯示標籤（新增單位時只改這裡） */
export function unitLabel(unit: string): string {
  switch (unit) {
    case 'percent': return '%';
    case 'min': return '分';
    case 'ml': return 'ml';
    default: return unit;
  }
}

/** 院區選項（竹東無達文西 → 反白停用）。兩頁共用，避免清單漂移。 */
export const CAMPUS_OPTIONS: { name: string; enabled: boolean }[] = [
  { name: '竹北', enabled: true },
  { name: '竹東', enabled: false },
  { name: '新竹', enabled: true },
];

export const ENABLED_CAMPUSES = CAMPUS_OPTIONS.filter(c => c.enabled).map(c => c.name);

/** 期別顯示標籤：202605 → '115年5月'；'2026Q2' → '115年Q2'（與後端 period_label 一致） */
export function periodLabel(period: DavinciPeriodKey): string {
  const s = String(period);
  if (s.includes('Q')) {
    const [y, q] = s.split('Q');
    return `${parseInt(y) - 1911}年Q${q}`;
  }
  const n = parseInt(s);
  return `${Math.floor(n / 100) - 1911}年${n % 100}月`;
}

/**
 * <select> 字串值 → 期別 key 還原。
 * 不可用 mode 猜型別（mode 切換瞬間舊 groups 仍在畫面上，Number('2026Q2')=NaN
 * 會讓 find(===) 永遠 miss 而整頁空白）——一律以字串比對回查原 key。
 */
export function resolvePeriodValue(
  raw: string,
  periods: DavinciPeriodKey[],
): DavinciPeriodKey | null {
  return periods.find(p => String(p) === raw) ?? null;
}
