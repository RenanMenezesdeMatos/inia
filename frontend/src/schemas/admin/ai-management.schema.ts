import { z } from "zod"

/**
 * Administração de IA (`/admin/ai`) — Providers, Conexões, Modelos, Roteamento por Use Case,
 * Custos e Orçamentos. Espelho dos view-models de `backend/src/modules/ai-management`.
 *
 * Regras que a tela respeita (o backend é a autoridade):
 *  - Segredo nunca volta: a conexão traz só `credential.configured` + `maskedValue`.
 *  - Dinheiro é STRING decimal por moeda (`costByCurrency`): nunca somar moedas, nunca converter.
 *  - Token `null` = "não informado pelo provider" — nunca vira 0.
 *  - A UI de conexão é montada pela metadata do provider (`/providers`) — nenhum `if provider`.
 */

// ---------------------------------------------------------------------------------------------
// Vocabulário (tipos do produto, não dados da organização)
// ---------------------------------------------------------------------------------------------

export const AI_PERMISSIONS = ["AI_CONFIG_READ", "AI_CONFIG_WRITE", "AI_SECRETS_WRITE", "AI_USAGE_READ", "AI_BUDGET_WRITE"] as const
export type AiPermission = (typeof AI_PERMISSIONS)[number]

export const AI_CAPABILITIES = ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING", "REASONING", "VISION", "AUDIO", "PROMPT_CACHE"] as const
export type AiCapability = (typeof AI_CAPABILITIES)[number]

export const AI_CAPABILITY_LABELS: Record<AiCapability, string> = {
  STRUCTURED_OUTPUT: "Saída estruturada (JSON)",
  TOOLS: "Ferramentas (function calling)",
  STREAMING: "Streaming",
  REASONING: "Raciocínio",
  VISION: "Visão (imagem)",
  AUDIO: "Áudio",
  PROMPT_CACHE: "Cache de prompt",
}

export const CAPABILITY_SOURCE_LABELS: Record<string, string> = {
  DISCOVERED: "Informada pela API do provider",
  MANUAL: "Declarada pelo admin",
  INFERRED: "Inferida pela INIA (família conhecida)",
}

export const AI_MODEL_KINDS = ["GENERATIVE", "EMBEDDING", "CLASSIFICATION", "DECISION"] as const
export const AI_MODEL_KIND_LABELS: Record<string, string> = { GENERATIVE: "Generativo", EMBEDDING: "Embedding", CLASSIFICATION: "Classificação", DECISION: "Decisão" }
/** Só modelos generativos atendem Use Cases nesta versão. */
export const ROUTABLE_MODEL_KINDS = ["GENERATIVE"]

/** Voz para síntese de voz — mesmas regras do backend (ai-management/domain/ai-speech.ts). */
export const SPEECH_VOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/
export const SPEECH_INSTRUCTIONS_MAX_LENGTH = 1_000

export const AI_QUALITY_TIERS = ["BASIC", "STANDARD", "DEEP"] as const
export const AI_QUALITY_TIER_LABELS: Record<string, string> = { BASIC: "Básico", STANDARD: "Padrão", DEEP: "Profundo" }

export const AI_ROUTING_MODES = ["PINNED", "FALLBACK_CHAIN", "AUTO"] as const
export type AiRoutingMode = (typeof AI_ROUTING_MODES)[number]
export const AI_ROUTING_MODE_LABELS: Record<AiRoutingMode, string> = { PINNED: "Modelo fixo", FALLBACK_CHAIN: "Cadeia de fallback", AUTO: "Automático" }
export const AI_ROUTING_MODE_DESCRIPTIONS: Record<AiRoutingMode, string> = {
  PINNED: "Sempre o mesmo modelo. Se ele falhar, a chamada falha (sem troca silenciosa).",
  FALLBACK_CHAIN: "O primeiro modelo atende; os seguintes só são tentados, na ordem, quando o anterior falha por um dos erros marcados.",
  AUTO: "A INIA ordena os modelos elegíveis pela estratégia escolhida, de forma determinística (nunca um LLM escolhendo outro LLM).",
}
/** Mesmo limite do backend (MAX_POLICY_MODELS). */
export const AI_ROUTING_MAX_MODELS: Record<AiRoutingMode, number> = { PINNED: 1, FALLBACK_CHAIN: 5, AUTO: 8 }

export const AI_AUTO_STRATEGIES = ["COST_FIRST", "LATENCY_FIRST", "BALANCED", "QUALITY_FIRST"] as const
export type AiAutoStrategy = (typeof AI_AUTO_STRATEGIES)[number]
export const AI_AUTO_STRATEGY_LABELS: Record<AiAutoStrategy, string> = {
  COST_FIRST: "Menor custo (preço vigente configurado)",
  LATENCY_FIRST: "Menor latência (mediana real das chamadas recentes)",
  BALANCED: "Equilibrado (custo + latência)",
  QUALITY_FIRST: "Qualidade — tier declarado pelo admin, não é benchmark",
}

export const AI_FALLBACK_CATEGORIES = ["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE", "AUTH"] as const
export type AiFallbackCategory = (typeof AI_FALLBACK_CATEGORIES)[number]
export const AI_DEFAULT_FALLBACK_ON: AiFallbackCategory[] = ["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE"]
export const AI_FALLBACK_CATEGORY_LABELS: Record<AiFallbackCategory, string> = {
  RATE_LIMIT: "Limite de requisições (rate limit)",
  TIMEOUT: "Tempo esgotado",
  NETWORK: "Falha de rede",
  PROVIDER_ERROR: "Erro do provider",
  MODEL_UNAVAILABLE: "Modelo indisponível",
  AUTH: "Credencial recusada",
}

export const AI_BUDGET_SCOPES = ["GLOBAL", "USE_CASE", "PROVIDER"] as const
export type AiBudgetScope = (typeof AI_BUDGET_SCOPES)[number]
export const AI_BUDGET_SCOPE_LABELS: Record<AiBudgetScope, string> = { GLOBAL: "Global (todos os usos)", USE_CASE: "Por Use Case", PROVIDER: "Por provider" }
export const AI_DEFAULT_WARNING_THRESHOLDS = [70, 90, 100]

export const AI_USAGE_PERIODS = ["TODAY", "7D", "30D", "MONTH", "CUSTOM"] as const
export type AiUsagePeriod = (typeof AI_USAGE_PERIODS)[number]
export const AI_USAGE_PERIOD_LABELS: Record<AiUsagePeriod, string> = { TODAY: "Hoje", "7D": "7 dias", "30D": "30 dias", MONTH: "Mês atual", CUSTOM: "Personalizado" }

export const CONNECTION_TEST_STATUS_LABELS: Record<string, string> = {
  CONNECTED: "Conectado",
  AUTH_ERROR: "Credencial recusada",
  NETWORK_ERROR: "Falha de rede",
  RATE_LIMITED: "Rate limit",
  INVALID_ENDPOINT: "Endpoint inválido",
  UNSUPPORTED: "Sem verificação automática",
  UNKNOWN_ERROR: "Erro desconhecido",
}

export const CONNECTION_HEALTH_LABELS: Record<string, string> = { HEALTHY: "Saudável", DEGRADED: "Degradada", OFFLINE: "Fora do ar", UNKNOWN: "Desconhecida" }

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

export const aiMeSchema = z.object({ permissions: z.array(z.string()) })

export const aiProviderSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().catch(""),
  adapterType: z.string(),
  deployment: z.enum(["REMOTE", "LOCAL", "REMOTE_OR_LOCAL"]),
  icon: z.string().catch("plug"),
  defaultBaseUrl: z.string().nullable(),
  baseUrlRequired: z.boolean(),
  credential: z.enum(["REQUIRED", "OPTIONAL", "NONE"]),
  credentialLabel: z.string().catch(""),
  supportsModelDiscovery: z.boolean(),
  supportsCustomHeaders: z.boolean(),
  protocolCapabilities: z.array(z.string()).catch([]),
  notes: z.array(z.string()).catch([]),
})
export type AiProvider = z.infer<typeof aiProviderSchema>

export const aiUseCaseSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().catch(""),
  group: z.string(),
  requiredCapabilities: z.array(z.string()),
  preferredCapabilities: z.array(z.string()).catch([]),
  routable: z.boolean(),
  internal: z.boolean().optional().default(false),
  /** Síntese de voz: o modelo precisa de uma voz cadastrada. */
  requiresSpeechVoice: z.boolean().optional().default(false),
  notes: z.string().optional(),
})
export type AiUseCase = z.infer<typeof aiUseCaseSchema>

export const connectionHealthSnapshotSchema = z.object({ status: z.string().nullable(), checkedAt: z.string().nullable(), latencyMs: z.number().nullable(), message: z.string().nullable() })

export const aiConnectionSchema = z.object({
  id: z.string(),
  providerKey: z.string(),
  provider: z.object({ key: z.string(), name: z.string(), icon: z.string(), deployment: z.string(), credential: z.string() }).nullable(),
  name: z.string(),
  baseUrl: z.string().nullable(),
  effectiveBaseUrl: z.string().nullable(),
  apiVersion: z.string().nullable().catch(null),
  isLocal: z.boolean(),
  timeoutMs: z.number(),
  /** Chamadas simultâneas da conexão somando todas as instâncias da INIA; null = sem limite próprio. */
  maxConcurrentCalls: z.number().nullable().catch(null),
  enabled: z.boolean(),
  credential: z.object({ configured: z.boolean(), maskedValue: z.string().nullable(), updatedAt: z.string().nullable() }),
  customHeaderNames: z.array(z.string()).catch([]),
  health: connectionHealthSnapshotSchema,
  modelCount: z.number(),
  enabledModelCount: z.number(),
  lastUsedAt: z.string().nullable(),
  activePolicyUseCases: z.array(z.string()).catch([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type AiConnection = z.infer<typeof aiConnectionSchema>

export const connectionTestResultSchema = z.object({ status: z.string(), latencyMs: z.number().nullable(), message: z.string(), modelCount: z.number().nullable(), checkedAt: z.string() })
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>

export const syncReportSchema = z.object({ discovered: z.number(), created: z.number(), updated: z.number(), missing: z.number() })
export type SyncReport = z.infer<typeof syncReportSchema>

export const capabilityClaimSchema = z.object({ supported: z.boolean(), source: z.string() })
export type CapabilityClaim = z.infer<typeof capabilityClaimSchema>

export const aiPricingSchema = z.object({
  id: z.string(),
  currency: z.string(),
  inputPerMillion: z.string(),
  outputPerMillion: z.string(),
  cachedInputPerMillion: z.string().nullable(),
  reasoningPerMillion: z.string().nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  note: z.string().nullable(),
})
export type AiPricing = z.infer<typeof aiPricingSchema>

export const AI_COST_LABELS = ["NOT_LOCAL", "API_COST_ZERO", "API_COST_UNKNOWN", "API_COST_CONFIGURED"] as const
export type AiCostLabel = (typeof AI_COST_LABELS)[number]

export const aiModelSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  connectionEnabled: z.boolean(),
  providerKey: z.string(),
  providerName: z.string().nullable(),
  providerModelId: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  kind: z.string(),
  origin: z.string(),
  contextWindow: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  capabilities: z.record(z.string(), capabilityClaimSchema).catch({}),
  qualityTier: z.string().nullable(),
  timeoutMs: z.number().nullable(),
  /** Voz para síntese de voz ("Voz do recado do avatar"): nome da voz do provider + instrução de tom opcional. */
  speech: z.object({ voice: z.string(), instructions: z.string().nullable() }).nullable().catch(null),
  isLocal: z.boolean(),
  lastSeenAt: z.string().nullable(),
  missingFromLastSync: z.boolean().catch(false),
  currentPricing: aiPricingSchema.nullable(),
  costLabel: z.enum(AI_COST_LABELS).catch("NOT_LOCAL"),
  usage30d: z.object({ requests: z.number(), errors: z.number(), costByCurrency: z.record(z.string(), z.string()) }),
  policies: z.array(z.object({ useCase: z.string(), status: z.string() })).catch([]),
})
export type AiModel = z.infer<typeof aiModelSchema>

export const modelTestResultSchema = z.object({
  status: z.enum(["OK", "ERROR"]),
  latencyMs: z.number(),
  message: z.string(),
  outputPreview: z.string().nullable(),
  usage: z.object({ inputTokens: z.number().nullable(), outputTokens: z.number().nullable(), totalTokens: z.number().nullable() }),
  cost: z.object({ status: z.string(), amount: z.string().nullable(), currency: z.string().nullable() }),
  testedAt: z.string(),
})
export type ModelTestResult = z.infer<typeof modelTestResultSchema>

export const policyIssueSchema = z.object({ code: z.string(), message: z.string(), modelId: z.string().optional() })
export type PolicyIssue = z.infer<typeof policyIssueSchema>

export const aiPolicySchema = z.object({
  id: z.string(),
  status: z.string(),
  mode: z.enum(AI_ROUTING_MODES),
  strategy: z.string().nullable(),
  fallbackOn: z.array(z.string()),
  maxEstimatedCostPerRequest: z.string().nullable(),
  costCurrency: z.string().nullable(),
  models: z.array(z.object({ modelId: z.string(), displayName: z.string().nullable(), providerModelId: z.string().nullable(), connectionName: z.string().nullable(), providerKey: z.string().nullable(), enabled: z.boolean(), available: z.boolean() })),
  issues: z.array(policyIssueSchema),
  valid: z.boolean(),
  version: z.number(),
  updatedAt: z.string(),
  activatedAt: z.string().nullable(),
})
export type AiPolicy = z.infer<typeof aiPolicySchema>

export const legacyRouteSchema = z.object({ providerKey: z.string(), model: z.string(), tier: z.string(), mode: z.string(), reason: z.string() }).nullable()
export type LegacyRoute = z.infer<typeof legacyRouteSchema>

export const useCaseRoutingSchema = z.object({
  useCase: aiUseCaseSchema,
  active: aiPolicySchema.nullable(),
  draft: aiPolicySchema.nullable(),
  effective: z.enum(["POLICY", "LEGACY"]),
  legacy: legacyRouteSchema,
})
export type UseCaseRouting = z.infer<typeof useCaseRoutingSchema>

export const routingTestResultSchema = z.object({
  useCase: z.string(),
  source: z.enum(["ACTIVE", "DRAFT", "LEGACY"]),
  selected: z.object({ modelId: z.string(), displayName: z.string(), providerModelId: z.string(), connectionName: z.string(), providerKey: z.string(), reason: z.string() }).nullable(),
  chain: z.array(
    z.object({
      position: z.number(),
      modelId: z.string(),
      displayName: z.string(),
      providerKey: z.string(),
      connectionName: z.string(),
      reason: z.string(),
      capabilities: z.array(z.string()),
      pricing: z.object({ currency: z.string(), inputPerMillion: z.string(), outputPerMillion: z.string() }).nullable(),
      recentLatencyMs: z.number().nullable(),
    }),
  ),
  skipped: z.array(z.object({ modelId: z.string(), displayName: z.string().nullable(), reason: z.string() })),
  notes: z.array(z.string()),
  requiredCapabilities: z.array(z.string()),
  fallbackOn: z.array(z.string()),
  legacy: legacyRouteSchema,
  budgetBlocked: z.boolean(),
})
export type RoutingTestResult = z.infer<typeof routingTestResultSchema>

export const budgetEvaluationSchema = z.object({
  budgetId: z.string(),
  status: z.enum(["OK", "WARNING", "EXCEEDED"]),
  spent: z.string(),
  limit: z.string(),
  currency: z.string(),
  percent: z.number().nullable(),
  reachedThresholds: z.array(z.number()),
  notComparableCurrencies: z.array(z.string()),
  unknownCostCalls: z.number(),
  hardLimitReached: z.boolean(),
})
export type BudgetEvaluation = z.infer<typeof budgetEvaluationSchema>

export const aiBudgetSchema = z.object({
  id: z.string(),
  scope: z.enum(AI_BUDGET_SCOPES),
  scopeKey: z.string().nullable(),
  scopeLabel: z.string(),
  currency: z.string(),
  monthlyAmount: z.string(),
  warningThresholds: z.array(z.number()),
  hardLimit: z.boolean(),
  enabled: z.boolean(),
  evaluation: budgetEvaluationSchema.nullable(),
})
export type AiBudget = z.infer<typeof aiBudgetSchema>

export const tokenTotalsSchema = z.object({
  input: z.number().nullable(),
  output: z.number().nullable(),
  reasoning: z.number().nullable(),
  cached: z.number().nullable(),
  total: z.number().nullable(),
  reported: z.object({ input: z.number(), output: z.number(), reasoning: z.number(), cached: z.number(), total: z.number() }),
})
export type TokenTotals = z.infer<typeof tokenTotalsSchema>

export const usageMetricsSchema = z.object({
  requests: z.number(),
  attempts: z.number(),
  errors: z.number(),
  blocked: z.number(),
  fallbacks: z.number(),
  tokens: tokenTotalsSchema,
  costByCurrency: z.record(z.string(), z.string()),
  unknownCostCalls: z.number(),
  localCalls: z.number(),
  latencyAvgMs: z.number().nullable(),
  latencyP50Ms: z.number().nullable(),
  latencyP95Ms: z.number().nullable(),
  errorRate: z.number().nullable(),
})
export type UsageMetrics = z.infer<typeof usageMetricsSchema>

export const breakdownRowSchema = usageMetricsSchema.extend({ key: z.string(), label: z.string(), secondary: z.string().nullable() })
export type BreakdownRow = z.infer<typeof breakdownRowSchema>

export const dailyPointSchema = z.object({ day: z.string(), requests: z.number(), tokens: z.number().nullable(), costByCurrency: z.record(z.string(), z.string()) })
export type DailyPoint = z.infer<typeof dailyPointSchema>

export const usageDashboardSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), label: z.string(), timezone: z.string() }),
  totals: usageMetricsSchema,
  daily: z.array(dailyPointSchema),
  byProvider: z.array(breakdownRowSchema),
  byModel: z.array(breakdownRowSchema),
  byUseCase: z.array(breakdownRowSchema),
  currencies: z.array(z.string()),
})
export type UsageDashboard = z.infer<typeof usageDashboardSchema>

export const connectionHealthSchema = z.object({
  connectionId: z.string(),
  name: z.string(),
  providerKey: z.string(),
  providerName: z.string().nullable(),
  enabled: z.boolean(),
  status: z.enum(["HEALTHY", "DEGRADED", "OFFLINE", "UNKNOWN"]),
  lastTest: z.object({ status: z.string(), checkedAt: z.string(), latencyMs: z.number().nullable(), message: z.string().nullable().optional() }).nullable(),
  lastSuccessAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastErrorCategory: z.string().nullable(),
  attempts24h: z.number(),
  errors24h: z.number(),
  recentLatencyMs: z.number().nullable(),
})
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>

export const legacyEnvironmentSchema = z.object({
  credentialConfigured: z.boolean(),
  routingMode: z.string(),
  profiles: z.array(z.object({ id: z.string(), providerKey: z.string(), model: z.string(), tier: z.string(), enabled: z.boolean() })),
  pricingConfigured: z.boolean(),
  profilesOverridden: z.boolean(),
})
export type LegacyEnvironment = z.infer<typeof legacyEnvironmentSchema>

export const aiOnboardingSchema = z.object({ hasConnection: z.boolean(), hasCredential: z.boolean(), hasTestedConnection: z.boolean(), hasModel: z.boolean(), hasActivePolicy: z.boolean() })
export type AiOnboarding = z.infer<typeof aiOnboardingSchema>

export const aiOverviewSchema = z.object({
  usage: usageDashboardSchema,
  health: z.array(connectionHealthSchema),
  budgets: z.array(aiBudgetSchema),
  counts: z.object({ connections: z.number(), activeConnections: z.number(), models: z.number(), activeModels: z.number(), activePolicies: z.number() }),
  onboarding: aiOnboardingSchema,
  legacy: legacyEnvironmentSchema,
})
export type AiOverview = z.infer<typeof aiOverviewSchema>

// ---------------------------------------------------------------------------------------------
// Regras de UI derivadas (espelho do backend — o backend revalida)
// ---------------------------------------------------------------------------------------------

/** Decimal não negativo em texto ("0", "2.5", "0.075"). */
export const DECIMAL_PATTERN = /^\d+(\.\d+)?$/
export const CURRENCY_PATTERN = /^[A-Z]{3}$/

export function supportsCapability(model: Pick<AiModel, "capabilities">, capability: string): boolean {
  return model.capabilities[capability]?.supported === true
}

/** Por que o modelo NÃO pode atender o Use Case — null = compatível (mesma ordem do backend). */
export function modelIncompatibility(model: AiModel, requiredCapabilities: readonly string[], requiresSpeechVoice = false): string | null {
  if (!model.connectionEnabled) return `Conexão "${model.connectionName}" desabilitada`
  if (!model.enabled) return "Modelo desabilitado"
  if (!ROUTABLE_MODEL_KINDS.includes(model.kind)) return `Modelo do tipo ${AI_MODEL_KIND_LABELS[model.kind] ?? model.kind} não atende requisições generativas`
  const missing = requiredCapabilities.filter((capability) => !supportsCapability(model, capability))
  if (missing.length > 0) return `Capacidade ausente ou não declarada: ${missing.map((capability) => AI_CAPABILITY_LABELS[capability as AiCapability] ?? capability).join(", ")}`
  if (requiresSpeechVoice && !model.speech) return "Voz não configurada no modelo (Modelos › Configurar)"
  return null
}
