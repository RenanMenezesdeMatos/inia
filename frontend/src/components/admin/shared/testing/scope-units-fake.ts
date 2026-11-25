import { fireEvent, screen, waitFor } from "@testing-library/react"

import type { ScopeUnitOption } from "@/schemas/scope-units/scope-units.schema"

/**
 * Serviço FALSO de `/admin/scope-units` para testes de tela: a partir da mesma estrutura de Grupos que os testes já montavam, aplica o que o
 * servidor aplica (universo — Grupo/Subgrupo sem universo some quando há universo escolhido —, busca sem acento e elegibilidade por
 * `withoutProduction`). Use com `vi.mock("@/services/scope-units/scope-units-service", () => scopeUnitsServiceFrom(TEAMS))` (TEAMS via
 * `vi.hoisted`).
 */
type TeamLike = { id: string; name: string; operatingUniverse?: string | null; universe?: string | null; subteams?: readonly { id: string; name: string; operatingUniverse?: string | null; universe?: string | null }[] }

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function scopeUnitsOf(teams: readonly TeamLike[], withoutProduction: readonly string[] = []): ScopeUnitOption[] {
  return teams.flatMap((team) => {
    const teamUniverse = team.operatingUniverse ?? team.universe ?? null
    const own: ScopeUnitOption = { kind: "TEAM", id: team.id, name: team.name, teamId: null, teamName: null, operatingUniverse: teamUniverse, productionOperators: withoutProduction.includes(team.id) ? 0 : 5, eligible: !withoutProduction.includes(team.id), manageable: true }
    const subs = (team.subteams ?? []).map((subteam): ScopeUnitOption => ({ kind: "SUBTEAM", id: subteam.id, name: subteam.name, teamId: team.id, teamName: team.name, operatingUniverse: subteam.operatingUniverse ?? subteam.universe ?? teamUniverse, productionOperators: withoutProduction.includes(subteam.id) ? 0 : 3, eligible: !withoutProduction.includes(subteam.id), manageable: true }))
    return [own, ...subs]
  })
}

type FakeSearch = { kind: string; search?: string; universes?: readonly string[]; purpose?: string; eligibility?: string; teamId?: string; withinTeamIds?: readonly string[] }

export function scopeUnitsServiceFrom(teams: readonly TeamLike[], withoutProduction: readonly string[] = []) {
  const units = () => scopeUnitsOf(teams, withoutProduction)
  const inUniverse = (unit: ScopeUnitOption, universes: readonly string[]) => unit.operatingUniverse !== null && universes.includes(unit.operatingUniverse)
  // Filtro: o Grupo de outro universo aparece se tiver Subgrupo do universo escolhido.
  const fits = (unit: ScopeUnitOption, search: FakeSearch) => {
    if (!search.universes?.length || inUniverse(unit, search.universes)) return true
    return search.purpose === "filter" && unit.kind === "TEAM" && units().some((other) => other.kind === "SUBTEAM" && other.teamId === unit.id && inUniverse(other, search.universes!))
  }
  return {
    MAX_WITHIN_TEAM_IDS: 40,
    MAX_SCOPE_UNIT_IDS: 300,
    fetchScopeUnits: async (search: FakeSearch) => ({
      items: units().filter(
        (unit) =>
          unit.kind === search.kind &&
          (unit.eligible || search.eligibility === "all" || search.purpose === "filter") &&
          fits(unit, search) &&
          (!search.teamId || unit.teamId === search.teamId) &&
          (!search.withinTeamIds || search.withinTeamIds.includes(unit.kind === "TEAM" ? unit.id : (unit.teamId ?? ""))) &&
          (!search.search?.trim() || fold(`${unit.teamName ?? ""} ${unit.name}`).includes(fold(search.search.trim()))),
      ),
      nextCursor: null,
    }),
    fetchScopeUnitsByIds: async (kind: string, _permission: string, ids: readonly string[]) => units().filter((unit) => unit.kind === kind && ids.includes(unit.id)),
  }
}

/** Abre um campo de Grupo/Subgrupo (o gatilho se chama "<rótulo>: <escolha>") e devolve o nome das opções. */
export async function openUnitField(label: string): Promise<string[]> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${label}:`) }))
  await screen.findByRole("listbox")
  await waitFor(() => {
    if (screen.queryByText("Carregando…")) throw new Error("ainda carregando")
  })
  return screen.queryAllByRole("option").map((option) => option.getAttribute("aria-label") ?? "")
}

/** Escolhe num campo de Grupo/Subgrupo (Subgrupo como "Grupo › Subgrupo"); `tab` = aba do filtro que junta os dois. Fecha em seguida. */
export async function chooseUnit(label: string, option: string, tab?: "Grupos" | "Subgrupos") {
  await openUnitField(label)
  if (tab) fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${tab}`) }))
  fireEvent.click(await screen.findByRole("option", { name: option }))
  // Na escolha múltipla o seletor continua aberto.
  if (screen.queryByRole("listbox")) closeUnitField()
}

export function closeUnitField() {
  fireEvent.keyDown(screen.getByRole("combobox", { name: /Buscar/ }), { key: "Escape" })
}

/** Abre o seletor, escolhe a aba e marca a opção (nome do Grupo; Subgrupo como "Grupo › Subgrupo"); fecha em seguida. */
export async function pickScopeUnit(name: string, kind: "TEAM" | "SUBTEAM" = "TEAM") {
  fireEvent.click(await screen.findByRole("button", { name: /Adicionar Grupo ou Subgrupo/ }))
  if (kind === "SUBTEAM") fireEvent.click(await screen.findByRole("radio", { name: "Subgrupos" }))
  fireEvent.click(await screen.findByRole("option", { name }))
  fireEvent.keyDown(screen.getByRole("combobox", { name: /Buscar/ }), { key: "Escape" })
}

/** Nomes oferecidos no seletor (abre, lê e fecha). */
export async function offeredScopeUnits(kind: "TEAM" | "SUBTEAM" = "TEAM"): Promise<string[]> {
  fireEvent.click(await screen.findByRole("button", { name: /Adicionar Grupo ou Subgrupo/ }))
  if (kind === "SUBTEAM") fireEvent.click(await screen.findByRole("radio", { name: "Subgrupos" }))
  await screen.findByRole("listbox")
  await waitFor(() => {
    if (screen.queryByText("Carregando…")) throw new Error("ainda carregando")
  })
  const names = screen.queryAllByRole("option").map((option) => option.getAttribute("aria-label") ?? "")
  fireEvent.keyDown(screen.getByRole("combobox", { name: /Buscar/ }), { key: "Escape" })
  return names
}
