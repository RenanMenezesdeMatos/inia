import { afterEach, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { isVerbatimEvidence } from "../../agents/application/run-agent.js"
import { transcriptForModel } from "./transcript.js"

const RAW = [
  "[00:00–00:06] OPERADOR: Olá, meu nome é Mariana, do atendimento.",
  "[00:10–00:20] CLIENTE: Meu CPF é 348.123.456-09 e o telefone (11) 98765-4321.",
  "[00:21–00:30] CLIENTE: Pode mandar para joana.silva@email.com?",
  "[03:00–03:05] OPERADOR: O protocolo deste atendimento é 202610200031.",
].join("\n")

describe("transcrição para a IA (R-31)", () => {
  const original = env.INIA_MODEL_PII_MASKING
  afterEach(() => {
    ;(env as { INIA_MODEL_PII_MASKING: string }).INIA_MODEL_PII_MASKING = original
  })

  it("CPF, e-mail e protocolo viram marcadores; o telefone mantém só o formato (DDD e 1º dígito); nomes, falantes e turnos ficam", () => {
    const masked = transcriptForModel(RAW)
    expect(masked).not.toMatch(/348\.123\.456-09|98765-4321|joana\.silva@email\.com|202610200031/)
    expect(masked).toContain("Meu CPF é [CPF] e o telefone (11) 9••••-••••.")
    expect(masked).toContain("Pode mandar para [EMAIL]?")
    expect(masked).toContain("O protocolo deste atendimento é [PROTOCOLO].")
    expect(masked).toContain("OPERADOR: Olá, meu nome é Mariana, do atendimento.")
    expect(masked.split("\n")).toHaveLength(4)
  })

  it("V2 — números mantêm o formato que os indícios de produto descrevem, nunca o número: começo e quantidade de dígitos", () => {
    // Exemplos FICTÍCIOS de teste (nenhum prefixo real vive no código).
    const masked = transcriptForModel(["CLIENTE: A conta é 4561234567.", "CLIENTE: É a linha 11-97740-2561.", "CLIENTE: E o fixo 3210-2360.", "CLIENTE: A conta é 456 123 4567.", "CLIENTE: Paguei R$ 1.234.567,89 no dia 21/10/2026 às 10:30."].join("\n"))
    expect(masked).toContain("A conta é 456•••••••.")
    expect(masked).toContain("É a linha 11-9••••-••••.")
    expect(masked).toContain("E o fixo 3•••-••••.")
    expect(masked).toContain("A conta é 456 ••• ••••.")
    expect(masked).toContain("Paguei R$ 1.234.567,89 no dia 21/10/2026 às 10:30.")
    expect(masked).not.toMatch(/1234567|97740|2561|2360/)
  })

  it("é idempotente: mascarar de novo não muda nada (quem relê o texto confere contra o mesmo)", () => {
    const once = transcriptForModel(RAW)
    expect(transcriptForModel(once)).toBe(once)
  })

  it("a citação literal vale contra o texto que o modelo recebeu; a citação com o dado original não", () => {
    const masked = transcriptForModel(RAW)
    expect(isVerbatimEvidence(masked, "O protocolo deste atendimento é [PROTOCOLO].")).toBe(true)
    expect(isVerbatimEvidence(masked, "O protocolo deste atendimento é 202610200031.")).toBe(false)
  })

  it("INIA_MODEL_PII_MASKING=OFF devolve o original (só para comparar resultados)", () => {
    ;(env as { INIA_MODEL_PII_MASKING: string }).INIA_MODEL_PII_MASKING = "OFF"
    expect(transcriptForModel(RAW)).toBe(RAW)
  })
})
