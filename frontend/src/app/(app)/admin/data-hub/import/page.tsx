import { Suspense } from "react"

import { FileImportFlow } from "@/components/admin/data-hub/file-import-flow"

export default function Page() {
  return (
    <Suspense>
      <FileImportFlow />
    </Suspense>
  )
}
