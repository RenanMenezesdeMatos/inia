import { Suspense } from "react"

import { DataHubPage } from "@/components/admin/data-hub/data-hub-page"

export default function Page() {
  return (
    <Suspense>
      <DataHubPage />
    </Suspense>
  )
}
