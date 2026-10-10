import { randomUUID } from "node:crypto"
import type { AccessRepository, VisibilityFilter } from "../application/access-repository.js"
import type { AccountAccessRepository } from "../application/account-access-repository.js"
import { accountAccessStatusOf } from "../domain/account-access-status.js"
import type { AccessScope } from "../domain/access-scope.js"

export type MemPerson = { id: string; organizationId: string; name: string; jobTitle: string | null; level: string; active: boolean; teamId: string | null; subteamId: string | null; reportsToId?: string | null }
export type MemAccount = { id: string; organizationId: string; personId: string; email: string; active: boolean; sessionVersion?: number; passwordHash?: string; passwordChangeRequired?: boolean; temporaryPasswordIssuedAt?: Date | null; temporaryPasswordExpiresAt?: Date | null; accessDisabledAt?: Date | null }
export type MemAssignment = { id: string; organizationId: string; accountId: string; roleCode: string; scope: AccessScope; grantedByAccountId: string | null; grantedAt: Date; revokedAt: Date | null; revokedByAccountId: string | null; reason: string | null }
export type MemAudit = { organizationId: string; actorPersonId: string | null; action: string; entityId: string; payload: Record<string, unknown> }

/** Repositório de acesso em memória com a MESMA semântica do Postgres (organização, conta/pessoa ativas, revogar ≠ apagar, auditoria). */
export function createInMemoryAccessRepository(seed: { people: MemPerson[]; accounts: MemAccount[]; teams: { id: string; organizationId: string; name: string }[]; subteams: { id: string; teamId: string; name: string }[]; assignments?: MemAssignment[] }) {
  const people = seed.people
  const accounts = seed.accounts
  const assignments: MemAssignment[] = seed.assignments ?? []
  const audit: MemAudit[] = []
  const visible = (visibility: VisibilityFilter, person: MemPerson) => visibility.organizationWide || (person.teamId !== null && visibility.teamIds.includes(person.teamId)) || (person.subteamId !== null && visibility.subteamIds.includes(person.subteamId))
  const active = (organizationId: string, accountId: string) => assignments.filter((entry) => entry.organizationId === organizationId && entry.accountId === accountId && !entry.revokedAt)
  const summary = (account: MemAccount) => {
    const person = people.find((entry) => entry.id === account.personId)!
    const team = seed.teams.find((entry) => entry.id === person.teamId)
    const subteam = seed.subteams.find((entry) => entry.id === person.subteamId)
    return { accountId: account.id, email: account.email, active: account.active, lastLoginAt: null, collaborator: { personId: person.id, name: person.name, jobTitle: person.jobTitle, level: person.level, active: person.active, team: team ? { id: team.id, name: team.name } : null, subteam: subteam ? { id: subteam.id, name: subteam.name } : null } }
  }
  const contextOf = (organizationId: string, account: MemAccount | undefined, fallback: { accountId: string; personId: string }) => {
    const person = account ? people.find((entry) => entry.id === account.personId) : undefined
    if (!account || !person || !account.active || !person.active || account.organizationId !== organizationId) return { organizationId, ...fallback, assignments: [] }
    return { organizationId, accountId: account.id, personId: account.personId, assignments: active(organizationId, account.id).map((entry) => ({ id: entry.id, roleCode: entry.roleCode, scope: entry.scope })) }
  }
  const repository: AccessRepository = {
    async loadContext(organizationId, accountId) { return contextOf(organizationId, accounts.find((entry) => entry.id === accountId), { accountId, personId: "" }) },
    async loadContextByPerson(organizationId, personId) { return contextOf(organizationId, accounts.find((entry) => entry.personId === personId), { accountId: "", personId }) },
    async collaborator(organizationId, personId) { const person = people.find((entry) => entry.id === personId && entry.organizationId === organizationId); return person ? { personId: person.id, teamId: person.teamId, subteamId: person.subteamId } : null },
    async account(organizationId, accountId) { const account = accounts.find((entry) => entry.id === accountId && entry.organizationId === organizationId); return account ? { accountId: account.id, personId: account.personId, active: account.active } : null },
    async isInStructure(organizationId, managerPersonId, personId) {
      const found = new Set<string>(); const queue = [managerPersonId]
      while (queue.length) { const current = queue.shift()!; for (const person of people) if (person.organizationId === organizationId && person.reportsToId === current && !found.has(person.id)) { found.add(person.id); queue.push(person.id) } }
      return found.has(personId)
    },
    async resolveScope(organizationId, input) {
      if (input.type === "ORGANIZATION" || input.type === "MY_STRUCTURE") return input.teamId || input.subteamId ? null : { type: input.type }
      if (input.type === "GROUP") return input.teamId && !input.subteamId && seed.teams.some((team) => team.id === input.teamId && team.organizationId === organizationId) ? { type: "GROUP", teamId: input.teamId } : null
      const subteam = input.subteamId && !input.teamId ? seed.subteams.find((entry) => entry.id === input.subteamId && seed.teams.some((team) => team.id === entry.teamId && team.organizationId === organizationId)) : undefined
      return subteam ? { type: "SUBGROUP", subteamId: subteam.id, teamId: subteam.teamId } : null
    },
    async listAccounts(organizationId, visibility, filters) {
      const all = accounts.filter((account) => account.organizationId === organizationId).map(summary).filter((entry) => visible(visibility, people.find((person) => person.id === entry.collaborator.personId)!) && (!filters.search || entry.collaborator.name.toLowerCase().includes(filters.search.toLowerCase())))
      return { items: all.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize), total: all.length }
    },
    async getAccount(organizationId, accountId) { const account = accounts.find((entry) => entry.id === accountId && entry.organizationId === organizationId); return account ? summary(account) : null },
    async listAssignments(organizationId, accountId) { return active(organizationId, accountId).map((entry) => ({ id: entry.id, accountId: entry.accountId, roleCode: entry.roleCode, scope: entry.scope, scopeLabel: entry.scope.type, source: "MANUAL", grantedAt: entry.grantedAt, grantedByName: null })) },
    async findAssignment(organizationId, assignmentId) { const entry = assignments.find((item) => item.id === assignmentId && item.organizationId === organizationId); return entry ? { id: entry.id, accountId: entry.accountId, roleCode: entry.roleCode, scope: entry.scope, revoked: entry.revokedAt !== null } : null },
    async listLeaderAccounts(organizationId, visibility) {
      return accounts
        .filter((account) => account.organizationId === organizationId && account.active)
        .map((account) => ({ account, person: people.find((entry) => entry.id === account.personId)! }))
        .filter(({ person }) => person.active && visible(visibility, person) && people.some((sub) => sub.reportsToId === person.id && sub.active && sub.organizationId === organizationId))
        .map(({ account, person }) => ({ accountId: account.id, personId: person.id, teamId: person.teamId, subteamId: person.subteamId }))
    },
    async scopeOptions(organizationId, visibility) {
      return {
        teams: seed.teams.filter((team) => team.organizationId === organizationId && (visibility.organizationWide || visibility.teamIds.includes(team.id))).map(({ id, name }) => ({ id, name })),
        subteams: seed.subteams.filter((subteam) => seed.teams.some((team) => team.id === subteam.teamId && team.organizationId === organizationId) && (visibility.organizationWide || visibility.teamIds.includes(subteam.teamId) || visibility.subteamIds.includes(subteam.id))).map((subteam) => ({ id: subteam.id, name: subteam.name, teamId: subteam.teamId, teamName: seed.teams.find((team) => team.id === subteam.teamId)!.name })),
      }
    },
    async createAssignment({ organizationId, accountId, roleCode, scope, grantedByAccountId, actorPersonId, permissions, at }) {
      const key = JSON.stringify(scope)
      if (active(organizationId, accountId).some((entry) => entry.roleCode === roleCode && JSON.stringify(entry.scope) === key)) return { ok: false, error: "ALREADY_ASSIGNED" }
      const entry: MemAssignment = { id: randomUUID(), organizationId, accountId, roleCode, scope, grantedByAccountId, grantedAt: at, revokedAt: null, revokedByAccountId: null, reason: null }
      assignments.push(entry)
      audit.push({ organizationId, actorPersonId, action: "ACCESS_ROLE_GRANTED", entityId: entry.id, payload: { recipientAccountId: accountId, grantedByAccountId, roleCode, permissions, scope } })
      return { ok: true, id: entry.id }
    },
    async revokeAssignment({ organizationId, assignmentId, revokedByAccountId, actorPersonId, reason, at }) {
      const entry = assignments.find((item) => item.id === assignmentId && item.organizationId === organizationId && !item.revokedAt)
      if (!entry) return false
      Object.assign(entry, { revokedAt: at, revokedByAccountId, reason })
      audit.push({ organizationId, actorPersonId, action: "ACCESS_ROLE_REVOKED", entityId: entry.id, payload: { recipientAccountId: entry.accountId, revokedByAccountId, roleCode: entry.roleCode, scope: entry.scope, reason } })
      return true
    },
    async countActiveHolders(organizationId, roleCode, options = {}) {
      const holders = assignments.filter((entry) => entry.organizationId === organizationId && entry.roleCode === roleCode && !entry.revokedAt && entry.id !== options.excludingAssignmentId && entry.accountId !== options.excludingAccountId && (() => { const account = accounts.find((item) => item.id === entry.accountId); const person = account ? people.find((item) => item.id === account.personId) : undefined; return Boolean(account?.active && person?.active) })())
      return new Set(holders.map((entry) => entry.accountId)).size
    },
  }
  return { repository, people, accounts, assignments, audit }
}

/** Liberação de acesso em memória sobre o MESMO estado (pessoas, contas, papéis, auditoria) — mesma semântica do Postgres. */
export function createInMemoryAccountAccessRepository(memory: ReturnType<typeof createInMemoryAccessRepository>, seed: { teams: { id: string; name: string }[]; subteams: { id: string; name: string }[] }): AccountAccessRepository {
  const { people, accounts, assignments, audit } = memory
  const visible = (visibility: VisibilityFilter, person: MemPerson) => visibility.organizationWide || (person.teamId !== null && visibility.teamIds.includes(person.teamId)) || (person.subteamId !== null && visibility.subteamIds.includes(person.subteamId))
  const rolesOf = (accountId: string) => assignments.filter((entry) => entry.accountId === accountId && !entry.revokedAt)
  const target = (person: MemPerson | undefined) => {
    if (!person) return null
    const account = accounts.find((entry) => entry.personId === person.id)
    const led: MemPerson[] = []
    const queue = [person.id]
    while (queue.length) { const current = queue.shift()!; for (const entry of people) if (entry.organizationId === person.organizationId && entry.reportsToId === current && !led.includes(entry) && entry.id !== person.id) { led.push(entry); queue.push(entry.id) } }
    const ledPlacements = [...new Map(led.filter((entry) => entry.active).map((entry) => [`${entry.teamId}|${entry.subteamId}`, { teamId: entry.teamId, subteamId: entry.subteamId }])).values()]
    return { personId: person.id, name: person.name, personActive: person.active, teamId: person.teamId, subteamId: person.subteamId, ledPlacements, account: account ? { accountId: account.id, email: account.email, active: account.active, sessionVersion: account.sessionVersion ?? 0, passwordChangeRequired: account.passwordChangeRequired === true, assignments: rolesOf(account.id).map((entry) => ({ roleCode: entry.roleCode, scope: entry.scope })) } : null }
  }
  const mutate = (organizationId: string, accountId: string, expected: number, when: (account: MemAccount) => boolean, change: (account: MemAccount) => void, auditEntry: { actorPersonId: string | null; action: string; payload: Record<string, unknown> }) => {
    const account = accounts.find((entry) => entry.id === accountId && entry.organizationId === organizationId)
    if (!account || (account.sessionVersion ?? 0) !== expected || !when(account)) return { ok: false as const, error: "CONFLICT" as const }
    change(account)
    account.sessionVersion = (account.sessionVersion ?? 0) + 1
    audit.push({ organizationId, actorPersonId: auditEntry.actorPersonId, action: auditEntry.action, entityId: account.id, payload: auditEntry.payload })
    return { ok: true as const, accountId: account.id }
  }
  return {
    async listIdentifiedUsers(organizationId, visibility, filters) {
      const all = people
        .filter((person) => person.organizationId === organizationId && visible(visibility, person))
        .map((person) => ({ person, account: accounts.find((entry) => entry.personId === person.id) ?? null }))
        .filter(({ person, account }) => (!filters.search || `${person.name} ${account?.email ?? ""}`.toLowerCase().includes(filters.search.toLowerCase())) && (!filters.status || accountAccessStatusOf(account ? { active: account.active, passwordChangeRequired: account.passwordChangeRequired === true } : null) === filters.status))
        .sort((a, b) => a.person.name.localeCompare(b.person.name))
      const items = all.map(({ person, account }) => ({
        personId: person.id, name: person.name, matricula: null, jobTitle: person.jobTitle, level: person.level, personActive: person.active,
        team: person.teamId ? { id: person.teamId, name: seed.teams.find((team) => team.id === person.teamId)?.name ?? "" } : null,
        subteam: person.subteamId ? { id: person.subteamId, name: seed.subteams.find((subteam) => subteam.id === person.subteamId)?.name ?? "" } : null,
        account: account ? { accountId: account.id, email: account.email, active: account.active, lastLoginAt: null, passwordChangeRequired: account.passwordChangeRequired === true, temporaryPasswordIssuedAt: account.temporaryPasswordIssuedAt ?? null, temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt ?? null, accessDisabledAt: account.accessDisabledAt ?? null, roleCodes: rolesOf(account.id).map((entry) => entry.roleCode) } : null,
      }))
      return { items: items.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize), total: items.length }
    },
    async targetByPerson(organizationId, personId) { return target(people.find((entry) => entry.id === personId && entry.organizationId === organizationId)) },
    async targetByAccount(organizationId, accountId) {
      const account = accounts.find((entry) => entry.id === accountId && entry.organizationId === organizationId)
      return target(account ? people.find((entry) => entry.id === account.personId) : undefined)
    },
    async createWithTemporaryPassword(input) {
      if (accounts.some((entry) => entry.personId === input.personId)) return { ok: false, error: "ALREADY_LINKED" }
      if (accounts.some((entry) => entry.email.toLowerCase() === input.email.toLowerCase())) return { ok: false, error: "EMAIL_IN_USE" }
      const account: MemAccount = { id: randomUUID(), organizationId: input.organizationId, personId: input.personId, email: input.email, active: true, sessionVersion: 0, passwordHash: input.passwordHash, passwordChangeRequired: true, temporaryPasswordIssuedAt: input.issuedAt, temporaryPasswordExpiresAt: input.expiresAt }
      accounts.push(account)
      audit.push({ organizationId: input.organizationId, actorPersonId: input.actorPersonId, action: "ACCESS_ENABLED", entityId: account.id, payload: { personId: input.personId, email: input.email, accountCreated: true, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), actorAccountId: input.actorAccountId } })
      return { ok: true, accountId: account.id }
    },
    async enableWithTemporaryPassword(input) {
      if (input.email && accounts.some((entry) => entry.id !== input.accountId && entry.email.toLowerCase() === input.email!.toLowerCase())) return { ok: false, error: "EMAIL_IN_USE" }
      return mutate(input.organizationId, input.accountId, input.expectedSessionVersion, (account) => !account.active, (account) => Object.assign(account, { active: true, email: input.email ?? account.email, passwordHash: input.passwordHash, passwordChangeRequired: true, temporaryPasswordIssuedAt: input.issuedAt, temporaryPasswordExpiresAt: input.expiresAt, accessDisabledAt: null }), { actorPersonId: input.actorPersonId, action: "ACCESS_ENABLED", payload: { personId: input.personId, accountCreated: false, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), sessionsRevoked: true, actorAccountId: input.actorAccountId } })
    },
    async issueTemporaryPassword(input) {
      return mutate(input.organizationId, input.accountId, input.expectedSessionVersion, (account) => account.active, (account) => Object.assign(account, { passwordHash: input.passwordHash, passwordChangeRequired: true, temporaryPasswordIssuedAt: input.issuedAt, temporaryPasswordExpiresAt: input.expiresAt }), { actorPersonId: input.actorPersonId, action: "ACCESS_TEMPORARY_PASSWORD_ISSUED", payload: { personId: input.personId, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), sessionsRevoked: true, actorAccountId: input.actorAccountId } })
    },
    async disable(input) {
      return mutate(input.organizationId, input.accountId, input.expectedSessionVersion, (account) => account.active, (account) => Object.assign(account, { active: false, accessDisabledAt: input.at, passwordChangeRequired: false, temporaryPasswordIssuedAt: null, temporaryPasswordExpiresAt: null }), { actorPersonId: input.actorPersonId, action: "ACCESS_DISABLED", payload: { personId: input.personId, sessionsRevoked: true, actorAccountId: input.actorAccountId } })
    },
  }
}
