import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { ENROLLMENT, InMemoryPendingActionsRepository, OPERATOR, ORG, OTHER_ENROLLMENT, OTHER_SUPERVISOR, SUPERVISOR } from "../testing/in-memory-pending-actions-repository.js"
import { createPendingActionsRouter } from "./pending-actions-router.js"

const noDatabase = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database

function user(personId: string): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role: "SUPERVISOR", name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

function appAs(personId: string | null, repository: InMemoryPendingActionsRepository) {
  const app = express()
  app.use(express.json())
  app.use((requestObject, _response, next) => {
    if (personId) requestObject.user = user(personId)
    next()
  })
  app.use("/pending-actions", (requestObject, response, next) => (requestObject.user ? next() : response.status(401).json({ error: { code: "UNAUTHENTICATED" } })), createPendingActionsRouter(noDatabase, repository, repository.submit))
  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof DomainError) return response.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    if (error instanceof ZodError) return response.status(400).json({ error: { code: "VALIDATION_ERROR" } })
    void next
    return response.status(500).json({ error: { code: "INTERNAL_ERROR", message: String(error) } })
  }
  app.use(errorHandler)
  return app
}

const REVIEW_PATH = `/pending-actions/human-reviews/${ENROLLMENT}/review`

describe("Pendências — autorização e visibilidade", () => {
  it("sem sessão → 401", async () => {
    const response = await request(appAs(null, InMemoryPendingActionsRepository.fixture())).get("/pending-actions")
    expect(response.status).toBe(401)
  })

  it("o supervisor endereçado vê a revisão pendente com contexto; alertas órfãos ficam fora", async () => {
    const response = await request(appAs(SUPERVISOR, InMemoryPendingActionsRepository.fixture())).get("/pending-actions")
    expect(response.status).toBe(200)
    expect(response.body.data.pendingCount).toBe(1)
    expect(response.body.data.pending).toHaveLength(1)
    expect(response.body.data.history).toHaveLength(0)
    const item = response.body.data.pending[0]
    expect(item).toMatchObject({ id: `${ENROLLMENT}:review`, kind: "HUMAN_REVIEW", status: "PENDING", workflowName: "Qualidade recorrente", nodeLabel: "Revisão do supervisor", reason: "Avalie a recorrência.", caseId: "case-1" })
    expect(item.operator).toMatchObject({ personId: OPERATOR, name: "Karoline", teamName: "Atendimento" })
  })

  it("outro supervisor NÃO vê nem abre a revisão de estrutura alheia", async () => {
    const app = appAs(OTHER_SUPERVISOR, InMemoryPendingActionsRepository.fixture())
    const list = await request(app).get("/pending-actions")
    expect(list.body.data.pending.map((item: { enrollmentId: string }) => item.enrollmentId)).toEqual([OTHER_ENROLLMENT])
    const detail = await request(app).get(REVIEW_PATH)
    expect(detail.status).toBe(404)
    const decision = await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "approved" })
    expect(decision.status).toBe(404)
  })

  it("detalhe traz instrução, conteúdo resolvido do Execution Context, evidências e só as decisões com aresta", async () => {
    const response = await request(appAs(SUPERVISOR, InMemoryPendingActionsRepository.fixture())).get(REVIEW_PATH)
    expect(response.status).toBe(200)
    const detail = response.body.data
    expect(detail.instruction).toBe("Avalie a recorrência.")
    expect(detail.content).toContain("**Qualidade** abaixo da meta.")
    expect(detail.allowedDecisions).toEqual(["approved", "rejected"])
    expect(detail.caseTitle).toBe("Qualidade abaixo da meta")
    expect(detail.evidences).toHaveLength(1)
    expect(detail.previousOutputs).toEqual([{ nodeId: "orch", nodeLabel: "Diagnóstico", text: "### Diagnóstico\n\n**Qualidade** abaixo da meta." }])
    expect(detail.timeline).toHaveLength(1)
  })
})

describe("Pendências — decisão", () => {
  it("aprovar grava pela função compartilhada, retoma a execução, resolve o alerta e sai da fila", async () => {
    const repository = InMemoryPendingActionsRepository.fixture()
    const app = appAs(SUPERVISOR, repository)
    const response = await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "approved" })
    expect(response.status).toBe(200)
    expect(response.body.data.status).toBe("DECIDED")
    expect(response.body.data.decision).toBe("approved")
    expect(response.body.data.reviewer).toEqual({ personId: SUPERVISOR, name: "Vanessa" })
    expect(repository.submissions).toEqual([{ enrollmentId: ENROLLMENT, nodeId: "review", decision: "approved", reviewerId: SUPERVISOR }])
    expect(repository.enrollments.get(ENROLLMENT)?.status).toBe("active")
    expect(repository.resolvedAlerts).toEqual(["alert-1"])

    const list = await request(app).get("/pending-actions")
    expect(list.body.data.pendingCount).toBe(0)
    expect(list.body.data.history[0]).toMatchObject({ status: "DECIDED", decision: "approved" })
  })

  it("reprovar segue o mesmo caminho", async () => {
    const repository = InMemoryPendingActionsRepository.fixture()
    const response = await request(appAs(SUPERVISOR, repository)).post(`${REVIEW_PATH}/decision`).send({ decision: "rejected" })
    expect(response.status).toBe(200)
    expect(repository.submissions[0]?.decision).toBe("rejected")
  })

  it("retry da mesma decisão é idempotente (não grava de novo); decisão diferente → 409", async () => {
    const repository = InMemoryPendingActionsRepository.fixture()
    const app = appAs(SUPERVISOR, repository)
    await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "approved" })
    const again = await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "approved" })
    expect(again.status).toBe(200)
    expect(again.body.data.status).toBe("DECIDED")
    expect(repository.submissions).toHaveLength(1)
    const different = await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "rejected" })
    expect(different.status).toBe(409)
    expect(different.body.error.code).toBe("PENDING_ACTION_ALREADY_DECIDED")
    expect(repository.submissions).toHaveLength(1)
  })

  it("escalar sem aresta no grafo é recusado (422) e nada é gravado", async () => {
    const repository = InMemoryPendingActionsRepository.fixture()
    const response = await request(appAs(SUPERVISOR, repository)).post(`${REVIEW_PATH}/decision`).send({ decision: "escalated" })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("PENDING_ACTION_DECISION_NOT_ALLOWED")
    expect(repository.submissions).toHaveLength(0)
  })

  it("execução que já seguiu por outro caminho → 409 UNAVAILABLE; decisão inválida → 400", async () => {
    const repository = InMemoryPendingActionsRepository.fixture()
    repository.enrollments.get(ENROLLMENT)!.status = "completed"
    const app = appAs(SUPERVISOR, repository)
    const unavailable = await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "approved" })
    expect(unavailable.status).toBe(409)
    expect(unavailable.body.error.code).toBe("PENDING_ACTION_UNAVAILABLE")
    const invalid = await request(app).post(`${REVIEW_PATH}/decision`).send({ decision: "maybe" })
    expect(invalid.status).toBe(400)
  })
})
