import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { triggerConfigSchema } from "../domain/trigger-config-schema.js"
import { CONFIGURATION_CHANGE_LABELS, type WorkflowConfiguration } from "../domain/workflow-configuration.js"
import { assertGoLiveConfirmed, computeGoLiveImpact, type GoLiveImpact } from "./go-live-impact.js"
import { validateWorkflowForPublish } from "./validate-workflow-for-publish.js"
import { loadWorkflowConfigurationRow, type WorkflowConfigurationRow } from "./workflow-configuration-store.js"

type Queryable = Pick<Database, "query">

/**
 * PUBLICAR — o ÚNICO caminho pelo qual a configuração do rascunho (Gatilho, Abrangência, Modo de
 * avaliação) passa a valer no runtime, sempre junto com o grafo e na mesma transação:
 *   1. trava a linha do Workflow (duas publicações simultâneas nunca intercalam);
 *   2. valida rascunho (grafo + configuração) com a MESMA função do dry-run `POST /:id/validate`;
 *   3. calcula o impacto de entrar no ar e exige a confirmação explícita quando ele pede
 *      (go-live-impact.ts — Agenda com catch-up imediato ou população grande);
 *   4. grava a versão COM a configuração (a versão e o gatilho dela sempre batem) e copia o rascunho
 *      para as colunas vivas + `active_version_id`;
 *   5. registra em `audit_logs` (o que mudou na configuração e o impacto confirmado).
 */
export type PublishWorkflowInput = {
  organizationId: string
  workflowId: string
  actorPersonId: string | null
  /** `fingerprint` do impacto que a pessoa viu e confirmou (go-live-impact.ts). */
  confirmation?: string | null
  /** Autorização sobre a Abrangência — quem publica precisa gerenciar a do rascunho E a publicada. */
  canManageScope: (scope: { scopeType: string; teamId: string | null; subteamId: string | null }) => boolean
  now?: Date
}

export type PublishWorkflowResult = { versionId: string; impact: GoLiveImpact } | null

export async function publishWorkflow(db: Database, input: PublishWorkflowInput): Promise<PublishWorkflowResult> {
  return inTransaction(db, async (tx) => {
    const row = await loadWorkflowConfigurationRow(tx, input.organizationId, input.workflowId, { forUpdate: true })
    if (!row) return null
    if (!input.canManageScope(row.live)) return null
    if (!input.canManageScope(row)) {
      throw new DomainError("Você não tem permissão para publicar este workflow na Abrangência do rascunho.", "WORKFLOW_SCOPE_FORBIDDEN", 403)
    }

    const graph = await validateWorkflowForPublish(tx as Database, input.organizationId, input.workflowId, row)
    const draft = draftConfigurationOf(row)
    const impact = await computeGoLiveImpact(tx as Database, input.organizationId, {
      workflowId: input.workflowId,
      reason: "PUBLISH",
      configuration: draft,
      published: row.published ? row.live : null,
      active: row.active,
      now: input.now ?? new Date(),
    })
    assertGoLiveConfirmed(impact, input.confirmation)

    const version = await tx.query<{ id: string }>(
      `insert into workflow_versions(workflow_id, graph, created_by, trigger_config, scope_type, team_id, subteam_id, consolidated_structure, population_filter)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        input.workflowId,
        JSON.stringify(graph),
        input.actorPersonId,
        JSON.stringify(draft.triggerConfig),
        draft.scopeType,
        draft.teamId,
        draft.subteamId,
        draft.consolidatedStructure ? JSON.stringify(draft.consolidatedStructure) : null,
        draft.populationFilter ? JSON.stringify(draft.populationFilter) : null,
      ],
    )
    const versionId = version.rows[0]!.id
    await tx.query(
      `update workflows set
         active_version_id = $1,
         trigger_config = draft_trigger_config, scope_type = draft_scope_type, team_id = draft_team_id, subteam_id = draft_subteam_id,
         consolidated_structure = draft_consolidated_structure, population_filter = draft_population_filter,
         updated_at = now()
       where id = $2 and organization_id = $3`,
      [versionId, input.workflowId, input.organizationId],
    )
    if (input.actorPersonId) {
      await tx.query(
        `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'WORKFLOW_PUBLISHED', 'workflow', $3, $4)`,
        [
          input.organizationId,
          input.actorPersonId,
          input.workflowId,
          JSON.stringify({
            versionId,
            firstPublication: impact.firstPublication,
            configurationChanges: impact.configurationChanges.map((change) => CONFIGURATION_CHANGE_LABELS[change]),
            active: impact.goesLive,
            impact: impact.schedule
              ? { population: impact.schedule.population, immediateEnrollments: impact.schedule.immediate.enrollments, firstFireAt: impact.schedule.firstFireAt }
              : null,
            confirmedImpact: impact.requiresConfirmation ? { reasons: impact.reasons, fingerprint: impact.fingerprint } : null,
          }),
        ],
      )
    }
    return { versionId, impact }
  })
}

/** Configuração do rascunho com o gatilho normalizado pelo schema (defaults como `intervalDays`) — é ela que vira a publicada. */
export function draftConfigurationOf(row: WorkflowConfigurationRow): WorkflowConfiguration {
  const trigger = triggerConfigSchema.safeParse(row.triggerConfig)
  return {
    triggerConfig: trigger.success ? trigger.data : row.triggerConfig,
    scopeType: row.scopeType,
    teamId: row.teamId,
    subteamId: row.subteamId,
    consolidatedStructure: row.consolidatedStructure,
    populationFilter: row.populationFilter,
  }
}

/** Com o POOL, conexão dedicada (begin/commit); com um CLIENT já em transação (provas/QA), savepoint — nunca um commit de fora. */
async function inTransaction<T>(db: Database, work: (tx: Queryable) => Promise<T>): Promise<T> {
  if (typeof (db as unknown as { release?: unknown }).release === "function") {
    await db.query("savepoint workflow_publish_tx")
    try {
      const result = await work(db)
      await db.query("release savepoint workflow_publish_tx")
      return result
    } catch (error) {
      await db.query("rollback to savepoint workflow_publish_tx").catch(() => undefined)
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
