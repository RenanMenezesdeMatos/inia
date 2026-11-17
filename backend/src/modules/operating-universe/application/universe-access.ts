import type { Database } from "../../../infrastructure/database/pool.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { canAnywhere, scopesWithPermission, type AccessContext } from "../../access/domain/access-decision.js"
import type { VisibilityFilter } from "../../access/application/access-repository.js"
import { visibilityOf } from "../../access/application/access-service.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { assertUniverseProvided, isOperatingUniverse, optionalOperatingUniverseSchema, universeAccessFor, type OperatingUniverse, type UniverseAccess } from "../domain/operating-universe.js"

/**
 * LEITURA ÚNICA da abrangência de universos (backend é a autoridade). Toda consulta operacional que segmenta por universo passa por
 * aqui: o universo do colaborador vem do banco (nunca do token, da pergunta ou do parâmetro da tela) e a permissão de todos os universos
 * vem das atribuições de papel (`operating_universes.all`) — com o ESCOPO delas (Grupo/Subgrupo/organização/minha estrutura).
 */
type Queryable = Pick<Database, "query">

export const ALL_UNIVERSES_PERMISSION = "operating_universes.all" as const

/** A organização já ativou a exigência e o filtro por universo? Antes disso nada é filtrado (fase de classificação do legado). */
export async function isUniverseEnforced(db: Queryable, organizationId: string): Promise<boolean> {
  const row = (await db.query<{ enforced: boolean }>(`select operating_universe_enforced_at is not null enforced from organizations where id = $1`, [organizationId])).rows[0]
  return row?.enforced ?? false
}

export async function personUniverse(db: Queryable, organizationId: string, personId: string): Promise<OperatingUniverse | null> {
  const value = (await db.query<{ operating_universe: string | null }>(`select operating_universe from people where id = $1 and organization_id = $2`, [personId, organizationId])).rows[0]?.operating_universe ?? null
  return isOperatingUniverse(value) ? value : null
}

/**
 * Regra de PESSOAS (analytics, Equipe, ficha, ferramentas da liderança, exportações): a pessoa entra se for do universo do viewer, ou se o
 * escopo da permissão de todos os universos a alcançar (aí inclusive pendente — quem pode ver todos vê também quem falta classificar).
 */
export type PersonUniverseRule = {
  enforced: boolean
  own: OperatingUniverse | null
  /** Onde a conta tem `operating_universes.all` (Grupo/Subgrupo/organização). */
  cross: VisibilityFilter
  /** `operating_universes.all` com escopo "Minha estrutura": vale para a subárvore de quem tem o papel. */
  crossInStructure: boolean
}

export const UNRESTRICTED_PERSON_RULE: PersonUniverseRule = { enforced: false, own: null, cross: { organizationWide: true, teamIds: [], subteamIds: [] }, crossInStructure: false }

export type UniversePerson = { id: string; teamId: string | null; subteamId: string | null; operatingUniverse: string | null }

export function personAllowedByUniverse(rule: PersonUniverseRule, person: UniversePerson, inViewerStructure: boolean): boolean {
  if (!rule.enforced) return true
  // Liderança vê a PRÓPRIA estrutura (quem responde a ela) em qualquer universo: um supervisor pode liderar equipes B2C e B2B
  // (resposta do usuário, 16/11). O universo limita o que vem dos PAPÉIS de acesso (Grupo/Subgrupo/organização), não a hierarquia.
  if (inViewerStructure) return true
  const cross = rule.cross
  if (cross.organizationWide || (person.teamId !== null && cross.teamIds.includes(person.teamId)) || (person.subteamId !== null && cross.subteamIds.includes(person.subteamId))) return true
  if (rule.crossInStructure && inViewerStructure) return true
  return rule.own !== null && person.operatingUniverse === rule.own
}

export function personRuleFor(access: AccessContext, enforced: boolean, own: OperatingUniverse | null): PersonUniverseRule {
  return {
    enforced,
    own,
    cross: visibilityOf(access, ALL_UNIVERSES_PERMISSION),
    crossInStructure: scopesWithPermission(access, ALL_UNIVERSES_PERMISSION).some((scope) => scope.type === "MY_STRUCTURE"),
  }
}

export async function loadPersonUniverseRule(db: Queryable, user: { organizationId: string; sub: string; personId: string }): Promise<PersonUniverseRule> {
  const [enforced, own, access] = await Promise.all([isUniverseEnforced(db, user.organizationId), personUniverse(db, user.organizationId, user.personId), createPostgresAccessRepository(db as Database).loadContext(user.organizationId, user.sub)])
  return personRuleFor(access, enforced, own)
}

/**
 * Regra de RECURSOS consumidos pela própria pessoa (bases no chat, produtos sugeridos pela INIA): o universo do cadastro, ou todos com a
 * permissão em algum escopo (a abrangência organizacional dos recursos continua sendo a regra de Grupo/Subgrupo de cada um).
 */
export async function loadUniverseAccess(db: Queryable, user: { organizationId: string; sub?: string | null; personId: string }): Promise<UniverseAccess> {
  const [enforced, own, access] = await Promise.all([
    isUniverseEnforced(db, user.organizationId),
    personUniverse(db, user.organizationId, user.personId),
    user.sub ? createPostgresAccessRepository(db as Database).loadContext(user.organizationId, user.sub) : Promise.resolve(null),
  ])
  return universeAccessFor({ enforced, own, allUniverses: access !== null && canAnywhere(access, ALL_UNIVERSES_PERMISSION) })
}

/** Abrangência de quem é o SUJEITO (operador sem sessão: execução de Workflow, gatilho) — só o universo do cadastro. */
export async function loadSubjectUniverseAccess(db: Queryable, organizationId: string, personId: string): Promise<UniverseAccess> {
  const [enforced, own] = await Promise.all([isUniverseEnforced(db, organizationId), personUniverse(db, organizationId, personId)])
  return universeAccessFor({ enforced, own, allUniverses: false })
}

/** Cadastro: a partir da ativação, o universo é obrigatório no backend (lido do banco, nunca confiado ao cliente). */
export async function assertUniverseRequiredFor(db: Queryable, organizationId: string, universe: OperatingUniverse | null, what: string): Promise<void> {
  assertUniverseProvided(await isUniverseEnforced(db, organizationId), universe, what)
}

/** SQL: predicado de recurso utilizável na operação (`$n` = text[] dos universos; null = sem filtro). */
export function universeResourcePredicate(column: string, paramRef: string): string {
  return `(${paramRef}::text[] is null or ${column} = any(${paramRef}::text[]))`
}

/** Universos para o predicado de recurso: null = sem filtro (organização sem ativação). Vazio = nada (pendente). */
export const universeParam = (access: UniverseAccess): string[] | null => (access.enforced ? [...access.universes] : null)

export function universeForbidden(): DomainError {
  return new DomainError("Você não tem acesso a este universo de atuação.", "OPERATING_UNIVERSE_FORBIDDEN", 403)
}

/** Universo vindo do corpo de um cadastro (campo `operatingUniverse`): valida o valor e exige quando a organização já ativou. */
export async function universeFromBody(db: Queryable, organizationId: string, body: unknown, what: string): Promise<OperatingUniverse | null> {
  const raw = body && typeof body === "object" ? (body as { operatingUniverse?: unknown }).operatingUniverse : undefined
  const universe = optionalOperatingUniverseSchema.parse(raw === "" ? null : raw)
  await assertUniverseRequiredFor(db, organizationId, universe, what)
  return universe
}
