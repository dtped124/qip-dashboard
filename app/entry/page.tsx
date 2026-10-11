'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getMyTasks } from '@/lib/entry/api'
import { useAuthStore } from '@/lib/auth/store'
import type { CategoryTask, MyTasksResponse, RejectionNotice } from '@/lib/entry/types'

// ─── 輔助元件 ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; className: string }> = {
    unfilled:  { label: '⬜ 未填',   className: 'bg-gray-100 text-gray-500' },
    draft:     { label: '📝 草稿',   className: 'bg-yellow-50 text-yellow-700' },
    submitted: { label: '🔍 審核中', className: 'bg-blue-50 text-blue-700' },
    approved:  { label: '✅ 已核准', className: 'bg-green-50 text-green-700' },
    finalized: { label: '🔒 已送出', className: 'bg-gray-50 text-gray-500' },
  }
  const c = configs[status] ?? { label: status, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}

function ProgressBar({ filled, total }: { filled: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-12 text-right">{filled}/{total}</span>
    </div>
  )
}

function RejectionBanner({ notices }: { notices: RejectionNotice[] }) {
  if (notices.length === 0) return null
  return (
    <div className="mb-4 space-y-2">
      {notices.map((n) => (
        <div
          key={`${n.campus_code}:${n.category_code}`}
          className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start justify-between gap-3"
        >
          <div>
            <p className="text-sm font-medium text-red-800">
              ⚠️ <strong>{n.campus_name} · {n.category_name}</strong> 面向已被退回
            </p>
            <p className="text-sm text-red-600 mt-0.5">理由：{n.reason}</p>
          </div>
          <Link
            href={`/entry/${n.category_code}?campus=${encodeURIComponent(n.campus_code)}&status=rejected`}
            className="shrink-0 text-sm text-red-700 font-medium hover:underline"
          >
            前往修改 →
          </Link>
        </div>
      ))}
    </div>
  )
}

function DeadlineBanner({ daysRemaining, twDeadlineDate, isOverdue }: {
  daysRemaining: number
  twDeadlineDate: string
  isOverdue: boolean
}) {
  if (isOverdue) {
    return (
      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-sm text-amber-800">
          ⏰ <strong>本月資料已逾期</strong>（截止日：{twDeadlineDate}）。仍可繼續填報，系統將標記為逾期。
        </p>
      </div>
    )
  }
  if (daysRemaining <= 5) {
    return (
      <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <p className="text-sm text-yellow-800">
          ⏰ 截止日：<strong>{twDeadlineDate}</strong>，剩餘 <strong>{daysRemaining}</strong> 天
        </p>
      </div>
    )
  }
  return null
}

/** A campus label; loud when the user has tasks in more than one campus, because the rows then look alike. */
function CampusTag({ name, emphasized }: { name: string; emphasized: boolean }) {
  return (
    <span
      className={
        emphasized
          ? 'px-1.5 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200'
          : 'text-xs text-gray-500'
      }
    >
      {name}
    </span>
  )
}

/** Required fields of the whole campus x category still empty that are not mine (somebody else's, or nobody's). */
function othersPendingCount(task: CategoryTask): number {
  return Math.max(0, task.category_missing - (task.my_total - task.my_filled))
}

function CategoryRow({ task, multiCampus }: { task: CategoryTask; multiCampus: boolean }) {
  // Submitted, approved and finalized reports are locked for the reporter (KD1).
  const isLocked = task.status === 'submitted' || task.status === 'approved' || task.status === 'finalized'
  const hasRejection = task.rejection_reason !== ''
  const pendingOthers = othersPendingCount(task)

  return (
    <Link
      href={isLocked ? '#' : `/entry/${task.category_code}?campus=${encodeURIComponent(task.campus_code)}`}
      className={`block ${isLocked ? 'pointer-events-none opacity-70' : 'hover:bg-gray-50 cursor-pointer'}`}
    >
      <div className="flex items-center px-4 py-3 border-b last:border-b-0">
        {/* 面向色條 */}
        <div
          className="w-1 h-10 rounded-full mr-3 shrink-0"
          style={{ backgroundColor: task.category_color }}
        />

        {/* 名稱 */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-800">{task.category_name}</span>
            <CampusTag name={task.campus_name} emphasized={multiCampus} />
            {hasRejection && (
              <span className="text-xs text-red-600 font-medium">🔙 退回</span>
            )}
          </div>
          <div title={`我負責的欄位：已填 ${task.my_filled} / 共 ${task.my_total}`}>
            <ProgressBar filled={task.my_filled} total={task.my_total} />
          </div>
          {pendingOthers > 0 && (
            <p
              className="mt-1 text-xs text-amber-600"
              title="整個院區的這個面向還有必填欄位是空的，不是由你負責（他人負責或尚未指派）；要全部填齊才能送審"
            >
              待他人填寫 {pendingOthers}
            </p>
          )}
        </div>

        {/* 狀態 + 箭頭 */}
        <div className="flex items-center gap-3 ml-3 shrink-0">
          <StatusBadge status={hasRejection ? 'draft' : task.status} />
          {!isLocked && (
            <span className="text-gray-400 text-sm">→</span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ─── 主頁面 ─────────────────────────────────────────────────

export default function EntryHomePage() {
  // The frame (EntryShell) shows the title bar and the logout; the user comes from the auth store.
  const user = useAuthStore((s) => s.user)
  const [tasks, setTasks] = useState<MyTasksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const twYear = now.getFullYear() - 1911
    const month = now.getMonth() + 1
    getMyTasks(twYear, month)
      .then((data) => {
        if (!cancelled) setTasks(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '載入失敗')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-gray-500">載入中…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-red-500">{error}</div>
      </div>
    )
  }

  if (!tasks) return null

  const { period, deadline, rejection_notices, categories, overall_progress } = tasks
  const overallPct = overall_progress.total === 0
    ? 0
    : Math.round((overall_progress.filled / overall_progress.total) * 100)
  const multiCampus = new Set(categories.map((c) => c.campus_code)).size > 1

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-4">
      {/* 期間 */}
      <div className="bg-white rounded-lg border p-4">
        <p className="text-sm text-gray-500">當前填報期間</p>
        <p className="text-lg font-bold text-gray-800 mt-1">
          {period.year} 年 {period.month} 月
          {user?.campus_name && (
            <span className="text-sm font-normal text-gray-500 ml-2">
              · {user.campus_name}
            </span>
          )}
        </p>
        {/* 只提示、不阻擋：填報範圍由指標負責人指派決定，不靠帳號的院區（之後的 phase 會整理這一塊） */}
        {user && !user.campus_code && (
          <p className="mt-2 text-xs text-amber-600">
            帳號尚未設定所屬院區；填報範圍依指標負責人指派決定，若下方清單是空的請聯絡管理員。
          </p>
        )}
      </div>

      {/* 逾期 / 截止日提醒 */}
      <DeadlineBanner
        daysRemaining={deadline.days_remaining}
        twDeadlineDate={deadline.tw_deadline_date}
        isOverdue={deadline.is_overdue}
      />

      {/* 退回通知 */}
      <RejectionBanner notices={rejection_notices} />

      {/* 整體進度 */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">本月整體完成度</p>
          <p className="text-sm text-gray-500">
            {overall_progress.filled}/{overall_progress.total} 指標已填
          </p>
        </div>
        <div className="bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <p className="text-right text-xs text-gray-400 mt-1">{overallPct}%</p>
      </div>

      {/* 面向清單 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-gray-700">我的填報進度</h2>
        </div>
        {categories.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">
            本月無指派指標，請聯絡管理員
          </div>
        ) : (
          categories.map((task) => (
            <CategoryRow
              key={`${task.campus_code}:${task.category_code}`}
              task={task}
              multiCampus={multiCampus}
            />
          ))
        )}
      </div>
    </main>
  )
}
