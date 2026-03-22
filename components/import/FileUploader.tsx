'use client';

import { useState, useCallback } from 'react';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { parseQIPExcel } from '@/lib/excel-parser';
import { applyStatus } from '@/lib/status-engine';
import { applyTrends } from '@/lib/trend-calculator';
import * as XLSX from 'xlsx';
import { Upload, X, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function FileUploader({ onClose }: Props) {
  const setIndicators = useDashboardStore(s => s.setIndicators);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<{ count: number; errors: string[] } | null>(null);

  const processFile = useCallback(async (file: File) => {
    setStatus('parsing');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });

      const { indicators, errors } = parseQIPExcel(workbook);

      // 套用狀態和趨勢
      let processed = applyStatus(indicators);
      processed = applyTrends(processed);

      setIndicators(processed);
      setResult({ count: processed.length, errors });
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setResult({ count: 0, errors: [String(err)] });
    }
  }, [setIndicators]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-800">匯入 Excel 資料</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {status === 'idle' || status === 'parsing' ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {status === 'parsing' ? (
                <div className="space-y-3">
                  <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-gray-600">解析中...</p>
                </div>
              ) : (
                <>
                  <FileSpreadsheet size={40} className="mx-auto text-gray-300 mb-3" />
                  <p className="text-sm text-gray-600 mb-2">
                    拖放 .xls / .xlsx 檔案到此處
                  </p>
                  <p className="text-xs text-gray-400 mb-4">或</p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer transition-colors">
                    <Upload size={16} />
                    選擇檔案
                    <input
                      type="file"
                      accept=".xls,.xlsx"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </>
              )}
            </div>
          ) : status === 'success' ? (
            <div className="text-center space-y-4">
              <CheckCircle size={48} className="mx-auto text-green-500" />
              <div>
                <p className="text-lg font-medium text-gray-800">匯入成功</p>
                <p className="text-sm text-gray-500">
                  共解析 {result?.count} 項指標數據
                </p>
              </div>
              {result && result.errors.length > 0 && (
                <div className="text-left bg-yellow-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-yellow-700 mb-1">
                    {result.errors.length} 個警告:
                  </p>
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-xs text-yellow-600">{err}</p>
                  ))}
                </div>
              )}
              <button
                onClick={onClose}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                關閉
              </button>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <AlertCircle size={48} className="mx-auto text-red-500" />
              <div>
                <p className="text-lg font-medium text-gray-800">匯入失敗</p>
                <p className="text-sm text-red-600">
                  {result?.errors[0]}
                </p>
              </div>
              <button
                onClick={() => { setStatus('idle'); setResult(null); }}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                重試
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
