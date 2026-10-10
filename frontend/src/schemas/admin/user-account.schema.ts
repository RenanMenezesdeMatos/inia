import { z } from "zod"

import { platformRoleSchema, ROLE_LABELS } from "@/schemas/auth/auth.schema"
import { employmentStatusReadSchema, operationalCapitalViewSchema, workScheduleViewSchema } from "@/schemas/people/employment-status.schema"

export { ROLE_LABELS }

/** Situação FUNCIONAL (nove situações reais) — separada de `active` (conta/cadastro). Ver schemas/people/employment-status.schema.ts. */
export { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUSES, employmentStatusSchema, employmentStatusLabel, type EmploymentStatus } from "@/schemas/people/employment-status.schema"

export const employmentStatusPeriodSchema = z.object({
  id: z.string(),
  status: employmentStatusReadSchema,
  label: z.string(),
  rawStatus: z.string().nullable(),
  legacyStatus: z.string().nullable().default(null),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  effectiveFromInferred: z.boolean(),
  observedAt: z.string(),
  sourceUpdatedAt: z.string().nullable(),
  source: z.string(),
  sourceReference: z.string().nullable(),
})
export type EmploymentStatusPeriod = z.infer<typeof employmentStatusPeriodSchema>

export const employmentStatusDetailSchema = z.object({
  current: z.object({ status: employmentStatusReadSchema, label: z.string() }),
  history: z.array(employmentStatusPeriodSchema),
  schedule: workScheduleViewSchema.nullable().default(null),
  operationalCapital: operationalCapitalViewSchema.default(null),
})
export type EmploymentStatusDetail = z.infer<typeof employmentStatusDetailSchema>

export const userAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: platformRoleSchema,
  active: z.boolean(),
  employmentStatus: employmentStatusReadSchema.optional(),
  /** Capital operacional (jurisdição de feriados) — código do catálogo das 27 ou null. */
  operationalCapitalCode: z.string().nullable().optional(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  accountId: z.string().nullable(),
  email: z.string().nullable(),
  lastLoginAt: z.coerce.string().nullable(),
})
export type UserAccount = z.infer<typeof userAccountSchema>

