"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { fetchPersonOrganizationStructure } from "@/services/org-structure/person-structure-service"

export const personStructureKeys = {
  structure: (personId: string) => ["org-structure", "person", personId] as const,
}

/** Ao trocar a pessoa focal, a estrutura anterior fica na tela (placeholder) até a nova chegar — o organograma transiciona em vez de desmontar. */
export function usePersonStructureQuery(personId: string, enabled = true) {
  return useQuery({ queryKey: personStructureKeys.structure(personId), queryFn: () => fetchPersonOrganizationStructure(personId), enabled, placeholderData: keepPreviousData })
}
