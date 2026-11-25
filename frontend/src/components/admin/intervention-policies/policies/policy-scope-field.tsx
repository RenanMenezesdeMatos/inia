"use client"

import { useId, useState } from "react"

import { OrgScopeSelect, useOrgScopeUnits, type OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { UniverseSelect } from "@/components/operating-universe/universe-select"
import { Label } from "@/components/ui/label"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

const PERMISSION = "intervention_policies.edit"

/**
 * ESCOPO DA POLÍTICA na hierarquia do app: universo de atuação → Grupo → Subgrupo. Escolhido o universo, só aparecem Grupos e
 * Subgrupos dele; trocar o universo limpa o Grupo/Subgrupo que deixou de caber. A política não guarda universo (o escopo dela é o
 * Grupo/Subgrupo): aqui ele só filtra as opções. "Todos os universos" mostra todos os Grupos.
 */
export function PolicyScopeField({ value, onChange, allowAllTeams }: { value: OrgScopeValue; onChange: (value: OrgScopeValue) => void; allowAllTeams: boolean }) {
  const universeId = useId()
  // `undefined` = a pessoa ainda não mexeu: vale o universo do escopo salvo (que chega depois do primeiro render).
  const [chosen, setChosen] = useState<OperatingUniverse | null | undefined>(undefined)
  const units = useOrgScopeUnits(PERMISSION, value)
  const universe = chosen === undefined ? ((units.universe as OperatingUniverse | null) ?? null) : chosen
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
            onChange(units.afterUniverse(next))
          }}
        />
      </div>
      <div className="col-span-full">
        <OrgScopeSelect permission={PERMISSION} value={value} onChange={onChange} allowAllTeams={allowAllTeams} universe={universe} />
      </div>
    </div>
  )
}
