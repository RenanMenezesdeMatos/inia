import { withDeclaredConduct } from "../../reliable-feedback/testing/contestacao-v171b-smoke-fixture.js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { buildProcessCheckpointCatalog, publicCatalogOf } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { V172_ASSESSMENT, V172_PRESENTED, V172_PUBLISHED, V172_SUBJECT, V172_TRANSCRIPT } from "../../reliable-feedback/testing/contestacao-v172-smoke-fixture.js"

/**
 * V1.7.3 — o reparo único da cobertura NO RUNTIME do especialista (Orquestrador → especialista, contrato PROCESS_ASSESSMENT): a
 * primeira resposta REAL do smoke V1.7.2 omite etapas MUST_ASSESS → exatamente UMA chamada a mais, só com as faltantes, com
 * propósito próprio no uso de IA e zero retry de transporte; falha do reparo não derruba o nó (a análise fica PARCIAL).
 */
const CATALOG = buildProcessCheckpointCatalog({ excerpts: V172_PRESENTED, contentOf: (id) => V172_PUBLISHED.get(id)?.content, subject: V172_SUBJECT, coveragePlan: true })
const KNOWLEDGE = { mode: "RETRIEVAL", authorizedDocuments: [], retrieved: V172_PRESENTED.map((excerpt) => ({ ...excerpt, score: 1 })), injectedChars: 1000, authorizedChars: 1000, estimatedTokens: 250, budget: { maxExcerpts: 8, maxTotalChars: 9000 }, checkpointCatalog: publicCatalogOf(CATALOG) }

type GatewayCall = { classification: { purpose: string; source: string; tags?: string[] }; transport?: { timeoutMs?: number; retries?: number }; contents: { text: string }[]; route: { purpose: string } }
const gatewayCalls: GatewayCall[] = []
const replies: (() => Promise<string>)[] = []
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()),
  generateForRoute: async (request: GatewayCall) => {
    gatewayCalls.push(request)
    const next = replies.shift()
    if (!next) throw new Error("chamada inesperada ao modelo")
    return { kind: "text", text: await next(), usage: null, durationMs: 0, model: "fake-model" }
  },
}))
vi.mock("../../agents/application/build-system-prompt.js", () => ({ buildSystemPromptWithTrace: async () => ({ systemPrompt: "SYSTEM", knowledge: KNOWLEDGE }) }))
vi.mock("../../../shared/application/llm-telemetry.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../shared/application/llm-telemetry.js")>()), attachKnowledgeTrace: () => {} }))
vi.mock("../../workflows/application/organization-timezone.js", () => ({ resolveOrganizationTimezone: async () => "America/Fortaleza", DEFAULT_ORGANIZATION_TIMEZONE: "America/Fortaleza" }))
vi.mock("./build-operator-context.js", () => ({ buildOperatorIdentity: async () => ({ name: "Larissa Monteiro", teamId: "team-1", teamName: "B2C · Atendimento Geral" }), buildIndicatorSnapshot: async () => null, buildFeedbackHistory: async () => null }))

const { runSpecialistTool } = await import("./run-specialist-tool.js")

const agent = { name: "Especialista de Faturamento", objective: "o", description: "d", context_prompt: "P", active: true, specialty: "FATURAMENTO", specialty_kind: "DOMAIN", domain: "FATURAMENTO", capability: null, consolidated_input: false, investigation_capabilities: null }
const db = { query: async (sql: string) => (sql.includes("from agents where id = $1") ? { rows: [agent], rowCount: 1 } : { rows: [], rowCount: 0 }) } as unknown as Database
const refOf = (pattern: RegExp) => CATALOG.entries.find((entry) => pattern.test(entry.sourceText))!.ref
const MISSING = [refOf(/Validei o titular/), refOf(/Identifiquei lançamento/), refOf(/Verifiquei se a conta foi paga/), refOf(/Abri análise quando/)]
// Monitoring V2 — a avaliação histórica é anterior ao conductEvidence (V5 o exige): declarada como a matriz pede.
const firstReply = () => { const assessment = JSON.parse(JSON.stringify(V172_ASSESSMENT)) as { validation?: unknown; processes: { checkpoints: { status: string }[] }[] }; delete assessment.validation; for (const process of assessment.processes) process.checkpoints = withDeclaredConduct(process.checkpoints); return JSON.stringify({ title: "Contestação", summary: "Resumo", impactedIndicator: "Qualidade", evidenceFound: "E essa fatura você já pagou?", observedBehavior: "o", relatedProcedure: "Procedimento Operacional — Contestação de Contas Móvel", recommendation: "r", processAssessment: assessment }) }
const followed = (checkpointRef: string, quote: string) => ({ checkpointRef, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [quote], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null, conductEvidence: { role: "ACTION_PERFORMED", relation: "EQUIVALENT" } })
const repairReply = () => JSON.stringify({ assessments: [
  followed(MISSING[0]!, "Operador: Entendi. Antes de eu verificar, me confirma o nome do titular e os dois últimos dígitos do CPF, por favor?"),
  followed(MISSING[1]!, "Operador: Deixa eu olhar aqui... Achei. É uma assinatura de revistas digitais, ativada no dia 3 de setembro pelo próprio celular da linha. Essa é a primeira cobrança dela."),
  followed(MISSING[2]!, "Operador: Tudo bem. E essa fatura você já pagou?"),
  followed(MISSING[3]!, "Operador: Agora vou abrir a contestação dos R$ 12,90 pra área de faturamento analisar."),
] })
const run = () => runSpecialistTool(db, "org-1", "a-1", "Avalie as etapas de processo.", "op-1", undefined, V172_TRANSCRIPT, { outputContract: "PROCESS_ASSESSMENT" })
type AssessmentResult = { structured?: { processAssessment?: { validation?: { completeness: string; assessmentCoverage?: Record<string, unknown> } } } }

beforeEach(() => { gatewayCalls.length = 0; replies.length = 0; vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {}) })

describe("V1.7.3 — reparo único da cobertura no especialista do Orquestrador", () => {
  it("faltantes → exatamente 2 chamadas; a 2ª é o reparo (propósito próprio, zero retry, só as faltantes) e a cobertura fecha", async () => {
    replies.push(async () => firstReply(), async () => repairReply())
    const result = await run() as AssessmentResult
    expect(gatewayCalls).toHaveLength(2)
    expect(gatewayCalls[0]!.classification.purpose).toBe("SPECIALIST_SYNTHESIS")
    // A avaliação da checklist inteira é a resposta longa: 120 s (45 s estourou 4× seguidas em 2026-09-30).
    expect(gatewayCalls[0]!.transport).toEqual({ timeoutMs: 120_000 })
    const repair = gatewayCalls[1]!
    expect(repair.classification).toMatchObject({ purpose: "ASSESSMENT_COVERAGE_REPAIR", source: "SPECIALIST", tags: ["stage:ASSESSMENT_REPAIR"] })
    expect(repair.route.purpose).toBe("SPECIALIST_SYNTHESIS")
    expect(repair.transport).toMatchObject({ retries: 0 })
    expect([...new Set(repair.contents[0]!.text.match(/CP-[0-9a-f]{10}/g))]).toEqual(MISSING)
    expect(result.structured?.processAssessment?.validation).toMatchObject({ completeness: "COMPLETE", assessmentCoverage: { missingAfterInitial: MISSING, repairTriggered: true, repairCalls: 1, repairAssessmentCount: 4, missingAfterRepair: [], status: "COMPLETE" } })
  })

  it("primeira resposta completa → nenhuma chamada extra", async () => {
    const complete = () => { const reply = JSON.parse(firstReply()) as { processAssessment: { processes: { checkpoints: unknown[] }[] } }; reply.processAssessment.processes[0]!.checkpoints.push(...(JSON.parse(repairReply()) as { assessments: unknown[] }).assessments); return JSON.stringify(reply) }
    replies.push(async () => complete())
    const result = await run() as AssessmentResult
    expect(gatewayCalls).toHaveLength(1)
    expect(result.structured?.processAssessment?.validation).toMatchObject({ completeness: "COMPLETE", assessmentCoverage: { repairTriggered: false, missingAfterInitial: [] } })
  })

  it("falha do reparo não derruba o nó nem vira laço: 2 chamadas, análise PARCIAL com o erro registrado", async () => {
    replies.push(async () => firstReply(), async () => { throw Object.assign(new Error("503"), { name: "TRANSIENT" }) })
    const result = await run() as AssessmentResult
    expect(gatewayCalls).toHaveLength(2)
    expect(result.structured?.processAssessment?.validation).toMatchObject({ completeness: "PARTIAL", assessmentCoverage: { repairTriggered: true, repairCalls: 1, repairAssessmentCount: 0, missingAfterRepair: MISSING, status: "PARTIAL" } })
  })
})
