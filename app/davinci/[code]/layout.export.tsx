import { IS_STATIC_EXPORT, DAVINCI_CODES } from '@/lib/export/staticParams'

// Static export only: pre-render one page per known `code` (a client page cannot export
// generateStaticParams itself, hence this server layout). Regular builds return [] and keep
// rendering any `code` on demand, exactly as before.
export const dynamicParams = process.env.NEXT_OUTPUT !== 'export'

export function generateStaticParams() {
  return IS_STATIC_EXPORT ? DAVINCI_CODES.map((code) => ({ code })) : []
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
