import type { LoginAttemptReason } from "../domain/login-attempt.js"
import type { LoginAttemptOutcome } from "./credential-store.js"

/** Última tentativa pela matrícula que deu uma resposta (a trava temporária da INIA não conta como resposta). */
export type NetworkAttempt = { at: Date; outcome: LoginAttemptOutcome; reason: LoginAttemptReason | null; directoryCode: string | null }
export type NetworkAttemptSummary = { lockedUntil: Date | null; last: NetworkAttempt | null }

/**
 * PORTA das tentativas de login pela matrícula para quem ADMINISTRA acessos (nunca para o login): situação da trava temporária e
 * última resposta. Só leitura do que a própria INIA registrou — nada consulta o AD.
 */
export interface NetworkAttemptsReader {
  /** Por matrícula já normalizada (`normalizeNetworkLogin`); sem tentativa registrada = ausente do mapa. */
  summaries(normalized: readonly string[], now: Date): Promise<Map<string, NetworkAttemptSummary>>
  /**
   * Acesso habilitado agora: as falhas que nunca chegaram ao AD (a matrícula ainda não tinha conta) saem da trava temporária —
   * senão a pessoa recém-habilitada continuaria barrada por até 15 minutos. Senha recusada pelo AD continua contando.
   */
  releaseUnreached(normalized: readonly string[], now: Date): Promise<void>
}
