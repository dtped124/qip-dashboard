'use client';

/**
 * 達文西匯入對話框（兩段式：上傳預覽 → 確認寫入）
 * 報告呈現：期別摘要（人次/七指標）、清洗明細、矛盾、待人工確認。
 */

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { confirmDavinciImport, uploadDavinciExcel } from '../lib/api';
import type { DavinciImportPreview } from '../lib/types';
import { periodLabel } from '../lib/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

const FLAG_LABELS: Record<string, string> = {
  blood_minimum_as_zero: 'Minimum → 0',
  blood_upper_bound: '<50ml → 50（近似）',
  unit_stripped: '去除單位',
  value_unparsed: '無法解析 → 空值',
  yn_blank_as_n: '空白視為 N',
  yn_unrecognized_as_n: '非 Y/N 的值 → 視為 N（請人工確認）',
  yn_conflict_content_wins: '旗標 N 但內容欄有值 → 視為 Y',
  unknown_event_code: '未知事件代碼',
  date_parse_failed: '日期無法解析',
  merged_value_mismatch: '同帳號多列的手術時間/出血量不一致（已取較大值）',
};

export function ImportDialog({ open, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'preview' | 'confirming' | 'done'>('idle');
  const [preview, setPreview] = useState<DavinciImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setPhase('idle');
    setPreview(null);
    setError(null);
    setDoneMsg(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setError(null);
    setPhase('uploading');
    try {
      const p = await uploadDavinciExcel(file);
      setPreview(p);
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setPhase('confirming');
    try {
      const r = await confirmDavinciImport(preview.log_id);
      setDoneMsg(
        `已寫入 ${r.cases_written} 人次、指標值新增 ${r.values_created} / 更新 ${r.values_updated}`,
      );
      setPhase('done');
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('preview');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Upload size={18} /> 匯入達文西申報資料
          </h2>
          <button onClick={() => { reset(); onClose(); }} className="p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {phase === 'idle' && (
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-10 text-center cursor-pointer hover:border-blue-400"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mx-auto text-gray-400 mb-2" size={32} />
              <p className="text-sm text-gray-600">點擊選擇達文西申報 xlsx（可含多分頁）</p>
              <p className="text-xs text-gray-400 mt-1">
                匯入即自動去重（帳號）、清洗、計算七指標；同月份重複匯入為覆蓋
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          )}

          {(phase === 'uploading' || phase === 'confirming') && (
            <div className="flex items-center justify-center gap-2 py-10 text-gray-500">
              <Loader2 className="animate-spin" size={20} />
              {phase === 'uploading' ? '解析中（去重、清洗、計算指標）…' : '寫入資料庫中…'}
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col items-center gap-2 py-10 text-green-700">
              <CheckCircle2 size={32} />
              <p className="text-sm">{doneMsg}</p>
            </div>
          )}

          {phase === 'preview' && preview && (
            <>
              {/* 期別摘要 */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  匯入摘要 — {preview.file_name}（原始 {preview.rows_raw} 列 → 去重 {preview.cases_dedup} 人次）
                </h3>
                <div className="space-y-3">
                  {preview.report.summary.map(s => (
                    <div key={`${s.campus}-${s.period}`} className="border rounded-lg p-3">
                      <div className="text-sm font-medium text-gray-800 mb-2">
                        {s.campus} {s.period_label}：{s.cases_dedup} 人次
                        <span className="text-xs text-gray-400 ml-2">（原始 {s.rows_raw} 列）</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="text-left font-normal">指標</th>
                            <th className="text-right font-normal">分子/分母</th>
                            <th className="text-right font-normal">值</th>
                            <th className="text-right font-normal">中位數</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.indicators.map(ind => (
                            <tr key={ind.code} className="border-t border-gray-100">
                              <td className="py-1">{ind.code}</td>
                              <td className="text-right">
                                {ind.numerator != null ? `${ind.numerator}/${ind.denominator}` : `n=${ind.denominator}`}
                              </td>
                              <td className="text-right">{ind.value ?? '—'}</td>
                              <td className="text-right">{ind.median ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>

              {/* 矛盾（最重要，紅色） */}
              {preview.report.conflicts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-red-700 flex items-center gap-1 mb-1">
                    <AlertTriangle size={14} /> 矛盾資料（{preview.report.conflicts.length}）— 已依規則處理，請回查填報單位
                  </h4>
                  <ul className="text-xs text-red-600 space-y-0.5">
                    {preview.report.conflicts.map((c, i) => (
                      <li key={i}>
                        {c.campus} {periodLabel(c.period)}
                        {c.sheet !== '-' && ` 分頁「${c.sheet}」`}列 {Array.isArray(c.row) ? c.row.join(',') : c.row}：
                        {c.field} — {FLAG_LABELS[c.flag] ?? c.flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 待人工確認 */}
              {preview.report.pending.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-amber-700 mb-1">
                    待人工確認（{preview.report.pending.length}）— 這些列未寫入
                  </h4>
                  <ul className="text-xs text-amber-700 space-y-0.5">
                    {preview.report.pending.map((p, i) => (
                      <li key={i}>分頁「{p.sheet}」列 {p.row}：{p.detail}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 清洗明細（可收合） */}
              {preview.report.cleaned.length > 0 && (
                <details className="border rounded-lg p-3">
                  <summary className="text-sm text-gray-600 cursor-pointer">
                    清洗/近似明細（{preview.report.cleaned.length}）
                    {preview.report.masked > 0 && `，系統遮罩 ${preview.report.masked} 筆個資`}
                  </summary>
                  <ul className="text-xs text-gray-500 mt-2 space-y-0.5">
                    {preview.report.cleaned.map((c, i) => (
                      <li key={i}>
                        {c.campus} {periodLabel(c.period)} 列 {c.row}：{c.field}「{c.raw}」→ {c.cleaned ?? '空值'}
                        （{FLAG_LABELS[c.flag] ?? c.flag}）
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {preview.report.header_warnings.length > 0 && (
                <div className="text-xs text-gray-400">
                  {preview.report.header_warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          {phase === 'preview' && (
            <>
              <button
                onClick={reset}
                className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                重新選擇
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                確認匯入
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              onClick={() => { reset(); onClose(); }}
              className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
