import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { clientIpAndLoginKey, createRateLimiter, isNetworkLoginRequest } from "./rate-limit.js"

/** Limite do login por IP + login (achado SLR-02/QA-01 da run-9): a matrícula conta como login, nunca só o IP. */
function loginApp(max: number) {
  const app = express()
  app.set("trust proxy", true)
  app.use(express.json())
  app.post(
    "/login",
    createRateLimiter({ name: "login-ip-email", windowMs: 60_000, max, key: clientIpAndLoginKey, message: (req) => (isNetworkLoginRequest(req) ? "Muitas tentativas de acesso com esta matrícula." : "Muitas tentativas de acesso com este e-mail.") }),
    (_req, res) => res.status(204).send(),
  )
  return app
}

describe("clientIpAndLoginKey", () => {
  const fake = (body: unknown) => ({ ip: "203.0.113.20", socket: {}, body }) as unknown as express.Request
  it("e-mail em minúsculas; matrícula normalizada como no AD (prefixo de domínio e caixa não mudam o contador)", () => {
    expect(clientIpAndLoginKey(fake({ email: " Carla@INIA.com " }))).toBe("203.0.113.20|carla@inia.com")
    expect(clientIpAndLoginKey(fake({ matricula: "empresa\\g0055350" }))).toBe("203.0.113.20|matricula:G0055350")
    expect(clientIpAndLoginKey(fake({ matricula: " G0055350 " }))).toBe("203.0.113.20|matricula:G0055350")
    expect(clientIpAndLoginKey(fake({}))).toBe("203.0.113.20|")
  })
})

describe("limite do login por IP + login", () => {
  it("matrículas diferentes no mesmo IP têm contadores separados; o 429 da matrícula não fala em e-mail", async () => {
    const app = loginApp(2)
    const send = (matricula: string) => request(app).post("/login").set("X-Forwarded-For", "203.0.113.20").send({ matricula, password: "x" })
    expect((await send("G0000001")).status).toBe(204)
    expect((await send("g0000001")).status).toBe(204)
    const blocked = await send("EMPRESA\\G0000001")
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.message).toContain("matrícula")
    expect(blocked.body.error.message).not.toContain("e-mail")
    // Outra pessoa no mesmo IP (virada de turno atrás de NAT/Citrix) segue entrando.
    for (let index = 2; index < 6; index += 1) expect((await send(`G000000${index}`)).status).toBe(204)
  })
  it("login por e-mail continua com a mensagem do e-mail", async () => {
    const app = loginApp(1)
    const send = () => request(app).post("/login").set("X-Forwarded-For", "203.0.113.21").send({ email: "carla@inia.com", password: "x" })
    expect((await send()).status).toBe(204)
    const blocked = await send()
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.message).toContain("e-mail")
  })
})
