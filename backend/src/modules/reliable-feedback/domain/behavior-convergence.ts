import { createHash } from "node:crypto"
import type { CheckpointStatus } from "../../agents/domain/process-assessment-contract.js"
import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { isListLine } from "../../knowledge/domain/knowledge-list.js"
import { closingSectionRoleOf } from "../../knowledge/domain/section-roles.js"
import { subjectAnchorTerms } from "../../knowledge/domain/primary-process.js"
import type { KnowledgeVerification, PublishedKnowledgeDocument, VerifiedCheckpoint } from "./process-assessment.js"
import { BEHAVIOR_TITLES, canonicalBehaviorOf, COMPOSITE_SECTION_ROLE, type BehaviorFacet, type CanonicalBehavior } from "./canonical-behavior.js"
import { assessCompleteness, compositeListOf } from "./composite-checkpoint.js"
import { isEligibleProcessCheckpoint } from "./checkpoint-eligibility.js"
import { segmentKnowledgeQuote } from "./knowledge-segments.js"
import { sectionExamplesOf, sectionLinesOf } from "./rule-selection.js"
import { processAnchorOf, STRUCTURED_ANCHOR_VERSION } from "./structured-anchor.js"
import { knowledgeContentKindOf } from "./suggested-response.js"
import { ruleContextOf } from "./verified-omission.js"

/**
 * V1.7.1m — CONVERGÊNCIA DAS FONTES DE UM MESMO COMPORTAMENTO (`BEHAVIOR_CONVERGENCE_V1`, domínio puro, sem LLM).
 *
 *   CanonicalBehavior
 *     ├── source checkpoint A  (PRIMARY: avalia o comportamento)
 *     ├── source checkpoint B  (SUPPORTING: proveniência preservada; não vira outro ponto nem outra observação)
 *     └── source checkpoint C
 *
 * PRECEDÊNCIA (quem avalia): a representação COMPOSTA (lista com subitens) é autoritativa para a completude → documento do
 * processo ESPECÍFICO (título ancorado no assunto; nunca a diretriz transversal) → seção de procedimento antes de checklist e de
 * "evitar" → regra verificada antes de só literal → ordem da avaliação. Uma fonte genérica ("Recapitulei as ações?") nunca
 * transforma PARCIAL em cumprida: ela reforça que houve tentativa.
 *
 * RESOLUÇÃO COMPOSTA: comportamento cuja representação autoritativa é a lista de uma seção de fechamento (RECAPITULATE_INTERACTION
 * → seção de recapitulação) e nenhuma fonte citou essa lista — a lista LITERAL da versão publicada (mesmo documento; senão o único
 * documento do processo que a tem) é avaliada com as MESMAS falas verificadas do operador (subitens, completude, âncora tipada).
 *
 * CONFLITO: fontes do mesmo comportamento com status opostos (cumprida × não cumprida) e sem representação composta autoritativa
 * → nada é escolhido em silêncio: o grupo fica em conflito (QA; observação NEEDS_REVIEW).
 */
export const BEHAVIOR_CONVERGENCE_VERSION = "BEHAVIOR_CONVERGENCE_V1" as const

export type CanonicalRole = "PRIMARY" | "SUPPORTING" | "CONFLICTING"
export type CheckpointCanonical = {
  version: typeof BEHAVIOR_CONVERGENCE_VERSION
  behavior: CanonicalBehavior
  title: string
  /** Facetas DESTA fonte (ex.: prazo + próximo passo). */
  facets: BehaviorFacet[]
  role: CanonicalRole
  primaryRef: string
  groupRefs: string[]
  conflict: boolean
  /** Base da escolha do avaliador (auditoria). */
  precedence: string[]
  /** A lista composta autoritativa foi aplicada a esta fonte (a citação original fica aqui). */
  compositeResolution?: { heading: string | null; documentId: string; fromQuote: string | null; fromHeading: string | null } | null
}
export type BehaviorGroup = { behavior: CanonicalBehavior; facets: BehaviorFacet[]; primaryRef: string; refs: string[]; status: CheckpointStatus; conflict: boolean; composite: boolean; compositeResolved: boolean }

const EVIDENCED: readonly CheckpointStatus[] = ["FOLLOWED", "NOT_FOLLOWED"]
const sha = (text: string) => createHash("sha256").update(text).digest("hex")
const HEADING = /^\s*#{1,6}\s+(.*)$/

/** A lista composta (abertura + itens de DIZER) de uma seção, literal da versão publicada. */
function compositeRuleIn(content: string, heading: string): string | null {
  const section = sectionLinesOf(content, heading)
  if (!section) return null
  for (let index = 0; index < section.length; index += 1) {
    const line = section[index]!.trim()
    if (!line.endsWith(":") || isListLine(line)) continue
    const items: string[] = []
    for (const next of section.slice(index + 1)) {
      const value = next.trim()
      if (value.length === 0 && items.length === 0) continue
      if (!isListLine(value)) break
      items.push(value)
    }
    const rule = [line, ...items].join("\n")
    if (items.length >= 2 && compositeListOf(rule)?.family === "INFORM") return rule
  }
  return null
}

/** Seções de um documento com o papel de fechamento pedido e uma lista composta — exatamente uma, senão nada. */
function compositeSectionOf(document: PublishedKnowledgeDocument, role: "RECAP"): { heading: string; rule: string } | null {
  const found = document.content.split(/\r?\n/).flatMap((line) => { const match = HEADING.exec(line); return match && closingSectionRoleOf(match[1]!, "") === role ? [match[1]!.trim()] : [] })
    .flatMap((heading) => { const rule = compositeRuleIn(document.content, heading); return rule ? [{ heading, rule }] : [] })
  return found.length === 1 ? found[0]! : null
}

type Context = {
  published: ReadonlyMap<string, PublishedKnowledgeDocument>
  subject: string | null
  conversation: readonly string[]
  operatorConversation: readonly string[]
  windowComplete: boolean
}

const usable = (checkpoint: VerifiedCheckpoint) => Boolean(checkpoint.knowledge && checkpoint.knowledge.applicability !== "NOT_VERIFIED" && checkpoint.knowledge.quote && checkpoint.knowledge.documentId)

function rankOf(checkpoint: VerifiedCheckpoint, subject: string | null): number[] {
  const role = checkpoint.checkpointEligibility?.sectionRole ?? "UNKNOWN"
  return [
    checkpoint.completeness ? 0 : 1,
    checkpoint.knowledge && subjectAnchorTerms(checkpoint.knowledge.documentTitle, subject).length > 0 ? 0 : 1,
    role === "CHECKLIST" ? 1 : role === "WARNING" ? 2 : 0,
    checkpoint.knowledge?.applicability === "VERIFIED" ? 0 : 1,
  ]
}
const precedenceOf = (rank: number[]) => [rank[0] === 0 ? "COMPOSITE_AUTHORITATIVE" : null, rank[1] === 0 ? "PROCESS_SPECIFIC_DOCUMENT" : "SUPPLEMENTAL_DOCUMENT", rank[2] === 0 ? "PROCEDURE_SECTION" : rank[2] === 1 ? "CHECKLIST_SECTION" : "WARNING_SECTION", rank[3] === 0 ? "RULE_VERIFIED" : "RULE_LITERAL_ONLY"].filter((entry): entry is string => entry !== null)

/** Aplica a lista composta autoritativa a uma fonte genérica do comportamento (devolve a fonte reavaliada, ou null). */
function resolveComposite(primary: VerifiedCheckpoint, members: readonly VerifiedCheckpoint[], ctx: Context, role: "RECAP"): VerifiedCheckpoint | null {
  const docIds = [...new Set([primary.knowledge!.documentId!, ...members.map((member) => member.knowledge!.documentId!)])]
  const own = docIds.map((id) => ctx.published.get(id)).filter((document): document is PublishedKnowledgeDocument => Boolean(document))
  const specific = [...ctx.published.values()].filter((document) => !docIds.includes(document.documentId) && subjectAnchorTerms(document.title, ctx.subject).length > 0)
  let chosen: { document: PublishedKnowledgeDocument; heading: string; rule: string } | null = null
  for (const pool of [own.slice(0, 1), own.slice(1), specific]) {
    const found = pool.flatMap((document) => { const section = compositeSectionOf(document, role); return section ? [{ document, ...section }] : [] })
    if (found.length === 1) { chosen = found[0]!; break }
    if (found.length > 1) return null
  }
  if (!chosen) return null
  const { document, heading, rule } = chosen
  if (!normalizeForLiteralQuote(document.content).includes(normalizeForLiteralQuote(rule))) return null
  const evidence = members.flatMap((member) => member.transcriptEvidence.filter((unit) => unit.speaker === "OPERADOR").map((unit) => ({ turnRef: unit.turnRef, text: unit.quote })))
  const unique = [...new Map(evidence.map((unit) => [unit.turnRef, unit])).values()]
  const completeness = assessCompleteness({ quote: rule, evidence: unique, operatorConversation: ctx.operatorConversation, windowComplete: ctx.windowComplete })
  if (!completeness) return null
  const typedObserved = completeness.items.filter((item) => item.status === "OBSERVED" && item.kind !== undefined && item.kind !== "LEXICAL")
  const ruleContext = ruleContextOf(document.content, rule, heading)
  const processAnchor = processAnchorOf({ documentTitle: document.title, subject: ctx.subject, heading, leadIn: ruleContext?.leadIn ?? null, conversation: ctx.conversation })
  const anchored = typedObserved.length >= 2 && processAnchor !== null
  const contentKind = knowledgeContentKindOf(document.content, rule)
  const knowledge: KnowledgeVerification = {
    documentId: document.documentId, documentTitle: document.title, heading, version: document.version, quote: rule, literalInPublished: true, presentedInRun: false, anchorTerms: [],
    applicability: anchored ? "VERIFIED" : "LITERAL_ONLY", applicabilityBasis: anchored ? "STRUCTURED_ANCHOR" : null,
    structuredAnchor: anchored ? { version: STRUCTURED_ANCHOR_VERSION, anchored: true, basis: "COMPOSITE_ITEMS_OBSERVED", failure: null, checkpoint: null, proof: { processAnchor, actionStem: null, operatorTurns: [...new Set(typedObserved.flatMap((item) => item.observedTurns))], situationTerms: [], itemTerms: typedObserved.map((item) => item.text), otherStepStems: [], stepTermsInSpeech: [] } } : null,
    leadIn: ruleContext?.leadIn ?? null, failure: null, contentSha256: sha(document.content), contentKind,
    documentOffset: normalizeForLiteralQuote(document.content).indexOf(normalizeForLiteralQuote(rule)), chunkIndex: null, segments: segmentKnowledgeQuote(document.content, rule),
  }
  const status: CheckpointStatus = completeness.status === "PARTIAL" ? "NOT_FOLLOWED" : completeness.status === "COMPLETE" ? "FOLLOWED" : primary.status
  const sectionExamples = sectionExamplesOf(document.content, heading)
  return {
    ...primary,
    status,
    statusDowngradeReason: completeness.status === "PARTIAL" && primary.status === "FOLLOWED" ? "COMPOSITE_PARTIAL" : primary.statusDowngradeReason,
    evidenceType: status === "NOT_FOLLOWED" ? "OBSERVED_ACTION" : primary.evidenceType,
    completeness,
    knowledge,
    operativeRule: null,
    ruleBackfill: null,
    checkpointStep: null,
    sectionExamples: [...new Set([...(primary.sectionExamples ?? []), ...sectionExamples])],
    checkpointEligibility: isEligibleProcessCheckpoint({ content: document.content, heading, documentTitle: document.title, documentId: document.documentId, version: document.version, contentKind, listKind: ruleContext?.listKind ?? null }),
  }
}

/**
 * Identifica o comportamento de cada etapa evidenciada, agrupa as fontes, escolhe quem avalia e marca apoio/conflito.
 * Devolve as etapas (a avaliadora de um comportamento composto pode vir reavaliada pela lista autoritativa) e os grupos.
 */
export function convergeCanonicalBehaviors(checkpoints: readonly VerifiedCheckpoint[], ctx: Context): { checkpoints: VerifiedCheckpoint[]; groups: BehaviorGroup[] } {
  const result = [...checkpoints]
  const members = new Map<CanonicalBehavior, { index: number; facets: BehaviorFacet[] }[]>()
  result.forEach((checkpoint, index) => {
    if (!EVIDENCED.includes(checkpoint.status) || !usable(checkpoint) || checkpoint.checkpointEligibility?.eligible === false) return
    const knowledge = checkpoint.knowledge!
    // V1.7.1n — com etapa de origem (checkpointRef), o comportamento é o do CATÁLOGO — nunca reclassificado pela citação.
    const identity = checkpoint.source
      ? (checkpoint.source.canonicalBehavior ? { behavior: checkpoint.source.canonicalBehavior, facets: [...checkpoint.source.facets] } : null)
      : canonicalBehaviorOf({ step: checkpoint.checkpointStep ?? null, quote: knowledge.quote, heading: knowledge.heading, documentTitle: knowledge.documentTitle, contentKind: knowledge.contentKind ?? null, composite: Boolean(checkpoint.completeness) || compositeListOf(knowledge.quote) !== null })
    if (!identity) return
    members.set(identity.behavior, [...(members.get(identity.behavior) ?? []), { index, facets: identity.facets }])
  })
  const groups: BehaviorGroup[] = []
  for (const [behavior, entries] of members) {
    const ranked = [...entries].sort((a, b) => { const left = rankOf(result[a.index]!, ctx.subject); const right = rankOf(result[b.index]!, ctx.subject); for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return left[i]! - right[i]!; return a.index - b.index })
    const primaryEntry = ranked[0]!
    let primary = result[primaryEntry.index]!
    const sourceCheckpoints = ranked.map((entry) => result[entry.index]!)
    // Resolução composta: comportamento com lista autoritativa que nenhuma fonte citou.
    const compositeRole = COMPOSITE_SECTION_ROLE[behavior]
    let compositeResolved = false
    // Só sobre AÇÃO observada: numa omissão a fala é o momento em que a etapa caberia, não a execução dela.
    const observedSources = sourceCheckpoints.filter((checkpoint) => !checkpoint.omission && checkpoint.evidenceType !== "VERIFIED_OMISSION" && checkpoint.evidenceType !== "UNVERIFIED_OMISSION")
    if (compositeRole && !sourceCheckpoints.some((checkpoint) => checkpoint.completeness) && observedSources.includes(primary)) {
      const resolved = resolveComposite(primary, observedSources, ctx, compositeRole)
      if (resolved) { primary = resolved; compositeResolved = true }
    }
    const composite = Boolean(primary.completeness)
    const statuses = new Set([primary.status, ...ranked.slice(1).map((entry) => result[entry.index]!.status)])
    const conflict = !composite && statuses.size > 1
    const refs = ranked.map((entry) => result[entry.index]!.ref)
    const facets = [...new Set(ranked.flatMap((entry) => entry.facets))]
    const precedence = [...precedenceOf(rankOf(primary, ctx.subject)), ...(compositeResolved ? ["COMPOSITE_RESOLVED_FROM_GENERIC_SOURCE"] : [])]
    const original = result[primaryEntry.index]!
    const base = { version: BEHAVIOR_CONVERGENCE_VERSION, behavior, title: BEHAVIOR_TITLES[behavior], primaryRef: primary.ref, groupRefs: refs, conflict, precedence }
    result[primaryEntry.index] = { ...primary, canonical: { ...base, facets: primaryEntry.facets, role: "PRIMARY", ...(compositeResolved ? { compositeResolution: { heading: primary.knowledge!.heading, documentId: primary.knowledge!.documentId!, fromQuote: original.knowledge?.quote ?? null, fromHeading: original.knowledge?.heading ?? null } } : {}) } }
    for (const entry of ranked.slice(1)) {
      const source = result[entry.index]!
      const role: CanonicalRole = conflict && source.status !== primary.status ? "CONFLICTING" : "SUPPORTING"
      result[entry.index] = { ...source, canonical: { ...base, facets: entry.facets, role } }
    }
    groups.push({ behavior, facets, primaryRef: primary.ref, refs, status: primary.status, conflict, composite, compositeResolved })
  }
  return { checkpoints: result, groups }
}
