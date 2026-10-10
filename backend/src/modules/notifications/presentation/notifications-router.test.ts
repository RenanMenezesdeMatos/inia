import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { ENROLLMENT, InMemoryPendingActionsRepository, OPERATOR, ORG, OTHER_SUPERVISOR, SUPERVISOR } from "../../pending-actions/testing/in-memory-pending-actions-repository.js"
import { decideHumanReview } from "../../pending-actions/application/build-pending-actions.js"
import { InMemoryNotificationsRepository } from "../testing/in-memory-notifications-repository.js"
import { createNotificationsRouter } from "./notifications-router.js"

const noDatabase = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database
const A1 = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
const A2 = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
const A3 = "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
const A4 = "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4"

function fixtures() {
  const pending = InMemoryPendingActionsRepository.fixture()
  // O alerta de revisão do fixture de pendências tem id "alert-1"; o sino usa ids uuid.
  pending.alerts[0]!.id = A1
  const notifications = new InMemoryNotificationsRepository([
    { id: A1, recipientId: SUPERVISOR, organizationId: ORG, alertType: "WORKFLOW_HUMAN_REVIEW", title: "Revisão pendente: Karoline", description: "Um workflow está aguardando sua decisão. Instrução: Avalie. Conteúdo: {\"text\":\"muito longo\"}", severity: "HIGH", status: "OPEN", createdAt: "2026-09-14T10:00:00.000Z", readAt: null, caseId: "case-1", dedupeKey: `workflow_human_review:${ENROLLMENT}:review`, operator: { personId: OPERATOR, name: "Karoline" } },
    { id: A2, recipientId: SUPERVISOR, organizationId: ORG, alertType: "WORKFLOW_OUTPUT", title: "Novo output de workflow: Karoline", description: "Um workflow gerou uma saída relacionada a Karoline.", severity: "MEDIUM", status: "OPEN", createdAt: "2026-09-14T09:00:00.000Z", readAt: null, caseId: "case-1", dedupeKey: "workflow_output:x:y:z", operator: { personId: OPERATOR, name: "Karoline" } },
    { id: A3, recipientId: SUPERVISOR, organizationId: ORG, alertType: "WORKFLOW_ESCALATION", title: "Escalonamento: Karoline", description: "Caso de qualidade escalado.", severity: "HIGH", status: "SEEN", createdAt: "2026-09-13T09:00:00.000Z", readAt: "2026-09-13T10:00:00.000Z", caseId: "case-1", dedupeKey: "escalation:1", operator: { personId: OPERATOR, name: "Karoline" } },
    { id: A4, recipientId: OTHER_SUPERVISOR, organizationId: ORG, alertType: "WORKFLOW_OUTPUT", title: "Novo output: outra equipe", description: "x", severity: "MEDIUM", status: "OPEN", createdAt: "2026-09-14T12:00:00.000Z", readAt: null, caseId: null, dedupeKey: "workflow_output:o:o:o", operator: null },
  ])
  return { pending, notifications }
}

function appAs(personId: string | null, repos: ReturnType<typeof fixtures>) {
  const app = express()
  app.use(express.json())
  app.use((requestObject, _response, next) => {
    if (personId) requestObject.user = { sub: "acc", personId, organizationId: ORG, role: "SUPERVISOR", name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null } satisfies AuthTokenPayload
    next()
  })
  app.use("/notifications", (requestObject, response, next) => (requestObject.user ? next() : response.status(401).json({ error: { code: "UNAUTHENTICATED" } })), createNotificationsRouter(noDatabase, repos.notifications, repos.pending))
  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof DomainError) return response.status(error.statusCode).json({ error: { code: error.code } })
    if (error instanceof ZodError) return response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    void next
    return response.status(500).json({ error: { code: "INTERNAL_ERROR", message: String(error) } })
  }
  app.use(errorHandler)
  return app
}

describe("Sino — conteúdo e autorização", () => {
  it("sem sessão → 401", async () => {
    expect((await request(appAs(null, fixtures())).get("/notifications")).status).toBe(401)
  })

  it("lista só alertas do viewer, com tipo, destino e badge de não lidos; revisão pendente é acionável", async () => {
    const response = await request(appAs(SUPERVISOR, fixtures())).get("/notifications")
    expect(response.status).toBe(200)
    const data = response.body.data
    expect(data.unreadCount).toBe(2)
    expect(data.pendingActionCount).toBe(1)
    expect(data.items.map((item: { id: string }) => item.id)).toEqual([A1, A2, A3])
    expect(data.items[0]).toMatchObject({ kind: "HUMAN_REVIEW", actionable: true, target: { type: "PENDING_ACTION", actionId: `${ENROLLMENT}:review` }, operator: { personId: OPERATOR } })
    expect(data.items[0].description).not.toContain("Conteúdo:")
    expect(data.items[1]).toMatchObject({ kind: "WORKFLOW_OUTPUT", target: { type: "FOLLOW_UP", itemId: A2, operatorId: OPERATOR } })
    expect(data.items[2]).toMatchObject({ kind: "ESCALATION", readAt: "2026-09-13T10:00:00.000Z", target: { type: "FOLLOW_UP", itemId: A3 } })
  })

  it("alerta de outra estrutura nunca aparece nem pode ser marcado como lido por quem não é o destinatário", async () => {
    const repos = fixtures()
    const app = appAs(SUPERVISOR, repos)
    const list = await request(app).get("/notifications")
    expect(list.body.data.items.some((item: { id: string }) => item.id === A4)).toBe(false)
    const read = await request(app).post(`/notifications/${A4}/read`)
    expect(read.status).toBe(404)
    expect(repos.notifications.alerts.find((alert) => alert.id === A4)?.readAt).toBeNull()
  })
})

describe("Sino — estado de leitura ≠ decisão", () => {
  it("marcar como lida baixa o badge e NÃO decide a revisão", async () => {
    const repos = fixtures()
    const app = appAs(SUPERVISOR, repos)
    expect((await request(app).post(`/notifications/${A1}/read`)).status).toBe(204)
    const after = await request(app).get("/notifications")
    expect(after.body.data.unreadCount).toBe(1)
    expect(after.body.data.pendingActionCount).toBe(1)
    expect(after.body.data.items[0]).toMatchObject({ readAt: expect.any(String), actionable: true })
    expect(repos.pending.submissions).toHaveLength(0)
  })

  it("marcar todas como lidas zera o badge só para o viewer", async () => {
    const repos = fixtures()
    const response = await request(appAs(SUPERVISOR, repos)).post("/notifications/read-all")
    expect(response.body.data.updated).toBe(2)
    expect((await request(appAs(SUPERVISOR, repos)).get("/notifications")).body.data.unreadCount).toBe(0)
    expect((await request(appAs(OTHER_SUPERVISOR, repos)).get("/notifications")).body.data.unreadCount).toBe(1)
  })

  it("decidir a revisão (pela Pendência) some do contador de pendentes e a notificação vira histórico", async () => {
    const repos = fixtures()
    await decideHumanReview(repos.pending, repos.pending.submit, { personId: SUPERVISOR, organizationId: ORG }, { enrollmentId: ENROLLMENT, nodeId: "review", decision: "approved" })
    repos.notifications.alerts[0]!.status = "RESOLVED" // reflexo do resolveAlert() no Pg
    const after = await request(appAs(SUPERVISOR, repos)).get("/notifications")
    expect(after.body.data.pendingActionCount).toBe(0)
    expect(after.body.data.items[0]).toMatchObject({ actionable: false, resolved: true, description: "Revisão já decidida." })
    expect(after.body.data.unreadCount).toBe(1)
  })
})
