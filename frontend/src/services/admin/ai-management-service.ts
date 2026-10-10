import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import {
  aiBudgetSchema,
  aiConnectionSchema,
  aiMeSchema,
  aiModelSchema,
  aiOverviewSchema,
  aiPricingSchema,
  aiProviderSchema,
  aiUseCaseSchema,
  connectionTestResultSchema,
  modelTestResultSchema,
  routingTestResultSchema,
  syncReportSchema,
  useCaseRoutingSchema,
  type AiBudget,
  type AiConnection,
  type AiModel,
  type AiOverview,
  type AiPermission,
  type AiPricing,
  type AiProvider,
  type AiUsagePeriod,
  type AiUseCase,
  type ConnectionTestResult,
  type ModelTestResult,
  type RoutingTestResult,
  type SyncReport,
  type UseCaseRouting,
} from "@/schemas/admin/ai-management.schema"

const BASE = "/api/v1/admin/ai"

export async function fetchAiPermissions(): Promise<AiPermission[]> {
  return aiMeSchema.parse(await adminGet(`${BASE}/me`)).permissions as AiPermission[]
}

export async function fetchAiProviders(): Promise<AiProvider[]> {
  return z.array(aiProviderSchema).parse(await adminGet(`${BASE}/providers`))
}

export async function fetchAiUseCases(): Promise<AiUseCase[]> {
  return z.array(aiUseCaseSchema).parse(await adminGet(`${BASE}/use-cases`))
}

// ---------------------------------------------------------------- Visão geral / uso

export type AiUsageParams = { period: AiUsagePeriod; from?: string; to?: string; providerKey?: string; modelId?: string; useCase?: string }

export function usageQueryString(params: AiUsageParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return query ? `?${query}` : ""
}

export async function fetchAiOverview(params: AiUsageParams): Promise<AiOverview> {
  return aiOverviewSchema.parse(await adminGet(`${BASE}/overview${usageQueryString(params)}`))
}

// ---------------------------------------------------------------- Conexões

export async function fetchAiConnections(): Promise<AiConnection[]> {
  return z.array(aiConnectionSchema).parse(await adminGet(`${BASE}/connections`))
}

export type CreateAiConnectionInput = {
  providerKey: string
  name: string
  baseUrl?: string | null
  isLocal?: boolean
  timeoutMs?: number
  apiKey?: string | null
  customHeaders?: Record<string, string> | null
}

export async function createAiConnection(input: CreateAiConnectionInput): Promise<AiConnection> {
  return aiConnectionSchema.parse(await adminSend(`${BASE}/connections`, "POST", input))
}

export type UpdateAiConnectionInput = { id: string; name?: string; baseUrl?: string | null; isLocal?: boolean; timeoutMs?: number; enabled?: boolean }

export async function updateAiConnection({ id, ...input }: UpdateAiConnectionInput): Promise<AiConnection> {
  return aiConnectionSchema.parse(await adminSend(`${BASE}/connections/${id}`, "PATCH", input))
}

export async function deleteAiConnection(id: string): Promise<void> {
  await adminSend(`${BASE}/connections/${id}`, "DELETE")
}

/** Escrita-apenas: o valor vai, nunca volta (a resposta traz só a máscara). */
export async function replaceAiConnectionSecret({ id, apiKey }: { id: string; apiKey: string }): Promise<AiConnection> {
  return aiConnectionSchema.parse(await adminSend(`${BASE}/connections/${id}/secret`, "PUT", { apiKey }))
}

export async function removeAiConnectionSecret(id: string): Promise<AiConnection> {
  return aiConnectionSchema.parse(await adminSend(`${BASE}/connections/${id}/secret`, "DELETE"))
}

export async function replaceAiConnectionHeaders({ id, customHeaders }: { id: string; customHeaders: Record<string, string> }): Promise<AiConnection> {
  return aiConnectionSchema.parse(await adminSend(`${BASE}/connections/${id}/headers`, "PUT", { customHeaders }))
}

export async function testAiConnection(id: string): Promise<ConnectionTestResult> {
  return connectionTestResultSchema.parse(await adminSend(`${BASE}/connections/${id}/test`, "POST"))
}

export async function syncAiConnectionModels(id: string): Promise<SyncReport> {
  return syncReportSchema.parse(await adminSend(`${BASE}/connections/${id}/sync-models`, "POST"))
}

// ---------------------------------------------------------------- Modelos e preços

export async function fetchAiModels(connectionId?: string): Promise<AiModel[]> {
  return z.array(aiModelSchema).parse(await adminGet(`${BASE}/models${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ""}`))
}

type CapabilitiesInput = Partial<Record<string, { supported: boolean }>>

export type CreateAiModelInput = {
  connectionId: string
  providerModelId: string
  displayName?: string
  kind?: string
  contextWindow?: number | null
  maxOutputTokens?: number | null
  capabilities?: CapabilitiesInput
  qualityTier?: string | null
  timeoutMs?: number | null
}

export async function createAiModel(input: CreateAiModelInput): Promise<AiModel> {
  return aiModelSchema.parse(await adminSend(`${BASE}/models`, "POST", input))
}

export type UpdateAiModelInput = {
  id: string
  displayName?: string
  enabled?: boolean
  contextWindow?: number | null
  maxOutputTokens?: number | null
  capabilities?: CapabilitiesInput
  qualityTier?: string | null
  timeoutMs?: number | null
  speech?: { voice: string; instructions: string | null } | null
  acknowledgeActivePolicyImpact?: boolean
}

export async function updateAiModel({ id, ...input }: UpdateAiModelInput): Promise<AiModel> {
  return aiModelSchema.parse(await adminSend(`${BASE}/models/${id}`, "PATCH", input))
}

export async function deleteAiModel(id: string): Promise<void> {
  await adminSend(`${BASE}/models/${id}`, "DELETE")
}

/** UMA requisição mínima real ao provider — pode gerar custo (a UI avisa antes). */
export async function testAiModel(id: string): Promise<ModelTestResult> {
  return modelTestResultSchema.parse(await adminSend(`${BASE}/models/${id}/test`, "POST"))
}

export async function fetchAiModelPricing(id: string): Promise<AiPricing[]> {
  return z.array(aiPricingSchema).parse(await adminGet(`${BASE}/models/${id}/pricing`))
}

export type AddAiPricingInput = {
  modelId: string
  currency: string
  inputPerMillion: string
  outputPerMillion: string
  cachedInputPerMillion?: string | null
  reasoningPerMillion?: string | null
  effectiveFrom?: string
  note?: string | null
}

export async function addAiModelPricing({ modelId, ...input }: AddAiPricingInput): Promise<AiPricing[]> {
  return z.array(aiPricingSchema).parse(await adminSend(`${BASE}/models/${modelId}/pricing`, "POST", input))
}

// ---------------------------------------------------------------- Roteamento

export async function fetchAiRouting(): Promise<UseCaseRouting[]> {
  return z.array(useCaseRoutingSchema).parse(await adminGet(`${BASE}/routing`))
}

export type SaveAiRoutingDraftInput = {
  useCase: string
  mode: string
  strategy?: string | null
  modelIds: string[]
  fallbackOn?: string[]
  maxEstimatedCostPerRequest?: string | null
  costCurrency?: string | null
}

export async function saveAiRoutingDraft({ useCase, ...input }: SaveAiRoutingDraftInput): Promise<UseCaseRouting> {
  return useCaseRoutingSchema.parse(await adminSend(`${BASE}/routing/${useCase}/draft`, "PUT", input))
}

export async function discardAiRoutingDraft(useCase: string): Promise<UseCaseRouting> {
  return useCaseRoutingSchema.parse(await adminSend(`${BASE}/routing/${useCase}/draft`, "DELETE"))
}

export async function activateAiRoutingDraft(useCase: string): Promise<UseCaseRouting> {
  return useCaseRoutingSchema.parse(await adminSend(`${BASE}/routing/${useCase}/activate`, "POST"))
}

export async function deactivateAiRoutingPolicy(useCase: string): Promise<UseCaseRouting> {
  return useCaseRoutingSchema.parse(await adminSend(`${BASE}/routing/${useCase}/deactivate`, "POST"))
}

/** Plano de rota SEM chamada ao provider. */
export async function testAiRouting({ useCase, source }: { useCase: string; source?: "ACTIVE" | "DRAFT" }): Promise<RoutingTestResult> {
  return routingTestResultSchema.parse(await adminSend(`${BASE}/routing/${useCase}/test`, "POST", source ? { source } : {}))
}

// ---------------------------------------------------------------- Orçamentos

export async function fetchAiBudgets(): Promise<AiBudget[]> {
  return z.array(aiBudgetSchema).parse(await adminGet(`${BASE}/budgets`))
}

export type AiBudgetInput = { scope: string; scopeKey?: string | null; currency: string; monthlyAmount: string; warningThresholds?: number[]; hardLimit?: boolean; enabled?: boolean }

export async function createAiBudget(input: AiBudgetInput): Promise<AiBudget[]> {
  return z.array(aiBudgetSchema).parse(await adminSend(`${BASE}/budgets`, "POST", input))
}

export async function updateAiBudget({ id, ...input }: AiBudgetInput & { id: string }): Promise<AiBudget[]> {
  return z.array(aiBudgetSchema).parse(await adminSend(`${BASE}/budgets/${id}`, "PUT", input))
}

export async function deleteAiBudget(id: string): Promise<AiBudget[]> {
  return z.array(aiBudgetSchema).parse(await adminSend(`${BASE}/budgets/${id}`, "DELETE"))
}
