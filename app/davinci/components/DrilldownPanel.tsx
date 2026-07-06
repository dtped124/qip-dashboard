'use client';

/**
 * 達文西下鑽面板（Phase 3 — QIP 沒有的能力）
 * 指標（院區層）→ 科別 → 執行醫師 → 術式 → 個案明細
 * 每層皆顯示分子/分母（0 事件顯示 0/n 而非 0%）。
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, Users } from 'lucide-react';
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
  period: DavinciPeriodKey;
  periodLabel: string;
}

interface Crumb {
  level: 'dept' | 'surgeon' | 'order' | 'cases';
  dept?: string;
  surgeon?: string;
  order?: string;
}

export function DrilldownPanel({ code, kind, unit, campus, period, periodLabel }: Props) {
  const [crumb, setCrumb] = useState<Crumb>({ level: 'dept' });
  const [rows, setRows] = useState<DrilldownRow[]>([]);
  const [cases, setCases] = useState<DavinciCaseRow[]>([]);
  const [casesTotal, setCasesTotal] = useState(0);
  const [casesTruncated, setCasesTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitLabel = fmtUnit(unit);

  const load = useCallback(async (c: Crumb) => {
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
          dept: c.dept, surgeon: c.surgeon,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, campus, period]);

  // 單一資料流：導覽只 setCrumb，fetch 統一由 crumb 變化驅動 —
  // 避免「setCrumb 沒配對 load()」造成麵包屑與表格脫鉤
  useEffect(() => {
    setCrumb({ level: 'dept' });
  }, [code, campus, period]);

  useEffect(() => {
    load(crumb);
  }, [crumb, load]);

  const go = (c: Crumb) => setCrumb(c);

  const drill = (key: string) => {
    if (crumb.level === 'dept') go({ level: 'surgeon', dept: key });
    else if (crumb.level === 'surgeon') go({ level: 'order', dept: crumb.dept, surgeon: key });
    else if (crumb.level === 'order') go({ level: 'cases', dept: crumb.dept, surgeon: crumb.surgeon, order: key });
  };

  const LEVEL_LABEL: Record<Crumb['level'], string> = {
    dept: '科別', surgeon: '執行醫師', order: '術式', cases: '個案明細',
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <Users size={15} /> 下鑽分析 — {periodLabel}
        </h3>
        {/* 麵包屑 */}
        <nav className="flex items-center gap-1 text-xs text-gray-500 flex-wrap">
          <button onClick={() => go({ level: 'dept' })}
                  className={crumb.level === 'dept' ? 'font-medium text-gray-800' : 'text-blue-600 hover:underline'}>
            全院區
          </button>
          {crumb.dept && (
            <>
              <ChevronRight size={12} />
              <button onClick={() => go({ level: 'surgeon', dept: crumb.dept })}
                      className={crumb.level === 'surgeon' ? 'font-medium text-gray-800' : 'text-blue-600 hover:underline'}>
                {crumb.dept}
              </button>
            </>
          )}
          {crumb.surgeon && (
            <>
              <ChevronRight size={12} />
              <button onClick={() => go({ level: 'order', dept: crumb.dept, surgeon: crumb.surgeon })}
                      className={crumb.level === 'order' ? 'font-medium text-gray-800' : 'text-blue-600 hover:underline'}>
                {crumb.surgeon}
              </button>
            </>
          )}
          {crumb.order && (
            <>
              <ChevronRight size={12} />
              <span className="font-medium text-gray-800">{crumb.order}</span>
            </>
          )}
          {crumb.level !== 'cases' && (
            <button
              onClick={() => go({ level: 'cases', dept: crumb.dept, surgeon: crumb.surgeon, order: crumb.order })}
              className="ml-2 px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              直接看個案
            </button>
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
                    onClick={() => drill(r.key)}
                    className="border-b border-gray-50 hover:bg-blue-50/50 cursor-pointer">
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
                  <td className="py-2 text-gray-300"><ChevronRight size={14} /></td>
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
