import { Suspense } from "react"

import { UsabilityPersonPage } from "@/components/admin/usability/person-detail-page"

/** Detalhe de uso de uma pessoa — exige `usability.users.view` no escopo dela (o backend devolve 404 fora dele) e é auditado. */
export default async function Page({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params
  return (
    <Suspense>
      <UsabilityPersonPage personId={personId} />
    </Suspense>
  )
}
