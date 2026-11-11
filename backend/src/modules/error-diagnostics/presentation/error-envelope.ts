import type { Request, RequestHandler, Response } from "express"
import { currentRequestId } from "../../../shared/application/observability/request-context.js"
import { serviceRelease } from "../../../shared/application/observability/service-identity.js"
import type { SanitizedError } from "../../../shared/application/errors/classify-error.js"
import { severityFor } from "../../../shared/domain/errors/error-lookup.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { recordOccurrence } from "../application/occurrence-recorder.js"
import { normalizeRoute } from "../domain/error-occurrence.js"

const log = createLogger("http")

/** Onde o handler global deixa o resumo SANITIZADO de uma falha inesperada (o envelope registra uma vez só, com ele). */
export const ERROR_SUMMARY_LOCAL = "iniaErrorSummary"

/**
 * Rota normalizada: o caminho ORIGINAL com ids (uuid, números longos, tokens) trocados e sem query. Não usa o padrão do Express:
 * quando o erro passa pelo handler global o `baseUrl` já foi zerado e a rota sairia vazia.
 */
export function routeOf(request: Request): string {
  return `${request.method} ${normalizeRoute(request.originalUrl || request.url)}`
}

/**
 * Envelope das respostas de ERRO da API, num ponto só (sem tocar as ~500 rotas que respondem `{ error: { code, message } }`):
 * - acrescenta `error.reference` = `x-request-id` (o que a pessoa copia da tela) — `requestId` do 500 continua por compatibilidade;
 * - grava UMA linha `http_error` no log (código, referência, status, rota normalizada, severidade; serviço/versão/hora UTC vêm do
 *   logger) — 4xx em `info`/`warn`, 5xx em `error` com o resumo sanitizado da falha;
 * - registra a ocorrência no banco (assíncrono, com teto; ver occurrence-recorder.ts), exceto o 404 de rota inexistente
 *   (varredura) — que fica só no log.
 * Status e corpo continuam os mesmos: só o campo `reference` é acrescentado.
 */
export function errorEnvelope(): RequestHandler {
  return (request, response, next) => {
    const originalJson = response.json.bind(response)
    response.json = ((body: unknown) => {
      if (response.statusCode >= 400) decorate(request, response, body)
      return originalJson(body)
    }) as Response["json"]
    response.setHeader("x-inia-release", serviceRelease())
    next()
  }
}

function decorate(request: Request, response: Response, body: unknown): void {
  const reference = currentRequestId()
  const errorObject = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "object" && (body as { error: unknown }).error !== null ? ((body as { error: Record<string, unknown> }).error) : null
  const code = typeof errorObject?.code === "string" ? errorObject.code : `HTTP_${response.statusCode}`
  if (errorObject && reference && errorObject.reference === undefined) errorObject.reference = reference
  const status = response.statusCode
  const route = routeOf(request)
  const severity = severityFor(code, status)
  const summary = response.locals[ERROR_SUMMARY_LOCAL] as SanitizedError | undefined
  const user = request.user
  const line = { event: "http_error", reference, code, status, severity, route, ...(summary ? { failure: summary } : {}) }
  if (status >= 500) log.error(line, "erro na API")
  else if (severity === "warning") log.warn(line, "erro do cliente na API")
  else log.info(line, "erro do cliente na API")
  if (!reference) return
  const unmatchedRoute = status === 404 && code === "NOT_FOUND" && !request.route
  if (unmatchedRoute) return
  recordOccurrence({
    reference,
    code,
    source: "API",
    httpStatus: status,
    severity,
    method: request.method,
    route,
    organizationId: user?.organizationId ?? null,
    authenticated: Boolean(user),
    details: summary ? { failure: summary } : {},
  })
}
