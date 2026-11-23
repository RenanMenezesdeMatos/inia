import { assertWorkflowGraphUniverse } from "../../operating-universe/application/resource-universe.js"
import { isUniverseEnforced } from "../../operating-universe/application/universe-access.js"
import { isOperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { triggerConfigSchema } from "../domain/trigger-config-schema.js"
import { CONFIGURATION_CHANGE_LABELS, type WorkflowConfiguration } from "../domain/workflow-configuration.js"
import { assertGoLiveConfirmed, computeGoLiveImpact, type GoLiveImpact } from "./go-live-impact.js"
import { validateWorkflowForPublish } from "./validate-workflow-for-publish.js"
import { loadWorkflowConfigurationRow, type WorkflowConfigurationRow } from "./workflow-configuration-store.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"
import { pinGraphReferences } from "./workflow-agent-version.js"
import { normalizeScopeLinks, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { replaceResourceScopeLinks } from "../../org-structure/application/resource-scope-links.js"
import type { ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { scopeLinkProblems, sortLinks } from "../../../shared/domain/scope-links/scope-links.js"
import { workflowScopedTarget, workflowScopeLinksJson } from "../domain/workflow-scope.js"

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
  canManageScope: (scope: ScopedTarget) => boolean
  now?: Date
}

export type PublishWorkflowResult = { versionId: string; impact: GoLiveImpact } | null

export async function publishWorkflow(db: Database, input: PublishWorkflowInput): Promise<PublishWorkflowResult> {
  return inTransaction(db, async (tx: Queryable) => {
    const row = await loadWorkflowConfigurationRow(tx, input.organizationId, input.workflowId, { forUpdate: true })
    if (!row) return null
    if (!input.canManageScope(workflowScopedTarget(row.live))) return null
    if (!input.canManageScope(workflowScopedTarget(row))) {
      throw new DomainError("Você não tem permissão para publicar este workflow na Abrangência do rascunho.", "WORKFLOW_SCOPE_FORBIDDEN", 403)
    }

    const graph = await pinGraphReferences(tx, input.organizationId, await validateWorkflowForPublish(tx as Database, input.organizationId, input.workflowId, row))
    const draft = draftConfigurationOf(row)
    // Abrangência do rascunho, conferida de novo (o rascunho é jsonb sem FK): Grupo/Subgrupo ainda existentes, Subgrupo do Grupo certo,
    // sem duplicata e ao menos um vínculo — "nenhum Grupo" nunca entra no ar (não alcançaria ninguém, nem vira "todos").
    const liveScope = await publishableScopeOf(tx, input.organizationId, draft)
    // Universos não se misturam: agentes, Orquestradores e indicadores citados precisam ser do universo do Workflow.
    await assertWorkflowGraphUniverse(tx, input.organizationId, [graph, draft.triggerConfig], isOperatingUniverse(draft.operatingUniverse) ? draft.operatingUniverse : null, await isUniverseEnforced(tx, input.organizationId))
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
      `insert into workflow_versions(workflow_id, graph, created_by, trigger_config, scope_type, team_id, subteam_id, scope_links, consolidated_structure, population_filter, operating_universe, require_active_access)
       values ($1,$2,$3,$4,$5,null,null,$6,$7,$8,$9,$10) returning id`,
      [
        input.workflowId,
        JSON.stringify(graph),
        input.actorPersonId,
        JSON.stringify(draft.triggerConfig),
        liveScope.scopeType,
        workflowScopeLinksJson(liveScope.links),
        draft.consolidatedStructure ? JSON.stringify(draft.consolidatedStructure) : null,
        draft.populationFilter ? JSON.stringify(draft.populationFilter) : null,
        draft.operatingUniverse,
        draft.requireActiveAccess === true,
      ],
    )
    const versionId = version.rows[0]!.id
    // O rascunho passa a mostrar as mesmas versões fixadas na publicação (só preenche referências que ainda não tinham versão).
    await tx.query(
      `update workflows set draft_graph = $3 where id = $1 and organization_id = $2 and draft_graph is not null`,
      [input.workflowId, input.organizationId, JSON.stringify(await pinGraphReferences(tx, input.organizationId, (row.draftGraph ?? { nodes: [] }) as { nodes: unknown[] }))],
    )
    await tx.query(
      `update workflows set
         active_version_id = $1,
         trigger_config = draft_trigger_config, scope_type = $4, team_id = null, subteam_id = null,
         draft_scope_type = $4, draft_team_id = null, draft_subteam_id = null, draft_scope_links = $5::jsonb,
         consolidated_structure = draft_consolidated_structure, population_filter = draft_population_filter,
         operating_universe = draft_operating_universe,
         require_active_access = draft_require_active_access,
         updated_at = now()
       where id = $2 and organization_id = $3`,
      [versionId, input.workflowId, input.organizationId, liveScope.scopeType, workflowScopeLinksJson(liveScope.links)],
    )
    // Vínculos publicados (o gatilho da 144 não enxerga esta tabela): na mesma transação da versão e das colunas vivas.
    await replaceResourceScopeLinks(tx, "WORKFLOW", input.organizationId, input.workflowId, liveScope)
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
            // "Somente quem tem acesso ativo à INIA": quantos entravam no momento da publicação (ligada ou sendo desligada).
            access: impact.access,
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
    scopeLinks: row.scopeLinks,
    teamId: row.teamId ?? null,
    subteamId: row.subteamId ?? null,
    consolidatedStructure: row.consolidatedStructure,
    populationFilter: row.populationFilter,
    operatingUniverse: row.operatingUniverse,
    requireActiveAccess: row.requireActiveAccess === true,
  }
}

/**
 * Abrangência do rascunho pronta para entrar no ar (ALL_TEAMS ou GROUPS + vínculos com o Grupo-pai real). Legado TEAM/SUBTEAM vira o
 * vínculo equivalente. A elegibilidade dos vínculos (universo, operador em produção) foi conferida ao SALVAR o rascunho; aqui só o que
 * pode ter mudado sem passar pela tela (Grupo/Subgrupo removido ou movido).
 */
async function publishableScopeOf(db: Queryable, organizationId: string, draft: WorkflowConfiguration): Promise<ResourceScope> {
  if (draft.scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS", links: [] }
  const raw =
    draft.scopeType === "GROUPS"
      ? draft.scopeLinks
      : draft.scopeType === "TEAM" && draft.teamId
        ? [{ teamId: draft.teamId, subteamId: null }]
        : draft.scopeType === "SUBTEAM" && draft.subteamId
          ? [{ teamId: draft.teamId ?? null, subteamId: draft.subteamId }]
          : []
  const links = raw.length > 0 ? await normalizeScopeLinks(db, organizationId, raw) : []
  if (!links || links.length === 0 || scopeLinkProblems(links).length > 0) {
    throw new DomainError(
      links && links.length === 0
        ? "Escolha ao menos um Grupo ou Subgrupo na Abrangência — ou “Todos os Grupos e Subgrupos” — antes de publicar."
        : "A Abrangência do rascunho tem Grupo ou Subgrupo que não existe mais (ou repetido). Revise a Abrangência antes de publicar.",
      "WORKFLOW_SCOPE_INVALID",
      422,
    )
  }
  return { scopeType: "GROUPS", links: sortLinks(links) }
}

/** Com o POOL, conexão dedicada (begin/commit); com um CLIENT já em transação (provas/QA), savepoint — nunca um commit de fora. */
const inTransaction = transactionRunner("workflow_publish_tx")
