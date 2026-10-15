import { describe, expect, it } from "vitest"
import { AI_USE_CASES, findUseCase, useCaseForPurpose } from "../../../shared/application/model-routing/ai-use-cases.js"
import { canFallbackOn, categorizeHttpStatus, redactSecrets } from "../../../shared/application/model-routing/ai-errors.js"
import { connectionHealth } from "./ai-health.js"
import { aiPermissionsFor } from "./ai-permissions.js"
import { localCostLabel, orderAuto, planRoute, validatePolicy, type ModelSnapshot, type PolicySnapshot } from "./ai-routing-policy.js"
import type { AiPricingVersion } from "./ai-pricing.js"

const pricing = (input: string, output: string, currency = "USD"): AiPricingVersion => ({ id: `p-${input}`, modelId: "x", currency, inputPerMillion: input, outputPerMillion: output, cachedInputPerMillion: null, reasoningPerMillion: null, effectiveFrom: new Date(0), effectiveTo: null, source: "MANUAL", note: null })

function model(id: string, overrides: Partial<ModelSnapshot> = {}): ModelSnapshot {
  return {
    id,
    displayName: id,
    providerModelId: `${id}-provider`,
    enabled: true,
    kind: "GENERATIVE",
    capabilities: { STRUCTURED_OUTPUT: { supported: true, source: "MANUAL" }, TOOLS: { supported: true, source: "MANUAL" } },
    contextWindow: 100_000,
    maxOutputTokens: null,
    qualityTier: null,
    timeoutMs: null,
    isLocal: false,
    pricing: null,
    recentLatencyMs: null,
    lastRateLimitedAt: null,
    connection: { id: `c-${id}`, name: `Conn ${id}`, enabled: true, providerKey: "OPENAI", providerActive: true },
    ...overrides,
  }
}

const policy = (overrides: Partial<PolicySnapshot>): PolicySnapshot => ({ id: "pol", useCase: "SEMANTIC_EXTRACTION", status: "ACTIVE", mode: "PINNED", strategy: null, maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: ["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE"], modelIds: [], ...overrides })
const extraction = findUseCase("SEMANTIC_EXTRACTION")!
const planning = findUseCase("INVESTIGATION_PLANNING")!
const now = new Date("2026-09-22T12:00:00Z")
const ctx = { estimatedInputTokens: 1_000, now }
const mapOf = (...models: ModelSnapshot[]) => new Map(models.map((item) => [item.id, item]))

describe("Use Cases derivados dos pontos reais de chamada", () => {
  it("todo RoutePurpose existente tem Use Case; etapas da análise semântica são separadas pela tag stage", () => {
    for (const purpose of ["PLANNING", "INVESTIGATION_NOTES", "TOOL_ARGUMENT_GENERATION", "ANALYZE_INTERACTIONS", "ANALYZE_PEER_PATTERNS", "AGENT_SYNTHESIS", "SPECIALIST_SYNTHESIS", "ORCHESTRATOR_ROUTING", "ORCHESTRATOR_SYNTHESIS", "POST_JOIN_SYNTHESIS", "GATING_CORRECTION", "FEEDBACK_WRITING"]) expect(useCaseForPurpose(purpose)).not.toBeNull()
    const cls = (tag: string) => ({ phase: "SEMANTIC_ANALYSIS" as const, purpose: "ANALYZE_INTERACTIONS", source: "INVESTIGATION_TOOL" as const, semanticType: "SEMANTIC_ANALYSIS" as const, tags: [tag] })
    expect(useCaseForPurpose("ANALYZE_INTERACTIONS", cls("stage:EXTRACTION"))).toBe("SEMANTIC_EXTRACTION")
    expect(useCaseForPurpose("ANALYZE_INTERACTIONS", cls("stage:SYNTHESIS"))).toBe("PATTERN_SYNTHESIS")
    expect(useCaseForPurpose("ANALYZE_INTERACTIONS", cls("stage:SIDECAR"))).toBe("OUTCOME_ATTRIBUTION")
    expect(useCaseForPurpose("ANALYZE_INTERACTIONS", cls("stage:NEED_KIND"))).toBe("OUTCOME_ATTRIBUTION")
    expect(useCaseForPurpose("GATING_CORRECTION", { phase: "SYNTHESIS", purpose: "GATING_CORRECTION", source: "SPECIALIST", semanticType: "TEXT" })).toBe("SPECIALIST_RESPONSE")
    expect(useCaseForPurpose("QUALQUER_COISA")).toBeNull()
    expect(new Set(AI_USE_CASES.map((item) => item.key)).size).toBe(AI_USE_CASES.length)
  })
})

describe("planRoute — PINNED / FALLBACK_CHAIN / AUTO (§21–§28, §98)", () => {
  it("PINNED usa exatamente o modelo fixado", () => {
    const plan = planRoute(policy({ mode: "PINNED", modelIds: ["a"] }), extraction, mapOf(model("a")), ctx)
    expect(plan.candidates.map((item) => [item.model.id, item.reason])).toEqual([["a", "PINNED"]])
  })
  it("capacidade ausente/não declarada bloqueia a seleção (Tools obrigatórias no planejamento)", () => {
    const local = model("qwen", { isLocal: true, capabilities: { STRUCTURED_OUTPUT: { supported: true, source: "MANUAL" } } })
    const plan = planRoute(policy({ mode: "PINNED", modelIds: ["qwen"], useCase: "INVESTIGATION_PLANNING" }), planning, mapOf(local), ctx)
    expect(plan.candidates).toEqual([])
    expect(plan.skipped[0]?.reason).toContain("TOOLS")
  })
  it("modelo desabilitado e conexão desabilitada nunca são candidatos", () => {
    const plan = planRoute(policy({ mode: "FALLBACK_CHAIN", modelIds: ["a", "b", "c"] }), extraction, mapOf(model("a", { enabled: false }), model("b", { connection: { ...model("b").connection, enabled: false } }), model("c")), ctx)
    expect(plan.candidates.map((item) => item.model.id)).toEqual(["c"])
    expect(plan.skipped.map((item) => item.reason)).toEqual(["modelo desabilitado", 'conexão "Conn b" desabilitada'])
  })
  it("FALLBACK_CHAIN preserva a ordem configurada", () => {
    const plan = planRoute(policy({ mode: "FALLBACK_CHAIN", modelIds: ["a", "b", "c"] }), extraction, mapOf(model("a"), model("b"), model("c")), ctx)
    expect(plan.candidates.map((item) => [item.model.id, item.reason])).toEqual([["a", "FALLBACK_CHAIN_PRIMARY"], ["b", "FALLBACK_CHAIN_NEXT"], ["c", "FALLBACK_CHAIN_NEXT"]])
  })
  it("rate limit recente empurra o modelo para o fim (só quando há alternativa)", () => {
    const plan = planRoute(policy({ mode: "FALLBACK_CHAIN", modelIds: ["a", "b"] }), extraction, mapOf(model("a", { lastRateLimitedAt: new Date(now.getTime() - 10_000) }), model("b")), ctx)
    expect(plan.candidates.map((item) => item.model.id)).toEqual(["b", "a"])
    expect(plan.notes.join(" ")).toContain("Rate limit")
  })
  it("janela de contexto menor que a entrada estimada torna o modelo inelegível", () => {
    const plan = planRoute(policy({ modelIds: ["a"] }), extraction, mapOf(model("a", { contextWindow: 500 })), ctx)
    expect(plan.candidates).toEqual([])
  })
  it("AUTO COST_FIRST ordena pelo preço vigente; desconhecido por último (determinístico)", () => {
    const models = mapOf(model("caro", { pricing: pricing("5", "15") }), model("sem-preco"), model("barato", { pricing: pricing("0.1", "0.4") }))
    const plan = planRoute(policy({ mode: "AUTO", strategy: "COST_FIRST", modelIds: ["caro", "sem-preco", "barato"] }), extraction, models, ctx)
    expect(plan.candidates.map((item) => [item.model.id, item.reason])).toEqual([["barato", "AUTO_COST"], ["caro", "AUTO_COST"], ["sem-preco", "AUTO_COST"]])
    expect(planRoute(policy({ mode: "AUTO", strategy: "COST_FIRST", modelIds: ["caro", "sem-preco", "barato"] }), extraction, models, ctx).candidates.map((item) => item.model.id)).toEqual(["barato", "caro", "sem-preco"])
  })
  it("AUTO LATENCY_FIRST usa latência medida; QUALITY_FIRST usa só o tier DECLARADO pelo admin", () => {
    const items = [
      { model: model("a", { recentLatencyMs: 900, qualityTier: "BASIC" }), position: 0 },
      { model: model("b", { recentLatencyMs: 300, qualityTier: "DEEP" }), position: 1 },
      { model: model("c", { recentLatencyMs: null, qualityTier: "STANDARD" }), position: 2 },
    ]
    expect(orderAuto(items, "LATENCY_FIRST").map((item) => item.model.id)).toEqual(["b", "a", "c"])
    expect(orderAuto(items, "QUALITY_FIRST").map((item) => item.model.id)).toEqual(["b", "c", "a"])
    // Sem preço: postos de custo = ordem configurada; a (0+1) empata com b (1+0) → desempate pela posição.
    expect(orderAuto(items, "BALANCED").map((item) => item.model.id)).toEqual(["a", "b", "c"])
  })
  it("limite de custo por requisição: modelo sem preço ou caro demais fica de fora (moedas nunca convertidas)", () => {
    const models = mapOf(model("caro", { pricing: pricing("100", "100") }), model("sem"), model("brl", { pricing: pricing("0.1", "0.1", "BRL") }), model("ok", { pricing: pricing("1", "1") }))
    const plan = planRoute(policy({ mode: "AUTO", strategy: "COST_FIRST", modelIds: ["caro", "sem", "brl", "ok"], maxEstimatedCostPerRequest: "0.01", costCurrency: "USD" }), extraction, models, { estimatedInputTokens: 1_000, now })
    expect(plan.candidates.map((item) => item.model.id)).toEqual(["ok"])
    expect(plan.skipped.map((item) => item.modelId).sort()).toEqual(["brl", "caro", "sem"])
  })
})

describe("validatePolicy — política inválida nunca é ativada (§62)", () => {
  it("aponta modelo desabilitado, cadeia curta, estratégia ausente e fallback proibido", () => {
    const models = mapOf(model("a", { enabled: false }), model("b"))
    const codes = validatePolicy({ useCase: "SEMANTIC_EXTRACTION", mode: "FALLBACK_CHAIN", strategy: null, maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: ["INVALID_REQUEST"], modelIds: ["a"] }, extraction, models).map((issue) => issue.code)
    expect(codes).toEqual(expect.arrayContaining(["AI_POLICY_CHAIN_TOO_SHORT", "AI_POLICY_FALLBACK_NOT_ALLOWED", "AI_POLICY_MODEL_INELIGIBLE"]))
    expect(validatePolicy({ useCase: "SEMANTIC_EXTRACTION", mode: "AUTO", strategy: null, maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: [], modelIds: ["b"] }, extraction, models).map((issue) => issue.code)).toContain("AI_POLICY_STRATEGY_REQUIRED")
    expect(validatePolicy({ useCase: "SEMANTIC_EXTRACTION", mode: "PINNED", strategy: null, maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: [], modelIds: ["b"] }, extraction, models)).toEqual([])
  })
  it("QUALITY_FIRST exige tier declarado em todos os modelos (nenhum número mágico)", () => {
    const issues = validatePolicy({ useCase: "SEMANTIC_EXTRACTION", mode: "AUTO", strategy: "QUALITY_FIRST", maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: [], modelIds: ["b"] }, extraction, mapOf(model("b")))
    expect(issues.map((issue) => issue.code)).toContain("AI_POLICY_QUALITY_TIER_MISSING")
  })
  it("Use Case não roteável (voz) não aceita policy", () => {
    expect(validatePolicy({ useCase: "VOICE_REALTIME", mode: "PINNED", strategy: null, maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: [], modelIds: [] }, findUseCase("VOICE_REALTIME"), new Map()).map((issue) => issue.code)).toContain("AI_USE_CASE_NOT_ROUTABLE")
  })
})

describe("regras de fallback e erro normalizado (§24, §92)", () => {
  it("só disponibilidade faz fallback; AUTH só por opt-in explícito; INVALID_REQUEST/CONTEXT_LIMIT nunca", () => {
    const defaults = ["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE"]
    expect(canFallbackOn("RATE_LIMIT", defaults)).toBe(true)
    expect(canFallbackOn("AUTH", defaults)).toBe(false)
    expect(canFallbackOn("AUTH", [...defaults, "AUTH"])).toBe(true)
    expect(canFallbackOn("INVALID_REQUEST", [...defaults, "INVALID_REQUEST"])).toBe(false)
    expect(canFallbackOn("CONTEXT_LIMIT", [...defaults, "CONTEXT_LIMIT"])).toBe(false)
  })
  it("HTTP → categoria", () => {
    expect(categorizeHttpStatus(401)).toBe("AUTH")
    expect(categorizeHttpStatus(429)).toBe("RATE_LIMIT")
    expect(categorizeHttpStatus(503)).toBe("PROVIDER_ERROR")
    expect(categorizeHttpStatus(400, "This model's maximum context length is 8192 tokens")).toBe("CONTEXT_LIMIT")
    expect(categorizeHttpStatus(400, "bad field")).toBe("INVALID_REQUEST")
  })
  it("redação de segredos: valor conhecido + padrões de chave de vendors", () => {
    const text = redactSecrets("key=sk-abcdefghijklmnop1234 Bearer xyzxyzxyzxyz AIzaSyA1234567890123456789012 minha-chave-interna-xyz", ["minha-chave-interna-xyz"])
    expect(text).not.toMatch(/sk-abcdef|xyzxyzxyz|AIzaSy|minha-chave-interna/)
  })
})

describe("saúde, permissões e custo local", () => {
  it("saúde derivada de teste explícito + telemetria (sem polling)", () => {
    const base = { lastTest: null, attempts24h: 0, errors24h: 0, rateLimitsLastHour: 0, lastSuccessAt: null, lastErrorAt: null }
    expect(connectionHealth(base)).toBe("UNKNOWN")
    expect(connectionHealth({ ...base, lastTest: { status: "CONNECTED", checkedAt: now } })).toBe("HEALTHY")
    expect(connectionHealth({ ...base, lastTest: { status: "AUTH_ERROR", checkedAt: now } })).toBe("OFFLINE")
    expect(connectionHealth({ ...base, lastTest: { status: "AUTH_ERROR", checkedAt: new Date(0) }, lastSuccessAt: now })).toBe("HEALTHY")
    expect(connectionHealth({ ...base, attempts24h: 10, errors24h: 3, lastSuccessAt: now })).toBe("DEGRADED")
    expect(connectionHealth({ ...base, attempts24h: 4, errors24h: 4 })).toBe("OFFLINE")
    expect(connectionHealth({ ...base, rateLimitsLastHour: 1, lastSuccessAt: now })).toBe("DEGRADED")
  })
  it("permissões derivadas do papel + escopo existentes (sem backdoor)", () => {
    // V1.5.7: derivadas das atribuições de papel (nunca do cargo). Administrador geral (organização) = tudo; Administrador
    // (qualquer escopo) = leitura; sem papel = nada, qualquer que seja o cargo. "Quem mais usa" (AI_USAGE_RANKING_READ) vem da
    // concessão explícita `ai.usage_ranking.view` que os dois papéis carregam — nunca de ai.manage/ai.view.
    const ctx = (roleCode: string | null, scope: { type: "ORGANIZATION" } | { type: "GROUP"; teamId: string } = { type: "ORGANIZATION" }) => ({ organizationId: "o", accountId: "a", personId: "p", assignments: roleCode ? [{ id: "x", roleCode, scope }] : [] })
    expect(aiPermissionsFor(ctx("ADMINISTRADOR_GERAL"))).toEqual(["AI_CONFIG_READ", "AI_CONFIG_WRITE", "AI_SECRETS_WRITE", "AI_USAGE_READ", "AI_BUDGET_WRITE", "AI_USAGE_RANKING_READ"])
    expect(aiPermissionsFor(ctx("ADMINISTRADOR", { type: "GROUP", teamId: "t" }))).toEqual(["AI_CONFIG_READ", "AI_USAGE_READ", "AI_USAGE_RANKING_READ"])
    expect(aiPermissionsFor(ctx("ADMINISTRADOR_DE_ACESSOS"))).toEqual([])
    expect(aiPermissionsFor(ctx(null))).toEqual([])
  })
  it("modelo local: custo de API zero ≠ desconhecido (nunca \"grátis\")", () => {
    expect(localCostLabel({ isLocal: true, pricing: null })).toBe("API_COST_UNKNOWN")
    expect(localCostLabel({ isLocal: true, pricing: pricing("0", "0") })).toBe("API_COST_ZERO")
    expect(localCostLabel({ isLocal: false, pricing: null })).toBe("NOT_LOCAL")
  })
})

describe("Voz do recado (SPEECH_SYNTHESIS) roteável", () => {
  const speech = findUseCase("SPEECH_SYNTHESIS")!
  const audio = { AUDIO: { supported: true, source: "MANUAL" as const } }
  const voiceModel = (id: string, overrides: Partial<ModelSnapshot> = {}) => model(id, { capabilities: audio, speech: { voice: "marin", instructions: null }, ...overrides })

  it("é configurável e exige áudio declarado, protocolo com síntese de voz e voz cadastrada no modelo", () => {
    expect(speech).toMatchObject({ routable: true, requiredCapabilities: ["AUDIO"], requiresSpeechVoice: true })
    const models = mapOf(voiceModel("ok"), voiceModel("sem-audio", { capabilities: {} }), voiceModel("sem-voz", { speech: null }), voiceModel("gemini", { connection: { id: "c-g", name: "Gemini", enabled: true, providerKey: "GOOGLE_GENAI", providerActive: true } }), voiceModel("compat", { connection: { id: "c-x", name: "Gateway", enabled: true, providerKey: "OPENAI_COMPATIBLE", providerActive: true } }))
    const plan = planRoute(policy({ useCase: "SPEECH_SYNTHESIS", mode: "AUTO", strategy: "BALANCED", modelIds: ["ok", "sem-audio", "sem-voz", "gemini", "compat"] }), speech, models, ctx)
    expect(plan.candidates.map((candidate) => candidate.model.id)).toEqual(["ok", "compat"])
    expect(Object.fromEntries(plan.skipped.map((item) => [item.modelId, item.reason]))).toEqual({
      "sem-audio": "capacidade ausente ou não declarada: AUDIO",
      "sem-voz": "voz não configurada no modelo",
      gemini: "o provider não faz síntese de voz na INIA (hoje: OpenAI e servidores compatíveis)",
    })
    const issues = validatePolicy({ useCase: "SPEECH_SYNTHESIS", mode: "PINNED", strategy: null, maxEstimatedCostPerRequest: null, costCurrency: null, fallbackOn: [], modelIds: ["sem-voz"] }, speech, models)
    expect(issues).toEqual([expect.objectContaining({ code: "AI_POLICY_MODEL_INELIGIBLE", message: "sem-voz: voz não configurada no modelo." })])
  })

  it("a exigência de voz não vale para as outras funções", () => {
    expect(planRoute(policy({ modelIds: ["a"] }), extraction, mapOf(model("a")), ctx).candidates).toHaveLength(1)
  })
})
