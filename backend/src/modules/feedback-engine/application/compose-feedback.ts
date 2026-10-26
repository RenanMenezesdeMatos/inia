import { DomainError } from "../../../shared/domain/domain-error.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import { analysisClaimsOf, applyVerdicts, assembleMessage, coherenceNeedOf, forbiddenContentOf, parseVerdicts, parseWriterDraft, repairInstructionsOf, resolveDraftQuotes, trustedReadingsOf, usefulnessOf, type AppliedVerdicts, type AssembledMessage, type ContentLeak, type SentenceDecision, type Usefulness, type WriterDraft } from "../domain/composition.js"
import { COHERENCE_RESPONSE_SCHEMA, COHERENCE_SYSTEM_PROMPT, COMPOSITION_RESPONSE_SCHEMA, COMPOSITION_SYSTEM_PROMPT, parseCoherence, renderCoherenceUserTurn, renderCompositionUserTurn, renderVerificationUserTurn, VERIFICATION_RESPONSE_SCHEMA, VERIFICATION_SYSTEM_PROMPT } from "../domain/composition-prompt.js"
import type { FeedbackBrief, TrustedReadings } from "../domain/feedback-brief.js"
import { readabilityOf, type Readability } from "../domain/readability.js"
import { COHERENCE_PROMPT_VERSION, COMPOSITION_PROMPT_VERSION, COMPOSITION_VERSION, VERIFICATION_PROMPT_VERSION } from "../domain/versions.js"
import { callModel } from "./analyze-call.js"
import { isBudgetExhausted } from "./engine-meter.js"
import type { EngineModelPort, ModelCallMetric } from "./ports.js"

/**
 * CASO DE USO: COMPOR a mensagem a partir do brief (`FEEDBACK_COMPOSITION_V3`). Orçamento fechado: no máximo 2 redações,
 * 2 verificações e 1 conferência de coerência.
 *   redação → verificação (frases + leitura da análise, contra os FATOS) → checagens locais + utilidade + repetição
 *   → [algo recusado, card recusado ou ponto principal sem entrega útil] 1 reescrita guiada pelos motivos → nova verificação
 *   → a melhor rodada; se ela perdeu frases, o CONJUNTO é conferido (coerência) antes de valer
 *   → mensagem = só frases do redator verificadas. Nenhuma frase do sistema tapa lacuna.
 * Sem mensagem útil e coerente → sem mensagem, com o motivo (a análise continua na memória). Falha TRANSITÓRIA do provedor
 * (depois da nova tentativa do medidor) é falha técnica: o erro sobe classificado e o Workflow tenta de novo mais tarde.
 */
export type CompositionAudit = {
  version: typeof COMPOSITION_VERSION
  promptVersion: typeof COMPOSITION_PROMPT_VERSION
  verificationPromptVersion: typeof VERIFICATION_PROMPT_VERSION
  coherencePromptVersion: typeof COHERENCE_PROMPT_VERSION
  attempts: { writer: number; verifier: number; coherence: number }
  errors: string[]
  decisions: Pick<SentenceDecision, "id" | "stance" | "refs" | "kept" | "reasons">[]
  verdicts: { id: string; verdict: string; specific: boolean | null; repeats: string | null; addsInformation?: boolean }[]
  /** V5 — leitura do verificador sobre a mensagem inteira e a informação perdida na reescrita. */
  messageAssessment?: { conveysPrimary: boolean; valueBeyondNarration: boolean; note: string | null } | null
  lostInformation?: string[]
  /** Leitura da análise conferida: aprovada (pode ser usada nos detalhes) × recusada/não conferida (nunca usada). */
  analysis: { id: string; accepted: boolean; verdict: string | null; note: string | null }[]
  trusted: TrustedReadings
  usefulness: Usefulness | null
  coherence: { required: boolean; checked: boolean; coherent: boolean | null; problems: { kind: string; note: string | null }[]; danglingAfterRemoval: string[] }
  /** Pontos do brief comunicados (os demais continuam na memória, não marcados como entregues). */
  communicatedRefs: string[]
  notCommunicated: string[]
  /** Trava final: o que foi retirado dos detalhes por reintroduzir conteúdo recusado/não conferido. */
  leaksRemoved: ContentLeak[]
  outcome: "MESSAGE" | "NO_MESSAGE"
  /** `READABILITY_PT_V1` — medida de leitura do texto entregue (só acompanha; nunca meta nem trava). */
  readability?: Readability | null
  /** Motivo quando não há mensagem. */
  reason: CompositionFailure | null
}

export type CompositionFailure = "WRITER_OUTPUT_INVALID" | "VERIFIER_UNAVAILABLE" | "NO_USEFUL_MESSAGE" | "INCOHERENT_AFTER_REMOVAL" | "COHERENCE_UNVERIFIED" | "REJECTED_CONTENT_REAPPEARED" | "MODEL_BUDGET_EXHAUSTED"

type Attempt = { draft: WriterDraft; decisions: AppliedVerdicts | null }

/** Erro que não pode virar "sem mensagem": provedor fora — o Workflow tenta de novo (a análise já está gravada). */
const rethrowIfTechnical = (error: unknown) => {
  if (isBudgetExhausted(error)) return
  if (classifyExecutionError(error).category === "TRANSIENT_PROVIDER_ERROR") throw error
}

async function writeAndVerify(model: EngineModelPort, brief: FeedbackBrief, repair: string[] | null, metrics: ModelCallMetric[], audit: CompositionAudit, previousApproved: readonly string[] = []): Promise<Attempt | null> {
  audit.attempts.writer += 1
  let draftText: string
  try {
    draftText = (await callModel(model, { stage: "COMPOSITION", systemPrompt: COMPOSITION_SYSTEM_PROMPT, contents: [{ role: "user", text: renderCompositionUserTurn(brief, repair) }], responseSchema: COMPOSITION_RESPONSE_SCHEMA, tag: repair ? "repair" : "draft" }, metrics)).text
  } catch (error) {
    audit.errors.push(`WRITER:${error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN"}`)
    rethrowIfTechnical(error)
    return null
  }
  const parsed = parseWriterDraft(draftText)
  if (!parsed.ok) {
    audit.errors.push(`WRITER_PARSE:${parsed.error}`)
    return null
  }
  // `LITERAL_QUOTES_V1`: o redator cita a fala pelo id ([[Q3]]); daqui em diante (verificação, checagens, montagem) vale o texto exato.
  const draft = resolveDraftQuotes(parsed.draft, brief)
  const sentenceClaims = [...draft.sentences.map((sentence, index) => ({ id: `F${index + 1}`, text: sentence.text, stance: sentence.stance, refs: sentence.refs, ...(sentence.format ? { listItem: true } : {}) })), { id: "CARD", text: draft.card.text, stance: "CONTEXT", refs: draft.card.refs }]
  const claims = [...sentenceClaims, ...analysisClaimsOf(brief)]
  audit.attempts.verifier += 1
  try {
    const verificationText = (await callModel(model, { stage: "VERIFICATION", systemPrompt: VERIFICATION_SYSTEM_PROMPT, contents: [{ role: "user", text: renderVerificationUserTurn(brief, claims, { previousApproved }) }], responseSchema: VERIFICATION_RESPONSE_SCHEMA, tag: repair ? "repair" : "draft" }, metrics)).text
    const verdicts = parseVerdicts(verificationText, sentenceClaims.map((claim) => claim.id))
    if (!verdicts.ok) {
      audit.errors.push(`VERIFIER_PARSE:${verdicts.error}`)
      return { draft, decisions: null }
    }
    // A informação perdida só conta na reescrita (há uma versão anterior aprovada para comparar).
    return { draft, decisions: applyVerdicts(draft, brief, verdicts.verdicts, { message: verdicts.message, lost: previousApproved.length > 0 ? verdicts.lost : [] }) }
  } catch (error) {
    audit.errors.push(`VERIFIER:${error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN"}`)
    rethrowIfTechnical(error)
    return { draft, decisions: null }
  }
}

const keptOf = (decisions: AppliedVerdicts) => decisions.sentences.filter((entry) => entry.kept)
const usefulnessOfDecisions = (brief: FeedbackBrief, decisions: AppliedVerdicts) => usefulnessOf(brief, keptOf(decisions), decisions.message)
const scoreOf = (brief: FeedbackBrief, decisions: AppliedVerdicts) => {
  const usefulness = usefulnessOfDecisions(brief, decisions)
  return { primary: usefulness.primaryCovered ? 0 : 1, gaps: usefulness.missingGuidance.length + (usefulness.missingRecognition ? 1 : 0) + (usefulness.missingContext ? 1 : 0) + (usefulness.missingValue ? 1 : 0) + ((usefulness.missingPractice ?? []).length > 0 ? 1 : 0) + (usefulness.missingCorrection ?? []).length + (usefulness.softenedCorrection ? 1 : 0) + (usefulness.missingDevelopment ?? []).length + (usefulness.missingAdjustment ?? []).length + (usefulness.missingList ?? []).length + ((usefulness.missingBasePractice ?? []).length > 0 ? 1 : 0), lost: (decisions.lost ?? []).length, rejected: decisions.sentences.filter((entry) => !entry.kept && !entry.reasons.every((reason) => reason === "REDUNDANT")).length }
}
/** A reescrita só substitui a versão anterior se não ficou pior: ponto principal, lacunas de utilidade, informação útil PERDIDA, recusas. */
const better = (brief: FeedbackBrief, a: AppliedVerdicts, b: AppliedVerdicts) => {
  const left = scoreOf(brief, a)
  const right = scoreOf(brief, b)
  return left.primary !== right.primary ? left.primary < right.primary : left.gaps !== right.gaps ? left.gaps < right.gaps : left.lost !== right.lost ? left.lost < right.lost : left.rejected <= right.rejected
}

/** Orçamento visto pela composição: a reescrita só começa se reescrita + nova verificação couberem juntas (`ENGINE_BUDGET_V2`). */
export type CompositionBudget = { fitsAll(requests: readonly { stage: "COMPOSITION" | "VERIFICATION"; inputChars: number }[]): boolean }

export async function composeFeedback(model: EngineModelPort, brief: FeedbackBrief, metrics: ModelCallMetric[], budget: CompositionBudget | null = (model as { meter?: CompositionBudget }).meter ?? null): Promise<{ message: AssembledMessage | null; audit: CompositionAudit }> {
  const audit: CompositionAudit = { version: COMPOSITION_VERSION, promptVersion: COMPOSITION_PROMPT_VERSION, verificationPromptVersion: VERIFICATION_PROMPT_VERSION, coherencePromptVersion: COHERENCE_PROMPT_VERSION, attempts: { writer: 0, verifier: 0, coherence: 0 }, errors: [], decisions: [], verdicts: [], analysis: [], trusted: { guidance: {}, why: {} }, usefulness: null, coherence: { required: false, checked: false, coherent: null, problems: [], danglingAfterRemoval: [] }, communicatedRefs: [], notCommunicated: [], leaksRemoved: [], outcome: "NO_MESSAGE", reason: null }
  const budgetHit = () => audit.errors.some((error) => error.includes("FEEDBACK_ENGINE_BUDGET_EXHAUSTED"))
  const fail = (reason: CompositionFailure) => {
    audit.reason = budgetHit() ? "MODEL_BUDGET_EXHAUSTED" : reason
    return { message: null, audit }
  }
  const rounds: AppliedVerdicts[] = []
  let best = await writeAndVerify(model, brief, null, metrics, audit)
  if (best?.decisions) rounds.push(best.decisions)
  const needsRepair = (attempt: Attempt | null) => !attempt || !attempt.decisions || scoreOf(brief, attempt.decisions).primary > 0 || scoreOf(brief, attempt.decisions).gaps > 0 || scoreOf(brief, attempt.decisions).rejected > 0 || !attempt.decisions.card.kept
  if (needsRepair(best) && !budgetHit()) {
    const instructions = best?.decisions ? repairInstructionsOf([...best.decisions.sentences, best.decisions.card], usefulnessOfDecisions(brief, best.decisions), brief) : ["A versão anterior não pôde ser lida ou verificada. Escreva de novo seguindo o schema."]
    // Reescrita sem verificação não vale nada: se as duas não cabem, nenhuma começa (a decisão fica com a primeira versão).
    const writerChars = COMPOSITION_SYSTEM_PROMPT.length + renderCompositionUserTurn(brief, instructions).length
    const verifierChars = VERIFICATION_SYSTEM_PROMPT.length + writerChars + 4_000
    if (budget && !budget.fitsAll([{ stage: "COMPOSITION", inputChars: writerChars }, { stage: "VERIFICATION", inputChars: verifierChars }])) audit.errors.push("REPAIR_SKIPPED:FEEDBACK_ENGINE_BUDGET_EXHAUSTED")
    else {
    // A verificação da reescrita recebe o que já estava aprovado: diz se a nova versão PERDEU informação útil (e a escolha pesa isso).
    const second = await writeAndVerify(model, brief, instructions, metrics, audit, best?.decisions ? keptOf(best.decisions).map((entry) => entry.text) : [])
    if (second?.decisions) rounds.push(second.decisions)
    if (second?.decisions && (!best?.decisions || better(brief, second.decisions, best.decisions))) best = second
    }
  }
  const decisions = best?.decisions ?? null
  const trusted = trustedReadingsOf(brief, rounds)
  audit.trusted = trusted
  audit.analysis = analysisClaimsOf(brief).map((claim) => {
    const judged = rounds.map((round) => round.analysis.find((entry) => entry.id === claim.id)).filter((entry) => entry?.verdict)
    const refused = judged.find((entry) => !entry!.accepted)
    return { id: claim.id, accepted: Boolean(claim.refs[0] && (claim.id.startsWith("G-") ? trusted.guidance[claim.refs[0]] : trusted.why[claim.refs[0]])), verdict: (refused ?? judged[0])?.verdict?.verdict ?? null, note: (refused ?? judged[0])?.verdict?.note ?? null }
  })
  if (!decisions) return fail(best ? "VERIFIER_UNAVAILABLE" : "WRITER_OUTPUT_INVALID")
  audit.decisions = [...decisions.sentences, decisions.card].map(({ id, stance, refs, kept, reasons }) => ({ id, stance, refs, kept, reasons }))
  audit.verdicts = [...decisions.sentences, decisions.card].flatMap((entry) => (entry.verdict ? [{ id: entry.id, verdict: entry.verdict.verdict, specific: entry.verdict.specific, repeats: entry.verdict.repeats, ...(entry.verdict.addsInformation !== undefined && entry.verdict.addsInformation !== null ? { addsInformation: entry.verdict.addsInformation } : {}) }] : []))
  const usefulness = usefulnessOfDecisions(brief, decisions)
  audit.usefulness = usefulness
  audit.messageAssessment = decisions.message ?? null
  audit.lostInformation = decisions.lost ?? []
  // Utilidade do CONJUNTO (V5): ponto principal sem orientação/reconhecimento útil, ou mensagem que só narra etapas = sem mensagem.
  if (!usefulness.primaryCovered || usefulness.missingValue) return fail("NO_USEFUL_MESSAGE")

  const forbidden = forbiddenContentOf(brief, rounds, trusted)
  const message = assembleMessage(brief, decisions, { trusted, forbidden })
  if (!message) return fail("REJECTED_CONTENT_REAPPEARED")

  // Conjunto: se frases saíram, o que sobrou é conferido como um texto só (nada de publicar um texto com sentido quebrado).
  const need = coherenceNeedOf(decisions)
  audit.coherence = { required: need.required, checked: false, coherent: null, problems: [], danglingAfterRemoval: need.danglingAfterRemoval }
  if (need.danglingAfterRemoval.length > 0) {
    audit.coherence.coherent = false
    audit.coherence.problems = need.danglingAfterRemoval.map((id) => ({ kind: "DANGLING_REFERENCE", note: `${id} depende de uma frase retirada` }))
    return fail("INCOHERENT_AFTER_REMOVAL")
  }
  if (need.required) {
    audit.attempts.coherence += 1
    try {
      const response = await callModel(model, { stage: "VERIFICATION", systemPrompt: COHERENCE_SYSTEM_PROMPT, contents: [{ role: "user", text: renderCoherenceUserTurn(brief, message) }], responseSchema: COHERENCE_RESPONSE_SCHEMA, tag: "coherence" }, metrics)
      const parsed = parseCoherence(response.text)
      audit.coherence.checked = parsed.ok
      if (!parsed.ok) {
        audit.errors.push(`COHERENCE_PARSE:${parsed.error}`)
        return fail("COHERENCE_UNVERIFIED")
      }
      audit.coherence.coherent = parsed.coherent
      audit.coherence.problems = parsed.problems
      if (!parsed.coherent) return fail("INCOHERENT_AFTER_REMOVAL")
    } catch (error) {
      audit.errors.push(`COHERENCE:${error instanceof DomainError ? error.code : error instanceof Error ? error.name : "UNKNOWN"}`)
      rethrowIfTechnical(error)
      return fail("COHERENCE_UNVERIFIED")
    }
  }
  audit.communicatedRefs = message.communicatedRefs
  audit.notCommunicated = [...brief.developments, ...brief.strengths].map((finding) => finding.ref).filter((ref) => !message.communicatedRefs.includes(ref))
  audit.leaksRemoved = message.leaksRemoved
  audit.readability = readabilityOf(message.text)
  audit.outcome = "MESSAGE"
  return { message, audit }
}
