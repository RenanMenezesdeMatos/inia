import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { criterionPatternsOf, type MemoryRow } from "../domain/indicator-investigation.js"
import { buildProcedureContext } from "../domain/procedure.js"
import {
  newPracticeKeyOf,
  parsePracticeIdentity,
  practiceIdentitySchemaFor,
  anchorLineKeysOf,
  practiceLinesOf,
  renderPracticeIdentityTurn,
  type CatalogPractice,
  type PracticeLine,
} from "../domain/practice-identity.js"
import type { FeedbackBrief } from "../domain/feedback-brief.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../infrastructure/overlay-feedback-memory-store.js"
import { fakeEngineModel, type PracticePayload } from "../testing/fake-engine-model.js"
import { sourceDocuments } from "../testing/fixtures.js"
import { CALLS, ORG, PERSON, setup } from "../testing/investigation-world.js"
import { analyzeCall } from "./analyze-call.js"
import { EngineBudgetExhaustedError } from "./engine-meter.js"
import type { EngineModelRequest } from "./ports.js"
import { resolvePractices } from "./resolve-practices.js"

/**
 * PRÁTICAS (`PRACTICE_IDENTITY_V1`) — zero IA. A leitura de sentido é do MODELO (aqui, falso); o código só confere a forma da resposta
 * (códigos de uma lista fechada) e registra. Nenhuma regra é juntada ou separada por palavra.
 */
const line = (lineKey: string, text: string, extra: Partial<PracticeLine> = {}): PracticeLine => ({ lineKey, sourceKind: "KNOWLEDGE", sourceId: "doc-1", sourceVersion: 1, sourceTitle: "Contestação de conta", heading: "35. Prazo da análise", leadIn: null, text, ...extra })
const LINES = [
  line("l-prazo-a", "Sempre informar prazo de análise."),
  line("l-prazo-b", "O operador deverá informar o prazo exibido na ferramenta."),
  line("l-checklist", "Forneci prazo?", { sourceTitle: "Checklist de Encerramento", heading: null }),
  line("l-objetivo", "Orientar a contestação de cobranças.", { heading: "1. Objetivo" }),
]
const answer = (body: unknown) => JSON.stringify(body)

describe("contrato: o modelo escolhe numa lista fechada; o código confere a forma", () => {
  it("o pedido lista as práticas conhecidas (P-n) e as regras (R-n) com a fonte e a abertura da lista; o esquema só aceita esses códigos", () => {
    const catalog: CatalogPractice[] = [{ practiceKey: "KP-000000000001", title: "Validar o titular", examples: [{ sourceTitle: "Procedimento", heading: "2. Validação", text: "Confirmar nome completo;" }] }]
    const turn = renderPracticeIdentityTurn(catalog, [line("x", "Estorno;", { leadIn: "Quando a conta já estiver paga, avaliar:" })])
    expect(turn).toContain('"ref": "P1"')
    expect(turn).toContain('"ref": "R1"')
    expect(turn).toContain('"listOpening": "Quando a conta já estiver paga, avaliar:"')
    expect(turn).toContain("Base: Contestação de conta · 35. Prazo da análise")
    expect(renderPracticeIdentityTurn(catalog, LINES)).toBe(renderPracticeIdentityTurn(catalog, LINES))
    const schema = practiceIdentitySchemaFor(1, 2) as { properties: { assignments: { items: { properties: { rule: { enum: string[] }; practice: { enum: string[] } } } } } }
    expect(schema.properties.assignments.items.properties.rule.enum).toEqual(["R1", "R2"])
    expect(schema.properties.assignments.items.properties.practice.enum).toEqual(["P1", "N1", "N2", "NONE"])
  })

  it("três redações da MESMA conduta (duas linhas da seção e o checklist) viram UMA prática nova; o contexto vira NONE", () => {
    const parsed = parsePracticeIdentity(answer({
      assignments: [{ rule: "R1", practice: "N1" }, { rule: "R2", practice: "N1" }, { rule: "R3", practice: "N1" }, { rule: "R4", practice: "NONE" }],
      newPractices: [{ ref: "N1", title: "  Informar o prazo   da análise " }],
    }), [], LINES)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.result.practices).toEqual([{ practiceKey: newPracticeKeyOf("l-prazo-a"), title: "Informar o prazo da análise" }])
    expect(parsed.result.members.map((member) => [member.line.lineKey, member.practiceKey, member.basis])).toEqual([
      ["l-prazo-a", newPracticeKeyOf("l-prazo-a"), "NEW_PRACTICE"],
      ["l-prazo-b", newPracticeKeyOf("l-prazo-a"), "NEW_PRACTICE"],
      ["l-checklist", newPracticeKeyOf("l-prazo-a"), "NEW_PRACTICE"],
      ["l-objetivo", null, "NO_CONDUCT"],
    ])
    expect(parsed.result.unassigned).toEqual([])
  })

  it("o código NUNCA junta nem separa por texto: textos idênticos que o modelo separou continuam separados; textos sem palavra em comum que ele juntou ficam juntos", () => {
    const twins = [line("t-1", "Informar o protocolo."), line("t-2", "Informar o protocolo.", { heading: "Transferência" })]
    const separated = parsePracticeIdentity(answer({ assignments: [{ rule: "R1", practice: "N1" }, { rule: "R2", practice: "N2" }], newPractices: [{ ref: "N1", title: "Informar o protocolo ao encerrar" }, { ref: "N2", title: "Informar o protocolo antes de transferir" }] }), [], twins)
    if (!separated.ok) throw new Error(separated.error)
    expect(new Set(separated.result.members.map((member) => member.practiceKey)).size).toBe(2)
    const different = [line("d-1", "Recapitule o que foi feito."), line("d-2", "Resumir o atendimento ao cliente antes de desligar.")]
    const joined = parsePracticeIdentity(answer({ assignments: [{ rule: "R1", practice: "P1" }, { rule: "R2", practice: "P1" }], newPractices: [] }), [{ practiceKey: "KP-00000000000a", title: "Recapitular o atendimento", examples: [] }], different)
    if (!joined.ok) throw new Error(joined.error)
    expect(joined.result.members.map((member) => [member.practiceKey, member.basis])).toEqual([["KP-00000000000a", "SAME_AS_EXISTING"], ["KP-00000000000a", "SAME_AS_EXISTING"]])
  })

  it("forma inválida não é consertada: regra ausente, duas respostas diferentes, prática inexistente, nova sem título → a regra fica sem prática (volta na próxima vez)", () => {
    const lines = [line("a", "A."), line("b", "B."), line("c", "C."), line("d", "D.")]
    const parsed = parsePracticeIdentity(answer({
      assignments: [{ rule: "R2", practice: "N1" }, { rule: "R2", practice: "NONE" }, { rule: "R3", practice: "P9" }, { rule: "R4", practice: "N2" }, { rule: "R77", practice: "NONE" }],
      newPractices: [{ ref: "N1", title: "B" }, { ref: "N2", title: "   " }],
    }), [], lines)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.result.members).toEqual([])
    expect(parsed.result.unassigned).toEqual([{ lineKey: "a", reason: "MISSING" }, { lineKey: "b", reason: "DUPLICATE" }, { lineKey: "c", reason: "UNKNOWN_PRACTICE" }, { lineKey: "d", reason: "NEW_WITHOUT_TITLE" }])
    expect(parsePracticeIdentity("não é json", [], lines)).toEqual({ ok: false, error: "INVALID_JSON" })
  })

  it("organiza SÓ as linhas-âncora das regras avaliadas (nunca o documento inteiro), na ordem do documento, com a seção", () => {
    const context = buildProcedureContext(sourceDocuments())
    const all = [...context.lines.values()]
    const birth = all.find((entry) => entry.text.includes("data de nascimento"))!
    const lines = practiceLinesOf(context, anchorLineKeysOf([{ lineKey: `${birth.lineKey}#parte` }]))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ lineKey: birth.lineKey, sourceKind: "KNOWLEDGE", sourceVersion: 1, heading: "2. Validação do titular" })
    expect(practiceLinesOf(context, new Set(all.map((entry) => entry.lineKey))).length).toBe(all.length)
  })
  it("linha que ABRE uma lista leva os itens dela como contexto (estrutura do documento)", () => {
    const context = buildProcedureContext([{ documentId: "doc-x", title: "Contestação", version: 1, content: "## 46. Recapitulação\n\nAntes de encerrar, recapitular:\n\n- conta analisada;\n- valor;\n- protocolo.\n", contentHash: "x", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 0 }])
    const opening = [...context.lines.values()].find((entry) => entry.text.startsWith("Antes de encerrar"))!
    expect(practiceLinesOf(context, new Set([opening.lineKey]))[0]!.listItems).toEqual(["- conta analisada;", "- valor;", "- protocolo."])
  })
})

describe("organizar só o que ainda não foi organizado (uma vez por linha)", () => {
  const deps = (memory = createInMemoryFeedbackMemoryStore(), respond: (payload: PracticePayload, request: EngineModelRequest) => unknown = (payload) => ({ assignments: payload.rules.map((rule, index) => ({ rule: rule.ref, practice: `N${index + 1}` })), newPractices: payload.rules.map((rule, index) => ({ ref: `N${index + 1}`, title: rule.rule })) })) => {
    const requests: EngineModelRequest[] = []
    const fake = fakeEngineModel({ practices: (payload) => respond(payload, requests[requests.length - 1]!) })
    return { memory, requests, deps: { memory, now: () => new Date("2026-10-05T12:00:00Z"), call: (request: EngineModelRequest) => { requests.push(request); return fake.model.generate(request) } } }
  }

  it("1ª vez: um pedido, tudo registrado; 2ª vez: nenhum pedido; linha nova: um pedido que já vê as práticas conhecidas", async () => {
    const world = deps()
    const first = await resolvePractices(world.deps, ORG, LINES)
    expect(first).toMatchObject({ status: "ORGANIZED", lines: 4, pending: 4, organized: 4, newPractices: 4, requests: 1, stopReason: null })
    expect(await resolvePractices(world.deps, ORG, LINES)).toMatchObject({ status: "UP_TO_DATE", pending: 0, requests: 0 })
    expect(world.requests).toHaveLength(1)
    const third = await resolvePractices(world.deps, ORG, [...LINES, line("l-novo", "Informar o canal de retorno.")])
    expect(third).toMatchObject({ pending: 1, requests: 1, organized: 1 })
    expect(world.requests[1]!.contents[0]!.text).toContain("PRÁTICAS JÁ CONHECIDAS (4)")
    expect(world.requests[1]!.stage).toBe("PRACTICE_IDENTITY")
  })

  it("sem orçamento ou com resposta fora do contrato: nada é gravado, a análise não cai, e tudo volta na próxima vez", async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const noBudget = await resolvePractices({ memory, now: () => new Date(), call: async () => { throw new EngineBudgetExhaustedError("maxModelCalls", "PRACTICE_IDENTITY") } }, ORG, LINES)
    expect(noBudget).toMatchObject({ status: "SKIPPED", stopReason: "BUDGET", organized: 0 })
    const broken = await resolvePractices({ memory, now: () => new Date(), call: async () => ({ text: "{", model: "fake", usage: null, durationMs: 1, costUsd: null, finishReason: "STOP" }) }, ORG, LINES)
    expect(broken).toMatchObject({ status: "SKIPPED", stopReason: "CONTRACT" })
    expect((await memory.practiceMemberships(ORG, LINES.map((entry) => entry.lineKey))).size).toBe(0)
  })

  it("obrigação que começa pela ABERTURA de uma lista (sem conduta): a prática é a do primeiro item que pede conduta", async () => {
    const base = createInMemoryFeedbackMemoryStore()
    const overlay = createInMemoryFeedbackMemoryStore()
    const row = { callAssessmentId: "ca-1", segmentKey: null, interactionId: "i-1", personId: PERSON, criterionKey: "KC-0000000000aa", practiceKey: "KC-open", documentId: "doc-1", documentTitle: "Contestação", heading: "49. Condutas proibidas", text: "É proibido:\n- Culpar o cliente;", status: "NOT_MET" as const, localDate: "2026-09-10", evidence: [], rationale: null, guidance: null, materiality: "HIGH" as const, anchorLineKey: "open", sourceLineKeys: ["open", "item-culpar"] }
    const assessment = { callAssessmentId: "ca-1", analysisRunId: "r-1", interactionId: "i-1", personId: PERSON, occurredAt: new Date("2026-09-10T12:00:00Z"), asOf: new Date("2026-09-10T12:00:00Z"), segmentKey: null, pathAssessment: null, outcome: "USABLE", logicVersion: null }
    const stub = { ...base, currentMemory: async () => ({ assessments: [assessment], criteria: [row] }) } as unknown as typeof base
    const stores = createOverlayFeedbackMemoryStore(stub, overlay)
    const practiceKey = newPracticeKeyOf("item-culpar")
    await overlay.savePracticeAssignments(ORG, { practices: [{ practiceKey, title: "Analisar sem culpar o cliente" }], members: [{ line: line("open", "É proibido:"), practiceKey: null, basis: "NO_CONDUCT" }, { line: line("item-culpar", "- Culpar o cliente;", { leadIn: "É proibido:" }), practiceKey, basis: "NEW_PRACTICE" }], unassigned: [] }, { identityVersion: "PRACTICE_IDENTITY_V1", model: "fake" }, new Date())
    const [read] = (await stores.currentMemory(ORG, { personIds: [PERSON] })).criteria
    expect(read).toMatchObject({ practiceKey, practiceTitle: "Analisar sem culpar o cliente" })
  })

  it("ensaio isolado (sobreposição): a prática organizada no ensaio vale para as leituras do banco e fica só na RAM", async () => {
    const base = createInMemoryFeedbackMemoryStore()
    const overlay = createInMemoryFeedbackMemoryStore()
    const stores = createOverlayFeedbackMemoryStore(base, overlay)
    const world = deps(stores as unknown as ReturnType<typeof createInMemoryFeedbackMemoryStore>, (payload) => ({ assignments: payload.rules.map((rule) => ({ rule: rule.ref, practice: "N1" })), newPractices: [{ ref: "N1", title: "Informar o prazo da análise" }] }))
    await resolvePractices({ ...world.deps, memory: stores }, ORG, LINES.slice(0, 3))
    expect((await base.practiceMemberships(ORG, ["l-prazo-a"])).size).toBe(0)
    expect((await stores.practiceMemberships(ORG, ["l-prazo-a"])).get("l-prazo-a")).toMatchObject({ practiceKey: newPracticeKeyOf("l-prazo-a"), title: "Informar o prazo da análise" })
  })
})

describe("a mesma conduta conta junto no histórico, nos padrões e na orientação anterior", () => {
  const row = (interactionId: string, practiceKey: string, status: MemoryRow["status"], text: string): MemoryRow => ({ interactionId, personId: PERSON, criterionKey: `KC-${text.length}`, practiceKey, practiceTitle: "Informar o prazo da análise", documentId: "doc-1", documentTitle: "Contestação de conta", heading: "35. Prazo da análise", text, status, localDate: "2026-09-10", evidence: [], rationale: null, guidance: null, materiality: "HIGH" })
  it("rodada V14: 'prazo' em duas linhas da mesma seção dava 2 de 2 + 2 de 2 (nenhum padrão); com a prática, 4 de 4 — padrão, com as duas regras literais", () => {
    const rows = [
      row("c1", "KP-prazo00000001", "NOT_MET", "Sempre informar prazo de análise."),
      row("c2", "KP-prazo00000001", "NOT_MET", "Sempre informar prazo de análise."),
      row("c3", "KP-prazo00000001", "NOT_MET", "O operador deverá informar o prazo exibido na ferramenta."),
      row("c4", "KP-prazo00000001", "NOT_MET", "O operador deverá informar o prazo exibido na ferramenta."),
    ]
    const [pattern] = criterionPatternsOf(rows)
    expect(pattern).toMatchObject({ criterionKey: "KP-prazo00000001", eligible: 4, notMet: 4, classification: "DEVELOPMENT_PATTERN", practiceTitle: "Informar o prazo da análise" })
    expect(pattern!.memberRules!.map((rule) => rule.text)).toEqual(["Sempre informar prazo de análise.", "O operador deverá informar o prazo exibido na ferramenta."])
    // Sem prática (como antes): duas âncoras, nenhuma chega ao padrão.
    const split = criterionPatternsOf(rows.map((entry, index) => {
      const loose = { ...entry, practiceKey: index < 2 ? "KC-a" : "KC-b" }
      delete loose.practiceTitle
      return loose
    }))
    expect(split.map((entry) => [entry.eligible, entry.classification])).toEqual([[2, "ISOLATED_DEVIATION"], [2, "ISOLATED_DEVIATION"]])
  })

  it("orientação entregue ANTES da organização (chave da linha-âncora KC-…) conta para a prática da linha", async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const claim = await memory.claimMessage({ organizationId: ORG, messageKey: "m-1", enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: null, sourceNodeId: null, personId: PERSON, domain: "MONITORING" }, new Date("2026-09-01T12:00:00Z"), 60)
    if (claim.kind !== "CLAIMED") throw new Error("fixture")
    const brief = { developments: [{ findingKey: "F-1", practiceKeys: ["KC-l-prazo-a"] }] } as unknown as FeedbackBrief
    await memory.completeMessage(ORG, claim.messageId, { status: "PUBLISHABLE", analysisRunIds: [], abstainReason: null, findingKeys: ["F-1"], brief, message: null, composition: null, suppressed: [], metrics: {}, materials: [] }, new Date("2026-09-01T12:00:00Z"))
    await memory.markDelivered(ORG, claim.messageId, new Date("2026-09-02T12:00:00Z"))
    const practiceKey = newPracticeKeyOf("l-prazo-a")
    expect(await memory.deliveredPractices(ORG, PERSON, [practiceKey], new Date("2026-10-01T00:00:00Z"))).toEqual([])
    await memory.savePracticeAssignments(ORG, { practices: [{ practiceKey, title: "Informar o prazo da análise" }], members: [{ line: LINES[0]!, practiceKey, basis: "NEW_PRACTICE" }], unassigned: [] }, { identityVersion: "PRACTICE_IDENTITY_V1", model: "fake" }, new Date("2026-10-01T00:00:00Z"))
    expect(await memory.deliveredPractices(ORG, PERSON, [practiceKey], new Date("2026-10-01T00:00:00Z"))).toEqual([{ practiceKey, deliveredAt: new Date("2026-09-02T12:00:00Z") }])
  })

  it("análise de chamada com a organização ligada: as linhas apresentadas são organizadas uma vez e a memória lê a prática de cada regra", async () => {
    const built = setup()
    const fake = fakeEngineModel({ practices: (payload) => ({ assignments: payload.rules.map((rule) => ({ rule: rule.ref, practice: rule.rule.includes("Confirmar nome") || rule.rule.includes("data de nascimento") ? "N1" : "NONE" })), newPractices: [{ ref: "N1", title: "Validar o titular antes de informar dados da conta" }] }) })
    const analyze = { ...built.analyze, model: fake.model, organizePractices: true }
    const first = await analyzeCall(analyze, { organizationId: ORG, collaboratorId: PERSON, interactionId: CALLS[0]!, agentId: "00000000-0000-4000-8000-00000000a001", trigger: { kind: "EVALUATION", selectionReason: "teste" } })
    const run = await built.memory.getRun(ORG, first.runId)
    expect((run?.provenance as { practices?: { status: string; requests: number } }).practices).toMatchObject({ status: "ORGANIZED", requests: 1 })
    expect(fake.calls.filter((call) => call.stage === "PRACTICE_IDENTITY")).toHaveLength(1)
    await analyzeCall(analyze, { organizationId: ORG, collaboratorId: PERSON, interactionId: CALLS[1]!, agentId: "00000000-0000-4000-8000-00000000a001", trigger: { kind: "EVALUATION", selectionReason: "teste" } })
    expect(fake.calls.filter((call) => call.stage === "PRACTICE_IDENTITY")).toHaveLength(1)
    const memory = await built.memory.currentMemory(ORG, { personIds: [PERSON] })
    const validation = memory.criteria.filter((entry) => entry.text.includes("Confirmar nome") || entry.text.includes("data de nascimento"))
    expect(validation.length).toBeGreaterThan(0)
    for (const entry of validation) expect(entry).toMatchObject({ practiceTitle: "Validar o titular antes de informar dados da conta" })
    expect(new Set(validation.map((entry) => entry.practiceKey)).size).toBe(1)
  })
})
