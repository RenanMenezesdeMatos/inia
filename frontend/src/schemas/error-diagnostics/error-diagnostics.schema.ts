import { z } from "zod"

/** Contratos de `GET /api/v1/admin/error-diagnostics/*` (catálogo de erros e ocorrências — somente leitura). */
const cause = z.object({ hypothesis: z.string(), signal: z.string() })
const evidence = z.object({ where: z.string(), command: z.string().optional() })
const severity = z.enum(["info", "warning", "error", "critical"])

export const catalogEntrySchema = z.object({
  code: z.string(),
  aliases: z.array(z.string()).optional(),
  module: z.string(),
  origin: z.string(),
  trigger: z.string(),
  httpStatus: z.number().nullable(),
  severity,
  publicMessage: z.string(),
  safeAction: z.string(),
  technicalDescription: z.string(),
  probableCauses: z.array(cause),
  checks: z.array(z.string()),
  evidence: z.array(evidence),
  recovery: z.string(),
  escalation: z.string(),
  codeRefs: z.array(z.string()),
  example: z.string().optional(),
})

export const familySchema = z.object({
  id: z.string(),
  statuses: z.array(z.number()),
  title: z.string(),
  severity,
  meaning: z.string(),
  probableCauses: z.array(cause),
  checks: z.array(z.string()),
  evidence: z.array(evidence),
  recovery: z.string(),
  escalation: z.string(),
})

export const explanationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ENTRY"), requested: z.string(), entry: catalogEntrySchema, viaAlias: z.boolean(), catalogVersion: z.string() }),
  z.object({
    kind: z.literal("DOMAIN"),
    requested: z.string(),
    domain: z.object({ code: z.string(), module: z.string(), statuses: z.array(z.number()), messages: z.array(z.string()), refs: z.array(z.string()) }),
    family: familySchema,
    catalogVersion: z.string(),
  }),
])

export const occurrenceSchema = z.object({
  reference: z.string(),
  code: z.string(),
  source: z.string(),
  httpStatus: z.number().nullable(),
  severity,
  service: z.string(),
  release: z.string(),
  method: z.string().nullable(),
  route: z.string().nullable(),
  authenticated: z.boolean(),
  occurredAt: z.string(),
  details: z.record(z.string(), z.unknown()),
})

export const codeSearchSchema = z.object({
  catalogVersion: z.string(),
  results: z.array(z.object({ code: z.string(), module: z.string(), title: z.string(), kind: z.enum(["ENTRY", "ALIAS", "DOMAIN"]) })),
})

export const codeDetailSchema = z.object({
  explanation: explanationSchema,
  occurrences: z.object({ total24h: z.number(), recent: z.array(occurrenceSchema) }),
})

export const referenceDetailSchema = z.object({
  reference: z.string(),
  occurrences: z.array(occurrenceSchema),
  explanations: z.record(z.string(), explanationSchema.nullable()),
})

export type Explanation = z.infer<typeof explanationSchema>
export type Occurrence = z.infer<typeof occurrenceSchema>
export type CodeSearch = z.infer<typeof codeSearchSchema>
export type CodeDetail = z.infer<typeof codeDetailSchema>
export type ReferenceDetail = z.infer<typeof referenceDetailSchema>
