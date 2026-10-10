import { z } from "zod"
import {
  STRUCTURE_ANCHOR_LABELS,
  STRUCTURE_ANCHOR_ROLE,
  structureAnchorGroupId,
  structureAnchorPersonId,
  structureAnchorVariants,
  type StructureAnchor,
} from "./structure-anchor-schema"

/**
 * Filtro Populacional — QUAIS colaboradores, dentro da Abrangência, entram na população elegível
 * de um Workflow em modo de avaliação Individual. Espelha population-filter-schema.ts do
 * backend. Isso NUNCA vira análise agregada — é só uma restrição de QUEM participa; cada
 * colaborador do filtro continua tendo sua própria execução individual. Ausente = `ALL`.
 */
export const populationFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ALL") }),
  z.object({ kind: z.literal("EMPLOYEE"), employeeId: z.string() }),
  ...structureAnchorVariants,
])
export type PopulationFilter = z.infer<typeof populationFilterSchema>
export type PopulationFilterKind = PopulationFilter["kind"]

export const POPULATION_FILTER_LABELS: Record<PopulationFilterKind, string> = {
  ALL: "Todos os colaboradores elegíveis",
  EMPLOYEE: "Colaborador específico",
  ...STRUCTURE_ANCHOR_LABELS,
}

export const POPULATION_FILTER_ANCHOR_ROLE = STRUCTURE_ANCHOR_ROLE

export function populationFilterAnchorId(filter: PopulationFilter): string | null {
  if (filter.kind === "ALL") return null
  if (filter.kind === "EMPLOYEE") return filter.employeeId
  return structureAnchorPersonId(filter as StructureAnchor)
}

export function populationFilterGroupId(filter: PopulationFilter): string {
  if (filter.kind === "ALL" || filter.kind === "EMPLOYEE") return ""
  return structureAnchorGroupId(filter as StructureAnchor)
}
