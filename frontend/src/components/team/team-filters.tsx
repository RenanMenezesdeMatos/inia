"use client"

import { FilterX, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MEMBER_SITUATION_LABELS, type MemberSituation, type TeamOverview } from "@/schemas/analytics/analytics.schema"

const ALL = "__all__"

export type TeamFilterState = {
  search: string
  teamId: string | null
  subteamId: string | null
  situation: MemberSituation | null
  attentionIndicatorCode: string | null
  pendingOnly: boolean
}

export const EMPTY_TEAM_FILTERS: TeamFilterState = { search: "", teamId: null, subteamId: null, situation: null, attentionIndicatorCode: null, pendingOnly: false }

export function hasActiveTeamFilters(filters: TeamFilterState): boolean {
  return filters.search.trim() !== "" || filters.teamId !== null || filters.subteamId !== null || filters.situation !== null || filters.attentionIndicatorCode !== null || filters.pendingOnly
}

/** Filtros da lista de membros — só aparecem os que fazem sentido para o conjunto (Grupo só com 2+ grupos etc.). */
export function TeamFilters({ filters, options, onChange, onClear }: { filters: TeamFilterState; options: TeamOverview["filterOptions"]; onChange: (patch: Partial<TeamFilterState>) => void; onClear: () => void }) {
  const subteams = filters.teamId ? options.subteams.filter((subteam) => subteam.teamId === filters.teamId) : options.subteams
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={filters.search} onChange={(event) => onChange({ search: event.target.value })} placeholder="Buscar por nome" aria-label="Buscar colaborador por nome" className="bg-card pl-8" />
      </div>
      <div role="group" aria-label="Filtros" className="flex flex-wrap items-center gap-2">
        {options.teams.length > 1 ? (
          <Select value={filters.teamId ?? ALL} onValueChange={(value) => onChange({ teamId: value === ALL ? null : value, subteamId: null })}>
            <SelectTrigger className="w-44 bg-card" aria-label="Grupo">
              <SelectValue placeholder="Grupo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os grupos</SelectItem>
              {options.teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {subteams.length > 0 ? (
          <Select value={filters.subteamId ?? ALL} onValueChange={(value) => onChange({ subteamId: value === ALL ? null : value })}>
            <SelectTrigger className="w-48 bg-card" aria-label="Subgrupo">
              <SelectValue placeholder="Subgrupo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os subgrupos</SelectItem>
              {subteams.map((subteam) => (
                <SelectItem key={subteam.id} value={subteam.id}>
                  {subteam.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={filters.situation ?? ALL} onValueChange={(value) => onChange({ situation: value === ALL ? null : (value as MemberSituation) })}>
          <SelectTrigger className="w-48 bg-card" aria-label="Situação">
            <SelectValue placeholder="Situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as situações</SelectItem>
            {(Object.keys(MEMBER_SITUATION_LABELS) as MemberSituation[]).map((situation) => (
              <SelectItem key={situation} value={situation}>
                {MEMBER_SITUATION_LABELS[situation]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.indicators.length > 0 ? (
          <Select value={filters.attentionIndicatorCode ?? ALL} onValueChange={(value) => onChange({ attentionIndicatorCode: value === ALL ? null : value })}>
            <SelectTrigger className="w-56 bg-card" aria-label="Indicador em atenção">
              <SelectValue placeholder="Indicador em atenção" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Qualquer indicador</SelectItem>
              {options.indicators.map((indicator) => (
                <SelectItem key={indicator.code} value={indicator.code}>
                  Em atenção: {indicator.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button type="button" variant={filters.pendingOnly ? "secondary" : "outline"} size="sm" className="bg-card data-[active=true]:bg-primary/10" data-active={filters.pendingOnly} aria-pressed={filters.pendingOnly} onClick={() => onChange({ pendingOnly: !filters.pendingOnly })}>
          Com pendências
        </Button>
        {hasActiveTeamFilters(filters) ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <FilterX data-icon="inline-start" /> Limpar filtros
          </Button>
        ) : null}
      </div>
    </div>
  )
}
