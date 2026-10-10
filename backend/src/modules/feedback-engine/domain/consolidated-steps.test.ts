import { describe, expect, it } from "vitest"
import { consolidateDevelopments, type BriefFinding, type FeedbackBrief } from "./feedback-brief.js"
import { compositionPayloadOf, COMPOSITION_SYSTEM_PROMPT, VERIFICATION_SYSTEM_PROMPT, verificationFactsOf } from "./composition-prompt.js"

/**
 * `CONSOLIDATED_STEPS_V1` — zero IA. Avaliação de 05/10 (L09 da Larissa): o ponto "Caminho do atendimento" juntava seis etapas
 * confirmadas como não cumpridas, mas o redator via só o status do caminho e duas falas. O texto orientou "ofereça o bloqueio preventivo"
 * sem dizer que faltou, e a espera e a confirmação de entendimento sumiram. Agora cada etapa vai como fato próprio.
 */
const finding = (overrides: Partial<BriefFinding>): BriefFinding => ({ ref: "", findingKey: "k", kind: "DEVELOPMENT", origin: "CRITERION", title: "t", materiality: "MEDIUM", status: "NOT_MET", observed: "x", reading: null, quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [], ...overrides })
const rule = (section: string, text: string) => ({ text, section, documentId: "doc", documentTitle: "Procedimento Operacional — Contestação de Contas Móvel" })
const path = () => finding({ findingKey: "CALL:i:PATH:doc", origin: "PATH", title: "Caminho do atendimento", status: "PATH_INCORRECT", materiality: "HIGH", criterionKeys: ["KC-promessa", "KC-bloqueio", "KC-espera", "KC-prazo", "KC-conf"], quotes: [{ speaker: "OPERATOR", text: "Vou estornar os doze reais no seu cartão amanhã mesmo.", turn: "T9" }], firmness: { level: "CORRECT", basis: [] } })
const promessa = finding({ findingKey: "CALL:i:KC-promessa", title: "Conta já paga", criterionKeys: ["KC-promessa"], quotes: [{ speaker: "OPERATOR", text: "Vou estornar os doze reais no seu cartão amanhã mesmo.", turn: "T9" }], rules: [rule("Conta já paga", "Não prometer devolução imediata sem confirmação.")] })
const bloqueio = finding({ findingKey: "CALL:i:KC-bloqueio", title: "Serviços digitais não reconhecidos", criterionKeys: ["KC-bloqueio"], absence: { opportunity: null }, rules: [rule("Serviços digitais não reconhecidos", "Oferecer bloqueio preventivo;")] })
const espera = finding({ findingKey: "CALL:i:KC-espera", title: "Tempo de espera", criterionKeys: ["KC-espera"], quotes: [{ speaker: "OPERATOR", text: "Só um minutinho.", turn: "T5" }], rules: [rule("Tempo de espera", "Informar o motivo da espera;")] })
const prazo = finding({ findingKey: "CALL:i:KC-prazo", title: "Prazo da análise", criterionKeys: ["KC-prazo"], quotes: [{ speaker: "OPERATOR", text: "É só aguardar que vai ser resolvido.", turn: "T13" }], rules: [rule("Prazo da análise", "O operador deverá informar o prazo exibido na ferramenta.")] })
const conf = finding({ findingKey: "CALL:i:KC-conf", title: "Confirmação de entendimento", criterionKeys: ["KC-conf"], absence: { opportunity: null }, rules: [rule("Confirmação de entendimento", "Confirmar se o cliente entendeu as informações.")] })

const briefWith = (developments: BriefFinding[]): FeedbackBrief => ({ domain: "MONITORING", label: "Contestação de cobrança", context: [], officialLines: [], developments: developments.map((point, index) => ({ ...point, ref: `A${index + 1}` })), strengths: [], limitations: [], materials: [], tone: "DEVELOPMENT", suppressed: [] }) as unknown as FeedbackBrief

describe("CONSOLIDATED_STEPS_V1 — cada etapa de um ponto consolidado é fato próprio", () => {
  it("o caminho inadequado leva TODAS as etapas que absorve (não só as 4 primeiras regras), com status, falas ou ausência", () => {
    const [point] = consolidateDevelopments([path(), promessa, bloqueio, espera, prazo, conf])
    // Todas as regras das etapas absorvidas (até 8 por ponto — uma regra por origem, `RULE_SOURCES_V1`).
    expect(point!.rules).toHaveLength(5)
    expect(point!.steps?.map((step) => step.title)).toEqual(["Conta já paga", "Serviços digitais não reconhecidos", "Tempo de espera", "Prazo da análise", "Confirmação de entendimento"])
    expect(point!.steps?.find((step) => step.title === "Serviços digitais não reconhecidos")).toMatchObject({ status: "NOT_MET", absentInCall: true, quotes: [] })
    expect(point!.steps?.find((step) => step.title === "Tempo de espera")?.quotes[0]?.text).toBe("Só um minutinho.")
  })

  it("várias etapas da mesma seção viram um ponto com as etapas — inclusive a principal", () => {
    const recapA = finding({ findingKey: "CALL:i:KC-r1", title: "Conta analisada", criterionKeys: ["KC-r1"], absence: { opportunity: null }, rules: [rule("Recapitulação obrigatória", "- Conta analisada;")] })
    const recapB = finding({ findingKey: "CALL:i:KC-r2", title: "Prazo", criterionKeys: ["KC-r2"], absence: { opportunity: null }, rules: [rule("Recapitulação obrigatória", "- Prazo;")] })
    const [point] = consolidateDevelopments([recapA, recapB])
    expect(point!.steps?.map((step) => step.title)).toEqual(["Conta analisada", "Prazo"])
  })

  it("as etapas chegam ao redator e ao verificador como fatos (status em palavras, falas, ausência, regra)", () => {
    const brief = briefWith(consolidateDevelopments([path(), promessa, bloqueio, espera]))
    for (const facts of [compositionPayloadOf(brief).facts.developments[0], verificationFactsOf(brief).developments[0]]) {
      const steps = (facts as { steps?: { title: string; status: string; absentInCall: boolean; quotes?: { who: string; text: string }[]; rule?: string }[] }).steps!
      expect(steps.map((step) => step.title)).toEqual(["Conta já paga", "Serviços digitais não reconhecidos", "Tempo de espera"])
      expect(steps[1]).toMatchObject({ status: "não cumprida (confirmado)", absentInCall: true })
      expect(steps[1]!.rule).toContain("Oferecer bloqueio preventivo")
      expect(steps[2]!.quotes).toEqual([{ who: "você", text: "Só um minutinho." }])
    }
  })

  it("ponto que não junta nada não ganha etapas", () => {
    const [point] = consolidateDevelopments([prazo])
    expect(point!.steps).toBeUndefined()
    expect((compositionPayloadOf(briefWith([point!])).facts.developments[0] as { steps?: unknown }).steps).toBeUndefined()
  })
})

describe("FEEDBACK_COMPOSITION_PROMPT_V17 / VERIFICATION_PROMPT_V15 — o que o texto precisa fazer", () => {
  it("redator: um assunto por parágrafo, o que aconteceu antes do que fazer, 'o cliente' e não 'a pessoa'", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Um assunto por parágrafo")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Todo ajuste diz o que aconteceu nesta chamada antes do que fazer")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain('nunca "a pessoa" nem "o usuário"')
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("steps:")
  })
  it("verificador: status de cada etapa é fato; firmeza exige saber o que aconteceu nesta chamada", () => {
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("steps traz o status confirmado de cada etapa")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("o que aconteceu (ou faltou) nesta chamada")
  })
})
