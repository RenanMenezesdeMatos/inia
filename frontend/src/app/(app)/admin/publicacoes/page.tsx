import { Suspense } from "react"

import { PublicationsListPage } from "@/components/publications/publications-list-page"

/** Publicações — comunicados e alinhamentos operacionais (o backend confere a permissão de cada um em cada rota). */
export default function Page() {
  return (
    <Suspense>
      <PublicationsListPage />
    </Suspense>
  )
}
