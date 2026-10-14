"use client"

import { useId, useState } from "react"
import { Link2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePatternOptionsQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { PatternOption } from "@/schemas/admin/intervention-policy.schema"

import { KeyChipsInput } from "../shared/fields"

const BEHAVIOR_KEY_PATTERN = /^[A-Z][A-Z_]{1,30}:[A-Z0-9_]{1,60}$/
const isBaseKey = (key: string) => key.startsWith("KP-") || key.startsWith("KC-")

/**
 * Ligação da competência com o diagnóstico PELO NOME: busca práticas e critérios da base de conhecimento e vincula o escolhido
 * (a chave técnica fica por trás). Comportamentos de estratégia de diagnóstico (CHAVE:VALOR) ficam num campo avançado.
 */
export function PatternPicker({ practiceKeys, criterionKeys, disabled, onChange }: { practiceKeys: string[]; criterionKeys: string[]; disabled: boolean; onChange: (next: { practiceKeys: string[]; criterionKeys: string[] }) => void }) {
  const searchId = useId()
  const [search, setSearch] = useState("")
  const selectedBaseKeys = [...practiceKeys.filter(isBaseKey), ...criterionKeys]
  const query = usePatternOptionsQuery(search, selectedBaseKeys)
  const known = new Map((query.data ?? []).map((option) => [option.key, option]))
  const behaviors = practiceKeys.filter((key) => !isBaseKey(key))
  const results = search.trim().length >= 2 ? (query.data ?? []).filter((option) => !selectedBaseKeys.includes(option.key)).slice(0, 12) : []

  const add = (option: PatternOption) =>
    option.kind === "PRACTICE" ? onChange({ practiceKeys: [...practiceKeys, option.key], criterionKeys }) : onChange({ practiceKeys, criterionKeys: [...criterionKeys, option.key] })
  const remove = (key: string) => onChange({ practiceKeys: practiceKeys.filter((item) => item !== key), criterionKeys: criterionKeys.filter((item) => item !== key) })

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Práticas e critérios vinculados</p>
        {selectedBaseKeys.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum. Busque abaixo pelo nome da prática ou do critério.</p> : null}
        <ul className="space-y-1">
          {selectedBaseKeys.map((key) => {
            const option = known.get(key)
            return (
              <li key={key} className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
                <span>
                  {option?.title ?? (query.isPending ? "Carregando…" : "Não existe mais na base")}
                  <span className="block text-xs text-muted-foreground">
                    {key.startsWith("KP-") ? "Prática" : "Critério"}
                    {option?.detail ? ` · ${option.detail}` : ""}
                  </span>
                </span>
                {disabled ? null : (
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Desvincular ${option?.title ?? key}`} onClick={() => remove(key)}>
                    <X />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      {disabled ? null : (
        <div className="space-y-1.5">
          <Label htmlFor={searchId} className="text-xs">
            Buscar prática ou critério da base
          </Label>
          <Input id={searchId} type="search" value={search} placeholder="Ex.: espera, entendimento, protocolo" onChange={(event) => setSearch(event.target.value)} />
          {search.trim().length >= 2 ? (
            <ul className="space-y-1">
              {results.map((option) => (
                <li key={option.key} className="flex items-start justify-between gap-2 text-sm">
                  <span>
                    {option.title}
                    <span className="block text-xs text-muted-foreground">
                      {option.kind === "PRACTICE" ? "Prática" : "Critério"}
                      {option.detail ? ` · ${option.detail}` : ""}
                    </span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => add(option)}>
                    <Link2 /> Vincular
                  </Button>
                </li>
              ))}
              {query.isSuccess && results.length === 0 ? <li className="text-xs text-muted-foreground">Nada encontrado.</li> : null}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Digite pelo menos 2 letras.</p>
          )}
        </div>
      )}
      <Collapsible>
        <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">Avançado: comportamentos de estratégia de diagnóstico{behaviors.length > 0 ? ` (${behaviors.length})` : ""}</CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <KeyChipsInput
            label="Comportamentos"
            values={behaviors}
            pattern={BEHAVIOR_KEY_PATTERN}
            placeholder="CHAVE:VALOR"
            hint="Chave de comportamento definida numa estratégia de diagnóstico de indicador."
            disabled={disabled}
            onChange={(next) => onChange({ practiceKeys: [...practiceKeys.filter(isBaseKey), ...next], criterionKeys })}
          />
        </CollapsibleContent>
      </Collapsible>
      {selectedBaseKeys.length > 0 ? (
        <Badge variant="outline" className="font-normal">
          {selectedBaseKeys.length} vínculo(s): um diagnóstico sustentado com algum deles aponta para esta competência
        </Badge>
      ) : null}
    </div>
  )
}
