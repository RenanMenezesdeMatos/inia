import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { composeFeedback } from "../application/compose-feedback.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { applyVerdicts, assembleMessage, parseWriterDraft, type Verdict } from "./composition.js"
import { COMPOSITION_RESPONSE_SCHEMA, COMPOSITION_SYSTEM_PROMPT, VERIFICATION_SYSTEM_PROMPT } from "./composition-prompt.js"
import type { BriefFinding, FeedbackBrief } from "./feedback-brief.js"

/**
 * `SPEECH_EXAMPLE_V1` — zero IA. O "exemplo de como dizer" volta ao motor: o redator propõe uma fala ao cliente por ponto de
 * desenvolvimento, o verificador a confere na MESMA chamada (E-n) e ela só aparece nos detalhes ("Como melhorar") quando sustentada como
 * fala concreta. A narrativa não muda; conteúdo fora dos fatos, fala com lacuna ou exemplo não conferido nunca aparecem.
 */
const finding = (overrides: Partial<BriefFinding>): BriefFinding => ({ ref: "", findingKey: "k", kind: "DEVELOPMENT", origin: "CRITERION", title: "t", materiality: "HIGH", status: "NOT_MET", observed: "x", reading: null, quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [], ...overrides })
const rule = (section: string, text: string) => ({ text, section, documentId: "doc", documentTitle: "Procedimento Operacional — Contestação de Contas Móvel" })

const PRAZO = finding({ ref: "A1", findingKey: "CALL:i:KC-prazo", title: "Prazo da análise", criterionKeys: ["KC-prazo"], quotes: [{ speaker: "OPERATOR", text: "É só aguardar que vai ser resolvido.", turn: "T13" }], rules: [rule("Prazo da análise", "O operador deverá informar o prazo exibido na ferramenta.")] })
const ESPERA = finding({ ref: "A2", findingKey: "CALL:i:KC-espera", title: "Tempo de espera", materiality: "MEDIUM", criterionKeys: ["KC-espera"], quotes: [{ speaker: "OPERATOR", text: "Só um minutinho que eu vou olhar.", turn: "T5" }], rules: [rule("Tempo de espera", "Informar o motivo da espera e pedir autorização ao cliente.")] })
const PROTOCOLO = finding({ ref: "S1", findingKey: "CALL:i:KC-protocolo", kind: "STRENGTH", status: "MET", title: "Protocolo", criterionKeys: ["KC-protocolo"], quotes: [{ speaker: "OPERATOR", text: "Anota o protocolo, por favor.", turn: "T15" }], rules: [rule("Protocolo", "Informar o número do protocolo.")] })

const brief = (): FeedbackBrief => ({ domain: "MONITORING", label: "Contestação de cobrança", heading: { title: "Contestação de cobrança", subtitle: "Atendimento de 25/09/2026" }, context: ["A cliente contestou uma cobrança de doze reais numa conta já paga."], officialLines: [], developments: [PRAZO, ESPERA], strengths: [PROTOCOLO], limitations: [], materials: [], tone: "DEVELOPMENT", suppressed: [] }) as unknown as FeedbackBrief

const SENTENCES = [
  { text: "Quando a cliente perguntou sobre a análise, você disse só “É só aguardar que vai ser resolvido”, sem o prazo.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 },
  { text: "Nas próximas contestações, informe o prazo exibido na ferramenta antes de encerrar.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 },
]
const EXAMPLE = "Deixa eu conferir aqui o prazo da análise que aparece para o seu caso, para você saber quando esperar o retorno."
const draft = (examples: unknown[]) => ({ sentences: SENTENCES, card: { text: "Informe o prazo exibido na ferramenta nas contestações.", refs: ["A1"] }, examples })
const ok = (id: string, overrides: Partial<Verdict> = {}): [string, Verdict] => [id, { id, verdict: "SUPPORTED", specific: true, repeats: null, note: null, ...overrides }]

function composed(examples: unknown[], verdicts: [string, Verdict][]) {
  const parsed = parseWriterDraft(JSON.stringify(draft(examples)))
  if (!parsed.ok) throw new Error(parsed.error)
  const decisions = applyVerdicts(parsed.draft, brief(), new Map([ok("F1"), ok("F2"), ok("CARD"), ...verdicts]))
  return { decisions, message: assembleMessage(brief(), decisions)! }
}

describe("SPEECH_EXAMPLE_V1 — exemplo de como dizer", () => {
  it("o rascunho lê os exemplos sem deixar um item malformado derrubar o texto; um exemplo por ponto", () => {
    const parsed = parseWriterDraft(JSON.stringify(draft([{ ref: "a1", text: EXAMPLE }, { ref: "A1", text: "Outra fala." }, { ref: "A2" }, "lixo"])))
    expect(parsed.ok && parsed.draft.examples).toEqual([{ ref: "A1", text: EXAMPLE }])
    const without = parseWriterDraft(JSON.stringify({ sentences: SENTENCES, card: { text: "c", refs: [] } }))
    expect(without.ok && without.draft.examples).toBeUndefined()
  })

  it("sustentado e concreto: aparece nos detalhes do ponto ('Como melhorar'), nunca na narrativa", () => {
    const { decisions, message } = composed([{ ref: "A1", text: EXAMPLE }], [ok("E-A1")])
    expect(decisions.examples).toEqual([expect.objectContaining({ id: "E-A1", ref: "A1", accepted: true, reasons: [] })])
    expect(message.view.developments.find((detail) => detail.title === "Prazo da análise")?.suggestedResponse).toBe(EXAMPLE)
    expect(message.text).not.toContain(EXAMPLE)
  })

  it("conteúdo fora dos fatos (prazo inventado), contradição ou promessa: recusado e fora de todas as superfícies", () => {
    for (const kind of ["UNSUPPORTED_ADDITION", "CONTRADICTION", "OVERREACH"] as const) {
      const invented = "A análise leva cinco dias úteis e o valor volta na sua próxima fatura."
      const { decisions, message } = composed([{ ref: "A1", text: invented }], [ok("E-A1", { verdict: kind, note: "prazo e resultado não estão nos fatos" })])
      expect(decisions.examples?.[0]).toMatchObject({ accepted: false, reasons: [kind] })
      expect(JSON.stringify(message)).not.toContain(invented)
    }
  })

  it("fala genérica, com lacuna ou instrução ao operador (specific false), e exemplo não conferido: não aparecem", () => {
    const gap = composed([{ ref: "A1", text: "O prazo da análise é de [prazo] dias." }], [ok("E-A1", { specific: false })])
    expect(gap.decisions.examples?.[0]).toMatchObject({ accepted: false, reasons: ["NOT_USABLE_AS_SPEECH"] })
    expect(gap.message.view.developments[0]?.suggestedResponse).toBeNull()
    const unverified = composed([{ ref: "A1", text: EXAMPLE }], [])
    expect(unverified.decisions.examples?.[0]).toMatchObject({ accepted: false, reasons: ["NOT_VERIFIED"] })
    expect(unverified.message.view.developments[0]?.suggestedResponse).toBeNull()
  })

  it("checagens locais de frase valem para o exemplo: número fora dos fatos, código interno e ponto que não é de desenvolvimento", () => {
    const number = composed([{ ref: "A1", text: "A análise fica pronta em 5 dias, tá bom?" }], [ok("E-A1")])
    expect(number.decisions.examples?.[0]?.reasons).toContain("UNGROUNDED_NUMBER")
    const internal = composed([{ ref: "A1", text: "Conforme a regra A1, o prazo aparece aqui para você." }], [ok("E-A1")])
    expect(internal.decisions.examples?.[0]?.reasons).toContain("INTERNAL_REFERENCE")
    const strength = composed([{ ref: "S1", text: "Anota aí o seu protocolo, por favor." }], [ok("E-S1")])
    expect(strength.decisions.examples?.[0]?.reasons).toContain("NOT_A_DEVELOPMENT")
  })

  it("exemplo de um ponto que a mensagem não comunicou não aparece (o ponto não aparece nos detalhes)", () => {
    const { decisions, message } = composed([{ ref: "A2", text: "Vou consultar o sistema para ver a sua fatura; posso te deixar um instante em espera?" }], [ok("E-A2")])
    expect(decisions.examples?.[0]?.accepted).toBe(true)
    expect(message.view.developments.map((detail) => detail.title)).toEqual(["Prazo da análise"])
    expect(JSON.stringify(message.view)).not.toContain("posso te deixar um instante em espera")
  })

  it("composição: o exemplo vai ao verificador na mesma chamada (E-n) e um exemplo recusado sozinho não paga reescrita", async () => {
    const verified: string[] = []
    const { model } = fakeEngineModel({
      composition: draft([{ ref: "A1", text: EXAMPLE }]),
      verification: (claims) => {
        verified.push(...claims.map((claim) => `${claim.id}:${claim.stance}`))
        return { verdicts: claims.map((claim) => ({ id: claim.id, verdict: claim.id === "E-A1" ? "UNSUPPORTED_ADDITION" : "SUPPORTED", specific: true, note: claim.id === "E-A1" ? "acrescenta prazo" : null })) }
      },
    })
    // Só o ponto do exemplo: um ponto de desenvolvimento não comunicado pediria a reescrita por si só (`ALL_DEVELOPMENTS_V1`).
    const { message, audit } = await composeFeedback(model, { ...brief(), developments: [PRAZO] }, [], null)
    expect(verified).toContain("E-A1:EXAMPLE")
    expect(audit.attempts).toMatchObject({ writer: 1, verifier: 1 })
    expect(audit.examples).toEqual([expect.objectContaining({ id: "E-A1", accepted: false, verdict: "UNSUPPORTED_ADDITION", note: "acrescenta prazo" })])
    expect(message?.view.developments[0]?.suggestedResponse).toBeNull()
  })

  it("prompts: o redator sabe o que é o exemplo e o verificador o confere como fala, com lacuna = não utilizável", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("EXEMPLO DE COMO DIZER (examples)")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("sem inventar o valor")
    expect((COMPOSITION_RESPONSE_SCHEMA as { properties: Record<string, unknown> }).properties.examples).toBeDefined()
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("Itens E-… são EXEMPLOS DE COMO DIZER")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("tem lacuna a preencher")
  })
})

describe("`CALL_IDENTIFIER_INTEGRITY_V1` — protocolo, telefone e documento só das falas da chamada", () => {
  const withRule = (): FeedbackBrief => {
    const base = brief()
    const protocolo = finding({ ref: "A1", findingKey: "CALL:i:KC-prot", title: "Protocolo", criterionKeys: ["KC-prot"], quotes: [{ speaker: "CUSTOMER", text: "Pode me passar o protocolo? Anota aí: meu telefone é (11) 98765-4321.", turn: "T20" }], rules: [rule("Exemplos de encerramento", "“A contestação foi registrada e será analisada em até 5 dias úteis. O retorno será enviado por SMS. Seu protocolo é 202609130184.”")] })
    return { ...base, developments: [protocolo] } as FeedbackBrief
  }
  const decide = (example: string) => {
    const parsed = parseWriterDraft(JSON.stringify({ sentences: [{ text: "Ao encerrar, você não informou o protocolo do atendimento.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }], card: { text: "Informe o protocolo ao encerrar.", refs: ["A1"] }, examples: [{ ref: "A1", text: example }] }))
    if (!parsed.ok) throw new Error(parsed.error)
    return applyVerdicts(parsed.draft, withRule(), new Map([ok("F1"), ok("CARD"), ok("E-A1")])).examples![0]!
  }

  it("o número de protocolo do EXEMPLO da regra nunca vai para a fala sugerida, mesmo que o verificador aceite", () => {
    expect(decide("A sua contestação foi registrada e o seu protocolo é 202609130184.")).toMatchObject({ accepted: false, reasons: ["IDENTIFIER_NOT_FROM_CALL"] })
    const spaced = decide("A sua contestação foi registrada e o seu protocolo é 2026 0913 0184.")
    expect(spaced.accepted).toBe(false)
    expect(spaced.reasons).toContain("IDENTIFIER_NOT_FROM_CALL")
  })

  it("identificador que está numa fala da chamada vale; fala sem número e prazo da regra também", () => {
    expect(decide("Vou te retornar no telefone que você me passou, o (11) 98765-4321.")).toMatchObject({ accepted: true })
    expect(decide("A sua contestação foi registrada, vou te passar agora o número do protocolo, e a análise leva até 5 dias úteis.")).toMatchObject({ accepted: true })
  })
})

describe("`ARGUMENT_PHRASING_V1` — com fraseologia do argumentário, o exemplo de como dizer é pedido", () => {
  const phrased = (): FeedbackBrief => {
    const base = brief()
    const espera = { ...ESPERA, materiality: "HIGH" as const, rules: [{ ...rule("Aviso de consulta", "Avisar o motivo da consulta e pedir um momento."), sourceKind: "ARGUMENT_SCRIPT" as const, phrasing: { scriptName: "Aviso de consulta e retomada", text: "Vou consultar algumas informações para te orientar. Pode aguardar um instante?" } }] }
    return { ...base, developments: [PRAZO, espera] } as FeedbackBrief
  }
  const kept = [
    { stance: "ADJUSTMENT" as const, refs: ["A1"], verdict: { id: "F1", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null } },
    { stance: "ADJUSTMENT" as const, refs: ["A2"], verdict: { id: "F2", verdict: "SUPPORTED" as const, specific: true, repeats: null, note: null } },
  ]

  it("ponto comunicado com fraseologia e sem exemplo aceito = lacuna (pede a reescrita com a instrução); com exemplo, não", async () => {
    const { usefulnessOf, repairInstructionsOf } = await import("./composition.js")
    const missing = usefulnessOf(phrased(), kept, null, new Set())
    expect(missing.missingPhrasingExample).toEqual(["A2"])
    expect(repairInstructionsOf([], missing, phrased(), { guidance: {}, why: {} }).join("\n")).toContain("fraseologia sugerida pelo argumentário")
    expect(usefulnessOf(phrased(), kept, null, new Set(["A2"])).missingPhrasingExample).toBeUndefined()
    // Ponto que o texto não comunica não é cobrado; sem o conjunto de exemplos (leitores antigos), nada é conferido.
    expect(usefulnessOf(phrased(), kept.slice(0, 1), null, new Set()).missingPhrasingExample).toBeUndefined()
    expect(usefulnessOf(phrased(), kept).missingPhrasingExample).toBeUndefined()
  })
})

describe("`CURRENT_PRACTICE_TITLE_V1` — o nome da prática que vai ao redator é o atual", () => {
  it("padrões e práticas dos colegas trocam só o rótulo; contagens e regras ficam como apuradas", async () => {
    const { withCurrentPracticeTitles } = await import("./indicator-investigation.js")
    const pattern = { criterionKey: "KP-1", practiceTitle: "Confirmar o entendimento da solicitação de contestação do cliente", text: "Confirmar o entendimento;", eligible: 3, notMet: 3 }
    const investigation = { evidence: [{ patterns: [pattern, { criterionKey: "KC-2", text: "linha sem prática", eligible: 1 }] }], reference: { practices: [{ criterionKey: "KP-1", practiceTitle: pattern.practiceTitle, reference: { eligible: 9 } }] } } as never
    const renamed = withCurrentPracticeTitles(investigation, new Map([["KP-1", "Confirmar o entendimento da solicitação do cliente"]])) as unknown as { evidence: { patterns: { practiceTitle?: string; eligible: number }[] }[]; reference: { practices: { practiceTitle: string }[] } }
    expect(renamed.evidence[0]!.patterns[0]).toMatchObject({ practiceTitle: "Confirmar o entendimento da solicitação do cliente", eligible: 3 })
    expect(renamed.evidence[0]!.patterns[1]!.practiceTitle).toBeUndefined()
    expect(renamed.reference.practices[0]!.practiceTitle).toBe("Confirmar o entendimento da solicitação do cliente")
  })
})
