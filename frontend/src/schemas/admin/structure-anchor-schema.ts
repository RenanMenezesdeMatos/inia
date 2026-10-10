import { z } from "zod"

/**
 * As 7 formas de referenciar uma estrutura organizacional — bloco compartilhado por
 * `consolidated-structure-schema.ts` (a estrutura analisada como UMA unidade, em modo
 * Consolidado) e `population-filter-schema.ts` (quais colaboradores são elegíveis, em modo
 * Individual). Espelha structure-anchor-schema.ts do backend — nunca duplicar essas 7 variantes
 * em mais de um lugar.
 */
export const structureAnchorVariants = [
  z.object({ kind: z.literal("SUPERVISOR_TEAM"), supervisorId: z.string() }),
  z.object({ kind: z.literal("SUBTEAM"), subteamId: z.string() }),
  z.object({ kind: z.literal("TEAM"), teamId: z.string() }),
  z.object({ kind: z.literal("COORDINATOR_STRUCTURE"), coordinatorId: z.string() }),
  z.object({ kind: z.literal("MANAGER_STRUCTURE"), managerId: z.string() }),
  z.object({ kind: z.literal("SENIOR_MANAGER_STRUCTURE"), seniorManagerId: z.string() }),
  z.object({ kind: z.literal("DIRECTOR_STRUCTURE"), directorId: z.string() }),
] as const

export const structureAnchorSchema = z.discriminatedUnion("kind", structureAnchorVariants)
export type StructureAnchor = z.infer<typeof structureAnchorSchema>
export type StructureAnchorKind = StructureAnchor["kind"]

export const STRUCTURE_ANCHOR_LABELS: Record<StructureAnchorKind, string> = {
  SUPERVISOR_TEAM: "Equipe de Supervisor",
  SUBTEAM: "Subgrupo",
  TEAM: "Grupo",
  COORDINATOR_STRUCTURE: "Estrutura de Coordenador",
  MANAGER_STRUCTURE: "Estrutura de Gerente",
  SENIOR_MANAGER_STRUCTURE: "Estrutura de Gerente Sênior",
  DIRECTOR_STRUCTURE: "Estrutura de Diretor",
}

/** Papel (people.role) da pessoa-âncora esperada por cada kind baseado em pessoa — usado só pra
 * filtrar o picker de pessoas (o backend valida a Abrangência de novo, sempre). */
export const STRUCTURE_ANCHOR_ROLE: Partial<Record<StructureAnchorKind, string>> = {
  SUPERVISOR_TEAM: "SUPERVISOR",
  COORDINATOR_STRUCTURE: "COORDINATOR",
  MANAGER_STRUCTURE: "MANAGER",
  SENIOR_MANAGER_STRUCTURE: "SENIOR_MANAGER",
  DIRECTOR_STRUCTURE: "DIRECTOR",
}

export function structureAnchorPersonId(anchor: StructureAnchor): string | null {
  switch (anchor.kind) {
    case "SUPERVISOR_TEAM":
      return anchor.supervisorId
    case "COORDINATOR_STRUCTURE":
      return anchor.coordinatorId
    case "MANAGER_STRUCTURE":
      return anchor.managerId
    case "SENIOR_MANAGER_STRUCTURE":
      return anchor.seniorManagerId
    case "DIRECTOR_STRUCTURE":
      return anchor.directorId
    case "SUBTEAM":
    case "TEAM":
      return null
  }
}

export function structureAnchorGroupId(anchor: StructureAnchor): string {
  if (anchor.kind === "SUBTEAM") return anchor.subteamId
  if (anchor.kind === "TEAM") return anchor.teamId
  return ""
}
