/**
 * Códigos de falhas que nascem no NAVEGADOR (ou no proxy, visto pelo navegador). Todos existem no catálogo do backend
 * (`backend/src/shared/domain/errors/error-catalog.ts`): o teste `error-catalog.test.ts` recusa um código daqui que não esteja lá.
 */
export const CLIENT_ERROR_CODES = {
  offline: "INIA-REDE-SEM-CONEXAO",
  apiUnreachable: "INIA-REDE-API-INALCANCAVEL",
  proxyUnavailable: "INIA-PROXY-INDISPONIVEL",
  invalidResponse: "INIA-INTERFACE-RESPOSTA-INVALIDA",
  render: "INIA-INTERFACE-RENDERIZACAO",
  serverRender: "INIA-INTERFACE-SERVIDOR",
  pageNotFound: "INIA-INTERFACE-PAGINA-NAO-ENCONTRADA",
} as const

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES]

/** Referência de uma ocorrência gerada no navegador (mesma forma aceita pela API em `x-request-id`). */
export function newReference(prefix = ""): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}${id}`
}
