"use client"

import { useMemo } from "react"

import { useCompetenciesQuery, useEditorCatalogQuery, useInterventionTypesQuery } from "@/queries/admin/use-intervention-policy-queries"
import { ESCALATION_ROLE_LABELS, RESPONSIBLE_ROLE_LABELS, type PolicyAction, type PolicyConditionGroup, type PolicyRule } from "@/schemas/admin/intervention-policy.schema"

import { describeWhen } from "./describe-condition"

/**
 * A REGRA EM FRASE — "Quando ‹situação›, a INIA ‹faz o quê, para quem›" — com os nomes do catálogo (indicadores, tipos,
 * competências). Usada no resumo da política e no cabeçalho de cada regra do editor: é o mesmo texto nos dois lugares.
 */
export function usePolicyDescriber(policyIndicatorCode: string | null) {
  const typesQuery = useInterventionTypesQuery()
  const catalogQuery = useEditorCatalogQuery()
  const competenciesQuery = useCompetenciesQuery()
  return useMemo(() => {
    const types = new Map((typesQuery.data ?? []).map((type) => [type.key, type]))
    const indicators = new Map((catalogQuery.data?.indicators ?? []).map((indicator) => [indicator.code, indicator.name]))
    const competencies = new Map((competenciesQuery.data ?? []).map((competency) => [competency.key, competency.name]))
    const definitionOf = (key: string) => types.get(key)?.published?.definition ?? types.get(key)?.draft?.definition
    const typeName = (key: string) => definitionOf(key)?.name ?? key
    const indicatorName = (code: string) => indicators.get(code) ?? code

    const when = (group: PolicyConditionGroup) => describeWhen(group, { policyIndicatorCode, indicatorName, typeName, competencyName: (key) => competencies.get(key) ?? key })

    const action = (item: PolicyAction): string => {
      const definition = types.get(item.typeKey)?.published?.definition
      const name = `“${typeName(item.typeKey)}”`
      if (!definition) return name
      if (definition.capabilities.includes("CONTINUITY_REVIEW")) return `sugere ${name} — a decisão é de uma pessoa autorizada, nunca da INIA`
      const responsible = RESPONSIBLE_ROLE_LABELS[definition.responsibleRole].toLowerCase()
      if (item.effect === "NOTIFY") return `só avisa o ${responsible} sobre ${name}, sem criar a ação`
      const approval = definition.approval.required ? `, com aprovação de ${ESCALATION_ROLE_LABELS[definition.approval.approverRole].toLowerCase()}` : ""
      const script = definition.script.length > 0 ? `, já com ${definition.script.length} ${definition.script.length === 1 ? "passo" : "passos"} do roteiro` : ""
      return item.effect === "RECOMMEND" ? `sugere ${name} ao ${responsible}, que aceita ou descarta${approval}${script}` : `abre ${name} para o ${responsible}${approval}${script}`
    }

    const actions = (items: PolicyAction[]) => items.map(action).join("; e ")
    /** "Quando ‹…›, a INIA ‹…›." — a regra inteira numa frase. */
    const rule = (item: Pick<PolicyRule, "when" | "actions">) => `Quando ${when(item.when)}, a INIA ${item.actions.length > 0 ? actions(item.actions) : "ainda não tem ação definida"}.`
    return { when, action, actions, rule, indicatorName }
  }, [typesQuery.data, catalogQuery.data, competenciesQuery.data, policyIndicatorCode])
}
