import ReviewDetailPage from './client-page'

export function generateStaticParams() {
  const campuses = ['zhubei', 'zhudong', 'hsinchu']
  const categories = ['HA01','HA02','HA03','HA04','HA05','HA06','HA07','HA08','HA09','HA10']
  return campuses.flatMap(campus =>
    categories.map(category => ({ campus, category }))
  )
}

export default function Page() {
  return <ReviewDetailPage />
}
