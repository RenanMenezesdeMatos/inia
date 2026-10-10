import { createHash } from "node:crypto"
import { inlineEnumerationOf, isListLine, listMarkerOf, stripListMarker } from "../../knowledge/domain/knowledge-list.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { selectPrimaryProcessDocument } from "../../knowledge/domain/primary-process.js"
import { closingSectionRoleOf, isExecutableSectionRole, sectionProcessRoleIn, type SectionProcessRole } from "../../knowledge/domain/section-roles.js"
import { canonicalBehaviorOf, type BehaviorFacet, type CanonicalBehavior } from "./canonical-behavior.js"
import { compositeListOf } from "./composite-checkpoint.js"
import { NORMATIVE } from "./rule-selection.js"
import { ruleActionOf } from "./behavior-presentation.js"
import { knowledgeContentKindOf, type KnowledgeContentKind } from "./suggested-response.js"
import { segmentKnowledgeQuote } from "./knowledge-segments.js"

/**
 * V1.7.1n — CATÁLOGO DE ETAPAS AVALIÁVEIS (`PROCESS_CHECKPOINT_CATALOG_V1`, domínio puro, determinístico, sem LLM).
 *
 * Até a V1.7.1m a IDENTIDADE da etapa era redescoberta a partir da citação do modelo: citação → localizar texto na base →
 * descobrir qual etapa é → descobrir o comportamento. No smoke V1.7.1m o especialista citou o "Checklist de Encerramento"
 * INTEIRO para a etapa "(3) explique o próximo passo e o prazo" e a presença do item "(4) confirme se o cliente tem mais alguma
 * dúvida" na mesma string reclassificou a etapa como confirmação de entendimento; "- Forneci protocolo?" sem o "[ ]" da base não
 * localizou a linha. Aqui a direção se inverte:
 *
 *   base publicada → estrutura (seção, lista, item) → etapas elegíveis → checkpointRef ESTÁVEL → comportamento canônico
 *   → etapa apresentada ao Agent (marcada no próprio trecho) → Agent devolve o checkpointRef → a citação é só evidência.
 *
 * ETAPA = (a) ITEM de lista (em linhas ou enumeração em linha) de seção EXECUTÁVEL; (b) LISTA COMPOSTA inteira (abertura de
 * dizer/conferir + itens — a completude é da lista, os itens não viram etapas soltas); (c) FRASE normativa fora de lista
 * ("O operador deverá informar o prazo exibido na ferramenta.") ou frase do que evitar. Exemplo nunca é etapa; seção não
 * executável (objetivo, conceitos, exemplos…) nunca oferece etapa.
 *
 * checkpointRef = "CP-" + sha256(documento | seção | tipo | texto literal normalizado | ocorrência) — mesmo documento, mesma
 * seção e mesmo texto → mesma identidade, em qualquer execução (e no prompt × na verificação). Texto livre do modelo nunca é
 * identidade.
 *
 * DUAS PERGUNTAS DIFERENTES (V1.7.3 — nunca um "REQUIRED" ambíguo):
 *   PROCESS_REQUIREMENT (`processRequirement`) — "esta ação é obrigatória NO PROCESSO?". REQUIRED só quando o plano de cobertura
 *     do fechamento está ativo (a chamada chegou ao fim) e a etapa é a LISTA COMPOSTA de RECAPITULAÇÃO do documento PRIMÁRIO do
 *     processo (a única com completude determinística pelo sistema); o resto é NOT_DECLARED. Documento transversal nunca torna
 *     uma etapa obrigatória.
 *   ASSESSMENT_REQUIREMENT (`assessmentRequirement`) — "o Agent PRECISA devolver uma disposição para esta etapa NESTA análise?".
 *     Decidido pelo PLANEJADOR DE COBERTURA (`planAssessmentCoverage`): MUST_ASSESS | MAY_ASSESS | SUPPORT_ONLY.
 */
export const PROCESS_CHECKPOINT_CATALOG_VERSION = "PROCESS_CHECKPOINT_CATALOG_V1" as const
export type ProcessCheckpointKind = "LIST_ITEM" | "COMPOSITE_LIST" | "SENTENCE"
/** Obrigatoriedade NO PROCESSO (o que o procedimento exige), nunca "o que o Agent precisa avaliar". */
export type ProcessRequirement = "REQUIRED" | "NOT_DECLARED"
/**
 * Obrigatoriedade NA AVALIAÇÃO (`ASSESSMENT_COVERAGE_PLAN_V1`):
 *   MUST_ASSESS  — o planejador escolheu a etapa como parte da avaliação principal: o Agent devolve exatamente uma disposição
 *                  (FOLLOWED, NOT_FOLLOWED, NOT_OBSERVABLE ou NOT_APPLICABLE); faltou = análise PARCIAL, nunca conclusão;
 *   MAY_ASSESS   — etapa elegível que o Agent avalia quando for relevante;
 *   SUPPORT_ONLY — fonte de apoio do mesmo comportamento de uma etapa obrigatória no processo (não exige avaliação própria).
 */
export type AssessmentRequirement = "MUST_ASSESS" | "MAY_ASSESS" | "SUPPORT_ONLY"
/** Por que a etapa é MUST_ASSESS: obrigatória no processo, ou a etapa-representante de um comportamento canônico do processo primário. */
export type AssessmentBasis = "PROCESS_REQUIRED" | "PRIMARY_PROCESS_BEHAVIOR"
export const ASSESSMENT_COVERAGE_PLAN_VERSION = "ASSESSMENT_COVERAGE_PLAN_V1" as const
export type CheckpointSegmentRole = "RULE" | "AVOID"

export type ProcessCheckpointEntry = {
  version: typeof PROCESS_CHECKPOINT_CATALOG_VERSION
  ref: string
  documentId: string
  documentTitle: string
  heading: string | null
  chunkIndex: number | null
  kind: ProcessCheckpointKind
  sectionRole: SectionProcessRole
  segmentRole: CheckpointSegmentRole
  leadIn: string | null
  /** Posição do item na lista (1..n); null em frase/lista composta. */
  position: number | null
  /** Texto LITERAL da etapa como está no trecho apresentado (com o marcador; a lista inteira na composta). */
  sourceText: string
  /** Texto da etapa sem marcador (o item; a abertura na composta; a frase). */
  stepText: string
  composite: boolean
  canonicalBehavior: CanonicalBehavior | null
  facets: BehaviorFacet[]
  processRequirement: ProcessRequirement
  assessmentRequirement: AssessmentRequirement
  /** Motivo do MUST_ASSESS (null nas demais). */
  assessmentBasis: AssessmentBasis | null
  primaryProcess: boolean
  /** Checkpoint Registry — definição/versão ATIVA que governa esta etapa (só em documento governado; ausente = legado). */
  registry?: GovernedCheckpointRef | null
}

/**
 * CHECKPOINT REGISTRY × RUNTIME (`CHECKPOINT_GOVERNANCE_V1`). Num documento GOVERNADO (o administrador ativou a governança e a
 * versão publicada já foi extraída), o especialista só recebe — e o contrato/verificação só aceitam — as etapas cuja versão no
 * registry está ATIVA (e cuja definição está ativa e no escopo). Documento não governado: o catálogo estrutural de sempre.
 * O código da etapa é o mesmo nos dois lados (o registry é extraído pelo mesmo catálogo), então nada no contrato muda.
 */
export const CHECKPOINT_GOVERNANCE_VERSION = "CHECKPOINT_GOVERNANCE_V1" as const
export type GovernedCheckpointRef = { definitionId: string; versionId: string; definitionVersion: number; knowledgeVersion: number; name: string; criticality: string; feedbackEnabled: boolean; analyticsEnabled: boolean; highlight: boolean }
export type CheckpointGovernanceSnapshot = {
  version: typeof CHECKPOINT_GOVERNANCE_VERSION
  /** Documentos governados, na versão publicada que foi apresentada. */
  governed: { documentId: string; knowledgeVersion: number }[]
  /** Etapas que valem (versão ATIVA, definição ativa, no escopo). */
  active: (GovernedCheckpointRef & { ref: string; documentId: string })[]
  /** Governado mas a versão publicada ainda não foi extraída: continua no catálogo estrutural (nunca some em silêncio). */
  pendingExtraction: string[]
  /** O escopo (Grupo/Subgrupo/domínio) foi avaliado para o colaborador desta execução. */
  scopeEvaluated: boolean
}
export function applyCheckpointGovernance<T extends ProcessCheckpointCatalog & { located?: (Located & { ref: string })[] }>(catalog: T, snapshot: CheckpointGovernanceSnapshot | null | undefined): T {
  if (!snapshot || snapshot.governed.length === 0) return catalog
  const governed = new Set(snapshot.governed.map((entry) => entry.documentId))
  const active = new Map(snapshot.active.map((entry) => [entry.ref, entry]))
  const keep = (entry: { documentId: string; ref: string }) => !governed.has(entry.documentId) || (active.get(entry.ref)?.documentId === entry.documentId)
  const registryOf = (ref: string): GovernedCheckpointRef | null => { const found = active.get(ref); if (!found) return null; const { ref: _ref, documentId: _documentId, ...rest } = found; void _ref; void _documentId; return rest }
  // O planejador roda DEPOIS do recorte: num documento governado só etapas ATIVAS podem ser MUST_ASSESS (Registry → ativos → plano).
  return {
    ...catalog,
    entries: planAssessmentCoverage(catalog.entries.filter(keep).map((entry) => (governed.has(entry.documentId) ? { ...entry, registry: registryOf(entry.ref) } : entry)), catalog.coveragePlan),
    ...(catalog.located ? { located: catalog.located.filter(keep) } : {}),
  }
}

export type CatalogExcerpt = { documentId: string; documentTitle: string; heading: string | null; excerpt: string; chunkIndex?: number | null }
export type ProcessCheckpointCatalog = {
  version: typeof PROCESS_CHECKPOINT_CATALOG_VERSION
  entries: ProcessCheckpointEntry[]
  primaryDocumentId: string | null
  /** O plano de cobertura desta avaliação está ativo (monitoria de uma chamada que chegou ao fim). Sem plano não há MUST_ASSESS. */
  coveragePlan: boolean
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
const HEADING = /^\s*#{1,6}\s+/
const QUOTED_START = /^\s*[“"«]/
const EXAMPLE_LEAD = /^\s*\**\s*(?:exemplos?|modelo)(?!\p{L})/iu
/** Lista de valores de REFERÊNCIA ("Como referência operacional:") informa o processo, não é etapa executável. */
const REFERENCE_LEAD = /(?<!\p{L})refer[êe]ncia(?!\p{L})/iu
const TAG = /\[CP-[0-9a-f]{10}(?:\s*·[^\]]*)?\]\s*/g
/** Marca, no trecho apresentado, da etapa que o Agent PRECISA avaliar (a mesma palavra que o contrato explica). */
export const MUST_ASSESS_TAG = "AVALIAR" as const
export const stripCheckpointTags = (text: string) => text.replace(TAG, "")

type Located = Omit<ProcessCheckpointEntry, "version" | "ref" | "processRequirement" | "assessmentRequirement" | "assessmentBasis" | "primaryProcess"> & { offset: number }

function refOf(entry: Pick<Located, "documentId" | "heading" | "kind" | "sourceText">, occurrence: number): string {
  const key = [entry.documentId, fold(entry.heading ?? ""), entry.kind, normalizeForLiteralQuote(entry.sourceText), String(occurrence)].join("|")
  return `CP-${createHash("sha256").update(key).digest("hex").slice(0, 10)}`
}

/** Etapas de UM trecho apresentado (seção executável), na ordem do texto, com o offset onde a marca entra. */
function locateCheckpoints(excerpt: CatalogExcerpt, content: string): Located[] {
  const sectionRole = sectionProcessRoleIn(content, excerpt.heading, excerpt.documentTitle)
  if (!isExecutableSectionRole(sectionRole)) return []
  const base = { documentId: excerpt.documentId, documentTitle: excerpt.documentTitle, heading: excerpt.heading && excerpt.heading.trim().length > 0 ? excerpt.heading : null, chunkIndex: excerpt.chunkIndex ?? null, sectionRole }
  const text = excerpt.excerpt
  const lines: { text: string; offset: number }[] = []
  let cursor = 0
  for (const raw of text.split("\n")) { lines.push({ text: raw.replace(/\r$/, ""), offset: cursor }); cursor += raw.length + 1 }
  // Pergunta/frase entre aspas prescrita por uma abertura normativa ("Perguntar:\n- “As informações ficaram claras?”") é REGRA
  // (V1.7.1j, segmentos); fala-modelo avulsa continua exemplo e nunca vira etapa.
  const kindOf = (literal: string): KnowledgeContentKind => {
    const kind = knowledgeContentKindOf(content, literal)
    if (kind !== "EXAMPLE_CONTENT") return kind
    const segments = segmentKnowledgeQuote(content, literal)
    return segments.length > 0 && segments.every((segment) => segment.role === "RULE") ? "RULE_CONTENT" : kind
  }
  const behaviorOf = (input: { step: string | null; quote: string; composite: boolean; contentKind: KnowledgeContentKind }) => canonicalBehaviorOf({ step: input.step, quote: input.quote, heading: base.heading, documentTitle: base.documentTitle, contentKind: input.contentKind, composite: input.composite })
  const found: Located[] = []
  const pushItems = (leadIn: string | null, leadOffset: number | null, items: { raw: string; body: string; offset: number; position: number }[], blockText: string) => {
    const composite = leadIn ? compositeListOf(`${leadIn}\n${items.map((item) => item.raw).join("\n")}`) : null
    if (composite && leadOffset !== null) {
      const kind = kindOf(blockText)
      if (kind === "EXAMPLE_CONTENT") return
      const identity = behaviorOf({ step: null, quote: blockText, composite: true, contentKind: kind })
      found.push({ ...base, kind: "COMPOSITE_LIST", segmentRole: kind === "DO_NOT_CONTENT" ? "AVOID" : "RULE", leadIn, position: null, sourceText: blockText, stepText: leadIn ?? blockText, composite: true, canonicalBehavior: identity?.behavior ?? null, facets: identity?.facets ?? [], offset: leadOffset })
      return
    }
    for (const item of items) {
      const kind = kindOf(item.raw)
      if (kind === "EXAMPLE_CONTENT" || item.body.trim().length === 0) continue
      const identity = behaviorOf({ step: item.body, quote: item.raw, composite: false, contentKind: kind })
      found.push({ ...base, kind: "LIST_ITEM", segmentRole: kind === "DO_NOT_CONTENT" ? "AVOID" : "RULE", leadIn, position: item.position, sourceText: item.raw, stepText: item.body, composite: false, canonicalBehavior: identity?.behavior ?? null, facets: identity?.facets ?? [], offset: item.offset })
    }
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const value = line.text.trim()
    if (value.length === 0 || HEADING.test(line.text)) { index += 1; continue }
    // Lista em linhas: bloco de itens (linhas em branco entre itens não quebram); a abertura é a linha anterior com ":".
    if (isListLine(line.text)) {
      const block: { raw: string; body: string; offset: number; position: number }[] = []
      let end = index
      while (end < lines.length && (isListLine(lines[end]!.text) || (lines[end]!.text.trim() === "" && end + 1 < lines.length && isListLine(lines[end + 1]!.text)))) {
        const current = lines[end]!
        if (isListLine(current.text)) {
          const marker = listMarkerOf(current.text)!
          const lead = current.text.length - current.text.trimStart().length
          block.push({ raw: current.text.trim(), body: marker.body.trim(), offset: current.offset + lead, position: block.length + 1 })
        }
        end += 1
      }
      let leadIndex = index - 1
      while (leadIndex >= 0 && lines[leadIndex]!.text.trim() === "") leadIndex -= 1
      const leadLine = leadIndex >= 0 && !HEADING.test(lines[leadIndex]!.text) && lines[leadIndex]!.text.trim().endsWith(":") && !isListLine(lines[leadIndex]!.text) ? lines[leadIndex]! : null
      const leadIn = leadLine ? leadLine.text.trim() : null
      // A lista composta cita o trecho LITERAL da abertura ao último item (como está no trecho apresentado).
      const blockStart = leadLine ? leadLine.offset + (leadLine.text.length - leadLine.text.trimStart().length) : block[0]!.offset
      const last = block[block.length - 1]!
      const blockText = text.slice(blockStart, last.offset + last.raw.length)
      if (!(leadIn && (EXAMPLE_LEAD.test(leadIn) || REFERENCE_LEAD.test(leadIn)))) pushItems(leadIn, leadLine ? blockStart : null, block, blockText)
      index = end
      continue
    }
    // Enumeração em linha: "Antes de encerrar qualquer chamada: (1) …; (2) …".
    const inline = inlineEnumerationOf(line.text)
    if (inline) {
      const items: { raw: string; body: string; offset: number; position: number }[] = []
      let from = 0
      const starts = inline.items.map((item) => { const at = line.text.indexOf(item.marker, from); from = at + item.marker.length; return at })
      inline.items.forEach((item, position) => {
        const start = starts[position]!
        const end = position + 1 < starts.length ? starts[position + 1]! : line.text.length
        items.push({ raw: line.text.slice(start, end).trim(), body: item.text, offset: line.offset + start, position: position + 1 })
      })
      const leadOffset = inline.leadIn ? line.offset + line.text.indexOf(inline.leadIn) : null
      const blockText = line.text.trim()
      pushItems(inline.leadIn, leadOffset, items, blockText)
      index += 1
      continue
    }
    // Frase normativa (ou do que evitar) fora de lista; abertura de lista/exemplo não é etapa.
    const nextNonEmpty = lines.slice(index + 1).find((next) => next.text.trim().length > 0)
    const opensList = value.endsWith(":") && nextNonEmpty !== undefined && isListLine(nextNonEmpty.text)
    if (!QUOTED_START.test(value) && !EXAMPLE_LEAD.test(value) && !opensList && !value.endsWith(":")) {
      const kind = kindOf(value)
      // Normativa = verbo de obrigação ("deverá", "deve", "é obrigatório") OU frase que começa pela ação (imperativo/infinitivo de
      // verbo conhecido, inclusive depois de circunstância: "Antes de abrir a contestação, confirme…", "Informe ao cliente…").
      if (kind === "DO_NOT_CONTENT" || (kind === "RULE_CONTENT" && (NORMATIVE.test(value) || ruleActionOf(value) !== null))) {
        const identity = behaviorOf({ step: null, quote: value, composite: false, contentKind: kind })
        found.push({ ...base, kind: "SENTENCE", segmentRole: kind === "DO_NOT_CONTENT" ? "AVOID" : "RULE", leadIn: null, position: null, sourceText: value, stepText: stripListMarker(value), composite: false, canonicalBehavior: identity?.behavior ?? null, facets: identity?.facets ?? [], offset: line.offset + (line.text.length - line.text.trimStart().length) })
      }
    }
    index += 1
  }
  return found
}

/**
 * Catálogo das etapas dos trechos APRESENTADOS (a mesma função no prompt e na verificação). `contentOf` = conteúdo publicado do
 * documento (papel da seção e tipo do trecho); `coveragePlan` = o plano de cobertura desta avaliação está ativo.
 */
export function buildProcessCheckpointCatalog(input: { excerpts: readonly CatalogExcerpt[]; contentOf: (documentId: string) => string | null | undefined; subject: string | null | undefined; coveragePlan: boolean }): ProcessCheckpointCatalog & { located: (Located & { ref: string })[] } {
  const documents = [...new Map(input.excerpts.map((excerpt) => [excerpt.documentId, { documentId: excerpt.documentId, documentTitle: excerpt.documentTitle }])).values()]
  const primary = selectPrimaryProcessDocument(documents, input.subject).primaryDocumentId
  const occurrences = new Map<string, number>()
  const located = input.excerpts.flatMap((excerpt) => {
    const content = input.contentOf(excerpt.documentId)
    if (!content) return []
    return locateCheckpoints(excerpt, content).map((entry) => {
      const key = [entry.documentId, fold(entry.heading ?? ""), entry.kind, normalizeForLiteralQuote(entry.sourceText)].join("|")
      const occurrence = occurrences.get(key) ?? 0
      occurrences.set(key, occurrence + 1)
      return { ...entry, ref: refOf(entry, occurrence) }
    })
  })
  const processRequired = (entry: Omit<Located, "offset">) => input.coveragePlan && primary !== null && entry.documentId === primary && entry.kind === "COMPOSITE_LIST" && closingSectionRoleOf(entry.heading ?? "", entry.documentTitle) === "RECAP"
  const entries: ProcessCheckpointEntry[] = located.map((item) => { const { offset, ...entry } = item; void offset; return entry }).map((entry) => ({
    version: PROCESS_CHECKPOINT_CATALOG_VERSION,
    ...entry,
    processRequirement: processRequired(entry) ? "REQUIRED" : "NOT_DECLARED",
    assessmentRequirement: "MAY_ASSESS",
    assessmentBasis: null,
    primaryProcess: entry.documentId === primary,
  }))
  return { version: PROCESS_CHECKPOINT_CATALOG_VERSION, entries: planAssessmentCoverage(entries, input.coveragePlan), primaryDocumentId: primary, coveragePlan: input.coveragePlan, located }
}

/**
 * PLANEJADOR DE COBERTURA (`ASSESSMENT_COVERAGE_PLAN_V1`, determinístico, sem LLM, sem nome de etapa escrito no código). Com o
 * plano ativo, MUST_ASSESS é um conjunto PEQUENO e explícito:
 *   (a) toda etapa obrigatória NO PROCESSO (processRequirement REQUIRED — a recapitulação composta do documento primário);
 *   (b) para cada COMPORTAMENTO CANÔNICO (vocabulário fechado do sistema) presente em etapas de REGRA do documento PRIMÁRIO do
 *       processo, UMA etapa-representante (do checklist do processo, senão de seção de procedimento, senão a primeira apresentada)
 *       — identificação da cobrança, verificação do
 *       pagamento, tratativa, prazo, protocolo, confirmação… saem da base, nunca de uma lista por processo.
 * Documento transversal e fonte de apoio nunca viram MUST_ASSESS sozinhos. Outras etapas do MESMO comportamento continuam
 * MAY_ASSESS (e satisfazem a cobertura da representante — `mustAssessSatisfiedBy`); as do comportamento de uma etapa obrigatória
 * no processo são SUPPORT_ONLY. Etapa sem comportamento canônico (cauda longa) é MAY_ASSESS. Sem plano: nada é MUST_ASSESS.
 * Roda de novo depois da governança do Checkpoint Registry (só etapas ativas entram no plano).
 */
export function planAssessmentCoverage<T extends Omit<ProcessCheckpointEntry, "assessmentRequirement" | "assessmentBasis"> & Partial<Pick<ProcessCheckpointEntry, "assessmentRequirement" | "assessmentBasis">>>(entries: readonly T[], coveragePlan: boolean): (T & Pick<ProcessCheckpointEntry, "assessmentRequirement" | "assessmentBasis">)[] {
  const requiredBehaviors = new Set(entries.filter((entry) => entry.processRequirement === "REQUIRED").flatMap((entry) => (entry.canonicalBehavior ? [entry.canonicalBehavior] : [])))
  const representatives = new Map<CanonicalBehavior, string>()
  if (coveragePlan) {
    // Preferência da representante: CHECKLIST do processo (vale para toda chamada do processo) → seção de PROCEDIMENTO → as demais
    // (seções de cenário específico, ex. "Linha ou contrato desconhecido", só quando o comportamento não aparece em outro lugar).
    const rank = (entry: T) => (entry.sectionRole === "CHECKLIST" ? 0 : entry.sectionRole === "PROCEDURE_STEP" ? 1 : 2)
    const candidates = entries.map((entry, order) => ({ entry, order })).filter(({ entry }) => entry.primaryProcess && entry.segmentRole === "RULE" && entry.canonicalBehavior && entry.processRequirement !== "REQUIRED" && !requiredBehaviors.has(entry.canonicalBehavior))
    for (const { entry } of candidates.sort((a, b) => rank(a.entry) - rank(b.entry) || a.order - b.order)) if (!representatives.has(entry.canonicalBehavior!)) representatives.set(entry.canonicalBehavior!, entry.ref)
  }
  const chosen = new Set(representatives.values())
  return entries.map((entry) => {
    if (coveragePlan && entry.processRequirement === "REQUIRED") return { ...entry, assessmentRequirement: "MUST_ASSESS" as const, assessmentBasis: "PROCESS_REQUIRED" as const }
    if (chosen.has(entry.ref)) return { ...entry, assessmentRequirement: "MUST_ASSESS" as const, assessmentBasis: "PRIMARY_PROCESS_BEHAVIOR" as const }
    if (entry.canonicalBehavior && requiredBehaviors.has(entry.canonicalBehavior)) return { ...entry, assessmentRequirement: "SUPPORT_ONLY" as const, assessmentBasis: null }
    return { ...entry, assessmentRequirement: "MAY_ASSESS" as const, assessmentBasis: null }
  })
}

/**
 * Uma etapa MUST_ASSESS está COBERTA quando o Agent devolveu uma disposição para ela — ou, na representante de um comportamento,
 * para OUTRA etapa apresentada do MESMO comportamento canônico (a convergência trata as fontes; exigir o código exato só geraria
 * reparos inúteis). A etapa obrigatória no processo exige o próprio código (tem completude determinística própria).
 */
export function mustAssessSatisfiedBy(entry: Pick<ProcessCheckpointEntry, "ref" | "assessmentBasis" | "canonicalBehavior">, assessedRefs: ReadonlySet<string>, catalog: Pick<ProcessCheckpointCatalog, "entries">): string | null {
  if (assessedRefs.has(entry.ref)) return entry.ref
  if (entry.assessmentBasis !== "PRIMARY_PROCESS_BEHAVIOR" || !entry.canonicalBehavior) return null
  return catalog.entries.find((other) => other.ref !== entry.ref && other.segmentRole === "RULE" && other.canonicalBehavior === entry.canonicalBehavior && assessedRefs.has(other.ref))?.ref ?? null
}
/** Etapas MUST_ASSESS sem disposição nesta avaliação (a lista que a auditoria de cobertura registra). */
export const missingMustAssessOf = (catalog: Pick<ProcessCheckpointCatalog, "entries">, assessedRefs: ReadonlySet<string>): ProcessCheckpointEntry[] =>
  catalog.entries.filter((entry) => entry.assessmentRequirement === "MUST_ASSESS" && mustAssessSatisfiedBy(entry, assessedRefs, catalog) === null)

/** Marca as etapas no texto do trecho ("[CP-… ] - [ ] Forneci protocolo?"; avaliação obrigatória: "[CP-… · AVALIAR]"). */
export function renderExcerptWithCheckpoints(excerpt: CatalogExcerpt, catalog: ProcessCheckpointCatalog & { located: (Located & { ref: string })[] }): string {
  const marks = catalog.located.filter((entry) => entry.documentId === excerpt.documentId && (entry.chunkIndex ?? null) === (excerpt.chunkIndex ?? null) && fold(entry.heading ?? "") === fold(excerpt.heading ?? ""))
  const requirement = new Map(catalog.entries.map((entry) => [entry.ref, entry.assessmentRequirement]))
  let text = excerpt.excerpt
  for (const mark of [...marks].sort((a, b) => b.offset - a.offset)) {
    const tag = requirement.get(mark.ref) === "MUST_ASSESS" ? `[${mark.ref} · ${MUST_ASSESS_TAG}] ` : `[${mark.ref}] `
    text = `${text.slice(0, mark.offset)}${tag}${text.slice(mark.offset)}`
  }
  return text
}

/**
 * Como a citação da base que o modelo trouxe se relaciona com a etapa escolhida pelo checkpointRef. NUNCA muda a identidade:
 *   ABSENT (sem citação) · EXACT · CONTAINS_STEP (a citação contém a etapa) · SPANS_SIBLINGS (contém a etapa e outras etapas —
 *   ampla demais: recusada como citação, a identidade continua a do código) · WITHIN_STEP (trecho da própria etapa) ·
 *   SAME_SECTION (outro trecho da MESMA seção apresentada, sem ser outra etapa — contexto da mesma regra) · OTHER_CHECKPOINT (a
 *   citação é OUTRA etapa e não esta: a escolha do modelo é ambígua → QA) · UNRELATED (texto fora da seção da etapa → QA).
 * Marcadores editoriais ("[ ]", "-", "(3)", numeração) e as marcas [CP-…] não contam.
 */
export type SourceQuoteMatch = "ABSENT" | "EXACT" | "CONTAINS_STEP" | "SPANS_SIBLINGS" | "WITHIN_STEP" | "SAME_SECTION" | "OTHER_CHECKPOINT" | "UNRELATED"
/** Citação que torna a escolha da etapa ambígua (QA); as demais não afetam a verificação. */
export const AMBIGUOUS_QUOTE_MATCHES: readonly SourceQuoteMatch[] = ["OTHER_CHECKPOINT", "UNRELATED"]
export function sourceQuoteMatchOf(entry: Pick<ProcessCheckpointEntry, "ref" | "documentId" | "sourceText" | "stepText">, modelQuote: string | null | undefined, siblings: readonly Pick<ProcessCheckpointEntry, "ref" | "documentId" | "stepText">[] = [], sectionText: string | null = null): SourceQuoteMatch {
  if (!modelQuote || modelQuote.trim().length === 0) return "ABSENT"
  const quote = normalizeForLiteralQuote(stripCheckpointTags(modelQuote))
  const source = normalizeForLiteralQuote(entry.sourceText)
  const step = normalizeForLiteralQuote(entry.stepText)
  if (quote === source || quote === step) return "EXACT"
  const others = siblings.filter((other) => other.ref !== entry.ref && other.documentId === entry.documentId).map((other) => normalizeForLiteralQuote(other.stepText)).filter((other) => other.length >= 8 && !step.includes(other) && !other.includes(step))
  if (quote.includes(step) && step.length > 0) return others.some((other) => quote.includes(other)) ? "SPANS_SIBLINGS" : "CONTAINS_STEP"
  if (quote.length >= 12 && source.includes(quote)) return "WITHIN_STEP"
  if (others.some((other) => quote.includes(other) || (quote.length >= 12 && other.includes(quote)))) return "OTHER_CHECKPOINT"
  if (sectionText && quote.length >= 12 && normalizeForLiteralQuote(sectionText).includes(quote)) return "SAME_SECTION"
  return "UNRELATED"
}

/** Identidade da etapa por referência (a única fonte da identidade no contrato V3). */
export const catalogEntryOf = (catalog: Pick<ProcessCheckpointCatalog, "entries"> | null | undefined, ref: string | null | undefined) => (catalog && ref ? catalog.entries.find((entry) => entry.ref === ref.trim()) ?? null : null)
/** Visão do catálogo para o contrato/prompt (sem offsets internos). */
export const publicCatalogOf = (catalog: ProcessCheckpointCatalog): ProcessCheckpointCatalog => ({ version: catalog.version, entries: catalog.entries, primaryDocumentId: catalog.primaryDocumentId, coveragePlan: catalog.coveragePlan })
