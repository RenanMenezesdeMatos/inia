import { DomainError } from "../../../shared/domain/domain-error.js"
import { renderClaimCandidates, type ClaimCandidate } from "../domain/claim-candidates.js"
import { CLAIM_SCOPE_LABELS, claimResidueIn, claimSupportHandleOf, correctionCategoriesOf, DEFAULT_CLAIM_SCOPE, factRefsFromBinding, flattenGating, gateSynthesisDetailed, hasSynthesisEnvelope, parseSynthesisFields, rejectionCategoryOf, renderClaimCorrection, renderClaimSupportsLine, renderEnvelopeCorrection, renderGatingCorrection, representativenessOf, sanitizeLedgerSummaryForCollaborator, stripInternalRefs, temporalConclusionFor, type ClaimRejection, type ClaimSupportOptions, type ClaimVerdict, type GatingContext, type SynthesisGating } from "../domain/evidence-gating.js"
import { isUndeclaredCriticalFacts } from "../domain/decision-critical-facts.js"
import type { LedgerEntry } from "../domain/evidence-ledger.js"
import type { ClaimScope, EvidenceGatingResult, InvestigationSynthesis } from "../domain/tool-trace.js"
import { extractMarkerPayload, type MarkerParseStatus } from "../../../shared/application/prompting/structured-markers.js"
import { checkTemporalConclusionCompatibility, supportScopeIndex, TEMPORAL_SAFE_MEANINGS, type TemporalConclusion, type TemporalRelation, type TemporalSupportScope } from "../domain/temporal-semantics.js"

/**
 * EVIDENCE GATING EM RESPOSTAS DE TEXTO (V1.2 — especialista, chat/voz, Agent em texto livre):
 * o modelo termina a resposta com UMA linha `EVIDENCE_JSON:` (mesmos campos internos da síntese
 * estruturada — hipóteses, limitações, afirmações com refs/escopo, base das recomendações); a
 * aplicação extrai a linha (nunca mostrada ao usuário), valida por código e, se rejeitar, pede UMA
 * correção. Persistindo, a resposta é substituída pela versão factual (só o que o ledger sustenta)
 * — nunca chega ao usuário uma afirmação comportamental sem evidência. Sem chain-of-thought.
 *
 * FAIL-CLOSED (V1.3 — §2/3): envelope AUSENTE ou inválido nunca vale como "zero afirmações" — é uma
 * resposta NÃO VALIDÁVEL: uma correção pedindo o envelope; persistindo, o mesmo destino da violação
 * (fallback factual determinístico no chat/voz; descarte no Workflow). O fallback nunca reaproveita
 * texto comportamental do modelo. Tudo fica no trace (`evidenceGating`: envelopePresent, parseStatus,
 * correctionAttempted/Succeeded, fallbackUsed) — o QA Lab mostra.
 */
export const EVIDENCE_MARKER = "EVIDENCE_JSON:"
export { renderGatingCorrection }

/** Parte ESTÁTICA das instruções de evidência para texto (formato + regras) — sem a lista de refs desta execução. */
export function renderTextEvidenceRules(options?: { claimRefsLabel?: string }): string {
  return [
    `EVIDÊNCIA DA RESPOSTA: ao terminar a resposta normal, adicione UMA linha própria começando exatamente com "${EVIDENCE_MARKER}" seguida de um JSON válido (objeto, sem markdown; nada mais na mesma linha; um único EVIDENCE_JSON por resposta — outros marcadores internos, se pedidos, vão cada um em linha própria) no formato`,
    `{"supportedHypotheses":["…(refs)"],"unsupportedHypotheses":["…"],"limitations":["…"],"behavioralClaims":[{"text":"cada afirmação da resposta sobre o que o colaborador FAZ na chamada (números do indicador/tendência/jornada NÃO entram aqui)","evidenceRefs":["refs"],"candidateRef":"CC-n (quando a execução listar candidatos: único campo de vínculo — tipo, polaridade e escopo vêm do candidato)","scope":"INTERACTION_SPECIFIC|PERIOD_PATTERN|EMPLOYEE_PATTERN|POPULATION_PATTERN (só sem candidatos)","support":{"type":"PATTERN|FINDING","patternRef":"SP-n","findingRef":"SF-n"},"polarity":"POSITIVE|NEGATIVE|NEUTRAL|MIXED (só sem candidatos)"}],"recommendationSupport":[{"text":"cada ação recomendada","basis":"OBSERVED_EVIDENCE|KNOWLEDGE_GUIDANCE|GENERAL_DEVELOPMENT_SUGGESTION","evidenceRefs":[]}],"consideredCriticalFacts":["refs dos fatos críticos à decisão considerados (valor × meta, tendência, comparação, qualidade do dado)"]}`,
    `As refs são internas: nunca as escreva no texto da resposta${options?.claimRefsLabel ? ` (${options.claimRefsLabel})` : ""}. Afirmação sobre comportamento sem fato de interação/transcrição NÃO pode aparecer como observação — use linguagem factual e declare a limitação. Poucas interações sustentam só INTERACTION_SPECIFIC ("na(s) interação(ões) analisada(s)…"), nunca "você costuma/sempre…". SUPORTE: quando a execução lista CANDIDATOS DE AFIRMAÇÃO (CC-n), cada claim traz apenas "candidateRef" (um CC-n existente) e o texto — tipo, polaridade, escopo e suporte já vêm do candidato e não podem ser contraditos pelo texto. Sem candidatos, cada claim traz exatamente um "support" selecionado entre os handles da linha "Suportes de claim válidos" (SP-n pattern; SF-n finding), copiado exatamente — nunca F-n, F-n/P-n, I-n/F-n, listas ou "N/A"; a claim nunca excede o teto de claim do pattern ("claim até …"): teto INTERACTION_SPECIFIC = "observado em N das M analisadas"; teto PERIOD_PATTERN = "no período analisado"; só teto EMPLOYEE_PATTERN autoriza "você costuma/o colaborador apresenta…". OBSERVED_EVIDENCE exige refs; KNOWLEDGE_GUIDANCE exige documento real; GENERAL_DEVELOPMENT_SUGGESTION deve soar como sugestão. A linha ${EVIDENCE_MARKER} é OBRIGATÓRIA (sem ela a resposta é descartada por código) e não é mostrada ao usuário.`,
  ].join("\n")
}

/** Linha DINÂMICA: as refs válidas desta execução e (V1.4.2) o enum dinâmico de suportes de claim (SP-n/SF-n existentes). */
export function renderTextEvidenceRefsLine(refs: string[], options?: { transcriptRef?: string; supports?: ClaimSupportOptions | undefined; candidates?: ClaimCandidate[] | undefined }): string {
  const refList = refs.length > 0 ? refs.join(", ") : "(nenhum fato disponível)"
  const line = `Refs válidas para a linha ${EVIDENCE_MARKER}: ${refList}${options?.transcriptRef ? ` (${options.transcriptRef} = a transcrição em foco)` : ""}.`
  // V1.4.4: candidatos substituem a lista de suportes quando existem.
  if (options?.candidates && options.candidates.length > 0) return `${line}\n${renderClaimCandidates(options.candidates)}`
  return `${line}${options?.supports ? `\n${renderClaimSupportsLine(options.supports)}` : ""}`
}

export function renderTextEvidenceInstructions(refs: string[], options?: { transcriptRef?: string; claimRefsLabel?: string }): string {
  const refList = refs.length > 0 ? refs.join(", ") : "(nenhum fato disponível)"
  return [
    `EVIDÊNCIA DA RESPOSTA: ao terminar a resposta normal, adicione UMA linha própria começando exatamente com "${EVIDENCE_MARKER}" seguida de um JSON válido (objeto, sem markdown, sem texto depois) no formato`,
    `{"supportedHypotheses":["…(refs)"],"unsupportedHypotheses":["…"],"limitations":["…"],"behavioralClaims":[{"text":"cada afirmação da resposta sobre o que o colaborador FAZ na chamada (números do indicador/tendência/jornada NÃO entram aqui)","evidenceRefs":["refs"],"scope":"INTERACTION_SPECIFIC|PERIOD_PATTERN|EMPLOYEE_PATTERN|POPULATION_PATTERN","patternRef":"F-n/P-n (obrigatório para PERIOD/EMPLOYEE)","findingRef":"I-ref/F-id (INTERACTION_SPECIFIC)","polarity":"POSITIVE|NEGATIVE|NEUTRAL|MIXED"}],"recommendationSupport":[{"text":"cada ação recomendada","basis":"OBSERVED_EVIDENCE|KNOWLEDGE_GUIDANCE|GENERAL_DEVELOPMENT_SUGGESTION","evidenceRefs":[]}]}`,
    `Refs válidas: ${refList}${options?.transcriptRef ? ` (${options.transcriptRef} = a transcrição em foco)` : ""}${options?.claimRefsLabel ? ` — ${options.claimRefsLabel}` : ""}. As refs são internas: nunca as escreva no texto da resposta. Afirmação sobre comportamento sem fato de interação/transcrição NÃO pode aparecer como observação — use linguagem factual e declare a limitação. Poucas interações sustentam só INTERACTION_SPECIFIC ("na(s) interação(ões) analisada(s)…"), nunca "você costuma/sempre…". OBSERVED_EVIDENCE exige refs; KNOWLEDGE_GUIDANCE exige documento real; GENERAL_DEVELOPMENT_SUGGESTION deve soar como sugestão. A linha ${EVIDENCE_MARKER} é interna e não é mostrada ao usuário.`,
  ].join("\n")
}

export type EnvelopeParseStatus = "PARSED" | "MISSING" | "INVALID"

/**
 * Separa o texto do usuário do JSON interno. Nunca lança: `parseStatus` diz se o envelope veio (PARSED),
 * faltou (MISSING) ou era inválido (INVALID); `markerStatus` detalha o framing (V1.3.2 — §6): VALID,
 * MARKER_NOT_FOUND, MARKER_DUPLICATE, MARKER_PAYLOAD_INVALID, MARKER_BOUNDARY_ERROR. O bloco é delimitado por
 * scanner balanceado — um marcador seguinte (ex.: SUPPORT_MATERIALS_JSON) NUNCA é engolido e permanece no `text`
 * para o parser dele.
 */
export function extractEvidenceMarker(rawText: string): { text: string; synthesis: InvestigationSynthesis; present: boolean; parseStatus: EnvelopeParseStatus; markerStatus: MarkerParseStatus } {
  const extraction = extractMarkerPayload(rawText, EVIDENCE_MARKER)
  const text = stripInternalRefs(extraction.text)
  if (extraction.status === "MARKER_NOT_FOUND") return { text, synthesis: parseSynthesisFields(undefined), present: false, parseStatus: "MISSING", markerStatus: extraction.status }
  if (extraction.status !== "VALID") return { text, synthesis: parseSynthesisFields(undefined), present: false, parseStatus: "INVALID", markerStatus: extraction.status }
  if (!hasSynthesisEnvelope(extraction.payload)) return { text, synthesis: parseSynthesisFields(extraction.payload), present: false, parseStatus: "INVALID", markerStatus: "MARKER_PAYLOAD_INVALID" }
  return { text, synthesis: parseSynthesisFields(extraction.payload), present: true, parseStatus: "PARSED", markerStatus: "VALID" }
}

export type TextGatingOutcome = { text: string; synthesis: InvestigationSynthesis; gating: EvidenceGatingResult; replacedByFactual: boolean }

export type FactualFallbackInput = {
  ledger: LedgerEntry[]
  limitations: string[]
  /** Síntese do modelo (já parseada) — só as partes VALIDÁVEIS entram: orientação de base real, limitações declaradas. Nunca claims. */
  synthesis?: InvestigationSynthesis | undefined
  knowledgeAvailable?: boolean | undefined
  reason?: "ENVELOPE_MISSING" | "CLAIMS_REJECTED" | undefined
}

/**
 * SAFE FACTUAL FALLBACK (V1.3 — §3): resposta determinística composta só do que a aplicação
 * validou — fatos do ledger (com qualidade), limitações (da aplicação + declaradas), orientação de
 * procedimento quando há base real. Nunca reaproveita texto comportamental do modelo; nunca inventa.
 */
export function renderFactualFallback(ledger: LedgerEntry[], limitations: string[], options: Omit<FactualFallbackInput, "ledger" | "limitations"> = {}): string {
  const facts = ledger.filter((entry) => entry.ref !== "TRANSCRICAO")
  const declared = [...new Set([...limitations, ...(options.synthesis?.limitations ?? [])])]
  const guidance = options.knowledgeAvailable ? (options.synthesis?.recommendationSupport ?? []).filter((item) => item.basis === "KNOWLEDGE_GUIDANCE").map((item) => stripInternalRefs(item.text)) : []
  const opening = options.reason === "ENVELOPE_MISSING"
    ? "A resposta gerada não pôde ser validada contra as evidências, então ela foi limitada aos fatos apurados pela aplicação:"
    : "Não foi possível sustentar com evidência as afirmações sobre comportamento desta resposta, então ela foi limitada aos fatos apurados:"
  return [
    opening,
    facts.length > 0 ? facts.map((entry) => `- ${sanitizeLedgerSummaryForCollaborator(entry.summary)}${entry.qualityNote ? ` (${entry.qualityNote})` : ""}`).join("\n") : "- Nenhum fato foi apurado nesta análise.",
    ...(guidance.length > 0 ? [`Orientação do procedimento (base de conhecimento): ${guidance.join("; ")}.`] : []),
    ...(declared.length > 0 ? [`Limitações: ${declared.join("; ")}.`] : []),
    "A amostra de interações disponível não é suficiente para afirmar uma causa comportamental com segurança.",
  ].join("\n")
}

/**
 * CLAIM SALVAGE (V1.4.3 — §2–§12). Antes, UMA afirmação inválida derrubava a síntese inteira: correção global → fallback
 * factual, apagando findings/patterns/claims corretos do mesmo output (3 de 8 runs na V1.4.2). Agora o gating é por
 * unidade semântica:
 *   1ª passada → verdito por claim (aceita / rejeitada, com motivo, suporte congelado, polaridade e escopo permitidos);
 *   correção LOCAL só das rejeitadas (as aceitas são citadas para serem mantidas);
 *   2ª passada → aceita o que passou (ACCEPTED_CORRECTED), DESCARTA o que insistiu — sem derrubar as irmãs.
 * O fallback inteiro vira último recurso (§9): nenhuma afirmação segura sobreviveu, resíduo de afirmação descartada no
 * texto entregue, problema global do texto (fato crítico contradito, linguagem temporal/procedimental) ou envelope ausente.
 * A troca de suporte para "fazer passar" é proibida (§6): mesma afirmação com outro SP-n/SF-n é rejeitada por código.
 */
export type ClaimSalvage = {
  outcome: "PARTIAL" | "FULL_FALLBACK"
  reason: "ENVELOPE_MISSING" | "CLAIMS_REJECTED" | "UNISOLABLE_TEXT" | "NO_SAFE_CLAIM" | null
  synthesis: InvestigationSynthesis
  outcomes: NonNullable<EvidenceGatingResult["claimOutcomes"]>
  counters: { claimsProposed: number; claimsAcceptedFirstPass: number; claimsCorrectionRequired: number; claimsCorrected: number; claimsDropped: number; claimsPreservedAfterSiblingFailure: number; recommendationsDropped: number; claimCandidatesAvailable: number; claimCandidatesSelected: number; claimCandidatesDelivered: number; textPolarityMismatch: number; textScopeMismatch: number; candidateSwapRejected: number; duplicateCandidateSelection: number }
  persistentRejections: ClaimRejection[]
}

const normalizedClaimKey = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()

/**
 * Afirmação da 2ª passada que é a MESMA da 1ª (texto idêntico a menos de caixa/pontuação) mas trocou de CANDIDATO (V1.4.4 §40)
 * ou de suporte (V1.4.3 §6) — a identidade do que sustenta a afirmação é congelada na correção.
 */
function supportSwapped(verdict: ClaimVerdict, firstRejected: ClaimVerdict[], ledger: GatingContext["ledger"]): string | null {
  const key = normalizedClaimKey(verdict.claim.text)
  const previous = firstRejected.find((item) => normalizedClaimKey(item.claim.text) === key)
  if (!previous) return null
  const beforeCandidate = previous.claim.candidateRef?.trim().toUpperCase() ?? null
  const afterCandidate = verdict.claim.candidateRef?.trim().toUpperCase() ?? null
  if (beforeCandidate && afterCandidate && beforeCandidate !== afterCandidate) return `CLAIM_CANDIDATE_SWAPPED: a mesma afirmação trocou o candidato ${beforeCandidate} por ${afterCandidate} na correção — a identidade do candidato é congelada`
  const before = claimSupportHandleOf(previous.claim, ledger)
  const after = claimSupportHandleOf(verdict.claim, ledger)
  return before && after && before !== after ? `CLAIM_SUPPORT_SWAPPED: a mesma afirmação trocou o suporte ${before} por ${after} na correção — a identidade do suporte é congelada` : null
}

/**
 * Decide o destino da 2ª passada preservando o que é válido. `deliveredText` é o que o humano leria (texto livre ou os
 * campos de texto do JSON) — é nele que a aplicação confere resíduo de afirmação descartada (§11/§12).
 */
export function salvageClaims(input: {
  firstGating: SynthesisGating
  retryGating: SynthesisGating
  retrySynthesis: InvestigationSynthesis
  deliveredText: string
  ledger: GatingContext["ledger"]
}): ClaimSalvage {
  const firstRejected = input.firstGating.claims.filter((verdict) => verdict.status === "REJECTED")
  const outcomes: NonNullable<EvidenceGatingResult["claimOutcomes"]> = []
  const accepted: ClaimVerdict[] = []
  const dropped: ClaimVerdict[] = []
  const persistent: ClaimRejection[] = []
  // ACCEPTED = a afirmação já existia (e já passava) na 1ª resposta; ACCEPTED_CORRECTED = nasceu/mudou na correção local.
  const acceptedBefore = new Set(input.firstGating.claims.filter((verdict) => verdict.status === "ACCEPTED").map((verdict) => normalizedClaimKey(verdict.claim.text)))
  const cameFromCorrection = (verdict: ClaimVerdict) => !acceptedBefore.has(normalizedClaimKey(verdict.claim.text))
  for (const verdict of input.retryGating.claims) {
    const swapped = verdict.status === "ACCEPTED" ? supportSwapped(verdict, firstRejected, input.ledger) : null
    if (verdict.status === "ACCEPTED" && !swapped) {
      accepted.push(verdict)
      outcomes.push({ text: verdict.claim.text, status: cameFromCorrection(verdict) ? "ACCEPTED_CORRECTED" : "ACCEPTED", reason: null, category: null })
      continue
    }
    const rejections = swapped ? [{ kind: "CLAIM_BINDING" as const, text: verdict.claim.text, reason: swapped }] : verdict.rejections
    dropped.push(verdict)
    persistent.push(...rejections)
    outcomes.push({ text: verdict.claim.text, status: "DROPPED", reason: rejections.map((item) => item.reason).join(" | "), category: rejections[0] ? rejectionCategoryOf(rejections[0]) : null })
  }
  // §10 — RECOMENDAÇÃO: cai se foi rejeitada pelo gating, se repete uma afirmação descartada ou se sua única base eram os
  // fatos que só a afirmação descartada sustentava. Recomendação ligada a uma afirmação aceita sobrevive.
  const refsOf = (verdicts: ClaimVerdict[]) => new Set(verdicts.flatMap((verdict) => [...verdict.claim.evidenceRefs, ...(verdict.candidate ? [verdict.candidate.provenance.factRef] : []), ...factRefsFromBinding(verdict.claim, input.ledger)].map((ref) => ref.trim().toUpperCase())))
  const droppedRefs = refsOf(dropped)
  const acceptedRefs = refsOf(accepted)
  const rejectedRecommendationTexts = new Set(input.retryGating.recommendations.map((item) => item.text))
  const keptRecommendations = input.retrySynthesis.recommendationSupport.filter((recommendation) => {
    if (rejectedRecommendationTexts.has(recommendation.text)) return false
    if (dropped.some((verdict) => claimResidueIn(recommendation.text, verdict.claim.text))) return false
    if (recommendation.basis !== "OBSERVED_EVIDENCE") return true
    const refs = recommendation.evidenceRefs.map((ref) => ref.trim().toUpperCase())
    return !(refs.length > 0 && refs.every((ref) => droppedRefs.has(ref) && !acceptedRefs.has(ref)))
  })
  const recommendationsDropped = input.retrySynthesis.recommendationSupport.length - keptRecommendations.length
  const droppedRecommendations = input.retrySynthesis.recommendationSupport.filter((item) => !keptRecommendations.includes(item))
  // V1.4.4 (§42): candidatos disponíveis × selecionados × entregues, e os erros que sobraram — todos de TEXTO, não de estrutura.
  const allRejections = [...input.firstGating.claims, ...input.retryGating.claims].flatMap((verdict) => verdict.rejections.map((item) => item.reason))
  const counters = {
    claimsProposed: input.firstGating.claims.length,
    claimsAcceptedFirstPass: input.firstGating.claims.filter((verdict) => verdict.status === "ACCEPTED").length,
    claimsCorrectionRequired: firstRejected.length,
    claimsCorrected: outcomes.filter((item) => item.status === "ACCEPTED_CORRECTED").length,
    claimsDropped: dropped.length,
    claimsPreservedAfterSiblingFailure: dropped.length > 0 ? accepted.length : 0,
    recommendationsDropped,
    claimCandidatesAvailable: input.retryGating.candidates.length || input.firstGating.candidates.length,
    claimCandidatesSelected: new Set([...input.firstGating.claims, ...input.retryGating.claims].map((verdict) => verdict.claim.candidateRef?.trim().toUpperCase()).filter((ref): ref is string => Boolean(ref))).size,
    claimCandidatesDelivered: new Set(accepted.map((verdict) => verdict.claim.candidateRef?.trim().toUpperCase()).filter((ref): ref is string => Boolean(ref))).size,
    textPolarityMismatch: allRejections.filter((reason) => reason.startsWith("TEXT_POLARITY_MISMATCH")).length,
    textScopeMismatch: allRejections.filter((reason) => reason.startsWith("TEXT_SCOPE_MISMATCH")).length,
    candidateSwapRejected: persistent.filter((item) => item.reason.startsWith("CLAIM_CANDIDATE_SWAPPED") || item.reason.startsWith("CLAIM_SUPPORT_SWAPPED")).length,
    duplicateCandidateSelection: allRejections.filter((reason) => reason.startsWith("DUPLICATE_CANDIDATE_SELECTION")).length,
  }
  const synthesis: InvestigationSynthesis = { ...input.retrySynthesis, behavioralClaims: accepted.map((verdict) => verdict.claim), recommendationSupport: keptRecommendations }
  // §9 — o que NÃO dá para isolar: resíduo da afirmação/recomendação descartada no texto entregue e rejeições globais
  // (fato crítico contradito, linguagem temporal/procedimental do texto). Nesses casos, fallback inteiro.
  const residue = [...dropped.map((verdict) => verdict.claim.text), ...droppedRecommendations.map((item) => item.text)].some((text) => claimResidueIn(input.deliveredText, text))
  // Rejeições GLOBAIS que sobrevivem à correção não são isoláveis: o fato crítico contradito, a linguagem temporal/procedimental
  // do texto e uma RECOMENDAÇÃO sem base são conteúdo entregue em prosa — a aplicação não reescreve texto, então cai o todo.
  const globalPersisting = [...input.retryGating.criticalFacts.filter((item) => !isUndeclaredCriticalFacts(item)), ...input.retryGating.transversal, ...input.retryGating.recommendations]
  if (residue || globalPersisting.length > 0) return { outcome: "FULL_FALLBACK", reason: "UNISOLABLE_TEXT", synthesis, outcomes, counters, persistentRejections: [...persistent, ...globalPersisting] }
  // Nenhuma afirmação segura sobrevive (§9) — mas só quando a resposta corrigida AINDA afirma comportamento: se o modelo
  // removeu as afirmações e entregou um texto factual, isso é a correção funcionando (V1.3), não um fallback.
  if (accepted.length === 0 && input.retryGating.claims.length > 0) return { outcome: "FULL_FALLBACK", reason: "NO_SAFE_CLAIM", synthesis, outcomes, counters, persistentRejections: persistent }
  return { outcome: "PARTIAL", reason: null, synthesis, outcomes, counters, persistentRejections: persistent }
}

/** Contadores de candidatos numa resposta aceita de primeira (sem correção) — V1.4.4 §42. */
function candidateCountersOf(gating: SynthesisGating): { claimCandidatesAvailable: number; claimCandidatesSelected: number; claimCandidatesDelivered: number; textPolarityMismatch: number; textScopeMismatch: number; candidateSwapRejected: number; duplicateCandidateSelection: number } {
  const selected = new Set(gating.claims.map((verdict) => verdict.claim.candidateRef?.trim().toUpperCase()).filter((ref): ref is string => Boolean(ref)))
  return { claimCandidatesAvailable: gating.candidates.length, claimCandidatesSelected: selected.size, claimCandidatesDelivered: selected.size, textPolarityMismatch: 0, textScopeMismatch: 0, candidateSwapRejected: 0, duplicateCandidateSelection: 0 }
}

/** Correção LOCAL da 1ª passada (só o que falhou) — ou a correção global de sempre quando não há verdito por claim. */
function renderLocalCorrection(gating: SynthesisGating, context: GatingContext): string {
  const rejected = gating.claims.filter((verdict) => verdict.status === "REJECTED")
  const global = [...gating.criticalFacts, ...gating.transversal, ...gating.recommendations]
  if (rejected.length === 0) return renderGatingCorrection(global)
  const conclusion = temporalConclusionFor(context.ledger)
  return renderClaimCorrection({ rejected, accepted: gating.claims.filter((verdict) => verdict.status === "ACCEPTED"), global, temporalConclusion: conclusion.kind === "NOT_COMPARED" ? undefined : conclusion.safeMeaning })
}

/**
 * FAIL-CLOSED: roda `generate` (1ª vez sem correção; 2ª com o bloco de correção) e aplica o gating.
 * Fluxo: envelope presente e parseável? SIM → validar; NÃO → correção pedindo o envelope. Retry
 * válido? SIM → validar; NÃO → fallback. `onPersistentFailure` = "FACTUAL" (chat/voz: resposta factual
 * determinística) | "THROW" (Workflow: descarta, como a evidência não literal).
 */
export async function gateTextReply(
  generate: (correction: string | null) => Promise<string>,
  context: GatingContext & { limitations?: string[] },
  onPersistentFailure: "FACTUAL" | "THROW",
): Promise<TextGatingOutcome> {
  const representativeness = representativenessOf(context)
  const first = extractEvidenceMarker(await generate(null))
  const firstGating = first.present ? gateSynthesisDetailed(first.synthesis, context, first.text) : null
  const firstRejected = firstGating ? flattenGating(firstGating) : []
  if (first.present && firstRejected.length === 0) {
    return { text: first.text, synthesis: { ...first.synthesis, evidenceRepresentativeness: representativeness }, gating: { rejectedClaims: [], corrected: false, envelopePresent: true, parseStatus: "PARSED", markerStatus: first.markerStatus, correctionAttempted: false, correctionSucceeded: false, fallbackUsed: false, fallbackReason: null, factPreservation: context.criticalFacts && context.criticalFacts.length > 0 ? "DECLARED" : "NOT_APPLICABLE", salvage: "NONE", claimsProposed: firstGating!.claims.length, claimsAcceptedFirstPass: firstGating!.claims.length, claimsCorrectionRequired: 0, claimsCorrected: 0, claimsDropped: 0, claimsPreservedAfterSiblingFailure: 0, ...candidateCountersOf(firstGating!) }, replacedByFactual: false }
  }
  // V1.4.3 (§5): correção LOCAL quando há verdito por claim (as aceitas são preservadas explicitamente).
  const correction = firstGating ? renderLocalCorrection(firstGating, context) : renderEnvelopeCorrection("MARKER_LINE")
  console.warn(JSON.stringify({ event: first.present ? "text_evidence_gating_rejected" : "text_evidence_envelope_missing", parseStatus: first.parseStatus, markerStatus: first.markerStatus, rejected: firstRejected }))
  const retry = extractEvidenceMarker(await generate(`${correction}\n\nRESPOSTA ANTERIOR (a corrigir):\n${first.text}`))
  if (!retry.present) {
    const gating: EvidenceGatingResult = { rejectedClaims: firstRejected, corrected: false, envelopePresent: false, parseStatus: retry.parseStatus, markerStatus: retry.markerStatus, firstAttemptMarkerStatus: first.markerStatus, correctionAttempted: true, correctionSucceeded: false, fallbackUsed: onPersistentFailure === "FACTUAL", fallbackReason: "ENVELOPE_MISSING", correctionCategories: first.present ? correctionCategoriesOf(firstRejected) : ["ENVELOPE"], persistentCategories: ["ENVELOPE"], salvage: "FULL_FALLBACK" }
    if (onPersistentFailure === "THROW") throw new DomainError("A resposta não trouxe o envelope de evidência validável após correção — descartada (fail-closed).", "AGENT_EVIDENCE_ENVELOPE_MISSING", 502)
    const text = renderFactualFallback(context.ledger, context.limitations ?? [], { synthesis: retry.synthesis, knowledgeAvailable: context.knowledgeAvailable, reason: "ENVELOPE_MISSING" })
    return { text, synthesis: { ...retry.synthesis, behavioralClaims: [], evidenceRepresentativeness: representativeness }, gating, replacedByFactual: true }
  }
  const retryGating = gateSynthesisDetailed(retry.synthesis, context, retry.text)
  const salvage = salvageClaims({ firstGating: firstGating ?? emptyGating(), retryGating, retrySynthesis: retry.synthesis, deliveredText: retry.text, ledger: context.ledger })
  const undeclared = retryGating.criticalFacts.some(isUndeclaredCriticalFacts)
  const base = { rejectedClaims: [...firstRejected, ...salvage.persistentRejections], envelopePresent: true, parseStatus: "PARSED" as const, markerStatus: retry.markerStatus, firstAttemptMarkerStatus: first.markerStatus, correctionAttempted: true, factPreservation: (undeclared ? "UNDECLARED" : context.criticalFacts && context.criticalFacts.length > 0 ? "DECLARED" : "NOT_APPLICABLE") as NonNullable<EvidenceGatingResult["factPreservation"]>, correctionCategories: first.present ? correctionCategoriesOf(firstRejected) : ["ENVELOPE" as const], persistentCategories: correctionCategoriesOf(salvage.persistentRejections), claimOutcomes: salvage.outcomes, ...salvage.counters }
  if (salvage.outcome === "PARTIAL") {
    // §8 — PARTIAL SAFE SYNTHESIS: a resposta corrigida é entregue com as afirmações válidas; as descartadas saíram do texto.
    return { text: retry.text, synthesis: { ...salvage.synthesis, evidenceRepresentativeness: representativeness }, gating: { ...base, corrected: true, correctionSucceeded: true, fallbackUsed: false, fallbackReason: null, salvage: salvage.counters.claimsDropped > 0 ? "PARTIAL" : "NONE" }, replacedByFactual: false }
  }
  const gating: EvidenceGatingResult = { ...base, corrected: false, correctionSucceeded: false, fallbackUsed: onPersistentFailure === "FACTUAL", fallbackReason: salvage.reason, salvage: "FULL_FALLBACK" }
  if (onPersistentFailure === "THROW") {
    throw new DomainError(`A resposta mantém afirmações sem evidência após correção (${salvage.persistentRejections.map((item) => `"${item.text}"`).join("; ")}) — descartada.`, "AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM", 502)
  }
  const text = renderFactualFallback(context.ledger, context.limitations ?? [], { synthesis: retry.synthesis, knowledgeAvailable: context.knowledgeAvailable, reason: "CLAIMS_REJECTED" })
  return { text, synthesis: { ...retry.synthesis, behavioralClaims: [], evidenceRepresentativeness: representativeness }, gating, replacedByFactual: true }
}

const emptyGating = (): SynthesisGating => ({ criticalFacts: [], claims: [], transversal: [], recommendations: [], candidates: [] })

export type StructuredGatingOutcome = { raw: string; synthesis: InvestigationSynthesis; gating: EvidenceGatingResult }

/**
 * FAIL-CLOSED para respostas JSON (síntese estruturada do Agent/especialista FEEDBACK): o envelope
 * são os campos internos do próprio JSON. Ausentes/inválidos → correção pedindo os campos; claims
 * rejeitadas → correção de gating; persistindo → descarte (Workflow nunca publica o que não validou).
 * `parseJson` é o parser do chamador (tolerante a texto em volta); `generate` recebe a correção (ou null).
 */
export async function gateStructuredReply(
  generate: (correction: string | null) => Promise<string>,
  parseJson: (raw: string) => unknown,
  context: GatingContext,
  discardMessage: (still: EvidenceGatingResult["rejectedClaims"]) => string,
): Promise<StructuredGatingOutcome> {
  const representativeness = representativenessOf(context)
  const read = (raw: string) => {
    const json = parseJson(raw)
    const present = hasSynthesisEnvelope(json)
    // Texto que o colaborador lê (fact preservation + resíduo de claim descartada) — só campos de texto do JSON.
    const record = (json && typeof json === "object" ? json : {}) as Record<string, unknown>
    const text = ["title", "summary", "observedBehavior", "recommendation"].map((key) => (typeof record[key] === "string" ? (record[key] as string) : "")).join("\n")
    return { present, synthesis: parseSynthesisFields(present ? json : undefined), text }
  }
  let raw = await generate(null)
  const first = read(raw)
  const firstGating = first.present ? gateSynthesisDetailed(first.synthesis, context, first.text) : null
  const firstRejected = firstGating ? flattenGating(firstGating) : []
  if (first.present && firstRejected.length === 0) {
    return { raw, synthesis: { ...first.synthesis, evidenceRepresentativeness: representativeness }, gating: { rejectedClaims: [], corrected: false, envelopePresent: true, parseStatus: "PARSED", correctionAttempted: false, correctionSucceeded: false, fallbackUsed: false, fallbackReason: null, factPreservation: context.criticalFacts && context.criticalFacts.length > 0 ? "DECLARED" : "NOT_APPLICABLE", salvage: "NONE", claimsProposed: firstGating!.claims.length, claimsAcceptedFirstPass: firstGating!.claims.length, claimsCorrectionRequired: 0, claimsCorrected: 0, claimsDropped: 0, claimsPreservedAfterSiblingFailure: 0, ...candidateCountersOf(firstGating!) } }
  }
  const correction = firstGating ? renderLocalCorrection(firstGating, context) : renderEnvelopeCorrection("JSON_FIELDS")
  console.warn(JSON.stringify({ event: first.present ? "agent_evidence_gating_rejected" : "agent_evidence_envelope_missing", rejected: firstRejected }))
  raw = await generate(`${correction}\n\nRESPOSTA ANTERIOR (a corrigir):\n${raw}`)
  const retry = read(raw)
  if (!retry.present) {
    const gating: EvidenceGatingResult = { rejectedClaims: firstRejected, corrected: false, envelopePresent: false, parseStatus: "MISSING", correctionAttempted: true, correctionSucceeded: false, fallbackUsed: false, fallbackReason: "ENVELOPE_MISSING", correctionCategories: first.present ? correctionCategoriesOf(firstRejected) : ["ENVELOPE"], persistentCategories: ["ENVELOPE"], salvage: "FULL_FALLBACK" }
    throw new StructuredGatingError("A resposta não trouxe os campos de evidência validáveis após correção — descartada (fail-closed).", "AGENT_EVIDENCE_ENVELOPE_MISSING", { ...retry.synthesis, evidenceRepresentativeness: representativeness }, gating)
  }
  const retryGating = gateSynthesisDetailed(retry.synthesis, context, retry.text)
  const salvage = salvageClaims({ firstGating: firstGating ?? emptyGating(), retryGating, retrySynthesis: retry.synthesis, deliveredText: retry.text, ledger: context.ledger })
  const undeclared = retryGating.criticalFacts.some(isUndeclaredCriticalFacts)
  if (undeclared) console.warn(JSON.stringify({ event: "critical_facts_undeclared", facts: retryGating.criticalFacts.filter(isUndeclaredCriticalFacts).map((item) => item.text) }))
  const base = { rejectedClaims: [...firstRejected, ...salvage.persistentRejections], envelopePresent: true, parseStatus: "PARSED" as const, correctionAttempted: true, factPreservation: (undeclared ? "UNDECLARED" : context.criticalFacts && context.criticalFacts.length > 0 ? "DECLARED" : "NOT_APPLICABLE") as NonNullable<EvidenceGatingResult["factPreservation"]>, correctionCategories: first.present ? correctionCategoriesOf(firstRejected) : ["ENVELOPE" as const], persistentCategories: correctionCategoriesOf(salvage.persistentRejections), claimOutcomes: salvage.outcomes, ...salvage.counters }
  if (salvage.outcome === "PARTIAL") {
    // §8 — o Workflow publica a resposta corrigida com as afirmações válidas; as descartadas saíram do JSON e do texto.
    return { raw, synthesis: { ...salvage.synthesis, evidenceRepresentativeness: representativeness }, gating: { ...base, corrected: true, correctionSucceeded: true, fallbackUsed: false, fallbackReason: null, salvage: salvage.counters.claimsDropped > 0 ? "PARTIAL" : "NONE" } }
  }
  const gating: EvidenceGatingResult = { ...base, corrected: false, correctionSucceeded: false, fallbackUsed: false, fallbackReason: salvage.reason, salvage: "FULL_FALLBACK" }
  throw new StructuredGatingError(discardMessage(salvage.persistentRejections), "AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM", { ...salvage.synthesis, evidenceRepresentativeness: representativeness }, gating)
}

/** Descarte fail-closed com o que foi apurado (o chamador persiste síntese/gating no trace antes de propagar). */
export class StructuredGatingError extends DomainError {
  constructor(message: string, code: string, public readonly synthesis: InvestigationSynthesis, public readonly gating: EvidenceGatingResult) {
    super(message, code, 502)
  }
}

// ---------------------------------------------------------------------------------------------
// ORQUESTRADOR: não pode ELEVAR o escopo de uma claim do especialista (O).
// ---------------------------------------------------------------------------------------------
export type SpecialistClaimRef = { ref: string; text: string; scope: ClaimScope; representativeness: "INSUFFICIENT" | "ANECDOTAL" | "REPRESENTATIVE" | null; specialist: string }

const SCOPE_RANK: Record<ClaimScope, number> = { INTERACTION_SPECIFIC: 0, PERIOD_PATTERN: 1, EMPLOYEE_PATTERN: 2, POPULATION_PATTERN: 0 }

/** Claims dos especialistas numeradas C1..Cn (o que o Orquestrador pode referenciar). */
export function collectSpecialistClaims(results: { agentName: string | null; synthesis: InvestigationSynthesis | undefined }[]): SpecialistClaimRef[] {
  const claims: SpecialistClaimRef[] = []
  for (const result of results) {
    if (!result.synthesis) continue
    const best = result.synthesis.evidenceRepresentativeness?.some((item) => item.level === "REPRESENTATIVE") ? "REPRESENTATIVE" : result.synthesis.evidenceRepresentativeness?.some((item) => item.level === "ANECDOTAL") ? "ANECDOTAL" : result.synthesis.evidenceRepresentativeness ? "INSUFFICIENT" : null
    for (const claim of result.synthesis.behavioralClaims) {
      claims.push({ ref: `C${claims.length + 1}`, text: claim.text, scope: claim.scope ?? DEFAULT_CLAIM_SCOPE, representativeness: best, specialist: result.agentName ?? "especialista" })
    }
  }
  return claims
}

/** Como cada investigação de especialista terminou (V1.3.1 — §34): o Orquestrador preserva a semântica de parada. */
export type SpecialistOutcomeRef = { specialist: string; stopReason: string; status: string | null }

export function renderSpecialistClaims(claims: SpecialistClaimRef[], limitations: string[], outcomes: SpecialistOutcomeRef[] = []): string {
  if (claims.length === 0 && limitations.length === 0 && outcomes.length === 0) return ""
  const incomplete = outcomes.filter((item) => item.stopReason !== "ANSWER_SUFFICIENT")
  return [
    "EVIDÊNCIA DOS ESPECIALISTAS (afirmações sobre comportamento que eles sustentaram — cite pelas refs; nunca amplie o escopo):",
    ...claims.map((claim) => `${claim.ref} [${CLAIM_SCOPE_LABELS[claim.scope]}${claim.representativeness ? ` · evidência ${claim.representativeness.toLowerCase()}` : ""}] ${claim.text} (${claim.specialist})`),
    ...(outcomes.length > 0 ? [`Resultado da investigação de cada especialista: ${outcomes.map((item) => `${item.specialist} = ${item.stopReason}`).join("; ")}.`] : []),
    ...(incomplete.length > 0 ? [`ATENÇÃO: ${incomplete.map((item) => item.specialist).join(", ")} terminou SEM evidência suficiente (dados insuficientes/limite). Isso nunca vira "provavelmente a causa é X": mantenha a incerteza declarada. Se especialistas trouxerem evidência conflitante, a síntese reflete o conflito — não escolhe um lado sem evidência.`] : []),
    ...(limitations.length > 0 ? [`Limitações declaradas: ${limitations.join("; ")}.`] : []),
  ].join("\n")
}

/**
 * O que os especialistas AUTORIZAM sobre o tempo (V1.3.4.2 §18): conclusão temporal de cada investigação + relações das claims
 * temporais aceitas + se algum consultou histórico de indicador. O Orquestrador nunca amplia: "nenhuma diferença sustentada"
 * de um especialista não vira "permaneceu estável" na síntese.
 */
export type OrchestratorTemporalAuthorization = { conclusions: TemporalConclusion[]; acceptedRelations: TemporalRelation[]; indicatorTemporalFact: boolean }

export function collectSpecialistTemporalAuthorization(results: { investigation?: { synthesis?: InvestigationSynthesis | undefined; temporal?: { conclusion?: TemporalConclusion | undefined } | undefined; evidenceSources?: { used: string[] } | undefined } | null | undefined }[]): OrchestratorTemporalAuthorization {
  const investigations = results.map((result) => result.investigation).filter((item): item is NonNullable<typeof item> => Boolean(item))
  return {
    conclusions: investigations.map((item) => item.temporal?.conclusion).filter((item): item is TemporalConclusion => Boolean(item)),
    acceptedRelations: investigations.flatMap((item) => (item.synthesis?.behavioralClaims ?? []).map((claim) => claim.temporalRelation).filter((relation): relation is TemporalRelation => Boolean(relation) && relation !== "NONE")),
    indicatorTemporalFact: investigations.some((item) => item.evidenceSources?.used.includes("TEMPORAL_HISTORY")),
  }
}

/** Gating do Orquestrador: cada claim deve referenciar claims de especialistas e não pode ter escopo maior que a maior delas; o texto/hipóteses/premissas não podem afirmar relação temporal que nenhum especialista sustentou (V1.3.4.2). */
export function gateOrchestratorClaims(synthesis: InvestigationSynthesis, claims: SpecialistClaimRef[], temporal?: OrchestratorTemporalAuthorization & { text?: string }): EvidenceGatingResult["rejectedClaims"] {
  const byRef = new Map(claims.map((claim) => [claim.ref, claim]))
  const rejected: EvidenceGatingResult["rejectedClaims"] = []
  if (temporal) {
    // A conclusão mais permissiva entre os especialistas define o que pode ser dito; sem comparação = NOT_COMPARED.
    const supported = temporal.conclusions.flatMap((item) => item.supportedRelations)
    const allowed = [...new Set(temporal.conclusions.flatMap((item) => item.allowedRelations))]
    const kind = temporal.conclusions.find((item) => item.kind === "SUPPORTED_RELATION")?.kind ?? temporal.conclusions.find((item) => item.kind === "NO_DIFFERENCE_SUPPORTED")?.kind ?? temporal.conclusions.find((item) => item.kind === "SAMPLE_DIFFERENCE_ONLY")?.kind ?? temporal.conclusions.find((item) => item.kind === "INSUFFICIENT_EVIDENCE")?.kind ?? "NOT_COMPARED"
    const supportScope = temporal.conclusions.reduce<TemporalSupportScope>((acc, item) => (supportScopeIndex(item.supportScope ?? "SAMPLE") > supportScopeIndex(acc) ? (item.supportScope ?? "SAMPLE") : acc), "SAMPLE")
    const conclusion: TemporalConclusion = { kind, safeMeaning: TEMPORAL_SAFE_MEANINGS[kind], supportedRelations: supported, allowedRelations: allowed, refs: temporal.conclusions.flatMap((item) => item.refs), supportScope }
    const surfaces = [
      ...synthesis.supportedHypotheses.map((text) => ({ where: "hipótese sustentada", text })),
      ...synthesis.recommendationSupport.map((item) => ({ where: "premissa de recomendação", text: item.text })),
      ...synthesis.behavioralClaims.map((claim) => ({ where: "afirmação comportamental", text: claim.text })),
      ...(temporal.text !== undefined ? [{ where: "texto entregue", text: temporal.text }] : []),
    ]
    for (const item of checkTemporalConclusionCompatibility(surfaces, { conclusion, acceptedRelations: temporal.acceptedRelations, indicatorTemporalFact: temporal.indicatorTemporalFact, indicatorStable: false })) {
      rejected.push({ kind: "TEMPORAL_CLAIM", text: item.where === "texto entregue" ? item.language.join(" | ") : item.text, reason: `${item.reason}: ${item.detail} (nenhum especialista sustentou essa relação)` })
    }
  }
  for (const claim of synthesis.behavioralClaims) {
    const refs = claim.evidenceRefs.map((ref) => byRef.get(ref.trim().toUpperCase())).filter((item): item is SpecialistClaimRef => Boolean(item))
    if (refs.length === 0) {
      rejected.push({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: claims.length === 0 ? "nenhum especialista sustentou afirmação comportamental" : "sem referência a uma afirmação de especialista (C-n)" })
      continue
    }
    const scope = claim.scope ?? DEFAULT_CLAIM_SCOPE
    if (scope === "POPULATION_PATTERN") {
      if (!refs.some((item) => item.scope === "POPULATION_PATTERN")) rejected.push({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: "padrão de população sem claim de população de especialista" })
      continue
    }
    const maxRank = Math.max(...refs.filter((item) => item.scope !== "POPULATION_PATTERN").map((item) => SCOPE_RANK[item.scope]), -1)
    if (maxRank < 0 || SCOPE_RANK[scope] > maxRank) rejected.push({ kind: "BEHAVIORAL_CLAIM", text: claim.text, reason: `escopo ${scope} amplia o que os especialistas sustentaram (${refs.map((item) => `${item.ref}=${item.scope}`).join(", ")})` })
  }
  return rejected
}
