"use client"

import { useQuery } from "@tanstack/react-query"

import { useAdminMutation } from "@/lib/admin/use-admin-mutation"
import { adminQueryKeys } from "@/queries/admin/admin-query-keys"
import type { OperatingUniverse, UniverseResourceKind } from "@/schemas/operating-universe/operating-universe.schema"
import {
  classifyPeopleUniverse,
  classifyPendingPeopleOfTeam,
  classifyUniverseResource,
  fetchUniverseReadiness,
  fetchUniverseResources,
  setKnowledgeUniverse,
  setUniverseEnforcement,
} from "@/services/operating-universe/operating-universe-service"

/** Tudo de universo invalida a raiz do admin: o universo aparece em listas de várias áreas (pessoas, bases, Workflows, produtos…). */
const universeKey = () => [...adminQueryKeys.all, "operating-universe"] as const

export function useUniverseReadinessQuery(enabled = true) {
  return useQuery({ queryKey: [...universeKey(), "readiness"], queryFn: fetchUniverseReadiness, enabled })
}

export function useUniverseResourcesQuery(kind: UniverseResourceKind, status: "PENDING" | "CLASSIFIED" | "ALL", search?: string) {
  return useQuery({ queryKey: [...universeKey(), "resources", kind, status, search ?? ""], queryFn: () => fetchUniverseResources(kind, status, search) })
}

export function useClassifyResourceMutation() {
  return useAdminMutation({
    mutationFn: ({ kind, id, operatingUniverse }: { kind: UniverseResourceKind; id: string; operatingUniverse: OperatingUniverse | null }) => classifyUniverseResource(kind, id, operatingUniverse),
    invalidateKey: adminQueryKeys.all,
    successMessage: "Universo de atuação salvo.",
  })
}

export function useClassifyPeopleMutation() {
  return useAdminMutation({
    mutationFn: ({ personIds, operatingUniverse }: { personIds: string[]; operatingUniverse: OperatingUniverse }) => classifyPeopleUniverse(personIds, operatingUniverse),
    invalidateKey: adminQueryKeys.all,
  })
}

export function useClassifyPendingTeamMutation() {
  return useAdminMutation({
    mutationFn: ({ teamId, operatingUniverse }: { teamId: string | null; operatingUniverse: OperatingUniverse }) => classifyPendingPeopleOfTeam(teamId, operatingUniverse),
    invalidateKey: adminQueryKeys.all,
  })
}

export function useUniverseEnforcementMutation() {
  return useAdminMutation({
    mutationFn: ({ enforce, acknowledgedPending }: { enforce: boolean; acknowledgedPending?: number }) => setUniverseEnforcement(enforce, acknowledgedPending),
    invalidateKey: adminQueryKeys.all,
  })
}

export function useSetKnowledgeUniverseMutation() {
  return useAdminMutation({
    mutationFn: ({ id, operatingUniverse }: { id: string; operatingUniverse: OperatingUniverse | null }) => setKnowledgeUniverse(id, operatingUniverse),
    invalidateKey: adminQueryKeys.knowledge(),
    // O erro (vínculos de outro universo a resolver) aparece no próprio formulário.
    silentErrors: true,
  })
}
