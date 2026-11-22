import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { analyzeCall, type AnalyzeCallDeps } from "./analyze-call.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { resolveOperationalAlignments, type AlignmentCandidate, type AlignmentSubject } from "../../operational-alignments/domain/operational-alignment.js"
import { verificationRecordOf } from "../infrastructure/postgres-feedback-memory-store.js"

/**
 * ALINHAMENTO OPERACIONAL NA MONITORIA — caminho completo com modelo falso (zero IA): a base oficial da Ouvidoria manda ENVIAR a fatura;
 * o alinhamento do Grupo Ouvidoria (B2C, 10/11 a 30/11/2026) manda orientar o App Meu Telnova ou o site. Comprova contratos e execução
 * (o que chega ao modelo, a precedência aplicada por código, o que a memória guarda), nunca a qualidade de um modelo real.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const INTERACTION = "00000000-0000-4000-8000-0000000000c1"
const DOC = "00000000-0000-4000-8000-0000000000d1"
const OUVIDORIA = "11111111-1111-4111-8111-111111111111"
const OUTRO_GRUPO = "33333333-3333-4333-8333-333333333333"

const PROCEDURE = `# PR — Envio de fatura

## 1. Validação

- Confirmar o nome completo do titular.

## 2. Atendimento da solicitação

- Enviar a fatura ao cliente pelo e-mail cadastrado quando ele solicitar.
`

const TRANSCRIPT = [
  "Operador: Ouvidoria, bom dia. Com quem eu falo?",
  "Cliente: É a Marina. Preciso da minha fatura.",
  "Operador: Marina, me confirma seu nome completo?",
  "Cliente: Marina Souza Prado.",
  "Operador: Obrigada. Você consegue ver e baixar a fatura agora pelo App Meu Telnova ou pelo site, na área de faturas.",
  "Cliente: Ah, tá bom, vou olhar no app.",
].join("\n")

const ALIGNMENT: AlignmentCandidate = {
  alignmentId: "aaaaaaaa-0000-4000-8000-000000000001",
  versionId: "bbbbbbbb-0000-4000-8000-000000000001",
  version: 1,
  title: "Fatura pelo App Meu Telnova ou site",
  guidance: "Oriente o cliente a acessar a fatura pelo App Meu Telnova ou pelo site.\nNão envie a fatura por e-mail durante a vigência.",
  justification: "Envio de fatura suspenso na Ouvidoria enquanto o sistema de envio é substituído.",
  affectedDocuments: [{ id: DOC, title: "PR — Envio de fatura" }],
  affectedTopic: "Envio da fatura quando o cliente solicita",
  operatingUniverse: "B2C",
  scopeType: "GROUPS",
  links: [{ teamId: OUVIDORIA, teamName: "Ouvidoria", subteamId: null, subteamName: null }],
  productId: null,
  productName: null,
  startsOn: "2026-11-10",
  endsOn: "2026-11-30",
  timeZone: "America/Sao_Paulo",
  effectiveFrom: new Date("2026-11-10T03:00:00Z"),
  effectiveUntil: new Date("2026-12-01T03:00:00Z"),
  endedEarlyAt: null,
  contentHash: "hash-v1",
  publishedAt: new Date("2026-11-09T18:00:00Z"),
  relations: [],
}

function setup(input: { callAt: Date; teamId?: string; withAlignmentLoader?: boolean; alignment?: AlignmentCandidate; analysis: (handle: (text: string) => string) => unknown }) {
  const fake = fakeEngineModel({ analysis: input.analysis })
  const stores = createInMemoryFeedbackMemoryStore()
  const subject: AlignmentSubject = { teamId: input.teamId ?? OUVIDORIA, subteamId: null, operatingUniverse: "B2C", universeEnforced: true }
  const deps: AnalyzeCallDeps = {
    memory: stores,
    model: fake.model,
    loadInteraction: async (_org, id) => (id === INTERACTION ? { id: INTERACTION, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: input.callAt, endedAt: new Date(input.callAt.getTime() + 240_000), reason: "Fatura", channel: "VOICE", subjectCanonical: null, flags: [], transcript: { content: TRANSCRIPT, checksum: "tx" }, teamId: input.teamId ?? OUVIDORIA, subteamId: null, supervisorId: null, timeZone: "America/Sao_Paulo" } : null),
    loadAgent: async () => ({ id: AGENT, name: "Especialista Ouvidoria", objective: "Avaliar atendimento da Ouvidoria", contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [{ documentId: DOC, title: "PR — Envio de fatura", version: 3, content: PROCEDURE, contentHash: "pr3", perspective: "RULE_IN_FORCE_AT_CALL" }],
    loadPreviousVersion: async () => null,
    // A MESMA regra pura do produto (`resolveOperationalAlignments`), com a data do ATENDIMENTO que o motor passa.
    ...(input.withAlignmentLoader === false ? {} : { loadOperationalAlignments: async (_org: string, _person: string, at: Date, documentIds: readonly string[]) => resolveOperationalAlignments([input.alignment ?? ALIGNMENT], subject, at, new Set(documentIds)) }),
    // Monitoria/reprocessamento DEPOIS do término do alinhamento.
    now: () => new Date("2026-12-05T12:00:00Z"),
  }
  return { fake, stores, deps }
}

const handleIn = (calls: { stage: string; contents: { text: string }[] }[]) => (text: string) => {
  const prompt = calls.find((call) => call.stage === "CALL_ANALYSIS")!.contents[0]!.text
  return new RegExp(`\\[(L\\d+)\\] [^\\n]*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(prompt)?.[1] ?? "L0"
}

const obligation = (id: string, sources: string[], action: string, finding: string, evidence: { turn: string; speaker: string; quote: string }[], opportunityTurn: string | null = null) => ({
  id, sources, action, condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding,
  evidence: evidence.map((quote) => ({ ...quote, role: "CONDUCT" })), opportunityTurn, materiality: "HIGH", role: "CENTRAL", rationale: action, guidance: finding === "NOT_MET" ? { moment: "Quando a cliente pediu a fatura", action: "Enviar a fatura por e-mail." } : null,
})
const NAME = { turn: "T3", speaker: "OPERADOR", quote: "me confirma seu nome completo?" }
const APP = { turn: "T5", speaker: "OPERADOR", quote: "Você consegue ver e baixar a fatura agora pelo App Meu Telnova ou pelo site" }

/** Leitura com o alinhamento: o trecho oficial conflita com o alinhamento (declarado em sourceConflicts) e a conduta é julgada por ele. */
const analysisWithAlignment = (handle: (text: string) => string) => ({
  need: { summary: "A cliente quer a fatura.", conditions: [] },
  sources: { primary: "D1", related: ["A1"], rationale: "PR de fatura com o alinhamento vigente." },
  argumentScripts: [],
  obligations: [
    obligation("OBL-1", [handle("Confirmar o nome completo")], "Confirmar o nome completo", "MET", [NAME]),
    obligation("OBL-2", [handle("Oriente o cliente a acessar a fatura")], "Orientar o App Meu Telnova ou o site", "MET", [APP]),
    // Mesmo que a leitura ainda proponha a falha pela regra oficial, o código não a deixa valer: o trecho foi substituído.
    obligation("OBL-3", [handle("Enviar a fatura ao cliente")], "Enviar a fatura por e-mail", "NOT_MET", [], "T5"),
  ],
  notAssessed: [],
  conduct: { pathTaken: "Validou o nome e orientou o app/site.", assessment: "CORRECT", rationale: "Seguiu o alinhamento." },
  sourceConflicts: [{ lines: [handle("Enviar a fatura ao cliente"), handle("Oriente o cliente a acessar a fatura")], description: "O PR manda enviar; o alinhamento manda orientar o app/site." }],
  limitations: [],
})

/** Leitura sem alinhamento (antes do início, fora do escopo): só o procedimento oficial — não enviou a fatura. */
const officialAnalysis = (handle: (text: string) => string) => ({
  need: { summary: "A cliente quer a fatura.", conditions: [] },
  sources: { primary: "D1", related: [], rationale: "PR de fatura." },
  argumentScripts: [],
  obligations: [
    obligation("OBL-1", [handle("Confirmar o nome completo")], "Confirmar o nome completo", "MET", [NAME]),
    obligation("OBL-3", [handle("Enviar a fatura ao cliente")], "Enviar a fatura por e-mail", "NOT_MET", [], "T5"),
  ],
  notAssessed: [],
  conduct: { pathTaken: "Validou o nome e orientou o app/site.", assessment: "PARTIALLY_CORRECT", rationale: "Não enviou a fatura." },
  sourceConflicts: [],
  limitations: [],
})

const request = () => ({ organizationId: ORG, interactionId: INTERACTION, collaboratorId: OPERATOR, agentId: AGENT, trigger: { kind: "EVALUATION" as const, selectionReason: "teste" } })

describe("alinhamento operacional na monitoria (cenário da Ouvidoria)", () => {
  it("chamada durante a vigência, monitorada DEPOIS do término: seguir o alinhamento não é falha; o trecho oficial fica não aplicável com a referência", async () => {
    const holder: { handle?: (text: string) => string } = {}
    const { fake, stores, deps } = setup({ callAt: new Date("2026-11-20T15:00:00Z"), analysis: (handle) => analysisWithAlignment(holder.handle ?? handle) })
    holder.handle = handleIn(fake.calls)
    const result = await analyzeCall(deps, request())
    const analysisCall = fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!
    expect(analysisCall.systemPrompt).toContain("ALINHAMENTOS OPERACIONAIS (A-n")
    expect(analysisCall.contents[0]!.text).toContain("=== A1 · Alinhamento operacional \"Fatura pelo App Meu Telnova ou site\" (AO-AAAAAAAA v1 · vigente de 10/11/2026 a 30/11/2026")
    // A revisão recebe o alinhamento e as instruções dele.
    const review = fake.calls.find((call) => call.stage === "CALL_REVIEW")!
    expect(review.systemPrompt).toContain("ALINHAMENTOS OPERACIONAIS (A-n")
    expect(review.contents[0]!.text).toContain("=== A1 · Alinhamento operacional")

    const criteria = result.assessment!.analysis.criteria
    const byAction = (text: string) => criteria.find((criterion) => criterion.text.includes(text))!
    const sent = byAction("Enviar a fatura ao cliente")
    expect(sent).toMatchObject({ status: "NOT_APPLICABLE", ruleConflict: true, operationalAlignment: { role: "SUPERSEDED", alignmentId: ALIGNMENT.alignmentId, versionId: ALIGNMENT.versionId, reference: "AO-AAAAAAAA v1" } })
    expect(sent.downgrades).toContain("SUPERSEDED_BY_OPERATIONAL_ALIGNMENT")
    expect(sent.rationale).toContain("AO-AAAAAAAA v1")
    const app = byAction("Oriente o cliente a acessar a fatura")
    expect(app).toMatchObject({ status: "MET", confirmation: "CONFIRMED", ruleConflict: false, operationalAlignment: { role: "GUIDANCE", versionId: ALIGNMENT.versionId } })
    // O resto do procedimento oficial continua valendo.
    expect(byAction("Confirmar o nome completo")).toMatchObject({ status: "MET", confirmation: "CONFIRMED" })
    expect(byAction("Confirmar o nome completo").operationalAlignment).toBeUndefined()
    // Nenhuma falha de processo por esse motivo.
    expect(criteria.filter((criterion) => criterion.status === "NOT_MET" || criterion.status === "PARTIAL")).toEqual([])
    // A versão usada fica registrada (proveniência → `call_assessments.operational_alignments`) e no critério.
    const run = await stores.getRun(ORG, result.runId)
    const used = (run!.provenance as { operationalAlignments: { versionId: string; reference: string; supersededCriteria: string[]; guidanceCriteria: string[] }[] }).operationalAlignments
    expect(used).toEqual([expect.objectContaining({ versionId: ALIGNMENT.versionId, reference: "AO-AAAAAAAA v1", supersededCriteria: [sent.lineHandle], guidanceCriteria: [app.lineHandle] })])
    // O trecho oficial substituído fica na fotografia também como LINHA (vale mesmo quando a leitura não cria obrigação para ela).
    expect((used[0] as unknown as { supersededLines: { text: string }[] }).supersededLines.map((line) => line.text)).toEqual([expect.stringContaining("Enviar a fatura ao cliente")])
    expect((run!.provenance as { operationalAlignmentRule: { referenceDate: string } }).operationalAlignmentRule.referenceDate).toBe("2026-11-20T15:00:00.000Z")
    expect(verificationRecordOf(sent)).toMatchObject({ operationalAlignment: { role: "SUPERSEDED", versionId: ALIGNMENT.versionId } })
  })

  it("chamada ANTES do início: vale o procedimento oficial — sem alinhamento no prompt, a falha pela regra oficial fica", async () => {
    const holder: { handle?: (text: string) => string } = {}
    const { fake, deps } = setup({ callAt: new Date("2026-11-05T15:00:00Z"), analysis: (handle) => officialAnalysis(holder.handle ?? handle) })
    holder.handle = handleIn(fake.calls)
    const result = await analyzeCall(deps, request())
    const analysisCall = fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!
    expect(analysisCall.systemPrompt).not.toContain("ALINHAMENTOS OPERACIONAIS")
    expect(analysisCall.contents[0]!.text).not.toContain("Alinhamento operacional")
    const sent = result.assessment!.analysis.criteria.find((criterion) => criterion.text.includes("Enviar a fatura"))!
    expect(sent.status).toBe("NOT_MET")
    expect(sent.operationalAlignment).toBeUndefined()
  })

  it("chamada DEPOIS do término e operador de outro Grupo: o procedimento oficial", async () => {
    for (const scenario of [{ callAt: new Date("2026-12-02T15:00:00Z") }, { callAt: new Date("2026-11-20T15:00:00Z"), teamId: OUTRO_GRUPO }]) {
      const holder: { handle?: (text: string) => string } = {}
      const { fake, deps } = setup({ ...scenario, analysis: (handle) => officialAnalysis(holder.handle ?? handle) })
      holder.handle = handleIn(fake.calls)
      await analyzeCall(deps, request())
      expect(fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!.contents[0]!.text).not.toContain("Alinhamento operacional")
    }
  })

  it("sem alinhamento aplicável, o pedido ao modelo é byte a byte o de antes (nenhuma análise anterior deixa de ser reaproveitada)", async () => {
    const prompts: string[] = []
    for (const withAlignmentLoader of [false, true]) {
      const holder: { handle?: (text: string) => string } = {}
      const { fake, deps } = setup({ callAt: new Date("2026-11-05T15:00:00Z"), withAlignmentLoader, analysis: (handle) => officialAnalysis(holder.handle ?? handle) })
      holder.handle = handleIn(fake.calls)
      await analyzeCall(deps, request())
      const call = fake.calls.find((entry) => entry.stage === "CALL_ANALYSIS")!
      prompts.push(`${call.systemPrompt}\n${call.contents[0]!.text}`)
    }
    expect(prompts[1]).toBe(prompts[0])
  })

  it("orientação NOVA (sem trecho da base): vale como obrigação do processo na vigência — cumprida ou não — e nada do oficial é superado", async () => {
    const novo: AlignmentCandidate = { ...ALIGNMENT, alignmentId: "aaaaaaaa-0000-4000-8000-000000000002", versionId: "bbbbbbbb-0000-4000-8000-000000000002", title: "Prazo de retorno da Ouvidoria", affectedTopic: null, guidance: "Informe ao cliente que a Ouvidoria retorna em até 48 horas." }
    const holder: { handle?: (text: string) => string } = {}
    const newInfo = (handle: (text: string) => string) => ({
      need: { summary: "A cliente quer a fatura.", conditions: [] },
      sources: { primary: "D1", related: ["A1"], rationale: "PR de fatura e o alinhamento novo." },
      argumentScripts: [],
      obligations: [
        obligation("OBL-1", [handle("Confirmar o nome completo")], "Confirmar o nome completo", "MET", [NAME]),
        obligation("OBL-2", [handle("Informe ao cliente que a Ouvidoria retorna")], "Informar o prazo de 48 horas", "NOT_MET", [], "T5"),
      ],
      notAssessed: [],
      conduct: { pathTaken: "Validou o nome e orientou o app/site.", assessment: "PARTIALLY_CORRECT", rationale: "Não informou o prazo novo." },
      sourceConflicts: [],
      limitations: [],
    })
    const { fake, deps } = setup({ callAt: new Date("2026-11-20T15:00:00Z"), alignment: novo, analysis: (handle) => newInfo(holder.handle ?? handle) })
    holder.handle = handleIn(fake.calls)
    const result = await analyzeCall(deps, request())
    const prompt = fake.calls.find((call) => call.stage === "CALL_ANALYSIS")!
    expect(prompt.contents[0]!.text).toContain("Sem trecho indicado: pode ser orientação nova")
    expect(prompt.systemPrompt).toContain("Pode trazer uma orientação NOVA")
    const criteria = result.assessment!.analysis.criteria
    const prazo = criteria.find((criterion) => criterion.text.includes("retorna em até 48 horas"))!
    expect(prazo).toMatchObject({ status: "NOT_MET", confirmation: "CONFIRMED", ruleConflict: false, operationalAlignment: { role: "GUIDANCE", versionId: novo.versionId } })
    expect(criteria.some((criterion) => criterion.operationalAlignment?.role === "SUPERSEDED")).toBe(false)
  })
})
