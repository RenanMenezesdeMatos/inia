import { z } from "zod"
import { adminGet, adminSend } from "@/lib/admin/admin-api"
import {
  auditEntrySchema,
  capabilityCatalogSchema,
  competencyViewSchema,
  editorCatalogSchema,
  evaluationListItemSchema,
  interventionTypeViewSchema,
  patternOptionSchema,
  policyViewSchema,
  publishedPolicySummarySchema,
  simulationResultSchema,
  validationResultSchema,
  type CompetencyInput,
  type InterventionTypeDefinition,
  type PolicyDefinition,
} from "@/schemas/admin/intervention-policy.schema"

const BASE = "/api/v1/admin/intervention-policies"

export const fetchCapabilityCatalog = async () => capabilityCatalogSchema.parse(await adminGet<unknown>(`${BASE}/capabilities`))
export const fetchEditorCatalog = async () => editorCatalogSchema.parse(await adminGet<unknown>(`${BASE}/editor-catalog`))
export const searchPatternOptions = async (params: { search?: string; keys?: string[] }) => {
  const query = new URLSearchParams()
  if (params.search?.trim()) query.set("search", params.search.trim())
  if (params.keys?.length) query.set("keys", params.keys.join(","))
  return z.array(patternOptionSchema).parse(await adminGet<unknown>(`${BASE}/editor-catalog/patterns?${query.toString()}`))
}

export const fetchInterventionTypes = async () => z.array(interventionTypeViewSchema).parse(await adminGet<unknown>(`${BASE}/types`))
export const createInterventionType = async (input: { key: string; definition: InterventionTypeDefinition }) => interventionTypeViewSchema.parse(await adminSend<unknown>(`${BASE}/types`, "POST", input))
export const saveInterventionTypeDraft = async (id: string, definition: InterventionTypeDefinition) => interventionTypeViewSchema.parse(await adminSend<unknown>(`${BASE}/types/${id}/draft`, "PUT", { definition }))
export const validateInterventionType = async (id: string) => validationResultSchema.parse(await adminSend<unknown>(`${BASE}/types/${id}/validate`, "POST"))
export const publishInterventionType = async (id: string) => interventionTypeViewSchema.parse(await adminSend<unknown>(`${BASE}/types/${id}/publish`, "POST"))
export const discardInterventionTypeDraft = async (id: string) => interventionTypeViewSchema.parse(await adminSend<unknown>(`${BASE}/types/${id}/draft`, "DELETE"))
export const setInterventionTypeActive = async (id: string, active: boolean) => interventionTypeViewSchema.parse(await adminSend<unknown>(`${BASE}/types/${id}/active`, "POST", { active }))

export const fetchCompetencies = async () => z.array(competencyViewSchema).parse(await adminGet<unknown>(`${BASE}/competencies`))
export const createCompetency = async (input: CompetencyInput) => competencyViewSchema.parse(await adminSend<unknown>(`${BASE}/competencies`, "POST", input))
export const updateCompetency = async (id: string, input: CompetencyInput) => competencyViewSchema.parse(await adminSend<unknown>(`${BASE}/competencies/${id}`, "PUT", input))
export const setCompetencyActive = async (id: string, active: boolean) => competencyViewSchema.parse(await adminSend<unknown>(`${BASE}/competencies/${id}/active`, "POST", { active }))

export const fetchPolicies = async () => z.array(policyViewSchema).parse(await adminGet<unknown>(`${BASE}/policies`))
export const fetchPolicy = async (id: string) => policyViewSchema.parse(await adminGet<unknown>(`${BASE}/policies/${id}`))
/** Cria o cabeçalho + rascunho v1; a tela abre a política pelo id devolvido (o detalhe traz o que o viewer pode fazer). */
export const createPolicy = async (input: { key: string; name: string; scopeType: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId: string | null; subteamId: string | null }) => z.object({ id: z.string() }).parse(await adminSend<unknown>(`${BASE}/policies`, "POST", input))
/** Nome muda sempre; o escopo só enquanto não houver versão publicada (409 INTERVENTION_POLICY_SCOPE_LOCKED depois). */
export const updatePolicyHeader = async (id: string, input: { name: string; scopeType?: "ORGANIZATION" | "GROUP" | "SUBGROUP"; teamId?: string | null; subteamId?: string | null }) => adminSend<unknown>(`${BASE}/policies/${id}`, "PATCH", input)
export const savePolicyDraft = async (id: string, definition: PolicyDefinition) => adminSend<unknown>(`${BASE}/policies/${id}/draft`, "PUT", { definition })
export const validatePolicy = async (id: string) => validationResultSchema.parse(await adminSend<unknown>(`${BASE}/policies/${id}/validate`, "POST"))
export const publishPolicy = async (id: string, effectiveFrom: string | null) => adminSend<unknown>(`${BASE}/policies/${id}/publish`, "POST", { effectiveFrom })
export const discardPolicyDraft = async (id: string) => adminSend<unknown>(`${BASE}/policies/${id}/draft`, "DELETE")
export const setPolicyActive = async (id: string, active: boolean) => adminSend<unknown>(`${BASE}/policies/${id}/active`, "POST", { active })

export const fetchPublishedPolicySummaries = async () => z.array(publishedPolicySummarySchema).parse(await adminGet<unknown>(`${BASE}/published-summary`))
export const searchSimulationPeople = async (search: string) => z.array(z.object({ id: z.string(), name: z.string(), teamName: z.string().nullable() })).parse(await adminGet<unknown>(`${BASE}/simulation-people?search=${encodeURIComponent(search)}`))
export const simulatePolicy = async (id: string, input: { personId: string; asOf: string | null; version: "DRAFT" | "IN_FORCE" | string; mode: "RECOMMEND_ONLY" | "APPLY_POLICY" }) => simulationResultSchema.parse(await adminSend<unknown>(`${BASE}/policies/${id}/simulate`, "POST", input))

export const fetchPolicyAudit = async (entityId?: string) => z.array(auditEntrySchema).parse(await adminGet<unknown>(`${BASE}/audit${entityId ? `?entityId=${entityId}` : ""}`))
export const fetchPolicyEvaluations = async (id: string) => z.array(evaluationListItemSchema).parse(await adminGet<unknown>(`${BASE}/policies/${id}/evaluations`))
export const reevaluate = async (evaluationId: string, reason: string) => adminSend<unknown>(`${BASE}/evaluations/${evaluationId}/reevaluate`, "POST", { reason })
