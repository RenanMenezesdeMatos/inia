import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type ListParams, type OrgScopeFilter, type PageResult } from "@/lib/admin/list-query"
import {
  argumentScriptDetailSchema,
  argumentScriptSchema,
  argumentScriptScopeOptionsSchema,
  type ArgumentScript,
  type ArgumentScriptContentInput,
  type ArgumentScriptConversion,
  type ArgumentScriptDetail,
  type ArgumentScriptScopeOptions,
  type ArgumentScriptScopeType,
  type ArgumentScriptStatus,
} from "@/schemas/admin/argument-script.schema"

const BASE = "/api/v1/admin/argument-scripts"

export type ArgumentScriptListParams = ListParams &
  OrgScopeFilter & {
    status?: ArgumentScriptStatus
    businessDomainId?: string
    conversion?: ArgumentScriptConversion
    hasDraft?: boolean
  }

export async function fetchArgumentScriptsPage(params: ArgumentScriptListParams): Promise<PageResult<ArgumentScript>> {
  return pageResultSchema(argumentScriptSchema).parse(await adminGet(`${BASE}${toQueryString(params)}`))
}

export async function fetchArgumentScript(id: string): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminGet(`${BASE}/${id}`))
}

/** O que o usuário pode escolher como escopo: "Todos os grupos" só para quem administra a organização inteira. */
export async function fetchArgumentScriptScopeOptions(): Promise<ArgumentScriptScopeOptions> {
  return argumentScriptScopeOptionsSchema.parse(await adminGet(`${BASE}/scope-options`))
}

export type ArgumentScriptScopeInput = { scopeType: ArgumentScriptScopeType; teamId?: string; subteamId?: string }

export type CreateArgumentScriptInput = {
  name: string
  businessDomainId: string
  scope: ArgumentScriptScopeInput
  content?: ArgumentScriptContentInput
  sourceDocumentId?: string | null
  sourceReference?: string | null
}

export async function createArgumentScript(input: CreateArgumentScriptInput): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminSend(BASE, "POST", input))
}

/** Conteúdo e fonte sempre vão para o RASCUNHO (o servidor o cria a partir da versão vigente quando não existe). */
export type UpdateArgumentScriptInput = {
  name?: string
  businessDomainId?: string | null
  scope?: ArgumentScriptScopeInput
  content?: ArgumentScriptContentInput
  sourceDocumentId?: string | null
  sourceReference?: string | null
}

export async function updateArgumentScript(id: string, input: UpdateArgumentScriptInput): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminSend(`${BASE}/${id}`, "PATCH", input))
}

export async function discardArgumentScriptDraft(id: string): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminSend(`${BASE}/${id}/draft`, "DELETE"))
}

/** `effectiveFrom` ausente = agora. Pode ser no futuro, nunca no passado (422 ARGUMENT_SCRIPT_RETROACTIVE). */
export async function publishArgumentScript(id: string, input: { effectiveFrom?: string } = {}): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminSend(`${BASE}/${id}/publish`, "POST", input))
}

export async function archiveArgumentScript(id: string): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminSend(`${BASE}/${id}/archive`, "POST"))
}

export async function reactivateArgumentScript(id: string): Promise<ArgumentScriptDetail> {
  return argumentScriptDetailSchema.parse(await adminSend(`${BASE}/${id}/reactivate`, "POST"))
}

/** Só argumentário nunca publicado (409 caso contrário — o publicado é encerrado, nunca excluído). */
export async function deleteArgumentScript(id: string): Promise<void> {
  await adminSend(`${BASE}/${id}`, "DELETE")
}
