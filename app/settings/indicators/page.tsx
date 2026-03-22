'use client';

import { useEffect, useState } from 'react';
import { Plus, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { IndicatorTable } from '@/components/settings/IndicatorTable';
import { IndicatorForm } from '@/components/settings/IndicatorForm';
import { INDICATOR_META } from '@/lib/constants';
import { upsertIndicator, deleteCustomIndicator, getAllIndicators } from '@/lib/db/operations';
import type { IndicatorMeta } from '@/lib/types';

export default function IndicatorManagementPage() {
  const [indicators, setIndicators] = useState<IndicatorMeta[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingIndicator, setEditingIndicator] = useState<IndicatorMeta | undefined>();
  const [loading, setLoading] = useState(true);

  // 載入指標：合併預設 + DB 中的自定義
  async function loadIndicators() {
    setLoading(true);
    try {
      // 預設指標
      const presets: IndicatorMeta[] = Object.entries(INDICATOR_META).map(([code, meta]) => ({
        code,
        ...meta,
      }));

      // DB 中的自定義指標
      const dbIndicators = await getAllIndicators();
      const customIndicators = dbIndicators.filter(ind => ind.source === 'custom');

      // 合併（預設指標以 constants 為準，自定義指標以 DB 為準）
      const presetCodes = new Set(presets.map(p => p.code));
      const merged = [
        ...presets,
        ...customIndicators.filter(c => !presetCodes.has(c.code)),
      ];

      setIndicators(merged);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIndicators();
  }, []);

  async function handleSave(indicator: IndicatorMeta) {
    await upsertIndicator(indicator);
    setShowForm(false);
    setEditingIndicator(undefined);
    await loadIndicators();
  }

  async function handleDelete(code: string) {
    if (!confirm(`確定要刪除指標 ${code} 嗎？相關資料也會一併刪除。`)) return;
    await deleteCustomIndicator(code);
    await loadIndicators();
  }

  function handleEdit(indicator: IndicatorMeta) {
    setEditingIndicator(indicator);
    setShowForm(true);
  }

  return (
    <div className="p-6">
      {/* 標題 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">指標管理</h1>
        </div>
        <button
          onClick={() => { setEditingIndicator(undefined); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} />
          新增自訂指標
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">載入中...</div>
      ) : (
        <IndicatorTable
          indicators={indicators}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {showForm && (
        <IndicatorForm
          indicator={editingIndicator}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingIndicator(undefined); }}
        />
      )}
    </div>
  );
}
