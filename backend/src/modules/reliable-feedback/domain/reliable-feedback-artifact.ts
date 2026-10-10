import { cleanSectionHeading } from "./process-items.js"
import type { FeedbackDomain, InvestigationSourceType } from "./feedback-investigation-result.js"
import type { ProcessAssessmentAuditView } from "./process-assessment.js"
import { artifactDispositionOf, isEmittableSection, isItemEmittable, type ApplicabilityPointView, type EmittableSection, type ArtifactDisposition, type GuidanceGrounding, type ItemPriority, type ItemQaStatus, type ReliableFact, type ReliableItemDecision, type ReliableItemDraft, type ReliableKnowledgeRef, type ReliableProcessRef, type ReliableWording } from "./reliable-feedback-item.js"
import { hasSuggestedResponsePlaceholder, suggestedResponseProvenanceOf, suggestedResponseScopeOf, suggestedResponseViolations, type SuggestedResponseProvenance } from "./suggested-response.js"
import { isHighlightedStrength, maintainParagraphOf } from "./supervisor-presentation.js"
import { NATURAL_FEEDBACK_VERSION, resolvePresentation, type FeedbackPresentation, type PresentationContext, type StoredPresentation } from "./feedback-presentation.js"
import { feedbackViewOf, feedbackViewParts } from "./feedback-view.js"
import { prvCollaboratorViewOf, renderPrvFeedbackText, resolvePrvNarrative, type PrvClosingArtifactData } from "./prv-closing-views.js"
import { statementSentence } from "./applicability-items.js"
import type { ApplicabilityResolution } from "./applicability-resolution.js"
import type { SupportMaterialRecommendation } from "../../feedbacks/domain/support-material.js"
import type { IndicatorDiagnosisOutcome } from "../../indicator-diagnosis/domain/diagnosis-outcome.js"
import { presentationLabelOf, speechIntroOf } from "./behavior-presentation.js"
import type { WriterFieldValidation } from "./reliable-writer.js"
import { isListLine, stripListMarker, structuralLinesOf } from "../../knowledge/domain/knowledge-list.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"

/**
 * V1.5.12 — RELIABLE FEEDBACK ARTIFACT: o resultado PÚBLICO da ação "Gerar feedback".
 *
 * Não pertence a nenhuma superfície: é conteúdo confiável que o Workflow carrega adiante (Revisão humana opcional, um ou
 * mais Outputs). "Gerar feedback" nunca entrega nada; quem decide destino é o Output. O artefato persistido guarda TODOS
 * os itens (inclusive bloqueados, para auditoria); o que segue no Workflow (`nodeOutputOf`) são só os itens EMITÍVEIS,
 * com o texto final (o proposto, ou a versão editada pelo QA).
 */
export const RELIABLE_FEEDBACK_ARTIFACT_CONTRACT = "RELIABLE_FEEDBACK_ARTIFACT_V1" as const
export const RELIABLE_FEEDBACK_NODE_OUTPUT_KIND = "RELIABLE_FEEDBACK_ARTIFACT" as const

export type ArtifactItem = Omit<ReliableItemDraft, "analysis"> & {
  /** A interpretação da origem NÃO fica no artefato exibível (só no `normalized_input`, auditoria). */
  analysisUsed: boolean
  slot: string | null
  proposedWording: ReliableWording | null
  /** V1.7.1b: SYSTEM = texto montado pelo sistema (ponto de aplicabilidade), sem redator. */
  wordingSource: "WRITER" | "FALLBACK" | "SYSTEM" | null
  writerViolations: string[]
  /** V1.7.1h — validação POR CAMPO do texto do redator (auditoria/QA técnico; nunca ao colaborador). Ausente antes. */
  writerFieldValidation?: WriterFieldValidation[]
  decision: ReliableItemDecision
}

export type ReliableFeedbackArtifactV1 = {
  contract: typeof RELIABLE_FEEDBACK_ARTIFACT_CONTRACT
  domain: FeedbackDomain
  sourceNodeId: string
  sourceType: InvestigationSourceType
  subject: { collaboratorId: string; interactionId: string | null; indicatorMeasurementId: string | null }
  /** Rótulo exibível (data + assunto, ou indicador + período) — nunca identificador. */
  label: string
  items: ArtifactItem[]
  uncertainties: string[]
  /** Motivo de um artefato sem itens (origem incompatível, sem contexto canônico…) — null quando há itens. */
  blockedReason: string | null
  /** V1.6.0 — o diagnóstico de processo VERIFICADO de onde os itens nasceram (auditoria/QA; sem trecho bruto da conversa).
   * Ausente em artefatos anteriores e no caminho sem avaliação de processo. */
  processAssessment?: ProcessAssessmentAuditView | null
  /** V1.6.0 — etapas evidenciadas que ficaram fora pelo limite de materialidade (refs internas, auditoria). V1.7.1a: sempre
   * vazio — não há mais limite editorial (mantido para os artefatos anteriores). */
  excludedForMateriality?: string[]
  /** V1.7.1a — análise completa × feedback: quantos achados, quantos confiáveis e o destino de cada um (ausente antes). */
  findings?: FindingsSummary | null
  /** V1.7.1b — destinatário (primeiro nome do SISTEMA) e o rascunho de abertura/fechamento do redator (ausente antes). */
  presentation?: StoredPresentation | null
  /** V1.6.1 — diagnóstico do indicador (onde o resultado se concentra, amostra, padrões, pares, limitações). Ausente fora dele. */
  indicatorDiagnosis?: IndicatorDiagnosisOutcome | null
  /** INDICATOR DIAGNOSIS V1 — feedback do FECHAMENTO do PRV: a verdade diagnóstica, o mapa dos itens e o rascunho do redator. */
  prvClosing?: PrvClosingArtifactData | null
  policyVersion: string
  writer: { invoked: boolean; skippedReason: string | null; error: string | null; promptVersion: string | null; /** V1.7.1d — categoria da falha do redator (ausente em artefatos anteriores). */ failureCategory?: string | null }
}

export const SECTION_LABELS = { STRENGTH: "Ponto forte", OPPORTUNITY: "Ponto de desenvolvimento", ATTENTION: "Vale confirmar o produto" } as const

export type EmittedItem = {
  index: number
  /** V1.7.1a — domínio do artefato (o escopo do exemplo de condução depende dele). Ausente em chamadas antigas = MONITORING. */
  domain?: FeedbackDomain
  /** V1.7.1b — tipo do item (o escopo do exemplo depende dele) e, nos pontos de aplicabilidade, a visão verificada. */
  kind?: ReliableItemDraft["kind"]
  applicability?: ApplicabilityPointView | null
  section: EmittableSection
  sectionLabel: string
  wording: ReliableWording
  wordingSource: "PROPOSED" | "HUMAN_EDITED"
  qaStatus: "NOT_SELECTED_FOR_QA" | "APPROVED_UNCHANGED" | "APPROVED_EDITED"
  facts: ReliableFact[]
  /** V1.6.0 — regra da base verificada (null no caminho legado/indicador e em artefatos anteriores). */
  knowledge: ReliableKnowledgeRef | null
  grounding: GuidanceGrounding
  process: ReliableProcessRef | null
  /** V1.7.1a — posição na leitura (ausente em artefatos anteriores). */
  priority?: ItemPriority | null
  /** V1.7.1a — exemplo de condução aceito (texto final) e a proveniência determinística dele; null = sem exemplo. */
  suggestedResponse?: { text: string; provenance: SuggestedResponseProvenance } | null
}

export type ArtifactReviewState = { itemIndex: number; status: Exclude<ItemQaStatus, null>; finalWording: ReliableWording | null }

/**
 * V1.7.1a — ANÁLISE COMPLETA × FEEDBACK (nunca fingir que só existiam os publicados):
 *   detected   etapas que a origem avaliou como cumpridas/não cumpridas (ou itens propostos, fora da avaliação de processo);
 *   reliable   itens estruturalmente emitíveis (não BLOCKED);
 *   inFeedback itens que seguem no feedback agora (READY sem QA, ou aprovados no QA);
 *   o resto por motivo: bloqueados pela estrutura, aguardando QA, rejeitados no QA; etapas iguais fundidas; e as etapas que
 *   ficaram como limite/escopo da análise (não observável / não aplicável).
 */
export type FindingsSummary = {
  detected: number
  reliable: number
  inFeedback: number
  blocked: number
  heldForQa: number
  rejected: number
  collapsedDuplicates: number
  notObservable: number
  notApplicable: number
  /** V1.7.1c — etapas propostas fora do contrato (avaliação PARCIAL); ausente em artefatos anteriores. */
  outsideContract?: number
  /** V1.7.1l — citações de seção não executável (objetivo, abrangência…): contexto do procedimento, não etapa; fora de "detectadas". */
  notCheckpoint?: number
}

export function findingsSummaryOf(artifact: ReliableFeedbackArtifactV1, reviews: readonly ArtifactReviewState[]): FindingsSummary {
  const qaOf = (index: number) => reviews.find((review) => review.itemIndex === index)?.status ?? null
  const assessment = artifact.processAssessment ?? null
  return {
    // V1.7.1m — fonte que só reforça outra do mesmo comportamento não é outro achado (aparece em "fundidas").
    detected: assessment ? assessment.checkpoints.filter((checkpoint) => (checkpoint.declaredStatus === "FOLLOWED" || checkpoint.declaredStatus === "NOT_FOLLOWED") && checkpoint.statusDowngradeReason !== "NOT_A_PROCESS_CHECKPOINT" && checkpoint.canonical?.role !== "SUPPORTING").length : artifact.items.length,
    reliable: artifact.items.filter((item) => item.decision.disposition !== "BLOCKED").length,
    inFeedback: artifact.items.filter((item) => item.proposedWording && isItemEmittable(item.decision.disposition, qaOf(item.index))).length,
    blocked: artifact.items.filter((item) => item.decision.disposition === "BLOCKED").length,
    heldForQa: artifact.items.filter((item) => item.decision.disposition === "HOLD_FOR_QA" && (qaOf(item.index) === null || qaOf(item.index) === "PENDING_REVIEW")).length,
    rejected: artifact.items.filter((item) => qaOf(item.index) === "REJECTED").length,
    collapsedDuplicates: artifact.items.reduce((total, item) => total + (item.collapsedCheckpoints?.length ?? 0), 0),
    notObservable: assessment?.summary.NOT_OBSERVABLE ?? 0,
    notApplicable: (assessment?.summary.NOT_APPLICABLE ?? 0) - (assessment?.summary.notCheckpointEligible ?? 0),
    ...(assessment?.summary.contractInvalidItems ? { outsideContract: assessment.summary.contractInvalidItems } : {}),
    ...(assessment?.summary.notCheckpointEligible ? { notCheckpoint: assessment.summary.notCheckpointEligible } : {}),
  }
}

/** Disposição ATUAL do artefato (geração × QA) pela regra única. */
export function currentDisposition(artifact: ReliableFeedbackArtifactV1, reviews: readonly ArtifactReviewState[]): ArtifactDisposition {
  if (artifact.items.length === 0) return "BLOCKED"
  return artifactDispositionOf(artifact.items.map((item) => ({ disposition: item.decision.disposition, qa: reviews.find((review) => review.itemIndex === item.index)?.status ?? null })))
}

const UNGROUNDED_EXAMPLE_DATA = new Set(["UNSUPPORTED_NUMBER", "UNSUPPORTED_FACT", "EXAMPLE_CONTENT_AS_FACT"])
/** O exemplo de condução afirma um dado concreto (número, protocolo, prazo, canal…) sem fonte tipada no item? */
function hasUngroundedExampleData(example: string | null | undefined, item: ReliableFeedbackArtifactV1["items"][number], domain: ReliableFeedbackArtifactV1["domain"]): boolean {
  if (!(example ?? "").trim()) return false
  const scope = suggestedResponseScopeOf({ ...item, domain })
  return scope.allowed && suggestedResponseViolations(example, scope).some((code) => UNGROUNDED_EXAMPLE_DATA.has(code))
}

/** Itens que podem seguir no Workflow, com o texto final (editado pelo QA quando houver). */
export function emittedItems(artifact: ReliableFeedbackArtifactV1, reviews: readonly ArtifactReviewState[]): EmittedItem[] {
  return artifact.items.flatMap((item): EmittedItem[] => {
    const review = reviews.find((entry) => entry.itemIndex === item.index) ?? null
    if (!item.proposedWording || !isEmittableSection(item.section)) return []
    if (!isItemEmittable(item.decision.disposition, review?.status ?? null)) return []
    const edited = review?.status === "APPROVED_EDITED" && review.finalWording
    const chosen: ReliableWording = edited ? review.finalWording! : item.proposedWording
    // V1.7.1m — exemplo com marcador de lacuna ("O prazo de análise é de...") nunca é emitido: sai SÓ o exemplo, o ponto fica.
    // TYPED_NUMBER_GROUNDING_V1 — idem para exemplo com dado concreto sem fonte do MESMO papel ("seu protocolo é 7" quando o 7
    // é do prazo ou da numeração da lista): defesa na emissão, que vale também para artefatos gravados antes da correção.
    const wording: ReliableWording = hasSuggestedResponsePlaceholder(chosen.suggestedResponse) || hasUngroundedExampleData(chosen.suggestedResponse, item, artifact.domain) ? { observed: chosen.observed, whyItMatters: chosen.whyItMatters, whatYouCanDo: chosen.whatYouCanDo } : chosen
    const exampleText = (wording.suggestedResponse ?? "").trim()
    return [{
      index: item.index,
      domain: artifact.domain,
      kind: item.kind,
      applicability: item.applicability ?? null,
      section: item.section,
      sectionLabel: SECTION_LABELS[item.section],
      wording,
      wordingSource: edited ? "HUMAN_EDITED" : "PROPOSED",
      qaStatus: review?.status === "APPROVED_UNCHANGED" || review?.status === "APPROVED_EDITED" ? review.status : "NOT_SELECTED_FOR_QA",
      facts: item.facts,
      knowledge: item.knowledge ?? null,
      grounding: item.grounding ?? "NO_GROUNDED_GUIDANCE",
      process: item.process ?? null,
      priority: item.priority ?? null,
      suggestedResponse: exampleText ? { text: exampleText, provenance: suggestedResponseProvenanceOf(exampleText, suggestedResponseScopeOf({ ...item, domain: artifact.domain }), edited && (review!.finalWording!.suggestedResponse ?? "").trim() !== (item.proposedWording.suggestedResponse ?? "").trim() ? "HUMAN_QA" : "WRITER") } : null,
    }]
  })
}

const SYSTEM_ROLES: readonly ReliableFact["role"][] = ["DADO_OFICIAL", "ANALISE", "REFERENCIA"]
const factLine = (fact: ReliableFact) => (SYSTEM_ROLES.includes(fact.role) ? fact.text : `${fact.role === "OPERADOR" ? "Operador" : fact.role === "CLIENTE" ? "Cliente" : fact.role === "EVENTO" ? "Evento da chamada" : "Participante"}: “${fact.text}${fact.truncated ? "…" : ""}”`)

/** Citação literal dentro de Markdown: escapa os caracteres de marcação (a fala/regra nunca vira formatação) e junta linhas. */
export function escapeMarkdownQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/([\\`*_[\]<>#|~])/g, "\\$1")
}
/** V1.7.1e — a fala do operador é apresentada pelo ATO (pergunta × fala), decidido pela pontuação da própria fala. */
const speakerIntro = (fact: ReliableFact) => (fact.role === "OPERADOR" ? speechIntroOf(fact.text) : fact.role === "CLIENTE" ? "O cliente disse" : fact.role === "EVENTO" ? "Evento da chamada" : "Na conversa")

/**
 * V1.7.1e — RÓTULO DO ACHADO (título do bloco): o ASSUNTO do comportamento ("Prazo da análise", "Cancelamento da recorrência"),
 * nunca "Ponto forte", "Etapa 1" nem o texto cru da etapa (`presentationLabelOf`). O nome interno da etapa continua no item.
 */
export const findingLabelOf = (item: Pick<EmittedItem, "section" | "process" | "knowledge" | "sectionLabel">) => presentationLabelOf(item) ?? item.sectionLabel
/** Tira só o PAR de aspas externas de uma fala-modelo citada inteira (“…”) — nunca a aspa final de uma lista citada. */
const stripOuterQuotes = (text: string) => { const value = text.trim(); return /^[“"«]/.test(value) && /[”"»]$/.test(value) ? value.slice(1, -1).trim() : value }
const quoteLine = (text: string) => `“${escapeMarkdownQuote(stripOuterQuotes(text))}”`
const sectionLabelOf = (heading: string | null | undefined) => (heading ? cleanSectionHeading(heading) : null)
/** V1.7.1e — ORIGEM no próprio achado: documento · seção + "Abrir processo ↗" (o colaborador nunca precisa ir ao fim do texto). */
export const PROCESS_LINK_LABEL = "Abrir processo ↗"
const sourceLine = (knowledge: Pick<ReliableKnowledgeRef, "documentTitle" | "href" | "heading">) => {
  const section = sectionLabelOf(knowledge.heading)
  return `_${escapeMarkdownQuote(knowledge.documentTitle)}${section ? ` · Seção: ${escapeMarkdownQuote(section)}` : ""}_ — [${PROCESS_LINK_LABEL}](${knowledge.href})`
}

/**
 * V1.7.1d/V1.7.1e — o que a BASE diz, por TIPO de trecho, cada um com a SUA proveniência:
 *   regras   a REGRA OPERACIONAL da seção primeiro (`RULE_SELECTION_V1`), depois o trecho citado (quando é regra) e o detalhe regra;
 *   evitar   a lista do que evitar (complementa a regra, nunca a substitui);
 *   exemplo  exemplo presente no material, sempre rotulado ("não é regra").
 * Trecho de outra seção do mesmo documento leva a própria seção.
 */
type KnowledgeExcerpt = { text: string; heading: string | null; kind: "RULE_CONTENT" | "DO_NOT_CONTENT" | "EXAMPLE_CONTENT" }
function knowledgeExcerptsOf(knowledge: ReliableKnowledgeRef): KnowledgeExcerpt[] {
  // V1.7.1k — citação que já começa pela abertura ("Antes de encerrar qualquer chamada: (1) …") não repete a abertura.
  const leadInShown = knowledge.leadIn && !normalizeForLiteralQuote(knowledge.quote).startsWith(normalizeForLiteralQuote(knowledge.leadIn)) ? knowledge.leadIn : null
  const cited = { text: `${leadInShown ? `${leadInShown} … ` : ""}${knowledge.quote}`, heading: knowledge.heading, kind: (knowledge.contentKind ?? "RULE_CONTENT") as KnowledgeExcerpt["kind"] }
  return [
    ...(knowledge.operativeRule ? [{ text: knowledge.operativeRule.quote, heading: knowledge.operativeRule.heading ?? knowledge.heading, kind: "RULE_CONTENT" as const }] : []),
    cited,
    ...(knowledge.detail ? [{ text: knowledge.detail.quote, heading: knowledge.detail.heading ?? knowledge.heading, kind: (knowledge.detail.contentKind ?? "RULE_CONTENT") as KnowledgeExcerpt["kind"] }] : []),
    // V1.7.1j — fala-modelo que vinha dentro do trecho citado: sempre rotulada como exemplo, nunca em "O processo orienta".
    ...(knowledge.citedExamples ?? []).map((text) => ({ text, heading: knowledge.heading, kind: "EXAMPLE_CONTENT" as const })),
  ]
}
/** Frases de uma lista "Evitar" (literal da base), uma por linha de lista; sem lista, o trecho inteiro. */
const avoidPhrasesOf = (text: string) => {
  // V1.7.1k — linhas de lista pela representação canônica (inclui "(n)" e a enumeração em linha).
  const lines = structuralLinesOf(text).map((line) => line.text.trim()).filter(isListLine).map((line) => stripListMarker(line).trim())
  return lines.length > 0 ? lines : [text.replace(/^[^:]*:\s*/, "")]
}
const uniqueBy = <T,>(values: readonly T[], key: (value: T) => string) => { const seen = new Set<string>(); return values.filter((value) => { const k = key(value); if (seen.has(k)) return false; seen.add(k); return true }) }
/**
 * O que a BASE diz de um ou mais itens, por tipo (a mesma função do Markdown e do view model V2): regras (com a seção quando é
 * outra), o que evitar (frases da lista), exemplos (sem marcador de lacuna) e as fontes (documento × seção, sem repetição).
 */
export type KnowledgeGuidance = { rules: { text: string; otherSection: string | null }[]; avoid: string[]; avoidExcerpts: { phrases: string[]; otherSection: string | null }[]; examples: string[]; sources: ReliableKnowledgeRef[] }
export function knowledgeGuidanceOf(knowledge: readonly ReliableKnowledgeRef[]): KnowledgeGuidance {
  if (knowledge.length === 0) return { rules: [], avoid: [], avoidExcerpts: [], examples: [], sources: [] }
  const primaryHeading = knowledge[0]!.heading
  const excerpts = uniqueBy(knowledge.flatMap(knowledgeExcerptsOf), (excerpt) => `${excerpt.kind}|${excerpt.text.replace(/\s+/g, " ").trim()}`)
  const otherSection = (excerpt: KnowledgeExcerpt) => { const section = sectionLabelOf(excerpt.heading); return section && section !== sectionLabelOf(primaryHeading) ? section : null }
  const avoidExcerpts = excerpts.filter((excerpt) => excerpt.kind === "DO_NOT_CONTENT").map((excerpt) => ({ phrases: avoidPhrasesOf(excerpt.text), otherSection: otherSection(excerpt) }))
  return {
    rules: excerpts.filter((excerpt) => excerpt.kind === "RULE_CONTENT").map((excerpt) => ({ text: stripOuterQuotes(excerpt.text), otherSection: otherSection(excerpt) })),
    avoid: [...new Set(avoidExcerpts.flatMap((entry) => entry.phrases.map(stripOuterQuotes)))],
    avoidExcerpts,
    // V1.7.1m — fala-modelo da base com marcador de lacuna ("O prazo de análise é de...") não é mostrada nem como exemplo.
    examples: excerpts.filter((excerpt) => excerpt.kind === "EXAMPLE_CONTENT" && !hasSuggestedResponsePlaceholder(excerpt.text)).map((excerpt) => stripOuterQuotes(excerpt.text)),
    sources: uniqueBy(knowledge, (entry) => `${entry.documentId}|${sectionLabelOf(entry.heading) ?? ""}`),
  }
}
/** "O processo orienta" / "Base oficial" de um ou mais itens: regras (com a origem de cada documento/seção), evitar e exemplo. */
export const LEGACY_EXAMPLE_LABEL = "Exemplo presente no material (não é regra)"
export function processGuidanceBlocks(knowledge: readonly ReliableKnowledgeRef[], title: string, options: { exampleLabel?: string } = {}): string[] {
  if (knowledge.length === 0) return []
  const guidance = knowledgeGuidanceOf(knowledge)
  const sectionNote = (section: string | null) => (section ? `_Seção “${escapeMarkdownQuote(section)}”:_ ` : "")
  const sources = guidance.sources.map(sourceLine)
  return [
    ...(guidance.rules.length > 0 ? [`**${title}**\n\n${guidance.rules.map((rule) => `> ${sectionNote(rule.otherSection)}${quoteLine(rule.text)}`).join("\n>\n")}`] : [`**${title}**`]),
    sources.join("\n\n"),
    ...(guidance.avoidExcerpts.length > 0 ? [`**O procedimento pede evitar**\n\n${guidance.avoidExcerpts.map((entry) => `> ${sectionNote(entry.otherSection)}${entry.phrases.map(quoteLine).join(" · ")}`).join("\n>\n")}`] : []),
    ...guidance.examples.map((example) => `_${options.exampleLabel ?? LEGACY_EXAMPLE_LABEL}:_ ${quoteLine(example)}`),
  ]
}
/**
 * V1.7.1m — outra fonte oficial do MESMO comportamento que acrescenta uma dimensão ao avaliador (ex.: "(3) explique o próximo
 * passo e o prazo" além de "Informei prazo e canal de retorno?") continua visível em "O processo orienta", com a própria origem.
 * Fonte que só repete o avaliador fica como proveniência (auditoria), sem poluir o texto.
 */
function facetSourcesOf(item: EmittedItem): ReliableKnowledgeRef[] {
  return (item.process?.behavior?.sources ?? []).filter((source) => source.addsFacets.length > 0 && source.documentId && source.href).map((source) => ({ documentId: source.documentId!, documentTitle: source.documentTitle, heading: source.heading, version: null, quote: source.quote, applicability: source.applicability ?? ("LITERAL_ONLY" as const), href: source.href!, leadIn: source.leadIn, detail: null, applicabilityBasis: null, contentKind: "RULE_CONTENT" as const, chunkIndex: null }))
}
export const feedbackKnowledgeOf = (item: EmittedItem): ReliableKnowledgeRef[] => (item.knowledge ? [item.knowledge, ...facetSourcesOf(item)] : [])
const callQuotes = (item: EmittedItem) => item.facts.filter((fact) => !SYSTEM_ROLES.includes(fact.role)).map((fact) => `> ${speakerIntro(fact)}: “${escapeMarkdownQuote(fact.text)}${fact.truncated ? "…" : ""}”`).join("\n>\n")

/** V1.7.1a — EXEMPLO DE CONDUÇÃO: rotulado como sugestão de formulação (nunca fala da chamada, nunca texto oficial). */
export const SUGGESTED_RESPONSE_LABEL = "Exemplo de condução"
export const SUGGESTED_RESPONSE_DISCLAIMER = "sugestão de como dizer — não é fala desta chamada nem texto oficial"
export function renderSuggestedResponse(item: EmittedItem): string[] {
  const text = item.suggestedResponse?.text ?? (item.wording.suggestedResponse ?? "").trim()
  if (!text || item.section === "STRENGTH") return []
  return [`**${SUGGESTED_RESPONSE_LABEL}** _(${SUGGESTED_RESPONSE_DISCLAIMER})_\n\n_“${escapeMarkdownQuote(text.replace(/^[“"«]+|[”"»]+$/g, ""))}”_`]
}

/**
 * V1.7.1e — FORMATO BEHAVIOR-FIRST de um achado de ETAPA DE PROCESSO (monitoria). Título = assunto do comportamento. A evidência
 * e a base são renderizadas pelo SISTEMA; o texto do redator (ou o texto de segurança) diz o comportamento e como aplicar.
 *   PONTO FORTE              assunto → O QUE VOCÊ FEZ BEM (comportamento + falas) → BASE OFICIAL (regra, documento · seção,
 *                            Abrir processo ↗; exemplo rotulado) → por que importa → para manter;
 *   PONTO DE DESENVOLVIMENTO assunto → NA CHAMADA (falas; na omissão, a frase do sistema) → O QUE PRECISA SER AJUSTADO → O
 *                            PROCESSO ORIENTA (regra operacional primeiro, documento · seção, Abrir processo ↗; evitar; exemplo)
 *                            → por que importa → como aplicar → exemplo de condução.
 * Seção sem conteúdo = omitida. O nome interno da etapa nunca é copy.
 */
const OMISSION_NOTE = "_Na chamada analisada, isto não apareceu. No momento em que caberia:_"
function renderProcessItemBlocks(item: EmittedItem): string[] {
  const quotes = callQuotes(item)
  const knowledge = feedbackKnowledgeOf(item)
  if (item.section === "STRENGTH") {
    return [
      `### ${escapeMarkdownQuote(findingLabelOf(item))}`,
      [`**O que você fez bem**`, item.wording.observed, ...(quotes ? [quotes] : [])].join("\n\n"),
      ...processGuidanceBlocks(knowledge, "Base oficial"),
      ...(item.wording.whyItMatters.trim() ? [`**Por que importa:** ${item.wording.whyItMatters}`] : []),
      ...(item.wording.whatYouCanDo.trim() ? [`**Para manter:** ${item.wording.whatYouCanDo}`] : []),
    ]
  }
  return renderDevelopmentBlock([item])
}

/**
 * V1.7.1d — COMPOSIÇÃO DE ACHADOS (`FINDING_COMPOSITION_V1`, determinística e rastreável — nunca LLM). Pontos de desenvolvimento
 * formam UM bloco de coaching só quando há unidade pedagógica real:
 *   mesma fala do operador (o MESMO momento da chamada)  E  regra do mesmo documento  E  da mesma seção.
 * Documento igual, falante igual ou proximidade NÃO bastam. A composição é só de apresentação: cada etapa continua sendo um
 * item (evidência, status, regra, QA, linhagem e analytics intactos); `compositionOf` registra quais itens formam cada bloco.
 */
export const FINDING_COMPOSITION_VERSION = "FINDING_COMPOSITION_V1" as const
export type FindingBlock = { label: string | null; itemIndexes: number[]; basis: ("SAME_CALL_MOMENT" | "SAME_DOCUMENT_SECTION")[] }
const operatorMomentsOf = (item: EmittedItem) => new Set(item.facts.filter((fact) => fact.role === "OPERADOR").map((fact) => fact.text.replace(/\s+/g, " ").trim()))
function pedagogicallyRelated(left: EmittedItem, right: EmittedItem): boolean {
  if (left.section !== "OPPORTUNITY" || right.section !== "OPPORTUNITY" || !isProcessItem(left) || !isProcessItem(right)) return false
  if (!left.knowledge || !right.knowledge) return false
  // V1.7.1m — o "evitar" do MESMO momento da chamada complementa a regra do ponto (a regra primeiro, depois o que evitar),
  // mesmo vindo de outra seção/documento: no smoke V1.7.1l o prazo e "É só aguardar" viravam dois coachings do mesmo momento.
  const avoidComplement = (left.knowledge.contentKind === "DO_NOT_CONTENT") !== (right.knowledge.contentKind === "DO_NOT_CONTENT")
  if (!avoidComplement && (left.knowledge.documentId !== right.knowledge.documentId || (left.knowledge.heading ?? "") !== (right.knowledge.heading ?? ""))) return false
  const moments = operatorMomentsOf(left)
  return [...operatorMomentsOf(right)].some((moment) => moments.has(moment))
}
/** Grupos na ordem do primeiro item de cada um (a ordem de prioridade continua valendo). */
export function composeDevelopmentBlocks(items: readonly EmittedItem[]): EmittedItem[][] {
  const groups: EmittedItem[][] = []
  for (const item of items) {
    const group = groups.find((entry) => entry.some((member) => pedagogicallyRelated(member, item)))
    if (group) group.push(item)
    else groups.push([item])
  }
  return groups
}
/** V1.7.1e — rótulo do bloco = o ASSUNTO comum (um só assunto → ele; vários → a seção do documento). V1.7.1m: o "evitar" que
 * complementa uma regra não dá nome ao bloco (o assunto é a regra). */
const blockLabelOf = (group: readonly EmittedItem[]): string | null => {
  const rules = group.filter((item) => item.knowledge?.contentKind !== "DO_NOT_CONTENT")
  const named = rules.length > 0 && rules.length < group.length ? rules : group
  const labels = [...new Set(named.map((item) => presentationLabelOf(item)).filter((label): label is string => Boolean(label)))]
  if (labels.length === 1) return labels[0]!
  const section = sectionLabelOf(named[0]!.knowledge?.heading)
  return section ? section[0]!.toLocaleUpperCase("pt-BR") + section.slice(1) : labels[0] ?? null
}
/** V1.7.2 — o rótulo do bloco de desenvolvimento (a abertura/card do supervisor falam do mesmo assunto do bloco). */
export const developmentBlockLabelOf = (group: readonly EmittedItem[]): string | null => blockLabelOf(group)
export function compositionOf(items: readonly EmittedItem[]): { version: typeof FINDING_COMPOSITION_VERSION; blocks: FindingBlock[] } {
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  return { version: FINDING_COMPOSITION_VERSION, blocks: composeDevelopmentBlocks(development).filter((group) => group.length > 1).map((group) => ({ label: blockLabelOf(group), itemIndexes: group.map((item) => item.index), basis: ["SAME_CALL_MOMENT", "SAME_DOCUMENT_SECTION"] })) }
}
/** Rótulos dos TEMAS do feedback (um por bloco de coaching) — a abertura/fechamento do sistema fala de temas, não de trechos crus. */
export function developmentTopicsOf(items: readonly EmittedItem[]): string[] {
  return composeDevelopmentBlocks(items.filter((item) => item.section === "OPPORTUNITY")).map(blockLabelOf).filter((label): label is string => Boolean(label))
}

const unique = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
/** "Como aplicar" do bloco sem repetição: uma orientação que é o começo de outra (a mais completa) sai. */
const withoutPrefixed = (values: readonly string[]) => values.filter((value, index) => { const core = value.replace(/[.!\s]+$/, ""); return !values.some((other, position) => position !== index && other.length > value.length && other.startsWith(core)) })
/** Um BLOCO de coaching (uma ou várias etapas do mesmo momento): na chamada → o que precisa ser ajustado → o processo orienta →
 * por que importa → como aplicar → exemplo — sem perder nenhuma etapa. */
function renderDevelopmentBlock(original: readonly EmittedItem[]): string[] {
  // No bloco, primeiro o que FAZER (regra) e depois o que EVITAR — a ordem de prioridade dos itens continua registrada neles.
  const group = [...original].sort((left, right) => Number(left.knowledge?.contentKind === "DO_NOT_CONTENT") - Number(right.knowledge?.contentKind === "DO_NOT_CONTENT"))
  const label = blockLabelOf(group) ?? group[0]!.sectionLabel
  const omission = group.some((item) => item.process?.evidenceType === "VERIFIED_OMISSION" || item.process?.evidenceType === "UNVERIFIED_OMISSION")
  const quotes = unique(group.flatMap((item) => callQuotes(item).split("\n>\n")))
  const knowledge = group.flatMap(feedbackKnowledgeOf)
  const observed = unique(group.map((item) => item.wording.observed))
  const howTo = withoutPrefixed(unique(group.map((item) => item.wording.whatYouCanDo)))
  const suggested = group.map(renderSuggestedResponse).find((blocks) => blocks.length > 0) ?? []
  // V1.7.3 — ausência VERIFICADA sem fala exibível: a frase do SISTEMA (itálico, nunca "Você disse:") representa a conclusão.
  const absence = quotes.length === 0 ? group.map((item) => item.process?.absenceDisplay?.statement).find((statement): statement is string => Boolean(statement)) ?? null : null
  const callBlock = absence ? [`_${escapeMarkdownQuote(absence)}_`] : [...(omission ? [OMISSION_NOTE] : []), ...(quotes.length > 0 ? [quotes.join("\n>\n")] : [])]
  return [
    `### ${escapeMarkdownQuote(label)}`,
    ...(callBlock.length > 0 ? [`**Na chamada**\n\n${callBlock.join("\n\n")}`] : []),
    `**O que precisa ser ajustado**\n\n${observed.length > 1 ? observed.map((text) => `- ${text}`).join("\n") : observed[0] ?? ""}`,
    ...processGuidanceBlocks(knowledge, "O processo orienta"),
    ...unique(group.map((item) => item.wording.whyItMatters)).map((text) => `**Por que importa:** ${text}`),
    ...(howTo.length > 0 ? [`**Como aplicar:** ${howTo.join(" ")}`] : []),
    ...suggested,
  ]
}

/** V1.7.1 — o item traz a etapa de processo com o tipo da evidência (monitoria PROCESS-CENTRIC a partir da V1.7.1). */
export const isProcessItem = (item: Pick<EmittedItem, "process">) => Boolean(item.process?.evidenceType)

/**
 * Blocos de UM item no formato de coaching (V1.6.0): o que aconteceu → (quando sustentado) por que importa → (quando há
 * orientação fundamentada) o que fazer → a regra da base citada, com documento e link. Campo vazio = seção omitida. V1.7.1:
 * itens de etapa de processo usam o formato behavior-first acima (V1.7.1e).
 */
export function renderItemBlocks(item: EmittedItem): string[] {
  if (item.section === "ATTENTION" && item.applicability) return renderApplicabilityBlocks(item)
  if (isProcessItem(item)) return renderProcessItemBlocks(item)
  return [
    `**${item.sectionLabel}**`,
    item.wording.observed,
    ...(item.wording.whyItMatters.trim() ? [`**Por que importa:** ${item.wording.whyItMatters}`] : []),
    ...(item.wording.whatYouCanDo.trim() ? [`**${item.section === "STRENGTH" ? "Para manter" : "O que fazer nos próximos casos"}:** ${item.wording.whatYouCanDo}`] : []),
    // V1.7.1e — a base no próprio ponto, com documento e link.
    ...(item.knowledge ? [`**Base:** ${quoteLine(item.knowledge.quote)} — ${sourceLine(item.knowledge)}`] : []),
    // V1.7.1b — padrão de desenvolvimento do diagnóstico também traz o exemplo de condução (quando há base).
    ...renderSuggestedResponse(item),
  ]
}

/**
 * V1.7.1b — "VALE CONFIRMAR O PRODUTO": o que ficou incerto → a fala do operador → compatível com X (nunca "correto") → o que a
 * base prevê para cada produto (tabela só com 2+ candidatos verificados; cada linha com o PRÓPRIO trecho e documento) → não é
 * erro → etapas que ficaram sem avaliação → como aplicar → exemplo de condução para CONFIRMAR o produto. Tudo do sistema.
 */
export const renderApplicabilityMarkdown = (item: EmittedItem) => renderApplicabilityBlocks(item).join("\n\n")
function renderApplicabilityBlocks(item: EmittedItem): string[] {
  const view = item.applicability!
  const quotes = callQuotes(item)
  const comparison = statementSentence(view)
  const table = view.candidates.length > 1
    ? [`**O que a base prevê para cada produto**`, ["| Produto | O que a base prevê | Documento |", "| --- | --- | --- |", ...view.candidates.map((candidate) => `| ${escapeMarkdownQuote(candidate.product)} | “${escapeMarkdownQuote(candidate.quote)}” | [${escapeMarkdownQuote(candidate.documentTitle)} ↗](${candidate.href}) |`)].join("\n")]
    : view.candidates.map((candidate) => `**O que a base prevê para ${escapeMarkdownQuote(candidate.product)}:** “${escapeMarkdownQuote(candidate.quote)}” — [${escapeMarkdownQuote(candidate.documentTitle)} ↗](${candidate.href})`)
  return [
    `### ${item.sectionLabel}`,
    item.wording.observed,
    ...(quotes ? [`**Na chamada**\n\n${quotes}`] : []),
    ...(comparison ? [comparison] : []),
    ...table,
    ...(item.wording.whyItMatters.trim() ? [item.wording.whyItMatters] : []),
    ...(view.affectedSteps.length > 0 ? [`**Pontos que ficaram sem avaliação:** ${view.affectedSteps.map((step) => `“${escapeMarkdownQuote(step)}”`).join(" · ")}`] : []),
    ...(item.wording.whatYouCanDo.trim() ? [`**Como aplicar:** ${item.wording.whatYouCanDo}`] : []),
    ...renderSuggestedResponse(item),
  ]
}

/** V1.6.1 — limitações da análise (frases do sistema), quando há diagnóstico. */
export function renderLimitations(limitations: readonly string[]): string[] {
  return limitations.length > 0 ? [`**Limitações da análise:** ${limitations.join(" ")}`] : []
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** V1.7.1a — resumo DETERMINÍSTICO da análise (contagens + documentos), nunca texto de modelo. V1.7.1b: "Visão geral" + produto
 * confirmado. V1.7.1e — fala de PONTOS, nunca de "etapas cumpridas". */
export function processSummaryLine(items: readonly EmittedItem[], confirmed: readonly ConfirmedProduct[] = []): string {
  const development = items.filter((item) => item.section === "OPPORTUNITY").length
  const strengths = items.filter((item) => item.section === "STRENGTH").length
  const attention = items.filter((item) => item.section === "ATTENTION").length
  const documents = [...new Set(items.flatMap((item) => (item.knowledge ? [item.knowledge.documentTitle] : [])))]
  const parts = [...(development > 0 ? [plural(development, "ponto a desenvolver", "pontos a desenvolver")] : []), ...(strengths > 0 ? [plural(strengths, "ponto forte", "pontos fortes")] : []), ...(attention > 0 ? [plural(attention, "ponto a confirmar", "pontos a confirmar")] : [])]
  const source = documents.length > 0 ? ` com base no procedimento ${documents.map((title) => `“${escapeMarkdownQuote(title)}”`).join(" e ")}` : ""
  const product = confirmed.length > 0 ? ` Produto identificado: ${confirmed.map((entry) => `${escapeMarkdownQuote(entry.product)} (confirmado ${entry.source === "SYSTEM_DATA" ? "pelo assunto registrado do atendimento" : "pela fala da chamada"})`).join(", ")}.` : ""
  return `**Visão geral:** esta chamada foi analisada${source}: ${parts.join(", ").replace(/, ([^,]*)$/, " e $1")}.${product}`
}
export type ConfirmedProduct = { product: string; source: string }
export const confirmedProductsOf = (resolutions: readonly Pick<ApplicabilityResolution, "status" | "resolvedProduct" | "source">[] | null | undefined): ConfirmedProduct[] =>
  (resolutions ?? []).flatMap((resolution) => (resolution.status === "CONFIRMED" && resolution.resolvedProduct ? [{ product: resolution.resolvedProduct, source: resolution.source }] : []))

/**
 * V1.7.1e — DOCUMENTO DO FEEDBACK em partes: a MESMA função produz o texto publicado, o texto do nó e a prévia do QA ("o que
 * você vê no QA = o que o colaborador recebe", salvo edição do revisor). Cada parte diz de quais itens nasceu — é assim que o
 * QA liga um bloco do feedback aos detalhes técnicos dos seus itens.
 */
export type FeedbackDocumentPartKind = "GREETING" | "INTRODUCTION" | "OVERVIEW" | "GROUP" | "FINDING" | "MATERIALS" | "LIMITATIONS" | "CLOSING"
export type FeedbackDocumentPart = { kind: FeedbackDocumentPartKind; markdown: string; itemIndexes: number[]; label: string | null; section: EmittableSection | null }
const part = (kind: FeedbackDocumentPartKind, markdown: string, itemIndexes: number[] = [], label: string | null = null, section: EmittableSection | null = null): FeedbackDocumentPart => ({ kind, markdown, itemIndexes, label, section })

/**
 * V1.7.1a/V1.7.1b/V1.7.1e — FEEDBACK DE PROCESSO COMPLETO, ORGANIZADO: visão geral → PONTOS DE DESENVOLVIMENTO (na ordem de
 * prioridade, sem numeração editorial) → PONTOS FORTES (os da mesma seção do documento num bloco) → VALE CONFIRMAR →
 * MATERIAIS UTILIZADOS. Nenhum achado confiável fica de fora por tamanho.
 */
function processSectionParts(items: readonly EmittedItem[], confirmed: readonly ConfirmedProduct[]): FeedbackDocumentPart[] {
  return supervisorSectionParts(items, confirmed)
}

/**
 * V1.7.2 — FEEDBACK DE SUPERVISOR (`SUPERVISOR_PRESENTATION_V2`): sem placar ("N pontos fortes"). Ordem: O QUE AJUSTAR (todos os
 * pontos de desenvolvimento, detalhados como antes: fala, o que ajustar, o processo orienta, como aplicar, exemplo) → O QUE
 * MANTER (um parágrafo por fase do atendimento; obrigação cumprida não vira bloco nem medalha; destaque individual só com razão
 * estrutural) → pontos de atenção → materiais. É só apresentação: itens, revisões, observações e analytics não mudam.
 */
function supervisorSectionParts(items: readonly EmittedItem[], confirmed: readonly ConfirmedProduct[]): FeedbackDocumentPart[] {
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  const strengths = items.filter((item) => item.section === "STRENGTH")
  const attention = items.filter((item) => item.section === "ATTENTION")
  const highlighted = strengths.filter(isHighlightedStrength)
  const summarized = strengths.filter((item) => !isHighlightedStrength(item))
  const maintain = maintainParagraphOf(summarized)
  const product = confirmed.length > 0 ? `Produto identificado: ${confirmed.map((entry) => `${escapeMarkdownQuote(entry.product)} (confirmado ${entry.source === "SYSTEM_DATA" ? "pelo assunto registrado do atendimento" : "pela fala da chamada"})`).join(", ")}.` : null
  return [
    ...(product ? [part("OVERVIEW", product, items.map((item) => item.index))] : []),
    ...(development.length > 0 ? [part("GROUP", "## O que ajustar", [], null, "OPPORTUNITY"), ...composeDevelopmentBlocks(development).map((group) => part("FINDING", renderDevelopmentBlock(group).join("\n\n"), group.map((item) => item.index), blockLabelOf(group), "OPPORTUNITY"))] : []),
    ...(strengths.length > 0 ? [
      part("GROUP", "## O que manter", [], null, "STRENGTH"),
      ...(maintain ? [part("FINDING", maintain, summarized.map((item) => item.index), "O que manter", "STRENGTH")] : []),
      ...highlighted.map((item) => part("FINDING", renderProcessItemBlocks(item).join("\n\n"), [item.index], findingLabelOf(item), "STRENGTH")),
    ] : []),
    ...(attention.length > 0 ? [part("GROUP", "## Pontos de atenção", [], null, "ATTENTION"), ...attention.map((item) => part("FINDING", renderApplicabilityBlocks(item).join("\n\n"), [item.index], item.sectionLabel, "ATTENTION"))] : []),
  ]
}

/** V1.7.1a–V1.7.1n — composição anterior (placar + um bloco por ponto forte), preservada para comparação ANTES × DEPOIS. */
export function legacyProcessSectionParts(items: readonly EmittedItem[], confirmed: readonly ConfirmedProduct[]): FeedbackDocumentPart[] {
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  const strengths = items.filter((item) => item.section === "STRENGTH")
  const attention = items.filter((item) => item.section === "ATTENTION")
  const groups: EmittedItem[][] = []
  for (const item of strengths) {
    // V1.7.1m — ponto com comportamento canônico tem título próprio ("Protocolo"): não é agrupado sob a seção ("Checklist do operador").
    const key = item.knowledge && !item.process?.behavior ? `${item.knowledge.documentId}|${item.knowledge.heading ?? ""}` : `item:${item.index}`
    const group = groups.find((entry) => { const first = entry[0]!; return (first.knowledge && !first.process?.behavior ? `${first.knowledge.documentId}|${first.knowledge.heading ?? ""}` : `item:${first.index}`) === key })
    if (group) group.push(item)
    else groups.push([item])
  }
  return [
    part("OVERVIEW", processSummaryLine(items, confirmed), items.map((item) => item.index)),
    ...(development.length > 0 ? [part("GROUP", "## Pontos de desenvolvimento", [], null, "OPPORTUNITY"), ...composeDevelopmentBlocks(development).map((group) => part("FINDING", renderDevelopmentBlock(group).join("\n\n"), group.map((item) => item.index), blockLabelOf(group), "OPPORTUNITY"))] : []),
    ...(strengths.length > 0 ? [part("GROUP", "## Pontos fortes", [], null, "STRENGTH"), ...groups.map((group) => part("FINDING", (group.length > 1 && group[0]!.knowledge ? renderStrengthGroup(group) : renderProcessItemBlocks(group[0]!)).join("\n\n"), group.map((item) => item.index), group.length > 1 ? sectionLabelOf(group[0]!.knowledge?.heading) : findingLabelOf(group[0]!), "STRENGTH"))] : []),
    ...(attention.length > 0 ? [part("GROUP", "## Pontos de atenção", [], null, "ATTENTION"), ...attention.map((item) => part("FINDING", renderApplicabilityBlocks(item).join("\n\n"), [item.index], item.sectionLabel, "ATTENTION"))] : []),
  ]
}

/**
 * V1.7.1a — PONTOS FORTES DA MESMA SEÇÃO do documento num bloco só (evita feedback fragmentado sem perder nada): cada ponto
 * mantém o próprio comportamento e as falas; a base (regra de cada um, documento · seção e o link) aparece uma vez no bloco.
 * A consolidação é só de apresentação; a linhagem, o QA e a disposição continuam por item.
 */
function renderStrengthGroup(items: readonly EmittedItem[]): string[] {
  const title = sectionLabelOf(items[0]!.knowledge!.heading) ?? items[0]!.knowledge!.documentTitle
  return [
    `### ${escapeMarkdownQuote(title)}`,
    [`**O que você fez bem**`, ...items.map((item) => { const quotes = callQuotes(item); return [`**${escapeMarkdownQuote(findingLabelOf(item))}:** ${item.wording.observed}`, ...(quotes ? [quotes] : [])].join("\n\n") })].join("\n\n"),
    ...processGuidanceBlocks(items.flatMap((item) => (item.knowledge ? [item.knowledge] : [])), "Base oficial"),
    ...unique(items.map((item) => item.wording.whyItMatters)).map((text) => `**Por que importa:** ${text}`),
    ...(() => { const keep = unique(items.map((item) => item.wording.whatYouCanDo)); return keep.length > 0 ? [`**Para manter:** ${keep.join(" ")}`] : [] })(),
  ]
}

function materialsPart(items: readonly EmittedItem[]): FeedbackDocumentPart[] {
  const materials = supportMaterialLineageOf(items)
  return materials.length > 0 ? [part("MATERIALS", `**Materiais utilizados**\n\n${materials.map((material) => `- [${escapeMarkdownQuote(material.title)} ↗](${material.href}) — utilizado em: ${unique(material.usedIn.map((use) => escapeMarkdownQuote(use.step))).join(" · ")}`).join("\n")}`, [...new Set(materials.flatMap((material) => material.usedIn.map((use) => use.itemIndex)))])] : []
}

/** Monitoria de processo (itens de etapa e/ou pontos de aplicabilidade da monitoria). */
export const isProcessFeedback = (items: readonly EmittedItem[]) => {
  const content = items.filter((item) => item.section !== "ATTENTION")
  return items.length > 0 && (content.length > 0 ? content.every(isProcessItem) : items.every((item) => (item.domain ?? "MONITORING") === "MONITORING"))
}

/** `legacyComposition` (V1.7.2): só para comparação ANTES × DEPOIS (replay); nenhum caminho de produção usa. */
export type RenderOptions = { presentation?: FeedbackPresentation | null; confirmedProducts?: readonly ConfirmedProduct[]; legacyComposition?: boolean }
const openingParts = (presentation: FeedbackPresentation | null) => (presentation ? [part("GREETING", presentation.greeting), part("INTRODUCTION", presentation.introduction)] : [])
const closingParts = (presentation: FeedbackPresentation | null) => (presentation ? [part("CLOSING", presentation.closing)] : [])
const limitationParts = (limitations: readonly string[]) => renderLimitations(limitations).map((markdown) => part("LIMITATIONS", markdown))
const joinParts = (parts: readonly FeedbackDocumentPart[]) => parts.map((entry) => entry.markdown).join("\n\n")

/** Partes do corpo do feedback (o que o nó e a Revisão humana mostram). */
export function renderFeedbackDocument(items: readonly EmittedItem[], limitations: readonly string[] = [], options: RenderOptions = {}): FeedbackDocumentPart[] {
  const presentation = options.presentation ?? null
  if (isProcessFeedback(items)) {
    // FEEDBACK POR FLAG V2 — narrativa de supervisor + "Entenda este feedback" (detalhes determinísticos a partir dos itens).
    const view = !options.legacyComposition && presentation?.version === NATURAL_FEEDBACK_VERSION ? feedbackViewOf(items, presentation, { confirmedProducts: options.confirmedProducts ?? [] }) : null
    if (view) return [...feedbackViewParts(view, items), ...limitationParts(limitations)]
    return [...openingParts(presentation), ...(options.legacyComposition ? legacyProcessSectionParts : processSectionParts)(items, options.confirmedProducts ?? []), ...materialsPart(items), ...limitationParts(limitations), ...closingParts(presentation)]
  }
  const blocks = items.map((item) => {
    const system = item.facts.filter((fact) => SYSTEM_ROLES.includes(fact.role))
    const conversation = item.facts.filter((fact) => !SYSTEM_ROLES.includes(fact.role))
    const markdown = item.section === "ATTENTION" ? renderItemBlocks(item).join("\n\n") : [
      ...renderItemBlocks(item),
      ...(system.length > 0 ? [`_${system.every((fact) => fact.role === "DADO_OFICIAL") ? "Dados oficiais" : "Dados e análise"}:_ ${system.map(factLine).join(" · ")}`] : []),
      ...(conversation.length > 0 ? [`_Trecho da conversa:_ ${conversation.map(factLine).join(" · ")}`] : []),
    ].join("\n\n")
    return part("FINDING", markdown, [item.index], item.sectionLabel, item.section)
  })
  const materials = supportMaterialsOf(items)
  return [...openingParts(presentation), ...blocks, ...(materials.length > 0 ? [part("MATERIALS", `**Material de apoio:** ${materials.map((material) => material.title).join(" · ")}`, items.map((item) => item.index))] : []), ...limitationParts(limitations), ...closingParts(presentation)]
}

/**
 * O CORPO do feedback (sem o título do caso): saudação e abertura (V1.7.1b) → conteúdo → materiais → limitações → fechamento.
 * A apresentação só organiza e humaniza — o conteúdo é o dos itens, renderizado pelo sistema.
 */
export function renderFeedbackBody(items: readonly EmittedItem[], limitations: readonly string[] = [], options: RenderOptions = {}): string {
  return joinParts(renderFeedbackDocument(items, limitations, options))
}

/**
 * Partes do texto PUBLICADO no Acompanhamento (campo recomendação): o corpo inteiro no feedback de processo; no indicador, os blocos
 * dos itens + limitações (os dados oficiais já vão no campo de evidência) — sempre com saudação/abertura/fechamento (V1.7.1b).
 * É também a PRÉVIA do QA (V1.7.1e).
 */
export function renderPublishedDocument(items: readonly EmittedItem[], limitations: readonly string[] = [], options: RenderOptions = {}): FeedbackDocumentPart[] {
  if (isProcessFeedback(items)) return renderFeedbackDocument(items, limitations, options)
  const presentation = options.presentation ?? null
  return [...openingParts(presentation), ...items.map((item) => part("FINDING", renderItemBlocks(item).join("\n\n"), [item.index], item.sectionLabel, item.section)), ...limitationParts(limitations), ...closingParts(presentation)]
}
export function renderPublishedNarrative(items: readonly EmittedItem[], limitations: readonly string[] = [], options: RenderOptions = {}): string {
  return joinParts(renderPublishedDocument(items, limitations, options))
}

/** Texto legível (Markdown) do conteúdo emitível — o que Revisão humana/alertas/Acompanhamento mostram. Nunca refs internas. */
export function renderEmittedText(label: string, items: readonly EmittedItem[], limitations: readonly string[] = [], options: RenderOptions = {}): string {
  return [`**${label}**`, renderFeedbackBody(items, limitations, options)].join("\n\n")
}

/**
 * V1.7.1a — LINHAGEM do material de apoio: cada documento real que sustentou algum item, com TODOS os itens em que foi usado
 * (a UI deduplica o documento; a associação por item nunca se perde). Ordem: aplicabilidade (VERIFIED antes de LITERAL_ONLY)
 * e ordem dos itens.
 */
export type SupportMaterialLineage = { documentId: string; title: string; href: string; applicability: "VERIFIED" | "LITERAL_ONLY"; usedIn: { itemIndex: number; section: EmittableSection; step: string }[] }
export function supportMaterialLineageOf(items: readonly EmittedItem[]): SupportMaterialLineage[] {
  const byDocument = new Map<string, SupportMaterialLineage & { order: number }>()
  items.forEach((item, order) => {
    // V1.7.1b — cada alternativa de um ponto de aplicabilidade carrega o PRÓPRIO documento como material.
    for (const candidate of item.applicability?.candidates ?? []) {
      const step = `Confirmar o produto (${candidate.product})`
      const existing = byDocument.get(candidate.documentId)
      if (existing) existing.usedIn.push({ itemIndex: item.index, section: item.section, step })
      else byDocument.set(candidate.documentId, { documentId: candidate.documentId, title: candidate.documentTitle, href: candidate.href, applicability: "LITERAL_ONLY", usedIn: [{ itemIndex: item.index, section: item.section, step }], order })
    }
    if (!item.knowledge) return
    // V1.7.1e — "utilizado em" fala do ASSUNTO do achado (rótulo de apresentação), nunca do texto cru da etapa.
    const step = presentationLabelOf(item) ?? item.process?.stepTitle ?? (item.knowledge.quote.length > 80 ? `${item.knowledge.quote.slice(0, 79)}…` : item.knowledge.quote)
    // V1.7.1m — a fonte de outro documento que acrescenta uma dimensão ao ponto (visível em "O processo orienta") também é material.
    for (const knowledge of [item.knowledge, ...facetSourcesOf(item)]) {
      const existing = byDocument.get(knowledge.documentId)
      if (existing) {
        if (!existing.usedIn.some((use) => use.itemIndex === item.index)) existing.usedIn.push({ itemIndex: item.index, section: item.section, step })
        if (knowledge.applicability === "VERIFIED") existing.applicability = "VERIFIED"
        continue
      }
      byDocument.set(knowledge.documentId, { documentId: knowledge.documentId, title: knowledge.documentTitle, href: knowledge.href, applicability: knowledge.applicability, usedIn: [{ itemIndex: item.index, section: item.section, step }], order })
    }
  })
  return [...byDocument.values()].sort((a, b) => (a.applicability === b.applicability ? a.order - b.order : a.applicability === "VERIFIED" ? -1 : 1)).map((entry) => ({ documentId: entry.documentId, title: entry.title, href: entry.href, applicability: entry.applicability, usedIn: entry.usedIn }))
}

const SUPPORT_REASON_MAX = 280
/**
 * MATERIAL DE APOIO (V1.6.0 → V1.7.1a): os documentos cuja regra sustentou algum item, sem repetição — nunca "todos os
 * documentos recuperados". O motivo diz EM QUE ETAPAS o documento foi usado ("Utilizado em: Explicar prazo · Registrar
 * contestação"); id e título são do documento real (o link é montado pela página a partir do id).
 */
export function supportMaterialsOf(items: readonly EmittedItem[]): SupportMaterialRecommendation[] {
  return supportMaterialLineageOf(items).map((material) => {
    const steps = [...new Set(material.usedIn.map((use) => use.step))]
    const reason = `Utilizado em: ${steps.join(" · ")}`
    return { materialId: material.documentId, title: material.title, reason: reason.length > SUPPORT_REASON_MAX ? `${reason.slice(0, SUPPORT_REASON_MAX - 1)}…` : reason }
  })
}

/** O que o nó "Gerar feedback" grava no Execution Context (fonte do Output / Revisão humana). */
export type ReliableFeedbackNodeOutput = {
  kind: typeof RELIABLE_FEEDBACK_NODE_OUTPUT_KIND
  contract: typeof RELIABLE_FEEDBACK_ARTIFACT_CONTRACT
  artifactId: string
  domain: FeedbackDomain
  sourceNodeId: string
  sourceType: InvestigationSourceType
  disposition: ArtifactDisposition
  label: string
  items: EmittedItem[]
  /** Texto legível do que segue (vazio quando nada é emitível). */
  text: string
  policyVersion: string
  reasons: string[]
  /** V1.6.1 — limitações da análise (frases do sistema) quando o feedback veio de um diagnóstico de indicador. */
  limitations: string[]
  /** V1.7.1a — análise completa × feedback (contagens por destino). Ausente em saídas gravadas antes da V1.7.1a. */
  findings?: FindingsSummary
  /** V1.7.1b — saudação/abertura/fechamento FINAIS (validados contra os itens emitidos); null sem itens. */
  presentation?: FeedbackPresentation | null
  /** V1.7.1d — blocos de coaching compostos (quais itens formam cada bloco e por quê); ausente em saídas anteriores. */
  composition?: ReturnType<typeof compositionOf>
}

/** V1.7.1b — contexto da apresentação a partir do artefato (nome do SISTEMA guardado na geração). */
export function presentationContextOf(artifact: ReliableFeedbackArtifactV1): PresentationContext {
  const indicatorName = artifact.domain === "INDICATOR" ? (artifact.label.split(" · ")[0] ?? null) : null
  return { domain: artifact.domain, label: artifact.label, firstName: artifact.presentation?.recipient?.firstName ?? null, indicatorName, indicatorCode: indicatorName, interaction: artifact.processAssessment?.interaction ?? null }
}
/** A apresentação final de uma emissão (null sem itens ou em artefato anterior à V1.7.1b). */
export function presentationOf(artifact: ReliableFeedbackArtifactV1, items: readonly EmittedItem[], options: { legacy?: boolean; supervisorV172?: boolean } = {}): FeedbackPresentation | null {
  if (items.length === 0 || !artifact.presentation) return null
  return resolvePresentation(artifact.presentation, items, presentationContextOf(artifact), options)
}

export function nodeOutputOf(artifactId: string, artifact: ReliableFeedbackArtifactV1, reviews: readonly ArtifactReviewState[]): ReliableFeedbackNodeOutput {
  const disposition = currentDisposition(artifact, reviews)
  const items = disposition === "READY" ? emittedItems(artifact, reviews) : []
  const reasons = artifact.blockedReason ? [artifact.blockedReason] : [...new Set(artifact.items.flatMap((item) => item.decision.reasons))]
  return {
    kind: RELIABLE_FEEDBACK_NODE_OUTPUT_KIND,
    contract: RELIABLE_FEEDBACK_ARTIFACT_CONTRACT,
    artifactId,
    domain: artifact.domain,
    sourceNodeId: artifact.sourceNodeId,
    sourceType: artifact.sourceType,
    disposition,
    label: artifact.label,
    items,
    text: items.length > 0 ? (artifact.prvClosing ? prvClosingTextOf(artifact.prvClosing, items) : renderEmittedText(artifact.label, items, artifact.indicatorDiagnosis?.limitations ?? [], { presentation: presentationOf(artifact, items), confirmedProducts: confirmedProductsOf(artifact.processAssessment?.applicability as ApplicabilityResolution[] | undefined) })) : "",
    policyVersion: artifact.policyVersion,
    reasons,
    limitations: artifact.prvClosing ? artifact.prvClosing.diagnosis.investigations.flatMap((investigation) => investigation.limitations) : artifact.indicatorDiagnosis?.limitations ?? [],
    findings: findingsSummaryOf(artifact, reviews),
    presentation: presentationOf(artifact, items),
    composition: compositionOf(items),
  }
}

export function isReliableFeedbackNodeOutput(value: unknown): value is ReliableFeedbackNodeOutput {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === RELIABLE_FEEDBACK_NODE_OUTPUT_KIND
}

/** INDICATOR DIAGNOSIS V1 — texto do feedback do fechamento: derivado da MESMA visão do colaborador (itens que realmente saem). */
export function prvClosingTextOf(data: PrvClosingArtifactData, items: readonly EmittedItem[]): string {
  const narrative = resolvePrvNarrative(data.narrative, items, data)
  const limitations = data.diagnosis.investigations.flatMap((investigation) => investigation.limitations.filter((limitation) => !/Subgrupo/.test(limitation)))
  return renderPrvFeedbackText(prvCollaboratorViewOf(items, data, narrative), limitations)
}
