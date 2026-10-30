import { Router } from "express"
import { z } from "zod"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import type { AccessRepository } from "../application/access-repository.js"
import { assignRole, assignRoleToLeaders, getAccount, listAccounts, listRoles, revokeRole, scopeOptions, type AccessDeps } from "../application/access-service.js"
import type { AccountAccessRepository } from "../application/account-access-repository.js"
import { disableAccess, enableAccess, issueTemporaryPassword, listIdentifiedUsers, type AccountAccessDeps } from "../application/account-access-service.js"
import { ACCOUNT_ACCESS_STATUSES } from "../domain/account-access-status.js"
import { ACCESS_SCOPE_TYPES } from "../domain/access-scope.js"
import { createPostgresAccessRepository } from "../infrastructure/postgres-access-repository.js"
import { createPostgresAccountAccessRepository } from "../infrastructure/postgres-account-access-repository.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const idParam = z.string().uuid()
const listSchema = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) })
const usersListSchema = listSchema.extend({ status: z.enum(ACCOUNT_ACCESS_STATUSES).optional() })
const enableSchema = z.object({ email: z.string().trim().email().max(160).optional() }).strict()
const assignSchema = z.object({ roleCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/), scope: z.object({ type: z.enum(ACCESS_SCOPE_TYPES), teamId: z.string().uuid().nullable().optional(), subteamId: z.string().uuid().nullable().optional() }).strict() }).strict()
const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict()

/**
 * Usuários e acessos (V1.5.7) — `/api/v1/admin/access`. Montado só com sessão; CADA caso de uso checa a permissão dele
 * (access.users.view/manage, access.roles.view/assign) contra as atribuições da conta — sem permissão = 403, fora do escopo =
 * 404. Delegação validada no backend (papel, permissão e escopo), auto-concessão bloqueada, auditoria estruturada.
 */
export function createAccessRouter(database: Database, deps?: { repository?: AccessRepository; accounts?: AccountAccessRepository; clock?: Clock }) {
  const clock = deps?.clock ?? systemClock
  const resolved: AccessDeps = { repository: deps?.repository ?? createPostgresAccessRepository(database), now: () => clock.now() }
  const accountDeps: AccountAccessDeps = { ...resolved, accounts: deps?.accounts ?? createPostgresAccountAccessRepository(database), hashPassword, temporaryPasswordTtlHours: env.TEMPORARY_PASSWORD_TTL_HOURS }
  const router = Router()
  const actorOf = (request: { user?: { organizationId: string; sub: string; personId: string } }) => ({ organizationId: sessionUser(request).organizationId, accountId: sessionUser(request).sub, personId: sessionUser(request).personId })

  router.get("/roles", async (request, response) => { response.json({ data: await listRoles(resolved, actorOf(request)) }) })
  router.get("/scope-options", async (request, response) => { response.json({ data: await scopeOptions(resolved, actorOf(request)) }) })
  // Liberação de acesso: pessoas JÁ identificadas × situação do acesso. As respostas que trazem senha temporária nunca vão
  // para cache (a senha aparece uma única vez, só nesta resposta).
  router.get("/users", async (request, response) => {
    const filters = usersListSchema.parse(request.query)
    const page = await listIdentifiedUsers(accountDeps, actorOf(request), filters)
    response.json({ data: { ...page, page: filters.page, pageSize: filters.pageSize, temporaryPasswordTtlHours: accountDeps.temporaryPasswordTtlHours } })
  })
  router.post("/users/:personId/enable", async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.status(201).json({ data: await enableAccess(accountDeps, actorOf(request), { personId: idParam.parse(request.params.personId), email: enableSchema.parse(request.body ?? {}).email }) })
  })
  router.post("/accounts/:accountId/temporary-password", async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.status(201).json({ data: await issueTemporaryPassword(accountDeps, actorOf(request), { accountId: idParam.parse(request.params.accountId) }) })
  })
  router.post("/accounts/:accountId/disable", async (request, response) => {
    response.json({ data: await disableAccess(accountDeps, actorOf(request), { accountId: idParam.parse(request.params.accountId) }) })
  })
  router.get("/accounts", async (request, response) => {
    const filters = listSchema.parse(request.query)
    const page = await listAccounts(resolved, actorOf(request), filters)
    response.json({ data: { ...page, page: filters.page, pageSize: filters.pageSize } })
  })
  router.get("/accounts/:accountId", async (request, response) => { response.json({ data: await getAccount(resolved, actorOf(request), idParam.parse(request.params.accountId)) }) })
  router.post("/accounts/:accountId/roles", async (request, response) => {
    const body = assignSchema.parse(request.body)
    response.status(201).json({ data: await assignRole(resolved, actorOf(request), { accountId: idParam.parse(request.params.accountId), roleCode: body.roleCode, scope: body.scope }) })
  })
  router.post("/roles/:roleCode/grant-to-leaders", async (request, response) => {
    const roleCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).parse(request.params.roleCode)
    response.json({ data: await assignRoleToLeaders(resolved, actorOf(request), { roleCode }) })
  })
  router.delete("/accounts/:accountId/roles/:assignmentId", async (request, response) => {
    const body = revokeSchema.parse(request.body ?? {})
    await revokeRole(resolved, actorOf(request), { accountId: idParam.parse(request.params.accountId), assignmentId: idParam.parse(request.params.assignmentId), reason: body.reason ?? null })
    response.status(204).send()
  })
  return router
}
