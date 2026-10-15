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

/**
 * Quem controla cada campo da pessoa (espelho de backend/src/modules/data-hub/domain/person-field-control.ts): a fonte e o
 * conjunto de dados da Central que mandam no campo, ou null — editável na INIA. Campo da base é só leitura aqui; acesso
 * (papéis com escopo) é sempre só da INIA e não aparece nesta lista.
 */
export const sourceManagerSchema = z.object({ sourceName: z.string(), feedName: z.string() })
export type SourceManager = z.infer<typeof sourceManagerSchema>
const managedByField = sourceManagerSchema.nullable().default(null)
export const personManagedBySchema = z.object({
  name: managedByField,
  role: managedByField,
  jobTitle: managedByField,
  teamId: managedByField,
  subteamId: managedByField,
  managerId: managedByField,
  hiredAt: managedByField,
  active: managedByField,
  email: managedByField,
  operationalCapitalCode: managedByField,
})
export type PersonManagedBy = z.infer<typeof personManagedBySchema>
export type PersonSourceField = keyof PersonManagedBy

export const userAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: platformRoleSchema,
  /** Matrícula da base do cliente; null = cadastrada à mão na INIA. */
  matricula: z.string().nullable().default(null),
  active: z.boolean(),
  employmentStatus: employmentStatusReadSchema.optional(),
  /** Capital operacional (jurisdição de feriados) — código do catálogo das 27 ou null. */
  operationalCapitalCode: z.string().nullable().optional(),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  accountId: z.string().nullable(),
  email: z.string().nullable(),
  lastLoginAt: z.coerce.string().nullable(),
  managedBy: personManagedBySchema.prefault({}),
})
export type UserAccount = z.infer<typeof userAccountSchema>

const namedSchema = z.object({ id: z.string(), name: z.string() })

/** Detalhe da pessoa: a que ela PERTENCE na estrutura (Grupo, Subgrupo, gestor) e quem controla cada campo. */
export const userDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: platformRoleSchema,
  jobTitle: z.string().nullable(),
  matricula: z.string().nullable(),
  hiredAt: z.string().nullable(),
  active: z.boolean(),
  operationalCapitalCode: z.string().nullable(),
  team: namedSchema.nullable(),
  subteam: namedSchema.nullable(),
  manager: namedSchema.nullable(),
  accountId: z.string().nullable(),
  email: z.string().nullable(),
  managedBy: personManagedBySchema.prefault({}),
  /** Pessoa cadastrada à mão já vinculada à pessoa da base (a conta e os papéis foram para lá). */
  linkedTo: z.object({ id: z.string(), name: z.string(), matricula: z.string().nullable(), at: z.string() }).nullable().default(null),
})
export type UserDetail = z.infer<typeof userDetailSchema>

/**
 * Política do "Novo usuário": com Colaboradores vigente na Central, quem é da hierarquia vem pela base — sem matrícula, o
 * cadastro manual só aceita "Fora da hierarquia".
 */
export const creationPolicySchema = z.object({ hierarchyRequiresMatricula: z.boolean(), sources: z.array(sourceManagerSchema) })
export type CreationPolicy = z.infer<typeof creationPolicySchema>

export const personLinkResultSchema = z.object({ fromPersonId: z.string(), toPersonId: z.string(), matricula: z.string(), accountId: z.string().nullable(), sessionsRevoked: z.boolean() })
export type PersonLinkResult = z.infer<typeof personLinkResultSchema>

