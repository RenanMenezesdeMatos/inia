import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type PageResult } from "@/lib/admin/list-query"
import {
  creationPolicySchema,
  employmentStatusDetailSchema,
  personLinkResultSchema,
  userAccountSchema,
  userDetailSchema,
  type CreationPolicy,
  type EmploymentStatus,
  type EmploymentStatusDetail,
  type PersonLinkResult,
  type UserAccount,
  type UserDetail,
} from "@/schemas/admin/user-account.schema"
import { issuedTemporaryPasswordSchema, type IssuedTemporaryPassword } from "@/schemas/access/access.schema"
import type { PlatformRole } from "@/schemas/auth/auth.schema"

export async function fetchUserAccounts(): Promise<UserAccount[]> {
  return z.array(userAccountSchema).parse(await adminGet("/api/v1/admin/users"))
}

export type UserListParams = ListParams & {
  role: PlatformRole[]
  active?: boolean
  teamId?: string
  hasAccount?: boolean
  /** true = veio da base (tem matrícula); false = cadastrada à mão. */
  hasMatricula?: boolean
  lastLoginAt: DateRangeFilter
}

export async function fetchUserAccountsPage(params: UserListParams): Promise<PageResult<UserAccount>> {
  const { lastLoginAt, ...rest } = params
  return pageResultSchema(userAccountSchema).parse(
    await adminGet(`/api/v1/admin/users${toQueryString({ ...rest, lastLoginFrom: lastLoginAt.from, lastLoginTo: lastLoginAt.to })}`),
  )
}

/** Detalhe da pessoa: estrutura a que pertence e quem controla cada campo (base do cliente × INIA). */
export async function fetchUserDetail(personId: string): Promise<UserDetail> {
  return userDetailSchema.parse(await adminGet(`/api/v1/admin/users/${personId}`))
}

export async function fetchCreationPolicy(): Promise<CreationPolicy> {
  return creationPolicySchema.parse(await adminGet("/api/v1/admin/users/creation-policy"))
}

export type CreateUserInput = {
  name: string
  role: PlatformRole
  teamId?: string
  /** Matrícula como a base vai mandar: a carga atualiza esta pessoa em vez de criar outra. */
  matricula?: string
  email: string
}

const createdUserSchema = z.object({ id: z.string(), issued: issuedTemporaryPasswordSchema })

/** A senha provisória é gerada pelo servidor e volta UMA vez (ver TemporaryPasswordDialog) — nunca é escolhida aqui. */
export async function createUserAccount(input: CreateUserInput): Promise<IssuedTemporaryPassword> {
  return createdUserSchema.parse(await adminSend("/api/v1/admin/users", "POST", input)).issued
}

/** Só os campos enviados são alterados: o que vem da base do cliente fica de fora (o backend recusa com 422). `teamId: null` tira do Grupo. */
export type UpdateUserDetailsInput = {
  personId: string
  name?: string
  email?: string
  role?: PlatformRole
  teamId?: string | null
}

export async function updateUserDetails({ personId, ...fields }: UpdateUserDetailsInput): Promise<void> {
  await adminSend(`/api/v1/admin/users/${personId}`, "PATCH", Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)))
}

/** "Vincular à pessoa da base": a conta e os papéis da pessoa cadastrada à mão vão para a pessoa que veio da base. */
export async function linkUserToSourcePerson(personId: string, targetPersonId: string): Promise<PersonLinkResult> {
  return personLinkResultSchema.parse(await adminSend(`/api/v1/admin/users/${personId}/link`, "POST", { targetPersonId }))
}

export async function updateUserRole(personId: string, role: PlatformRole): Promise<void> {
  await adminSend(`/api/v1/admin/users/${personId}`, "PATCH", { role })
}

export async function updateUserActive(personId: string, active: boolean): Promise<void> {
  await adminSend(`/api/v1/admin/users/${personId}`, "PATCH", { active })
}


// Jornada PREVISTA (horário de entrada + carga horária) — evolução do Trigger "Por agenda"
// relativo ao expediente. Nunca telemetria de login real.
const workShiftSchema = z.object({ startTime: z.string(), workMinutes: z.number(), effectiveFrom: z.string() })
export type WorkShift = z.infer<typeof workShiftSchema>

export async function fetchUserShift(personId: string): Promise<WorkShift | null> {
  return workShiftSchema.nullable().parse(await adminGet(`/api/v1/admin/users/${personId}/shift`))
}

export type UpdateUserShiftInput = { personId: string; startTime: string; workMinutes: number }

export async function updateUserShift(input: UpdateUserShiftInput): Promise<void> {
  await adminSend(`/api/v1/admin/users/${input.personId}/shift`, "PUT", { startTime: input.startTime, workMinutes: input.workMinutes })
}

// Situação FUNCIONAL (Ativo/Férias/Afastado/Inativo) com histórico por período — a INIA consome
// esse dado da fonte de colaboradores; o ajuste manual existe pra registrar/corrigir (fonte MANUAL).
export async function fetchEmploymentStatus(personId: string): Promise<EmploymentStatusDetail> {
  return employmentStatusDetailSchema.parse(await adminGet(`/api/v1/admin/users/${personId}/employment-status`))
}

export type ApplyEmploymentStatusInput = { personId: string; status: EmploymentStatus; effectiveFrom?: string; effectiveTo?: string | null; note?: string }

export async function applyEmploymentStatus(input: ApplyEmploymentStatusInput): Promise<void> {
  await adminSend(`/api/v1/admin/users/${input.personId}/employment-status`, "POST", { status: input.status, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, note: input.note })
}

/** Capital operacional (jurisdição de feriados) — só códigos do catálogo das 27; null limpa. Não é endereço nem lotação. */
export async function updateUserOperationalCapital(personId: string, operationalCapitalCode: string | null): Promise<void> {
  await adminSend(`/api/v1/admin/users/${personId}`, "PATCH", { operationalCapitalCode })
}
