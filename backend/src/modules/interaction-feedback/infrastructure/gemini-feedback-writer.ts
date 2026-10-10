import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { AiCallBlockedError } from "../../../shared/application/llm-telemetry.js"
import { generateForRoute, type GatewayRequest, type GatewayResponse } from "../../../shared/application/model-routing/llm-gateway.js"
import type { ModelProfile } from "../../../shared/application/model-routing/model-profile.js"
import type { RouteDecision } from "../../../shared/application/model-routing/route-policy.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FeedbackWriterPort } from "../application/ports.js"
import { assertWriterPayloadSafe, FEEDBACK_WRITER_MODEL_CONFIG, FEEDBACK_WRITER_SYSTEM_PROMPT, feedbackWriterFingerprint, parseWriterResponse, projectWriterInputForModel, renderWriterUserTurn, sha256, WriterPayloadViolation, type WriterItemSchema, type WriterPipelineOutput, type WriterPresentationSchema } from "../domain/feedback-writer-prompt.js"
import { FeedbackWriterError, type FeedbackWriterErrorCode, type WriterProvenance } from "../domain/feedback-writer-provenance.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"

/** V1.7.1d — teto da resposta rejeitada guardada para diagnóstico (a resposta do redator cabe inteira). */
export const REJECTED_WRITER_RESPONSE_MAX_CHARS = 60_000

/**
 * V1.5.1 — ADAPTER GEMINI DO FEEDBACK WRITER (implementa `FeedbackWriterPort`).
 *
 * Reaproveita a infraestrutura existente, sem cliente/auth/timeout/telemetria próprios: a chamada sai pelo GATEWAY único
 * (`generateForRoute` → adapter Gemini registrado → cliente `generateContent` com `responseMimeType: application/json`),
 * que já grava telemetria, evento de uso/custo e aplica o hard limit do orçamento. Use Case dedicado `FEEDBACK_WRITER`
 * (propósito FEEDBACK_WRITING): sem policy da organização, a rota fixa do piloto abaixo; com policy ativa, o modelo dela (o
 * schema, o teto de saída e o tempo pedidos aqui seguem junto, e a proveniência registra a rota usada).
 *
 * Responsabilidade: FeedbackWriterInput V1 → payload do modelo (lista branca + defesa estrutural) → request → parse ESTRITO
 * → `{ items: [{ slot, observed, whyItMatters, whatYouCanDo }] }`. Não decide seção, dono, polaridade, escopo, readiness,
 * revisão, entrega, evidência nem fonte da orientação; não valida LINGUAGEM (isso é do pipeline, por item); não faz retry
 * (transporte com `retries: 0`) nem fallback de modelo/escalação — qualquer falha vira `FeedbackWriterError` e o PIPELINE
 * decide o fallback determinístico.
 */
const PROFILE: ModelProfile = {
  id: "feedback-writer-pilot",
  provider: FEEDBACK_WRITER_MODEL_CONFIG.provider,
  model: FEEDBACK_WRITER_MODEL_CONFIG.model,
  tier: "BASIC",
  contextWindow: 1_000_000,
  maxOutput: 65_536,
  supportsTools: false,
  supportsStructuredOutput: true,
  supportsReasoning: false,
  // Sem cache explícito: o prefixo é pequeno (< mínimo da API) e o piloto não precisa de mais uma variável.
  supportsPromptCache: false,
  enabled: true,
}

/** Rota FIXA do piloto — nunca passa pela política de tiers (sem fallback, sem escalação). */
export function feedbackWriterRoute(): RouteDecision {
  return { profile: PROFILE, tier: "BASIC", reason: "feedback_writing · modelo fixo do piloto (V1.5.1) — sem roteamento, fallback ou escalação", mode: "CURRENT", escalated: false, fallback: false, purpose: "FEEDBACK_WRITING" }
}

export type GeminiFeedbackWriterDeps = { generate?: (request: GatewayRequest) => Promise<GatewayResponse> }

function transportErrorCode(error: unknown): FeedbackWriterErrorCode {
  if (error instanceof WriterPayloadViolation) return "WRITER_PAYLOAD_VIOLATION"
  if (error instanceof AiCallBlockedError) return "WRITER_BLOCKED_BY_BUDGET"
  if (error instanceof DomainError) {
    if (/TIMEOUT/.test(error.code)) return "WRITER_TIMEOUT"
    if (/NETWORK/.test(error.code)) return "WRITER_TRANSPORT_ERROR"
    if (/NOT_CONFIGURED/.test(error.code)) return "WRITER_NOT_CONFIGURED"
    // Resposta vazia do provider = nada para parsear.
    if (/EMPTY/.test(error.code)) return "WRITER_MALFORMED_JSON"
    return "WRITER_PROVIDER_ERROR"
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "WRITER_TIMEOUT"
  return "WRITER_TRANSPORT_ERROR"
}

/** Identidade do Writer que entra na proveniência (versão/sha do prompt, schema, contrato, modo de efeito). */
export type WriterFingerprint = { adapterVersion: string; promptVersion: string; promptSha256: string; schemaVersion: string; contractVersion: string; effectClaimMode: string; writerSha256: string }

/**
 * A CHAMADA do redator, comum a todo Writer de feedback (V1.5.1; extraída na V1.5.12 para os redatores do feedback
 * confiável reaproveitarem o MESMO transporte): payload (montado e defendido por quem chama, antes da rede) → gateway
 * único com a rota fixa do piloto (30 s, zero retry) → parse ESTRITO pelos itemRefs esperados → `{ rawOutput, provenance }`.
 * Qualquer falha vira `FeedbackWriterError` (com a proveniência); quem decide o fallback é o pipeline.
 */
export async function callFeedbackWriterModel(
  generate: (request: GatewayRequest) => Promise<GatewayResponse>,
  input: { systemPrompt: string; buildUserTurn: () => string; expectedRefs: string[]; fingerprint: WriterFingerprint; itemSchema?: WriterItemSchema; presentationSchema?: WriterPresentationSchema; /** V1.7.1d — schema de saída estruturada enviado ao provedor (mesmas chaves do parser). */ responseSchema?: { version: string; schema: Record<string, unknown> } },
): Promise<{ rawOutput: WriterPipelineOutput; provenance: WriterProvenance }> {
  const { expectedRefs, fingerprint } = input
  const base = (): WriterProvenance => ({
    adapterVersion: fingerprint.adapterVersion,
    provider: FEEDBACK_WRITER_MODEL_CONFIG.provider,
    requestedModel: FEEDBACK_WRITER_MODEL_CONFIG.model,
    responseModel: null,
    promptVersion: fingerprint.promptVersion,
    promptSha256: fingerprint.promptSha256,
    schemaVersion: fingerprint.schemaVersion,
    contractVersion: fingerprint.contractVersion,
    effectClaimMode: fingerprint.effectClaimMode,
    writerSha256: fingerprint.writerSha256,
    config: { responseMimeType: FEEDBACK_WRITER_MODEL_CONFIG.responseMimeType, timeoutMs: FEEDBACK_WRITER_MODEL_CONFIG.timeoutMs, retries: FEEDBACK_WRITER_MODEL_CONFIG.retries, modelFallback: FEEDBACK_WRITER_MODEL_CONFIG.modelFallback, escalation: FEEDBACK_WRITER_MODEL_CONFIG.escalation },
    requestSha256: "",
    responseSha256: null,
    response: { durationMs: null, usage: null, costStatus: null },
    validation: { status: "VALID", detail: null, itemCount: 0, expectedItemCount: expectedRefs.length },
    responseSchema: input.responseSchema?.version ?? null,
  })

  let userTurn: string
  try {
    userTurn = input.buildUserTurn()
  } catch (error) {
    const provenance = { ...base(), validation: { status: "WRITER_PAYLOAD_VIOLATION" as const, detail: error instanceof Error ? error.message : null, itemCount: 0, expectedItemCount: expectedRefs.length } }
    throw new FeedbackWriterError("WRITER_PAYLOAD_VIOLATION", provenance, error instanceof Error ? error.message : undefined)
  }
  const provenance = { ...base(), requestSha256: sha256(`${input.systemPrompt}\n\n${userTurn}`) }

  let response: GatewayResponse
  try {
    response = await generate({
      systemPrompt: input.systemPrompt,
      contents: [{ role: "user", text: userTurn }],
      tools: [],
      structuredOutput: true,
      route: feedbackWriterRoute(),
      transport: { timeoutMs: FEEDBACK_WRITER_MODEL_CONFIG.timeoutMs, retries: FEEDBACK_WRITER_MODEL_CONFIG.retries },
      ...(input.responseSchema ? { responseSchema: input.responseSchema.schema } : {}),
      classification: { phase: "SYNTHESIS", purpose: "FEEDBACK_WRITING", source: "FEEDBACK_WRITER", semanticType: "FEEDBACK" },
    })
  } catch (error) {
    const code = transportErrorCode(error)
    // V1.7.1d — só falha de TRANSPORTE transitória (timeout, rede, 429, 5xx) segue a política de retry; o resto não se repete.
    const transient = code !== "WRITER_PAYLOAD_VIOLATION" && code !== "WRITER_BLOCKED_BY_BUDGET" && classifyExecutionError(error).category === "TRANSIENT_PROVIDER_ERROR"
    throw new FeedbackWriterError(code, { ...provenance, validation: { ...provenance.validation, status: code, detail: error instanceof DomainError ? error.code : null } }, undefined, { transient })
  }

  // Use Case FEEDBACK_WRITER roteado pela policy da organização: a proveniência diz QUEM escreveu, não a rota fixa de antes.
  const route = response.resolvedRoute
  const answered: WriterProvenance = {
    ...provenance,
    ...(route ? { provider: route.providerKey, requestedModel: route.modelName, route: { routingMode: route.routingMode, providerKey: route.providerKey, connectionName: route.connectionName, modelName: route.modelName, fallbackAttempt: route.fallbackAttempt } } : {}),
    responseModel: response.model ?? null,
    responseSha256: response.kind === "text" ? sha256(response.text) : null,
    response: {
      durationMs: response.durationMs ?? null,
      usage: response.usage ? { promptTokens: response.usage.promptTokens, outputTokens: response.usage.outputTokens, reasoningTokens: response.usage.reasoningTokens, cachedInputTokens: response.usage.cachedInputTokens, totalTokens: response.usage.totalTokens } : null,
      costStatus: response.cost?.status ?? null,
    },
    finishReason: response.finishReason ?? null,
  }
  if (response.kind !== "text") throw new FeedbackWriterError("WRITER_UNEXPECTED_RESPONSE", { ...answered, validation: { ...answered.validation, status: "WRITER_UNEXPECTED_RESPONSE", detail: response.kind } })

  const parsed = parseWriterResponse(response.text, expectedRefs, input.itemSchema, input.presentationSchema ?? null)
  if (!parsed.ok) {
    // Resposta cortada pelo limite de saída = o JSON não fecha: o motivo vem do provedor, nunca adivinhado.
    const detail = parsed.error === "WRITER_MALFORMED_JSON" && answered.finishReason === "MAX_TOKENS" ? "resposta truncada pelo limite de saída do provedor (MAX_TOKENS)" : parsed.detail
    throw new FeedbackWriterError(parsed.error, { ...answered, validation: { ...answered.validation, status: parsed.error, detail } }, detail, { rejectedResponse: response.text.slice(0, REJECTED_WRITER_RESPONSE_MAX_CHARS) })
  }
  return { rawOutput: parsed.output, provenance: { ...answered, validation: { ...answered.validation, status: "VALID", itemCount: parsed.output.items.length } } }
}

export function createGeminiFeedbackWriter(deps: GeminiFeedbackWriterDeps = {}): FeedbackWriterPort {
  const generate = deps.generate ?? generateForRoute
  const fingerprint = feedbackWriterFingerprint()
  return {
    write(input: FeedbackWriterInputV1) {
      return callFeedbackWriterModel(generate, {
        systemPrompt: FEEDBACK_WRITER_SYSTEM_PROMPT,
        expectedRefs: input.items.map((item) => item.slot),
        fingerprint,
        buildUserTurn: () => {
          const payload = projectWriterInputForModel(input)
          assertWriterPayloadSafe(payload)
          return renderWriterUserTurn(payload)
        },
      })
    },
  }
}
