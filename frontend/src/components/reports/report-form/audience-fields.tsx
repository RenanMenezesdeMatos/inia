"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { PLATFORM_LEVELS, type AudiencePerson, type ReportAudience, type ReportOptions } from "@/schemas/reports/reports.schema"
import { searchAudiencePeople } from "@/services/reports/reports-service"
import { LEVEL_LABELS } from "../report-labels"
import { ChipToggleGroup, Field } from "./form-controls"

type Distribution = Extract<ReportAudience, { mode: "DISTRIBUTION" }>
const EMPTY: Distribution = { mode: "DISTRIBUTION", everyone: false, levels: [], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] }

/**
 * Para quem: líder comum → só para si (sem escolha). Papel Report → público no escopo da atribuição (todos, níveis, cargos,
 * Grupos, Subgrupos, pessoas — combinados sem duplicar). Cada pessoa recebe só os dados que o escopo DELA alcança.
 */
export function AudienceFields({ audience, onChange, catalog, canCreateForSelf }: { audience: ReportAudience; onChange: (audience: ReportAudience) => void; catalog: ReportOptions; canCreateForSelf: boolean }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<AudiencePerson[]>([])
  const [chosen, setChosen] = useState<AudiencePerson[]>([])
  const distribution = audience.mode === "DISTRIBUTION" ? audience : null

  useEffect(() => {
    if (!catalog.audience || query.trim().length < 2) return
    const handle = setTimeout(() => void searchAudiencePeople(query.trim()).then(setResults).catch(() => setResults([])), 250)
    return () => clearTimeout(handle)
  }, [query, catalog.audience])

  if (!catalog.audience) return <p className="text-sm text-muted-foreground">Este report é para você: ele chega no seu Acompanhamento, com os dados da sua estrutura atual.</p>
  const set = (patch: Partial<Distribution>) => onChange({ ...(distribution ?? EMPTY), ...patch })
  const groups = catalog.audience
  return (
    <div className="space-y-4">
      <RadioGroup value={audience.mode} onValueChange={(mode) => onChange(mode === "SELF" ? { mode: "SELF" } : (distribution ?? { ...EMPTY, levels: ["SUPERVISOR"] }))} className="gap-1.5">
        {canCreateForSelf ? <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="SELF" />Só para mim</label> : null}
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="DISTRIBUTION" />Distribuir para outras pessoas{groups.scope.organizationWide ? "" : " (no seu escopo)"}</label>
      </RadioGroup>
      {distribution ? (
        <div className="grid gap-4 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Cada destinatário recebe a versão do SEU escopo (ex.: “a estrutura de quem recebe” vira a equipe de cada um). Quem não tiver acesso à estrutura do report fica de fora e aparece no histórico da execução.</p>
          <label className="flex items-center gap-2 text-sm"><Switch checked={distribution.everyone} onCheckedChange={(everyone) => set({ everyone })} />Todos os usuários elegíveis{groups.scope.organizationWide ? "" : " do seu escopo"}</label>
          <Field label="Níveis hierárquicos">
            <ChipToggleGroup ariaLabel="Níveis" options={PLATFORM_LEVELS.map((value) => ({ value, label: LEVEL_LABELS[value]! }))} selected={distribution.levels} onChange={(levels) => set({ levels: levels as Distribution["levels"] })} />
          </Field>
          <Field label="Cargos">
            <ChipToggleGroup ariaLabel="Cargos" options={groups.jobTitles.map((value) => ({ value, label: value }))} selected={distribution.jobTitles} onChange={(jobTitles) => set({ jobTitles })} empty="Nenhum cargo cadastrado no escopo." />
          </Field>
          <Field label="Grupos">
            <ChipToggleGroup ariaLabel="Grupos" options={groups.teams.map((team) => ({ value: team.id, label: team.name }))} selected={distribution.teamIds} onChange={(teamIds) => set({ teamIds })} />
          </Field>
          <Field label="Subgrupos">
            <ChipToggleGroup ariaLabel="Subgrupos" options={groups.subteams.map((subteam) => ({ value: subteam.id, label: subteam.name }))} selected={distribution.subteamIds} onChange={(subteamIds) => set({ subteamIds })} />
          </Field>
          <Field label="Pessoas específicas" hint="Digite ao menos 2 letras do nome.">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa" aria-label="Buscar pessoa" />
            {query.trim().length >= 2 && results.length > 0 ? (
              <ul className="mt-1 max-h-40 overflow-auto rounded-md border text-sm">
                {results.filter((person) => !distribution.personIds.includes(person.personId)).map((person) => (
                  <li key={person.personId}>
                    <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-muted" onClick={() => { setChosen([...chosen, person]); set({ personIds: [...distribution.personIds, person.personId] }); setQuery("") }}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</button>
                  </li>
                ))}
              </ul>
            ) : null}
            {distribution.personIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {distribution.personIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                    {chosen.find((person) => person.personId === id)?.name ?? "Pessoa selecionada"}
                    <button type="button" aria-label="Remover pessoa" onClick={() => set({ personIds: distribution.personIds.filter((item) => item !== id) })}><X className="size-3" aria-hidden /></button>
                  </span>
                ))}
              </div>
            ) : null}
          </Field>
        </div>
      ) : null}
    </div>
  )
}
