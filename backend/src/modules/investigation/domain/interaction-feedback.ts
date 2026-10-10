import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import { candidatePolarityOf, type ClaimCandidate } from "./claim-candidates.js"
import { projectDisplayEvidence, type DisplayEvidence, type DisplayEvidenceResult, type DisplayProjectionContext } from "./feedback-display-evidence.js"
import type { InteractionFinding, InteractionFindingKind, InteractionSemanticFrame, SemanticObservation } from "./interaction-semantic-frame.js"
import type { Ownership } from "./outcome-attribution.js"
import type { ProceduralComparisonStatus, ProceduralEvaluation } from "./procedural-semantics.js"
import type { ClaimPolarity } from "./tool-trace.js"

/**
 * INTERACTION FEEDBACK V1 (V1.4.9) — composição ESTRUTURAL e DETERMINÍSTICA do feedback de UMA interação de UM colaborador.
 *
 * Função pura: não chama modelo, não lê banco, não está ligada a nenhum Output/Workflow (a fiação é etapa posterior). Parte
 * SÓ de findings que o pipeline já aceitou (frame verificado → promoção → atribuição → findings procedimentais) e nunca muda
 * finding, atribuição, ownership, polaridade ou escopo — só os LÊ. Cada item separa quatro camadas que nunca se misturam:
 *   FACT           — evidência verificada (turno, falante, trecho literal curto, tipo da observação) — vem do verifier;
 *   INTERPRETATION — kind/ownership/polaridade estrutural do finding, escopo sempre da interação — vem do pipeline;
 *   GUIDANCE       — FONTE da orientação (reforço | coaching | regra da base com lineage | nenhuma) — decidida por código;
 *   WORDING        — texto final: SEMPRE null nesta versão (a redação por LLM é etapa futura e não poderá mudar as outras três).
 *
 * Regras: só ownership AGENT vira crítica individual; INTERACTION/CUSTOMER/PROCESS/UNKNOWN nunca viram culpa (contexto neutro,
 * só supervisor); procedimento só com lineage completo da base; sem evidência verificada o item cai; uma interação nunca vira
 * padrão do colaborador; materialidade V1 = TODO item exibível entra (sem ranking, sem LLM).
 */
export const INTERACTION_FEEDBACK_CONTRACT = "INTERACTION_FEEDBACK_V1" as const

export type InteractionFeedbackStatus = "HAS_POINTS" | "NOTHING_MATERIAL" | "INSUFFICIENT_EVIDENCE"
export type FeedbackSection = "STRENGTH" | "OPPORTUNITY" | "NEUTRAL_CONTEXT" | "UNCERTAINTY" | "EXCLUDED"
export type GuidanceSource = "REINFORCEMENT" | "COACHING_SUGGESTION" | "KB_RULE" | "NONE"
export type FeedbackAudience = "COLLABORATOR" | "SUPERVISOR_ONLY" | "AUDIT_ONLY"
export type ReviewReason = "OPPORTUNITY_PRESENT" | "KB_RULE_GUIDANCE" | "NEGATIVE_AGENT_FINDING" | "STRENGTH_ONLY" | "NO_COLLABORATOR_CONTENT"

/** Seções exibíveis ao colaborador (depois da revisão, quando exigida); o resto é supervisor/auditoria. */
export const COLLABORATOR_SECTIONS: readonly FeedbackSection[] = ["STRENGTH", "OPPORTUNITY"]
export const SECTION_AUDIENCE: Record<FeedbackSection, FeedbackAudience> = { STRENGTH: "COLLABORATOR", OPPORTUNITY: "COLLABORATOR", NEUTRAL_CONTEXT: "SUPERVISOR_ONLY", UNCERTAINTY: "SUPERVISOR_ONLY", EXCLUDED: "AUDIT_ONLY" }

/** Trecho literal exibido no máximo com este tamanho (prefixo literal do trecho verificado; `truncated` diz que foi cortado). */
export const FEEDBACK_QUOTE_MAX_CHARS = 240
export const SINGLE_INTERACTION_UNCERTAINTY = "evidência de uma única interação; não representa padrão"
/** Rótulo usado quando o rótulo informado carrega identificador interno (nunca exibido). */
export const FALLBACK_INTERACTION_LABEL = "Interação analisada"

/** Handles internos que NUNCA podem aparecer em campo exibível (interação, finding/pattern de claim, candidato, fato, finding local, base). */
export const INTERNAL_REF_PATTERN = /\b(?:I|P|SF|SP|CC|F|FP|K|KR|M)-?\d+\b/

/**
 * Lineage procedimental completo: a afirmação do operador + a regra da base (handle da execução) + o documento. Sem os três
 * identificadores da base um item procedimental é EXCLUDED — nunca vira KB_RULE.
 */
export type ProceduralLineage = { interactionRef: string; assertionRef: string; status: ProceduralComparisonStatus; ruleRef: string; documentRef: string; documentTitle: string; ruleQuote: string | null; /** Id REAL do documento/material (resolvido pelo mapa de handles da execução) — origem do link; null = sem link. */ documentId: string | null }

/** Resolve o handle do documento (K-n) para o id real, a partir do mapa de handles gravado no trace (`investigation.handles`). */
export type DocumentIdResolver = (documentRef: string) => string | null | undefined
export function documentIdResolverFromHandles(handles: readonly { handle: string; kind: string; realId: string }[]): DocumentIdResolver {
  const byHandle = new Map(handles.filter((item) => item.kind === "K").map((item) => [item.handle.toUpperCase(), item.realId]))
  return (documentRef) => byHandle.get(documentRef.trim().toUpperCase()) ?? null
}

/** Chave do lineage: `I-ref/assertion`. */
export const proceduralLineageKey = (interactionRef: string, assertionRef: string) => `${interactionRef}/${assertionRef}`

/** Lineage a partir das avaliações em memória (runtime). Avaliação sem regra não gera lineage. */
export function proceduralLineageFromEvaluations(evaluations: readonly ProceduralEvaluation[], resolveDocumentId?: DocumentIdResolver): Map<string, ProceduralLineage> {
  const lineage = new Map<string, ProceduralLineage>()
  for (const item of evaluations) {
    if (!item.rule) continue
    lineage.set(proceduralLineageKey(item.interactionRef, item.assertionRef), { interactionRef: item.interactionRef, assertionRef: item.assertionRef, status: item.status, ruleRef: item.rule.ruleRef, documentRef: item.rule.documentRef, documentTitle: item.rule.documentTitle, ruleQuote: item.rule.quote, documentId: resolveDocumentId?.(item.rule.documentRef) ?? null })
  }
  return lineage
}

/** Lineage a partir do SINAL gravado no trace (`signals.interactionAnalysis.procedural.items`). Item sem regra = sem lineage. */
export function proceduralLineageFromSignalItems(items: readonly { interactionRef: string; assertionRef: string; status: ProceduralComparisonStatus; ruleRef?: string | null | undefined; documentRef?: string | null | undefined; documentTitle?: string | null | undefined; ruleQuote?: string | null | undefined }[], resolveDocumentId?: DocumentIdResolver): Map<string, ProceduralLineage> {
  const lineage = new Map<string, ProceduralLineage>()
  for (const item of items) {
    if (!item.ruleRef || !item.documentRef || !item.documentTitle) continue
    lineage.set(proceduralLineageKey(item.interactionRef, item.assertionRef), { interactionRef: item.interactionRef, assertionRef: item.assertionRef, status: item.status, ruleRef: item.ruleRef, documentRef: item.documentRef, documentTitle: item.documentTitle, ruleQuote: item.ruleQuote ?? null, documentId: resolveDocumentId?.(item.documentRef) ?? null })
  }
  return lineage
}

/** O trecho exibível NUNCA é seguro por padrão: dado pessoal (protocolo, CPF, telefone) exige redaction antes de qualquer UI. */
export type EvidenceRedaction = { required: true; status: "PENDING" }

/** FACT — uma unidade de evidência verificada. `quote` é literal (prefixo do trecho verificado quando cortado). */
export type FeedbackFact = {
  turnRef: string
  speaker: string | null
  quote: string
  truncated: boolean
  /** Tipo da observação que contém o trecho (AGENT_ACTION, CUSTOMER_NEED…); FINDING_EVIDENCE quando só o finding a carrega. */
  evidenceType: SemanticObservation["kind"] | "FINDING_EVIDENCE"
  redaction: EvidenceRedaction
}

export type FeedbackInterpretation = {
  kind: InteractionFindingKind
  /** Dono já decidido pelo pipeline (ausente = UNKNOWN; o compositor nunca infere). */
  ownership: Ownership
  polarity: ClaimPolarity
  /** Uma interação descreve ESTA conversa — nunca padrão. O compositor não eleva escopo. */
  scope: "INTERACTION_SPECIFIC"
  /** Significado seguro determinístico da seção (sem handle, sem texto de modelo). */
  meaning: string
}

/**
 * Referência à base de conhecimento de um item procedimental. `href` vem SÓ do id real do documento pela rota canônica
 * (`buildKnowledgeMaterialHref`) — nunca de texto de modelo; o redator não recebe nem escreve link. Sem id resolvido, o item
 * carrega documento/regra e NENHUM link. `ruleRef` é o handle da regra na execução (auditoria): a visão exibível o remove.
 */
export type KnowledgeRef = { documentTitle: string; ruleRef: string; href: string | null; openBehavior: "NEW_TAB" | null }

/**
 * Política do link (para a UI futura, nada renderizado aqui): abrir em NOVA ABA para não tirar o operador da tela do feedback —
 * `target="_blank"` + `rel="noopener noreferrer"`. Acesso continua decidido pelo backend ao abrir o material.
 */
export const KNOWLEDGE_LINK_POLICY = { openBehavior: "NEW_TAB", target: "_blank", rel: "noopener noreferrer", hrefSource: "buildKnowledgeMaterialHref(documentId)", modelMayWriteHref: false } as const

/**
 * TODO conteúdo cuja classificação depende do casamento procedimental (afirmação ↔ regra da base) — divergência (KB_RULE) E
 * aderência (STRENGTH procedimental) — é composto para AUDITORIA, mas NÃO é entregue enquanto o casamento não for validado:
 * o replay DEV achou um falso positivo ("Não precisa explicar…" × regra sobre oferta), e o matcher que erra na divergência
 * pode errar no elogio. Lineage, knowledgeRef e href ficam preservados; a revisão continua conforme o contrato, mas NÃO
 * desbloqueia a entrega; nada disso entra no Writer Input nem conta como critério de liberação do Writer Gate.
 */
export const PROCEDURAL_MATCHING_DELIVERY_POLICY = { status: "BLOCKED", reason: "PROCEDURAL_MATCHING_NOT_VALIDATED", scope: ["PROCEDURAL_DIVERGENCE", "PROCEDURAL_ADHERENCE"], humanReviewUnblocks: false, writerGateCriterion: false } as const
export type ItemDeliveryBlock = "PROCEDURAL_MATCHING_NOT_VALIDATED" | "INSUFFICIENT_DISPLAY_EVIDENCE"

/**
 * V1.4.9d — DELIVERY EVIDENCE READINESS. "Finding estruturalmente válido" ≠ "item com evidência EXIBÍVEL suficiente para ser
 * comunicado ao colaborador e redigido". Decidido por código, só com a estrutura já verificada da evidência DEPOIS da projeção
 * de display (o que foi retido por privacidade não conta): papel de cada trecho = falante verificado (OPERADOR/CLIENTE/EVENTO;
 * observação INTERACTION_EVENT = evento) e tipo da observação que o contém (CUSTOMER_NEED = necessidade). Nenhuma análise léxica,
 * nenhuma LLM. Item não READY continua no feedback (auditoria/supervisor/analytics/provenance) e nunca vai ao redator, ao
 * colaborador nem a notificação — o redator não decide suficiência de evidência.
 *
 *   STRENGTH              → ≥ 1 trecho exibível do OPERADOR (o comportamento positivo; significado seguro sozinho não vira elogio)
 *   FRICTION              → evento exibível que É o atrito, OU trecho do OPERADOR + reação/contexto do CLIENTE, ambos exibíveis
 *   CONTRADICTION         → todas as partes exibíveis (nenhuma retida) e ≥ 2 trechos
 *   UNRESOLVED_NEED       → a necessidade (CUSTOMER_NEED) E a condução do OPERADOR, ambas exibíveis
 *   PROCEDURAL_DIVERGENCE → ≥ 1 trecho exibível do OPERADOR (e continua bloqueado pela política procedimental)
 */
export const DELIVERY_READINESS_VERSION = "DELIVERY_EVIDENCE_READINESS_V1" as const
export type ReadinessRequirement = "OPERATOR_BEHAVIOR" | "EVENT_OR_OPERATOR_AND_CUSTOMER" | "ALL_PARTS_DISPLAYABLE" | "CUSTOMER_NEED" | "OPERATOR_CONDUCT"
export type DeliveryEvidenceReadiness = {
  version: typeof DELIVERY_READINESS_VERSION
  status: "READY" | "INSUFFICIENT_DISPLAY_EVIDENCE" | "NOT_APPLICABLE"
  /** Requisitos do kind que a evidência exibível NÃO atendeu (vazio quando READY). */
  missing: ReadinessRequirement[]
  displayed: { operator: number; customer: number; event: number; customerNeed: number; total: number }
  withheld: number
}

type EvidenceRole = "OPERATOR" | "CUSTOMER" | "EVENT" | "OTHER"
function roleOf(evidence: DisplayEvidence): EvidenceRole {
  const speaker = (evidence.speaker ?? "").toUpperCase()
  if (speaker === "EVENTO" || evidence.evidenceType === "INTERACTION_EVENT") return "EVENT"
  if (speaker === "OPERADOR") return "OPERATOR"
  if (speaker === "CLIENTE") return "CUSTOMER"
  return "OTHER"
}

/** Readiness de UM item a partir da evidência já projetada para exibição. Seções que não vão ao colaborador: NOT_APPLICABLE. */
export function deliveryReadinessOf(kind: InteractionFindingKind, section: FeedbackSection, display: readonly DisplayEvidenceResult[]): DeliveryEvidenceReadiness {
  const shown = display.filter((entry): entry is DisplayEvidence => entry.status === "DISPLAYED")
  const roles = shown.map(roleOf)
  const count = (role: EvidenceRole) => roles.filter((item) => item === role).length
  const displayed = { operator: count("OPERATOR"), customer: count("CUSTOMER"), event: count("EVENT"), customerNeed: shown.filter((entry) => entry.evidenceType === "CUSTOMER_NEED").length, total: shown.length }
  const withheld = display.length - shown.length
  const result = (missing: ReadinessRequirement[], applicable = true): DeliveryEvidenceReadiness => ({ version: DELIVERY_READINESS_VERSION, status: !applicable ? "NOT_APPLICABLE" : missing.length === 0 ? "READY" : "INSUFFICIENT_DISPLAY_EVIDENCE", missing, displayed, withheld })
  if (!COLLABORATOR_SECTIONS.includes(section)) return result([], false)
  switch (kind) {
    case "STRENGTH":
    case "PROCEDURAL_DIVERGENCE":
      return result(displayed.operator > 0 ? [] : ["OPERATOR_BEHAVIOR"])
    case "FRICTION":
      return result(displayed.event > 0 || (displayed.operator > 0 && displayed.customer > 0) ? [] : ["EVENT_OR_OPERATOR_AND_CUSTOMER"])
    case "CONTRADICTION":
      return result(withheld === 0 && displayed.total >= 2 ? [] : ["ALL_PARTS_DISPLAYABLE"])
    case "UNRESOLVED_NEED":
      return result([...(displayed.customerNeed > 0 ? [] : ["CUSTOMER_NEED" as const]), ...(displayed.operator > 0 ? [] : ["OPERATOR_CONDUCT" as const])])
    default:
      // Kind sem regra de comunicação definida: nunca READY por omissão.
      return result(["OPERATOR_BEHAVIOR"])
  }
}

export type FeedbackGuidance = {
  source: GuidanceSource
  /** Só KB_RULE é orientação obrigatória; coaching é sugestão. */
  mandatory: boolean
  knowledge: KnowledgeRef | null
}

export type FeedbackItemProvenance = {
  findingRef: string
  findingHandle: string | null
  findingSource: InteractionFinding["source"]
  declaredKind: InteractionFindingKind | null
  attribution: InteractionFinding["attribution"]
  observationRefs: string[]
  candidateRef: string | null
  candidateSafeMeaning: string | null
  /** Candidato com polaridade diferente da estrutural: a estrutura vence; registrado para auditoria. */
  candidatePolarityConflict: boolean
  /** Regra aplicada para a seção (auditoria). */
  sectionRule: string
  proceduralLineage: ProceduralLineage | null
  /** Evidência BRUTA verificada, inteira (alinhada por índice com `fact`) — só auditoria; nunca vira exibição sem a projeção de display. */
  rawEvidence: RawVerifiedEvidence[]
  /** Findings estruturalmente IDÊNTICOS a este (mesma interação/seção/kind/dono/orientação/evidência/lineage), colapsados nele. */
  collapsedFindings: CollapsedFinding[]
}

export type CollapsedFinding = { findingRef: string; findingHandle: string | null; findingSource: InteractionFinding["source"]; observationRefs: string[]; candidateRef: string | null }

export type RawVerifiedEvidence = { turnRef: string; speaker: string | null; quote: string }

export type InteractionFeedbackItem = {
  section: FeedbackSection
  audience: FeedbackAudience
  fact: FeedbackFact[]
  interpretation: FeedbackInterpretation
  guidance: FeedbackGuidance
  /** Evidência já projetada para exibição (alinhada por índice com `fact`/`provenance.rawEvidence`) — a ÚNICA que pode ir à UI/ao redator. */
  displayEvidence: DisplayEvidenceResult[]
  /** V1.4.9d: a evidência exibível sustenta comunicar este item? (decisão de código) */
  readiness: DeliveryEvidenceReadiness
  /** Entrega ao colaborador deste item (seção de colaborador, sem bloqueio de política E evidência exibível READY). */
  delivery: { collaborator: boolean; blocked: ItemDeliveryBlock | null }
  wording: null
  provenance: FeedbackItemProvenance
}

export type FeedbackUncertainty = { code: "SINGLE_INTERACTION" | "FRAME_NOT_RETURNED" | "FRAME_EMPTY" | "NO_FINDINGS" | "PROCEDURE_PENDING_VERIFICATION" | "ITEMS_EXCLUDED" | "PROCEDURAL_COVERAGE_PARTIAL"; text: string }

export type InteractionFeedbackReview = { required: boolean; reasons: ReviewReason[] }

/**
 * Política de entrega registrada no contrato (nada é enviado aqui):
 *   HAS_POINTS            → colaborador (depois da revisão quando exigida) + notificação;
 *   NOTHING_MATERIAL      → sem feedback ao colaborador, sem notificação; fica em auditoria/saída interna;
 *   INSUFFICIENT_EVIDENCE → idem, com a incerteza registrada.
 * Além do status, item com bloqueio de política (conteúdo procedimental — `PROCEDURAL_MATCHING_DELIVERY_POLICY`) não é entregue: sem nenhum item entregável, não há entrega nem
 * notificação, mesmo com HAS_POINTS (o feedback continua composto para auditoria).
 */
export type InteractionFeedbackDelivery = {
  collaborator: boolean
  notification: boolean
  audit: true
  reviewBeforeCollaborator: boolean
  /**
   * V1.4.9d: DELIVERABLE | NOTHING_MATERIAL | INSUFFICIENT_EVIDENCE (espelham o status) | NOT_DELIVERABLE = há material
   * estrutural de colaborador, mas nenhum item pode ser comunicado (política procedimental e/ou evidência exibível
   * insuficiente) — fica para auditoria/supervisor, sem redator, sem entrega, sem notificação.
   */
  state: "DELIVERABLE" | "NOTHING_MATERIAL" | "INSUFFICIENT_EVIDENCE" | "NOT_DELIVERABLE"
  blockedReasons: ItemDeliveryBlock[]
}

export type InteractionFeedbackV1 = {
  contract: typeof INTERACTION_FEEDBACK_CONTRACT
  subject: { collaboratorRef: string }
  interaction: { label: string }
  status: InteractionFeedbackStatus
  items: InteractionFeedbackItem[]
  counts: Record<FeedbackSection, number>
  uncertainties: FeedbackUncertainty[]
  review: InteractionFeedbackReview
  delivery: InteractionFeedbackDelivery
  summaryWording: null
  /** Interna — nunca exibida. */
  provenance: { interactionRef: string; interactionId: string; sourceRun: string; labelRejected: boolean; findingRefs: string[]; findingHandles: string[]; observationRefs: string[]; candidateRefs: string[]; /** Itens colapsados pela deduplicação estrutural (0 = nenhum). */ collapsedDuplicates: number }
}

export type ComposeInteractionFeedbackInput = {
  subject: { collaboratorRef: string }
  frame: InteractionSemanticFrame
  /** Rótulo exibível (data + assunto) montado pelo chamador — nunca identificador interno. */
  interactionLabel: string
  sourceRun: string
  proceduralLineage?: ReadonlyMap<string, ProceduralLineage> | undefined
  /** Candidatos da execução: só fornecem proveniência/significado seguro para auditoria — nunca mudam a estrutura. */
  claimCandidates?: readonly ClaimCandidate[] | undefined
  /** Contexto da projeção de display (nomes de outros operadores conhecidos → trecho retido). */
  displayContext?: DisplayProjectionContext | undefined
}

const OPERATOR_OBSERVATION_KINDS = new Set<SemanticObservation["kind"]>(["AGENT_ACTION", "AGENT_STATEMENT", "COMMITMENT", "PROCEDURE_ASSERTION", "ANSWER"])
const isOperatorEvidence = (observation: SemanticObservation) => OPERATOR_OBSERVATION_KINDS.has(observation.kind) || observation.evidence.some((unit) => (unit.speaker ?? "").toUpperCase() === "OPERADOR")

const MEANING: Record<FeedbackSection, string> = {
  STRENGTH: "comportamento positivo observado nesta interação",
  OPPORTUNITY: "ponto de desenvolvimento observado nesta interação",
  NEUTRAL_CONTEXT: "contexto da interação, sem atribuição ao colaborador",
  UNCERTAINTY: "questão a verificar, sem conclusão",
  EXCLUDED: "item excluído do feedback",
}

/** Todas as observações do frame (id → observação). */
export function frameObservations(frame: InteractionSemanticFrame): Map<string, SemanticObservation> {
  const all: SemanticObservation[] = [...frame.customerNeeds, ...frame.questions, ...frame.answers, ...frame.agentActions, ...frame.agentStatements, ...frame.commitments, ...frame.customerSignals, ...frame.procedureAssertions, ...frame.interactionEvents]
  return new Map(all.map((observation) => [observation.id, observation]))
}

type SectionDecision = { section: FeedbackSection; guidance: FeedbackGuidance; rule: string; lineage: ProceduralLineage | null }

const NO_GUIDANCE: FeedbackGuidance = { source: "NONE", mandatory: false, knowledge: null }

/** Referência à base com link DETERMINÍSTICO (id real → rota canônica); sem id, nenhum link. */
export function knowledgeRefOf(lineage: ProceduralLineage): KnowledgeRef {
  const href = lineage.documentId ? buildKnowledgeMaterialHref(lineage.documentId) : null
  return { documentTitle: lineage.documentTitle, ruleRef: lineage.ruleRef, href, openBehavior: href ? KNOWLEDGE_LINK_POLICY.openBehavior : null }
}

/** Lineage completo e coerente com o finding (mesma afirmação, mesma regra, status esperado); senão null. */
function lineageOf(finding: InteractionFinding, lineage: ReadonlyMap<string, ProceduralLineage> | undefined, expected: ProceduralComparisonStatus): ProceduralLineage | null {
  const procedural = finding.procedural
  if (!procedural || procedural.status !== expected) return null
  const entry = lineage?.get(proceduralLineageKey(finding.interactionRef, procedural.assertionRef)) ?? null
  if (!entry || !entry.ruleRef || !entry.documentRef || !entry.documentTitle) return null
  if (entry.status !== expected || (procedural.ruleRef && procedural.ruleRef !== entry.ruleRef)) return null
  return entry
}

/** Seção de UM finding — só kind + ownership + observações referenciadas + lineage. Nunca texto. */
export function sectionOf(finding: InteractionFinding, observations: SemanticObservation[], lineage?: ReadonlyMap<string, ProceduralLineage>): SectionDecision {
  const ownership: Ownership = finding.ownership ?? "UNKNOWN"
  const neutral = (rule: string): SectionDecision => ({ section: "NEUTRAL_CONTEXT", guidance: NO_GUIDANCE, rule, lineage: null })
  const excluded = (rule: string): SectionDecision => ({ section: "EXCLUDED", guidance: NO_GUIDANCE, rule, lineage: null })
  const procedural = finding.source === "PROCEDURAL"
  switch (finding.kind) {
    case "STRENGTH": {
      if (procedural) {
        const verified = lineageOf(finding, lineage, "CONSISTENT")
        if (!verified) return excluded("aderência procedimental sem lineage completo da base")
        return { section: "STRENGTH", guidance: { source: "REINFORCEMENT", mandatory: false, knowledge: knowledgeRefOf(verified) }, rule: "aderência verificada contra a base (lineage completo)", lineage: verified }
      }
      if (ownership !== "AGENT") return neutral(`força com ownership ${ownership} não é mérito individual`)
      if (!observations.some(isOperatorEvidence)) return neutral("força sem observação do operador — não vira elogio")
      return { section: "STRENGTH", guidance: { source: "REINFORCEMENT", mandatory: false, knowledge: null }, rule: "STRENGTH · ownership AGENT · observação do operador", lineage: null }
    }
    case "FRICTION":
    case "CONTRADICTION":
    case "UNRESOLVED_NEED":
      if (ownership !== "AGENT") return neutral(`${finding.kind} com ownership ${ownership} nunca vira crítica individual`)
      return { section: "OPPORTUNITY", guidance: { source: "COACHING_SUGGESTION", mandatory: false, knowledge: null }, rule: `${finding.kind} · ownership AGENT — sugestão de coaching`, lineage: null }
    case "PROCEDURAL_DIVERGENCE": {
      const verified = lineageOf(finding, lineage, "CONTRADICTED")
      if (!verified) return excluded("divergência procedimental sem lineage completo (regra + documento) — nunca KB_RULE")
      if (ownership !== "AGENT") return neutral(`divergência procedimental com ownership ${ownership} nunca vira crítica individual`)
      return { section: "OPPORTUNITY", guidance: { source: "KB_RULE", mandatory: true, knowledge: knowledgeRefOf(verified) }, rule: "divergência APLICÁVEL confirmada contra a base (lineage completo)", lineage: verified }
    }
    case "PROCEDURAL_QUESTION":
      return { section: "UNCERTAINTY", guidance: NO_GUIDANCE, rule: "afirmação sobre procedimento a verificar — nunca erro", lineage: null }
    case "INTERACTION_FRICTION":
      return neutral("atrito da interação (cliente/evento) — sem atribuição")
    case "UNRESOLVED_OUTCOME":
      return neutral(`resultado aberto sem atribuição ao operador (ownership ${ownership})`)
    default:
      return neutral(`${finding.kind} — contexto`)
  }
}

const truncateLiteral = (quote: string): { quote: string; truncated: boolean } => (quote.length <= FEEDBACK_QUOTE_MAX_CHARS ? { quote, truncated: false } : { quote: quote.slice(0, FEEDBACK_QUOTE_MAX_CHARS), truncated: true })

/** FACT do item: SÓ a evidência verificada do finding, com o tipo da observação que a contém. Duplicatas (turno + trecho) caem. */
function factsOf(finding: InteractionFinding, observations: SemanticObservation[]): { facts: FeedbackFact[]; raw: RawVerifiedEvidence[] } {
  const seen = new Set<string>()
  const facts: FeedbackFact[] = []
  const raw: RawVerifiedEvidence[] = []
  for (const unit of finding.evidence) {
    const key = `${unit.turnRef}\u0000${unit.quote}`
    if (seen.has(key)) continue
    seen.add(key)
    const owner = observations.find((observation) => observation.evidence.some((item) => item.turnRef === unit.turnRef && item.quote === unit.quote))
    facts.push({ turnRef: unit.turnRef, speaker: unit.speaker, ...truncateLiteral(unit.quote), evidenceType: owner?.kind ?? "FINDING_EVIDENCE", redaction: { required: true, status: "PENDING" } })
    raw.push({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote })
  }
  return { facts, raw }
}

/** Rótulo exibível: data local + assunto. Nunca inclui identificador. */
export function interactionDisplayLabel(input: { localDate: string; subject: string | null }): string {
  const [year, month, day] = input.localDate.split("-")
  const date = year && month && day ? `${day}/${month}/${year}` : input.localDate
  return input.subject ? `${date} · ${input.subject}` : date
}

/** Entrega por item: seção de colaborador, classificação que não depende do casamento procedimental E evidência exibível READY. */
function deliveryOf(section: FeedbackSection, dependsOnProceduralMatching: boolean, readiness: DeliveryEvidenceReadiness): InteractionFeedbackItem["delivery"] {
  if (!COLLABORATOR_SECTIONS.includes(section)) return { collaborator: false, blocked: null }
  if (dependsOnProceduralMatching) return { collaborator: false, blocked: PROCEDURAL_MATCHING_DELIVERY_POLICY.reason }
  if (readiness.status !== "READY") return { collaborator: false, blocked: "INSUFFICIENT_DISPLAY_EVIDENCE" }
  return { collaborator: true, blocked: null }
}

/**
 * Identidade ESTRUTURAL de um item: interação + seção + kind + dono + fonte da orientação + evidência bruta (turno + trecho,
 * ordenada) + lineage da regra quando houver. Dois itens com a mesma identidade dizem exatamente a mesma coisa.
 */
function structuralIdentity(item: InteractionFeedbackItem, interactionRef: string): string {
  const evidence = item.provenance.rawEvidence.map((unit) => `${unit.turnRef}\u0001${unit.speaker ?? ""}\u0001${unit.quote}`).sort()
  const lineage = item.provenance.proceduralLineage
  return JSON.stringify([interactionRef, item.section, item.interpretation.kind, item.interpretation.ownership, item.guidance.source, evidence, lineage ? [lineage.assertionRef, lineage.ruleRef, lineage.documentRef, lineage.status] : null])
}

/**
 * DEDUPLICAÇÃO ESTRUTURAL determinística (sem LLM, sem ranking): só colapsa itens com identidade estrutural IDÊNTICA — o
 * primeiro fica, os demais entram em `provenance.collapsedFindings`. Itens distintos nunca são fundidos; a ordem é preservada.
 */
export function dedupeFeedbackItems(items: readonly InteractionFeedbackItem[]): InteractionFeedbackItem[] {
  const kept: InteractionFeedbackItem[] = []
  const byIdentity = new Map<string, InteractionFeedbackItem>()
  for (const item of items) {
    const interactionRef = item.provenance.findingRef.split("/")[0] ?? ""
    const identity = structuralIdentity(item, interactionRef)
    const first = byIdentity.get(identity)
    if (!first) {
      const copy = { ...item, provenance: { ...item.provenance, collapsedFindings: [...item.provenance.collapsedFindings] } }
      byIdentity.set(identity, copy)
      kept.push(copy)
      continue
    }
    first.provenance.collapsedFindings.push({ findingRef: item.provenance.findingRef, findingHandle: item.provenance.findingHandle, findingSource: item.provenance.findingSource, observationRefs: [...item.provenance.observationRefs], candidateRef: item.provenance.candidateRef }, ...item.provenance.collapsedFindings)
  }
  return kept
}

export function composeInteractionFeedback(input: ComposeInteractionFeedbackInput): InteractionFeedbackV1 {
  const { frame } = input
  const observationsById = frameObservations(frame)
  const candidateByHandle = new Map((input.claimCandidates ?? []).filter((candidate) => candidate.support.type === "FINDING").map((candidate) => [candidate.support.ref, candidate]))

  const composed: InteractionFeedbackItem[] = frame.findings.map((finding) => {
    const observations = finding.observationRefs.map((ref) => observationsById.get(ref)).filter((item): item is SemanticObservation => Boolean(item))
    let decision = sectionOf(finding, observations, input.proceduralLineage)
    const { facts: fact, raw: rawEvidence } = factsOf(finding, observations)
    // Ausência de evidência verificada não vira conclusão: o item cai.
    if (decision.section !== "EXCLUDED" && fact.length === 0) decision = { section: "EXCLUDED", guidance: NO_GUIDANCE, rule: `${decision.rule}; sem evidência verificada`, lineage: decision.lineage }
    const polarity = candidatePolarityOf(finding.kind)
    const candidate = finding.handle ? candidateByHandle.get(finding.handle) ?? null : null
    const displayEvidence = rawEvidence.map((raw, index) => projectDisplayEvidence(raw, { factIndex: index, evidenceType: fact[index]!.evidenceType }, input.displayContext ?? {}))
    const readiness = deliveryReadinessOf(finding.kind, decision.section, displayEvidence)
    return {
      section: decision.section,
      audience: SECTION_AUDIENCE[decision.section],
      fact,
      interpretation: { kind: finding.kind, ownership: finding.ownership ?? "UNKNOWN", polarity, scope: "INTERACTION_SPECIFIC", meaning: MEANING[decision.section] },
      guidance: decision.section === "EXCLUDED" ? NO_GUIDANCE : decision.guidance,
      // Depende do casamento procedimental: finding criado pela avaliação procedimental ou item com lineage/KB_RULE.
      displayEvidence,
      readiness,
      delivery: deliveryOf(decision.section, finding.source === "PROCEDURAL" || decision.lineage !== null || decision.guidance.source === "KB_RULE", readiness),
      wording: null,
      provenance: {
        findingRef: `${frame.interactionRef}/${finding.id}`,
        findingHandle: finding.handle ?? null,
        findingSource: finding.source,
        declaredKind: finding.declaredKind,
        attribution: finding.attribution,
        observationRefs: [...finding.observationRefs],
        candidateRef: candidate?.ref ?? null,
        candidateSafeMeaning: candidate?.safeMeaning ?? null,
        candidatePolarityConflict: candidate !== null && candidate.polarity !== polarity,
        sectionRule: decision.rule,
        proceduralLineage: decision.lineage,
        rawEvidence,
        collapsedFindings: [],
      },
    }
  })
  const allItems = [...composed]
  const items = dedupeFeedbackItems(composed)

  const counts: Record<FeedbackSection, number> = { STRENGTH: 0, OPPORTUNITY: 0, NEUTRAL_CONTEXT: 0, UNCERTAINTY: 0, EXCLUDED: 0 }
  for (const item of items) counts[item.section] += 1

  const insufficient = frame.source === "NOT_RETURNED" || (observationsById.size === 0 && frame.findings.length === 0)
  const status: InteractionFeedbackStatus = insufficient ? "INSUFFICIENT_EVIDENCE" : counts.STRENGTH + counts.OPPORTUNITY > 0 ? "HAS_POINTS" : "NOTHING_MATERIAL"

  const uncertainties: FeedbackUncertainty[] = [{ code: "SINGLE_INTERACTION", text: SINGLE_INTERACTION_UNCERTAINTY }]
  if (frame.source === "NOT_RETURNED") uncertainties.push({ code: "FRAME_NOT_RETURNED", text: "a análise não devolveu esta interação" })
  else if (insufficient) uncertainties.push({ code: "FRAME_EMPTY", text: "nada observável foi extraído desta interação" })
  else if (items.length === 0) uncertainties.push({ code: "NO_FINDINGS", text: "observações sem conclusão sobre a interação" })
  if (counts.UNCERTAINTY > 0) uncertainties.push({ code: "PROCEDURE_PENDING_VERIFICATION", text: "afirmações sobre procedimento pendentes de verificação na base" })
  if (counts.EXCLUDED > 0) uncertainties.push({ code: "ITEMS_EXCLUDED", text: `${counts.EXCLUDED} item(ns) excluído(s) por falta de evidência verificada ou de lineage` })
  if (items.some((item) => item.section !== "EXCLUDED" && item.provenance.proceduralLineage)) uncertainties.push({ code: "PROCEDURAL_COVERAGE_PARTIAL", text: "a avaliação procedimental cobre só as regras verificadas, nunca o procedimento inteiro" })

  const visible = items.filter((item) => item.section !== "EXCLUDED")
  const reasons: ReviewReason[] = []
  if (visible.some((item) => item.section === "OPPORTUNITY")) reasons.push("OPPORTUNITY_PRESENT")
  if (visible.some((item) => item.guidance.source === "KB_RULE")) reasons.push("KB_RULE_GUIDANCE")
  if (visible.some((item) => item.interpretation.polarity === "NEGATIVE" && item.interpretation.ownership === "AGENT")) reasons.push("NEGATIVE_AGENT_FINDING")
  const required = reasons.length > 0
  if (!required) reasons.push(counts.STRENGTH > 0 ? "STRENGTH_ONLY" : "NO_COLLABORATOR_CONTENT")

  const label = INTERNAL_REF_PATTERN.test(input.interactionLabel) || input.interactionLabel.trim().length === 0 ? FALLBACK_INTERACTION_LABEL : input.interactionLabel.trim()
  const hasPoints = status === "HAS_POINTS"
  const deliverable = hasPoints && items.some((item) => item.delivery.collaborator)

  return {
    contract: INTERACTION_FEEDBACK_CONTRACT,
    subject: { collaboratorRef: input.subject.collaboratorRef },
    interaction: { label },
    status,
    items,
    counts,
    uncertainties,
    review: { required, reasons },
    delivery: {
      collaborator: deliverable, notification: deliverable, audit: true, reviewBeforeCollaborator: deliverable && required,
      state: status === "NOTHING_MATERIAL" ? "NOTHING_MATERIAL" : status === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : deliverable ? "DELIVERABLE" : "NOT_DELIVERABLE",
      blockedReasons: [...new Set(items.map((item) => item.delivery.blocked).filter((reason): reason is ItemDeliveryBlock => reason !== null))],
    },
    summaryWording: null,
    provenance: {
      interactionRef: frame.interactionRef,
      interactionId: frame.interactionId,
      sourceRun: input.sourceRun,
      labelRejected: label !== input.interactionLabel.trim(),
      findingRefs: allItems.map((item) => item.provenance.findingRef),
      findingHandles: allItems.map((item) => item.provenance.findingHandle).filter((handle): handle is string => handle !== null),
      observationRefs: [...new Set(allItems.flatMap((item) => item.provenance.observationRefs))],
      candidateRefs: allItems.map((item) => item.provenance.candidateRef).filter((ref): ref is string => ref !== null),
      collapsedDuplicates: allItems.length - items.length,
    },
  }
}

/** Visão sem provenance (o que uma superfície poderá consumir) — itens de colaborador ou também os do supervisor. */
export function displayableView(feedback: InteractionFeedbackV1, audience: "COLLABORATOR" | "SUPERVISOR") {
  const allowed: FeedbackAudience[] = audience === "COLLABORATOR" ? ["COLLABORATOR"] : ["COLLABORATOR", "SUPERVISOR_ONLY"]
  return {
    contract: feedback.contract,
    interaction: feedback.interaction,
    status: feedback.status,
    // Colaborador: só itens entregáveis (KB_RULE bloqueado fica fora). Supervisor: vê tudo que é dele, com o bloqueio indicado.
    items: feedback.items
      .filter((item) => allowed.includes(item.audience) && (audience !== "COLLABORATOR" || item.delivery.collaborator))
      .map(({ section, fact, interpretation, guidance, delivery, wording }) => ({ section, fact, interpretation, guidance: { ...guidance, knowledge: guidance.knowledge ? { documentTitle: guidance.knowledge.documentTitle, href: guidance.knowledge.href, openBehavior: guidance.knowledge.openBehavior } : null }, deliveryBlocked: delivery.blocked, wording })),
    uncertainties: feedback.uncertainties,
    review: feedback.review,
  }
}

export class FeedbackRedactionPendingError extends Error {
  constructor() {
    super("trecho de evidência sem redaction aplicada — não pode ir para a interface")
    this.name = "FeedbackRedactionPendingError"
  }
}

/** Guarda de contrato: nenhum trecho sai para UI sem redaction aplicada. Nesta versão NENHUM trecho está pronto — sempre lança. */
export function assertDisplaySafe(fact: Pick<FeedbackFact, "redaction">): never | void {
  if ((fact.redaction.status as string) !== "APPLIED") throw new FeedbackRedactionPendingError()
}
