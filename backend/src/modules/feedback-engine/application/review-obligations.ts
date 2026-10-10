import { createHash } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TranscriptProjection } from "../../investigation/domain/transcript-projection.js"
import { isDeterminate, type AssessedCriterion } from "../domain/call-analysis.js"
import { reviewRuleOf } from "../domain/call-review.js"
import { CALL_ANALYSIS_FORMAT_RETRY } from "../domain/call-analysis-prompt.js"
import type { ModelObligationAnalysis } from "../domain/obligation-analysis.js"
import { obligationClaimOf, OBLIGATION_CONFIRMATION_RESPONSE_SCHEMA, OBLIGATION_CONFIRMATION_SYSTEM_PROMPT, OBLIGATION_REVIEW_RESPONSE_SCHEMA, OBLIGATION_REVIEW_SYSTEM_PROMPT, parseObligationConfirmation, parseObligationReview, renderObligationConfirmationUserTurn, renderObligationReviewUserTurn, type ObligationReviewTargets } from "../domain/obligation-review.js"
import { listItemsInPlayOf, obligationDiscoveriesOf, reviewableGapsOf, situationsInPlayOf, verifyObligationAnalysis, type ObligationConfirmationInput, type ObligationReviewInput } from "../domain/obligation-verification.js"
import type { ProcedureContext, TranscriptStatus } from "../domain/procedure.js"
import type { StageResponse } from "../domain/analysis-recovery.js"
import { isBudgetExhausted } from "./engine-meter.js"
import type { EngineModelPort, EngineModelRequest, ModelCallMetric } from "./ports.js"
import { callModel, type ReviewOutcome, type ReviewPending } from "./analyze-call.js"

const sha = (value: string) => createHash("sha256").update(value).digest("hex")
/** Por que a análise deixou a obrigação sem determinar — dito pelo que ela mesma leu (nunca por palavra-chave). */
function setAsideReasonOf(criterion: AssessedCriterion): string {
  if (criterion.declaredStatus === "NOT_APPLICABLE") return "a analista leu que a condição não aconteceu"
  if (criterion.declaredStatus === "NOT_OBSERVABLE") return criterion.observability === "OUTSIDE_CONVERSATION" ? "a analista leu como execução fora da conversa (sistema/registro)" : "a analista leu que a gravação não permite concluir"
  return "a conclusão da analista não se sustentou pelas próprias leituras dela (papel das falas, partes ou combinação das partes)"
}

/**
 * REVISÃO DA ANÁLISE ORIENTADA AO CASO (`OBLIGATION_REVIEW_V1`) + CONFIRMAÇÃO FOCAL dos achados só da revisão
 * (`REVIEW_DISCOVERY_CONFIRMATION_V1`). Uma revisão por chamada analisada (mesmas fontes da análise): confere as conclusões
 * determinadas, avalia os itens de argumentário aplicável que ficaram sem avaliação e aponta obrigações materiais de fora. O que só
 * ela encontrou vai a UMA confirmação focal (só esses achados, sem a base inteira); sem orçamento ou com falha, fica inconclusivo
 * com o motivo. Resposta paga com o MESMO pedido é reaproveitada (nenhuma chamada). Falha da revisão = pendência (nada confirmado).
 */
export async function reviewObligationAnalysis(deps: { model: EngineModelPort }, input: { model: ModelObligationAnalysis; context: ProcedureContext; projection: TranscriptProjection; transcriptStatus: TranscriptStatus; interactionId: string; subject: string | null; anchored: readonly string[]; storedReviews?: readonly StageResponse[]; storedConfirmations?: readonly StageResponse[] }, metrics: ModelCallMetric[]): Promise<ReviewOutcome> {
  const base = { model: input.model, context: input.context, projection: input.projection, transcriptStatus: input.transcriptStatus, interactionId: input.interactionId, subjectAnchoredDocumentIds: input.anchored }
  const preliminary = verifyObligationAnalysis(base)
  const claims = preliminary.criteria.filter((criterion) => criterion.origin === "ANALYSIS" && isDeterminate(criterion.proposedStatus) && !criterion.ruleConflict).map(obligationClaimOf)
  // Itens sem avaliação que vão à revisora: os do argumentário aplicável (disposição por item) e, como CONTEXTO, os das listas que as
  // obrigações usam e ninguém avaliou (`LIST_COVERAGE_V2`) — ela aponta em `missed` só os que valiam e faltaram.
  const gaps = reviewableGapsOf(preliminary.criteria)
  const inPlay = listItemsInPlayOf(input.model, input.context, preliminary.criteria.filter((criterion) => criterion.origin === "ANALYSIS"))
  const situations = situationsInPlayOf(input.model, input.context, preliminary.criteria.filter((criterion) => criterion.origin === "ANALYSIS"), new Map([["I1", { interactionRef: "I1", interactionId: input.interactionId, projection: input.projection }]]), input.projection)
  const declared = preliminary.scenario.declaredPathAssessment
  // O caminho que a revisora confere é a LEITURA DA ANÁLISE (o que está sendo revisado), nunca o texto vigente do sistema.
  const analystPath = preliminary.scenario.analysisReading ?? { assessment: declared, pathTaken: preliminary.scenario.pathTaken, rationale: preliminary.scenario.pathRationale }
  const targets: ObligationReviewTargets = {
    need: { summary: input.model.need.summary, conditions: preliminary.scenario.conditions.map((condition) => ({ text: condition.text, turns: condition.evidence.map((quote) => quote.turn) })) },
    claims,
    linesToAssess: gaps.map((criterion) => ({ id: criterion.lineHandle, rule: reviewRuleOf({ heading: criterion.heading, leadIn: criterion.leadIn, text: criterion.text, argument: criterion.argument ?? null }) })),
    listItemsInPlay: inPlay.groups.map((group) => ({ obligation: group.obligation, action: group.action, opening: group.opening?.text ?? null, items: group.items.map((item) => ({ line: item.handle, text: item.text })) })),
    situationsInPlay: situations.groups.map((group) => ({ section: group.section, heading: group.heading, situationShownBy: group.evidence.map((quote) => ({ turn: quote.turn, speaker: quote.speaker, quote: quote.quote })), lines: group.lines.map((line) => ({ line: line.handle, text: line.text })) })),
    notAssessed: input.model.notAssessed,
    // V3: o que a análise deixou SEM determinar vai junto — a revisão pode contestar (mesmas linhas, em `missed`); a divergência vai à
    // confirmação focal. Sem isso uma obrigação de informar lida como "fora da conversa" nunca era reexaminada.
    undetermined: preliminary.criteria.filter((criterion) => criterion.origin === "ANALYSIS" && !isDeterminate(criterion.proposedStatus) && !criterion.ruleConflict).map((criterion) => ({
      id: criterion.lineHandle,
      action: criterion.requiredAction ?? null,
      sources: (criterion.sources ?? []).map((source) => ({ line: source.handle, section: source.heading, text: source.text })),
      analysisConclusion: criterion.declaredStatus,
      setAsideBecause: setAsideReasonOf(criterion),
      analystReading: criterion.rationale,
    })),
    path: preliminary.scenario.proposedPathAssessment === "CORRECT" || preliminary.scenario.proposedPathAssessment === "INCORRECT" || preliminary.scenario.proposedPathAssessment === "PARTIALLY_CORRECT" ? { assessment: declared, pathTaken: analystPath.pathTaken, analystReading: analystPath.rationale } : null,
  }
  const requested = { linesToAssess: targets.linesToAssess.map((line) => line.id) }
  const request: EngineModelRequest = { stage: "CALL_REVIEW", systemPrompt: OBLIGATION_REVIEW_SYSTEM_PROMPT, contents: [{ role: "user", text: renderObligationReviewUserTurn({ projection: input.projection, transcriptStatus: input.transcriptStatus, subject: input.subject, context: input.context, targets }) }], responseSchema: OBLIGATION_REVIEW_RESPONSE_SCHEMA, tag: "review:obligations" }
  const requestSha256 = sha(`${request.systemPrompt}\n${request.contents[0]!.text}`)
  let review: ObligationReviewInput = { attempted: true, review: null, error: null, sentClaims: claims, requested, actPlaceRequired: true }
  let raw: StageResponse | null = null
  let reviewReused = false
  let pending: ReviewPending | null = null
  const stored = (input.storedReviews ?? []).find((entry) => entry.requestSha256 === requestSha256)
  const storedParsed = stored ? parseObligationReview(stored.text) : null
  if (stored && storedParsed?.ok) {
    review = { ...review, review: storedParsed.review }
    raw = stored
    reviewReused = true
  } else {
    try {
      const first = await callModel(deps.model, request, metrics)
      let parsed = parseObligationReview(first.text)
      raw = { requestSha256, text: first.text.slice(0, 60_000) }
      if (!parsed.ok) {
        const retry = await callModel(deps.model, { ...request, contents: [...request.contents, { role: "model", text: first.text.slice(0, 20_000) }, { role: "user", text: CALL_ANALYSIS_FORMAT_RETRY }], tag: "review:obligations:retry:format" }, metrics)
        parsed = parseObligationReview(retry.text)
        raw = { requestSha256, text: retry.text.slice(0, 60_000) }
      }
      if (parsed.ok) review = { ...review, review: parsed.review }
      else pending = { reason: "CONTRACT", error: `REVIEW_CONTRACT:${parsed.error}`, attempted: true, cause: null }
    } catch (error) {
      const budget = isBudgetExhausted(error)
      pending = { reason: budget ? "BUDGET" : "TECHNICAL", error: error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN", attempted: !budget, cause: error }
    }
  }
  const legacyView = { attempted: true, review: null, error: pending?.error ?? null }
  if (pending) return { analysis: verifyObligationAnalysis({ ...base, review: { ...review, review: null, error: pending.error } }), review: legacyView, raw: null, reviewReused, pending }
  const verifyWith = (confirmation?: ObligationConfirmationInput) => verifyObligationAnalysis({ ...base, review, ...(confirmation ? { confirmation } : {}) })
  const analysis = verifyWith()
  const discoveries = obligationDiscoveriesOf(analysis.criteria)
  if (discoveries.length === 0) return { analysis, review: legacyView, raw, reviewReused, pending: null, confirmationRaw: null }
  // CONFIRMAÇÃO FOCAL: só os achados pendentes, com o texto das linhas de origem e a transcrição inteira.
  const confirmationClaims = discoveries.map(obligationClaimOf)
  const confirmationRequest: EngineModelRequest = { stage: "CALL_CONFIRMATION", systemPrompt: OBLIGATION_CONFIRMATION_SYSTEM_PROMPT, contents: [{ role: "user", text: renderObligationConfirmationUserTurn({ projection: input.projection, transcriptStatus: input.transcriptStatus, subject: input.subject, claims: confirmationClaims }) }], responseSchema: OBLIGATION_CONFIRMATION_RESPONSE_SCHEMA, tag: "confirmation:obligations" }
  const confirmationSha = sha(`${confirmationRequest.systemPrompt}\n${confirmationRequest.contents[0]!.text}`)
  const storedConfirmation = (input.storedConfirmations ?? []).find((entry) => entry.requestSha256 === confirmationSha)
  const storedConfirmationParsed = storedConfirmation ? parseObligationConfirmation(storedConfirmation.text) : null
  if (storedConfirmation && storedConfirmationParsed?.ok) return { analysis: verifyWith({ attempted: true, claims: storedConfirmationParsed.claims, error: null, reason: null, sentClaims: confirmationClaims, actPlaceRequired: true }), review: legacyView, raw, reviewReused, pending: null, confirmationRaw: storedConfirmation }
  try {
    const response = await callModel(deps.model, confirmationRequest, metrics)
    const parsed = parseObligationConfirmation(response.text)
    const confirmationRaw = { requestSha256: confirmationSha, text: response.text.slice(0, 60_000) }
    if (!parsed.ok) return { analysis: verifyWith({ attempted: true, claims: null, error: `CONFIRMATION_CONTRACT:${parsed.error}`, reason: "CONTRACT", sentClaims: confirmationClaims, actPlaceRequired: true }), review: legacyView, raw, reviewReused, pending: null, confirmationRaw }
    return { analysis: verifyWith({ attempted: true, claims: parsed.claims, error: null, reason: null, sentClaims: confirmationClaims, actPlaceRequired: true }), review: legacyView, raw, reviewReused, pending: null, confirmationRaw }
  } catch (error) {
    const budget = isBudgetExhausted(error)
    return { analysis: verifyWith({ attempted: true, claims: null, error: error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN", reason: budget ? "BUDGET" : "TECHNICAL", sentClaims: confirmationClaims, actPlaceRequired: true }), review: legacyView, raw, reviewReused, pending: null, confirmationRaw: null }
  }
}
