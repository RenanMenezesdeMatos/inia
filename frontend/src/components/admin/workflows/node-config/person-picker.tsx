"use client"

import { UserCombobox } from "@/components/admin/users/user-combobox"

/**
 * Escolher a pessoa pelo nome. Antes o campo pedia um id interno digitado, que ninguém sabe de cabeça e que o servidor só
 * recusava depois, com "Dados inválidos.". O backend continua conferindo a pessoa ao publicar.
 */
export function PersonPicker({ id, value, onChange }: { id?: string; value: string; onChange: (personId: string) => void }) {
  return <UserCombobox id={id} value={value} onChange={onChange} ariaLabel="Pessoa" />
}
