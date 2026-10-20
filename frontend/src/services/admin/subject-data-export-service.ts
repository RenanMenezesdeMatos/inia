import { adminGetBlob } from "@/lib/admin/admin-api"

/** `GET /api/v1/admin/people/:id/data-export` → salva o JSON no computador de quem pediu. */
export async function downloadSubjectDataExport(personId: string): Promise<void> {
  const { blob, filename } = await adminGetBlob(`/api/v1/admin/people/${encodeURIComponent(personId)}/data-export`)
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename ?? `dados-pessoa-${personId}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
