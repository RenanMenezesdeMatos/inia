import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { buildProcedureContext, type SourceDocument } from "../domain/procedure.js"
import { isDeterminate, type ModelCallAnalysis, type VerifiedCallAnalysis } from "../domain/call-analysis.js"
import type { CallReview } from "../domain/call-review.js"

/**
 * Fixtures do motor de feedback (testes sem modelo). A base e as transcrições são sintéticas — escritas para exercitar regras
 * (pré-requisito, proibição, encerramento), nunca copiadas de conversas reais.
 */
export const DOC_ID = "00000000-0000-4000-8000-00000000d001"
export const CHECKLIST_ID = "00000000-0000-4000-8000-00000000d002"
export const INTERACTION_ID = "00000000-0000-4000-8000-00000000f001"

export const PROCEDURE_V1 = `# Procedimento — Segunda via de conta

**Versão:** 1.0

## 1. Objetivo

Orientar a emissão da segunda via.

## 2. Validação do titular

O operador deverá validar o titular antes de informar qualquer dado da conta.
- Confirmar nome completo;
- Confirmar data de nascimento.

## 3. Emissão

- Confirmar se a solicitação é da fatura ou do parcelamento;
- Enviar a segunda via pelo canal escolhido pelo cliente;
- Informar o prazo de 2 dias úteis para o envio por correio.

## 4. Frases a evitar

- Não prometer envio imediato por correio.

## 5. Encerramento

- Confirmar se o cliente tem mais alguma dúvida.
`

export const CHECKLIST_V1 = `# Checklist de Encerramento de Chamada

Antes de encerrar qualquer chamada: (1) recapitule o que foi feito; (2) informe o protocolo.`

export const TRANSCRIPT = [
  "Operador: Bom dia, meu nome é Ana. Com quem eu falo?",
  "Cliente: Bom dia, é o Carlos. Preciso da segunda via da conta.",
  "Operador: Claro, Carlos. Me confirma seu nome completo?",
  "Cliente: Carlos Eduardo Lima.",
  "Operador: Obrigada. A segunda via é da fatura ou do parcelamento?",
  "Cliente: Da fatura.",
  "Operador: Vou enviar por e-mail agora mesmo.",
  "Cliente: Ótimo, obrigado.",
  "Operador: Posso ajudar em mais alguma coisa?",
  "Cliente: Não, só isso.",
].join("\n")

export function sourceDocuments(procedure = PROCEDURE_V1): SourceDocument[] {
  return [
    { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: procedure, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "SUBJECT_ANCHOR", relevance: 10 },
    { documentId: CHECKLIST_ID, title: "Checklist de Encerramento de Chamada", version: 1, content: CHECKLIST_V1, contentHash: "h2", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 1 },
  ]
}

export function fixtureContext(procedure = PROCEDURE_V1) {
  const context = buildProcedureContext(sourceDocuments(procedure))
  const projection = projectTranscript(TRANSCRIPT)
  const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!
  const section = (heading: string) => [...context.sections.values()].find((entry) => entry.heading?.includes(heading))!
  return { context, projection, line, section }
}

export function modelAnalysis(overrides: Partial<ModelCallAnalysis> = {}, scenario: Partial<ModelCallAnalysis["scenario"]> = {}): ModelCallAnalysis {
  return {
    scenario: { customerNeed: "Segunda via da fatura", conditions: [], procedure: "D1", procedureRationale: null, pathSections: [], correctPath: "Validar titular, confirmar o tipo, enviar pelo canal e encerrar confirmando dúvidas.", pathTaken: "Validou nome, confirmou o tipo, enviou por e-mail.", pathAssessment: "PARTIALLY_CORRECT", pathRationale: "Não confirmou a data de nascimento.", pathEvidence: [], ...scenario },
    criteria: [],
    sectionDispositions: [],
    groupDispositions: [],
    sourceConflicts: [],
    limitations: [],
    contractViolations: [],
    ...overrides,
  }
}

/** Revisão que CONFIRMA toda proposta (itens de lista lidos como cumulativos; condição sustentada por uma fala real do cliente). */
export const confirmingReview = (preliminary: VerifiedCallAnalysis, condition: { turn: string; speaker: string; quote: string } = { turn: "T2", speaker: "CLIENTE", quote: "Preciso da segunda via da conta." }): CallReview => ({
  claims: new Map(preliminary.criteria.filter((criterion) => isDeterminate(criterion.proposedStatus)).map((criterion) => [criterion.lineHandle, { id: criterion.lineHandle, verdict: "CONFIRMED" as const, issues: [], listReading: "CUMULATIVE" as const, conditionEvidence: [condition], counterEvidence: [], note: null }])),
  path: { verdict: "CONFIRMED", issues: [], note: null },
  lines: [],
  violations: [],
})
