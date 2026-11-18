"use client"

import { useId, useState } from "react"

import { OrgScopeSelect, orgScopeValueAfterUniverseChange, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { UniverseSelect } from "@/components/operating-universe/universe-select"
import { Label } from "@/components/ui/label"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

/** Universo do Grupo/Subgrupo já escolhido (o Subgrupo traz o efetivo) — ponto de partida do seletor ao abrir um escopo salvo. */
export function universeOfScope(teams: readonly Team[], scope: OrgScopeValue): OperatingUniverse | null {
  const team = teams.find((candidate) => candidate.id === scope.teamId)
  if (!team) return null
  const subteam = scope.subteamId ? team.subteams.find((candidate) => candidate.id === scope.subteamId) : undefined
  return subteam?.operatingUniverse ?? team.operatingUniverse ?? null
}

/**
 * ESCOPO DA POLÍTICA na hierarquia do app: universo de atuação → Grupo → Subgrupo. Escolhido o universo, só aparecem Grupos e
 * Subgrupos dele; trocar o universo limpa o Grupo/Subgrupo que deixou de caber. A política não guarda universo (o escopo dela é o
 * Grupo/Subgrupo): aqui ele só filtra as opções. "Todos os universos" mostra todos os Grupos.
 */
export function PolicyScopeField({ teams, value, onChange, allowAllTeams }: { teams: Team[]; value: OrgScopeValue; onChange: (value: OrgScopeValue) => void; allowAllTeams: boolean }) {
  const universeId = useId()
  // `undefined` = a pessoa ainda não mexeu: vale o universo do escopo salvo (os Grupos chegam depois do primeiro render).
  const [chosen, setChosen] = useState<OperatingUniverse | null | undefined>(undefined)
  const universe = chosen === undefined ? universeOfScope(teams, value) : chosen
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      <div className="space-y-1.5">
        <Label htmlFor={universeId}>Universo de atuação</Label>
        <UniverseSelect
          id={universeId}
          value={universe}
          allowPending
          pendingLabel="Todos os universos"
          onChange={(next) => {
            setChosen(next)
            onChange(orgScopeValueAfterUniverseChange(value, teams, next))
          }}
        />
      </div>
      <div className="col-span-full">
        <OrgScopeSelect teams={teams} value={value} onChange={onChange} allowAllTeams={allowAllTeams} universe={universe} />
      </div>
    </div>
  )
}
