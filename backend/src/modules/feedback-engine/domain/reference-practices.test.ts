import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { compositionPayloadOf, verificationFactsOf } from "./composition-prompt.js"
import { localViolationsOf, repairInstructionsOf, usefulnessOf } from "./composition.js"
import { groundingTextsOf } from "./feedback-brief.js"
import { buildIndicatorBrief } from "./indicator-brief.js"
import { criterionPatternsOf, onePerInteraction, referencePracticesOf, type IndicatorInvestigation, type MemoryRow, type ReferenceGroup } from "./indicator-investigation.js"
import { INDICATOR_INVESTIGATION_LOGIC_VERSION } from "./versions.js"
import type { IndicatorSignal } from "../infrastructure/postgres-indicator-data.js"

/**
 * BOAS PRÁTICAS DOS COLEGAS (`PRACTICE_ANCHOR_V1`, `REFERENCE_GROUP_V2`, `REFERENCE_PRACTICES_V1`) — sem IA.
 *
 * Origem: sonda sem custo de 02/10/2026 sobre a memória real do TMA de agosto/2026 da Larissa. Cada análise junta as linhas de uma
 * obrigação do seu jeito ("validar o titular" + CPF; + nome completo…) e a identidade da obrigação muda junto: 159 leituras dos colegas
 * de melhor resultado viraram ZERO práticas com os mínimos. Pela linha-âncora (a primeira linha da regra, identidade da base), as mesmas
 * leituras dão 5 práticas — e as boas práticas dos colegas passam a chegar ao feedback do indicador como fatos agregados (P-n).
 */
const row = (interactionId: string, personId: string, status: MemoryRow["status"], obligationKey: string, practiceKey: string | undefined, text = "Antes de consultar o detalhamento, o operador deverá validar o titular.\n- CPF ou CNPJ;"): MemoryRow => ({ interactionId, personId, criterionKey: obligationKey, ...(practiceKey ? { practiceKey } : {}), documentId: "doc", documentTitle: "Procedimento Operacional — Contestação de Contas Móvel", heading: "7. Validação de segurança", text, status, localDate: "2026-08-10", evidence: [], rationale: null, guidance: null, materiality: "HIGH" })

describe("PRACTICE_ANCHOR_V1 — a mesma prática não se espalha entre identidades de obrigação", () => {
  const reference = [
    row("r1", "a", "MET", "KC-obr000000001", "KC-anchor000001"),
    row("r2", "b", "MET", "KC-obr000000002", "KC-anchor000001", "Antes de consultar o detalhamento, o operador deverá validar o titular.\n- Nome completo;"),
    row("r3", "c", "MET", "KC-obr000000003", "KC-anchor000001"),
    row("r4", "d", "MET", "KC-obr000000004", "KC-anchor000001"),
    row("r5", "e", "NOT_MET", "KC-obr000000005", "KC-anchor000001"),
  ]
  const person = criterionPatternsOf([row("p1", "me", "MET", "KC-obr000000009", "KC-anchor000001"), row("p2", "me", "MET", "KC-obr00000000a", "KC-anchor000001")])

  it("agrupa pela âncora: 5 leituras de 5 obrigações diferentes formam UMA prática com os mínimos", () => {
    const practices = referencePracticesOf(reference, person)
    expect(practices).toHaveLength(1)
    expect(practices[0]).toMatchObject({ criterionKey: "KC-anchor000001", reference: { eligible: 5, met: 4, contributors: 5 }, person: { eligible: 2, met: 2 }, contrast: "BOTH_FOLLOW" })
  })

  it("sem âncora (memória antiga), continua pela identidade da obrigação — e então não há prática com os mínimos", () => {
    expect(referencePracticesOf(reference.map((entry) => {
      const rest = { ...entry }
      delete rest.practiceKey
      return rest
    }), criterionPatternsOf([row("p1", "me", "MET", "KC-obr000000009", undefined)]))).toEqual([])
  })

  it("uma leitura por chamada em cada prática: duas obrigações da mesma chamada na mesma âncora contam uma vez, a mais grave", () => {
    const rows = [row("i1", "me", "MET", "KC-x1", "KC-anchor"), row("i1", "me", "PARTIAL", "KC-x2", "KC-anchor"), row("i2", "me", "MET", "KC-x3", "KC-anchor")]
    expect(onePerInteraction(rows).map((entry) => `${entry.interactionId}:${entry.status}`).sort()).toEqual(["i1:PARTIAL", "i2:MET"])
    expect(criterionPatternsOf(rows)[0]).toMatchObject({ criterionKey: "KC-anchor", eligible: 2, met: 1, partial: 1 })
  })

  it("os mínimos da estratégia só endurecem (nunca abaixo do produto)", () => {
    expect(referencePracticesOf(reference, person, { contributors: 6 })).toEqual([])
    expect(referencePracticesOf(reference, person, { assessments: 2, contributors: 1 })).toHaveLength(1)
  })
})

describe("contrastes do grupo de referência", () => {
  const groupRows = (status: MemoryRow["status"], key = "KC-anchor") => ["a", "b", "c", "d", "e"].map((personId, index) => row(`r${index}`, personId, status, `KC-o${index}`, key))

  it("REFERENCE_ONLY: o grupo cumpre e a pessoa não tem avaliação — boa prática, nunca falta dela", () => {
    expect(referencePracticesOf(groupRows("MET"), [])[0]).toMatchObject({ contrast: "REFERENCE_ONLY", person: null })
  })

  it("REFERENCE_ALSO_MISSES: a pessoa não cumpre e o grupo de melhor resultado também quase nunca cumpre", () => {
    const person = criterionPatternsOf(["p1", "p2", "p3"].map((id) => row(id, "me", "PARTIAL", `KC-p${id}`, "KC-anchor")))
    expect(referencePracticesOf(groupRows("PARTIAL"), person)[0]).toMatchObject({ contrast: "REFERENCE_ALSO_MISSES", person: { eligible: 3, notMet: 3 } })
  })

  it("nada a dizer (grupo dividido, pessoa sem avaliação) não vira prática", () => {
    const rows = [...groupRows("MET").slice(0, 3), ...groupRows("NOT_MET").slice(3)]
    expect(referencePracticesOf(rows, [])).toEqual([])
  })
})

describe("REFERENCE_PRACTICES_V1 — boas práticas dos colegas no feedback do indicador", () => {
  const practice = (contrast: ReferenceGroup["practices"][number]["contrast"], person: ReferenceGroup["practices"][number]["person"], key: string, heading: string) => ({ criterionKey: key, text: "Depois, confirmar o entendimento:\n“Entendi. … Está correto?”", heading, documentTitle: "Procedimento Operacional — Contestação de Contas Móvel", reference: { eligible: 6, met: 6, contributors: 6 }, person, contrast })
  const investigation = (practices: ReferenceGroup["practices"]): IndicatorInvestigation => ({
    logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION,
    official: { indicatorId: "i", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "c", value: 357, target: 400, withinTarget: true, gapToTarget: null, periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "agosto/2026", referencePeriod: "2026-08", previous: { value: 382, periodLabel: "julho/2026", withinTarget: true }, movement: "IMPROVED", quartile: "Q1", previousQuartile: "Q2" },
    localization: { proxy: { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação" }, windows: { current: { start: "2026-08-01", end: "2026-08-31", label: "01/08 a 31/08" }, previous: { start: "2026-07-01", end: "2026-07-31", label: "01/07 a 31/07" } }, overall: { current: null, previous: null, change: null, direction: "UNKNOWN" }, officialAgreement: "UNKNOWN", decomposition: null, segments: [], daily: { available: false, points: [], outliers: [], weekdays: [] }, focus: [], limitations: [] },
    evidence: [],
    reference: { basis: "OVERALL_INDICATOR", segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", population: 267, members: 67, practices, limitations: [] },
    questions: [],
    conclusion: "RESULT_RECOGNITION",
    limitations: [],
    budget: { maxCallAnalyses: 0, callAnalyses: 0, reusedCalls: 0, stoppedBy: null },
    strategy: { versionId: "s", configured: true },
    teamId: null,
    subteamId: null,
  })
  const brief = buildIndicatorBrief(investigation([
    practice("BOTH_FOLLOW", { eligible: 4, met: 4, notMet: 0 }, "KC-a", "47. Confirmação de entendimento"),
    practice("REFERENCE_ONLY", null, "KC-b", "6. Escuta e identificação da solicitação"),
    practice("INSUFFICIENT", { eligible: 1, met: 0, notMet: 1 }, "KC-c", "1. Abertura"),
  ]), { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })

  it("as práticas viram fatos agregados P-n, sem nomes, com o grupo descrito pela regra de escolha", () => {
    expect(brief.referencePractices?.map((entry) => [entry.ref, entry.title, entry.contrast])).toEqual([["P1", "Escuta e identificação da solicitação", "REFERENCE_ONLY"], ["P2", "Confirmação de entendimento", "BOTH_FOLLOW"]])
    // Quantos colegas CONTRIBUÍRAM (6), nunca o tamanho do grupo (67) como se todos tivessem chamadas avaliadas.
    expect(brief.referencePractices?.[0]?.group).toBe("Entre os colegas com melhor resultado oficial de Tempo Médio de Atendimento em agosto/2026, nas chamadas já analisadas de 6 deles do assunto Contestação de cobrança em que essa etapa se aplicava, ela foi cumprida em 6 de 6.")
    expect(brief.referencePractices?.some((entry) => entry.group.includes("67"))).toBe(false)
    expect(brief.referencePractices?.[0]?.you).toBeNull()
    expect(brief.referencePractices?.[1]?.you).toBe("Nas suas chamadas analisadas do período, em 4 de 4.")
  })

  it("chegam ao redator e ao verificador como fatos; os números entram no lastro do texto", () => {
    expect(compositionPayloadOf(brief).facts).toHaveProperty("referencePractices")
    expect(verificationFactsOf(brief)).toHaveProperty("referencePractices")
    const grounding = groundingTextsOf(brief).join("\n")
    expect(localViolationsOf({ text: "Entre os colegas com melhor resultado, essa confirmação aparece em 6 de 6 chamadas.", stance: "GUIDANCE", refs: ["P1"] }, brief, grounding)).toEqual([])
  })

  it("P-n vale para orientação e contexto, nunca como reconhecimento; o código P1 nunca aparece no texto", () => {
    expect(localViolationsOf({ text: "Você confirma o entendimento como o grupo.", stance: "RECOGNITION", refs: ["P2"] }, brief, "")).toContain("STANCE_REF_MISMATCH")
    expect(localViolationsOf({ text: "Veja P1 para mais detalhes.", stance: "CONTEXT", refs: ["P1"] }, brief, "")).toContain("INTERNAL_REFERENCE")
    expect(localViolationsOf({ text: "Vale reforçar a escuta.", stance: "GUIDANCE", refs: ["P9"] }, brief, "")).toContain("UNKNOWN_REF")
  })
})

describe("REFERENCE_STEP_V1 + REFERENCE_GROUP_V2 — a comparação com os colegas é um passo, não uma escolha do planejador", () => {
  it("com pares ligados e resultado bom (nenhuma pergunta leva à referência), o grupo é consultado sem modelo; sem grupo por assunto, vale o resultado oficial", async () => {
    const { setup, improved, strategyWith, request, investigationOf } = await import("../testing/investigation-world.js")
    const { investigateIndicator } = await import("../application/investigate-indicator.js")
    const unavailable = { generate: async () => { throw new Error("modelo indisponível nesta prova") } }
    const built = setup({ official: improved, subjects: "IMPROVED", strategy: strategyWith({ segmentation: true, sample: true, peers: true }), model: unavailable as never, maxCallAnalyses: 0 })
    const peers = ["q1", "q2", "q3", "q4", "q5"]
    Object.assign(built.investigate.data, { teamPeers: async () => peers, peerOfficialValues: async () => peers.map((personId, index) => ({ personId, value: 300 + index * 10 })) })
    const result = await investigateIndicator(built.investigate, request())
    const investigation = await investigationOf(built.memory, result.investigations[0]!.runId)
    const step = investigation.tools!.ledger.find((entry) => entry.tool === "reference_practices")
    expect(step).toMatchObject({ via: "CONTRACT", status: "OK", question: "REFERENCE" })
    // V3: o grupo tem pelo menos os 4 colegas que a estratégia exige para comparar.
    expect(investigation.reference).toMatchObject({ basis: "OVERALL_INDICATOR", members: 4, practices: [] })
    expect(investigation.reference!.limitations.join(" ")).toContain("pequeno demais")
  })
})

describe("rodada real V13, cenário C — resultado bom não pode virar 'só o número'", () => {
  const base = (conclusion: IndicatorInvestigation["conclusion"]): IndicatorInvestigation => ({
    logicVersion: INDICATOR_INVESTIGATION_LOGIC_VERSION,
    official: { indicatorId: "i", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "c", value: 357, target: 400, withinTarget: true, gapToTarget: null, periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "agosto/2026", referencePeriod: "2026-08", previous: { value: 382, periodLabel: "julho/2026", withinTarget: true }, movement: "IMPROVED", quartile: "Q1", previousQuartile: "Q2" },
    localization: { proxy: { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação" }, windows: { current: { start: "2026-08-01", end: "2026-08-31", label: "01/08 a 31/08" }, previous: { start: "2026-07-01", end: "2026-07-31", label: "01/07 a 31/07" } }, overall: { current: null, previous: null, change: null, direction: "UNKNOWN" }, officialAgreement: "UNKNOWN", decomposition: null, segments: [], daily: { available: false, points: [], outliers: [], weekdays: [] }, focus: [], limitations: [] },
    evidence: [
      { segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", focusReason: "UNLOCATED", universe: 10, analyzedCalls: 5, reusedCalls: 5, newlyAnalyzed: 0, sampleBasis: "EXISTING_MEMORY", sampleNote: "5 de 10 chamadas já tinham análise.", pathIncorrect: 0, pathAssessed: 0, patterns: [{ criterionKey: "KC-conf", documentId: "doc", documentTitle: "Procedimento", heading: "47. Confirmação de entendimento", text: "Perguntar:\n- “As informações ficaram claras?”", eligible: 5, met: 5, notMet: 0, partial: 0, inconclusive: 0, notApplicable: 0, classification: "STRENGTH_PATTERN", reevaluated: 0, examples: [], currentRule: "IN_FORCE" }] },
      { segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", scope: "Nas chamadas do recorte dia 04/08", focusReason: "ATYPICAL_DAY", universe: 1, analyzedCalls: 1, reusedCalls: 0, newlyAnalyzed: 1, sampleBasis: "TEMPORAL", sampleNote: "1 de 1 chamada do dia 04/08 analisada.", pathIncorrect: 0, pathAssessed: 0, patterns: [] },
    ],
    reference: { basis: "OVERALL_INDICATOR", segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", population: 267, members: 67, practices: [{ criterionKey: "KC-escuta", text: "Depois, confirmar o entendimento:\n“Entendi. … Está correto?”", heading: "6. Escuta e identificação da solicitação", documentTitle: "Procedimento", reference: { eligible: 6, met: 6, contributors: 6 }, person: null, contrast: "REFERENCE_ONLY" }], limitations: [] },
    questions: [],
    conclusion,
    limitations: [],
    budget: { maxCallAnalyses: 2, callAnalyses: 1, reusedCalls: 5, stoppedBy: null },
    strategy: { versionId: "s", configured: true },
    teamId: null,
    subteamId: null,
  })

  it("STRENGTH_WITH_GOOD_RESULT_V1: a conduta consistente continua no brief mesmo com o dia 04/08 examinado (conclusão sem causa)", () => {
    const brief = buildIndicatorBrief(base("CHANGE_LOCATED_NO_CAUSE"), { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(brief.strengths.map((finding) => finding.title)).toEqual(["Resultado de Tempo Médio de Atendimento", "Confirmação de entendimento"])
  })

  it("mensagem sem nenhuma prática dos colegas que orienta: lacuna de utilidade com o pedido de reescrita (não bloqueia a mensagem)", () => {
    const brief = buildIndicatorBrief(base("CHANGE_LOCATED_NO_CAUSE"), { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    const onlyNumber = [{ stance: "RECOGNITION" as const, refs: ["S1"], verdict: { id: "F1", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null, addsInformation: null } }]
    const usefulness = usefulnessOf(brief, onlyNumber, null)
    expect(usefulness).toMatchObject({ primaryCovered: true, missingPractice: ["P1"] })
    expect(repairInstructionsOf([], usefulness, brief).join(" ")).toContain("P1")
    const withPractice = [...onlyNumber, { stance: "GUIDANCE" as const, refs: ["P1"], verdict: { id: "F2", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null, addsInformation: null } }]
    expect(usefulnessOf(brief, withPractice, null).missingPractice).toBeUndefined()
  })
})

describe("REFERENCE_GROUP_V3 + REFERENCE_DURATION_V1 — o grupo pelo resultado oficial também analisa chamadas dos colegas", () => {
  it("analisa, na ordem do resultado, colegas COM chamada no assunto (pula quem não tem), com orçamento próprio; duração no assunto pessoa × grupo", async () => {
    const { setup, improved, strategyWith, request, investigationOf, PERSON, ORG } = await import("../testing/investigation-world.js")
    const { investigateIndicator } = await import("../application/investigate-indicator.js")
    const { TRANSCRIPT } = await import("../testing/fixtures.js")
    // Pessoa sem nenhuma análise própria nesta execução (maxCallAnalyses 0): só as análises de colegas, à parte, podem acontecer.
    const built = setup({ official: improved, subjects: "IMPROVED", strategy: strategyWith({ segmentation: true, sample: true, peers: true }), maxCallAnalyses: 0 })
    const peers = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]
    const callsOf = (member: string) => (member === "q1" ? [] : [1, 2].map((index) => `00000000-0000-4000-8000-0000000c${member.slice(1)}0${index}`.slice(0, 36)))
    const asked: string[] = []
    const ownRows = built.investigate.data.segmentRows.bind(built.investigate.data)
    Object.assign(built.investigate.data, {
      teamPeers: async () => peers,
      peerOfficialValues: async () => peers.map((personId, index) => ({ personId, value: 300 + index * 10 })),
      segmentRows: async (org: string, personIds: readonly string[], window: { start: Date }, flags: IndicatorSignal) => {
        if (personIds.includes(PERSON)) return ownRows(org, personIds, window as never, flags)
        return personIds.filter((id) => id !== "q1").map((personId) => ({ personId, key: "CONTESTACAO", n: 2, avgDuration: 400, signaled: 0 }))
      },
      segmentInteractions: async (_org: string, member: string) => {
        asked.push(member)
        return member === PERSON ? [] : callsOf(member).map((id, index) => ({ id, startedAt: new Date(`2026-08-1${index}T13:00:00Z`), durationSeconds: 400, signaled: false }))
      },
    })
    Object.assign(built.analyze, {
      loadInteraction: async (_org: string, id: string) => {
        const owner = peers.find((member) => callsOf(member).includes(id))
        return owner ? { id, organizationId: ORG, operatorId: owner, operatorName: "Colega", startedAt: new Date("2026-08-11T13:00:00Z"), endedAt: new Date("2026-08-11T13:06:40Z"), reason: "Contestação de cobrança", channel: "VOICE", subjectCanonical: { code: "CONTESTACAO", name: "Contestação de cobrança" }, flags: [], transcript: { content: TRANSCRIPT, checksum: `t-${id}` }, teamId: "team-1", subteamId: "sub-1", supervisorId: null, timeZone: "America/Sao_Paulo" } : null
      },
    })
    const result = await investigateIndicator(built.investigate, request())
    const investigation = await investigationOf(built.memory, result.investigations[0]!.runId)
    expect(investigation.reference?.basis).toBe("OVERALL_INDICATOR")
    // q1 (melhor resultado) não tem chamada no assunto: perguntado e pulado; em LARGURA, uma chamada de cada colega antes da segunda.
    expect(asked.slice(0, 4)).toEqual(["q1", "q2", "q3", "q4"])
    expect(new Set(asked).size).toBe(asked.length)
    expect(investigation.budget.callAnalyses).toBe(0)
    expect(investigation.budget.peerCallAnalyses).toBeGreaterThan(0)
    expect(investigation.budget.peerCallAnalyses).toBeLessThanOrEqual(6)
    expect(investigation.reference!.limitations.join(" ")).not.toContain("nenhuma chamada de colega foi analisada")
    // Grupo = os 4 de melhor resultado (a estratégia exige 4 colegas); q1 sem chamada no assunto → 3 com duração registrada.
    expect(investigation.reference!.members).toBe(4)
    expect(investigation.reference!.durationComparison).toEqual({ personAverage: 330, personCalls: 10, referenceAverage: 400, referenceCalls: 6, contributors: 3 })
  })

  it("comparação de duração: menos de 3 colegas com chamadas no assunto não vira fato", async () => {
    const { durationComparisonOf } = await import("./indicator-investigation.js")
    expect(durationComparisonOf({ avgDuration: 700, n: 10 }, [{ avgDuration: 400, n: 2 }, { avgDuration: 420, n: 2 }])).toBeNull()
    expect(durationComparisonOf({ avgDuration: 700.4, n: 10 }, [{ avgDuration: 400, n: 2 }, { avgDuration: 420, n: 2 }, { avgDuration: 380, n: 1 }, { avgDuration: null, n: 0 }])).toEqual({ personAverage: 700, personCalls: 10, referenceAverage: 404, referenceCalls: 5, contributors: 3 })
  })
})

describe("cobertura da referência POR PRÁTICA (rodada real V14: prazo com 4 de 5 avaliações no grupo)", () => {
  it("conta uma leitura determinada por chamada da prática e quantos colegas contribuíram", async () => {
    const { practiceCoverageOf } = await import("./indicator-investigation.js")
    const row = (interactionId: string, personId: string, status: string, practiceKey = "KC-prazo") => ({ interactionId, personId, status, practiceKey, criterionKey: `${practiceKey}#${interactionId}` }) as never
    const rows = [row("c1", "p1", "MET"), row("c1", "p1", "NOT_MET"), row("c2", "p2", "MET"), row("c3", "p3", "NOT_OBSERVABLE"), row("c4", "p3", "MET"), row("c5", "p4", "MET", "KC-outra")]
    expect(practiceCoverageOf(rows, "KC-prazo")).toEqual({ eligible: 3, contributors: 3 })
  })
})

describe("validação V14C: 'os colegas cumprem e você não' vira prática P-n mesmo sendo ponto de desenvolvimento", () => {
  it("a prática fica entre as P-n (pedida na reescrita se não usada) e não repete como número anexo do ponto", async () => {
    const { buildIndicatorBrief } = await import("./indicator-brief.js")
    const base = JSON.parse(JSON.stringify(investigationFixture())) as import("./indicator-investigation.js").IndicatorInvestigation
    const brief = buildIndicatorBrief(base, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    const point = brief.developments.find((finding) => finding.criterionKeys.includes("KC-conf"))!
    expect(point).toBeDefined()
    expect(point.stats.join(" ")).not.toMatch(/cumprida em 6 de 6/)
    const practice = (brief.referencePractices ?? []).find((entry) => entry.contrast === "REFERENCE_FOLLOWS_PERSON_MISSES")!
    expect(practice.group).toMatch(/6 de 6/)
    expect(practice.you).toMatch(/1 de 4/)
  })
})

function investigationFixture() {
  const pattern = { criterionKey: "KC-conf", documentId: "d1", documentTitle: "Procedimento", heading: "47. Confirmação de entendimento", text: "Perguntar:\n- “As informações ficaram claras?”", eligible: 4, met: 1, notMet: 3, partial: 0, inconclusive: 0, notApplicable: 0, classification: "DEVELOPMENT_PATTERN" as const, examples: [] }
  return {
    logicVersion: "INDICATOR_INVESTIGATION_V12",
    official: { indicatorId: "i", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", sourceKind: "OFFICIAL_CLOSING", sourceRef: "c", value: 452, target: 400, withinTarget: false, gapToTarget: 52, periodStart: "2026-09-01", periodEnd: "2026-09-30", periodLabel: "setembro/2026", referencePeriod: "2026-09", previous: { value: 357, periodLabel: "agosto/2026", withinTarget: true }, movement: "WORSENED", quartile: "Q3", previousQuartile: "Q1" },
    localization: { proxy: { kind: "DURATION_SECONDS", label: "a duração média registrada das chamadas", description: "aproximação" }, windows: { current: { label: "setembro/2026" }, previous: { label: "agosto/2026" } }, overall: { current: null, previous: null, change: null, direction: "UNKNOWN" }, segments: [], focus: [{ key: "contestacao", label: "Contestação de cobrança", reason: "DETERIORATED" }], decomposition: null, daily: { outliers: [] }, limitations: [] },
    evidence: [{ segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", focusReason: "DETERIORATED", universe: 11, analyzedCalls: 6, reusedCalls: 0, newlyAnalyzed: 6, sampleBasis: "LONGEST_DURATION", sampleNote: "6 de 11 chamadas têm análise.", patterns: [pattern], pathIncorrect: 0, pathAssessed: 0 }],
    reference: { basis: "OVERALL_INDICATOR", segmentKey: "contestacao", segmentLabel: "Contestação de cobrança", population: 32, members: 8, limitations: [], practices: [{ criterionKey: "KC-conf", documentId: "d1", documentTitle: "Procedimento", heading: "47. Confirmação de entendimento", text: pattern.text, reference: { eligible: 6, met: 6, contributors: 6 }, person: { eligible: 4, met: 1, notMet: 3 }, contrast: "REFERENCE_FOLLOWS_PERSON_MISSES" }] },
    conclusion: "PATTERN_SUPPORTED",
    limitations: [],
    strategy: {},
  } as never
}
