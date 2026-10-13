import { IS_STATIC_EXPORT, REPORT_CATEGORY_CODES } from '@/lib/export/staticParams'

// Static export only: pre-render one page per known `category` (a client page cannot export
// generateStaticParams itself, hence this server layout). Regular builds return [] and keep
// rendering any `category` on demand, exactly as before.
export const dynamicParams = process.env.NEXT_OUTPUT !== 'export'

export function generateStaticParams() {
  return IS_STATIC_EXPORT ? REPORT_CATEGORY_CODES.map((category) => ({ category })) : []
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
