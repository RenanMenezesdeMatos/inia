import { Suspense } from "react"

import { SourceWizard } from "@/components/admin/data-hub/source-wizard"

export default function Page() {
  return (
    <Suspense>
      <SourceWizard />
    </Suspense>
  )
}
