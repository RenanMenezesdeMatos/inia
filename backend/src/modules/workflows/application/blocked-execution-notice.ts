import type { Database } from "../../../infrastructure/database/pool.js"
import { canManageScope, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import type { HumanReviewBlockReason } from "../domain/execution-block.js"
import type { WorkflowEffectSink } from "./effect-sink.js"

/**
 * Aviso de execução bloqueada (D1, `docs/qa/workflows/propostas.md`). Vai para quem publicou a versão vigente, mesmo sendo o
 * colaborador da execução: o destinatário decorre da responsabilidade pela publicação. Quem não tem mais acesso ao workflow não
 * recebe, e versão sem publicador ativo não avisa ninguém: nada escolhe outra pessoa no lugar.
 *
 * A linha gravada não guarda workflow, etapa nem colaborador. Quem pode ver recebe esses dados na leitura do sino, e a permissão
 * daquele momento decide o que aparece e o que conta nos não lidos (notifications-repository.ts). Sem caso vinculado, para o sino não
 * associar o colaborador ao aviso.
 */
export const EXECUTION_BLOCKED_ALERT_TYPE = "WORKFLOW_EXECUTION_BLOCKED"

const KEY_PREFIX = "workflow_execution_blocked:"
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}(${UUID_PATTERN}):(.+):(\\d{4}-\\d{2}-\\d{2})$`)

/** O workflow do aviso, lido da chave. Chave fora do formato dá `null`: o aviso fica invisível, sem erro na consulta. */
export function executionBlockedWorkflowIdSql(alias: string): string {
  return `case when ${alias}.dedupe_key ~ '^${KEY_PREFIX}${UUID_PATTERN}:' then substr(${alias}.dedupe_key, ${KEY_PREFIX.length + 1}, 36)::uuid end`
}

const NOTICE_TEXTS: Readonly<Record<HumanReviewBlockReason, string>> = {
  HUMAN_REVIEW_NO_REVIEWER: "Uma execução parou porque a revisão não tem revisor disponível.",
  HUMAN_REVIEW_CONTENT_MISSING: "Uma execução parou porque o conteúdo a revisar não está disponível.",
}

export function parseExecutionBlockedKey(dedupeKey: string): { workflowId: string; nodeId: string } | null {
  const match = KEY_PATTERN.exec(dedupeKey)
  return match ? { workflowId: match[1]!, nodeId: match[2]! } : null
}

type NoticeContext = { db: Database; organizationId: string; workflowId: string; nodeId: string; effects: Pick<WorkflowEffectSink, "dispatchAlert"> }

export async function notifyPublisherOfBlockedExecution(context: NoticeContext, reason: HumanReviewBlockReason): Promise<void> {
  const { db, organizationId, workflowId, nodeId, effects } = context
  const publisher = (await db.query<{ person_id: string; account_id: string; scope_type: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; team_id: string | null; subteam_id: string | null; today: string }>(
    `select p.id person_id, a.id account_id, w.scope_type, w.team_id, w.subteam_id,
            (now() at time zone coalesce((select o.timezone from operations o where o.organization_id = w.organization_id order by o.created_at limit 1), 'America/Fortaleza'))::date::text today
     from workflows w
     join workflow_versions v on v.id = w.active_version_id
     join people p on p.id = v.created_by and p.active
     join user_accounts a on a.person_id = p.id and a.organization_id = w.organization_id and a.active
     where w.id = $1 and w.organization_id = $2`,
    [workflowId, organizationId],
  )).rows[0]
  if (!publisher) return
  const scopes = await getManageableScopes(db, { organizationId, sub: publisher.account_id }, "workflows.manage")
  if (!canManageScope(scopes, { scopeType: publisher.scope_type, teamId: publisher.team_id, subteamId: publisher.subteam_id })) return
  await effects.dispatchAlert(db, {
    organizationId,
    caseId: null,
    recipientId: publisher.person_id,
    title: "Execução de workflow bloqueada",
    description: NOTICE_TEXTS[reason],
    severity: "HIGH",
    alertType: EXECUTION_BLOCKED_ALERT_TYPE,
    dedupeKey: `${KEY_PREFIX}${workflowId}:${nodeId}:${publisher.today}`,
  })
}
