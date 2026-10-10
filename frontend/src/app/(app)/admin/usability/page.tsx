import { Suspense } from "react"

import { UsabilityPage } from "@/components/admin/usability/usability-page"

/** Monitoria de usabilidade — o layout da Administração libera a rota para `canViewUsability`; o backend autoriza cada consulta. */
export default function Page() {
  return (
    <Suspense>
      <UsabilityPage />
    </Suspense>
  )
}
