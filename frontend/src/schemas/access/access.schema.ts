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
/** O que a conta alcança ao conceder papéis (os Grupos e Subgrupos em si vêm em lotes de `/admin/scope-units`). */
export const scopeOptionsSchema = z.object({ organizationWide: z.boolean(), hasGroups: z.boolean(), hasSubgroups: z.boolean() })
export type ScopeOptions = z.infer<typeof scopeOptionsSchema>

/**
 * Liberação de acesso: pessoas JÁ identificadas pela plataforma × situação do acesso (derivada no backend). Desabilitado = sem
 * conta de login ou conta desabilitada; aguardando troca = senha temporária ainda não substituída; ativo = senha da pessoa.
 */
export const accessStatusSchema = z.enum(["DISABLED", "PENDING_PASSWORD_CHANGE", "ACTIVE"])
export type AccessStatus = z.infer<typeof accessStatusSchema>
export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = { DISABLED: "Desabilitado", PENDING_PASSWORD_CHANGE: "Aguardando troca de senha", ACTIVE: "Ativo" }
/** O que impede a pessoa de entrar pela matrícula, do lado do cadastro (espelho de backend access/domain/network-access.ts). */
export const networkAccessIssueSchema = z.enum(["PERSON_INACTIVE", "MATRICULA_MISSING", "MATRICULA_INVALID", "MATRICULA_DUPLICATED"])
export type NetworkAccessIssue = z.infer<typeof networkAccessIssueSchema>
/** Por que a última tentativa pela rede deu nisso (espelho de backend auth/domain/login-attempt.ts). */
export const loginAttemptReasonSchema = z.enum(["NO_ACCOUNT", "BAD_FORMAT", "NETWORK_INVALID", "NETWORK_PASSWORD_EXPIRED", "NETWORK_ACCOUNT_LOCKED", "NETWORK_ACCOUNT_DISABLED", "NETWORK_UNAVAILABLE", "NETWORK_NO_ANSWER", "NETWORK_IDENTITY_MISMATCH", "NETWORK_IDENTITY_UNREADABLE", "INIA_ACCESS_DISABLED", "PERSON_INACTIVE", "THROTTLED"])
export type LoginAttemptReason = z.infer<typeof loginAttemptReasonSchema>
/** Situação do login pela rede: trava temporária da INIA e última resposta. Só vem para quem gerencia acessos. */
export const networkAttemptsSchema = z.object({
  lockedUntil: z.string().nullable(),
  last: z.object({ at: z.string(), outcome: z.enum(["SUCCEEDED", "INVALID_CREDENTIALS", "ACCESS_DISABLED", "TEMPORARY_PASSWORD_EXPIRED", "LOCKED"]), reason: loginAttemptReasonSchema.nullable(), directoryCode: z.string().nullable() }).nullable(),
})
export type NetworkAttempts = z.infer<typeof networkAttemptsSchema>
/** Qual login a pessoa usa (espelho de backend access/domain/network-access.ts). `directoryLogins` só vem para quem gerencia acessos. */
export const loginGuideSchema = z.object({ kind: z.enum(["NETWORK", "EMAIL"]), typed: z.string(), directoryLogins: z.array(z.string()), proven: z.boolean() })
export type LoginGuide = z.infer<typeof loginGuideSchema>
export const accessDisabledReasonSchema = z.enum(["PERSON_DEACTIVATED", "PERSON_DEACTIVATED_BY_SOURCE", "LINKED_BY_SOURCE_NEW_PLACEMENT"])
export type AccessDisabledReason = z.infer<typeof accessDisabledReasonSchema>

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
  /** "Nova senha temporária" só para conta habilitada com senha da INIA; com o login pela rede, a senha é do AD. */
  canIssueTemporaryPassword: z.boolean(),
  /** Habilitar esta pessoa abre a entrada pela rede (NETWORK, sem senha) ou gera senha temporária (LOCAL). */
  enableCredential: z.enum(["LOCAL", "NETWORK"]),
  networkIssue: networkAccessIssueSchema.nullable(),
  loginGuide: loginGuideSchema.nullable(),
  networkAttempts: networkAttemptsSchema.nullable(),
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
    /** Quem gerencia a senha: LOCAL = senha da INIA; NETWORK = Active Directory (login pela rede, conta que não é de emergência). */
    credentialProvider: z.enum(["LOCAL", "NETWORK"]),
    disabledReason: accessDisabledReasonSchema.nullable(),
  }).nullable(),
})
export type IdentifiedUser = z.infer<typeof identifiedUserSchema>
export const identifiedUserPageSchema = z.object({ items: z.array(identifiedUserSchema), total: z.number(), page: z.number(), pageSize: z.number(), temporaryPasswordTtlHours: z.number(), networkLoginEnabled: z.boolean() })
export type IdentifiedUserPage = z.infer<typeof identifiedUserPageSchema>
/** Resposta de habilitar / gerar senha: a senha temporária vem SÓ aqui, uma vez (nunca guardada no cache da tela). */
export const issuedTemporaryPasswordSchema = z.object({ personId: z.string(), accountId: z.string(), name: z.string(), email: z.string(), temporaryPassword: z.string(), expiresAt: z.string() })
export type IssuedTemporaryPassword = z.infer<typeof issuedTemporaryPasswordSchema>
/** Habilitar devolve uma senha temporária (login local) ou nada a entregar (login pela rede: a senha é a do AD). */
export const enabledAccessSchema = z.discriminatedUnion("credential", [
  z.object({ credential: z.literal("NETWORK"), personId: z.string(), accountId: z.string(), name: z.string(), matricula: z.string() }),
  issuedTemporaryPasswordSchema.extend({ credential: z.literal("TEMPORARY_PASSWORD") }),
])
export type EnabledAccess = z.infer<typeof enabledAccessSchema>

/** Habilitar em massa pela rede (CSV): o que cada linha faz (prévia) ou fez (aplicação). */
export const networkEnableOutcomeSchema = z.enum(["CREATE", "REENABLE", "ALREADY_ENABLED", "REFUSED"])
export type NetworkEnableOutcome = z.infer<typeof networkEnableOutcomeSchema>
export const networkEnableRefusalSchema = z.enum(["MATRICULA_REQUIRED", "MATRICULA_INVALID", "DUPLICATE_IN_FILE", "PERSON_NOT_FOUND", "MATRICULA_DUPLICATED", "PERSON_INACTIVE", "SELF_CREDENTIAL", "TARGET_MORE_PRIVILEGED", "TARGET_LEADS_OUTSIDE_SCOPE", "EMERGENCY_ACCOUNT", "EMAIL_INVALID", "EMAIL_REQUIRED", "EMAIL_IN_USE", "CONCURRENT_CHANGE"])
export type NetworkEnableRefusal = z.infer<typeof networkEnableRefusalSchema>
export const networkEnableRowSchema = z.object({ line: z.number(), matricula: z.string(), name: z.string().nullable(), login: z.string().nullable(), outcome: networkEnableOutcomeSchema, refusal: networkEnableRefusalSchema.nullable(), similar: z.array(z.string()), emailIgnored: z.boolean() })
export type NetworkEnableRow = z.infer<typeof networkEnableRowSchema>
export const networkEnableReportSchema = z.object({ rows: z.array(networkEnableRowSchema), counts: z.record(networkEnableOutcomeSchema, z.number()), ignoredColumns: z.array(z.string()) })
export type NetworkEnableReport = z.infer<typeof networkEnableReportSchema>

/** "Por que esta pessoa não entra?" — conferência pela matrícula digitada, sem senha e sem consultar o AD. */
export const networkLoginCheckSchema = z.object({ networkLogin: z.string().nullable(), networkLoginEnabled: z.boolean(), people: z.array(identifiedUserSchema), similar: z.array(z.string()), attempts: networkAttemptsSchema.nullable() })
export type NetworkLoginCheck = z.infer<typeof networkLoginCheckSchema>
export type AssignRoleInput = { roleCode: string; scope: { type: ScopeType; teamId?: string | null; subteamId?: string | null } }
