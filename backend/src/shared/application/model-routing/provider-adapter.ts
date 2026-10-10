import type { LlmCacheRecord, LlmUsage } from "../llm-telemetry.js"
import type { ModelProfile, ModelProvider } from "./model-profile.js"
import type { RouteDecision } from "./route-policy.js"

/**
 * ADAPTER DE PROVEDOR — a única fronteira que conhece a API concreta. Uma request é o mesmo
 * contrato para qualquer provedor: prompt de sistema, turnos, ferramentas (function calling),
 * saída estruturada, e a decisão de rota (modelo concreto + telemetria).
 */
export type AdapterTurn =
  | { role: "user" | "model"; text: string }
  | { role: "model"; functionCalls: { name: string; args: Record<string, unknown>; id?: string; thoughtSignature?: string }[] }
  | { role: "user"; functionResponses: { name: string; response: Record<string, unknown> }[] }

export type AdapterFunctionDeclaration = { name: string; description: string; parameters: Record<string, unknown> }

export type AdapterRequest = {
  systemPrompt: string
  contents: AdapterTurn[]
  tools: AdapterFunctionDeclaration[]
  structuredOutput: boolean
  route: RouteDecision
  /** V1.3 (§23–26): o prefixo (prompt de sistema + tools) é ESTÁTICO e seguro para cache
   * compartilhado do provider — sem dado de colaborador/organização dinâmico. `cacheKeyVersion`
   * é o hash dos componentes estáticos (invalidação automática ao mudar o prompt). Ausente ou
   * `cacheable: false` = nunca cache explícito. */
  cache?: { cacheable: boolean; cacheKeyVersion: string } | undefined
  /** V1.5.1: transporte explícito por chamada (ausente = o padrão do cliente: 30 s e 1 retry em 503). O Feedback Writer do
   * piloto pede `retries: 0` — quem decide o que fazer com a falha é o pipeline, nunca o transporte. */
  transport?: { timeoutMs?: number; retries?: number } | undefined
  /** V1.7.1d: schema da saída estruturada (subconjunto OpenAPI aceito pelo provedor) — ausente = só o modo JSON. Quem não
   * suporta ignora (o parser de quem chamou continua sendo a validação de verdade). */
  responseSchema?: Record<string, unknown> | undefined
  /** Teto de tokens de SAÍDA (inclui raciocínio no Gemini). Ausente = o padrão do provedor. Quem chama define pelo uso normal
   * da etapa — protege contra resposta degenerada (repetição até o limite do modelo). */
  maxOutputTokens?: number | undefined
}

export type AdapterResponse = ({ kind: "text"; text: string } | { kind: "functionCalls"; calls: { name: string; args: Record<string, unknown>; id?: string; thoughtSignature?: string }[] }) & {
  usage: LlmUsage
  durationMs: number
  model: string
  provider: ModelProvider
  /** V1.7.1d: motivo de término informado pelo provedor (ex.: STOP, MAX_TOKENS) — null/ausente = não informado. */
  finishReason?: string | null
  /** Cache de prompt como o adapter o usou/observou nesta request (V1.3). */
  cache?: LlmCacheRecord & { /** Tokens gastos para CRIAR o cache nesta request (cobrados como entrada) — 0 quando reaproveitado. */ createdTokens?: number }
}

export interface ProviderAdapter {
  readonly provider: ModelProvider
  generate(request: AdapterRequest): Promise<AdapterResponse>
}

const adapters = new Map<ModelProvider, ProviderAdapter>()

export function registerProviderAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.provider, adapter)
}

export function providerAdapterFor(profile: ModelProfile): ProviderAdapter {
  const adapter = adapters.get(profile.provider)
  if (!adapter) throw new Error(`Provedor ${profile.provider} não tem adapter registrado neste ambiente.`)
  return adapter
}

export function hasProviderAdapter(provider: ModelProvider): boolean {
  return adapters.has(provider)
}
