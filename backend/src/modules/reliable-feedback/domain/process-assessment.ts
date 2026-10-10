import { createHash } from "node:crypto"
import { normalizeForKnowledgeMatch, normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import type { CheckpointStatus, GuidanceGrounding, RawProcessAssessment } from "../../agents/domain/process-assessment-contract.js"
import type { Ownership } from "../../investigation/domain/outcome-attribution.js"
import { projectTranscript, verifyEvidenceUnit, type ProjectedInteraction, type VerifiedEvidence } from "../../investigation/domain/transcript-projection.js"
import { decomposeClaimedEvidence } from "./monitoring-adapter.js"
import { isDeclaration, OMISSION_NOT_OBSERVABLE_FAILURES, ruleContextOf, transcriptWindowComplete, turnIndexOf, verifyOmission, type CheckpointEvidenceType, type OmissionVerification, type RuleContext } from "./verified-omission.js"
import { assessCompleteness, declaredCompletenessOf, type CheckpointCompleteness } from "./composite-checkpoint.js"
import { exampleTextsOfSegments, isMixedCitation, ruleTextOfSegments, segmentKnowledgeQuote, type KnowledgeSegment } from "./knowledge-segments.js"
import { knowledgeContentKindOf, type KnowledgeContentKind } from "./suggested-response.js"
import { APPLICABILITY_RESOLUTION_VERSION, compareStatement, productInDocument, resolveApplicabilityStatus, sameProduct, siblingDocumentTitles, summarizeStatement, mentionsProduct, type ApplicabilityCandidateRejection, type ApplicabilityResolution, type VerifiedApplicabilityCandidate } from "./applicability-resolution.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import { backfillCheckpointRule, sectionExamplesOf, selectOperativeRule, withoutExampleSpans, type OperativeRule, type RuleBackfillAudit } from "./rule-selection.js"
import { forbiddenPhrasesOf, processAnchorOf, STRUCTURED_ANCHOR_VERSION, structuredAnchorOf, type StructuredAnchor } from "./structured-anchor.js"
import { isEligibleProcessCheckpoint, type CheckpointEligibility } from "./checkpoint-eligibility.js"
import { convergeCanonicalBehaviors, type BehaviorGroup, type CheckpointCanonical } from "./behavior-convergence.js"
import { AMBIGUOUS_QUOTE_MATCHES, applyCheckpointGovernance, buildProcessCheckpointCatalog, catalogEntryOf, type CheckpointGovernanceSnapshot, type GovernedCheckpointRef, sourceQuoteMatchOf, type AssessmentRequirement, mustAssessSatisfiedBy, type ProcessRequirement, type ProcessCheckpointCatalog, type ProcessCheckpointEntry, type ProcessCheckpointKind, type SourceQuoteMatch } from "./checkpoint-catalog.js"
import { canonicalBehaviorOf, type BehaviorFacet, type CanonicalBehavior } from "./canonical-behavior.js"
import { compositeListOf } from "./composite-checkpoint.js"
import { assessEvidencePolarity, behaviorPolarityOf, type EvidencePolarityAssessment } from "./evidence-polarity.js"
import { isContractV5, type InteractionContext, PROCESS_ASSESSMENT_MODEL_CONTRACT_V5, PROCESS_ASSESSMENT_MODEL_CONTRACT_VERSION, PROCESS_ASSESSMENT_MODEL_CONTRACT_V3, type AssessmentCoverageAudit } from "../../agents/domain/process-assessment-contract.js"
import { assessConduct, prerequisiteDependencyOf, prerequisiteGateOf, prerequisiteSkipOf, semanticConductAnchorOf, type ConductAssessment, type PrerequisiteDependency, type PrerequisiteSkip } from "./evidence-conduct.js"

/**
 * V1.6.0 — PROCESS ASSESSMENT VERIFICADO (domínio puro): a monitoria PROCESS-CENTRIC.
 *
 * A unidade da análise é o PROCESSO aplicável à chamada (um documento da Base de Conhecimento) e as ETAPAS observáveis
 * dele. O Agent/especialista PROPÕE (contrato `PROCESS_ASSESSMENT_V1`); este módulo VERIFICA por código, sem LLM:
 *
 *   TRANSCRIÇÃO   cada trecho citado é decomposto por fala e conferido literalmente num turno da transcrição real pelo
 *                 verificador da investigação (falante vem da TRANSCRIÇÃO, nunca do rótulo do modelo). Regra ALL: uma
 *                 parte não verificada contamina a etapa.
 *   DONO          FOLLOWED e NOT_FOLLOWED exigem fala verificada do OPERADOR (a conduta é dele). Sem isso a etapa cai para
 *                 NOT_OBSERVABLE — ausência de evidência nunca vira "cumpriu" nem "descumpriu".
 *   BASE          o trecho da base citado precisa (1) resolver para UM documento pelo título exato entre os trechos que
 *                 ENTRARAM nesta execução, (2) existir literalmente na versão PUBLICADA atual do documento e (3) estar
 *                 dentro de um desses trechos. Documento recuperado ≠ documento aplicável: além disso a regra precisa estar
 *                 ANCORADA no que aconteceu (≥ 2 termos de conteúdo em comum entre o trecho da base e a fala verificada).
 *                 VERIFIED = literal + recuperado + ancorado · LITERAL_ONLY = literal + recuperado, sem âncora (QA decide) ·
 *                 NOT_VERIFIED = qualquer outra coisa (a etapa não pode virar feedback).
 *   ORIENTAÇÃO    OFFICIAL_PROCEDURE / OFFICIAL_SERVICE_GUIDELINE só com base ≥ LITERAL_ONLY; VERIFIED_PEER_PATTERN ainda não
 *                 é afirmação do MODELO — evidência de pares só existe calculada pelo sistema (V1.6.1, `indicator-diagnosis/domain/peer-practice-evidence.ts`) → NO_GROUNDED_GUIDANCE.
 *
 * V1.7.1 — OMISSÃO: NOT_FOLLOWED proposto como OMISSION não tem fala do operador que "ancore" a regra (a etapa não
 * aconteceu). A âncora léxica é trocada pela VERIFIED OMISSION (`verified-omission.ts`: processo aplicável, etapa obrigatória,
 * janela completa, oportunidade, nenhuma ação correspondente). Verificada ⇒ aplicabilidade VERIFIED com base VERIFIED_OMISSION;
 * falha estrutural ⇒ NOT_OBSERVABLE; falha de prova ⇒ continua LITERAL_ONLY (QA).
 *
 * Aplicabilidade é verificada ESTRUTURALMENTE (literal, apresentado, ancorado) — não semanticamente. Um trecho literal,
 * recuperado e com termos em comum ainda pode ser a regra errada para a situação: por isso LITERAL_ONLY nunca é autônomo e
 * o QA de exceção continua existindo.
 */
/** V1.7.4 — V2: a etapa é lida por estrutura (condicionalidade/precedência, `step-semantics.ts`) e a evidência precisa sustentar a
 * CONDUTA exigida (`evidence-conduct.ts`): afirmar um resultado não prova a verificação; paráfrase só com papel + relação + objeto. */
export const PROCESS_ASSESSMENT_VERIFICATION_VERSION = "PROCESS_ASSESSMENT_VERIFICATION_V2" as const

export type KnowledgeApplicability = "VERIFIED" | "LITERAL_ONLY" | "NOT_VERIFIED"
export type KnowledgeVerificationFailure = "DOCUMENT_NOT_PRESENTED" | "DOCUMENT_AMBIGUOUS" | "DOCUMENT_NOT_PUBLISHED" | "QUOTE_TOO_SHORT" | "QUOTE_NOT_LITERAL" | "QUOTE_NOT_IN_PRESENTED_EXCERPT" | "NO_QUOTE" | /** V1.7.1n — o código da etapa não existe no catálogo apresentado. */ "CHECKPOINT_REF_UNKNOWN"

/** Trecho de KB que entrou no prompt da execução que produziu a avaliação (o rastro — não o que o modelo diz). */
export type PresentedKnowledgeExcerpt = { documentId: string; documentTitle: string; heading: string; excerpt: string; /** V1.7.1d — posição do trecho no documento (ausente em rastros anteriores). */ chunkIndex?: number }
/** Versão PUBLICADA atual de um documento (lida do banco no momento da verificação). */
export type PublishedKnowledgeDocument = { documentId: string; title: string; content: string; version: number }

export type KnowledgeVerification = {
  documentId: string | null
  documentTitle: string
  heading: string | null
  version: number | null
  quote: string | null
  literalInPublished: boolean
  presentedInRun: boolean
  anchorTerms: string[]
  applicability: KnowledgeApplicability
  /** V1.7.1 — de onde veio a aplicabilidade VERIFIED: âncora léxica regra × fala, ou omissão verificada. V1.7.1f: ou a prova
   * ESTRUTURADA (etapa de lista + processo aplicável + ação/pergunta da etapa na fala verificada — `structured-anchor.ts`). */
  applicabilityBasis: "LEXICAL_ANCHOR" | "VERIFIED_OMISSION" | "STRUCTURED_ANCHOR" | /** MONITORING V2 — contrato V5: etapa identificada pelo catálogo + regra literal apresentada + conduta DECLARADA coerente. */ "DECLARED_CONDUCT" | null
  /** V1.7.1f — a prova estruturada tentada (auditoria), quando a âncora léxica não bastou numa etapa cumprida. */
  structuredAnchor?: StructuredAnchor | null
  /** V1.7.1 — frase LITERAL que abre a lista da etapa no documento ("Se o cliente não reconhecer:"), quando existe. */
  leadIn: string | null
  failure: KnowledgeVerificationFailure | null
  /** Hash do conteúdo publicado usado na verificação (auditoria: a versão pode mudar depois). */
  contentSha256: string | null
  /** V1.7.1a — o trecho é REGRA ou EXEMPLO do documento (exemplo nunca sustenta fato da chamada). Ausente = regra. */
  contentKind?: KnowledgeContentKind
  /** V1.7.1a — posição do trecho no documento publicado (ordem do procedimento; null quando não verificado). */
  documentOffset?: number | null
  /** V1.7.1d — posição (no documento) do trecho apresentado onde a citação foi encontrada (proveniência por trecho). */
  chunkIndex?: number | null
  /** V1.7.1j — SEGMENTOS do trecho citado (regra × fala-modelo × evitar), cada um com a própria posição. Ausente antes. */
  segments?: KnowledgeSegment[]
  /** V1.7.1j — o trecho como o especialista citou, quando ele misturava regra e exemplo (`quote` passa a ser só a REGRA). */
  citedQuote?: string | null
  /** V1.7.1n — como a citação do modelo se relaciona com a etapa escolhida pelo checkpointRef (nunca muda a identidade). */
  sourceQuoteMatch?: SourceQuoteMatch | null
}

/**
 * V1.7.1n — a ETAPA DE ORIGEM (identidade do sistema): o item do catálogo apresentado que o especialista escolheu pelo
 * checkpointRef, ou que o sistema completou (cobertura obrigatória). Ausente = avaliação anterior (identidade pela citação).
 */
export type CheckpointSourceRef = {
  ref: string
  kind: ProcessCheckpointKind
  documentId: string
  heading: string | null
  position: number | null
  sourceText: string
  canonicalBehavior: CanonicalBehavior | null
  facets: BehaviorFacet[]
  /** V1.7.3 — obrigatória NO PROCESSO × precisa de disposição NESTA avaliação (plano de cobertura) — duas perguntas diferentes. */
  processRequirement: ProcessRequirement
  assessmentRequirement: AssessmentRequirement
  primaryProcess: boolean
  quoteMatch: SourceQuoteMatch
  modelQuote: string | null
  /** Checkpoint Registry — definição lógica e versão ATIVA que governam a etapa (ausente fora de documento governado). */
  registry?: GovernedCheckpointRef | null
}
/** V1.7.1n — completude DETERMINÍSTICA de uma etapa obrigatória que o especialista não avaliou. */
export type RequiredCompletion = { basis: "RECAP_MOMENT_DETECTED"; turnRef: string; marker: string; resolved: boolean; failure: "COMPLETENESS_UNKNOWN" | "KNOWLEDGE_NOT_ANCHORED" | null }
export type AssessmentCoverageSummary = {
  /** Etapas obrigatórias NO PROCESSO (recapitulação composta do documento primário). */
  required: number
  assessedByModel: number
  completedDeterministically: number
  /** V1.7.3 — etapas MUST_ASSESS do plano (fora as obrigatórias no processo) e quantas tiveram disposição (própria ou do mesmo comportamento). */
  mustAssess?: number
  mustAssessCovered?: number
  /** V1.7.3 — auditoria de cobertura de cada fonte (plano × primeira resposta × reparo único), como o especialista a registrou. */
  audits?: AssessmentCoverageAudit[]
  missingUnresolved: { ref: string; heading: string | null; behavior: CanonicalBehavior | null; reason: "NO_SAFE_RECAP_MOMENT" | "COMPLETION_NOT_SUPPORTED" | "COMPLETENESS_UNKNOWN" | "KNOWLEDGE_NOT_ANCHORED" | "TRANSCRIPT_INCOMPLETE" | /** V1.7.3 — MUST_ASSESS sem disposição nem depois do reparo único. */ "MUST_ASSESS_NOT_RETURNED" }[]
}
/** Nome anterior (V1.7.1n): mesmo formato. */
export type RequiredCoverageSummary = AssessmentCoverageSummary
export type VerifiedCheckpoint = {
  /** "P1.C2" — só auditoria interna; nunca vai ao redator nem à UI. */
  ref: string
  processTitle: string
  requirement: string
  declaredStatus: CheckpointStatus
  status: CheckpointStatus
  /** V1.7.1b — APPLICABILITY_*: a etapa depende do produto e o produto não foi confirmado (NOT_OBSERVABLE), é de outro produto
   * (NOT_APPLICABLE) ou o especialista escolheu entre documentos irmãos sem declarar (NOT_OBSERVABLE). Nunca vira "não seguiu". */
  statusDowngradeReason: "EVIDENCE_NOT_VERIFIED" | "NO_OPERATOR_EVIDENCE" | "NO_EVIDENCE" | "OMISSION_NOT_OBSERVABLE" | /** V1.7.1n — etapa OBRIGATÓRIA não avaliada e não completável com segurança (análise parcial). */ "MISSING_REQUIRED_CHECKPOINT" | "APPLICABILITY_NOT_CONFIRMED" | "APPLICABILITY_OTHER_PRODUCT" | "APPLICABILITY_UNRESOLVED" | /** V1.7.1i — etapa composta cumprida só em parte (nunca ponto forte). */ "COMPOSITE_PARTIAL" | /** V1.7.1l — o trecho citado é de seção NÃO executável (objetivo, abrangência, conceitos, resultado esperado, referência, exemplos): contexto do procedimento, nunca etapa. */ "NOT_A_PROCESS_CHECKPOINT" | /** V1.7.4 — a evidência não sustenta a CONDUTA da etapa (resultado afirmado ≠ verificação; abstenção citada contra uma acusação; ausência de falha ≠ ponto forte). */ "EVIDENCE_ACTION_MISMATCH" | /** V1.7.4 — ação cumprida que se apoia num pré-requisito DESCUMPRIDO na mesma seção (premissa afirmada sem a validação exigida; ação que só vale depois de uma checagem não feita): nunca ponto forte. */ "PREREQUISITE_NOT_MET" | null
  /** V1.7.4 — conduta exigida × papel da evidência (auditoria). Ausente antes / etapa sem evidência. */
  conduct?: ConductAssessment | null
  /** V1.7.4 — prova de etapa pulada ("X antes de Y": Y feito sem X), quando a omissão proposta não se verificou. */
  prerequisite?: PrerequisiteSkip | null
  /** V1.7.4 — a etapa cumprida dependia de um pré-requisito descumprido (`PREREQUISITE_DEPENDENCY_V1`). Ausente antes. */
  dependency?: PrerequisiteDependency | null
  /** MONITORING V2 — contrato V5: a semântica veio DECLARADA pelo especialista (o caminho léxico não roda). Ausente = V4. */
  declaredSemantics?: true
  /** MONITORING V2 — pré-requisito declarado pelo especialista (código [CP-…]). */
  dependsOn?: string | null
  /** MONITORING V2 — o que aconteceu nesta etapa, no contexto da chamada (interpretação do especialista; nunca evidência). */
  summary?: string | null
  /** V1.7.1i — completude de uma etapa COMPOSTA (lista de itens que o operador diz/confere); null = etapa simples. Ausente antes. */
  completeness?: CheckpointCompleteness | null
  /** V1.7.1 — tipo da evidência (null quando a etapa não virou FOLLOWED/NOT_FOLLOWED). */
  evidenceType: CheckpointEvidenceType | null
  /** V1.7.1 — verificação da omissão (só quando o Agent propôs OMISSION). */
  omission: OmissionVerification | null
  /** V1.7.1 — trecho LITERAL do mesmo documento que diz como cumprir a etapa (verificado; null quando ausente/não verificado). */
  knowledgeDetail: { quote: string; heading: string | null; contentKind?: KnowledgeContentKind; /** V1.7.1d — proveniência PRÓPRIA do trecho de detalhe. */ documentId?: string; version?: number | null; chunkIndex?: number | null } | null
  /** V1.7.1e — REGRA OPERACIONAL da mesma seção (literal, mesmo documento/versão), quando o trecho citado era só abertura ou
   * lista do que evitar (`RULE_SELECTION_V1`). null = o citado já é a regra normativa (ou a seção não tem uma). Ausente antes. */
  operativeRule?: OperativeRule | null
  /** V1.7.1g — tentativa de BACKFILL da regra da etapa canônica em outra seção do mesmo documento (auditoria). Ausente antes. */
  ruleBackfill?: RuleBackfillAudit | null
  /** V1.7.1f — falas-modelo/EXEMPLOS literais da mesma seção (nunca fato; alimentam a proteção contra fato de exemplo). */
  sectionExamples?: string[]
  /** V1.7.1k — texto literal do ITEM DE LISTA que a citação escolheu (representação canônica), quando a citação é um item. */
  checkpointStep?: string | null
  /** V1.7.1l — o trecho citado é uma ETAPA executável (papel da seção × papel do segmento)? Ausente antes / sem base usável. */
  checkpointEligibility?: CheckpointEligibility | null
  /** V1.7.1m — comportamento canônico e papel desta fonte no grupo (PRIMARY avalia; SUPPORTING é proveniência; CONFLICTING = QA). */
  canonical?: CheckpointCanonical | null
  /** V1.7.1n — etapa de origem pelo checkpointRef (identidade do sistema). Ausente antes / contrato V2. */
  source?: CheckpointSourceRef | null
  /** V1.7.1n — MODEL = avaliada pelo especialista; SYSTEM_COMPLETION = etapa obrigatória completada deterministicamente. */
  origin?: "MODEL" | "SYSTEM_COMPLETION"
  completion?: RequiredCompletion | null
  /** V1.7.1n — polaridade da evidência para comportamentos com detector (prazo, protocolo): mencionar ≠ cumprir. */
  evidencePolarity?: EvidencePolarityAssessment | null
  transcriptEvidence: VerifiedEvidence[]
  rejectedUnits: { reason: string }[]
  ownership: Ownership
  knowledge: KnowledgeVerification | null
  guidance: { declared: GuidanceGrounding; grounding: GuidanceGrounding; text: string | null; downgradeReason: "GUIDANCE_WITHOUT_VERIFIED_KNOWLEDGE" | "PEER_EVIDENCE_NOT_SUPPORTED" | null }
  uncertainty: string | null
}

/** V1.7.1b — como a aplicabilidade do produto afetou o processo: JUDGED (avaliado normalmente), OTHER_PRODUCT, NOT_CONFIRMED, UNRESOLVED_SIBLINGS. */
export type ProcessApplicabilityMode = "JUDGED" | "OTHER_PRODUCT" | "NOT_CONFIRMED" | "UNRESOLVED_SIBLINGS"

export type VerifiedProcessAssessment = {
  version: typeof PROCESS_ASSESSMENT_VERIFICATION_VERSION
  processes: { title: string; documentId: string | null; checkpointRefs: string[]; product?: string | null; applicabilityMode?: ProcessApplicabilityMode; applicabilityRef?: string | null; siblings?: string[] }[]
  checkpoints: VerifiedCheckpoint[]
  /** V1.7.1b — resoluções de aplicabilidade verificadas (ausente em avaliações anteriores). */
  applicability?: ApplicabilityResolution[]
  /** V1.7.1m — fontes do mesmo comportamento canônico convergidas (ausente em avaliações anteriores). */
  behaviors?: BehaviorGroup[]
  /** V1.7.1n — cobertura obrigatória (catálogo): avaliadas pelo especialista, completadas pelo sistema e ainda faltando. */
  coverage?: AssessmentCoverageSummary
  /** MONITORING V2 — contexto da chamada declarado pelo especialista (contrato V5): motivo, situação, caminho. Interpretação, nunca evidência. */
  interaction?: InteractionContext | null
  summary: Record<CheckpointStatus, number> & { statusDowngrades: number; knowledgeVerified: number; knowledgeLiteralOnly: number; knowledgeNotVerified: number; verifiedOmissions: number; unverifiedOmissions: number; applicabilityDowngrades?: number; contractInvalidItems?: number; /** V1.7.1i */ compositeComplete?: number; compositePartial?: number; compositeUnknown?: number; /** V1.7.1l — citações de seção não executável (contexto, nunca etapa). */ notCheckpointEligible?: number; /** V1.7.1m — fontes que só reforçam um comportamento já avaliado por outra. */ behaviorSupportingSources?: number; behaviorConflicts?: number }
}

/** Uma avaliação proposta por UMA fonte (o Agent, ou um especialista do Orquestrador) + os trechos que ELA viu. */
/** `governance` (Checkpoint Registry): o recorte aplicado no prompt desta fonte — a verificação usa exatamente o mesmo. */
export type ProcessAssessmentSource = { sourceRef: string; assessment: RawProcessAssessment; presented: PresentedKnowledgeExcerpt[]; governance?: CheckpointGovernanceSnapshot | null }

const INTERACTION_REF = "I1"
const MIN_QUOTE_CHARS = 12
const MIN_ANCHOR_TERMS = 2

/** Normalização para comparação LITERAL (fonte única em knowledge/domain/knowledge-match.ts). */
export { normalizeForKnowledgeMatch }

const STOPWORDS = new Set(["para", "pelo", "pela", "pelos", "pelas", "como", "quando", "sobre", "entre", "após", "antes", "depois", "também", "ainda", "mesmo", "mesma", "esse", "essa", "este", "esta", "isso", "isto", "aquele", "aquela", "você", "voce", "cliente", "operador", "deve", "devem", "pode", "podem", "será", "serão", "está", "estão", "foram", "sendo", "caso", "casos", "qual", "quais", "cada", "todo", "toda", "todos", "todas", "mais", "menos", "muito", "sempre", "nunca", "apenas", "somente", "então", "porque", "assim", "onde", "seus", "suas", "dele", "dela", "nosso", "nossa"])
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
/** Termos de conteúdo (≥ 4 letras, sem acento, radical de 5) — âncora lexical conservadora, nunca semântica. */
export function contentTerms(text: string): Set<string> {
  const terms = new Set<string>()
  for (const word of fold(text).match(/\p{L}{4,}/gu) ?? []) if (!STOPWORDS.has(word)) terms.add(word.slice(0, 5))
  return terms
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

export function verifyKnowledgeQuote(input: {
  documentTitle: string
  quote: string | null
  presented: readonly PresentedKnowledgeExcerpt[]
  published: ReadonlyMap<string, PublishedKnowledgeDocument>
  anchorTexts: readonly string[]
  /** V1.7.1n — etapa de origem do catálogo: documento, trecho apresentado e tipo vêm DELA (nunca da citação do modelo). */
  source?: Pick<ProcessCheckpointEntry, "documentId" | "chunkIndex" | "heading" | "segmentRole"> | null
}): KnowledgeVerification {
  const base: KnowledgeVerification = { documentId: null, documentTitle: input.documentTitle, heading: null, version: null, quote: input.quote, literalInPublished: false, presentedInRun: false, anchorTerms: [], applicability: "NOT_VERIFIED", applicabilityBasis: null, leadIn: null, failure: null, contentSha256: null }
  if (!input.quote) return { ...base, failure: "NO_QUOTE" }
  // V1.7.1f — literal pela normalização ESTRUTURAL (lista com ou sem marcadores/numeração); título continua exato.
  const quote = normalizeForLiteralQuote(input.quote)
  if (quote.length < MIN_QUOTE_CHARS) return { ...base, failure: "QUOTE_TOO_SHORT" }
  const title = normalizeForKnowledgeMatch(input.documentTitle)
  const documentIds = input.source ? (input.presented.some((excerpt) => excerpt.documentId === input.source!.documentId) ? [input.source.documentId] : []) : [...new Set(input.presented.filter((excerpt) => normalizeForKnowledgeMatch(excerpt.documentTitle) === title).map((excerpt) => excerpt.documentId))]
  if (documentIds.length === 0) return { ...base, failure: "DOCUMENT_NOT_PRESENTED" }
  if (documentIds.length > 1) return { ...base, failure: "DOCUMENT_AMBIGUOUS" }
  const documentId = documentIds[0]!
  const published = input.published.get(documentId)
  if (!published) return { ...base, documentId, failure: "DOCUMENT_NOT_PUBLISHED" }
  const withDoc = { ...base, documentId, documentTitle: published.title, version: published.version, contentSha256: sha(published.content) }
  const publishedNormalized = normalizeForLiteralQuote(published.content)
  if (!publishedNormalized.includes(quote)) return { ...withDoc, failure: "QUOTE_NOT_LITERAL" }
  const sameSource = (entry: PresentedKnowledgeExcerpt) => !input.source || ((input.source.chunkIndex === null || entry.chunkIndex === undefined || entry.chunkIndex === input.source.chunkIndex) && normalizeForKnowledgeMatch(entry.heading ?? "") === normalizeForKnowledgeMatch(input.source.heading ?? ""))
  const excerpt = input.presented.find((entry) => entry.documentId === documentId && sameSource(entry) && normalizeForLiteralQuote(entry.excerpt).includes(quote)) ?? null
  if (!excerpt) return { ...withDoc, literalInPublished: true, failure: "QUOTE_NOT_IN_PRESENTED_EXCERPT" }
  // V1.7.1j — trecho MISTO (regra + fala-modelo): só a parte normativa vale como regra, inclusive para a âncora. A fala-modelo
  // continua registrada nos segmentos (exemplo rotulado, nunca base de fato).
  const segments = segmentKnowledgeQuote(published.content, input.quote)
  const mixed = isMixedCitation(segments)
  const ruleQuote = mixed ? ruleTextOfSegments(segments) : input.quote
  const quoteTerms = contentTerms(ruleQuote)
  const observed = new Set(input.anchorTexts.flatMap((text) => [...contentTerms(text)]))
  const anchorTerms = [...quoteTerms].filter((term) => observed.has(term)).sort()
  // V1.7.1n — com a etapa de origem, o tipo é o dela (pergunta prescrita por "Perguntar:" é REGRA mesmo citada sem a abertura).
  const contentKind = input.source ? (input.source.segmentRole === "AVOID" ? "DO_NOT_CONTENT" : "RULE_CONTENT") : knowledgeContentKindOf(published.content, ruleQuote)
  // V1.7.1k — conteúdo "EVITAR": termos em comum não provam que a formulação proibida foi dita ("Não posso fazer nada" ×
  // "posso fazer isso"); só a âncora própria de AVOID (a formulação dentro da fala) verifica.
  const anchored = anchorTerms.length >= MIN_ANCHOR_TERMS && contentKind !== "DO_NOT_CONTENT"
  const ruleOffset = publishedNormalized.indexOf(normalizeForLiteralQuote(ruleQuote))
  return { ...withDoc, quote: ruleQuote, ...(mixed ? { citedQuote: input.quote } : {}), segments, heading: excerpt.heading, leadIn: ruleContextOf(published.content, ruleQuote, excerpt.heading)?.leadIn ?? null, literalInPublished: true, presentedInRun: true, anchorTerms, applicability: anchored ? "VERIFIED" : "LITERAL_ONLY", applicabilityBasis: anchored ? "LEXICAL_ANCHOR" : null, contentKind, documentOffset: ruleOffset >= 0 ? ruleOffset : publishedNormalized.indexOf(quote), chunkIndex: excerpt.chunkIndex ?? null }
}

/**
 * MONITORING V2 — APLICABILIDADE com semântica declarada (contrato V5). A regra já é LITERAL, publicada e apresentada nesta chamada
 * (`verifyKnowledgeQuote`), a etapa é a do CATÁLOGO (identidade do sistema) e a conduta declarada é coerente (`assessConduct`
 * DECLARED): isso basta — nenhuma contagem de termos em comum. "O que evitar" continua exigindo a formulação proibida DENTRO da fala.
 */
function declaredApplicabilityOf(input: { knowledge: KnowledgeVerification; entry: ProcessCheckpointEntry | null; status: CheckpointStatus; conduct: ConductAssessment | null; stepText: string; operatorEvidence: readonly { turnRef: string; text: string }[] }): KnowledgeVerification {
  const { knowledge } = input
  if (!input.entry || knowledge.failure || input.conduct?.verdict === "MISMATCH") return knowledge
  if (knowledge.contentKind === "DO_NOT_CONTENT") {
    const said = input.operatorEvidence.map((unit) => normalizeForLiteralQuote(unit.text))
    const found = input.status === "NOT_FOLLOWED" && forbiddenPhrasesOf(input.stepText).some((phrase) => said.some((text) => text.includes(normalizeForLiteralQuote(phrase))))
    return found ? { ...knowledge, applicability: "VERIFIED", applicabilityBasis: "DECLARED_CONDUCT" } : knowledge
  }
  return { ...knowledge, applicability: "VERIFIED", applicabilityBasis: "DECLARED_CONDUCT" }
}

function ownershipOf(verified: readonly VerifiedEvidence[]): Ownership {
  if (verified.some((unit) => unit.speaker === "OPERADOR")) return "AGENT"
  if (verified.some((unit) => unit.speaker === "CLIENTE")) return "CUSTOMER"
  if (verified.some((unit) => unit.speaker === "EVENTO")) return "INTERACTION"
  return "UNKNOWN"
}

const EVIDENCED: readonly CheckpointStatus[] = ["FOLLOWED", "NOT_FOLLOWED"]
/** V1.7.4 — falhas ESTRUTURAIS da omissão que ainda admitem a prova de etapa pulada (nunca a contraprova MATCHING_ACTION_FOUND). */
const PREREQUISITE_ELIGIBLE_FAILURES: readonly string[] = ["NO_OPPORTUNITY", "PROCESS_APPLICABILITY_UNVERIFIED", "CHECKPOINT_CONDITIONAL", "ABSENCE_UNVERIFIABLE"]

/**
 * Verifica TODAS as avaliações propostas (Agent direto = uma fonte; Orquestrador = uma por especialista, cada uma contra os
 * trechos que ELA viu) contra a transcrição real e as versões publicadas. Pura e determinística.
 * `subject` = assunto ESTRUTURADO da interação (motivo), um dos sinais de aplicabilidade do processo na omissão.
 */
export function verifyProcessAssessments(input: { sources: readonly ProcessAssessmentSource[]; interactionId: string; transcript: string; published: ReadonlyMap<string, PublishedKnowledgeDocument>; subject?: string | null; /** V1.7.1n — monitoria por Flag: o plano de cobertura desta avaliação esteve ativo (etapas obrigatórias no processo + MUST_ASSESS). */ coveragePlan?: boolean }): VerifiedProcessAssessment {
  const projection = projectTranscript(input.transcript)
  const interactions = new Map<string, ProjectedInteraction>([[INTERACTION_REF, { interactionRef: INTERACTION_REF, interactionId: input.interactionId, projection }]])
  const conversation = projection.turns.filter((turn) => turn.speaker === "OPERADOR" || turn.speaker === "CLIENTE").map((turn) => turn.text)
  const operatorConversation = projection.turns.filter((turn) => turn.speaker === "OPERADOR").map((turn) => turn.text)
  const processes: VerifiedProcessAssessment["processes"] = []
  const checkpoints: VerifiedCheckpoint[] = []
  const resolutions: ApplicabilityResolution[] = []
  const windowComplete = transcriptWindowComplete(projection)
  const operatorTurnUnits = projection.turns.filter((turn) => turn.speaker === "OPERADOR").map((turn) => ({ turnRef: turn.handle, text: turn.text }))
  // V1.7.1o — conversa em ordem (contexto de anáfora nas perguntas do operador: "alguma delas").
  const conversationTurns = projection.turns.filter((turn) => turn.speaker === "OPERADOR" || turn.speaker === "CLIENTE").map((turn) => ({ turnRef: turn.handle, text: turn.text }))
  const coverage: AssessmentCoverageSummary = { required: 0, assessedByModel: 0, completedDeterministically: 0, missingUnresolved: [] }
  let catalogUsed = false
  input.sources.forEach((source) => {
    // V1.7.1n — CONTRATO V3: a etapa é identificada pelo checkpointRef do catálogo apresentado (recalculado aqui dos MESMOS trechos,
    // pela MESMA função do prompt). Avaliação anterior (V2, sem código) continua pela citação.
    const usesRefs = source.assessment.validation?.contractVersion === PROCESS_ASSESSMENT_MODEL_CONTRACT_VERSION || source.assessment.validation?.contractVersion === PROCESS_ASSESSMENT_MODEL_CONTRACT_V5 || source.assessment.validation?.contractVersion === PROCESS_ASSESSMENT_MODEL_CONTRACT_V3 || source.assessment.processes.some((process) => process.checkpoints.some((checkpoint) => Boolean(checkpoint.checkpointRef)))
    // Checkpoint Registry: documento governado = só as etapas ATIVAS no recorte do prompt (o mesmo `applyCheckpointGovernance`).
    const catalog: ProcessCheckpointCatalog | null = usesRefs ? applyCheckpointGovernance(buildProcessCheckpointCatalog({ excerpts: source.presented, contentOf: (id) => input.published.get(id)?.content, subject: input.subject ?? null, coveragePlan: Boolean(input.coveragePlan) && windowComplete }), source.governance) : null
    if (catalog) catalogUsed = true
    // MONITORING V2 — contrato V5: a semântica (papel da fala, pré-requisito, itens cobertos) vem DECLARADA; o caminho léxico não roda.
    const v5 = isContractV5(source.assessment.validation) && catalog !== null
    // COBERTURA OBRIGATÓRIA: etapa REQUIRED que o especialista não avaliou → completude determinística SÓ quando segura; senão fica
    // registrada como faltando (análise parcial → QA), nunca "não observável" em silêncio.
    const sourceProcesses = source.assessment.processes.map((process) => ({ ...process, checkpoints: [...process.checkpoints] }))
    const assessedRefs = new Set(sourceProcesses.flatMap((process) => process.checkpoints.flatMap((checkpoint) => (checkpoint.checkpointRef ? [checkpoint.checkpointRef] : []))))
    const completions = new Map<object, RequiredCompletion>()
    let missingUnresolved = false
    for (const entry of (catalog?.entries ?? []).filter((candidate) => candidate.processRequirement === "REQUIRED")) {
      coverage.required += 1
      if (assessedRefs.has(entry.ref)) { coverage.assessedByModel += 1; continue }
      const attempt = requiredCompletionOf(entry, projection, windowComplete)
      if (!attempt.ok) { missingUnresolved = true; coverage.missingUnresolved.push({ ref: entry.ref, heading: entry.heading, behavior: entry.canonicalBehavior, reason: attempt.reason }); continue }
      const raw: RawProcessAssessment["processes"][number]["checkpoints"][number] = { checkpointRef: entry.ref, requirement: entry.stepText, status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [attempt.quote], knowledgeQuote: null, knowledgeDetailQuote: null, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null }
      const target = sourceProcesses.find((process) => normalizeForKnowledgeMatch(process.documentTitle) === normalizeForKnowledgeMatch(entry.documentTitle))
      if (target) target.checkpoints.push(raw)
      else sourceProcesses.push({ documentTitle: entry.documentTitle, product: null, checkpoints: [raw] })
      completions.set(raw, { basis: "RECAP_MOMENT_DETECTED", turnRef: attempt.turnRef, marker: attempt.marker, resolved: false, failure: null })
    }
    // V1.7.3 — COBERTURA DA AVALIAÇÃO: as etapas MUST_ASSESS que o PLANO do prompt escolheu (persistido na auditoria de cobertura do
    // especialista) precisam ter disposição — a dela ou a de outra etapa do mesmo comportamento. A lista é conferida aqui de novo,
    // contra o que a avaliação (já com o reparo único) de fato traz; o que faltar deixa a análise PARCIAL (QA), nunca vira conclusão.
    // Só com o plano ativo TAMBÉM aqui (a chamada chegou ao fim pela transcrição): os dois lados usam a mesma regra de fechamento.
    const planned = catalog?.coveragePlan ? source.assessment.validation?.assessmentCoverage?.mustAssessRefs ?? [] : []
    if (source.assessment.validation?.assessmentCoverage) coverage.audits = [...(coverage.audits ?? []), source.assessment.validation.assessmentCoverage]
    for (const ref of planned) {
      const entry = catalogEntryOf(catalog, ref)
      if (!entry || entry.processRequirement === "REQUIRED") continue
      coverage.mustAssess = (coverage.mustAssess ?? 0) + 1
      if (mustAssessSatisfiedBy({ ...entry, assessmentBasis: "PRIMARY_PROCESS_BEHAVIOR" }, assessedRefs, catalog!)) { coverage.mustAssessCovered = (coverage.mustAssessCovered ?? 0) + 1; continue }
      missingUnresolved = true
      coverage.missingUnresolved.push({ ref: entry.ref, heading: entry.heading, behavior: entry.canonicalBehavior, reason: "MUST_ASSESS_NOT_RETURNED" })
    }
    const sourceResolutions = (source.assessment.applicability ?? []).map((raw) => {
      const resolution = verifyApplicability({ raw, ref: `A${resolutions.length + 1}`, presented: source.presented, published: input.published, interactions, projection, subject: input.subject ?? null })
      resolutions.push(resolution)
      return resolution
    })
    const presentedTitles = source.presented.map((excerpt) => excerpt.documentTitle)
    // Análise parcial = etapas fora do contrato OU etapa obrigatória que nem a completude determinística cobre.
    const declaredMissing = (source.assessment.validation?.missingMustAssess?.length ?? 0) + (source.assessment.validation?.missingRequired?.length ?? 0)
    const partial = (source.assessment.validation?.invalidItems?.length ?? 0) > 0 || missingUnresolved || (source.assessment.validation?.completeness === "PARTIAL" && declaredMissing === 0)
    sourceProcesses.forEach((process) => {
      // V1.7.1b — o processo depende do produto? Qual resolução o cobre e o que ela permite.
      const product = process.product ?? null
      const covering = product ? sourceResolutions.find((resolution) => resolution.candidates.some((candidate) => sameProduct(candidate.product, product)) || sameProduct(resolution.resolvedProduct, product)) ?? null : null
      const siblings = siblingDocumentTitles(process.documentTitle, presentedTitles)
      const applicabilityMode: ProcessApplicabilityMode = covering
        ? (covering.status === "CONFIRMED" ? (sameProduct(covering.resolvedProduct, product) ? "JUDGED" : "OTHER_PRODUCT") : "NOT_CONFIRMED")
        : siblings.length > 0
          // Irmãos sem aplicabilidade declarada: só o dado do sistema (assunto) que nomeia o produto do processo resolve.
          ? (product && input.subject && mentionsProduct(input.subject, product) ? "JUDGED" : "UNRESOLVED_SIBLINGS")
          : "JUDGED"
      const processRef = `P${processes.length + 1}`
      const refs: string[] = []
      let processDocumentId: string | null = null
      // 1ª passada: evidência da conversa + regra da base de cada etapa (como sempre).
      const firstPass = process.checkpoints.map((raw, index) => {
        const ref = `${processRef}.C${index + 1}`
        refs.push(ref)
        const units = raw.transcriptEvidence.flatMap((quote) => { const decomposed = decomposeClaimedEvidence(quote); return decomposed.length > 0 ? decomposed : [{ speaker: null, text: quote }] })
        const verified: VerifiedEvidence[] = []
        const rejected: { reason: string }[] = []
        for (const unit of units) {
          const verdict = verifyEvidenceUnit({ interactionRef: INTERACTION_REF, speaker: unit.speaker, quote: unit.text }, interactions)
          if (verdict.ok) verified.push(verdict.evidence)
          else rejected.push({ reason: verdict.reason })
        }
        const ownership = ownershipOf(verified)
        let status: CheckpointStatus = raw.status
        let statusDowngradeReason: VerifiedCheckpoint["statusDowngradeReason"] = null as VerifiedCheckpoint["statusDowngradeReason"]
        if (EVIDENCED.includes(raw.status)) {
          if (units.length === 0) statusDowngradeReason = "NO_EVIDENCE"
          else if (rejected.length > 0) statusDowngradeReason = "EVIDENCE_NOT_VERIFIED"
          else if (ownership !== "AGENT") statusDowngradeReason = "NO_OPERATOR_EVIDENCE"
          if (statusDowngradeReason) status = "NOT_OBSERVABLE"
        }
        // V1.7.1n — com checkpointRef, o trecho verificado é o LITERAL da etapa no catálogo (documento, seção e item do sistema); a
        // citação do modelo só é comparada (nunca muda a identidade): ampla demais / com marcador faltando não importa; outra etapa = QA.
        const entry = catalog && raw.checkpointRef ? catalogEntryOf(catalog, raw.checkpointRef) : null
        const unknownRef = Boolean(catalog && raw.checkpointRef && !entry)
        const sectionText = entry ? source.presented.find((excerpt) => excerpt.documentId === entry.documentId && (entry.chunkIndex === null || excerpt.chunkIndex === undefined || excerpt.chunkIndex === entry.chunkIndex) && normalizeForKnowledgeMatch(excerpt.heading ?? "") === normalizeForKnowledgeMatch(entry.heading ?? ""))?.excerpt ?? null : null
        const quoteMatch: SourceQuoteMatch | null = entry ? sourceQuoteMatchOf(entry, raw.knowledgeQuote, catalog!.entries, sectionText) : null
        const knowledgeQuote = entry ? entry.sourceText : raw.knowledgeQuote
        const knowledgeTitle = entry ? entry.documentTitle : process.documentTitle
        const verifiedQuote = unknownRef
          ? { documentId: null, documentTitle: process.documentTitle, heading: null, version: null, quote: raw.knowledgeQuote, literalInPublished: false, presentedInRun: false, anchorTerms: [], applicability: "NOT_VERIFIED" as const, applicabilityBasis: null, leadIn: null, failure: "CHECKPOINT_REF_UNKNOWN" as const, contentSha256: null }
          : knowledgeQuote || EVIDENCED.includes(status)
            ? verifyKnowledgeQuote({ documentTitle: knowledgeTitle, quote: knowledgeQuote, presented: source.presented, published: input.published, anchorTexts: verified.map((unit) => unit.quote), source: entry })
            : null
        const knowledge = verifiedQuote && entry ? { ...verifiedQuote, sourceQuoteMatch: quoteMatch, ...(raw.knowledgeQuote && quoteMatch !== "EXACT" ? { citedQuote: raw.knowledgeQuote } : {}) } : verifiedQuote
        if (knowledge?.documentId) processDocumentId = processDocumentId ?? knowledge.documentId
        const content = knowledge?.documentId ? input.published.get(knowledge.documentId)?.content ?? null : null
        const rule: RuleContext | null = content && knowledge?.quote && knowledge.applicability !== "NOT_VERIFIED" ? ruleContextOf(content, knowledge.quote, knowledge.heading) : null
        // V1.7.1l — ELEGIBILIDADE DE ETAPA: trecho de seção não executável (objetivo, abrangência, conceitos, resultado esperado,
        // referência, exemplos) é contexto do procedimento — nunca etapa cumprida/descumprida, nunca observação analítica.
        const eligibility = knowledge && knowledge.applicability !== "NOT_VERIFIED" && knowledge.documentId && EVIDENCED.includes(status)
          ? isEligibleProcessCheckpoint({ content, heading: knowledge.heading, documentTitle: knowledge.documentTitle, documentId: knowledge.documentId, version: knowledge.version, contentKind: knowledge.contentKind, listKind: rule?.listKind ?? null })
          : null
        if (eligibility && !eligibility.eligible) { status = "NOT_APPLICABLE"; statusDowngradeReason = "NOT_A_PROCESS_CHECKPOINT" }
        // V1.7.4 — CONDUTA: a evidência precisa sustentar o VERBO da etapa (mesmo rigor para cumprida e não cumprida).
        const stepText = entry?.stepText ?? (rule && rule.listKind !== "NONE" && rule.stepPosition !== null ? rule.stepText : null) ?? knowledge?.quote ?? raw.requirement
        const conductEvidence = verified.filter((unit) => unit.speaker === "OPERADOR").map((unit) => ({ turnRef: unit.turnRef, text: unit.quote }))
        const conduct = EVIDENCED.includes(status) ? assessConduct({ stepText, status, evidenceType: raw.evidenceType ?? null, evidence: conductEvidence, operatorTurns: operatorTurnUnits, declared: raw.conductEvidence ?? null, mode: v5 ? "DECLARED" : "LEXICAL" }) : null
        if (conduct?.verdict === "MISMATCH") { status = "NOT_OBSERVABLE"; statusDowngradeReason = "EVIDENCE_ACTION_MISMATCH" }
        // V1.7.1n — COMPORTAMENTO: do catálogo (checkpointRef → etapa → comportamento), nunca da citação; sem código (V2), da regra.
        const knowledgeUsable = Boolean(knowledge && knowledge.applicability !== "NOT_VERIFIED" && knowledge.quote)
        const behavior: CanonicalBehavior | null = entry
          ? entry.canonicalBehavior
          : knowledgeUsable ? canonicalBehaviorOf({ step: rule && rule.listKind !== "NONE" && rule.stepPosition !== null ? rule.stepText : null, quote: knowledge!.quote, heading: knowledge!.heading, documentTitle: knowledge!.documentTitle, contentKind: knowledge!.contentKind ?? null, composite: compositeListOf(knowledge!.quote) !== null })?.behavior ?? null : null
        const operatorEvidence = verified.filter((unit) => unit.speaker === "OPERADOR").map((unit) => ({ turnRef: unit.turnRef, text: unit.quote }))
        // V1.7.1n — POLARIDADE (prazo, protocolo): mencionar ≠ cumprir; "não sei te dizer um prazo" é evidência de NÃO cumprimento.
        const polarity = !v5 && EVIDENCED.includes(status) && raw.evidenceType !== "OMISSION" ? assessEvidencePolarity({ behavior, status, evidence: operatorEvidence, operatorTurns: operatorTurnUnits }) : null
        // V1.7.1f — âncora léxica insuficiente numa etapa CUMPRIDA: a prova estruturada (nunca a palavra do modelo).
        // V1.7.1g — também na etapa NÃO cumprida com ação observada (a omissão segue o caminho próprio, mais forte).
        // MONITORING V2 — no V5 a contagem de termos em comum não decide nada: a aplicabilidade é a da conduta declarada.
        const knowledgeForAnchor = v5 && knowledge?.applicabilityBasis === "LEXICAL_ANCHOR" ? { ...knowledge, applicability: "LITERAL_ONLY" as const, applicabilityBasis: null } : knowledge
        const anchored = knowledgeForAnchor && knowledgeForAnchor.applicability === "LITERAL_ONLY" && (status === "FOLLOWED" || (status === "NOT_FOLLOWED" && raw.evidenceType !== "OMISSION"))
          ? v5
            ? declaredApplicabilityOf({ knowledge: knowledgeForAnchor, entry, status, conduct, stepText, operatorEvidence })
            : (() => {
              const knowledge = knowledgeForAnchor!
              const structured = structuredAnchorOf({ status, declaredEvidenceType: raw.evidenceType ?? null, contentKind: knowledge.contentKind, rule, citedQuote: knowledge.quote, documentTitle: knowledge.documentTitle, subject: input.subject ?? null, operatorEvidence, conversation, operatorConversation, polarity, turns: conversationTurns })
              return structured.anchored ? { ...knowledge, applicability: "VERIFIED" as const, applicabilityBasis: "STRUCTURED_ANCHOR" as const, structuredAnchor: structured } : { ...knowledge, structuredAnchor: structured }
            })()
          : knowledgeForAnchor
        // Evidência que contradiz a conclusão (cumprida sem fala que cumpra; não cumprida com cumprimento na fala) ou citação de OUTRA
        // etapa para o código escolhido: a escolha não se sustenta sozinha → só literal (QA), nunca verificada em silêncio.
        // V1.7.4 — PARÁFRASE: poucas palavras em comum não bastam para recusar nem para aceitar; aceita só com conduta sustentada,
        // relação EQUIVALENT declarada pelo especialista e ao menos um termo/classe de objeto da regra (`semanticConductAnchorOf`).
        const semantic = !v5 && anchored && anchored.applicability === "LITERAL_ONLY" && conduct && (status === "FOLLOWED" || (status === "NOT_FOLLOWED" && raw.evidenceType !== "OMISSION")) ? semanticConductAnchorOf({ conduct, stepText, evidence: operatorEvidence }) : null
        const withSemantic = semantic?.anchored && anchored
          ? { ...anchored, applicability: "VERIFIED" as const, applicabilityBasis: "STRUCTURED_ANCHOR" as const, structuredAnchor: { version: STRUCTURED_ANCHOR_VERSION, anchored: true, basis: "SEMANTIC_CONDUCT" as const, failure: null, checkpoint: anchored.structuredAnchor?.checkpoint ?? null, proof: { ...(anchored.structuredAnchor?.proof ?? { processAnchor: null, actionStem: null, situationTerms: [], itemTerms: [], otherStepStems: [], stepTermsInSpeech: [] }), operatorTurns: operatorEvidence.map((unit) => unit.turnRef), itemTerms: [...semantic.sharedTerms, ...semantic.objectClasses] } } }
          : anchored
        const verifiedKnowledge = withSemantic && withSemantic.applicability === "VERIFIED" && (polarity?.conflict || (quoteMatch !== null && AMBIGUOUS_QUOTE_MATCHES.includes(quoteMatch))) ? { ...withSemantic, applicability: "LITERAL_ONLY" as const, applicabilityBasis: null } : withSemantic
        return { raw, ref, verified, rejected, ownership, status, statusDowngradeReason, knowledge: verifiedKnowledge, rule, eligibility, entry, behavior, polarity, quoteMatch, conduct, stepText }
      })
      // V1.7.1g — a MESMA etapa canônica escolhida com status opostos no mesmo processo: a escolha é ambígua; nenhuma das duas
      // fica verificada só pela estrutura (volta a só literal → QA).
      const identities = new Map<string, Set<CheckpointStatus>>()
      for (const entry of firstPass) { const identity = entry.knowledge?.structuredAnchor?.checkpoint?.identity; if (identity) identities.set(identity, new Set([...(identities.get(identity) ?? []), entry.status])) }
      firstPass.forEach((entry) => {
        const anchor = entry.knowledge?.structuredAnchor
        if (!entry.knowledge || !anchor?.anchored || !anchor.checkpoint) return
        const statuses = identities.get(anchor.checkpoint.identity)!
        if (statuses.has("FOLLOWED") && statuses.has("NOT_FOLLOWED")) entry.knowledge = { ...entry.knowledge, applicability: "LITERAL_ONLY", applicabilityBasis: null, structuredAnchor: { ...anchor, anchored: false, basis: null, failure: "CHECKPOINT_CONFLICT" } }
      })
      // 2ª passada: omissão proposta → verificação (as outras etapas do MESMO processo são o contexto).
      firstPass.forEach((entry, index) => {
        const { raw } = entry
        let status: CheckpointStatus = entry.status
        let statusDowngradeReason: VerifiedCheckpoint["statusDowngradeReason"] = entry.statusDowngradeReason
        let knowledge: KnowledgeVerification | null = entry.knowledge
        let omission: OmissionVerification | null = null
        let prerequisite: PrerequisiteSkip | null = null
        if (raw.status === "NOT_FOLLOWED" && raw.evidenceType === "OMISSION" && status === "NOT_FOLLOWED") {
          const siblings = firstPass.filter((_, position) => position !== index).map((other) => ({
            status: other.status,
            knowledgeApplicability: other.knowledge?.applicability ?? null,
            operatorTurns: other.verified.filter((unit) => unit.speaker === "OPERADOR").map((unit) => turnIndexOf(unit.turnRef)),
            stepPosition: other.rule?.stepPosition ?? null,
            sameList: Boolean(other.rule && entry.rule && other.rule.heading === entry.rule.heading && other.rule.leadIn === entry.rule.leadIn && other.rule.listKind === entry.rule.listKind),
            requirement: other.raw.requirement,
          }))
          // V1.7.1n — contraprova da omissão por POLARIDADE quando o comportamento tem detector (só fala que CUMPRE contradiz).
          const behaviorOfEntry = entry.behavior
          const fulfilled = behaviorPolarityOf(behaviorOfEntry, "") ? (text: string) => behaviorPolarityOf(behaviorOfEntry, text)?.polarity === "FULFILLED" : undefined
          omission = verifyOmission({ knowledgeUsable: knowledge !== null && knowledge.applicability !== "NOT_VERIFIED", rule: entry.rule, detailQuote: raw.knowledgeDetailQuote, requirement: raw.requirement, documentTitle: knowledge?.documentTitle ?? process.documentTitle, subject: input.subject ?? null, projection, siblings, ...(fulfilled ? { fulfilled } : {}) })
          if (partial && omission.verified) omission = { ...omission, verified: false, failure: "ASSESSMENT_PARTIAL" }
          // V1.7.4 — ETAPA PULADA: a omissão não se verifica por falta de marco do processo (sem etapa irmã cumprida) ou de
          // aplicabilidade, mas a fala citada É a ação seguinte feita sem a obrigatória antes → conduta observada, não omissão.
          // MONITORING V2 — mantida também no V5: sem ela a omissão proposta de "X antes de Y" se perde e o gap principal some (replay
          // das chamadas 6 e 8 da Golden Demo). Nunca cria ponto forte: só converte omissão não verificável em desvio observado.
          if (!omission.verified && !partial && knowledge && knowledge.applicability !== "NOT_VERIFIED" && omission.failure && PREREQUISITE_ELIGIBLE_FAILURES.includes(omission.failure)) {
            const skip = prerequisiteSkipOf({ stepText: entry.stepText, evidence: entry.verified.filter((unit) => unit.speaker === "OPERADOR").map((unit) => ({ turnRef: unit.turnRef, text: unit.quote })), operatorTurns: operatorTurnUnits, contextTexts: [entry.rule?.heading, entry.rule?.leadIn, knowledge.heading, knowledge.leadIn, knowledge.documentTitle] })
            prerequisite = skip
            if (skip.proven) {
              omission = null
              knowledge = { ...knowledge, applicability: "VERIFIED", applicabilityBasis: "STRUCTURED_ANCHOR", structuredAnchor: { version: STRUCTURED_ANCHOR_VERSION, anchored: true, basis: "PREREQUISITE_SKIPPED", failure: null, checkpoint: knowledge.structuredAnchor?.checkpoint ?? null, proof: { processAnchor: null, actionStem: null, operatorTurns: skip.successorTurns, situationTerms: [], itemTerms: [], otherStepStems: [], stepTermsInSpeech: [] } } }
            }
          }
          if (omission?.verified && knowledge) knowledge = { ...knowledge, applicability: "VERIFIED", applicabilityBasis: "VERIFIED_OMISSION" }
          else if (omission && knowledge && knowledge.applicabilityBasis === "LEXICAL_ANCHOR") knowledge = { ...knowledge, applicability: "LITERAL_ONLY", applicabilityBasis: null }
          if (omission && omission.failure && OMISSION_NOT_OBSERVABLE_FAILURES.includes(omission.failure)) {
            status = "NOT_OBSERVABLE"
            statusDowngradeReason = "OMISSION_NOT_OBSERVABLE"
          }
        }
        const detail = raw.knowledgeDetailQuote && knowledge?.documentId && knowledge.applicability !== "NOT_VERIFIED"
          ? verifyKnowledgeQuote({ documentTitle: process.documentTitle, quote: raw.knowledgeDetailQuote, presented: source.presented, published: input.published, anchorTexts: [] })
          : null
        const knowledgeDetail = detail && detail.documentId === knowledge?.documentId && detail.presentedInRun && detail.quote ? { quote: detail.quote.trim(), heading: detail.heading, contentKind: detail.contentKind ?? "RULE_CONTENT", documentId: detail.documentId!, version: detail.version, chunkIndex: detail.chunkIndex ?? null } : null
        // V1.7.1e — regra operacional: só sobre base usável, da MESMA seção da versão publicada usada na verificação.
        const notCheckpoint = entry.eligibility?.eligible === false
        const publishedContent = !notCheckpoint && knowledge?.documentId && knowledge.applicability !== "NOT_VERIFIED" && knowledge.quote ? input.published.get(knowledge.documentId)?.content ?? null : null
        const sameSection = publishedContent && knowledge?.quote ? selectOperativeRule({ content: publishedContent, heading: knowledge.heading ?? entry.rule?.heading ?? null, citedQuote: knowledge.quote, citedKind: knowledge.contentKind ?? "RULE_CONTENT" }) : null
        // V1.7.1g — etapa canônica (linha de lista) sem regra de como cumprir na própria seção: backfill determinístico no MESMO
        // documento/versão publicada (nunca exemplo, nunca outro documento, ambíguo = nada).
        const backfill = !sameSection && publishedContent && knowledge?.documentId ? backfillCheckpointRule({ content: publishedContent, rule: entry.rule, citedKind: knowledge.contentKind ?? "RULE_CONTENT" }) : null
        const operativeRule: OperativeRule | null = sameSection
          ? { ...sameSection, documentId: knowledge!.documentId, version: knowledge!.version, contentSha256: knowledge!.contentSha256 }
          : backfill?.operativeRule ? { ...backfill.operativeRule, documentId: knowledge!.documentId, version: knowledge!.version, contentSha256: knowledge!.contentSha256 } : null
        // V1.7.1g — as falas-modelo da seção do backfill também entram na proteção contra fato de exemplo ("SMS" da seção 35).
        const sectionExamples = publishedContent && knowledge?.quote ? [...new Set([...sectionExamplesOf(publishedContent, knowledge.heading ?? entry.rule?.heading ?? null), ...(operativeRule?.basis === "CHECKPOINT_RULE_BACKFILL" ? sectionExamplesOf(publishedContent, operativeRule.heading) : []), ...exampleTextsOfSegments(knowledge.segments ?? [])])] : []
        // V1.7.1b — APLICABILIDADE do produto: incerteza do sistema nunca vira "não seguiu"; regra de outro produto não se aplica.
        if (status === "FOLLOWED" || status === "NOT_FOLLOWED") {
          if (applicabilityMode === "OTHER_PRODUCT") { status = "NOT_APPLICABLE"; statusDowngradeReason = "APPLICABILITY_OTHER_PRODUCT"; omission = null }
          else if (applicabilityMode === "NOT_CONFIRMED") { status = "NOT_OBSERVABLE"; statusDowngradeReason = "APPLICABILITY_NOT_CONFIRMED"; omission = null }
          else if (applicabilityMode === "UNRESOLVED_SIBLINGS") {
            // Escolha silenciosa entre documentos irmãos: "não seguiu" não se sustenta; "cumpriu" vai ao QA (regra só literal).
            if (status === "NOT_FOLLOWED") { status = "NOT_OBSERVABLE"; statusDowngradeReason = "APPLICABILITY_UNRESOLVED"; omission = null }
            else if (knowledge && knowledge.applicability === "VERIFIED") knowledge = { ...knowledge, applicability: "LITERAL_ONLY", applicabilityBasis: null }
          }
        }
        const operatorText = entry.verified.filter((unit) => unit.speaker === "OPERADOR").map((unit) => unit.quote)
        // V1.7.1i — ETAPA COMPOSTA: um subconjunto observado não prova cumprimento integral. Cumprida + PARCIAL (item observado e
        // item verificadamente ausente) vira não cumprida; completude desconhecida fica registrada (QA e fora do histórico).
        const completeness = knowledge && knowledge.applicability !== "NOT_VERIFIED" && (knowledge.contentKind ?? "RULE_CONTENT") === "RULE_CONTENT" && (status === "FOLLOWED" || (status === "NOT_FOLLOWED" && !omission))
          ? (v5 && !completions.has(raw)
              // MONITORING V2 — itens cobertos DECLARADOS pelo especialista, cada um com fala literal conferida (sem detector por tipo).
              ? declaredCompletenessOf({ quote: knowledge.quote, declared: raw.items ?? null, windowComplete: transcriptWindowComplete(projection), verifiedTurnsOf: (quote) => { const unit = decomposeClaimedEvidence(quote)[0] ?? { speaker: null, text: quote }; const verdict = verifyEvidenceUnit({ interactionRef: INTERACTION_REF, speaker: unit.speaker, quote: unit.text }, interactions); return verdict.ok && verdict.evidence.speaker === "OPERADOR" ? verdict.evidence.turnRef : null } })
              : assessCompleteness({ quote: knowledge.quote, evidence: entry.verified.filter((unit) => unit.speaker === "OPERADOR").map((unit) => ({ turnRef: unit.turnRef, text: unit.quote })), operatorConversation, windowComplete: transcriptWindowComplete(projection) }))
          : null
        if (completeness?.status === "PARTIAL" && status === "FOLLOWED") { status = "NOT_FOLLOWED"; statusDowngradeReason = "COMPOSITE_PARTIAL" }
        // V1.7.1k — ETAPA COMPOSTA ancorada pelos PRÓPRIOS itens: ≥ 2 itens da lista reconhecidos por detector TIPADO (dinheiro,
        // data, canal, recorrência…) na fala verificada do operador + processo aplicável. Palavra solta nunca ancora (LEXICAL fora).
        if (!v5 && knowledge && knowledge.applicability === "LITERAL_ONLY" && completeness && (status === "FOLLOWED" || status === "NOT_FOLLOWED")) {
          const typedObserved = completeness.items.filter((item) => item.status === "OBSERVED" && item.kind !== undefined && item.kind !== "LEXICAL")
          const processAnchor = processAnchorOf({ documentTitle: knowledge.documentTitle, subject: input.subject ?? null, heading: entry.rule?.heading ?? knowledge.heading, leadIn: entry.rule?.leadIn ?? knowledge.leadIn, conversation })
          if (typedObserved.length >= 2 && processAnchor) {
            knowledge = { ...knowledge, applicability: "VERIFIED", applicabilityBasis: "STRUCTURED_ANCHOR", structuredAnchor: { version: STRUCTURED_ANCHOR_VERSION, anchored: true, basis: "COMPOSITE_ITEMS_OBSERVED", failure: null, checkpoint: null, proof: { processAnchor, actionStem: null, operatorTurns: [...new Set(typedObserved.flatMap((item) => item.observedTurns))], situationTerms: [], itemTerms: typedObserved.map((item) => item.text), otherStepStems: [], stepTermsInSpeech: [] } } }
          }
        }
        const evidenceType: CheckpointEvidenceType | null = status === "FOLLOWED"
          ? (operatorText.some(isDeclaration) ? "OBSERVED_DECLARATION" : "OBSERVED_ACTION")
          : status === "NOT_FOLLOWED"
            ? (omission ? (omission.verified ? "VERIFIED_OMISSION" : "UNVERIFIED_OMISSION") : "OBSERVED_ACTION")
            : null
        const declared = raw.guidance.source
        const knowledgeUsable = knowledge !== null && knowledge.applicability !== "NOT_VERIFIED"
        const grounding: GuidanceGrounding = declared === "VERIFIED_PEER_PATTERN" ? "NO_GROUNDED_GUIDANCE" : declared === "NO_GROUNDED_GUIDANCE" ? declared : knowledgeUsable ? declared : "NO_GROUNDED_GUIDANCE"
        const downgradeReason = declared === "VERIFIED_PEER_PATTERN" ? "PEER_EVIDENCE_NOT_SUPPORTED" as const : declared !== "NO_GROUNDED_GUIDANCE" && grounding === "NO_GROUNDED_GUIDANCE" ? "GUIDANCE_WITHOUT_VERIFIED_KNOWLEDGE" as const : null
        const sourceEntry = entry.entry
        checkpoints.push({
          ref: entry.ref,
          processTitle: sourceEntry ? sourceEntry.documentTitle : process.documentTitle,
          requirement: raw.requirement,
          declaredStatus: raw.status,
          status,
          statusDowngradeReason,
          evidenceType,
          omission,
          transcriptEvidence: entry.verified,
          rejectedUnits: entry.rejected,
          ownership: entry.ownership,
          knowledge,
          knowledgeDetail,
          operativeRule,
          ...(backfill ? { ruleBackfill: backfill.audit } : {}),
          ...(completeness ? { completeness } : {}),
          ...(sectionExamples.length > 0 ? { sectionExamples } : {}),
          ...(entry.rule && entry.rule.listKind !== "NONE" && entry.rule.stepPosition !== null && !notCheckpoint ? { checkpointStep: entry.rule.stepText } : {}),
          ...(entry.eligibility ? { checkpointEligibility: entry.eligibility } : {}),
          // V1.7.1f — a orientação do especialista vai ao redator como interpretação: falas-modelo (EXEMPLO) do documento citadas
          // nela saem antes (o exemplo não é fato desta chamada — "cinco dias úteis… SMS" do smoke V1.7.1e).
          guidance: { declared, grounding, text: grounding === "NO_GROUNDED_GUIDANCE" ? null : publishedContent && raw.guidance.text ? withoutExampleSpans(raw.guidance.text, publishedContent) : raw.guidance.text, downgradeReason },
          uncertainty: raw.uncertainty,
          ...(sourceEntry ? { source: { ref: sourceEntry.ref, kind: sourceEntry.kind, documentId: sourceEntry.documentId, heading: sourceEntry.heading, position: sourceEntry.position, sourceText: sourceEntry.sourceText, canonicalBehavior: sourceEntry.canonicalBehavior, facets: [...sourceEntry.facets], processRequirement: sourceEntry.processRequirement, assessmentRequirement: sourceEntry.assessmentRequirement, primaryProcess: sourceEntry.primaryProcess, quoteMatch: entry.quoteMatch ?? "ABSENT", modelQuote: raw.knowledgeQuote ?? null, ...(sourceEntry.registry ? { registry: sourceEntry.registry } : {}) } } : {}),
          origin: completions.has(raw) ? "SYSTEM_COMPLETION" : "MODEL",
          ...(completions.has(raw) ? { completion: completions.get(raw)! } : {}),
          ...(entry.polarity ? { evidencePolarity: entry.polarity } : {}),
          ...(entry.conduct ? { conduct: entry.conduct } : {}),
          ...(prerequisite ? { prerequisite } : {}),
          ...(v5 ? { declaredSemantics: true as const, dependsOn: raw.dependsOn ?? null, summary: raw.summary ?? null } : {}),
        })
      })
      processes.push({ title: process.documentTitle, documentId: processDocumentId, checkpointRefs: refs, product, applicabilityMode, applicabilityRef: covering?.ref ?? null, siblings })
    })
  })
  // V1.7.1n — completude determinística: resolvida só com a lista avaliada (completa ou parcial) e a regra ancorada; senão a
  // etapa obrigatória continua FALTANDO (motivo explícito, análise parcial) — nunca "não observável" nem inventada.
  checkpoints.forEach((checkpoint, index) => {
    if (checkpoint.origin !== "SYSTEM_COMPLETION" || !checkpoint.completion) return
    const completenessKnown = checkpoint.completeness?.status === "COMPLETE" || checkpoint.completeness?.status === "PARTIAL"
    const anchoredRule = checkpoint.knowledge?.applicability === "VERIFIED"
    if (completenessKnown && anchoredRule && EVIDENCED.includes(checkpoint.status)) {
      coverage.completedDeterministically += 1
      checkpoints[index] = { ...checkpoint, completion: { ...checkpoint.completion, resolved: true } }
      return
    }
    const failure = !completenessKnown ? "COMPLETENESS_UNKNOWN" as const : "KNOWLEDGE_NOT_ANCHORED" as const
    coverage.missingUnresolved.push({ ref: checkpoint.source?.ref ?? checkpoint.ref, heading: checkpoint.source?.heading ?? null, behavior: checkpoint.source?.canonicalBehavior ?? null, reason: failure })
    checkpoints[index] = { ...checkpoint, status: "NOT_OBSERVABLE", statusDowngradeReason: "MISSING_REQUIRED_CHECKPOINT", evidenceType: null, completion: { ...checkpoint.completion, resolved: false, failure } }
  })
  // V1.7.4 — MESMA FALA, MESMA SEÇÃO: a fala que prova um descumprimento observado (não parcial, não omissão) não sustenta um
  // ponto forte na mesma seção do mesmo documento — o acerto está misturado à violação. Seções diferentes ("Registrei a contestação,
  // é só aguardar": registro × formulação a evitar) continuam independentes.
  const sectionKey = (checkpoint: VerifiedCheckpoint) => `${checkpoint.knowledge?.documentId ?? ""}|${normalizeForKnowledgeMatch(checkpoint.source?.heading ?? checkpoint.knowledge?.heading ?? "")}`
  const violations = checkpoints.filter((checkpoint) => checkpoint.status === "NOT_FOLLOWED" && checkpoint.statusDowngradeReason === null && checkpoint.evidenceType === "OBSERVED_ACTION" && (checkpoint.knowledge?.applicability ?? "NOT_VERIFIED") !== "NOT_VERIFIED")
  checkpoints.forEach((checkpoint, index) => {
    if (checkpoint.status !== "FOLLOWED") return
    const turns = checkpoint.transcriptEvidence.filter((unit) => unit.speaker === "OPERADOR").map((unit) => unit.turnRef)
    const violationTurns = new Set(violations.filter((violation) => sectionKey(violation) === sectionKey(checkpoint)).flatMap((violation) => violation.transcriptEvidence.filter((unit) => unit.speaker === "OPERADOR").map((unit) => unit.turnRef)))
    if (turns.length === 0 || !turns.every((turn) => violationTurns.has(turn))) return
    const conduct: ConductAssessment = { ...(checkpoint.conduct ?? { version: "EVIDENCE_CONDUCT_V1", required: "NONE", obligation: null, cues: { checkActTurns: [], questionTurns: [], abstentionTurns: [], assertionTurns: [], priorCheckTurns: [] }, declared: null }), verdict: "MISMATCH", failure: "EVIDENCE_SHARED_WITH_VIOLATION" }
    checkpoints[index] = { ...checkpoint, status: "NOT_OBSERVABLE", statusDowngradeReason: "EVIDENCE_ACTION_MISMATCH", evidenceType: null, conduct }
  })
  // V1.7.4 — PRÉ-REQUISITO DESCUMPRIDO: a ação cumprida que se apoia nele (mesma seção, assunto em comum, depois da violação) não é
  // ponto forte — nem ponto de desenvolvimento: fica sem item (`PREREQUISITE_DEPENDENCY_V1`).
  const stepTextOf = (checkpoint: VerifiedCheckpoint) => checkpoint.checkpointStep ?? checkpoint.knowledge?.quote ?? checkpoint.requirement
  const operatorTurnsOf = (checkpoint: VerifiedCheckpoint) => checkpoint.transcriptEvidence.filter((unit) => unit.speaker === "OPERADOR").map((unit) => unit.turnRef)
  // MONITORING V2 — contrato V5: o pré-requisito é DECLARADO (`dependsOn`). Pré-requisito DESCUMPRIDO (ou que caiu por um descumprido) ⇒
  // a dependente não é cumprida (NOT_MET). Pré-requisito INCONCLUSIVO (fala não verificada, não observável, ausente, inaplicável) ⇒ a
  // dependente mantém status e evidência, marcada UNVERIFIED: nunca vira conformidade sozinha (QA; fora da analytics). Incerteza ≠ falha.
  checkpoints.forEach((checkpoint, index) => {
    if (!checkpoint.declaredSemantics || checkpoint.status !== "FOLLOWED" || !checkpoint.dependsOn) return
    const gate = checkpoints.find((other) => other !== checkpoint && other.source?.ref === checkpoint.dependsOn) ?? null
    if (gate?.status === "FOLLOWED" && gate.dependency?.state !== "UNVERIFIED") return
    const notMet = gate?.status === "NOT_FOLLOWED" || gate?.statusDowngradeReason === "PREREQUISITE_NOT_MET"
    const dependency = { version: "PREREQUISITE_DEPENDENCY_V1" as const, gateRef: checkpoint.dependsOn, kind: "DECLARED" as const, sharedTerms: [], gateTurn: gate?.transcriptEvidence.find((unit) => unit.speaker === "OPERADOR")?.turnRef ?? null, state: notMet ? "NOT_MET" as const : "UNVERIFIED" as const, gateStatus: gate?.status ?? null, gateReason: gate ? gate.statusDowngradeReason ?? gate.dependency?.state ?? null : "PREREQUISITE_NOT_ASSESSED" }
    checkpoints[index] = notMet ? { ...checkpoint, status: "NOT_OBSERVABLE", statusDowngradeReason: "PREREQUISITE_NOT_MET", evidenceType: null, dependency } : { ...checkpoint, dependency }
  })
  // V4 — inferido por termos em comum (a avaliação V5 não passa por aqui).
  const gates = violations.filter((violation) => !violation.declaredSemantics).flatMap((violation) => { const gate = prerequisiteGateOf(stepTextOf(violation)); return gate ? [{ violation, gate }] : [] })
  checkpoints.forEach((checkpoint, index) => {
    if (checkpoint.status !== "FOLLOWED" || checkpoint.declaredSemantics || gates.length === 0) return
    for (const { violation, gate } of gates) {
      if (violation === checkpoint || sectionKey(violation) !== sectionKey(checkpoint)) continue
      const dependency = prerequisiteDependencyOf({ gateRef: violation.source?.ref ?? violation.ref, gate, stepText: stepTextOf(checkpoint), evidenceTurns: operatorTurnsOf(checkpoint), gateTurns: operatorTurnsOf(violation), gateEvidence: violation.transcriptEvidence.filter((unit) => unit.speaker === "OPERADOR").map((unit) => unit.quote), contextTexts: [checkpoint.knowledge?.heading, checkpoint.knowledge?.leadIn, checkpoint.source?.heading, checkpoint.knowledge?.documentTitle, checkpoint.processTitle] })
      if (!dependency) continue
      checkpoints[index] = { ...checkpoint, status: "NOT_OBSERVABLE", statusDowngradeReason: "PREREQUISITE_NOT_MET", evidenceType: null, dependency }
      return
    }
  })
  // V1.7.1m — fontes do mesmo comportamento canônico convergem (uma avalia; as outras são proveniência ou conflito).
  const converged = convergeCanonicalBehaviors(checkpoints, { published: input.published, subject: input.subject ?? null, conversation, operatorConversation, windowComplete: transcriptWindowComplete(projection) })
  checkpoints.splice(0, checkpoints.length, ...converged.checkpoints)
  const count = (status: CheckpointStatus) => checkpoints.filter((checkpoint) => checkpoint.status === status).length
  const applicability = (value: KnowledgeApplicability) => checkpoints.filter((checkpoint) => checkpoint.knowledge?.applicability === value).length
  return {
    version: PROCESS_ASSESSMENT_VERIFICATION_VERSION,
    processes,
    checkpoints,
    summary: {
      FOLLOWED: count("FOLLOWED"),
      NOT_FOLLOWED: count("NOT_FOLLOWED"),
      NOT_OBSERVABLE: count("NOT_OBSERVABLE"),
      NOT_APPLICABLE: count("NOT_APPLICABLE"),
      statusDowngrades: checkpoints.filter((checkpoint) => checkpoint.statusDowngradeReason !== null).length,
      knowledgeVerified: applicability("VERIFIED"),
      knowledgeLiteralOnly: applicability("LITERAL_ONLY"),
      knowledgeNotVerified: applicability("NOT_VERIFIED"),
      verifiedOmissions: checkpoints.filter((checkpoint) => checkpoint.evidenceType === "VERIFIED_OMISSION").length,
      unverifiedOmissions: checkpoints.filter((checkpoint) => checkpoint.evidenceType === "UNVERIFIED_OMISSION").length,
      applicabilityDowngrades: checkpoints.filter((checkpoint) => checkpoint.statusDowngradeReason?.startsWith("APPLICABILITY_")).length,
      // V1.7.1c — etapas propostas que ficaram FORA da avaliação por violar o contrato (análise PARCIAL, nunca "completa").
      contractInvalidItems: input.sources.reduce((total, source) => total + (source.assessment.validation?.invalidItems.length ?? 0), 0),
      compositeComplete: checkpoints.filter((checkpoint) => checkpoint.completeness?.status === "COMPLETE").length,
      compositePartial: checkpoints.filter((checkpoint) => checkpoint.completeness?.status === "PARTIAL").length,
      compositeUnknown: checkpoints.filter((checkpoint) => checkpoint.completeness?.status === "UNKNOWN").length,
      notCheckpointEligible: checkpoints.filter((checkpoint) => checkpoint.statusDowngradeReason === "NOT_A_PROCESS_CHECKPOINT").length,
      behaviorSupportingSources: checkpoints.filter((checkpoint) => checkpoint.canonical?.role === "SUPPORTING").length,
      behaviorConflicts: converged.groups.filter((group) => group.conflict).length,
    },
    applicability: resolutions,
    behaviors: converged.groups,
    ...(catalogUsed ? { coverage } : {}),
    ...(input.sources.some((source) => source.assessment.interaction) ? { interaction: input.sources.find((source) => source.assessment.interaction)!.assessment.interaction ?? null } : {}),
  }
}

/**
 * V1.7.1n — MOMENTO DA RECAPITULAÇÃO (completude determinística da etapa obrigatória omitida pelo especialista): UMA fala do
 * operador que ABRE com marcador explícito de recapitulação ("Resumindo…", "Recapitulando…", "Só pra recapitular…", "Em
 * resumo…"). Nenhuma, duas ou mais, transcrição incompleta ou etapa que não é a lista composta de recapitulação = não é seguro.
 */
const RECAP_MARKER = /^(?:(?:ent[ãa]o|bom|certo|ok|t[áa]|beleza)[,.!]?\s+)?(resumindo|recapitulando|em\s+resumo|s[óo]\s+(?:pra|para)\s+(?:recapitular|resumir)|(?:vou|vamos)\s+(?:recapitular|resumir)|pra\s+recapitular|para\s+recapitular|recapitulando)(?!\p{L})/iu
function requiredCompletionOf(entry: ProcessCheckpointEntry, projection: ReturnType<typeof projectTranscript>, windowComplete: boolean): { ok: true; turnRef: string; quote: string; marker: string } | { ok: false; reason: RequiredCoverageSummary["missingUnresolved"][number]["reason"] } {
  if (entry.canonicalBehavior !== "RECAPITULATE_INTERACTION" || entry.kind !== "COMPOSITE_LIST") return { ok: false, reason: "COMPLETION_NOT_SUPPORTED" }
  if (!windowComplete) return { ok: false, reason: "TRANSCRIPT_INCOMPLETE" }
  const moments = projection.turns.filter((turn) => turn.speaker === "OPERADOR").flatMap((turn) => { const match = RECAP_MARKER.exec(turn.text.trim()); return match ? [{ turn, marker: match[1]! }] : [] })
  if (moments.length !== 1) return { ok: false, reason: "NO_SAFE_RECAP_MOMENT" }
  return { ok: true, turnRef: moments[0]!.turn.handle, quote: moments[0]!.turn.text, marker: moments[0]!.marker }
}

/**
 * V1.7.1b — VERIFICA a aplicabilidade proposta: candidatos (documento apresentado, trecho literal na versão publicada, produto
 * nomeado no próprio documento), falas que identificam o produto e a fala do operador sobre o ponto que muda. O status é o do
 * código (`resolveApplicabilityStatus`), nunca o declarado. Se as falas trazidas não nomeiam produto, a própria transcrição é
 * lida (uma menção inequívoca a UM candidato confirma; menção a vários = ambíguo).
 */
function verifyApplicability(input: { raw: NonNullable<RawProcessAssessment["applicability"]>[number]; ref: string; presented: readonly PresentedKnowledgeExcerpt[]; published: ReadonlyMap<string, PublishedKnowledgeDocument>; interactions: ReadonlyMap<string, ProjectedInteraction>; projection: ReturnType<typeof projectTranscript>; subject: string | null }): ApplicabilityResolution {
  const { raw } = input
  const verifyQuote = (quote: string) => {
    const units = decomposeClaimedEvidence(quote)
    const verified: VerifiedEvidence[] = []
    for (const unit of units.length > 0 ? units : [{ speaker: null, text: quote }]) {
      const verdict = verifyEvidenceUnit({ interactionRef: INTERACTION_REF, speaker: unit.speaker, quote: unit.text }, input.interactions)
      if (!verdict.ok) return null
      verified.push(verdict.evidence)
    }
    return verified
  }
  const operatorStatementUnits = raw.operatorStatement ? verifyQuote(raw.operatorStatement) : null
  const operatorStatement = operatorStatementUnits && operatorStatementUnits.length > 0 && operatorStatementUnits.every((unit) => unit.speaker === "OPERADOR")
    ? { turnRef: operatorStatementUnits[0]!.turnRef, quote: operatorStatementUnits.map((unit) => unit.quote).join(" ") }
    : null
  const candidates: VerifiedApplicabilityCandidate[] = []
  const rejectedCandidates: ApplicabilityCandidateRejection[] = []
  for (const candidate of raw.candidates) {
    const knowledge = verifyKnowledgeQuote({ documentTitle: candidate.documentTitle, quote: candidate.ruleQuote, presented: input.presented, published: input.published, anchorTexts: [] })
    if (!knowledge.documentId) { rejectedCandidates.push({ product: candidate.product, documentTitle: candidate.documentTitle, reason: "DOCUMENT_NOT_VERIFIED" }); continue }
    if (!knowledge.presentedInRun || !knowledge.quote) { rejectedCandidates.push({ product: candidate.product, documentTitle: candidate.documentTitle, reason: "QUOTE_NOT_VERIFIED" }); continue }
    if (!productInDocument(candidate.product, { title: knowledge.documentTitle, heading: knowledge.heading, quote: knowledge.quote })) { rejectedCandidates.push({ product: candidate.product, documentTitle: candidate.documentTitle, reason: "PRODUCT_NOT_IN_DOCUMENT" }); continue }
    if (candidates.some((existing) => sameProduct(existing.product, candidate.product) || existing.documentId === knowledge.documentId)) { rejectedCandidates.push({ product: candidate.product, documentTitle: candidate.documentTitle, reason: "DUPLICATE" }); continue }
    candidates.push({ product: candidate.product.trim(), documentId: knowledge.documentId, documentTitle: knowledge.documentTitle, heading: knowledge.heading, version: knowledge.version, quote: knowledge.quote.trim(), href: buildKnowledgeMaterialHref(knowledge.documentId), statementComparison: compareStatement(operatorStatement?.quote ?? null, knowledge.quote) })
  }
  const declaredEvidence = raw.evidence.flatMap((quote) => verifyQuote(quote) ?? [])
  const namesCandidate = (text: string) => candidates.some((candidate) => mentionsProduct(text, candidate.product))
  const evidence = declaredEvidence.some((unit) => namesCandidate(unit.quote))
    ? declaredEvidence.filter((unit) => namesCandidate(unit.quote))
    : input.projection.turns.filter((turn) => namesCandidate(turn.text)).map((turn) => ({ turnRef: turn.handle, speaker: turn.speaker, quote: turn.text }))
  const decided = resolveApplicabilityStatus({ declaredStatus: raw.status, declaredProduct: raw.resolvedProduct, candidates, evidenceTexts: evidence.map((unit) => unit.quote), subject: input.subject })
  const statement = summarizeStatement(operatorStatement, candidates)
  return {
    version: APPLICABILITY_RESOLUTION_VERSION,
    ref: input.ref,
    declaredStatus: raw.status,
    status: decided.status,
    resolvedProduct: decided.resolvedProduct,
    source: decided.source,
    evidence: evidence.map((unit) => ({ turnRef: unit.turnRef, speaker: unit.speaker, quote: unit.quote })),
    candidates,
    rejectedCandidates,
    operatorStatement,
    statementComparison: statement.summary,
    compatibleProducts: statement.compatible,
  }
}

/** Resumo SEGURO para o artefato (auditoria/QA): nada de trecho bruto da transcrição — só turno, falante e hash. */
export function assessmentAuditView(assessment: VerifiedProcessAssessment) {
  return {
    version: assessment.version,
    summary: assessment.summary,
    processes: assessment.processes.map((process) => ({ title: process.title, documentId: process.documentId, product: process.product ?? null, applicabilityMode: process.applicabilityMode ?? "JUDGED", applicabilityRef: process.applicabilityRef ?? null, siblings: process.siblings ?? [] })),
    // V1.7.1b — resoluções de aplicabilidade (falas só por turno + hash; trechos da base são literais publicados).
    behaviors: assessment.behaviors ?? [],
    // V1.7.1n — cobertura obrigatória (avaliadas pelo especialista × completadas pelo sistema × faltando).
    coverage: assessment.coverage ?? null,
    ...(assessment.interaction ? { interaction: assessment.interaction } : {}),
    applicability: (assessment.applicability ?? []).map((resolution) => ({ ...resolution, evidence: resolution.evidence.map((unit) => ({ turnRef: unit.turnRef, speaker: unit.speaker, rawSha256: sha(unit.quote) })), operatorStatement: resolution.operatorStatement ? { turnRef: resolution.operatorStatement.turnRef, rawSha256: sha(resolution.operatorStatement.quote) } : null })),
    checkpoints: assessment.checkpoints.map((checkpoint) => ({
      ref: checkpoint.ref,
      processTitle: checkpoint.processTitle,
      requirement: checkpoint.requirement,
      declaredStatus: checkpoint.declaredStatus,
      status: checkpoint.status,
      statusDowngradeReason: checkpoint.statusDowngradeReason,
      evidenceType: checkpoint.evidenceType,
      omission: checkpoint.omission ? { verified: checkpoint.omission.verified, failure: checkpoint.omission.failure, checks: checkpoint.omission.checks, signals: checkpoint.omission.signals } : null,
      ownership: checkpoint.ownership,
      evidence: checkpoint.transcriptEvidence.map((unit) => ({ turnRef: unit.turnRef, speaker: unit.speaker, rawSha256: sha(unit.quote) })),
      rejectedUnits: checkpoint.rejectedUnits,
      knowledge: checkpoint.knowledge ? { documentId: checkpoint.knowledge.documentId, documentTitle: checkpoint.knowledge.documentTitle, heading: checkpoint.knowledge.heading, version: checkpoint.knowledge.version, quote: checkpoint.knowledge.quote, applicability: checkpoint.knowledge.applicability, applicabilityBasis: checkpoint.knowledge.applicabilityBasis, leadIn: checkpoint.knowledge.leadIn, failure: checkpoint.knowledge.failure, anchorTerms: checkpoint.knowledge.anchorTerms, contentSha256: checkpoint.knowledge.contentSha256, contentKind: checkpoint.knowledge.contentKind ?? null, documentOffset: checkpoint.knowledge.documentOffset ?? null, structuredAnchor: checkpoint.knowledge.structuredAnchor ?? null, segments: checkpoint.knowledge.segments ?? null, citedQuote: checkpoint.knowledge.citedQuote ?? null } : null,
      knowledgeDetail: checkpoint.knowledgeDetail,
      operativeRule: checkpoint.operativeRule ?? null,
      ruleBackfill: checkpoint.ruleBackfill ?? null,
      completeness: checkpoint.completeness ?? null,
      checkpointEligibility: checkpoint.checkpointEligibility ?? null,
      canonical: checkpoint.canonical ?? null,
      // V1.7.1n — etapa de origem (checkpointRef), origem da avaliação, completude determinística e polaridade da evidência.
      source: checkpoint.source ? { ...checkpoint.source, modelQuote: checkpoint.source.modelQuote } : null,
      origin: checkpoint.origin ?? "MODEL",
      completion: checkpoint.completion ?? null,
      evidencePolarity: checkpoint.evidencePolarity ? { behavior: checkpoint.evidencePolarity.behavior, evidence: checkpoint.evidencePolarity.evidence, conflict: checkpoint.evidencePolarity.conflict, evidenceUnits: checkpoint.evidencePolarity.evidenceUnits, fulfilledTurns: checkpoint.evidencePolarity.fulfilledTurns } : null,
      // V1.7.4 — conduta exigida × papel da evidência e prova de etapa pulada (auditoria; sem texto de fala, só turnos).
      conduct: checkpoint.conduct ? { version: checkpoint.conduct.version, required: checkpoint.conduct.required, verdict: checkpoint.conduct.verdict, failure: checkpoint.conduct.failure, cues: checkpoint.conduct.cues, declared: checkpoint.conduct.declared } : null,
      dependency: checkpoint.dependency ?? null,
      prerequisite: checkpoint.prerequisite ? { version: checkpoint.prerequisite.version, proven: checkpoint.prerequisite.proven, failure: checkpoint.prerequisite.failure, successorTurns: checkpoint.prerequisite.successorTurns, obligationTermsBefore: checkpoint.prerequisite.obligationTermsBefore, checkActsBefore: checkpoint.prerequisite.checkActsBefore } : null,
      guidance: { declared: checkpoint.guidance.declared, grounding: checkpoint.guidance.grounding, downgradeReason: checkpoint.guidance.downgradeReason },
      uncertainty: checkpoint.uncertainty,
    })),
  }
}
export type ProcessAssessmentAuditView = ReturnType<typeof assessmentAuditView>
