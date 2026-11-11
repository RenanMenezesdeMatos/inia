import type { Database } from "../../../infrastructure/database/pool.js"
import { withLlmScope, type LlmRequestSource } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { AiCallCancelledError } from "../../../shared/application/model-routing/ai-errors.js"
import { generateForRoute, routeFor, type GatewayRequest } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { loadAgentGuardrails, type AgentGuardrails } from "../../agents/application/agent-guardrails.js"
import { QaWriteBlockedError } from "../../qa-lab/application/read-only-database.js"
import {
  complianceRulesOf,
  limitComplianceSources,
  parseComplianceVerdict,
  renderComplianceInput,
  renderComplianceSourcesSystem,
  renderComplianceSystem,
  RESPONSE_COMPLIANCE_MAX_CHARS,
  RESPONSE_COMPLIANCE_PROMPT_VERSION,
  RESPONSE_COMPLIANCE_SOURCES_PROMPT_VERSION,
  RESPONSE_COMPLIANCE_DATA_PROMPT_VERSION,
  responseCheckMode,
  type ComplianceHit,
  type ComplianceRule,
  type ComplianceSource,
} from "../domain/response-compliance.js"

/**
 * A conferência da resposta (PEN-017), um caminho só para todos os canais. As regras são as de sempre, lidas de `loadAgentGuardrails`: nada de
 * cadastro novo. Sem regra, não há chamada à IA. Passa pelo gateway único (roteamento, uso e custo registrados, Use Case RESPONSE_COMPLIANCE).
 */
export type ComplianceModel = (input: { organizationId: string; agentId: string | null; system: string; user: string; source: LlmRequestSource }) => Promise<{ text: string; model: string | null }>

/** Curto de propósito: a conferência fica entre a resposta pronta e quem espera por ela. */
export const RESPONSE_COMPLIANCE_TIMEOUT_MS = 20_000

export const gatewayComplianceModel: ComplianceModel = async (input) => {
  const call = async () => {
    const route = routeFor({ purpose: "RESPONSE_COMPLIANCE", phase: "KNOWLEDGE", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(input.system, input.user) })
    const request: GatewayRequest = {
      classification: { phase: "KNOWLEDGE", purpose: "RESPONSE_COMPLIANCE", source: input.source, semanticType: "RESPONSE_COMPLIANCE" },
      systemPrompt: input.system,
      contents: [{ role: "user", text: input.user }],
      tools: [],
      structuredOutput: true,
      transport: { timeoutMs: RESPONSE_COMPLIANCE_TIMEOUT_MS },
      route,
    }
    const reply = await withLlmScope({ role: "response_compliance", agentId: input.agentId }, () => generateForRoute(request))
    return { text: reply.kind === "text" ? reply.text : "", model: reply.model ?? route.profile.model }
  }
  return currentAiOrganizationId() === input.organizationId ? call() : runWithAiOrganization(input.organizationId, call)
}

export type ResponseCheckRequest = {
  organizationId: string
  text: string
  question?: string | null | undefined
  /** O agente cujos limites valem para esta resposta (null = só os assuntos proibidos). */
  agentId?: string | null | undefined
  /** Regras já lidas neste turno: a resposta usa as mesmas que foram para a instrução. */
  guardrails?: AgentGuardrails | null | undefined
  source: LlmRequestSource
  /** O que sustentou a resposta (trechos de base, respostas anteriores já conferidas). Com alguma fonte, usa a V3 da conferência. */
  sources?: readonly ComplianceSource[] | undefined
}

/** `promptVersion`: a versão da conferência usada neste resultado, gravada no registro. */
export type ResponseCheckResult =
  | { outcome: "NOT_APPLICABLE" }
  | { outcome: "ALLOWED"; model: string | null; durationMs: number; promptVersion?: string }
  | { outcome: "VIOLATION"; hits: ComplianceHit[]; reason: string; model: string | null; durationMs: number; promptVersion?: string }
  | { outcome: "CHECK_FAILED"; code: string; message: string; model: string | null; durationMs: number; cause?: unknown; promptVersion?: string }

export type ResponseCheck = (db: Pick<Database, "query">, request: ResponseCheckRequest, model?: ComplianceModel) => Promise<ResponseCheckResult>

const failure = (code: string, message: string, startedAt: number, cause?: unknown): ResponseCheckResult => ({ outcome: "CHECK_FAILED", code, message, model: null, durationMs: Date.now() - startedAt, ...(cause === undefined ? {} : { cause }) })

/**
 * Nunca lança, salvo o cancelamento de quem pediu: uma falha vira CHECK_FAILED, e quem chama decide sem exceção de sobra. Falha passageira ou
 * resposta fora do contrato têm UMA nova tentativa; repetir mais só faria a pessoa esperar.
 */
export const checkResponse: ResponseCheck = async (db, request, model = gatewayComplianceModel) => {
  const startedAt = Date.now()
  let guardrails = request.guardrails ?? null
  if (!guardrails) {
    try {
      guardrails = await loadAgentGuardrails(db, request.organizationId, request.agentId ?? null)
    } catch (error) {
      return failure("RESPONSE_CHECK_RULES_UNAVAILABLE", "Não foi possível ler as regras para conferir a resposta.", startedAt, error)
    }
  }
  const rules = complianceRulesOf(guardrails)
  if (rules.length === 0) return { outcome: "NOT_APPLICABLE" }
  if (request.text.length > RESPONSE_COMPLIANCE_MAX_CHARS) return failure("RESPONSE_CHECK_TEXT_TOO_LONG", "A resposta é longa demais para ser conferida.", startedAt)
  const sources = limitComplianceSources(request.sources ?? [])
  const judge = async (judged: readonly ComplianceRule[], system: string, promptVersion: string, withSources: readonly ComplianceSource[]): Promise<Exclude<ResponseCheckResult, { outcome: "NOT_APPLICABLE" }>> => {
    const user = renderComplianceInput({ question: request.question, response: request.text, sources: withSources })
    let last: Extract<ResponseCheckResult, { outcome: "CHECK_FAILED" }> = { outcome: "CHECK_FAILED", code: "RESPONSE_CHECK_FAILED", message: "A conferência da resposta falhou.", model: null, durationMs: 0 }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const reply = await model({ organizationId: request.organizationId, agentId: request.agentId ?? null, system, user, source: request.source })
        const verdict = parseComplianceVerdict(reply.text, judged, request.text)
        if (verdict) return { ...verdict, model: reply.model, durationMs: Date.now() - startedAt, promptVersion }
        last = { outcome: "CHECK_FAILED", code: "RESPONSE_CHECK_INVALID_OUTPUT", message: "A conferência devolveu uma resposta fora do contrato.", model: reply.model, durationMs: Date.now() - startedAt }
      } catch (error) {
        if (error instanceof AiCallCancelledError) throw error
        last = { outcome: "CHECK_FAILED", code: "RESPONSE_CHECK_PROVIDER_ERROR", message: "O provedor de IA não concluiu a conferência.", model: null, durationMs: Date.now() - startedAt, cause: error }
      }
    }
    return { ...last, promptVersion }
  }
  if (sources.length === 0) return judge(rules, renderComplianceSystem(rules), RESPONSE_COMPLIANCE_PROMPT_VERSION, [])
  // Com fontes: os assuntos proibidos vão com elas (V3); o limite de atuação não depende de onde a informação veio e vai à parte, sem elas (V1).
  const topicRules = complianceRulesOf({ actionLimits: null, prohibitedTopics: guardrails.prohibitedTopics })
  const limitRules = complianceRulesOf({ actionLimits: guardrails.actionLimits, prohibitedTopics: [] })
  // Com dados calculados entre as fontes, a V5 (a V3 com a origem desses dados); sem eles, a V3 exatamente como foi medida.
  const withData = sources.some((source) => source.origin === "DATA")
  const judgeTopics = () => judge(topicRules, renderComplianceSourcesSystem(topicRules, { withData }), withData ? RESPONSE_COMPLIANCE_DATA_PROMPT_VERSION : RESPONSE_COMPLIANCE_SOURCES_PROMPT_VERSION, sources)
  const judgeLimits = () => judge(limitRules, renderComplianceSystem(limitRules), RESPONSE_COMPLIANCE_PROMPT_VERSION, [])
  if (limitRules.length === 0) return judgeTopics()
  if (topicRules.length === 0) return judgeLimits()
  const [topics, limits] = await Promise.all([judgeTopics(), judgeLimits()])
  return combineJudgements(topics, limits)
}

type Judgement = Exclude<ResponseCheckResult, { outcome: "NOT_APPLICABLE" }>
/** Violação em qualquer lado é violação, mesmo que o outro lado tenha falhado. Sem violação, uma falha vale pela conferência inteira: nada sai sem as duas partes. */
function combineJudgements(topics: Judgement, limits: Judgement): ResponseCheckResult {
  const durationMs = Math.max(topics.durationMs, limits.durationMs)
  // A versão das fontes que valeu nesta conferência (V3 ou V5), a mesma da parte dos assuntos proibidos.
  const promptVersion = topics.promptVersion ?? RESPONSE_COMPLIANCE_SOURCES_PROMPT_VERSION
  const violations = [topics, limits].filter((item): item is Extract<Judgement, { outcome: "VIOLATION" }> => item.outcome === "VIOLATION")
  if (violations.length > 0) return { outcome: "VIOLATION", hits: violations.flatMap((item) => item.hits), reason: violations.map((item) => item.reason).join(" "), model: violations[0]!.model, durationMs, promptVersion }
  const failed = [topics, limits].find((item) => item.outcome === "CHECK_FAILED")
  if (failed) return { ...failed, durationMs, promptVersion }
  return { outcome: "ALLOWED", model: topics.model, durationMs, promptVersion }
}

export type ResponseCheckSurface = "CHAT" | "VOICE_TOOL" | "VOICE_SPOKEN" | "AGENT_RUN" | "SPECIALIST" | "WORKFLOW_ORCHESTRATOR"
export type ResponseCheckRecord = {
  organizationId: string
  surface: ResponseCheckSurface
  /** PREVENTIVE = conferida antes de chegar à pessoa. DETECTIVE = conferida depois. */
  control: "PREVENTIVE" | "DETECTIVE"
  action: "DELIVERED" | "BLOCKED" | "RECORDED"
  result: Exclude<ResponseCheckResult, { outcome: "NOT_APPLICABLE" }>
  text: string
  conversationId?: string | null | undefined
  interactionId?: string | null | undefined
  agentId?: string | null | undefined
  agentRunId?: string | null | undefined
  workflowEnrollmentId?: string | null | undefined
}

/** Só registro: falhar aqui não muda o que já foi decidido. O QA Lab (só leitura) não grava nada. */
export async function recordResponseCheck(db: Pick<Database, "query">, record: ResponseCheckRecord): Promise<void> {
  const { result } = record
  const flagged = result.outcome !== "ALLOWED"
  if (flagged) console.warn(JSON.stringify({ event: "response_check_flagged", outcome: result.outcome, surface: record.surface, control: record.control, action: record.action, code: result.outcome === "CHECK_FAILED" ? result.code : null, conversationId: record.conversationId ?? null }))
  try {
    await db.query(
      `insert into response_compliance_checks (organization_id, surface, control, outcome, action, rules, reason, error_code, flagged_content, conversation_id, interaction_id, agent_id, agent_run_id, workflow_enrollment_id, prompt_version, model, duration_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        record.organizationId,
        record.surface,
        record.control,
        result.outcome,
        record.action,
        JSON.stringify(result.outcome === "VIOLATION" ? result.hits : []),
        result.outcome === "VIOLATION" ? result.reason : result.outcome === "CHECK_FAILED" ? result.message : null,
        result.outcome === "CHECK_FAILED" ? result.code : null,
        flagged ? record.text : null,
        record.conversationId ?? null,
        record.interactionId ?? null,
        record.agentId ?? null,
        record.agentRunId ?? null,
        record.workflowEnrollmentId ?? null,
        result.promptVersion ?? RESPONSE_COMPLIANCE_PROMPT_VERSION,
        result.model,
        result.durationMs,
      ],
    )
  } catch (error) {
    if (error instanceof QaWriteBlockedError) return
    console.error(JSON.stringify({ event: "response_check_record_failed", surface: record.surface, message: (error as Error).message }))
  }
}

/** A entrada de `tool_calls` da mensagem que substituiu uma resposta: a tela de monitoramento e o histórico sabem o que aconteceu, sem o conteúdo. */
export const RESPONSE_CHECK_TOOL_NAME = "response_check"
export function responseCheckToolCall(result: Exclude<ResponseCheckResult, { outcome: "NOT_APPLICABLE" }>, control: "PREVENTIVE" | "DETECTIVE") {
  return { toolName: RESPONSE_CHECK_TOOL_NAME, outcome: result.outcome, control, rules: result.outcome === "VIOLATION" ? result.hits : [] }
}

export const RESPONSE_BLOCKED_BY_RULES_CODE = "RESPONSE_BLOCKED_BY_RULES"
export const RESPONSE_CHECK_UNAVAILABLE_CODE = "RESPONSE_CHECK_UNAVAILABLE"

/**
 * Saída que vai para um próximo passo, sem ninguém esperando na tela (execução de agente, etapa de Workflow): confere antes de seguir. Violação
 * interrompe como a evidência não literal: a resposta rejeitada fica no diagnóstico e não há nova tentativa. Falha da conferência pode ser
 * repetida (a etapa volta pela política de sempre) e nada segue sem conferência.
 */
export async function enforceResponseBeforeNextStep(
  db: Pick<Database, "query">,
  input: { organizationId: string; text: string; agentId: string | null; surface: Extract<ResponseCheckSurface, "AGENT_RUN" | "SPECIALIST" | "WORKFLOW_ORCHESTRATOR">; source: LlmRequestSource; agentRunId?: string | null | undefined; workflowEnrollmentId?: string | null | undefined; guardrails?: AgentGuardrails | null | undefined; sources?: readonly ComplianceSource[] | undefined },
  check: ResponseCheck = checkResponse,
): Promise<void> {
  const mode = responseCheckMode()
  if (mode === "OFF") return
  const result = await check(db, { organizationId: input.organizationId, text: input.text, agentId: input.agentId, guardrails: input.guardrails, source: input.source, sources: input.sources })
  if (result.outcome === "NOT_APPLICABLE") return
  const enforcing = mode === "ENFORCE"
  const allowed = result.outcome === "ALLOWED"
  await recordResponseCheck(db, { organizationId: input.organizationId, surface: input.surface, control: enforcing ? "PREVENTIVE" : "DETECTIVE", action: allowed ? "DELIVERED" : enforcing ? "BLOCKED" : "RECORDED", result, text: input.text, agentId: input.agentId, agentRunId: input.agentRunId, workflowEnrollmentId: input.workflowEnrollmentId })
  if (!enforcing || allowed) return
  if (result.outcome === "VIOLATION") {
    throw new ModelOutputContractError(`A resposta foi bloqueada pela conferência: ${result.hits.map((hit) => hit.name).join(", ")}.`, RESPONSE_BLOCKED_BY_RULES_CODE, {
      contract: "RESPONSE_COMPLIANCE",
      contractVersion: result.promptVersion ?? RESPONSE_COMPLIANCE_PROMPT_VERSION,
      violations: result.hits.map((hit) => ({ path: "$", code: hit.kind, message: hit.name })),
      rawResponse: input.text,
    })
  }
  throw new DomainError("A conferência da resposta não pôde ser concluída. Nada foi entregue.", RESPONSE_CHECK_UNAVAILABLE_CODE, 503)
}
