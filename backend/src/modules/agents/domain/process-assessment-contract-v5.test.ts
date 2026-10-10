import { describe, expect, it } from "vitest"
import { PROCESS_ASSESSMENT_INSTRUCTIONS, PROCESS_ASSESSMENT_INSTRUCTIONS_V5, renderCheckpointFormatRules, validateProcessAssessmentOutput } from "./process-assessment-contract.js"
import { INDICATOR_DIAGNOSIS_INSTRUCTIONS } from "./indicator-diagnosis-contract.js"
import { buildProcessCheckpointCatalog } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"

/**
 * MONITORING ARCHITECTURE V2 — contrato V5 do especialista: a semântica é DECLARADA (papel da fala, pré-requisito, cobertura da
 * composta, contexto) e o validador só confere formato e referências. O V4 (diagnóstico de indicador) não muda.
 */
const CONTENT = [
  "# Guia de Abordagem",
  "## ARG-006 · Reparo móvel",
  "Orientação ao operador:",
  "- Realizar as validações cabíveis de sinal e de configuração da linha.",
  "- Informar que o consumo da franquia pode ser acompanhado pelo aplicativo e que, caso precise, o cliente pode comprar um pacote adicional de dados por esse canal.",
].join("\n")
const presented = chunkKnowledgeDocument({ id: "doc", title: "Guia de Abordagem", content: CONTENT }).map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index }))
const catalog = buildProcessCheckpointCatalog({ excerpts: presented, contentOf: () => CONTENT, subject: null, coveragePlan: false })
const VALIDATE = catalog.entries.find((entry) => entry.stepText.startsWith("Realizar"))!.ref
const OFFER = catalog.entries.find((entry) => entry.stepText.startsWith("Informar"))!.ref
const step = (ref: string, status: string, extra: Record<string, unknown> = {}) => ({ checkpointRef: ref, requirement: "x", status, evidenceType: status === "FOLLOWED" || status === "NOT_FOLLOWED" ? "OBSERVED" : null, transcriptEvidence: status === "FOLLOWED" || status === "NOT_FOLLOWED" ? ["Operador: fala"] : [], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null, ...extra })
const conduct = (relation: string) => ({ conductEvidence: { role: "ACTION_PERFORMED", relation } })
const validate = (checkpoints: unknown[], extra: Record<string, unknown> = {}, modelContract: "V4" | "V5" = "V5") => validateProcessAssessmentOutput({ processes: [{ documentTitle: "Guia de Abordagem", checkpoints }], applicability: [], ...extra }, { presented, catalog, modelContract })

describe("contrato V5 do especialista", () => {
  it("FOLLOWED/NOT_FOLLOWED sem conductEvidence sai da avaliação (CHECKPOINT_CONDUCT_REQUIRED); NOT_OBSERVABLE não precisa", () => {
    const result = validate([step(VALIDATE, "NOT_OBSERVABLE"), step(OFFER, "FOLLOWED")])
    expect(result.ok && result.validation.invalidItems.map((item) => item.code)).toEqual(["CHECKPOINT_CONDUCT_REQUIRED"])
    expect(result.ok && result.validation).toMatchObject({ contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V5", completeness: "PARTIAL" })
  })

  it("dependsOn: código de OUTRA etapa apresentada é aceito; inexistente ou a própria etapa é recusado", () => {
    const ok = validate([step(VALIDATE, "NOT_FOLLOWED", conduct("DIFFERENT")), step(OFFER, "NOT_FOLLOWED", { ...conduct("DIFFERENT"), dependsOn: `[${VALIDATE}]` })])
    expect(ok.ok && ok.assessment.processes[0]!.checkpoints[1]).toMatchObject({ dependsOn: VALIDATE })
    const unknown = validate([step(OFFER, "NOT_FOLLOWED", { ...conduct("DIFFERENT"), dependsOn: "CP-0000000000" })])
    expect(unknown.ok).toBe(false)
    const self = validate([step(VALIDATE, "NOT_FOLLOWED", conduct("DIFFERENT")), step(OFFER, "NOT_FOLLOWED", { ...conduct("DIFFERENT"), dependsOn: OFFER })])
    expect(self.ok && self.validation.invalidItems.map((item) => item.code)).toEqual(["CHECKPOINT_DEPENDS_ON_UNKNOWN"])
  })

  it("items, summary e interaction viajam com a avaliação (texto vazio vira null, registrado)", () => {
    const result = validate([step(OFFER, "FOLLOWED", { ...conduct("EQUIVALENT"), summary: "Explicou onde comprar o pacote.", items: [{ text: "consumo pelo aplicativo", covered: true, evidence: ["Operador: fala"] }] })], { interaction: { customerNeed: "Internet do celular parou", situation: "", path: "Atribuiu à franquia e ofereceu pacote" } })
    expect(result.ok && result.assessment.processes[0]!.checkpoints[0]).toMatchObject({ summary: "Explicou onde comprar o pacote.", items: [{ text: "consumo pelo aplicativo", covered: true }] })
    expect(result.ok && result.assessment.interaction).toEqual({ customerNeed: "Internet do celular parou", situation: null, path: "Atribuiu à franquia e ofereceu pacote" })
  })

  it("V4 (diagnóstico de indicador) não muda: sem conductEvidence continua válido e nenhum campo V5 entra na avaliação", () => {
    const result = validate([step(OFFER, "FOLLOWED", { summary: "x", dependsOn: VALIDATE, items: [] })], { interaction: { customerNeed: "x" } }, "V4")
    expect(result.ok && result.validation).toMatchObject({ contractVersion: "PROCESS_ASSESSMENT_MODEL_CONTRACT_V4", completeness: "COMPLETE" })
    const checkpoint = result.ok ? result.assessment.processes[0]!.checkpoints[0]! : null
    expect(checkpoint && ["summary", "dependsOn", "items"].some((key) => key in checkpoint)).toBe(false)
    expect(result.ok && "interaction" in result.assessment).toBe(false)
  })

  it("prompts: V5 pede os campos novos e a regra do pré-requisito; V4 e as regras do diagnóstico de indicador ficam como estavam", () => {
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS_V5).toContain("\"dependsOn\"")
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS_V5).toContain("\"interaction\"")
    expect(PROCESS_ASSESSMENT_INSTRUCTIONS_V5).toMatch(/depende de um pré-requisito NÃO cumprido nunca é FOLLOWED/)
    for (const text of [PROCESS_ASSESSMENT_INSTRUCTIONS, renderCheckpointFormatRules(), INDICATOR_DIAGNOSIS_INSTRUCTIONS]) {
      expect(text).not.toContain("dependsOn")
      expect(text).not.toContain("\"interaction\"")
    }
  })
})
