import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { compositionViolations, narrativeBriefOf, resolveNarrative, SUPERVISOR_NARRATIVE_VERSION, type NarrativeDraft, type StoredNarrative } from "../domain/supervisor-narrative.js"
import { applyFactuality, factualityClaimsOf, type StoredFactuality, factualityPayloadOf, NARRATIVE_FACTUALITY_SYSTEM_PROMPT_V1, parseFactualityResponse } from "../domain/narrative-factuality.js"
import { SUPERVISOR_NARRATIVE_PROMPT_VERSION } from "../domain/supervisor-narrative-prompt.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import { FACTUALITY_CASES, factualityItem as item, factualityVerdictFor } from "../testing/narrative-factuality-cases.js"

/**
 * FEEDBACK EXPERIENCE V2.1 — FATUALIDADE SEMÂNTICA, NÃO LÉXICA. Quem decide se uma paráfrase acrescentou significado é a verificação
 * semântica (uma chamada; aqui um veredito fixo — o comportamento do modelo é medido em `scripts/dev/eval-narrative-factuality.ts`).
 * Estes testes provam o encanamento: nenhuma lista de palavras decide; frase recusada sai; sem veredito, nada do redator é entregue.
 */
const LABEL = "Atendimento de 29/09/2026 · Bloqueio por inadimplência"
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
type Sentence = NonNullable<NarrativeDraft["sentences"]>[number]
const draft = (sentences: [number, string, Sentence["stance"], string[]][], card = "", cardRefs: string[] = []): NarrativeDraft => {
  const list = sentences.map(([paragraph, text, stance, refs]) => ({ paragraph, text, stance, refs }))
  return { paragraphs: [...new Set(list.map((entry) => entry.paragraph))].map((number) => list.filter((entry) => entry.paragraph === number).map((entry) => entry.text).join(" ")), card, sentences: list, cardRefs }
}
const stored = (items: EmittedItem[], value: NarrativeDraft, factuality: StoredFactuality | null, promptVersion: string = SUPERVISOR_NARRATIVE_PROMPT_VERSION): StoredNarrative => ({ version: SUPERVISOR_NARRATIVE_VERSION, promptVersion, itemsKey: narrativeBriefOf(items, LABEL).itemsKey, draft: value, violations: { narrative: [], card: [] }, error: null, factuality })
const rejecting = (value: NarrativeDraft, text: RegExp) => factualityVerdictFor(value, (claim) => (text.test(claim.text) ? "UNSUPPORTED_ADDITION" : "SUPPORTED"))

const informe = () => [item("OPPORTUNITY", "Informe de pagamento", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.", ["É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você."])]
const mixed = () => [
  item("STRENGTH", "Reparo fixa", "Realizar os testes básicos antes de abrir reparo.", ["Desliga o modem da tomada e liga de novo.", "O cabo está bem encaixado?"]),
  item("OPPORTUNITY", "Promessas", "Não prometer desbloqueio imediato.", ["O desbloqueio é na hora."]),
]

describe("nenhuma lista de palavras decide a especificidade", () => {
  it("a camada determinística não conhece 'comprovante': a frase só cai pelo veredito semântico", () => {
    const items = informe()
    const value = draft([[1, "Você orientou o envio do comprovante pelo aplicativo sem checar se a opção estava disponível.", "ADJUSTMENT", ["A1"]]])
    expect(compositionViolations(value, narrativeBriefOf(items, LABEL), items, CONTEXT)).toEqual({ narrative: [], card: [] })
    const resolved = resolveNarrative(stored(items, value, rejecting(value, /comprovante/)), items, CONTEXT)
    expect(resolved.source.narrative).toBe("SYSTEM")
    expect(resolved.factualityRejected).toEqual([expect.objectContaining({ id: "F1", status: "UNSUPPORTED_ADDITION" })])
  })
  it("as listas léxicas de especificidade saíram do código (sem radical de objeto nem de grau)", () => {
    const sources = ["../domain/supervisor-narrative.ts", "../domain/suggested-response.ts", "../domain/narrative-factuality.ts"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    for (const source of sources) {
      expect(source).not.toMatch(/comprovant|integridad|DEGREE_UPGRADE|specificityUpgradesIn|unsupportedOperationalFactsIn/)
    }
  })
  it("os casos obrigatórios e os de vocabulário novo não aparecem no prompt do verificador (generalização, não memória)", () => {
    const prompt = NARRATIVE_FACTUALITY_SYSTEM_PROMPT_V1.toLowerCase()
    for (const word of ["comprovante", "integridade", "completo", "todos os testes", "aprovação", "firmware", "viabilidade", "ressarcimento", "transação", "pós-pago"]) expect(prompt).not.toContain(word)
    expect(FACTUALITY_CASES.filter((entry) => entry.group === "REQUIRED").map((entry) => entry.id)).toEqual(expect.arrayContaining(["A", "B", "C", "D", "E", "F", "G", "H"]))
    expect(FACTUALITY_CASES.filter((entry) => entry.group === "NOVEL").length).toBeGreaterThanOrEqual(5)
  })
})

describe("o veredito semântico aplicado à composição (sem reescrita, sem laço)", () => {
  it("frase recusada sai; o resto do texto do redator continua (o ajuste principal segue coberto)", () => {
    const items = mixed()
    const value = draft([[1, "Você fez um diagnóstico completo da conexão.", "STRENGTH", ["S1"]], [1, "Você pediu para reiniciar o modem e conferir o cabo.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]])
    const resolved = resolveNarrative(stored(items, value, rejecting(value, /completo/)), items, CONTEXT)
    expect(resolved.source.narrative).toBe("WRITER")
    expect(resolved.paragraphs.join(" ")).not.toMatch(/completo/)
    expect(resolved.paragraphs).toEqual(["Você pediu para reiniciar o modem e conferir o cabo.", "O ajuste é não prometer que o desbloqueio é na hora."])
  })
  it("se a frase recusada era a única com o ajuste principal, a narrativa inteira do SISTEMA assume", () => {
    const items = mixed()
    const value = draft([[1, "Você pediu para reiniciar o modem e conferir o cabo.", "STRENGTH", ["S1"]], [2, "Você prometeu desbloqueio na hora após o envio da segunda via.", "ADJUSTMENT", ["A1"]]])
    const resolved = resolveNarrative(stored(items, value, rejecting(value, /segunda via/)), items, CONTEXT)
    expect(resolved.source.narrative).toBe("SYSTEM")
    expect(resolved.violations.narrative).toEqual(expect.arrayContaining(["NARRATIVE_GAP_OMITTED", "NARRATIVE_FACTUALITY_REJECTED"]))
  })
  it("card recusado → card do sistema; a narrativa aceita continua do redator", () => {
    const items = mixed()
    const value = draft([[1, "Você pediu para reiniciar o modem e conferir o cabo.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]], "Não prometa desbloqueio imediato depois do pagamento via débito automático.", ["A1"])
    const resolved = resolveNarrative(stored(items, value, rejecting(value, /débito automático/)), items, CONTEXT)
    expect(resolved.source).toEqual({ narrative: "WRITER", card: "SYSTEM" })
    expect(resolved.violations.card).toContain("NARRATIVE_FACTUALITY_REJECTED")
  })
  it("sem veredito, verificação com erro ou texto diferente do verificado → nada do redator é entregue", () => {
    const items = mixed()
    const value = draft([[1, "Você pediu para reiniciar o modem e conferir o cabo.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]], "Não prometa desbloqueio imediato.", ["A1"])
    const other = draft([[1, "Você pediu para reiniciar o modem, conferir o cabo e trocar a fonte.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]], "Não prometa desbloqueio imediato.", ["A1"])
    for (const factuality of [null, { ...factualityVerdictFor(value), status: "ERROR" as const, verdicts: [], error: "FACTUALITY_TRANSPORT_ERROR:TimeoutError" }, factualityVerdictFor(other)]) {
      const resolved = resolveNarrative(stored(items, value, factuality), items, CONTEXT)
      expect(resolved.source).toEqual({ narrative: "SYSTEM", card: "SYSTEM" })
      expect(resolved.violations.narrative).toContain("NARRATIVE_FACTUALITY_UNVERIFIED")
    }
  })
  it("reparo ÚNICO na mesma verificação: a reescrita que só RETIRA o acréscimo substitui a frase; a que traz algo novo não vale", () => {
    const items = mixed()
    const value = draft([[1, "Você fez um diagnóstico completo, reiniciando o modem e conferindo o cabo.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]])
    const withRewrite = (rewrite: string) => ({ ...rejecting(value, /completo/), verdicts: rejecting(value, /completo/).verdicts.map((verdict) => (verdict.id === "F1" ? { ...verdict, supportedRewrite: rewrite } : verdict)) })
    const contained = resolveNarrative(stored(items, value, withRewrite("Você reiniciou o modem e conferiu o cabo.")), items, CONTEXT)
    expect(contained.paragraphs[0]).toBe("Você reiniciou o modem e conferiu o cabo.")
    expect(contained.factualityRepaired).toEqual([expect.objectContaining({ id: "F1" })])
    const added = resolveNarrative(stored(items, value, withRewrite("Você reiniciou o modem e trocou a fonte de alimentação.")), items, CONTEXT)
    expect(added.paragraphs).toEqual(["O ajuste é não prometer que o desbloqueio é na hora."])
    expect(added.factualityRejected).toEqual([expect.objectContaining({ id: "F1" })])
  })
  it("GENERALIZATION é aceita; CONTRADICTION e UNCERTAIN saem", () => {
    const value = draft([[1, "Você fez verificações de diagnóstico.", "STRENGTH", ["S1"]], [1, "Você verificou a fonte do modem.", "STRENGTH", ["S1"]], [1, "Você resolveu a falha.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]])
    const statuses: Record<string, "GENERALIZATION" | "UNCERTAIN" | "CONTRADICTION" | "SUPPORTED"> = { F1: "GENERALIZATION", F2: "UNCERTAIN", F3: "CONTRADICTION", F4: "SUPPORTED" }
    const applied = applyFactuality(value, factualityVerdictFor(value, (claim) => statuses[claim.id]!))
    expect(applied.draft.sentences!.map((sentence) => sentence.text)).toEqual(["Você fez verificações de diagnóstico.", "O ajuste é não prometer que o desbloqueio é na hora."])
    expect(applied.rejected.map((verdict) => verdict.status)).toEqual(["UNCERTAIN", "CONTRADICTION"])
  })
  it("o que a semântica decide melhor sai da checagem léxica: relato fiel de promessa e negação sobre o problema do cliente passam", () => {
    const items = [item("STRENGTH", "Reparo", "Abrir reparo quando os testes não resolverem.", ["Os testes não resolveram, então eu já abri o reparo."], { declared: true }), item("OPPORTUNITY", "Promessas", "Não prometer desbloqueio imediato.", ["O desbloqueio é na hora."], { customer: ["E a linha volta quando?"] })]
    const value = draft([[1, "Como o sinal não foi restabelecido, você informou que abriu o reparo.", "STRENGTH", ["S1"]], [2, "Quando o cliente perguntou, você garantiu que o desbloqueio seria na hora.", "ADJUSTMENT", ["A1"]]])
    // Sem veredito semântico (histórico V6), a regex derrubava as duas frases verdadeiras.
    expect(compositionViolations(value, narrativeBriefOf(items, LABEL), items, CONTEXT).narrative).toEqual(expect.arrayContaining(["NARRATIVE_CONTRADICTS_ARTIFACT", "GUARANTEED_EFFECT"]))
    expect(resolveNarrative(stored(items, value, factualityVerdictFor(value)), items, CONTEXT)).toMatchObject({ source: { narrative: "WRITER" }, violations: { narrative: [] } })
  })
  it("rascunhos V5/V6 (histórico, sem paráfrase livre) continuam validados pela regra da sua versão", () => {
    const items = mixed()
    const value = draft([[1, "Você pediu para reiniciar o modem e conferir o cabo.", "STRENGTH", ["S1"]], [2, "O ajuste é não prometer que o desbloqueio é na hora.", "ADJUSTMENT", ["A1"]]])
    expect(resolveNarrative(stored(items, value, null, "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V6"), items, CONTEXT).source.narrative).toBe("WRITER")
  })
})

describe("o que o verificador recebe e devolve", () => {
  it("os fatos de cada ponto (conclusão, ação × declaração, falas verificadas, regra) e as frases com refs — sem identificador interno", () => {
    const items = [...mixed(), item("STRENGTH", "Retorno", "Informar o próximo passo.", ["Vou consultar e te retorno ainda hoje."], { declared: true })]
    const value = draft([[1, "Você pediu para reiniciar o modem.", "STRENGTH", ["S1"]]])
    const payload = factualityPayloadOf(value, narrativeBriefOf(items, LABEL), items)
    expect(payload.points.find((point) => point.ref === "S1")).toMatchObject({ kind: "ACERTO", verifiedQuotes: expect.arrayContaining(["Operador: Desliga o modem da tomada e liga de novo."]), rule: ["Realizar os testes básicos antes de abrir reparo."] })
    expect(payload.points.find((point) => point.ref === "S2")).toMatchObject({ executionEvidence: expect.stringMatching(/^DECLARAÇÃO/) })
    expect(payload.claims).toEqual([{ id: "F1", type: "STRENGTH", refs: ["S1"], text: "Você pediu para reiniciar o modem." }])
    expect(JSON.stringify(payload)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|\/materiais\/|CP-/)
  })
  it("parse ESTRITO: um veredito por frase, ids conhecidos, sem repetição, enum válido", () => {
    const claims = factualityClaimsOf(draft([[1, "A.", "CONTEXT", []], [1, "B.", "CONTEXT", []]], "C.", []))
    const ok = parseFactualityResponse(JSON.stringify({ claims: [{ id: "F1", status: "SUPPORTED", unsupportedMeaning: null, reason: "r" }, { id: "F2", status: "GENERALIZATION", reason: "r" }, { id: "CARD", status: "UNSUPPORTED_ADDITION", unsupportedMeaning: "x", reason: "r" }] }), claims)
    expect(ok).toMatchObject({ ok: true, verdicts: [{ id: "F1" }, { id: "F2" }, { id: "CARD", unsupportedMeaning: "x" }] })
    expect(parseFactualityResponse(JSON.stringify({ claims: [{ id: "F1", status: "SUPPORTED", reason: "r" }] }), claims)).toMatchObject({ ok: false, error: "FACTUALITY_MISSING_CLAIM" })
    expect(parseFactualityResponse(JSON.stringify({ claims: [{ id: "F1", status: "SUPPORTED", reason: "r" }, { id: "F1", status: "SUPPORTED", reason: "r" }] }), claims)).toMatchObject({ ok: false, error: "FACTUALITY_DUPLICATE_CLAIM" })
    expect(parseFactualityResponse(JSON.stringify({ claims: [{ id: "F9", status: "SUPPORTED", reason: "r" }] }), claims)).toMatchObject({ ok: false, error: "FACTUALITY_UNKNOWN_CLAIM" })
    expect(parseFactualityResponse(JSON.stringify({ claims: [{ id: "F1", status: "OK", reason: "r" }] }), claims)).toMatchObject({ ok: false, error: "FACTUALITY_SCHEMA_INVALID" })
    expect(parseFactualityResponse("{", claims)).toMatchObject({ ok: false, error: "FACTUALITY_MALFORMED_JSON" })
  })
})

describe("reconhecimento factual dentro de uma frase de contexto (vínculo, não palavra)", () => {
  const negotiation = () => [
    item("STRENGTH", "Negociação", "Orientar o Vivo em Dia para consultar débitos e opções de parcelamento.", ["Pra isso existe o Vivo em Dia. Por lá você consegue consultar os valores em aberto e ver as opções de parcelamento."], { observed: "Você indicou o Vivo em Dia para consultar os valores em aberto e as opções de parcelamento." }),
    item("OPPORTUNITY", "Promessas", "Não garantir aprovação antes da consulta.", ["Ele vai ser aprovado na hora, isso eu te garanto."]),
  ]
  const check = (items: EmittedItem[], value: NarrativeDraft) => compositionViolations(value, narrativeBriefOf(items, LABEL), items, CONTEXT)
  it("ligado a S1 pela ref ou pelo próprio conteúdo → aceito", () => {
    expect(check(negotiation(), draft([[1, "A cliente queria regularizar os débitos e você indicou corretamente o Vivo em Dia para consultar os valores e as opções de parcelamento.", "CONTEXT", ["S1"]], [1, "Você garantiu a aprovação do parcelamento antes da consulta.", "ADJUSTMENT", ["A1"]]]))).toEqual({ narrative: [], card: [] })
    expect(check(negotiation(), draft([[1, "A cliente queria regularizar os débitos e você indicou corretamente o Vivo em Dia para consultar os valores e as opções de parcelamento.", "CONTEXT", []], [1, "Você garantiu a aprovação do parcelamento antes da consulta.", "ADJUSTMENT", ["A1"]]]))).toEqual({ narrative: [], card: [] })
  })
  it("elogio em contexto SEM força correspondente continua recusado; elogio junto do ajuste também", () => {
    const onlyGap = [negotiation()[1]!]
    expect(check(onlyGap, draft([[1, "A cliente queria parcelar e você conduziu bem a negociação.", "CONTEXT", []], [1, "Você garantiu a aprovação antes da consulta.", "ADJUSTMENT", ["A1"]]])).narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
    expect(check(negotiation(), draft([[1, "Você indicou corretamente o Vivo em Dia, mas garantiu a aprovação.", "CONTEXT", ["A1"]], [1, "Você garantiu a aprovação antes da consulta.", "ADJUSTMENT", ["A1"]]])).narrative).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
})
