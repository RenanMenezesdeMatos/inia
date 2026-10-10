import type { ToolQuality, ToolProvenance } from "./tool-output.js"

/**
 * TRACE SEGURO de uma chamada de Tool — o que fica persistido (agent_runs.tool_trace,
 * assistant_interactions.tool_calls, context_snapshot do Feedback) e o que o QA Lab mostra em
 * "Ferramentas utilizadas". Só fatos/ações observáveis: nunca prompt, nunca cadeia de raciocínio.
 */
export type ToolInvocationTrace = {
  sequence: number
  tool: string
  /** Rótulo amigável da Tool (catálogo) — ex.: "Consultar indicador". */
  label: string
  capability: string
  /** Argumentos como o Agent pediu, já validados e resumidos (sem texto longo). */
  argumentsSummary: Record<string, unknown>
  /** Resumo legível do resultado (uma linha) — o que o QA Lab mostra ao lado do nome. */
  resultSummary: string
  quality: ToolQuality | null
  provenance: ToolProvenance | null
  status: "COMPLETED" | "FAILED" | "REJECTED" | "CACHED" | "BUDGET_EXCEEDED"
  error?: string | undefined
  startedAt: string
  completedAt: string
  /** Rodada de planejamento que pediu a chamada — 0 = PREFLIGHT determinístico (V1.1). Ausente em traces anteriores. */
  round?: number
  /** Argumentos como o MODELO os pediu (handles I1/K1/M1 — V1.2); `argumentsSummary` guarda os ids reais resolvidos (auditoria). */
  modelArguments?: Record<string, unknown>
  /** Quantas chamadas rodaram em PARALELO na mesma onda (1 = sozinha). A `sequence` continua lógica (ordem do pedido). */
  concurrency?: number
  /** Referência no Evidence Ledger (F1..Fn) quando a chamada produziu fato. */
  ledgerRef?: string
  /** Sinais determinísticos do resultado (direção, meta, qualidade) — fatos críticos à decisão (V1.3.1). */
  signals?: import("./decision-critical-facts.js").DecisionSignals | null
}

/** Tokens somados a partir do que o provider informou — null = nenhuma request informou o campo (nunca estimado). */
export type InvestigationTokens = { input: number | null; cached: number | null; output: number | null; reasoning: number | null; total: number | null }

/** Observabilidade do Token Budget (V1.1): aviso configurável, nunca teto cego. */
export type TokenBudgetStatus = { status: "OK" | "WARNING" | "NOT_INFORMED"; thresholds: { total: number | null; input: number | null; output: number | null }; exceeded: ("total" | "input" | "output")[] }

/** Base de cada recomendação (V1.1 — item 19): OBSERVED_EVIDENCE exige refs do ledger; KNOWLEDGE_GUIDANCE exige base/procedimento real; GENERAL é sugestão declarada. */
export type RecommendationBasis = "OBSERVED_EVIDENCE" | "KNOWLEDGE_GUIDANCE" | "GENERAL_DEVELOPMENT_SUGGESTION"
export type RecommendationSupport = { text: string; basis: RecommendationBasis; evidenceRefs: string[] }
/** ESCOPO de uma afirmação (V1.2): o que a evidência autoriza generalizar. */
export type ClaimScope = "INTERACTION_SPECIFIC" | "PERIOD_PATTERN" | "EMPLOYEE_PATTERN" | "POPULATION_PATTERN"
export type ClaimPolarity = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED"
export type BehavioralClaim = { text: string; evidenceRefs: string[]; scope?: ClaimScope | undefined; /** V1.3.4: relação temporal declarada (NONE = não temporal) e blocos que a sustentam. */ temporalRelation?: import("./temporal-semantics.js").TemporalRelation | undefined; evidenceBuckets?: string[] | undefined; position?: "FIRST" | "MIDDLE" | "LAST" | undefined; /** V1.4.1 — BINDING: pattern ("F3/P2") que sustenta claim de padrão; finding ("I6/F1") que sustenta claim de interação; polaridade declarada (validada contra o kind do pattern/finding). */ patternRef?: string | undefined; findingRef?: string | undefined; polarity?: ClaimPolarity | undefined; /** V1.4.2 — SUPORTE PRIMÁRIO CANÔNICO: exatamente um, por handle da execução (SP-n pattern | SF-n finding); `patternRef`/`findingRef` soltos são legado (aceitos só em forma 100 % inequívoca). */ support?: ClaimSupport | undefined; /** V1.4.4 — CANDIDATO selecionado ("CC-n"): a aplicação já derivou tipo, polaridade, escopo máximo e suporte; o modelo só escolhe o candidato e escreve o texto. */ candidateRef?: string | undefined }

/** V1.4.2 (§3): estrutura de suporte de uma claim — o modelo SELECIONA um handle existente; nunca compõe "F3/P1". */
export type ClaimSupport = { /** PATTERN | FINDING — qualquer outro valor é rejeitado por código (`claimSupportSchemaFor`). */ type: string; patternRef?: string | undefined; findingRef?: string | undefined }
/** V1.4.2 (§20): categoria de cada rejeição do gating — separa perda por CONTRATO (formato/handle) de perda semântica e temporal. */
export type GatingCorrectionCategory = "BINDING_FORMAT" | "SEMANTIC" | "TEMPORAL" | "ENVELOPE"

/** Síntese estruturada persistida (não exposta ao colaborador): hipóteses, limitações e o suporte de cada afirmação/recomendação. */
export type InvestigationSynthesis = {
  supportedHypotheses: string[]
  unsupportedHypotheses: string[]
  limitations: string[]
  behavioralClaims: BehavioralClaim[]
  recommendationSupport: RecommendationSupport[]
  /** Refs dos fatos críticos à decisão que a síntese declarou ter considerado (V1.3.1 — fact preservation). */
  consideredCriticalFacts?: string[] | undefined
  /** Representatividade de cada fato de interação (V1.2; V1.3 acrescenta os dois universos) — calculada por código, nunca pelo modelo.
   * `analyzed/universe/level` são os campos da V1.2 (runs históricos só têm esses). */
  evidenceRepresentativeness?: {
    ref: string
    tool: string
    analyzed: number
    universe: number | null
    level: "INSUFFICIENT" | "ANECDOTAL" | "REPRESENTATIVE"
    analyzedCount?: number
    recordedUniverseCount?: number | null
    recordedCoverage?: number | null
    operationalUniverseCount?: number | null
    operationalCoverage?: number | null
    universeRelationship?: "EXACT" | "PARTIAL" | "UNKNOWN"
    classification?: "INSUFFICIENT" | "ANECDOTAL" | "REPRESENTATIVE"
    reason?: string
  }[]
}

/** Resultado do EVIDENCE GATING por código: o que foi rejeitado na 1ª resposta e se a correção foi aceita. */
export type EvidenceGatingResult = {
  rejectedClaims: { kind: "BEHAVIORAL_CLAIM" | "RECOMMENDATION" | "CRITICAL_FACT" | "TEMPORAL_CLAIM" | "PROCEDURAL_CLAIM" | "CLAIM_BINDING"; text: string; reason: string }[]
  /** true = a resposta precisou de UMA re-request corretiva e ela passou. */
  corrected: boolean
  // --- V1.3 FAIL-CLOSED (§2/3) — ausentes em runs anteriores ---
  /** O envelope de evidência (linha EVIDENCE_JSON ou campos internos do JSON) veio na resposta aceita? */
  envelopePresent?: boolean
  parseStatus?: "PARSED" | "MISSING" | "INVALID"
  correctionAttempted?: boolean
  correctionSucceeded?: boolean
  /** A resposta entregue é o fallback factual determinístico (nunca o texto original não validado). */
  fallbackUsed?: boolean
  fallbackReason?: "ENVELOPE_MISSING" | "CLAIMS_REJECTED" | "UNISOLABLE_TEXT" | "NO_SAFE_CLAIM" | null
  /** V1.3.1: fatos críticos declarados/considerados (DECLARED), ou aceitos com a declaração ausente após correção (UNDECLARED). */
  factPreservation?: "DECLARED" | "UNDECLARED" | "NOT_APPLICABLE"
  /** V1.3.2: framing do marcador EVIDENCE_JSON na resposta ACEITA (ou na última tentativa) — prova de que INVALID não veio de outro marcador engolido. */
  markerStatus?: import("../../../shared/application/prompting/structured-markers.js").MarkerParseStatus
  /** V1.3.2: framing da 1ª tentativa quando houve correção. */
  firstAttemptMarkerStatus?: import("../../../shared/application/prompting/structured-markers.js").MarkerParseStatus
  /** V1.4.2 (§20): categorias das rejeições que motivaram a correção (1ª tentativa) e das que persistiram após ela. */
  correctionCategories?: GatingCorrectionCategory[]
  persistentCategories?: GatingCorrectionCategory[]
  // --- V1.4.3 (§3/§7/§8/§16) CLAIM SALVAGE: o destino de CADA afirmação; uma inválida não apaga as válidas ---
  /** Destino por afirmação, na ordem proposta pelo modelo. */
  claimOutcomes?: { text: string; status: ClaimOutcomeStatus; reason?: string | null; category?: GatingCorrectionCategory | null }[]
  claimsProposed?: number
  claimsAcceptedFirstPass?: number
  claimsCorrectionRequired?: number
  claimsCorrected?: number
  claimsDropped?: number
  /** Afirmações válidas preservadas apesar de alguma irmã ter falhado (o que a V1.4.2 perdia no fallback inteiro). */
  claimsPreservedAfterSiblingFailure?: number
  /** Recomendações descartadas por dependerem só de afirmações descartadas (§10). */
  recommendationsDropped?: number
  /** NONE = nada foi rejeitado; PARTIAL = resposta entregue com as afirmações válidas; FULL_FALLBACK = resposta factual/descarte. */
  salvage?: "NONE" | "PARTIAL" | "FULL_FALLBACK"
  // --- V1.4.4 (§42) PROJEÇÃO DETERMINÍSTICA: o modelo seleciona candidatos; erros restantes são de TEXTO, não de estrutura ---
  claimCandidatesAvailable?: number
  claimCandidatesSelected?: number
  claimCandidatesDelivered?: number
  /** Texto contradiz a polaridade do candidato (erro de redação; o estrutural não existe mais por construção). */
  textPolarityMismatch?: number
  /** Texto generaliza acima do escopo máximo do candidato. */
  textScopeMismatch?: number
  /** Correção tentou trocar o candidato para a afirmação passar (§40). */
  candidateSwapRejected?: number
  /** Mesmo candidato selecionado mais de uma vez (paráfrase equivalente). */
  duplicateCandidateSelection?: number
}

/** V1.4.3: destino de uma afirmação no gating. */
export type ClaimOutcomeStatus = "ACCEPTED" | "ACCEPTED_CORRECTED" | "DROPPED"

/** Universo OPERACIONAL do indicador em foco (volume que compõe o indicador) — distinto das interações registradas (V1.3). */
export type OperationalUniverseRecord = { count: number; source: string; label: string }

export type InvestigationSummary = {
  toolCalls: number
  /** Chamadas repetidas atendidas pelo cache da execução (mesma Tool + mesmos argumentos). */
  cachedCalls: number
  rejectedCalls: number
  budget: number
  /** Como a investigação terminou. */
  outcome: "ANSWERED" | "BUDGET_EXHAUSTED" | "NO_TOOLS" | "TIMEOUT"
  // --- V1.1 (eficiência) — ausentes em execuções anteriores ---
  /** Chamadas executadas pelo PREFLIGHT determinístico (contam em toolCalls; NÃO consomem o orçamento do Agent — V1.2). */
  preflightCalls?: number
  /** Chamadas escolhidas pelo Agent (as únicas que consomem `targetToolCalls`/`budget`). */
  investigationToolCalls?: number
  /** Interações do colaborador no período padrão (universo REGISTRADO da representatividade) — null = desconhecido. */
  interactionsInPeriod?: number | null
  /** Volume operacional do indicador em foco (ex.: 1.267 contatos do TMA) — universo OPERACIONAL; null = não determinado (V1.3). */
  operationalUniverse?: OperationalUniverseRecord | null
  /** Handles desta execução → identidade real (AUDIT context; o modelo só viu os handles). */
  handles?: { handle: string; kind: "I" | "K" | "M" | "P"; realId: string }[]
  /** Rodadas de planejamento que pediram Tools (a request de notas/síntese não conta). */
  planningRounds?: number
  maxPlanningRounds?: number
  targetToolCalls?: number
  /** Ondas com 2+ Tools executadas em paralelo. */
  parallelWaves?: number
  /** Requests ao modelo feitas por esta investigação (planejamento, notas, análise semântica, síntese final quando informada pelo chamador). */
  requests?: number
  /** Uma linha por request (fase, modelo, tier, tokens) — auditoria do roteamento fora do QA Lab (V1.2). */
  requestLog?: { phase: string; model: string; tier: string | null; total: number | null; reasoning: number | null; escalated: boolean }[]
  tokens?: InvestigationTokens
  tokenBudget?: TokenBudgetStatus
  synthesis?: InvestigationSynthesis
  evidenceGating?: EvidenceGatingResult
  // --- V1.3.1 — objetivo, suficiência e parada (ausentes em runs anteriores) ---
  objective?: import("./investigation-objective.js").InvestigationObjective
  /** Por que a investigação parou — nunca só "ANSWERED". */
  stopReason?: import("./evidence-sufficiency.js").StopReason
  sufficiency?: InvestigationSufficiency
  // --- V1.3.2 — fontes, amostragem e intenção do período (ausentes em runs anteriores) ---
  /** Fontes de evidência disponíveis nesta execução × consultadas (rastreabilidade, nunca score). */
  evidenceSources?: { available: import("./evidence-sources.js").EvidenceSource[]; used: import("./evidence-sources.js").EvidenceSource[] }
  /** Estratégia padrão de amostragem de find_interactions decidida pelo runtime (objetivo × janela). */
  samplingStrategy?: import("./sampling-strategy.js").SamplingStrategy
  periodIntent?: import("./interaction-analysis.js").PeriodIntent
  /** V1.3.4: semântica temporal — comparação exigida/realizada, blocos, claims temporais propostas × aceitas × rejeitadas. */
  temporal?: import("./temporal-semantics.js").TemporalTelemetry
  /** V1.4.0: cobertura da camada semântica somada sobre as chamadas de analyze_interactions do alvo (só contagens). */
  semantic?: SemanticCoverageSummary
  /** V1.4.5: avaliação procedimental agregada da execução. */
  procedural?: ProceduralCoverageSummary
  /** V1.4.6: RESULTADO × ATRIBUIÇÃO agregados — necessidades abertas, de quê dependem e quantas foram atribuídas ao operador. */
  outcomeAttribution?: OutcomeCoverageSummary
  /** V1.4.6 (§26): tokens da análise semântica por estágio (EXTRACTION / SYNTHESIS / SIDECAR). */
  semanticStageTokens?: Record<string, number>
}

/** V1.4.0 (§41): telemetria compacta da camada semântica — frames, findings, necessidades, patterns por suporte. */
export type SemanticCoverageSummary = {
  analysisCalls: number
  /** V1.4.6.8 — completude ESTRUTURAL do contrato da Fase A somada sobre as chamadas que mediram (ausente em runs anteriores).
   * final = depois do retry dirigido (ou o inicial, sem retry). EMPTY ≠ MISSING. */
  frameContract?: FrameContractCoverage
  semanticFramesCreated: number
  framesNotReturned: number
  framesEmpty: number
  interactionsWithFindings: number
  interactionsWithoutMaterialFindings: number
  customerNeedsCount: number
  unresolvedNeedsCount: number
  partialNeedsCount: number
  strengthFindingsCount: number
  riskFindingsCount: number
  proceduralQuestionsCount: number
  procedureAssertionsCount: number
  crossInteractionPatternsCount: number
  patternsBySupport: Record<string, number>
  patternsByKind: Record<string, number>
  observationsDropped: number
  findingsDropped: number
  patternsDropped: number
  contractViolations: number
  /** V1.4.1 — formação de findings e atribuição. */
  phaseAFindings?: number
  phaseBPromotedFindings?: number
  promotionRejectedCount?: number
  interactionFrictionFindingsCount?: number
  findingKindDowngraded?: number
  interactionEventsCount?: number
  /** V1.4.2 — patterns por ESCOPO de suporte (SAMPLE / PERIOD / RECORDED_UNIVERSE / EMPLOYEE_PATTERN). */
  patternsByScope?: Record<string, number>
  /** V1.4.6 — patterns por DONO do fenômeno e quantos tiveram o teto de claim reduzido por não serem de conduta do operador. */
  patternsByOwnership?: Record<string, number>
  patternsScopeCappedByOwnership?: number
  /** V1.4.5 — interpretação semântica: derivações que rebaixaram o declarado (completude, resolução, atribuição). */
  questionsWithComponents?: number
  answerCompletenessDowngraded?: number
  needStatusDowngradedByOpenPoint?: number
  needStatusDowngradedByAnswer?: number
  frictionDowngradedByCompleteAnswer?: number
  contradictionDowngradedByCorrection?: number
  proceduralConsistencyFindings?: number
  proceduralDivergenceFindings?: number
  proceduralQuestionFindings?: number
}

/** V1.4.6 (§39): funil de resultado × atribuição da execução — a métrica central da versão. */
export type OutcomeCoverageSummary = {
  analysisCalls: number
  needsTotal: number
  needsOpen: number
  attributionsDeclared: number
  attributionsAccepted: number
  byAttribution: Record<string, number>
  /** AGENT_ACTION declarada e RECUSADA por falta de ponte — a métrica de FALSA ATRIBUIÇÃO. */
  agentAttributionRejected: number
  bridges: Record<string, number>
  findingsNeutralized: number
  findingsAgentAttributed: number
  patternsByOwnership: Record<string, number>
  patternsScopeCappedByOwnership: number
  sidecarStatus: string
}

/** V1.4.5 (§47/§48): funil procedimental da execução — afirmação → regra da base → comparação → finding. */
export type ProceduralCoverageSummary = {
  analysisCalls: number
  assertionsDeclared: number
  quantitiesParsedAssertion: number
  knowledgeExcerptsAvailable: number
  rulesDeclared: number
  rulesVerified: number
  rulesRejected: number
  evaluations: number
  byStatus: Record<string, number>
  coverage: "PARTIAL" | "COMPLETE"
  knowledgeSource: string
}

/** Estado de suficiência persistido (QA Lab "Investigation outcome"; auditoria). Nunca chain-of-thought. */
export type InvestigationSufficiency = {
  status: import("./evidence-sufficiency.js").SufficiencyStatus
  requiredScope: ClaimScope | null
  stopProposed: boolean
  stopAccepted: boolean
  /** Recusas de STOP ao longo das rodadas (rodada + lacunas com caminho). */
  rejections: { round: number; reasons: string[] }[]
  evidenceNeeds: import("./evidence-sufficiency.js").EvidenceNeed[]
  hypotheses: import("./evidence-sufficiency.js").MaterialHypothesis[]
  contradictoryEvidence: { description: string; refs: string[]; status: "OPEN" | "CONTEXTUALIZED" }[]
  additionalEvidenceCouldChangeConclusion: boolean
  additionalEvidenceCouldIncreaseRequiredScope: boolean
  dataLimitations: string[]
  /** Fatos críticos à decisão derivados do ledger (refs + tipo). */
  criticalFacts: { ref: string; kind: string; label: string }[]
  /** V1.3.2 (§42): o STOP foi recusado (lacuna material com caminho) na ÚLTIMA rodada — sem rodada para reagir. */
  stopRejectedAtFinalRound?: boolean
  remainingMaterialNeeds?: string[]
  candidateToolsAvailable?: string[]
}

/** V1.4.6.8 — soma da completude estrutural da Fase A (só contagens). */
export type FrameContractCoverage = {
  calls: number
  initialComplete: number
  finalComplete: number
  retries: number
  expectedFrames: number
  initialMissingFrames: number
  finalMissingFrames: number
  emptyFrames: number
  duplicateFrames: number
  duplicateFrameObservationsDropped: number
  unexpectedFrames: number
  exampleRefEchoed: number
}
