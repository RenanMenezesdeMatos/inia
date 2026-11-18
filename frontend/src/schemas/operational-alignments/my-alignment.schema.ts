import { z } from "zod"

/**
 * Alinhamento no Acompanhamento do operador (espelho de `MyAlignment` em
 * backend/src/modules/operational-alignments/application/my-alignments.ts, `MY_OPERATIONAL_ALIGNMENTS_V1`).
 * O estado (antes de valer, em vigor, não vale mais) é decidido no servidor pelo relógio.
 */
export const myAlignmentStateSchema = z.enum(["UPCOMING", "IN_FORCE", "ENDED"])
export type MyAlignmentState = z.infer<typeof myAlignmentStateSchema>

export const myAlignmentSchema = z.object({
  alignmentId: z.string(),
  versionId: z.string(),
  version: z.number().int(),
  title: z.string(),
  guidance: z.string(),
  justification: z.string(),
  changeReason: z.string().nullable(),
  affectedTopic: z.string().nullable(),
  processes: z.array(z.string()),
  productName: z.string().nullable(),
  audienceLabel: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  timeZone: z.string(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string(),
  state: myAlignmentStateSchema,
  noLongerValidSince: z.string().nullable(),
  endedEarly: z.boolean(),
  publishedAt: z.string(),
  definedBy: z.object({ name: z.string(), jobTitle: z.string().nullable() }).nullable(),
  readAt: z.string().nullable(),
})
export type MyAlignment = z.infer<typeof myAlignmentSchema>

export const myAlignmentsSchema = z.object({ items: z.array(myAlignmentSchema) })

/**
 * Alinhamento no Acompanhamento de quem lidera (fase 2; espelho de `StructureAlignment` em
 * backend/src/modules/operational-alignments/application/structure-alignments.ts): sem a leitura de quem lê, com o alcance na estrutura
 * e quantos leram a versão mostrada.
 */
export const structureAlignmentSchema = myAlignmentSchema.omit({ readAt: true }).extend({ reach: z.object({ people: z.number().int(), read: z.number().int() }) })
export type StructureAlignment = z.infer<typeof structureAlignmentSchema>
export const myAlignmentReadSchema = z.object({ readAt: z.string() })
