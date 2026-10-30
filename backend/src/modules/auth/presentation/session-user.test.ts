import express from "express"
import supertest from "supertest"
import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { sessionUser } from "./session-user.js"

describe("sessionUser", () => {
  it("devolve o usuário que o requireAuth deixou na requisição", () => {
    const user = { sub: "conta-1", organizationId: "org-1", personId: "pessoa-1" }
    expect(sessionUser({ user })).toBe(user)
  })

  it("sem usuário (rota montada sem o middleware): o mesmo 401 do requireAuth, nunca TypeError/500", async () => {
    expect(() => sessionUser({})).toThrow(DomainError)
    const app = express()
    app.get("/esquecida", (request, response) => {
      response.json({ data: sessionUser(request).organizationId })
    })
    app.use(((error, _request, response, next) => {
      if (!(error instanceof DomainError)) return next(error)
      response.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    }) satisfies express.ErrorRequestHandler)
    const response = await supertest(app).get("/esquecida")
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe("UNAUTHENTICATED")
  })
})
