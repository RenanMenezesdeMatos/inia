import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type PageResult } from "@/lib/admin/list-query"
import { userAccountSchema, type UserAccount, employmentStatusDetailSchema, type EmploymentStatus, type EmploymentStatusDetail } from "@/schemas/admin/user-account.schema"
import type { PlatformRole } from "@/schemas/auth/auth.schema"

export async function fetchUserAccounts(): Promise<UserAccount[]> {
  return z.array(userAccountSchema).parse(await adminGet("/api/v1/admin/users"))
}

export type UserListParams = ListParams & {
  role: PlatformRole[]
  active?: boolean
  teamId?: string
  hasAccount?: boolean
  lastLoginAt: DateRangeFilter
}

export async function fetchUserAccountsPage(params: UserListParams): Promise<PageResult<UserAccount>> {
  const { lastLoginAt, ...rest } = params
  return pageResultSchema(userAccountSchema).parse(
    await adminGet(`/api/v1/admin/users${toQueryString({ ...rest, lastLoginFrom: lastLoginAt.from, lastLoginTo: lastLoginAt.to })}`),
  )
}

export type CreateUserInput = {
  name: string
  role: PlatformRole
  teamId?: string
  email: string
  password: string
}

export async function createUserAccount(input: CreateUserInput): Promise<void> {
  await adminSend("/api/v1/admin/users", "POST", input)
}

export type UpdateUserDetailsInput = {
  personId: string
  name: string
  email: string
  role: PlatformRole
  teamId?: string
}

export async function updateUserDetails(input: UpdateUserDetailsInput): Promise<void> {
  await adminSend(`/api/v1/admin/users/${input.personId}`, "PATCH", {
    name: input.name,
    email: input.email,
    role: input.role,
    teamId: input.teamId ?? null,
  })
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
