'use client';

/**
 * 達文西手術品質儀表板 — 總覽（內容區）
 *
 * 標題列 / 院區切換 / 匯入匯出 由達文西外框（DavinciSidebar / DavinciHeader）
 * 提供，操作方式與 QIP 儀表板一致；本頁只負責內容：
 * - 頂部警示彙整列 + 四張統計摘要卡
 * - 七指標卡（評級徽章/WER 訊號）/ 表格 / 矩陣 三檢視
 * - 月/季切換 + 期別選擇
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, LayoutGrid, Loader2, Table2, Grid3X3 } from 'lucide-react';
import { fetchDavinciIndicators, fetchDavinciMeta } from './lib/api';
import type {
  DavinciMeta,
  DavinciMode,
  DavinciPeriodGroup,
  DavinciPeriodKey,
  DavinciSpcSummary,
} from './lib/types';
import { useDavinciStore } from './lib/store';
import { resolvePeriodValue } from './lib/ui';
import { IndicatorCard } from './components/IndicatorCard';
import { MatrixView, TableView } from './components/Views';
import { RatingBadge } from './components/RatingBadge';

type ViewMode = 'card' | 'table' | 'matrix';

export default function DavinciPage() {
  const campus = useDavinciStore(s => s.campus);
  const mode = useDavinciStore(s => s.mode);
  const setMode = useDavinciStore(s => s.setMode);
  const dataVersion = useDavinciStore(s => s.dataVersion);

  const [meta, setMeta] = useState<DavinciMeta | null>(null);
  const [view, setView] = useState<ViewMode>('card');
  const [groups, setGroups] = useState<DavinciPeriodGroup[]>([]);
  const [spcSummary, setSpcSummary] = useState<Record<string, DavinciSpcSummary>>({});
  const [selectedPeriod, setSelectedPeriod] = useState<DavinciPeriodKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, result] = await Promise.all([
        meta ? Promise.resolve(meta) : fetchDavinciMeta(),
        fetchDavinciIndicators(campus, mode),
      ]);
      setMeta(m);
      setGroups(result.groups);
      setSpcSummary(result.spc);
      setSelectedPeriod(prev =>
        prev !== null && result.groups.some(x => x.period === prev)
          ? prev
          : result.groups.length > 0 ? result.groups[result.groups.length - 1].period : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus, mode, dataVersion]);   // dataVersion：Header 匯入完成後觸發 reload

  useEffect(() => { load(); }, [load]);

  const currentGroup = groups.find(g => g.period === selectedPeriod) ?? null;

  const summary = useMemo(() => {
    if (!currentGroup || !meta) return null;
    const rates = currentGroup.indicators.filter(r =>
      meta.indicators.find(m => m.code === r.code)?.kind === 'rate',
    );
    return {
      totalIndicators: meta.indicators.length,
      nCases: currentGroup.indicators[0]?.n_cases ?? 0,
      eventCount: rates.reduce((s, r) => s + (r.numerator ?? 0), 0),
      collectedPeriods: groups.length,
      unfavorable: currentGroup.indicators.filter(r => r.rating !== 'neutral'),
    };
  }, [currentGroup, groups, meta]);

  const baselineWarning = useMemo(
    () => Object.values(spcSummary).some(s => s.insufficient || s.baseline_warning),
    [spcSummary],
  );

  return (
    <div className="space-y-4">
      {/* 月/季 + 期別 + 檢視切換 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {(['monthly', 'quarterly'] as DavinciMode[]).map(m => (
              <button
                key={m}
                onClick={() => {
                  // 點擊已選中的按鈕不得清空 selectedPeriod（load 不會重跑，會整頁空白）
                  if (m !== mode) { setMode(m); setSelectedPeriod(null); }
                }}
                className={`px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {m === 'monthly' ? '月' : '季'}
              </button>
            ))}
          </div>
          {groups.length > 0 && (
            <select
              value={String(selectedPeriod ?? '')}
              onChange={e =>
                // 以字串回查原 key，不可用 mode 猜型別（切換瞬間會 NaN → 空白）
                setSelectedPeriod(resolvePeriodValue(e.target.value, groups.map(g => g.period)))
              }
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              {groups.map(g => (
                <option key={String(g.period)} value={String(g.period)}>{g.period_label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {([
            ['card', LayoutGrid, '卡片'],
            ['table', Table2, '表格'],
            ['matrix', Grid3X3, '矩陣'],
          ] as const).map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              title={label}
              className={`px-2.5 py-1.5 ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="animate-spin" size={20} /> 載入中…
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={16} /> 無法載入資料：{error}
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center text-gray-400">
          <p className="text-sm">尚無 {campus} 院區的達文西資料</p>
          <p className="text-xs mt-1">點右上「匯入資料」上傳申報 xlsx 即可自動計算七項指標</p>
        </div>
      )}

      {!loading && !error && summary && currentGroup && meta && (
        <>
          {/* 頂部警示彙整列 */}
          {summary.unfavorable.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <div className="text-sm font-medium text-orange-800 flex items-center gap-1.5 mb-1">
                <AlertTriangle size={15} />
                {currentGroup.period_label} 需關注指標（{summary.unfavorable.length}）
              </div>
              <div className="flex flex-wrap gap-2">
                {summary.unfavorable.map(r => {
                  const m = meta.indicators.find(x => x.code === r.code);
                  return (
                    <span key={r.code} className="flex items-center gap-1 text-xs bg-white border border-orange-200 rounded px-2 py-1">
                      <RatingBadge rating={r.rating} small />
                      <span className="text-gray-700">{r.code} {m?.name}</span>
                      {r.signals[0] && <span className="text-gray-400">— {r.signals[0].message}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 統計摘要卡 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="監測指標數" value={summary.totalIndicators} />
            <SummaryCard label={mode === 'monthly' ? '本月手術人次' : '本季手術人次'} value={summary.nCases} />
            <SummaryCard
              label={mode === 'monthly' ? '本月事件數' : '本季事件數'}
              value={summary.eventCount}
              tone={summary.eventCount > 0 ? 'warn' : 'ok'}
            />
            <SummaryCard label={mode === 'monthly' ? '已收集月份' : '已收集季數'} value={summary.collectedPeriods} />
          </div>

          {/* 檢視主體 */}
          {view === 'card' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {meta.indicators.map(m => (
                <IndicatorCard
                  key={m.code}
                  meta={m}
                  groups={groups}
                  selectedPeriod={currentGroup.period}
                  campus={campus}
                />
              ))}
            </div>
          )}
          {view === 'table' && (
            <TableView metas={meta.indicators} groups={groups} selectedPeriod={currentGroup.period} campus={campus} />
          )}
          {view === 'matrix' && (
            <MatrixView metas={meta.indicators} groups={groups} campus={campus} />
          )}

          <p className="text-[11px] text-gray-400">
            比率型指標顯示 分子/分母（0 事件顯示 0/n）；連續型顯示{mode === 'monthly' ? '月' : '季'}平均與中位數。
            {baselineWarning && ' SPC 基線資料累積中（< 24 點）：管制界限僅供參考，評級以既有訊號判定。'}
            點擊指標卡可進入 SPC 趨勢與科別/醫師/術式下鑽。
          </p>
        </>
      )}

    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'warn';
}) {
  const valueClass =
    tone === 'warn' ? 'text-orange-600' : tone === 'ok' ? 'text-green-600' : 'text-gray-900';
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
    </div>
  );
}
