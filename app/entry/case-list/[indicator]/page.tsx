import CaseListPage from './client-page'

export function generateStaticParams() {
  return [{ indicator: 'placeholder' }]
}

export default function Page() {
  return <CaseListPage />
}
