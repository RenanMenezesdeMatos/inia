"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useUserAccountsQuery } from "@/queries/admin/use-user-account-queries"
import { ROLE_LABELS } from "@/schemas/auth/auth.schema"

const VISIBLE_RESULTS = 30

/** A busca desconsidera maiúsculas e acentos: "joao" encontra "João". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}

/**
 * Escolher a pessoa pelo nome. Antes o campo pedia um id interno digitado, que ninguém sabe de cabeça e que o servidor só
 * recusava depois, com "Dados inválidos.". O backend continua conferindo a pessoa ao publicar.
 */
export function PersonPicker({ id, value, onChange }: { id?: string; value: string; onChange: (personId: string) => void }) {
  const peopleQuery = useUserAccountsQuery()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const people = useMemo(() => (peopleQuery.data ?? []).filter((person) => person.active), [peopleQuery.data])
  const selected = people.find((person) => person.id === value)
  const results = useMemo(() => {
    const term = normalize(search.trim())
    const matches = term ? people.filter((person) => normalize(person.name).includes(term) || normalize(person.email ?? "").includes(term)) : people
    return matches.slice(0, VISIBLE_RESULTS)
  }, [people, search])

  const triggerText = selected ? selected.name : value && peopleQuery.data ? "Pessoa não encontrada ou inativa" : "Selecione a pessoa"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
        <Input autoFocus aria-label="Buscar pessoa por nome ou e-mail" placeholder="Buscar por nome ou e-mail" value={search} onChange={(event) => setSearch(event.target.value)} />
        {peopleQuery.isError ? (
          <p className="p-2 text-sm text-destructive">Não foi possível carregar as pessoas.</p>
        ) : peopleQuery.isLoading ? (
          <p className="p-2 text-sm text-muted-foreground">Carregando…</p>
        ) : results.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Ninguém encontrado com esse nome.</p>
        ) : (
          <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto" aria-label="Pessoas encontradas">
            {results.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  aria-current={person.id === value || undefined}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    onChange(person.id)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[ROLE_LABELS[person.role], person.teamName].filter(Boolean).join(" · ")}</span>
                  </span>
                  {person.id === value ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
