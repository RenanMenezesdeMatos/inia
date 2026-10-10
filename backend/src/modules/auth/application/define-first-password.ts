import { DomainError } from "../../../shared/domain/domain-error.js"
import { PASSWORD_POLICY_MESSAGES, passwordPolicyViolations } from "../domain/password-policy.js"
import { decideSession } from "../domain/session-state.js"
import type { CredentialStore } from "./credential-store.js"

export type DefineFirstPasswordDeps = {
  store: CredentialStore
  hashPassword: (plain: string) => Promise<string>
  verifyPassword: (plain: string, hash: string) => Promise<boolean>
  now: () => Date
}

/**
 * PRIMEIRO ACESSO — a pessoa que entrou com a senha temporária cria a própria senha. Só existe enquanto a troca é obrigatória
 * e a senha temporária ainda vale. A nova senha: confere com a confirmação, cumpre a política e é diferente da temporária
 * (comparada com o hash atual, que É o da temporária). Concluir apaga a temporária, deixa o acesso ATIVO e revoga as outras
 * sessões (ex.: outro aparelho que entrou com a temporária); a sessão atual recebe a versão nova.
 */
export async function defineFirstPassword(deps: DefineFirstPasswordDeps, input: { organizationId: string; accountId: string; personId: string; newPassword: string; confirmPassword: string }) {
  const now = deps.now()
  const state = await deps.store.passwordState(input.organizationId, input.accountId)
  if (!state || !state.active) throw new DomainError("Sua sessão foi encerrada. Entre novamente.", "SESSION_REVOKED", 401)
  if (!state.passwordChangeRequired) throw new DomainError("Sua senha já foi criada.", "PASSWORD_CHANGE_NOT_REQUIRED", 409)
  const session = decideSession(state, state.sessionVersion, now, { allowPendingPasswordChange: true })
  if (!session.ok) throw new DomainError(session.message, session.code, session.status)

  if (input.newPassword !== input.confirmPassword) throw new DomainError("A confirmação não é igual à nova senha.", "PASSWORD_CONFIRMATION_MISMATCH", 422)
  const violations = passwordPolicyViolations(input.newPassword, { login: state.email })
  if (violations.length > 0) {
    throw new DomainError("A senha não atende à política de segurança.", "PASSWORD_POLICY_VIOLATION", 422, { violations: violations.map((code) => ({ code, message: PASSWORD_POLICY_MESSAGES[code] })) })
  }
  if (await deps.verifyPassword(input.newPassword, state.passwordHash)) {
    throw new DomainError("A nova senha precisa ser diferente da senha temporária.", "PASSWORD_SAME_AS_TEMPORARY", 422)
  }

  const changed = await deps.store.completePasswordChange({
    organizationId: input.organizationId,
    accountId: input.accountId,
    actorPersonId: input.personId,
    expectedSessionVersion: state.sessionVersion,
    passwordHash: await deps.hashPassword(input.newPassword),
    at: now,
  })
  // Outra senha temporária foi gerada (ou o acesso desabilitado) enquanto a pessoa digitava: nada é gravado.
  if (!changed) throw new DomainError("Seu acesso foi alterado agora há pouco. Entre novamente.", "SESSION_REVOKED", 401)
  return changed
}
