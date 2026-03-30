import { INDICATOR_META } from '@/lib/constants'
import IndicatorDetailPage from './client-page'

export function generateStaticParams() {
  return Object.keys(INDICATOR_META).map(code => ({ code }))
}

export default function Page() {
  return <IndicatorDetailPage />
}
