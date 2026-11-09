import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type ListParams, type OrgScopeFilter, type PageResult } from "@/lib/admin/list-query"
import {
  indicatorCatalogSchema,
  indicatorCorrectionImpactSchema,
  indicatorDependenciesSchema,
  type IndicatorCatalog,
  type IndicatorCorrectionFields,
  type IndicatorCorrectionImpact,
  type IndicatorDependencies,
  type IndicatorUnit,
  type OperationalAggregationKind,
} from "@/schemas/admin/indicator-definition.schema"
import { indicatorWithRulesSchema, type CalculationPeriod, type DesiredDirection, type IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"

export async function fetchIndicatorsWithRules(): Promise<IndicatorWithRules[]> {
  return z.array(indicatorWithRulesSchema).parse(await adminGet("/api/v1/admin/indicator-rules"))
}

export type IndicatorListParams = ListParams &
  OrgScopeFilter & {
    desiredDirection: DesiredDirection[]
    active?: boolean
    hasGlossary?: boolean
    dailySupported?: boolean
    calculationPeriod: CalculationPeriod[]
  }

export async function fetchIndicatorsWithRulesPage(params: IndicatorListParams): Promise<PageResult<IndicatorWithRules>> {
  return pageResultSchema(indicatorWithRulesSchema).parse(await adminGet(`/api/v1/admin/indicator-rules${toQueryString(params)}`))
}

/** Mesmo contrato do serviço do backend (`indicator-definition-service.ts`): a metadata completa. */
export type IndicatorDefinitionInput = {
  code: string
  name: string
  unit: IndicatorUnit
  desiredDirection: DesiredDirection
  dailySupported: boolean
  operationalAggregation: OperationalAggregationKind
  minimumSampleSize: number | null
  minimumCoverage: number | null
  officialClosureSupported: boolean
  provesWorkActivity: boolean
  unjustifiedAbsencePolicy: "NO_SAMPLE" | "ZERO_CONTRIBUTION"
  availabilityPolicy: { lagDays: number; availableByLocalTime: string } | null
  iconKey: string | null
}

export async function createIndicatorDefinition(input: IndicatorDefinitionInput): Promise<{ id: string }> {
  return adminSend("/api/v1/admin/indicator-rules/definitions", "POST", input)
}

export type UpdateIndicatorDefinitionInput = { id: string } & Partial<IndicatorDefinitionInput>

export async function updateIndicatorDefinition({ id, ...patch }: UpdateIndicatorDefinitionInput): Promise<{ id: string }> {
  return adminSend(`/api/v1/admin/indicator-rules/definitions/${id}`, "PATCH", patch)
}

export async function fetchIndicatorCatalog(): Promise<IndicatorCatalog> {
  return indicatorCatalogSchema.parse(await adminGet("/api/v1/admin/indicator-rules/catalog"))
}

export async function fetchIndicatorDependencies(id: string): Promise<IndicatorDependencies> {
  return indicatorDependenciesSchema.parse(await adminGet(`/api/v1/admin/indicator-rules/definitions/${id}/dependencies`))
}

export async function previewIndicatorCorrection(id: string, fields: IndicatorCorrectionFields): Promise<IndicatorCorrectionImpact> {
  return indicatorCorrectionImpactSchema.parse(await adminSend(`/api/v1/admin/indicator-rules/definitions/${id}/correction/preview`, "POST", fields))
}

export type ApplyIndicatorCorrectionInput = { id: string; fields: IndicatorCorrectionFields; reason: string; confirmation: string }

export async function applyIndicatorCorrection({ id, fields, reason, confirmation }: ApplyIndicatorCorrectionInput): Promise<void> {
  await adminSend(`/api/v1/admin/indicator-rules/definitions/${id}/correction`, "POST", { ...fields, reason, confirmation })
}

export async function setIndicatorDefinitionActive(id: string, active: boolean): Promise<void> {
  await adminSend(`/api/v1/admin/indicator-rules/definitions/${id}`, "PATCH", { active })
}

export async function deleteIndicatorDefinition(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/indicator-rules/definitions/${id}`, "DELETE")
}

export type SaveIndicatorRuleInput = {
  indicatorDefinitionId: string
  orgScope: OrgScopeValue
  calculationPeriod: string
  calculationMethod: string
  attainmentRule?: string
}

export async function saveIndicatorRule(input: SaveIndicatorRuleInput) {
  return adminSend("/api/v1/admin/indicator-rules", "POST", {
    indicatorDefinitionId: input.indicatorDefinitionId,
    scopeType: input.orgScope.scopeType,
    teamId: input.orgScope.teamId,
    subteamId: input.orgScope.subteamId,
    calculationPeriod: input.calculationPeriod,
    calculationMethod: input.calculationMethod,
    attainmentRule: input.attainmentRule,
  })
}

export async function setIndicatorRuleActive(ruleId: string, active: boolean): Promise<void> {
  await adminSend(`/api/v1/admin/indicator-rules/${ruleId}`, "PATCH", { active })
}

export async function deleteIndicatorRule(ruleId: string): Promise<void> {
  await adminSend(`/api/v1/admin/indicator-rules/${ruleId}`, "DELETE")
}

export type SaveIndicatorGlossaryInput = {
  indicatorDefinitionId: string
  description: string
  interpretation: string
  goodPractices: string
  feedbackGuidance: string
}

export async function saveIndicatorGlossary(input: SaveIndicatorGlossaryInput): Promise<void> {
  await adminSend("/api/v1/admin/indicator-rules/glossary", "PUT", input)
}
