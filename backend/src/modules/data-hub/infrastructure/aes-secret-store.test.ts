import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { decryptStoredSecret, encryptBoundSecret, encryptSecret, rotateStoredSecret, type SecretBinding } from "./aes-secret-store.js"

const OLD = randomBytes(32)
const NEW = randomBytes(32)
const BINDING: SecretBinding = { store: "data_secrets", organizationId: "org-1", ownerId: "source-1", purpose: "PASSWORD" }
const legacy = (plain: string, key: Buffer) => ({ ...encryptSecret(plain, key), keyVersion: 1 })

describe("cifra das credenciais (R-12/R-25)", () => {
  it("v2 fica presa ao lugar: o texto cifrado de uma fonte não abre como credencial de outra fonte, organização ou finalidade", () => {
    const stored = encryptBoundSecret("s3nha-do-banco", BINDING, NEW)
    expect(decryptStoredSecret(stored, BINDING, { current: NEW, previous: null })).toBe("s3nha-do-banco")
    for (const other of [{ ...BINDING, ownerId: "source-2" }, { ...BINDING, organizationId: "org-2" }, { ...BINDING, purpose: "TOKEN" }, { ...BINDING, store: "ai_connection_secrets" as const }]) {
      expect(() => decryptStoredSecret(stored, other, { current: NEW, previous: null })).toThrow()
    }
  })

  it("linhas antigas (v1, sem dados associados) continuam legíveis", () => {
    expect(decryptStoredSecret(legacy("antiga", NEW), BINDING, { current: NEW, previous: null })).toBe("antiga")
  })

  it("durante a troca, a chave anterior abre o que a atual não abre; sem ela, falha", () => {
    expect(decryptStoredSecret(legacy("antiga", OLD), BINDING, { current: NEW, previous: OLD })).toBe("antiga")
    expect(() => decryptStoredSecret(legacy("antiga", OLD), BINDING, { current: NEW, previous: null })).toThrow()
  })

  it("rotação: v1 na chave antiga → recifrada v2 na chave nova; já atual → nada; nenhuma chave abre → ilegível", () => {
    const rotated = rotateStoredSecret(legacy("antiga", OLD), BINDING, { current: NEW, previous: OLD })
    expect(rotated.kind).toBe("ROTATED")
    if (rotated.kind !== "ROTATED") return
    expect(rotated.encrypted.keyVersion).toBe(2)
    // Depois da rotação, só a chave nova basta.
    expect(decryptStoredSecret(rotated.encrypted, BINDING, { current: NEW, previous: null })).toBe("antiga")
    expect(rotateStoredSecret(rotated.encrypted, BINDING, { current: NEW, previous: null })).toEqual({ kind: "CURRENT" })
    expect(rotateStoredSecret(legacy("perdida", randomBytes(32)), BINDING, { current: NEW, previous: OLD })).toEqual({ kind: "UNREADABLE" })
    // Mesma chave, v1 → v2 (só ganha os dados associados).
    expect(rotateStoredSecret(legacy("mesma", NEW), BINDING, { current: NEW, previous: null }).kind).toBe("ROTATED")
  })
})
