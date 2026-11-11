import express from "express"
import request from "supertest"
import { afterEach, describe, expect, it } from "vitest"
import { classifyUnexpectedError, redactSensitive, sanitizeError } from "../../../shared/application/errors/classify-error.js"
import { requestIdMiddleware } from "../../../shared/presentation/request-id.js"
import { registerOccurrenceRecorder, createOccurrenceRecorder } from "../application/occurrence-recorder.js"
import type { OccurrenceInput } from "../domain/error-occurrence.js"
import { normalizeRoute } from "../domain/error-occurrence.js"
import { ERROR_SUMMARY_LOCAL, errorEnvelope } from "./error-envelope.js"

function appWith(recorded: OccurrenceInput[]) {
  registerOccurrenceRecorder({ record: (input) => recorded.push(input), stats: () => ({ recorded: recorded.length, dropped: 0, failed: 0 }) })
  const app = express()
  app.use(requestIdMiddleware())
  app.use(errorEnvelope())
  app.get("/api/v1/itens/:id", (_request, response) => response.status(403).json({ error: { code: "FORBIDDEN", message: "Sem permissão." } }))
  app.get("/ok", (_request, response) => response.json({ data: 1 }))
  app.get("/quebra", () => {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432 senha=abc123"), { code: "ECONNREFUSED" })
  })
  app.use((_request, response) => response.status(404).json({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } }))
  // Quatro parâmetros: é assim que o Express reconhece um handler de erro.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(((error, _request, response, _next) => {
    const failure = classifyUnexpectedError(error)
    response.locals[ERROR_SUMMARY_LOCAL] = failure.summary
    response.status(500).json({ error: { code: failure.code, message: "Erro interno." } })
  }) as express.ErrorRequestHandler)
  return app
}

afterEach(() => registerOccurrenceRecorder(null))

describe("envelope de erro", () => {
  it("acrescenta a referência (= x-request-id) sem mudar status nem código, e registra a ocorrência com a rota normalizada", async () => {
    const recorded: OccurrenceInput[] = []
    const response = await request(appWith(recorded)).get("/api/v1/itens/3f2b8c1a-1111-2222-3333-444455556666?email=a@b.com").set("x-request-id", "tela-ref-0001")
    expect(response.status).toBe(403)
    expect(response.body.error).toEqual({ code: "FORBIDDEN", message: "Sem permissão.", reference: "tela-ref-0001" })
    expect(response.headers["x-inia-release"]).toBeTruthy()
    expect(recorded).toEqual([expect.objectContaining({ reference: "tela-ref-0001", code: "FORBIDDEN", source: "API", httpStatus: 403, route: "GET /api/v1/itens/:id", authenticated: false })])
  })

  it("corpo de erro compartilhado (constante de módulo) nunca é alterado: cada resposta leva a SUA referência (run-3 C04)", async () => {
    const SHARED_NOT_FOUND = { error: { code: "NOT_FOUND", message: "Caso não encontrado." } } as const
    registerOccurrenceRecorder({ record: () => undefined, stats: () => ({ recorded: 0, dropped: 0, failed: 0 }) })
    const app = express()
    app.use(requestIdMiddleware())
    app.use(errorEnvelope())
    app.get("/api/v1/casos/:id", (_request, response) => response.status(404).json(SHARED_NOT_FOUND))
    const first = await request(app).get("/api/v1/casos/x").set("x-request-id", "ATACANTE-REF-0001")
    const second = await request(app).get("/api/v1/casos/y").set("x-request-id", "vitima-ref-0002")
    expect(first.body.error.reference).toBe("ATACANTE-REF-0001")
    expect(second.body.error.reference).toBe("vitima-ref-0002")
    expect(SHARED_NOT_FOUND.error).toEqual({ code: "NOT_FOUND", message: "Caso não encontrado." })
  })

  it("resposta de sucesso não é tocada nem registrada", async () => {
    const recorded: OccurrenceInput[] = []
    const response = await request(appWith(recorded)).get("/ok")
    expect(response.body).toEqual({ data: 1 })
    expect(recorded).toEqual([])
  })

  it("404 de rota inexistente (varredura) fica só no log", async () => {
    const recorded: OccurrenceInput[] = []
    const response = await request(appWith(recorded)).get("/wp-admin.php")
    expect(response.status).toBe(404)
    expect(response.body.error.reference).toMatch(/^[0-9a-f-]{36}$/)
    expect(recorded).toEqual([])
  })

  it("falha inesperada de banco: continua 500, código INIA-BANCO-INDISPONIVEL, resumo sem segredo na ocorrência", async () => {
    const recorded: OccurrenceInput[] = []
    const response = await request(appWith(recorded)).get("/quebra")
    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe("INIA-BANCO-INDISPONIVEL")
    expect(response.body.error.message).toBe("Erro interno.")
    expect(JSON.stringify(response.body)).not.toContain("ECONNREFUSED")
    expect(recorded[0]).toMatchObject({ code: "INIA-BANCO-INDISPONIVEL", httpStatus: 500, severity: "critical" })
    expect(JSON.stringify(recorded[0]!.details)).not.toContain("abc123")
  })
})

describe("classificação e sanitização", () => {
  it.each([
    [{ code: "57014", severity: "ERROR", message: "canceling statement due to statement timeout" }, "INIA-BANCO-TIMEOUT"],
    [new Error("timeout exceeded when trying to connect"), "INIA-BANCO-TIMEOUT"],
    // Visto no ensaio com o banco travado (aceita a conexão e não responde): prazo, não indisponibilidade.
    [new Error("Connection terminated due to connection timeout"), "INIA-BANCO-TIMEOUT"],
    [{ code: "53300", severity: "FATAL", message: "sorry, too many clients already" }, "INIA-BANCO-CONEXOES-ESGOTADAS"],
    [Object.assign(new Error("Connection terminated unexpectedly"), {}), "INIA-BANCO-INDISPONIVEL"],
    [{ code: "57P01", severity: "FATAL", message: "terminating connection due to administrator command" }, "INIA-BANCO-INDISPONIVEL"],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "INIA-DEPENDENCIA-TIMEOUT"],
    // Pool do pg em outra porta (banco remoto, repassador): reconhecido pela pilha do driver, não pela porta 5432.
    [Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3394"), { code: "ECONNREFUSED", stack: "Error: connect ECONNREFUSED 127.0.0.1:3394\n    at /srv/inia/backend/node_modules/pg-pool/index.js:45:11" }), "INIA-BANCO-INDISPONIVEL"],
    [new TypeError("Cannot read properties of undefined"), "INTERNAL_ERROR"],
    [Object.assign(new Error("getaddrinfo ENOTFOUND api.example"), { code: "ENOTFOUND" }), "INTERNAL_ERROR"],
  ])("%o → %s", (error, code) => {
    expect(classifyUnexpectedError(error).code).toBe(code)
  })

  it("remove e-mail, CPF, token, senha de URL e chaves longas", () => {
    // Chave inventada montada em tempo de execução: nenhum literal com formato de chave fica no código (o `security:check` recusa).
    const fakeKey = ["AI", "za", "Sy", "A1234567890abcdefghijklmnopqrstuv"].join("")
    const text = redactSensitive(`postgres://inia:SuperSenha@db:5432/inia ana.souza@empresa.com.br 123.456.789-09 Bearer eyJhbGciOi.abc.def token=xyz key=${fakeKey} 5511999998888`)
    expect(text).not.toMatch(/SuperSenha|ana\.souza|123\.456|eyJhbGciOi|xyz|5511999998888/)
    expect(text).not.toContain(fakeKey)
    expect(sanitizeError(new Error("x")).stack?.length).toBeGreaterThan(0)
  })

  it("rota normalizada sem ids nem query", () => {
    expect(normalizeRoute("/api/v1/x/3f2b8c1a-1111-2222-3333-444455556666/itens/123456?cpf=1")).toBe("/api/v1/x/:id/itens/:n")
  })
})

describe("gravador de ocorrências", () => {
  it("tem teto por minuto com cota própria para as graves, e falha ao gravar não derruba nada", async () => {
    let now = 0
    const inserts: unknown[] = []
    const fakeDb = { query: async (_text: string, values?: unknown[]) => { inserts.push(values); return { rows: [], rowCount: 1 } } } as unknown as Parameters<typeof createOccurrenceRecorder>[0]
    const recorder = createOccurrenceRecorder(fakeDb, { serious: 2, ordinary: 1, now: () => now })
    const base = { source: "API" as const, authenticated: false, code: "X", severity: "info" as const }
    recorder.record({ ...base, reference: "ordinaria-1", httpStatus: 401 })
    recorder.record({ ...base, reference: "ordinaria-2", httpStatus: 401 })
    recorder.record({ ...base, reference: "grave-1", httpStatus: 500 })
    recorder.record({ ...base, reference: "grave-2", httpStatus: 500 })
    recorder.record({ ...base, reference: "grave-3", httpStatus: 500 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(inserts).toHaveLength(3)
    expect(recorder.stats().dropped).toBe(2)
    now = 61_000
    recorder.record({ ...base, reference: "ordinaria-3", httpStatus: 401 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(inserts).toHaveLength(4)
    const failing = createOccurrenceRecorder({ query: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }) } } as unknown as Parameters<typeof createOccurrenceRecorder>[0])
    failing.record({ ...base, reference: "grave-x", httpStatus: 500 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(failing.stats().failed).toBe(1)
  })
})
