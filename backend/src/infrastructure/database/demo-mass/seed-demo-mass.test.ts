import { describe, expect, it } from "vitest"
import { hashPassword, verifyPassword } from "../../../modules/auth/infrastructure/password-hasher.js"
import { DEMO_PASSWORD_MIN_LENGTH, resolveDemoPassword } from "./demo-constants.js"
import { DEMO_FLAGS } from "./flag-catalog.js"

describe("seed da massa demo — credenciais e catálogo", () => {
  it("a senha demo vem do ambiente (INIA_DEMO_PASSWORD), nunca do código, e respeita o mínimo", () => {
    expect(DEMO_PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(6)
    expect(() => resolveDemoPassword(undefined)).toThrow(/INIA_DEMO_PASSWORD/)
    expect(() => resolveDemoPassword("   ")).toThrow(/INIA_DEMO_PASSWORD/)
    expect(() => resolveDemoPassword("x".repeat(DEMO_PASSWORD_MIN_LENGTH - 1))).toThrow(/INIA_DEMO_PASSWORD/)
    expect(resolveDemoPassword(`  ${"y".repeat(DEMO_PASSWORD_MIN_LENGTH)}  `)).toBe("y".repeat(DEMO_PASSWORD_MIN_LENGTH))
  })

  it("a senha demo passa pelo mesmo bcrypt do cadastro", async () => {
    const password = resolveDemoPassword("valor-qualquer-de-teste")
    const hash = await hashPassword(password)
    expect(hash).not.toContain(password)
    expect(await verifyPassword(password, hash)).toBe(true)
    expect(await verifyPassword("senha-errada", hash)).toBe(false)
  })

  it("reutiliza as 4 flags existentes e só cria as novas booleanas", () => {
    expect(DEMO_FLAGS.filter((flag) => flag.existing).map((flag) => flag.name).sort()).toEqual(["nota_ura", "rechamada", "tdna", "tempo_silencio"])
    expect(DEMO_FLAGS.filter((flag) => !flag.existing).every((flag) => flag.valueType === "BOOLEAN")).toBe(true)
  })
})
