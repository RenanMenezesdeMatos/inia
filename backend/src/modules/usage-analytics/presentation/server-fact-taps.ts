import type { Express, NextFunction, Request, RequestHandler, Response } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { verifyAuthToken, type AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { SESSION_COOKIE_NAME } from "../../auth/presentation/session-cookie.js"
import { accountIdentity } from "../../people/application/usage-analytics-reader.js"
import { countLoginFailure, recordServerUsageEvent } from "../application/record-server-event.js"
import type { UsageEntityType } from "../domain/usage-events.js"

/**
 * FATOS DE SERVIDOR observados na RESPOSTA das rotas existentes ("taps"): o tap é montado antes do roteiro original, guarda o
 * corpo devolvido e, quando a resposta termina com sucesso (2xx), grava o fato — DEPOIS da operação de negócio ter respondido.
 * Nenhuma regra de feedback, conversa ou login muda; falha do tap nunca altera a resposta (melhor esforço, log).
 * Rotas observadas: login/logout, sessão de voz emitida, ciclo e apresentação da aplicação de feedback, convite, notificação lida.
 */
type TapContext = { request: Request; status: number; body: unknown; preAuth: AuthTokenPayload | null }
type TapRule = { method: "POST"; path: RegExp; preAuth?: boolean; handle: (context: TapContext) => Promise<void> }

const SOURCE_KINDS = new Set(["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"])
const dataOf = (body: unknown) => (body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : null) as Record<string, unknown> | null
const sourceOf = (value: unknown): { type: UsageEntityType; id: string } | null => {
  const source = value as { kind?: unknown; id?: unknown } | null
  return source && typeof source.kind === "string" && SOURCE_KINDS.has(source.kind) && typeof source.id === "string" ? { type: source.kind as UsageEntityType, id: source.id } : null
}
const ok = (status: number) => status >= 200 && status < 300

function createTap(rules: readonly TapRule[]): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const rule = rules.find((candidate) => candidate.method === request.method && candidate.path.test(request.path))
    if (!rule) return next()
    let preAuth: AuthTokenPayload | null = null
    if (rule.preAuth) {
      try {
        const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined
        preAuth = token ? verifyAuthToken(token) : null
      } catch {
        preAuth = null
      }
    }
    let captured: unknown = null
    const json = response.json.bind(response)
    response.json = (payload: unknown) => {
      captured = payload
      return json(payload)
    }
    response.on("finish", () => {
      rule.handle({ request, status: response.statusCode, body: captured, preAuth }).catch((error: unknown) => console.error(JSON.stringify({ event: "usage_tap_failed", path: request.originalUrl.split("?")[0], message: (error as Error).message })))
    })
    return next()
  }
}

export function mountUsageServerTaps(app: Express, db: Pick<Database, "query">) {
  const actor = (request: Request) => (request.user ? { organizationId: request.user.organizationId, accountId: request.user.sub, actorPersonId: request.user.personId } : null)

  app.use(
    "/api/v1/auth",
    createTap([
      {
        method: "POST",
        path: /^\/login$/,
        handle: async ({ status, body }) => {
          if (status === 401) return countLoginFailure(db)
          const accountId = dataOf(body)?.id
          if (!ok(status) || typeof accountId !== "string") return
          const identity = await accountIdentity(db, accountId)
          if (identity) await recordServerUsageEvent(db, { organizationId: identity.organizationId, name: "auth.login_succeeded", accountId, actorPersonId: identity.personId })
        },
      },
      {
        method: "POST",
        path: /^\/logout$/,
        preAuth: true,
        handle: async ({ status, preAuth }) => {
          if (ok(status) && preAuth) await recordServerUsageEvent(db, { organizationId: preAuth.organizationId, name: "auth.logout", accountId: preAuth.sub, actorPersonId: preAuth.personId })
        },
      },
    ]),
  )

  app.use(
    "/api/v1/realtime",
    createTap([
      {
        method: "POST",
        path: /^\/sessions$/,
        handle: async ({ request, status }) => {
          const who = actor(request)
          if (!ok(status) || !who) return
          const feedbackApplicationId = (request.body as { feedbackApplicationId?: unknown } | undefined)?.feedbackApplicationId
          await recordServerUsageEvent(db, { ...who, name: "voice.session_issued", properties: { context: typeof feedbackApplicationId === "string" ? "FEEDBACK_APPLICATION" : "GENERAL" } })
        },
      },
    ]),
  )

  const lifecycle = (stage: "OPENED" | "PAUSED") => async ({ request, status, body }: TapContext) => {
    const who = actor(request)
    const data = dataOf(body)
    const entity = sourceOf(data?.source)
    if (!ok(status) || !who || !entity) return
    await recordServerUsageEvent(db, { ...who, name: "feedback_application.lifecycle", subjectPersonId: who.actorPersonId, entity, properties: { stage, applicationId: typeof data?.id === "string" ? data.id : null } })
  }
  app.use(
    "/api/v1/feedback-applications",
    createTap([
      {
        method: "POST",
        path: /^\/$/,
        handle: async ({ request, status, body }) => {
          const who = actor(request)
          const data = dataOf(body)
          const application = data?.application as { id?: unknown; source?: unknown } | undefined
          const entity = sourceOf(application?.source)
          if (!ok(status) || !who || !entity) return
          await recordServerUsageEvent(db, { ...who, name: "feedback_application.lifecycle", subjectPersonId: who.actorPersonId, entity, properties: { stage: data?.created === true ? "STARTED" : "RESUMED", applicationId: typeof application?.id === "string" ? application.id : null } })
        },
      },
      { method: "POST", path: /^\/[0-9a-f-]{36}\/opened$/, handle: lifecycle("OPENED") },
      { method: "POST", path: /^\/[0-9a-f-]{36}\/pause$/, handle: lifecycle("PAUSED") },
      {
        method: "POST",
        path: /^\/[0-9a-f-]{36}\/presentation-events$/,
        handle: async ({ request, status, body }) => {
          const who = actor(request)
          const data = dataOf(body)
          const stage = (request.body as { event?: unknown } | undefined)?.event
          const entity = sourceOf(data?.source)
          if (!ok(status) || !who || typeof data?.id !== "string" || typeof stage !== "string") return
          await recordServerUsageEvent(db, { ...who, name: "feedback_application.presentation", subjectPersonId: who.actorPersonId, entity, properties: { stage, applicationId: data.id } })
        },
      },
      {
        method: "POST",
        path: /^\/invite\/events$/,
        handle: async ({ request, status }) => {
          const who = actor(request)
          const input = request.body as { source?: unknown; event?: unknown } | undefined
          const entity = sourceOf(input?.source)
          if (!ok(status) || !who || !entity || typeof input?.event !== "string") return
          await recordServerUsageEvent(db, { ...who, name: "feedback_application.invite", subjectPersonId: who.actorPersonId, entity, properties: { decision: input.event } })
        },
      },
    ]),
  )

  app.use(
    "/api/v1/notifications",
    createTap([
      {
        method: "POST",
        path: /^\/read-all$/,
        handle: async ({ request, status }) => {
          const who = actor(request)
          if (ok(status) && who) await recordServerUsageEvent(db, { ...who, name: "notification.read", subjectPersonId: who.actorPersonId, properties: { scope: "ALL" } })
        },
      },
      {
        method: "POST",
        path: /^\/[0-9a-f-]{36}\/read$/,
        handle: async ({ request, status }) => {
          const who = actor(request)
          const alertId = request.path.split("/")[1]
          if (ok(status) && who && alertId) await recordServerUsageEvent(db, { ...who, name: "notification.read", subjectPersonId: who.actorPersonId, entity: { type: "ALERT", id: alertId }, properties: { scope: "ONE" } })
        },
      },
    ]),
  )
}
