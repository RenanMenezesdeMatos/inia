import { projectDisplayEvidence, type DisplayProjectionContext } from "../../investigation/domain/feedback-display-evidence.js"
import type { ApplicabilityResolution } from "./applicability-resolution.js"
import type { VerifiedProcessAssessment } from "./process-assessment.js"
import { stepTitleOf } from "./process-items.js"
import type { ApplicabilityPointView, ReliableFact, ReliableItemDraft, ReliableWording } from "./reliable-feedback-item.js"

/**
 * V1.7.1b — PONTO DE APLICABILIDADE ("Vale confirmar o produto"), domínio puro. Nasce de uma resolução INFERRED/AMBIGUOUS
 * verificada: o produto não foi confirmado, então as etapas que dependem dele NÃO foram avaliadas (process-assessment.ts) — e o
 * colaborador vê isso com honestidade, não como erro:
 *
 *   o que ficou incerto (frase do sistema) → a fala do operador sobre o ponto que muda (conferida) → "compatível com X" pela
 *   comparação determinística de quantidades (nunca "correto"), ou "não corresponde a nenhum" (inconsistência factual, sem dizer
 *   qual era o aplicável) → o que a base prevê para cada produto (documento, trecho literal, link) → não é classificado como erro
 *   → como aplicar + exemplo de condução para CONFIRMAR o produto (sem valor de nenhum candidato).
 *
 * Todo o texto é do SISTEMA (nenhuma redação de IA): a disposição é READY por construção (`SYSTEM_RENDERED_NEUTRAL`) e não passa
 * por QA; a estrutura ainda precisa ser emitível. UNKNOWN (sem candidatos verificados) não gera ponto: não há o que mostrar sem
 * inventar produto.
 */
export const APPLICABILITY_SAFE_MEANING = "o produto/processo desta chamada não foi confirmado; as etapas que dependem dele não foram avaliadas e nada disso é erro do colaborador"

const list = (values: readonly string[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} ou ${values[values.length - 1]}`)
const listAnd = (values: readonly string[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`)

function viewOf(resolution: ApplicabilityResolution, affectedSteps: string[], sample: ApplicabilityPointView["sample"] = null): ApplicabilityPointView {
  return {
    ref: resolution.ref,
    status: resolution.status as "INFERRED" | "AMBIGUOUS",
    resolvedProduct: resolution.resolvedProduct,
    statementComparison: resolution.statementComparison,
    compatibleProducts: resolution.compatibleProducts,
    candidates: resolution.candidates.map((candidate) => ({ product: candidate.product, documentId: candidate.documentId, documentTitle: candidate.documentTitle, heading: candidate.heading, quote: candidate.quote, href: candidate.href })),
    affectedSteps,
    sample,
  }
}

/** A frase do sistema sobre o que ficou incerto (nunca "você não identificou"). */
export function uncertaintySentence(view: ApplicabilityPointView): string {
  const products = view.candidates.map((candidate) => candidate.product)
  if (view.sample) return `Em ${view.sample.affected} de ${view.sample.analyzed} atendimentos analisados não foi possível confirmar qual produto estava sendo tratado${products.length > 1 ? ` (${list(products)})` : ""}.`
  if (view.status === "INFERRED" && view.resolvedProduct) return `Há indícios de que o produto tratado seja ${view.resolvedProduct}, mas não foi possível confirmar essa identificação com os dados disponíveis.`
  return `Não foi possível identificar com segurança se a solicitação estava relacionada a ${list(products)}.`
}

/** "compatível com X" (nunca "correto") ou "não corresponde a nenhum" — só com a comparação determinística das quantidades. */
export function statementSentence(view: ApplicabilityPointView): string | null {
  if (view.statementComparison === "COMPATIBLE_WITH_ONE") return `O que você informou é compatível com o procedimento de ${view.compatibleProducts[0]}. Como o produto não foi confirmado, não dá para afirmar que era o procedimento aplicável a este atendimento.`
  if (view.statementComparison === "COMPATIBLE_WITH_SEVERAL") return `O que você informou é compatível com os procedimentos de ${listAnd(view.compatibleProducts)}.`
  if (view.statementComparison === "COMPATIBLE_WITH_NONE") return `O que você informou não corresponde ao que a base prevê para nenhum dos produtos possíveis (${listAnd(view.candidates.map((candidate) => candidate.product))}).`
  return null
}

export const NOT_AN_ERROR_SENTENCE = "Como os procedimentos são diferentes conforme o produto, este ponto não é classificado como erro."

/** Texto do ponto — do SISTEMA, a partir da visão verificada. */
export function applicabilityWording(view: ApplicabilityPointView): ReliableWording {
  const products = view.candidates.map((candidate) => candidate.product)
  return {
    observed: uncertaintySentence(view),
    whyItMatters: NOT_AN_ERROR_SENTENCE,
    whatYouCanDo: "Quando o procedimento muda conforme o produto, confirme qual produto está vinculado à solicitação antes de informar o que depende dele.",
    suggestedResponse: `Antes de seguir, vou confirmar qual produto está vinculado à sua solicitação, porque o procedimento muda conforme o serviço${products.length > 1 ? `: é ${list(products)}?` : "."}`,
  }
}

function applicabilityItem(input: { index: number; view: ApplicabilityPointView; domain: "MONITORING" | "INDICATOR"; statement: { turnRef: string; quote: string } | null; displayContext: DisplayProjectionContext }): ReliableItemDraft {
  const { view } = input
  const projected = input.statement ? projectDisplayEvidence({ turnRef: input.statement.turnRef, speaker: "OPERADOR", quote: input.statement.quote }, { factIndex: 0, evidenceType: "FINDING_EVIDENCE" }, input.displayContext) : null
  const facts: ReliableFact[] = [
    { role: "ANALISE", text: uncertaintySentence(view), truncated: false, masked: false },
    ...(projected?.status === "DISPLAYED" ? [{ role: "OPERADOR" as const, text: projected.text, truncated: projected.truncated, masked: projected.wasRedacted }] : []),
  ]
  return {
    index: input.index,
    claimRef: view.ref,
    domain: input.domain,
    section: "ATTENTION",
    kind: input.domain === "MONITORING" ? "MONITORING_APPLICABILITY_POINT" : "INDICATOR_APPLICABILITY_POINT",
    polarity: "NEUTRAL",
    ownership: "UNKNOWN",
    safeMeaning: APPLICABILITY_SAFE_MEANING,
    guidanceSource: "COACHING_SUGGESTION",
    grounding: "NO_GROUNDED_GUIDANCE",
    knowledge: null,
    process: null,
    facts,
    withheldFacts: projected && projected.status !== "DISPLAYED" ? 1 : 0,
    analysis: null,
    analysisConflicts: [],
    // Sem candidato verificado não há o que mostrar sem inventar produto.
    structuralBlock: view.candidates.length === 0 ? "KNOWLEDGE_NOT_VERIFIED" : null,
    applicability: view,
    audit: { evidence: projected ? [{ turnRef: projected.origin.turnRef, speaker: "OPERADOR", rawSha256: projected.origin.rawSha256 }] : [], rejectedUnits: [] },
  }
}

/** Etapas que ficaram sem avaliação por causa desta resolução (nome = linha literal da regra verificada; nunca texto do modelo). */
function affectedStepsOf(assessment: VerifiedProcessAssessment, ref: string): string[] {
  const refs = new Set(assessment.processes.filter((process) => process.applicabilityRef === ref).flatMap((process) => process.checkpointRefs))
  return [...new Set(assessment.checkpoints.filter((checkpoint) => refs.has(checkpoint.ref) && checkpoint.statusDowngradeReason === "APPLICABILITY_NOT_CONFIRMED").flatMap((checkpoint) => { const title = stepTitleOf(checkpoint.requirement, checkpoint.knowledge?.quote, checkpoint.knowledge?.heading); return title ? [title] : [] }))]
}

/** Monitoria: um ponto por resolução INFERRED/AMBIGUOUS com candidato verificado e algo a mostrar (etapa afetada ou fala). */
export function buildApplicabilityItems(assessment: VerifiedProcessAssessment, displayContext: DisplayProjectionContext, startIndex: number): ReliableItemDraft[] {
  return (assessment.applicability ?? [])
    .filter((resolution) => (resolution.status === "INFERRED" || resolution.status === "AMBIGUOUS") && resolution.candidates.length > 0)
    .flatMap((resolution) => {
      const affected = affectedStepsOf(assessment, resolution.ref)
      return affected.length > 0 || resolution.operatorStatement ? [{ resolution, affected }] : []
    })
    .map(({ resolution, affected }, position) => applicabilityItem({ index: startIndex + position, view: viewOf(resolution, affected), domain: "MONITORING", statement: resolution.operatorStatement, displayContext }))
}

/**
 * Diagnóstico de indicador: UM ponto agregado quando, na amostra, algum atendimento teve o produto não confirmado — as etapas
 * que dependem do produto ficaram fora dos padrões. Candidatos = a união verificada (um por documento).
 */
export function buildSampleApplicabilityItem(assessed: readonly { assessment: VerifiedProcessAssessment }[], startIndex: number): ReliableItemDraft | null {
  const unresolved = assessed.map((entry) => (entry.assessment.applicability ?? []).filter((resolution) => (resolution.status === "INFERRED" || resolution.status === "AMBIGUOUS") && resolution.candidates.length > 0)).filter((list) => list.length > 0)
  if (unresolved.length === 0) return null
  const first = unresolved[0]![0]!
  const candidates = [...new Map(unresolved.flat().flatMap((resolution) => resolution.candidates).map((candidate) => [candidate.documentId, candidate])).values()]
  const affected = [...new Set(assessed.flatMap((entry) => (entry.assessment.applicability ?? []).flatMap((resolution) => affectedStepsOf(entry.assessment, resolution.ref))))]
  const view = viewOf({ ...first, status: "AMBIGUOUS", resolvedProduct: null, candidates, statementComparison: "NO_STATEMENT", compatibleProducts: [] }, affected, { affected: unresolved.length, analyzed: assessed.length })
  return applicabilityItem({ index: startIndex, view: { ...view, ref: "SAMPLE" }, domain: "INDICATOR", statement: null, displayContext: {} })
}
