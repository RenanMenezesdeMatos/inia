import type { WriterOutputError } from "./feedback-writer-prompt.js"

/**
 * V1.5.1 — PROVENIÊNCIA DE CADA CHAMADA DO WRITER (persistida no run, `interaction_feedback_runs.writer_provenance`).
 * Diz exatamente QUAL Writer gerou o texto: provider, modelo, versão/sha do prompt, schema, contrato, config, hash do request,
 * metadados da resposta e o resultado da validação estrutural. Nunca: API key, prompt/resposta em claro (só hashes — o
 * payload do redator já fica em `writer_input`; o texto validado em `writer_raw_output`).
 */
export const WRITER_TRANSPORT_ERRORS = ["WRITER_TRANSPORT_ERROR", "WRITER_TIMEOUT", "WRITER_PROVIDER_ERROR", "WRITER_NOT_CONFIGURED", "WRITER_BLOCKED_BY_BUDGET", "WRITER_UNEXPECTED_RESPONSE", "WRITER_PAYLOAD_VIOLATION"] as const
export type WriterTransportError = (typeof WRITER_TRANSPORT_ERRORS)[number]
export type FeedbackWriterErrorCode = WriterTransportError | WriterOutputError

export type WriterProvenance = {
  adapterVersion: string
  provider: string
  requestedModel: string
  responseModel: string | null
  promptVersion: string
  promptSha256: string
  schemaVersion: string
  contractVersion: string
  effectClaimMode: string
  writerSha256: string
  config: { responseMimeType: string; timeoutMs: number; retries: number; modelFallback: boolean; escalation: boolean }
  /** sha256 de system prompt + turno do usuário exatamente como enviados. */
  requestSha256: string
  /** sha256 do texto bruto devolvido (null = não houve resposta). */
  responseSha256: string | null
  response: { durationMs: number | null; usage: { promptTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; cachedInputTokens: number | null; totalTokens: number | null } | null; costStatus: string | null }
  validation: { status: "VALID" | FeedbackWriterErrorCode; detail: string | null; itemCount: number; expectedItemCount: number }
  /** V1.7.1d — motivo de término informado pelo provedor (STOP, MAX_TOKENS…); ausente em registros anteriores. */
  finishReason?: string | null
  /** V1.7.1d — schema de saída estruturada enviado ao provedor (versão); null = só o modo JSON. */
  responseSchema?: string | null
  /** Rota pela policy da organização (Use Case FEEDBACK_WRITER) — `provider`/`requestedModel` passam a ser os dela. Ausente = a
   * rota fixa de sempre (`config`). Falha antes da resposta não traz rota: a tentativa fica no evento de uso (`ai_usage_events`). */
  route?: { routingMode: string; providerKey: string; connectionName: string | null; modelName: string; fallbackAttempt: number }
}

/**
 * V1.7.1d — CATEGORIA da falha do redator (a mesma filosofia do contrato do Agent na V1.7.1c):
 *   TRANSIENT_PROVIDER_ERROR        timeout/rede/429/5xx — o nó "Gerar feedback" falha e segue a política de retry do motor;
 *   WRITER_OUTPUT_CONTRACT_INVALID  o modelo respondeu fora do contrato (não é JSON, schema, itens ausentes/extras/fora de ordem,
 *                                   resposta inesperada) — sem retry cego: texto de segurança do sistema + QA, com a resposta
 *                                   rejeitada guardada para diagnóstico;
 *   WRITER_UNAVAILABLE              não configurado, orçamento, payload recusado pela defesa ou erro não transitório do provedor.
 */
export const WRITER_FAILURE_CATEGORIES = ["TRANSIENT_PROVIDER_ERROR", "WRITER_OUTPUT_CONTRACT_INVALID", "WRITER_UNAVAILABLE"] as const
export type WriterFailureCategory = (typeof WRITER_FAILURE_CATEGORIES)[number]
const CONTRACT_CODES: readonly FeedbackWriterErrorCode[] = ["WRITER_MALFORMED_JSON", "WRITER_SCHEMA_INVALID", "WRITER_MISSING_ITEM", "WRITER_EXTRA_ITEM", "WRITER_DUPLICATE_ITEM", "WRITER_ITEM_ORDER_MISMATCH", "WRITER_UNEXPECTED_RESPONSE"]
export function writerFailureCategoryOf(error: { code: FeedbackWriterErrorCode; transient?: boolean }): WriterFailureCategory {
  if (CONTRACT_CODES.includes(error.code)) return "WRITER_OUTPUT_CONTRACT_INVALID"
  return error.transient ? "TRANSIENT_PROVIDER_ERROR" : "WRITER_UNAVAILABLE"
}

/** Erro do adapter. `name` = código (o pipeline grava `error.name` em `writer_error`) e carrega a proveniência. */
export class FeedbackWriterError extends Error {
  /** V1.7.1d — a resposta de APLICAÇÃO que o modelo devolveu e foi recusada pelo contrato (nunca raciocínio do provedor). */
  readonly rejectedResponse: string | null
  /** V1.7.1d — falha de transporte transitória (timeout, rede, 429, 5xx). */
  readonly transient: boolean
  constructor(readonly code: FeedbackWriterErrorCode, readonly provenance: WriterProvenance | null, detail?: string, extras: { rejectedResponse?: string | null; transient?: boolean } = {}) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = code
    this.rejectedResponse = extras.rejectedResponse ?? null
    this.transient = extras.transient ?? false
  }
}
