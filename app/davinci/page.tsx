'use client';

/**
 * 達文西手術品質儀表板 — 總覽
 * 頁面結構 1:1 鏡射 QIP 首頁（app/page.tsx）：
 *   警示橫幅 → 總覽統計四卡 → 標題列（月/季 + 檢視切換）→
 *   面向分組指標卡 / 表格 / 狀態矩陣
 * 標題列/院區切換/匯入匯出由達文西外框（DavinciSidebar/DavinciHeader）提供。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarDays, FileSpreadsheet, Grid3x3, LayoutGrid, Loader2, Table } from 'lucide-react';
import { fetchDavinciIndicators, fetchDavinciMeta } from './lib/api';
import type {
  DavinciMeta,
  DavinciMode,
  DavinciPeriodGroup,
  DavinciPeriodKey,
  DavinciSpcSummary,
} from './lib/types';
import { useDavinciStore } from './lib/store';
import { DAVINCI_COLOR, resolvePeriodValue } from './lib/ui';
import { IndicatorCard } from './components/IndicatorCard';
import { MatrixView, TableView } from './components/Views';
import { DavinciAlertBanner } from './components/DavinciAlertBanner';
import { DavinciOverviewStats } from './components/DavinciOverviewStats';

type ViewMode = 'card' | 'table' | 'heatmap';

export default function DavinciPage() {
  const campus = useDavinciStore(s => s.campus);
  const mode = useDavinciStore(s => s.mode);
  const setMode = useDavinciStore(s => s.setMode);
  const dataVersion = useDavinciStore(s => s.dataVersion);

  const [meta, setMeta] = useState<DavinciMeta | null>(null);
  const [view, setView] = useState<ViewMode>('card');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unfavorable'>('all');
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

  // 警示/注意篩選（鏡射 QIP OverviewStats 點擊行為）
  const visibleMetas = useMemo(() => {
    if (!meta) return [];
    if (statusFilter === 'all' || !currentGroup) return meta.indicators;
    const unfavorable = new Set(
      currentGroup.indicators.filter(r => r.rating !== 'neutral').map(r => r.code),
    );
    return meta.indicators.filter(m => unfavorable.has(m.code));
  }, [meta, statusFilter, currentGroup]);

  const baselineWarning = useMemo(
    () => Object.values(spcSummary).some(s => s.insufficient || s.baseline_warning),
    [spcSummary],
  );

  // 初始載入中（鏡射 QIP 首頁）
  if (loading && groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Loader2 size={48} className="text-blue-400 animate-spin mb-4" />
        <p className="text-sm text-gray-500">載入達文西資料中...</p>
      </div>
    );
  }

  // API 錯誤（鏡射 QIP 首頁）
  if (error && groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div className="text-red-500 text-4xl mb-4">⚠</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">無法連線後端</h2>
        <p className="text-sm text-red-500 mb-4 max-w-md">{error}</p>
        <button
          onClick={load}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
        >
          重試連線
        </button>
      </div>
    );
  }

  // 空狀態（鏡射 QIP 首頁）
  if (!loading && groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <FileSpreadsheet size={64} className="text-gray-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-2">尚無 {campus} 院區的達文西資料</h2>
        <p className="text-sm text-gray-500 mb-6 max-w-md">
          請點擊右上角「匯入資料」按鈕，上傳達文西申報 Excel 檔案（.xlsx），
          系統會自動去重、清洗並計算七項指標。
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* 警示橫幅 */}
      {currentGroup && meta && (
        <DavinciAlertBanner
          rows={currentGroup.indicators}
          metas={meta.indicators}
          campus={campus}
          periodLabel={currentGroup.period_label}
        />
      )}

      {/* 總覽統計 */}
      {currentGroup && (
        <DavinciOverviewStats
          rows={currentGroup.indicators}
          collectedPeriods={groups.length}
          periodUnit={mode === 'monthly' ? '月' : '季'}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />
      )}

      {/* 檢視模式切換（鏡射 QIP 標題列 + PeriodToggle + ViewToggle） */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          {view === 'heatmap' ? '狀態矩陣' : '全部指標'}
          <span className="text-sm font-normal text-gray-400">
            {view !== 'heatmap' && `${visibleMetas.length} 項`}
          </span>
          {statusFilter === 'unfavorable' && (
            <span className="text-xs font-normal text-red-500">（僅顯示警示/注意）</span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          {/* 期別選擇 */}
          {groups.length > 0 && (
            <select
              value={String(selectedPeriod ?? '')}
              onChange={e =>
                setSelectedPeriod(resolvePeriodValue(e.target.value, groups.map(g => g.period)))
              }
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              {groups.map(g => (
                <option key={String(g.period)} value={String(g.period)}>{g.period_label}</option>
              ))}
            </select>
          )}
          {/* 月/季切換（鏡射 QIP PeriodToggle） */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {([['monthly', '月', Calendar], ['quarterly', '季', CalendarDays]] as const).map(([m, label, Icon]) => (
              <button
                key={m}
                onClick={() => {
                  if (m !== mode) { setMode(m as DavinciMode); setSelectedPeriod(null); }
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-sm transition-colors ${
                  mode === m
                    ? 'bg-white shadow-sm text-gray-800 font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {/* 檢視切換（鏡射 QIP ViewToggle） */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {([['card', '卡片', LayoutGrid], ['table', '表格', Table], ['heatmap', '矩陣', Grid3x3]] as const).map(([v, label, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v as ViewMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  view === v
                    ? 'bg-white shadow-sm text-gray-800 font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 指標列表 / 表格 / 熱力圖 */}
      {currentGroup && meta && (
        view === 'heatmap' ? (
          <MatrixView metas={visibleMetas} groups={groups} />
        ) : view === 'card' ? (
          /* 面向分組（鏡射 QIP CategorySection，達文西為單一面向） */
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: DAVINCI_COLOR }} />
              <h2 className="text-lg font-bold text-gray-800">達文西手術品質</h2>
              <span className="text-sm text-gray-400">{visibleMetas.length} 項指標</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visibleMetas.map(m => (
                <IndicatorCard
                  key={m.code}
                  meta={m}
                  groups={groups}
                  selectedPeriod={currentGroup.period}
                />
              ))}
            </div>
          </section>
        ) : (
          <TableView metas={visibleMetas} groups={groups} selectedPeriod={currentGroup.period} />
        )
      )}

      {baselineWarning && (
        <p className="text-[11px] text-gray-400 mt-2">
          SPC 基線資料累積中（&lt; 24 點）：管制界限僅供參考，評級以既有 WER 訊號判定。
        </p>
      )}
    </div>
  );
}
