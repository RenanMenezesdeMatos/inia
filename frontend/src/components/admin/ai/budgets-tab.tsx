"use client"

import { useState } from "react"
import { Pencil, Plus, Trash2, Wallet } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { formatMoney, normalizeDecimalInput } from "@/lib/admin/ai-format"
import {
  useAiBudgetsQuery,
  useAiCan,
  useAiProvidersQuery,
  useAiUseCasesQuery,
  useCreateAiBudgetMutation,
  useDeleteAiBudgetMutation,
  useUpdateAiBudgetMutation,
} from "@/queries/admin/use-ai-management-queries"
import { AI_BUDGET_SCOPE_LABELS, AI_BUDGET_SCOPES, AI_DEFAULT_WARNING_THRESHOLDS, CURRENCY_PATTERN, DECIMAL_PATTERN, type AiBudget, type AiBudgetScope } from "@/schemas/admin/ai-management.schema"

import { InfoCallout } from "./ai-shared"
import { BudgetProgress } from "./overview-tab"

/**
 * Orçamentos mensais de IA: global, por Use Case ou por provider — sempre com MOEDA explícita.
 * Gasto em outra moeda aparece como "não comparável" (não há conversão). Limite rígido bloqueia
 * novas chamadas pagas do escopo quando o orçamento é atingido.
 */
export function BudgetsTab() {
  const can = useAiCan()
  const canWrite = can("AI_BUDGET_WRITE")
  const budgetsQuery = useAiBudgetsQuery()
  const [editing, setEditing] = useState<AiBudget | "new" | null>(null)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Orçamentos</CardTitle>
            <CardDescription>Limite mensal por escopo, na moeda informada. Sem conversão entre moedas.</CardDescription>
          </div>
          {canWrite ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Novo orçamento
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {budgetsQuery.isPending ? (
          <ListSkeleton view="list" rows={3} />
        ) : budgetsQuery.isError ? (
          <ListErrorState message="Não foi possível carregar os orçamentos." onRetry={() => budgetsQuery.refetch()} />
        ) : budgetsQuery.data.length === 0 ? (
          <ListEmptyState
            icon={Wallet}
            title="Nenhum orçamento"
            description="Sem orçamento, o gasto é só acompanhado. Configure um limite global ou por Use Case para receber alertas (70/90/100%)."
            action={
              canWrite ? (
                <Button onClick={() => setEditing("new")}>
                  <Plus /> Novo orçamento
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Escopo</TableHead>
                  <TableHead>Limite mensal</TableHead>
                  <TableHead>Alertas</TableHead>
                  <TableHead className="min-w-72">Consumo do mês</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetsQuery.data.map((budget) => (
                  <TableRow key={budget.id} className={budget.enabled ? undefined : "opacity-60"} data-testid={`budget-row-${budget.id}`}>
                    <TableCell>
                      <p className="font-medium">{budget.scopeLabel}</p>
                      <p className="text-xs text-muted-foreground">{AI_BUDGET_SCOPE_LABELS[budget.scope]}</p>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(budget.monthlyAmount, budget.currency)}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="font-mono">
                          {budget.currency}
                        </Badge>
                        {budget.hardLimit ? <Badge variant="destructive">Limite rígido</Badge> : <Badge variant="outline">Só alerta</Badge>}
                        {!budget.enabled ? <Badge variant="outline">Desabilitado</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{budget.warningThresholds.map((threshold) => `${threshold}%`).join(" · ")}</TableCell>
                    <TableCell>
                      <BudgetProgress budget={budget} />
                    </TableCell>
                    <TableCell>
                      {canWrite ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" aria-label={`Editar orçamento ${budget.scopeLabel}`} onClick={() => setEditing(budget)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <DeleteBudgetButton budget={budget} />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Novo orçamento" : "Editar orçamento"}</DialogTitle>
            <DialogDescription>O gasto só é comparado com custos na mesma moeda do orçamento.</DialogDescription>
          </DialogHeader>
          {editing !== null ? <BudgetForm key={editing === "new" ? "new" : editing.id} budget={editing === "new" ? null : editing} onDone={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function parseThresholds(raw: string): number[] | null {
  const parts = raw
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0 || parts.length > 5) return null
  const values = parts.map(Number)
  return values.every((value) => Number.isInteger(value) && value >= 1 && value <= 100) ? values : null
}

export function BudgetForm({ budget, onDone }: { budget: AiBudget | null; onDone: () => void }) {
  const create = useCreateAiBudgetMutation()
  const update = useUpdateAiBudgetMutation()
  const mutation = budget ? update : create
  const useCasesQuery = useAiUseCasesQuery()
  const providersQuery = useAiProvidersQuery()
  const [scope, setScope] = useState<AiBudgetScope>(budget?.scope ?? "GLOBAL")
  const [scopeKey, setScopeKey] = useState(budget?.scopeKey ?? "")
  const [currency, setCurrency] = useState(budget?.currency ?? "USD")
  const [amount, setAmount] = useState(budget?.monthlyAmount ?? "")
  const [thresholds, setThresholds] = useState((budget?.warningThresholds ?? AI_DEFAULT_WARNING_THRESHOLDS).join(", "))
  const [hardLimit, setHardLimit] = useState(budget?.hardLimit ?? false)
  const [enabled, setEnabled] = useState(budget?.enabled ?? true)

  const normalizedAmount = normalizeDecimalInput(amount)
  const parsedThresholds = parseThresholds(thresholds)
  const valid = CURRENCY_PATTERN.test(currency) && DECIMAL_PATTERN.test(normalizedAmount) && Number(normalizedAmount) > 0 && parsedThresholds !== null && (scope === "GLOBAL" || scopeKey !== "")
  const useCases = (useCasesQuery.data ?? []).filter((useCase) => !useCase.internal)

  async function handleSubmit() {
    const input = { scope, scopeKey: scope === "GLOBAL" ? null : scopeKey, currency, monthlyAmount: normalizedAmount, warningThresholds: parsedThresholds ?? AI_DEFAULT_WARNING_THRESHOLDS, hardLimit, enabled }
    if (budget) await update.mutateAsync({ id: budget.id, ...input })
    else await create.mutateAsync(input)
    onDone()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Escopo</Label>
        <Select
          value={scope}
          onValueChange={(value) => {
            setScope(value as AiBudgetScope)
            setScopeKey("")
          }}
        >
          <SelectTrigger className="w-full" aria-label="Escopo do orçamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_BUDGET_SCOPES.map((item) => (
              <SelectItem key={item} value={item}>
                {AI_BUDGET_SCOPE_LABELS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {scope === "USE_CASE" ? (
        <div className="space-y-1.5">
          <Label>Use Case</Label>
          <Select value={scopeKey || undefined} onValueChange={setScopeKey}>
            <SelectTrigger className="w-full" aria-label="Use Case do orçamento">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {useCases.map((useCase) => (
                <SelectItem key={useCase.key} value={useCase.key}>
                  {useCase.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {scope === "PROVIDER" ? (
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={scopeKey || undefined} onValueChange={setScopeKey}>
            <SelectTrigger className="w-full" aria-label="Provider do orçamento">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {(providersQuery.data ?? []).map((provider) => (
                <SelectItem key={provider.key} value={provider.key}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-budget-currency">Moeda</Label>
          <Input id="ai-budget-currency" className="font-mono uppercase" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ai-budget-amount">Valor mensal</Label>
          <Input id="ai-budget-amount" inputMode="decimal" value={amount} placeholder="ex.: 500.00" onChange={(event) => setAmount(event.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-budget-thresholds">Alertas em (% do orçamento)</Label>
        <Input id="ai-budget-thresholds" value={thresholds} onChange={(event) => setThresholds(event.target.value)} />
        <p className="text-xs text-muted-foreground">Inteiros de 1 a 100, separados por vírgula (padrão 70, 90, 100). Cada limiar atingido gera um alerta no sino.</p>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Switch id="ai-budget-hard" checked={hardLimit} onCheckedChange={setHardLimit} />
          <Label htmlFor="ai-budget-hard">Limite rígido</Label>
        </div>
        <InfoCallout tone={hardLimit ? "warn" : "info"}>
          {hardLimit ? "Ao atingir 100%, novas chamadas pagas deste escopo são bloqueadas com AI_BUDGET_EXCEEDED até o mês virar ou o limite ser ajustado. Modelos locais não são bloqueados (sem custo de API); modelo remoto só escapa do bloqueio com preço zero configurado — remoto sem preço conta como pago. O bloqueio compara o gasto já registrado (atualizado a cada ~15 s) antes de cada chamada — chamadas simultâneas ou em andamento podem ultrapassar o limite levemente; não é uma reserva de saldo." : "Sem limite rígido o orçamento só gera alertas — nenhuma chamada é bloqueada."}
        </InfoCallout>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="ai-budget-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="ai-budget-enabled">{enabled ? "Habilitado" : "Desabilitado"}</Label>
      </div>
      <p className="text-xs text-muted-foreground">Não há conversão de moeda: gasto em outras moedas aparece como &quot;não comparável&quot;.</p>
      {mutation.isError ? <p className="text-sm text-destructive">{(mutation.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          disabled={!valid || mutation.isPending}
          onClick={async () => {
            try {
              await handleSubmit()
            } catch {
              // erro exibido acima
            }
          }}
        >
          {mutation.isPending ? "Salvando..." : "Salvar orçamento"}
        </Button>
      </div>
    </div>
  )
}

function DeleteBudgetButton({ budget }: { budget: AiBudget }) {
  const remove = useDeleteAiBudgetMutation()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="icon" variant="ghost" aria-label={`Excluir orçamento ${budget.scopeLabel}`} onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir o orçamento {budget.scopeLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            O limite de {formatMoney(budget.monthlyAmount, budget.currency)} deixa de existir{budget.hardLimit ? " e as chamadas deste escopo deixam de ser bloqueadas" : ""}. O histórico de uso não é afetado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(budget.id)
              setOpen(false)
            }}
          >
            Excluir
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
