'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { BarChart3, Upload, CheckCircle2, AlertTriangle, ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { parseTcpiExcel, isTcpiFormat } from '@/lib/tcpi-parser';
import { db } from '@/lib/db/schema';
import { INDICATOR_META } from '@/lib/constants';
import type { TCPIBenchmark, TCPIBenchmarkRecord } from '@/lib/types';

export default function TcpiImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [fileName, setFileName] = useState('');
  const [benchmarks, setBenchmarks] = useState<TCPIBenchmark[]>([]);
  const [matchedCount, setMatchedCount] = useState(0);
  const [unmatchedNames, setUnmatchedNames] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'array' });

        if (!isTcpiFormat(workbook)) {
          setErrors(['此檔案不是 TCPI 年值報表格式。請上傳正確的 TCPI 報表。']);
          return;
        }

        const result = parseTcpiExcel(workbook);
        setBenchmarks(result.benchmarks);
        setMatchedCount(result.matchedCount);
        setUnmatchedNames(result.unmatchedTcpiNames);
        setErrors(result.errors);
        setStep('preview');
      } catch (err) {
        setErrors([`解析失敗: ${err instanceof Error ? err.message : String(err)}`]);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      // 清除舊的 TCPI 標竿
      await db.tcpiBenchmarks.clear();

      // 寫入新的
      const records: TCPIBenchmarkRecord[] = benchmarks.map(b => ({
        indicatorCode: b.indicatorCode,
        tcpiName: b.tcpiName,
        year: b.year,
        medicalCenter: b.medicalCenter,
        regionalHospital: b.regionalHospital,
        districtHospital: b.districtHospital,
        importedAt: new Date(),
      }));

      await db.tcpiBenchmarks.bulkAdd(records);
      setSavedCount(records.length);
      setStep('done');
    } catch (err) {
      setErrors(prev => [...prev, `儲存失敗: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setSaving(false);
    }
  }, [benchmarks]);

  // 按 QIP 代碼分組顯示
  const groupedBenchmarks = benchmarks.reduce<Record<string, TCPIBenchmark[]>>((acc, b) => {
    if (!acc[b.indicatorCode]) acc[b.indicatorCode] = [];
    acc[b.indicatorCode].push(b);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-5xl">
      {/* 頂部導航 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/settings')}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ArrowLeft size={20} className="text-gray-500" />
        </button>
        <BarChart3 size={24} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-800">TCPI 標竿匯入</h1>
      </div>

      {/* 說明 */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-700">
        <p className="font-medium mb-1">TCPI（台灣臨床成效指標）標竿</p>
        <p>上傳醫策會發布的 TCPI 年值報表，系統將自動比對 QIP 指標並匯入同儕標竿值。</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div className="bg-white/60 rounded px-2 py-1">🏥 新竹（合併）→ 醫學中心標竿</div>
          <div className="bg-white/60 rounded px-2 py-1">🏢 竹北 → 區域醫院標竿</div>
          <div className="bg-white/60 rounded px-2 py-1">🏠 竹東 → 地區醫院標竿</div>
        </div>
      </div>

      {/* Step 1: 上傳 */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8">
          <div className="flex flex-col items-center justify-center">
            <FileSpreadsheet size={48} className="text-gray-300 mb-4" />
            <p className="text-gray-600 mb-4">選擇或拖放 TCPI 年值報表 Excel 檔</p>
            <label className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
              <Upload size={18} />
              選擇 TCPI 報表
              <input
                type="file"
                accept=".xls,.xlsx"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
          {errors.length > 0 && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              {errors.map((e, i) => (
                <p key={i} className="text-sm text-red-600">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: 預覽 */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* 摘要 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">解析結果</h2>
              <span className="text-sm text-gray-500">檔案：{fileName}</span>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{matchedCount}</div>
                <div className="text-xs text-green-600">已配對 QIP 指標</div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{benchmarks.length}</div>
                <div className="text-xs text-blue-600">標竿值數量</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-500">{unmatchedNames.length}</div>
                <div className="text-xs text-gray-500">未找到</div>
              </div>
            </div>

            {errors.length > 0 && (
              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={14} className="text-yellow-600" />
                  <span className="text-sm font-medium text-yellow-700">注意事項</span>
                </div>
                {errors.map((e, i) => (
                  <p key={i} className="text-sm text-yellow-600">{e}</p>
                ))}
              </div>
            )}

            {unmatchedNames.length > 0 && (
              <div className="mb-3 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">以下 QIP 指標在 TCPI 報表中未找到對應（可能因 TCPI 無此指標或名稱不同）：</p>
                <p className="text-xs text-gray-400">{unmatchedNames.join('、')}</p>
              </div>
            )}
          </div>

          {/* 配對明細表 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-medium text-gray-700">配對明細</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">QIP 代碼</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">指標名稱</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">TCPI 名稱</th>
                    <th className="text-center px-4 py-2 text-xs font-medium text-gray-500">年度</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">醫學中心</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">區域醫院</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">地區醫院</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedBenchmarks).map(([qipCode, items]) => {
                    const meta = INDICATOR_META[qipCode];
                    return items.map((b, idx) => (
                      <tr
                        key={`${qipCode}-${b.year}`}
                        className={idx === 0 ? 'border-t border-gray-100' : ''}
                      >
                        {idx === 0 && (
                          <>
                            <td rowSpan={items.length} className="px-4 py-2 font-mono text-gray-600 align-top border-r border-gray-50">
                              {qipCode}
                            </td>
                            <td rowSpan={items.length} className="px-4 py-2 text-gray-700 align-top border-r border-gray-50">
                              {meta?.name ?? ''}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2 text-gray-500 text-xs">{b.tcpiName}</td>
                        <td className="px-4 py-2 text-center text-gray-600">{b.year}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {b.medicalCenter !== null ? b.medicalCenter.toFixed(2) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {b.regionalHospital !== null ? b.regionalHospital.toFixed(2) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {b.districtHospital !== null ? b.districtHospital.toFixed(2) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 按鈕列 */}
          <div className="flex gap-3">
            <button
              onClick={() => { setStep('upload'); setErrors([]); setBenchmarks([]); }}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              重新選擇
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || benchmarks.length === 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              {saving ? '儲存中...' : `確認匯入 ${benchmarks.length} 筆標竿值`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: 完成 */}
      {step === 'done' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-8 text-center">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2">匯入完成</h2>
          <p className="text-gray-500 mb-6">
            已成功匯入 {savedCount} 筆 TCPI 標竿值，涵蓋 {matchedCount} 項 QIP 指標。
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.push('/settings')}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              返回設定
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              前往儀表板
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
