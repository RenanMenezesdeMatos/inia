"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { OrgScopeType, Team } from "@/schemas/admin/org-structure.schema"

export type OrgScopeValue = { scopeType: OrgScopeType; teamId?: string; subteamId?: string }

export function OrgScopeSelect({
  teams,
  value,
  onChange,
  allowAllTeams = true,
}: {
  teams: Team[]
  value: OrgScopeValue
  onChange: (value: OrgScopeValue) => void
  /** Escopo Administrativo (Parte 10/11 do pedido): um admin restrito a um ou mais grupos nunca
   * vê "Todos os grupos" aqui — só pode escolher um grupo/subgrupo específico dentre os seus.
   * Default `true` preserva o comportamento de sempre nas telas que não fazem essa restrição. */
  allowAllTeams?: boolean
}) {
  const selectedTeam = teams.find((team) => team.id === value.teamId)

  return (
    // auto-fit (não 3 colunas fixas): dentro de um Dialog estreito, 3 colunas fixas cortavam o
    // texto do select ("Todos os g…") — achado do QA visual da criação de Orquestrador.
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      <div className="space-y-1.5">
        <Label>Alcance por grupo</Label>
        <Select
          value={value.scopeType}
          onValueChange={(scopeType) => onChange({ scopeType: scopeType as OrgScopeType })}
        >
          <SelectTrigger className="w-full">
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
          <Label>Grupo</Label>
          <Select
            value={value.teamId ?? ""}
            onValueChange={(teamId) => onChange({ scopeType: value.scopeType, teamId, subteamId: undefined })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione o grupo" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {value.scopeType === "SUBTEAM" ? (
        <div className="space-y-1.5">
          <Label>Subgrupo</Label>
          <Select
            value={value.subteamId ?? ""}
            onValueChange={(subteamId) => onChange({ ...value, subteamId })}
            disabled={!selectedTeam}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione o subgrupo" />
            </SelectTrigger>
            <SelectContent>
              {(selectedTeam?.subteams ?? []).map((subteam) => (
                <SelectItem key={subteam.id} value={subteam.id}>
                  {subteam.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
