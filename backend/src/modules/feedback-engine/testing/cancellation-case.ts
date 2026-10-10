import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { verifyCallAnalysis, type ModelCallAnalysis } from "../domain/call-analysis.js"
import type { CallReview, ExclusionVerdict } from "../domain/call-review.js"
import { buildMonitoringBrief } from "../domain/feedback-brief.js"
import { buildProcedureContext, listContextOf } from "../domain/procedure.js"

/**
 * CASO SINTÉTICO de cobrança após cancelamento (testes sem modelo): mesmo FORMATO do atendimento que revelou o ponto cego da revisão
 * (C07, 01/10) — cancelamento pendente, cliente que continua pagando, recapitulação —, escrito para exercitar regras; nunca copiado
 * de uma conversa real.
 */
export const DOC = "00000000-0000-4000-8000-00000000e001"
export const PROCEDURE = `# Procedimento — Cobrança após cancelamento (teste)

## 1. Cobrança após cancelamento

Se o cancelamento não tiver sido concluído por falha interna:
- Corrigir o status;
- Contestar cobranças posteriores;
- Informar prazo.

## 2. Conta ajustada

- Emitir conta ajustada quando houver ajuste imediato.

## 3. Recapitulação obrigatória

Antes de encerrar, informar:
- Ação realizada;
- Serviço cancelado, quando aplicável;
- Próximo passo do pedido de cancelamento pendente;
- Protocolo.
`
export const TRANSCRIPT = [
  "Operador: Bom dia, aqui é a Ana. Com quem eu falo?",
  "Cliente: É a Bia. Cancelei o plano em julho e continuo sendo cobrada.",
  "Operador: Encontrei aqui o pedido de cancelamento aberto desde julho, ele não foi concluído.",
  "Cliente: E agora, vou continuar pagando?",
  "Operador: Registrei a contestação da mensalidade de agosto.",
  "Operador: A análise leva até cinco dias úteis. Resumindo: contestação registrada, protocolo 4455.",
  "Cliente: Certo, obrigada.",
  "Operador: Eu que agradeço. Tenha um bom dia.",
].join("\n")
export const INTERACTION = "00000000-0000-4000-8000-00000000e0f1"
export const context = buildProcedureContext([{ documentId: DOC, title: "Procedimento — Cobrança após cancelamento", version: 1, content: PROCEDURE, contentHash: "e1", perspective: "RULE_IN_FORCE_AT_CALL", selection: "SUBJECT_ANCHOR", relevance: 10 }])
export const projection = projectTranscript(TRANSCRIPT)
export const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!.handle
export const section = (heading: string) => [...context.sections.values()].find((entry) => entry.heading?.includes(heading))!.handle
export const T3 = { turn: "T3", speaker: "OPERADOR", quote: "Encontrei aqui o pedido de cancelamento aberto desde julho, ele não foi concluído." }
export const T4 = { turn: "T4", speaker: "CLIENTE", quote: "E agora, vou continuar pagando?" }
export const GENERIC = "Condições não ocorridas no atendimento (validação bem-sucedida, sem ajuste imediato, modalidades de outros fluxos)."

export function analysis(overrides: Partial<ModelCallAnalysis> = {}): ModelCallAnalysis {
  return {
    scenario: { customerNeed: "Parar a cobrança depois do cancelamento e contestar a mensalidade de agosto", conditions: [{ text: "Pedido de cancelamento aberto e não concluído", evidence: [T3] }, { text: "Cliente segue sendo cobrada", evidence: [{ turn: "T2", speaker: "CLIENTE", quote: "Cancelei o plano em julho e continuo sendo cobrada." }] }], procedure: "D1", procedureRationale: null, pathSections: [section("Cobrança após cancelamento"), section("Recapitulação")], correctPath: "Contestar, informar prazo e recapitular.", pathTaken: "Contestou, informou prazo e recapitulou.", pathAssessment: "CORRECT", pathRationale: "Seguiu o caminho.", pathEvidence: [] },
    criteria: [
      { line: line("Contestar cobranças posteriores"), status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [{ turn: "T5", speaker: "OPERADOR", quote: "Registrei a contestação da mensalidade de agosto." }], opportunityTurn: null, rationale: "Registrou a contestação.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL" },
      { line: line("Informar prazo"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T6", speaker: "OPERADOR", quote: "A análise leva até cinco dias úteis." }], opportunityTurn: null, rationale: "Informou o prazo.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "CENTRAL" },
      { line: line("Corrigir o status"), status: "NOT_OBSERVABLE", evidenceKind: "NONE", evidence: [], opportunityTurn: null, rationale: "Ação de sistema que a conversa não mostra.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL" },
      { line: line("Ação realizada"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T6", speaker: "OPERADOR", quote: "Resumindo: contestação registrada, protocolo 4455." }], opportunityTurn: null, rationale: "Recapitulou a contestação.", materiality: "MEDIUM", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "SUPPORTING" },
      { line: line("Protocolo"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T6", speaker: "OPERADOR", quote: "Resumindo: contestação registrada, protocolo 4455." }], opportunityTurn: null, rationale: "Informou o protocolo.", materiality: "MEDIUM", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "SUPPORTING" },
    ],
    sectionDispositions: [],
    // Justificativa GENÉRICA de grupo que atravessa duas seções e leva junto itens ligados ao cancelamento pendente.
    groupDispositions: [{ lines: [line("Serviço cancelado"), line("Próximo passo do pedido"), line("Emitir conta ajustada")], status: "NOT_APPLICABLE", rationale: GENERIC }],
    sourceConflicts: [],
    limitations: [],
    contractViolations: [],
    ...overrides,
  }
}
export const confirmAllClaims = (model: ModelCallAnalysis, exclusions: ExclusionVerdict[] = []): CallReview => {
  const preliminary = verifyCallAnalysis({ model, context, projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: false })
  return {
    claims: new Map(preliminary.criteria.filter((criterion) => ["MET", "NOT_MET", "PARTIAL"].includes(criterion.proposedStatus)).map((criterion) => [criterion.lineHandle, { id: criterion.lineHandle, verdict: "CONFIRMED" as const, issues: [], listReading: "CUMULATIVE" as const, conditionEvidence: [T3], counterEvidence: [], note: null }])),
    path: { verdict: "CONFIRMED", issues: [], note: null },
    lines: [],
    exclusions: new Map(exclusions.map((entry) => [entry.id, entry])),
    violations: [],
  }
}
export const challenge = (id: string, fields: Partial<ExclusionVerdict>): ExclusionVerdict => ({ id, verdict: "CHALLENGED", proposedStatus: null, itemNature: null, scenarioRole: null, issues: [], listReading: null, conditionEvidence: [], evidence: [], opportunityTurn: null, note: null, ...fields })
export const verified = (model: ModelCallAnalysis, review: CallReview) => verifyCallAnalysis({ model, context, projection, transcriptStatus: "COMPLETE", interactionId: INTERACTION, subjectAnchoredDocumentIds: [DOC], repairAttempted: false, review: { attempted: true, review, error: null } })
export const criterionOf = (result: ReturnType<typeof verified>, text: string) => result.criteria.find((criterion) => criterion.text.includes(text))

/** Brief como o motor monta (com a lista de cada item, para o redator ler a regra com a abertura e os irmãos). */
export const briefOf = (result: ReturnType<typeof verified>, keys = true) => buildMonitoringBrief({ analysis: result, listContext: listContextOf(context), interactionId: INTERACTION, label: "Contestação de cobrança", dateLabel: "21/08/2026", selectionReason: "teste", criterionKeys: keys ? new Map(result.criteria.map((criterion) => [criterion.lineKey, `KC-${criterion.lineHandle}`])) : new Map(), documentTitles: new Map([[DOC, "Procedimento"]]), documentVersions: new Map(), history: new Map(), delivered: new Set() })
