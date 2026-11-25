import { z } from "zod"

import { adminGet, adminGetBlob, adminSend } from "@/lib/admin/admin-api"
import { toQueryString } from "@/lib/admin/list-query"
import { accessAccountSchema, accessRoleSchema, enabledAccessSchema, identifiedUserPageSchema, issuedTemporaryPasswordSchema, networkEnableReportSchema, networkLoginCheckSchema, scopeOptionsSchema, type AccessStatus, type AssignRoleInput } from "@/schemas/access/access.schema"

const BASE = "/api/v1/admin/access"

export type IdentifiedUsersParams = { search?: string | undefined; status?: AccessStatus | undefined; networkIssue?: boolean | undefined; teamId?: readonly string[] | undefined; subteamId?: readonly string[] | undefined; page: number; pageSize: number }
export const fetchIdentifiedUsers = async (params: IdentifiedUsersParams) => identifiedUserPageSchema.parse(await adminGet(`${BASE}/users${toQueryString(params)}`))
export const fetchAccessAccount = async (accountId: string) => accessAccountSchema.parse(await adminGet(`${BASE}/accounts/${encodeURIComponent(accountId)}`))
export const fetchAccessRoles = async () => z.array(accessRoleSchema).parse(await adminGet(`${BASE}/roles`))
export const fetchScopeOptions = async () => scopeOptionsSchema.parse(await adminGet(`${BASE}/scope-options`))
/** Habilita o acesso (cria a conta se preciso): pela rede não há senha; no login local, a senha temporária vem UMA vez. */
export const enableUserAccess = async (personId: string, email?: string) => enabledAccessSchema.parse(await adminSend(`${BASE}/users/${encodeURIComponent(personId)}/enable`, "POST", email ? { email } : {}))
/** Nova senha temporária: a anterior deixa de valer, a troca volta a ser obrigatória e as sessões da pessoa caem. */
export const issueTemporaryPassword = async (accountId: string) => issuedTemporaryPasswordSchema.parse(await adminSend(`${BASE}/accounts/${encodeURIComponent(accountId)}/temporary-password`, "POST"))
/** Modelo CSV para habilitar em massa pela rede (o backend é dono do formato). */
export const downloadNetworkEnableTemplate = () => adminGetBlob(`${BASE}/users/network-enable/template`)
/** Confere o CSV sem gravar nada. */
export const previewNetworkEnable = async (contentBase64: string) => networkEnableReportSchema.parse(await adminSend(`${BASE}/users/network-enable/preview`, "POST", { contentBase64 }))
/** Habilita as linhas que podem (reavaliadas no servidor). */
export const applyNetworkEnable = async (contentBase64: string) => networkEnableReportSchema.parse(await adminSend(`${BASE}/users/network-enable`, "POST", { contentBase64 }))
export const checkNetworkLogin = async (matricula: string) => networkLoginCheckSchema.parse(await adminSend(`${BASE}/network-login-check`, "POST", { matricula }))
/** Desabilita o acesso: ninguém entra e as sessões abertas caem (papéis ficam registrados). */
export const disableUserAccess = (accountId: string) => adminSend<{ personId: string; accountId: string }>(`${BASE}/accounts/${encodeURIComponent(accountId)}/disable`, "POST")
export const assignAccessRole = (accountId: string, input: AssignRoleInput) => adminSend<{ id: string }>(`${BASE}/accounts/${encodeURIComponent(accountId)}/roles`, "POST", input)
export const revokeAccessRole = (accountId: string, assignmentId: string, reason?: string) => adminSend<void>(`${BASE}/accounts/${encodeURIComponent(accountId)}/roles/${encodeURIComponent(assignmentId)}`, "DELETE", reason ? { reason } : {})

