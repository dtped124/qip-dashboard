/** 達文西前端共用 UI 常數與格式化（消除跨元件重複，audit 後整併） */

import type { DavinciPeriodKey } from './types';

/** 達文西手術品質面向代表色（QIP 十大類別色系之外的紫，避免混淆） */
export const DAVINCI_COLOR = '#7C3AED';

/** WER 規則短標籤（卡片/警示列 tag 用，對應 QIP 的機制標籤樣式） */
export const WER_RULE_LABELS: Record<string, string> = {
  Rule1: '3σ超界',
  Rule2: '2σ警戒',
  Rule3: '連續同側',
  Rule4: '連續趨勢',
  Rule5: '2/3點2σ',
};

/** 期別 key → QIP Sparkline 用的 {year, month} 座標（季取季末月） */
export function periodToYearMonth(period: DavinciPeriodKey): { year: number; month: number } {
  const s = String(period);
  if (s.includes('Q')) {
    const [y, q] = s.split('Q');
    return { year: parseInt(y), month: parseInt(q) * 3 };
  }
  const n = parseInt(s);
  return { year: Math.floor(n / 100), month: n % 100 };
}

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
