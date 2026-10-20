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

  it("CPF, telefone, e-mail e protocolo do cliente viram marcadores; nomes, falantes e turnos ficam", () => {
    const masked = transcriptForModel(RAW)
    expect(masked).not.toMatch(/348\.123\.456-09|98765-4321|joana\.silva@email\.com|202610200031/)
    expect(masked).toContain("Meu CPF é [CPF] e o telefone [TELEFONE].")
    expect(masked).toContain("Pode mandar para [EMAIL]?")
    expect(masked).toContain("O protocolo deste atendimento é [PROTOCOLO].")
    expect(masked).toContain("OPERADOR: Olá, meu nome é Mariana, do atendimento.")
    expect(masked.split("\n")).toHaveLength(4)
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
