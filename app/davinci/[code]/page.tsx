'use client';

/**
 * 達文西指標詳情頁：SPC 趨勢（I-MR / P 雙層）+ WER 訊號列表 + 逐層下鑽
 * 路徑：/davinci/DV01
 *
 * 院區由達文西外框（DavinciSidebar）的院區選擇控制（store），
 * 標題列由 DavinciHeader 提供 — 操作方式與 QIP 指標詳情一致。
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { fetchDavinciSeries } from '../lib/api';
import type { DavinciMode, DavinciPeriodKey, DavinciSeries } from '../lib/types';
import { useDavinciStore } from '../lib/store';
import { resolvePeriodValue, unitLabel } from '../lib/ui';
import { SpcChart } from '../components/SpcChart';
import { DrilldownPanel } from '../components/DrilldownPanel';
import { RatingBadge } from '../components/RatingBadge';

export default function DavinciDetailPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code || '').toUpperCase();

  const campus = useDavinciStore(s => s.campus);
  const mode = useDavinciStore(s => s.mode);
  const setMode = useDavinciStore(s => s.setMode);
  const dataVersion = useDavinciStore(s => s.dataVersion);

  const [series, setSeries] = useState<DavinciSeries | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<DavinciPeriodKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchDavinciSeries(code, campus, mode);
      setSeries(s);
      setSelectedPeriod(prev =>
        prev !== null && s.points.some(p => p.period === prev)
          ? prev
          : s.points.length > 0 ? s.points[s.points.length - 1].period : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, campus, mode, dataVersion]);   // dataVersion：Header 匯入完成後 reload

  useEffect(() => { load(); }, [load]);

  const currentPoint = series?.points.find(p => p.period === selectedPeriod) ?? null;
  const unit = unitLabel(series?.unit ?? '');
  const highSignals = (series?.spc.signals ?? []).filter(s => s.side === 'high');
  const lowSignals = (series?.spc.signals ?? []).filter(s => s.side === 'low');

  return (
    <div className="space-y-4">
      {/* 標題列（院區/匯入匯出在外框，這裡只有指標身分與模式） */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/davinci" className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <span className="text-gray-400 font-normal">{code}</span>
              {series?.name ?? '…'}
              {series && <RatingBadge rating={series.spc.rating} />}
            </h1>
            <p className="text-xs text-gray-400">
              達文西手術品質 · {series?.kind === 'rate' ? '比率型（越低越好）' : `連續型（${unit}，越低越好）`}
            </p>
          </div>
        </div>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {(['monthly', 'quarterly'] as DavinciMode[]).map(m => (
            <button key={m}
                    onClick={() => {
                      if (m !== mode) { setMode(m); setSelectedPeriod(null); }
                    }}
                    className={`px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {m === 'monthly' ? '月' : '季'}
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
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {!loading && !error && series && (
        <>
          {/* 關鍵數值列 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-400 flex items-center justify-between">
                <span>{currentPoint?.label ?? '最新'} 值</span>
                {series.points.length > 1 && (
                  <select
                    value={String(selectedPeriod ?? '')}
                    onChange={e => setSelectedPeriod(resolvePeriodValue(e.target.value, series.points.map(p => p.period)))}
                    className="text-xs border border-gray-200 rounded px-1"
                  >
                    {series.points.map(p => (
                      <option key={String(p.period)} value={String(p.period)}>{p.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="text-2xl font-bold mt-1">
                {series.kind === 'rate' && currentPoint
                  ? <>{currentPoint.numerator}<span className="text-lg text-gray-400 font-normal">/{currentPoint.denominator}</span>
                      <span className="text-sm text-gray-500 font-normal ml-2">{currentPoint.value}%</span></>
                  : <>{currentPoint?.value ?? '—'}<span className="text-sm text-gray-400 font-normal ml-1">{unit}</span></>}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-400">CL（基線 {series.spc.baseline_n} 點）</div>
              <div className="text-2xl font-bold mt-1">{series.spc.cl ?? '—'}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-400">UCL / LCL（3σ）</div>
              <div className="text-lg font-bold mt-1">
                {series.spc.ucl ?? '—'} <span className="text-gray-300">/</span> {series.spc.lcl ?? '—'}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="text-xs text-gray-400">評級</div>
              <div className="mt-1.5"><RatingBadge rating={series.spc.rating} /></div>
            </div>
          </div>

          {/* SPC 圖 */}
          <SpcChart series={series} />

          {/* WER 訊號列表 */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">WER 訊號</h3>
            {highSignals.length === 0 && lowSignals.length === 0 ? (
              <p className="text-sm text-gray-300">
                {series.spc.insufficient ? '資料不足（< 6 點），尚未進行 WER 偵測' : '無訊號 — 製程穩定'}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {highSignals.map((s, i) => (
                  <li key={`h${i}`} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.severity === 'alert' ? 'bg-red-500' : s.severity === 'warning' ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                    <span className="text-gray-700">{s.label}</span>
                    <span className="text-gray-500">{s.message}</span>
                    <span className="text-xs text-gray-300">{s.rule}</span>
                  </li>
                ))}
                {lowSignals.map((s, i) => (
                  <li key={`l${i}`} className="flex items-center gap-2 text-gray-400">
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                    <span>{s.label}</span>
                    <span>{s.message}</span>
                    <span className="text-xs text-gray-300">{s.rule}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 下鑽 */}
          {currentPoint && (
            <DrilldownPanel
              code={code}
              kind={series.kind}
              unit={series.unit}
              campus={campus}
              period={currentPoint.period}
              periodLabel={currentPoint.label}
            />
          )}
        </>
      )}
    </div>
  );
}
