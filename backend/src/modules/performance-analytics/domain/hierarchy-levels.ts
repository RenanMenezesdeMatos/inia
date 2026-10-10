import type { PlatformRole } from "../../auth/infrastructure/jwt.js"
import type { StructureAnchorKind } from "../../workflows/domain/structure-anchor-schema.js"

/**
 * Ordem real da cadeia `reports_to_id` (ver migrations 007/019/037) — do topo pra base. É a única
 * definição de "quem está acima de quem" desta área: as opções de "Agrupar por", o rótulo da aba
 * (Equipe x Estrutura), o sujeito padrão de cada papel e a checagem de escopo derivam daqui, nunca
 * de um `if role === ...` espalhado pelos builders ou pelos componentes.
 */
export const HIERARCHY_ROLES = ["DIRECTOR", "SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR"] as const
export type HierarchyRole = (typeof HIERARCHY_ROLES)[number]

export const ROLE_LABELS: Record<PlatformRole, string> = {
  OPERATOR: "Operador",
  ADMIN: "Administrador",
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  MANAGER: "Gerente",
  SENIOR_MANAGER: "Gerente Sênior",
  DIRECTOR: "Diretor",
}

export function isHierarchyRole(role: string): role is HierarchyRole {
  return (HIERARCHY_ROLES as readonly string[]).includes(role)
}

/** Índice na cadeia — menor = mais alto. */
function levelOf(role: HierarchyRole): number {
  return HIERARCHY_ROLES.indexOf(role)
}

/** A variante de âncora de estrutura que representa "a estrutura abaixo desta pessoa". */
export const STRUCTURE_KIND_BY_ROLE: Record<HierarchyRole, StructureAnchorKind> = {
  DIRECTOR: "DIRECTOR_STRUCTURE",
  SENIOR_MANAGER: "SENIOR_MANAGER_STRUCTURE",
  MANAGER: "MANAGER_STRUCTURE",
  COORDINATOR: "COORDINATOR_STRUCTURE",
  SUPERVISOR: "SUPERVISOR_TEAM",
}

/** Dimensões pelas quais uma estrutura pode ser agrupada: um cargo intermediário da cadeia, ou
 * o Grupo/Subgrupo (`team_id`/`subteam_id`) dos operadores. */
export type GroupingDimension = HierarchyRole | "TEAM" | "SUBTEAM"

export const GROUPING_LABELS: Record<GroupingDimension, string> = {
  DIRECTOR: "Diretor",
  SENIOR_MANAGER: "Gerente Sênior",
  MANAGER: "Gerente",
  COORDINATOR: "Coordenador",
  SUPERVISOR: "Supervisor",
  TEAM: "Grupo",
  SUBTEAM: "Subgrupo",
}

/**
 * Agrupamentos permitidos pra quem olha uma estrutura ancorada num cargo: só os cargos ESTRITAMENTE
 * abaixo do dele na cadeia (um Gerente agrupa por Coordenador/Supervisor, nunca por Gerente), mais
 * Grupo e Subgrupo. Equipe de Supervisor não agrupa (é a folha da cadeia: seus membros já são os
 * operadores), e Grupo/Subgrupo como sujeito herdam os agrupamentos do papel de quem está olhando.
 */
export function groupingOptionsBelow(role: HierarchyRole): GroupingDimension[] {
  if (role === "SUPERVISOR") return []
  return [...HIERARCHY_ROLES.slice(levelOf(role) + 1), "TEAM", "SUBTEAM"]
}

export function isGroupingDimension(value: unknown): value is GroupingDimension {
  return typeof value === "string" && (isHierarchyRole(value) || value === "TEAM" || value === "SUBTEAM")
}
