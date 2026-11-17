"use client"

import { useId } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { teamScopeFitsUniverse, teamsForUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import type { OrgScopeType, Team } from "@/schemas/admin/org-structure.schema"

export type OrgScopeValue = { scopeType: OrgScopeType; teamId?: string; subteamId?: string }

/**
 * Alcance depois de trocar o universo do recurso: mantém o tipo de alcance e limpa o Grupo/Subgrupo que deixou de caber no universo
 * novo (hierarquia universo → Grupo → Subgrupo; o backend continua a autoridade).
 */
export function orgScopeValueAfterUniverseChange(value: OrgScopeValue, teams: readonly Team[] | undefined, universe: UniverseChoice): OrgScopeValue {
  if (!teams || teamScopeFitsUniverse(teams, value, universe)) return value
  // Subgrupo que deixou de caber: o Grupo fica se ainda tiver algum Subgrupo do universo novo (a pessoa só troca o Subgrupo).
  if (value.scopeType === "SUBTEAM" && value.teamId && teamsForUniverse(teams, universe).some((team) => team.id === value.teamId)) {
    return { scopeType: value.scopeType, teamId: value.teamId, subteamId: undefined }
  }
  return { scopeType: value.scopeType }
}

/** Marca do valor salvo fora do universo escolhido. */
function outOfUniverseNote(unitUniverse: string | null | undefined) {
  return unitUniverse ? `(de outro universo: ${unitUniverse})` : "(sem universo classificado)"
}

export function OrgScopeSelect({
  teams,
  value,
  onChange,
  allowAllTeams = true,
  universe,
}: {
  teams: Team[]
  value: OrgScopeValue
  onChange: (value: OrgScopeValue) => void
  /** Escopo Administrativo (Parte 10/11 do pedido): um admin restrito a um ou mais grupos nunca
   * vê "Todos os grupos" aqui — só pode escolher um grupo/subgrupo específico dentre os seus.
   * Default `true` preserva o comportamento de sempre nas telas que não fazem essa restrição. */
  allowAllTeams?: boolean
  /** Universo de atuação já escolhido no recurso: só Grupos/Subgrupos classificados nele (o sem universo some). Quem troca o universo limpa o
   * alcance com `orgScopeValueAfterUniverseChange`. */
  universe?: UniverseChoice
}) {
  const universeTeams = teamsForUniverse(teams, universe)
  // "Um grupo específico" só oferece Grupos que cabem inteiros no universo; "Um subgrupo" oferece também o Grupo de outro universo que
  // tem Subgrupo deste (o Subgrupo pode ter universo próprio).
  const fittingTeams = value.scopeType === "SUBTEAM" ? universeTeams : universeTeams.filter((team) => team.selectable)
  // O valor JÁ SALVO que não cabe no universo (ex.: Grupo classificado depois, ou ainda sem universo) continua visível e marcado —
  // nunca some em silêncio nem deixa o campo em branco (achado do QA de 17/11). Nada novo incompatível é oferecido: trocar o universo
  // limpa com `orgScopeValueAfterUniverseChange`, então só o salvo chega aqui fora do universo.
  const savedTeam = value.teamId && !fittingTeams.some((team) => team.id === value.teamId) ? teams.find((team) => team.id === value.teamId) : undefined
  const teamOptions = savedTeam ? [...fittingTeams, { ...savedTeam, selectable: false }] : fittingTeams
  const selectedTeam = universeTeams.find((team) => team.id === value.teamId) ?? savedTeam
  const subteamOptions = (() => {
    const fitting = universeTeams.find((team) => team.id === value.teamId)?.subteams ?? []
    const saved = value.subteamId && !fitting.some((subteam) => subteam.id === value.subteamId) ? selectedTeam?.subteams.find((subteam) => subteam.id === value.subteamId) : undefined
    return { fitting, saved }
  })()
  const id = useId()

  return (
    // auto-fit (não 3 colunas fixas): dentro de um Dialog estreito, 3 colunas fixas cortavam o
    // texto do select ("Todos os g…") — achado do QA visual da criação de Orquestrador.
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-scope`}>Alcance por grupo</Label>
        <Select
          value={value.scopeType}
          onValueChange={(scopeType) => onChange({ scopeType: scopeType as OrgScopeType })}
        >
          <SelectTrigger id={`${id}-scope`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowAllTeams ? <SelectItem value="ALL_TEAMS">Todos os grupos</SelectItem> : null}
            <SelectItem value="TEAM">Um grupo específico</SelectItem>
            <SelectItem value="SUBTEAM">Um subgrupo específico</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.scopeType !== "ALL_TEAMS" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-team`}>Grupo</Label>
          <Select
            value={value.teamId ?? ""}
            onValueChange={(teamId) => onChange({ scopeType: value.scopeType, teamId, subteamId: undefined })}
          >
            <SelectTrigger id={`${id}-team`} className="w-full">
              <SelectValue placeholder="Selecione o grupo" />
            </SelectTrigger>
            <SelectContent>
              {teamOptions.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                  {team.id === savedTeam?.id ? ` ${outOfUniverseNote(savedTeam.operatingUniverse)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {value.scopeType === "SUBTEAM" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-subteam`}>Subgrupo</Label>
          <Select
            value={value.subteamId ?? ""}
            onValueChange={(subteamId) => onChange({ ...value, subteamId })}
            disabled={!selectedTeam}
          >
            <SelectTrigger id={`${id}-subteam`} className="w-full">
              <SelectValue placeholder="Selecione o subgrupo" />
            </SelectTrigger>
            <SelectContent>
              {subteamOptions.fitting.map((subteam) => (
                <SelectItem key={subteam.id} value={subteam.id}>
                  {subteam.name}
                </SelectItem>
              ))}
              {subteamOptions.saved ? (
                <SelectItem value={subteamOptions.saved.id}>
                  {subteamOptions.saved.name} {outOfUniverseNote(subteamOptions.saved.operatingUniverse ?? selectedTeam?.operatingUniverse)}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
