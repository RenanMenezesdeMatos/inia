import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * Usuário da sessão numa rota montada atrás de `requireAuth`/`can(...)`. O tipo do Express não sabe que o middleware já rodou
 * (`request.user` é opcional), e as rotas liam `request.user!`: se uma rota fosse montada sem o middleware (erro de
 * programação), a leitura virava TypeError e 500. Aqui o usuário sai com tipo garantido e a falta dele é o mesmo 401 do
 * `requireAuth`. Genérico para servir também aos routers que declaram o formato da requisição à mão.
 */
export function sessionUser<User>(request: { user?: User | undefined }): User {
  if (!request.user) throw new DomainError("Sessão ausente ou expirada.", "UNAUTHENTICATED", 401)
  return request.user
}
