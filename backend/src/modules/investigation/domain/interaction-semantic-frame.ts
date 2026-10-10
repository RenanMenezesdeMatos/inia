import { z } from "zod"
import { classifyRepresentativeness, REPRESENTATIVE_ABSOLUTE_SAMPLE, type EvidenceRepresentativeness } from "./evidence-representativeness.js"
import { MAXIMUM_CLAIM_SCOPE_BY_SUPPORT, type SupportScope } from "./support-scope.js"
import type { ClaimScope } from "./tool-trace.js"
import { accumulateVerification, emptyVerificationTelemetry, verifyFinding, type EvidenceUnit, type EvidenceVerificationTelemetry, type ProjectedInteraction, type VerifiedEvidence } from "./transcript-projection.js"
import type { ProceduralComparisonStatus, ProcedureAssertionSemantics } from "./procedural-semantics.js"
import { EXAMPLE_INTERACTION_REF, type FrameContractSummary } from "./frame-contract.js"
import { capClaimScopeByOwnership, findingOwnership, patternOwnership, type NeedAttributionKind, type Ownership } from "./outcome-attribution.js"
import type { NeedKindAnnotation, NeedKindTelemetry } from "./need-kind-sidecar.js"

/**
 * INTERACTION SEMANTIC FRAME (V1.4.0 — Semantic Observation & Pattern Discovery).
 *
 * O BENCHMARK_BLIND_H1 mostrou que o gargalo não era acesso à evidência: em 31 dos 36 padrões não detectados a
 * interação-âncora JÁ tinha sido analisada. A análise pedia ao modelo para saltar de TRANSCRIÇÃO → PADRÃO. Esta camada
 * obriga a decomposição:
 *
 *   TRANSCRIÇÃO → OBSERVAÇÕES semânticas (fato) → FINDINGS da interação (interpretação) → PATTERNS entre interações
 *
 * FATO ANTES DE JULGAMENTO: "o cliente perguntou X" e "o operador disse que não precisa" são observações; "necessidade
 * não resolvida" é um finding que nasce delas; "isso se repete em N interações" é um pattern que nasce dos findings.
 * Nada aqui é lista de comportamentos a procurar: os tipos são categorias GENÉRICAS de conversa (necessidade, pergunta,
 * resposta, ação, afirmação, compromisso, sinal, afirmação normativa) — balanceadas (STRENGTH é primeira classe;
 * risco não é obrigatório; um frame explicitamente vazio é resposta válida).
 *
 * O que o código aplica (nunca o modelo):
 * - toda observação/finding aponta para unidades de evidência verificadas pelo verifier V1.3.3 (interação → turno →
 *   falante → literal; ANY/ALL; privacidade) — nada bypassa a verificação; item sem evidência válida é descartado;
 * - finding só existe se referencia observações sobreviventes do MESMO frame (provenance: pattern → finding →
 *   observation → turno → transcrição);
 * - pattern só existe se referencia findings sobreviventes; sua evidência é a UNIÃO da evidência dos findings;
 *   `matchedTranscriptCount` = interações distintas dos findings referenciados;
 * - o KIND do pattern é derivado dos kinds dos findings (comportamento positivo nunca vira RISK porque a investigação é
 *   de performance; risco real nunca vira STRENGTH) — o declarado fica registrado para telemetria;
 * - o SUPORTE do pattern consome a representatividade existente (analisadas × universo registrado) e a distribuição
 *   temporal: 2 de 8 é REPEATED_IN_SAMPLE, nunca "padrão do colaborador";
 * - RESOLVED/PARTIAL exigem evidência de resolução; UNRESOLVED nunca inventa o que deveria ter sido dito;
 * - afirmações normativas do operador (procedureAssertions) são REGISTRADAS; a correção frente ao procedimento só pode
 *   ser concluída na síntese com evidência da base de conhecimento (gating), nunca aqui.
 */
/**
 * V1.4.1 — FINDING FORMATION & CLAIM-PATTERN BINDING: o gargalo da V1.4.0 era OBSERVAÇÃO → FINDING (24 âncoras observadas no
 * frame sem virar finding). A Fase A passa a OBSERVAR primeiro (finding local opcional); a Fase B recebe TODAS as observações
 * verificadas + findings já aceitos e pode PROMOVER observações a findings — só com observationRefs existentes, nunca criando
 * observação/trecho (FRAME_MISS continua FRAME_MISS). Eventos da interação (falas sobrepostas, espera, transferência…) viram
 * observação própria (`InteractionEvent`, com atribuição), não risco automático; sinal do cliente sozinho nunca vira RISK do
 * operador (`INTERACTION_FRICTION`); risco atribuído ao operador exige observação material do lado do operador (ação,
 * afirmação, compromisso, afirmação normativa, necessidade não resolvida/parcial ou evento atribuído ao operador).
 */
/**
 * V1.4.5 — PROCEDURAL & SEMANTIC INTERPRETATION: as camadas estruturais (frames, promoção, patterns, suporte, candidatos)
 * estão congeladas; o que muda é o SIGNIFICADO do que já é observado. Três refinamentos, todos determinísticos sobre o que
 * o modelo declara (o runtime só REBAIXA, nunca promove):
 * - PERGUNTA × RESPOSTA por COMPONENTE (§3/§4): a pergunta declara o que pede; a resposta declara o que cobriu. Cobrir A de
 *   {A, B} é PARTIAL — "respondeu alguma coisa" nunca é COMPLETE;
 * - NECESSIDADE (§5/§6): RESOLVED exige resolução material — ponto declarado em aberto, ou resposta ligada PARCIAL, rebaixam
 *   para PARTIAL. UNRESOLVED continua podendo existir SEM saber que frase deveria ter sido dita (omissão sem alucinar procedimento);
 * - AFIRMAÇÃO NORMATIVA (§7): passa a carregar sujeito, modalidade, condição, ação e valor — a matéria-prima da avaliação
 *   procedimental determinística (`procedural-semantics.ts`), que só então vira finding PROCEDURAL_DIVERGENCE (base
 *   contradiz), STRENGTH (aderência verificada, §18) ou PROCEDURAL_QUESTION (indeterminado, §14/§17).
 * Eventos (§26/§27): sobreposição/interrupção com atribuição BOTH/UNKNOWN permanecem NEUTROS — não são lado do operador
 * nem do cliente; só AGENT/CUSTOMER atribuem. Repetição de pergunta com resposta COMPLETE não é material de risco (§22/§42);
 * correção explícita do próprio operador não é contradição (§23).
 */
export const SEMANTIC_FRAME_VERSION = "SEMANTIC_FRAME_V1_2"

export const RESOLUTION_STATUSES = ["RESOLVED", "PARTIAL", "UNRESOLVED", "UNKNOWN"] as const
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number]
export const ANSWER_COMPLETENESS = ["COMPLETE", "PARTIAL", "UNRELATED", "UNKNOWN"] as const
export type AnswerCompleteness = (typeof ANSWER_COMPLETENESS)[number]
export const AGENT_ACTION_KINDS = ["CONSULTED", "CONFIRMED", "TRANSFERRED", "GUIDED", "REQUESTED", "SUMMARIZED", "INFORMED_DEADLINE", "COMMITTED", "CHECKED_UNDERSTANDING", "OTHER"] as const
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number]
export const COMMITMENT_STATUSES = ["STATED", "FULFILLED_IN_INTERACTION", "NOT_VERIFIABLE", "CONTRADICTED"] as const
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number]
export const CUSTOMER_SIGNAL_KINDS = ["REPEATED_QUESTION", "CONFUSION", "URGENCY", "DISAGREEMENT", "SATISFACTION", "DISSATISFACTION", "CONFIRMATION_REQUEST", "OTHER"] as const
export type CustomerSignalKind = (typeof CUSTOMER_SIGNAL_KINDS)[number]
/** V1.4.1: INTERACTION_FRICTION = atrito da interação SEM atribuição ao operador (só sinal do cliente / evento). */
/**
 * V1.4.5: PROCEDURAL_DIVERGENCE = afirmação normativa CONTRADITADA por uma regra da base com trecho literal.
 * V1.4.6: UNRESOLVED_OUTCOME = necessidade que ficou ABERTA sem ponte com a conduta do operador — RESULTADO da interação,
 * não risco (§5/§10). `UNRESOLVED_NEED` passa a significar "aberta E atribuída ao operador" (§11).
 */
export const FINDING_KINDS = ["STRENGTH", "FRICTION", "UNRESOLVED_NEED", "UNRESOLVED_OUTCOME", "PROCEDURAL_QUESTION", "PROCEDURAL_DIVERGENCE", "CONTRADICTION", "INTERACTION_FRICTION", "CONTEXT", "OTHER"] as const
export type InteractionFindingKind = (typeof FINDING_KINDS)[number]
/** V1.4.1: INTERACTION_FRICTION = pattern factual de atrito/evento entre interações, sem atribuição ao operador. */
/** V1.4.6: OUTCOME = pattern de resultados abertos sem dono (nunca risco do colaborador). */
export const PATTERN_KINDS = ["STRENGTH", "RISK", "PROCEDURAL", "MIXED", "NEUTRAL", "INTERACTION_FRICTION", "OUTCOME"] as const
export type PatternKind = (typeof PATTERN_KINDS)[number]
export const INTERACTION_EVENT_KINDS = ["OVERLAPPING_SPEECH", "SILENCE", "HOLD", "TRANSFER", "INTERRUPTION", "SYSTEM_EVENT", "OTHER"] as const
export type InteractionEventKind = (typeof INTERACTION_EVENT_KINDS)[number]
export const EVENT_ATTRIBUTIONS = ["CUSTOMER", "AGENT", "BOTH", "SYSTEM", "UNKNOWN"] as const
export type EventAttribution = (typeof EVENT_ATTRIBUTIONS)[number]
/** Atribuição de um finding derivada por código do LADO das observações referenciadas. */
export type FindingAttribution = "OPERATOR" | "CUSTOMER" | "INTERACTION" | "BOTH"
/** Ordem crescente de suporte: observado uma vez → repetido → recorrente na amostra → sustentado como padrão do colaborador. */
export const PATTERN_SUPPORT_LEVELS = ["OBSERVED", "REPEATED_IN_SAMPLE", "RECURRENT_IN_SAMPLE", "EMPLOYEE_PATTERN_SUPPORTED"] as const
export type PatternSupportLevel = (typeof PATTERN_SUPPORT_LEVELS)[number]
/** Kinds de finding que pesam como RISCO na derivação do kind do pattern. */
export const RISK_FINDING_KINDS: readonly InteractionFindingKind[] = ["FRICTION", "UNRESOLVED_NEED", "CONTRADICTION", "PROCEDURAL_DIVERGENCE"]

export type ObservationKind = "CUSTOMER_NEED" | "QUESTION" | "ANSWER" | "AGENT_ACTION" | "AGENT_STATEMENT" | "COMMITMENT" | "CUSTOMER_SIGNAL" | "PROCEDURE_ASSERTION" | "INTERACTION_EVENT"

/** Base de toda observação: id (do frame), resumo em 1 frase e evidência VERIFICADA (nunca só texto). */
export type SemanticObservation = { id: string; kind: ObservationKind; summary: string; evidence: VerifiedEvidence[] }
export type CustomerNeed = SemanticObservation & { kind: "CUSTOMER_NEED"; resolutionStatus: ResolutionStatus; resolutionEvidence: VerifiedEvidence[]; /** true quando RESOLVED/PARTIAL veio sem evidência de resolução válida e o status caiu para UNKNOWN (por código). */ statusDowngraded: boolean; /** V1.4.6: ATRIBUIÇÃO anotada pelo sidecar — NUNCA altera `resolutionStatus` (resultado ≠ responsabilidade). */ attribution?: NeedAttributionKind | undefined; /** V1.4.8f: INTENÇÃO anotada pelo sidecar needKind (SIDECAR_NEED_KIND_V1) — anotação opcional; nunca criada pela Fase A (o schema da extração não a aceita), nunca altera status/evidência/summary; ausente = intenção desconhecida. */ needKind?: NeedKindAnnotation | undefined }
export type Question = SemanticObservation & { kind: "QUESTION"; askedBy: string | null }
export type Answer = SemanticObservation & { kind: "ANSWER"; answersQuestionRef: string | null; completeness: AnswerCompleteness }
export type AgentAction = SemanticObservation & { kind: "AGENT_ACTION"; actionKind: AgentActionKind }
export type AgentStatement = SemanticObservation & { kind: "AGENT_STATEMENT" }
export type Commitment = SemanticObservation & { kind: "COMMITMENT"; actor: string | null; status: CommitmentStatus }
export type CustomerSignal = SemanticObservation & { kind: "CUSTOMER_SIGNAL"; signalKind: CustomerSignalKind }
export type ProcedureAssertion = SemanticObservation & { kind: "PROCEDURE_ASSERTION"; /** Sempre NOT_CHECKED nesta camada: a base de conhecimento não entra na EXTRAÇÃO (a avaliação é do sidecar). */ knowledgeStatus: "NOT_CHECKED"; /** V1.4.6: significado normativo anotado pelo SIDECAR (nunca pela extração) — matéria-prima da comparação com a base. */ semantics?: ProcedureAssertionSemantics | undefined }
/** V1.4.1: evento da interação (falas sobrepostas, silêncio, espera, transferência, interrupção, sistema) — fato, não risco. */
export type InteractionEvent = SemanticObservation & { kind: "INTERACTION_EVENT"; eventKind: InteractionEventKind; attribution: EventAttribution }

export type InteractionFinding = {
  id: string
  interactionRef: string
  kind: InteractionFindingKind
  summary: string
  /** Observações do MESMO frame que sustentam o finding (todas sobreviventes). */
  observationRefs: string[]
  /** União da evidência verificada das observações referenciadas (+ unidades próprias válidas). */
  evidence: VerifiedEvidence[]
  /** Interações distintas da evidência (sempre 1 aqui) e turnos distintos — qualidade sem score. */
  quality: { observationCount: number; evidenceCount: number }
  /** V1.4.1: PHASE_A = proposto na extração; PHASE_B = promovido na síntese. V1.4.5: PROCEDURAL = criado pelo RUNTIME a partir de uma avaliação procedimental determinística (nunca declarado pelo modelo). */
  source: "PHASE_A" | "PHASE_B" | "PROCEDURAL"
  /** V1.4.1: lado das observações referenciadas (derivado por código). */
  attribution: FindingAttribution
  /** V1.4.1: kind declarado quando a atribuição/regra o rebaixou (ex.: FRICTION só com sinal do cliente → INTERACTION_FRICTION). */
  declaredKind: InteractionFindingKind | null
  /** V1.4.2: handle CANÔNICO de claim (SF-n), único na execução — o nome pelo qual a síntese cita este finding. */
  handle?: string | undefined
  /** V1.4.5 (§16): lineage procedimental — afirmação normativa + regra da base que produziram este finding. */
  procedural?: { assertionRef: string; status: ProceduralComparisonStatus; ruleRef: string | null; documentTitle: string | null; reason: string } | undefined
  /** V1.4.6 (§12): dono semântico do fenômeno — só AGENT pode sustentar padrão do colaborador. */
  ownership?: Ownership | undefined
}

export type InteractionSemanticFrame = {
  interactionRef: string
  interactionId: string
  /** MODEL = devolvido pelo modelo; NOT_RETURNED = o modelo omitiu a interação → frame explicitamente vazio criado por código. */
  source: "MODEL" | "NOT_RETURNED"
  customerNeeds: CustomerNeed[]
  questions: Question[]
  answers: Answer[]
  agentActions: AgentAction[]
  agentStatements: AgentStatement[]
  commitments: Commitment[]
  customerSignals: CustomerSignal[]
  procedureAssertions: ProcedureAssertion[]
  interactionEvents: InteractionEvent[]
  findings: InteractionFinding[]
  /** true quando o frame não tem nenhuma observação nem finding (resposta válida: interação sem materialidade). */
  empty: boolean
}

export type PatternSupport = {
  level: PatternSupportLevel
  /** V1.4.2 (§8–§10): ESCOPO de suporte ("até onde generalizar?") e o maior escopo de claim que ele autoriza — dimensão distinta do nível. */
  scope: SupportScope
  maximumClaimScope: ClaimScope
  scopeReason: string
  matchedTranscriptCount: number
  analyzedTranscriptCount: number
  recordedUniverseCount: number | null
  representativeness: EvidenceRepresentativeness
  /** Blocos temporais (da janela) em que o pattern tem evidência — 1 quando a janela tem um só bloco. */
  bucketsMatched: number
  bucketCount: number
  reason: string
}

export type CrossInteractionPattern = {
  description: string
  kind: PatternKind
  /** V1.4.6 (§12/§13): dono semântico derivado dos findings — só AGENT sustenta EMPLOYEE_PATTERN. */
  ownership?: Ownership | undefined
  /** Kind declarado pelo modelo (telemetria); `kind` é derivado dos findings por código. */
  declaredKind: PatternKind | null
  findingRefs: string[]
  interactionRefs: string[]
  evidence: VerifiedEvidence[]
  support: PatternSupport
  /** WEAK/MODERATE/STRONG — compatibilidade com o `evidenceStrength` das versões anteriores (mesmos limiares). */
  evidenceStrength: "STRONG" | "MODERATE" | "WEAK"
  /** V1.4.2: handle CANÔNICO de claim (SP-n), único na execução — o nome pelo qual a síntese cita este pattern. */
  handle?: string | undefined
}

/** Telemetria compacta da camada (V1.4.0 §41) — só contagens. */
export const PROMOTION_REJECTION_REASONS = ["UNKNOWN_INTERACTION", "NO_OBSERVATION_REFS", "UNKNOWN_OBSERVATION", "DUPLICATE_FINDING"] as const
export type PromotionRejectionReason = (typeof PROMOTION_REJECTION_REASONS)[number]

export type SemanticTelemetry = {
  version: string
  semanticFramesCreated: number
  framesReturnedByModel: number
  framesNotReturned: number
  /** Frames que faltaram na 1ª resposta e vieram no retry dirigido (só os handles ausentes). */
  framesRecoveredByRetry: number
  framesEmpty: number
  interactionsWithFindings: number
  interactionsWithoutMaterialFindings: number
  observationsCount: number
  observationsDropped: number
  customerNeedsCount: number
  unresolvedNeedsCount: number
  partialNeedsCount: number
  questionsCount: number
  answersCount: number
  agentActionsCount: number
  agentStatementsCount: number
  commitmentsCount: number
  customerSignalsCount: number
  procedureAssertionsCount: number
  interactionEventsCount: number
  findingsCount: number
  /** V1.4.1 — formação de findings: Fase A × promovidos na Fase B (só a partir de observações existentes). */
  phaseAFindings: number
  phaseBPromotedFindings: number
  promotedFromObservationCount: number
  promotionRejectedCount: number
  promotionRejectionReasons: Record<PromotionRejectionReason, number>
  /** V1.4.5/V1.4.6 — guardas de MATERIALIDADE que rebaixaram um risco declarado (nunca criam risco). */
  frictionDowngradedByCompleteAnswer?: number | undefined
  contradictionDowngradedByCorrection?: number | undefined
  /** V1.4.5 — findings criados pelo RUNTIME a partir de avaliações procedimentais determinísticas. */
  proceduralFindings?: { consistent: number; divergence: number; question: number } | undefined
  /** V1.4.1 — findings cujo kind foi rebaixado pela regra de atribuição (RISK sem lado do operador → INTERACTION_FRICTION; UNRESOLVED_NEED sem necessidade aberta → CONTEXT). */
  findingKindDowngraded: number
  interactionFrictionFindingsCount: number
  findingsDropped: number
  /** Findings sem observationRefs cuja evidência própria verificada caiu no turno de uma observação sobrevivente (ligados por código). */
  findingsLinkedByTurn: number
  /** Findings cujo observationRef veio como turno ("T12") e resolveu para observações sobreviventes daquele turno. */
  findingRefsResolvedByTurn: number
  strengthFindingsCount: number
  riskFindingsCount: number
  proceduralQuestionsCount: number
  contextFindingsCount: number
  crossInteractionPatternsCount: number
  patternsDropped: number
  patternsBySupport: Record<PatternSupportLevel, number>
  patternsByKind: Record<PatternKind, number>
  /** V1.4.2: patterns por ESCOPO de suporte (SAMPLE / PERIOD / RECORDED_UNIVERSE / EMPLOYEE_PATTERN) — ausente em runs anteriores. */
  patternsByScope?: Record<SupportScope, number> | undefined
  /** V1.4.6: patterns por DONO do fenômeno e quantos tiveram o teto reduzido por não serem de conduta do operador. */
  patternsByOwnership?: Record<Ownership, number> | undefined
  patternsScopeCappedByOwnership?: number | undefined
  /** Patterns cujo kind declarado pelo modelo foi corrigido pela derivação (ex.: STRENGTH declarado como RISK). */
  patternKindCorrected: number
  /** Motivos de descarte por camada (contagens). */
  drops: { observationWithoutEvidence: number; resolutionStatusDowngraded: number; danglingAnswerRef: number; findingWithoutObservation: number; patternWithoutFinding: number; frameForUnknownInteraction: number; duplicateFrame?: number }
  /** V1.4.6.1 (§3): observações que o modelo devolveu num SEGUNDO frame da mesma interação — o contrato é um frame por
   * interação e o primeiro vence, então elas são descartadas. Só CONTAGEM: a regra de descarte não mudou. */
  duplicateFrameObservationsDropped?: number | undefined
  /** V1.4.6.8: completude ESTRUTURAL do contrato da Fase A (esperados × devolvidos), antes e depois do retry dirigido —
   * EMPTY (frame presente sem observação) ≠ MISSING (ref esperado ausente). Ausente em runs anteriores. */
  frameContract?: { initial: FrameContractSummary; retryAttempted: boolean; afterRetry: FrameContractSummary | null } | undefined
  /** V1.4.8f: resultado do sidecar needKind (ausente = sidecar desligado ou nenhuma necessidade). */
  needKind?: NeedKindTelemetry | undefined
  /** true quando o modelo devolveu só o contrato antigo (patterns sem frames) — a decomposição foi pulada. */
  contractViolation: "NONE" | "NO_FRAMES"
  /** Como a análise foi executada: SINGLE_CALL (contrato combinado) ou TWO_PHASE (A: frames; B: patterns). */
  phases: "SINGLE_CALL" | "TWO_PHASE"
}

// ---------------------------------------------------------------------------------------------
// Schema do output do modelo (tolerante: item inválido cai fora; o output nunca é rejeitado inteiro por um item)
// ---------------------------------------------------------------------------------------------

const unitSchema = z.object({
  interactionRef: z.string().optional(),
  interactionId: z.string().optional(),
  /** Compatibilidade interna com o resolver ordinal (V1.3.4.2) — NUNCA sugerido ao modelo na V1.4.0 (§27). */
  interactionOrdinal: z.coerce.number().int().min(1).optional().catch(undefined),
  turnRef: z.string().nullable().optional(),
  speaker: z.string().nullable().optional(),
  quote: z.string().optional(),
  excerpt: z.string().optional(),
}).transform((item): EvidenceUnit => ({ interactionRef: (item.interactionRef ?? item.interactionId ?? "").trim(), ...(item.interactionOrdinal !== undefined ? { interactionOrdinal: item.interactionOrdinal } : {}), turnRef: item.turnRef ?? null, speaker: item.speaker ?? null, quote: (item.quote ?? item.excerpt ?? "").trim() }))
const unitsSchema = z.array(unitSchema.nullable().catch(null)).default([]).transform((items) => items.filter((item): item is EvidenceUnit => item !== null && item.quote.length >= 3))
const idSchema = z.string().trim().min(1).max(24)
const summarySchema = z.string().trim().min(3).max(400)
/** Enum tolerante: valor desconhecido/ausente cai no fallback (o item sobrevive; a evidência é o que decide). */
const enumOr = <T extends string>(values: readonly T[], fallback: T) => z.string().catch(fallback).transform((value): T => { const upper = value.trim().toUpperCase(); return (values as readonly string[]).includes(upper) ? (upper as T) : fallback })

const needSchema = z.object({ id: idSchema, summary: summarySchema, resolutionStatus: enumOr(RESOLUTION_STATUSES, "UNKNOWN"), evidence: unitsSchema, resolutionEvidence: unitsSchema })
const questionSchema = z.object({ id: idSchema, summary: summarySchema, askedBy: z.string().trim().nullable().optional(), evidence: unitsSchema })
const answerSchema = z.object({ id: idSchema, summary: summarySchema, answersQuestionRef: z.string().trim().nullable().optional(), completeness: enumOr(ANSWER_COMPLETENESS, "UNKNOWN"), evidence: unitsSchema })
const actionSchema = z.object({ id: idSchema, summary: summarySchema, kind: enumOr(AGENT_ACTION_KINDS, "OTHER"), evidence: unitsSchema })
const statementSchema = z.object({ id: idSchema, summary: summarySchema, evidence: unitsSchema })
const commitmentSchema = z.object({ id: idSchema, summary: summarySchema, actor: z.string().trim().nullable().optional(), status: enumOr(COMMITMENT_STATUSES, "STATED"), evidence: unitsSchema })
const signalSchema = z.object({ id: idSchema, summary: summarySchema, kind: enumOr(CUSTOMER_SIGNAL_KINDS, "OTHER"), evidence: unitsSchema })
const assertionSchema = z.object({ id: idSchema, summary: summarySchema, evidence: unitsSchema })
const eventSchema = z.object({ id: idSchema, summary: summarySchema, kind: enumOr(INTERACTION_EVENT_KINDS, "OTHER"), attribution: enumOr(EVENT_ATTRIBUTIONS, "UNKNOWN"), evidence: unitsSchema })
const findingSchema = z.object({ id: idSchema, summary: summarySchema, kind: enumOr(FINDING_KINDS, "OTHER"), observationRefs: z.array(z.string().trim()).default([]), evidence: unitsSchema })
/** V1.4.1 — finding PROMOVIDO na Fase B: só interactionRef + observationRefs existentes (nenhuma evidência própria é aceita). */
const promotedFindingSchema = z.object({ interactionRef: z.string().trim(), id: z.string().trim().max(24).optional(), summary: summarySchema, kind: enumOr(FINDING_KINDS, "OTHER"), observationRefs: z.array(z.string().trim()).default([]) })
const list = <T extends z.ZodTypeAny>(schema: T) => z.array(schema.nullable().catch(null)).default([]).transform((items) => items.filter((item): item is z.infer<T> => item !== null))
const frameSchema = z.object({
  interactionRef: z.string().trim(),
  customerNeeds: list(needSchema),
  questions: list(questionSchema),
  answers: list(answerSchema),
  agentActions: list(actionSchema),
  agentStatements: list(statementSchema),
  commitments: list(commitmentSchema),
  customerSignals: list(signalSchema),
  procedureAssertions: list(assertionSchema),
  interactionEvents: list(eventSchema),
  findings: list(findingSchema),
})
const patternSchema = z.object({
  description: summarySchema,
  kind: z.string().trim().toUpperCase().transform((value) => ((PATTERN_KINDS as readonly string[]).includes(value) ? (value as PatternKind) : null)).nullable().catch(null).default(null),
  findingRefs: z.array(z.string().trim()).default([]),
  /** Contrato antigo (V1.3.x): evidência direta — aceita só para detectar a violação NO_FRAMES; nunca vira provenance. */
  evidence: unitsSchema,
  evidenceRequirement: z.string().optional(),
})
export const semanticAnalysisOutputSchema = z.object({
  frames: list(frameSchema),
  patterns: list(patternSchema).transform((items) => items.slice(0, 12)),
})
export type SemanticAnalysisOutput = z.infer<typeof semanticAnalysisOutputSchema>
export type DeclaredFrame = z.infer<typeof frameSchema>

// ---------------------------------------------------------------------------------------------
// Verificação e derivação (determinísticas)
// ---------------------------------------------------------------------------------------------

export type SemanticVerificationInput = {
  parsed: SemanticAnalysisOutput
  /** Interações apresentadas ao modelo (ordem de apresentação = ordem do mapa), indexadas por handle. */
  projected: ReadonlyMap<string, ProjectedInteraction>
  analyzedTranscriptCount: number
  recordedUniverseCount: number | null
  /** Bloco temporal de cada interação apresentada (null = janela de um bloco). */
  bucketOf?: ((interactionRef: string) => string | null) | undefined
  bucketCount?: number | undefined
}

export type SemanticVerificationResult = {
  frames: InteractionSemanticFrame[]
  patterns: CrossInteractionPattern[]
  telemetry: SemanticTelemetry
  verification: EvidenceVerificationTelemetry
}

export function emptySemanticTelemetry(): SemanticTelemetry {
  return {
    version: SEMANTIC_FRAME_VERSION,
    semanticFramesCreated: 0, framesReturnedByModel: 0, framesNotReturned: 0, framesRecoveredByRetry: 0, framesEmpty: 0, interactionsWithFindings: 0, interactionsWithoutMaterialFindings: 0,
    observationsCount: 0, observationsDropped: 0, customerNeedsCount: 0, unresolvedNeedsCount: 0, partialNeedsCount: 0, questionsCount: 0, answersCount: 0, agentActionsCount: 0, agentStatementsCount: 0, commitmentsCount: 0, customerSignalsCount: 0, procedureAssertionsCount: 0, interactionEventsCount: 0,
    findingsCount: 0, phaseAFindings: 0, phaseBPromotedFindings: 0, promotedFromObservationCount: 0, promotionRejectedCount: 0, promotionRejectionReasons: { UNKNOWN_INTERACTION: 0, NO_OBSERVATION_REFS: 0, UNKNOWN_OBSERVATION: 0, DUPLICATE_FINDING: 0 }, findingKindDowngraded: 0, interactionFrictionFindingsCount: 0, findingsDropped: 0, findingsLinkedByTurn: 0, findingRefsResolvedByTurn: 0, frictionDowngradedByCompleteAnswer: 0, contradictionDowngradedByCorrection: 0, proceduralFindings: { consistent: 0, divergence: 0, question: 0 }, strengthFindingsCount: 0, riskFindingsCount: 0, proceduralQuestionsCount: 0, contextFindingsCount: 0,
    crossInteractionPatternsCount: 0, patternsDropped: 0, patternsBySupport: { OBSERVED: 0, REPEATED_IN_SAMPLE: 0, RECURRENT_IN_SAMPLE: 0, EMPLOYEE_PATTERN_SUPPORTED: 0 }, patternsByScope: { SAMPLE: 0, PERIOD: 0, RECORDED_UNIVERSE: 0, EMPLOYEE_PATTERN: 0 }, patternsByOwnership: { AGENT: 0, CUSTOMER: 0, INTERACTION: 0, PROCESS: 0, UNKNOWN: 0 }, patternsScopeCappedByOwnership: 0, patternsByKind: { STRENGTH: 0, RISK: 0, PROCEDURAL: 0, MIXED: 0, NEUTRAL: 0, INTERACTION_FRICTION: 0, OUTCOME: 0 }, patternKindCorrected: 0,
    drops: { observationWithoutEvidence: 0, resolutionStatusDowngraded: 0, danglingAnswerRef: 0, findingWithoutObservation: 0, patternWithoutFinding: 0, frameForUnknownInteraction: 0, duplicateFrame: 0 },
    duplicateFrameObservationsDropped: 0,
    contractViolation: "NONE",
    phases: "SINGLE_CALL",
  }
}

function dedupeEvidence(units: VerifiedEvidence[]): VerifiedEvidence[] {
  const seen = new Set<string>()
  return units.filter((unit) => { const key = `${unit.interactionRef}/${unit.turnRef}/${unit.quote}`; if (seen.has(key)) return false; seen.add(key); return true })
}

/** Unidades de uma observação são forçadas à interação do FRAME: citar outra interação é WRONG_INTERACTION (o verifier decide). */
function pinToFrame(units: EvidenceUnit[], interactionRef: string): EvidenceUnit[] {
  return units.map((unit) => (unit.interactionRef.length === 0 && unit.interactionOrdinal === undefined ? { ...unit, interactionRef } : unit))
}

/**
 * Verifica UMA lista de unidades (ANY) contra a interação do frame; unidades de outra interação são rejeitadas
 * (WRONG_INTERACTION) mesmo que literais lá — uma observação pertence a uma interação.
 */
function verifyUnits(units: EvidenceUnit[], frameRef: string, projected: ReadonlyMap<string, ProjectedInteraction>, verification: EvidenceVerificationTelemetry): VerifiedEvidence[] {
  if (units.length === 0) return []
  const result = verifyFinding(pinToFrame(units, frameRef), "ANY", projected)
  const own = result.verified.filter((unit) => unit.interactionRef === frameRef)
  accumulateVerification(verification, { ...result, survives: own.length > 0, verified: own, rejected: [...result.rejected, ...result.verified.filter((unit) => unit.interactionRef !== frameRef).map((unit) => ({ unit: { interactionRef: unit.interactionRef, turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote }, reason: "WRONG_INTERACTION" as const }))], findingRejection: own.length > 0 ? null : "MISSING_REQUIRED_EVIDENCE" }, units.length)
  return own
}

export type FrameVerificationResult = { frames: InteractionSemanticFrame[]; telemetry: SemanticTelemetry; verification: EvidenceVerificationTelemetry; /** Índice "I-ref/F-id" → finding sobrevivente (para a derivação de patterns). */ findingIndex: Map<string, InteractionFinding>; /** Observações sobreviventes por frame (id → observação) — o universo do que a Fase B pode promover. */ observationsByFrame: Map<string, Map<string, SemanticObservation>> }

/**
 * FASE A — verifica os frames declarados contra as interações apresentadas: uma observação só existe com evidência
 * verificada; um finding só existe com observações sobreviventes do MESMO frame; interação omitida vira frame vazio
 * explícito (NOT_RETURNED). Determinística.
 */
/** Observações DECLARADAS num frame (antes de qualquer verificação) — usado só para medir o que um frame
 * duplicado levava embora (V1.4.6.1 §3); não participa de nenhuma decisão. */
function declaredObservationCount(frame: DeclaredFrame): number {
  return frame.customerNeeds.length + frame.questions.length + frame.answers.length + frame.agentActions.length + frame.agentStatements.length + frame.commitments.length + frame.customerSignals.length + frame.procedureAssertions.length + frame.interactionEvents.length
}

export function verifySemanticFrames(declaredFrames: DeclaredFrame[], projected: ReadonlyMap<string, ProjectedInteraction>, telemetry: SemanticTelemetry = emptySemanticTelemetry(), verification: EvidenceVerificationTelemetry = emptyVerificationTelemetry()): FrameVerificationResult {
  const presented = [...projected.values()]
  const framesByRef = new Map<string, DeclaredFrame>()
  for (const frame of declaredFrames) {
    const ref = frame.interactionRef.toUpperCase()
    if (!projected.has(ref)) { telemetry.drops.frameForUnknownInteraction += 1; continue }
    // Dois frames para a mesma interação: mantém o primeiro (o contrato pede um por interação).
    // V1.4.6.1 (§3): o descarte continua igual, mas agora é MEDIDO — inclusive quanto de observação ia no duplicado.
    if (framesByRef.has(ref)) {
      telemetry.drops.duplicateFrame = (telemetry.drops.duplicateFrame ?? 0) + 1
      telemetry.duplicateFrameObservationsDropped = (telemetry.duplicateFrameObservationsDropped ?? 0) + declaredObservationCount(frame)
      continue
    }
    framesByRef.set(ref, frame)
  }
  telemetry.framesReturnedByModel = framesByRef.size

  const frames: InteractionSemanticFrame[] = []
  const findingIndex = new Map<string, InteractionFinding>()
  const observationsByFrame = new Map<string, Map<string, SemanticObservation>>()
  for (const interaction of presented) {
    const declared = framesByRef.get(interaction.interactionRef)
    const ref = interaction.interactionRef
    const frame: InteractionSemanticFrame = { interactionRef: ref, interactionId: interaction.interactionId, source: declared ? "MODEL" : "NOT_RETURNED", customerNeeds: [], questions: [], answers: [], agentActions: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], findings: [], empty: true }
    if (!declared) telemetry.framesNotReturned += 1
    const observations = new Map<string, SemanticObservation>()
    observationsByFrame.set(ref, observations)
    const uniqueId = (raw: string): string => {
      let id = raw.trim().toUpperCase()
      let suffix = 1
      while (observations.has(id)) { suffix += 1; id = `${raw.trim().toUpperCase()}_${suffix}` }
      return id
    }
    const admit = <T extends SemanticObservation>(observation: T): T | null => {
      if (observation.evidence.length === 0) { telemetry.observationsDropped += 1; telemetry.drops.observationWithoutEvidence += 1; return null }
      observations.set(observation.id, observation)
      telemetry.observationsCount += 1
      return observation
    }
    if (declared) {
      for (const item of declared.customerNeeds) {
        const evidence = verifyUnits(item.evidence, ref, projected, verification)
        const resolutionEvidence = verifyUnits(item.resolutionEvidence, ref, projected, verification)
        let status = item.resolutionStatus
        let downgraded = false
        if ((status === "RESOLVED" || status === "PARTIAL") && resolutionEvidence.length === 0) { status = "UNKNOWN"; downgraded = true; telemetry.drops.resolutionStatusDowngraded += 1 }
        const need = admit<CustomerNeed>({ id: uniqueId(item.id), kind: "CUSTOMER_NEED", summary: item.summary, evidence, resolutionStatus: status, resolutionEvidence, statusDowngraded: downgraded })
        if (need) frame.customerNeeds.push(need)
      }
      for (const item of declared.questions) { const question = admit<Question>({ id: uniqueId(item.id), kind: "QUESTION", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification), askedBy: item.askedBy?.toUpperCase() ?? null }); if (question) frame.questions.push(question) }
      for (const item of declared.answers) {
        const questionRef = item.answersQuestionRef ? item.answersQuestionRef.toUpperCase() : null
        const linked = questionRef && frame.questions.some((question) => question.id === questionRef) ? questionRef : null
        if (questionRef && !linked) telemetry.drops.danglingAnswerRef += 1
        const answer = admit<Answer>({ id: uniqueId(item.id), kind: "ANSWER", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification), answersQuestionRef: linked, completeness: item.completeness })
        if (answer) frame.answers.push(answer)
      }
      for (const item of declared.agentActions) { const action = admit<AgentAction>({ id: uniqueId(item.id), kind: "AGENT_ACTION", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification), actionKind: item.kind }); if (action) frame.agentActions.push(action) }
      for (const item of declared.agentStatements) { const statement = admit<AgentStatement>({ id: uniqueId(item.id), kind: "AGENT_STATEMENT", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification) }); if (statement) frame.agentStatements.push(statement) }
      for (const item of declared.commitments) { const commitment = admit<Commitment>({ id: uniqueId(item.id), kind: "COMMITMENT", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification), actor: item.actor?.toUpperCase() ?? null, status: item.status }); if (commitment) frame.commitments.push(commitment) }
      for (const item of declared.customerSignals) { const signal = admit<CustomerSignal>({ id: uniqueId(item.id), kind: "CUSTOMER_SIGNAL", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification), signalKind: item.kind }); if (signal) frame.customerSignals.push(signal) }
      for (const item of declared.procedureAssertions) { const assertion = admit<ProcedureAssertion>({ id: uniqueId(item.id), kind: "PROCEDURE_ASSERTION", summary: item.summary, evidence: verifyUnits(item.evidence, ref, projected, verification), knowledgeStatus: "NOT_CHECKED" }); if (assertion) frame.procedureAssertions.push(assertion) }
      for (const item of declared.interactionEvents) {
        const evidence = verifyUnits(item.evidence, ref, projected, verification)
        // O próprio texto do evento diz quem agiu ("o operador começa a falar antes de o cliente concluir") — a menção no
        // trecho verificado vence a atribuição declarada (regra genérica de menção; sem menção, vale a declarada).
        const fromText = eventAttributionFromText(evidence.map((unit) => unit.quote).join(" "))
        const attribution = fromText !== "UNKNOWN" ? fromText : item.attribution
        const event = admit<InteractionEvent>({ id: uniqueId(item.id), kind: "INTERACTION_EVENT", summary: item.summary, evidence, eventKind: item.kind, attribution })
        if (event) frame.interactionEvents.push(event)
      }
      // FINDINGS (Fase A) nascem de observações do MESMO frame: refs resolvidas contra as sobreviventes; sem observação → descartado.
      for (const item of declared.findings) {
        const rawRefs = [...new Set(item.observationRefs.map((value) => value.trim().toUpperCase()))]
        const own = verifyUnits(item.evidence, ref, projected, verification)
        const resolved = resolveObservationRefs(rawRefs, observations, own, telemetry)
        if (resolved.length === 0) { telemetry.findingsDropped += 1; telemetry.drops.findingWithoutObservation += 1; continue }
        const finding = admitFinding(frame, observations, findingIndex, telemetry, { id: item.id, kind: item.kind, summary: item.summary, observationRefs: resolved, ownEvidence: own, source: "PHASE_A" })
        if (finding) telemetry.phaseAFindings += 1
      }
    }
    frame.empty = observations.size === 0 && frame.findings.length === 0
    if (frame.empty) telemetry.framesEmpty += 1
    if (frame.findings.length > 0) telemetry.interactionsWithFindings += 1
    else telemetry.interactionsWithoutMaterialFindings += 1
    telemetry.customerNeedsCount += frame.customerNeeds.length
    telemetry.unresolvedNeedsCount += frame.customerNeeds.filter((need) => need.resolutionStatus === "UNRESOLVED").length
    telemetry.partialNeedsCount += frame.customerNeeds.filter((need) => need.resolutionStatus === "PARTIAL").length
    telemetry.questionsCount += frame.questions.length
    telemetry.answersCount += frame.answers.length
    telemetry.agentActionsCount += frame.agentActions.length
    telemetry.agentStatementsCount += frame.agentStatements.length
    telemetry.commitmentsCount += frame.commitments.length
    telemetry.customerSignalsCount += frame.customerSignals.length
    telemetry.procedureAssertionsCount += frame.procedureAssertions.length
    telemetry.interactionEventsCount += frame.interactionEvents.length
    frames.push(frame)
  }
  telemetry.semanticFramesCreated = frames.length
  return { frames, telemetry, verification, findingIndex, observationsByFrame }
}

/** Refs de observação como o modelo escreveu → ids sobreviventes: id direto; turno ("T12") → observações com evidência nesse turno; sem ref mas com evidência própria no turno de uma observação → ligação por turno. */
function resolveObservationRefs(rawRefs: string[], observations: Map<string, SemanticObservation>, ownEvidence: VerifiedEvidence[], telemetry: SemanticTelemetry): string[] {
  const byTurn = rawRefs.filter((value) => /^T\d+$/.test(value)).flatMap((turn) => [...observations.values()].filter((observation) => observation.evidence.some((unit) => unit.turnRef === turn)).map((observation) => observation.id))
  if (byTurn.length > 0) telemetry.findingRefsResolvedByTurn += 1
  const declaredRefs = [...new Set([...rawRefs.filter((value) => observations.has(value)), ...byTurn])]
  const ownTurns = new Set(ownEvidence.map((unit) => unit.turnRef))
  const linkedByTurn = declaredRefs.length === 0 && ownTurns.size > 0 ? [...observations.values()].filter((observation) => observation.evidence.some((unit) => ownTurns.has(unit.turnRef))).map((observation) => observation.id) : []
  if (linkedByTurn.length > 0) telemetry.findingsLinkedByTurn += 1
  return declaredRefs.length > 0 ? declaredRefs : linkedByTurn
}

/** Atribuição de um evento a partir das MENÇÕES no texto do evento (operador/atendente × cliente) — só quando o modelo não atribuiu. */
export function eventAttributionFromText(text: string): EventAttribution {
  const lower = text.toLowerCase()
  const agent = /\b(?:operador(?:a)?|atendente|agente)\b/.test(lower)
  const customer = /\bcliente\b/.test(lower)
  if (agent && customer) return "BOTH"
  if (agent) return "AGENT"
  if (customer) return "CUSTOMER"
  return "UNKNOWN"
}

/** Observações do LADO DO OPERADOR (o que ele fez/disse/prometeu/afirmou; omissão material = necessidade não resolvida/parcial; evento atribuído a ele). */
function isOperatorSide(observation: SemanticObservation): boolean {
  switch (observation.kind) {
    case "AGENT_ACTION":
    case "AGENT_STATEMENT":
    case "COMMITMENT":
    case "PROCEDURE_ASSERTION":
    case "ANSWER":
      return true
    case "CUSTOMER_NEED":
      return (observation as CustomerNeed).resolutionStatus === "UNRESOLVED" || (observation as CustomerNeed).resolutionStatus === "PARTIAL"
    case "INTERACTION_EVENT":
      // V1.4.5 (§27/§44): só atribuição EXPLÍCITA ao operador conta. BOTH/UNKNOWN (falas sobrepostas sem quem começou)
      // permanece NEUTRO — nunca "o operador interrompeu o cliente".
      return (observation as InteractionEvent).attribution === "AGENT"
    default:
      return false
  }
}
function isCustomerSide(observation: SemanticObservation): boolean {
  return observation.kind === "CUSTOMER_SIGNAL" || observation.kind === "QUESTION" || (observation.kind === "CUSTOMER_NEED" && !isOperatorSide(observation)) || (observation.kind === "INTERACTION_EVENT" && (observation as InteractionEvent).attribution === "CUSTOMER")
}

/** Atribuição do finding derivada das observações referenciadas. */
export function attributionOf(observations: SemanticObservation[]): FindingAttribution {
  const operator = observations.some(isOperatorSide)
  const customer = observations.some(isCustomerSide)
  if (operator && customer) return "BOTH"
  if (operator) return "OPERATOR"
  if (customer) return "CUSTOMER"
  return "INTERACTION"
}

/**
 * V1.4.5 (§23) — CORREÇÃO EXPLÍCITA não é contradição: quando o próprio operador se corrige ("na verdade…", "corrigindo…",
 * "me desculpe, o correto é…"), duas afirmações diferentes são um refinamento, não uma incompatibilidade. Rede de segurança
 * lexical pt-BR sobre os trechos JÁ VERIFICADOS das observações referenciadas.
 */
const EXPLICIT_CORRECTION: readonly RegExp[] = [/\bna\s+verdade\b/iu, /\bcorrigindo\b/iu, /\b(?:me\s+)?desculp\w+/iu, /\bperd[ãa]o\b/iu, /\bretific\w+/iu, /\bdeix(?:a|e)\s+eu\s+corrigir\b/iu, /\bo\s+correto\s+[ée]\b/iu, /\bcorre[çc][ãa]o:/iu, /\bme\s+equivoquei\b/iu]
export function detectExplicitCorrection(text: string): boolean {
  return EXPLICIT_CORRECTION.some((pattern) => pattern.test(text))
}

/**
 * REGRA DE ATRIBUIÇÃO DE RISCO (V1.4.1 §11–§13): FRICTION/CONTRADICTION atribuídos ao operador exigem ≥ 1 observação material
 * do lado do operador; só sinal do cliente / evento não atribuído → INTERACTION_FRICTION (atrito da interação, sem culpa).
 * UNRESOLVED_NEED exige uma necessidade UNRESOLVED/PARTIAL entre as refs; senão vira CONTEXT. STRENGTH e demais não mudam.
 */
export function applyAttributionRule(kind: InteractionFindingKind, observations: SemanticObservation[]): { kind: InteractionFindingKind; attribution: FindingAttribution; downgraded: boolean; rule?: "COMPLETE_ANSWER_ONLY" | "EXPLICIT_CORRECTION" | "SINGLE_STATEMENT" } {
  const attribution = attributionOf(observations)
  const operatorSide = attribution === "OPERATOR" || attribution === "BOTH"
  if ((kind === "FRICTION" || kind === "CONTRADICTION") && !operatorSide) return { kind: "INTERACTION_FRICTION", attribution, downgraded: true }
  if (kind === "UNRESOLVED_NEED" && !observations.some((observation) => observation.kind === "CUSTOMER_NEED" && ((observation as CustomerNeed).resolutionStatus === "UNRESOLVED" || (observation as CustomerNeed).resolutionStatus === "PARTIAL"))) return { kind: "CONTEXT", attribution, downgraded: true }
  // V1.4.5 (§22/§42) — repetição de pergunta com resposta COMPLETA não é material de risco do operador: quando o único lado
  // do operador são RESPOSTAS completas e nenhuma necessidade ficou aberta, o atrito é da interação, não conduta.
  if (kind === "FRICTION" && operatorSide) {
    const operatorObservations = observations.filter(isOperatorSide)
    const onlyCompleteAnswers = operatorObservations.length > 0 && operatorObservations.every((observation) => observation.kind === "ANSWER" && (observation as Answer).completeness === "COMPLETE")
    if (onlyCompleteAnswers) return { kind: "INTERACTION_FRICTION", attribution, downgraded: true, rule: "COMPLETE_ANSWER_ONLY" }
  }
  // V1.4.5 (§23) — contradição exige duas afirmações do operador em turnos distintos e SEM correção explícita entre elas.
  if (kind === "CONTRADICTION") {
    const operatorObservations = observations.filter(isOperatorSide)
    const turns = new Set(operatorObservations.flatMap((observation) => observation.evidence.map((unit) => unit.turnRef)))
    const corrected = operatorObservations.some((observation) => observation.evidence.some((unit) => detectExplicitCorrection(unit.quote)))
    if (corrected) return { kind: "CONTEXT", attribution, downgraded: true, rule: "EXPLICIT_CORRECTION" }
    if (operatorObservations.length < 2 && turns.size < 2) return { kind: "CONTEXT", attribution, downgraded: true, rule: "SINGLE_STATEMENT" }
  }
  return { kind, attribution, downgraded: false }
}

function countFindingKind(telemetry: SemanticTelemetry, kind: InteractionFindingKind): void {
  if (kind === "STRENGTH") telemetry.strengthFindingsCount += 1
  else if (RISK_FINDING_KINDS.includes(kind)) telemetry.riskFindingsCount += 1
  else if (kind === "PROCEDURAL_QUESTION") telemetry.proceduralQuestionsCount += 1
  else if (kind === "INTERACTION_FRICTION") telemetry.interactionFrictionFindingsCount += 1
  else telemetry.contextFindingsCount += 1
}

/** Admite um finding (Fase A ou promovido na B) já com refs resolvidas: aplica a regra de atribuição, evita id duplicado, indexa. */
function admitFinding(frame: InteractionSemanticFrame, observations: Map<string, SemanticObservation>, findingIndex: Map<string, InteractionFinding>, telemetry: SemanticTelemetry, input: { id: string; kind: InteractionFindingKind; summary: string; observationRefs: string[]; ownEvidence: VerifiedEvidence[]; source: "PHASE_A" | "PHASE_B" | "PROCEDURAL" }): InteractionFinding | null {
  const referenced = input.observationRefs.map((id) => observations.get(id)).filter((observation): observation is SemanticObservation => Boolean(observation))
  if (referenced.length === 0) return null
  // V1.4.5: finding criado pelo runtime a partir de avaliação procedimental já é do lado do operador por construção
  // (a observação É a afirmação normativa dele) — a regra de atribuição não o rebaixa.
  const rule = input.source === "PROCEDURAL" ? { kind: input.kind, attribution: "OPERATOR" as FindingAttribution, downgraded: false } : applyAttributionRule(input.kind, referenced)
  if (rule.downgraded) {
    telemetry.findingKindDowngraded += 1
    if (rule.rule === "COMPLETE_ANSWER_ONLY") telemetry.frictionDowngradedByCompleteAnswer = (telemetry.frictionDowngradedByCompleteAnswer ?? 0) + 1
    if (rule.rule === "EXPLICIT_CORRECTION") telemetry.contradictionDowngradedByCorrection = (telemetry.contradictionDowngradedByCorrection ?? 0) + 1
  }
  let id = input.id.trim().toUpperCase() || "F"
  let suffix = 1
  while (findingIndex.has(`${frame.interactionRef}/${id}`)) { suffix += 1; id = `${input.id.trim().toUpperCase() || "F"}_${suffix}` }
  const evidence = dedupeEvidence([...referenced.flatMap((observation) => observation.evidence), ...input.ownEvidence])
  const finding: InteractionFinding = { id, interactionRef: frame.interactionRef, kind: rule.kind, summary: input.summary, observationRefs: referenced.map((observation) => observation.id), evidence, quality: { observationCount: referenced.length, evidenceCount: evidence.length }, source: input.source, attribution: rule.attribution, declaredKind: rule.downgraded ? input.kind : null }
  frame.findings.push(finding)
  findingIndex.set(`${frame.interactionRef}/${id}`, finding)
  telemetry.findingsCount += 1
  countFindingKind(telemetry, rule.kind)
  return finding
}

/**
 * FASE B — PROMOÇÃO de observações a findings (V1.4.1 §4–§6): só interactionRef apresentada e observationRefs SOBREVIVENTES
 * daquele frame; nenhuma evidência própria é aceita (a Fase B não inventa observação/trecho); duplicata (mesmo kind + mesmas
 * refs de um finding já aceito) é recusada. Frames vazios continuam vazios (FRAME_MISS não é corrigido aqui).
 */
export function promoteFindings(declared: DeclaredPromotedFinding[], verified: FrameVerificationResult): InteractionFinding[] {
  const { telemetry, findingIndex, observationsByFrame } = verified
  const promoted: InteractionFinding[] = []
  const reject = (reason: PromotionRejectionReason) => { telemetry.promotionRejectedCount += 1; telemetry.promotionRejectionReasons[reason] += 1 }
  for (const item of declared) {
    const ref = item.interactionRef.toUpperCase()
    const frame = verified.frames.find((entry) => entry.interactionRef === ref)
    const observations = observationsByFrame.get(ref)
    if (!frame || !observations) { reject("UNKNOWN_INTERACTION"); continue }
    const rawRefs = [...new Set(item.observationRefs.map((value) => value.trim().toUpperCase()))]
    if (rawRefs.length === 0) { reject("NO_OBSERVATION_REFS"); continue }
    const resolved = resolveObservationRefs(rawRefs, observations, [], telemetry)
    if (resolved.length === 0) { reject("UNKNOWN_OBSERVATION"); continue }
    const key = `${item.kind}:${[...resolved].sort().join(",")}`
    if (frame.findings.some((existing) => `${existing.declaredKind ?? existing.kind}:${[...existing.observationRefs].sort().join(",")}` === key)) { reject("DUPLICATE_FINDING"); continue }
    const finding = admitFinding(frame, observations, findingIndex, telemetry, { id: item.id ?? `F${frame.findings.length + 1}`, kind: item.kind, summary: item.summary, observationRefs: resolved, ownEvidence: [], source: "PHASE_B" })
    if (!finding) { reject("UNKNOWN_OBSERVATION"); continue }
    promoted.push(finding)
    telemetry.phaseBPromotedFindings += 1
    telemetry.promotedFromObservationCount += resolved.length
    if (frame.empty) frame.empty = false
  }
  // Recontagem por interação (a promoção pode dar finding a um frame que não tinha).
  telemetry.interactionsWithFindings = verified.frames.filter((frame) => frame.findings.length > 0).length
  telemetry.interactionsWithoutMaterialFindings = verified.frames.length - telemetry.interactionsWithFindings
  return promoted
}

/**
 * V1.4.5 (§16–§18) — FINDINGS PROCEDIMENTAIS criados pelo RUNTIME a partir de avaliações determinísticas, entre a Fase A e a
 * Fase B (assim entram na síntese de patterns como qualquer outro finding). Não são declarados pelo modelo: a observação já
 * está verificada, o trecho da base é literal e a comparação é da aplicação — é o finding mais auditável do sistema.
 *
 *   CONTRADICTED          → PROCEDURAL_DIVERGENCE (risco real, atribuível: a afirmação é do operador)
 *   CONSISTENT            → STRENGTH (§18: aderência verificada é força de primeira classe)
 *   POTENTIAL_DIVERGENCE  → PROCEDURAL_QUESTION (§17: incerteza, nunca erro)
 *   INSUFFICIENT_KNOWLEDGE / NOT_APPLICABLE → nenhum finding (§14/§38: a base não decide, ou a regra não é deste cenário)
 */
export function attachProceduralFindings(evaluations: { interactionRef: string; assertionRef: string; assertionSummary: string; status: ProceduralComparisonStatus; reason: string; rule: { ruleRef: string; documentTitle: string } | null }[], verified: FrameVerificationResult): InteractionFinding[] {
  const { telemetry, findingIndex, observationsByFrame } = verified
  const counters = telemetry.proceduralFindings ?? { consistent: 0, divergence: 0, question: 0 }
  telemetry.proceduralFindings = counters
  const created: InteractionFinding[] = []
  for (const evaluation of evaluations) {
    const kind: InteractionFindingKind | null = evaluation.status === "CONTRADICTED" ? "PROCEDURAL_DIVERGENCE" : evaluation.status === "CONSISTENT" ? "STRENGTH" : evaluation.status === "POTENTIAL_DIVERGENCE" ? "PROCEDURAL_QUESTION" : null
    if (!kind) continue
    const frame = verified.frames.find((entry) => entry.interactionRef === evaluation.interactionRef)
    const observations = observationsByFrame.get(evaluation.interactionRef)
    if (!frame || !observations || !observations.has(evaluation.assertionRef)) continue
    const summary = evaluation.status === "CONTRADICTED"
      ? `afirmação sobre procedimento divergente do que a base registra: ${evaluation.assertionSummary}`
      : evaluation.status === "CONSISTENT"
        ? `afirmação sobre procedimento coerente com a base verificada: ${evaluation.assertionSummary}`
        : `afirmação sobre procedimento a verificar (divergência possível, não confirmada): ${evaluation.assertionSummary}`
    const finding = admitFinding(frame, observations, findingIndex, telemetry, { id: `FP${created.length + 1}`, kind, summary: summary.slice(0, 400), observationRefs: [evaluation.assertionRef], ownEvidence: [], source: "PROCEDURAL" })
    if (!finding) continue
    finding.procedural = { assertionRef: evaluation.assertionRef, status: evaluation.status, ruleRef: evaluation.rule?.ruleRef ?? null, documentTitle: evaluation.rule?.documentTitle ?? null, reason: evaluation.reason }
    if (frame.empty) frame.empty = false
    if (evaluation.status === "CONTRADICTED") counters.divergence += 1
    else if (evaluation.status === "CONSISTENT") counters.consistent += 1
    else counters.question += 1
    created.push(finding)
  }
  telemetry.interactionsWithFindings = verified.frames.filter((frame) => frame.findings.length > 0).length
  telemetry.interactionsWithoutMaterialFindings = verified.frames.length - telemetry.interactionsWithFindings
  return created
}

export type DeclaredPattern = z.infer<typeof patternSchema>

/**
 * FASE B — deriva PATTERNS de findings sobreviventes ("I6/F1"): evidência = união; interações = distintas; kind e suporte
 * por código. Pattern sem finding resolvido é descartado (provenance obrigatória).
 */
export function deriveCrossInteractionPatterns(declaredPatterns: DeclaredPattern[], verified: FrameVerificationResult, input: { analyzedTranscriptCount: number; recordedUniverseCount: number | null; bucketOf?: ((interactionRef: string) => string | null) | undefined; bucketCount?: number | undefined }): CrossInteractionPattern[] {
  const { telemetry, findingIndex } = verified
  const patterns: CrossInteractionPattern[] = []
  for (const declared of declaredPatterns) {
    const refs = [...new Set(declared.findingRefs.map((value) => value.trim().toUpperCase().replace(/\s+/g, "")))]
    const resolved = refs.map((value) => findingIndex.get(value)).filter((finding): finding is InteractionFinding => Boolean(finding))
    if (resolved.length === 0) { telemetry.patternsDropped += 1; telemetry.drops.patternWithoutFinding += 1; continue }
    const interactionRefs = [...new Set(resolved.map((finding) => finding.interactionRef))]
    const kind = patternKindOf(resolved.map((finding) => finding.kind))
    if (declared.kind && declared.kind !== kind) telemetry.patternKindCorrected += 1
    const bucketsMatched = input.bucketOf ? new Set(interactionRefs.map((ref) => input.bucketOf!(ref)).filter((bucket): bucket is string => bucket !== null)).size : 1
    const baseSupport = patternSupportOf({ matchedTranscriptCount: interactionRefs.length, analyzedTranscriptCount: input.analyzedTranscriptCount, recordedUniverseCount: input.recordedUniverseCount, bucketsMatched, bucketCount: input.bucketCount ?? 1 })
    // V1.4.6 (§12/§13) — OWNERSHIP e TETO POR OWNERSHIP: o cálculo de suporte é o da V1.4.4, intocado; o teto de claim é
    // então limitado pelo dono do fenômeno. "4 de 8 necessidades ficaram em aberto" só vira padrão DO COLABORADOR se as
    // quatro forem de conduta dele — senão é um padrão de RESULTADO, afirmável no máximo sobre o período.
    const ownership = patternOwnership(resolved.map((finding) => finding.ownership ?? findingOwnership(finding, null)))
    const maximumClaimScope = capClaimScopeByOwnership(baseSupport.maximumClaimScope, ownership)
    if (maximumClaimScope !== baseSupport.maximumClaimScope) telemetry.patternsScopeCappedByOwnership = (telemetry.patternsScopeCappedByOwnership ?? 0) + 1
    const support: PatternSupport = maximumClaimScope === baseSupport.maximumClaimScope ? baseSupport : { ...baseSupport, maximumClaimScope, scopeReason: `${baseSupport.scopeReason}; teto reduzido: o padrão não é de conduta do operador (dono ${ownership}) — necessidade aberta é resultado da interação, não traço do colaborador` }
    patterns.push({ description: declared.description, kind, ownership, declaredKind: declared.kind, findingRefs: resolved.map((finding) => `${finding.interactionRef}/${finding.id}`), interactionRefs, evidence: dedupeEvidence(resolved.flatMap((finding) => finding.evidence)), support, evidenceStrength: evidenceStrengthOf(baseSupport.level) })
    if (telemetry.patternsByOwnership) telemetry.patternsByOwnership[ownership] += 1
    telemetry.patternsBySupport[support.level] += 1
    if (telemetry.patternsByScope) telemetry.patternsByScope[support.scope] += 1
    telemetry.patternsByKind[kind] += 1
  }
  telemetry.crossInteractionPatternsCount = patterns.length
  return patterns
}

/** Composição das duas fases sobre UM output (contrato combinado; testes e replay). */
export function verifySemanticOutput(input: SemanticVerificationInput): SemanticVerificationResult {
  const verified = verifySemanticFrames(input.parsed.frames, input.projected)
  if (input.parsed.frames.length === 0 && input.parsed.patterns.length > 0) verified.telemetry.contractViolation = "NO_FRAMES"
  const patterns = deriveCrossInteractionPatterns(input.parsed.patterns, verified, input)
  return { frames: verified.frames, patterns, telemetry: verified.telemetry, verification: verified.verification }
}

/** Kind do pattern DERIVADO dos findings: positivo só → STRENGTH; risco só → RISK; ambos → MIXED; só procedural → PROCEDURAL; senão NEUTRAL. */
export function patternKindOf(findingKinds: InteractionFindingKind[]): PatternKind {
  const strength = findingKinds.includes("STRENGTH")
  const risk = findingKinds.some((kind) => RISK_FINDING_KINDS.includes(kind))
  const procedural = findingKinds.includes("PROCEDURAL_QUESTION") || findingKinds.includes("PROCEDURAL_DIVERGENCE")
  // V1.4.6 (§10): resultado aberto sem atribuição forma um pattern de RESULTADO — nunca risco do colaborador.
  if (!strength && !risk && findingKinds.length > 0 && findingKinds.every((kind) => kind === "UNRESOLVED_OUTCOME" || kind === "CONTEXT") && findingKinds.includes("UNRESOLVED_OUTCOME")) return "OUTCOME"
  // V1.4.5: divergência procedimental CONFIRMADA (trecho literal da base contradiz a afirmação) é um pattern PROCEDURAL,
  // não um risco comportamental genérico — a polaridade negativa vem do kind do finding, o assunto continua procedimento.
  if (!strength && findingKinds.every((kind) => kind === "PROCEDURAL_DIVERGENCE" || kind === "PROCEDURAL_QUESTION")) return "PROCEDURAL"
  const friction = findingKinds.includes("INTERACTION_FRICTION")
  if (strength && risk) return "MIXED"
  if (strength) return "STRENGTH"
  if (risk) return "RISK"
  if (procedural) return "PROCEDURAL"
  // V1.4.1: atrito/evento sem atribuição ao operador forma pattern FACTUAL da interação — nunca RISK do colaborador.
  if (friction) return "INTERACTION_FRICTION"
  return "NEUTRAL"
}

/**
 * SUPORTE do pattern — duas dimensões calculadas por código, nunca pelo modelo:
 *
 * NÍVEL (V1.4.0 §17–§20 — "quanto se repetiu?"): OBSERVED (1 interação) · REPEATED_IN_SAMPLE (2+ abaixo da recorrência) ·
 * RECURRENT_IN_SAMPLE (≥ max(3, metade da amostra) — o mesmo limiar do `evidenceStrength` STRONG) ·
 * EMPLOYEE_PATTERN_SUPPORTED (recorrente E escopo EMPLOYEE_PATTERN — o rótulo do nível acompanha o escopo).
 *
 * ESCOPO (V1.4.2 §8–§13 / recalibrado na V1.4.3 §18–§28 — "até onde a evidência permite generalizar?"), consumindo a
 * representatividade já validada (`classifyRepresentativeness`), nunca uma segunda lógica:
 * - SAMPLE: sem recorrência, ou recorrente numa amostra que não representa o universo → só "nas interações analisadas";
 * - PERIOD: recorrente numa amostra REPRESENTATIVE de um universo registrado MAIOR do que a amostra → inferência sobre o período;
 * - RECORDED_UNIVERSE: a amostra É o universo registrado da janela (cobertura total) → fato exaustivo sobre o período;
 * - EMPLOYEE_PATTERN: PERIOD (amostra representativa de um universo maior — há o que inferir) E ≥ 4 interações distintas
 *   E recorrência LONGITUDINAL (evidência em ≥ 2 blocos de uma janela com mais de um bloco).
 *
 * Duas assimetrias deliberadas (§25/§26):
 * (1) COBERTURA TOTAL de um universo pequeno é a evidência mais FORTE possível sobre aquela janela e, por isso mesmo, não
 *     precisa (nem autoriza) inferência: a afirmação honesta é exaustiva ("em 4 das 6 interações registradas no período"),
 *     que é PERIOD_PATTERN. Ler tudo o que existe de um trimestre de 6 chamadas não vira traço da pessoa (§25, V1.4.0 §58).
 * (2) AMOSTRA PARCIAL REPRESENTATIVA é justamente o instrumento de inferência: 8 de 30 com recorrência em vários blocos
 *     sustenta "no período analisado, o colaborador apresentou um padrão recorrente de…" — não se rejeita EMPLOYEE só
 *     porque 8 < 30 (§26). A V1.4.2 usava `REPRESENTATIVE_ABSOLUTE_SAMPLE` (30) como PISO DO UNIVERSO; auditoria da V1.4.3
 *     (§19): esse número nasceu na V1.2 como teto do tamanho da AMOSTRA ("a partir daqui a amostra basta mesmo com universo
 *     grande") — um RELAXAMENTO da cobertura exigida, nunca uma condição de claim longitudinal. O uso como piso foi removido;
 *     o 30 continua agindo onde sempre agiu, dentro de `classifyRepresentativeness`.
 * 2 de 8 nunca chega a padrão; volume alto num único bloco não é recorrência longitudinal (§24).
 */
/** Interações DISTINTAS mínimas para "padrão do colaborador" (§58: volume baixo nunca é compensado com inferência forte). */
export const EMPLOYEE_PATTERN_MIN_MATCHED = 4

export function patternSupportOf(input: { matchedTranscriptCount: number; analyzedTranscriptCount: number; recordedUniverseCount: number | null; bucketsMatched: number; bucketCount: number }): PatternSupport {
  const { matchedTranscriptCount: matched, analyzedTranscriptCount: analyzed } = input
  const representativeness = classifyRepresentativeness(analyzed, input.recordedUniverseCount)
  const recurrenceThreshold = Math.max(3, Math.ceil(analyzed / 2))
  const universe = input.recordedUniverseCount
  const fullCoverage = universe !== null && universe > 0 && analyzed >= universe
  const base = { matchedTranscriptCount: matched, analyzedTranscriptCount: analyzed, recordedUniverseCount: universe, representativeness, bucketsMatched: input.bucketsMatched, bucketCount: input.bucketCount }
  const withScope = (level: PatternSupportLevel, scope: SupportScope, reason: string, scopeReason: string): PatternSupport => ({ ...base, level, scope, maximumClaimScope: MAXIMUM_CLAIM_SCOPE_BY_SUPPORT[scope], reason, scopeReason })
  if (matched <= 1) return withScope("OBSERVED", "SAMPLE", `observado em 1 de ${analyzed} analisada(s)`, "uma interação não generaliza")
  if (matched < recurrenceThreshold) return withScope("REPEATED_IN_SAMPLE", "SAMPLE", `${matched} de ${analyzed} analisada(s) — abaixo da recorrência (≥ ${recurrenceThreshold})`, "sem recorrência: vale só para as interações analisadas")
  if (representativeness !== "REPRESENTATIVE") return withScope("RECURRENT_IN_SAMPLE", "SAMPLE", `${matched} de ${analyzed} analisada(s), mas amostra ${representativeness === "ANECDOTAL" ? "anedótica" : "insuficiente"} frente ao universo${universe !== null ? ` (${universe} registradas)` : " (desconhecido)"}`, "amostra não representa o universo registrado: vale só para as interações analisadas")
  // Cobertura total de um universo PEQUENO: fato exaustivo do período registrado — forte, e por isso mesmo sem inferência além
  // da janela (§25). V1.4.4 (§28): ler TUDO não pode ser um teto artificial quando a amostra é absolutamente suficiente por si
  // (`REPRESENTATIVE_ABSOLUTE_SAMPLE`, o papel original da constante: tamanho de AMOSTRA a partir do qual a cobertura deixa de
  // ser exigida) — aí a cobertura total continua valendo como amostra e o candidato segue para as demais condições de EMPLOYEE.
  if (fullCoverage && analyzed < REPRESENTATIVE_ABSOLUTE_SAMPLE) return withScope("RECURRENT_IN_SAMPLE", "RECORDED_UNIVERSE", `${matched} de ${analyzed} analisada(s) — todas as ${universe} registradas do período`, `todas as ${universe} interações registradas do período foram analisadas: a afirmação é o fato exaustivo da janela, não um traço do colaborador`)
  const periodScope: SupportScope = fullCoverage ? "RECORDED_UNIVERSE" : "PERIOD"
  const recurrent = (why: string) => withScope("RECURRENT_IN_SAMPLE", periodScope, `${matched} de ${analyzed} analisada(s) — recorrente; ${why}`, `amostra ${fullCoverage ? `exaustiva (todas as ${universe} registradas)` : `representativa (${analyzed}${universe !== null ? ` de ${universe} registradas` : ""})`} — vale para o período analisado; ${why}`)
  if (matched < EMPLOYEE_PATTERN_MIN_MATCHED) return recurrent(`abaixo de ${EMPLOYEE_PATTERN_MIN_MATCHED} interações distintas para padrão do colaborador`)
  if (input.bucketCount <= 1) return recurrent("janela de um só bloco: não há recorrência longitudinal a medir")
  if (input.bucketsMatched < 2) return recurrent(`evidência concentrada em 1 bloco de ${input.bucketCount}: volume não é recorrência longitudinal`)
  return withScope("EMPLOYEE_PATTERN_SUPPORTED", "EMPLOYEE_PATTERN", `${matched} de ${analyzed} analisada(s), amostra representativa, evidência em ${input.bucketsMatched} de ${input.bucketCount} blocos`, `amostra representativa de um universo maior (${analyzed}${universe !== null ? ` de ${universe} registradas` : " analisadas"}) com recorrência em ${input.bucketsMatched} de ${input.bucketCount} blocos — sustenta padrão do colaborador NO PERÍODO ANALISADO`)
}

export function evidenceStrengthOf(level: PatternSupportLevel): "STRONG" | "MODERATE" | "WEAK" {
  return level === "OBSERVED" ? "WEAK" : level === "REPEATED_IN_SAMPLE" ? "MODERATE" : "STRONG"
}

/** Comparação de níveis (índice na ordem crescente). */
export function supportLevelIndex(level: PatternSupportLevel): number {
  return PATTERN_SUPPORT_LEVELS.indexOf(level)
}

export function supportMeets(level: PatternSupportLevel, required: PatternSupportLevel): boolean {
  return supportLevelIndex(level) >= supportLevelIndex(required)
}

export const PATTERN_SUPPORT_LABELS: Record<PatternSupportLevel, string> = {
  OBSERVED: "observado uma vez",
  REPEATED_IN_SAMPLE: "repetido na amostra",
  RECURRENT_IN_SAMPLE: "recorrente na amostra",
  EMPLOYEE_PATTERN_SUPPORTED: "padrão do colaborador sustentado",
}

export const FINDING_KIND_LABELS: Record<InteractionFindingKind, string> = { STRENGTH: "ponto forte", FRICTION: "atrito atribuído ao operador", UNRESOLVED_NEED: "necessidade não resolvida atribuída ao operador", UNRESOLVED_OUTCOME: "necessidade em aberto (resultado da interação, sem atribuição)", PROCEDURAL_QUESTION: "questão procedimental", PROCEDURAL_DIVERGENCE: "divergência procedimental verificada", CONTRADICTION: "contradição", INTERACTION_FRICTION: "atrito da interação (sem atribuição)", CONTEXT: "contexto", OTHER: "outro" }

export const PATTERN_KIND_LABELS: Record<PatternKind, string> = { STRENGTH: "ponto forte", RISK: "ponto de atenção", PROCEDURAL: "questão procedimental", MIXED: "misto", NEUTRAL: "neutro", INTERACTION_FRICTION: "atrito da interação (sem atribuição)", OUTCOME: "resultado da interação (sem atribuição)" }

/** Sinal compacto por pattern gravado no trace/ledger (base do gating de escopo por suporte — nunca texto do modelo). */
export type PatternSupportSignal = { /** V1.4.6: dono semântico do pattern — só AGENT sustenta padrão do colaborador. */ ownership?: Ownership | undefined; /** V1.4.1: ref do pattern dentro do fato ("P1"..), na ordem do ledger. */ ref?: string | undefined; /** V1.4.2: handle canônico de claim (SP-n) — ausente em runs anteriores. */ handle?: string | undefined; kind: PatternKind; supportLevel: PatternSupportLevel; /** V1.4.2: escopo de suporte e teto de claim (ausentes em runs anteriores → derivados do nível por `maximumClaimScopeOf`). */ supportScope?: SupportScope | undefined; maximumClaimScope?: ClaimScope | undefined; matchedTranscriptCount: number; analyzedTranscriptCount: number }

/** Teto de claim de um sinal de pattern: o gravado (V1.4.2) ou, em sinais antigos, o que o nível implicava (nunca mais permissivo do que a regra da época). */
export function maximumClaimScopeOf(signal: Pick<PatternSupportSignal, "supportLevel" | "maximumClaimScope">): ClaimScope {
  if (signal.maximumClaimScope) return signal.maximumClaimScope
  return signal.supportLevel === "EMPLOYEE_PATTERN_SUPPORTED" ? "EMPLOYEE_PATTERN" : signal.supportLevel === "RECURRENT_IN_SAMPLE" ? "PERIOD_PATTERN" : "INTERACTION_SPECIFIC"
}

/**
 * V1.4.2 (§2/§6): atribui os handles CANÔNICOS de claim — SF-n a cada finding (ordem dos frames) e SP-n a cada pattern —
 * numa sequência única da execução (`next`), depois que a camada semântica terminou. O modelo só seleciona handles existentes;
 * nunca constrói "F3/P1" nem "I6/F1".
 */
export function assignClaimHandles(semantic: { frames: InteractionSemanticFrame[]; patterns: CrossInteractionPattern[] }, next: (kind: "SP" | "SF") => string): void {
  for (const frame of semantic.frames) for (const finding of frame.findings) if (!finding.handle) finding.handle = next("SF")
  for (const pattern of semantic.patterns) if (!pattern.handle) pattern.handle = next("SP")
}

/** Sequência local de handles (replay/testes) — o runtime usa o HandleRegistry da execução. */
export function claimHandleSequence(): (kind: "SP" | "SF") => string {
  const counters = { SP: 0, SF: 0 }
  return (kind) => { counters[kind] += 1; return `${kind}${counters[kind]}` }
}

/** Melhor suporte entre sinais (null = nenhum pattern). */
export function bestPatternSupport(signals: PatternSupportSignal[]): PatternSupportSignal | null {
  return signals.reduce<PatternSupportSignal | null>((best, item) => (best === null || supportLevelIndex(item.supportLevel) > supportLevelIndex(best.supportLevel) ? item : best), null)
}

// ---------------------------------------------------------------------------------------------
// Model-facing (instruções do contrato) — sem gabarito, sem lista de comportamentos a procurar
// ---------------------------------------------------------------------------------------------

export const frameExtractionOutputSchema = z.object({ frames: list(frameSchema) })
export const patternSynthesisOutputSchema = z.object({ findings: list(promotedFindingSchema).transform((items) => items.slice(0, 40)), patterns: list(patternSchema).transform((items) => items.slice(0, 12)) })
export type DeclaredPromotedFinding = z.infer<typeof promotedFindingSchema>

// V1.4.6.8: handles de EXEMPLO são o placeholder `EXAMPLE_INTERACTION_REF` — nunca um handle que pode ser real (o "I6"
// de exemplo ancorava a geração: V1.4.6.7). Os handles reais chegam só pelas listas dinâmicas de renderFrameExtractionInstructions.
const FRAME_CONTRACT = `{"frames":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}",
 "customerNeeds":[{"id":"N1","summary":"o que o cliente precisava/pediu","resolutionStatus":"RESOLVED|PARTIAL|UNRESOLVED|UNKNOWN","evidence":[UNIT],"resolutionEvidence":[UNIT]}],
 "questions":[{"id":"Q1","askedBy":"CLIENTE|OPERADOR","summary":"…","evidence":[UNIT]}],
 "answers":[{"id":"R1","answersQuestionRef":"Q1","completeness":"COMPLETE|PARTIAL|UNRELATED|UNKNOWN","summary":"…","evidence":[UNIT]}],
 "agentActions":[{"id":"A1","kind":"CONSULTED|CONFIRMED|TRANSFERRED|GUIDED|REQUESTED|SUMMARIZED|INFORMED_DEADLINE|COMMITTED|CHECKED_UNDERSTANDING|OTHER","summary":"o que o operador FEZ ou declarou ter feito","evidence":[UNIT]}],
 "agentStatements":[{"id":"D1","summary":"informação que o operador DISSE ao cliente (prazo, valor, status, explicação)","evidence":[UNIT]}],
 "commitments":[{"id":"C1","actor":"OPERADOR|CLIENTE","summary":"…","status":"STATED|FULFILLED_IN_INTERACTION|NOT_VERIFIABLE|CONTRADICTED","evidence":[UNIT]}],
 "customerSignals":[{"id":"S1","kind":"REPEATED_QUESTION|CONFUSION|URGENCY|DISAGREEMENT|SATISFACTION|DISSATISFACTION|CONFIRMATION_REQUEST|OTHER","summary":"…","evidence":[UNIT]}],
 "procedureAssertions":[{"id":"P1","summary":"afirmação normativa do operador ('precisa…', 'não precisa…', 'o prazo é…', 'o procedimento é…')","evidence":[UNIT]}],
 "interactionEvents":[{"id":"E1","kind":"OVERLAPPING_SPEECH|SILENCE|HOLD|TRANSFER|INTERRUPTION|SYSTEM_EVENT|OTHER","attribution":"CUSTOMER|AGENT|BOTH|SYSTEM|UNKNOWN","summary":"evento registrado na transcrição (ex.: '[Falas sobrepostas…]', espera, transferência)","evidence":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}","turnRef":"T12","speaker":"EVENTO","quote":"[Música de espera por 1 min 05 s.]"}]}],
 "findings":[{"id":"F1","kind":"STRENGTH|FRICTION|UNRESOLVED_NEED|PROCEDURAL_QUESTION|CONTRADICTION|INTERACTION_FRICTION|CONTEXT|OTHER","summary":"interpretação DESTA interação, em 1 frase (fato, não causa)","observationRefs":["N1","A2"]}]
}]}
UNIT = {"interactionRef":"${EXAMPLE_INTERACTION_REF}","turnRef":"T3","speaker":"CLIENTE","quote":"trecho LITERAL e EXATO copiado de UM único turno (copie e cole, nunca parafraseie)"}`

/**
 * FASE A — instruções da EXTRAÇÃO SEMÂNTICA (V1.4.0): um frame por interação, só observações e findings daquela interação;
 * nenhum pattern aqui (o experimento §21 mostrou que, pedindo frames + patterns na mesma chamada, o modelo devolve 1 frame
 * em 8 e salta para o padrão). `handles` = referências válidas nesta análise (restringe interactionRef).
 */
export function renderFrameExtractionInstructions(handles: string[]): string {
  return `Você analisa transcrições de atendimento dentro de uma investigação com objetivo definido. Cada transcrição vem em TURNOS numerados ("[T3] CLIENTE: …"): um turno = uma fala. O cabeçalho de cada transcrição é "=== ${EXAMPLE_INTERACTION_REF} · … ===": o primeiro item é a REFERÊNCIA da interação (interactionRef). As referências válidas nesta análise são SOMENTE: ${handles.join(", ")} — nunca outra, nunca uma posição.

MÉTODO — OBSERVAR PRIMEIRO: para CADA interação registre TODAS as observações materiais (o que o cliente precisava e perguntou; o que o operador fez, disse e prometeu; sinais do cliente; afirmações do operador sobre procedimento; EVENTOS da transcrição como falas sobrepostas, silêncio, espera, transferência — linhas "EVENTO:" são eventos, com a atribuição que a própria linha indica). Os FINDINGS da interação são OPCIONAIS nesta chamada: registre só os claros; a decisão do que é material será completada depois a partir das observações — por isso uma observação omitida aqui NUNCA é recuperada. NESTA chamada NÃO há padrões entre interações. O objetivo da investigação NÃO pressupõe problema: registre forças, riscos, necessidades e resultado conforme a evidência.

OBRIGATÓRIO: devolva EXATAMENTE ${handles.length} frame(s), um para cada referência (${handles.join(", ")}), nessa ordem — com listas vazias quando a interação não tiver nada material. Frame faltando = resposta incompleta.

Responda SOMENTE com JSON válido:
${FRAME_CONTRACT}

Regras: (1) todo item tem ≥ 1 UNIT literal de UM turno da interação do frame — item sem trecho literal é descartado por código; speaker é o rótulo do turno citado ("EVENTO" para linhas de evento — nunca CLIENTE/OPERADOR num evento); (2) findings vazio é válido (observações presentes, findings vazios é um frame correto) — nunca force finding; um evento ("[Falas sobrepostas…]") é observação, não risco automático; sinal do cliente (repetição, confusão, insatisfação) é INTERACTION_FRICTION quando não há observação do operador ligada — nunca vira FRICTION do operador sozinho; (3) resolutionStatus: RESOLVED/PARTIAL exigem resolutionEvidence (o turno que resolveu, total ou parcialmente); UNRESOLVED = a necessidade ficou sem resposta na interação (não invente o que deveria ter sido dito); UNKNOWN quando não dá para saber; (4) BALANCE: registre o que foi BOM (clareza, confirmação de dados, síntese, resolução, boa investigação, explicação objetiva, verificação de entendimento) como STRENGTH com a mesma seriedade que FRICTION/UNRESOLVED_NEED — não force forças nem riscos; (5) procedureAssertions: registre a afirmação com o trecho; NÃO decida se está correta (isso exige a base de conhecimento) — dúvida vira finding PROCEDURAL_QUESTION; (6) sinal do cliente (repetição, confusão, insatisfação) é fato observado, não culpa do operador; commitment nunca é FULFILLED fora da interação; (7) descreva o que aconteceu, não por que aconteceu; (8) findings nascem de observationRefs do MESMO frame (ids desse frame) — finding sem observação é descartado; (9) não use nomes de pessoas; (10) registre também o que contradiz ou complica o objetivo (inconsistências literais entre o que foi dito e o que foi feito, exceções).`
}

/** Retry dirigido da Fase A: só os handles que faltaram. */
export function renderMissingFramesRequest(missing: string[]): string {
  return `A resposta anterior não trouxe frame para: ${missing.join(", ")}. Devolva SOMENTE {"frames":[…]} com EXATAMENTE ${missing.length} frame(s) para essas referências (listas vazias quando não houver nada material).`
}

/**
 * FASE B — instruções da SÍNTESE DE PATTERNS a partir dos frames compactos (sem transcrições; a evidência já foi verificada
 * na Fase A). Só findingRefs "I-ref/F-id" existentes; a aplicação deriva kind, contagens e suporte.
 */
export function renderPatternSynthesisInstructions(): string {
  return `Você recebe, para cada interação analisada de um colaborador, o FRAME semântico já verificado: observações com ids (necessidades do cliente e status de resolução, perguntas × respostas, ações e afirmações do operador, compromissos, sinais do cliente, afirmações sobre procedimento, eventos da interação) e os FINDINGS já aceitos daquela interação. Duas tarefas, nesta ordem:

(A) COMPLETAR FINDINGS: para cada frame, decida o que é MATERIAL entre as observações listadas e ainda sem finding — necessidade não resolvida/parcial (UNRESOLVED_NEED), atrito com observação do operador (FRICTION), contradição entre o que foi dito e feito (CONTRADICTION), afirmação normativa a verificar (PROCEDURAL_QUESTION), comportamento POSITIVO material (STRENGTH: confirmação, síntese, prazo completo, verificação de entendimento, resolução…), atrito só do lado do cliente/evento (INTERACTION_FRICTION), contexto relevante (CONTEXT). Um finding promovido cita SÓ observationRefs que EXISTEM no frame — a aplicação recusa refs desconhecidas e NUNCA aceita trecho novo: se o fato não está nas observações, não existe finding. Trate STRENGTH e riscos com a mesma seriedade; não force finding onde nada é material.

(B) PATTERNS ENTRE INTERAÇÕES: findings semelhantes (já aceitos + promovidos em (A)) que se repetem em mais de uma interação, referenciados por "I-ref/F-id". Nunca invente: um pattern só existe a partir de findings listados ou promovidos aqui.

Responda SOMENTE com JSON válido:
{"findings":[{"interactionRef":"${EXAMPLE_INTERACTION_REF}","id":"F2","kind":"STRENGTH|FRICTION|UNRESOLVED_NEED|PROCEDURAL_QUESTION|CONTRADICTION|INTERACTION_FRICTION|CONTEXT|OTHER","summary":"interpretação desta interação, em 1 frase","observationRefs":["N1","R1"]}],
 "patterns":[{"description":"comportamento observado, em 1 frase (sem 'costuma/sempre/padrão do colaborador')","kind":"STRENGTH|RISK|PROCEDURAL|MIXED|NEUTRAL|INTERACTION_FRICTION","findingRefs":["${EXAMPLE_INTERACTION_REF}/F1","${EXAMPLE_INTERACTION_REF}/F2"]}]}

Regras: (1) observationRefs e findingRefs só com ids EXATAMENTE como listados; (2) FRICTION/CONTRADICTION atribuídos ao operador precisam de ≥ 1 observação do lado do operador (ação, afirmação, compromisso, afirmação normativa, necessidade não resolvida); só sinal do cliente ou evento = INTERACTION_FRICTION; (3) agrupe findings que descrevem o MESMO comportamento — um pattern por comportamento, com TODAS as interações em que aparece; (4) não escreva causa nem generalização: a aplicação calcula em quantas interações, o suporte e se chega a padrão do colaborador; (5) zero findings promovidos e zero patterns são respostas válidas; (6) não use nomes de pessoas.`
}

/** Frames compactos MODEL-FACING para a Fase B (sem transcrições, sem UUID): observações resumidas + findings com trechos verificados. */
export function renderFramesForModel(frames: InteractionSemanticFrame[], header?: (interactionRef: string) => string): string {
  const quote = (units: VerifiedEvidence[]) => units.slice(0, 3).map((unit) => `${unit.turnRef} ${unit.speaker ?? ""}: "${unit.quote.length > 160 ? `${unit.quote.slice(0, 157)}…` : unit.quote}"`).join(" | ")
  return frames.map((frame) => {
    const lines: string[] = [`=== ${header ? header(frame.interactionRef) : frame.interactionRef} ===`]
    if (frame.empty) { lines.push("(sem observações materiais)"); return lines.join("\n") }
    for (const need of frame.customerNeeds) lines.push(`${need.id} necessidade [${need.resolutionStatus}]: ${need.summary}`)
    for (const question of frame.questions) lines.push(`${question.id} pergunta (${question.askedBy ?? "?"}): ${question.summary}`)
    for (const answer of frame.answers) lines.push(`${answer.id} resposta${answer.answersQuestionRef ? ` a ${answer.answersQuestionRef}` : ""} [${answer.completeness}]: ${answer.summary}`)
    for (const action of frame.agentActions) lines.push(`${action.id} ação do operador [${action.actionKind}]: ${action.summary}`)
    for (const statement of frame.agentStatements) lines.push(`${statement.id} afirmação do operador: ${statement.summary}`)
    for (const commitment of frame.commitments) lines.push(`${commitment.id} compromisso (${commitment.actor ?? "?"}) [${commitment.status}]: ${commitment.summary}`)
    for (const signal of frame.customerSignals) lines.push(`${signal.id} sinal do cliente [${signal.signalKind}]: ${signal.summary}`)
    for (const assertion of frame.procedureAssertions) lines.push(`${assertion.id} afirmação sobre procedimento (a verificar na base): ${assertion.summary}`)
    for (const event of frame.interactionEvents) lines.push(`${event.id} evento [${event.eventKind}, ${event.attribution}]: ${event.summary}`)
    lines.push(frame.findings.length > 0 ? `FINDINGS ACEITOS: ${frame.findings.map((finding) => `${frame.interactionRef}/${finding.id} [${finding.kind}] ${finding.summary} (obs ${finding.observationRefs.join(", ")}; ${quote(finding.evidence)})`).join(" ‖ ")}` : "FINDINGS ACEITOS: nenhum (observações acima podem ser promovidas)")
    return lines.join("\n")
  }).join("\n\n")
}
