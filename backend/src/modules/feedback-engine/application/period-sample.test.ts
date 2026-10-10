import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { buildIndicatorBrief } from "../domain/indicator-brief.js"
import { ATTRIBUTION_LIMIT, localizationVolumeGapOf, periodSampleOf, type SegmentComparison } from "../domain/indicator-investigation.js"
import { analyzedInteractionIds } from "../domain/memory-queries.js"
import { CALL_ANALYSIS_LOGIC_VERSION, INDICATOR_INVESTIGATION_LOGIC_VERSION } from "../domain/versions.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { TRANSCRIPT } from "../testing/fixtures.js"
import { AGENT, CALLS, DAILY_WITH_PEAK, investigationOf, ORG, PERSON, request, setup, strategyWith, type SetupOptions } from "../testing/investigation-world.js"
import { analyzeCall } from "./analyze-call.js"
import { EngineBudgetExhaustedError } from "./engine-meter.js"
import { investigateIndicator } from "./investigate-indicator.js"
import type { EngineModelPort } from "./ports.js"

/**
 * `PERIOD_SAMPLE_V1` — zero IA (modelo falso). Dev 05/10/2026: Denisy Feitoza (TMA set, 8 × 14 chamadas), Fernanda Nunes Alves (2 × 6) e
 * Icaro Elias (9 × 12) terminaram sem NENHUMA chamada analisada, com a estratégia do TMA autorizando a análise: o volume não permitia
 * localizar por assunto e a memória "não localizada" só lia o que já existia. Agora, sem localizar por VOLUME e com a análise autorizada
 * pelo contrato, uma amostra determinística das chamadas do período é analisada (assunto com mais chamadas primeiro, depois os demais),
 * dentro dos tetos da estratégia e do orçamento — observação do período, nunca causa da variação.
 */
const uuid = (tag: string) => `00000000-0000-4000-8000-${tag.padStart(12, "0")}`
const SUBJECTS = { CONTESTACAO: "Contestação de cobrança", PLANO: "Troca de plano", TITULAR: "Troca de titularidade" } as const
type SubjectKey = keyof typeof SUBJECTS
const CODE: Record<SubjectKey, string> = { CONTESTACAO: "a1", PLANO: "b2", TITULAR: "c3" }
const callOf = (subject: SubjectKey, index: number) => ({ id: uuid(`${CODE[subject]}0${index}`), subject, date: `2026-08-${String(3 + index * 6).padStart(2, "0")}` })
const PEERS = [1, 2, 3, 4, 5].map((index) => uuid(`f${index}`))
const peerCall = (peerIndex: number, index: number) => uuid(`e${peerIndex}0${index}`)
const PEER_CALLS = new Map(PEERS.flatMap((peer, peerIndex) => [0, 1].map((index) => [peerCall(peerIndex + 1, index), peer] as const)))

type BuildOptions = { counts: Partial<Record<SubjectKey, number>>; strategy?: SetupOptions["strategy"]; peers?: boolean; model?: EngineModelPort; maxCallAnalyses?: number; maxToolCalls?: number; daily?: SetupOptions["daily"] }

/** Mundo do caso real: agosto com chamadas em três assuntos, julho com UMA chamada (não dá para comparar os períodos por assunto). */
function build(options: BuildOptions) {
  const calls = (Object.keys(options.counts) as SubjectKey[]).flatMap((subject) => Array.from({ length: options.counts[subject] ?? 0 }, (_, index) => callOf(subject, index)))
  const fake = fakeEngineModel()
  const built = setup({ subjects: "UNLOCATED", strategy: options.strategy ?? null, model: options.model ?? fake.model, ...(options.maxCallAnalyses !== undefined ? { maxCallAnalyses: options.maxCallAnalyses } : {}), ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}), ...(options.daily ? { daily: options.daily } : {}) })
  /** Assuntos cujas chamadas da PESSOA foram listadas (a amostra do período é a única que as lista neste mundo). */
  const listed: string[] = []
  Object.assign(built.investigate.data, {
    subjectNames: async () => new Map(Object.entries(SUBJECTS)),
    teamPeers: async () => (options.peers ? PEERS : []),
    peerOfficialValues: async () => PEERS.map((personId, index) => ({ personId, value: 300 + index })),
    segmentRows: async (_org: string, personIds: readonly string[], window: { start: Date }) => {
      if (!personIds.includes(PERSON)) return PEERS.filter((peer) => personIds.includes(peer)).map((personId, index) => ({ personId, key: "CONTESTACAO", n: 4, avgDuration: 300 + index * 10, signaled: 0 }))
      if (window.start.getUTCMonth() !== 7) return [{ personId: PERSON, key: "PLANO", n: 1, avgDuration: 900, signaled: 0 }]
      return (Object.keys(options.counts) as SubjectKey[]).filter((key) => (options.counts[key] ?? 0) > 0).map((key) => ({ personId: PERSON, key, n: options.counts[key]!, avgDuration: 480, signaled: 0 }))
    },
    segmentInteractions: async (_org: string, personId: string, _window: unknown, key: string) => {
      const peerIndex = PEERS.indexOf(personId)
      if (peerIndex >= 0) return [0, 1].map((index) => ({ id: peerCall(peerIndex + 1, index), startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 300, signaled: false }))
      listed.push(key)
      return calls.filter((call) => call.subject === key).map((call) => ({ id: call.id, startedAt: new Date(`${call.date}T13:00:00Z`), durationSeconds: 480, signaled: false }))
    },
  })
  const base = built.analyze.loadInteraction
  Object.assign(built.analyze, {
    loadInteraction: async (org: string, id: string): Promise<InteractionForAnalysis | null> => {
      const own = calls.find((call) => call.id === id)
      const peer = PEER_CALLS.get(id)
      if (!own && !peer) return base(org, id)
      const subject: SubjectKey = own?.subject ?? "CONTESTACAO"
      const date = own?.date ?? "2026-08-12"
      return { ...(await base(org, CALLS[0]!))!, id, operatorId: peer ?? PERSON, startedAt: new Date(`${date}T13:00:00Z`), endedAt: new Date(`${date}T13:08:00Z`), reason: SUBJECTS[subject], subjectCanonical: { code: subject, name: SUBJECTS[subject] }, transcript: { content: TRANSCRIPT, checksum: `t-${id}` } }
    },
  })
  return { ...built, fake, calls, listed }
}

const analysesOf = (requests: readonly { stage: string }[]) => requests.filter((entry) => entry.stage === "CALL_ANALYSIS").length
const ON = strategyWith({ segmentation: true, sample: true })

describe("amostra do período: localização impossível por volume, análise autorizada pela estratégia", () => {
  it("analisa uma amostra determinística (assunto com mais chamadas primeiro, depois os demais) e os padrões viram OBSERVAÇÃO do período no brief", async () => {
    const { investigate, memory, fake, calls } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: ON })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.logicVersion).toBe(INDICATOR_INVESTIGATION_LOGIC_VERSION)
    // Estratégia: até 5 chamadas, mínimo 3. Ordem: as 3 de Contestação, depois o rodízio Troca de plano → Troca de titularidade.
    expect(investigation.tools!.periodSample).toMatchObject({ version: "PERIOD_SAMPLE_V1", gap: "PERIOD_VOLUME", status: "SAMPLED", universe: 7, minimumAnalyzed: 3, target: 5, already: 0, requested: 5, analyzedNow: 5, topSubject: SUBJECTS.CONTESTACAO })
    expect(Object.fromEntries(investigation.tools!.periodSample!.subjects.map((subject) => [subject.key, subject.picked]))).toEqual({ CONTESTACAO: 3, PLANO: 1, TITULAR: 1 })
    const analyzed = analyzedInteractionIds(await memory.currentMemory(ORG, { personIds: [PERSON], interactionIds: calls.map((call) => call.id) }), CALL_ANALYSIS_LOGIC_VERSION)
    expect([...analyzed].sort()).toEqual([callOf("CONTESTACAO", 0), callOf("CONTESTACAO", 1), callOf("CONTESTACAO", 2), callOf("PLANO", 0), callOf("TITULAR", 0)].map((call) => call.id).sort())
    expect(analysesOf(fake.calls)).toBe(5)
    expect(investigation.budget).toMatchObject({ maxCallAnalyses: 5, callAnalyses: 5 })
    expect(investigation.tools!.ledger.find((entry) => entry.question === "CALLS:PERIOD")).toMatchObject({ tool: "analyze_calls", via: "CONTRACT", status: "OK" })

    // UMA evidência do período (não uma por assunto), não localizada, com o denominador de chamadas com transcrição.
    expect(investigation.evidence).toHaveLength(1)
    const period = investigation.evidence[0]!
    expect(period).toMatchObject({ focusReason: "UNLOCATED", sampleBasis: "PERIOD_SAMPLE", segmentKey: "PERIOD", universe: 7, analyzedCalls: 5, newlyAnalyzed: 5, reusedCalls: 0 })
    expect(period.periodSubjects).toEqual(expect.arrayContaining([{ key: "CONTESTACAO", label: SUBJECTS.CONTESTACAO, universe: 3, analyzed: 3 }, { key: "PLANO", label: SUBJECTS.PLANO, universe: 2, analyzed: 1 }, { key: "TITULAR", label: SUBJECTS.TITULAR, universe: 2, analyzed: 1 }]))
    expect(period.sampleNote).toContain("não explica a variação do indicador")
    const development = period.patterns.find((pattern) => pattern.classification === "DEVELOPMENT_PATTERN")
    expect(development).toBeDefined()

    // Observação nunca vira causa: a conclusão não é "padrão sustentado", e o brief não cria ponto de desenvolvimento a partir dela.
    expect(investigation.conclusion).not.toBe("PATTERN_SUPPORTED")
    expect(investigation.questions.find((question) => question.id === "CALLS")).toMatchObject({ answered: true })
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: true })
    expect(brief.developments).toEqual([])
    expect(brief.context.some((line) => /^Nas chamadas analisadas do período, a etapa “.+” não foi cumprida em \d+ de \d+ em que se aplicava \(não foi possível ligar isso à variação do indicador\)\.$/.test(line))).toBe(true)
    expect(brief.limitations).toContain(ATTRIBUTION_LIMIT)
    expect(brief.readerNotes).toContain(ATTRIBUTION_LIMIT)
    // A tabela de assuntos mostra quantas chamadas de cada assunto foram lidas.
    expect(brief.subjects?.rows.find((row) => row.key === "PLANO")?.analyzed).toEqual({ calls: 1, universe: 2 })
  })

  it("plano do CONTRATO (estratégia em modo fixo): a mesma amostra; com pares LIGADOS, a referência vale para o assunto escolhido pela amostra", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: strategyWith({ segmentation: true, sample: true, peers: true, fixed: true }), peers: true })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.plan).toBe("CONTRACT")
    expect(investigation.tools!.periodSample).toMatchObject({ status: "SAMPLED", requested: 5 })
    expect(investigation.tools!.ledger.find((entry) => entry.tool === "reference_practices")).toMatchObject({ via: "CONTRACT", status: "OK", requestedArgs: { subject: "CONTESTACAO" } })
    expect(investigation.reference).toMatchObject({ segmentKey: "CONTESTACAO" })
    // Análise de colegas: só com a comparação autorizada, no orçamento PRÓPRIO (nunca tira a amostra da pessoa).
    expect(investigation.budget.peerCallAnalyses).toBeGreaterThan(0)
    expect(investigation.budget.peerCallAnalyses).toBeLessThanOrEqual(investigation.budget.maxPeerCallAnalyses!)
    expect(investigation.budget.callAnalyses).toBe(5)
    expect(analysesOf(fake.calls)).toBe(5 + investigation.budget.peerCallAnalyses!)
  })

  it("dia fora do padrão que o plano do contrato não examina continua NÃO EXAMINADO, mesmo com a amostra do período analisada", async () => {
    const { investigate, memory } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: strategyWith({ segmentation: true, sample: true, fixed: true }), daily: DAILY_WITH_PEAK })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "SAMPLED", requested: 5 })
    const day = investigation.evidence.find((entry) => entry.focusReason === "ATYPICAL_DAY")
    expect(day).toMatchObject({ analyzedCalls: 0 })
    expect(investigation.evidence.find((entry) => entry.sampleBasis === "PERIOD_SAMPLE")).toMatchObject({ analyzedCalls: 5 })
    // As 5 chamadas da amostra descrevem o período; não fazem do dia que piorou um recorte "examinado sem causa".
    expect(investigation.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
    expect(investigation.questions.find((question) => question.id === "CALLS")).toMatchObject({ answered: false })
  })

  it("pares DESLIGADOS na estratégia: a amostra da pessoa acontece, mas nenhuma consulta nem análise de colega", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: strategyWith({ segmentation: true, sample: true, peers: false, fixed: true }), peers: true })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "SAMPLED", requested: 5 })
    expect(investigation.tools!.ledger.some((entry) => entry.tool === "reference_practices")).toBe(false)
    expect(investigation.budget.peerCallAnalyses ?? 0).toBe(0)
    expect(analysesOf(fake.calls)).toBe(5)
  })
})

describe("amostra do período: comportamento sem autorização permanece o mesmo", () => {
  it("SEM estratégia publicada: nenhuma chamada é listada nem analisada; a memória por assunto (`UNLOCATED_MEMORY_V2`) continua como antes", async () => {
    const { investigate, analyze, memory, fake, listed } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: null })
    // Memória que já existia (monitoria das chamadas de Contestação).
    for (const index of [0, 1, 2]) await analyzeCall(analyze, { organizationId: ORG, interactionId: callOf("CONTESTACAO", index).id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    const before = analysesOf(fake.calls)
    listed.length = 0
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(analysesOf(fake.calls)).toBe(before)
    expect(investigation.budget.callAnalyses).toBe(0)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "NOT_ALLOWED", universe: null, requested: 0, reason: "sem estratégia de diagnóstico publicada: nenhuma chamada é analisada pelo contrato" })
    // Só a leitura da memória existente (a mesma consulta por assunto de antes) — nenhuma amostra.
    expect(listed).toEqual(["CONTESTACAO"])
    expect(investigation.evidence).toHaveLength(1)
    expect(investigation.evidence[0]).toMatchObject({ focusReason: "UNLOCATED", sampleBasis: "EXISTING_MEMORY", segmentKey: "CONTESTACAO", analyzedCalls: 3, newlyAnalyzed: 0 })
    expect(investigation.evidence.some((entry) => entry.sampleBasis === "PERIOD_SAMPLE")).toBe(false)
  })

  it("SEM estratégia e sem memória: evidência vazia, nenhuma análise (como antes)", async () => {
    const { investigate, memory, fake, listed } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: null })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.evidence).toEqual([])
    expect(analysesOf(fake.calls)).toBe(0)
    expect(listed).toEqual([])
    expect(investigation.limitations.some((limitation) => limitation.includes("amostra"))).toBe(false)
  })

  it("estratégia com a avaliação de chamadas DESLIGADA: não autorizado, nada analisado", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: strategyWith({ segmentation: true, sample: false }) })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "NOT_ALLOWED", reason: "avaliação de chamadas desligada na estratégia" })
    expect(analysesOf(fake.calls)).toBe(0)
  })

  it("Workflow restringe a análise de chamadas: não autorizado", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: ON })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request({ allowedCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION"] }))).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "NOT_ALLOWED", reason: "o Workflow restringiu a análise de chamadas nesta execução" })
    expect(analysesOf(fake.calls)).toBe(0)
  })

  it("assunto LOCALIZADO (volume suficiente): nenhuma amostra do período — o recorte localizado segue como sempre", async () => {
    const { investigate, memory } = setup({ subjects: "LOCATED", strategy: ON })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toBeUndefined()
    expect(investigation.evidence.some((entry) => entry.sampleBasis === "PERIOD_SAMPLE")).toBe(false)
  })

  it("abaixo do mínimo da estratégia em chamadas com transcrição: nada analisado, limitação dita", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 1, PLANO: 1 }, strategy: ON })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "BELOW_MINIMUM", universe: 2, minimumAnalyzed: 3, requested: 0 })
    expect(analysesOf(fake.calls)).toBe(0)
    expect(investigation.evidence).toEqual([])
    expect(investigation.limitations.some((limitation) => limitation.includes("abaixo do mínimo de 3 da estratégia"))).toBe(true)
  })
})

describe("amostra do período: orçamento", () => {
  it("teto de análises da execução: só o espaço que sobra é analisado", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: ON, maxCallAnalyses: 2 })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "SAMPLED", target: 5, requested: 2, analyzedNow: 2 })
    expect(investigation.budget).toMatchObject({ maxCallAnalyses: 2, callAnalyses: 2 })
    expect(analysesOf(fake.calls)).toBe(2)
    expect(investigation.evidence[0]).toMatchObject({ sampleBasis: "PERIOD_SAMPLE", analyzedCalls: 2, universe: 7 })
  })

  it("teto de consultas da investigação: a amostra não roda e o motivo fica registrado", async () => {
    const { investigate, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: ON, maxToolCalls: 0 })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "TOOL_BUDGET", requested: 0 })
    expect(analysesOf(fake.calls)).toBe(0)
    expect(investigation.limitations.some((limitation) => limitation.includes("limite de consultas da investigação"))).toBe(true)
  })

  it("orçamento de IA da execução acaba no meio da amostra: para ali, registrado como tal", async () => {
    const fake = fakeEngineModel()
    let analyses = 0
    const model: EngineModelPort = {
      async generate(request) {
        if (request.stage === "CALL_ANALYSIS" && ++analyses > 2) throw new EngineBudgetExhaustedError("COST", "CALL_ANALYSIS")
        return fake.model.generate(request)
      },
    }
    const { investigate, memory } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: ON, model })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "MODEL_BUDGET", requested: 5 })
    expect(analysesOf(fake.calls)).toBe(2)
    expect(investigation.evidence[0]).toMatchObject({ sampleBasis: "PERIOD_SAMPLE", analyzedCalls: 2 })
    expect(investigation.limitations).toContain("O orçamento de IA da execução acabou antes de todas as análises pedidas.")
  })

  it("memória já cobre a amostra: nenhuma análise nova (reaproveitada, sem custo)", async () => {
    const { investigate, analyze, memory, fake } = build({ counts: { CONTESTACAO: 3, PLANO: 2, TITULAR: 2 }, strategy: ON })
    for (const call of [callOf("CONTESTACAO", 0), callOf("CONTESTACAO", 1), callOf("PLANO", 0), callOf("PLANO", 1), callOf("TITULAR", 1)]) await analyzeCall(analyze, { organizationId: ORG, interactionId: call.id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    const before = analysesOf(fake.calls)
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(analysesOf(fake.calls)).toBe(before)
    expect(investigation.tools!.periodSample).toMatchObject({ status: "MEMORY_SUFFICIENT", already: 5, requested: 0 })
    expect(investigation.evidence[0]).toMatchObject({ sampleBasis: "PERIOD_SAMPLE", analyzedCalls: 5, newlyAnalyzed: 0, reusedCalls: 5 })
  })
})

describe("amostra do período: funções puras", () => {
  const segment = (key: string, current: number, previous: number, sufficient: boolean): SegmentComparison => ({ key, label: key, current: current > 0 ? { n: current, value: 400 } : null, previous: previous > 0 ? { n: previous, value: 400 } : null, shareCurrent: 0, sharePrevious: 0, withinContribution: null, mixContribution: null, change: null, relativeChange: null, changeDirection: "UNKNOWN", sufficient })
  const overall = (current: number, previous: number) => ({ current: { n: current, value: 400 }, previous: { n: previous, value: 400 }, change: 0, direction: "STABLE" as const })

  it("lacuna de localização por volume: período, assunto, ou nenhuma", () => {
    expect(localizationVolumeGapOf({ segments: [segment("A", 14, 8, true)], overall: overall(14, 8), focus: [], minimumPerSegment: 3 })).toBe("PERIOD_VOLUME")
    expect(localizationVolumeGapOf({ segments: [segment("A", 6, 6, true), segment("B", 6, 6, true)], overall: overall(12, 12), focus: [], minimumPerSegment: 3 })).toBeNull()
    expect(localizationVolumeGapOf({ segments: [segment("A", 2, 2, false), segment("B", 2, 2, false), segment("C", 2, 2, false), segment("D", 2, 2, false), segment("E", 2, 2, false)], overall: overall(10, 10), focus: [], minimumPerSegment: 3 })).toBe("SUBJECT_VOLUME")
    expect(localizationVolumeGapOf({ segments: [segment("A", 5, 4, true)], overall: overall(5, 4), focus: [{ key: "A", label: "A", reason: "DETERIORATED" }], minimumPerSegment: 3 })).toBeNull()
    expect(localizationVolumeGapOf({ segments: [], overall: { current: null, previous: null, change: null, direction: "UNKNOWN" }, focus: [], minimumPerSegment: 3 })).toBeNull()
  })

  it("ordem determinística, memória conta na amostra, espaço do orçamento respeitado", () => {
    const subjects = [
      { key: "B", label: "B", calls: [{ id: "b1" }, { id: "b2" }] },
      { key: "A", label: "A", calls: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] },
      { key: "C", label: "C", calls: [{ id: "c1" }, { id: "c2" }] },
      { key: "Z", label: "Z", calls: [] },
    ]
    const plan = periodSampleOf({ subjects, analyzed: new Set(), target: 6, room: 10 })
    expect(plan.pick.map((entry) => entry.id)).toEqual(["a1", "a2", "a3", "b1", "c1", "b2"])
    expect(plan).toMatchObject({ universe: 7, target: 6, already: 0, topSubject: { key: "A", label: "A" } })
    // A mesma entrada = a mesma amostra (nunca sorteio).
    expect(periodSampleOf({ subjects: [...subjects].reverse(), analyzed: new Set(), target: 6, room: 10 }).pick).toEqual(plan.pick)
    const withMemory = periodSampleOf({ subjects, analyzed: new Set(["a2", "c2"]), target: 5, room: 10 })
    expect(withMemory).toMatchObject({ already: 2 })
    expect(withMemory.pick.map((entry) => entry.id)).toEqual(["a1", "a3", "b1"])
    expect(periodSampleOf({ subjects, analyzed: new Set(), target: 6, room: 2 }).pick.map((entry) => entry.id)).toEqual(["a1", "a2"])
    expect(periodSampleOf({ subjects, analyzed: new Set(["a1", "a2", "a3", "b1", "c1"]), target: 5, room: 10 }).pick).toEqual([])
    expect(periodSampleOf({ subjects: [{ key: "A", label: "A", calls: [{ id: "x" }] }, { key: "B", label: "B", calls: [{ id: "x" }] }], analyzed: new Set(), target: 5, room: 5 })).toMatchObject({ universe: 1, target: 1 })
  })
})
