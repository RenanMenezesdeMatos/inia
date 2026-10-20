import bcrypt from "bcryptjs"
import { describe, expect, it } from "vitest"
import { hashPassword, PASSWORD_QUEUE_LIMIT, PasswordCheckBusyError, verifyPassword } from "./password-hasher.js"

describe("password-hasher (bcryptjs em worker threads)", () => {
  it("mesmo formato de antes: o hash do pool confere no bcryptjs direto e vice-versa", async () => {
    const fromPool = await hashPassword("Senha#Forte1")
    expect(fromPool).toMatch(/^\$2[aby]\$10\$/)
    expect(bcrypt.compareSync("Senha#Forte1", fromPool)).toBe(true)
    const legacy = bcrypt.hashSync("Senha#Antiga2", 10)
    expect(await verifyPassword("Senha#Antiga2", legacy)).toBe(true)
    expect(await verifyPassword("errada", legacy)).toBe(false)
  })

  it("muitas verificações ao mesmo tempo: cada uma recebe a própria resposta", async () => {
    const hashes = await Promise.all(["a1", "b2", "c3"].map((password) => hashPassword(password)))
    const attempts = Array.from({ length: 12 }, (_, index) => ({ password: ["a1", "b2", "c3", "x9"][index % 4]!, hash: hashes[index % 3]! }))
    const results = await Promise.all(attempts.map((attempt) => verifyPassword(attempt.password, attempt.hash)))
    expect(results).toEqual(attempts.map((attempt, index) => attempt.password === ["a1", "b2", "c3"][index % 3]))
  })

  it("fila cheia: a verificação nova é recusada na hora (503 AUTH_BUSY) e as aceitas terminam certas", async () => {
    const cheap = bcrypt.hashSync("rapida", 4)
    const total = PASSWORD_QUEUE_LIMIT + 40
    const outcomes = await Promise.allSettled(Array.from({ length: total }, (_, index) => verifyPassword(index % 2 === 0 ? "rapida" : "errada", cheap)))
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected")
    expect(rejected.length).toBeGreaterThan(0)
    expect(rejected.every((outcome) => outcome.reason instanceof PasswordCheckBusyError && outcome.reason.statusCode === 503)).toBe(true)
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") expect(outcome.value).toBe(index % 2 === 0)
    })
    // Depois da rajada, a fila esvaziou: a próxima verificação passa normalmente.
    expect(await verifyPassword("rapida", cheap)).toBe(true)
  })

  it("hash inválido no banco não derruba nada: a verificação só dá falso, como no bcryptjs direto", async () => {
    expect(await verifyPassword("qualquer", "não-é-um-hash")).toBe(false)
    expect(await verifyPassword("ok", await hashPassword("ok"))).toBe(true)
  })
})
