import { assignmentScopesOf } from "../../access/application/permission-holders.js"
import { scopeCovers, type AccessScope } from "../../access/domain/access-scope.js"
import { ALL_UNIVERSES_PERMISSION, UNRESTRICTED_PERSON_RULE, isUniverseEnforced, personAllowedByUniverse, personUniverse, type PersonUniverseRule } from "../../operating-universe/application/universe-access.js"
import type { OperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { Queryable } from "./locks.js"

/**
 * ALCANCE de quem acompanha (Coordenador de Anjos e Administrador geral, `human_support.coordinate`; design_draft.md seção 5):
 *  - pedidos, conversas, classificações, avaliações e tentativas sem Anjo: o escopo de quem lê cobre o escopo CONGELADO do registro;
 *  - números da resposta da INIA (M1–M6): pessoas cujo Grupo/Subgrupo ATUAL o escopo cobre;
 *  - presença, pausas e números de um Anjo: o escopo de quem lê cobre ao menos um escopo das atribuições de Anjo da pessoa (D11);
 *    Anjo com escopo de organização, só quem acompanha a organização.
 * Com o universo de atuação ATIVADO na organização, pedidos e tentativas também precisam ser do universo de quem lê — o universo do
 * OPERADOR no cadastro —, salvo `operating_universes.all` num escopo que cubra o lugar congelado do registro (regra de pessoas de
 * `personAllowedByUniverse`; "Minha estrutura" não vale, como no resto do Apoio). Desligado, nada muda.
 * O SQL recebe só ids e o código do universo como parâmetros, nunca texto livre.
 */
export type CoordinatorScopes = { organizationWide: boolean; teamIds: string[]; subteamIds: string[]; scopes: AccessScope[]; universe: PersonUniverseRule }

const visibilityOfScopes = (scopes: readonly AccessScope[]) => ({
  organizationWide: scopes.some((scope) => scope.type === "ORGANIZATION"),
  teamIds: scopes.flatMap((scope) => (scope.type === "GROUP" ? [scope.teamId] : [])),
  subteamIds: scopes.flatMap((scope) => (scope.type === "SUBGROUP" ? [scope.subteamId] : [])),
})

/** Regra de universo de quem acompanha: o próprio universo e onde tem a permissão de todos (fora de "Minha estrutura"). */
export async function coordinatorUniverseRule(db: Queryable, organizationId: string, personId: string): Promise<PersonUniverseRule> {
  if (!(await isUniverseEnforced(db, organizationId))) return UNRESTRICTED_PERSON_RULE
  const [own, cross] = await Promise.all([personUniverse(db, organizationId, personId), assignmentScopesOf(db, organizationId, ALL_UNIVERSES_PERMISSION, [personId])])
  return { enforced: true, own, cross: visibilityOfScopes(cross.get(personId) ?? []), crossInStructure: false }
}

export async function coordinatorScopesOf(db: Queryable, organizationId: string, personId: string): Promise<CoordinatorScopes> {
  const [assignments, universe] = await Promise.all([assignmentScopesOf(db, organizationId, "human_support.coordinate", [personId]), coordinatorUniverseRule(db, organizationId, personId)])
  const scopes = assignments.get(personId) ?? []
  return { ...visibilityOfScopes(scopes), scopes, universe }
}

/**
 * Cláusula SQL do alcance sobre um registro com `team_id`/`subteam_id` congelados, mais o filtro da tela. `personColumn` = a coluna do
 * registro com quem pediu (`operator_person_id` no pedido, `person_id` na tentativa sem Anjo), para o filtro de universo.
 */
export function coverageClause(coverage: CoordinatorScopes, alias: string, params: unknown[], filter: { teamId?: string | null | undefined; subteamId?: string | null | undefined }, personColumn: "operator_person_id" | "person_id"): string {
  const add = (value: unknown) => `$${params.push(value)}`
  const clauses: string[] = []
  if (!coverage.organizationWide) clauses.push(`(${alias}.team_id = any(${add(coverage.teamIds)}::uuid[]) or ${alias}.subteam_id = any(${add(coverage.subteamIds)}::uuid[]))`)
  const universe = coverage.universe
  if (universe.enforced && !universe.cross.organizationWide) {
    const own = universe.own ? [`exists (select 1 from people up where up.id = ${alias}.${personColumn} and up.operating_universe = ${add(universe.own)})`] : []
    clauses.push(`(${[`${alias}.team_id = any(${add(universe.cross.teamIds)}::uuid[])`, `${alias}.subteam_id = any(${add(universe.cross.subteamIds)}::uuid[])`, ...own].join(" or ")})`)
  }
  if (filter.teamId) clauses.push(`${alias}.team_id = ${add(filter.teamId)}::uuid`)
  if (filter.subteamId) clauses.push(`${alias}.subteam_id = ${add(filter.subteamId)}::uuid`)
  return clauses.length > 0 ? clauses.join(" and ") : "true"
}

/** O registro (lugar congelado + universo ATUAL do operador, de `operatorUniverseOf`) está no alcance de quem lê? */
export const coversRecord = (coverage: CoordinatorScopes, record: { teamId: string | null; subteamId: string | null; operatorUniverse: OperatingUniverse | null }) =>
  (coverage.organizationWide || (record.teamId !== null && coverage.teamIds.includes(record.teamId)) || (record.subteamId !== null && coverage.subteamIds.includes(record.subteamId))) &&
  personAllowedByUniverse(coverage.universe, { id: "", teamId: record.teamId, subteamId: record.subteamId, operatingUniverse: record.operatorUniverse }, false)

/** Universo do operador para `coversRecord` — só lido do banco com a exigência ativada (desligada, a regra não o usa). */
export async function operatorUniverseOf(db: Queryable, organizationId: string, coverage: CoordinatorScopes, operatorPersonId: string): Promise<OperatingUniverse | null> {
  return coverage.universe.enforced ? personUniverse(db, organizationId, operatorPersonId) : null
}

/** D11: quem acompanha alcança o Anjo se cobre ao menos um escopo das atribuições de Anjo dele. */
export const reachesAnjo = (coverage: CoordinatorScopes, anjoScopes: readonly AccessScope[]) => anjoScopes.some((anjoScope) => coverage.scopes.some((scope) => scopeCovers(scope, anjoScope)))

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/
/** Período do painel: datas civis reais, início ≤ fim, até 92 dias (422 `PERIOD_TOO_LONG`). */
export function assertPanelPeriod(period: { from: string; to: string }) {
  const valid = (date: string) => CIVIL_DATE.test(date) && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date
  if (!valid(period.from) || !valid(period.to)) throw new DomainError("Informe as datas no formato AAAA-MM-DD.", "VALIDATION_ERROR", 400)
  const days = (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000 + 1
  if (days < 1) throw new DomainError("A data inicial precisa ser antes da final.", "VALIDATION_ERROR", 400)
  if (days > 92) throw new DomainError("Escolha um período de até 92 dias.", "PERIOD_TOO_LONG", 422)
}

/** Início e fim do período no fuso da organização (expressões SQL; `$org`, `$from`, `$to` já nos parâmetros). */
export const periodBounds = (org: string, from: string, to: string) => ({
  start: `((${from})::date)::timestamp at time zone analytics_org_timezone(${org})`,
  end: `((${to})::date + 1)::timestamp at time zone analytics_org_timezone(${org})`,
})

/** Cursor opaco das listas (instante + id), keyset em ordem decrescente. */
export const encodeListCursor = (at: Date, id: string) => Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url")
export function decodeListCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string]
    return typeof at === "string" && typeof id === "string" && !Number.isNaN(Date.parse(at)) ? { at, id } : null
  } catch {
    return null
  }
}
