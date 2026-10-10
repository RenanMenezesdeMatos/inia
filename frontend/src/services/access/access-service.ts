import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { toQueryString } from "@/lib/admin/list-query"
import { accessAccountSchema, accessRoleSchema, identifiedUserPageSchema, issuedTemporaryPasswordSchema, scopeOptionsSchema, type AccessStatus, type AssignRoleInput } from "@/schemas/access/access.schema"

const BASE = "/api/v1/admin/access"

export const fetchIdentifiedUsers = async (params: { search?: string | undefined; status?: AccessStatus | undefined; page: number; pageSize: number }) => identifiedUserPageSchema.parse(await adminGet(`${BASE}/users${toQueryString(params)}`))
export const fetchAccessAccount = async (accountId: string) => accessAccountSchema.parse(await adminGet(`${BASE}/accounts/${encodeURIComponent(accountId)}`))
export const fetchAccessRoles = async () => z.array(accessRoleSchema).parse(await adminGet(`${BASE}/roles`))
export const fetchScopeOptions = async () => scopeOptionsSchema.parse(await adminGet(`${BASE}/scope-options`))
/** Habilita o acesso de uma pessoa identificada (cria a conta de login se preciso) e devolve a senha temporária UMA vez. */
export const enableUserAccess = async (personId: string, email?: string) => issuedTemporaryPasswordSchema.parse(await adminSend(`${BASE}/users/${encodeURIComponent(personId)}/enable`, "POST", email ? { email } : {}))
/** Nova senha temporária: a anterior deixa de valer, a troca volta a ser obrigatória e as sessões da pessoa caem. */
export const issueTemporaryPassword = async (accountId: string) => issuedTemporaryPasswordSchema.parse(await adminSend(`${BASE}/accounts/${encodeURIComponent(accountId)}/temporary-password`, "POST"))
/** Desabilita o acesso: ninguém entra e as sessões abertas caem (papéis ficam registrados). */
export const disableUserAccess = (accountId: string) => adminSend<{ personId: string; accountId: string }>(`${BASE}/accounts/${encodeURIComponent(accountId)}/disable`, "POST")
export const assignAccessRole = (accountId: string, input: AssignRoleInput) => adminSend<{ id: string }>(`${BASE}/accounts/${encodeURIComponent(accountId)}/roles`, "POST", input)
export const revokeAccessRole = (accountId: string, assignmentId: string, reason?: string) => adminSend<void>(`${BASE}/accounts/${encodeURIComponent(accountId)}/roles/${encodeURIComponent(assignmentId)}`, "DELETE", reason ? { reason } : {})

/** "Conceder aos gestores": o papel com escopo "Minha estrutura" para cada conta de quem lidera alguém no seu alcance (auditado, idempotente). */
export async function grantRoleToLeaders(roleCode: string): Promise<{ leaders: number; granted: number; alreadyAssigned: number; skipped: number }> {
  return adminSend(`/api/v1/admin/access/roles/${roleCode}/grant-to-leaders`, "POST")
}
