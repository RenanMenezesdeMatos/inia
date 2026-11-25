import { coversUnit } from "@/lib/admin/unit-selection"
import type { ScopedOption } from "@/schemas/scope-units/scoped-options.schema"

/**
 * Serviço FALSO das rotas de opções das telas (`…/unit-options`): Grupos, Subgrupos e pessoas em lote único, com a busca sem acento e o
 * encadeamento que o servidor aplica. Use com `vi.mock("@/services/scope-units/scoped-options-service", () => scopedOptionsServiceFrom(…))`.
 */
type TeamLike = { id: string; name: string; subteams?: readonly { id: string; name: string }[] }
type PersonLike = { id: string; name: string; role?: string; teamId?: string | null; subteamId?: string | null }
type Search = { kind: string; search?: string; teamId?: readonly string[]; subteamId?: readonly string[] }

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
const empty = { teamId: null, teamName: null, subteamId: null, subteamName: null, operatingUniverse: null, matricula: null, role: null, jobTitle: null }

export function scopedOptionsServiceFrom(teams: readonly TeamLike[], people: readonly PersonLike[] = []) {
  const subteams = teams.flatMap((team) => (team.subteams ?? []).map((subteam) => ({ ...subteam, team })))
  const all: ScopedOption[] = [
    ...teams.map((team): ScopedOption => ({ ...empty, kind: "TEAM", id: team.id, name: team.name })),
    ...subteams.map((subteam): ScopedOption => ({ ...empty, kind: "SUBTEAM", id: subteam.id, name: subteam.name, teamId: subteam.team.id, teamName: subteam.team.name })),
    ...people.map((person): ScopedOption => ({
      ...empty,
      kind: "PERSON",
      id: person.id,
      name: person.name,
      role: person.role ?? null,
      teamId: person.teamId ?? null,
      teamName: teams.find((team) => team.id === person.teamId)?.name ?? null,
      subteamId: person.subteamId ?? null,
      subteamName: subteams.find((subteam) => subteam.id === person.subteamId)?.name ?? null,
    })),
  ]
  return {
    fetchScopedOptions: async (_source: unknown, search: Search) => ({
      items: all.filter(
        (option) =>
          option.kind === search.kind &&
          (option.kind !== "SUBTEAM" || !search.teamId?.length || search.teamId.includes(option.teamId ?? "")) &&
          (option.kind !== "PERSON" || coversUnit({ teamId: [...(search.teamId ?? [])], subteamId: [...(search.subteamId ?? [])] }, option, new Map(subteams.map((subteam) => [subteam.id, subteam.team.id])))) &&
          (!search.search || fold(`${option.teamName ?? ""} ${option.name}`).includes(fold(search.search))),
      ),
      nextCursor: null,
    }),
    fetchScopedOptionsByIds: async (_source: unknown, kind: string, ids: readonly string[]) => all.filter((option) => option.kind === kind && ids.includes(option.id)),
  }
}
