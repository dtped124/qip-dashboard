import { CATEGORY_ORDER } from '@/lib/constants'
import CategoryPage from './client-page'

export function generateStaticParams() {
  return CATEGORY_ORDER.map((id: string) => ({ id: encodeURIComponent(id) }))
}

export default function Page() {
  return <CategoryPage />
}
