import { IS_STATIC_EXPORT, CAMPUS_CODES } from '@/lib/export/staticParams'

// Static export only: pre-render one page per known `campus` (a client page cannot export
// generateStaticParams itself, hence this server layout). Regular builds return [] and keep
// rendering any `campus` on demand, exactly as before.
export const dynamicParams = process.env.NEXT_OUTPUT !== 'export'

export function generateStaticParams() {
  return IS_STATIC_EXPORT ? CAMPUS_CODES.map((campus) => ({ campus })) : []
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
