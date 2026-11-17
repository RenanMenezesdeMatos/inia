import { scopeTeamOptionsOf } from "@/components/admin/shared/multi-org-scope-field"
import { linksLabel, type ScopeTeamOption } from "@/lib/scope-links/scope-links"
import type { ArgumentScriptScope, ArgumentScriptScopeOptions, ArgumentScriptScopeType, ArgumentScriptVersion } from "@/schemas/admin/argument-script.schema"
import type { Team } from "@/schemas/admin/org-structure.schema"

export function scopeLabel(item: { scopeType: ArgumentScriptScopeType; scopeLinks?: ArgumentScriptScope["links"]; links?: ArgumentScriptScope["links"] }) {
  if (item.scopeType === "ALL_TEAMS") return "Todos os grupos"
  return linksLabel(item.scopeLinks ?? item.links ?? [])
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
export function teamsForScope(teams: Team[], options: ArgumentScriptScopeOptions): ScopeTeamOption[] {
  if (options.allTeams) return scopeTeamOptionsOf(teams)
  const teamIds = new Set(options.teamIds)
  const subteamIds = new Set(options.subteamIds)
  // Grupo administrado: inteiro ou qualquer Subgrupo; senão, só os Subgrupos administrados dele (o Grupo inteiro não é oferecido).
  return scopeTeamOptionsOf(teams.flatMap((team): (Team & { selectable: boolean })[] => {
    if (teamIds.has(team.id)) return [{ ...team, selectable: true }]
    const subteams = team.subteams.filter((subteam) => subteamIds.has(subteam.id))
    return subteams.length > 0 ? [{ ...team, subteams, selectable: false }] : []
  }))
}
