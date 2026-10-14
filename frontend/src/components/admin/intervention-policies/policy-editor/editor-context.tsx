"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

import { useIndicatorCatalog } from "@/components/admin/workflows/indicator-select"
import { useCapabilityCatalogQuery, useCompetenciesQuery, useEditorCatalogQuery, useInterventionTypesQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { CapabilityCatalog, CompetencyView, InterventionTypeDefinition, InterventionTypeView } from "@/schemas/admin/intervention-policy.schema"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

import { interventionTypeName, typeTraits, type TypeTraits } from "../shared/helpers"
import type { ConditionContext, FlagOption } from "./defaults"

/**
 * O que as partes do editor de política precisam saber do mundo (tipos publicados, competências, catálogo de capacidades,
 * indicadores) e se estão só leitura. Montado UMA vez no editor; cada parte lê daqui em vez de receber dezenas de props.
 */
export type PublishedTypeOption = { key: string; name: string; active: boolean; definition: InterventionTypeDefinition; traits: TypeTraits | null }

export type PolicyEditorContextValue = {
  readOnly: boolean
  /** Tipos e catálogo de capacidades carregados (ou com erro): só então uma regra nova nasce com a ação padrão certa. */
  catalogsReady: boolean
  policyIndicatorCode: string | null
  types: InterventionTypeView[]
  publishedTypes: PublishedTypeOption[]
  typeLabel: (key: string) => string
  competencies: CompetencyView[]
  catalog: CapabilityCatalog | undefined
  indicatorByCode: Map<string, IndicatorWithRules>
  /** Catálogo de flags por canal (ativas e inativas — uma referência antiga continua visível). */
  flags: (FlagOption & { description: string | null; active: boolean })[]
  /** Valores iniciais de uma condição nova (indicador da política, primeira flag ativa). */
  conditionContext: ConditionContext
}

const PolicyEditorContext = createContext<PolicyEditorContextValue | null>(null)

export function PolicyEditorProvider({ readOnly, policyIndicatorCode, children }: { readOnly: boolean; policyIndicatorCode: string | null; children: ReactNode }) {
  const typesQuery = useInterventionTypesQuery()
  const competenciesQuery = useCompetenciesQuery()
  const catalogQuery = useCapabilityCatalogQuery()
  const { byCode } = useIndicatorCatalog()
  const editorCatalogQuery = useEditorCatalogQuery()
  const value = useMemo<PolicyEditorContextValue>(() => {
    const types = typesQuery.data ?? []
    const publishedTypes = types.filter((type) => type.published).map((type) => ({ key: type.key, name: type.published!.definition.name, active: type.active, definition: type.published!.definition, traits: typeTraits(type.published!.definition, catalogQuery.data) }))
    const byKey = new Map(types.map((type) => [type.key, type]))
    return {
      readOnly,
      catalogsReady: !typesQuery.isPending && !catalogQuery.isPending,
      policyIndicatorCode,
      types,
      publishedTypes,
      typeLabel: (key) => (byKey.has(key) ? interventionTypeName(byKey.get(key)!) : key),
      competencies: competenciesQuery.data ?? [],
      catalog: catalogQuery.data,
      indicatorByCode: byCode,
      flags: editorCatalogQuery.data?.flags ?? [],
      conditionContext: { policyIndicatorCode, indicator: policyIndicatorCode ? byCode.get(policyIndicatorCode) : undefined, flag: editorCatalogQuery.data?.flags.find((flag) => flag.active) },
    }
  }, [readOnly, policyIndicatorCode, typesQuery.data, typesQuery.isPending, competenciesQuery.data, catalogQuery.data, catalogQuery.isPending, byCode, editorCatalogQuery.data])
  return <PolicyEditorContext.Provider value={value}>{children}</PolicyEditorContext.Provider>
}

export function usePolicyEditor(): PolicyEditorContextValue {
  const value = useContext(PolicyEditorContext)
  if (!value) throw new Error("usePolicyEditor fora do PolicyEditorProvider")
  return value
}
