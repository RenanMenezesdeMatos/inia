import type { NextFunction, Request, Response } from "express"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { decideSession } from "../domain/session-state.js"
import type { VerifiedAuthToken } from "../infrastructure/jwt.js"
import { verifyAuthToken } from "../infrastructure/jwt.js"
import { createPostgresCredentialStore } from "../infrastructure/postgres-credential-store.js"
import { SESSION_COOKIE_NAME } from "./session-cookie.js"

declare module "express-serve-static-core" {
  interface Request {
    user?: VerifiedAuthToken
    /** Estado da credencial lido do banco neste request (troca de senha pendente e validade da temporária). */
    session?: { passwordChangeRequired: boolean; temporaryPasswordExpiresAt: Date | null }
  }
}

/** Leituras não renovam a sessão (o sino e os avisos da tela consultam sozinhos): só ação que altera algo — inclusive o aviso
 * de interação que a tela manda (POST /auth/activity). */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
/** A atividade é gravada no máximo uma vez por minuto por sessão (uma escrita por minuto de uso, não por request). */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000

/**
 * GUARD DE SESSÃO: JWT válido E conta em dia NO BANCO, a cada request — conta desabilitada, sessão revogada (versão diferente),
 * sessão parada além de SESSION_IDLE_TIMEOUT_MINUTES ou senha temporária vencida derrubam a sessão na hora (401, cookie
 * apagado). Com a troca de senha pendente, só as rotas que declaram `allowPendingPasswordChange` (ver /auth/me e
 * /auth/password) passam; o resto responde 403 PASSWORD_CHANGE_REQUIRED.
 */
export function createRequireAuth(db: Pick<Database, "query">, options: { allowPendingPasswordChange?: boolean; now?: () => Date; idleTimeoutMs?: number } = {}) {
  const store = createPostgresCredentialStore(db)
  const now = options.now ?? (() => new Date())
  const idleTimeoutMs = options.idleTimeoutMs ?? env.sessionIdleTimeoutMs
  return async function requireAuth(request: Request, response: Response, next: NextFunction) {
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    if (!token) {
      return response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou expirada." } })
    }
    let user: VerifiedAuthToken
    try {
      user = verifyAuthToken(token)
    } catch {
      return response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sessão ausente ou expirada." } })
    }
    let decision
    let liveRole: VerifiedAuthToken["role"] | undefined
    const at = now()
    try {
      const state = await store.sessionState(user.organizationId, user.sub, user.jti ?? null)
      liveRole = state?.role
      decision = decideSession(state, user.sv ?? 0, at, { allowPendingPasswordChange: options.allowPendingPasswordChange === true, idleTimeoutMs })
      // Atividade desta sessão: só ação que altera algo, e no máximo uma gravação por minuto. Token sem jti (anterior à
      // revogação por sessão) não tem como ser medido — vence pelo prazo absoluto, como sempre.
      const lastActivityAt = state?.lastActivityAt ?? null
      if (decision.ok && idleTimeoutMs > 0 && user.jti && typeof user.exp === "number" && !READ_METHODS.has(request.method)
        && (!lastActivityAt || at.getTime() - lastActivityAt.getTime() >= ACTIVITY_WRITE_INTERVAL_MS)) {
        await store.recordSessionActivity({ accountId: user.sub, sessionId: user.jti, expiresAt: new Date(user.exp * 1000), at })
      }
    } catch (error) {
      return next(error)
    }
    if (!decision.ok) {
      // Cookie `__Host-` só é apagado com os mesmos atributos com que foi criado (Secure, Path=/).
      if (decision.status === 401) response.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure: env.sessionCookieSecure, sameSite: "lax", path: "/" })
      return response.status(decision.status).json({ error: { code: decision.code, message: decision.message } })
    }
    // O nível hierárquico do JWT é a foto do login; vale o do cadastro AGORA (nunca amplia por uma promoção revertida).
    request.user = liveRole ? { ...user, role: liveRole } : user
    request.session = { passwordChangeRequired: decision.passwordChangeRequired, temporaryPasswordExpiresAt: decision.temporaryPasswordExpiresAt }
    // Organização das chamadas de IA feitas neste request (policy/uso/orçamento — AI Providers V1): vem
    // SEMPRE da sessão verificada, nunca do corpo/URL. Origem = request de uma pessoa → prioridade INTERATIVA no limitador.
    // A pessoa da sessão vai junto e fica no evento de uso (quem pediu — ranking "Quem mais usa", migration 143).
    return runWithAiOrganization(user.organizationId, () => next(), { origin: "USER_REQUEST", requesterPersonId: user.personId })
  }
}
