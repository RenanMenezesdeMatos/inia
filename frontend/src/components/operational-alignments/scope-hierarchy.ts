import type { AlignmentScopeOptions } from "@/schemas/operational-alignments/operational-alignment.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

/**
 * ENCADEAMENTO universo → Grupo → Subgrupo (pedido do usuário, 17/11): escolhido o universo, só aparecem os Grupos/Subgrupos dele;
 * escolhido o Grupo, só os Subgrupos dele. Escolhido um universo, Grupo/Subgrupo ainda sem universo (não classificado) NÃO aparece —
 * o backend também recusa alinhamento para ele (`OPERATIONAL_ALIGNMENT_GROUP_UNCLASSIFIED`). Quando um nível acima muda, a escolha de baixo que deixou de caber é limpa.
 */
export type ScopeTeam = AlignmentScopeOptions["teams"][number]

const fits = (itemUniverse: OperatingUniverse | null, universe: OperatingUniverse | null | undefined) => !universe || itemUniverse === universe

export function teamsForUniverse(teams: readonly ScopeTeam[], universe: OperatingUniverse | null | undefined): ScopeTeam[] {
  return teams
    .map((team) => ({ ...team, subteams: team.subteams.filter((subteam) => fits(subteam.operatingUniverse, universe)) }))
    .filter((team) => (team.manageable && fits(team.operatingUniverse, universe)) || team.subteams.length > 0)
}
