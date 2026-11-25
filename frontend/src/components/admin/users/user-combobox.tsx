"use client"

import { RemoteCombobox, RemoteComboboxTrigger, remoteListOf, useRemoteCombobox } from "@/components/ui/remote-combobox"
import { useUserOptionQuery, useUserOptionsInfiniteQuery, type UserOptionsSearch } from "@/queries/admin/use-user-account-queries"
import type { UserAccount } from "@/schemas/admin/user-account.schema"
import { ROLE_LABELS } from "@/schemas/auth/auth.schema"

const detailsOf = (person: UserAccount) => [person.jobPositionName ?? ROLE_LABELS[person.role], [person.teamName, person.subteamName].filter(Boolean).join(" › ")].filter(Boolean).join(" · ")

/**
 * CAMPO DE UMA PESSOA DO CADASTRO (`people.manage`) com busca no servidor (nome, e-mail ou matrícula) e carregamento em lotes, dentro do
 * escopo de quem edita. A escolhida aparece no gatilho mesmo fora do lote atual; a que saiu do cadastro ativo fica dita.
 */
export function UserCombobox({ value, onChange, filter = {}, placeholder = "Selecione a pessoa", disabledReason, id, ariaLabel }: { value: string; onChange: (personId: string) => void; filter?: Omit<UserOptionsSearch, "search" | "active">; placeholder?: string; disabledReason?: (person: UserAccount) => string | null; id?: string; ariaLabel?: string }) {
  const state = useRemoteCombobox()
  const query = useUserOptionsInfiniteQuery({ ...filter, active: true, search: state.term || undefined }, state.open)
  const chosen = useUserOptionQuery(value)
  const label = !value ? null : chosen.data?.active ? chosen.data.name : chosen.isPending ? "Carregando…" : chosen.isError ? "Pessoa escolhida" : "Pessoa não encontrada ou inativa"
  return (
    <RemoteCombobox
      state={state}
      list={remoteListOf(query)}
      listLabel="Pessoas"
      searchLabel="Buscar pessoa por nome, e-mail ou matrícula"
      searchPlaceholder="Buscar por nome, e-mail ou matrícula"
      emptyText="Ninguém disponível neste recorte."
      optionOf={(person) => ({ id: person.id, label: person.name, details: detailsOf(person), selected: person.id === value, disabledReason: disabledReason?.(person) ?? null })}
      onSelect={(person) => onChange(person.id)}
      trigger={<RemoteComboboxTrigger id={id} label={label} placeholder={placeholder} aria-label={ariaLabel} />}
    />
  )
}
