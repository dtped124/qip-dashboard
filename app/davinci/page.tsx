'use client';

/**
 * 達文西手術品質儀表板（Phase 1 最小可用）
 * - 院區切換（竹北/新竹可選、竹東反白停用）
 * - 四張統計摘要卡
 * - 七指標卡（單一面向「達文西手術品質」）
 * - 月切換 + 匯入資料
 *
 * 與 QIP 物理隔離：本頁與下層 components/lib 全為新檔，不修改 QIP 既有程式。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, Loader2, Upload } from 'lucide-react';
import { fetchDavinciIndicators, fetchDavinciMeta } from './lib/api';
import type { DavinciCampus, DavinciMeta, DavinciPeriodGroup } from './lib/types';
import { IndicatorCard } from './components/IndicatorCard';
import { ImportDialog } from './components/ImportDialog';

const CAMPUS_OPTIONS: { name: string; enabled: boolean }[] = [
  { name: '竹北', enabled: true },
  { name: '竹東', enabled: false },  // 達文西無此院區
  { name: '新竹', enabled: true },
];

export default function DavinciPage() {
  const [meta, setMeta] = useState<DavinciMeta | null>(null);
  const [campus, setCampus] = useState<DavinciCampus>('竹北');
  const [groups, setGroups] = useState<DavinciPeriodGroup[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, g] = await Promise.all([
        meta ? Promise.resolve(meta) : fetchDavinciMeta(),
        fetchDavinciIndicators(campus),
      ]);
      setMeta(m);
      setGroups(g);
      setSelectedPeriod(prev =>
        prev !== null && g.some(x => x.period === prev)
          ? prev
          : g.length > 0 ? g[g.length - 1].period : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus]);

  useEffect(() => { load(); }, [load]);

  const currentGroup = groups.find(g => g.period === selectedPeriod) ?? null;

  const summary = useMemo(() => {
    if (!currentGroup || !meta) return null;
    const rates = currentGroup.indicators.filter(r =>
      meta.indicators.find(m => m.code === r.indicator_code)?.kind === 'rate',
    );
    return {
      totalIndicators: meta.indicators.length,
      nCases: currentGroup.indicators[0]?.n_cases ?? 0,
      eventCount: rates.reduce((s, r) => s + (r.numerator ?? 0), 0),
      collectedMonths: groups.length,
    };
  }, [currentGroup, groups, meta]);

  return (
    <div className="space-y-4">
      {/* 標題列 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Bot size={22} className="text-blue-600" />
            達文西手術品質儀表板 — {campus}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            醫院評鑑 達文西指標監測（單一面向：{meta?.category ?? '達文西手術品質'}）
          </p>
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          <Upload size={15} /> 匯入資料
        </button>
      </div>

      {/* 院區 + 月份切換 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1">
          {CAMPUS_OPTIONS.map(c => (
            <button
              key={c.name}
              disabled={!c.enabled}
              onClick={() => c.enabled && setCampus(c.name as DavinciCampus)}
              title={c.enabled ? undefined : '達文西無竹東院區'}
              className={`py-1.5 px-4 rounded text-sm font-medium transition-colors ${
                !c.enabled
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : campus === c.name
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        {groups.length > 0 && (
          <select
            value={selectedPeriod ?? ''}
            onChange={e => setSelectedPeriod(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            {groups.map(g => (
              <option key={g.period} value={g.period}>{g.period_label}</option>
            ))}
          </select>
        )}
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
          {/* 統計摘要卡 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="監測指標數" value={summary.totalIndicators} />
            <SummaryCard label="本月手術人次" value={summary.nCases} />
            <SummaryCard
              label="本月事件數"
              value={summary.eventCount}
              tone={summary.eventCount > 0 ? 'warn' : 'ok'}
            />
            <SummaryCard label="已收集月份" value={summary.collectedMonths} />
          </div>

          {/* 指標卡 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {meta.indicators.map(m => (
              <IndicatorCard
                key={m.code}
                meta={m}
                groups={groups}
                selectedPeriod={currentGroup.period}
              />
            ))}
          </div>

          <p className="text-[11px] text-gray-400">
            比率型指標顯示 分子/分母（0 事件顯示 0/n）；連續型顯示月平均與中位數。
            SPC 管制圖與評級將於資料累積後啟用（&lt;6 點僅監測）。
          </p>
        </>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />
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
