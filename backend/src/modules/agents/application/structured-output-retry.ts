import { createHash } from "node:crypto"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"

/**
 * INDICATOR DIAGNOSIS V1.0.2 — RETRY TÉCNICO DE STRUCTURED OUTPUT (≠ reparo semântico da avaliação).
 *
 * STRUCTURED OUTPUT RETRY: a resposta do modelo não pôde sequer ser lida como JSON (`AGENT_STRUCTURED_OUTPUT_INVALID` — ex.: um
 * "}" a mais no fim). É falha de FORMATO do modelo, não de conclusão: a MESMA tarefa (mesma amostra, mesmas etapas, mesmo contexto,
 * mesmas regras) é enviada de novo UMA vez, só com o aviso de que a resposta anterior não respeitou o formato — nenhuma dica sobre o
 * conteúdo, a resposta rejeitada não volta ao modelo. Segunda resposta inválida = falha fechada, como sempre. Nunca uma terceira.
 *
 * ASSESSMENT REPAIR (indicator-diagnosis-repair.ts): resposta LEGÍVEL, com etapas faltantes/inconsistentes/papéis trocados — outro
 * mecanismo, outro orçamento. Este retry não conta nele, e nenhum outro erro de contrato (campo ausente, envelope fora do formato,
 * evidência não literal) dispara este retry: não há parser permissivo, o JSON nunca é "consertado" pela aplicação.
 *
 * V1.7.4 — única extensão: na avaliação de processo da monitoria, o `processAssessment` OBRIGATÓRIO ausente é structured output
 * inválido (o mesmo código deste gatilho, violação `PROCESS_ASSESSMENT_MISSING`) — a resposta não tem a estrutura pedida. O
 * orçamento continua o mesmo: uma repetição, depois falha fechada.
 */
export const STRUCTURED_OUTPUT_RETRY_VERSION = "STRUCTURED_OUTPUT_RETRY_V1" as const
export const MAX_STRUCTURED_OUTPUT_RETRIES = 1
export const STRUCTURED_OUTPUT_RETRY_TAG = "stage:STRUCTURED_OUTPUT_RETRY" as const
export const STRUCTURED_OUTPUT_RETRY_TRIGGER = "AGENT_STRUCTURED_OUTPUT_INVALID" as const

export const STRUCTURED_OUTPUT_RETRY_NOTICE =
  "A resposta anterior não respeitou o schema estruturado. Retorne novamente SOMENTE o objeto JSON válido conforme o schema, sem texto antes/depois e sem campos adicionais."

export type StructuredOutputRetryTelemetry = {
  version: typeof STRUCTURED_OUTPUT_RETRY_VERSION
  structuredOutputRetryCount: number
  maxStructuredOutputRetries: number
  /** Só quando houve retry: o que a 1ª resposta violou (código + violações de caminho) e a impressão digital dela — nunca o texto. */
  rejectedAttempts: { errorCode: string; violations: { path: string; code: string }[]; rawSha256: string | null; rawLength: number | null }[]
}

export function isStructuredOutputRetryable(error: unknown): error is ModelOutputContractError {
  return error instanceof ModelOutputContractError && error.code === STRUCTURED_OUTPUT_RETRY_TRIGGER
}

/**
 * `call(notice)` faz a chamada estruturada (notice = null na 1ª; o aviso de formato na única repetição). `parse(raw)` é o parser
 * de sempre: qualquer erro que não seja JSON inválido sobe na hora, sem retry.
 */
export async function withStructuredOutputRetry<T>(input: { call: (notice: string | null) => Promise<string>; parse: (raw: string) => T; maxRetries?: number }): Promise<{ raw: string; value: T; telemetry: StructuredOutputRetryTelemetry }> {
  const maxRetries = Math.min(input.maxRetries ?? MAX_STRUCTURED_OUTPUT_RETRIES, MAX_STRUCTURED_OUTPUT_RETRIES)
  const telemetry: StructuredOutputRetryTelemetry = { version: STRUCTURED_OUTPUT_RETRY_VERSION, structuredOutputRetryCount: 0, maxStructuredOutputRetries: maxRetries, rejectedAttempts: [] }
  let notice: string | null = null
  for (;;) {
    const raw = await input.call(notice)
    try {
      return { raw, value: input.parse(raw), telemetry }
    } catch (error) {
      if (!isStructuredOutputRetryable(error) || telemetry.structuredOutputRetryCount >= maxRetries) throw error
      const rejected = error.diagnostics.rawResponse
      telemetry.rejectedAttempts.push({ errorCode: error.code, violations: error.diagnostics.violations.map((violation) => ({ path: violation.path, code: violation.code })), rawSha256: rejected === null ? null : createHash("sha256").update(rejected).digest("hex"), rawLength: rejected?.length ?? null })
      telemetry.structuredOutputRetryCount += 1
      console.warn(JSON.stringify({ event: "agent_structured_output_retry", attempt: telemetry.structuredOutputRetryCount, errorCode: error.code, rawSha256: telemetry.rejectedAttempts.at(-1)!.rawSha256 }))
      notice = STRUCTURED_OUTPUT_RETRY_NOTICE
    }
  }
}
