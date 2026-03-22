'use client';

import Link from 'next/link';
import { Settings, ListChecks, Database, Trash2, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { clearAllData } from '@/lib/db/operations';

export default function SettingsPage() {
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  async function handleClearData() {
    if (!confirm('確定要清除所有資料嗎？此操作無法復原。\n（指標定義不會被刪除）')) return;
    setClearing(true);
    try {
      await clearAllData();
      setCleared(true);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Settings size={24} className="text-gray-400" />
        <h1 className="text-2xl font-bold text-gray-800">設定</h1>
      </div>

      <div className="grid gap-4">
        {/* 指標管理 */}
        <Link
          href="/settings/indicators"
          className="flex items-center gap-4 bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
        >
          <div className="p-3 bg-blue-50 rounded-lg">
            <ListChecks size={24} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">指標管理</h2>
            <p className="text-sm text-gray-500">檢視、新增、編輯指標定義和別名設定</p>
          </div>
        </Link>

        {/* TCPI 標竿匯入 */}
        <Link
          href="/settings/tcpi"
          className="flex items-center gap-4 bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
        >
          <div className="p-3 bg-green-50 rounded-lg">
            <BarChart3 size={24} className="text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">TCPI 標竿管理</h2>
            <p className="text-sm text-gray-500">匯入醫策會 TCPI 年值報表，設定同儕標竿值</p>
          </div>
        </Link>

        {/* 資料管理 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-orange-50 rounded-lg">
              <Database size={24} className="text-orange-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-800">資料管理</h2>
              <p className="text-sm text-gray-500">管理本機 IndexedDB 中的所有監測資料</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleClearData}
              disabled={clearing || cleared}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {clearing ? '清除中...' : cleared ? '已清除' : '清除所有資料'}
            </button>
          </div>

          {cleared && (
            <p className="mt-2 text-xs text-green-600">資料已清除。重新整理頁面後生效。</p>
          )}
        </div>

        {/* 關於 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">關於</h2>
          <div className="text-sm text-gray-500 space-y-1">
            <p>QIP 持續性監測指標儀表板</p>
            <p>資料儲存方式：瀏覽器 IndexedDB（本機離線）</p>
            <p>異常偵測引擎：管制圖(I-Chart) + 月增減 + 同儕值比較</p>
          </div>
        </div>
      </div>
    </div>
  );
}
