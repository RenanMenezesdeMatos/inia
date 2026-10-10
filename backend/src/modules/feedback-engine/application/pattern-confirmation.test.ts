import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { patternConfirmationCandidatesOf, type CriterionPattern } from "../domain/indicator-investigation.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { CALLS, investigationOf, request, setup, strategyWith } from "../testing/investigation-world.js"
import { TRANSCRIPT } from "../testing/fixtures.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * CONFIRMAÇÃO DE PADRÃO (`PATTERN_CONFIRMATION_V1`) — zero IA. Rodada real V14: o TMA da Larissa piorou em contestação; o planejador
 * analisou 3 de 11 chamadas e "prazo" falhou em 2 de 2 aplicáveis — abaixo do mínimo de padrão, virou "desvio isolado" e a mensagem
 * disse que nada apontava desvio recorrente. Uma etapa que falha em toda a amostra pequena é uma PERGUNTA ("isso se repete?"): o motor
 * analisa mais chamadas do mesmo assunto, dentro do orçamento da estratégia, antes de concluir.
 */
const pattern = (overrides: Partial<CriterionPattern>): CriterionPattern => ({ criterionKey: "KC-x", documentId: "d", documentTitle: "D", heading: "35. Prazo", text: "Informar o prazo.", eligible: 2, met: 0, notMet: 2, partial: 0, inconclusive: 0, notApplicable: 0, classification: "ISOLATED_DEVIATION", examples: [], ...overrides })

describe("candidatos: falhou na amostra, mas a amostra não basta para dizer padrão", () => {
  it("2 de 2 não cumpridas → candidata; 1 de 3 (já com mínimo) não; padrão já formado não; cumprida não", () => {
    expect(patternConfirmationCandidatesOf([pattern({})])).toHaveLength(1)
    expect(patternConfirmationCandidatesOf([pattern({ eligible: 1, notMet: 1 })])).toHaveLength(1)
    expect(patternConfirmationCandidatesOf([pattern({ eligible: 3, notMet: 1, met: 2 })])).toHaveLength(0)
    expect(patternConfirmationCandidatesOf([pattern({ eligible: 3, notMet: 3, classification: "DEVELOPMENT_PATTERN" })])).toHaveLength(0)
    expect(patternConfirmationCandidatesOf([pattern({ eligible: 2, notMet: 0, met: 2, classification: "NONE" })])).toHaveLength(0)
    expect(patternConfirmationCandidatesOf([pattern({ eligible: 2, notMet: 0, partial: 1, met: 1 })])).toHaveLength(1)
  })
})

describe("investigação: o planejador analisou pouco; o contrato completa a amostra do assunto que piorou", () => {
  const EXTRA = ["00000000-0000-4000-8000-00000000f104", "00000000-0000-4000-8000-00000000f105", "00000000-0000-4000-8000-00000000f106"]
  const ALL = [...CALLS, ...EXTRA]
  const build = (maxCallAnalyses?: number) => {
    // O planejador escolhe só 2 chamadas do recorte e para.
    const model = fakeEngineModel({ planner: (payload, round) => (round === 1 ? { calls: [{ tool: "analyze_calls", args: { interactions: payload.slices![0]!.interactions.slice(0, 2) }, question: "CALLS:R1" }] } : { calls: [], stop: { reason: "SUFFICIENT", note: "Duas chamadas bastam." } }) })
    const built = setup({ subjects: "LOCATED", strategy: strategyWith({ segmentation: true, sample: true }), model: model.model, ...(maxCallAnalyses !== undefined ? { maxCallAnalyses } : {}) })
    const rows = ALL.map((id, index) => ({ id, startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 600 - index, signaled: false }))
    Object.assign(built.investigate.data, { segmentInteractions: async () => rows, sliceInteractions: async () => rows })
    const base = built.analyze.loadInteraction
    Object.assign(built.analyze, {
      loadInteraction: async (org: string, id: string) => (EXTRA.includes(id) ? { ...(await base(org, CALLS[0]!))!, id, transcript: { content: TRANSCRIPT, checksum: `t-${id}` } } : base(org, id)),
    })
    return { ...built, model }
  }

  it("2 de 2 com a mesma etapa não cumprida → mais 3 chamadas do assunto (até a amostra da estratégia) e o padrão se forma", async () => {
    const { investigate, memory, model } = build()
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.patternConfirmation).toEqual([{ sliceRef: "R1", candidates: expect.any(Array), requested: 3 }])
    const analyses = model.calls.filter((call) => call.stage === "CALL_ANALYSIS")
    expect(analyses).toHaveLength(5)
    const confirm = investigation.tools!.ledger.find((entry) => entry.via === "CONTRACT" && entry.tool === "analyze_calls")
    expect(confirm).toMatchObject({ status: "OK", question: "CALLS:R1" })
    const evidence = investigation.evidence.find((entry) => entry.sliceRef === "R1")!
    expect(evidence.analyzedCalls).toBe(5)
    expect(evidence.patterns.some((entry) => entry.classification === "DEVELOPMENT_PATTERN" && entry.eligible >= 3)).toBe(true)
  })

  it("sem orçamento de análises da pessoa sobrando, nada é pedido (registrado com zero)", async () => {
    const { investigate, memory, model } = build(2)
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.patternConfirmation?.[0]).toMatchObject({ sliceRef: "R1", requested: 0 })
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(2)
  })

  it("referência consultada ANTES das chamadas a mais é consultada DE NOVO depois (validação V14B: 'você 1 de 1' virava 1 de 4)", async () => {
    const model = fakeEngineModel({ planner: (payload, round) => (round === 1 ? { calls: [{ tool: "analyze_calls", args: { interactions: payload.slices![0]!.interactions.slice(0, 2) }, question: "CALLS:R1" }, { tool: "reference_practices", args: { subject: "CONTESTACAO" }, question: "CONTEXT" }] } : { calls: [], stop: { reason: "SUFFICIENT", note: "ok" } }) })
    const built = setup({ subjects: "LOCATED", strategy: strategyWith({ segmentation: true, sample: true, peers: true }), model: model.model })
    const peers = ["q1", "q2", "q3", "q4", "q5"]
    const rows = ALL.map((id, index) => ({ id, startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 600 - index, signaled: false }))
    Object.assign(built.investigate, { peerCallAnalyses: false })
    Object.assign(built.investigate.data, { segmentInteractions: async () => rows, sliceInteractions: async () => rows, teamPeers: async () => peers, peerOfficialValues: async () => peers.map((personId, index) => ({ personId, value: 300 + index })) })
    const base = built.analyze.loadInteraction
    Object.assign(built.analyze, { loadInteraction: async (org: string, id: string) => (EXTRA.includes(id) ? { ...(await base(org, CALLS[0]!))!, id, transcript: { content: TRANSCRIPT, checksum: `t-${id}` } } : base(org, id)) })
    const result = (await investigateIndicator(built.investigate, request())).investigations[0]!
    const investigation = await investigationOf(built.memory, result.runId)
    const order = investigation.tools!.ledger.map((entry) => `${entry.tool}:${entry.via}`)
    expect(order.filter((step) => step.startsWith("reference_practices"))).toEqual(["reference_practices:PLANNER", "reference_practices:CONTRACT"])
    expect(order.indexOf("reference_practices:CONTRACT")).toBeGreaterThan(order.indexOf("analyze_calls:CONTRACT"))
  })
})
