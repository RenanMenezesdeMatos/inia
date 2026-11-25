"use client"

import { useId } from "react"

import { OrgUnitCombobox, useOrgUnitLabel } from "@/components/admin/shared/org-unit-combobox"
import { universesOf } from "@/components/admin/shared/list/org-scope-filter"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { unitFitsUniverse, type UniverseChoice } from "@/lib/operating-universe/hierarchy"
import type { OrgScopeType } from "@/schemas/admin/org-structure.schema"
import type { ScopePickerPermission } from "@/schemas/scope-units/scope-units.schema"

export type OrgScopeValue = { scopeType: OrgScopeType; teamId?: string; subteamId?: string }

/**
 * Grupo e Subgrupo do alcance (nome e universo, mesmo fora do lote carregado), se o escolhido cabe num universo, e o alcance depois de
 * trocar o universo do recurso: mantém o tipo e limpa o Grupo/Subgrupo que deixou de caber (hierarquia universo → Grupo → Subgrupo; o
 * backend continua a autoridade). Enquanto o universo do escolhido não chega, nada é limpo.
 */
export function useOrgScopeUnits(permission: ScopePickerPermission, value: OrgScopeValue) {
  const team = useOrgUnitLabel("TEAM", permission, value.scopeType === "ALL_TEAMS" ? null : value.teamId).unit
  const subteam = useOrgUnitLabel("SUBTEAM", permission, value.scopeType === "SUBTEAM" ? value.subteamId : null).unit
  const chosen = value.scopeType === "SUBTEAM" && value.subteamId ? subteam : team
  return {
    team,
    subteam,
    /** Universo do escolhido (o efetivo, no Subgrupo). */
    universe: chosen?.operatingUniverse ?? null,
    fits: (universe: UniverseChoice) => chosen === null || unitFitsUniverse(chosen.operatingUniverse, universe),
    afterUniverse: (universe: UniverseChoice): OrgScopeValue => {
      if (chosen === null || unitFitsUniverse(chosen.operatingUniverse, universe)) return value
      // Subgrupo que deixou de caber: o Grupo fica se ele próprio cabe no universo novo (a pessoa só troca o Subgrupo).
      if (value.scopeType === "SUBTEAM" && value.subteamId && team && unitFitsUniverse(team.operatingUniverse, universe)) return { scopeType: value.scopeType, teamId: value.teamId, subteamId: undefined }
      return { scopeType: value.scopeType }
    },
  }
}

/** Marca do valor salvo fora do universo escolhido. */
function outOfUniverseNote(unitUniverse: string | null | undefined) {
  return unitUniverse ? `De outro universo: ${unitUniverse}` : "Sem universo classificado"
}

/**
 * Alcance ÚNICO de um recurso: todos os grupos, um Grupo ou um Subgrupo. Grupo e Subgrupo são campos pesquisáveis com as opções do
 * servidor, no escopo da permissão da tela; o Subgrupo pode ser buscado sem escolher o Grupo (que passa a ser o de origem).
 */
export function OrgScopeSelect({
  permission,
  value,
  onChange,
  allowAllTeams = true,
  universe,
}: {
  permission: ScopePickerPermission
  value: OrgScopeValue
  onChange: (value: OrgScopeValue) => void
  /** Escopo Administrativo (Parte 10/11 do pedido): um admin restrito a um ou mais grupos nunca
   * vê "Todos os grupos" aqui — só pode escolher um grupo/subgrupo específico dentre os seus.
   * Default `true` preserva o comportamento de sempre nas telas que não fazem essa restrição. */
  allowAllTeams?: boolean
  /** Universo de atuação já escolhido no recurso: só Grupos/Subgrupos classificados nele (o sem universo some). Quem troca o universo
   * limpa o alcance com `useOrgScopeUnits().afterUniverse`. */
  universe?: UniverseChoice
}) {
  const id = useId()
  const units = useOrgScopeUnits(permission, value)
  const universes = universesOf(universe)
  const bySubteam = value.scopeType === "SUBTEAM"
  // O valor JÁ SALVO que não cabe no universo (ex.: Grupo classificado depois, ou ainda sem universo) continua visível e marcado —
  // nunca some em silêncio nem deixa o campo em branco (achado do QA de 17/11). Nada novo incompatível é oferecido.
  const teamOut = units.team && (bySubteam ? Boolean(units.subteam && !unitFitsUniverse(units.subteam.operatingUniverse, universe)) : true) && !unitFitsUniverse(units.team.operatingUniverse, universe)
  const subteamOut = units.subteam && !unitFitsUniverse(units.subteam.operatingUniverse, universe)

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
          <OrgUnitCombobox
            id={`${id}-team`}
            kind="TEAM"
            source={permission}
            // No Subgrupo, o Grupo serve só para achá-lo: aparece também o Grupo-pai de um Subgrupo do escopo ou do universo.
            purpose={bySubteam ? "filter" : "reach"}
            eligibility="all"
            universes={universes}
            value={value.teamId}
            onChange={(team) => onChange({ scopeType: value.scopeType, teamId: team?.id, subteamId: undefined })}
            emptyLabel={bySubteam ? "Qualquer grupo" : null}
            variant="field"
                  ariaLabel="Grupo"
            ariaDescribedBy={teamOut ? `${id}-team-out` : undefined}
          />
          {teamOut ? <p id={`${id}-team-out`} className="text-xs text-amber-700 dark:text-amber-300">{outOfUniverseNote(units.team?.operatingUniverse)}</p> : null}
        </div>
      ) : null}

      {bySubteam ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-subteam`}>Subgrupo</Label>
          <OrgUnitCombobox
            id={`${id}-subteam`}
            kind="SUBTEAM"
            source={permission}
            purpose="reach"
            eligibility="all"
            universes={universes}
            teamId={value.teamId}
            value={value.subteamId}
            onChange={(subteam) => onChange({ scopeType: value.scopeType, teamId: subteam?.teamId ?? value.teamId, subteamId: subteam?.id })}
            emptyLabel={null}
            variant="field"
                  ariaLabel="Subgrupo"
            ariaDescribedBy={subteamOut ? `${id}-subteam-out` : undefined}
          />
          {subteamOut ? <p id={`${id}-subteam-out`} className="text-xs text-amber-700 dark:text-amber-300">{outOfUniverseNote(units.subteam?.operatingUniverse)}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
