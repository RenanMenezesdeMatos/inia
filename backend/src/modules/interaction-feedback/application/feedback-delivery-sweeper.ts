import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ExclusiveJobRunner } from "../../../infrastructure/jobs/periodic-jobs.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { createPostgresFeedbackDeliveryStore } from "../infrastructure/postgres-feedback-delivery-store.js"
import { deliverReadyFeedbackItems } from "./deliver-feedback.js"

/**
 * VARREDOR DE ENTREGA (V1.5.6): retry idempotente do que ficou "pronto para entrega" (ex.: falha técnica logo depois do QA)
 * e a forma do futuro worker de AUTO_DELIVER — sem broker. Só liga com INIA_INTERACTION_FEEDBACK_PIPELINE=ON (com OFF nada
 * roda e as tabelas nem são lidas). Nunca executa o pipeline, nunca chama o redator nem modelo, nunca notifica.
 */
export function startFeedbackDeliverySweeper(db: Database, options: { enabled?: boolean; intervalMs?: number; clock?: Clock; exclusive?: ExclusiveJobRunner } = {}): (() => void) | null {
  if (!(options.enabled ?? env.INIA_INTERACTION_FEEDBACK_PIPELINE === "ON")) return null
  const clock = options.clock ?? systemClock
  const deps = { deliveries: createPostgresFeedbackDeliveryStore(db), now: () => clock.now() }
  // Com 2+ processos (INIA_PROCESS_ROLE), `exclusive` faz cada rodada acontecer em um só (trava no banco).
  const intervalMs = options.intervalMs ?? 60_000
  const sweepOnce = () => deliverReadyFeedbackItems(deps)
  const sweep = () => (options.exclusive ? options.exclusive("feedback-delivery-sweeper", sweepOnce, { minIntervalMs: Math.round(intervalMs * 0.9) }) : sweepOnce()).catch((error: unknown) => console.error("Falha no varredor de entrega de feedback:", error))
  void sweep()
  const ticker = setInterval(() => void sweep(), intervalMs)
  return () => clearInterval(ticker)
}
