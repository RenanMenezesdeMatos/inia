import type { ItemWording, WordingViolation } from "../../investigation/domain/interaction-feedback-writer.js"
import type { Ownership } from "../../investigation/domain/outcome-attribution.js"
import { hasUnmaskedNumericIdentifier } from "../../investigation/domain/feedback-display-evidence.js"
import { redactEvidentPii } from "../../investigation/domain/peer-privacy-projection.js"
import type { FeedbackDomain } from "./feedback-investigation-result.js"
import type { GuidanceGrounding } from "../../agents/domain/process-assessment-contract.js"
import type { CheckpointEvidenceType } from "./verified-omission.js"
import type { KnowledgeContentKind, SuggestedResponseViolation } from "./suggested-response.js"

/**
 * V1.5.12 — RELIABILITY CORE (domínio puro): o item de feedback confiável comum a MONITORIA e INDICADOR, a política de
 * disposição e a disposição do ARTEFATO. Mesmos princípios do InteractionFeedback V1 (V1.5.5/V1.5.9):
 *
 *   BLOCKED      → a ESTRUTURA impede (evidência não verificada, não atribuível ao colaborador, sem evidência exibível,
 *                  dado pessoal, sem meta canônica…). Nenhuma decisão humana transforma BLOCKED em emitível.
 *   HOLD_FOR_QA  → estruturalmente emitível, mas a política/um critério de autonomia exige QA ANTES de o Workflow seguir.
 *   READY        → estruturalmente emitível e todos os critérios de autonomia atendidos — o Workflow segue (READY NÃO é
 *                  "entregar": quem entrega é o Output).
 * O LLM nunca decide disposição, seção, dono ou polaridade.
 */
/** V1.7.1b — ATTENTION = "Vale confirmar": incerteza de APLICABILIDADE (produto/processo) — nunca ponto de desenvolvimento. */
export type ReliableSection = "STRENGTH" | "OPPORTUNITY" | "ATTENTION" | "NEUTRAL_CONTEXT"
export const EMITTABLE_SECTIONS: readonly ReliableSection[] = ["STRENGTH", "OPPORTUNITY", "ATTENTION"]
export type EmittableSection = "STRENGTH" | "OPPORTUNITY" | "ATTENTION"
export const isEmittableSection = (section: string): section is EmittableSection => (EMITTABLE_SECTIONS as readonly string[]).includes(section)
/** V1.6.0: MONITORING_STRENGTH = etapa de processo CUMPRIDA, com o mesmo rigor probatório do ponto de desenvolvimento
 * (fala verificada do operador + regra da base verificada). Nunca elogio para "equilibrar". */
/** V1.6.1: INDICATOR_DEVELOPMENT_PATTERN / INDICATOR_STRENGTH_PATTERN = etapa de processo não seguida / seguida de forma
 * recorrente na AMOSTRA de atendimentos do motivo investigado a partir do indicador (diagnóstico). Nunca causa do resultado. */
/** V1.7.1b: *_APPLICABILITY_POINT = o produto/processo não foi confirmado; texto do SISTEMA (sem redator, sem avaliação do colaborador). */
export type ReliableItemKind = "MONITORING_DEVELOPMENT_POINT" | "MONITORING_STRENGTH" | "INDICATOR_TARGET_MET" | "INDICATOR_TARGET_NOT_MET" | "INDICATOR_DEVELOPMENT_PATTERN" | "INDICATOR_STRENGTH_PATTERN" | "MONITORING_APPLICABILITY_POINT" | "INDICATOR_APPLICABILITY_POINT"
export const APPLICABILITY_POINT_KINDS: readonly ReliableItemKind[] = ["MONITORING_APPLICABILITY_POINT", "INDICATOR_APPLICABILITY_POINT"]

/**
 * V1.7.1b — o que o ponto de aplicabilidade mostra (tudo verificado): status, produto indicado (INFERRED), comparação da fala do
 * operador com cada regra ("compatível com", nunca "correto"), os candidatos com documento/trecho/link e as etapas que ficaram
 * sem avaliação. No diagnóstico de indicador, `sample` = em quantos atendimentos analisados o produto não foi confirmado.
 */
export type ApplicabilityPointView = {
  ref: string
  status: "INFERRED" | "AMBIGUOUS"
  resolvedProduct: string | null
  statementComparison: "COMPATIBLE_WITH_ONE" | "COMPATIBLE_WITH_SEVERAL" | "COMPATIBLE_WITH_NONE" | "NOT_COMPARABLE" | "NO_STATEMENT"
  compatibleProducts: string[]
  candidates: { product: string; documentId: string; documentTitle: string; heading: string | null; quote: string; href: string }[]
  affectedSteps: string[]
  sample?: { affected: number; analyzed: number } | null
}
export const INDICATOR_PATTERN_KINDS: readonly ReliableItemKind[] = ["INDICATOR_DEVELOPMENT_PATTERN", "INDICATOR_STRENGTH_PATTERN"]
export type ReliableGuidanceSource = "REINFORCEMENT" | "COACHING_SUGGESTION"
export type { GuidanceGrounding } from "../../agents/domain/process-assessment-contract.js"

/**
 * V1.6.0 — a regra da base que sustenta o item (verificada em process-assessment.ts). O link nasce do id REAL do documento
 * (`buildKnowledgeMaterialHref`), nunca de texto de modelo; a autorização continua sendo decidida ao abrir o material.
 */
export type ReliableKnowledgeRef = {
  documentId: string
  documentTitle: string
  heading: string | null
  version: number | null
  /** Trecho LITERAL da versão publicada (mínimo necessário). */
  quote: string
  applicability: "VERIFIED" | "LITERAL_ONLY"
  href: string
  /** V1.7.1 — frase LITERAL que abre a lista da etapa no documento ("Se o cliente não reconhecer:"). Ausente em artefatos anteriores. */
  leadIn?: string | null
  /** V1.7.1 — trecho LITERAL do mesmo documento que diz COMO cumprir a etapa (verificado). Ausente em artefatos anteriores.
   * V1.7.1a — `contentKind`: o trecho é REGRA ou EXEMPLO do documento (exemplo nunca sustenta fato da chamada). */
  detail?: { quote: string; heading: string | null; contentKind?: KnowledgeContentKind | null; /** V1.7.1d — proveniência PRÓPRIA do trecho (documento, versão, trecho); ausente em artefatos anteriores. */ documentId?: string; version?: number | null; chunkIndex?: number | null } | null
  /** V1.7.1a — o trecho da etapa é REGRA ou EXEMPLO do documento. Ausente em artefatos anteriores (= regra). */
  contentKind?: KnowledgeContentKind | null
  /** V1.7.1d — posição (no documento) do trecho onde a regra foi encontrada. */
  chunkIndex?: number | null
  /** V1.7.1 — de onde veio a aplicabilidade VERIFIED (âncora regra × fala, ou omissão verificada). */
  applicabilityBasis?: "LEXICAL_ANCHOR" | "VERIFIED_OMISSION" | "STRUCTURED_ANCHOR" | "DECLARED_CONDUCT" | null
  /** V1.7.1f — falas-modelo/EXEMPLOS literais da mesma seção (nunca fato; proteção contra fato de exemplo). Ausente antes. */
  sectionExamples?: string[] | null
  /** V1.7.1j — falas-modelo que vinham DENTRO do trecho citado (separadas da regra pelos segmentos): mostradas só como exemplo. */
  citedExamples?: string[] | null
  /** V1.7.1e — REGRA OPERACIONAL da mesma seção/versão do documento (`RULE_SELECTION_V1`), quando o trecho citado era só
   * abertura ou lista do que evitar. É o que "O processo orienta" e "Como aplicar" usam primeiro. Ausente antes / sem troca. */
  operativeRule?: { quote: string; heading: string | null; basis: "SECTION_NORMATIVE_RULE" | "CHECKPOINT_RULE_BACKFILL"; replaced: "INTRODUCTORY_CITATION" | "DO_NOT_CITATION" | "LIST_STEP_WITHOUT_RULE"; selection: string; /** V1.7.1g — proveniência própria (backfill). */ documentId?: string | null; version?: number | null; contentSha256?: string | null } | null
  /** V1.7.1g — base da âncora estruturada (ação na fala, pergunta, escolha da etapa canônica, desvio observado). Ausente antes. */
  /** V1.7.1k — item de lista que a citação escolheu (literal, sem marcador); ausente = a citação não é um item. */
  step?: string | null
  structuredAnchorBasis?: "BEHAVIOR_FULFILLED" | "ACTION_STEP" | "ASKED_ITEM" | "CHECKPOINT_SELECTION" | "OBSERVED_DEVIATION" | "AVOIDED_PHRASE_OBSERVED" | "COMPOSITE_ITEMS_OBSERVED" | "UNDERSTANDING_CHECK" | /** V1.7.4 */ "SEMANTIC_CONDUCT" | "PREREQUISITE_SKIPPED" | null
}
/**
 * V1.6.0 — a etapa de processo de onde o item nasceu (monitoria PROCESS-CENTRIC); null no caminho legado/indicador.
 * V1.7.1 — `evidenceType` (ação observada · ação declarada · omissão verificada · omissão não verificada) e `stepTitle` (nome
 * EXIBÍVEL da etapa, derivado da regra literal da base — nunca do texto do modelo). Ausentes em artefatos anteriores.
 */
export type ReliableProcessRef = { title: string; requirement: string; status: "FOLLOWED" | "NOT_FOLLOWED"; checkpointRef: string; evidenceType?: CheckpointEvidenceType | null; stepTitle?: string | null
  /** V1.7.1i — etapa COMPOSTA: completude e itens da regra por situação (observado, verificadamente ausente, desconhecido, condicional). */
  /** V1.7.1k — prontidão analítica da observação desta etapa (a MESMA regra da persistência; só QA técnico). */
  analyticReadiness?: { status: "VERIFIED" | "NEEDS_REVIEW" | "REJECTED"; reasons: string[]; eligible: boolean }
  completeness?: { status: "COMPLETE" | "PARTIAL" | "UNKNOWN"; family: "INFORM" | "VERIFY"; observed: string[]; absent: string[]; unknown: string[]; conditional: string[]; /** V1.7.1j — dito na chamada, fora da etapa. */ elsewhere?: string[]; /** SUBITEM_APPLICABILITY_V1 — itens que dependiam de um resultado ainda pendente (não cobrados). */ notApplicable?: string[] } | null
  /** V1.7.1m — comportamento canônico do ponto (título comportamental, facetas) e as OUTRAS fontes oficiais do mesmo comportamento
   * (proveniência; `addsFacets` = dimensão que a fonte acrescenta e que continua visível). Ausente antes / sem comportamento. */
  behavior?: ReliableBehaviorRef | null
  /** V1.7.1n — etapa de origem pelo checkpointRef (identidade do sistema) e como a citação do modelo se relacionou com ela. */
  /** V1.7.3 — `processRequirement` (obrigatória NO PROCESSO) × `assessmentRequirement` (plano da avaliação); `coverageRequirement`
   * só existe em artefatos anteriores (REQUIRED = obrigatória no processo). */
  sourceCheckpoint?: { ref: string; kind: string; processRequirement?: string; assessmentRequirement?: string; coverageRequirement?: string; quoteMatch: string; origin: "MODEL" | "SYSTEM_COMPLETION" } | null
  /** Checkpoint Registry — identidade lógica e configuração operacional da etapa governada (ausente = legado). */
  registry?: { definitionId: string; versionId: string; definitionVersion: number; criticality: string; highlight: boolean } | null
  /** V1.7.1n — polaridade da evidência (prazo, protocolo): mencionar ≠ cumprir; conflito = a evidência contradiz a conclusão. */
  evidencePolarity?: { behavior: string; evidence: string; conflict: string | null } | null
  /** V1.7.3 — etapas que a análise PRECISAVA avaliar (obrigatórias no processo ou MUST_ASSESS) e ficaram sem disposição mesmo
   * depois do reparo único: análise parcial, o ponto não sai sem QA. `requiredCoverageMissing` = nome anterior (V1.7.1n). */
  assessmentMissing?: string[]
  requiredCoverageMissing?: string[]
  /** V1.7.3 — AUSÊNCIA VERIFICADA com texto do sistema: a omissão passou pelas cinco condições da verificação, mas nenhuma fala
   * do operador pôde ser exibida (ex.: a fala do momento traz um nome retido pela privacidade). A frase representa a CONCLUSÃO
   * determinística (nunca é evidência nova nem citação inventada); a evidência bruta continua na auditoria. */
  absenceDisplay?: VerifiedAbsenceDisplay | null
  /** MONITORING V2 — o que aconteceu nesta etapa, no contexto da chamada (especialista, contrato V5). Contexto para a redação, nunca evidência. */
  summary?: string | null
  /** MONITORING V2 — pré-requisito declarado INCONCLUSIVO: a fala desta etapa vale, mas ela não é conformidade sem QA. */
  prerequisite?: { state: "UNVERIFIED"; gateRef: string; gateStatus: string | null; gateReason: string | null } | null }
export const VERIFIED_ABSENCE_DISPLAY_VERSION = "VERIFIED_ABSENCE_DISPLAY_V1" as const
export type VerifiedAbsenceDisplay = { version: typeof VERIFIED_ABSENCE_DISPLAY_VERSION; statement: string; basis: "VERIFIED_OMISSION"; withheldEvidence: number }
export type ReliableBehaviorSource = { checkpointRef: string; role: "SUPPORTING" | "CONFLICTING"; status: string; applicability?: "VERIFIED" | "LITERAL_ONLY"; documentId: string | null; documentTitle: string; heading: string | null; quote: string; leadIn: string | null; href: string | null; facets: string[]; addsFacets: string[] }
export type ReliableBehaviorRef = { code: string; title: string; facets: string[]; conflict: boolean; sources: ReliableBehaviorSource[]; compositeResolution?: { heading: string | null; fromQuote: string | null; fromHeading: string | null } | null }

/**
 * Papel de um fato EXIBÍVEL: falante verificado na transcrição (monitoria), dado oficial do sistema (indicador), ANALISE =
 * contagem calculada pelo sistema sobre a amostra verificada (V1.6.1) e REFERENCIA = agregado do grupo de referência (V1.6.1).
 * `topic` identifica o fato do sistema (o redator e a validação leem por tópico, nunca por posição).
 */
export type ReliableFactRole = "OPERADOR" | "CLIENTE" | "EVENTO" | "OUTRO" | "DADO_OFICIAL" | "ANALISE" | "REFERENCIA"
export type ReliableFact = { role: ReliableFactRole; text: string; truncated: boolean; masked: boolean; topic?: "SEGMENT" | "PATTERN" | "PEER" }

/**
 * V1.7.1a — PRIORIDADE do item no feedback (determinística; ORDENA, nunca esconde): posição 1..n na leitura e a base da ordem
 * (desenvolvimento antes de ponto forte, regra ancorada antes de regra só literal, ordem do procedimento no documento).
 */
export type ItemPriority = { rank: number; policy: string; basis: string[] }

/**
 * V1.7.1a — o texto de um item do feedback confiável: os três campos do Writer + o EXEMPLO DE CONDUÇÃO opcional ("" ou
 * ausente = sem exemplo). O exemplo é formulação — nunca evidência nem texto oficial.
 */
export type ReliableWording = ItemWording & { suggestedResponse?: string }

export type StructuralBlock =
  | "NO_EVIDENCE"
  | "EVIDENCE_NOT_VERIFIED"
  | "NOT_ATTRIBUTABLE_TO_COLLABORATOR"
  | "INSUFFICIENT_DISPLAY_EVIDENCE"
  | "EVIDENCE_PRIVACY_FAIL"
  | "CANONICAL_TARGET_MISSING"
  /** V1.6.0 — etapa de processo cuja regra da base não foi verificada (não literal, não apresentada, documento ambíguo). */
  | "KNOWLEDGE_NOT_VERIFIED"

export type ReliableItemDraft = {
  /** Posição no artefato (0..n) — estável; identidade da revisão de QA junto do artefato. */
  index: number
  claimRef: string
  domain: FeedbackDomain
  section: ReliableSection
  kind: ReliableItemKind
  /** V1.7.1b: NEUTRAL só nos pontos de aplicabilidade (incerteza do sistema ≠ erro do colaborador). */
  polarity: "POSITIVE" | "NEGATIVE" | "NEUTRAL"
  ownership: Ownership
  safeMeaning: string
  guidanceSource: ReliableGuidanceSource
  /**
   * V1.6.0 — ORIGEM da orientação: OFFICIAL_PROCEDURE | OFFICIAL_SERVICE_GUIDELINE (só com regra da base verificada) |
   * NO_GROUNDED_GUIDANCE (o texto não pode trazer "o que fazer"). VERIFIED_PEER_PATTERN ainda não é produzido.
   */
  grounding: GuidanceGrounding
  knowledge: ReliableKnowledgeRef | null
  process: ReliableProcessRef | null
  /** Só o que pode ser exibido/enviado ao redator (já passou pela projeção de privacidade). */
  facts: ReliableFact[]
  withheldFacts: number
  /** Interpretação da origem que PODE ir ao redator (já filtrada: sem número/afirmação incompatível com o canônico). */
  analysis: { observation: string | null; summary: string | null; recommendation: string | null } | null
  /** Por que a interpretação da origem foi descartada (conflito com o dado canônico) — o item vai a QA. */
  analysisConflicts: string[]
  structuralBlock: StructuralBlock | null
  /** V1.7.1a — posição na leitura (ausente em artefatos anteriores). */
  priority?: ItemPriority | null
  /** V1.7.1a — etapas iguais (mesmo documento, trecho e status) fundidas neste item: refs internas, auditoria. */
  collapsedCheckpoints?: string[]
  /** V1.7.1b — só nos pontos de aplicabilidade. */
  applicability?: ApplicabilityPointView | null
  /** Só auditoria (nunca UI/redator): turno + falante + hash do trecho bruto; motivos de unidades recusadas. */
  audit: { evidence: { turnRef: string; speaker: string | null; rawSha256: string }[]; rejectedUnits: { reason: string }[] }
}

// ---------------------------------------------------------------------------------------------
// POLÍTICA
// ---------------------------------------------------------------------------------------------

export type ReliableStructuralState = "STRUCTURALLY_EMITTABLE" | "BLOCKED"
export type ReliableAutonomyBlocker =
  | "WRITER_NOT_PASSED"
  | "WRITER_FALLBACK_USED"
  | "WRITER_VALIDATION_FAILED"
  | "WORDING_PRIVACY_FLAG"
  | "OWNERSHIP_NOT_ALLOWED"
  | "SOURCE_INTERPRETATION_CONFLICT"
  | "CLAIM_BOUNDARY_NOT_ENFORCED"
  /** V1.6.0 — a regra da base é literal e foi apresentada, mas não está ancorada no que aconteceu: aplicabilidade é do QA. */
  | "KNOWLEDGE_APPLICABILITY_UNVERIFIED"
  /** V1.7.1i — etapa COMPOSTA dada como cumprida sem prova de que TODOS os itens aconteceram (nem ausência provada): QA. */
  | "COMPOSITE_COMPLETENESS_UNVERIFIED"
  /** V1.6.1 — padrão de processo cuja etapa não tem regra da base verificada (o nome da etapa é do modelo): só com QA. */
  | "PROCESS_RULE_UNVERIFIED"
  /** V1.7.1d — PORTÃO DE QUALIDADE DO CONHECIMENTO (problema estrutural, não de redação): o trecho citado como regra é um
   * EXEMPLO do documento; o trecho de detalhe não é do mesmo documento/versão da regra; a etapa não tem nome canônico. */
  | "KNOWLEDGE_RULE_IS_EXAMPLE"
  | "KNOWLEDGE_PROVENANCE_INCONSISTENT"
  | "CHECKPOINT_LABEL_UNRESOLVED"
  /** V1.7.1m — duas fontes oficiais do MESMO comportamento concluem o contrário (cumprida × não cumprida). */
  | "CANONICAL_BEHAVIOR_CONFLICT"
  /** V1.7.1n — a fala citada contradiz a conclusão (ex.: "cumpriu" com "não sei te dizer o prazo"; "não cumpriu" com o prazo dito). */
  | "EVIDENCE_POLARITY_CONFLICT"
  /** V1.7.1n — a citação da base é de OUTRA etapa (ou de fora da seção) do que o código escolhido: a escolha é ambígua. */
  | "CHECKPOINT_SOURCE_AMBIGUOUS"
  /** V1.7.1n (nome anterior do próximo, só em artefatos antigos). */
  | "REQUIRED_CHECKPOINT_NOT_ASSESSED"
  /** V1.7.3 — uma etapa que a análise PRECISAVA avaliar ficou sem disposição (nem o reparo único nem a completude determinística
   * cobriram): a análise está incompleta — ausência de resposta do Agent nunca é conclusão sobre a chamada. */
  | "MISSING_REQUIRED_ASSESSMENT"
  /** MONITORING V2 — a etapa depende de um pré-requisito declarado que ficou INCONCLUSIVO (não verificado/observável): incerteza, nunca falha. */
  | "PREREQUISITE_UNVERIFIED"
/** V1.6.2: NO_DIAGNOSIS_HOLD_FOR_QA = a estratégia do indicador manda o feedback factual (sem diagnóstico acionável) para o QA. */
export type ReliablePolicyHold = "PILOT_HOLD_ALL_FOR_QA" | "FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY" | "NO_DIAGNOSIS_HOLD_FOR_QA"

/** V1.6.2 — retém para QA um item estruturalmente emitível (nunca libera um bloqueado nem apaga os motivos já registrados). */
export function holdForStrategy(decision: ReliableItemDecision): ReliableItemDecision {
  if (decision.disposition === "BLOCKED") return decision
  return { ...decision, disposition: "HOLD_FOR_QA", reasons: [...decision.reasons.filter((reason) => reason !== "AUTONOMY_CRITERIA_MET"), "NO_DIAGNOSIS_HOLD_FOR_QA"] }
}
/** V1.7.1b: SYSTEM_RENDERED_NEUTRAL = ponto de aplicabilidade — texto do sistema, sem IA e sem avaliação do colaborador: nunca QA. */
export type ReliableReason = StructuralBlock | ReliableAutonomyBlocker | ReliablePolicyHold | "AUTONOMY_CRITERIA_MET" | "SYSTEM_RENDERED_NEUTRAL" | /** V1.7.1k — texto do sistema no lugar da redação genérica (auditoria). */ "VERIFIED_SPECIFIC_FALLBACK"
export type ReliableDisposition = "READY" | "HOLD_FOR_QA" | "BLOCKED"

/**
 * Política da camada de confiabilidade (dados, versionada, injetada). `releasedItemKinds` = tipos de item LIBERADOS para
 * autonomia (lista de permissão). O tipo SOZINHO nunca libera: um item liberado só segue sem QA com TODOS os critérios de
 * `decideReliableItem` atendidos (estrutura emitível, dono permitido, redator respondeu sem fallback, validadores PASS,
 * sem dado pessoal no texto, sem conflito da interpretação da origem com o dado, modos de afirmação aplicados).
 *
 * PILOT_V1: conservadora — todo item emitível passa por QA antes de o Workflow seguir.
 * AUTONOMOUS_V1 (V1.5.12a; MONITORING_STRENGTH na V1.6.0; padrões do diagnóstico de indicador na V1.6.1 — com as travas de regra verificada/aplicável): QA é EXCEÇÃO. Liberados os tipos que a camada produz — todos com verificação
 * estrutural própria: MONITORING_DEVELOPMENT_POINT (citação da origem conferida literalmente, por turno e falante, na
 * transcrição real; só fala do OPERADOR sustenta o ponto) e INDICATOR_TARGET_MET / INDICATOR_TARGET_NOT_MET (números,
 * comparação com a meta, período e distância até a meta vindos do contexto canônico; texto validado contra ele).
 */
export type ReliableFeedbackPolicy = { version: string; holdAllForQa: boolean; releasedItemKinds: readonly ReliableItemKind[]; autonomyOwnership: readonly Ownership[]; note: string }

export const RELIABLE_FEEDBACK_PILOT_POLICY: ReliableFeedbackPolicy = {
  version: "RELIABLE_FEEDBACK_POLICY_PILOT_V1",
  holdAllForQa: true,
  releasedItemKinds: [],
  autonomyOwnership: ["AGENT"],
  note: "piloto: todo feedback emitível passa por QA antes de o Workflow seguir",
}
export const RELIABLE_FEEDBACK_AUTONOMOUS_POLICY: ReliableFeedbackPolicy = {
  version: "RELIABLE_FEEDBACK_POLICY_AUTONOMOUS_V1",
  holdAllForQa: false,
  releasedItemKinds: ["MONITORING_DEVELOPMENT_POINT", "MONITORING_STRENGTH", "INDICATOR_TARGET_MET", "INDICATOR_TARGET_NOT_MET", "INDICATOR_DEVELOPMENT_PATTERN", "INDICATOR_STRENGTH_PATTERN"],
  autonomyOwnership: ["AGENT"],
  note: "autônoma: claro/seguro segue; duvidoso vai a QA (fallback, validador, conflito, dono, privacidade, afirmação); estruturalmente inseguro é BLOCKED",
}
export const RELIABLE_FEEDBACK_POLICIES = { PILOT_V1: RELIABLE_FEEDBACK_PILOT_POLICY, AUTONOMOUS_V1: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } as const

/** Modos de afirmação com que o texto foi escrito E validado: efeito só como possibilidade; ação dita = declaração (monitoria). */
export type ReliableClaimModes = { effect: string; action: string | null }
/** V1.7.1i: SYSTEM = texto montado pelo sistema por construção (etapa composta parcial) — sem redator, sem fallback de falha. */
export type ReliableWriterOutcome = { invoked: boolean; writerError: string | null; source: "WRITER" | "FALLBACK" | "SYSTEM"; violations: readonly string[]; wording: ReliableWording; claimModes?: ReliableClaimModes | null; /** V1.7.1k — o texto de segurança usado é específico e passa nos validadores? */ fallbackCheck?: { specific: boolean; violations: readonly string[] } }

/**
 * V1.7.1k — violações do redator que são só QUALIDADE DE REDAÇÃO (texto genérico, orientação/relevância sem base): com o texto de
 * segurança específico e válido no lugar, não são dúvida sobre o achado. Qualquer outra (fato, polaridade, evidência, efeito,
 * privacidade, ref interna, esquema ausente…) continua indo ao QA — núcleo inválido não é afrouxado.
 */
export const COPY_QUALITY_VIOLATIONS: ReadonlySet<string> = new Set(["GENERIC_WORDING", "UNGROUNDED_GUIDANCE", "UNGROUNDED_RELEVANCE"])

/**
 * V1.7.1k — texto de segurança VERIFICADO: o redator respondeu (sem falha de transporte), o texto dele caiu só por qualidade de
 * redação, o texto de segurança é específico e passa em todos os validadores, e o item tem regra aplicável VERIFICADA e evidência
 * verificada (item de etapa de processo emitível). Aí o fallback não é, sozinho, motivo de QA.
 */
export function isVerifiedSpecificFallback(item: Pick<ReliableItemDraft, "knowledge" | "process">, writer: ReliableWriterOutcome): boolean {
  if (writer.source !== "FALLBACK" || !writer.invoked || writer.writerError || !writer.fallbackCheck) return false
  if (!writer.fallbackCheck.specific || writer.fallbackCheck.violations.length > 0) return false
  if (writer.violations.length === 0 || !writer.violations.every((violation) => COPY_QUALITY_VIOLATIONS.has(violation))) return false
  return Boolean(item.process?.evidenceType) && item.knowledge?.applicability === "VERIFIED"
}

/** V1.7.1i — etapa composta PARCIAL: texto do sistema (itens observados/ausentes verificados + regra), nunca do redator. */
export const isSystemRenderedProcessItem = (item: Pick<ReliableItemDraft, "process" | "section">) => (item.section === "OPPORTUNITY" && item.process?.completeness?.status === "PARTIAL") || isObservedVerifyListItem(item) || (item.section === "OPPORTUNITY" && Boolean(item.process?.absenceDisplay))

/**
 * V1.7.1k — lista de CONFERÊNCIA ("Verificar: …") cumprida com completude DESCONHECIDA e ≥ 1 item reconhecido na fala: parte
 * das conferências é interna e não aparece na gravação. O ponto fala SÓ do que a fala mostra (texto do sistema) e não vai ao QA
 * por isso; a observação continua fora do histórico de "cumpriu" (completude não provada).
 */
export const isObservedVerifyListItem = (item: Pick<ReliableItemDraft, "process" | "section">) => {
  const completeness = item.process?.completeness
  return item.section === "STRENGTH" && item.process?.status === "FOLLOWED" && completeness?.family === "VERIFY" && completeness.status === "UNKNOWN" && completeness.observed.length > 0 && completeness.absent.length === 0
}

/** O contrato de afirmações foi aplicado ao item? Efeito POTENTIAL_ONLY sempre; na monitoria, ação DECLARED_ONLY. */
export function claimModesEnforced(domain: FeedbackDomain, modes: ReliableClaimModes | null | undefined): boolean {
  if (!modes || modes.effect !== "POTENTIAL_ONLY") return false
  return domain === "MONITORING" ? modes.action === "DECLARED_ONLY" : true
}

export type ReliableItemDecision = {
  disposition: ReliableDisposition
  structural: ReliableStructuralState
  reasons: ReliableReason[]
  policyVersion: string
  /** Critérios de autonomia atendidos INDEPENDENTE da política (null = item bloqueado). */
  autonomyEligible: boolean | null
  autonomyBlockers: ReliableAutonomyBlocker[]
}

export const hasPersonalData = (value: string) => redactEvidentPii(value).redactions.length > 0 || hasUnmaskedNumericIdentifier(value)

/** Bloqueio ESTRUTURAL (null = emitível). Independe de política e de redator. */
export function structuralBlockOf(item: ReliableItemDraft): StructuralBlock | null {
  if (item.structuralBlock) return item.structuralBlock
  if (!EMITTABLE_SECTIONS.includes(item.section)) return "NOT_ATTRIBUTABLE_TO_COLLABORATOR"
  // V1.7.3 — ausência VERIFICADA sem fala exibível: a frase do sistema representa a conclusão (nenhuma regra de privacidade muda).
  if (item.facts.length === 0 && !item.process?.absenceDisplay) return "INSUFFICIENT_DISPLAY_EVIDENCE"
  if (item.facts.some((fact) => fact.role !== "DADO_OFICIAL" && hasPersonalData(fact.text))) return "EVIDENCE_PRIVACY_FAIL"
  return null
}

/**
 * V1.7.1d — PORTÃO DE QUALIDADE DO CONHECIMENTO de um item de etapa de processo: nunca publica sozinho um ponto cuja "regra" é
 * exemplo, cujo trecho de detalhe vem de outro documento/versão, ou cuja etapa ficou sem nome canônico — vai ao QA.
 */
export function knowledgeQualityBlockers(item: Pick<ReliableItemDraft, "knowledge" | "process">): ReliableAutonomyBlocker[] {
  const blockers: ReliableAutonomyBlocker[] = []
  const knowledge = item.knowledge
  if (knowledge?.contentKind === "EXAMPLE_CONTENT") blockers.push("KNOWLEDGE_RULE_IS_EXAMPLE")
  const detail = knowledge?.detail ?? null
  const operative = knowledge?.operativeRule ?? null
  const inconsistent = (source: { documentId?: string | null; version?: number | null } | null) => Boolean(knowledge && source && ((source.documentId && source.documentId !== knowledge.documentId) || (source.version !== undefined && source.version !== null && source.version !== knowledge.version)))
  // V1.7.1g — a regra operacional (inclusive a do backfill) precisa ser do MESMO documento e versão da regra da etapa.
  if (inconsistent(detail) || inconsistent(operative)) blockers.push("KNOWLEDGE_PROVENANCE_INCONSISTENT")
  if (item.process?.evidenceType && !item.process.stepTitle) blockers.push("CHECKPOINT_LABEL_UNRESOLVED")
  // V1.7.1m — fontes do MESMO comportamento com conclusões opostas: nada é escolhido em silêncio.
  if (item.process?.behavior?.conflict) blockers.push("CANONICAL_BEHAVIOR_CONFLICT")
  if (item.process?.evidencePolarity?.conflict) blockers.push("EVIDENCE_POLARITY_CONFLICT")
  if (item.process?.sourceCheckpoint && ["OTHER_CHECKPOINT", "UNRELATED"].includes(item.process.sourceCheckpoint.quoteMatch)) blockers.push("CHECKPOINT_SOURCE_AMBIGUOUS")
  if ((item.process?.assessmentMissing?.length ?? 0) > 0) blockers.push("MISSING_REQUIRED_ASSESSMENT")
  if (item.process?.prerequisite?.state === "UNVERIFIED") blockers.push("PREREQUISITE_UNVERIFIED")
  return blockers
}

export function decideReliableItem(item: ReliableItemDraft, writer: ReliableWriterOutcome | null, policy: ReliableFeedbackPolicy): ReliableItemDecision {
  const block = structuralBlockOf(item)
  // V1.7.1b — ponto de aplicabilidade: montado pelo SISTEMA a partir de dados verificados; não tem texto de IA para o QA avaliar
  // nem juízo sobre o colaborador. Estrutura inválida continua BLOCKED.
  if (APPLICABILITY_POINT_KINDS.includes(item.kind)) {
    if (block) return { disposition: "BLOCKED", structural: "BLOCKED", reasons: [block], policyVersion: policy.version, autonomyEligible: null, autonomyBlockers: [] }
    return { disposition: "READY", structural: "STRUCTURALLY_EMITTABLE", reasons: ["SYSTEM_RENDERED_NEUTRAL"], policyVersion: policy.version, autonomyEligible: true, autonomyBlockers: [] }
  }
  if (block || !writer) return { disposition: "BLOCKED", structural: "BLOCKED", reasons: [block ?? "INSUFFICIENT_DISPLAY_EVIDENCE"], policyVersion: policy.version, autonomyEligible: null, autonomyBlockers: [] }
  const blockers: ReliableAutonomyBlocker[] = []
  if (!policy.autonomyOwnership.includes(item.ownership)) blockers.push("OWNERSHIP_NOT_ALLOWED")
  const system = writer.source === "SYSTEM"
  if (!system && (!writer.invoked || writer.writerError)) blockers.push("WRITER_NOT_PASSED")
  // V1.7.1k — texto de segurança específico e validado sobre regra e evidência verificadas não é, sozinho, motivo de QA.
  const verifiedFallback = isVerifiedSpecificFallback(item, writer)
  if (writer.source === "FALLBACK" && !verifiedFallback) blockers.push("WRITER_FALLBACK_USED")
  if (writer.violations.length > 0 && !verifiedFallback) blockers.push("WRITER_VALIDATION_FAILED")
  if (item.analysisConflicts.length > 0) blockers.push("SOURCE_INTERPRETATION_CONFLICT")
  // Texto do sistema respeita as fronteiras de afirmação por construção (sem efeito, só o que a fala e a regra sustentam).
  if (!system && !claimModesEnforced(item.domain, writer.claimModes)) blockers.push("CLAIM_BOUNDARY_NOT_ENFORCED")
  // V1.6.0 — documento recuperado ≠ aplicável: só regra ANCORADA na conversa segue sem QA.
  if (item.knowledge && item.knowledge.applicability !== "VERIFIED") blockers.push("KNOWLEDGE_APPLICABILITY_UNVERIFIED")
  if (item.process && !item.knowledge) blockers.push("PROCESS_RULE_UNVERIFIED")
  if (item.process?.status === "FOLLOWED" && item.process.completeness && item.process.completeness.status !== "COMPLETE" && !isObservedVerifyListItem(item)) blockers.push("COMPOSITE_COMPLETENESS_UNVERIFIED")
  blockers.push(...knowledgeQualityBlockers(item))
  if ([writer.wording.observed, writer.wording.whyItMatters, writer.wording.whatYouCanDo, writer.wording.suggestedResponse ?? ""].some(hasPersonalData)) blockers.push("WORDING_PRIVACY_FLAG")
  const holds: ReliablePolicyHold[] = [
    ...(policy.holdAllForQa ? ["PILOT_HOLD_ALL_FOR_QA" as const] : []),
    ...(!policy.releasedItemKinds.includes(item.kind) ? ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY" as const] : []),
  ]
  const base = { structural: "STRUCTURALLY_EMITTABLE" as const, policyVersion: policy.version, autonomyEligible: blockers.length === 0, autonomyBlockers: blockers }
  if (holds.length > 0 || blockers.length > 0) return { ...base, disposition: "HOLD_FOR_QA", reasons: [...holds, ...blockers] }
  return { ...base, disposition: "READY", reasons: verifiedFallback ? ["AUTONOMY_CRITERIA_MET", "VERIFIED_SPECIFIC_FALLBACK"] : ["AUTONOMY_CRITERIA_MET"] }
}

// ---------------------------------------------------------------------------------------------
// ARTEFATO: disposição = itens × QA
// ---------------------------------------------------------------------------------------------

export type ArtifactDisposition = "READY" | "HOLD_FOR_QA" | "BLOCKED" | "REJECTED"
export type ItemQaStatus = "PENDING_REVIEW" | "APPROVED_UNCHANGED" | "APPROVED_EDITED" | "REJECTED" | null

/** Um item é EMITÍVEL se: READY (sem QA) ou HOLD_FOR_QA aprovado. BLOCKED e REJECTED nunca. */
export function isItemEmittable(disposition: ReliableDisposition, qa: ItemQaStatus): boolean {
  if (disposition === "BLOCKED") return false
  if (disposition === "READY") return qa !== "REJECTED" && qa !== "PENDING_REVIEW"
  return qa === "APPROVED_UNCHANGED" || qa === "APPROVED_EDITED"
}

/**
 * Regra ÚNICA da disposição do artefato:
 *   algum item retido ainda PENDING_REVIEW → HOLD_FOR_QA (o Workflow espera);
 *   senão, algum item emitível            → READY (segue com os emitíveis; bloqueados/rejeitados nunca saem);
 *   senão, algum item foi REJECTED no QA  → REJECTED;
 *   senão                                 → BLOCKED.
 */
export function artifactDispositionOf(items: readonly { disposition: ReliableDisposition; qa: ItemQaStatus }[]): ArtifactDisposition {
  if (items.some((item) => item.disposition === "HOLD_FOR_QA" && (item.qa === "PENDING_REVIEW" || item.qa === null))) return "HOLD_FOR_QA"
  if (items.some((item) => isItemEmittable(item.disposition, item.qa))) return "READY"
  if (items.some((item) => item.qa === "REJECTED")) return "REJECTED"
  return "BLOCKED"
}

export type ReliableViolation = WordingViolation | "TARGET_COMPARISON_MISMATCH" | "TREND_WITHOUT_CANONICAL_HISTORY" | "PERIOD_MISMATCH" | "UNGROUNDED_GUIDANCE" | "UNGROUNDED_RELEVANCE"
  /** V1.6.1 — relação de causa entre comportamento e indicador; grupo de referência sem evidência; rótulo "simples/complexo". */
  | "CAUSAL_CLAIM" | "PEER_CLAIM_WITHOUT_EVIDENCE" | "UNSUPPORTED_SEGMENT_LABEL"
  /** V1.7.1 — texto de um item de processo que não nomeia a etapa (genérico: serviria para qualquer chamada). */
  | "GENERIC_WORDING"
  /** V1.7.1a — exemplo de condução fora do escopo/sem fonte; número/canal que só existe num EXEMPLO da base. */
  | SuggestedResponseViolation
