'use client';

import Link from 'next/link';
import { Settings, ListChecks, Database, Trash2, BarChart3, Bot, UserCog, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { clearAllData } from '@/lib/db/operations';
import { useAuthStore } from '@/lib/auth/store';
import { hasRole, isAdmin } from '@/lib/auth/roles';

export default function SettingsPage() {
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  // Cards of other roles are not shown. The backend enforces the permissions
  // regardless; this only decides what to show.
  const roles = useAuthStore((s) => s.user?.roles);
  const admin = isAdmin(roles);
  const reviewer = hasRole(roles, 'reviewer');

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
        {/* 填報系統管理（管理員） */}
        {admin && (
          <Link
            href="/entry/admin"
            className="flex items-center gap-4 bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
          >
            <div className="p-3 bg-indigo-50 rounded-lg">
              <UserCog size={24} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">填報系統管理</h2>
              <p className="text-sm text-gray-500">帳號管理、填報截止日、指標負責人指派（僅管理員）</p>
            </div>
          </Link>
        )}

        {/* 填報審核（審核者；管理員同樣可用） */}
        {reviewer && (
          <Link
            href="/entry/review"
            className="flex items-center gap-4 bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
          >
            <div className="p-3 bg-teal-50 rounded-lg">
              <ClipboardCheck size={24} className="text-teal-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">填報審核</h2>
              <p className="text-sm text-gray-500">各院區填報進度總覽、審核與退回填報（審核者、管理員）</p>
            </div>
          </Link>
        )}

        {/* 指標管理（管理員） */}
        {admin && (
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
        )}

        {/* TCPI 標竿匯入（管理員） */}
        {admin && (
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
        )}

        {/* AI 深度分析 */}
        <Link
          href="/settings/ai"
          className="flex items-center gap-4 bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow"
        >
          <div className="p-3 bg-purple-50 rounded-lg">
            <Bot size={24} className="text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">AI 深度分析</h2>
            <p className="text-sm text-gray-500">設定 Claude API Key、選擇模型、查看用量統計</p>
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
