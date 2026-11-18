import { apiGet, apiPost } from "@/lib/api/api-client"
import { myAlignmentReadSchema, myAlignmentsSchema, type MyAlignment } from "@/schemas/operational-alignments/my-alignment.schema"

const BASE = "/api/v1/operational-alignments"

/** Alinhamentos da pessoa da sessão para o Acompanhamento (um por alinhamento). */
export async function fetchMyAlignments(): Promise<MyAlignment[]> {
  return myAlignmentsSchema.parse(await apiGet<unknown>(`${BASE}/mine`)).items
}

/** "Li o alinhamento" — desta versão (nova versão pede de novo). Idempotente. */
export async function markMyAlignmentRead(alignmentId: string, versionId: string): Promise<{ readAt: string }> {
  return myAlignmentReadSchema.parse(await apiPost<unknown>(`${BASE}/${encodeURIComponent(alignmentId)}/versions/${encodeURIComponent(versionId)}/read`))
}
