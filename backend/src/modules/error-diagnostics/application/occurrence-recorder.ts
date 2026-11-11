import type { Database } from "../../../infrastructure/database/pool.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import type { OccurrenceInput } from "../domain/error-occurrence.js"
import { insertOccurrence } from "../infrastructure/pg-error-occurrence-store.js"

/**
 * Gravação das ocorrências SEM atrapalhar a resposta: assíncrona (fire-and-forget), com teto por minuto por processo — um
 * ataque ou uma tela em loop de 401 nunca enche o banco nem tira a vaga das falhas graves (cota própria para 5xx/críticas). Falha
 * ao gravar (banco fora) só conta e registra UMA linha por minuto: a ocorrência continua no log do serviço, que é a fonte primária.
 *
 * Registrado só pelo server.ts (processo real). Nos testes e nos apps montados sem registro, `recordOccurrence` não faz nada.
 */
export type OccurrenceRecorder = { record(input: OccurrenceInput): void; stats(): { recorded: number; dropped: number; failed: number } }

const log = createLogger("error-occurrences")

export function createOccurrenceRecorder(db: Pick<Database, "query">, options: { serious?: number; ordinary?: number; now?: () => number } = {}): OccurrenceRecorder {
  const limits = { serious: options.serious ?? 600, ordinary: options.ordinary ?? 120 }
  const now = options.now ?? Date.now
  let windowStart = now()
  let used = { serious: 0, ordinary: 0 }
  let lastFailureLog = 0
  const counters = { recorded: 0, dropped: 0, failed: 0 }
  return {
    record(input) {
      const at = now()
      if (at - windowStart >= 60_000) {
        windowStart = at
        used = { serious: 0, ordinary: 0 }
      }
      const bucket = (input.httpStatus ?? 500) >= 500 || input.severity === "critical" || input.severity === "error" ? "serious" : "ordinary"
      if (used[bucket] >= limits[bucket]) {
        counters.dropped++
        return
      }
      used[bucket]++
      insertOccurrence(db, input)
        .then(() => {
          counters.recorded++
        })
        .catch((error: unknown) => {
          counters.failed++
          if (at - lastFailureLog >= 60_000) {
            lastFailureLog = at
            log.warn({ event: "error_occurrence_not_recorded", reference: input.reference, code: input.code, err: { code: (error as { code?: unknown })?.code, name: (error as { name?: unknown })?.name } }, "ocorrência de erro não gravada no banco (continua no log)")
          }
        })
    },
    stats: () => ({ ...counters }),
  }
}

let registered: OccurrenceRecorder | null = null

export function registerOccurrenceRecorder(recorder: OccurrenceRecorder | null): void {
  registered = recorder
}

export function recordOccurrence(input: OccurrenceInput): void {
  registered?.record(input)
}

export function occurrenceRecorderStats() {
  return registered?.stats() ?? null
}
