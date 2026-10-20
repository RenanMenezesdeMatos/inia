import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  KNOWLEDGE_CLARIFICATION_VERSION,
  applyStepAnswer,
  clarificationStateOfToolCalls,
  describeStepAnswer,
  focusDocumentIdsOf,
  optionIdFor,
  parseClarificationState,
  scenarioOf,
  stepIdFor,
  type ClarificationState,
  type ClarificationStep,
} from "./clarification-state.js"
import { toClarificationView } from "./clarification-view.js"
import { TEST_KNOWLEDGE_BASES } from "../testing/clarification-fixtures.js"

/** Estado fictício, só para este teste. */
const source = (documentId: string, chunkIndex = 0) => ({ documentId, documentTitle: `Base ${documentId}`, versionId: `${documentId}-v1`, heading: `Seção ${chunkIndex}`, chunkIndex })
function makeStep(position: number, dimension: string, labels: string[], selectionMode: "SINGLE" | "MULTIPLE" = "SINGLE"): ClarificationStep {
  return { id: stepIdFor(position, dimension), dimension, question: `Qual ${dimension.toLowerCase()}?`, selectionMode, options: labels.map((label, index) => ({ id: optionIdFor(dimension, label), label, description: null, group: null, evidence: [source(`kb-${dimension}-${index}`)] })), answer: null }
}
const NOW = new Date("2026-10-20T12:00:00.000Z")
function makeState(steps: ClarificationStep[]): ClarificationState {
  return { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "11111111-1111-4111-8111-111111111111", originalQuestion: "Pergunta de teste", status: "OPEN", steps, questionFacts: [{ dimension: "Assunto", value: "teste" }], coverage: { consideredDocuments: 3, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: NOW.toISOString() }
}
const answer = (step: ClarificationStep, labels: string[], extra: Partial<{ freeText: string; noneMatched: boolean; revise: boolean }> = {}) => ({ stepId: step.id, optionIds: step.options.filter((option) => labels.includes(option.label)).map((option) => option.id), freeText: extra.freeText, noneMatched: extra.noneMatched ?? false, revise: extra.revise ?? false })

describe("estado do esclarecimento — escolhas, correções e ids", () => {
  it("ids estáveis: a mesma dimensão/rótulo (normalizados) gera o mesmo id; posição distingue a etapa", () => {
    expect(optionIdFor("Tipo X", "Opção Á")).toBe(optionIdFor("tipo x", "opcao a"))
    expect(optionIdFor("Tipo X", "Opção A")).not.toBe(optionIdFor("Tipo Y", "Opção A"))
    expect(stepIdFor(1, "Tipo X")).toMatch(/^step_1_[a-f0-9]{8}$/)
    expect(stepIdFor(2, "Tipo X")).not.toBe(stepIdFor(1, "Tipo X"))
  })

  it("responder a etapa aberta grava a escolha e o cenário acumula (pergunta + escolhas + complemento)", () => {
    const first = makeStep(1, "Público", ["Grupo 1", "Grupo 2"])
    const state = applyStepAnswer(makeState([first]), answer(first, ["Grupo 1"], { freeText: "com urgência" }), "FORM", NOW)
    expect(state.steps[0]!.answer).toMatchObject({ via: "FORM", freeText: "com urgência", noneMatched: false })
    expect(scenarioOf(state)).toEqual([
      { dimension: "Assunto", value: "teste", origin: "QUESTION", stepId: null },
      { dimension: "Público", value: "Grupo 1", origin: "SELECTION", stepId: first.id },
      { dimension: "Público (complemento)", value: "com urgência", origin: "TEXT", stepId: first.id },
    ])
    expect(focusDocumentIdsOf(state)).toEqual(["kb-Público-0"])
  })

  it("validações da escolha: opção de outra etapa, duas numa seleção única, nada escolhido, 'nenhuma' sem descrição ou junto de opção", () => {
    const first = makeStep(1, "Público", ["Grupo 1", "Grupo 2"])
    const state = makeState([first])
    const expectInvalid = (fn: () => unknown) => expect(fn).toThrowError(DomainError)
    expectInvalid(() => applyStepAnswer(state, { ...answer(first, []), optionIds: ["opt_0000000000"] }, "FORM", NOW))
    expectInvalid(() => applyStepAnswer(state, answer(first, ["Grupo 1", "Grupo 2"]), "FORM", NOW))
    expectInvalid(() => applyStepAnswer(state, answer(first, []), "FORM", NOW))
    expectInvalid(() => applyStepAnswer(state, answer(first, [], { noneMatched: true }), "FORM", NOW))
    expectInvalid(() => applyStepAnswer(state, answer(first, ["Grupo 1"], { noneMatched: true, freeText: "x" }), "FORM", NOW))
    // Nenhuma corresponde + descrição: válido.
    expect(applyStepAnswer(state, answer(first, [], { noneMatched: true, freeText: "um caso diferente" }), "FORM", NOW).steps[0]!.answer!.noneMatched).toBe(true)
  })

  it("seleção múltipla aceita várias opções", () => {
    const first = makeStep(1, "Itens", ["Item 1", "Item 2", "Item 3"], "MULTIPLE")
    const state = applyStepAnswer(makeState([first]), answer(first, ["Item 1", "Item 3"]), "FORM", NOW)
    expect(scenarioOf(state).find((fact) => fact.origin === "SELECTION")!.value).toBe("Item 1 + Item 3")
  })

  it("etapa já respondida só muda por CORREÇÃO, que descarta as etapas seguintes (elas dependiam da escolha)", () => {
    const first = makeStep(1, "Público", ["Grupo 1", "Grupo 2"])
    const second = makeStep(2, "Relação", ["R1", "R2"])
    let state = applyStepAnswer(makeState([first]), answer(first, ["Grupo 1"]), "FORM", NOW)
    state = { ...state, steps: [...state.steps, second] }
    state = applyStepAnswer(state, answer(second, ["R2"]), "FORM", NOW)
    state = { ...state, status: "ANSWERED", sources: [source("kb-final")] }
    expect(() => applyStepAnswer(state, answer(first, ["Grupo 2"]), "FORM", NOW)).toThrowError(/Alterar/)
    const revised = applyStepAnswer(state, answer(first, ["Grupo 2"], { revise: true }), "FORM", NOW)
    expect(revised.steps).toHaveLength(1)
    expect(revised.steps[0]!.answer!.optionIds).toEqual([first.options[1]!.id])
    expect(revised).toMatchObject({ status: "OPEN", sources: [], conflicts: [], notice: null })
  })

  it("texto legível da escolha (a mensagem gravada na conversa)", () => {
    const first = makeStep(1, "Público", ["Grupo 1", "Grupo 2"])
    expect(describeStepAnswer(first, { optionIds: [first.options[0]!.id], freeText: null, noneMatched: false })).toBe("Grupo 1")
    expect(describeStepAnswer(first, { optionIds: [], freeText: "caso X", noneMatched: true })).toBe("Nenhuma das opções corresponde ao meu caso — caso X")
  })

  it("estado gravado inválido (outra versão, corrompido) é ignorado, nunca quebra a tela", () => {
    const valid = makeState([makeStep(1, "Público", ["Grupo 1", "Grupo 2"])])
    expect(parseClarificationState(valid)).toEqual(valid)
    expect(parseClarificationState({ ...valid, version: "OUTRA" })).toBeNull()
    expect(clarificationStateOfToolCalls([{ toolName: "knowledge_clarification", state: valid }])).toEqual(valid)
    expect(clarificationStateOfToolCalls([{ toolName: "outra", state: valid }])).toBeNull()
  })

  it("visão para quem lê: fonte de base sem acesso vai sem título nem seção", () => {
    const first = makeStep(1, "Público", ["Grupo 1", "Grupo 2"])
    const view = toClarificationView(makeState([first]), new Set(["kb-Público-0"]))
    expect(view.steps[0]!.options[0]!.evidence[0]).toMatchObject({ available: true, documentTitle: "Base kb-Público-0" })
    expect(view.steps[0]!.options[1]!.evidence[0]).toMatchObject({ available: false, documentTitle: "", heading: "" })
    expect(view.scenario[0]).toMatchObject({ dimension: "Assunto", origin: "QUESTION" })
  })
})

describe("geração dinâmica — nenhuma regra de negócio nem regra de palavras no código de produção", () => {
  const root = join(__dirname, "..", "..")
  const productionFiles = [
    ...readdirSync(join(root, "knowledge-clarification"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)),
    join(root, "knowledge", "domain", "knowledge-catalog.ts"),
    join(root, "knowledge", "application", "knowledge-catalog.ts"),
  ].filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && !relative(root, path).split(/[\\/]/).includes("testing"))
  /** Quem usa o esclarecimento (chat e voz no roteador; consulta de processo de quem lidera) também não conhece conteúdo. */
  const callerFiles = [join(root, "realtime", "presentation", "realtime-router.ts"), join(root, "leadership-analytics", "application", "process-consultation.ts")]

  it("os nomes das bases fictícias dos testes não aparecem no código de produção do esclarecimento, do catálogo nem de quem os usa", () => {
    const terms = ["LP de Dados", "FWT", "SIP", "banda larga", "titularidade", "linha básica", "Residencial", "PJ para PJ", "Sucessão empresarial", "Falecimento", ...TEST_KNOWLEDGE_BASES.map((base) => base.title)]
    const offenders = [...productionFiles, ...callerFiles].flatMap((path) => {
      const text = readFileSync(path, "utf8").toLowerCase()
      return terms.filter((term) => text.includes(term.toLowerCase())).map((term) => `${relative(root, path)}: ${term}`)
    })
    expect(productionFiles.length).toBeGreaterThan(6)
    expect(offenders).toEqual([])
  })

  it("nada de busca por palavra: sem busca lexical, tokenização, ranqueamento, listas de palavras nem detecção de siglas", () => {
    const forbidden = ["lexical-retrieval", "query-acronyms", "tokenize(", "rankChunks", "documentAnchors", "STOPWORDS", "QUESTION_FILLERS", "expandAcronyms", "meaningfulQueryTerms"]
    const offenders = [...productionFiles, ...callerFiles].flatMap((path) => {
      const text = readFileSync(path, "utf8")
      return forbidden.filter((term) => text.includes(term)).map((term) => `${relative(root, path)}: ${term}`)
    })
    expect(offenders).toEqual([])
  })
})
