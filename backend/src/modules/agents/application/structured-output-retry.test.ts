import { describe, expect, it } from "vitest"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { STRUCTURED_OUTPUT_RETRY_NOTICE, withStructuredOutputRetry } from "./structured-output-retry.js"

/** Parser de sempre (sem permissividade): JSON inválido = AGENT_STRUCTURED_OUTPUT_INVALID; envelope fora do formato = outro código. */
function parse(raw: string): { interactionAssessments: unknown[] } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ModelOutputContractError("JSON inválido.", "AGENT_STRUCTURED_OUTPUT_INVALID", { contract: "STRUCTURED_JSON", violations: [{ path: "$", code: "JSON_INVALID", message: "x" }], rawResponse: raw })
  }
  const value = json as { interactionAssessments?: unknown }
  if (!Array.isArray(value.interactionAssessments)) throw new ModelOutputContractError("Envelope.", "AGENT_INDICATOR_DIAGNOSIS_INCOMPLETE", { contract: "INDICATOR_DIAGNOSIS_ASSESSMENTS_V1", rawResponse: raw })
  return { interactionAssessments: value.interactionAssessments }
}

const VALID = JSON.stringify({ interactionAssessments: [{ interactionRef: "I1" }] })
// O caso real do smoke V1.0.2: um "}" a mais no fim do objeto.
const EXTRA_BRACE = `${VALID}}`

function scripted(replies: string[]) {
  const notices: (string | null)[] = []
  return { notices, call: async (notice: string | null) => { notices.push(notice); const next = replies.shift(); if (next === undefined) throw new Error("chamada a mais"); return next } }
}

describe("V1.0.2 — retry técnico de structured output", () => {
  it("A. resposta válida → zero retry", async () => {
    const model = scripted([VALID])
    const result = await withStructuredOutputRetry({ call: model.call, parse })
    expect(result.telemetry.structuredOutputRetryCount).toBe(0)
    expect(model.notices).toEqual([null])
    expect(result.value.interactionAssessments).toHaveLength(1)
  })

  it("B. 1ª resposta com JSON inválido + 2ª válida → sucesso com 1 retry; a MESMA tarefa com só o aviso de formato, sem a resposta rejeitada", async () => {
    const model = scripted([EXTRA_BRACE, VALID])
    const result = await withStructuredOutputRetry({ call: model.call, parse })
    expect(result.raw).toBe(VALID)
    expect(result.telemetry.structuredOutputRetryCount).toBe(1)
    expect(result.telemetry.rejectedAttempts).toEqual([expect.objectContaining({ errorCode: "AGENT_STRUCTURED_OUTPUT_INVALID", rawLength: EXTRA_BRACE.length, rawSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })])
    expect(model.notices).toEqual([null, STRUCTURED_OUTPUT_RETRY_NOTICE])
    // O aviso não dá dica de conteúdo nem reconsideração da conclusão.
    expect(STRUCTURED_OUTPUT_RETRY_NOTICE).not.toMatch(/FOLLOWED|NOT_FOLLOWED|reconsider|conclus|disposi/i)
  })

  it("C. 1ª e 2ª inválidas → falha fechada com o erro de sempre; nunca uma 3ª chamada", async () => {
    const model = scripted([EXTRA_BRACE, "texto sem JSON", VALID])
    await expect(withStructuredOutputRetry({ call: model.call, parse })).rejects.toMatchObject({ code: "AGENT_STRUCTURED_OUTPUT_INVALID" })
    expect(model.notices).toHaveLength(2)
  })

  it("D. resposta legível mas fora do contrato (ou semanticamente inconsistente) → NÃO usa o retry técnico", async () => {
    const envelope = scripted([JSON.stringify({ title: "x" }), VALID])
    await expect(withStructuredOutputRetry({ call: envelope.call, parse })).rejects.toMatchObject({ code: "AGENT_INDICATOR_DIAGNOSIS_INCOMPLETE" })
    expect(envelope.notices).toEqual([null])
    // Inconsistência semântica (ex.: OMISSION com a regra de evitar) é JSON válido: passa direto — o reparo seletivo é quem trata.
    const inconsistent = scripted([JSON.stringify({ interactionAssessments: [{ interactionRef: "I1", status: "NOT_FOLLOWED", evidenceType: "OMISSION", knowledgeQuote: "Evitar: “É só aguardar.”" }] })])
    const result = await withStructuredOutputRetry({ call: inconsistent.call, parse })
    expect(result.telemetry.structuredOutputRetryCount).toBe(0)
    // Erro que não é de contrato (transporte) sobe sem retry aqui (a política do motor é outra).
    const transport = { notices: [] as (string | null)[], call: async (notice: string | null) => { transport.notices.push(notice); throw new Error("503") } }
    await expect(withStructuredOutputRetry({ call: transport.call, parse })).rejects.toThrow("503")
    expect(transport.notices).toHaveLength(1)
  })

  it("E. o limite é 1 mesmo que alguém peça mais (o retry técnico nunca vira laço nem usa o orçamento do reparo)", async () => {
    const model = scripted([EXTRA_BRACE, EXTRA_BRACE, VALID])
    await expect(withStructuredOutputRetry({ call: model.call, parse, maxRetries: 5 })).rejects.toMatchObject({ code: "AGENT_STRUCTURED_OUTPUT_INVALID" })
    expect(model.notices).toHaveLength(2)
  })
})
