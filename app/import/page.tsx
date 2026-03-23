'use client';

import { useEffect, useState } from 'react';
import { Upload, Clock, FileSpreadsheet, AlertCircle } from 'lucide-react';
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

export default function ImportPage() {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await getImportLogsFromAPI();
      setLogs(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  function handleWizardClose() {
    setShowWizard(false);
    loadLogs();
  }

  function formatDate(d: Date): string {
    const date = new Date(d);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
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

      {/* 匯入紀錄 */}
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
          {logs.map(log => (
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
                  <span className="text-green-600">
                    新增 {log.dataPointsNew}
                  </span>
                  <span className="text-blue-600">
                    更新 {log.dataPointsUpdated}
                  </span>
                  <span className="text-gray-400">
                    未變 {log.dataPointsUnchanged}
                  </span>
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

              {/* 錯誤 */}
              {log.errors.length > 0 && (
                <div className="mt-2 flex items-start gap-1.5">
                  <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-red-600 space-y-0.5">
                    {log.errors.slice(0, 3).map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                    {log.errors.length > 3 && (
                      <div className="text-red-400">...還有 {log.errors.length - 3} 個錯誤</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showWizard && <ImportWizard onClose={handleWizardClose} />}
    </div>
  );
}
