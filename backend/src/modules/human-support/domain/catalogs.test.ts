import { describe, expect, it } from "vitest"
import { END_SYSTEM_CODE, generateProtocol, PROTOCOL_ALPHABET, PROTOCOL_PATTERN, REQUEST_END_CAUSES, SYSTEM_MESSAGE_CODES_V1, systemMessageText } from "./catalogs.js"

describe("catálogos do Apoio com Anjo", () => {
  it("protocolo: AP- + 6 símbolos sem 0/O/1/I, sempre no padrão do banco", () => {
    expect(PROTOCOL_ALPHABET).not.toMatch(/[01IO]/)
    for (let index = 0; index < 200; index += 1) expect(generateProtocol()).toMatch(PROTOCOL_PATTERN)
    expect(generateProtocol(() => 0)).toBe("AP-222222")
  })

  it("toda mensagem de sistema tem texto para operador, Anjo e quem acompanha; o operador nunca lê motivo de pausa", () => {
    for (const code of SYSTEM_MESSAGE_CODES_V1) {
      for (const reader of ["OPERATOR", "ANJO", "OBSERVER"] as const) {
        const text = systemMessageText(code, reader, { anjoName: "Ana" })
        expect(text.length).toBeGreaterThan(5)
        expect(text).not.toMatch(/lanche|reunião|pausa/i)
      }
    }
    expect(systemMessageText("ANJO_ASSIGNED", "OPERATOR", { anjoName: "Ana" })).toBe("Ana (Anjo) recebeu seu pedido. Aguardando a primeira resposta.")
    expect(systemMessageText("ANJO_ASSIGNED", "OBSERVER", {})).toBe("O Anjo recebeu o pedido.")
    expect(systemMessageText("CANCELLED_SCOPE_DISABLED", "OPERATOR")).toBe("O apoio com Anjo foi desativado para sua equipe.")
  })

  it("toda causa de fim tem a mensagem de sistema dela", () => {
    for (const cause of REQUEST_END_CAUSES) expect(SYSTEM_MESSAGE_CODES_V1).toContain(END_SYSTEM_CODE[cause])
    expect(END_SYSTEM_CODE.ANJO_LOST).toBe("ANJO_LEFT")
  })
})
