import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { runtimeParametersOf } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { OfficialFacts } from "../domain/indicator-investigation.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../infrastructure/overlay-feedback-memory-store.js"
import type { IndicatorDataPort } from "../infrastructure/postgres-indicator-data.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, PROCEDURE_V1, TRANSCRIPT } from "../testing/fixtures.js"
import { analyzeCall, CollaboratorNotAllowedError, type AnalyzeCallDeps } from "./analyze-call.js"
import { investigateIndicator, type InvestigateIndicatorDeps, type InvestigateIndicatorRequest } from "./investigate-indicator.js"
import type { FeedbackMemoryStore } from "./ports.js"

/**
 * INVESTIGAÇÃO × EVIDÊNCIA NOVA (sem IA — modelo falso, memória em RAM). O indicador oficial NÃO muda em nenhum passo: o que
 * muda são as chamadas, as transcrições e a memória. A investigação precisa enxergar o que acabou de ser analisado no MESMO
 * armazenamento, reusar quando nada mudou, revisar quando algo relevante mudou, e nunca deixar uma execução antiga sobrescrever a
 * revisão mais nova.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "00000000-0000-4000-8000-0000000000aa"
const PEER = "00000000-0000-4000-8000-0000000000bb"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const CALLS = ["00000000-0000-4000-8000-00000000f101", "00000000-0000-4000-8000-00000000f102", "00000000-0000-4000-8000-00000000f103"]
const PEER_CALL = "00000000-0000-4000-8000-00000000f201"

const official: OfficialFacts = { indicatorId: "ind-tma", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "closing-aug", value: 357, target: 400, withinTarget: true, gapToTarget: null, periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "agosto/2026", referencePeriod: "2026-08", previous: { value: 382, periodLabel: "julho/2026", withinTarget: true }, movement: "IMPROVED", quartile: null, previousQuartile: null }

function world() {
  const signature = { person: "10:v1" }
  // Volume do período anterior insuficiente (1 chamada): não dá para LOCALIZAR onde o resultado mudou.
  const data = {
    timeZone: async () => "America/Sao_Paulo",
    indicatorByCode: async () => ({ id: "ind-tma", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" as const, dailySupported: false }),
    indicatorById: async () => ({ id: "ind-tma", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" as const, dailySupported: false }),
    officialFromClosing: async () => official,
    placement: async () => ({ teamId: "team-1", subteamId: null }),
    teamPeers: async () => [PEER],
    peerOfficialValues: async () => [],
    subjectNames: async () => new Map([["CONTESTACAO", "Contestação de cobrança"]]),
    resolveSignal: async () => ({ flagIds: [], condition: null }),
    segmentRows: async (_org: string, personIds: readonly string[], window: { start: Date }) => (personIds.includes(PERSON) ? (window.start.getUTCMonth() === 7 ? [{ personId: PERSON, key: "CONTESTACAO", n: 10, avgDuration: 450, signaled: 0 }] : [{ personId: PERSON, key: "PLANO", n: 1, avgDuration: 900, signaled: 0 }]) : [{ personId: PEER, key: "CONTESTACAO", n: 12, avgDuration: 400, signaled: 0 }]),
    dailyPoints: async () => [],
    segmentInteractions: async (_org: string, personId: string) => (personId === PERSON ? CALLS.map((id, index) => ({ id, startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 450, signaled: false })) : [{ id: PEER_CALL, startedAt: new Date("2026-08-12T13:00:00Z"), durationSeconds: 400, signaled: false }]),
    sliceInteractions: async (_org: string, personId: string, _window: unknown, filters: { dimension: string; value: string }[]) => (personId === PERSON && filters.every((filter) => filter.dimension === "SUBJECT" && filter.value === "CONTESTACAO") ? CALLS.map((id, index) => ({ id, startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 450, signaled: false })) : []),
    interactionEvidence: async (_org: string, personIds: readonly string[]) => (personIds.includes(PERSON) ? signature.person : "peers:v1"),
  } as unknown as IndicatorDataPort
  return { data, signature }
}

function deps(memory: FeedbackMemoryStore, data: IndicatorDataPort, options: { now?: () => Date; peerCallAnalyses?: boolean; allowCollaborator?: (id: string) => boolean; procedure?: () => string } = {}) {
  const { model, calls } = fakeEngineModel()
  const interaction = (id: string): InteractionForAnalysis | null => (CALLS.includes(id) || id === PEER_CALL ? { id, organizationId: ORG, operatorId: id === PEER_CALL ? PEER : PERSON, operatorName: "X", startedAt: new Date("2026-08-11T13:00:00Z"), endedAt: new Date("2026-08-11T13:07:00Z"), reason: "Contestação de cobrança", channel: "VOICE", subjectCanonical: { code: "CONTESTACAO", name: "Contestação de cobrança" }, flags: [], transcript: { content: TRANSCRIPT, checksum: "t1" }, teamId: "team-1", subteamId: null, supervisorId: null, timeZone: "America/Sao_Paulo" } : null)
  const now = options.now ?? (() => new Date("2026-09-30T12:00:00Z"))
  const analyze: AnalyzeCallDeps = {
    memory,
    model,
    loadInteraction: async (_org, id) => interaction(id),
    loadAgent: async () => ({ id: AGENT, name: "Especialista", objective: null, contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [
      { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: options.procedure?.() ?? PROCEDURE_V1, contentHash: options.procedure ? "h1-alterado" : "h1", perspective: "RULE_IN_FORCE_AT_CALL" as const },
      { documentId: CHECKLIST_ID, title: "Checklist de Encerramento de Chamada", version: 1, content: CHECKLIST_V1, contentHash: "h2", perspective: "RULE_IN_FORCE_AT_CALL" as const },
    ],
    loadPreviousVersion: async () => null,
    now,
    ...(options.allowCollaborator ? { allowCollaborator: options.allowCollaborator } : {}),
  }
  const investigate: InvestigateIndicatorDeps = { memory, data, analyze, strategy: async () => runtimeParametersOf(null), now, ...(options.peerCallAnalyses !== undefined ? { peerCallAnalyses: options.peerCallAnalyses } : {}) }
  return { investigate, analyze, calls }
}

const request = (now = new Date("2026-09-30T12:00:00Z")): InvestigateIndicatorRequest => ({ organizationId: ORG, personId: PERSON, agentId: AGENT, agentConfiguredAt: "2026-09-01T00:00:00.000Z", enrollmentId: null, target: { kind: "OFFICIAL_CLOSING", indicatorCode: "TMA" }, trigger: { kind: "EVALUATION", selectionReason: "teste" }, now })
const investigationOf = (stores: ReturnType<typeof createInMemoryFeedbackMemoryStore>, runId: string) => stores.investigations.find((entry) => entry.runId === runId)!

describe("investigação de indicador — evidência nova, reuso e revisão (sem IA)", () => {
  it("1–4: poucos dados → evidência nova com o MESMO oficial → nova revisão incorpora → nada mudou → reuso", async () => {
    const stores = createInMemoryFeedbackMemoryStore()
    const { data, signature } = world()
    const { investigate, analyze, calls } = deps(stores, data)

    // 1. Concluída com poucos dados: resultado dentro da meta, sem localizar onde mudou e sem nenhuma chamada analisada.
    const first = await investigateIndicator(investigate, request())
    const run1 = first.investigations[0]!
    expect(run1).toMatchObject({ reused: false, conclusion: "RESULT_RECOGNITION" })
    expect(investigationOf(stores, run1.runId).investigation.evidence).toEqual([])
    expect(calls).toHaveLength(0)

    // Mesmas fontes → reuso (nenhuma execução nova).
    expect((await investigateIndicator(investigate, request())).investigations[0]).toMatchObject({ runId: run1.runId, reused: true })

    // 2. Evidência relevante nova (monitoria das chamadas do período), oficial intacto.
    for (const id of CALLS) await analyzeCall(analyze, { organizationId: ORG, interactionId: id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })

    // 3. Nova revisão incorpora: a memória gravada AGORA, no mesmo armazenamento, é vista pela investigação.
    const second = (await investigateIndicator(investigate, request())).investigations[0]!
    expect(second.reused).toBe(false)
    expect(second.runId).not.toBe(run1.runId)
    const revision = investigationOf(stores, second.runId)
    expect(revision.investigation.evidence[0]).toMatchObject({ focusReason: "UNLOCATED", analyzedCalls: 3, newlyAnalyzed: 0, sampleBasis: "EXISTING_MEMORY" })
    expect(revision.investigation.conclusion).toBe("STRENGTH_PATTERN")
    expect(revision.current).toBe(true)
    expect(investigationOf(stores, run1.runId).current).toBe(false)
    // O desvio recorrente num recorte NÃO localizado é observação, nunca padrão que "explica" o indicador.
    expect(revision.investigation.evidence[0]!.patterns.some((pattern) => pattern.classification === "DEVELOPMENT_PATTERN")).toBe(true)
    expect(revision.investigation.conclusion).not.toBe("PATTERN_SUPPORTED")
    // Itens enumerados DENTRO de uma linha do checklist ("(1) … (2) …") continuam em vigor — nunca "mudou na base" por engano.
    expect(revision.investigation.evidence[0]!.patterns.map((pattern) => pattern.currentRule)).toEqual(revision.investigation.evidence[0]!.patterns.map(() => "IN_FORCE"))

    // 4. Nada mudou → reuso da revisão (nenhuma análise, nenhuma execução nova).
    const modelCalls = calls.length
    expect((await investigateIndicator(investigate, request())).investigations[0]).toMatchObject({ runId: second.runId, reused: true })
    expect(calls).toHaveLength(modelCalls)

    // Transcrição corrigida / chamada nova (assinatura das chamadas muda) → nova revisão, mesmo oficial.
    signature.person = "11:v2"
    const third = (await investigateIndicator(investigate, request())).investigations[0]!
    expect(third).toMatchObject({ reused: false })
    expect(third.runId).not.toBe(second.runId)
  })

  it("regra que MUDOU na base depois das chamadas: a avaliação histórica fica na memória, mas não orienta (nem vira reconhecimento)", async () => {
    const stores = createInMemoryFeedbackMemoryStore()
    const { data } = world()
    let current = PROCEDURE_V1
    const { investigate, analyze } = deps(stores, data, { procedure: () => current })
    for (const id of CALLS) await analyzeCall(analyze, { organizationId: ORG, interactionId: id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    current = PROCEDURE_V1.replace("- Confirmar nome completo;", "- Confirmar nome completo somente se o cliente não tiver senha;")
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = investigationOf(stores, result.runId).investigation
    const changed = investigation.evidence[0]!.patterns.find((pattern) => pattern.text.includes("Confirmar nome completo"))!
    expect(changed.currentRule).toBe("CHANGED")
    expect(investigation.evidence[0]!.patterns.filter((pattern) => pattern.currentRule === "IN_FORCE").length).toBeGreaterThan(0)
  })

  it("5: execução ANTIGA que termina depois não substitui a revisão mais nova", async () => {
    const stores = createInMemoryFeedbackMemoryStore()
    const { data, signature } = world()
    const newer = deps(stores, data, { now: () => new Date("2026-09-30T12:00:00Z") })
    const older = deps(stores, data, { now: () => new Date("2026-09-30T10:00:00Z") })
    const recent = (await investigateIndicator(newer.investigate, request())).investigations[0]!
    signature.person = "10:v-old"
    const late = (await investigateIndicator(older.investigate, request(new Date("2026-09-30T10:00:00Z")))).investigations[0]!
    expect(late.runId).not.toBe(recent.runId)
    expect(investigationOf(stores, recent.runId).current).toBe(true)
    expect(investigationOf(stores, late.runId).current).toBe(false)
    expect(stores.investigations.filter((entry) => entry.current)).toHaveLength(1)
  })

  it("memória SOBREPOSTA (ensaio/QA Lab): a investigação vê a memória do banco E o que o ensaio acabou de gravar na RAM", async () => {
    const database = createInMemoryFeedbackMemoryStore()
    const { data } = world()
    const seeded = deps(database, data)
    await analyzeCall(seeded.analyze, { organizationId: ORG, interactionId: CALLS[0]!, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "memória existente" } })
    const overlay = createOverlayFeedbackMemoryStore(database, createInMemoryFeedbackMemoryStore())
    const rehearsal = deps(overlay, data)
    // Reuso da análise que já existia "no banco": nenhuma chamada de modelo.
    const reused = await analyzeCall(rehearsal.analyze, { organizationId: ORG, interactionId: CALLS[0]!, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "ensaio" } })
    expect(reused.reused).toBe(true)
    expect(rehearsal.calls).toHaveLength(0)
    for (const id of CALLS.slice(1)) await analyzeCall(rehearsal.analyze, { organizationId: ORG, interactionId: id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "ensaio" } })
    const result = (await investigateIndicator(rehearsal.investigate, request())).investigations[0]!
    const stored = overlay.overlay.investigations.find((entry) => entry.runId === result.runId)!
    expect(stored.investigation.evidence[0]).toMatchObject({ analyzedCalls: 3 })
    expect(database.investigations).toHaveLength(0)
  })

  it("expansão de pares desligada: nenhuma chamada de colega é analisada; trava de colaborador bloqueia análise de outra pessoa antes de qualquer modelo", async () => {
    const stores = createInMemoryFeedbackMemoryStore()
    const { data } = world()
    const guarded = deps(stores, data, { peerCallAnalyses: false, allowCollaborator: (id) => id === PERSON })
    await expect(analyzeCall(guarded.analyze, { organizationId: ORG, interactionId: PEER_CALL, collaboratorId: PEER, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "colega" } })).rejects.toBeInstanceOf(CollaboratorNotAllowedError)
    expect(guarded.calls).toHaveLength(0)
    await investigateIndicator(guarded.investigate, request())
    expect(stores.assessments.filter((entry) => entry.snapshot.personId === PEER)).toHaveLength(0)
  })
})
