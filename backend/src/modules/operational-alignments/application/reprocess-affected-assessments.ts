import type { Database } from "../../../infrastructure/database/pool.js"
import { analyzeCall } from "../../feedback-engine/application/analyze-call.js"
import { createEngineDeps } from "../../feedback-engine/application/engine-wiring.js"
import { recordAlignmentEvent } from "./alignment-audit.js"
import { affectedAssessments } from "./operational-alignment-service.js"

/**
 * REPROCESSAMENTO RASTREÁVEL de monitorias concluídas que podem ter sido avaliadas pelo procedimento oficial durante a vigência de um
 * alinhamento (publicado depois da monitoria, ou com início retroativo). Lista = `affectedAssessments` (avaliação vigente, chamada na
 * vigência, público na data, critério do procedimento afetado, sem o alinhamento na fotografia).
 *
 * Reprocessar = a MESMA análise do motor (`analyzeCall`) com o MESMO especialista da avaliação anterior, pela data do atendimento — a
 * regra única aplica o alinhamento — e gatilho próprio (`OPERATIONAL_ALIGNMENT_REPROCESS`, com alinhamento, versão, avaliação anterior e
 * quem pediu). A avaliação nova substitui a anterior (`supersede_reason = 'REANALYZED'`, `superseded_by`); nada é apagado; o Diagnóstico
 * passa a ler a nova. Feedback já entregue NÃO é refeito nem retirado aqui (decisão da liderança, fora deste fluxo). Consome IA.
 */
export type ReprocessRequest = { organizationId: string; alignmentId: string; requestedBy: string | null; reason: string; limit: number; onlyWithDeviation: boolean; callAssessmentIds?: readonly string[] }

export async function reprocessAffectedAssessments(db: Database, input: ReprocessRequest) {
  const scopes = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
  const affected = await affectedAssessments(db, input.organizationId, scopes, input.alignmentId, Math.max(input.limit, input.callAssessmentIds?.length ?? 0))
  const selected = affected.items
    .filter((item) => !input.onlyWithDeviation || item.withDeviation)
    .filter((item) => !input.callAssessmentIds || input.callAssessmentIds.includes(item.callAssessmentId))
    .slice(0, input.limit)
  const deps = createEngineDeps({ db })
  const results: { callAssessmentId: string; interactionId: string; ok: boolean; runId?: string; newCallAssessmentId?: string | null; alignmentApplied?: boolean; error?: string }[] = []
  for (const item of selected) {
    try {
      const result = await analyzeCall(deps.analyze, {
        organizationId: input.organizationId,
        interactionId: item.interactionId,
        collaboratorId: item.personId,
        agentId: item.agentId,
        trigger: { kind: "OPERATIONAL_ALIGNMENT_REPROCESS", selectionReason: `Reprocessamento pelo alinhamento operacional (versão ${item.version}): ${input.reason}`, parentRunId: item.analysisRunId },
      })
      const run = await deps.memory.getRun(input.organizationId, result.runId)
      const used = ((run?.provenance as { operationalAlignments?: { alignmentId: string }[] } | undefined)?.operationalAlignments ?? []).some((entry) => entry.alignmentId === input.alignmentId)
      results.push({ callAssessmentId: item.callAssessmentId, interactionId: item.interactionId, ok: true, runId: result.runId, newCallAssessmentId: result.assessment?.id ?? null, alignmentApplied: used })
    } catch (error) {
      results.push({ callAssessmentId: item.callAssessmentId, interactionId: item.interactionId, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "erro desconhecido" })
    }
  }
  await recordAlignmentEvent(db, { organizationId: input.organizationId, alignmentId: input.alignmentId, type: "REPROCESSED", actorPersonId: input.requestedBy, details: { reason: input.reason, results } })
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'OPERATIONAL_ALIGNMENT_REPROCESSED', 'operational_alignment', $3, $4)`, [input.organizationId, input.requestedBy, input.alignmentId, JSON.stringify({ reason: input.reason, results })])
  return { found: affected.items.length, truncated: affected.truncated, results }
}
