import { signalsOf, type SupportSignal } from "../domain/reply-signals.js"
import type { OrchestratedReply } from "./run-orchestrated-reply.js"

/**
 * Sinais de uma resposta orquestrada (chat e voz), a partir dos resultados estruturados do turno (`assistant/domain/reply-signals.ts`).
 * Especialista = resultado com agente; falha (`failed`) e impedimento (`blocked`) contam mesmo sem agente (a chamada que falhou fica
 * sem ele); ferramentas diretas do backend = `directResults` (conteúdo = cartão). `clarificationStatus` = esclarecimento da consulta de processo gravado junto.
 */
export function signalsOfOrchestratedReply(reply: Pick<OrchestratedReply, "results" | "directResults">, clarificationStatus?: string | null): SupportSignal[] {
  return signalsOf({
    specialists: reply.results.filter((result) => result.agentId !== null || result.failed || result.blocked).map((result) => ({ knowledge: result.knowledge, toolTrace: result.toolTrace, failed: result.failed, blocked: result.blocked })),
    direct: (reply.directResults ?? []).map((result) => ({ card: result.card })),
    clarificationStatus: clarificationStatus ?? null,
  })
}

/** Sinais de uma resposta que saiu do esclarecimento pelas bases (estado final dele). */
export function signalsOfClarification(state: { status?: unknown } | null | undefined): SupportSignal[] {
  return signalsOf({ clarificationStatus: typeof state?.status === "string" ? state.status : null })
}

/** Sinais da resposta de UM especialista acionado pela voz (`/tool-call`). */
export function signalsOfSpecialist(result: { knowledge?: { mode: string } | undefined; toolTrace?: readonly { status: string }[] | undefined }): SupportSignal[] {
  return signalsOf({ specialists: [{ knowledge: result.knowledge, toolTrace: result.toolTrace }] })
}
