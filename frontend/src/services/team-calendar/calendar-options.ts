import type { ScopedOptionsSource } from "@/services/scope-units/scoped-options-service"

/**
 * Opções em lotes do Calendário: `of: "anchors"` = estruturas que o leitor pode abrir; senão, os operadores diretos da âncora (e os
 * Grupos/Subgrupos deles).
 */
export function calendarOptionsSource({ anchorId, of }: { anchorId?: string | null; of?: "anchors" }): ScopedOptionsSource {
  return { path: "/api/v1/team-calendar/options", params: { ...(anchorId ? { anchorId } : {}), ...(of ? { of } : {}) } }
}
