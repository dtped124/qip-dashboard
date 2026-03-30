import CategoryFormPage from './client-page'

export function generateStaticParams() {
  return ['HA01','HA02','HA03','HA04','HA05','HA06','HA07','HA08','HA09','HA10'].map(
    category => ({ category })
  )
}

export default function Page() {
  return <CategoryFormPage />
}
