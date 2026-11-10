"use client"

import { useState } from "react"
import { AlertTriangle, Network } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useSaveSupportScopeMutation, useSupportScopesQuery } from "@/queries/human-support/use-human-support-admin"
import { effectiveScopeText, SCOPE_STATE_LABELS, SCOPE_STATES, type ScopeNode, type ScopeState } from "@/schemas/human-support/admin.schema"

import type { ScopeFilterValue } from "./scope-filter"

type PendingChange = { node: ScopeNode; parent: ScopeNode | null; state: ScopeState }

/** O efetivo depois da troca (a mesma regra do servidor): Ligado/Desligado próprio vence; Herdar segue o Grupo; Grupo herdando = desligado. */
function effectiveAfter(change: PendingChange): boolean {
  if (change.node.effectiveSource === "MASTER_OFF") return false
  if (change.state === "ON") return true
  if (change.state === "OFF") return false
  return change.parent ? change.parent.effective : false
}

const anjoCountText = (count: number) => (count === 0 ? "Nenhum Anjo" : count === 1 ? "1 Anjo" : `${count} Anjos`)

/**
 * Escopos › árvore Grupo › Subgrupos: estado gravado (Herdar/Ligado/Desligado), o efetivo e de onde ele vem, quantos Anjos atendem e o
 * alerta "Ligado sem Anjo". Uma troca que desliga um escopo hoje ligado pede confirmação: a fila daquele escopo é cancelada na hora,
 * os atendimentos em andamento continuam.
 */
export function ScopesTab({ onShowAnjos }: { onShowAnjos: (filter: ScopeFilterValue) => void }) {
  const query = useSupportScopesQuery()
  const save = useSaveSupportScopeMutation()
  const [confirming, setConfirming] = useState<PendingChange | null>(null)

  if (query.isPending) return <Skeleton className="h-60 w-full rounded-xl" aria-label="Carregando os escopos" />
  if (query.isError) return <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.length === 0) return <AnalyticsEmptyState icon={Network} title="Nenhum Grupo cadastrado" description="Os Grupos e Subgrupos vêm da estrutura da organização." />

  const masterOff = query.data.some((node) => node.effectiveSource === "MASTER_OFF")

  function apply(change: PendingChange) {
    save.mutate(
      { scopeType: change.node.type === "GROUP" ? "group" : "subgroup", id: change.node.id, state: change.state },
      { onSuccess: (node) => toast.success(`${node.name}: ${effectiveScopeText(node)}.`), onError: (error) => toast.error(error.message) },
    )
  }
  function request(change: PendingChange) {
    if (change.state === change.node.state) return
    if (change.node.effective && !effectiveAfter(change)) setConfirming(change)
    else apply(change)
  }

  const inheritingChildren = confirming && confirming.node.type === "GROUP" ? (confirming.node.children ?? []).filter((child) => child.effective && child.effectiveSource === "GROUP") : []

  return (
    <div className="space-y-3">
      {masterOff ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          A chave geral está desligada (aba Configuração): nenhum escopo está ligado agora. Os estados abaixo passam a valer quando ela for ligada.
        </p>
      ) : null}
      <div className={TABLE_FRAME}>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Grupo › Subgrupo</TableHead>
              <TableHead className="w-40">Estado</TableHead>
              <TableHead>Efetivo</TableHead>
              <TableHead>Anjos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.flatMap((group) => [
              <ScopeRow key={group.id} node={group} parent={null} disabled={save.isPending} onChange={request} onShowAnjos={() => onShowAnjos({ teamId: group.id })} />,
              ...(group.children ?? []).map((child) => (
                <ScopeRow key={child.id} node={child} parent={group} disabled={save.isPending} onChange={request} onShowAnjos={() => onShowAnjos({ teamId: group.id, subteamId: child.id })} />
              )),
            ])}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => (!open ? setConfirming(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desligar o apoio em {confirming?.node.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os pedidos que estão na fila {inheritingChildren.length > 0 ? `deste Grupo e dos Subgrupos que herdam dele (${inheritingChildren.map((child) => child.name).join(", ")})` : "deste escopo"} são cancelados, e os operadores veem “O apoio com Anjo foi desativado para sua equipe”. Os atendimentos em andamento continuam até alguém encerrar. Pedidos novos são recusados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirming) apply(confirming)
                setConfirming(null)
              }}
            >
              Desligar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ScopeRow({ node, parent, disabled, onChange, onShowAnjos }: { node: ScopeNode; parent: ScopeNode | null; disabled: boolean; onChange: (change: PendingChange) => void; onShowAnjos: () => void }) {
  const withoutAnjo = node.warnings.includes("ENABLED_WITHOUT_ANJO")
  return (
    <TableRow data-testid={`scope-${node.id}`} className={cn(!parent && "bg-muted/25")}>
      <TableCell className={cn("whitespace-normal", parent ? "pl-8 text-muted-foreground" : "font-medium")}>
        {parent ? <span className="sr-only">{parent.name} › </span> : null}
        {node.name}
        {parent ? null : <span className="ml-2 text-xs font-normal text-muted-foreground">Grupo</span>}
      </TableCell>
      <TableCell>
        <Select value={node.state} onValueChange={(state) => onChange({ node, parent, state: state as ScopeState })} disabled={disabled}>
          <SelectTrigger className="w-full" aria-label={`Estado de ${node.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {state === "INHERIT" && node.type === "GROUP" ? "Herdar (desligado)" : SCOPE_STATE_LABELS[state]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", node.effective ? "bg-emerald-500" : "bg-muted-foreground/40")} />
          {effectiveScopeText(node)}
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onShowAnjos}>
            {anjoCountText(node.anjoCount)}
          </Button>
          {withoutAnjo ? (
            <Badge variant="destructive" title="Operadores deste escopo veem o apoio, mas ninguém com o papel Anjo atende aqui.">
              <AlertTriangle data-icon="inline-start" aria-hidden />
              Ligado sem Anjo
            </Badge>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}
