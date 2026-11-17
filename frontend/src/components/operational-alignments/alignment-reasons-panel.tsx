"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { SectionLabel } from "@/components/ui/surface"
import { Switch } from "@/components/ui/switch"
import {
  useAlignmentReasonsQuery,
  useAlignmentScopeOptionsQuery,
  useCreateReasonMutation,
  useCreateRequestReasonMutation,
  useRequestReasonsQuery,
  useUpdateReasonMutation,
} from "@/queries/operational-alignments/use-operational-alignment-queries"

function AddRow({ label, placeholder, onAdd, pending }: { label: string; placeholder: string; onAdd: (name: string) => Promise<unknown>; pending: boolean }) {
  const [name, setName] = useState("")
  const add = async () => {
    if (name.trim().length < 2) return
    await onAdd(name.trim())
    setName("")
  }
  return (
    <div className="flex gap-2">
      <Input aria-label={label} value={name} onChange={(event) => setName(event.target.value)} placeholder={placeholder} onKeyDown={(event) => (event.key === "Enter" ? void add() : undefined)} />
      <Button type="button" variant="outline" disabled={pending || name.trim().length < 2} onClick={() => void add()}><Plus className="size-4" />Incluir</Button>
    </div>
  )
}

/**
 * MOTIVOS (213): o motivo do ALINHAMENTO (catálogo da organização: incluir, renomear, desativar — desativado deixa de ser oferecido, mas
 * continua nos registros e nos indicadores) e o motivo do PEDIDO DO CLIENTE (os assuntos canônicos das chamadas: incluir). Manter as
 * listas exige administrar alinhamentos na organização inteira; o backend confere.
 */
export function AlignmentReasonsPanel() {
  const scope = useAlignmentScopeOptionsQuery()
  const reasons = useAlignmentReasonsQuery()
  const requestReasons = useRequestReasonsQuery()
  const createReason = useCreateReasonMutation()
  const updateReason = useUpdateReasonMutation()
  const createRequest = useCreateRequestReasonMutation()
  const canEdit = Boolean(scope.data?.universe)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="grid content-start gap-3">
        <SectionLabel>Motivo do alinhamento</SectionLabel>
        <p className="text-sm text-muted-foreground">Por que a operação mudou antes da base oficial. Obrigatório em cada alinhamento.</p>
        {canEdit ? <AddRow label="Novo motivo do alinhamento" placeholder="Ex.: Mudança de fornecedor" pending={createReason.isPending} onAdd={(name) => createReason.mutateAsync(name)} /> : null}
        {reasons.isLoading ? <LoadingState rows={3} /> : reasons.isError ? <ErrorState message="Não foi possível carregar os motivos." onRetry={() => reasons.refetch()} /> : (
          <ul className="grid gap-1.5" aria-label="Motivos do alinhamento">
            {(reasons.data ?? []).map((reason) => (
              <li key={reason.id} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
                {editing?.id === reason.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); updateReason.mutate({ id: reason.id, input: { name: editing.name } }, { onSuccess: () => setEditing(null) }) }}>
                    <Input aria-label={`Novo nome de ${reason.name}`} value={editing.name} onChange={(event) => setEditing({ id: reason.id, name: event.target.value })} />
                    <Button type="submit" size="sm" disabled={editing.name.trim().length < 2}>Salvar</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">{reason.name}</span>
                    <Badge variant="outline">{reason.uses} {reason.uses === 1 ? "alinhamento" : "alinhamentos"}</Badge>
                    {canEdit ? <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ id: reason.id, name: reason.name })}>Renomear</Button> : null}
                    <Switch checked={reason.active} disabled={!canEdit} aria-label={`${reason.active ? "Desativar" : "Ativar"} ${reason.name}`} onCheckedChange={(active) => updateReason.mutate({ id: reason.id, input: { active } })} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid content-start gap-3">
        <SectionLabel>Pedidos do cliente relacionados</SectionLabel>
        <p className="text-sm text-muted-foreground">Os assuntos dos atendimentos a que um alinhamento se relaciona — os mesmos com que as chamadas são classificadas. Um assunto incluído aqui serve aos alinhamentos; as chamadas só passam a usá-lo quando a carga de assuntos trouxer o de-para.</p>
        {canEdit ? <AddRow label="Novo pedido do cliente" placeholder="Ex.: Mudança de endereço" pending={createRequest.isPending} onAdd={(name) => createRequest.mutateAsync(name)} /> : null}
        {requestReasons.isLoading ? <LoadingState rows={3} /> : requestReasons.isError ? <ErrorState message="Não foi possível carregar os pedidos do cliente." onRetry={() => requestReasons.refetch()} /> : (
          <ul className="flex flex-wrap gap-1.5" aria-label="Pedidos do cliente relacionados">
            {(requestReasons.data ?? []).map((reason) => <li key={reason.id}><Badge variant="secondary">{reason.name}</Badge></li>)}
          </ul>
        )}
      </section>
      {!canEdit ? <p className="text-xs text-muted-foreground lg:col-span-2">Manter as listas é de quem administra alinhamentos na organização inteira.</p> : null}
    </div>
  )
}
