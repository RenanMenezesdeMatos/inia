"use client"

import { useId, useState } from "react"
import { Power, Users } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ApiError } from "@/lib/api/api-client"
import { cn } from "@/lib/utils"
import { useSaveSupportSettingsMutation, useSupportSettingsQuery } from "@/queries/human-support/use-human-support-admin"
import type { SettingsView } from "@/schemas/human-support/admin.schema"
import { IconBadge, SURFACE_CARD, toneSurface } from "@/components/ui/surface"

/** Capacidade de um Anjo: de 1 a 5 atendimentos ao mesmo tempo (Apêndice A). */
export const CAPACITY_OPTIONS = [1, 2, 3, 4, 5] as const

/**
 * Configuração › chave geral e capacidade padrão. O rascunho guarda a `version` que ele leu: salvar manda essa versão e, se outra
 * pessoa salvou nesse meio-tempo (409 `HUMAN_SUPPORT_CONCURRENT_CHANGE`), a tela explica, descarta o rascunho e mostra o valor atual.
 */
export function SettingsTab() {
  const query = useSupportSettingsQuery()
  const save = useSaveSupportSettingsMutation()
  const [draft, setDraft] = useState<SettingsView | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const switchId = useId()
  const capacityId = useId()

  if (query.isPending) return <Skeleton className="h-40 w-full rounded-xl" aria-label="Carregando a configuração" />
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />

  const saved = query.data
  const current = draft ?? saved
  const dirty = draft !== null && (draft.enabled !== saved.enabled || draft.defaultCapacity !== saved.defaultCapacity)
  const edit = (patch: Partial<Pick<SettingsView, "enabled" | "defaultCapacity">>) => {
    setConflict(false)
    setDraft({ ...(draft ?? saved), ...patch })
  }

  function submit() {
    if (!draft) return
    save.mutate(draft, {
      onSuccess: () => {
        setDraft(null)
        toast.success("Configuração salva.")
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === "HUMAN_SUPPORT_CONCURRENT_CHANGE") {
          // O valor atual chega pela recarga (a mutação invalida a configuração ao terminar).
          setDraft(null)
          setConflict(true)
          return
        }
        toast.error(error.message)
      },
    })
  }
  // Desligar a chave geral cancela os pedidos na fila da organização inteira: pede confirmação antes de salvar.
  const turningOff = dirty && saved.enabled && !current.enabled

  return (
    <div className={cn(SURFACE_CARD, "overflow-hidden")}>
      {conflict ? (
        <p role="alert" className={cn(toneSurface("warning"), "m-4 px-3 py-2 text-sm sm:m-5")}>
          A configuração foi alterada por outra pessoa enquanto você editava. Recarregamos os valores atuais: revise e salve de novo, se ainda for preciso.
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-4 px-4 py-5 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <IconBadge icon={Power} tone={current.enabled ? "success" : "neutral"} size="sm" />
          <div className="space-y-1">
          <Label htmlFor={switchId} className="text-sm font-semibold">Apoio com Anjo ligado</Label>
          <p className="text-sm text-muted-foreground">Chave geral da organização. Desligada, nenhum operador vê o apoio, seja qual for o estado de cada Grupo ou Subgrupo.</p>
          </div>
        </div>
        <Switch id={switchId} checked={current.enabled} onCheckedChange={(checked) => edit({ enabled: checked })} disabled={save.isPending} />
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <IconBadge icon={Users} tone="info" size="sm" />
          <div className="space-y-1">
          <Label htmlFor={capacityId} className="text-sm font-semibold">Capacidade padrão</Label>
          <p className="text-sm text-muted-foreground">Quantos atendimentos cada Anjo pode ter ao mesmo tempo, quando não tiver uma capacidade própria (aba Anjos). Reduzir não encerra atendimentos em andamento.</p>
          </div>
        </div>
        <Select value={String(current.defaultCapacity)} onValueChange={(value) => edit({ defaultCapacity: Number(value) })} disabled={save.isPending}>
          <SelectTrigger id={capacityId} className="w-full sm:w-40" aria-label="Capacidade padrão">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAPACITY_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} {option === 1 ? "atendimento" : "atendimentos"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-3 sm:px-5">
        {dirty ? <p className="mr-auto text-xs text-muted-foreground">Alterações não salvas.</p> : null}
        {dirty ? (
          <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => setDraft(null)} disabled={save.isPending}>
            Descartar
          </Button>
        ) : null}
        <Button type="button" className="rounded-full px-5" onClick={() => (turningOff ? setConfirmOff(true) : submit())} disabled={!dirty || save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desligar o Apoio com Anjo na organização?</AlertDialogTitle>
            <AlertDialogDescription>
              Os pedidos que estão na fila são cancelados e os operadores veem “O apoio com Anjo foi desativado para sua equipe”. Os atendimentos em andamento continuam até alguém encerrar. Pedidos novos são recusados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOff(false)
                submit()
              }}
            >
              Desligar e salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
