import { chunkKnowledgeDocument } from "../../knowledge/domain/knowledge-chunking.js"
import { buildProcessCheckpointCatalog, type CheckpointSegmentRole, type ProcessCheckpointEntry, type ProcessCheckpointKind } from "../../reliable-feedback/domain/checkpoint-catalog.js"
import { BEHAVIOR_TITLES } from "../../reliable-feedback/domain/canonical-behavior.js"
import { presentationLabelOf } from "../../reliable-feedback/domain/behavior-presentation.js"
import { familyOfAction, isUnderstandingCheckStep, stepActionOf } from "../../reliable-feedback/domain/action-semantics.js"

/**
 * CHECKPOINT REGISTRY — EXTRAÇÃO (design time; nunca em runtime, nunca por chamada).
 *
 * A BASE DE CONHECIMENTO é a fonte da verdade. A extração só ESTRUTURA o que a base já diz: cada regra observável de uma seção
 * executável vira um CANDIDATO — com o literal oficial, a etapa, o código da etapa (o MESMO `checkpointRef` que o runtime usa),
 * aplicabilidade e tipo de evidência esperada derivados do próprio texto. Nunca cria obrigação: nome e aplicabilidade são
 * recortes/resumos do literal; exemplo, contexto, objetivo e referência nunca viram candidato (a elegibilidade é a do catálogo
 * de etapas, `PROCESS_CHECKPOINT_CATALOG_V1`, com papéis de seção e de segmento — RULE × AVOID preservados).
 *
 * `CheckpointExtractor` é a PORTA: a implementação padrão é estrutural (determinística, zero modelo). Um enriquecimento
 * semântico por LLM (nome operacional, aplicabilidade em linguagem natural) pode ser acoplado depois pela porta
 * `CheckpointSemanticEnricher` — e passa por `acceptEnrichment`, que recusa qualquer mudança na regra oficial.
 */
export const CHECKPOINT_EXTRACTOR_VERSION = "CHECKPOINT_EXTRACTOR_STRUCTURAL_V1" as const

export type ExpectedEvidenceKind = "OPERATOR_ACTION" | "OPERATOR_QUESTION" | "OPERATOR_STATEMENT" | "AVOIDED_PHRASE" | "COMPOSITE_LIST"

export type CheckpointCandidate = {
  checkpointRef: string
  documentId: string
  documentTitle: string
  kind: ProcessCheckpointKind
  segmentRole: CheckpointSegmentRole
  sectionHeading: string | null
  chunkIndex: number | null
  leadIn: string | null
  listPosition: number | null
  /** Literal OFICIAL como está na base (read-only em toda a aplicação). */
  sourceLiteral: string
  /** A etapa (o item; a abertura na lista composta; a frase). */
  requirement: string
  /** Nome operacional DERIVADO (título do comportamento, substantivo da ação ou seção) — nunca regra nova. */
  name: string
  /** Condição literal em que a regra vale ("quando permitido", "Quando houver fidelização vigente…"), null = sempre. */
  applicability: string | null
  expectedEvidenceKind: ExpectedEvidenceKind
  canonicalBehavior: string | null
}

export type PublishedKnowledgeVersion = { organizationId: string; documentId: string; documentTitle: string; version: number; content: string }

export interface CheckpointExtractor {
  readonly version: string
  extract(document: PublishedKnowledgeVersion): Promise<CheckpointCandidate[]>
}

/** Enriquecimento semântico opcional (LLM) — nunca obrigatório, nunca fonte da regra. */
export type CheckpointEnrichment = { checkpointRef: string; name?: string | null; applicability?: string | null }
export interface CheckpointSemanticEnricher {
  enrich(document: PublishedKnowledgeVersion, candidates: readonly CheckpointCandidate[]): Promise<CheckpointEnrichment[]>
}

const CONDITION_TAIL = /,\s*((?:quando|se|caso|desde\s+que)\b[^;.]*)[;.]?\s*$/iu
const LEADING_CONDITION = /^\s*((?:quando|se|caso|sempre\s+que|antes\s+de|depois\s+de|ao)\s+[^,]{3,160}),/iu
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const capitalize = (text: string) => (text.length > 0 ? text[0]!.toLocaleUpperCase("pt-BR") + text.slice(1) : text)
const cleanStep = (text: string) => text.replace(/^[“"«\s]+|[”"»\s]+$/gu, "").replace(/[;:.]+$/u, "").trim()

/** Condição LITERAL da regra (recorte do próprio texto; nunca inferida). */
export function applicabilityOf(entry: Pick<ProcessCheckpointEntry, "stepText" | "sourceText">): string | null {
  const text = entry.stepText.trim()
  const leading = LEADING_CONDITION.exec(text)
  if (leading) return capitalize(leading[1]!.trim())
  const tail = CONDITION_TAIL.exec(text)
  return tail ? capitalize(tail[1]!.trim()) : null
}

/** B29 — proibição escrita como frase negativa ("Não orientar o cliente apenas a aguardar") é RESTRIÇÃO: nunca vira obrigação
 * positiva. O catálogo do runtime continua avaliando a etapa (cumprida = não fez); o registry registra o papel certo. */
const PROHIBITION = /^\s*(?:n[ãa]o|nunca|jamais|evit[ae]r?|[ée]\s+proibid[oa])(?!\p{L})/iu
export const segmentRoleOf = (entry: Pick<ProcessCheckpointEntry, "segmentRole" | "stepText">): CheckpointSegmentRole => (entry.segmentRole === "AVOID" || PROHIBITION.test(cleanStep(entry.stepText)) ? "AVOID" : "RULE")
/** A ação principal (sem a circunstância inicial: "Antes de confirmar a visita, confirmar se…" → "confirmar se…"). */
const mainClauseOf = (step: string) => { const leading = LEADING_CONDITION.exec(step); return leading ? step.slice(leading[0].length).trim() : step }

/** O que prova a regra na chamada: evitar/proibição → a conduta proibida; lista composta → os itens; pergunta → pergunta do
 * operador; ato de fala (informar, confirmar, perguntar) → o que o operador disse; resto → a ação do operador. */
export function expectedEvidenceKindOf(entry: Pick<ProcessCheckpointEntry, "segmentRole" | "composite" | "stepText" | "leadIn">): ExpectedEvidenceKind {
  if (segmentRoleOf(entry) === "AVOID") return "AVOIDED_PHRASE"
  if (entry.composite) return "COMPOSITE_LIST"
  const step = mainClauseOf(cleanStep(entry.stepText))
  if (/\?\s*$/u.test(entry.stepText.replace(/[”"»]\s*$/u, "")) || /^perguntar/iu.test(entry.leadIn ?? "") || isUnderstandingCheckStep(step)) return "OPERATOR_QUESTION"
  const family = stepActionOf(step).family ?? familyOfAction(step)
  if (family === "ASK") return "OPERATOR_QUESTION"
  if (family === "INFORM" || family === "CONFIRM") return "OPERATOR_STATEMENT"
  return "OPERATOR_ACTION"
}

const NAME_MAX = 90
const shorten = (text: string) => (text.length <= NAME_MAX ? text : `${text.slice(0, text.lastIndexOf(" ", NAME_MAX - 1) > 40 ? text.lastIndexOf(" ", NAME_MAX - 1) : NAME_MAX - 1)}…`)
/**
 * Nome operacional (derivado, nunca regra nova): comportamento canônico → título; lista composta → a seção; proibição → a
 * própria frase; item de lista → substantivo da ação ("Confirmação do endereço completo do cliente"); frase → a ação principal,
 * sem a circunstância inicial ("Orientar o cliente sobre a multa antes de concluir o cancelamento").
 */
export function candidateNameOf(entry: ProcessCheckpointEntry): string {
  if (entry.canonicalBehavior) return BEHAVIOR_TITLES[entry.canonicalBehavior]
  const step = cleanStep(entry.stepText)
  const heading = entry.heading ? entry.heading.replace(/^\s*\d+(?:\.\d+)*\.?\s+/u, "").trim() : null
  if (entry.composite && heading) return shorten(heading)
  if (segmentRoleOf(entry) === "AVOID" || entry.kind === "SENTENCE") return shorten(capitalize(mainClauseOf(step).replace(/,\s*(?:quando|se|caso|desde\s+que)\b.*$/iu, "")))
  const label = presentationLabelOf({ section: "STRENGTH", process: { stepTitle: step.replace(/,\s*(?:quando|se|caso|desde\s+que)\b.*$/iu, "") }, knowledge: { quote: entry.sourceText, heading: entry.heading, leadIn: entry.leadIn, contentKind: "RULE_CONTENT" } })
  return shorten((label ?? step).trim()) || "Etapa do procedimento"
}

/** Candidato a partir da entrada do catálogo (o mesmo código de etapa do runtime). */
export function candidateOf(entry: ProcessCheckpointEntry): CheckpointCandidate {
  return {
    checkpointRef: entry.ref,
    documentId: entry.documentId,
    documentTitle: entry.documentTitle,
    kind: entry.kind,
    segmentRole: segmentRoleOf(entry),
    sectionHeading: entry.heading,
    chunkIndex: entry.chunkIndex,
    leadIn: entry.leadIn,
    listPosition: entry.position,
    sourceLiteral: entry.sourceText,
    requirement: cleanStep(entry.stepText) || entry.stepText,
    name: candidateNameOf(entry),
    applicability: applicabilityOf(entry),
    expectedEvidenceKind: expectedEvidenceKindOf(entry),
    canonicalBehavior: entry.canonicalBehavior,
  }
}

/**
 * Extrator ESTRUTURAL (padrão): fatia a versão publicada pelos MESMOS trechos da recuperação e aplica o MESMO catálogo de etapas
 * do runtime — o `checkpointRef` do registry é, por construção, o que o especialista recebe no prompt.
 */
export class StructuralCheckpointExtractor implements CheckpointExtractor {
  readonly version = CHECKPOINT_EXTRACTOR_VERSION
  constructor(private readonly enricher: CheckpointSemanticEnricher | null = null) {}

  async extract(document: PublishedKnowledgeVersion): Promise<CheckpointCandidate[]> {
    const chunks = chunkKnowledgeDocument({ id: document.documentId, title: document.documentTitle, content: document.content })
    const catalog = buildProcessCheckpointCatalog({
      excerpts: chunks.map((chunk) => ({ documentId: chunk.documentId, documentTitle: chunk.documentTitle, heading: chunk.heading, excerpt: chunk.text, chunkIndex: chunk.index })),
      contentOf: (id) => (id === document.documentId ? document.content : null),
      subject: null,
      coveragePlan: false,
    })
    const candidates = catalog.entries.map(candidateOf)
    if (!this.enricher) return candidates
    const enrichments = await this.enricher.enrich(document, candidates)
    return candidates.map((candidate) => acceptEnrichment(candidate, enrichments.find((entry) => entry.checkpointRef === candidate.checkpointRef) ?? null))
  }
}

/**
 * B27 — o enriquecimento só pode NOMEAR e resumir a aplicabilidade; nunca muda literal, etapa, código, tipo nem papel. Nome ou
 * aplicabilidade que traga termo de obrigação ausente do literal ("deve", "sempre", "obrigatório", número) é recusado.
 */
export function acceptEnrichment(candidate: CheckpointCandidate, enrichment: CheckpointEnrichment | null): CheckpointCandidate {
  if (!enrichment) return candidate
  const literal = fold(candidate.sourceLiteral)
  const invents = (text: string) => /(?<!\p{L})(?:deve|deverá|devera|obrigat\p{L}*|sempre|nunca|proibid\p{L}*)(?!\p{L})/iu.test(fold(text)) && !/(?<!\p{L})(?:deve|devera|obrigat\p{L}*|sempre|nunca|proibid\p{L}*)(?!\p{L})/iu.test(literal)
  const newNumbers = (text: string) => (text.match(/\d+/gu) ?? []).some((number) => !literal.includes(number))
  const name = enrichment.name?.trim()
  const applicability = enrichment.applicability?.trim()
  return {
    ...candidate,
    ...(name && name.length >= 2 && name.length <= 160 && !invents(name) && !newNumbers(name) ? { name } : {}),
    ...(applicability && applicability.length <= 300 && !invents(applicability) && !newNumbers(applicability) ? { applicability } : {}),
  }
}
