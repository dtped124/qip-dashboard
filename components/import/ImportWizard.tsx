'use client';

import { useState, useCallback } from 'react';
import { useDashboardStore } from '@/lib/store/dashboardStore';
import { parseQIPExcel } from '@/lib/excel-parser';
import { applyStatus } from '@/lib/status-engine';
import { applyTrends } from '@/lib/trend-calculator';
import { createImportLog, bulkUpsertDataPoints } from '@/lib/db/operations';
import type { DataPointRecord } from '@/lib/types';
import * as XLSX from 'xlsx';
import {
  Upload, X, FileSpreadsheet, CheckCircle, AlertCircle,
  ArrowRight, ArrowLeft, FileCheck, FileDiff, Loader2,
} from 'lucide-react';
import type { IndicatorData } from '@/lib/types';

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'preview' | 'diff' | 'done';

interface ParsedResult {
  indicators: IndicatorData[];
  errors: string[];
  fileName: string;
  fileSize: number;
  sheetsCount: number;
  dateRange: string;
}

export function ImportWizard({ onClose }: Props) {
  const setIndicators = useDashboardStore(s => s.setIndicators);
  const [step, setStep] = useState<Step>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importing, setImporting] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });

      const { indicators, errors } = parseQIPExcel(workbook);

      // 找出資料期間範圍
      let minYear = Infinity, maxYear = -Infinity;
      for (const ind of indicators) {
        for (const dp of ind.monthlyData) {
          if (dp.value !== null) {
            if (dp.year < minYear) minYear = dp.year;
            if (dp.year > maxYear) maxYear = dp.year;
          }
        }
      }

      setParsed({
        indicators,
        errors,
        fileName: file.name,
        fileSize: file.size,
        sheetsCount: workbook.SheetNames.length,
        dateRange: minYear !== Infinity ? `民國 ${minYear} 年 - ${maxYear} 年` : '無數據',
      });
      setStep('preview');
    } catch (err) {
      setParsed({
        indicators: [],
        errors: [String(err)],
        fileName: file.name,
        fileSize: file.size,
        sheetsCount: 0,
        dateRange: '',
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

  const confirmImport = useCallback(async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      let processed = applyStatus(parsed.indicators);
      processed = applyTrends(processed);

      // 合併：保留其他院區/指標的現有資料，只更新本次匯入的部分
      const existingIndicators = useDashboardStore.getState().indicators;
      const importedKeys = new Set(
        processed.map(i => `${i.meta.code}:${i.campus}`)
      );
      const kept = existingIndicators.filter(
        i => !importedKeys.has(`${i.meta.code}:${i.campus}`)
      );
      setIndicators([...kept, ...processed]);

      // 將數據點寫入 IndexedDB（含分子/分母供 P/U Chart 使用）
      const dataPointRecords: DataPointRecord[] = [];
      for (const ind of processed) {
        for (const dp of ind.monthlyData) {
          const record: DataPointRecord = {
            indicatorCode: ind.meta.code,
            campus: ind.campus,
            year: dp.year,
            month: dp.month,
            value: dp.value,
          };
          if (dp.numerator !== undefined) record.numerator = dp.numerator;
          if (dp.denominator !== undefined) record.denominator = dp.denominator;
          dataPointRecords.push(record);
        }
      }

      const stats = await bulkUpsertDataPoints(dataPointRecords);
      setImportStats(stats);

      // 寫入匯入紀錄
      await createImportLog({
        timestamp: new Date(),
        fileName: parsed.fileName,
        fileSize: parsed.fileSize,
        sheetsProcessed: [`${parsed.sheetsCount} 張工作表`],
        dataPointsNew: stats.inserted,
        dataPointsUpdated: stats.updated,
        dataPointsUnchanged: stats.unchanged,
        revisionsDetected: stats.updated,
        errors: parsed.errors,
      });

      setStep('done');
    } catch {
      // handle error
    } finally {
      setImporting(false);
    }
  }, [parsed, setIndicators]);

  // 統計解析結果
  const campusCounts = parsed ? {
    zhubei: parsed.indicators.filter(i => i.campus === '竹北').length,
    zhudong: parsed.indicators.filter(i => i.campus === '竹東').length,
    hsinchu: parsed.indicators.filter(i => i.campus === '新竹').length,
  } : { zhubei: 0, zhudong: 0, hsinchu: 0 };

  const totalDataPoints = parsed
    ? parsed.indicators.reduce((sum, ind) =>
      sum + ind.monthlyData.filter(dp => dp.value !== null).length, 0)
    : 0;

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
              {/* 檔案資訊 */}
              <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-4">
                <FileCheck size={24} className="text-blue-500" />
                <div>
                  <div className="font-medium text-gray-800">{parsed.fileName}</div>
                  <div className="text-xs text-gray-500">
                    {(parsed.fileSize / 1024).toFixed(0)} KB | {parsed.sheetsCount} 張工作表
                  </div>
                </div>
              </div>

              {/* 解析摘要 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">辨識指標數</div>
                  <div className="text-xl font-bold text-gray-800">{parsed.indicators.length}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">數據點數</div>
                  <div className="text-xl font-bold text-gray-800">{totalDataPoints}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">院區分布</div>
                  <div className="text-sm text-gray-800">
                    {[
                      campusCounts.zhubei > 0 && `竹北 ${campusCounts.zhubei}`,
                      campusCounts.zhudong > 0 && `竹東 ${campusCounts.zhudong}`,
                      campusCounts.hsinchu > 0 && `新竹 ${campusCounts.hsinchu}`,
                    ].filter(Boolean).join(' | ')}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">資料期間</div>
                  <div className="text-sm text-gray-800">{parsed.dateRange}</div>
                </div>
              </div>

              {/* 錯誤/警告 */}
              {parsed.errors.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="text-xs font-medium text-yellow-700 mb-1">
                    {parsed.errors.length} 個警告
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-0.5">
                    {parsed.errors.map((err, i) => (
                      <div key={i} className="text-xs text-yellow-600">{err}</div>
                    ))}
                  </div>
                </div>
              )}

              {parsed.indicators.length === 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                  <AlertCircle size={32} className="mx-auto text-red-400 mb-2" />
                  <div className="text-sm text-red-700">無法解析任何指標數據</div>
                </div>
              )}
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
                    將載入 {parsed.indicators.length} 項指標、{totalDataPoints} 個數據點
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600 space-y-2">
                  <div className="flex items-center justify-between">
                    <span>指標數</span>
                    <span className="font-medium">{parsed.indicators.length} 項</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>數據點</span>
                    <span className="font-medium">{totalDataPoints} 筆</span>
                  </div>
                  {campusCounts.zhubei > 0 && (
                    <div className="flex items-center justify-between">
                      <span>竹北院區</span>
                      <span className="font-medium">{campusCounts.zhubei} 項指標</span>
                    </div>
                  )}
                  {campusCounts.zhudong > 0 && (
                    <div className="flex items-center justify-between">
                      <span>竹東院區</span>
                      <span className="font-medium">{campusCounts.zhudong} 項指標</span>
                    </div>
                  )}
                  {campusCounts.hsinchu > 0 && (
                    <div className="flex items-center justify-between">
                      <span>新竹院區</span>
                      <span className="font-medium">{campusCounts.hsinchu} 項指標</span>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-gray-400 text-center">
                匯入後將自動執行三重異常偵測分析
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <div className="text-center space-y-4 py-6">
              <CheckCircle size={48} className="mx-auto text-green-500" />
              <div>
                <p className="text-lg font-medium text-gray-800">匯入成功</p>
                <p className="text-sm text-gray-500">
                  共載入 {parsed?.indicators.length} 項指標、{totalDataPoints} 個數據點
                </p>
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
                <p className="text-xs text-gray-400 mt-1">
                  已完成異常偵測分析
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
            {step === 'preview' && parsed && parsed.indicators.length > 0 && (
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
