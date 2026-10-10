/**
 * HOMOLOGAÇÃO REAL — Indicator Diagnosis V2 · Rechamada V1 (diagnóstico DIRETO, sem fechamento do PRV).
 *
 * Tudo pelos caminhos do PRODUTO (nunca SQL direto em dado de produto):
 *   - indicador "Rechamada" pelo serviço do catálogo (`createIndicatorDefinition`, o mesmo da tela Indicadores);
 *   - estratégia RECALL_V1 pelo serviço versionado (`saveStrategyDraft` + `publishStrategyDraft`, o mesmo da aba Diagnóstico com IA);
 *   - massa controlada pela CENTRAL DE DADOS (fonte de arquivo → feeds EMPLOYEES / INTERACTIONS / INTERACTION_FLAGS /
 *     OFFICIAL_INDICATOR_PERFORMANCE → upload bruto → Run processado pelo worker do SERVIDOR em execução);
 *   - Workflow isolado (Agenda + filtro de 1 colaborador) criado como a API cria e publicado pela MESMA validação do botão Publicar.
 * O disparo é a própria Agenda (poucos minutos à frente) — o motor do servidor processa a matrícula. Nenhuma linha de PRV é carregada.
 *
 *   npx tsx scripts/dev/smoke-recall-indicator-diagnosis.ts load        (indicador + estratégia + massa pela Central)
 *   npx tsx scripts/dev/smoke-recall-indicator-diagnosis.ts plan        (plano determinístico, ZERO modelo)
 *   npx tsx scripts/dev/smoke-recall-indicator-diagnosis.ts arm [min=3] (Workflow publicado, Agenda N minutos à frente)
 *   npx tsx scripts/dev/smoke-recall-indicator-diagnosis.ts report
 *   npx tsx scripts/dev/smoke-recall-indicator-diagnosis.ts deactivate
 *
 * Idempotente: o que já existe (indicador, estratégia, fonte, colaboradora, Workflow) é reaproveitado. Recusa NODE_ENV=production.
 */
import pg from "pg"
import { env } from "../../src/config/env.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { createDataHubContext } from "../../src/modules/data-hub/application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../../src/modules/data-hub/application/feed-service.js"
import { enqueueRun } from "../../src/modules/data-hub/application/run-service.js"
import { createSource, setSourceStatus } from "../../src/modules/data-hub/application/source-service.js"
import { publishStrategyDraft, saveStrategyDraft, loadStrategyOverview } from "../../src/modules/indicator-diagnosis/application/diagnostic-strategy-service.js"
import { emptyStrategyConfig, type DiagnosticStrategyConfig } from "../../src/modules/indicator-diagnosis/domain/diagnostic-strategy.js"
import { createIndicatorDefinition, findIndicatorDefinitionByCode } from "../../src/modules/indicators/application/indicator-definition-service.js"
import { validateWorkflowForPublish } from "../../src/modules/workflows/application/validate-workflow-for-publish.js"

if (process.env.NODE_ENV === "production") throw new Error("Homologação recusada em produção.")
const [mode, arg] = process.argv.slice(2)
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 })
const db = pool as unknown as Database
const ORG = "00000000-0000-4000-8000-000000000001"
/** O mesmo ator das homologações anteriores do diagnóstico (conta demo de gestão) — só auditoria; nenhuma senha é usada. */
const ACTOR = { userAccountId: "de00ac02-9ba0-4638-8fa4-30241766aeef", personId: "de000ae8-78fd-46b4-8602-4daf1e37c638" }
const INDICATOR_CODE = "RECHAMADA"
const FLAG = "rechamada"
const MATRICULA = "SMOKE-RECALL-001"
const SOURCE_NAME = "Smoke Rechamada V1 · Indicator Diagnosis"
const WORKFLOW_NAME = "Golden smoke · Rechamada · Indicator Diagnosis"
const AGENT_ID = "f18c813b-2557-4181-b35e-66667e45353b" // Especialista de Experiência do Cliente (rechamada, detrator)
const PERIOD = "2026-08"
const PREVIOUS = "2026-07"

export const RECALL_V1: DiagnosticStrategyConfig = {
  ...emptyStrategyConfig(),
  segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 },
  interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 3, minimumCoveragePercent: null, maxRepairInteractions: 5 },
  processAssessment: { enabled: true, population: "LINKED_PREVIOUS_OF_SIGNAL" },
  closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: true, quartileWorsened: true, recognitionQuartiles: ["Q1"] },
  noDiagnosisBehavior: "FACTUAL_ONLY",
  populationSignal: { kind: "INTERACTION_FLAG", flagName: FLAG, effect: "ADVERSE" },
  investigation: {
    mode: "AGENT_SELECTED",
    objective: "Entender em que situações as interações marcadas como rechamada aparecem nos atendimentos do colaborador e se há algo observável que mereça orientação — sem transformar associação em causa.",
    instructions: [
      "1. Considere a situação oficial do indicador e a evolução em relação ao período anterior.",
      "2. Veja por motivo onde as interações marcadas como rechamada se concentram e se a composição mudou entre os períodos.",
      "3. Avalie processos nos atendimentos ANTERIORES às rechamadas só quando existir vínculo confiável entre as interações; nunca presuma qual atendimento originou o retorno.",
      "4. Resultado ruim não obriga a encontrar um problema: se os dados não sustentarem um padrão, diga isso.",
    ].join("\n"),
    allowedSteps: ["SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION", "REASON_MIX_SHIFT", "PROCESS_ASSESSMENT"],
    prohibitedClaims: ["reduzirá a rechamada", "causou a rechamada", "gerou a rechamada", "por causa das rechamadas"],
  },
}

// ---------------------------------------------------------------------------------------------
// MASSA CONTROLADA (determinística)
// ---------------------------------------------------------------------------------------------

const REASONS = { contestacao: "Contestação de cobrança", segunda: "Segunda via de fatura", plano: "Informação sobre plano" } as const
type Reason = keyof typeof REASONS

const FIRST_CONTACT: Record<Reason, string[]> = {
  contestacao: [
    "CLIENTE: Oi, veio uma cobrança de trinta e nove e noventa na minha fatura que eu não reconheço.",
    "OPERADOR: Entendi. Vou verificar com você. Pode me confirmar qual fatura é e o valor contestado?",
    "CLIENTE: É a de agosto, trinta e nove e noventa, um serviço digital.",
    "OPERADOR: Obrigada. Abri a contestação desse valor. A análise leva até cinco dias úteis e o retorno vem por SMS. O protocolo é 20260817-4471.",
    "CLIENTE: Tá bom, obrigado.",
    "OPERADOR: Ficou alguma dúvida? Posso ajudar em mais alguma coisa?",
  ],
  segunda: [
    "CLIENTE: Preciso da segunda via da minha fatura.",
    "OPERADOR: Claro. Vou enviar agora para o e-mail cadastrado. Consegue confirmar se é o mesmo final?",
    "CLIENTE: Sim, é esse.",
    "OPERADOR: Enviado. Ela chega em alguns minutos; se não chegar, também dá para baixar pelo aplicativo.",
  ],
  plano: [
    "CLIENTE: Queria saber o que tem no meu plano atual.",
    "OPERADOR: Seu plano tem vinte gigas de internet, ligações ilimitadas e o aplicativo de música incluso.",
    "CLIENTE: E se eu quiser mais internet?",
    "OPERADOR: Posso te passar as opções de pacote adicional. Quer que eu registre o interesse?",
  ],
}
const RETURN_CONTACT: Record<Reason, string[]> = {
  contestacao: [
    "CLIENTE: Estou ligando de novo por causa da mesma cobrança. Da outra vez disseram que ia ser analisada e até agora nada.",
    "OPERADOR: Entendo, vou verificar. Consigo ver a contestação registrada e ela está dentro do prazo de análise.",
    "CLIENTE: E quanto tempo ainda falta?",
    "OPERADOR: O prazo é de até cinco dias úteis a partir da abertura, e o retorno chega por SMS. Seu protocolo continua o mesmo.",
    "CLIENTE: Tá, vou aguardar então.",
  ],
  segunda: [
    "CLIENTE: Liguei ontem pedindo a segunda via e ela não chegou no meu e-mail.",
    "OPERADOR: Vou reenviar agora e confirmar o endereço com você. O e-mail termina com ponto com ponto br?",
    "CLIENTE: Termina só com ponto com.",
    "OPERADOR: Obrigada, corrigi e reenviei. Confere se chegou enquanto estamos na linha?",
    "CLIENTE: Chegou, obrigado.",
  ],
  plano: [
    "CLIENTE: Já tinha ligado para saber do meu plano, mas fiquei com dúvida sobre o pacote adicional.",
    "OPERADOR: Sem problema. O pacote adicional de dez gigas custa quinze reais por mês e entra na próxima fatura.",
    "CLIENTE: Entendi, então não quero agora.",
    "OPERADOR: Tudo bem. Ficou alguma dúvida?",
  ],
}

type Call = { id: string; reason: Reason; startedAt: string; endedAt: string; transcript: string; returnContact: boolean }

/** Dias úteis (seg–sex) do mês, horário comercial em São Paulo (UTC-3), em ordem. Determinístico. */
function workdays(period: string): string[] {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const days: string[] = []
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day, 15))
    if (date.getUTCMonth() !== month - 1) break
    const weekday = date.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(date.toISOString().slice(0, 10))
  }
  return days
}
function calls(period: string, plan: { reason: Reason; count: number; returns: number }[], prefix: string): Call[] {
  const days = workdays(period)
  const result: Call[] = []
  let index = 0
  for (const entry of plan) {
    for (let item = 0; item < entry.count; item += 1) {
      const day = days[(index * 7 + item * 3) % days.length]!
      const hour = 9 + ((index * 5 + item) % 8)
      const minute = (index * 13 + item * 7) % 50
      const start = new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`)
      const seconds = 240 + ((index * 37 + item * 53) % 480)
      const returnContact = item < entry.returns
      result.push({ id: `${prefix}-${String(index + 1).padStart(3, "0")}`, reason: entry.reason, startedAt: start.toISOString(), endedAt: new Date(start.getTime() + seconds * 1000).toISOString(), transcript: (returnContact ? RETURN_CONTACT : FIRST_CONTACT)[entry.reason].join("\n"), returnContact })
      index += 1
    }
  }
  return result
}

const AUGUST = calls(PERIOD, [{ reason: "contestacao", count: 14, returns: 5 }, { reason: "segunda", count: 20, returns: 1 }, { reason: "plano", count: 14, returns: 1 }], "SMOKE-RECALL-2026-08")
const JULY = calls(PREVIOUS, [{ reason: "contestacao", count: 12, returns: 1 }, { reason: "segunda", count: 22, returns: 1 }, { reason: "plano", count: 10, returns: 1 }], "SMOKE-RECALL-2026-07")

const csv = (rows: Record<string, string | number | null>[]) => {
  const columns = Object.keys(rows[0]!)
  const cell = (value: string | number | null) => (value === null ? "" : /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value))
  return [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column]!)).join(","))].join("\n")
}

// ---------------------------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------------------------

async function ensureIndicator(): Promise<string> {
  const existing = await findIndicatorDefinitionByCode(db, ORG, INDICATOR_CODE)
  if (existing) return existing.id
  // Taxa (percentual, menor é melhor); fechamento oficial pela fonte. A INIA não define janela nem regra de rechamada.
  const created = await createIndicatorDefinition(db, ORG, { code: INDICATOR_CODE, name: "Rechamada", unit: "PERCENT", desiredDirection: "LOWER", operationalAggregation: "RATE", dailySupported: false, officialClosureSupported: true, active: true })
  console.log(`indicador criado pelo catálogo: ${created.id}`)
  return created.id
}

async function ensureStrategy(indicatorId: string): Promise<string> {
  const overview = await loadStrategyOverview(db, ORG, indicatorId)
  if (overview.published) return overview.published.id
  await saveStrategyDraft(db, ORG, indicatorId, { config: RECALL_V1 }, ACTOR)
  const published = (await publishStrategyDraft(db, ORG, indicatorId, ACTOR)).published!
  console.log(`estratégia RECALL publicada: v${published.version} ${published.id}`)
  return published.id
}

const FILE_CONNECTOR = { connector: "FILE_UPLOAD", file: { format: "CSV", csv: { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }
const identity = (fields: string[]) => ({ fields: fields.map((field) => ({ source: field, target: field, transforms: [] })) })

async function loadThroughDataHub(): Promise<void> {
  const ctx = createDataHubContext(db)
  let sourceId = (await pool.query<{ id: string }>("select id from data_sources where organization_id = $1 and name = $2 and deleted_at is null", [ORG, SOURCE_NAME])).rows[0]?.id
  if (!sourceId) {
    sourceId = (await createSource(ctx, ORG, ACTOR.personId, { name: SOURCE_NAME, description: "Massa controlada da homologação do Indicator Diagnosis V2 (Rechamada V1).", config: { kind: "FILE_UPLOAD" } })).id
    await setSourceStatus(ctx, ORG, ACTOR.personId, sourceId, "ACTIVATE")
  }
  const feeds: { key: string; name: string; contract: string; fields: string[]; rows: Record<string, string | number | null>[] }[] = [
    { key: "colaboradora", name: "Colaboradora (smoke rechamada)", contract: "EMPLOYEES", fields: ["externalEmployeeId", "name", "role", "jobTitle", "groupExternalCode", "reportsToExternalId", "hiredAt"], rows: [{ externalEmployeeId: MATRICULA, name: "Joana Ribeiro", role: "OPERATOR", jobTitle: "Analista de Atendimento I", groupExternalCode: "B2C_ATENDIMENTO_GERAL", reportsToExternalId: "DEMO-SUP-001", hiredAt: "2025-02-10" }] },
    { key: "interacoes", name: "Interações (smoke rechamada)", contract: "INTERACTIONS", fields: ["externalInteractionId", "externalEmployeeId", "channel", "reason", "startedAt", "endedAt", "transcriptContent"], rows: [...JULY, ...AUGUST].map((call) => ({ externalInteractionId: call.id, externalEmployeeId: MATRICULA, channel: "VOICE", reason: REASONS[call.reason], startedAt: call.startedAt, endedAt: call.endedAt, transcriptContent: call.transcript })) },
    // O sinal chega PRONTO da fonte (como no produto): a flag só na interação que a fonte marcou como novo contato.
    { key: "flags-rechamada", name: "Flags de rechamada (smoke)", contract: "INTERACTION_FLAGS", fields: ["externalInteractionId", "flagName", "value"], rows: [...JULY, ...AUGUST].filter((call) => call.returnContact).map((call) => ({ externalInteractionId: call.id, flagName: FLAG, value: "true" })) },
    { key: "fechamento-rechamada", name: "Fechamento oficial de Rechamada (smoke)", contract: "OFFICIAL_INDICATOR_PERFORMANCE", fields: ["externalEmployeeId", "indicatorCode", "referencePeriod", "value", "targetValue", "achievementPercent", "quartile"], rows: [
      { externalEmployeeId: MATRICULA, indicatorCode: INDICATOR_CODE, referencePeriod: PREVIOUS, value: 6.8, targetValue: 10, achievementPercent: 147.1, quartile: "Q1" },
      { externalEmployeeId: MATRICULA, indicatorCode: INDICATOR_CODE, referencePeriod: PERIOD, value: 14.6, targetValue: 10, achievementPercent: 68.5, quartile: "Q4" },
    ] },
  ]
  for (const spec of feeds) {
    let feed = (await pool.query<{ id: string }>("select id from data_feeds where source_id = $1 and feed_key = $2 and deleted_at is null", [sourceId, spec.key])).rows[0]?.id
    if (!feed) feed = (await createFeed(ctx, ORG, ACTOR.personId, sourceId, { feedKey: spec.key, name: spec.name, contractKey: spec.contract, connectorConfig: FILE_CONNECTOR, mapping: identity(spec.fields), loadMode: "DELTA", cadence: { kind: "MANUAL" } })).id
    const content = csv(spec.rows)
    const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId, feedId: null, filename: `${spec.key}.csv`, contentType: "text/csv", content: new TextEncoder().encode(content) })
    await setFeedStatus(ctx, ORG, ACTOR.personId, feed, "ACTIVATE").catch(() => undefined)
    const feedRow = (await pool.query("select id, organization_id \"organizationId\", source_id \"sourceId\", contract_key \"contractKey\", contract_version \"contractVersion\", checkpoint from data_feeds where id = $1", [feed])).rows[0]
    const { run, deduplicated } = await enqueueRun(ctx, { organizationId: ORG, feed: feedRow as never, triggerKind: "FILE_UPLOAD", requestedBy: ACTOR.personId, rawObjectId: raw.id, idempotencyKey: `file:${raw.checksumSha256}` })
    await pool.query(`insert into data_processed_files (organization_id, feed_id, remote_path, checksum_sha256, byte_size, run_id) values ($1, $2, $3, $4, $5, $6) on conflict (feed_id, checksum_sha256) do nothing`, [ORG, feed, `${spec.key}.csv`, raw.checksumSha256, raw.byteSize, run.id])
    // O worker do SERVIDOR processa a fila (o mesmo caminho do botão "Importar"); espera o Run terminar.
    let status: string = run.status
    for (let attempt = 0; attempt < 60 && !["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      status = (await pool.query<{ status: string }>("select status from data_ingestion_runs where id = $1", [run.id])).rows[0]!.status
    }
    const summary = (await pool.query("select status, records_received, records_valid, records_inserted, records_updated, records_unchanged, records_rejected, warning_count, error_code from data_ingestion_runs where id = $1", [run.id])).rows[0]
    console.log(`Central · ${spec.contract} (${spec.rows.length} registros)${deduplicated ? " [reaproveitado]" : ""}: ${JSON.stringify(summary)}`)
    if (!["COMPLETED", "PARTIAL"].includes(summary.status)) throw new Error(`Carga ${spec.key} não concluída.`)
  }
}

async function ensureWorkflow(personId: string, minutes: number): Promise<{ id: string; version: string; time: string }> {
  const fire = new Date(Date.now() + minutes * 60_000)
  const local = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fire)
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(fire)
  const trigger = { kind: "schedule", mode: "CALENDAR", times: [local], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: Number(localDate.slice(8, 10)) }, anchorDate: localDate, intervalDays: 1 }
  const graph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Agenda (controlada)", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", type: "action", label: "Diagnóstico do indicador · Rechamada", position: { x: 0, y: 140 }, config: { actionType: "CALL_AGENT", agentId: AGENT_ID, scheduledDataSource: { kind: "PERFORMANCE", closures: 1, indicatorCode: INDICATOR_CODE }, outputContract: "INDICATOR_DIAGNOSIS" } },
      { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 280 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
      { id: "output", type: "output", label: "Acompanhamento da colaboradora", position: { x: 0, y: 420 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 560 }, config: {} },
    ],
    edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: "always" }, { id: "e2", source: "agent", target: "feedback", sourceHandle: "always" }, { id: "e3", source: "feedback", target: "output", sourceHandle: "always" }, { id: "e4", source: "output", target: "end", sourceHandle: "always" }],
  }
  const populationFilter = { kind: "EMPLOYEE", employeeId: personId }
  let id = (await pool.query<{ id: string }>("select id from workflows where organization_id = $1 and name = $2", [ORG, WORKFLOW_NAME])).rows[0]?.id
  if (!id) {
    id = (await pool.query<{ id: string }>(`insert into workflows(organization_id, name, description, scope_type, team_id, subteam_id, trigger_config, draft_graph, created_by) values ($1,$2,$3,'ALL_TEAMS',null,null,$4,$5,$6) returning id`, [ORG, WORKFLOW_NAME, "Homologação do diagnóstico direto de Rechamada (sem PRV). Isolado: uma colaboradora.", JSON.stringify(trigger), JSON.stringify(graph), ACTOR.personId])).rows[0]!.id
  }
  await pool.query("update workflows set trigger_config = $2, draft_graph = $3, population_filter = $4, consolidated_structure = null, active = true, updated_at = now() where id = $1", [id, JSON.stringify(trigger), JSON.stringify(graph), JSON.stringify(populationFilter)])
  // A MESMA validação do botão Publicar (Agenda + "Fechamentos oficiais" + indicador + estratégia publicada + Gerar feedback + Output).
  const validated = await validateWorkflowForPublish(db, ORG, id, { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph: graph, triggerConfig: trigger as never, consolidatedStructure: null })
  const version = (await pool.query<{ id: string }>("insert into workflow_versions(workflow_id, graph, created_by) values ($1,$2,$3) returning id", [id, JSON.stringify(validated), ACTOR.personId])).rows[0]!.id
  await pool.query("update workflows set active_version_id = $1, updated_at = now() where id = $2", [version, id])
  return { id, version, time: `${localDate} ${local}` }
}

async function smokePerson() {
  const person = (await pool.query<{ id: string; subteam_id: string | null; team_id: string | null }>("select id, subteam_id, team_id from people where organization_id = $1 and matricula = $2", [ORG, MATRICULA])).rows[0]
  if (!person) throw new Error("Colaboradora não carregada.")
  return person
}

async function load() {
  const indicatorId = await ensureIndicator()
  const strategyVersionId = await ensureStrategy(indicatorId)
  await loadThroughDataHub()
  const person = await smokePerson()
  // Isolamento: fora do Subgrupo do Workflow de monitoria por flag "rechamada" (nenhuma matrícula de monitoria disparada pelas flags).
  const flagEnrollments = (await pool.query("select count(*)::int n from workflow_enrollments we join interactions i on i.id = we.interaction_id where i.operator_id = $1", [person.id])).rows[0].n
  const prv = (await pool.query("select count(*)::int n from employee_prv_performance where person_id = $1", [person.id])).rows[0].n
  console.log(JSON.stringify({ indicatorId, strategyVersionId, personId: person.id, subteamId: person.subteam_id, flagEnrollmentsForThisPerson: flagEnrollments, prvRows: prv }, null, 2))
}

/** O plano determinístico do nó, SEM nenhuma chamada de modelo (conferência antes do disparo). */
async function plan() {
  const person = await smokePerson()
  const { prepareDirectIndicatorPlan } = await import("../../src/modules/indicator-diagnosis/application/prepare-prv-closing.js")
  const result = await prepareDirectIndicatorPlan(db, ORG, { personId: person.id, now: new Date(), agentId: AGENT_ID, indicatorCode: INDICATOR_CODE })
  console.log(JSON.stringify({ status: result.status, source: result.source, idempotencyKey: result.idempotencyKey, triage: result.triage?.decisions, investigations: result.investigations.map((entry) => ({ status: entry.status, metric: entry.metric, interactionsInPeriod: entry.interactionsInPeriod, selectedSegment: entry.selectedSegment, needsPlanner: entry.needsPlanner, steps: entry.steps, signal: entry.signal, toAssess: entry.toAssess.length })) }, null, 2))
}

async function arm(minutes: number) {
  const person = await smokePerson()
  console.log(JSON.stringify(await ensureWorkflow(person.id, minutes), null, 2))
}

// ---------------------------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------------------------

async function report() {
  const workflow = (await pool.query<{ id: string }>("select id from workflows where organization_id = $1 and name = $2", [ORG, WORKFLOW_NAME])).rows[0]
  if (!workflow) throw new Error("Workflow não encontrado.")
  const enrollment = (await pool.query("select id, status, current_node_id, attempts, created_at, node_outputs from workflow_enrollments where workflow_id = $1 order by created_at desc limit 1", [workflow.id])).rows[0]
  if (!enrollment) return console.log("Ainda sem matrícula (a Agenda não disparou).")
  const events = (await pool.query("select event_type, node_id, created_at, payload from workflow_enrollment_events where enrollment_id = $1 order by created_at", [enrollment.id])).rows
  const artifact = (await pool.query("select id, disposition, prv_closing_key, artifact from reliable_feedback_artifacts where enrollment_id = $1", [enrollment.id])).rows[0]
  const diagnosis = (await pool.query("select id, source_kind, logic_version, idempotency_key, strategy_versions, closing, diagnosis from prv_closing_diagnoses where source_artifact_id = $1", [artifact?.id ?? null])).rows[0]
  const person = (await pool.query<{ id: string }>("select id from people where organization_id = $1 and matricula = $2", [ORG, MATRICULA])).rows[0]!
  const feedback = (await pool.query("select id, impacted_indicator, evidence_found, recommendation, context_snapshot, published_at from feedbacks where operator_id = $1 order by created_at desc limit 1", [person.id])).rows[0]
  const usage = (await pool.query("select use_case, purpose, phase, provider_key, model_name, status, input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, cost, currency, cost_status, workflow_node_id, occurred_at from ai_usage_events where enrollment_id = $1 order by occurred_at", [enrollment.id])).rows
  const runs = (await pool.query("select id, status, left(output_text, 2000) output_text, created_at from agent_runs where agent_id = $1 and created_at >= $2 order by created_at", [AGENT_ID, enrollment.created_at])).rows
  console.log(JSON.stringify({ enrollment: { id: enrollment.id, status: enrollment.status, node: enrollment.current_node_id, attempts: enrollment.attempts }, events: events.map((event) => ({ type: event.event_type, node: event.node_id, at: event.created_at })), agentNodeOutput: enrollment.node_outputs?.agent ?? null, artifact, diagnosis, feedback, usage, agentRuns: runs }, null, 2))
}

async function deactivate() {
  await pool.query("update workflows set active = false, updated_at = now() where organization_id = $1 and name = $2", [ORG, WORKFLOW_NAME])
  console.log("Workflow de homologação desativado.")
}

try {
  if (mode === "load") await load()
  else if (mode === "plan") await plan()
  else if (mode === "arm") await arm(Number(arg ?? 3))
  else if (mode === "report") await report()
  else if (mode === "deactivate") await deactivate()
  else throw new Error("uso: load | plan | arm [minutos] | report | deactivate")
} finally {
  await pool.end()
}
