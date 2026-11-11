import type { ErrorSeverity } from "../../../shared/domain/errors/error-catalog-types.js"

/** Referência aceita: a mesma forma do `x-request-id` (identificador simples, sem texto livre) e prefixos `job-`/`cli-`. */
export const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/

export type OccurrenceSource = "API" | "STREAM" | "JOB" | "PROCESS" | "INTERFACE" | "CLIENT"

export type OccurrenceInput = {
  reference: string
  code: string
  source: OccurrenceSource
  httpStatus: number | null
  severity: ErrorSeverity
  method?: string | null
  route?: string | null
  organizationId?: string | null
  authenticated: boolean
  /** Já sanitizado por quem chama (classify-error.ts / client-errors-router.ts). */
  details?: Record<string, unknown>
  occurredAt?: Date
}

export type OccurrenceRecord = {
  reference: string
  code: string
  source: OccurrenceSource
  httpStatus: number | null
  severity: ErrorSeverity
  service: string
  release: string
  method: string | null
  route: string | null
  authenticated: boolean
  occurredAt: string
  details: Record<string, unknown>
}

/** Rota normalizada: ids (uuid, números longos) viram `:id` — agrupa ocorrências e não leva identificador para o registro. */
export function normalizeRoute(raw: string): string {
  const pathOnly = raw.split("?")[0] ?? ""
  return pathOnly
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{3,}(?=\/|$)/g, "/:n")
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, "/:token")
    .slice(0, 200)
}
