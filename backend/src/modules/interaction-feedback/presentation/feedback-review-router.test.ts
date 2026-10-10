import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { beforeEach, describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { composeInteractionFeedback } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { runInteractionFeedbackPipeline } from "../application/interaction-feedback-pipeline.js"
import { FEEDBACK_PILOT_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"
import { createInMemoryFeedbackReviewReader, type TestGrant, type TestPerson } from "../testing/in-memory-feedback-review-reader.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { createInMemoryFeedbackDeliveryStore } from "../testing/in-memory-feedback-delivery-store.js"
import { createFeedbackReviewRouter } from "./feedback-review-router.js"

// Hierarquia: Gerente → Supervisor A → Op1, Op2; Gerente → Supervisor B → Op3; Supervisor C (com subordinado, SEM capability);
// Admin; Analista de Qualidade (capability ORGANIZATION); Analista da Retenção (capability TEAM B); outra organização.
const ORG = "00000000-0000-4000-8000-00000000a001"
const OTHER_ORG = "00000000-0000-4000-8000-00000000b001"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const TEAM_A = { id: id(900), name: "B2C · Atendimento" }
const TEAM_B = { id: id(901), name: "B2C · Retenção" }
const MANAGER: TestPerson = { id: id(1), organizationId: ORG, name: "Gerente Um", jobTitle: "Gerente", reportsToId: null, team: null }
const SUP_A: TestPerson = { id: id(2), organizationId: ORG, name: "Supervisora A", jobTitle: "Supervisor", reportsToId: MANAGER.id, team: TEAM_A }
const SUP_B: TestPerson = { id: id(3), organizationId: ORG, name: "Supervisor B", jobTitle: "Supervisor", reportsToId: MANAGER.id, team: TEAM_B }
const OP1: TestPerson = { id: id(11), organizationId: ORG, name: "Operadora Um", jobTitle: "Operador", reportsToId: SUP_A.id, team: TEAM_A }
const OP2: TestPerson = { id: id(12), organizationId: ORG, name: "Operador Dois", jobTitle: "Operador", reportsToId: SUP_A.id, team: TEAM_A }
const OP3: TestPerson = { id: id(13), organizationId: ORG, name: "Operador Três", jobTitle: "Operador", reportsToId: SUP_B.id, team: TEAM_B }
const ADMIN: TestPerson = { id: id(20), organizationId: ORG, name: "Admin Geral", jobTitle: "Administrador", reportsToId: null, team: null }
const SUP_C: TestPerson = { id: id(4), organizationId: ORG, name: "Supervisor C", jobTitle: "Supervisor", reportsToId: MANAGER.id, team: TEAM_A }
const OP4: TestPerson = { id: id(14), organizationId: ORG, name: "Operadora Quatro", jobTitle: "Operador", reportsToId: SUP_C.id, team: TEAM_A }
const QUALITY: TestPerson = { id: id(40), organizationId: ORG, name: "Analista de Qualidade", jobTitle: "Qualidade", reportsToId: null, team: null }
const RETENTION_QA: TestPerson = { id: id(41), organizationId: ORG, name: "Analista da Retenção", jobTitle: "Qualidade", reportsToId: null, team: null }
const OTHER_SUP: TestPerson = { id: id(30), organizationId: OTHER_ORG, name: "Supervisor Externo", jobTitle: "Supervisor", reportsToId: null, team: null }
const OTHER_OP: TestPerson = { id: id(31), organizationId: OTHER_ORG, name: "Operador Externo", jobTitle: "Operador", reportsToId: OTHER_SUP.id, team: null }
const PEOPLE = [MANAGER, SUP_A, SUP_B, SUP_C, OP1, OP2, OP3, OP4, ADMIN, QUALITY, RETENTION_QA, OTHER_SUP, OTHER_OP]
const grant = (person: TestPerson, scopeType: TestGrant["scopeType"], teamId: string | null = null): TestGrant => ({ organizationId: person.organizationId, personId: person.id, scopeType, teamId, subteamId: null })
// A capability é EXPLÍCITA: SUP_C lidera alguém e NÃO tem; Admin NÃO tem; a Qualidade tem sem liderar ninguém.
const GRANTS = [grant(MANAGER, "MY_STRUCTURE"), grant(SUP_A, "MY_STRUCTURE"), grant(SUP_B, "MY_STRUCTURE"), grant(QUALITY, "ORGANIZATION"), grant(RETENTION_QA, "GROUP", TEAM_B.id), grant(OTHER_SUP, "MY_STRUCTURE")]

const INTERACTION_ID = "0f0e0d0c-0000-4000-8000-000000000006"
const RAW_WITHHELD = "Anota o código 99887766554433 aí."
const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: INTERACTION_ID, turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })

/** Feedback com STRENGTH (1 trecho retido) + FRICTION + divergência procedimental (bloqueada — nunca vira item de revisão). */
function feedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "RESUMO-DO-MODELO", evidence: [unit("T4", "OPERADOR", "Vou te passar o prazo: são até cinco dias úteis."), unit("T5", "OPERADOR", RAW_WITHHELD)] }
  const statement = { id: "D1", kind: "AGENT_STATEMENT", summary: "RESUMO-DO-MODELO", evidence: [unit("T19", "OPERADOR", "É o faturamento pro rata do ciclo.")] }
  const signal = { id: "S1", kind: "CUSTOMER_SIGNAL", summary: "RESUMO-DO-MODELO", evidence: [unit("T20", "CLIENTE", "Não entendi nada disso.")] }
  const assertion = { id: "P1", kind: "PROCEDURE_ASSERTION", summary: "RESUMO-DO-MODELO", evidence: [unit("T15", "OPERADOR", "Não precisa validar nada, vou seguir.")] }
  const finding = (fid: string, kind: string, observations: { id: string; evidence: unknown[] }[], extra: object = {}) => ({ id: fid, interactionRef: "I6", kind, summary: "SUMMARY", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${fid}`, ownership: "AGENT", ...extra })
  const frame = { interactionRef: "I6", interactionId: INTERACTION_ID, source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [statement], commitments: [], customerSignals: [signal], procedureAssertions: [assertion], interactionEvents: [], empty: false, findings: [finding("1", "STRENGTH", [action]), finding("2", "FRICTION", [statement, signal]), finding("3", "PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })] }
  const lineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "O operador deve validar os dados antes de seguir.", documentId: "11111111-2222-4333-8444-555555555555" }]])
  return composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: frame as never, interactionLabel: "14/03/2026", sourceRun: "run-1", proceduralLineage: lineage })
}

const PROPOSED = { strength: { observed: "Você informou ao cliente o prazo de até cinco dias úteis.", whyItMatters: "Isso pode ajudar o cliente a se organizar.", whatYouCanDo: "Você pode manter essa prática em conversas parecidas." }, friction: { observed: "Você usou um termo técnico e o cliente respondeu que não entendeu.", whyItMatters: "Explicar com palavras do dia a dia pode facilitar a compreensão.", whatYouCanDo: "Você pode explicar o termo com um exemplo simples." } }
type Setup = { memory: ReturnType<typeof createInMemoryInteractionFeedbackStore>; deliveries: ReturnType<typeof createInMemoryFeedbackDeliveryStore>; writerCalls: () => number; app: (as: TestPerson | null) => express.Express }

async function setup(options: { failingWriter?: boolean } = {}): Promise<Setup> {
  const memory = createInMemoryInteractionFeedbackStore()
  let calls = 0
  const writer = { async write(input: FeedbackWriterInputV1) { calls += 1; if (options.failingWriter) throw new Error("boom"); return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, ...(item.section === "STRENGTH" ? PROPOSED.strength : PROPOSED.friction) })) } } } }
  const seed = async (collaborator: TestPerson, occurredAt: string) => runInteractionFeedbackPipeline({ enabled: true, writer, store: memory.store, now: () => new Date(occurredAt), deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), { organizationId: collaborator.organizationId, collaboratorId: collaborator.id, teamId: collaborator.team?.id ?? null, interactionId: INTERACTION_ID, occurredAt: new Date(occurredAt) })
  await seed(OP1, "2026-03-14T12:00:00Z")
  await seed(OP2, "2026-03-15T12:00:00Z")
  await seed(OP3, "2026-03-16T12:00:00Z")
  await seed(OTHER_OP, "2026-03-17T12:00:00Z")
  await seed(OP4, "2026-03-18T12:00:00Z")
  const reader = createInMemoryFeedbackReviewReader(memory, PEOPLE, GRANTS)
  const deliveries = createInMemoryFeedbackDeliveryStore(memory)
  const noDatabase = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
  const app = (as: TestPerson | null) => {
    const instance = express()
    instance.use(express.json())
    instance.use((req, _res, next) => { if (as) req.user = { sub: "acc", personId: as.id, organizationId: as.organizationId, role: as === ADMIN ? "ADMIN" : "SUPERVISOR", name: as.name, email: "x@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null } satisfies AuthTokenPayload; next() })
    instance.use("/feedback-quality-reviews", (req, res, next) => (req.user ? next() : res.status(401).json({ error: { code: "UNAUTHENTICATED" } })), createFeedbackReviewRouter(noDatabase, { reader, store: memory.store, deliveries: deliveries.store, now: () => new Date("2026-09-24T12:00:00Z") }))
    const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
      void next
      if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } })
      if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } })
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: String(error) } })
    }
    instance.use(errorHandler)
    return instance
  }
  return { memory, deliveries, writerCalls: () => calls, app }
}

const list = async (s: Setup, as: TestPerson, query = "") => (await request(s.app(as)).get(`/feedback-quality-reviews${query}`)).body.data as { items: { reviewId: string; collaborator: { name: string }; section: string; status: string; isFallback: boolean }[]; total: number; filterOptions: { collaborators: { name: string }[]; teams: { name: string }[] } }
const firstOf = async (s: Setup, as: TestPerson, section: "STRENGTH" | "OPPORTUNITY" = "STRENGTH") => (await list(s, as, `?section=${section}`)).items[0]!.reviewId

describe("V1.5.5 — QA de feedback: capability explícita, escopo e isolamento", () => {
  let s: Setup
  beforeEach(async () => { s = await setup() })

  it("sem sessão → 401", async () => {
    expect((await request(s.app(null)).get("/feedback-quality-reviews")).status).toBe(401)
  })

  it("sem a capability explícita → 403, mesmo liderando pessoas (supervisor sem concessão), sendo Admin ou operador", async () => {
    for (const as of [SUP_C, ADMIN, OP1]) {
      const response = await request(s.app(as)).get("/feedback-quality-reviews")
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe("FEEDBACK_QUALITY_REVIEW_FORBIDDEN")
      expect((await request(s.app(as)).get("/feedback-quality-reviews/access")).body.data).toEqual({ canReview: false, canDecide: false, scopes: [] })
    }
    const op4Review = (await list(s, QUALITY, `?collaboratorId=${OP4.id}`)).items[0]!.reviewId
    expect((await request(s.app(SUP_C)).get(`/feedback-quality-reviews/${op4Review}`)).status).toBe(403)
    expect((await request(s.app(SUP_C)).post(`/feedback-quality-reviews/${op4Review}/decision`).send({ decision: "APPROVED_UNCHANGED" })).status).toBe(403)
    expect(s.memory.reviews.get(op4Review)!.reviewStatus).toBe("PENDING_REVIEW")
  })

  it("escopo = concessões: SUBTREE (supervisor/gerente), ORGANIZATION (Qualidade, sem liderar ninguém), TEAM; outra organização isolada", async () => {
    const names = async (as: TestPerson) => [...new Set((await list(s, as)).items.map((item) => item.collaborator.name))].sort()
    expect(await names(SUP_A)).toEqual(["Operador Dois", "Operadora Um"])
    expect(await names(SUP_B)).toEqual(["Operador Três"])
    expect(await names(MANAGER)).toEqual(["Operador Dois", "Operador Três", "Operadora Quatro", "Operadora Um"])
    expect(await names(QUALITY)).toEqual(["Operador Dois", "Operador Três", "Operadora Quatro", "Operadora Um"])
    expect(await names(RETENTION_QA)).toEqual(["Operador Três"])
    expect(await names(OTHER_SUP)).toEqual(["Operador Externo"])
    expect((await list(s, SUP_A)).filterOptions.collaborators.map((entry) => entry.name).sort()).toEqual(["Operador Dois", "Operadora Um"])
    expect((await request(s.app(QUALITY)).get("/feedback-quality-reviews/access")).body.data).toEqual({ canReview: true, canDecide: true, scopes: [{ scopeType: "ORGANIZATION", label: "Toda a organização" }] })
  })

  it("detalhe fora do escopo, de outra organização ou inexistente → 404 sem distinguir; id inválido → 400", async () => {
    const op3Review = (await list(s, SUP_B)).items[0]!.reviewId
    const otherOrgReview = (await list(s, OTHER_SUP)).items[0]!.reviewId
    for (const [as, reviewId] of [[SUP_A, op3Review], [SUP_A, otherOrgReview], [QUALITY, otherOrgReview], [RETENTION_QA, (await list(s, SUP_A)).items[0]!.reviewId], [SUP_A, "00000000-0000-4000-8000-00000000dead"]] as const) {
      const response = await request(s.app(as)).get(`/feedback-quality-reviews/${reviewId}`)
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe("FEEDBACK_REVIEW_NOT_FOUND")
    }
    expect((await request(s.app(SUP_A)).get("/feedback-quality-reviews/nao-e-uuid")).status).toBe(400)
    // Decidir fora do escopo também é 404 e não grava nada.
    expect((await request(s.app(SUP_A)).post(`/feedback-quality-reviews/${op3Review}/decision`).send({ decision: "APPROVED_UNCHANGED" })).status).toBe(404)
    expect((await request(s.app(SUP_B)).get(`/feedback-quality-reviews/${op3Review}`)).body.data.status).toBe("PENDING_REVIEW")
  })

  it("fila padrão = PENDING_REVIEW; paginação, filtros por colaborador, equipe, seção e período", async () => {
    const all = await list(s, MANAGER)
    expect(all.total).toBe(8)
    expect(all.items.every((item) => item.status === "PENDING_REVIEW")).toBe(true)
    const page2 = await list(s, MANAGER, "?page=2&pageSize=6")
    expect(page2.items).toHaveLength(2)
    expect((await list(s, MANAGER, `?collaboratorId=${OP2.id}`)).total).toBe(2)
    expect((await list(s, MANAGER, "?search=tr%C3%AAs")).total).toBe(2)
    expect((await list(s, MANAGER, "?search=%25")).total).toBe(0)
    expect((await list(s, MANAGER, `?teamId=${TEAM_B.id}`)).total).toBe(2)
    expect((await list(s, MANAGER, "?section=OPPORTUNITY")).items.every((item) => item.section === "OPPORTUNITY")).toBe(true)
    expect((await list(s, MANAGER, "?from=2026-03-15&to=2026-03-15")).total).toBe(2)
    expect((await request(s.app(MANAGER)).get("/feedback-quality-reviews?status=INVENTED")).status).toBe(400)
  })

  it("procedimental bloqueado NUNCA vira item revisável (cada interação só tem STRENGTH + OPPORTUNITY entregáveis)", async () => {
    const items = (await list(s, SUP_A, `?collaboratorId=${OP1.id}&status=ALL`)).items
    expect(items.map((item) => item.section).sort()).toEqual(["OPPORTUNITY", "STRENGTH"])
    for (const item of items) {
      const detail = (await request(s.app(SUP_A)).get(`/feedback-quality-reviews/${item.reviewId}`)).body.data
      expect(JSON.stringify(detail)).not.toMatch(/Procedimento de Validação|Não precisa validar|KR3|K5/)
    }
  })
})

describe("V1.5.4/V1.5.5 — DTO seguro (lista + detalhe)", () => {
  it("nada de raw retido, prompt, resposta do modelo, provenance, hashes, handles, ownership, tokens ou dados de pares", async () => {
    const s = await setup()
    const listed = await list(s, SUP_A)
    const detail = (await request(s.app(SUP_A)).get(`/feedback-quality-reviews/${await firstOf(s, SUP_A)}`)).body.data
    const serialized = JSON.stringify({ listed, detail })
    for (const forbidden of [RAW_WITHHELD, "99887766554433", INTERACTION_ID, "RESUMO-DO-MODELO", "SUMMARY", "SF1", "\"I6\"", "T4", "provenance", "writerOriginal", "writerViolations", "reviewRequiredBy", "rawEvidence", "requestSha", "promptSha", "responseSha", "usage", "ownership", "polarity", "findingRef", "writerInput", "slot", "itemIndex"]) expect(serialized).not.toContain(forbidden)
    expect(detail).toMatchObject({ sectionLabel: "Ponto positivo", kindLabel: "Comportamento positivo", guidanceLabel: expect.stringContaining("Reforço"), evidence: [{ speakerLabel: "Operador", text: "Vou te passar o prazo: são até cinco dias úteis." }], evidenceWithheldCount: 1, proposedWording: PROPOSED.strength, proposedIsFallback: false, uncertainty: expect.stringContaining("única interação"), deliveryState: "AWAITING_QA", limits: { maxChars: 600 }, selection: { disposition: "HOLD_FOR_QA", dispositionLabel: "Selecionado para QA", structurallyDeliverable: true, policyLabel: "Política do piloto", reasons: expect.arrayContaining(["Política do piloto: todo feedback entregável passa por QA"]) } })
    expect(serialized).not.toMatch(/FEEDBACK_DELIVERY_POLICY|PILOT_HOLD_ALL_FOR_QA|autonomyEligible/)
    expect(detail.reasons.map((reason: { code: string }) => reason.code)).toEqual(["FACTUAL_OVERCLAIM", "UNSUPPORTED_EFFECT", "UNSUPPORTED_PROCEDURE", "TOO_GENERIC", "NOT_ACTIONABLE", "TONE", "PRIVACY", "WRONG_FOCUS", "OTHER"])
  })

  it("fallback: o revisor vê que é texto de fallback de segurança, sem detalhe técnico do erro", async () => {
    const s = await setup({ failingWriter: true })
    const listed = await list(s, SUP_A)
    expect(listed.items.every((item) => item.isFallback)).toBe(true)
    const detail = (await request(s.app(SUP_A)).get(`/feedback-quality-reviews/${listed.items[0]!.reviewId}`)).body.data
    expect(detail.proposedIsFallback).toBe(true)
    expect(JSON.stringify(detail)).not.toMatch(/boom|SCHEMA|WRITER_|writerError|FALLBACK_USED/)
  })
})

describe("V1.5.4/V1.5.5 — avaliações de QA", () => {
  let s: Setup
  beforeEach(async () => { s = await setup() })
  const decide = (as: TestPerson, reviewId: string, body: object) => request(s.app(as)).post(`/feedback-quality-reviews/${reviewId}/decision`).send(body)

  it("APPROVED_UNCHANGED: sem motivo obrigatório; texto final = proposto; revisor e data gravados; pronto para entrega (nada entregue); redator não é chamado", async () => {
    const reviewId = await firstOf(s, SUP_A)
    const callsBefore = s.writerCalls()
    const response = await decide(SUP_A, reviewId, { decision: "APPROVED_UNCHANGED" })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ status: "APPROVED_UNCHANGED", finalWording: PROPOSED.strength, proposedWording: PROPOSED.strength, deliveryState: "DELIVERED", decision: { reviewerName: "Supervisora A", reviewedAt: "2026-09-24T12:00:00.000Z", reasonCategory: null } })
    expect(s.writerCalls()).toBe(callsBefore)
    const stored = s.memory.reviews.get(reviewId)!
    expect(stored).toMatchObject({ reviewStatus: "APPROVED_UNCHANGED", finalWording: null, reviewedBy: SUP_A.id, writerOriginal: expect.objectContaining({ observed: PROPOSED.strength.observed }) })
  })

  it("APPROVED_EDITED: motivo obrigatório; original do redator e proposto preservados; versão humana separada; causalidade corrigida como FACTUAL_OVERCLAIM", async () => {
    const reviewId = await firstOf(s, SUP_A, "OPPORTUNITY")
    const edited = { observed: "Você usou o termo \"pro rata\" e, em seguida, o cliente disse que não entendeu.", whyItMatters: PROPOSED.friction.whyItMatters, whatYouCanDo: PROPOSED.friction.whatYouCanDo }
    const noReason = await decide(SUP_A, reviewId, { decision: "APPROVED_EDITED", finalWording: edited })
    expect(noReason.status).toBe(422)
    expect(noReason.body.error).toMatchObject({ code: "FEEDBACK_REVIEW_INVALID_DECISION", details: { reason: "REASON_REQUIRED" } })
    const unchanged = await decide(SUP_A, reviewId, { decision: "APPROVED_EDITED", finalWording: PROPOSED.friction, reasonCategory: "OTHER" })
    expect(unchanged.body.error.details.reason).toBe("FINAL_WORDING_UNCHANGED")
    const response = await decide(SUP_A, reviewId, { decision: "APPROVED_EDITED", finalWording: edited, reasonCategory: "FACTUAL_OVERCLAIM", comment: "Sequência, não causa." })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ status: "APPROVED_EDITED", finalWording: edited, proposedWording: PROPOSED.friction, deliveryState: "DELIVERED", decision: { reasonCategory: "FACTUAL_OVERCLAIM", reasonLabel: "Afirma mais do que a evidência mostra", comment: "Sequência, não causa." } })
    expect(s.memory.reviews.get(reviewId)).toMatchObject({ proposedWording: PROPOSED.friction, writerOriginal: expect.objectContaining({ observed: PROPOSED.friction.observed }), finalWording: edited })
  })

  it("edição inválida é bloqueada (ref interna, JSON, citação adulterada, dado pessoal) sem gravar; avisos não bloqueiam", async () => {
    const reviewId = await firstOf(s, SUP_A, "OPPORTUNITY")
    const base = PROPOSED.friction
    for (const [observed, code] of [["Você usou um termo técnico (ver SF2).", "INTERNAL_REF"], ["Você usou um termo técnico {\"x\": 1}.", "INTERNAL_JSON_LEAKAGE"], ["O cliente disse \"eu entendi tudo perfeitamente bem\".", "EVIDENCE_ALTERATION"], ["O cliente com CPF 123.456.789-09 não entendeu.", "PRIVACY_DATA"]] as const) {
      const check = await request(s.app(SUP_A)).post(`/feedback-quality-reviews/${reviewId}/edit-check`).send({ ...base, observed })
      expect(check.body.data.blocking.map((entry: { code: string }) => entry.code)).toContain(code)
      const response = await decide(SUP_A, reviewId, { decision: "APPROVED_EDITED", finalWording: { ...base, observed }, reasonCategory: "OTHER" })
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("FEEDBACK_REVIEW_EDIT_BLOCKED")
      expect(response.body.error.details.violations[0].message).toEqual(expect.any(String))
    }
    expect(s.memory.reviews.get(reviewId)!.reviewStatus).toBe("PENDING_REVIEW")
    const warning = { ...base, whatYouCanDo: "Você pode sempre explicar o termo com um exemplo." }
    const check = await request(s.app(SUP_A)).post(`/feedback-quality-reviews/${reviewId}/edit-check`).send(warning)
    expect(check.body.data).toMatchObject({ blocking: [], warnings: [{ code: "PATTERN_LANGUAGE" }] })
    const response = await decide(SUP_A, reviewId, { decision: "APPROVED_EDITED", finalWording: warning, reasonCategory: "TONE" })
    expect(response.status).toBe(200)
    expect(response.body.data.decision.editWarnings).toEqual([{ code: "PATTERN_LANGUAGE", message: expect.any(String) }])
  })

  it("REJECTED: motivo obrigatório; não entregável; auditável", async () => {
    const reviewId = await firstOf(s, SUP_A)
    expect((await decide(SUP_A, reviewId, { decision: "REJECTED" })).body.error.details.reason).toBe("REASON_REQUIRED")
    expect((await decide(SUP_A, reviewId, { decision: "REJECTED", reasonCategory: "INVENTADO" })).status).toBe(400)
    const response = await decide(SUP_A, reviewId, { decision: "REJECTED", reasonCategory: "TOO_GENERIC", comment: "Não diz nada específico." })
    expect(response.body.data).toMatchObject({ status: "REJECTED", finalWording: null, deliveryState: "QA_REJECTED", decision: { reasonCategory: "TOO_GENERIC", comment: "Não diz nada específico.", reviewerName: "Supervisora A" } })
  })

  it("decisão é única: quem chega depois recebe 409 com o estado atual; em corrida, exatamente uma decisão vence", async () => {
    const reviewId = await firstOf(s, SUP_A)
    expect((await decide(SUP_A, reviewId, { decision: "APPROVED_UNCHANGED" })).status).toBe(200)
    const late = await decide(MANAGER, reviewId, { decision: "REJECTED", reasonCategory: "TONE" })
    expect(late.status).toBe(409)
    expect(late.body.error).toMatchObject({ code: "FEEDBACK_REVIEW_ALREADY_DECIDED", details: { current: { status: "APPROVED_UNCHANGED", decision: { reviewerName: "Supervisora A" } } } })
    expect(s.memory.reviews.get(reviewId)!.reviewStatus).toBe("APPROVED_UNCHANGED")
    const other = await firstOf(s, SUP_A, "OPPORTUNITY")
    const [a, b] = await Promise.all([decide(SUP_A, other, { decision: "APPROVED_UNCHANGED" }), decide(MANAGER, other, { decision: "REJECTED", reasonCategory: "TONE" })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
  })

  it("V1.5.6: aprovar aciona a ENTREGA (uma só, com o texto final quando editado); rejeitar nunca entrega; a falha técnica não desfaz a avaliação", async () => {
    const strength = await firstOf(s, SUP_A)
    const opportunity = await firstOf(s, SUP_A, "OPPORTUNITY")
    expect((await decide(SUP_A, strength, { decision: "APPROVED_UNCHANGED" })).body.data.deliveryState).toBe("DELIVERED")
    expect((await decide(SUP_A, opportunity, { decision: "REJECTED", reasonCategory: "TONE" })).body.data.deliveryState).toBe("QA_REJECTED")
    expect(s.deliveries.deliveries.map((entry) => [entry.itemReviewId, entry.deliveryMode, entry.wordingSource])).toEqual([[strength, "QA_APPROVED", "PROPOSED"]])
    // Falha técnica na entrega logo depois do QA: a avaliação fica gravada e o item fica "pronto para entrega" (o varredor refaz).
    const other = (await list(s, SUP_B, "?section=STRENGTH")).items[0]!.reviewId
    s.deliveries.control.failNextRecord = true
    const response = await decide(SUP_B, other, { decision: "APPROVED_UNCHANGED" })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ status: "APPROVED_UNCHANGED", deliveryState: "READY_FOR_DELIVERY" })
    expect(s.deliveries.deliveries).toHaveLength(1)
  })

  it("a avaliação de QA NUNCA altera a verdade estrutural: disposição, motivos, política e snapshot ficam como estavam", async () => {
    const approved = await firstOf(s, SUP_A)
    const rejected = await firstOf(s, SUP_A, "OPPORTUNITY")
    const before = structuredClone(s.memory.decisions)
    const snapshots = [...s.memory.runs.values()].map((run) => JSON.stringify(run.feedbackSnapshot))
    expect((await decide(SUP_A, approved, { decision: "APPROVED_UNCHANGED" })).status).toBe(200)
    expect((await decide(SUP_A, rejected, { decision: "REJECTED", reasonCategory: "TONE" })).status).toBe(200)
    // Só a ENTREGA real (delivered_at) é registrada na decisão; disposição, motivos, política e autonomia ficam iguais.
    const withoutDelivery = (list: typeof before) => list.map((entry) => ({ ...entry, deliveredAt: null }))
    expect(withoutDelivery(s.memory.decisions)).toEqual(withoutDelivery(before))
    expect(s.memory.decisions.filter((entry) => entry.deliveredAt).map((entry) => entry.itemReviewId)).toEqual([approved])
    expect([...s.memory.runs.values()].map((run) => JSON.stringify(run.feedbackSnapshot))).toEqual(snapshots)
    // Os procedimentais continuam BLOCKED e nunca aparecem no QA.
    expect(s.memory.decisions.filter((entry) => entry.findingKind === "PROCEDURAL_DIVERGENCE").every((entry) => entry.decision.disposition === "BLOCKED" && entry.itemReviewId === null)).toBe(true)
  })

  it("campo fora do contrato no corpo é recusado (sem 'voltar para PENDING_REVIEW')", async () => {
    const reviewId = await firstOf(s, SUP_A)
    expect((await decide(SUP_A, reviewId, { decision: "PENDING_REVIEW" })).status).toBe(400)
    expect((await decide(SUP_A, reviewId, { decision: "APPROVED_UNCHANGED", deliver: true })).status).toBe(400)
  })
})
