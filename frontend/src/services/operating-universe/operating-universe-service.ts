import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import {
  classifyPeopleResultSchema,
  universeReadinessSchema,
  universeResourceSchema,
  type ClassifyPeopleResult,
  type OperatingUniverse,
  type UniverseReadiness,
  type UniverseResource,
  type UniverseResourceKind,
} from "@/schemas/operating-universe/operating-universe.schema"

const BASE = "/api/v1/admin/operating-universe"

export async function fetchUniverseReadiness(): Promise<UniverseReadiness> {
  return universeReadinessSchema.parse(await adminGet(`${BASE}/readiness`))
}

export async function fetchUniverseResources(kind: UniverseResourceKind, status: "PENDING" | "CLASSIFIED" | "ALL" = "ALL", search?: string): Promise<UniverseResource[]> {
  const query = new URLSearchParams({ status, ...(search ? { search } : {}) })
  return z.array(universeResourceSchema).parse(await adminGet(`${BASE}/resources/${kind}?${query.toString()}`))
}

export async function classifyUniverseResource(kind: UniverseResourceKind, id: string, operatingUniverse: OperatingUniverse | null): Promise<void> {
  await adminSend(`${BASE}/resources/${kind}/${id}`, "PUT", { operatingUniverse })
}

export async function classifyPeopleUniverse(personIds: string[], operatingUniverse: OperatingUniverse): Promise<ClassifyPeopleResult> {
  return classifyPeopleResultSchema.parse(await adminSend(`${BASE}/people/classify`, "POST", { personIds, operatingUniverse }))
}

/** Regularização em lote: todas as pessoas ATIVAS e PENDENTES de um Grupo (null = sem Grupo), no escopo de quem pede. */
export async function classifyPendingPeopleOfTeam(teamId: string | null, operatingUniverse: OperatingUniverse): Promise<ClassifyPeopleResult> {
  return classifyPeopleResultSchema.parse(await adminSend(`${BASE}/people/classify`, "POST", { pendingInTeamId: teamId, operatingUniverse }))
}

export async function setUniverseEnforcement(enforce: boolean, acknowledgedPending?: number): Promise<void> {
  await adminSend(`${BASE}/enforcement`, "PUT", { enforce, ...(acknowledgedPending !== undefined ? { acknowledgedPending } : {}) })
}

/** Universo da base de conhecimento: classificação direta (vale na hora), auditada; recusa com a lista se criar vínculo entre universos. */
export async function setKnowledgeUniverse(id: string, operatingUniverse: OperatingUniverse | null): Promise<void> {
  await adminSend(`/api/v1/admin/knowledge/${id}/operating-universe`, "PUT", { operatingUniverse })
}
