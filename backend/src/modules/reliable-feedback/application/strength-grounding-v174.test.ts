import { describe, expect, it } from "vitest"
import { prerequisiteDependencyOf, prerequisiteGateOf } from "../domain/evidence-conduct.js"
import { verifyProcessAssessments, type PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import { buildProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { cardViolations, deterministicNarrative, narrativeBriefOf, narrativeViolations } from "../domain/supervisor-narrative.js"
import { SUPERVISOR_NARRATIVE_PROMPT_VERSION, SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS } from "../domain/supervisor-narrative-prompt.js"
import { feedbackViewOf } from "../domain/feedback-view.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"

/**
 * V1.7.4 — ASSESSMENT É A FONTE FACTUAL ÚNICA (princípios do fechamento da Golden Demo "Argumentário"):
 *   1–3  redator/card/view nunca criam ponto forte, achado, ação ou conclusão: elogio só com ponto forte do assessment;
 *   4    ação que depende de pré-requisito descumprido não é ponto forte (chamada 10: oferta de pacote depois de "a sua franquia
 *        acabou" sem as validações);
 *   5–6  "o que manter" é opcional; feedback só de desenvolvimento pode ter zero elogio;
 *   7    liberdade de estrutura e extensão ao redator — nunca de fato.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Princípio 4 — dependência de pré-requisito (chamada 10)
// ---------------------------------------------------------------------------------------------------------------------
const DOCUMENT = { documentId: "doc-reparo", title: "Guia de Abordagem | Atendimento", version: 1, content: [
  "# Guia de Abordagem | Atendimento",
  "## ARG-006 · Reparo móvel",
  "Orientação ao operador:",
  "- Perguntar desde quando a conexão está falhando e em quais locais.",
  "- Informar que o consumo da franquia pode ser acompanhado pelo aplicativo e que, caso precise, o cliente pode comprar um pacote adicional de dados por esse canal.",
  "Atenção / frases a evitar:",
  "- Não afirmar que a falta de conexão está necessariamente relacionada ao fim da franquia sem realizar as validações cabíveis.",
  "## ARG-007 · Segunda via",
  "Orientação ao operador:",
  "- Informar que a segunda via pode ser baixada pelo aplicativo, na área de faturas.",
].join("\n") }
const published = new Map([[DOCUMENT.documentId, DOCUMENT]])
const presented: PresentedKnowledgeExcerpt[] = chunkKnowledgeDocument({ id: DOCUMENT.documentId, title: DOCUMENT.title, content: DOCUMENT.content }).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => DOCUMENT.content, subject: null, coveragePlan: false })
const refOf = (text: string) => catalog.entries.find((entry) => entry.stepText.startsWith(text))!.ref
type Raw = RawProcessAssessment["processes"][number]["checkpoints"][number]
const checkpoint = (ref: string, status: "FOLLOWED" | "NOT_FOLLOWED", evidence: string[], extra: Partial<Raw> = {}): Raw => ({ checkpointRef: ref, requirement: "x", status, evidenceType: "OBSERVED", transcriptEvidence: evidence, knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, ...extra }) as Raw
const verify = (transcript: string, checkpoints: Raw[]) => verifyProcessAssessments({ sources: [{ sourceRef: "agent", assessment: { processes: [{ documentTitle: DOCUMENT.title, checkpoints }], validation: { contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V4", completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] } }, presented }], interactionId: "i-10", transcript, published })

const PREMISE = "Operador: Então, Nilton, quando a internet para assim é porque a sua franquia acabou."
const OFFER = "Operador: Pelo aplicativo você acompanha o consumo da franquia e, se precisar, compra um pacote adicional de dados."
const OFFER_REF = () => refOf("Informar que o consumo da franquia")
const PROHIBITION_REF = () => refOf("Não afirmar que a falta de conexão")
const offer = () => checkpoint(OFFER_REF(), "FOLLOWED", [OFFER], { conductEvidence: { role: "INFORMATION_PROVIDED", relation: "EQUIVALENT" } } as Partial<Raw>)
const violation = () => checkpoint(PROHIBITION_REF(), "NOT_FOLLOWED", [PREMISE], { conductEvidence: { role: "RESULT_ASSERTED", relation: "DIFFERENT" } } as Partial<Raw>)

describe("Princípio 4 — ação que depende de pré-requisito descumprido não é ponto forte", () => {
  it("o portão é estrutural: 'Não afirmar X sem realizar as validações' → X depende; 'Avaliar se… Em caso positivo, Y' → Y depende", () => {
    expect(prerequisiteGateOf("Não afirmar que a falta de conexão está necessariamente relacionada ao fim da franquia sem realizar as validações cabíveis.")).toMatchObject({ kind: "ASSERTED_WITHOUT_VALIDATION", dependentTerms: expect.arrayContaining(["franq"]) })
    expect(prerequisiteGateOf("Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente. Em caso positivo, orientar que a solicitação pode ser realizada pelo aplicativo.")).toMatchObject({ kind: "ACTION_AFTER_VALIDATION", dependentTerms: expect.arrayContaining(["aplic"]) })
    // Proibição sem pré-requisito e etapa comum não são portão.
    expect(prerequisiteGateOf("Não prometer desbloqueio imediato.")).toBeNull()
    expect(prerequisiteGateOf("Informar que a segunda via pode ser baixada pelo aplicativo.")).toBeNull()
  })

  it("chamada 10: a oferta de pacote DEPOIS da premissa sem validação sai de ponto forte (nem vira desenvolvimento); a violação continua", () => {
    const transcript = ["Operador: Boa tarde, com quem eu falo?", "Cliente: Nilton. Minha internet do celular parou de funcionar.", PREMISE, "Cliente: Mas eu nem usei muito.", OFFER, "Cliente: Tá bom."].join("\n")
    const result = verify(transcript, [offer(), violation()])
    const [offered, prohibited] = result.checkpoints
    expect(prohibited).toMatchObject({ status: "NOT_FOLLOWED", statusDowngradeReason: null })
    expect(offered).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "PREREQUISITE_NOT_MET", evidenceType: null, dependency: { version: "PREREQUISITE_DEPENDENCY_V1", kind: "ASSERTED_WITHOUT_VALIDATION", sharedTerms: ["franq"] } })
    expect(result.summary.FOLLOWED).toBe(0)
  })

  it("o acerto ANTERIOR à premissa não se apoiou nela: continua ponto forte", () => {
    const transcript = ["Operador: Boa tarde, com quem eu falo?", "Cliente: Nilton. Minha internet do celular parou de funcionar.", OFFER, "Cliente: Tá, mas não é isso.", PREMISE, "Cliente: Tá bom."].join("\n")
    const result = verify(transcript, [offer(), violation()])
    expect(result.checkpoints.map((entry) => entry.status)).toEqual(["FOLLOWED", "NOT_FOLLOWED"])
  })

  it("acerto sem assunto em comum com a premissa (mesma seção) e acerto de OUTRA seção continuam pontos fortes", () => {
    const ask = "Operador: Desde quando a conexão está falhando e em quais locais isso acontece?"
    const secondCopy = "Operador: E a segunda via você baixa pelo aplicativo, na área de faturas."
    const transcript = ["Operador: Boa tarde.", "Cliente: Minha internet parou.", PREMISE, "Cliente: Hum.", ask, "Cliente: Desde ontem, em casa.", secondCopy, "Cliente: Obrigado."].join("\n")
    const result = verify(transcript, [
      checkpoint(refOf("Perguntar desde quando"), "FOLLOWED", [ask], { conductEvidence: { role: "QUESTION_ASKED", relation: "EQUIVALENT" } } as Partial<Raw>),
      checkpoint(refOf("Informar que a segunda via"), "FOLLOWED", [secondCopy], { conductEvidence: { role: "INFORMATION_PROVIDED", relation: "EQUIVALENT" } } as Partial<Raw>),
      violation(),
    ])
    expect(result.checkpoints.map((entry) => [entry.status, entry.statusDowngradeReason])).toEqual([["FOLLOWED", null], ["FOLLOWED", null], ["NOT_FOLLOWED", null]])
  })

  it("dependência exige termo PRÓPRIO: termo que só está no título/abertura da seção não liga duas etapas", () => {
    const gate = prerequisiteGateOf("Não afirmar que o reparo móvel está concluído sem realizar os testes.")!
    expect(prerequisiteDependencyOf({ gateRef: "g", gate, stepText: "Informar que o reparo móvel pode ser acompanhado pelo aplicativo.", evidenceTurns: ["T5"], gateTurns: ["T3"], gateEvidence: ["O reparo móvel já está concluído."], contextTexts: ["ARG-006 · Reparo móvel"] })).toBeNull()
    // Termo da regra que o operador NÃO afirmou (o sintoma) não liga: só a premissa dita sem validação.
    const franchise = prerequisiteGateOf("Não afirmar que a falta de conexão está necessariamente relacionada ao fim da franquia sem realizar as validações cabíveis.")!
    expect(prerequisiteDependencyOf({ gateRef: "g", gate: franchise, stepText: "Perguntar desde quando a conexão está falhando.", evidenceTurns: ["T5"], gateTurns: ["T3"], gateEvidence: ["é porque a sua franquia acabou"], contextTexts: [] })).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Princípios 1–3, 5–7 — redator/card/view não criam ponto forte
// ---------------------------------------------------------------------------------------------------------------------
const LABEL = "Atendimento de 29/09/2026 · Bloqueio por inadimplência"
const CONTEXT = { domain: "MONITORING" as const, label: LABEL, firstName: "Larissa" }
let next = 1
function item(section: "STRENGTH" | "OPPORTUNITY", title: string, observed: string, quote: string, line: string): EmittedItem {
  const index = next++
  return {
    index, domain: "MONITORING", section, sectionLabel: section === "STRENGTH" ? "Ponto forte" : "Ponto de desenvolvimento",
    wording: { observed, whyItMatters: "", whatYouCanDo: "" }, wordingSource: "PROPOSED", qaStatus: "NOT_SELECTED_FOR_QA",
    facts: [{ role: "OPERADOR", text: line, truncated: false, masked: false }],
    knowledge: { documentId: "doc", documentTitle: "Guia de Abordagem | Atendimento", heading: "ARG-002 · Informe de pagamento", version: 1, quote, applicability: "VERIFIED", href: "/materiais/doc", contentKind: "RULE_CONTENT" },
    grounding: "OFFICIAL_PROCEDURE",
    process: { title: "Guia de Abordagem | Atendimento", requirement: quote, status: section === "STRENGTH" ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: `CP-${index}`, evidenceType: "OBSERVED_ACTION" as never, stepTitle: title },
  } as EmittedItem
}
/** Chamada 4 (V174F): o assessment trouxe SÓ dois pontos de desenvolvimento — nenhum ponto forte. */
const call4 = () => [
  item("OPPORTUNITY", "Informe de pagamento", "Você orientou o informe de pagamento pelo aplicativo sem antes avaliar se a funcionalidade estava disponível para o cliente.", "Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente. Em caso positivo, orientar que a solicitação pode ser realizada pelo aplicativo.", "É só você informar o pagamento pelo aplicativo, essa opção está disponível pra você, sim."),
  item("OPPORTUNITY", "Não prometer desbloqueio imediato", "Você disse que o desbloqueio seria imediato.", "Não prometer desbloqueio imediato.", "Assim que você informar, o desbloqueio é imediato, volta na hora."),
]
const REAL_CARD_CALL4 = "Você orientou corretamente o uso do aplicativo para o informe de pagamento. O ponto a ajustar é a afirmação sobre a imediatidade do desbloqueio após esse registro."
const PRAISE_WORDS = /corretamente|conduziu bem|fez bem|mantenha|continue|parab|com clareza|bem feito/i

describe("Princípios 1–3 — redator e card não criam ponto forte", () => {
  it("chamada 4: o card REAL da V174F ('orientou corretamente…') é recusado — não há ponto forte no assessment", () => {
    const items = call4()
    const brief = narrativeBriefOf(items, LABEL)
    expect(brief.positives).toEqual([])
    expect(cardViolations(REAL_CARD_CALL4, brief, items, CONTEXT)).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
    expect(narrativeViolations([REAL_CARD_CALL4], brief, items, CONTEXT)).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })

  it("'orientou' (fato afirmado) não é marcador de ajuste: frase que afirma o comportamento de um ajuste como feito contradiz o artefato", () => {
    const items = call4()
    const brief = narrativeBriefOf(items, LABEL)
    expect(narrativeViolations(["Você orientou o cliente a usar o aplicativo para o pagamento."], brief, items, CONTEXT)).toContain("NARRATIVE_CONTRADICTS_ARTIFACT")
  })

  it("elogio genérico ('conduziu bem este atendimento') com ajustes e sem ponto forte correspondente é recusado; com ponto forte ligado, passa", () => {
    const items = call4()
    const brief = narrativeBriefOf(items, LABEL)
    expect(narrativeViolations(["Você conduziu bem este atendimento. O desbloqueio imediato não pode ser prometido."], brief, items, CONTEXT)).toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
    const withStrength = [...call4(), item("STRENGTH", "Validação do titular", "Você confirmou o nome completo do titular da linha.", "Confirmar o nome completo do titular da linha.", "Pode me confirmar o nome completo do titular?")]
    const briefStrength = narrativeBriefOf(withStrength, LABEL)
    const anchored = narrativeViolations(["Você confirmou corretamente o nome completo do titular. O desbloqueio imediato não pode ser prometido, e antes de orientar o aplicativo é preciso avaliar se o informe de pagamento está disponível."], briefStrength, withStrength, CONTEXT)
    expect(anchored).not.toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })

  it("orientação prospectiva não é elogio ('Na próxima chamada, explique com clareza…')", () => {
    const items = call4()
    const brief = narrativeBriefOf(items, LABEL)
    const violations = narrativeViolations(["O desbloqueio imediato não pode ser prometido e o informe de pagamento precisa ser avaliado antes. Na próxima chamada, explique com clareza que o desbloqueio depende da análise."], brief, items, CONTEXT)
    expect(violations).not.toContain("NARRATIVE_UNSUPPORTED_STRENGTH")
  })
})

describe("Princípios 5–7 — elogio e 'o que manter' são opcionais; o redator tem liberdade, não de fato", () => {
  it("feedback só de desenvolvimento: narrativa e card do sistema sem nenhum elogio, e sem 'O que manter'", () => {
    const items = call4()
    const system = deterministicNarrative(narrativeBriefOf(items, LABEL))
    expect([...system.paragraphs, system.card].join(" ")).not.toMatch(PRAISE_WORDS)
    expect(feedbackViewOf(items, { narrative: system.paragraphs, card: system.card, firstName: "Larissa" } as never)!.maintain).toBeNull()
  })

  it("prompt da narrativa V4: elogio e 'o que manter' só com wentWell, estrutura livre, nenhum fato novo; V3 congelado", () => {
    expect(SUPERVISOR_NARRATIVE_PROMPT_VERSION).not.toBe("SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V3")
    const v4 = SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS.SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V4
    expect(v4).toContain("Quando \"wentWell\" estiver vazio, não elogie nada e não diga o que manter")
    expect(v4).toContain("Você escolhe a estrutura e a extensão")
    expect(v4).toContain("ação, acerto, erro")
    expect(v4).not.toContain("reconheça o que foi bem feito")
    expect(SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS.SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V3).toContain("reconheça o que foi bem feito")
  })
})
