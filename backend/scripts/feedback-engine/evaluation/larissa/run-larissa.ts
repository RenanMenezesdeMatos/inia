/**
 * VALIDAÇÃO FOCAL — Larissa Monteiro (ensaio com modelo real, custo limitado). Dados REAIS lidos em transação somente leitura;
 * processamento isolado (memória sobreposta: lê o banco, grava na RAM); resultado salvo só como artefato de avaliação. Nada é
 * entregue, notificado ou gravado para a pessoa. O gabarito (`ground-truth.json`) NÃO é lido aqui.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/run-larissa.ts --freeze     → congela identidade, casos e fontes
 *   npx tsx scripts/feedback-engine/evaluation/larissa/run-larissa.ts --dry-run    → tamanho de cada pedido (zero chamada paga)
 *   npx tsx scripts/feedback-engine/evaluation/larissa/run-larissa.ts              → rodada paga planejada (sequencial)
 *   npx tsx scripts/feedback-engine/evaluation/larissa/run-larissa.ts --resume <artefato.json> --only <etapa>  → só a etapa
 *     afetada (as análises do artefato são recarregadas e reutilizadas; o orçamento restante é o teto menos o já gasto)
 *
 * Travas: (1) orçamento na fronteira HTTP (12 requisições / US$ 1, reserva do pior caso antes de cada envio, retry de transporte
 * desligado); (2) só a Larissa pode ter chamada analisada (inclusive indiretamente, pela investigação); (3) expansão de pares
 * desligada; (4) até 3 chamadas distintas; (5) seleção e fontes conferidas contra o congelado antes de qualquer gasto.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { callAnalysisNodeOutput, createEngineDeps } from "../../../../src/modules/feedback-engine/application/engine-wiring.js"
import { generateFeedback } from "../../../../src/modules/feedback-engine/application/generate-feedback.js"
import { investigateIndicator } from "../../../../src/modules/feedback-engine/application/investigate-indicator.js"
import type { EngineModelPort } from "../../../../src/modules/feedback-engine/application/ports.js"
import { INDICATOR_ANALYSIS_NODE_OUTPUT_KIND } from "../../../../src/modules/feedback-engine/domain/node-output.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/overlay-feedback-memory-store.js"
import { createPostgresFeedbackMemoryStore } from "../../../../src/modules/feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadAgentDocumentsAt } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import { createPaidBudget, PaidBudgetExceededError } from "../paid-budget.js"

const here = dirname(fileURLToPath(import.meta.url))
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = { name: "Larissa Monteiro", matricula: "DEMO-OP-0001" }
const AGENT_NAME = "Especialista de Faturamento"
const CALLS = [
  { key: "C07", externalId: "GOLDEN-LARISSA-TMA-AGO-C07" },
  { key: "C04", externalId: "GOLDEN-LARISSA-TMA-AGO-C04" },
  { key: "C00", externalId: "GOLDEN-LARISSA-TMA-AGO-C00" },
]
/** Feedbacks completos de monitoria (máx. 2), na ordem de prioridade; o indicador vem entre eles (ver ordem das etapas). */
const MONITORING_MESSAGES = ["C07", "C04"]
const INDICATOR = { code: "TMA", referencePeriod: "2026-08" }
const LIMITS = { maxRequests: 12, maxUsd: 1, pricePerMillion: { input: 0.75, output: 3.75 }, hostPattern: /generativelanguage\.googleapis\.com/ }
const selectionFile = join(here, "selection.json")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")
const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? null : null }

type Selection = {
  frozenAt: string
  person: { id: string; name: string; matricula: string; organizationId: string; team: string | null; subteam: string | null }
  agent: { id: string; name: string; updatedAt: string }
  calls: { key: string; externalId: string; interactionId: string; startedAt: string; durationSeconds: number; reason: string | null; transcriptSha256: string }[]
  knowledge: { documentId: string; title: string; version: number; contentHash: string; perspective: string }[]
  indicator: { code: string; referencePeriod: string; closingId: string; value: number; target: number | null }
}

async function resolveSelection(db: ReturnType<typeof createReadOnlyDatabase>): Promise<Selection> {
  const people = (await db.query<{ id: string; name: string; matricula: string; team: string | null; subteam: string | null }>(
    `select p.id, p.name, p.matricula, t.name team, s.name subteam from people p left join teams t on t.id = p.team_id left join subteams s on s.id = p.subteam_id
     where p.organization_id = $1 and p.name = $2 and p.matricula = $3`,
    [ORG, PERSON.name, PERSON.matricula],
  )).rows
  if (people.length !== 1) throw new Error(`Identidade ambígua ou ausente para ${PERSON.name}/${PERSON.matricula}: ${people.length} registro(s). Nada foi executado.`)
  const person = people[0]!
  const agents = (await db.query<{ id: string; name: string; updated_at: Date }>(`select id, name, updated_at from agents where organization_id = $1 and name = $2 and active`, [ORG, AGENT_NAME])).rows
  if (agents.length !== 1) throw new Error(`Especialista "${AGENT_NAME}" ambíguo ou ausente (${agents.length}).`)
  const calls = []
  for (const call of CALLS) {
    const row = (await db.query<{ id: string; operator_id: string; started_at: Date; duration: string; reason: string | null; content: string }>(
      `select i.id, i.operator_id, i.started_at, extract(epoch from i.ended_at - i.started_at)::int duration, i.reason, (select t.content from transcripts t where t.interaction_id = i.id order by t.version desc limit 1) content
       from interactions i where i.organization_id = $1 and i.external_id = $2`,
      [ORG, call.externalId],
    )).rows
    if (row.length !== 1 || row[0]!.operator_id !== person.id || !row[0]!.content) throw new Error(`Chamada ${call.externalId} ausente, ambígua, sem transcrição ou de outra pessoa.`)
    calls.push({ key: call.key, externalId: call.externalId, interactionId: row[0]!.id, startedAt: new Date(row[0]!.started_at).toISOString(), durationSeconds: Number(row[0]!.duration), reason: row[0]!.reason, transcriptSha256: sha(row[0]!.content) })
  }
  const knowledge = (await loadAgentDocumentsAt(db, ORG, agents[0]!.id, new Date(calls[0]!.startedAt))).map((document) => ({ documentId: document.documentId, title: document.title, version: document.version, contentHash: document.contentHash, perspective: document.perspective })).sort((a, b) => a.documentId.localeCompare(b.documentId))
  const closing = (await db.query<{ id: string; value: string; target_value: string | null }>(
    `select e.id, e.value, e.target_value from employee_indicator_performance e join indicator_definitions i on i.id = e.indicator_definition_id where e.organization_id = $1 and e.person_id = $2 and i.code = $3 and e.reference_period = $4`,
    [ORG, person.id, INDICATOR.code, INDICATOR.referencePeriod],
  )).rows
  if (closing.length !== 1) throw new Error(`Fechamento oficial de ${INDICATOR.code} ${INDICATOR.referencePeriod} ausente/ambíguo.`)
  return {
    frozenAt: new Date().toISOString(),
    person: { id: person.id, name: person.name, matricula: person.matricula, organizationId: ORG, team: person.team, subteam: person.subteam },
    agent: { id: agents[0]!.id, name: agents[0]!.name, updatedAt: new Date(agents[0]!.updated_at).toISOString() },
    calls,
    knowledge,
    indicator: { code: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod, closingId: closing[0]!.id, value: Number(closing[0]!.value), target: closing[0]!.target_value === null ? null : Number(closing[0]!.target_value) },
  }
}

const comparable = (selection: Selection) => JSON.stringify({ ...selection, frozenAt: null })

try {
  const readDb = createReadOnlyDatabase(pool)
  const current = await resolveSelection(readDb)
  if (process.argv.includes("--freeze")) {
    if (existsSync(selectionFile)) throw new Error("selection.json já existe — a seleção congelada não é sobrescrita.")
    writeFileSync(selectionFile, `${JSON.stringify(current, null, 2)}\n`)
    console.log(`Seleção congelada: ${selectionFile}`)
    console.log(JSON.stringify(current, null, 2))
    process.exit(0)
  }
  const frozen = JSON.parse(readFileSync(selectionFile, "utf8")) as Selection
  if (comparable(frozen) !== comparable(current)) throw new Error("A seleção/fontes mudaram desde o congelamento (identidade, chamadas, transcrições, base ou fechamento oficial). Nada foi executado.")
  if (frozen.calls.length > 3) throw new Error("Mais de 3 chamadas selecionadas.")
  const person = frozen.person.id

  const resumeFile = arg("--resume")
  const previous = resumeFile ? (JSON.parse(readFileSync(resumeFile, "utf8")) as { memory?: { runs: (Record<string, unknown> & { id: string; analysisKey: string; kind: string; status: string })[]; assessments: { analysisRunId: string; snapshot: Record<string, unknown> & { occurredAt: string }; analysis: unknown; criterionKeys: Record<string, string> }[] }; steps?: Record<string, { status: string; result?: unknown }>; budget?: { totals: { requests: number; spentUsd: number } } }) : null
  const dryRun = process.argv.includes("--dry-run")
  // Teto da TASK inteira: uma retomada só usa o que sobrou (requisições e custo já gastos são descontados).
  const spentBefore = previous?.budget?.totals ?? { requests: 0, spentUsd: 0 }
  const budget = createPaidBudget({ ...LIMITS, maxRequests: LIMITS.maxRequests - spentBefore.requests, maxUsd: LIMITS.maxUsd - spentBefore.spentUsd })
  const sizes: { step: string; stage: string; tag: string | null; chars: number }[] = []
  let step = "setup"
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const model: EngineModelPort = {
    async generate(request) {
      const chars = request.systemPrompt.length + request.contents.reduce((sum, turn) => sum + turn.text.length, 0) + JSON.stringify(request.responseSchema).length
      sizes.push({ step, stage: request.stage, tag: request.tag ?? null, chars })
      if (dryRun) throw Object.assign(new Error("DRY_RUN: pedido medido, não enviado."), { name: "DryRunStop" })
      budget.setLabel(`${step} · ${request.stage}${request.tag ? `:${request.tag}` : ""}`)
      return real.generate(request)
    },
  }
  if (!dryRun) globalThis.fetch = budget.fetch

  const overlay = createInMemoryFeedbackMemoryStore()
  const stores = createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(readDb), overlay)
  // Retomada: recarrega na RAM as análises CONCLUÍDAS de uma rodada anterior (mesmas fontes congeladas → mesma chave → reuso,
  // nenhuma chamada paga). Só a etapa afetada (`--only`) roda de novo.
  if (previous?.memory) {
    for (const assessment of previous.memory.assessments) {
      const runRecord = previous.memory.runs.find((entry) => entry.id === assessment.analysisRunId && entry.kind === "CALL_ANALYSIS" && entry.status === "COMPLETED")
      if (!runRecord) continue
      const claim = await overlay.claimAnalysis({ organizationId: ORG, kind: "CALL_ANALYSIS", analysisKey: runRecord.analysisKey, personId: String(runRecord.personId), interactionId: String(runRecord.interactionId), indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: (runRecord.agentId as string | null) ?? null, trigger: runRecord.trigger as never, logicVersion: String(runRecord.logicVersion), asOf: new Date(String(runRecord.asOf)) }, new Date(), 60)
      if (claim.kind !== "CLAIMED") continue
      const provenance = runRecord.provenance as { documents?: { documentId: string; version: number; perspective: string }[] }
      await overlay.completeCallAnalysis(ORG, claim.runId, { snapshot: { ...assessment.snapshot, occurredAt: new Date(assessment.snapshot.occurredAt) } as never, analysis: assessment.analysis as never, identities: new Map(Object.entries(assessment.criterionKeys).map(([lineKey, criterionKey]) => [lineKey, { lineKey, criterionKey, basis: "UNCHANGED" as const, previousCriterionKey: null }])), documentVersions: new Map((provenance.documents ?? []).map((document) => [document.documentId, { version: document.version, perspective: document.perspective }])), provenance: runRecord.provenance as Record<string, unknown>, metrics: (runRecord.metrics as Record<string, unknown>) ?? {} }, new Date())
    }
  }
  const deps = createEngineDeps({ db: readDb, stores, model, peerCallAnalyses: false, allowCollaborator: (id) => id === person })
  const steps: Record<string, { status: "DONE" | "NOT_VALIDATED" | "FAILED"; reason?: string; result?: unknown }> = {}
  const run = async (name: string, work: () => Promise<unknown>) => {
    step = name
    const only = arg("--only")
    // Análises sempre rodam: na retomada elas só REUTILIZAM o que foi recarregado (mesma chave) — tentativa paga seria bloqueada.
    if (only && !only.split(",").includes(name) && !name.startsWith("analysis:")) return
    try {
      steps[name] = { status: "DONE", result: await work() }
    } catch (error) {
      const budgetHit = error instanceof PaidBudgetExceededError || (error instanceof Error && /Orçamento de avaliação atingido/.test(error.message))
      steps[name] = { status: budgetHit ? "NOT_VALIDATED" : "FAILED", reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
      console.log(`${name}: ${steps[name]!.status} — ${steps[name]!.reason}`)
    }
  }
  const callOf = (key: string) => frozen.calls.find((call) => call.key === key)!
  const analysisOutputs = new Map<string, Awaited<ReturnType<typeof callAnalysisNodeOutput>>>()
  const messageDetail = async (messageId: string) => {
    const record = await stores.getMessage(ORG, messageId)
    if (!record) return null
    const message = record.message
    return {
      status: record.status,
      abstainReason: record.abstainReason,
      tone: record.brief?.tone ?? null,
      card: message?.card ?? null,
      paragraphs: message?.paragraphs ?? [],
      sentences: (message?.sentences ?? []).map((sentence) => ({ text: sentence.text, stance: sentence.stance, source: sentence.source, basis: sentence.basis ?? null, refs: sentence.refs })),
      developments: (record.brief?.developments ?? []).map((finding) => ({ ref: finding.ref, title: finding.title, status: finding.status, observed: finding.observed, reading: finding.reading, guidanceProposed: finding.guidance, rules: finding.rules.map((rule) => rule.text), criterionKeys: finding.criterionKeys, quotes: finding.quotes })),
      strengths: (record.brief?.strengths ?? []).map((finding) => ({ ref: finding.ref, title: finding.title, observed: finding.observed, whyProposed: finding.whyItMatters, rules: finding.rules.map((rule) => rule.text), quotes: finding.quotes, stats: finding.stats })),
      context: record.brief?.context ?? [],
      limitations: record.brief?.limitations ?? [],
      officialLines: record.brief?.officialLines ?? [],
      composition: record.composition,
      view: message?.view ?? null,
      text: message?.text ?? null,
    }
  }

  // 1. Análise das 3 chamadas (cada uma no máximo uma vez; reuso de análise compatível já existente no banco).
  for (const call of frozen.calls) {
    await run(`analysis:${call.key}`, async () => {
      const output = await callAnalysisNodeOutput(deps, { organizationId: ORG, interactionId: call.interactionId, collaboratorId: person, agentId: frozen.agent.id, trigger: { kind: "EVALUATION", selectionReason: `Validação focal (${call.key}): chamada de ${call.reason ?? "atendimento"} do período do ${INDICATOR.code} ${INDICATOR.referencePeriod}.` } })
      analysisOutputs.set(call.key, output)
      const assessment = await stores.getCallAssessmentByRun(ORG, output.analysisRunId)
      return { node: output, analysis: assessment?.analysis ?? null }
    })
  }
  const monitoring = async (key: string) => {
    const source = analysisOutputs.get(key)
    if (!source) throw new Error(`Análise de ${key} indisponível — mensagem não gerada.`)
    const result = await generateFeedback(deps, { organizationId: ORG, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: `monitoria-${key}`, sourceNodeId: `analysis-${key}`, domain: "MONITORING", sourceNodeOutput: source, collaboratorId: person, interactionId: callOf(key).interactionId, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: `Validação focal (${key}).`, now: new Date() })
    return { result: { kind: result.kind, messageId: result.messageId, reused: result.reused }, message: await messageDetail(result.messageId) }
  }
  // 2. Monitoria da chamada com desvio esperado (prioridade), 3. indicador, 4. monitoria da chamada longa.
  await run(`monitoring:${MONITORING_MESSAGES[0]}`, () => monitoring(MONITORING_MESSAGES[0]!))
  await run("investigation:TMA", async () => {
    const investigated = await investigateIndicator(deps.investigate, { organizationId: ORG, personId: person, agentId: frozen.agent.id, agentConfiguredAt: frozen.agent.updatedAt, enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: INDICATOR.code, referencePeriod: INDICATOR.referencePeriod }, trigger: { kind: "EVALUATION", selectionReason: "Validação focal: investigação do TMA de agosto/2026." }, now: new Date() })
    const stored = await Promise.all(investigated.investigations.map((entry) => stores.getIndicatorInvestigationByRun(ORG, entry.runId)))
    const source = { kind: INDICATOR_ANALYSIS_NODE_OUTPUT_KIND, personId: person, agentId: frozen.agent.id, investigations: investigated.investigations.map((entry) => ({ analysisRunId: entry.runId, investigationId: entry.investigationId, indicatorCode: entry.indicatorCode, periodLabel: entry.periodLabel, conclusion: entry.conclusion, reused: entry.reused })), skippedReason: investigated.skippedReason, text: "" }
    step = "indicator-feedback:TMA"
    const result = await generateFeedback(deps, { organizationId: ORG, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "indicador-TMA", sourceNodeId: "investigation-TMA", domain: "INDICATOR", sourceNodeOutput: source, collaboratorId: person, interactionId: null, indicatorMeasurementId: null, configuredAgentId: frozen.agent.id, selectionReason: "Validação focal (TMA).", now: new Date() })
    return { investigations: investigated, stored: stored.map((entry) => entry?.investigation ?? null), result: { kind: result.kind, messageId: result.messageId }, message: await messageDetail(result.messageId) }
  })
  if (MONITORING_MESSAGES[1]) await run(`monitoring:${MONITORING_MESSAGES[1]}`, () => monitoring(MONITORING_MESSAGES[1]!))

  const others = overlay.assessments.filter((entry) => entry.snapshot.personId !== person)
  const artifact = {
    kind: dryRun ? "DRY_RUN" : resumeFile ? "PAID_RESUME" : "PAID_RUN",
    resumedFrom: resumeFile,
    previousBudget: previous?.budget?.totals ?? null,
    cumulative: { requests: spentBefore.requests + budget.totals().requests, spentUsd: spentBefore.spentUsd + budget.totals().spentUsd },
    model: ENGINE_MODEL,
    ranAt: new Date().toISOString(),
    selection: frozen,
    limits: LIMITS,
    budget: dryRun ? null : { totals: budget.totals(), ledger: budget.ledger },
    requestSizes: sizes,
    otherCollaboratorsAnalyzed: others.length,
    distinctCallsAnalyzed: new Set(overlay.assessments.map((entry) => entry.snapshot.interactionId)).size,
    steps: { ...(previous?.steps ?? {}), ...steps },
    // Memória da RAM (para retomada sem nova chamada paga): execuções e leituras produzidas nesta rodada.
    memory: { runs: [...overlay.runs.values()].map((entry) => ({ ...entry, asOf: entry.asOf.toISOString() })), assessments: overlay.assessments.map((entry) => ({ analysisRunId: entry.analysisRunId, snapshot: entry.snapshot, analysis: entry.analysis, criterionKeys: entry.criterionKeys })) },
  }
  mkdirSync(join(here, "results"), { recursive: true })
  const out = join(here, "results", `${dryRun ? "dry-run" : resumeFile ? "resume" : "paid"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`)
  console.log(dryRun ? `Tamanhos: ${JSON.stringify(sizes)}` : `Orçamento: ${JSON.stringify(budget.totals())}`)
  console.log(`Etapas: ${Object.entries(steps).map(([name, entry]) => `${name}=${entry.status}`).join(" · ")}`)
  console.log(`Artefato: ${out}`)
} finally {
  await pool.end()
}
