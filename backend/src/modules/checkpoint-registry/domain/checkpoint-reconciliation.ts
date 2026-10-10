import { normalizeForLiteralQuote } from "../../knowledge/domain/knowledge-match.js"
import { terms } from "../../reliable-feedback/domain/verified-omission.js"
import type { CheckpointCandidate } from "./checkpoint-extraction.js"

/**
 * CHECKPOINT REGISTRY — RECONCILIAÇÃO (design time, pura, determinística, sem modelo).
 *
 * Quando a base muda, os candidatos da versão nova são comparados com o registry — nunca só por igualdade de texto:
 *
 *   UNCHANGED                mesmo literal (mesmo código de etapa, ou a mesma frase numa seção renumerada) → mesma identidade;
 *   SEMANTICALLY_EQUIVALENT  a MESMA obrigação reescrita (mesma seção/comportamento, alta sobreposição de termos, sem mudança
 *                            MATERIAL: números, negação, condição) → mesma identidade lógica, nova versão da regra;
 *   MODIFIED                 a mesma obrigação (mesmo comportamento, ou mesma seção + mesma posição/sobreposição) com mudança
 *                            material → mesma identidade lógica, nova versão, revisão administrativa antes de valer;
 *   NEW                      regra sem correspondente;
 *   REMOVED                  regra do registry sem correspondente na versão nova (deixa de valer; histórico preservado);
 *   AMBIGUOUS                o candidato corresponde a 2+ regras com força parecida (ou 2+ candidatos disputam a mesma) →
 *                            revisão humana obrigatória; nenhuma das regras envolvidas é removida em silêncio.
 *
 * Sinais usados: seção (sem a numeração editorial), posição na lista, papel (regra × evitar), tipo (item × lista composta),
 * comportamento canônico, termos de conteúdo, números, negação e condição literal. Um juiz semântico (LLM) pode refinar os
 * casos incertos pela porta `CheckpointEquivalenceJudge` — nunca é obrigatório e nunca cria regra.
 */
export const CHECKPOINT_RECONCILIATION_VERSION = "CHECKPOINT_RECONCILIATION_V1" as const
export type CheckpointChangeKind = "NEW" | "UNCHANGED" | "SEMANTICALLY_EQUIVALENT" | "MODIFIED" | "REMOVED" | "AMBIGUOUS"
export type CheckpointVersionStatus = "PROPOSED" | "ACTIVE" | "NEEDS_REVIEW" | "REJECTED" | "SUPERSEDED" | "REMOVED"

/** Uma regra CORRENTE do registry (última versão de cada definição que ainda não foi substituída nem removida). */
export type RegistryEntry = {
  definitionId: string
  versionId: string
  definitionVersion: number
  status: Exclude<CheckpointVersionStatus, "SUPERSEDED" | "REMOVED">
  checkpointRef: string | null
  kind: CheckpointCandidate["kind"]
  segmentRole: CheckpointCandidate["segmentRole"]
  sectionHeading: string | null
  listPosition: number | null
  sourceLiteral: string
  requirement: string
  applicability: string | null
  canonicalBehavior: string | null
}

export type MatchBasis = "SAME_CHECKPOINT_REF" | "SAME_LITERAL" | "SAME_BEHAVIOR" | "SAME_SECTION" | "SAME_POSITION" | "TERM_OVERLAP"
export type MaterialChange = "NUMBERS" | "NEGATION" | "CONDITION" | "BEHAVIOR"
export type ReconciliationMatch = { previous: RegistryEntry; similarity: number; score: number; basis: MatchBasis[] }
export type ReconciliationItem =
  | { kind: "UNCHANGED" | "SEMANTICALLY_EQUIVALENT" | "MODIFIED"; candidate: CheckpointCandidate; match: ReconciliationMatch; materialChanges: MaterialChange[] }
  | { kind: "NEW"; candidate: CheckpointCandidate }
  | { kind: "REMOVED"; previous: RegistryEntry }
  | { kind: "AMBIGUOUS"; candidate: CheckpointCandidate; matches: ReconciliationMatch[] }
export type CheckpointChangeSet = { version: typeof CHECKPOINT_RECONCILIATION_VERSION; items: ReconciliationItem[]; counts: Record<CheckpointChangeKind, number> }

/** Porta opcional: juiz semântico para pares incertos (MODIFIED por baixa sobreposição). Ausente = só os sinais estruturais. */
export interface CheckpointEquivalenceJudge {
  sameObligation(previous: RegistryEntry, candidate: CheckpointCandidate): Promise<"SAME" | "DIFFERENT" | "UNSURE">
}

const EQUIVALENCE_MIN_SIMILARITY = 0.5
const OVERLAP_ANCHOR_MIN = 0.3
const POSITION_ANCHOR_MIN = 0.2
const MOVED_SECTION_MIN = 0.6
const AMBIGUITY_MARGIN = 0.15

const headingKey = (heading: string | null) => (heading ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/^\s*\d+(?:\.\d+)*\.?\s*/u, "").replace(/\s+/g, " ").trim()
const literalKey = (text: string) => normalizeForLiteralQuote(text)
const numbersOf = (text: string) => new Set(text.match(/\d+(?:[.,]\d+)?/gu) ?? [])
const NEGATION = /(?<!\p{L})(?:n[ãa]o|nunca|jamais|evitar|proibid\p{L}*)(?!\p{L})/iu
const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) => left.size === right.size && [...left].every((value) => right.has(value))
function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1
  const shared = [...left].filter((value) => right.has(value)).length
  return shared / (left.size + right.size - shared)
}

function matchOf(previous: RegistryEntry, candidate: CheckpointCandidate): ReconciliationMatch | null {
  // Papel e tipo são parte da obrigação: "evitar" nunca vira regra positiva; lista composta nunca vira item solto.
  if (previous.segmentRole !== candidate.segmentRole || (previous.kind === "COMPOSITE_LIST") !== (candidate.kind === "COMPOSITE_LIST")) return null
  const basis: MatchBasis[] = []
  const similarity = jaccard(terms(previous.requirement), terms(candidate.requirement))
  const sameHeading = headingKey(previous.sectionHeading) === headingKey(candidate.sectionHeading) && headingKey(candidate.sectionHeading).length > 0
  const sameBehavior = Boolean(previous.canonicalBehavior) && previous.canonicalBehavior === candidate.canonicalBehavior
  const samePosition = previous.listPosition !== null && previous.listPosition === candidate.listPosition
  if (sameBehavior) basis.push("SAME_BEHAVIOR")
  if (sameHeading) basis.push("SAME_SECTION")
  if (sameHeading && samePosition) basis.push("SAME_POSITION")
  if (similarity >= OVERLAP_ANCHOR_MIN) basis.push("TERM_OVERLAP")
  // Mesma posição só ancora com algum termo de conteúdo em comum (a lista trocar um item por OUTRO não é "a mesma obrigação").
  const anchored = sameBehavior || (sameHeading && ((samePosition && similarity >= POSITION_ANCHOR_MIN) || similarity >= OVERLAP_ANCHOR_MIN)) || similarity >= MOVED_SECTION_MIN
  if (!anchored) return null
  const score = similarity + (sameBehavior ? 1 : 0) + (sameHeading ? 0.5 : 0) + (sameHeading && samePosition ? 0.3 : 0)
  return { previous, similarity: Math.round(similarity * 1000) / 1000, score, basis }
}

function materialChangesOf(previous: RegistryEntry, candidate: CheckpointCandidate): MaterialChange[] {
  const changes: MaterialChange[] = []
  if (!sameSet(numbersOf(previous.sourceLiteral), numbersOf(candidate.sourceLiteral))) changes.push("NUMBERS")
  if (NEGATION.test(previous.requirement) !== NEGATION.test(candidate.requirement)) changes.push("NEGATION")
  if (!sameSet(terms(previous.applicability ?? ""), terms(candidate.applicability ?? ""))) changes.push("CONDITION")
  if (previous.canonicalBehavior && candidate.canonicalBehavior && previous.canonicalBehavior !== candidate.canonicalBehavior) changes.push("BEHAVIOR")
  return changes
}

export function reconcileCheckpoints(previousEntries: readonly RegistryEntry[], candidates: readonly CheckpointCandidate[]): CheckpointChangeSet {
  const items: ReconciliationItem[] = []
  const pendingPrevious = new Set(previousEntries)
  const pendingCandidates = new Set(candidates)
  // 1) Mesmo literal: mesmo código de etapa, ou a mesma frase na mesma seção (renumerada) → UNCHANGED.
  for (const candidate of candidates) {
    const same = [...pendingPrevious].find((previous) => previous.checkpointRef === candidate.checkpointRef)
      ?? [...pendingPrevious].find((previous) => literalKey(previous.sourceLiteral) === literalKey(candidate.sourceLiteral) && headingKey(previous.sectionHeading) === headingKey(candidate.sectionHeading) && previous.segmentRole === candidate.segmentRole && previous.kind === candidate.kind)
    if (!same) continue
    pendingPrevious.delete(same)
    pendingCandidates.delete(candidate)
    items.push({ kind: "UNCHANGED", candidate, match: { previous: same, similarity: 1, score: 3, basis: [same.checkpointRef === candidate.checkpointRef ? "SAME_CHECKPOINT_REF" : "SAME_LITERAL"] }, materialChanges: [] })
  }
  // 2) Correspondência pela obrigação (nunca só pelo texto), com detecção de ambiguidade nos dois sentidos.
  const matchesByCandidate = new Map<CheckpointCandidate, ReconciliationMatch[]>()
  for (const candidate of pendingCandidates) {
    const matches = [...pendingPrevious].map((previous) => matchOf(previous, candidate)).filter((match): match is ReconciliationMatch => match !== null).sort((left, right) => right.score - left.score)
    if (matches.length > 0) matchesByCandidate.set(candidate, matches)
  }
  const contenders = (previous: RegistryEntry) => [...matchesByCandidate.entries()].flatMap(([candidate, matches]) => { const found = matches.find((match) => match.previous === previous); return found ? [{ candidate, score: found.score }] : [] }).sort((left, right) => right.score - left.score)
  const ambiguous = new Set<CheckpointCandidate>()
  const heldPrevious = new Set<RegistryEntry>()
  for (const [candidate, matches] of matchesByCandidate) {
    const [best, second] = matches
    const rivals = contenders(best!.previous)
    const contested = rivals.length > 1 && rivals[0]!.score - rivals[1]!.score < AMBIGUITY_MARGIN && rivals.slice(0, 2).some((rival) => rival.candidate === candidate)
    if ((second && best!.score - second.score < AMBIGUITY_MARGIN) || contested) {
      ambiguous.add(candidate)
      const close = matches.filter((match) => best!.score - match.score < AMBIGUITY_MARGIN)
      for (const match of close) heldPrevious.add(match.previous)
      items.push({ kind: "AMBIGUOUS", candidate, matches: close })
    }
  }
  // Pares não ambíguos, do mais forte ao mais fraco (cada regra anterior e cada candidato no máximo uma vez).
  const pairs = [...matchesByCandidate.entries()].filter(([candidate]) => !ambiguous.has(candidate)).flatMap(([candidate, matches]) => matches.filter((match) => !heldPrevious.has(match.previous)).map((match) => ({ candidate, match }))).sort((left, right) => right.match.score - left.match.score)
  for (const { candidate, match } of pairs) {
    if (!pendingCandidates.has(candidate) || !pendingPrevious.has(match.previous)) continue
    pendingCandidates.delete(candidate)
    pendingPrevious.delete(match.previous)
    const materialChanges = materialChangesOf(match.previous, candidate)
    const equivalent = materialChanges.length === 0 && (match.similarity >= EQUIVALENCE_MIN_SIMILARITY || (match.basis.includes("SAME_BEHAVIOR") && match.basis.includes("SAME_SECTION")))
    items.push({ kind: equivalent ? "SEMANTICALLY_EQUIVALENT" : "MODIFIED", candidate, match, materialChanges })
  }
  for (const candidate of pendingCandidates) if (!ambiguous.has(candidate)) items.push({ kind: "NEW", candidate })
  for (const previous of pendingPrevious) if (!heldPrevious.has(previous)) items.push({ kind: "REMOVED", previous })
  const counts: Record<CheckpointChangeKind, number> = { NEW: 0, UNCHANGED: 0, SEMANTICALLY_EQUIVALENT: 0, MODIFIED: 0, REMOVED: 0, AMBIGUOUS: 0 }
  for (const item of items) counts[item.kind] += 1
  return { version: CHECKPOINT_RECONCILIATION_VERSION, items, counts }
}

/**
 * Estado de governança da versão NOVA a partir da reconciliação: a mesma regra mantém o estado (ativa continua ativa; rejeitada
 * continua rejeitada); regra modificada, nova ou ambígua espera o administrador; nada muda de estado por reescrita.
 */
export function statusAfterReconciliation(item: Exclude<ReconciliationItem, { kind: "REMOVED" }>): Exclude<CheckpointVersionStatus, "SUPERSEDED" | "REMOVED"> {
  if (item.kind === "NEW") return "PROPOSED"
  if (item.kind === "AMBIGUOUS" || item.kind === "MODIFIED") return "NEEDS_REVIEW"
  return item.match.previous.status
}
