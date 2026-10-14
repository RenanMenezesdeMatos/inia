"use client"

import { useId, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { FlaskConical } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { PolicySimulationView } from "@/components/interventions/policy-simulation-view"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useSimulationPeopleQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { PolicyView } from "@/schemas/admin/intervention-policy.schema"
import { simulatePolicy } from "@/services/admin/intervention-policy-service"

import { Note, OptionSelect } from "../shared/fields"
import { errorCode, errorMessage, localDateTimeToIso } from "../shared/helpers"
import { SIMULATION_MODE_LABELS } from "../shared/labels"

type SimulationMode = "RECOMMEND_ONLY" | "APPLY_POLICY"

/**
 * Simular a política com um colaborador real, SEM efeitos (banco somente leitura no backend): nada é gravado, nenhuma
 * intervenção é aberta, ninguém é avisado. Simular exige já enxergar a pessoa por outra concessão — configurar não dá acesso.
 */
export function PolicySimulationPanel({ policy }: { policy: PolicyView }) {
  const searchId = useId()
  const asOfId = useId()
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search.trim(), 300)
  const peopleQuery = useSimulationPeopleQuery(debounced)
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null)
  const [asOf, setAsOf] = useState("")
  const versionOptions = [
    ...(policy.draft ? [{ value: "DRAFT", label: `Rascunho (v${policy.draft.version}, como está salvo)` }] : []),
    ...(policy.inForce ? [{ value: "IN_FORCE", label: "Em vigor na data de referência" }] : []),
    ...policy.versions.filter((version) => version.status === "PUBLISHED").map((version) => ({ value: version.id, label: `Versão ${version.version}${version.effectiveFrom ? ` · vigência ${formatDateTime(version.effectiveFrom)}` : ""}` })),
  ]
  const [version, setVersion] = useState<string>(versionOptions[0]?.value ?? "IN_FORCE")
  const [mode, setMode] = useState<SimulationMode>("APPLY_POLICY")
  const simulation = useMutation({ mutationFn: () => simulatePolicy(policy.id, { personId: person!.id, asOf: localDateTimeToIso(asOf), version, mode }) })
  const people = peopleQuery.data ?? []

  return (
    <div className="space-y-4">
      <Note>Sem efeitos: nada é gravado, nenhuma intervenção é aberta e ninguém é avisado. Só aparecem colaboradores que você já pode consultar (sua estrutura, Indicadores ou Workflows no seu escopo) — configurar políticas não dá acesso a ninguém.</Note>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={searchId} className="text-xs">
            Colaborador
          </Label>
          <Input id={searchId} type="search" value={search} placeholder="Buscar pelo nome" onChange={(event) => setSearch(event.target.value)} />
          <div className="max-h-48 overflow-y-auto rounded-md border" role="listbox" aria-label="Colaboradores para simular">
            {peopleQuery.isPending ? <p className="p-2 text-xs text-muted-foreground">Carregando…</p> : null}
            {!peopleQuery.isPending && people.length === 0 ? <p className="p-2 text-xs text-muted-foreground">{debounced ? "Ninguém com esse nome no seu escopo." : "Nenhum colaborador no seu escopo."}</p> : null}
            {people.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={person?.id === candidate.id}
                onClick={() => setPerson({ id: candidate.id, name: candidate.name })}
                className={cn("block w-full px-2 py-1.5 text-left text-sm hover:bg-muted", person?.id === candidate.id && "bg-muted font-medium")}
              >
                {candidate.name}
                {candidate.teamName ? <span className="text-xs text-muted-foreground"> · {candidate.teamName}</span> : null}
              </button>
            ))}
          </div>
          {person ? <p className="text-xs text-muted-foreground">Selecionado: {person.name}</p> : null}
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={asOfId} className="text-xs">
              Data e hora de referência (opcional)
            </Label>
            <Input id={asOfId} type="datetime-local" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
            <p className="text-xs text-muted-foreground">Vazio = agora. As janelas das condições terminam neste instante.</p>
          </div>
          <OptionSelect label="Versão" value={version} options={versionOptions} onChange={setVersion} />
          <RadioGroup value={mode} onValueChange={(value) => setMode(value as SimulationMode)} className="space-y-1" aria-label="Modo">
            {(["RECOMMEND_ONLY", "APPLY_POLICY"] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <RadioGroupItem value={value} className="mt-0.5" />
                <span>
                  {SIMULATION_MODE_LABELS[value].title}
                  <span className="block text-xs text-muted-foreground">{SIMULATION_MODE_LABELS[value].description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
      </div>
      <Button size="sm" disabled={!person || versionOptions.length === 0 || simulation.isPending} onClick={() => simulation.mutate()}>
        <FlaskConical /> {simulation.isPending ? "Simulando…" : "Simular"}
      </Button>
      {versionOptions.length === 0 ? <p className="text-xs text-muted-foreground">Não há versão para simular.</p> : null}
      {simulation.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {errorCode(simulation.error) === "PERSON_NOT_FOUND" ? "Colaborador não encontrado no seu escopo: para simular, você precisa já enxergar esta pessoa." : errorMessage(simulation.error, "Não foi possível simular.")}
        </p>
      ) : null}
      {simulation.data ? <PolicySimulationView result={simulation.data} /> : null}
    </div>
  )
}
