import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { instantOf, type Clock } from "../../../shared/domain/clock.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"

/**
 * VISIBILIDADE NO ACOMPANHAMENTO (migration 095) — ocultação LÓGICA de um feedback publicado nas superfícies de leitura do
 * produto (feed do colaborador, visão do gestor sobre o colaborador, feed da estrutura e contadores derivados), sem tocar no
 * registro: `feedbacks`, caso, artefato confiável, emissões do Workflow, Resultados e QA continuam intactos e acessíveis.
 *
 * A seleção é sempre EXPLÍCITA (lista de ids + motivo + rótulo da seleção), nunca uma regra por data ou por pessoa — ocultar
 * não pode atingir um feedback legítimo por acidente. Desfazer grava `restored_at`; a linha fica no histórico.
 */
export const FOLLOW_UP_HIDE_REASON_CODES = ["DEVELOPMENT_ARTIFACT"] as const
export type FollowUpHideReasonCode = (typeof FOLLOW_UP_HIDE_REASON_CODES)[number]

/** Fragmento ÚNICO de leitura: o feedback (alias `alias`) não tem ocultação vigente. */
export function visibleInFollowUpSql(alias: string): string {
  return `not exists (select 1 from feedback_follow_up_hides fh where fh.feedback_id = ${alias}.id and fh.restored_at is null)`
}

export type HideFromFollowUpInput = {
  organizationId: string
  feedbackIds: readonly string[]
  /** Quando informado, TODOS os ids precisam ser feedbacks deste colaborador (proteção contra id trocado). */
  expectedOperatorId?: string
  reasonCode: FollowUpHideReasonCode
  reason: string
  selectionRef: string
  actorId: string | null
  clock: Clock | Date
}

export type HideFromFollowUpResult = { hidden: string[]; alreadyHidden: string[] }

export async function hideFeedbacksFromFollowUp(db: Database, input: HideFromFollowUpInput): Promise<HideFromFollowUpResult> {
  const ids = [...new Set(input.feedbackIds)]
  if (ids.length === 0) throw new DomainError("Informe ao menos um feedback.", "FOLLOW_UP_HIDE_EMPTY_SELECTION", 422)
  if (!FOLLOW_UP_HIDE_REASON_CODES.includes(input.reasonCode)) throw new DomainError("Motivo de ocultação inválido.", "FOLLOW_UP_HIDE_INVALID_REASON", 422)
  if (!input.reason.trim()) throw new DomainError("Descreva o motivo da ocultação.", "FOLLOW_UP_HIDE_INVALID_REASON", 422)
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(input.selectionRef)) throw new DomainError("Rótulo da seleção inválido.", "FOLLOW_UP_HIDE_INVALID_SELECTION", 422)
  const at = instantOf(input.clock).toISOString()

  return inTransaction(db, async (client) => {
    const found = await client.query<{ id: string; operator_id: string }>(
      `select id, operator_id from feedbacks where organization_id = $1 and id = any($2::uuid[]) for update`,
      [input.organizationId, ids],
    )
    const missing = ids.filter((id) => !found.rows.some((row) => row.id === id))
    if (missing.length > 0) throw new DomainError(`Feedback não encontrado nesta organização: ${missing.join(", ")}`, "FOLLOW_UP_HIDE_FEEDBACK_NOT_FOUND", 404)
    if (input.expectedOperatorId) {
      const other = found.rows.filter((row) => row.operator_id !== input.expectedOperatorId).map((row) => row.id)
      if (other.length > 0) throw new DomainError(`Feedback de outro colaborador: ${other.join(", ")}`, "FOLLOW_UP_HIDE_OPERATOR_MISMATCH", 422)
    }
    const hidden: string[] = []
    const alreadyHidden: string[] = []
    for (const id of ids) {
      const inserted = await client.query<{ id: string }>(
        `insert into feedback_follow_up_hides (organization_id, feedback_id, reason_code, reason, selection_ref, hidden_by, hidden_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (feedback_id) where restored_at is null do nothing
         returning id`,
        [input.organizationId, id, input.reasonCode, input.reason.trim(), input.selectionRef, input.actorId, at],
      )
      if (!inserted.rows[0]) { alreadyHidden.push(id); continue }
      hidden.push(id)
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_HIDDEN_FROM_FOLLOW_UP', 'FEEDBACK', $3, $4, $5)`,
        [input.organizationId, input.actorId, id, JSON.stringify({ hideId: inserted.rows[0].id, reasonCode: input.reasonCode, reason: input.reason.trim(), selectionRef: input.selectionRef }), at],
      )
    }
    return { hidden, alreadyHidden }
  })
}

export async function restoreFeedbackToFollowUp(db: Database, input: { organizationId: string; feedbackId: string; reason: string; actorId: string | null; clock: Clock | Date }): Promise<{ restored: boolean }> {
  if (!input.reason.trim()) throw new DomainError("Descreva o motivo da restauração.", "FOLLOW_UP_HIDE_INVALID_REASON", 422)
  const at = instantOf(input.clock).toISOString()
  return inTransaction(db, async (client) => {
    const updated = await client.query<{ id: string }>(
      `update feedback_follow_up_hides set restored_at = $3, restored_by = $4, restore_reason = $5
       where organization_id = $1 and feedback_id = $2 and restored_at is null returning id`,
      [input.organizationId, input.feedbackId, at, input.actorId, input.reason.trim()],
    )
    const row = updated.rows[0]
    if (row) {
      await client.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, 'FEEDBACK_RESTORED_TO_FOLLOW_UP', 'FEEDBACK', $3, $4, $5)`,
        [input.organizationId, input.actorId, input.feedbackId, JSON.stringify({ hideId: row.id, reason: input.reason.trim() }), at],
      )
    }
    return { restored: Boolean(row) }
  })
}
