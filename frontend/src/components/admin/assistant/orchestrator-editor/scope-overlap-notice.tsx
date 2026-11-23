"use client"

import { z } from "zod"

import { AdminApiError } from "@/lib/admin/admin-api"

const conflictDetailsSchema = z.object({
  conflicts: z.array(z.object({ name: z.string(), units: z.array(z.string()).catch([]) })).catch([]),
})

export type ScopeConflict = { message: string; conflicts: { name: string; units: string[] }[] }

/**
 * 409 do servidor quando o alcance disputa o chat/voz com outro orquestrador ativo do mesmo universo: vínculo idêntico
 * (`ORCHESTRATOR_SCOPE_OVERLAP`) ou dois de "Todos os Grupos" (`ORCHESTRATOR_SCOPE_TAKEN`). Null para qualquer outro erro.
 */
export function scopeConflictOf(error: unknown): ScopeConflict | null {
  if (!(error instanceof AdminApiError) || (error.code !== "ORCHESTRATOR_SCOPE_OVERLAP" && error.code !== "ORCHESTRATOR_SCOPE_TAKEN")) return null
  const parsed = conflictDetailsSchema.safeParse(error.details ?? {})
  return { message: error.message, conflicts: parsed.success ? parsed.data.conflicts : [] }
}

/** Aviso junto do campo de alcance: o que está em conflito e com quem — nada foi gravado. */
export function ScopeOverlapNotice({ conflict }: { conflict: ScopeConflict }) {
  return (
    <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <p className="font-medium">Nada foi gravado: outro orquestrador ativo já atende o chat/voz neste alcance.</p>
      {conflict.conflicts.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5">
          {conflict.conflicts.map((entry) => (
            <li key={entry.name}>
              <span className="font-medium">{entry.name}</span>
              {entry.units.length > 0 ? `: ${entry.units.join(", ")}` : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>{conflict.message}</p>
      )}
      <p className="text-xs">Tire esses Grupos/Subgrupos de um dos dois, desative um deles ou restrinja um a “Só workflows”. Um Subgrupo dentro do Grupo inteiro do outro pode ficar: ali o do Subgrupo vence.</p>
    </div>
  )
}
