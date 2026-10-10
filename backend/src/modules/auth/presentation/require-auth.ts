import type { NextFunction, Request, Response } from "express"
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

/**
 * GUARD DE SESSÃO: JWT válido E conta em dia NO BANCO, a cada request — conta desabilitada, sessão revogada (versão diferente)
 * ou senha temporária vencida derrubam a sessão na hora (401, cookie apagado). Com a troca de senha pendente, só as rotas que
 * declaram `allowPendingPasswordChange` (ver /auth/me e /auth/password) passam; o resto responde 403 PASSWORD_CHANGE_REQUIRED.
 */
export function createRequireAuth(db: Pick<Database, "query">, options: { allowPendingPasswordChange?: boolean; now?: () => Date } = {}) {
  const store = createPostgresCredentialStore(db)
  const now = options.now ?? (() => new Date())
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
    try {
      const state = await store.sessionState(user.organizationId, user.sub, user.jti ?? null)
      liveRole = state?.role
      decision = decideSession(state, user.sv ?? 0, now(), { allowPendingPasswordChange: options.allowPendingPasswordChange === true })
    } catch (error) {
      return next(error)
    }
    if (!decision.ok) {
      if (decision.status === 401) response.clearCookie(SESSION_COOKIE_NAME, { path: "/" })
      return response.status(decision.status).json({ error: { code: decision.code, message: decision.message } })
    }
    // O nível hierárquico do JWT é a foto do login; vale o do cadastro AGORA (nunca amplia por uma promoção revertida).
    request.user = liveRole ? { ...user, role: liveRole } : user
    request.session = { passwordChangeRequired: decision.passwordChangeRequired, temporaryPasswordExpiresAt: decision.temporaryPasswordExpiresAt }
    // Organização das chamadas de IA feitas neste request (policy/uso/orçamento — AI Providers V1): vem
    // SEMPRE da sessão verificada, nunca do corpo/URL. Origem = request de uma pessoa → prioridade INTERATIVA no limitador.
    return runWithAiOrganization(user.organizationId, () => next(), { origin: "USER_REQUEST" })
  }
}
