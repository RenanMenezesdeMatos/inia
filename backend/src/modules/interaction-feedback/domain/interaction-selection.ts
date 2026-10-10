import { createHash } from "node:crypto"
import { INTERACTION_FEEDBACK_CONTRACT } from "../../investigation/domain/interaction-feedback.js"

/** Contrato do feedback gerado — reexportado para quem está fora do módulo (o compositor só é importado aqui dentro). */
export { INTERACTION_FEEDBACK_CONTRACT }

/**
 * V1.5.10 — de onde vêm as interações de "Gerar feedback de atendimento" e como a amostra é escolhida.
 *
 * - TRIGGER_INTERACTION: a interação que originou a execução (gatilho por Flag). Nunca sorteia outra.
 * - COLLABORATOR_SAMPLE: interações do colaborador numa janela do motor (mesmo catálogo de períodos da agenda), com
 *   estratégia MOST_RECENT (as mais recentes) ou DETERMINISTIC_SAMPLE (amostra sem viés de recência, REPRODUZÍVEL).
 *
 * Reprodutível = mesma semente + mesmos candidatos → mesma amostra. A semente é a identidade da EXECUÇÃO (matrícula) +
 * colaborador + janela: o retry da mesma execução reescolhe exatamente as mesmas interações (e, além disso, a seleção fica
 * reservada no registro de gerações); uma execução nova tem outra semente e pode escolher outra amostra. Nunca Math.random.
 */
export const INTERACTION_SELECTION_SOURCES = ["TRIGGER_INTERACTION", "COLLABORATOR_SAMPLE"] as const
export type InteractionSelectionSource = (typeof INTERACTION_SELECTION_SOURCES)[number]
export const INTERACTION_SAMPLE_STRATEGIES = ["MOST_RECENT", "DETERMINISTIC_SAMPLE"] as const
export type InteractionSampleStrategy = (typeof INTERACTION_SAMPLE_STRATEGIES)[number]
export const INTERACTION_SAMPLE_MAX = 10

export type InteractionCandidate = { id: string; startedAt: Date }

export function selectionSeedOf(input: { enrollmentId: string; collaboratorId: string; window: { start: Date; end: Date } }): string {
  return `${input.enrollmentId}:${input.collaboratorId}:${input.window.start.toISOString()}:${input.window.end.toISOString()}`
}

const rankKey = (seed: string, id: string) => createHash("sha256").update(`${seed}:${id}`, "utf8").digest("hex")

/** Seleção pura e determinística: nunca depende da ordem de chegada dos candidatos. */
export function selectInteractions(candidates: readonly InteractionCandidate[], options: { strategy: InteractionSampleStrategy; size: number; seed: string }): string[] {
  const size = Math.max(0, Math.min(options.size, INTERACTION_SAMPLE_MAX))
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
  const ordered =
    options.strategy === "MOST_RECENT"
      ? unique.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || a.id.localeCompare(b.id))
      : unique.map((candidate) => ({ candidate, key: rankKey(options.seed, candidate.id) })).sort((a, b) => a.key.localeCompare(b.key) || a.candidate.id.localeCompare(b.candidate.id)).map((entry) => entry.candidate)
  return ordered.slice(0, size).map((candidate) => candidate.id)
}

/**
 * Chave de IDEMPOTÊNCIA de uma geração pedida por uma ação de Workflow. Decisão (V1.5.10): mesmo Workflow + mesmo nó de
 * ação + mesma interação + mesmo contrato do feedback = UM feedback, para sempre — cobre o retry da mesma execução, duas
 * matrículas concorrentes do mesmo disparo e execuções futuras da agenda. Outro Workflow/outro nó (configuração explícita)
 * ou um contrato novo geram outro feedback. A versão publicada do Workflow NÃO entra na chave: republicar não reenvia
 * feedback de interações já atendidas.
 */
export function workflowGenerationKeyOf(input: { workflowId: string; nodeId: string; interactionId: string; contractVersion?: string }): string {
  return ["WORKFLOW_ACTION", input.workflowId, input.nodeId, input.interactionId, input.contractVersion ?? INTERACTION_FEEDBACK_CONTRACT].join(":")
}
