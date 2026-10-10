import type { AccessContext } from "../domain/access-decision.js"
import type { AccessScope, CollaboratorResource } from "../domain/access-scope.js"

/**
 * PORTA de persistência do modelo de acesso. Tudo escopado pela organização da sessão; conta de outra organização
 * simplesmente não existe para o chamador. Implementações: Postgres (produção/prova) e memória (testes) — mesma semântica.
 */
export type AccountSummary = { accountId: string; email: string; active: boolean; lastLoginAt: Date | null; collaborator: { personId: string; name: string; jobTitle: string | null; level: string; active: boolean; team: { id: string; name: string } | null; subteam: { id: string; name: string } | null } }
export type AssignmentRecord = { id: string; accountId: string; roleCode: string; scope: AccessScope; scopeLabel: string; source: string; grantedAt: Date; grantedByName: string | null }
/** Onde o chamador enxerga (derivado das atribuições com a permissão pedida). */
export type VisibilityFilter = { organizationWide: boolean; teamIds: string[]; subteamIds: string[] }

export interface AccessRepository {
  /** Contexto de acesso de uma conta ATIVA da organização (conta inativa/inexistente/de outra organização → sem atribuições). */
  loadContext(organizationId: string, accountId: string): Promise<AccessContext>
  loadContextByPerson(organizationId: string, personId: string): Promise<AccessContext>
  collaborator(organizationId: string, personId: string): Promise<CollaboratorResource | null>
  account(organizationId: string, accountId: string): Promise<{ accountId: string; personId: string; active: boolean } | null>
  /** O colaborador está abaixo de `managerPersonId` por reports_to (a MESMA CTE de loadDescendants)? */
  isInStructure(organizationId: string, managerPersonId: string, personId: string): Promise<boolean>
  /** Resolve e valida o escopo pedido NA organização (Grupo/Subgrupo existentes); null = inválido. */
  resolveScope(organizationId: string, input: { type: AccessScope["type"]; teamId?: string | null | undefined; subteamId?: string | null | undefined }): Promise<AccessScope | null>
  listAccounts(organizationId: string, visibility: VisibilityFilter, filters: { search?: string | undefined; page: number; pageSize: number }): Promise<{ items: AccountSummary[]; total: number }>
  getAccount(organizationId: string, accountId: string): Promise<AccountSummary | null>
  listAssignments(organizationId: string, accountId: string): Promise<AssignmentRecord[]>
  findAssignment(organizationId: string, assignmentId: string): Promise<{ id: string; accountId: string; roleCode: string; scope: AccessScope; revoked: boolean } | null>
  /** Contas ATIVAS de pessoas ATIVAS que lideram alguém (≥ 1 subordinado direto ativo por reports_to), no alcance. */
  listLeaderAccounts(organizationId: string, visibility: VisibilityFilter): Promise<{ accountId: string; personId: string; teamId: string | null; subteamId: string | null }[]>
  scopeOptions(organizationId: string, visibility: VisibilityFilter): Promise<{ teams: { id: string; name: string }[]; subteams: { id: string; name: string; teamId: string; teamName: string }[] }>
  /** Grava a atribuição + auditoria estruturada; ALREADY_ASSIGNED = já existe ativa igual. */
  createAssignment(input: { organizationId: string; accountId: string; roleCode: string; scope: AccessScope; grantedByAccountId: string; actorPersonId: string; permissions: readonly string[]; at: Date }): Promise<{ ok: true; id: string } | { ok: false; error: "ALREADY_ASSIGNED" }>
  revokeAssignment(input: { organizationId: string; assignmentId: string; revokedByAccountId: string; actorPersonId: string; reason: string | null; at: Date }): Promise<boolean>
  /** Contas ATIVAS (pessoa ativa) com o papel ativo na organização — proteção contra o tenant ficar sem administrador geral. */
  countActiveHolders(organizationId: string, roleCode: string, options?: { excludingAssignmentId?: string; excludingAccountId?: string }): Promise<number>
}
