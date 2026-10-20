import { describe, expect, it } from "vitest"
import { issueDeviceToken, readDeviceToken } from "./known-device.js"

const ACCOUNT = "11111111-1111-4111-8111-111111111111"

describe("dispositivo conhecido — cookie assinado (auditoria de segurança 17/10/2026, AUTH-3)", () => {
  it("o cookie emitido volta com a conta e um identificador de trava próprio, diferente a cada navegador", () => {
    const first = readDeviceToken(issueDeviceToken(ACCOUNT))
    const second = readDeviceToken(issueDeviceToken(ACCOUNT))
    expect(first?.accountId).toBe(ACCOUNT)
    expect(first?.identifierHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first?.identifierHash).not.toBe(second?.identifierHash)
  })

  it("cookie forjado, trocado de conta, truncado ou de outro formato não vale", () => {
    const token = issueDeviceToken(ACCOUNT)
    const [, nonce, signature] = token.split(".")
    for (const forged of [`22222222-2222-4222-8222-222222222222.${nonce}.${signature}`, `${ACCOUNT}.${nonce}x.${signature}`, `${ACCOUNT}.${nonce}`, `${token}.extra`, "", undefined, 42, "x".repeat(400)]) {
      expect(readDeviceToken(forged)).toBeNull()
    }
  })
})
