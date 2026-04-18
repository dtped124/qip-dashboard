'use client';

import { useEffect, useState } from 'react';
import { Upload, Clock, FileSpreadsheet, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { ImportWizard } from '@/components/import/ImportWizard';
import type { ImportLog } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

async function getImportLogsFromAPI(): Promise<ImportLog[]> {
  const res = await fetch(`${API_BASE}/api/v1/imports/logs/`);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.data || []).map((log: Record<string, any>) => ({
    id: log.id,
    timestamp: new Date(log.created_at),
    fileName: log.file_name,
    fileSize: log.file_size,
    sheetsProcessed: log.sheets_processed || [],
    dataPointsNew: log.data_points_new,
    dataPointsUpdated: log.data_points_updated,
    dataPointsUnchanged: log.data_points_unchanged,
    revisionsDetected: 0,
    errors: log.errors || [],
  }));
}

interface WarningInfo {
  indicatorCode: string;
  campus: string;
  year: number;
  month: number;
  computedValue: number;
  cellValue: number;
  numerator: number;
  denominator: number;
}

function parseWarning(errorText: string): WarningInfo | null {
  const m = errorText.match(
    /^\[警告\] (\S+) (\S+) (\d+)年(\d+)月: n\/d 計算值 ([\d.]+) 與儲存格顯示值 ([\d.]+) 差異 [\d.]+ 倍 \(n=(\d+), d=(\d+)\)/
  );
  if (!m) return null;
  return {
    indicatorCode: m[1],
    campus: m[2],
    year: parseInt(m[3]),
    month: parseInt(m[4]),
    computedValue: parseFloat(m[5]),
    cellValue: parseFloat(m[6]),
    numerator: parseInt(m[7]),
    denominator: parseInt(m[8]),
  };
}

async function postCorrection(
  logId: number,
  info: WarningInfo,
  newValue: number | null,
  errorText: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/imports/correct-datapoint/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      indicator_code: info.indicatorCode,
      campus: info.campus,
      year: info.year,
      month: info.month,
      new_value: newValue,
      log_id: logId,
      error_text: errorText,
    }),
  });
  if (!res.ok) throw new Error('Correction failed');
}

export default function ImportPage() {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  // key: `${logId}-${errorText}` → 'correcting' | 'corrected'
  const [correctionState, setCorrectionState] = useState<Record<string, 'correcting' | 'corrected'>>({});

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await getImportLogsFromAPI();
      setLogs(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadLogs(); }, []);

  function handleWizardClose() {
    setShowWizard(false);
    loadLogs();
  }

  function toggleExpand(logId: number) {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      next.has(logId) ? next.delete(logId) : next.add(logId);
      return next;
    });
  }

  async function handleCorrect(logId: number, errorText: string, info: WarningInfo, newValue: number | null) {
    const key = `${logId}-${errorText}`;
    setCorrectionState(prev => ({ ...prev, [key]: 'correcting' }));
    try {
      await postCorrection(logId, info, newValue, errorText);
      setCorrectionState(prev => ({ ...prev, [key]: 'corrected' }));
      // Remove the error from local state
      setLogs(prev => prev.map(log =>
        log.id === logId
          ? { ...log, errors: log.errors.filter(e => e !== errorText) }
          : log
      ));
    } catch {
      setCorrectionState(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      alert('修正失敗，請稍後再試');
    }
  }

  function formatDate(d: Date): string {
    return new Date(d).toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">資料匯入</h1>
          <p className="text-sm text-gray-500 mt-1">上傳 Excel 檔案匯入 QIP 指標資料</p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Upload size={16} />
          匯入新資料
        </button>
      </div>

      <h2 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Clock size={18} className="text-gray-400" />
        匯入紀錄
      </h2>

      {loading ? (
        <div className="text-center py-12 text-gray-400">載入中...</div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center">
          <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">尚無匯入紀錄</p>
          <p className="text-sm text-gray-400 mt-1">點擊上方按鈕匯入第一份 Excel 資料</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map(log => {
            const isExpanded = expandedLogs.has(log.id!);
            const visibleErrors = isExpanded ? log.errors : log.errors.slice(0, 3);
            const hiddenCount = log.errors.length - 3;

            return (
              <div
                key={log.id}
                className="bg-white rounded-lg shadow-sm border border-gray-100 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet size={16} className="text-green-600" />
                      <span className="font-medium text-gray-800 text-sm">{log.fileName}</span>
                      <span className="text-xs text-gray-400">{formatSize(log.fileSize)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {formatDate(log.timestamp)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-600">新增 {log.dataPointsNew}</span>
                    <span className="text-blue-600">更新 {log.dataPointsUpdated}</span>
                    <span className="text-gray-400">未變 {log.dataPointsUnchanged}</span>
                  </div>
                </div>

                {/* 處理的工作表 */}
                {log.sheetsProcessed.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 flex-wrap">
                    {log.sheetsProcessed.map(s => (
                      <span key={s} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* 錯誤與警告 */}
                {log.errors.length > 0 && (
                  <div className="mt-3 border-t border-red-50 pt-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertCircle size={14} className="text-red-400 shrink-0" />
                      <span className="text-xs font-medium text-red-600">
                        {log.errors.length} 個警告／錯誤
                      </span>
                      {log.errors.length > 3 && (
                        <button
                          onClick={() => toggleExpand(log.id!)}
                          className="ml-auto flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600"
                        >
                          {isExpanded ? (
                            <><ChevronUp size={13} />收合</>
                          ) : (
                            <><ChevronDown size={13} />展開全部 ({log.errors.length})</>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {visibleErrors.map((err, i) => {
                        const warning = parseWarning(err);
                        const key = `${log.id}-${err}`;
                        const state = correctionState[key];

                        return (
                          <div key={i} className="text-xs text-red-600 bg-red-50 rounded p-2">
                            <div>{err}</div>

                            {/* 警告類型：提供修正按鈕 */}
                            {warning && state !== 'corrected' && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  disabled={state === 'correcting'}
                                  onClick={() => handleCorrect(log.id!, err, warning, null)}
                                  className="px-2 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 text-xs"
                                >
                                  ✓ n/d 值正確，僅移除警告
                                </button>
                                <button
                                  disabled={state === 'correcting'}
                                  onClick={() => handleCorrect(log.id!, err, warning, warning.cellValue)}
                                  className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50 text-xs"
                                >
                                  改用儲存格值 {warning.cellValue}
                                </button>
                                <button
                                  disabled={state === 'correcting'}
                                  onClick={() => handleCorrect(log.id!, err, warning, warning.computedValue)}
                                  className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 text-xs"
                                >
                                  改用 n/d 計算值 {warning.computedValue}
                                </button>
                              </div>
                            )}
                            {state === 'correcting' && (
                              <div className="mt-1 text-gray-400 text-xs">更新中...</div>
                            )}
                          </div>
                        );
                      })}

                      {!isExpanded && hiddenCount > 0 && (
                        <button
                          onClick={() => toggleExpand(log.id!)}
                          className="text-xs text-red-400 hover:text-red-600 flex items-center gap-0.5"
                        >
                          <ChevronDown size={13} />
                          還有 {hiddenCount} 個錯誤，點擊展開
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showWizard && <ImportWizard onClose={handleWizardClose} />}
    </div>
  );
}
