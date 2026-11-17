"use client"

import { useId } from "react"
import { Plus, Users, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { unitFitsUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import { scopeReachSummary, scopeValueIssue, type ScopeLinksValue, type ScopeTeamOption } from "@/lib/scope-links/scope-links"
import { cn } from "@/lib/utils"

/**
 * SELETOR DE ALCANCE POR VÁRIOS GRUPOS (multi-grupo, 223) — o mesmo para Bases de Conhecimento, Comunicados, Alinhamentos e
 * Argumentários. Para cada Grupo escolhido: "Grupo inteiro" (todos os Subgrupos, inclusive os que forem criados depois) OU "Só alguns
 * Subgrupos" (marcados um a um). O escopo global do conteúdo (todos os Grupos / o universo inteiro) é uma opção à parte, quando a tela
 * permite. O resumo do alcance fica sempre visível, antes de salvar ou publicar. Universo escolhido: só Grupos/Subgrupos dele
 * (hierarquia `lib/operating-universe/hierarchy`); o salvo que não cabe continua visível e marcado. O backend continua a autoridade.
 */
export function MultiOrgScopeField({
  teams,
  value,
  onChange,
  allowGlobal = false,
  globalLabel = "Todos os grupos",
  universe,
  disabled = false,
  label = "Alcance",
  hint,
}: {
  teams: readonly ScopeTeamOption[]
  value: ScopeLinksValue
  onChange: (value: ScopeLinksValue) => void
  allowGlobal?: boolean
  globalLabel?: string
  universe?: UniverseChoice
  disabled?: boolean
  label?: string
  hint?: string
}) {
  const id = useId()
  const fits = (unitUniverse: string | null | undefined) => unitFitsUniverse(unitUniverse, universe)
  const chosen = new Set(value.groups.map((group) => group.teamId))
  // Grupo oferecido: o inteiro cabe, ou ao menos um Subgrupo dele cabe no universo.
  const available = teams.filter((team) => !chosen.has(team.id) && ((team.selectable !== false && fits(team.operatingUniverse)) || team.subteams.some((subteam) => fits(subteam.operatingUniverse ?? team.operatingUniverse))))
  const issue = scopeValueIssue(value)
  const update = (teamId: string, patch: Partial<ScopeLinksValue["groups"][number]>) =>
    onChange({ ...value, groups: value.groups.map((group) => (group.teamId === teamId ? { ...group, ...patch } : group)) })

  return (
    <fieldset className="space-y-3" disabled={disabled} data-testid="multi-org-scope-field">
      <legend className="text-sm font-medium">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      {allowGlobal ? (
        <RadioGroup
          value={value.global ? "GLOBAL" : "GROUPS"}
          onValueChange={(mode) => onChange({ ...value, global: mode === "GLOBAL" })}
          className="flex flex-wrap gap-4"
          aria-label={label}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="GLOBAL" id={`${id}-global`} />
            <Label htmlFor={`${id}-global`} className="font-normal">{globalLabel}</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="GROUPS" id={`${id}-groups`} />
            <Label htmlFor={`${id}-groups`} className="font-normal">Grupos específicos</Label>
          </div>
        </RadioGroup>
      ) : null}

      {!value.global ? (
        <div className="space-y-2">
          {value.groups.map((group) => {
            const team = teams.find((candidate) => candidate.id === group.teamId)
            const outside = team ? !fits(team.operatingUniverse) && !team.subteams.some((subteam) => fits(subteam.operatingUniverse ?? team.operatingUniverse)) : true
            const wholeAllowed = team ? team.selectable !== false && fits(team.operatingUniverse) : false
            const subteams = team?.subteams.filter((subteam) => fits(subteam.operatingUniverse ?? team.operatingUniverse) || group.subteamIds.includes(subteam.id)) ?? []
            return (
              <div key={group.teamId} className="rounded-xl border border-border p-3" data-testid={`scope-group-${group.teamId}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate text-sm font-medium">{team?.name ?? "Grupo não encontrado"}</span>
                    {outside ? <span className="text-xs text-amber-700 dark:text-amber-300">(fora do universo escolhido)</span> : null}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remover ${team?.name ?? "Grupo"}`} onClick={() => onChange({ ...value, groups: value.groups.filter((entry) => entry.teamId !== group.teamId) })}>
                    <X className="size-4" />
                  </Button>
                </div>
                <RadioGroup
                  value={group.mode}
                  onValueChange={(mode) => update(group.teamId, { mode: mode as "WHOLE" | "SUBTEAMS" })}
                  className="mt-2 flex flex-wrap gap-4"
                  aria-label={`Recorte em ${team?.name ?? "Grupo"}`}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="WHOLE" id={`${id}-${group.teamId}-whole`} disabled={!wholeAllowed && group.mode !== "WHOLE"} />
                    <Label htmlFor={`${id}-${group.teamId}-whole`} className={cn("font-normal", !wholeAllowed && "text-muted-foreground")}>Grupo inteiro</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="SUBTEAMS" id={`${id}-${group.teamId}-subteams`} disabled={subteams.length === 0} />
                    <Label htmlFor={`${id}-${group.teamId}-subteams`} className={cn("font-normal", subteams.length === 0 && "text-muted-foreground")}>Só alguns Subgrupos</Label>
                  </div>
                </RadioGroup>
                {group.mode === "SUBTEAMS" ? (
                  <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                    {subteams.map((subteam) => {
                      const checked = group.subteamIds.includes(subteam.id)
                      return (
                        <label key={subteam.id} className="flex items-center gap-2 text-sm" htmlFor={`${id}-${subteam.id}`}>
                          <Checkbox
                            id={`${id}-${subteam.id}`}
                            checked={checked}
                            onCheckedChange={(next) => update(group.teamId, { subteamIds: next === true ? [...group.subteamIds, subteam.id] : group.subteamIds.filter((entry) => entry !== subteam.id) })}
                          />
                          <span className="truncate">{subteam.name}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}

          {available.length > 0 ? (
            <Select
              value=""
              onValueChange={(teamId) => {
                const team = teams.find((candidate) => candidate.id === teamId)
                const whole = team ? team.selectable !== false && fits(team.operatingUniverse) : false
                onChange({ ...value, groups: [...value.groups, { teamId, subteamIds: [], mode: whole ? "WHOLE" : "SUBTEAMS" }] })
              }}
            >
              <SelectTrigger className="w-full sm:w-80" aria-label="Adicionar Grupo">
                <Plus className="size-4" aria-hidden />
                <SelectValue placeholder="Adicionar Grupo" />
              </SelectTrigger>
              <SelectContent>
                {available.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : value.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum Grupo disponível{universe ? " neste universo" : ""} no seu escopo.</p>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm" role="status" data-testid="scope-reach-summary">
        <span className="text-muted-foreground">Vale para: </span>
        <span className="font-medium">{scopeReachSummary(value, teams, globalLabel)}</span>
      </p>
      {issue ? <p className="text-xs text-amber-700 dark:text-amber-300">{issue}</p> : null}
    </fieldset>
  )
}

/** `Team` da estrutura (Grupos administráveis) → opção do seletor. */
export function scopeTeamOptionsOf(teams: readonly { id: string; name: string; operatingUniverse?: string | null; subteams?: readonly { id: string; name: string; operatingUniverse?: string | null }[]; selectable?: boolean }[]): ScopeTeamOption[] {
  return teams.map((team) => ({ id: team.id, name: team.name, operatingUniverse: team.operatingUniverse ?? null, selectable: team.selectable, subteams: (team.subteams ?? []).map((subteam) => ({ id: subteam.id, name: subteam.name, operatingUniverse: subteam.operatingUniverse ?? null })) }))
}
