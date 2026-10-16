import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type ListParams, type PageResult } from "@/lib/admin/list-query"
import { glossaryTermSchema, prohibitedTopicSchema, type GlossaryTerm, type ProhibitedTopic } from "@/schemas/admin/governance.schema"

export async function fetchProhibitedTopics(): Promise<ProhibitedTopic[]> {
  return z.array(prohibitedTopicSchema).parse(await adminGet("/api/v1/admin/prohibited-topics"))
}

export type GovernanceListParams = ListParams & { active?: boolean }

export async function fetchProhibitedTopicsPage(params: GovernanceListParams): Promise<PageResult<ProhibitedTopic>> {
  return pageResultSchema(prohibitedTopicSchema).parse(await adminGet(`/api/v1/admin/prohibited-topics${toQueryString(params)}`))
}

export async function createProhibitedTopic(name: string, requiredBehavior: string): Promise<ProhibitedTopic> {
  return prohibitedTopicSchema.parse(await adminSend("/api/v1/admin/prohibited-topics", "POST", { name, requiredBehavior }))
}

export async function updateProhibitedTopic(id: string, name: string, requiredBehavior: string): Promise<ProhibitedTopic> {
  return prohibitedTopicSchema.parse(await adminSend(`/api/v1/admin/prohibited-topics/${id}`, "PATCH", { name, requiredBehavior }))
}

export async function fetchGlossaryTermsPage(params: GovernanceListParams): Promise<PageResult<GlossaryTerm>> {
  return pageResultSchema(glossaryTermSchema).parse(await adminGet(`/api/v1/admin/glossary${toQueryString(params)}`))
}

export async function createGlossaryTerm(term: string, definition: string, feedbackApplication: string): Promise<GlossaryTerm> {
  return glossaryTermSchema.parse(await adminSend("/api/v1/admin/glossary", "POST", { term, definition, feedbackApplication }))
}

export async function updateGlossaryTerm(id: string, term: string, definition: string, feedbackApplication: string): Promise<GlossaryTerm> {
  return glossaryTermSchema.parse(
    await adminSend(`/api/v1/admin/glossary/${id}`, "PATCH", { term, definition, feedbackApplication }),
  )
}

export async function setProhibitedTopicActive(id: string, active: boolean): Promise<void> {
  await adminSend(`/api/v1/admin/prohibited-topics/${id}`, "PATCH", { active })
}

export async function deleteProhibitedTopic(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/prohibited-topics/${id}`, "DELETE")
}

export async function setGlossaryTermActive(id: string, active: boolean): Promise<void> {
  await adminSend(`/api/v1/admin/glossary/${id}`, "PATCH", { active })
}

export async function deleteGlossaryTerm(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/glossary/${id}`, "DELETE")
}
