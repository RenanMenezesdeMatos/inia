import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { buildProcedureContext } from "../domain/procedure.js"
import { combinedObligationLinesOf, newPracticeKeyOf, type PracticeLine } from "../domain/practice-identity.js"
import {
  PRACTICE_THEMES_SYSTEM_PROMPT,
  SHORT_TITLE_MAX_CHARS,
  newThemeKeyOf,
  parsePracticeThemes,
  practiceThemesSchemaFor,
  renderPracticeThemesTurn,
  type CatalogTheme,
  type PracticeToTheme,
} from "../domain/practice-themes.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../infrastructure/overlay-feedback-memory-store.js"
import { fakeEngineModel, type PracticePayload, type ThemePayload } from "../testing/fake-engine-model.js"
import { ORG, PERSON } from "../testing/investigation-world.js"
import { EngineBudgetExhaustedError } from "./engine-meter.js"
import { organizePracticesOfAnalysis } from "./organize-practices.js"
import type { EngineModelRequest } from "./ports.js"
import { resolvePracticeThemes } from "./resolve-practice-themes.js"

/**
 * TEMAS (`PRACTICE_THEMES_V1`) e regras COMPOSTAS — zero IA. O tema e o nome curto são leitura do MODELO (aqui, falso); o código só
 * confere a forma (códigos de lista fechada, nome curto presente e curto) e registra. Nada é agrupado por palavra.
 */
const practice = (practiceKey: string, title: string): PracticeToTheme => ({ practiceKey, title, examples: [{ sourceTitle: "Contestação de conta", heading: "35. Prazo da análise", text: title }] })
const PRACTICES = [
  practice("KP-000000000001", "Informar o prazo da análise da contestação exibido na ferramenta"),
  practice("KP-000000000002", "Realizar a recapitulação dos lançamentos analisados e ações adotadas antes de encerrar o atendimento"),
  practice("KP-000000000003", "Validar o titular antes de acessar informações da conta"),
]
const answer = (body: unknown) => JSON.stringify(body)

describe("contrato do tema: o modelo escolhe numa lista fechada; o código confere a forma", () => {
  it("o pedido lista os temas conhecidos (T-n, com os pontos que já têm) e as práticas (P-n, com as regras); o esquema só aceita esses códigos", () => {
    const catalog: CatalogTheme[] = [{ themeKey: "KT-000000000001", title: "Encerramento do atendimento", points: ["Protocolo"] }]
    const turn = renderPracticeThemesTurn(catalog, PRACTICES)
    expect(turn).toContain('"ref": "T1"')
    expect(turn).toContain('"theme": "Encerramento do atendimento"')
    expect(turn).toContain('"ref": "P3"')
    expect(turn).toContain("Contestação de conta · 35. Prazo da análise")
    expect(renderPracticeThemesTurn(catalog, PRACTICES)).toBe(turn)
    const schema = practiceThemesSchemaFor(1, 2) as { properties: { assignments: { items: { properties: { practice: { enum: string[] }; theme: { enum: string[] } } } } } }
    expect(schema.properties.assignments.items.properties.practice.enum).toEqual(["P1", "P2"])
    expect(schema.properties.assignments.items.properties.theme.enum).toEqual(["T1", "N1", "N2"])
    // Nenhum tema fixo no prompt: os temas são dados da organização.
    expect(PRACTICE_THEMES_SYSTEM_PROMPT).not.toMatch(/Encerramento|Abertura|Segurança/)
  })

  it("práticas vão para um tema conhecido e para um tema novo; o nome curto fica limpo; tema novo tem chave da primeira prática", () => {
    const catalog: CatalogTheme[] = [{ themeKey: "KT-000000000001", title: "Encerramento do atendimento", points: [] }]
    const parsed = parsePracticeThemes(answer({
      assignments: [{ practice: "P1", theme: "N1", shortTitle: "  Prazo da   análise " }, { practice: "p2", theme: "t1", shortTitle: "Recapitulação" }, { practice: "P3", theme: "N2", shortTitle: "Validação do titular" }],
      newThemes: [{ ref: "N1", title: "Prazo e próximos passos" }, { ref: "N2", title: "Segurança" }],
    }), catalog, PRACTICES)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.result.themes).toEqual([{ themeKey: newThemeKeyOf("KP-000000000001"), title: "Prazo e próximos passos" }, { themeKey: newThemeKeyOf("KP-000000000003"), title: "Segurança" }])
    expect(parsed.result.assignments.map((entry) => [entry.practiceKey, entry.themeKey, entry.shortTitle, entry.basis])).toEqual([
      ["KP-000000000001", newThemeKeyOf("KP-000000000001"), "Prazo da análise", "NEW_THEME"],
      ["KP-000000000002", "KT-000000000001", "Recapitulação", "EXISTING_THEME"],
      ["KP-000000000003", newThemeKeyOf("KP-000000000003"), "Validação do titular", "NEW_THEME"],
    ])
    expect(parsed.result.unassigned).toEqual([])
  })

  it("o código NUNCA agrupa por texto: títulos quase iguais que o modelo pôs em temas diferentes continuam separados", () => {
    const twins = [practice("KP-0000000000a1", "Informar o prazo"), practice("KP-0000000000a2", "Informar o prazo")]
    const parsed = parsePracticeThemes(answer({ assignments: [{ practice: "P1", theme: "N1", shortTitle: "Prazo" }, { practice: "P2", theme: "N2", shortTitle: "Prazo" }], newThemes: [{ ref: "N1", title: "A" }, { ref: "N2", title: "B" }] }), [], twins)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(new Set(parsed.result.assignments.map((entry) => entry.themeKey)).size).toBe(2)
  })

  it("forma inválida não é consertada (nem cortada): prática ausente, duas respostas, tema inexistente, novo sem nome, nome curto vazio ou longo demais → fica sem tema", () => {
    const five = [...PRACTICES, practice("KP-000000000004", "Avisar antes de deixar o cliente em espera"), practice("KP-000000000005", "Registrar o protocolo")]
    const parsed = parsePracticeThemes(answer({
      assignments: [
        { practice: "P2", theme: "T1", shortTitle: "Recapitulação" }, { practice: "P2", theme: "N1", shortTitle: "Recapitulação" },
        { practice: "P3", theme: "T9", shortTitle: "Titular" },
        { practice: "P4", theme: "N2", shortTitle: "Espera" },
        { practice: "P5", theme: "N1", shortTitle: "x".repeat(SHORT_TITLE_MAX_CHARS + 1) },
      ],
      newThemes: [{ ref: "N1", title: "Encerramento" }],
    }), [{ themeKey: "KT-000000000001", title: "Encerramento", points: [] }], five)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.result.assignments).toEqual([])
    expect(parsed.result.unassigned.map((entry) => [entry.practiceKey, entry.reason])).toEqual([
      ["KP-000000000001", "MISSING"], ["KP-000000000002", "DUPLICATE"], ["KP-000000000003", "UNKNOWN_THEME"], ["KP-000000000004", "NEW_WITHOUT_TITLE"], ["KP-000000000005", "SHORT_TITLE_INVALID"],
    ])
    expect(parsePracticeThemes("{", [], PRACTICES)).toEqual({ ok: false, error: "INVALID_JSON" })
  })
})

describe("agrupar só o que ainda não tem tema (uma vez por prática)", () => {
  const seeded = async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const at = new Date("2026-10-05T12:00:00Z")
    for (const entry of PRACTICES) memory.practices.set(entry.practiceKey, { title: entry.title, createdAt: at })
    return memory
  }
  const world = (memory: ReturnType<typeof createInMemoryFeedbackMemoryStore>, themes?: (payload: ThemePayload) => unknown) => {
    const fake = fakeEngineModel(themes ? { themes } : {})
    const requests: EngineModelRequest[] = []
    return { requests, deps: { memory, now: () => new Date("2026-10-05T12:00:00Z"), call: (request: EngineModelRequest) => { requests.push(request); return fake.model.generate(request) } } }
  }

  it("1ª vez: um pedido, tudo agrupado; 2ª vez: nenhum pedido; prática nova: um pedido que já vê os temas e os pontos", async () => {
    const memory = await seeded()
    const run = world(memory)
    expect(await resolvePracticeThemes(run.deps, ORG, null)).toMatchObject({ status: "ORGANIZED", pending: 3, themed: 3, newThemes: 1, requests: 1 })
    expect(run.requests[0]!.stage).toBe("PRACTICE_THEMES")
    expect(await resolvePracticeThemes(run.deps, ORG, null)).toMatchObject({ status: "UP_TO_DATE", pending: 0, requests: 0 })
    memory.practices.set("KP-000000000009", { title: "Informar o canal de retorno", createdAt: new Date("2026-10-06T12:00:00Z") })
    expect(await resolvePracticeThemes(run.deps, ORG, ["KP-000000000009"])).toMatchObject({ pending: 1, themed: 1, newThemes: 0, requests: 1 })
    expect(run.requests[1]!.contents[0]!.text).toContain("TEMAS JÁ CONHECIDOS (1)")
    expect(run.requests[1]!.contents[0]!.text).toContain('"points": [')
    expect(memory.practices.get("KP-000000000009")).toMatchObject({ themeKey: memory.practices.get("KP-000000000001")!.themeKey, shortTitle: "Informar o canal de retorno" })
  })

  it("só as práticas pedidas; lista vazia = nenhum pedido", async () => {
    const memory = await seeded()
    const run = world(memory)
    expect(await resolvePracticeThemes(run.deps, ORG, [])).toMatchObject({ status: "UP_TO_DATE", requests: 0 })
    expect(await resolvePracticeThemes(run.deps, ORG, ["KP-000000000002"])).toMatchObject({ pending: 1, themed: 1 })
    expect(memory.practices.get("KP-000000000001")!.themeKey).toBeUndefined()
  })

  it("sem orçamento ou com resposta fora do contrato: nada é gravado e tudo volta na próxima vez", async () => {
    const memory = await seeded()
    expect(await resolvePracticeThemes({ memory, now: () => new Date(), call: async () => { throw new EngineBudgetExhaustedError("maxModelCalls", "PRACTICE_THEMES") } }, ORG, null)).toMatchObject({ status: "SKIPPED", stopReason: "BUDGET", themed: 0 })
    expect(await resolvePracticeThemes({ memory, now: () => new Date(), call: async () => ({ text: "{", model: "fake", usage: null, durationMs: 1, costUsd: null, finishReason: "STOP" }) }, ORG, null)).toMatchObject({ status: "SKIPPED", stopReason: "CONTRACT" })
    expect((await memory.practicesWithoutTheme(ORG, null)).length).toBe(3)
  })

  it("ensaio isolado (sobreposição): agrupa só as práticas que o ensaio criou; o catálogo de temas inclui os do banco", async () => {
    const base = await seeded()
    await resolvePracticeThemes(world(base).deps, ORG, null)
    const overlay = createInMemoryFeedbackMemoryStore()
    overlay.practices.set("KP-00000000000e", { title: "Avisar antes da espera", createdAt: new Date() })
    const stores = createOverlayFeedbackMemoryStore(base, overlay)
    const run = world(overlay)
    expect(await resolvePracticeThemes({ ...run.deps, memory: stores }, ORG, null)).toMatchObject({ pending: 1, themed: 1 })
    expect(run.requests[0]!.contents[0]!.text).toContain("TEMAS JÁ CONHECIDOS (1)")
    expect(overlay.practices.get("KP-00000000000e")!.themeKey).toBe(base.practices.get("KP-000000000001")!.themeKey)
  })
})

describe("obrigação COMPOSTA: várias linhas avaliadas juntas em que nenhuma pede conduta sozinha", () => {
  const source = { sourceKind: "KNOWLEDGE" as const, sourceId: "doc-1", sourceVersion: 1, sourceTitle: "Checklist de Encerramento" }
  const obligation = (lineKey: string, lineKeys: string[]) => ({ lineKey, lineKeys, text: "Antes de encerrar qualquer chamada:\n(1) confirme a solução aplicada;\n(2) informe o número do protocolo.", heading: "Checklist", source })
  const none = { practiceKey: null }

  it("só obrigação de várias linhas (chave com '#'), com TODAS as linhas já decididas sem conduta; uma vez por chave", () => {
    const decided = new Map<string, { practiceKey: string | null }>([["a", none], ["b", none], ["c", { practiceKey: "KP-000000000001" }]])
    const lines = combinedObligationLinesOf([obligation("a#1", ["a", "b"]), obligation("a#1", ["a", "b"]), obligation("a", ["a"]), obligation("a#2", ["a", "c"]), obligation("a#3", ["a", "z"])], decided)
    // a#1 = composta; "a" (uma linha) usa a decisão da linha; a#2 tem linha com conduta; a#3 espera a linha "z" ser organizada.
    expect(lines.map((entry: PracticeLine) => [entry.lineKey, entry.combined, entry.text.split("\n").length])).toEqual([["a#1", true, 3]])
    expect(combinedObligationLinesOf([obligation("a#1", ["a", "b"])], new Map([...decided, ["a#1", none]]))).toEqual([])
  })

  it("na análise: linhas sem conduta → a obrigação vai ao modelo como composta ('severalLines'); a prática dela ganha tema", async () => {
    const content = "# Checklist de Encerramento\n\n## Checklist\n\nAntes de encerrar qualquer chamada:\n(1) confirme a solução aplicada;\n(2) informe o número do protocolo.\n"
    const context = buildProcedureContext([{ documentId: "doc-1", title: "Checklist de Encerramento", version: 1, content, contentHash: "h", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 1 }])
    const lines = [...context.lines.values()]
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const criterion = { lineKey: `${lines[0]!.lineKey}#obrigacao`, sources: lines.map((entry) => ({ lineKey: entry.lineKey })), text: lines.map((entry) => entry.text).join("\n"), heading: "Checklist", documentId: "doc-1" }
    const memory = createInMemoryFeedbackMemoryStore()
    const sent: PracticePayload[] = []
    const fake = fakeEngineModel({ practices: (payload) => {
      sent.push(payload)
      return { assignments: payload.rules.map((rule) => ({ rule: rule.ref, practice: (rule as { severalLines?: boolean }).severalLines ? "N1" : "NONE" })), newPractices: [{ ref: "N1", title: "Cumprir o checklist de encerramento" }] }
    } })
    const deps = { memory, now: () => new Date("2026-10-05T12:00:00Z"), call: (request: EngineModelRequest) => fake.model.generate(request) }
    const first = await organizePracticesOfAnalysis(deps, ORG, context, [criterion])
    expect(first.lines).toMatchObject({ organized: lines.length, newPractices: 0 })
    expect(first.combined).toMatchObject({ status: "ORGANIZED", organized: 1, newPractices: 1 })
    expect(sent[1]!.rules).toEqual([expect.objectContaining({ rule: criterion.text, severalLines: true })])
    expect(first.themes).toMatchObject({ themed: 1 })
    const practiceKey = newPracticeKeyOf(criterion.lineKey)
    expect((await memory.practiceMemberships(ORG, [criterion.lineKey])).get(criterion.lineKey)).toMatchObject({ practiceKey })
    expect(memory.practices.get(practiceKey)).toMatchObject({ title: "Cumprir o checklist de encerramento", shortTitle: "Cumprir o checklist de encerramento" })
    // De novo: nada a organizar, nenhum pedido.
    const calls = fake.calls.length
    expect(await organizePracticesOfAnalysis(deps, ORG, context, [criterion])).toMatchObject({ lines: { status: "UP_TO_DATE" }, combined: null, themes: { status: "UP_TO_DATE", requests: 0 } })
    expect(fake.calls.length).toBe(calls)
  })

  it("a memória lê a prática da obrigação composta pela chave inteira, depois das linhas", async () => {
    const base = createInMemoryFeedbackMemoryStore()
    const overlay = createInMemoryFeedbackMemoryStore()
    const row = { callAssessmentId: "ca-1", segmentKey: null, interactionId: "i-1", personId: PERSON, criterionKey: "KC-0000000000bb", practiceKey: "KC-open", documentId: "doc-1", documentTitle: "Checklist", heading: "Checklist", text: "Antes de encerrar:\n(1) confirme a solução aplicada;", status: "NOT_MET" as const, localDate: "2026-09-10", evidence: [], rationale: null, guidance: null, materiality: "HIGH" as const, anchorLineKey: "open", obligationLineKey: "open#todos" }
    const assessment = { callAssessmentId: "ca-1", analysisRunId: "r-1", interactionId: "i-1", personId: PERSON, occurredAt: new Date("2026-09-10T12:00:00Z"), asOf: new Date("2026-09-10T12:00:00Z"), segmentKey: null, pathAssessment: null, outcome: "USABLE", logicVersion: null }
    const stub = { ...base, currentMemory: async () => ({ assessments: [assessment], criteria: [row] }) } as unknown as typeof base
    const stores = createOverlayFeedbackMemoryStore(stub, overlay)
    const practiceKey = newPracticeKeyOf("open#todos")
    const line = (lineKey: string, text: string, extra: Partial<PracticeLine> = {}): PracticeLine => ({ lineKey, ...source, heading: "Checklist", leadIn: null, text, ...extra })
    await overlay.savePracticeAssignments(ORG, { practices: [{ practiceKey, title: "Cumprir o checklist de encerramento" }], members: [{ line: line("open", "Antes de encerrar:"), practiceKey: null, basis: "NO_CONDUCT" }, { line: line("open#todos", row.text, { combined: true }), practiceKey, basis: "NEW_PRACTICE" }], unassigned: [] }, { identityVersion: "PRACTICE_IDENTITY_V1", model: "fake" }, new Date())
    const [read] = (await stores.currentMemory(ORG, { personIds: [PERSON] })).criteria
    expect(read).toMatchObject({ practiceKey, practiceTitle: "Cumprir o checklist de encerramento" })
  })
})
