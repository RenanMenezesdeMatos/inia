import { generateForRoute, type GatewayRequest, type GatewayResponse } from "../../../shared/application/model-routing/llm-gateway.js"
import { callFeedbackWriterModel, feedbackWriterRoute } from "../../interaction-feedback/infrastructure/gemini-feedback-writer.js"
import { FEEDBACK_WRITER_MODEL_CONFIG, sha256 } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import { assertNarrativePayloadSafe, parseCompositionResponse, projectCompositionBriefForModel, renderNarrativeUserTurn, SUPERVISOR_NARRATIVE_PROMPT_VERSION, SUPERVISOR_NARRATIVE_RESPONSE_SCHEMA_V5, SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS } from "../domain/supervisor-narrative-prompt.js"
import type { NarrativeBrief, NarrativeDraft } from "../domain/supervisor-narrative.js"
import type { NarrativeWriterResult, PrvNarrativeWriterResult } from "../application/ports.js"
import type { EmittedItem } from "../domain/reliable-feedback-artifact.js"
import type { ModelProfile } from "../../../shared/application/model-routing/model-profile.js"
import type { RouteDecision } from "../../../shared/application/model-routing/route-policy.js"
import { factualityClaimsOf, factualityPayloadOf, NARRATIVE_FACTUALITY_PROMPT_VERSION, NARRATIVE_FACTUALITY_RESPONSE_SCHEMA, NARRATIVE_FACTUALITY_SYSTEM_PROMPTS, NARRATIVE_FACTUALITY_VERSION, parseFactualityResponse, renderFactualityUserTurn, type StoredFactuality } from "../domain/narrative-factuality.js"
import { assertPrvPayloadSafe, parsePrvNarrativeResponse, projectPrvBriefForModel, PRV_NARRATIVE_PROMPT_VERSION, PRV_NARRATIVE_RESPONSE_SCHEMA, PRV_NARRATIVE_SYSTEM_PROMPT, renderPrvUserTurn } from "../domain/prv-narrative-prompt.js"
import type { PrvNarrativeBrief } from "../domain/prv-closing-views.js"
import type { ReliableFeedbackWriterPort } from "../application/ports.js"
import {
  assertReliablePayloadSafe,
  INDICATOR_WRITER_PROMPT_VERSION,
  projectIndicatorInputForModel,
  projectMonitoringInputForModel,
  RELIABLE_WRITER_SYSTEM_PROMPTS,
  reliableWriterFingerprint,
  reliableWriterItemSchemaV3,
  reliableWriterPresentationSchema,
  RELIABLE_WRITER_RESPONSE_SCHEMA_V4,
  RELIABLE_WRITER_RESPONSE_SCHEMA_VERSION,
  renderReliableUserTurn,
  WORKFLOW_MONITORING_WRITER_PROMPT_VERSION,
} from "../domain/reliable-writer-prompts.js"

/**
 * V1.5.12 — ADAPTER GEMINI DOS REDATORES DO FEEDBACK CONFIÁVEL. Nenhuma infraestrutura nova: a MESMA chamada do Writer
 * do piloto (`callFeedbackWriterModel` → gateway único, Use Case FEEDBACK_WRITER — sem policy da organização, gemini-3.1-flash-lite
 * fixo —, 30 s, ZERO retry, sem fallback/escalação, JSON estrito), só com o prompt e o payload versionados de cada domínio.
 */
/** V1.7.1d — saída estruturada enviada ao provedor (mesmas chaves do parser). */
const RESPONSE_SCHEMA = { version: RELIABLE_WRITER_RESPONSE_SCHEMA_VERSION, schema: RELIABLE_WRITER_RESPONSE_SCHEMA_V4 }

export function createGeminiReliableFeedbackWriter(deps: { generate?: (request: GatewayRequest) => Promise<GatewayResponse> } = {}): ReliableFeedbackWriterPort {
  const generate = deps.generate ?? generateForRoute
  return {
    writeMonitoring(input) {
      return callFeedbackWriterModel(generate, {
        systemPrompt: RELIABLE_WRITER_SYSTEM_PROMPTS[WORKFLOW_MONITORING_WRITER_PROMPT_VERSION],
        expectedRefs: input.items.map((item) => item.slot),
        fingerprint: reliableWriterFingerprint(WORKFLOW_MONITORING_WRITER_PROMPT_VERSION),
        // V1.7.1a — saída V3: + suggestedResponse (exemplo de condução), validado depois pelo código.
        itemSchema: reliableWriterItemSchemaV3,
        presentationSchema: reliableWriterPresentationSchema,
        responseSchema: RESPONSE_SCHEMA,
        buildUserTurn: () => {
          const payload = projectMonitoringInputForModel(input)
          assertReliablePayloadSafe(payload)
          return renderReliableUserTurn(input.contract, payload)
        },
      })
    },
    writeNarrative: (brief) => writeSupervisorNarrative(generate, brief),
    verifyNarrativeFactuality: (draft, brief, items) => verifyNarrativeFactuality(generate, draft, brief, items),
    writePrvNarrative: (brief) => writePrvClosingNarrative(generate, brief),
    writeIndicator(input) {
      return callFeedbackWriterModel(generate, {
        systemPrompt: RELIABLE_WRITER_SYSTEM_PROMPTS[INDICATOR_WRITER_PROMPT_VERSION],
        expectedRefs: input.items.map((item) => item.slot),
        fingerprint: reliableWriterFingerprint(INDICATOR_WRITER_PROMPT_VERSION),
        // V1.7.1b — indicador V4: itens com exemplo de condução + apresentação.
        itemSchema: reliableWriterItemSchemaV3,
        presentationSchema: reliableWriterPresentationSchema,
        responseSchema: RESPONSE_SCHEMA,
        buildUserTurn: () => {
          const payload = projectIndicatorInputForModel(input)
          assertReliablePayloadSafe(payload)
          return renderReliableUserTurn(input.contract, payload)
        },
      })
    },
  }
}

/**
 * FEEDBACK POR FLAG V2 — a chamada do redator da NARRATIVA de supervisor: mesma rota fixa do redator do piloto (gateway único,
 * gemini-3.1-flash-lite, 30 s, zero retry, JSON), prompt próprio. Nunca lança: qualquer falha (payload, transporte, JSON,
 * schema) = sem rascunho, e a narrativa do SISTEMA assume — o feedback nunca espera nem falha por causa dela.
 */
export async function writeSupervisorNarrative(generate: (request: GatewayRequest) => Promise<GatewayResponse>, brief: NarrativeBrief): Promise<NarrativeWriterResult> {
  const systemPrompt = SUPERVISOR_NARRATIVE_SYSTEM_PROMPTS[SUPERVISOR_NARRATIVE_PROMPT_VERSION]
  let userTurn: string
  try {
    // FEEDBACK EXPERIENCE V2 — composição (V7): disposição + contexto + pontos com refs e falas; frases com vínculo + card com refs.
    const payload = projectCompositionBriefForModel(brief)
    assertNarrativePayloadSafe(payload)
    userTurn = renderNarrativeUserTurn(payload)
  } catch {
    return { draft: null, error: "NARRATIVE_PAYLOAD_VIOLATION", provenance: null }
  }
  const base = { promptVersion: SUPERVISOR_NARRATIVE_PROMPT_VERSION, requestSha256: sha256(`${systemPrompt}\n\n${userTurn}`), responseSha256: null, responseModel: null, durationMs: null, usage: null }
  let response: GatewayResponse
  try {
    response = await generate({
      systemPrompt,
      contents: [{ role: "user", text: userTurn }],
      tools: [],
      structuredOutput: true,
      route: feedbackWriterRoute(),
      transport: { timeoutMs: FEEDBACK_WRITER_MODEL_CONFIG.timeoutMs, retries: FEEDBACK_WRITER_MODEL_CONFIG.retries },
      responseSchema: SUPERVISOR_NARRATIVE_RESPONSE_SCHEMA_V5,
      classification: { phase: "SYNTHESIS", purpose: "FEEDBACK_WRITING", source: "FEEDBACK_WRITER", semanticType: "FEEDBACK", tags: ["stage:SUPERVISOR_NARRATIVE"] },
    })
  } catch (error) {
    return { draft: null, error: `NARRATIVE_TRANSPORT_ERROR:${error instanceof Error ? error.name : "UNKNOWN"}`, provenance: base }
  }
  if (response.kind !== "text") return { draft: null, error: "NARRATIVE_UNEXPECTED_RESPONSE", provenance: base }
  const provenance = { ...base, responseSha256: sha256(response.text), responseModel: response.model ?? null, durationMs: response.durationMs ?? null, usage: response.usage ?? null }
  // V7 — frases + card curto com refs (o card volta a ser do redator, validado pelo vínculo; o do sistema é a reserva).
  const parsed = parseCompositionResponse(response.text, { withCard: true })
  return parsed.ok ? { draft: parsed.draft, error: null, provenance } : { draft: null, error: parsed.error, provenance }
}

/**
 * INDICATOR DIAGNOSIS V1 — a chamada do redator da INTERPRETAÇÃO/NARRATIVA do fechamento: mesma rota fixa do redator do piloto
 * (gateway único, gemini-3.1-flash-lite, 30 s, zero retry, JSON), prompt próprio e estágio próprio na telemetria
 * (`stage:PRV_DIAGNOSIS_NARRATIVE`). Nunca lança: qualquer falha = sem rascunho, e o texto do SISTEMA assume.
 */
export async function writePrvClosingNarrative(generate: (request: GatewayRequest) => Promise<GatewayResponse>, brief: PrvNarrativeBrief): Promise<PrvNarrativeWriterResult> {
  let userTurn: string
  try {
    const payload = projectPrvBriefForModel(brief)
    assertPrvPayloadSafe(payload)
    userTurn = renderPrvUserTurn(payload)
  } catch {
    return { draft: null, error: "PRV_NARRATIVE_PAYLOAD_VIOLATION", provenance: null }
  }
  const base = { promptVersion: PRV_NARRATIVE_PROMPT_VERSION, requestSha256: sha256(`${PRV_NARRATIVE_SYSTEM_PROMPT}\n\n${userTurn}`), responseSha256: null, responseModel: null, durationMs: null, usage: null }
  let response: GatewayResponse
  try {
    response = await generate({
      systemPrompt: PRV_NARRATIVE_SYSTEM_PROMPT,
      contents: [{ role: "user", text: userTurn }],
      tools: [],
      structuredOutput: true,
      route: feedbackWriterRoute(),
      transport: { timeoutMs: FEEDBACK_WRITER_MODEL_CONFIG.timeoutMs, retries: FEEDBACK_WRITER_MODEL_CONFIG.retries },
      responseSchema: PRV_NARRATIVE_RESPONSE_SCHEMA,
      classification: { phase: "SYNTHESIS", purpose: "FEEDBACK_WRITING", source: "FEEDBACK_WRITER", semanticType: "FEEDBACK", tags: ["stage:PRV_DIAGNOSIS_NARRATIVE"] },
    })
  } catch (error) {
    return { draft: null, error: `PRV_NARRATIVE_TRANSPORT_ERROR:${error instanceof Error ? error.name : "UNKNOWN"}`, provenance: base }
  }
  if (response.kind !== "text") return { draft: null, error: "PRV_NARRATIVE_UNEXPECTED_RESPONSE", provenance: base }
  const provenance = { ...base, responseSha256: sha256(response.text), responseModel: response.model ?? null, durationMs: response.durationMs ?? null, usage: response.usage ?? null }
  const parsed = parsePrvNarrativeResponse(response.text)
  return parsed.ok ? { draft: parsed.draft, error: null, provenance } : { draft: null, error: parsed.error, provenance }
}

/**
 * FEEDBACK EXPERIENCE V2.1 — a VERIFICAÇÃO SEMÂNTICA da narrativa: UMA chamada por rascunho, pelo gateway único, rota FIXA
 * (gemini-3.8-flash — julgar se uma paráfrase acrescentou significado pede mais que o redator), 60 s, 1 retry de transporte, JSON com
 * schema. Nunca lança: qualquer falha vira `status: ERROR` e nada do redator é entregue (a narrativa do sistema assume).
 */
const FACTUALITY_PROFILE: ModelProfile = { id: "narrative-factuality", provider: "GEMINI", model: "gemini-3.8-flash", tier: "STANDARD", contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: false, supportsStructuredOutput: true, supportsReasoning: true, supportsPromptCache: false, enabled: true }
export const NARRATIVE_FACTUALITY_TIMEOUT_MS = 60_000
export function narrativeFactualityRoute(): RouteDecision {
  return { profile: FACTUALITY_PROFILE, tier: "STANDARD", reason: "feedback_writing · verificação semântica da narrativa (V2.1) — modelo fixo, sem roteamento, fallback ou escalação", mode: "CURRENT", escalated: false, fallback: false, purpose: "FEEDBACK_WRITING" }
}

export async function verifyNarrativeFactuality(generate: (request: GatewayRequest) => Promise<GatewayResponse>, draft: NarrativeDraft, brief: NarrativeBrief, items: readonly EmittedItem[]): Promise<StoredFactuality> {
  const systemPrompt = NARRATIVE_FACTUALITY_SYSTEM_PROMPTS[NARRATIVE_FACTUALITY_PROMPT_VERSION]!
  const claims = factualityClaimsOf(draft)
  const failed = (error: string, provenance: unknown = null): StoredFactuality => ({ version: NARRATIVE_FACTUALITY_VERSION, promptVersion: NARRATIVE_FACTUALITY_PROMPT_VERSION, status: "ERROR", verdicts: [], error, provenance })
  let userTurn: string
  try {
    const payload = factualityPayloadOf(draft, brief, items)
    // As mesmas defesas do payload do redator: nada de id, link ou ref interna (as refs S/A e os ids F-n são o vínculo pedido).
    const text = JSON.stringify(payload).replace(/"ref":"[SA]\d+"|"refs":\[[^\]]*\]|"id":"(?:F\d+|CARD)"/g, "")
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text) || /\/materiais\//.test(text)) return failed("FACTUALITY_PAYLOAD_VIOLATION")
    userTurn = renderFactualityUserTurn(payload)
  } catch {
    return failed("FACTUALITY_PAYLOAD_VIOLATION")
  }
  const base = { promptVersion: NARRATIVE_FACTUALITY_PROMPT_VERSION, requestSha256: sha256(`${systemPrompt}\n\n${userTurn}`), responseSha256: null as string | null, responseModel: null as string | null, durationMs: null as number | null, usage: null as unknown }
  let response: GatewayResponse
  try {
    response = await generate({
      systemPrompt,
      contents: [{ role: "user", text: userTurn }],
      tools: [],
      structuredOutput: true,
      route: narrativeFactualityRoute(),
      // Uma nova tentativa só para falha TRANSITÓRIA de transporte (503/timeout) — nunca para refazer um veredito.
      transport: { timeoutMs: NARRATIVE_FACTUALITY_TIMEOUT_MS, retries: 1 },
      responseSchema: NARRATIVE_FACTUALITY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      classification: { phase: "SYNTHESIS", purpose: "FEEDBACK_WRITING", source: "FEEDBACK_WRITER", semanticType: "FEEDBACK", tags: ["stage:NARRATIVE_FACTUALITY"] },
    })
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string" ? (error as { code: string }).code : error instanceof Error ? error.name : "UNKNOWN"
    return failed(`FACTUALITY_TRANSPORT_ERROR:${code}`, base)
  }
  if (response.kind !== "text") return failed("FACTUALITY_UNEXPECTED_RESPONSE", base)
  const provenance = { ...base, responseSha256: sha256(response.text), responseModel: response.model ?? null, durationMs: response.durationMs ?? null, usage: response.usage ?? null }
  const parsed = parseFactualityResponse(response.text, claims)
  return parsed.ok
    ? { version: NARRATIVE_FACTUALITY_VERSION, promptVersion: NARRATIVE_FACTUALITY_PROMPT_VERSION, status: "VERIFIED", verdicts: parsed.verdicts, error: null, provenance }
    : failed(`${parsed.error}${parsed.detail ? `:${parsed.detail.slice(0, 200)}` : ""}`, provenance)
}
