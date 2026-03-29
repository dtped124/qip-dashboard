'use client';

import { useState, useCallback } from 'react';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { uploadExcel, loadDashboardFromAPI } from '@/lib/api';
import {
  Upload, X, FileSpreadsheet, CheckCircle,
  ArrowRight, ArrowLeft, FileCheck, FileDiff, Loader2,
} from 'lucide-react';

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'preview' | 'diff' | 'done';

interface UploadedFileInfo {
  file: File;
  fileName: string;
  fileSize: number;
}

export function ImportWizard({ onClose }: Props) {
  const store = useDashboardStore();
  const [step, setStep] = useState<Step>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [fileInfo, setFileInfo] = useState<UploadedFileInfo | null>(null);
  const [importing, setImporting] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      setFileInfo({
        file,
        fileName: file.name,
        fileSize: file.size,
      });
      setStep('preview');
    } finally {
      setParsing(false);
    }
  }, []);

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

  const [importStats, setImportStats] = useState<{ inserted: number; updated: number; unchanged: number } | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const confirmImport = useCallback(async () => {
    if (!fileInfo) return;
    setImporting(true);
    setImportErrors([]);
    try {
      // Upload to Django API (server-side parsing + persistence + anomaly detection)
      const result = await uploadExcel(fileInfo.file);
      setImportStats({
        inserted: result.new,
        updated: result.updated,
        unchanged: result.unchanged,
      });
      if (result.errors?.length > 0) {
        setImportErrors(result.errors);
      }

      // Reload dashboard data from API
      const loaded = await loadDashboardFromAPI(store.campus);
      store.setIndicators(loaded);

      setStep('done');
    } catch (err) {
      setImportErrors([String(err)]);
    } finally {
      setImporting(false);
    }
  }, [fileInfo, store]);

  const parsed = fileInfo; // Alias for template compatibility

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-gray-800">匯入資料</h3>
            {/* 步驟指示器 */}
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <span className={step === 'upload' ? 'text-blue-600 font-medium' : ''}>上傳</span>
              <ArrowRight size={10} />
              <span className={step === 'preview' ? 'text-blue-600 font-medium' : ''}>預覽</span>
              <ArrowRight size={10} />
              <span className={step === 'diff' ? 'text-blue-600 font-medium' : ''}>確認</span>
              <ArrowRight size={10} />
              <span className={step === 'done' ? 'text-blue-600 font-medium' : ''}>完成</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {parsing ? (
                <div className="space-y-3">
                  <Loader2 size={40} className="mx-auto text-blue-500 animate-spin" />
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
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && parsed && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-4">
                <FileCheck size={24} className="text-blue-500" />
                <div>
                  <div className="font-medium text-gray-800">{parsed.fileName}</div>
                  <div className="text-xs text-gray-500">
                    {(parsed.fileSize / 1024).toFixed(0)} KB
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
                <p>檔案將上傳至伺服器進行解析與匯入，包含：</p>
                <ul className="mt-2 space-y-1 text-xs text-gray-500">
                  <li>• 自動辨識工作表（竹北/竹東/新竹）</li>
                  <li>• 解析指標代碼與月份數據</li>
                  <li>• 提取分子/分母供管制圖使用</li>
                  <li>• 執行三重異常偵測分析</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 3: Diff / Confirm */}
          {step === 'diff' && parsed && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-green-50 rounded-lg p-4">
                <FileDiff size={24} className="text-green-500" />
                <div>
                  <div className="font-medium text-gray-800">準備匯入</div>
                  <div className="text-xs text-gray-500">
                    {parsed.fileName} ({(parsed.fileSize / 1024).toFixed(0)} KB)
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
                <p>點擊「確認匯入」後，系統將：</p>
                <ol className="mt-2 space-y-1 text-xs text-gray-500 list-decimal ml-4">
                  <li>上傳檔案至伺服器解析</li>
                  <li>比對現有資料（新增/更新/未變更）</li>
                  <li>執行三重異常偵測（管制圖+月增減+同儕比較）</li>
                  <li>自動重新整理儀表板</li>
                </ol>
              </div>

              {importErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  {importErrors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <div className="text-center space-y-4 py-6">
              <CheckCircle size={48} className="mx-auto text-green-500" />
              <div>
                <p className="text-lg font-medium text-gray-800">匯入成功</p>
                {importStats && (
                  <div className="flex items-center justify-center gap-4 mt-2 text-xs">
                    {importStats.inserted > 0 && (
                      <span className="text-green-600">新增 {importStats.inserted} 筆</span>
                    )}
                    {importStats.updated > 0 && (
                      <span className="text-blue-600">更新 {importStats.updated} 筆</span>
                    )}
                    {importStats.unchanged > 0 && (
                      <span className="text-gray-400">未變 {importStats.unchanged} 筆</span>
                    )}
                  </div>
                )}
                {importErrors.length > 0 && (
                  <div className="mt-3 text-left bg-yellow-50 rounded-lg p-3 max-h-32 overflow-y-auto">
                    {importErrors.slice(0, 5).map((e, i) => (
                      <p key={i} className="text-xs text-yellow-600">{e}</p>
                    ))}
                    {importErrors.length > 5 && (
                      <p className="text-xs text-yellow-400">...還有 {importErrors.length - 5} 個警告</p>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  已完成異常偵測分析，儀表板已自動更新
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-100 shrink-0">
          <div>
            {(step === 'preview' || step === 'diff') && (
              <button
                onClick={() => setStep(step === 'diff' ? 'preview' : 'upload')}
                className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                <ArrowLeft size={14} /> 上一步
              </button>
            )}
          </div>
          <div>
            {step === 'preview' && parsed && (
              <button
                onClick={() => setStep('diff')}
                className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                下一步 <ArrowRight size={14} />
              </button>
            )}
            {step === 'diff' && (
              <button
                onClick={confirmImport}
                disabled={importing}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {importing ? (
                  <><Loader2 size={14} className="animate-spin" /> 匯入中...</>
                ) : (
                  <><CheckCircle size={14} /> 確認匯入</>
                )}
              </button>
            )}
            {step === 'done' && (
              <button
                onClick={onClose}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                完成
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
