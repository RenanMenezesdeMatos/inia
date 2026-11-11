import { apiGet } from "@/lib/api/api-client"
import { codeDetailSchema, codeSearchSchema, referenceDetailSchema } from "@/schemas/error-diagnostics/error-diagnostics.schema"

/** Diagnóstico de erros (Administração › Plataforma): catálogo e ocorrências — o servidor confere a permissão e o escopo. */
const BASE = "/api/v1/admin/error-diagnostics"

export const searchErrorCodes = async (query: string) => codeSearchSchema.parse(await apiGet<unknown>(`${BASE}/codes?q=${encodeURIComponent(query)}`))
export const fetchErrorCode = async (code: string) => codeDetailSchema.parse(await apiGet<unknown>(`${BASE}/codes/${encodeURIComponent(code)}`))
export const fetchErrorReference = async (reference: string) => referenceDetailSchema.parse(await apiGet<unknown>(`${BASE}/occurrences/${encodeURIComponent(reference)}`))
