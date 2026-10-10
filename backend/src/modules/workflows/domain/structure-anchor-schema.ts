import { z } from "zod"

/**
 * As 7 formas de referenciar uma estrutura organizacional (equipe de um Supervisor, Subgrupo,
 * Grupo, ou a estrutura abaixo de um Coordenador/Gerente/Gerente Sênior/Diretor) — bloco
 * compartilhado por `consolidated-structure-schema.ts` (a estrutura analisada como UMA unidade,
 * em modo Consolidado) e `population-filter-schema.ts` (quais colaboradores são elegíveis, em
 * modo Individual). Nunca duplicar essas 7 variantes em mais de um lugar.
 */
export const structureAnchorVariants = [
  z.object({ kind: z.literal("SUPERVISOR_TEAM"), supervisorId: z.string().uuid() }),
  z.object({ kind: z.literal("SUBTEAM"), subteamId: z.string().uuid() }),
  z.object({ kind: z.literal("TEAM"), teamId: z.string().uuid() }),
  z.object({ kind: z.literal("COORDINATOR_STRUCTURE"), coordinatorId: z.string().uuid() }),
  z.object({ kind: z.literal("MANAGER_STRUCTURE"), managerId: z.string().uuid() }),
  z.object({ kind: z.literal("SENIOR_MANAGER_STRUCTURE"), seniorManagerId: z.string().uuid() }),
  z.object({ kind: z.literal("DIRECTOR_STRUCTURE"), directorId: z.string().uuid() }),
] as const

export const structureAnchorSchema = z.discriminatedUnion("kind", structureAnchorVariants)
export type StructureAnchor = z.infer<typeof structureAnchorSchema>
export type StructureAnchorKind = StructureAnchor["kind"]

/** Extrai o id da pessoa-âncora, quando a estrutura é ancorada numa pessoa (Supervisor/
 * Coordenador/Gerente/Gerente Sênior/Diretor) — `null` pra Subgrupo/Grupo, que são ancorados num
 * grupo, não numa pessoa (ver `structureAnchorGroupRef`). */
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

/** Extrai o grupo diretamente, quando a estrutura já É um grupo (Subgrupo/Grupo) — `null` pras
 * estruturas ancoradas numa pessoa (ver `structureAnchorPersonId`). */
export function structureAnchorGroupRef(anchor: StructureAnchor): { teamId?: string; subteamId?: string } | null {
  if (anchor.kind === "TEAM") return { teamId: anchor.teamId }
  if (anchor.kind === "SUBTEAM") return { subteamId: anchor.subteamId }
  return null
}
