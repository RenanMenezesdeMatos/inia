import { z } from "zod"
import { structureAnchorGroupRef, structureAnchorPersonId, structureAnchorVariants, type StructureAnchor } from "./structure-anchor-schema.js"

/**
 * Filtro Populacional — QUAIS colaboradores, dentro da Abrangência, entram na população elegível
 * de um Workflow em modo de avaliação Individual (`workflows.consolidated_structure` nulo). Isso
 * nunca vira análise agregada — é só uma restrição de QUEM participa; cada colaborador do filtro
 * continua tendo sua própria matrícula/execução individual (ver schedule-check.ts). Só faz
 * sentido com Agenda (de calendário ou relativa ao expediente) — Flag/Indicador não têm filtro
 * populacional, o sujeito já vem do próprio evento.
 *
 * Ausente (`null`) = `ALL` — todo colaborador ativo elegível da Abrangência, comportamento de
 * sempre antes desta configuração existir.
 */
export const populationFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ALL") }),
  z.object({ kind: z.literal("EMPLOYEE"), employeeId: z.string().uuid() }),
  ...structureAnchorVariants,
])
export type PopulationFilter = z.infer<typeof populationFilterSchema>

/** Extrai o id da pessoa-âncora, quando o filtro é ancorado numa pessoa (Colaborador específico,
 * ou a estrutura de um Supervisor/Coordenador/Gerente/Gerente Sênior/Diretor) — `null` pra `ALL`
 * e pros filtros de grupo (Subgrupo/Grupo, ver `populationFilterGroupRef`). */
export function populationFilterAnchorId(filter: PopulationFilter): string | null {
  if (filter.kind === "ALL") return null
  if (filter.kind === "EMPLOYEE") return filter.employeeId
  return structureAnchorPersonId(filter as StructureAnchor)
}

/** Extrai o grupo diretamente, quando o filtro já É um grupo (Subgrupo/Grupo) — `null` pros
 * demais kinds. */
export function populationFilterGroupRef(filter: PopulationFilter): { teamId?: string; subteamId?: string } | null {
  if (filter.kind === "ALL" || filter.kind === "EMPLOYEE") return null
  return structureAnchorGroupRef(filter as StructureAnchor)
}
