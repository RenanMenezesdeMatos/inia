import { booleanParam, unitFilterShape } from "../../../shared/presentation/list-query.js"
import { Router, type Request } from "express"
import { z } from "zod"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import type { AccessRepository } from "../application/access-repository.js"
import { assignRole, getAccount, listAccounts, listRoles, revokeRole, scopeOptions, type AccessDeps } from "../application/access-service.js"
import type { AccountAccessRepository } from "../application/account-access-repository.js"
import { disableAccess, enableAccess, issueTemporaryPassword, listIdentifiedUsers, type AccountAccessDeps } from "../application/account-access-service.js"
import { checkNetworkLogin } from "../application/network-check-service.js"
import { applyNetworkEnable, previewNetworkEnable } from "../application/network-enable-service.js"
import { parseShortLoginFormats, shortNetworkLoginOf } from "../../auth/domain/network-login.js"
import { createPostgresNetworkAttempts } from "../../auth/infrastructure/postgres-network-attempts.js"
import { createPostgresNetworkLoginRepository } from "../../auth/infrastructure/postgres-network-login-repository.js"
import type { NetworkAttemptsReader } from "../../auth/application/network-attempts.js"
import { NETWORK_ENABLE_TEMPLATE_FILE, networkEnableTemplate } from "../domain/network-enable-csv.js"
import { ACCOUNT_ACCESS_STATUSES } from "../domain/account-access-status.js"
import { ACCESS_SCOPE_TYPES } from "../domain/access-scope.js"
import { createPostgresAccessRepository } from "../infrastructure/postgres-access-repository.js"
import { createPostgresAccountAccessRepository } from "../infrastructure/postgres-account-access-repository.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const idParam = z.string().uuid()
const listSchema = z.object({ search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) })
const usersListSchema = listSchema.extend({ status: z.enum(ACCOUNT_ACCESS_STATUSES).optional(), networkIssue: booleanParam, ...unitFilterShape })
const enableSchema = z.object({ email: z.string().trim().email().max(160).optional() }).strict()
// Arquivo em base64: o servidor decide a codificação (Excel salva CSV em Windows-1252) e os limites; nada é gravado em disco.
const networkEnableSchema = z.object({ contentBase64: z.string().min(1).max(960_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict()
const networkCheckSchema = z.object({ matricula: z.string().trim().min(1).max(80) }).strict()
const assignSchema = z.object({ roleCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/), scope: z.object({ type: z.enum(ACCESS_SCOPE_TYPES), teamId: z.string().uuid().nullable().optional(), subteamId: z.string().uuid().nullable().optional() }).strict() }).strict()
const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict()

/**
 * Usuários e acessos (V1.5.7) — `/api/v1/admin/access`. Montado só com sessão; CADA caso de uso checa a permissão dele
 * (access.users.view/manage, access.roles.view/assign) contra as atribuições da conta — sem permissão = 403, fora do escopo =
 * 404. Delegação validada no backend (papel, permissão e escopo), auto-concessão bloqueada, auditoria estruturada.
 */
export function createAccessRouter(database: Database, deps?: { repository?: AccessRepository; accounts?: AccountAccessRepository; networkAttempts?: NetworkAttemptsReader; networkLoginEnabled?: (organizationId: string) => Promise<boolean>; networkDomain?: string | null; clock?: Clock }) {
  const clock = deps?.clock ?? systemClock
  const resolved: AccessDeps = { repository: deps?.repository ?? createPostgresAccessRepository(database), now: () => clock.now() }
  const networkLogin = createPostgresNetworkLoginRepository(database)
  const accountDeps: AccountAccessDeps = {
    ...resolved, accounts: deps?.accounts ?? createPostgresAccountAccessRepository(database), hashPassword, temporaryPasswordTtlHours: env.TEMPORARY_PASSWORD_TTL_HOURS,
    networkAttempts: deps?.networkAttempts ?? createPostgresNetworkAttempts(database),
    networkLoginEnabled: deps?.networkLoginEnabled ?? (async (organizationId) => (await networkLogin.organizationSwitch(organizationId))?.enabled === true),
    shortLoginOf: (login) => shortNetworkLoginOf(login, parseShortLoginFormats(env.AD_LOGIN_WITHOUT_LAST_DIGIT)),
    networkDomain: deps?.networkDomain !== undefined ? deps.networkDomain : env.AD_DOMAIN ?? null,
  }
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
  // Habilitar em massa pela rede (CSV de matrículas): modelo, conferência (não grava) e aplicação. Nenhuma senha em nenhuma resposta.
  router.get("/users/network-enable/template", (_request, response) => {
    response.setHeader("content-type", "text/csv; charset=utf-8")
    response.setHeader("content-disposition", `attachment; filename="${NETWORK_ENABLE_TEMPLATE_FILE}"`)
    response.send(networkEnableTemplate())
  })
  const csvOf = (request: Request) => Buffer.from(networkEnableSchema.parse(request.body).contentBase64, "base64")
  router.post("/users/network-enable/preview", async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.json({ data: await previewNetworkEnable(accountDeps, actorOf(request), csvOf(request)) })
  })
  router.post("/users/network-enable", async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.json({ data: await applyNetworkEnable(accountDeps, actorOf(request), csvOf(request)) })
  })
  // "Por que esta pessoa não entra?" — POST para a matrícula não ir para a URL nem para os logs de acesso.
  router.post("/network-login-check", async (request, response) => {
    response.set("Cache-Control", "no-store")
    response.json({ data: await checkNetworkLogin(accountDeps, actorOf(request), networkCheckSchema.parse(request.body).matricula) })
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
  router.delete("/accounts/:accountId/roles/:assignmentId", async (request, response) => {
    const body = revokeSchema.parse(request.body ?? {})
    await revokeRole(resolved, actorOf(request), { accountId: idParam.parse(request.params.accountId), assignmentId: idParam.parse(request.params.assignmentId), reason: body.reason ?? null })
    response.status(204).send()
  })
  return router
}
