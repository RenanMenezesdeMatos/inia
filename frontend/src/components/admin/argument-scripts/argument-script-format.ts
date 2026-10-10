import type { ArgumentScriptScopeOptions, ArgumentScriptScopeType, ArgumentScriptVersion } from "@/schemas/admin/argument-script.schema"
import type { Team } from "@/schemas/admin/org-structure.schema"

export function scopeLabel(item: { scopeType: ArgumentScriptScopeType; teamName: string | null; subteamName: string | null }) {
  if (item.scopeType === "ALL_TEAMS") return "Todos os grupos"
  if (item.scopeType === "SUBTEAM") return [item.teamName, item.subteamName].filter(Boolean).join(" › ") || "—"
  return item.teamName ?? "—"
}

const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

function parse(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDay(value: string | null | undefined) {
  const date = parse(value)
  return date ? DAY.format(date) : "—"
}

export function formatDateTime(value: string | null | undefined) {
  const date = parse(value)
  return date ? DATE_TIME.format(date) : "—"
}

/** Vigência da versão publicada em texto simples ("Vigente desde dd/mm/aaaa", "… até …", "Começa a valer em …"). */
export function validityLabel(from: string | null, until: string | null, now: number = Date.now()): string | null {
  const start = parse(from)
  if (!start) return null
  const end = parse(until)
  if (start.getTime() > now) return `Começa a valer em ${DAY.format(start)}`
  if (end && end.getTime() <= now) return `Valeu de ${DAY.format(start)} até ${DAY.format(end)}`
  if (end) return `Vigente desde ${DAY.format(start)} até ${DAY.format(end)}`
  return `Vigente desde ${DAY.format(start)}`
}

export function versionSituation(version: ArgumentScriptVersion, now: number = Date.now()): string {
  if (version.status === "DRAFT") return "Rascunho"
  if (version.status === "SUPERSEDED") return "Substituída"
  const start = parse(version.effectiveFrom)
  const end = parse(version.effectiveUntil)
  if (start && start.getTime() > now) return "Agendada"
  if (end && end.getTime() <= now) return "Encerrada"
  return "Vigente"
}

/**
 * Grupos/subgrupos oferecidos no seletor de escopo: quem administra a organização vê tudo (e "Todos os grupos"); quem administra
 * só alguns grupos/subgrupos vê só os seus. "Um grupo específico" lista só grupos inteiros administrados; "Um subgrupo específico"
 * lista os subgrupos administrados (diretamente ou pelo grupo). O backend continua sendo a autoridade (403).
 */
export function teamsForScope(teams: Team[], options: ArgumentScriptScopeOptions, scopeType: ArgumentScriptScopeType): Team[] {
  if (options.allTeams) return teams
  const teamIds = new Set(options.teamIds)
  const subteamIds = new Set(options.subteamIds)
  if (scopeType === "TEAM") return teams.filter((team) => teamIds.has(team.id))
  return teams.flatMap((team) => {
    if (teamIds.has(team.id)) return [team]
    const subteams = team.subteams.filter((subteam) => subteamIds.has(subteam.id))
    return subteams.length > 0 ? [{ ...team, subteams }] : []
  })
}

export function defaultScopeType(options: ArgumentScriptScopeOptions): ArgumentScriptScopeType {
  if (options.allTeams) return "ALL_TEAMS"
  return options.teamIds.length > 0 ? "TEAM" : "SUBTEAM"
}
