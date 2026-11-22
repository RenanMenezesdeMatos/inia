/**
 * `ENGINE_LEASE_V1` (21/11/2026) — posse CURTA e RENOVADA das execuções do motor (análise de chamada, investigação de indicador e
 * "Gerar feedback"). A posse diz "esta execução está viva": enquanto o processo roda, ela é renovada a cada 1/3 do prazo; se o processo
 * cai, a renovação para e a posse vence em `ENGINE_LEASE_SECONDS` — outra execução retoma em ~2 min, sem pagar a mesma análise duas
 * vezes enquanto a primeira ainda trabalha. Mesmo desenho da posse da matrícula no worker (`workflows/application/engine.ts`).
 *
 * Relógio (run-9, SFW-01): a posse nasce, é comparada e é renovada com o relógio do BANCO (`now()` no SQL do armazenamento) — nunca
 * com o relógio do processo; API e workers em máquinas com relógios diferentes não tomam a posse viva uns dos outros. O relógio do
 * processo só mede há quanto tempo ESTA execução segura a posse (teto `ENGINE_MAX_RUN_SECONDS`). A memória em RAM dos testes usa o
 * relógio injetado.
 *
 * Posse perdida (run-9, SFW-02): a execução PARA — cada chamada de modelo passa por `guard` (confere `lost()` antes de pagar) e as
 * conclusões só gravam se a linha ainda for desta tentativa (`attempts` gravado no claim; 0 linhas = nada gravado, `EngineLeaseLostError`).
 * Quem perdeu termina como "em andamento em outra execução" (o Workflow tenta de novo e reaproveita o que a outra concluiu).
 *
 * Antes: posses fixas de 5/10/15 min, sem renovação — análise mais longa que a posse podia ser paga de novo por outra execução, e
 * posse longa atrasava a retomada de quem caiu.
 */
import { ENGINE_MAX_RUN_SECONDS } from "./engine-meter.js"
import type { EngineModelPort } from "./ports.js"

export const ENGINE_LEASE_SECONDS = 120

/** Renova a posse (o armazenamento soma o prazo ao `now()` do banco): devolve a nova posse (token), ou null se já não é desta execução. */
export type LeaseRenewer = (token: Date) => Promise<Date | null>
export type EngineLeaseHold = {
  stop(): void
  lost(): boolean
  /** Para a execução que perdeu a posse (antes de uma etapa paga ou de gravar). */
  assertHeld(): void
  /** O erro é a perda DESTA posse (e não a de outra execução aninhada). */
  isLossOf(error: unknown): boolean
  /** O mesmo modelo, que recusa a chamada (sem pagar) depois que a posse foi perdida. */
  guard<T extends EngineModelPort>(model: T): T
}

/**
 * A execução perdeu a posse do registro (`recordId` = execução de análise ou mensagem): nada mais é pago nem gravado por ela. Interno ao
 * motor — cada dona converte no seu "em andamento em outra execução" (código já existente), nunca chega à tela como está.
 */
export class EngineLeaseLostError extends Error {
  constructor(readonly recordId: string, readonly at: "MODEL_CALL" | "COMPLETE") {
    super(`A posse da execução ${recordId} passou para outra execução (${at}).`)
    this.name = "EngineLeaseLostError"
  }
}

/**
 * Renova a posse até `stop()` ou até o tempo máximo de uma execução (`ENGINE_MAX_RUN_SECONDS`): depois dele a execução é tratada como
 * travada — a renovação para e a posse vence. Renovação recusada (outra execução pegou a posse) ou com erro de banco: para de renovar e
 * registra; a execução atual termina, e quem conclui primeiro grava (as gravações do motor já são idempotentes por chave).
 */
export function holdEngineLease(input: { label: string; recordId: string; initial: Date; renew: LeaseRenewer; leaseSeconds?: number; maxSeconds?: number; now?: () => number }): EngineLeaseHold {
  const leaseMs = (input.leaseSeconds ?? ENGINE_LEASE_SECONDS) * 1000
  const maxMs = (input.maxSeconds ?? ENGINE_MAX_RUN_SECONDS) * 1000
  const now = input.now ?? (() => Date.now())
  const startedAt = now()
  let token = input.initial
  let lost = false
  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    if (now() - startedAt >= maxMs) {
      console.warn(JSON.stringify({ event: "feedback_engine_lease_max_hold", label: input.label }))
      clearInterval(timer)
      return
    }
    busy = true
    void input.renew(token)
      .then((next) => {
        if (next) token = next
        else {
          lost = true
          clearInterval(timer)
          console.warn(JSON.stringify({ event: "feedback_engine_lease_lost", label: input.label }))
        }
      })
      .catch((error: unknown) => {
        // Banco fora do ar: tenta de novo no próximo tique (a posse ainda pode estar valendo).
        console.warn(JSON.stringify({ event: "feedback_engine_lease_renew_failed", label: input.label, message: error instanceof Error ? error.message : String(error) }))
      })
      .finally(() => {
        busy = false
      })
  }, Math.max(1, Math.floor(leaseMs / 3)))
  // A renovação nunca segura o processo vivo sozinha.
  timer.unref?.()
  const assertHeld = () => {
    if (lost) throw new EngineLeaseLostError(input.recordId, "MODEL_CALL")
  }
  return {
    stop: () => clearInterval(timer),
    lost: () => lost,
    assertHeld,
    isLossOf: (error) => error instanceof EngineLeaseLostError && error.recordId === input.recordId,
    // Cópia rasa: preserva o que o modelo expõe além de `generate` (ex.: o medidor do orçamento).
    guard: <T extends EngineModelPort>(model: T): T => ({
      ...model,
      generate: (request: Parameters<EngineModelPort["generate"]>[0]) => {
        assertHeld()
        return model.generate(request)
      },
    }),
  }
}

/** Registro da perda na conclusão (0 linhas atualizadas): nada foi gravado por esta execução. */
export function leaseLostOnComplete(table: string, recordId: string, attempt: number): EngineLeaseLostError {
  console.warn(JSON.stringify({ event: "feedback_engine_lease_lost_on_complete", table, recordId, attempt }))
  return new EngineLeaseLostError(recordId, "COMPLETE")
}
