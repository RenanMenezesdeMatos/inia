import { Router, type Response } from "express"
import { z } from "zod"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { describeAccess } from "../../access/application/access-service.js"
import { accessCapabilities } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { loadIdentityForSession } from "../../profile-preferences/application/session-identity.js"
import { loadDiagnosticsAccess } from "../../diagnostics/application/diagnostics-access-loader.js"
import { authenticate } from "../application/authenticate.js"
import { defineFirstPassword } from "../application/define-first-password.js"
import { hashPassword, verifyPassword } from "../infrastructure/password-hasher.js"
import { issueSessionToken, parseDurationToMs, sessionPayloadOf, verifyAuthToken, type AuthTokenPayload, type VerifiedAuthToken } from "../infrastructure/jwt.js"
import { createPostgresCredentialStore, loginIdentifierHash } from "../infrastructure/postgres-credential-store.js"
import { DEVICE_COOKIE_MAX_AGE_MS, DEVICE_COOKIE_NAME, issueDeviceToken, readDeviceToken } from "../infrastructure/known-device.js"
import { createRequireAuth } from "./require-auth.js"
import { SESSION_COOKIE_NAME } from "./session-cookie.js"

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(1024),
})

const firstPasswordSchema = z.object({
  newPassword: z.string().min(1).max(1024),
  confirmPassword: z.string().max(1024),
}).strict()

/** Módulos ligados no ambiente (não é permissão: um módulo ligado ainda exige a permissão da conta). */
export type AuthFeatures = { interactionFeedbackQa: boolean; usageCollection?: boolean; usabilityPanel?: boolean }

export function createAuthRouter(db: Database, options: { features?: AuthFeatures; now?: () => Date; cookieSecure?: boolean } = {}) {
  const features: AuthFeatures = options.features ?? { interactionFeedbackQa: false }
  const now = options.now ?? (() => new Date())
  const router = Router()
  const cookieMaxAgeMs = parseDurationToMs(env.JWT_EXPIRES_IN)
  const cookieSecure = options.cookieSecure ?? env.sessionCookieSecure
  const store = createPostgresCredentialStore(db)
  // /me e /password são as ÚNICAS rotas que uma sessão com troca de senha pendente alcança (além de /logout, sem guarda).
  const requireSessionAllowingPasswordChange = createRequireAuth(db, { allowPendingPasswordChange: true, now })
  const requireSession = createRequireAuth(db, { now })
  const clearSessionCookie = (response: Response) => response.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/" })
  // Sessão nova = atividade agora: o encerramento por inatividade mede a partir do login (migration 149).
  const setSessionCookie = async (response: Response, payload: AuthTokenPayload) => {
    const session = issueSessionToken(payload)
    await store.recordSessionActivity({ accountId: payload.sub, sessionId: session.jti, expiresAt: session.expiresAt, at: now() })
    response.cookie(SESSION_COOKIE_NAME, session.token, { httpOnly: true, secure: cookieSecure, sameSite: "lax", maxAge: cookieMaxAgeMs, path: "/" })
  }

  router.post("/login", async (request, response) => {
    response.set("Cache-Control", "no-store")
    const input = loginSchema.parse(request.body)
    const device = readDeviceToken(request.cookies?.[DEVICE_COOKIE_NAME])
    const result = await authenticate({ store, verifyPassword, identifierHash: loginIdentifierHash, now }, { login: input.email, password: input.password, device })
    if (result.kind === "LOCKED") {
      return response.status(429).json({ error: { code: "LOGIN_TOO_MANY_ATTEMPTS", message: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.", details: { retryAt: result.retryAt.toISOString() } } })
    }
    if (result.kind === "INVALID_CREDENTIALS") return response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." } })
    if (result.kind === "ACCESS_DISABLED") return response.status(403).json({ error: { code: "ACCESS_DISABLED", message: "Seu acesso à INIA está desabilitado. Procure o administrador." } })
    if (result.kind === "TEMPORARY_PASSWORD_EXPIRED") return response.status(401).json({ error: { code: "TEMPORARY_PASSWORD_EXPIRED", message: "Sua senha temporária expirou. Peça uma nova ao administrador." } })

    const account = result.account
    const identity = { id: account.id, personId: account.personId, name: account.name, role: account.role, email: account.email, avatarUrl: account.avatarUrl, jobTitle: account.jobTitle, teamId: account.teamId, teamName: account.teamName }
    await setSessionCookie(response, sessionPayloadOf({ ...identity, sub: account.id, organizationId: account.organizationId }, { sv: account.sessionVersion, pc: account.passwordChangeRequired }))
    // Depois do cookie de sessão. Navegador onde a conta entrou: passa a ser dispositivo conhecido dela (ver known-device.ts).
    if (device?.accountId !== account.id) response.cookie(DEVICE_COOKIE_NAME, issueDeviceToken(account.id), { httpOnly: true, secure: cookieSecure, sameSite: "lax", maxAge: DEVICE_COOKIE_MAX_AGE_MS, path: "/api/v1/auth" })
    return response.json({ data: { ...identity, passwordChangeRequired: account.passwordChangeRequired } })
  })

  // Sair encerra ESTA sessão no servidor (jti revogado até o token vencer), não só o cookie deste navegador: uma cópia do token
  // deixa de valer na hora. Token ausente, inválido ou de antes do jti: só apaga o cookie, como sempre.
  router.post("/logout", async (request, response) => {
    response.set("Cache-Control", "no-store")
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    let session: VerifiedAuthToken | null = null
    try {
      session = token ? verifyAuthToken(token) : null
    } catch {
      session = null
    }
    if (session?.jti && typeof session.exp === "number") {
      await store.revokeSession({ organizationId: session.organizationId, accountId: session.sub, sessionId: session.jti, expiresAt: new Date(session.exp * 1000), at: now() })
    }
    clearSessionCookie(response)
    response.status(204).send()
  })

  // "Sair de todos os aparelhos" (R-33): a própria pessoa encerra TODAS as suas sessões, inclusive esta (versão de sessão + 1).
  // Serve para quando ela esqueceu a INIA aberta em outro computador ou desconfia que alguém usou o acesso dela.
  router.post("/logout-all", requireSession, async (request, response) => {
    response.set("Cache-Control", "no-store")
    const user = request.user!
    await store.endAllSessions({ organizationId: user.organizationId, accountId: user.sub, actorPersonId: user.personId, at: now() })
    clearSessionCookie(response)
    response.status(204).send()
  })

  // Aviso de interação na tela (no máximo um por minuto, enviado pela interface): mantém a sessão viva enquanto a pessoa usa a
  // INIA só lendo — leituras automáticas não contam. O guard grava a atividade porque é um POST; aqui não há mais nada a fazer.
  router.post("/activity", requireSession, (_request, response) => {
    response.set("Cache-Control", "no-store")
    response.status(204).send()
  })

  // Primeiro acesso: cria a senha da pessoa (troca obrigatória pendente). A sessão atual segue valendo com a versão nova; as
  // outras caem. Nada de senha em resposta, log ou auditoria.
  router.post("/password", requireSessionAllowingPasswordChange, async (request, response) => {
    response.set("Cache-Control", "no-store")
    const input = firstPasswordSchema.parse(request.body)
    const user = request.user!
    const changed = await defineFirstPassword({ store, hashPassword, verifyPassword, now }, { organizationId: user.organizationId, accountId: user.sub, personId: user.personId, newPassword: input.newPassword, confirmPassword: input.confirmPassword })
    await setSessionCookie(response, sessionPayloadOf(user, { sv: changed.sessionVersion, pc: false }))
    return response.json({ data: { passwordChangeRequired: false } })
  })

  // Acesso calculado AO VIVO (nunca vai no JWT) a partir das ATRIBUIÇÕES DE PAPEL da conta (V1.5.7): permissões efetivas +
  // capabilities derivadas. Uma concessão/revogação vale na próxima request, sem novo login. `role` continua sendo só o
  // nível hierárquico da pessoa (organizacional) — não concede nada. Com a troca de senha pendente, a sessão existe mas NÃO
  // tem acesso a nada: permissões vazias, só a identidade para a tela de criar a senha.
  router.get("/me", requireSessionAllowingPasswordChange, async (request, response) => {
    // Só a identidade: versão de sessão, dica de troca de senha e os metadados do token (iat/exp/jti) não saem para o navegador.
    const { sv: _sv, pc: _pc, iat: _iat, exp: _exp, jti: _jti, ...user } = request.user! as VerifiedAuthToken & { iat?: number }
    void [_sv, _pc, _iat, _exp, _jti]
    const session = request.session!
    // A tela avisa antes de a sessão parada ser encerrada (o servidor encerra de qualquer forma).
    const sessionIdleTimeoutMinutes = env.SESSION_IDLE_TIMEOUT_MINUTES
    if (session.passwordChangeRequired) {
      const identity = await loadIdentityForSession(db, user)
      const noAccess = { organizationId: user.organizationId, accountId: user.sub, personId: user.personId, assignments: [] }
      return response.json({ data: { ...user, ...identity, passwordChangeRequired: true, temporaryPasswordExpiresAt: session.temporaryPasswordExpiresAt?.toISOString() ?? null, sessionIdleTimeoutMinutes, access: { permissions: [], capabilities: { ...accessCapabilities(noAccess), canViewDiagnostics: false, canUseReports: false, canViewBestPractices: false, canManageBestPractices: false }, roles: [] }, features } })
    }
    const [access, identity] = await Promise.all([
      describeAccess({ repository: createPostgresAccessRepository(db), now: () => new Date() }, { organizationId: user.organizationId, accountId: user.sub, personId: user.personId }),
      // Identidade AO VIVO (nunca o snapshot do JWT): uma carga que atualiza o cadastro, ou a pessoa que muda como quer ser
      // chamada/a foto, aparece na próxima leitura — sem novo login.
      loadIdentityForSession(db, user),
    ])
    // Diagnóstico: regra operacional (lidera alguém) OU `indicators.view` — a mesma que a API aplica (diagnostics-access.ts).
    const canViewDiagnostics = await loadDiagnosticsAccess(db, { organizationId: user.organizationId, personId: user.personId, canViewIndicators: access.capabilities.canViewIndicators })
    // Base de boas práticas: o público do Diagnóstico lê; quem administra a configuração também lê e revisa (best-practices-router.ts).
    const bestPractices = { canViewBestPractices: canViewDiagnostics || access.capabilities.canManageConfiguration, canManageBestPractices: access.capabilities.canManageConfiguration }
    return response.json({ data: { ...user, ...identity, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, sessionIdleTimeoutMinutes, access: { ...access, capabilities: { ...access.capabilities, canViewDiagnostics, canUseReports: canViewDiagnostics || access.capabilities.canDistributeReports, ...bestPractices } }, features } })
  })

  return router
}
