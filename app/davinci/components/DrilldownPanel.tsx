'use client';

/**
 * 達文西下鑽面板（Phase 3 — QIP 沒有的能力）
 * 指標（院區層）→ 科別 → 執行醫師 → 術式 → 個案明細
 * 每層皆顯示分子/分母（0 事件顯示 0/n 而非 0%）。
 * 個案明細（病歷號、醫師等逐案資料）僅審核者／管理員可看（後端 cases/ 同規則）：
 * 其他人的最後一層分組不可再點、沒有「直接看個案」，也不會呼叫 cases/。
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, Users } from 'lucide-react';
import { useAuthStore } from '@/lib/auth/store';
import { canSeeDavinciCases } from '@/lib/auth/roles';
import { fetchCases, fetchDrilldown } from '../lib/api';
import type {
  DavinciCampus,
  DavinciCaseRow,
  DavinciPeriodKey,
  DrilldownRow,
} from '../lib/types';
import { unitLabel as fmtUnit } from '../lib/ui';

interface Props {
  code: string;
  kind: 'rate' | 'continuous';
  unit: string;
  campus: DavinciCampus;
  /** 可下鑽的期別（僅有資料者），由舊到新；預設選最新一期。 */
  periods: { period: DavinciPeriodKey; label: string }[];
  /** 選取範圍變動時通知父層（供「完整數據」跟隨）。必須是穩定的 callback。 */
  onScopeChange?: (scope: { dept?: string; surgeon?: string }) => void;
}

interface Crumb {
  level: 'dept' | 'surgeon' | 'order' | 'cases';
  dept?: string;
  surgeon?: string;
  order?: string;
}

type Dim = 'dept' | 'surgeon' | 'order';

/** 起始維度 → 下鑽序列（後續順序固定，個案明細恆為最後一層）。
 * 術式不放中段以後的原因見 scope 註解：一台刀可含多個術式。 */
const DRILL_SEQ: Record<Dim, Dim[]> = {
  dept: ['dept', 'surgeon', 'order'],
  surgeon: ['surgeon', 'order'],
  order: ['order', 'surgeon'],
};

const DIM_LABEL: Record<Dim, string> = { dept: '科別', surgeon: '醫師', order: '術式' };

export function DrilldownPanel({ code, kind, unit, campus, periods, onScopeChange }: Props) {
  const [picked, setPicked] = useState<DavinciPeriodKey | null>(null);
  // 切換指標/院區/月季後，舊的選擇可能已不在清單裡 → 退回最新一期。
  // 用「驗證後退回」而非 reset effect，避免多一次 render 與載入。
  const latestPeriod = periods[periods.length - 1]?.period;
  const period = periods.some(p => String(p.period) === String(picked))
    ? (picked as DavinciPeriodKey)
    : latestPeriod;
  const periodLabel = periods.find(p => String(p.period) === String(period))?.label ?? '';

  const [startDim, setStartDim] = useState<Dim>('dept');
  const seq = DRILL_SEQ[startDim];

  const [crumb, setCrumb] = useState<Crumb>({ level: 'dept' });
  const [rows, setRows] = useState<DrilldownRow[]>([]);
  const [cases, setCases] = useState<DavinciCaseRow[]>([]);
  const [casesTotal, setCasesTotal] = useState(0);
  const [casesTruncated, setCasesTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitLabel = fmtUnit(unit);
  const canCases = canSeeDavinciCases(useAuthStore(s => s.user?.roles));

  const load = useCallback(async (c: Crumb) => {
    if (c.level === 'cases' && !canCases) return; // 沒有個案權限：永遠不打 cases/
    setLoading(true);
    setError(null);
    try {
      if (c.level === 'cases') {
        const r = await fetchCases({
          campus, period, code,
          dept: c.dept, surgeon: c.surgeon, order: c.order,
        });
        setCases(r.data);
        setCasesTotal(r.total);
        setCasesTruncated(r.truncated);
      } else {
        setRows(await fetchDrilldown({
          code, campus, period, by: c.level,
          dept: c.dept, surgeon: c.surgeon, order: c.order,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, campus, period, canCases]);

  // 單一資料流：導覽只 setCrumb，fetch 統一由 crumb 變化驅動 —
  // 避免「setCrumb 沒配對 load()」造成麵包屑與表格脫鉤
  useEffect(() => {
    setCrumb({ level: startDim });
  }, [code, campus, period, startDim]);

  useEffect(() => {
    load(crumb);
  }, [crumb, load]);

  // 範圍通知：掛在 crumb 上而非 go()，因為上面的 reset effect 也會 setCrumb，
  // 只在 go() 通知會讓切換院區/指標後的範圍殘留。
  // 依賴取兩個字串而非 crumb 物件：order → cases 這種只改 level 的導覽不該重打 API。
  // 刻意不含 order —— 一台刀可計入多個術式，跟隨術式會讓分母加總超過全院區。
  useEffect(() => {
    onScopeChange?.({ dept: crumb.dept, surgeon: crumb.surgeon });
  }, [crumb.dept, crumb.surgeon, onScopeChange]);

  const go = (c: Crumb) => {
    if (c.level === 'cases' && !canCases) return;
    setCrumb(c);
  };

  // 目前這層的列能不能再點：最後一層分組之下就是個案明細，沒有個案權限的人到此為止
  const levelIdx = seq.indexOf(crumb.level as Dim);
  const rowsClickable = levelIdx !== -1 && (canCases || levelIdx + 1 < seq.length);

  const drill = (key: string) => {
    const idx = seq.indexOf(crumb.level as Dim);
    if (idx === -1) return; // cases 層不再下鑽
    if (idx + 1 >= seq.length && !canCases) return;
    const next: Crumb = { level: idx + 1 < seq.length ? seq[idx + 1] : 'cases' };
    for (let i = 0; i < idx; i++) next[seq[i]] = crumb[seq[i]];
    next[seq[idx]] = key;
    go(next);
  };

  const LEVEL_LABEL: Record<Crumb['level'], string> = {
    dept: '科別', surgeon: '執行醫師', order: '術式', cases: '個案明細',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <Users size={15} /> 下鑽分析 —
          {periods.length > 1 ? (
            <select
              value={String(period)}
              onChange={e => setPicked(e.target.value)}
              className="ml-0.5 border border-gray-300 rounded px-1.5 py-0.5 text-sm
                         text-gray-800 bg-white hover:border-gray-400 focus:outline-none
                         focus:ring-1 focus:ring-blue-400"
              aria-label="選擇下鑽期別"
            >
              {[...periods].reverse().map(p => (
                <option key={String(p.period)} value={String(p.period)}>{p.label}</option>
              ))}
            </select>
          ) : (
            <span>{periodLabel}</span>
          )}
          <span className="ml-2 flex items-center gap-1 text-xs font-normal">
            <span className="text-gray-400">先看</span>
            {(Object.keys(DRILL_SEQ) as Dim[]).map(d => (
              <button
                key={d}
                onClick={() => setStartDim(d)}
                className={`px-1.5 py-0.5 rounded border ${
                  startDim === d
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {DIM_LABEL[d]}
              </button>
            ))}
          </span>
        </h3>
        {/* 麵包屑 */}
        <nav className="flex items-center gap-1 text-xs text-gray-500 flex-wrap">
          <button onClick={() => go({ level: startDim })}
                  className={crumb.level === startDim ? 'font-medium text-gray-800' : 'text-blue-600 hover:underline'}>
            全院區
          </button>
          {seq.map((dim, i) => {
            const value = crumb[dim];
            if (!value) return null;
            const target: Crumb['level'] = i + 1 < seq.length ? seq[i + 1] : 'cases';
            return (
              <span key={dim} className="flex items-center gap-1">
                <ChevronRight size={12} />
                <button
                  onClick={() => {
                    const next: Crumb = { level: target };
                    for (let j = 0; j <= i; j++) next[seq[j]] = crumb[seq[j]];
                    go(next);
                  }}
                  className={crumb.level === target ? 'font-medium text-gray-800' : 'text-blue-600 hover:underline'}
                >
                  {value}
                </button>
              </span>
            );
          })}
          {crumb.level !== 'cases' && (
            canCases ? (
              <button
                onClick={() => go({ level: 'cases', dept: crumb.dept, surgeon: crumb.surgeon, order: crumb.order })}
                className="ml-2 px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                直接看個案
              </button>
            ) : (
              <span className="ml-2 text-gray-400">個案明細僅審核者／管理員可檢視</span>
            )
          )}
        </nav>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
          <Loader2 className="animate-spin" size={16} /> 載入中…
        </div>
      )}
      {error && !loading && (
        <div className="text-sm text-red-600 py-4">{error}</div>
      )}

      {/* 分組層（科別/醫師/術式） */}
      {!loading && !error && crumb.level !== 'cases' && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b">
              <th className="text-left font-normal py-1.5">{LEVEL_LABEL[crumb.level]}</th>
              <th className="text-right font-normal py-1.5">{kind === 'rate' ? '分子/分母' : `平均（${unitLabel}）/ n`}</th>
              <th className="text-right font-normal py-1.5">值</th>
              <th className="text-right font-normal py-1.5 w-32">占比</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {(() => {
              const maxDen = Math.max(...rows.map(x => x.denominator), 1);
              return rows.map(r => (
                <tr key={r.key}
                    onClick={rowsClickable ? () => drill(r.key) : undefined}
                    className={`border-b border-gray-50 ${rowsClickable ? 'hover:bg-blue-50/50 cursor-pointer' : ''}`}>
                  <td className="py-2">{r.key}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {kind === 'rate'
                      ? <span className={r.numerator ? 'text-red-600 font-medium' : ''}>{r.numerator}/{r.denominator}</span>
                      : <span>{r.value ?? '—'} / {r.denominator} 台</span>}
                  </td>
                  <td className="py-2 text-right text-gray-500">
                    {kind === 'rate' ? (r.value != null ? `${r.value}%` : '—') : (r.value ?? '—')}
                  </td>
                  <td className="py-2">
                    <div className="bg-gray-100 rounded h-2 ml-auto" style={{ width: '100%' }}>
                      <div className="bg-blue-400 rounded h-2"
                           style={{ width: `${(r.denominator / maxDen) * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-2 text-gray-300">{rowsClickable && <ChevronRight size={14} />}</td>
                </tr>
              ));
            })()}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-gray-300 text-sm">此期別無資料</td></tr>
            )}
          </tbody>
        </table>
      )}

      {/* 個案明細層 */}
      {!loading && !error && crumb.level === 'cases' && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b">
                <th className="text-left font-normal py-1.5 pr-2">期別</th>
                <th className="text-left font-normal py-1.5 pr-2">病歷號</th>
                <th className="text-left font-normal py-1.5 pr-2">病患</th>
                <th className="text-left font-normal py-1.5 pr-2">科別/醫師</th>
                <th className="text-left font-normal py-1.5 pr-2">術式</th>
                <th className="text-right font-normal py-1.5 pr-2">時間(分)</th>
                <th className="text-right font-normal py-1.5 pr-2">出血(ml)</th>
                <th className="text-left font-normal py-1.5 pr-2">事件</th>
                <th className="text-left font-normal py-1.5">清洗標記</th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={`${c.period}-${c.account}`}
                    className={`border-b border-gray-50 ${c.is_event ? 'bg-red-50/60' : ''}`}>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{c.period_label}</td>
                  <td className="py-1.5 pr-2 font-mono">{c.chart_no}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{c.patient}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{c.dept}／{c.surgeon}</td>
                  <td className="py-1.5 pr-2">{c.orders.join('、')}</td>
                  <td className="py-1.5 pr-2 text-right">{c.op_time_min ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right">{c.blood_ml ?? '—'}</td>
                  <td className="py-1.5 pr-2">
                    {[
                      c.conversion && '轉換',
                      c.adverse_14d && `不良：${c.adverse.map(a => a.label).join('、') || '—'}${c.adverse_free_text ? `（${c.adverse_free_text}）` : ''}`,
                      c.severe_comp_30d && `併發：${c.severe.map(s => s.label).join('、') || '—'}`,
                      c.infection_14d && '感染',
                      c.reoperation_14d && '再手術',
                    ].filter(Boolean).map((t, i) => (
                      <div key={i} className="text-red-600">{t}</div>
                    ))}
                    {!c.conversion && !c.adverse_14d && !c.severe_comp_30d && !c.infection_14d && !c.reoperation_14d && (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 text-amber-600">
                    {c.flags.filter(f => f !== 'masked_by_system').join('; ') || <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
              {cases.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-gray-300">無個案</td></tr>
              )}
            </tbody>
          </table>
          <p className="text-[10px] text-gray-400 mt-2">
            紅底列 = 本指標事件人次；病歷號/姓名皆為遮罩後資料
            {casesTruncated && (
              <span className="text-amber-600 ml-2">
                ⚠ 僅顯示前 {cases.length} / 共 {casesTotal} 筆，完整名單請用「匯出 xlsx」
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
