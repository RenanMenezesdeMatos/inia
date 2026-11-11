import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { loadEffectiveStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { resolveAgentVersionForRun } from "../../agents/application/agent-versions.js"
import { executionDenialFor } from "../../agents/application/agent-execution-authorization.js"
import { flowGraphSchema } from "../domain/graph-schema.js"
import { MANUAL_TRIGGER_CONTEXT_LABELS, triggerConfigSchema, type ManualTrigger, type ManualTriggerContext } from "../domain/trigger-config-schema.js"
import { isOperatorEligibleForWorkflow, loadEligibleOperator, resolveEligibleOperatorIds, type WorkflowPopulation } from "./workflow-eligibility.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"
import { enrollmentSubjectScopeParams, personInScopeSql, type EnrollmentSubjectScope } from "./enrollment-visibility.js"

/**
 * GATILHO MANUAL — "Executar agora" para UM colaborador escolhido explicitamente (nunca a população inteira).
 *
 * O disparo NÃO é um caminho paralelo: ele só cria a matrícula NORMAL do motor (`workflow_enrollments`), parada no nó
 * Gatilho da versão PUBLICADA e ATIVA (pinada na matrícula), com a origem de dados que o contexto do gatilho declara —
 * interação real (≈ Flag), medição real (≈ Indicador) ou só o colaborador (≈ Agenda individual). Quem avança o grafo
 * (Condition, Agent, Orquestrador, Gerar feedback, Revisão humana, Output…) é o motor de sempre (engine.ts).
 *
 * Nada é fabricado: interação/medição precisam existir, ser DO colaborador e da organização; o colaborador precisa estar
 * no escopo de quem dispara E ser elegível pelo Workflow (Abrangência + Filtro Populacional — a MESMA regra da ingestão e
 * da Agenda). O disparo (quem, quando, versão, colaborador, contexto) fica em `workflow_manual_runs` + auditoria, e a
 * matrícula aponta para ele (`manual_run_id`): a origem manual continua identificável.
 *
 * Idempotência: a MESMA chave (a tela gera uma por abertura do diálogo) devolve o disparo já registrado — duplo clique,
 * retry de rede e reenvio nunca criam duas execuções; um novo disparo intencional usa uma chave nova.
 */

export type ManualRunTarget = {
  id: string
  name: string
  active: boolean
  versionId: string | null
  scopeType: string
  teamId: string | null
  subteamId: string | null
  populationFilter: unknown
  consolidated: boolean
  trigger: ManualTrigger | null
  indicatorName: string | null
  indicatorUnit: string | null
  /** Agents/Orquestradores da versão PUBLICADA que não podem rodar agora (inativos, excluídos, só de chat) — impedem o disparo. */
  unavailableReferences?: ManualRunBlocker[]
}

export type ManualRunBlocker = { code: string; message: string }

/** Pessoa como o escopo de quem dispara precisa dela (Grupo/Subgrupo). */
export type CollaboratorScopeCheck = (person: { teamId: string | null; subteamId: string | null }) => boolean

/**
 * Impedimentos do WORKFLOW (antes de escolher qualquer pessoa) — puros, na ordem em que o admin precisa resolvê-los. A
 * tela mostra todos; o backend recusa com o primeiro.
 */
export function manualRunBlockers(target: ManualRunTarget): ManualRunBlocker[] {
  const blockers: ManualRunBlocker[] = []
  if (!target.trigger) {
    blockers.push({ code: "WORKFLOW_MANUAL_RUN_NOT_MANUAL", message: "Este workflow não usa o gatilho Manual — ele começa pelo próprio gatilho (Flag, Indicador ou Agenda)." })
    return blockers
  }
  if (!target.versionId) blockers.push({ code: "WORKFLOW_MANUAL_RUN_NOT_PUBLISHED", message: "O workflow ainda não foi publicado. Publique o rascunho antes de executar." })
  if (!target.active) blockers.push({ code: "WORKFLOW_MANUAL_RUN_INACTIVE", message: "O workflow está desativado. Ative-o antes de executar." })
  // Agent/Orquestrador desligado depois de publicar: o disparo era aceito e o nó falhava em seguida (validação funcional de
  // 20/10/2026, D10) — agora a tela mostra o motivo antes e o backend recusa.
  blockers.push(...(target.unavailableReferences ?? []))
  if (target.consolidated) blockers.push({ code: "WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED", message: "O gatilho Manual executa para um colaborador — troque o Alvo da avaliação para Individual." })
  if (target.trigger.context === "INDICATOR_MEASUREMENT" && !target.trigger.indicatorCode) {
    blockers.push({ code: "WORKFLOW_INVALID_TRIGGER", message: "O gatilho Manual não diz de qual indicador é a medição. Escolha o indicador nas configurações do workflow." })
  }
  return blockers
}

function assertRunnable(target: ManualRunTarget): asserts target is ManualRunTarget & { trigger: ManualTrigger; versionId: string } {
  const [first] = manualRunBlockers(target)
  if (!first) return
  const status = first.code === "WORKFLOW_MANUAL_RUN_NOT_MANUAL" || first.code === "WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED" || first.code === "WORKFLOW_INVALID_TRIGGER" ? 422 : 409
  throw new DomainError(first.message, first.code, status)
}

export async function loadManualRunTarget(db: Database, organizationId: string, workflowId: string): Promise<ManualRunTarget | null> {
  const result = await db.query<{
    id: string
    name: string
    active: boolean
    active_version_id: string | null
    scope_type: string
    team_id: string | null
    subteam_id: string | null
    population_filter: unknown
    consolidated_structure: unknown
    trigger_config: unknown
    indicator_name: string | null
    indicator_unit: string | null
  }>(
    `select w.id, w.name, w.active, w.active_version_id, w.scope_type, w.team_id, w.subteam_id, w.population_filter, w.consolidated_structure,
            w.trigger_config, idef.name indicator_name, idef.unit indicator_unit
       from workflows w
       left join indicator_definitions idef on idef.organization_id = w.organization_id and idef.code = w.trigger_config ->> 'indicatorCode'
      where w.id = $1 and w.organization_id = $2`,
    [workflowId, organizationId],
  )
  const row = result.rows[0]
  if (!row) return null
  const parsed = triggerConfigSchema.safeParse(row.trigger_config)
  const unavailableReferences = row.active_version_id ? await loadUnavailableReferences(db, organizationId, row.active_version_id) : []
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    versionId: row.active_version_id,
    scopeType: row.scope_type,
    teamId: row.team_id,
    subteamId: row.subteam_id,
    populationFilter: row.population_filter,
    consolidated: row.consolidated_structure !== null,
    trigger: parsed.success && parsed.data.kind === "manual" ? parsed.data : null,
    indicatorName: row.indicator_name,
    indicatorUnit: row.indicator_unit,
    unavailableReferences,
  }
}

/**
 * Agents ("Chamar agente") e Orquestradores da versão publicada que não rodariam agora — as mesmas recusas da publicação
 * (`WORKFLOW_AGENT_INACTIVE`, `WORKFLOW_ORCHESTRATOR_INACTIVE`…), mas sobre o estado ATUAL do cadastro.
 */
export async function loadUnavailableReferences(db: Database, organizationId: string, versionId: string): Promise<ManualRunBlocker[]> {
  const version = (await db.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [versionId])).rows[0]
  const graph = flowGraphSchema.safeParse(version?.graph)
  if (!graph.success) return []
  const agentNodes = graph.data.nodes.flatMap((node) => (node.type === "action" && node.config.actionType === "CALL_AGENT" ? [{ label: node.label, id: node.config.agentId }] : []))
  const orchestratorNodes = graph.data.nodes.flatMap((node) => (node.type === "orchestrator" ? [{ label: node.label, id: node.config.orchestratorId }] : []))
  const agents = new Map((await db.query<{ id: string; name: string; active: boolean; current_version_id: string | null }>(`select id, name, active, current_version_id from agents where organization_id = $1 and id = any($2::uuid[])`, [organizationId, agentNodes.map((node) => node.id)])).rows.map((row) => [row.id, row]))
  const workflowScope = (await db.query<{ scope_type: string; team_id: string | null; subteam_id: string | null }>(`select w.scope_type, w.team_id, w.subteam_id from workflow_versions v join workflows_all w on w.id = v.workflow_id where v.id = $1`, [versionId])).rows[0]
  const orchestrators = new Map((await db.query<{ id: string; name: string; active: boolean; invocation_mode: string }>(`select id, name, active, invocation_mode from assistant_orchestrators where organization_id = $1 and id = any($2::uuid[])`, [organizationId, orchestratorNodes.map((node) => node.id)])).rows.map((row) => [row.id, row]))
  const blockers: ManualRunBlocker[] = []
  for (const node of agentNodes) {
    const agent = agents.get(node.id)
    if (!agent) blockers.push({ code: "WORKFLOW_AGENT_NOT_FOUND", message: `O nó "${node.label}" usa um agente que não existe mais. Publique uma versão com outro agente antes de executar.` })
    else if (!agent.active) blockers.push({ code: "WORKFLOW_AGENT_INACTIVE", message: `O nó "${node.label}" usa o agente "${agent.name}", que está inativo. Ative-o (ou publique uma versão sem ele) antes de executar.` })
    else if (!agent.current_version_id) blockers.push({ code: "WORKFLOW_AGENT_NOT_PUBLISHED", message: `O nó "${node.label}" usa o agente "${agent.name}", que ainda não foi publicado. Publique-o antes de executar.` })
    else if (workflowScope) {
      // A versão VIGENTE do agente precisa estar autorizada para o alcance do Workflow (revisão de 03/11/2026) — a mesma conferência da execução.
      const snapshot = await resolveAgentVersionForRun(db, organizationId, agent.id)
      const denial = await executionDenialFor(db, snapshot, { scopeType: workflowScope.scope_type, teamId: workflowScope.team_id, subteamId: workflowScope.subteam_id })
      if (denial) blockers.push({ code: "WORKFLOW_AGENT_NOT_AUTHORIZED", message: `O nó "${node.label}" usa o agente "${agent.name}", cuja versão vigente não está autorizada para este Workflow (alcance ou bases do agente). Ajuste o agente antes de executar.` })
    }
  }
  for (const node of orchestratorNodes) {
    const orchestrator = orchestrators.get(node.id)
    if (!orchestrator) blockers.push({ code: "WORKFLOW_ORCHESTRATOR_NOT_FOUND", message: `O nó "${node.label}" usa um Orquestrador que não existe mais. Publique uma versão com outro Orquestrador antes de executar.` })
    else if (!orchestrator.active) blockers.push({ code: "WORKFLOW_ORCHESTRATOR_INACTIVE", message: `O nó "${node.label}" usa o Orquestrador "${orchestrator.name}", que está inativo. Ative-o (ou publique uma versão sem ele) antes de executar.` })
    else if (orchestrator.invocation_mode === "INTERACTIVE") blockers.push({ code: "WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION", message: `O nó "${node.label}" usa o Orquestrador "${orchestrator.name}", que só atende chat/voz. Publique uma versão com um Orquestrador habilitado para Workflows antes de executar.` })
  }
  return blockers
}

function populationOf(target: ManualRunTarget): WorkflowPopulation {
  return { scopeType: target.scopeType, teamId: target.teamId, subteamId: target.subteamId, populationFilter: target.populationFilter }
}

export type ManualRunCollaborator = { id: string; name: string; matricula: string | null; jobTitle: string | null; teamName: string | null; subteamName: string | null }

/**
 * Colaboradores que ESTE usuário pode escolher para ESTE Workflow: elegíveis pelo Workflow (Abrangência + Filtro
 * Populacional, mesma regra da ingestão/agenda) ∩ escopo de gestão de quem dispara. Busca por nome ou matrícula; nunca
 * devolve a população inteira de uma vez (a tela pede por busca, em páginas curtas).
 */
export async function listManualRunCollaborators(
  db: Database,
  organizationId: string,
  target: ManualRunTarget,
  canAccess: CollaboratorScopeCheck,
  options: { search?: string | undefined; limit?: number } = {},
): Promise<{ items: ManualRunCollaborator[]; total: number }> {
  const eligible = await resolveEligibleOperatorIds(db, organizationId, populationOf(target))
  if (eligible.length === 0) return { items: [], total: 0 }
  const search = options.search?.trim() ? `%${options.search.trim()}%` : null
  const rows = await db.query<ManualRunCollaborator & { teamId: string | null; subteamId: string | null }>(
    `select p.id, p.name, p.matricula, p.job_title "jobTitle", p.team_id "teamId", p.subteam_id "subteamId", t.name "teamName", st.name "subteamName"
       from people p
       left join teams t on t.id = p.team_id
       left join subteams st on st.id = p.subteam_id
      where p.organization_id = $1 and p.id = any($2::uuid[])
        and ($3::text is null or p.name ilike $3 or coalesce(p.matricula, '') ilike $3)
      order by p.name, p.id`,
    [organizationId, eligible, search],
  )
  const visible = rows.rows.filter((row) => canAccess({ teamId: row.teamId, subteamId: row.subteamId }))
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100)
  return {
    total: visible.length,
    items: visible.slice(0, limit).map((row) => ({ id: row.id, name: row.name, matricula: row.matricula, jobTitle: row.jobTitle, teamName: row.teamName, subteamName: row.subteamName })),
  }
}

/** Colaborador escolhido: existe, é operador ativo da organização, está no escopo de quem dispara e é elegível. */
async function assertCollaboratorAllowed(db: Database, organizationId: string, target: ManualRunTarget, collaboratorId: string, canAccess: CollaboratorScopeCheck): Promise<{ id: string; name: string }> {
  const person = await db.query<{ id: string; name: string; team_id: string | null; subteam_id: string | null }>(
    `select id, name, team_id, subteam_id from people where id = $1 and organization_id = $2`,
    [collaboratorId, organizationId],
  )
  const row = person.rows[0]
  // Fora do escopo de quem dispara = "não encontrado" (não revela que a pessoa existe).
  if (!row || !canAccess({ teamId: row.team_id, subteamId: row.subteam_id })) {
    throw new DomainError("Colaborador não encontrado no seu escopo.", "WORKFLOW_MANUAL_RUN_COLLABORATOR_NOT_FOUND", 404)
  }
  const operator = await loadEligibleOperator(db, organizationId, collaboratorId)
  if (!operator || !(await isOperatorEligibleForWorkflow(db, organizationId, populationOf(target), collaboratorId, operator))) {
    throw new DomainError(
      `${row.name} não é elegível para este workflow (precisa ser um operador ativo dentro da Abrangência e do Filtro Populacional do workflow).`,
      "WORKFLOW_MANUAL_RUN_COLLABORATOR_NOT_ELIGIBLE",
      422,
    )
  }
  return { id: row.id, name: row.name }
}

export type ManualRunInteraction = {
  id: string
  externalId: string
  /** Motivo (`interactions.reason`). */
  subject: string
  /** Submotivo; null = a fonte não informou. */
  subReason: string | null
  channel: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  flags: { name: string; value: string }[]
}

/** Interações REAIS do colaborador com transcrição (a análise precisa dela), mais recentes primeiro. */
export async function listManualRunInteractions(
  db: Database,
  organizationId: string,
  target: ManualRunTarget,
  collaboratorId: string,
  canAccess: CollaboratorScopeCheck,
  options: { search?: string | undefined; limit?: number } = {},
): Promise<ManualRunInteraction[]> {
  assertRunnableContext(target, "INTERACTION")
  await assertCollaboratorAllowed(db, organizationId, target, collaboratorId, canAccess)
  const search = options.search?.trim() ? `%${options.search.trim()}%` : null
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100)
  const result = await db.query<ManualRunInteraction>(
    `select i.id, i.external_id "externalId", i.reason subject, i.sub_reason "subReason", i.channel, i.started_at "startedAt", i.ended_at "endedAt",
            extract(epoch from (i.ended_at - i.started_at))::int "durationSeconds",
            coalesce((
              select json_agg(json_build_object('name', cf.flag_name, 'value', coalesce(f.value_boolean::text, f.value_numeric::text)) order by cf.flag_name)
                from interaction_flags f join channel_flags cf on cf.id = f.channel_flag_id
               where f.interaction_id = i.id
            ), '[]') flags
       from interactions i
      where i.organization_id = $1 and i.operator_id = $2
        and exists (select 1 from transcripts tr where tr.interaction_id = i.id)
        and ($3::text is null or i.reason ilike $3 or i.sub_reason ilike $3 or i.external_id ilike $3)
      order by i.started_at desc, i.id
      limit $4`,
    [organizationId, collaboratorId, search, limit],
  )
  return result.rows
}

export type ManualRunMeasurement = { id: string; periodStart: string; periodEnd: string; value: number; source: string }

/** Medições REAIS do indicador do gatilho para o colaborador, mais recentes primeiro. */
export async function listManualRunMeasurements(
  db: Database,
  organizationId: string,
  target: ManualRunTarget,
  collaboratorId: string,
  canAccess: CollaboratorScopeCheck,
  options: { limit?: number } = {},
): Promise<ManualRunMeasurement[]> {
  assertRunnableContext(target, "INDICATOR_MEASUREMENT")
  await assertCollaboratorAllowed(db, organizationId, target, collaboratorId, canAccess)
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100)
  const result = await db.query<{ id: string; period_start: string; period_end: string; value: string; source: string }>(
    `select m.id, m.period_start, m.period_end, m.value, m.source
       from indicator_measurements m
       join indicator_definitions d on d.id = m.indicator_definition_id
      where m.organization_id = $1 and d.code = $2 and m.subject_type = 'PERSON' and m.subject_id = $3
      order by m.period_end desc, m.id
      limit $4`,
    [organizationId, target.trigger?.indicatorCode ?? null, collaboratorId, limit],
  )
  return result.rows.map((row) => ({ id: row.id, periodStart: row.period_start, periodEnd: row.period_end, value: Number(row.value), source: row.source }))
}

function assertRunnableContext(target: ManualRunTarget, context: ManualTriggerContext): void {
  assertRunnable(target)
  if (target.trigger.context !== context) {
    throw new DomainError(`Este workflow manual pede "${MANUAL_TRIGGER_CONTEXT_LABELS[target.trigger.context]}", não "${MANUAL_TRIGGER_CONTEXT_LABELS[context]}".`, "WORKFLOW_MANUAL_RUN_CONTEXT_MISMATCH", 422)
  }
}

export type ManualRunRequest = {
  organizationId: string
  workflowId: string
  requestedBy: string
  collaboratorId: string
  interactionId?: string | null
  indicatorMeasurementId?: string | null
  idempotencyKey: string
}

type ResolvedContext =
  | { context: "COLLABORATOR" }
  | { context: "INTERACTION"; interactionId: string }
  | { context: "INDICATOR_MEASUREMENT"; indicatorMeasurementId: string; value: number }

async function resolveRunContext(db: Database, organizationId: string, target: ManualRunTarget & { trigger: ManualTrigger }, request: ManualRunRequest): Promise<ResolvedContext> {
  const { context } = target.trigger
  if (context !== "INTERACTION" && request.interactionId) {
    throw new DomainError("Este workflow não usa uma interação selecionada.", "WORKFLOW_MANUAL_RUN_CONTEXT_UNEXPECTED", 422)
  }
  if (context !== "INDICATOR_MEASUREMENT" && request.indicatorMeasurementId) {
    throw new DomainError("Este workflow não usa uma medição selecionada.", "WORKFLOW_MANUAL_RUN_CONTEXT_UNEXPECTED", 422)
  }
  if (context === "COLLABORATOR") return { context }

  if (context === "INTERACTION") {
    if (!request.interactionId) throw new DomainError("Selecione a interação do colaborador que será analisada.", "WORKFLOW_MANUAL_RUN_CONTEXT_REQUIRED", 422)
    const interaction = await db.query<{ operator_id: string; has_transcript: boolean }>(
      `select i.operator_id, exists (select 1 from transcripts tr where tr.interaction_id = i.id) has_transcript
         from interactions i where i.id = $1 and i.organization_id = $2`,
      [request.interactionId, organizationId],
    )
    const row = interaction.rows[0]
    if (!row || row.operator_id !== request.collaboratorId) {
      throw new DomainError("A interação selecionada não pertence a este colaborador.", "WORKFLOW_MANUAL_RUN_INTERACTION_INVALID", 422)
    }
    if (!row.has_transcript) throw new DomainError("A interação selecionada não tem transcrição — escolha outra.", "WORKFLOW_MANUAL_RUN_INTERACTION_INVALID", 422)
    return { context, interactionId: request.interactionId }
  }

  if (!request.indicatorMeasurementId) throw new DomainError("Selecione a medição do indicador que será analisada.", "WORKFLOW_MANUAL_RUN_CONTEXT_REQUIRED", 422)
  const measurement = await db.query<{ subject_type: string; subject_id: string; code: string; value: string }>(
    `select m.subject_type, m.subject_id, d.code, m.value
       from indicator_measurements m join indicator_definitions d on d.id = m.indicator_definition_id
      where m.id = $1 and m.organization_id = $2`,
    [request.indicatorMeasurementId, organizationId],
  )
  const row = measurement.rows[0]
  if (!row || row.subject_type !== "PERSON" || row.subject_id !== request.collaboratorId || row.code !== target.trigger.indicatorCode) {
    throw new DomainError("A medição selecionada não é deste colaborador e do indicador deste workflow.", "WORKFLOW_MANUAL_RUN_MEASUREMENT_INVALID", 422)
  }
  return { context, indicatorMeasurementId: request.indicatorMeasurementId, value: Number(row.value) }
}

type ExistingRunRow = { id: string; collaborator_id: string; interaction_id: string | null; indicator_measurement_id: string | null }

async function findRunByKey(db: Pick<Database, "query">, workflowId: string, requestedBy: string, idempotencyKey: string): Promise<ExistingRunRow | null> {
  const result = await db.query<ExistingRunRow>(
    `select id, collaborator_id, interaction_id, indicator_measurement_id from workflow_manual_runs where workflow_id = $1 and requested_by = $2 and idempotency_key = $3`,
    [workflowId, requestedBy, idempotencyKey],
  )
  return result.rows[0] ?? null
}

/** A mesma chave só vale para o MESMO pedido — reaproveitá-la com outro colaborador/contexto é erro, nunca "o anterior". */
function assertSameRequest(existing: ExistingRunRow, request: ManualRunRequest): void {
  if (
    existing.collaborator_id !== request.collaboratorId ||
    (existing.interaction_id ?? null) !== (request.interactionId ?? null) ||
    (existing.indicator_measurement_id ?? null) !== (request.indicatorMeasurementId ?? null)
  ) {
    throw new DomainError("Esta solicitação já foi usada para outro disparo. Abra o diálogo de novo para uma nova execução.", "WORKFLOW_MANUAL_RUN_IDEMPOTENCY_CONFLICT", 409)
  }
}

export type ManualRunResult = { runId: string; enrollmentId: string; created: boolean }

export async function requestManualRun(db: Database, request: ManualRunRequest, canAccess: CollaboratorScopeCheck): Promise<ManualRunResult> {
  const target = await loadManualRunTarget(db, request.organizationId, request.workflowId)
  if (!target) throw new DomainError("Workflow não encontrado.", "WORKFLOW_NOT_FOUND", 404)

  // Reenvio da MESMA solicitação: devolve o disparo registrado (sem revalidar o estado atual do workflow — ele já nasceu).
  const previous = await findRunByKey(db, request.workflowId, request.requestedBy, request.idempotencyKey)
  if (previous) {
    assertSameRequest(previous, request)
    return { runId: previous.id, enrollmentId: await enrollmentOfRun(db, previous.id), created: false }
  }

  assertRunnable(target)
  await assertCollaboratorAllowed(db, request.organizationId, target, request.collaboratorId, canAccess)
  const context = await resolveRunContext(db, request.organizationId, target, request)

  const versionResult = await db.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1 and workflow_id = $2`, [target.versionId, target.id])
  const graph = flowGraphSchema.parse(versionResult.rows[0]?.graph)
  const triggerNode = graph.nodes.find((node) => node.type === "trigger")
  if (!triggerNode) throw new DomainError("A versão publicada não tem nó Gatilho.", "WORKFLOW_INVALID_GRAPH", 422)
  // V1.6.2 — a versão da estratégia de diagnóstico EFETIVA fica presa na execução (a mesma regra da matrícula por Indicador).
  const strategy = context.context === "INDICATOR_MEASUREMENT" && target.trigger.indicatorCode ? await loadEffectiveStrategy(db, request.organizationId, { code: target.trigger.indicatorCode }) : null

  const created = await inTransaction(db, async (tx) => {
    // A unique (workflow, quem, chave) decide a corrida de dois cliques simultâneos: só um disparo nasce.
    const inserted = await tx.query<{ id: string }>(
      `insert into workflow_manual_runs (organization_id, workflow_id, version_id, requested_by, idempotency_key, context, collaborator_id, interaction_id, indicator_measurement_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (workflow_id, requested_by, idempotency_key) do nothing
       returning id`,
      [
        request.organizationId,
        target.id,
        target.versionId,
        request.requestedBy,
        request.idempotencyKey,
        context.context,
        request.collaboratorId,
        context.context === "INTERACTION" ? context.interactionId : null,
        context.context === "INDICATOR_MEASUREMENT" ? context.indicatorMeasurementId : null,
      ],
    )
    const runId = inserted.rows[0]?.id
    if (!runId) return null

    // Matrícula NORMAL, parada no Gatilho: exatamente uma origem de dados (interação | medição | colaborador).
    const enrollment = await tx.query<{ id: string }>(
      `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, manual_run_id,
                                         interaction_id, indicator_measurement_id, matched_value_numeric, indicator_diagnostic_strategy_version_id, scheduled_subject_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        request.organizationId,
        target.id,
        target.versionId,
        triggerNode.id,
        runId,
        context.context === "INTERACTION" ? context.interactionId : null,
        context.context === "INDICATOR_MEASUREMENT" ? context.indicatorMeasurementId : null,
        context.context === "INDICATOR_MEASUREMENT" ? context.value : null,
        strategy?.id ?? null,
        context.context === "COLLABORATOR" ? request.collaboratorId : null,
      ],
    )
    const enrollmentId = enrollment.rows[0]!.id
    const trace = {
      manualRunId: runId,
      requestedBy: request.requestedBy,
      context: context.context,
      collaboratorId: request.collaboratorId,
      interactionId: context.context === "INTERACTION" ? context.interactionId : null,
      indicatorMeasurementId: context.context === "INDICATOR_MEASUREMENT" ? context.indicatorMeasurementId : null,
      workflowVersionId: target.versionId,
    }
    await tx.query(
      `insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key) values ($1, $2, 'manual_run_requested', $3, $4)`,
      [enrollmentId, triggerNode.id, JSON.stringify(trace), `manual:${runId}`],
    )
    await tx.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'WORKFLOW_MANUAL_RUN_REQUESTED', 'workflow_manual_run', $3, $4)`,
      [request.organizationId, request.requestedBy, runId, JSON.stringify({ ...trace, workflowId: target.id, enrollmentId })],
    )
    return { runId, enrollmentId }
  })
  if (created) return { ...created, created: true }

  const concurrent = await findRunByKey(db, request.workflowId, request.requestedBy, request.idempotencyKey)
  if (!concurrent) throw new DomainError("Não foi possível registrar o disparo. Tente de novo.", "WORKFLOW_MANUAL_RUN_CONFLICT", 409)
  assertSameRequest(concurrent, request)
  return { runId: concurrent.id, enrollmentId: await enrollmentOfRun(db, concurrent.id), created: false }
}

/**
 * Transação da escrita: com o POOL, uma conexão dedicada (begin/commit); com um CLIENT já dentro de uma transação (provas),
 * um savepoint — nunca um commit que vazaria a transação de fora (mesmo padrão da estratégia de diagnóstico).
 */
const inTransaction = transactionRunner("workflow_manual_run_tx")

async function enrollmentOfRun(db: Pick<Database, "query">, runId: string): Promise<string> {
  const result = await db.query<{ id: string }>(`select id from workflow_enrollments where manual_run_id = $1`, [runId])
  return result.rows[0]?.id ?? ""
}

/**
 * Estágio do disparo para a tela — derivado do estado REAL da matrícula e das entregas persistidas. "Solicitado" nunca é
 * "entregue": só há entrega quando o Output gravou algo (Acompanhamento/Chat/Avatar), e no Avatar "disponível" (convite)
 * é diferente de "ouvido" (DELIVERED — o colaborador aceitou e a fala terminou).
 */
export type ManualRunStage = "QUEUED" | "PROCESSING" | "RETRYING" | "WAITING" | "COMPLETED" | "FAILED" | "BLOCKED"

export type ManualRunDelivery = { surface: string; status: string; recipientName: string | null; createdAt: string; deliveredAt: string | null; title: string | null }

export type ManualRunView = {
  id: string
  workflowId: string
  workflowName: string
  versionId: string
  versionNumber: number
  requestedAt: string
  requestedBy: { id: string; name: string }
  context: ManualTriggerContext
  collaborator: { id: string; name: string; matricula: string | null }
  interaction: { id: string; subject: string; subReason: string | null; startedAt: string } | null
  measurement: { id: string; periodStart: string; periodEnd: string; value: number; indicatorName: string | null } | null
  execution: {
    enrollmentId: string
    status: string
    stage: ManualRunStage
    /** Motivo de "blocked": agente inativo, acesso não autorizado ou revisão sem revisor ou sem conteúdo; null nos demais. */
    blockedReason: string | null
    /** Só nos bloqueios de Revisão humana: por que não há revisor ou conteúdo. */
    blockedCause: string | null
    currentNodeId: string
    currentNodeLabel: string | null
    waitingFor: "HUMAN_REVIEW" | "FEEDBACK_QA" | "WAIT" | null
    lastError: string | null
    nextRetryAt: string | null
    updatedAt: string
    events: { nodeId: string; nodeLabel: string | null; eventType: string; createdAt: string }[]
  }
  deliveries: ManualRunDelivery[]
  /** Intervenções que o nó "Avaliar política de acompanhamento" abriu ou recomendou nesta execução (não são entregas). */
  interventions: { id: string; caseId: string; typeName: string; status: string; responsibleName: string; dueAt: string }[]
}

const WAIT_EVENT: Record<string, ManualRunView["execution"]["waitingFor"]> = {
  reliable_feedback_held_for_qa: "FEEDBACK_QA",
  human_review_requested: "HUMAN_REVIEW",
  wait_started: "WAIT",
}

export function manualRunStageOf(status: string, currentNodeIsTrigger: boolean, lastEventType: string | null): ManualRunStage {
  if (status === "completed") return "COMPLETED"
  if (status === "dead" || status === "failed") return "FAILED"
  if (status === "blocked") return "BLOCKED"
  if (status === "waiting") return "WAITING"
  if (lastEventType === "node_failed") return "RETRYING"
  return currentNodeIsTrigger && (lastEventType === null || lastEventType === "manual_run_requested") ? "QUEUED" : "PROCESSING"
}

/** `scope` = escopo de `workflows.manage` de quem lê: disparo para colaborador fora dele não existe (null → 404). */
export async function loadManualRun(db: Database, organizationId: string, workflowId: string, runId: string, scope: EnrollmentSubjectScope): Promise<ManualRunView | null> {
  const result = await db.query<{
    id: string
    workflow_id: string
    workflow_name: string
    version_id: string
    version_number: number
    requested_at: string
    requested_by: string
    requested_by_name: string
    context: ManualTriggerContext
    collaborator_id: string
    collaborator_name: string
    collaborator_matricula: string | null
    interaction_id: string | null
    interaction_subject: string | null
    interaction_sub_reason: string | null
    interaction_started_at: string | null
    measurement_id: string | null
    measurement_period_start: string | null
    measurement_period_end: string | null
    measurement_value: string | null
    indicator_name: string | null
    enrollment_id: string | null
    status: string | null
    blocked_reason: string | null
    blocked_details: { cause?: string } | null
    current_node_id: string | null
    updated_at: string | null
    graph: unknown
  }>(
    `select r.id, r.workflow_id, w.name workflow_name, r.version_id,
            (select count(*) from workflow_versions v2 where v2.workflow_id = r.workflow_id and v2.created_at <= v.created_at)::int version_number,
            r.requested_at, r.requested_by, rb.name requested_by_name, r.context,
            r.collaborator_id, c.name collaborator_name, c.matricula collaborator_matricula,
            r.interaction_id, i.reason interaction_subject, i.sub_reason interaction_sub_reason, i.started_at interaction_started_at,
            r.indicator_measurement_id measurement_id, m.period_start measurement_period_start, m.period_end measurement_period_end, m.value measurement_value, d.name indicator_name,
            e.id enrollment_id, e.status, e.blocked_reason, e.blocked_details, e.current_node_id, e.updated_at, v.graph
       from workflow_manual_runs r
       join workflows_all w on w.id = r.workflow_id
       join workflow_versions v on v.id = r.version_id
       join people rb on rb.id = r.requested_by
       join people c on c.id = r.collaborator_id
       left join interactions i on i.id = r.interaction_id
       left join indicator_measurements_all m on m.id = r.indicator_measurement_id
       left join indicator_definitions_all d on d.id = m.indicator_definition_id
       left join workflow_enrollments e on e.manual_run_id = r.id
      where r.id = $1 and r.workflow_id = $2 and r.organization_id = $3
        and ${personInScopeSql("c", { allTeams: "$4", teamIds: "$5", subteamIds: "$6" })}`,
    [runId, workflowId, organizationId, ...enrollmentSubjectScopeParams(scope)],
  )
  const row = result.rows[0]
  if (!row || !row.enrollment_id) return null
  const graph = flowGraphSchema.safeParse(row.graph)
  const labelOf = (nodeId: string) => (graph.success ? (graph.data.nodes.find((node) => node.id === nodeId)?.label ?? null) : null)
  const triggerNodeId = graph.success ? (graph.data.nodes.find((node) => node.type === "trigger")?.id ?? null) : null

  const events = await db.query<{ node_id: string; event_type: string; payload: Record<string, unknown>; created_at: string }>(
    `select node_id, event_type, payload, created_at from workflow_enrollment_events where enrollment_id = $1 order by created_at, (event_type <> 'manual_run_requested'), id`,
    [row.enrollment_id],
  )
  // Filhos de fan-out não existem aqui (Manual é sempre Individual): as entregas são da própria matrícula.
  const deliveries = await db.query<ManualRunDelivery>(
    `select o.surface, o.delivery_status status, p.name "recipientName", o.created_at "createdAt", o.delivered_at "deliveredAt", o.title
       from workflow_outputs o left join people p on p.id = o.recipient_id
      where o.enrollment_id = $1
     union all
     select x.surface, 'DELIVERED' status, p.name "recipientName", x.created_at "createdAt", x.created_at "deliveredAt", null title
       from workflow_output_emissions x left join people p on p.id = x.recipient_id
      where x.enrollment_id = $1
      order by "createdAt"`,
    [row.enrollment_id],
  )
  const interventions = await db.query<ManualRunView["interventions"][number]>(
    `select i.id, i.case_id "caseId", coalesce(v.definition->>'name', i.type_key) "typeName", i.status, r.name "responsibleName", i.due_at::text "dueAt"
       from interventions i join intervention_type_versions v on v.id = i.type_version_id join people r on r.id = i.responsible_id
      where i.enrollment_id = $1 order by i.created_at`,
    [row.enrollment_id],
  )
  const lastEvent = events.rows[events.rows.length - 1] ?? null
  const lastFailure = [...events.rows].reverse().find((event) => event.event_type === "node_failed" || event.event_type === "flow_dead") ?? null
  const status = row.status ?? "active"
  const stage = manualRunStageOf(status, row.current_node_id === triggerNodeId, lastEvent?.event_type ?? null)
  const waitEvent = status === "waiting" ? [...events.rows].reverse().find((event) => WAIT_EVENT[event.event_type] !== undefined) : undefined

  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    versionId: row.version_id,
    versionNumber: row.version_number,
    requestedAt: row.requested_at,
    requestedBy: { id: row.requested_by, name: row.requested_by_name },
    context: row.context,
    collaborator: { id: row.collaborator_id, name: row.collaborator_name, matricula: row.collaborator_matricula },
    interaction: row.interaction_id && row.interaction_started_at ? { id: row.interaction_id, subject: row.interaction_subject ?? "", subReason: row.interaction_sub_reason, startedAt: row.interaction_started_at } : null,
    measurement:
      row.measurement_id && row.measurement_period_start && row.measurement_period_end
        ? { id: row.measurement_id, periodStart: row.measurement_period_start, periodEnd: row.measurement_period_end, value: Number(row.measurement_value), indicatorName: row.indicator_name }
        : null,
    execution: {
      enrollmentId: row.enrollment_id,
      status,
      stage,
      blockedReason: status === "blocked" ? row.blocked_reason : null,
      blockedCause: status === "blocked" ? (row.blocked_details?.cause ?? null) : null,
      currentNodeId: row.current_node_id ?? "",
      currentNodeLabel: row.current_node_id ? labelOf(row.current_node_id) : null,
      waitingFor: waitEvent ? (WAIT_EVENT[waitEvent.event_type] ?? null) : null,
      lastError: stage === "FAILED" || stage === "RETRYING" ? (typeof lastFailure?.payload.message === "string" ? lastFailure.payload.message : null) : null,
      nextRetryAt: stage === "RETRYING" && typeof lastFailure?.payload.nextRetryAt === "string" ? lastFailure.payload.nextRetryAt : null,
      updatedAt: row.updated_at ?? row.requested_at,
      events: events.rows.map((event) => ({ nodeId: event.node_id, nodeLabel: labelOf(event.node_id), eventType: event.event_type, createdAt: event.created_at })),
    },
    deliveries: deliveries.rows,
    interventions: interventions.rows,
  }
}

/** Últimos disparos manuais deste Workflow (quem, quando, para quem, estado) — a trilha que a tela mostra; só os de
 * colaboradores no escopo de quem lê (`scope`, a mesma regra das Execuções — enrollment-visibility.ts). */
export async function listManualRuns(db: Database, organizationId: string, workflowId: string, scope: EnrollmentSubjectScope, limit = 10): Promise<{ id: string; requestedAt: string; requestedByName: string; collaboratorName: string; status: string | null; enrollmentId: string | null }[]> {
  const result = await db.query<{ id: string; requestedAt: string; requestedByName: string; collaboratorName: string; status: string | null; enrollmentId: string | null }>(
    `select r.id, r.requested_at "requestedAt", rb.name "requestedByName", c.name "collaboratorName", e.status, e.id "enrollmentId"
       from workflow_manual_runs r
       join people rb on rb.id = r.requested_by
       join people c on c.id = r.collaborator_id
       left join workflow_enrollments e on e.manual_run_id = r.id
      where r.workflow_id = $1 and r.organization_id = $2
        and ${personInScopeSql("c", { allTeams: "$4", teamIds: "$5", subteamIds: "$6" })}
      order by r.requested_at desc, r.id
      limit $3`,
    [workflowId, organizationId, Math.min(Math.max(limit, 1), 50), ...enrollmentSubjectScopeParams(scope)],
  )
  return result.rows
}
