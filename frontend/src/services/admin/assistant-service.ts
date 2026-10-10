import type { OrchestratorPolicyKind, RoutingPolicyKind } from "@/schemas/admin/orchestrator-policy"
import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult } from "@/lib/admin/list-query"
import { orchestratorSchema, type Orchestrator, type OrchestratorInvocationMode } from "@/schemas/admin/assistant.schema"
import type { OutputSchema } from "@/schemas/admin/output-schema-fields"
import { structuredOutputUsageSchema, type StructuredOutputDefinition, type StructuredOutputUsage } from "@/schemas/admin/structured-output"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"

export async function fetchOrchestrators(): Promise<Orchestrator[]> {
  return z.array(orchestratorSchema).parse(await adminGet("/api/v1/admin/assistant-orchestrators"))
}

export type OrchestratorListParams = ListParams &
  OrgScopeFilter & {
    active?: boolean
    invocationMode: OrchestratorInvocationMode[]
    orchestratorAgentId?: string
    specialistAgentId?: string
    createdAt: DateRangeFilter
  }

export async function fetchOrchestratorsPage(params: OrchestratorListParams): Promise<PageResult<Orchestrator>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(orchestratorSchema).parse(
    await adminGet(`/api/v1/admin/assistant-orchestrators${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`),
  )
}

export async function fetchOrchestrator(id: string): Promise<Orchestrator> {
  return orchestratorSchema.parse(await adminGet(`/api/v1/admin/assistant-orchestrators/${id}`))
}

export type OrchestratorInput = {
  name: string
  orgScope: OrgScopeValue
  orchestratorAgentId: string
  specialistAgentIds: string[]
  invocationMode: OrchestratorInvocationMode
  /** Legado — só enviado quando `structuredOutput` está ausente (chamadas antigas). */
  outputInstructions?: string | null
  outputSchema?: OutputSchema | null
  /** Fonte única do resultado estruturado: definição (o backend gera contrato + metadado) ou null (só texto). */
  structuredOutput?: StructuredOutputDefinition | null
  /** Confirma uma mudança breaking que afeta Workflows em rascunho (409 STRUCTURED_OUTPUT_IN_USE_DRAFT). */
  acknowledgeStructuredOutputImpacts?: boolean
  /** Forma alvo (057/060). Quando presente, prevalece sobre a legada no backend; domínios por ID do catálogo. */
  routingPolicy?: RoutingPolicyKind | null
  routingDomainIds?: string[]
  /** Códigos de referências ainda sem id no catálogo (legado) — opcional. */
  routingDomains?: string[]
  recommendSupportMaterials?: boolean
  /** Legado (053) — mantido para compatibilidade de chamadas antigas (códigos). */
  policyKind?: OrchestratorPolicyKind | null
  policyDomains?: string[]
}

function structuredOutputPayload(input: OrchestratorInput) {
  if (input.structuredOutput !== undefined) {
    return { structuredOutput: input.structuredOutput, ...(input.acknowledgeStructuredOutputImpacts ? { acknowledgeStructuredOutputImpacts: true } : {}) }
  }
  return { outputInstructions: input.outputInstructions ?? null, outputSchema: input.outputSchema ?? null }
}

function policyPayload(input: OrchestratorInput) {
  if (input.routingPolicy !== undefined) {
    return { routingPolicy: input.routingPolicy, routingDomainIds: input.routingPolicy === "DOMAINS" ? (input.routingDomainIds ?? []) : [], ...(input.routingPolicy === "DOMAINS" && input.routingDomains?.length ? { routingDomains: input.routingDomains } : {}) }
  }
  return { policyKind: input.policyKind ?? null, policyDomains: input.policyDomains ?? [] }
}

export async function createOrchestrator(input: OrchestratorInput): Promise<Orchestrator> {
  return orchestratorSchema.parse(
    await adminSend("/api/v1/admin/assistant-orchestrators", "POST", {
      name: input.name,
      scopeType: input.orgScope.scopeType,
      teamId: input.orgScope.teamId,
      subteamId: input.orgScope.subteamId,
      orchestratorAgentId: input.orchestratorAgentId,
      specialistAgentIds: input.specialistAgentIds,
      invocationMode: input.invocationMode,
      recommendSupportMaterials: input.recommendSupportMaterials ?? false,
      ...structuredOutputPayload(input),
      ...policyPayload(input),
    }),
  )
}

export async function updateOrchestrator(id: string, input: OrchestratorInput): Promise<Orchestrator> {
  return orchestratorSchema.parse(
    await adminSend(`/api/v1/admin/assistant-orchestrators/${id}`, "PATCH", {
      name: input.name,
      scopeType: input.orgScope.scopeType,
      teamId: input.orgScope.teamId,
      subteamId: input.orgScope.subteamId,
      orchestratorAgentId: input.orchestratorAgentId,
      specialistAgentIds: input.specialistAgentIds,
      invocationMode: input.invocationMode,
      recommendSupportMaterials: input.recommendSupportMaterials ?? false,
      ...structuredOutputPayload(input),
      ...policyPayload(input),
    }),
  )
}

export async function updateOrchestratorActive(id: string, active: boolean): Promise<Orchestrator> {
  return orchestratorSchema.parse(await adminSend(`/api/v1/admin/assistant-orchestrators/${id}`, "PATCH", { active }))
}

export async function deleteOrchestrator(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/assistant-orchestrators/${id}`, "DELETE")
}

/** Onde cada path do resultado estruturado é usado em Workflows (rascunho/publicado). */
export async function fetchStructuredOutputUsage(id: string): Promise<StructuredOutputUsage[]> {
  return z.array(structuredOutputUsageSchema).parse(await adminGet(`/api/v1/admin/assistant-orchestrators/${id}/structured-output-usage`))
}
