import { describe, expect, it } from "vitest"
import { verifyProcessAssessments, type PresentedKnowledgeExcerpt } from "../domain/process-assessment.js"
import { buildProcessCheckpointCatalog } from "../domain/checkpoint-catalog.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import type { RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"

/**
 * MONITORING ARCHITECTURE V2 — Safety Gate fino (contrato V5). O especialista declara a semântica; o código confere só o que é
 * objetivo: fala literal, etapa do catálogo, regra literal apresentada, papel coerente com a conduta exigida (ato de checagem,
 * pergunta, abstenção), pré-requisito declarado e itens cobertos com fala literal. Nenhuma contagem de termos em comum.
 */
const DOCUMENT = { documentId: "doc-arg", title: "Guia de Abordagem | Atendimento", version: 1, content: [
  "# Guia de Abordagem | Atendimento",
  "## CEN-01 · Informe de pagamento",
  "Orientação ao operador:",
  "- Avaliar se a funcionalidade de informe de pagamento está disponível para o cliente.",
  "- Orientar que a solicitação pode ser realizada pelo aplicativo.",
  "Atenção / frases a evitar:",
  "- Não prometer desbloqueio imediato.",
  "## CEN-09 · Encerramento",
  "Antes de encerrar, informar:",
  "- o número do protocolo;",
  "- o prazo de retorno.",
].join("\n") }
const published = new Map([[DOCUMENT.documentId, DOCUMENT]])
const presented: PresentedKnowledgeExcerpt[] = chunkKnowledgeDocument({ id: DOCUMENT.documentId, title: DOCUMENT.title, content: DOCUMENT.content }).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => DOCUMENT.content, subject: null, coveragePlan: false })
const refOf = (text: string) => catalog.entries.find((entry) => entry.stepText.startsWith(text))!.ref
type Raw = RawProcessAssessment["processes"][number]["checkpoints"][number]
const step = (ref: string, status: "FOLLOWED" | "NOT_FOLLOWED", evidence: string[], role: string, relation: string, extra: Partial<Raw> = {}): Raw => ({ checkpointRef: ref, requirement: "x", status, evidenceType: "OBSERVED", transcriptEvidence: evidence, knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null, conductEvidence: { role, relation }, ...extra }) as Raw
const verify = (transcript: string, checkpoints: Raw[], contractVersion = "PROCESS_ASSESSMENT_MODEL_CONTRACT_V5") => verifyProcessAssessments({ sources: [{ sourceRef: "agent", assessment: { processes: [{ documentTitle: DOCUMENT.title, checkpoints }], validation: { contractVersion, completeness: "COMPLETE", invalidItems: [], normalizations: [], checkpointCapacity: [] } }, presented }], interactionId: "i-1", transcript, published })
const lines = (...rows: string[]) => rows.join("\n")

describe("Safety Gate V5 — ônus da prova positiva continua", () => {
  it("P0: resultado afirmado nunca é verificação, mesmo com o papel declarado de checagem", () => {
    const said = "Operador: É só informar pelo aplicativo, essa opção está disponível pra você, sim."
    const result = verify(lines("Operador: Boa tarde.", "Cliente: Já paguei e a linha continua bloqueada.", said), [step(refOf("Avaliar se a funcionalidade"), "FOLLOWED", [said], "CONDITION_VALIDATED", "EQUIVALENT")])
    expect(result.checkpoints[0]).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "EVIDENCE_ACTION_MISMATCH", conduct: { failure: "ASSERTED_RESULT_IS_NOT_VALIDATION" }, declaredSemantics: true })
  })

  it("proibição 'cumprida' exige abstenção explícita; com abstenção na fala, vale", () => {
    const silent = "Operador: A solicitação segue o processamento normal."
    const refused = "Operador: Isso eu não consigo te prometer, depende do processamento."
    const base = lines("Operador: Boa tarde.", "Cliente: Volta na hora?", silent, "Cliente: Mas volta hoje?", refused)
    const noAbstention = verify(base, [step(refOf("Não prometer"), "FOLLOWED", [silent], "INFORMATION_PROVIDED", "EQUIVALENT")])
    expect(noAbstention.checkpoints[0]).toMatchObject({ status: "NOT_OBSERVABLE", conduct: { failure: "PROHIBITION_COMPLIANCE_NOT_PROVEN" } })
    const abstention = verify(base, [step(refOf("Não prometer"), "FOLLOWED", [refused], "INFORMATION_PROVIDED", "EQUIVALENT")])
    expect(abstention.checkpoints[0]).toMatchObject({ status: "FOLLOWED", knowledge: { applicability: "VERIFIED", applicabilityBasis: "DECLARED_CONDUCT" } })
  })

  it("relação INFERRED (dedução) nunca sustenta cumprida nem descumprida", () => {
    const said = "Operador: Pode fazer pelo aplicativo."
    const result = verify(lines("Operador: Boa tarde.", "Cliente: Como faço?", said), [step(refOf("Orientar que a solicitação"), "FOLLOWED", [said], "INFORMATION_PROVIDED", "INFERRED")])
    expect(result.checkpoints[0]).toMatchObject({ status: "NOT_OBSERVABLE", conduct: { failure: "DECLARED_RELATION_INCOMPATIBLE" } })
  })
})

describe("Safety Gate V5 — paráfrase sem contagem de palavras", () => {
  it("checagem com outras palavras ('deixa eu ver aqui… tá liberado') é verificada pela conduta declarada, sem termos em comum", () => {
    const check = "Operador: Deixa eu ver aqui no sistema. Pronto, verifiquei, tá liberado pra sua linha."
    const result = verify(lines("Operador: Boa tarde.", "Cliente: Posso avisar que paguei?", check), [step(refOf("Avaliar se a funcionalidade"), "FOLLOWED", [check], "CONDITION_VALIDATED", "EQUIVALENT")])
    expect(result.checkpoints[0]).toMatchObject({ status: "FOLLOWED", knowledge: { applicability: "VERIFIED", applicabilityBasis: "DECLARED_CONDUCT" } })
  })

  it("a mesma avaliação no contrato V4 continua pelo caminho léxico (histórico nunca reinterpretado)", () => {
    const check = "Operador: Deixa eu ver aqui no sistema. Pronto, verifiquei, tá liberado pra sua linha."
    const result = verify(lines("Operador: Boa tarde.", "Cliente: Posso avisar que paguei?", check), [step(refOf("Avaliar se a funcionalidade"), "FOLLOWED", [check], "CONDITION_VALIDATED", "EQUIVALENT")], "PROCESS_ASSESSMENT_MODEL_CONTRACT_V4")
    expect(result.checkpoints[0]!.declaredSemantics).toBeUndefined()
    expect(result.checkpoints[0]!.knowledge?.applicabilityBasis).not.toBe("DECLARED_CONDUCT")
  })
})

describe("Safety Gate V5 — pré-requisito declarado (MIXED só com força independente)", () => {
  const skipped = "Operador: É só você informar o pagamento pelo aplicativo."
  it("ação que depende de uma checagem NÃO feita não vira ponto forte (PREREQUISITE_NOT_MET, dependência DECLARADA)", () => {
    const orient = "Operador: No aplicativo, você vai em pagamentos e anexa o comprovante."
    const result = verify(lines("Operador: Boa tarde.", "Cliente: Já paguei.", skipped, "Cliente: Como?", orient), [
      step(refOf("Avaliar se a funcionalidade"), "NOT_FOLLOWED", [skipped], "ACTION_PERFORMED", "DIFFERENT"),
      step(refOf("Orientar que a solicitação"), "FOLLOWED", [orient], "INFORMATION_PROVIDED", "EQUIVALENT", { dependsOn: refOf("Avaliar se a funcionalidade") }),
    ])
    expect(result.checkpoints[1]).toMatchObject({ status: "NOT_OBSERVABLE", statusDowngradeReason: "PREREQUISITE_NOT_MET", dependency: { kind: "DECLARED" } })
    expect(result.checkpoints[0]!.status).toBe("NOT_FOLLOWED")
  })

  it("com o pré-requisito cumprido, a ação dependente continua ponto forte", () => {
    const check = "Operador: Vou verificar se a opção está liberada pra você. Pronto, verifiquei."
    const orient = "Operador: Então você pode informar o pagamento pelo aplicativo."
    const result = verify(lines("Operador: Boa tarde.", "Cliente: Já paguei.", check, "Cliente: E agora?", orient), [
      step(refOf("Avaliar se a funcionalidade"), "FOLLOWED", [check], "CONDITION_VALIDATED", "EQUIVALENT"),
      step(refOf("Orientar que a solicitação"), "FOLLOWED", [orient], "INFORMATION_PROVIDED", "EQUIVALENT", { dependsOn: refOf("Avaliar se a funcionalidade") }),
    ])
    expect(result.checkpoints.map((entry) => entry.status)).toEqual(["FOLLOWED", "FOLLOWED"])
  })
})

describe("Safety Gate V5 — etapa composta pelos itens DECLARADOS", () => {
  const recap = "Operador: Seu protocolo é 20260929001. Posso ajudar em algo mais?"
  const transcript = lines("Operador: Boa tarde.", "Cliente: Quero contestar.", recap, "Cliente: Não, obrigado.")
  const encerramento = () => refOf("Antes de encerrar")
  it("coberto só com fala literal; item declarado ausente numa lista de DIZER com transcrição completa → PARCIAL (nunca 'cumpriu')", () => {
    const result = verify(transcript, [step(encerramento(), "FOLLOWED", [recap], "INFORMATION_PROVIDED", "EQUIVALENT", { items: [{ text: "o número do protocolo", covered: true, evidence: [recap] }, { text: "o prazo de retorno", covered: false, evidence: [] }] })])
    expect(result.checkpoints[0]).toMatchObject({ status: "NOT_FOLLOWED", statusDowngradeReason: "COMPOSITE_PARTIAL", completeness: { status: "PARTIAL" } })
  })
  it("sem itens declarados, a completude fica DESCONHECIDA (nenhum detector por tipo supre a declaração)", () => {
    const result = verify(transcript, [step(encerramento(), "FOLLOWED", [recap], "INFORMATION_PROVIDED", "EQUIVALENT")])
    expect(result.checkpoints[0]!.completeness?.status).toBe("UNKNOWN")
  })
  it("'coberto' com fala que não está na transcrição não conta", () => {
    const result = verify(transcript, [step(encerramento(), "FOLLOWED", [recap], "INFORMATION_PROVIDED", "EQUIVALENT", { items: [{ text: "o número do protocolo", covered: true, evidence: [recap] }, { text: "o prazo de retorno", covered: true, evidence: ["Operador: O prazo é de cinco dias."] }] })])
    expect(result.checkpoints[0]!.completeness).toMatchObject({ status: "UNKNOWN" })
  })
})
