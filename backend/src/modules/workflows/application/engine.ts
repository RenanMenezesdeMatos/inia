import { HumanReviewBlockedError, TRIGGERING_RECORD_CANCELLED } from "../domain/execution-block.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { runWithAiWorkflowCorrelation } from "../../../shared/application/model-routing/ai-runtime.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { env } from "../../../config/env.js"
import { findNode, flowGraphSchema, type FlowGraph } from "../domain/graph-schema.js"
import { callsModelOnEachVisit } from "../domain/paid-node-cycles.js"
import type { ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import { buildEmployeeFanInOutput, countFanOutChildren, loadFanOutChildren } from "./consolidate-results-executor.js"
import { productionEffects } from "./effect-sink.js"
import { classifyExecutionError, EXECUTION_ERROR_CATEGORY_LABELS, type ExecutionFailure } from "../../../shared/domain/execution-failure.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { decideNodeRetry } from "../domain/node-retry-policy.js"
import { AgentInactiveError } from "../../agents/domain/agent-inactive-error.js"
import { AgentAccessBlockedError } from "../../agents/application/agent-execution-authorization.js"
import { loadLatestTranscriptForModel } from "./transcript.js"
import { processNode, type EnrollmentRow, type NodeOutcome } from "./node-handlers.js"

/** Teto de matrículas por passada de `runWorkflowTick` (uma passada = provas/scripts; o servidor usa o worker). */
const CLAIM_LIMIT = 20
/**
 * Posse de uma matrícula pelo worker que a reivindicou. Não é o tempo máximo de um nó: enquanto o nó roda, o heartbeat
 * renova a posse a cada 1/3 da lease (holdEnrollmentLease). Só um worker que PAROU de renovar (processo morto, banco
 * inacessível) perde a matrícula — e ela volta ao claim quando a lease vence.
 */
const LEASE_SECONDS = 120
/**
 * Teto da posse renovada: um nó que ainda não terminou depois disso é tratado como travado (promessa que nunca resolve) —
 * o heartbeat para, a lease vence e outro worker o retoma. Folga larga sobre o nó mais longo conhecido (investigação de
 * indicador do motor de feedback, ~12 min; a própria posse da análise é de 15 min).
 */
const MAX_HOLD_SECONDS = 60 * 60
// Intervalo de repoll do PAI aguardando a barreira de "Consolidar resultados" (fan-in/JOIN) — o
// pai fica `active`/`current_node_id=<join>` e é pego de novo pelo claim loop normal, reaproveitando
// skip-locked+lease+revision otimista (idempotência/concorrência de graça, sem mecanismo novo).
const CONSOLIDATE_POLL_SECONDS = 20

/**
 * Token da posse = o `claimed_until` EXATO que gravamos, em texto ISO UTC com microssegundos (independente de
 * DateStyle/TimeZone da sessão). Toda renovação é um compare-and-swap sobre ele: só renova quem ainda detém a posse.
 */
const LEASE_TOKEN_SQL = `to_char(claimed_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

export type ClaimedRow = EnrollmentRow & {
  scope_type: string
  workflow_team_id: string | null
  workflow_subteam_id: string | null
  consolidated_structure: ConsolidatedStructure | null
  population_filter: unknown
  claimed_until: string
}

export type LeaseOptions = {
  /** Duração da posse (padrão LEASE_SECONDS); o heartbeat renova a cada 1/3. Só provas/testes encurtam. */
  leaseSeconds?: number
  /** Teto da posse renovada (padrão MAX_HOLD_SECONDS). Só testes encurtam. */
  maxHoldSeconds?: number
}

export type ClaimRequest = {
  /** Quantas matrículas reivindicar agora (vagas livres do worker). */
  limit: number
  leaseSeconds?: number
  /** Restringe o claim a estas matrículas — só provas contra o banco de teste compartilhado; o servidor nunca passa. */
  enrollmentIds?: readonly string[] | null
  /** Matrículas que este worker não deve pegar agora (trava de laço quente). */
  excludeEnrollmentIds?: readonly string[]
  /**
   * Justiça entre workflows: no máximo N matrículas do MESMO workflow em execução neste worker (contando as que já estão
   * rodando, `runningByWorkflow`). Dentro do limite, a ordem é rodízio — a 1ª vencida de cada workflow antes da 2ª de
   * qualquer um —, então um fan-out de 2.000 colaboradores nunca segura o workflow de outro grupo.
   */
  perWorkflowLimit?: number
  runningByWorkflow?: ReadonlyMap<string, number>
}

/**
 * Reivindica matrículas vencidas e livres (`claimed_until` nulo ou vencido) com `skip locked` — seguro com vários workers
 * e várias instâncias no mesmo banco: cada matrícula vencida é entregue a exatamente um. A posse nasce com o relógio do
 * BANCO, o mesmo do `claimed_until < now()` do claim — nunca depende do relógio do worker.
 */
export async function claimDueEnrollments(db: Database, request: ClaimRequest): Promise<ClaimedRow[]> {
  if (request.limit <= 0) return []
  const running = [...(request.runningByWorkflow ?? new Map<string, number>())]
  return inTransaction(db, async (client) => {
    const due = await client.query<Omit<ClaimedRow, "claimed_until">>(
      `with running as (
         select * from unnest($3::uuid[], $4::int[]) as r(workflow_id, count)
       ),
       ranked as (
         select we.id, we.next_eval_at,
                row_number() over (partition by we.workflow_id order by we.next_eval_at, we.id) as position,
                coalesce(r.count, 0) as running
         from workflow_enrollments we
         -- Workflow desativado não roda: as execuções em andamento ficam paradas onde estão até ele ser reativado (achado C06 da
         -- 4ª auditoria — antes, desativar só parava os disparos novos e um ciclo continuava gastando IA).
         join workflows active_workflow on active_workflow.id = we.workflow_id and active_workflow.active
         left join running r on r.workflow_id = we.workflow_id
         where we.next_eval_at <= now() and we.status in ('active', 'waiting')
           and (we.claimed_until is null or we.claimed_until < now())
           and ($2::uuid[] is null or we.id = any($2::uuid[]))
           and not (we.id = any($6::uuid[]))
       ),
       picked as (
         select id from ranked where position + running <= $5 order by position, next_eval_at limit $1
       )
       select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id,
              we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
              we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision,
              we.node_outputs, we.variables, we.parent_enrollment_id, we.retry_of_enrollment_id,
              w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter
       from workflow_enrollments we
       join workflows w on w.id = we.workflow_id
       where we.id in (select id from picked) and w.active
         and we.next_eval_at <= now() and we.status in ('active', 'waiting')
         and (we.claimed_until is null or we.claimed_until < now())
       order by we.next_eval_at
       for update of we skip locked`,
      [
        request.limit,
        request.enrollmentIds ? [...request.enrollmentIds] : null,
        running.map(([workflowId]) => workflowId),
        running.map(([, count]) => count),
        request.perWorkflowLimit ?? request.limit,
        [...(request.excludeEnrollmentIds ?? [])],
      ],
    )
    let claimed: ClaimedRow[] = []
    if (due.rows.length > 0) {
      const leased = await client.query<{ id: string; token: string }>(
        `update workflow_enrollments set claimed_until = now() + make_interval(secs => $2)
         where id = any($1::uuid[])
         returning id, ${LEASE_TOKEN_SQL} token`,
        [due.rows.map((row) => row.id), request.leaseSeconds ?? LEASE_SECONDS],
      )
      const tokens = new Map(leased.rows.map((row) => [row.id, row.token]))
      claimed = due.rows.map((row) => ({ ...row, claimed_until: tokens.get(row.id)! }))
    }
    return claimed
  })
}

/**
 * Executa o nó atual de UMA matrícula já reivindicada, mantendo a posse durante toda a execução. Antes do efeito caro
 * (chamar a IA, criar Feedback/Case) renova a posse de forma atômica, condicionada ao token do claim: se outro worker já
 * a reivindicou nesse meio tempo (lease vencida), devolve false sem executar nada — quem reivindicou de novo é quem
 * processa. A partir daí o heartbeat mantém a posse enquanto o nó roda (um nó de 12 min nunca é reexecutado em paralelo).
 */
export async function processClaimedEnrollment(db: Database, row: ClaimedRow, options: LeaseOptions = {}): Promise<boolean> {
  const lease = await holdEnrollmentLease(db, row, options.leaseSeconds ?? LEASE_SECONDS, options.maxHoldSeconds ?? MAX_HOLD_SECONDS)
  if (!lease) return false
  try {
    await processEnrollment(db, { ...row, claimed_until: lease.token })
  } finally {
    await lease.stop()
  }
  return true
}

export type WorkflowTickOptions = LeaseOptions & {
  /** Restringe o claim a estas matrículas — só provas contra o banco de teste compartilhado. */
  enrollmentIds?: readonly string[]
}

/**
 * UMA passada do motor: reivindica até CLAIM_LIMIT matrículas vencidas e executa todas em paralelo (uma não espera a
 * outra), devolvendo quando todas terminam. Usada por provas e scripts; o servidor roda o worker contínuo
 * (workflow-worker.ts), que usa as MESMAS funções de claim e execução. Erro técnico de uma matrícula não interrompe as
 * outras: todas terminam e só então o primeiro erro sobe.
 */
export async function runWorkflowTick(db: Database, options: WorkflowTickOptions = {}): Promise<{ processed: number }> {
  const claimed = await claimDueEnrollments(db, { limit: CLAIM_LIMIT, leaseSeconds: options.leaseSeconds ?? LEASE_SECONDS, enrollmentIds: options.enrollmentIds ?? null })
  const results = await Promise.allSettled(claimed.map((row) => processClaimedEnrollment(db, row, options)))
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
  if (failure) throw failure.reason
  return { processed: results.filter((result) => result.status === "fulfilled" && result.value).length }
}

/** Devolve uma matrícula reivindicada que não vai ser executada (worker parando) — só se a posse ainda for a do claim. */
export async function releaseClaimedEnrollment(db: Database, row: ClaimedRow): Promise<void> {
  await db.query(`update workflow_enrollments set claimed_until = null where id = $1 and claimed_until = $2::timestamptz`, [row.id, row.claimed_until])
}

/** Compare-and-swap da posse: renova só se `claimed_until` ainda é o token que gravamos. Devolve o token novo ou null. */
async function renewLease(db: Database, enrollmentId: string, token: string, leaseSeconds: number): Promise<string | null> {
  const renewed = await db.query<{ token: string }>(
    `update workflow_enrollments set claimed_until = now() + make_interval(secs => $3)
     where id = $1 and claimed_until = $2::timestamptz
     returning ${LEASE_TOKEN_SQL} token`,
    [enrollmentId, token, leaseSeconds],
  )
  return renewed.rows[0]?.token ?? null
}

type EnrollmentLease = { token: string; stop(): Promise<void> }

/**
 * Assume a posse da matrícula (CAS sobre o token do claim) e a mantém viva com um heartbeat enquanto o nó roda — cada
 * batida é outro CAS sobre o último token, então nunca ressuscita uma matrícula que saiu da nossa posse: concluída/falhou
 * (o applyOutcome zera `claimed_until`), decidida por outro caminho, ou reivindicada por outro tick depois que paramos de
 * renovar. Worker morto = sem batidas = a lease vence e o claim normal a recupera. `stop()` encerra o heartbeat e espera
 * a batida em voo (nenhuma consulta sobra depois do tick).
 */
async function holdEnrollmentLease(db: Database, row: ClaimedRow, leaseSeconds: number, maxHoldSeconds: number): Promise<EnrollmentLease | null> {
  const first = await renewLease(db, row.id, row.claimed_until, leaseSeconds)
  if (!first) return null
  let token = first
  let holding = true
  let beat: Promise<void> = Promise.resolve()
  const holdUntil = Date.now() + maxHoldSeconds * 1000
  const release = () => {
    holding = false
    clearInterval(timer)
  }
  const timer = setInterval(() => {
    if (!holding) return
    if (Date.now() >= holdUntil) {
      release()
      console.warn(JSON.stringify({ event: "workflow_enrollment_lease_hold_limit", enrollmentId: row.id, nodeId: row.current_node_id, maxHoldSeconds }))
      return
    }
    beat = beat.then(async () => {
      if (!holding) return
      try {
        const next = await renewLease(db, row.id, token, leaseSeconds)
        if (next) token = next
        else release()
      } catch (error) {
        // Falha transitória do banco: a posse continua sendo nossa até a lease vencer — tenta de novo na próxima batida.
        console.warn(JSON.stringify({ event: "workflow_enrollment_lease_heartbeat_failed", enrollmentId: row.id, nodeId: row.current_node_id, error: error instanceof Error ? error.message : String(error) }))
      }
    })
  }, (leaseSeconds * 1000) / 3)
  timer.unref?.()
  return {
    token: first,
    async stop() {
      release()
      await beat
    },
  }
}

// Exportado só pra prova de banco (V1.5.10, workflow-interaction-feedback-proof) — processa UMA matrícula já reivindicada
// exatamente como o worker; o único caminho de produção continua sendo processClaimedEnrollment (posse + este nó).
export async function processEnrollment(db: Database, row: ClaimedRow): Promise<void> {
  // Chamadas de IA deste nó pertencem à organização da matrícula (policy/uso/orçamento — AI Providers V1) e ficam
  // correlacionadas a ESTA execução (V1.5.13: workflow → versão → disparo → matrícula → nó), sem heurística.
  const correlation = { workflowId: row.workflow_id, workflowVersionId: row.version_id, enrollmentId: row.id, rootEnrollmentId: row.parent_enrollment_id ?? row.id, nodeId: row.current_node_id }
  return runWithAiWorkflowCorrelation(row.organization_id, correlation, () => processEnrollmentInOrganization(db, row))
}

/**
 * Medição cancelada na Central de Dados: a execução que nasceu dela não continua. Conferido aqui, antes de qualquer etapa, porque cada uma reagiria de um jeito: a Saída falha, mas a
 * Revisão humana ficaria esperando sem ninguém avisado e a Condição seguiria com o valor guardado. Bloqueada só anda com uma nova tentativa confirmada, e a tentativa exige que a
 * medição tenha voltado a valer. Só existe em Workflow pausado que voltou, em nova tentativa e em intervalo curto de execução manual: com Workflow rodando, o cancelamento é recusado.
 */
async function isTriggeringRecordCancelled(db: Database, row: ClaimedRow): Promise<boolean> {
  if (!row.indicator_measurement_id) return false
  const result = await db.query(`select 1 from indicator_measurements_all where id = $1 and cancelled_at is not null`, [row.indicator_measurement_id])
  return (result.rowCount ?? 0) > 0
}

async function processEnrollmentInOrganization(db: Database, row: ClaimedRow): Promise<void> {
  try {
    if (await isTriggeringRecordCancelled(db, row)) {
      return markBlocked(db, row, { reason: TRIGGERING_RECORD_CANCELLED, message: "A medição que iniciou esta execução foi cancelada na Central de Dados. Nada mais roda por ela. Se a medição voltar a valer, solicite uma nova tentativa.", details: {} })
    }
    const versionResult = await db.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [row.version_id])
    const graph = flowGraphSchema.parse(versionResult.rows[0]?.graph)
    const node = findNode(graph, row.current_node_id)
    if (!node) {
      await markFailed(db, row, { category: "APPLICATION_INVARIANT_VIOLATION", code: "WORKFLOW_NODE_INVARIANT", message: `Nó "${row.current_node_id}" não existe mais na versão pinada deste workflow.` }, null)
      return
    }
    // Teto de execuções do MESMO nó que chama a IA nesta execução (achado C06 da 4ª auditoria): um ciclo nunca gasta IA sem limite.
    // Conta só as vezes em que o nó RODOU E SEGUIU (`action_executed`/`orchestrator_executed`) — as várias chamadas de IA dentro de
    // uma execução do nó, as tentativas que falharam e as esperas não entram. Contado nos eventos gravados, não na memória do
    // processo: vale com vários workers e depois de reiniciar. Fluxo sem ciclo roda cada nó uma vez por execução.
    if (callsModelOnEachVisit(node)) {
      const runs = (await db.query<{ n: number }>(`select count(*)::int n from workflow_enrollment_events where enrollment_id = $1 and node_id = $2 and event_type in ('action_executed', 'orchestrator_executed')`, [row.id, node.id])).rows[0]?.n ?? 0
      if (runs >= env.WORKFLOW_MAX_PAID_NODE_RUNS) {
        await markFailed(db, row, { category: "APPLICATION_INVARIANT_VIOLATION", code: "WORKFLOW_PAID_NODE_RUN_LIMIT", message: `O nó "${node.label}" chama a IA e já rodou ${runs} vezes nesta execução (limite: ${env.WORKFLOW_MAX_PAID_NODE_RUNS}). A execução foi encerrada para não repetir o gasto de IA.` }, null)
        return
      }
    }

    let inputContext = ""
    if (row.interaction_id) {
      inputContext = (await loadLatestTranscriptForModel(db, row.interaction_id))?.content ?? ""
    }

    const outcome = await processNode(
      {
        db,
        graph,
        enrollment: row,
        workflow: {
          scopeType: row.scope_type,
          teamId: row.workflow_team_id,
          subteamId: row.workflow_subteam_id,
          consolidatedStructure: row.consolidated_structure,
          populationFilter: row.population_filter,
        },
        inputContext,
        now: new Date(),
        effects: productionEffects,
      },
      node,
    )

    await applyOutcome(db, row, outcome)
  } catch (error) {
    if (error instanceof AgentInactiveError || error instanceof AgentAccessBlockedError) return markBlocked(db, row, agentBlockOf(error))
    if (error instanceof HumanReviewBlockedError) return markBlocked(db, row, { reason: error.reason, message: error.message, details: { cause: error.blockCause } })
    await markFailed(db, row, classifyExecutionError(error), await contractDiagnosticsOf(db, row, error))
  }
}

type ExecutionBlock = { reason: string; message: string; details: Record<string, unknown> }

function agentBlockOf(error: AgentInactiveError | AgentAccessBlockedError): ExecutionBlock {
  // Acesso não autorizado (revisão de 03/11/2026): a versão vigente do agente não cobre o alcance do Workflow ou usa base não
  // autorizada. O motivo é genérico — nada do que é restrito vai para o registro.
  const details = { agentId: error.agentId, agentName: error.agentName, agentVersionId: error.agentVersionId, agentVersionNumber: error.agentVersionNumber, ...(error instanceof AgentAccessBlockedError ? { denial: error.reason } : {}) }
  return error instanceof AgentAccessBlockedError
    ? { reason: "AGENT_ACCESS_NOT_AUTHORIZED", details, message: `${error.message} Ajuste o agente (alcance ou bases da versão vigente) e solicite uma nova tentativa.` }
    : { reason: "AGENT_INACTIVE", details, message: "Agente inativo. Reative ou substitua o agente e solicite uma nova tentativa." }
}

/**
 * Agente inativo (PEN-070, PEN-073) ou revisão sem revisor ou sem conteúdo (P5c, D2): a execução fica bloqueada na etapa, sem nova
 * tentativa automática — nem ao corrigir a causa, nem ao republicar ou religar o Workflow. As etapas já concluídas mantêm os
 * resultados; nada é entregue por ela. Só uma nova tentativa confirmada por alguém continua o trabalho (workflow-retry.ts).
 */
async function markBlocked(db: Database, row: ClaimedRow, block: ExecutionBlock): Promise<void> {
  const { reason, message, details } = block
  await recordEvent(db, row, "node_blocked", { reason, message, ...details })
  await db.query(
    `update workflow_enrollments
     set status = 'blocked', blocked_at = now(), blocked_node_id = current_node_id, blocked_reason = $4, blocked_details = $3,
         claimed_until = null, revision = revision + 1, updated_at = now()
     where id = $1 and revision = $2`,
    [row.id, row.revision, JSON.stringify(details), reason],
  )
}

/** Violações mostradas no evento (caminho + código; nunca conteúdo) — as primeiras, com o total. */
const MAX_EVENT_VIOLATIONS = 20

/**
 * V1.7.1c — diagnóstico de uma resposta REJEITADA pelo contrato: a resposta bruta vai para `agent_runs` (acesso
 * administrativo; o caminho do Agent direto já a gravou na própria execução — aqui só o especialista acionado pelo
 * Orquestrador, que não tinha execução registrada) e o evento carrega versão do contrato, violações, modelo e o vínculo.
 */
async function contractDiagnosticsOf(db: Database, row: ClaimedRow, error: unknown): Promise<Record<string, unknown> | null> {
  if (!(error instanceof ModelOutputContractError)) return null
  const diagnostics = error.diagnostics
  let agentRunId = diagnostics.agentRunId
  if (!agentRunId && diagnostics.agentId && diagnostics.rawResponse) {
    try {
      agentRunId = await productionEffects.agentRuns.start(db, { organizationId: row.organization_id, agentId: diagnostics.agentId, source: "WORKFLOW", inputContext: `[Resposta rejeitada pelo contrato ${diagnostics.contract} — execução ${row.id}, nó ${row.current_node_id}]`, model: diagnostics.model })
      await productionEffects.agentRuns.fail(db, agentRunId, error.message, diagnostics.rawResponse)
    } catch (persistError) {
      // Guardar o diagnóstico nunca pode esconder a falha original nem mudar a decisão de retry.
      console.warn(JSON.stringify({ event: "workflow_rejected_output_not_stored", enrollmentId: row.id, error: persistError instanceof Error ? persistError.message : String(persistError) }))
      agentRunId = null
    }
  }
  return {
    contract: { name: diagnostics.contract, version: diagnostics.contractVersion, violationCount: diagnostics.violations.length, violations: diagnostics.violations.slice(0, MAX_EVENT_VIOLATIONS).map((violation) => ({ path: violation.path, code: violation.code })), rawResponseStored: Boolean(agentRunId && diagnostics.rawResponse) },
    ...(diagnostics.model ? { model: diagnostics.model } : {}),
    ...(diagnostics.agentId ? { agentId: diagnostics.agentId } : {}),
    ...(agentRunId ? { agentRunId } : {}),
  }
}

async function recordEvent(
  db: Database,
  row: ClaimedRow,
  eventType: string,
  payload: Record<string, unknown>,
  agentRunId?: string,
): Promise<void> {
  await db.query(
    `insert into workflow_enrollment_events(enrollment_id, node_id, event_type, payload, idempotency_key, agent_run_id)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (enrollment_id, idempotency_key) do nothing`,
    [row.id, row.current_node_id, eventType, JSON.stringify(payload), `${row.current_node_id}:${row.revision}`, agentRunId ?? null],
  )
}

/** jsonb_set(node_outputs, '{<current_node_id>}', <nodeOutput>, true) quando o nó produziu uma
 * saída — mantém node_outputs intocado (mesmo objeto) quando não produziu, em vez de gravar
 * `null` por engano. */
function nodeOutputPatchArgs(row: ClaimedRow, nodeOutput: unknown): [string | null, string] {
  return [nodeOutput !== undefined ? JSON.stringify(nodeOutput) : null, row.current_node_id]
}

/** Mesmo padrão de nodeOutputPatchArgs, mas chaveado pelo variableId (imutável mesmo que o
 * admin renomeie a variável depois) em vez do nodeId — ver workflow_variables/SET_VARIABLE. */
function variablePatchArgs(variableUpdate: { variableId: string; value: unknown } | undefined): [string | null, string | null] {
  if (!variableUpdate) return [null, null]
  return [JSON.stringify(variableUpdate.value), variableUpdate.variableId]
}

// Exportado só pra teste direto (engine.test.ts) — o resto do motor (runWorkflowTick) continua
// sendo o único caminho real de produção; mesmo padrão de node-handlers.ts exportar processNode.
export async function applyOutcome(db: Database, row: ClaimedRow, outcome: NodeOutcome): Promise<void> {
  if (outcome.kind === "advance") {
    await recordEvent(db, row, outcome.eventType, outcome.eventPayload ?? {}, outcome.agentRunId)
    const [outputJson, nodeId] = nodeOutputPatchArgs(row, outcome.nodeOutput)
    const [variableJson, variableId] = variablePatchArgs(outcome.variableUpdate)
    await db.query(
      `update workflow_enrollments
       set current_node_id = $1, status = 'active', next_eval_at = now(), claimed_until = null, revision = revision + 1, updated_at = now(),
           node_outputs = case when $4::jsonb is null then node_outputs else jsonb_set(node_outputs, array[$5], $4::jsonb, true) end,
           variables = case when $6::jsonb is null then variables else jsonb_set(variables, array[$7], $6::jsonb, true) end
       where id = $2 and revision = $3`,
      [outcome.nextNodeId, row.id, row.revision, outputJson, nodeId, variableJson, variableId],
    )
    return
  }
  if (outcome.kind === "wait") {
    await recordEvent(db, row, outcome.eventType, outcome.eventPayload ?? {})
    await db.query(
      `update workflow_enrollments
       set status = 'waiting', next_eval_at = $1, claimed_until = null, revision = revision + 1, updated_at = now()
       where id = $2 and revision = $3`,
      [outcome.nextEvalAt, row.id, row.revision],
    )
    return
  }
  if (outcome.kind === "fan_out") {
    // Fan-out (Parte 16-24 do pedido de EMPLOYEE_COLLECTION) — 1 único INSERT...SELECT a partir
    // de unnest($memberIds) é atômico por natureza (nunca "criei João, falhei no Maria" — Parte
    // 22/60): a linha inteira aplica ou nenhuma aplica. `on conflict do nothing` (unique index
    // de 049_workflow_fan_out.sql, refeito na 166 sem as novas tentativas) garante que um RETRY do mesmo fan-out nunca duplica filho
    // nenhum (Parte 21/62) — funciona igual com 0 membros (unnest de array vazio = 0 linhas,
    // sem tratamento especial). Filhos herdam workflow_id/version_id/organization_id do PAI, tal
    // como estavam nesta execução — nunca reconsultados —, garantindo a mesma versão publicada
    // (Parte 19/71). O índice é PARCIAL: o `on conflict` repete a condição dele, senão o Postgres não o reconhece (sem ela, o
    // INSERT falhava contra o banco real — defeito encontrado em 03/11/2026). `scheduled_subject_id` é o colaborador (mesma coluna que schedule-check.ts
    // já usa pra "carregador técnico" em modo Individual) — por isso `resolveEnrollmentOperatorId`
    // resolve o filho corretamente sem nenhuma mudança em enrollment-subject.ts.
    await db.query(
      `insert into workflow_enrollments
         (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, parent_enrollment_id, fan_out_node_id, scheduled_subject_id)
       select $1, $2, $3, $4, 'active', now(), $5, $6, member_id
       from unnest($7::uuid[]) as member_id
       on conflict (parent_enrollment_id, fan_out_node_id, scheduled_subject_id) where parent_enrollment_id is not null and fan_out_node_id is not null and retry_of_enrollment_id is null do nothing`,
      [row.organization_id, row.workflow_id, row.version_id, outcome.nextNodeId, row.id, outcome.fanOutNodeId, outcome.memberIds],
    )
    await recordEvent(db, row, "fan_out_completed", { childCount: outcome.memberIds.length, memberIds: outcome.memberIds, fanOutNodeId: outcome.fanOutNodeId })
    // Registra quantos filhos nasceram (auditoria/lineage — Parte 20/54) — `childCount` aqui é
    // a fonte da verdade que "join_check" usa depois pra saber quantos filhos esperar, nunca
    // reconsultado/recalculado.
    const nodeOutput = {
      kind: "FAN_OUT_COMPLETED",
      childCount: outcome.memberIds.length,
      memberIds: outcome.memberIds,
      fanOutNodeId: outcome.fanOutNodeId,
      completedAt: new Date().toISOString(),
    }
    if (outcome.joinNodeId) {
      // Este fan-out tem um "Consolidar resultados" pareado (fan-in/JOIN) — o PAI NÃO completa
      // aqui: avança pro Join como qualquer outro `advance`, e o claim loop normal (skip locked +
      // lease + revision otimista) vai pegá-lo de novo pra checar a barreira (case "join_check"
      // abaixo) — reaproveita 100% do mecanismo de concorrência/retry que já existe, nenhum lock
      // novo (Parte 28/29/30/72/73 do pedido).
      await db.query(
        `update workflow_enrollments
         set current_node_id = $1, status = 'active', next_eval_at = now(), claimed_until = null, revision = revision + 1, updated_at = now(),
             node_outputs = jsonb_set(node_outputs, array[$5], $4::jsonb, true)
         where id = $2 and revision = $3`,
        [outcome.joinNodeId, row.id, row.revision, JSON.stringify(nodeOutput), row.current_node_id],
      )
      return
    }
    // Sem Join pareado — comportamento legado intacto (Parte 35/36): o PAI nunca segue tentando
    // processar nodes que esperam EMPLOYEE, fica `completed` sem NENHUM fan-in.
    await db.query(
      `update workflow_enrollments
       set status = 'completed', claimed_until = null, revision = revision + 1, updated_at = now(),
           node_outputs = jsonb_set(node_outputs, array[$3], $4::jsonb, true)
       where id = $1 and revision = $2`,
      [row.id, row.revision, row.current_node_id, JSON.stringify(nodeOutput)],
    )
    return
  }
  if (outcome.kind === "join_check") {
    // Prontidão da barreira (Parte 14/69) — expectedCount vem do PRÓPRIO node_outputs do pai
    // (gravado no fan-out, nunca recalculado); completed/failed vem de 1 query agregada contra os
    // filhos (consolidate-results-executor.ts). Idempotência/concorrência: esta é a MESMA
    // atualização otimista (`where id=$1 and revision=$2`) de qualquer outro node — só o worker
    // que detém a lease do PAI decide avançar, os filhos nunca disputam essa decisão.
    const fanOutMarker = row.node_outputs[outcome.fanOutNodeId] as { childCount?: number } | undefined
    const expectedCount = fanOutMarker?.childCount ?? 0
    const { completed, failed } = await countFanOutChildren(db, row.id, outcome.fanOutNodeId)
    if (completed + failed < expectedCount) {
      await recordEvent(db, row, "consolidate_results_waiting", { expectedCount, completed, failed })
      await db.query(
        `update workflow_enrollments
         set status = 'waiting', next_eval_at = now() + make_interval(secs => $3), claimed_until = null, revision = revision + 1, updated_at = now()
         where id = $1 and revision = $2`,
        [row.id, row.revision, CONSOLIDATE_POLL_SECONDS],
      )
      return
    }
    const children = await loadFanOutChildren(db, row.id, outcome.fanOutNodeId)
    const fanInOutput = buildEmployeeFanInOutput(outcome.fanOutNodeId, expectedCount, children, new Date())
    await recordEvent(db, row, "consolidate_results_completed", { expectedCount, completedCount: fanInOutput.completedCount, failedCount: fanInOutput.failedCount })
    await db.query(
      `update workflow_enrollments
       set current_node_id = $1, status = 'active', next_eval_at = now(), claimed_until = null, revision = revision + 1, updated_at = now(),
           node_outputs = jsonb_set(node_outputs, array[$5], $4::jsonb, true)
       where id = $2 and revision = $3`,
      [outcome.nextNodeId, row.id, row.revision, JSON.stringify(fanInOutput), outcome.joinNodeId],
    )
    return
  }
  if (outcome.kind === "complete") {
    await recordEvent(db, row, "flow_completed", outcome.eventPayload ?? {})
    const [outputJson, nodeId] = nodeOutputPatchArgs(row, outcome.nodeOutput)
    const [variableJson, variableId] = variablePatchArgs(outcome.variableUpdate)
    await db.query(
      `update workflow_enrollments
       set status = 'completed', claimed_until = null, revision = revision + 1, updated_at = now(),
           node_outputs = case when $3::jsonb is null then node_outputs else jsonb_set(node_outputs, array[$4], $3::jsonb, true) end,
           variables = case when $5::jsonb is null then variables else jsonb_set(variables, array[$6], $5::jsonb, true) end
       where id = $1 and revision = $2`,
      [row.id, row.revision, outputJson, nodeId, variableJson, variableId],
    )
    return
  }
  // Um nó que DECIDIU falhar (aresta ausente, condição sem dado avaliável) é invariante da versão pinada: repetir não muda nada.
  await markFailed(db, row, { category: "APPLICATION_INVARIANT_VIOLATION", code: "WORKFLOW_NODE_INVARIANT", message: outcome.message }, null)
}

/**
 * V1.7.1c — falha de nó: a CATEGORIA decide o retry (workflows/domain/node-retry-policy.ts) e o evento registra a decisão
 * (attempt, errorCategory, willRetry, retryReason, nextRetryAt, repairAttempt) — é isso que explica custo e comportamento.
 */
async function markFailed(db: Database, row: ClaimedRow, failure: ExecutionFailure, diagnostics: Record<string, unknown> | null): Promise<void> {
  const decision = decideNodeRetry(failure.category, row.attempts, new Date())
  const dead = !decision.willRetry
  await recordEvent(
    db,
    row,
    dead ? "flow_dead" : "node_failed",
    {
      message: failure.message,
      attempts: decision.attempts,
      errorCategory: failure.category,
      errorCategoryLabel: EXECUTION_ERROR_CATEGORY_LABELS[failure.category],
      errorCode: failure.code,
      willRetry: decision.willRetry,
      retryReason: decision.retryReason,
      nextRetryAt: decision.nextRetryAt?.toISOString() ?? null,
      repairAttempt: decision.repairAttempt,
      ...(diagnostics ?? {}),
    },
    typeof diagnostics?.agentRunId === "string" ? diagnostics.agentRunId : undefined,
  )
  await db.query(
    `update workflow_enrollments
     set status = $1, attempts = $2, next_eval_at = coalesce($3, next_eval_at), claimed_until = null, revision = revision + 1, updated_at = now()
     where id = $4 and revision = $5`,
    [dead ? "dead" : "active", decision.attempts, decision.nextRetryAt, row.id, row.revision],
  )
}

export type { FlowGraph }
