import bcrypt from "bcryptjs"
import { describe, expect, it } from "vitest"
import { hashPassword, verifyPassword } from "./password-hasher.js"

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

  it("hash inválido no banco não derruba nada: a verificação só dá falso, como no bcryptjs direto", async () => {
    expect(await verifyPassword("qualquer", "não-é-um-hash")).toBe(false)
    expect(await verifyPassword("ok", await hashPassword("ok"))).toBe(true)
  })
})
