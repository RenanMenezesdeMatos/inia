import { z } from "zod"

import { adminGet, adminGetWithMeta, adminSend } from "@/lib/admin/admin-api"
import {
  universeUnitSchema,
  type UniverseUnit,
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

const universeResourceListMetaSchema = z.object({ truncated: z.boolean(), limit: z.number().int().positive() }).nullable().catch(null)

/** Lista para classificar: o servidor corta no limite (já no escopo de quem administra) e avisa em `truncated`. */
export async function fetchUniverseResources(kind: UniverseResourceKind, status: "PENDING" | "CLASSIFIED" | "ALL" = "ALL", search?: string): Promise<{ items: UniverseResource[]; truncated: boolean; limit: number | null }> {
  const query = new URLSearchParams({ status, ...(search ? { search } : {}) })
  const { data, meta } = await adminGetWithMeta<unknown>(`${BASE}/resources/${kind}?${query.toString()}`)
  const parsedMeta = universeResourceListMetaSchema.parse(meta)
  return { items: z.array(universeResourceSchema).parse(data), truncated: parsedMeta?.truncated ?? false, limit: parsedMeta?.limit ?? null }
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

/** Grupos e Subgrupos com o universo declarado (a fonte normal do universo dos operadores). */
export async function fetchUniverseUnits(): Promise<UniverseUnit[]> {
  return z.array(universeUnitSchema).parse(await adminGet(`${BASE}/units`))
}

export async function classifyUniverseUnit(kind: UniverseUnit["kind"], id: string, operatingUniverse: OperatingUniverse | null, effectiveFrom?: string | null): Promise<void> {
  await adminSend(`${BASE}/units/${kind}/${id}`, "PUT", { operatingUniverse, effectiveFrom: effectiveFrom ?? null })
}

export async function setUniverseEnforcement(enforce: boolean, acknowledgedPending?: number): Promise<void> {
  await adminSend(`${BASE}/enforcement`, "PUT", { enforce, ...(acknowledgedPending !== undefined ? { acknowledgedPending } : {}) })
}

/** Universo da base de conhecimento: classificação direta (vale na hora), auditada; recusa com a lista se criar vínculo entre universos. */
export async function setKnowledgeUniverse(id: string, operatingUniverse: OperatingUniverse | null): Promise<void> {
  await adminSend(`/api/v1/admin/knowledge/${id}/operating-universe`, "PUT", { operatingUniverse })
}
