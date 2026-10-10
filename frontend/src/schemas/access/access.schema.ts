import { z } from "zod"

/** Espelho de backend/src/modules/access (V1.5.7): contas de acesso × papéis × escopos. Cargo é só dado informativo. */
export const scopeTypeSchema = z.enum(["ORGANIZATION", "GROUP", "SUBGROUP", "MY_STRUCTURE"])
export type ScopeType = z.infer<typeof scopeTypeSchema>
export const SCOPE_TYPE_LABELS: Record<ScopeType, string> = { ORGANIZATION: "Toda a organização", GROUP: "Grupo", SUBGROUP: "Subgrupo", MY_STRUCTURE: "Estrutura da pessoa (quem está abaixo dela)" }

const named = z.object({ id: z.string(), name: z.string() })
export const accountRoleSchema = z.object({ id: z.string(), roleCode: z.string(), roleName: z.string(), scopeLabel: z.string(), scope: z.object({ type: scopeTypeSchema }).passthrough(), grantedAt: z.string(), grantedByName: z.string().nullable() })
export type AccountRole = z.infer<typeof accountRoleSchema>
export const accessAccountSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  active: z.boolean(),
  lastLoginAt: z.string().nullable(),
  collaborator: z.object({ personId: z.string(), name: z.string(), jobTitle: z.string().nullable(), level: z.string(), active: z.boolean(), team: named.nullable(), subteam: named.nullable() }),
  roles: z.array(accountRoleSchema),
})
export type AccessAccount = z.infer<typeof accessAccountSchema>
export const accessAccountPageSchema = z.object({ items: z.array(accessAccountSchema), total: z.number(), page: z.number(), pageSize: z.number() })
export type AccessAccountPage = z.infer<typeof accessAccountPageSchema>

export const accessRoleSchema = z.object({ code: z.string(), name: z.string(), description: z.string(), system: z.boolean(), allowedScopes: z.array(scopeTypeSchema), permissions: z.array(z.object({ code: z.string(), label: z.string() })), assignableByYou: z.boolean() })
export type AccessRole = z.infer<typeof accessRoleSchema>
export const scopeOptionsSchema = z.object({ organizationWide: z.boolean(), teams: z.array(named), subteams: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string(), teamName: z.string() })) })
export type ScopeOptions = z.infer<typeof scopeOptionsSchema>

/**
 * Liberação de acesso: pessoas JÁ identificadas pela plataforma × situação do acesso (derivada no backend). Desabilitado = sem
 * conta de login ou conta desabilitada; aguardando troca = senha temporária ainda não substituída; ativo = senha da pessoa.
 */
export const accessStatusSchema = z.enum(["DISABLED", "PENDING_PASSWORD_CHANGE", "ACTIVE"])
export type AccessStatus = z.infer<typeof accessStatusSchema>
export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = { DISABLED: "Desabilitado", PENDING_PASSWORD_CHANGE: "Aguardando troca de senha", ACTIVE: "Ativo" }
export const identifiedUserSchema = z.object({
  personId: z.string(),
  name: z.string(),
  matricula: z.string().nullable(),
  jobTitle: z.string().nullable(),
  level: z.string(),
  personActive: z.boolean(),
  team: named.nullable(),
  subteam: named.nullable(),
  self: z.boolean(),
  accessStatus: accessStatusSchema,
  temporaryPasswordExpired: z.boolean(),
  account: z.object({
    accountId: z.string(),
    email: z.string(),
    active: z.boolean(),
    lastLoginAt: z.string().nullable(),
    passwordChangeRequired: z.boolean(),
    temporaryPasswordIssuedAt: z.string().nullable(),
    temporaryPasswordExpiresAt: z.string().nullable(),
    accessDisabledAt: z.string().nullable(),
    roles: z.array(z.object({ code: z.string(), name: z.string() })),
  }).nullable(),
})
export type IdentifiedUser = z.infer<typeof identifiedUserSchema>
export const identifiedUserPageSchema = z.object({ items: z.array(identifiedUserSchema), total: z.number(), page: z.number(), pageSize: z.number(), temporaryPasswordTtlHours: z.number() })
export type IdentifiedUserPage = z.infer<typeof identifiedUserPageSchema>
/** Resposta de habilitar / gerar senha: a senha temporária vem SÓ aqui, uma vez (nunca guardada no cache da tela). */
export const issuedTemporaryPasswordSchema = z.object({ personId: z.string(), accountId: z.string(), name: z.string(), email: z.string(), temporaryPassword: z.string(), expiresAt: z.string() })
export type IssuedTemporaryPassword = z.infer<typeof issuedTemporaryPasswordSchema>
export type AssignRoleInput = { roleCode: string; scope: { type: ScopeType; teamId?: string | null; subteamId?: string | null } }
