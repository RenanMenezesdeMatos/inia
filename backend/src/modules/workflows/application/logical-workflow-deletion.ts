import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { WORKFLOW_DELETED } from "../domain/execution-block.js"

const STOPPED_MESSAGE = "O Workflow foi excluído. Esta execução foi interrompida e o histórico dela continua guardado."

/**
 * EXCLUSÃO LÓGICA: o Workflow sai das telas e para de rodar, e nada é apagado (migration 175). Versões, execuções, eventos e recados continuam guardados, e a Consultar dados mostra tudo.
 * Sem apagar, nenhuma chave estrangeira entra na conta: Workflow que já gerou feedback também pode ser excluído.
 *
 * As execuções que ainda iam rodar ficam bloqueadas com o motivo, em vez de paradas para sempre em "Aguardando": deixam de ser pendência de revisão e de contar como em andamento. Uma
 * etapa que já estava rodando termina sem efeito no fluxo, porque a revisão da linha mudou (`applyOutcome`). Quem chama já conferiu o alcance de quem pede.
 */
export async function deleteWorkflowLogically(db: Database, input: { organizationId: string; workflowId: string; actorPersonId: string | null }): Promise<boolean> {
  const { organizationId, workflowId, actorPersonId } = input
  return inTransaction(db, async (client) => {
    const deleted = await client.query<{ name: string }>(
      `update workflows_all set active = false, deleted_at = now(), deleted_by_person_id = $3, updated_at = now() where id = $1 and organization_id = $2 and deleted_at is null returning name`,
      [workflowId, organizationId, actorPersonId],
    )
    const workflow = deleted.rows[0]
    if (!workflow) return false
    const stopped = await client.query<{ id: string; current_node_id: string }>(
      `update workflow_enrollments
          set status = 'blocked', blocked_at = now(), blocked_node_id = current_node_id, blocked_reason = $3, blocked_details = '{}'::jsonb, claimed_until = null, revision = revision + 1, updated_at = now()
        where workflow_id = $1 and organization_id = $2 and status in ('active', 'waiting')
        returning id, current_node_id`,
      [workflowId, organizationId, WORKFLOW_DELETED],
    )
    if (stopped.rows.length > 0) {
      await client.query(
        `insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key)
         select id, node_id, 'node_blocked', $3::jsonb, 'workflow-deleted' from unnest($1::uuid[], $2::text[]) as t(id, node_id)`,
        [stopped.rows.map((row) => row.id), stopped.rows.map((row) => row.current_node_id), JSON.stringify({ reason: WORKFLOW_DELETED, message: STOPPED_MESSAGE })],
      )
    }
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'WORKFLOW_DELETED', 'workflow', $3, $4)`, [organizationId, actorPersonId, workflowId, JSON.stringify({ name: workflow.name, stoppedExecutions: stopped.rows.length })])
    return true
  })
}
