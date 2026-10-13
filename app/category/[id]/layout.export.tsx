import { IS_STATIC_EXPORT, DASHBOARD_CATEGORY_NAMES } from '@/lib/export/staticParams'

// Static export only: pre-render one page per known `id` (a client page cannot export
// generateStaticParams itself, hence this server layout). Regular builds return [] and keep
// rendering any `id` on demand, exactly as before.
export const dynamicParams = process.env.NEXT_OUTPUT !== 'export'

export function generateStaticParams() {
  return IS_STATIC_EXPORT ? DASHBOARD_CATEGORY_NAMES.map((id) => ({ id })) : []
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
