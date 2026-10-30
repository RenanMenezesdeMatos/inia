import { randomUUID } from "node:crypto"
import type { RequestHandler } from "express"
import { runWithRequestId } from "../application/observability/request-context.js"

export const REQUEST_ID_HEADER = "x-request-id"

/** Só identificador simples e curto: o valor vai para o log e para a resposta (nada de quebra de linha ou texto livre). */
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/

/**
 * Primeiro middleware da API: dá um id à requisição — o que vier em `x-request-id` (IIS, balanceador ou o próprio cliente
 * correlacionando chamadas), se for um identificador simples, senão um UUID novo —, devolve-o no mesmo cabeçalho e roda o resto
 * da cadeia dentro do contexto da requisição (`currentRequestId()`).
 */
export function requestIdMiddleware(): RequestHandler {
  return (request, response, next) => {
    const incoming = request.get(REQUEST_ID_HEADER)
    const requestId = incoming && ACCEPTED_REQUEST_ID.test(incoming) ? incoming : randomUUID()
    response.setHeader(REQUEST_ID_HEADER, requestId)
    runWithRequestId(requestId, next)
  }
}
