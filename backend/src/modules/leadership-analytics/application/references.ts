import { DomainError } from "../../../shared/domain/domain-error.js"
import { clampToClosedReferencePeriod } from "../../indicators/domain/official-closure-policy.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { describeSubject, resolveDefaultSubject, resolveSubject, visibleOperators, type ResolvedSubject, type ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { buildAnalyticsSubject, isStructureSubject } from "../../performance-analytics/domain/analytics-subject.js"
import { isHierarchyRole, ROLE_LABELS, STRUCTURE_KIND_BY_ROLE } from "../../performance-analytics/domain/hierarchy-levels.js"
import { longPeriodLabel, parseReferencePeriod, previousReferencePeriod } from "../../performance-analytics/domain/reference-period.js"
import type { PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { StructureAnchor } from "../../workflows/domain/structure-anchor-schema.js"
import { LOW_COVERAGE_THRESHOLD, matchesAllTokens, normalizeForMatch } from "../domain/analytic-rules.js"
import type { StructureRef } from "../domain/view-models.js"
import { PRV_DEFINITION } from "./official-query.js"

/**
 * Referências em linguagem natural ("a equipe do Carlos", "TMA", "agosto") → sujeito, indicador e competência, SEMPRE dentro
 * do escopo da sessão (`ViewerScope`). Um nome fora do escopo recebe a mesma resposta de um nome inexistente — nunca revela
 * que a estrutura existe. Ambiguidade devolve candidatos para a INIA perguntar; nada é escolhido por palpite.
 */

export type ReferenceOutcome<T> = { kind: "OK"; value: T } | { kind: "AMBIGUOUS"; candidates: string[] } | { kind: "NOT_FOUND"; message: string }

export type ResolvedStructure = { subject: StructureAnchor; resolved: ResolvedSubject; ref: StructureRef }

const SELF_WORDS = new Set(["minha", "meu", "minha equipe", "meu time", "minha estrutura", "minha area", "equipe", "time", "estrutura", "eu", "minha operacao"])
const MAX_CANDIDATES = 6

export type StructureCandidate = { subject: StructureAnchor; label: string; description: string }

function toResolved(scope: ViewerScope, subject: StructureAnchor): ResolvedStructure {
  const resolved = resolveSubject(scope, subject)
  return { subject, resolved, ref: { subject, label: resolved.descriptor.label, description: resolved.descriptor.description } }
}

/** Estruturas que o escopo alcança (líderes visíveis, Grupos e Subgrupos) — também a lista de escolha dos reports. */
export function structureCandidates(scope: ViewerScope): StructureCandidate[] {
  const leaders: PersonNode[] = [scope.viewer, ...scope.nodes.values()].filter((node) => node.active && isHierarchyRole(node.role))
  const candidates: StructureCandidate[] = leaders.map((leader) => {
    const subject = buildAnalyticsSubject(STRUCTURE_KIND_BY_ROLE[leader.role as keyof typeof STRUCTURE_KIND_BY_ROLE], leader.id) as StructureAnchor
    return { subject, label: leader.name, description: ROLE_LABELS[leader.role as PlatformRole] ?? leader.role }
  })
  const teams = new Map<string, string>()
  const subteams = new Map<string, string>()
  for (const operator of visibleOperators(scope)) {
    if (operator.teamId && operator.teamName) teams.set(operator.teamId, operator.teamName)
    if (operator.subteamId && operator.subteamName) subteams.set(operator.subteamId, operator.subteamName)
  }
  for (const [id, name] of teams) candidates.push({ subject: buildAnalyticsSubject("TEAM", id) as StructureAnchor, label: name, description: "Grupo" })
  for (const [id, name] of subteams) candidates.push({ subject: buildAnalyticsSubject("SUBTEAM", id) as StructureAnchor, label: name, description: "Subgrupo" })
  return candidates
}

/**
 * Estrutura pedida: nada/"minha" = a estrutura que a pessoa lidera; `subjectKind/subjectId` (vindo de um cartão anterior) =
 * validado contra o escopo; nome = líderes, Grupos e Subgrupos VISÍVEIS. O sujeito resolvido passa sempre por `resolveSubject`.
 */
export function resolveStructureReference(scope: ViewerScope, reference: { name?: string | null; subjectKind?: string | null; subjectId?: string | null }): ReferenceOutcome<ResolvedStructure> {
  const notFound = (message: string) => ({ kind: "NOT_FOUND" as const, message })
  try {
    if (reference.subjectKind && reference.subjectId) {
      const subject = buildAnalyticsSubject(reference.subjectKind, reference.subjectId)
      if (!isStructureSubject(subject)) return notFound("Essa referência não é uma estrutura.")
      return { kind: "OK", value: toResolved(scope, subject) }
    }
    const name = reference.name?.trim() ?? ""
    if (!name || SELF_WORDS.has(normalizeForMatch(name))) {
      const fallback = resolveDefaultSubject(scope)
      if (fallback && isStructureSubject(fallback.subject)) return { kind: "OK", value: toResolved(scope, fallback.subject) }
      return notFound("Seu perfil não lidera uma estrutura; diga qual equipe, Grupo ou Subgrupo do seu acesso você quer analisar.")
    }
    const normalized = normalizeForMatch(name)
    const candidates = structureCandidates(scope)
    const exact = candidates.filter((candidate) => normalizeForMatch(candidate.label) === normalized)
    const matches = exact.length > 0 ? exact : candidates.filter((candidate) => matchesAllTokens(candidate.label, name))
    if (matches.length === 1) return { kind: "OK", value: toResolved(scope, matches[0]!.subject) }
    if (matches.length > 1) return { kind: "AMBIGUOUS", candidates: matches.slice(0, MAX_CANDIDATES).map((candidate) => `${candidate.label} (${candidate.description})`) }
    return notFound(`Não encontrei "${name}" entre as estruturas que você pode consultar.`)
  } catch (error) {
    if (error instanceof DomainError) return notFound("Não encontrei essa estrutura entre as que você pode consultar.")
    throw error
  }
}

/** Indicador pelo código ou nome do catálogo (ativo ou não — o histórico de um inativo continua consultável). */
/** "PRV", "resultado geral", "quartil geral": o resultado geral da pessoa (conceito da plataforma, não um código do catálogo). */
const PRV_WORDS = new Set(["prv", "prv geral", "geral", "resultado geral", "quartil geral", "resultado consolidado da pessoa"])

export function resolveIndicatorReference(definitions: readonly IndicatorDefinitionRow[], reference: string | null | undefined): ReferenceOutcome<IndicatorDefinitionRow> {
  const text = reference?.trim() ?? ""
  if (!text) return { kind: "NOT_FOUND", message: "Diga qual indicador analisar." }
  if (PRV_WORDS.has(normalizeForMatch(text))) return { kind: "OK", value: PRV_DEFINITION }
  const byCode = definitions.find((definition) => definition.code.toUpperCase() === text.toUpperCase())
  if (byCode) return { kind: "OK", value: byCode }
  const normalized = normalizeForMatch(text)
  const exact = definitions.filter((definition) => normalizeForMatch(definition.name) === normalized)
  const matches = exact.length > 0 ? exact : definitions.filter((definition) => matchesAllTokens(definition.name, text) || matchesAllTokens(definition.code.replace(/_/g, " "), text))
  if (matches.length === 1) return { kind: "OK", value: matches[0]! }
  if (matches.length > 1) return { kind: "AMBIGUOUS", candidates: matches.slice(0, MAX_CANDIDATES).map((definition) => `${definition.name} (${definition.code})`) }
  return { kind: "NOT_FOUND", message: `Não encontrei o indicador "${text}" no catálogo.` }
}

export type AnalysisPeriod = { period: string; requested: boolean; note: string | null }

/** Competências examinadas para achar a mais recente com cobertura adequada. */
const PERIODS_EXAMINED = 4

/**
 * Competência: a pedida (AAAA-MM, limitada ao último fechamento) ou, por padrão, a MAIS RECENTE com cobertura adequada (≥ 70% das
 * pessoas com alguma linha oficial). Um fechamento parcial mais novo não vira o padrão — a nota diz que ele existe e quanto cobre,
 * e a pessoa pode pedi-lo. Sem nenhuma competência com cobertura adequada, a mais recente com dado (e a nota avisa).
 */
export async function resolveAnalysisPeriod(repository: AnalyticsReadRepository, scope: ViewerScope, memberIds: string[], requested: string | null | undefined, closure: { lastClosedPeriod: string; now: Date; timeZone: string }): Promise<AnalysisPeriod> {
  if (requested) {
    try {
      return { period: clampToClosedReferencePeriod(parseReferencePeriod(requested), closure.now, closure.timeZone), requested: true, note: null }
    } catch {
      // Formato inválido vindo do modelo: cai no padrão (a resposta diz qual competência foi usada).
    }
  }
  const coverage = await repository.loadPeriodCoverage(scope.organizationId, memberIds, closure.lastClosedPeriod, PERIODS_EXAMINED)
  const total = memberIds.length
  const adequate = coverage.find((entry) => total > 0 && entry.people / total >= LOW_COVERAGE_THRESHOLD)
  const latest = coverage[0]
  if (!latest) return { period: closure.lastClosedPeriod, requested: false, note: `Nenhuma competência fechada tem dado oficial para esta estrutura.` }
  if (!adequate) return { period: latest.period, requested: false, note: `Nenhuma competência recente tem dado para ao menos 70% da estrutura; usando ${longPeriodLabel(latest.period)} (${latest.people} de ${total} pessoas com dado).` }
  if (adequate.period !== latest.period) return { period: adequate.period, requested: false, note: `${longPeriodLabel(latest.period)} tem fechamento parcial (${latest.people} de ${total} pessoas com dado); a análise usa ${longPeriodLabel(adequate.period)}, a competência mais recente completa. Peça ${longPeriodLabel(latest.period)} se quiser o parcial.` }
  return { period: adequate.period, requested: false, note: null }
}

/**
 * Competência padrão quando a pergunta é sobre indicadores ESPECÍFICOS (ou o PRV): a mais recente em que ao menos 70% da estrutura
 * tem dado DESSES indicadores — um mês completo nos demais indicadores pode ser parcial justamente no pedido. Só recua até 3 meses.
 */
export async function periodCoveredFor(repository: AnalyticsReadRepository, scope: ViewerScope, memberIds: string[], codes: string[], start: AnalysisPeriod): Promise<AnalysisPeriod> {
  if (start.requested || codes.length === 0 || memberIds.length === 0) return start
  const candidates = [start.period, previousReferencePeriod(start.period), previousReferencePeriod(previousReferencePeriod(start.period))]
  const wantsPrv = codes.includes(PRV_DEFINITION.code)
  const [rows, prv] = await Promise.all([repository.loadIndicatorPerformance(scope.organizationId, memberIds, candidates), wantsPrv ? repository.loadPrvPerformance(scope.organizationId, memberIds, candidates) : Promise.resolve([])])
  const peopleIn = (period: string) => new Set([...rows.filter((row) => row.referencePeriod === period && codes.includes(row.indicatorCode)), ...prv.filter((row) => row.referencePeriod === period)].map((row) => row.personId)).size
  const chosen = candidates.find((period) => peopleIn(period) / memberIds.length >= LOW_COVERAGE_THRESHOLD)
  if (!chosen || chosen === start.period) return start
  return { period: chosen, requested: false, note: `${longPeriodLabel(start.period)} tem dado do que foi pedido para só ${peopleIn(start.period)} de ${memberIds.length} pessoas; a análise usa ${longPeriodLabel(chosen)}, a competência mais recente completa para esse pedido.` }
}

export function describeStructure(scope: ViewerScope, subject: StructureAnchor): StructureRef {
  const descriptor = describeSubject(scope, subject)
  return { subject, label: descriptor.label, description: descriptor.description }
}
