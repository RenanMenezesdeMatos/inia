import { z } from "zod"

/**
 * Universo de atuação (B2B, B2C, B2X) — universos SEPARADOS: nada é compartilhado entre eles. O backend é a autoridade (cadastro,
 * abrangência e filtros); aqui só o formato que a tela recebe e os rótulos.
 */
export const OPERATING_UNIVERSES = ["B2B", "B2C", "B2X"] as const
export const operatingUniverseSchema = z.enum(OPERATING_UNIVERSES)
export type OperatingUniverse = z.infer<typeof operatingUniverseSchema>

export const OPERATING_UNIVERSE_LABELS: Record<OperatingUniverse, string> = { B2B: "B2B", B2C: "B2C", B2X: "B2X" }
export const OPERATING_UNIVERSE_DESCRIPTIONS: Record<OperatingUniverse, string> = {
  B2B: "Atende empresas",
  B2C: "Atende consumidores",
  B2X: "Universo próprio, separado de B2B e B2C",
}

export const UNIVERSE_RESOURCE_KINDS = ["KNOWLEDGE_DOCUMENT", "WORKFLOW", "PRODUCT", "INDICATOR", "BUSINESS_DOMAIN", "AGENT", "ORCHESTRATOR", "ARGUMENT_SCRIPT"] as const
export const universeResourceKindSchema = z.enum(UNIVERSE_RESOURCE_KINDS)
export type UniverseResourceKind = z.infer<typeof universeResourceKindSchema>

export const universeResourceSchema = z.object({ kind: universeResourceKindSchema, id: z.string(), name: z.string(), operatingUniverse: operatingUniverseSchema.nullable() })
export type UniverseResource = z.infer<typeof universeResourceSchema>

const linkEndSchema = z.object({ kind: z.string(), id: z.string(), name: z.string(), operatingUniverse: z.string().nullable() })

export const universeReadinessSchema = z.object({
  enforced: z.boolean(),
  enforcedAt: z.string().nullable(),
  enforcedBy: z.string().nullable(),
  people: z.object({ total: z.number(), pending: z.number(), operatorsPending: z.number(), byUniverse: z.record(z.string(), z.number()) }),
  groupsPending: z.number().default(0),
  pendingPeopleByGroup: z.array(z.object({ teamId: z.string().nullable(), teamName: z.string().nullable(), pending: z.number() })),
  resources: z.array(z.object({ kind: universeResourceKindSchema, label: z.string(), total: z.number(), pending: z.number() })),
  conflicts: z.array(z.object({ from: linkEndSchema, to: linkEndSchema, viaCategory: z.boolean() })),
  impact: z.array(z.string()),
})
export type UniverseReadiness = z.infer<typeof universeReadinessSchema>

export const universeUnitSchema = z.object({
  kind: z.enum(["TEAM", "SUBTEAM"]),
  id: z.string(),
  name: z.string(),
  parentName: z.string().nullable(),
  operatingUniverse: operatingUniverseSchema.nullable(),
  operators: z.number(),
  operatorsPending: z.number(),
  managedBy: z.object({ sourceName: z.string(), feedName: z.string() }).nullable(),
})
export type UniverseUnit = z.infer<typeof universeUnitSchema>

export const classifyPeopleResultSchema = z.object({
  updated: z.number(),
  outOfScope: z.number(),
  managedBySource: z.array(z.object({ personId: z.string(), sourceName: z.string(), feedName: z.string() })),
})
export type ClassifyPeopleResult = z.infer<typeof classifyPeopleResultSchema>
