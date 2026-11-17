import { describe, expect, it } from "vitest"
import { ANJO_PAUSE_REASONS, END_SYSTEM_CODE, generateProtocol, PAUSE_REASON_LABELS, PAUSE_REASONS_V1, PROTOCOL_ALPHABET, PROTOCOL_PATTERN, REQUEST_END_CAUSES, SYSTEM_MESSAGE_CODES_V1, systemMessageText } from "./catalogs.js"

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
        // Para o operador, quem atende é "o Apoio" (pedido do responsável em 16/11/2026): ele nunca lê "Anjo".
        if (reader === "OPERATOR") expect(text).not.toMatch(/anjo/i)
      }
    }
    expect(systemMessageText("ANJO_ASSIGNED", "OPERATOR", { anjoName: "Ana" })).toBe("Ana (Apoio) recebeu seu pedido. Aguardando a primeira resposta.")
    expect(systemMessageText("ANJO_ASSIGNED", "OBSERVER", {})).toBe("O Anjo recebeu o pedido.")
    expect(systemMessageText("CANCELLED_SCOPE_DISABLED", "OPERATOR")).toBe("O Apoio foi desativado para sua equipe.")
    expect(systemMessageText("ANJO_SILENT_REQUEUED", "ANJO")).toMatch(/perdeu este atendimento/)
  })

  it("toda causa de fim tem a mensagem de sistema dela", () => {
    for (const cause of REQUEST_END_CAUSES) expect(SYSTEM_MESSAGE_CODES_V1).toContain(END_SYSTEM_CODE[cause])
    expect(END_SYSTEM_CODE.ANJO_LOST).toBe("ANJO_LEFT")
  })

  it("a pausa Desconexão só o sistema põe: fora da escolha do Anjo (195)", () => {
    expect(PAUSE_REASONS_V1).toContain("DISCONNECTION")
    expect(ANJO_PAUSE_REASONS).not.toContain("DISCONNECTION")
    expect(PAUSE_REASON_LABELS.DISCONNECTION).toBe("Desconexão")
  })
})
