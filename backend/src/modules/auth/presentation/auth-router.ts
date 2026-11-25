import { Router, type Response } from "express"
import { z } from "zod"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { describeAccess } from "../../access/application/access-service.js"
import { accessCapabilities } from "../../access/domain/access-decision.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { loadIdentityForSession } from "../../profile-preferences/application/session-identity.js"
import { loadDiagnosticsAccess } from "../../diagnostics/application/diagnostics-access-loader.js"
import { randomBytes } from "node:crypto"
import { authenticate } from "../application/authenticate.js"
import { authenticateNetwork } from "../application/authenticate-network.js"
import type { DirectoryAuthenticator } from "../application/directory-authenticator.js"
import { directoryFromEnv } from "../infrastructure/ldap-directory-authenticator.js"
import { defineFirstPassword } from "../application/define-first-password.js"
import { hashPassword, verifyPassword } from "../infrastructure/password-hasher.js"
import { issueSessionToken, parseDurationToMs, sessionPayloadOf, verifyAuthToken, type AuthTokenPayload, type VerifiedAuthToken } from "../infrastructure/jwt.js"
import { createPostgresCredentialStore, loginIdentifierHash } from "../infrastructure/postgres-credential-store.js"
import { createPostgresNetworkLoginRepository } from "../infrastructure/postgres-network-login-repository.js"
import { DEVICE_COOKIE_MAX_AGE_MS, DEVICE_COOKIE_NAME, issueDeviceToken, readDeviceToken } from "../infrastructure/known-device.js"
import { createRequireAuth } from "./require-auth.js"
import { SESSION_COOKIE_NAME } from "./session-cookie.js"

const loginSchema = z.union([
  z.object({ email: z.string().trim().email(), password: z.string().min(1).max(1024) }).strict(),
  // Login pela rede: matrícula de rede + senha de rede, conferidas no AD (application/authenticate-network.ts).
  z.object({ matricula: z.string().trim().min(1).max(80), password: z.string().min(1).max(1024) }).strict(),
])

/**
 * Recusas do login (e-mail ou rede) com status e mensagem — uma tabela só, a mesma para as duas portas. `code` é o que a resposta
 * leva (a senha de rede recusada sai como INVALID_CREDENTIALS, com a mensagem da rede). Cada linha no formato
 * `status, code, message` para o inventário do catálogo de erros (`npm run errors:catalog`) ler o código e a mensagem.
 */
export const LOGIN_REFUSALS = {
  INVALID_CREDENTIALS: { status: 401, code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." },
  INVALID_NETWORK_CREDENTIALS: { status: 401, code: "INVALID_CREDENTIALS", message: "Não foi possível entrar com esta matrícula e senha de rede. Confira as duas; se estiverem certas, peça ao administrador da INIA para conferir se o seu acesso está habilitado. Atenção: várias senhas erradas bloqueiam a sua conta de rede." },
  ACCESS_DISABLED: { status: 403, code: "ACCESS_DISABLED", message: "Seu acesso à INIA está desabilitado. Procure o administrador." },
  TEMPORARY_PASSWORD_EXPIRED: { status: 401, code: "TEMPORARY_PASSWORD_EXPIRED", message: "Sua senha temporária expirou. Peça uma nova ao administrador." },
  NETWORK_LOGIN_REQUIRED: { status: 403, code: "NETWORK_LOGIN_REQUIRED", message: "Na sua organização o acesso à INIA é pela matrícula e senha de rede." },
  NETWORK_PASSWORD_EXPIRED: { status: 403, code: "NETWORK_PASSWORD_EXPIRED", message: "Sua senha de rede venceu ou precisa ser trocada. Troque a senha de rede e tente de novo." },
  NETWORK_ACCOUNT_LOCKED: { status: 403, code: "NETWORK_ACCOUNT_LOCKED", message: "Sua conta de rede está bloqueada. Procure o suporte de TI para desbloquear." },
  NETWORK_ACCOUNT_DISABLED: { status: 403, code: "NETWORK_ACCOUNT_DISABLED", message: "Sua conta de rede está desativada ou sem permissão de acesso agora. Procure o suporte de TI." },
  NETWORK_IDENTITY_UNREADABLE: { status: 403, code: "NETWORK_IDENTITY_UNREADABLE", message: "Sua senha de rede foi aceita, mas a INIA não conseguiu confirmar a sua ID no AD. Procure o administrador da INIA." },
  NETWORK_LOGIN_UNAVAILABLE: { status: 503, code: "NETWORK_LOGIN_UNAVAILABLE", message: "O login pela rede está indisponível no momento. Tente de novo em alguns minutos." },
} as const

/** Trava do login (429, com `retryAt`): na rede, a mensagem avisa que insistir pode bloquear a conta de rede. */
export const LOGIN_LOCKED = {
  EMAIL: { status: 429, code: "LOGIN_TOO_MANY_ATTEMPTS", message: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." },
  NETWORK: { status: 429, code: "LOGIN_TOO_MANY_ATTEMPTS", message: "Muitas tentativas sem sucesso com esta matrícula. Aguarde antes de tentar de novo — insistir com a senha errada pode bloquear a sua conta de rede. Se a senha está certa, peça ao administrador da INIA para conferir o seu acesso." },
} as const

const firstPasswordSchema = z.object({
  newPassword: z.string().min(1).max(1024),
  confirmPassword: z.string().max(1024),
}).strict()

/** Módulos ligados no ambiente (não é permissão: um módulo ligado ainda exige a permissão da conta). */
export type AuthFeatures = { interactionFeedbackQa: boolean; usageCollection?: boolean; usabilityPanel?: boolean }

export function createAuthRouter(db: Database, options: { features?: AuthFeatures; now?: () => Date; cookieSecure?: boolean; directory?: DirectoryAuthenticator; networkLoginMinimumMs?: number } = {}) {
  const directory = options.directory ?? directoryFromEnv()
  const features: AuthFeatures = options.features ?? { interactionFeedbackQa: false }
  const now = options.now ?? (() => new Date())
  const router = Router()
  const cookieMaxAgeMs = parseDurationToMs(env.JWT_EXPIRES_IN)
  const cookieSecure = options.cookieSecure ?? env.sessionCookieSecure
  const store = createPostgresCredentialStore(db)
  const networkLogin = createPostgresNetworkLoginRepository(db)
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

  // Que login a tela mostra: com o AD configurado na instalação e o login pela rede ligado em alguma organização, a tela pede a
  // matrícula (e oferece o e-mail só como "administrador"). Não revela nada de conta.
  router.get("/login-options", async (_request, response) => {
    response.set("Cache-Control", "no-store")
    const enabled = directory.configured && (await networkLogin.anyOrganizationEnabled())
    return response.json({ data: { networkLogin: enabled } })
  })

  router.post("/login", async (request, response) => {
    response.set("Cache-Control", "no-store")
    const input = loginSchema.parse(request.body)
    const device = readDeviceToken(request.cookies?.[DEVICE_COOKIE_NAME])
    const network = "matricula" in input
    const result = network
      ? await authenticateNetwork({ store, directory, identifierHash: loginIdentifierHash, now, retiredPasswordHash: () => hashPassword(randomBytes(32).toString("base64url")), ...(options.networkLoginMinimumMs !== undefined ? { minimumDurationMs: options.networkLoginMinimumMs } : {}) }, { login: input.matricula, password: input.password, device })
      : await authenticate({ store, verifyPassword, identifierHash: loginIdentifierHash, now }, { login: input.email, password: input.password, device })
    if (result.kind === "LOCKED") {
      const locked = network ? LOGIN_LOCKED.NETWORK : LOGIN_LOCKED.EMAIL
      return response.status(locked.status).json({ error: { code: locked.code, message: locked.message, details: { retryAt: result.retryAt.toISOString() } } })
    }
    if (result.kind !== "SUCCEEDED") {
      // Sem isto, "login indisponível" não deixava rastro de QUAL servidor falhou e por quê. Sem matrícula nem senha.
      if (result.kind === "NETWORK_UNAVAILABLE") console.error(JSON.stringify({ event: "network_login_unavailable", reason: result.reason }))
      const key = result.kind === "INVALID_CREDENTIALS" && network ? "INVALID_NETWORK_CREDENTIALS" : result.kind === "NETWORK_UNAVAILABLE" ? "NETWORK_LOGIN_UNAVAILABLE" : result.kind
      const refusal = LOGIN_REFUSALS[key]
      return response.status(refusal.status).json({ error: { code: refusal.code, message: refusal.message } })
    }

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
    const [access, identity, credentialMode] = await Promise.all([
      describeAccess({ repository: createPostgresAccessRepository(db), now: () => new Date() }, { organizationId: user.organizationId, accountId: user.sub, personId: user.personId }),
      // Identidade AO VIVO (nunca o snapshot do JWT): uma carga que atualiza o cadastro, ou a pessoa que muda como quer ser
      // chamada/a foto, aparece na próxima leitura — sem novo login.
      loadIdentityForSession(db, user),
      // Que credencial a pessoa usa para confirmar a ciência: a de rede (login pela rede ligado e conta comum) ou a local.
      networkLogin.credentialModeOf(user.sub),
    ])
    // Diagnóstico: regra operacional (lidera alguém) OU `indicators.view` — a mesma que a API aplica (diagnostics-access.ts).
    const canViewDiagnostics = await loadDiagnosticsAccess(db, { organizationId: user.organizationId, personId: user.personId, canViewIndicators: access.capabilities.canViewIndicators })
    // Base de boas práticas: o público do Diagnóstico lê; quem administra a configuração também lê e revisa (best-practices-router.ts).
    const bestPractices = { canViewBestPractices: canViewDiagnostics || access.capabilities.canManageConfiguration, canManageBestPractices: access.capabilities.canManageConfiguration }
    return response.json({ data: { ...user, ...identity, passwordChangeRequired: false, temporaryPasswordExpiresAt: null, sessionIdleTimeoutMinutes, credentialMode, access: { ...access, capabilities: { ...access.capabilities, canViewDiagnostics, canUseReports: canViewDiagnostics || access.capabilities.canDistributeReports, ...bestPractices } }, features } })
  })

  return router
}
