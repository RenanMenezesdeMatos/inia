"use client"

import { useId, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Route, Settings2, X } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { formatLatency, formatPerMillion, normalizeDecimalInput } from "@/lib/admin/ai-format"
import { cn } from "@/lib/utils"
import {
  useActivateAiRoutingDraftMutation,
  useAiCan,
  useAiModelsQuery,
  useAiRoutingQuery,
  useDeactivateAiRoutingPolicyMutation,
  useDiscardAiRoutingDraftMutation,
  useSaveAiRoutingDraftMutation,
  useTestAiRoutingMutation,
} from "@/queries/admin/use-ai-management-queries"
import {
  AI_AUTO_STRATEGIES,
  AI_AUTO_STRATEGY_LABELS,
  AI_CAPABILITY_LABELS,
  AI_DEFAULT_FALLBACK_ON,
  AI_FALLBACK_CATEGORIES,
  AI_FALLBACK_CATEGORY_LABELS,
  AI_ROUTING_MAX_MODELS,
  AI_ROUTING_MODE_DESCRIPTIONS,
  AI_ROUTING_MODE_LABELS,
  AI_ROUTING_MODES,
  CURRENCY_PATTERN,
  DECIMAL_PATTERN,
  modelIncompatibility,
  type AiAutoStrategy,
  type AiCapability,
  type AiModel,
  type AiPolicy,
  type AiRoutingMode,
  type LegacyRoute,
  type RoutingTestResult,
  type UseCaseRouting,
} from "@/schemas/admin/ai-management.schema"

import { CapabilityBadges, InfoCallout, ModelPriceCell } from "./ai-shared"

/**
 * Roteamento por Use Case: DRAFT → ACTIVE. O rascunho pode estar inválido; só um rascunho VÁLIDO
 * é ativado (o backend revalida). "Testar roteamento" monta o mesmo plano do runtime SEM chamada
 * paga. Desativar volta o Use Case, explicitamente, para a configuração legada do ambiente.
 */
function capabilityLabel(capability: string): string {
  return AI_CAPABILITY_LABELS[capability as AiCapability] ?? capability
}

function policyModelName(model: AiPolicy["models"][number]): string {
  return model.displayName ?? model.providerModelId ?? "Modelo removido"
}

export function RoutingTab() {
  const can = useAiCan()
  const canWrite = can("AI_CONFIG_WRITE")
  const routingQuery = useAiRoutingQuery()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const editing = editingKey ? (routingQuery.data?.find((item) => item.useCase.key === editingKey) ?? null) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roteamento por Use Case</CardTitle>
        <CardDescription>Qual modelo atende cada uso da INIA. Use Cases sem política ativa continuam na configuração legada do ambiente.</CardDescription>
      </CardHeader>
      <CardContent>
        {routingQuery.isPending ? (
          <ListSkeleton view="list" rows={6} />
        ) : routingQuery.isError ? (
          <ListErrorState message="Não foi possível carregar o roteamento." onRetry={() => routingQuery.refetch()} />
        ) : routingQuery.data.length === 0 ? (
          <ListEmptyState icon={Route} title="Nenhum Use Case" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Use Case</TableHead>
                  <TableHead>Modo</TableHead>
                  <TableHead>Primário</TableHead>
                  <TableHead>Fallback</TableHead>
                  <TableHead>Estratégia</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routingQuery.data.map((item) => (
                  <RoutingRow key={item.useCase.key} item={item} onEdit={() => setEditingKey(item.useCase.key)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <RoutingEditorSheet item={editing} canWrite={canWrite} onOpenChange={(open) => (open ? null : setEditingKey(null))} />
    </Card>
  )
}

export function RoutingStatus({ item }: { item: UseCaseRouting }) {
  if (!item.useCase.routable) return <Badge variant="outline">Não configurável nesta versão</Badge>
  return (
    <div className="flex flex-col items-start gap-1">
      {item.active ? (
        item.active.valid ? (
          <Badge variant="secondary">Política ativa</Badge>
        ) : (
          <>
            <Badge variant="destructive">Política ativa inválida</Badge>
            <ul className="text-xs text-destructive">
              {item.active.issues.map((issue) => (
                <li key={issue.code + (issue.modelId ?? "")}>{issue.message}</li>
              ))}
            </ul>
          </>
        )
      ) : (
        <Badge variant="outline">Configuração legada</Badge>
      )}
      {item.draft ? <Badge variant="outline">Rascunho{item.draft.valid ? "" : " inválido"}</Badge> : null}
    </div>
  )
}

function RoutingRow({ item, onEdit }: { item: UseCaseRouting; onEdit: () => void }) {
  const shown = item.active ?? item.draft
  const [primary, ...fallbacks] = shown?.models ?? []
  return (
    <TableRow data-testid={`routing-row-${item.useCase.key}`} className={item.active && !item.active.valid ? "bg-destructive/5" : undefined}>
      <TableCell className="max-w-72">
        <p className="font-medium">{item.useCase.label}</p>
        <p className="whitespace-normal text-xs text-muted-foreground">{item.useCase.description}</p>
        {!item.useCase.routable && item.useCase.notes ? <p className="whitespace-normal text-xs text-muted-foreground">{item.useCase.notes}</p> : null}
      </TableCell>
      <TableCell className="text-sm">{shown ? AI_ROUTING_MODE_LABELS[shown.mode] : <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="max-w-56 text-sm whitespace-normal">
        {primary ? policyModelName(primary) : item.legacy ? <span className="text-muted-foreground">{item.legacy.model} (legado)</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="max-w-56 text-sm whitespace-normal">{fallbacks.length > 0 ? fallbacks.map(policyModelName).join(" → ") : <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="text-sm">{shown?.strategy ? (AI_AUTO_STRATEGY_LABELS[shown.strategy as AiAutoStrategy] ?? shown.strategy) : <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell>
        <RoutingStatus item={item} />
      </TableCell>
      <TableCell className="text-right">
        {item.useCase.routable ? (
          <Button size="icon" variant="ghost" aria-label={`Configurar roteamento de ${item.useCase.label}`} onClick={onEdit}>
            <Settings2 className="h-4 w-4" />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------- Editor

function RoutingEditorSheet({ item, canWrite, onOpenChange }: { item: UseCaseRouting | null; canWrite: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        {item ? (
          <>
            <SheetHeader>
              <SheetTitle>{item.useCase.label}</SheetTitle>
              <SheetDescription>{item.useCase.description}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <RoutingEditor key={`${item.useCase.key}-${item.draft?.updatedAt ?? "none"}-${item.active?.id ?? "none"}`} item={item} canWrite={canWrite} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

type DraftState = { mode: AiRoutingMode; strategy: AiAutoStrategy | null; modelIds: string[]; fallbackOn: string[]; maxCost: string; costCurrency: string }

function initialDraft(item: UseCaseRouting): DraftState {
  const source = item.draft ?? item.active
  if (!source) return { mode: "PINNED", strategy: null, modelIds: [], fallbackOn: [...AI_DEFAULT_FALLBACK_ON], maxCost: "", costCurrency: "USD" }
  return {
    mode: source.mode,
    strategy: (source.strategy as AiAutoStrategy | null) ?? null,
    modelIds: source.models.map((model) => model.modelId),
    fallbackOn: source.fallbackOn,
    maxCost: source.maxEstimatedCostPerRequest ?? "",
    costCurrency: source.costCurrency ?? "USD",
  }
}

function sameDraft(left: DraftState, right: DraftState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Problemas detectáveis antes de salvar (o backend é a autoridade na ativação). */
function localIssues(draft: DraftState, models: AiModel[], required: readonly string[], requiresSpeechVoice: boolean): string[] {
  const issues: string[] = []
  if (draft.modelIds.length === 0) issues.push("Selecione ao menos um modelo.")
  if (draft.modelIds.length > AI_ROUTING_MAX_MODELS[draft.mode]) issues.push(`${AI_ROUTING_MODE_LABELS[draft.mode]} aceita no máximo ${AI_ROUTING_MAX_MODELS[draft.mode]} modelo(s).`)
  if (draft.mode === "AUTO" && !draft.strategy) issues.push("Escolha a estratégia do modo automático.")
  for (const id of draft.modelIds) {
    const model = models.find((item) => item.id === id)
    const reason = model ? modelIncompatibility(model, required, requiresSpeechVoice) : "modelo removido"
    if (reason) issues.push(`${model?.displayName ?? id}: ${reason}.`)
  }
  const maxCost = normalizeDecimalInput(draft.maxCost)
  if (maxCost && (!DECIMAL_PATTERN.test(maxCost) || !CURRENCY_PATTERN.test(draft.costCurrency))) issues.push("Limite de custo por requisição: informe um decimal e uma moeda de 3 letras.")
  return issues
}

export function RoutingEditor({ item, canWrite }: { item: UseCaseRouting; canWrite: boolean }) {
  const modelsQuery = useAiModelsQuery()
  const models = modelsQuery.data ?? []
  const saved = initialDraft(item)
  const [draft, setDraft] = useState<DraftState>(saved)
  const [testResult, setTestResult] = useState<RoutingTestResult | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const maxCostId = useId()
  const save = useSaveAiRoutingDraftMutation()
  const discard = useDiscardAiRoutingDraftMutation()
  const activate = useActivateAiRoutingDraftMutation()
  const deactivate = useDeactivateAiRoutingPolicyMutation()
  const test = useTestAiRoutingMutation()

  const required = item.useCase.requiredCapabilities
  const dirty = !sameDraft(draft, saved)
  // Sem rascunho, a configuração mostrada vem da política ativa: salvar cria o rascunho a partir dela.
  const canSaveDraft = dirty || (!item.draft && draft.modelIds.length > 0)
  const issues = localIssues(draft, models, required, item.useCase.requiresSpeechVoice)
  const max = AI_ROUTING_MAX_MODELS[draft.mode]
  const selectedModels = draft.modelIds.map((id) => ({ id, model: models.find((model) => model.id === id) ?? null }))
  const available = models.filter((model) => !draft.modelIds.includes(model.id))
  const canActivate = canWrite && item.draft !== null && item.draft.valid && !dirty
  const update = (patch: Partial<DraftState>) => setDraft((current) => ({ ...current, ...patch }))

  function move(index: number, delta: number) {
    const next = [...draft.modelIds]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved!)
    update({ modelIds: next })
  }

  function saveDraft() {
    const maxCost = normalizeDecimalInput(draft.maxCost)
    save.mutate(
      {
        useCase: item.useCase.key,
        mode: draft.mode,
        strategy: draft.mode === "AUTO" ? draft.strategy : null,
        modelIds: draft.modelIds,
        fallbackOn: draft.fallbackOn,
        maxEstimatedCostPerRequest: maxCost || null,
        costCurrency: maxCost ? draft.costCurrency : null,
      },
      { onSuccess: () => setTestResult(null) },
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Capacidades exigidas:</span>
          {required.length === 0 ? <span className="text-muted-foreground">nenhuma</span> : required.map((capability) => <Badge key={capability}>{capabilityLabel(capability)}</Badge>)}
          {item.useCase.preferredCapabilities.length > 0 ? (
            <span className="text-xs text-muted-foreground">desejáveis: {item.useCase.preferredCapabilities.map(capabilityLabel).join(", ")}</span>
          ) : null}
        </div>
        <RoutingStatus item={item} />
        <LegacyRouteLine legacy={item.legacy} />
      </section>

      <section className="space-y-2">
        <Label>Modo</Label>
        <Select value={draft.mode} disabled={!canWrite} onValueChange={(value) => update({ mode: value as AiRoutingMode, strategy: value === "AUTO" ? (draft.strategy ?? "BALANCED") : null })}>
          <SelectTrigger className="w-64" aria-label="Modo de roteamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_ROUTING_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {AI_ROUTING_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{AI_ROUTING_MODE_DESCRIPTIONS[draft.mode]}</p>
        {draft.mode === "AUTO" ? (
          <div className="space-y-1.5 pt-1">
            <Label>Estratégia</Label>
            <Select value={draft.strategy ?? undefined} disabled={!canWrite} onValueChange={(value) => update({ strategy: value as AiAutoStrategy })}>
              <SelectTrigger className="w-full sm:w-96" aria-label="Estratégia automática">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {AI_AUTO_STRATEGIES.map((strategy) => (
                  <SelectItem key={strategy} value={strategy}>
                    {AI_AUTO_STRATEGY_LABELS[strategy]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <Label>
          {draft.mode === "PINNED" ? "Modelo" : draft.mode === "FALLBACK_CHAIN" ? "Cadeia (em ordem)" : "Candidatos"} ({draft.modelIds.length}/{max})
        </Label>
        {selectedModels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum modelo selecionado.</p>
        ) : (
          <ol className="space-y-2" aria-label="Modelos da política">
            {selectedModels.map(({ id, model }, index) => {
              const reason = model ? modelIncompatibility(model, required, item.useCase.requiresSpeechVoice) : "Modelo removido"
              return (
                <li key={id} className={cn("flex items-start gap-2 rounded-lg border p-2", reason && "border-destructive/40")}>
                  <span className="mt-1 w-5 text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium">
                      {model?.displayName ?? id}
                      {model ? <span className="ml-1 font-normal text-muted-foreground">· {model.connectionName}</span> : null}
                    </p>
                    {model ? <CapabilityBadges capabilities={model.capabilities} highlight={required} /> : null}
                    {reason ? <p className="text-xs text-destructive">{reason}</p> : null}
                  </div>
                  {canWrite ? (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" aria-label={`Subir ${model?.displayName ?? id}`} disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Descer ${model?.displayName ?? id}`} disabled={index === selectedModels.length - 1} onClick={() => move(index, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Remover ${model?.displayName ?? id}`} onClick={() => update({ modelIds: draft.modelIds.filter((item) => item !== id) })}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
        {canWrite ? (
          <div className="space-y-1.5 pt-2">
            <p className="text-xs font-medium text-muted-foreground">Modelos disponíveis</p>
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground">{models.length === 0 ? "Nenhum modelo cadastrado — sincronize uma conexão ou cadastre um modelo." : "Todos os modelos já estão na política."}</p>
            ) : (
              <ul className="space-y-1.5" aria-label="Modelos disponíveis">
                {available.map((model) => {
                  const reason = modelIncompatibility(model, required, item.useCase.requiresSpeechVoice)
                  const full = draft.modelIds.length >= max
                  return (
                    <li key={model.id} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5", reason && "opacity-70")} data-testid={`available-model-${model.id}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          {model.displayName} <span className="text-muted-foreground">· {model.connectionName}</span>
                        </p>
                        {reason ? <p className="text-xs text-muted-foreground">Incompatível: {reason}</p> : <ModelPriceCell model={model} />}
                      </div>
                      <Button size="sm" variant="outline" aria-label={`Adicionar ${model.displayName}`} disabled={Boolean(reason) || full} onClick={() => update({ modelIds: [...draft.modelIds, model.id] })}>
                        <Plus /> Adicionar
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      {draft.mode !== "PINNED" ? (
        <section className="space-y-2">
          <Label>Tentar o próximo modelo quando houver</Label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {AI_FALLBACK_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  disabled={!canWrite}
                  checked={draft.fallbackOn.includes(category)}
                  onChange={(event) => update({ fallbackOn: event.target.checked ? [...draft.fallbackOn, category] : draft.fallbackOn.filter((item) => item !== category) })}
                />
                {AI_FALLBACK_CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
          {draft.fallbackOn.includes("AUTH") ? <InfoCallout tone="warn">Fallback em credencial recusada esconde uma chave inválida: as chamadas seguem por outro modelo e o problema pode passar despercebido. Prefira corrigir a credencial.</InfoCallout> : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <Label htmlFor={maxCostId}>Limite de custo estimado por requisição (opcional)</Label>
        <div className="flex gap-2">
          <Input id={maxCostId} inputMode="decimal" className="w-40" disabled={!canWrite} value={draft.maxCost} placeholder="ex.: 0.05" onChange={(event) => update({ maxCost: event.target.value })} />
          <Input aria-label="Moeda do limite" className="w-24 font-mono uppercase" maxLength={3} disabled={!canWrite} value={draft.costCurrency} onChange={(event) => update({ costCurrency: event.target.value.toUpperCase() })} />
        </div>
        <p className="text-xs text-muted-foreground">Só a entrada é estimável antes da chamada. Com limite ativo, modelos sem preço configurado deixam de ser candidatos.</p>
      </section>

      {issues.length > 0 ? (
        <InfoCallout tone="warn">
          {issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </InfoCallout>
      ) : null}
      {item.draft && !item.draft.valid ? (
        <div className="space-y-1 text-sm text-destructive" data-testid="draft-issues">
          <p className="font-medium">O rascunho salvo não pode ser ativado:</p>
          <ul className="list-disc pl-5">
            {item.draft.issues.map((issue) => (
              <li key={issue.code + (issue.modelId ?? "")}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {dirty && canWrite ? <p className="text-xs text-muted-foreground">Alterações não salvas — salve o rascunho para testar ou ativar.</p> : null}

      {canWrite ? (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" disabled={save.isPending || !canSaveDraft} onClick={saveDraft}>
            {save.isPending ? "Salvando..." : "Salvar rascunho"}
          </Button>
          <Button variant="outline" disabled={test.isPending || !item.draft || dirty} onClick={() => test.mutate({ useCase: item.useCase.key, source: "DRAFT" }, { onSuccess: setTestResult })}>
            Testar roteamento
          </Button>
          <Button disabled={!canActivate || activate.isPending} onClick={() => activate.mutate(item.useCase.key)}>
            Ativar
          </Button>
          {item.draft ? (
            <Button variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate(item.useCase.key)}>
              Descartar rascunho
            </Button>
          ) : null}
          {item.active ? (
            <>
              <Button variant="ghost" disabled={test.isPending} onClick={() => test.mutate({ useCase: item.useCase.key, source: "ACTIVE" }, { onSuccess: setTestResult })}>
                Testar política ativa
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDeactivate(true)}>
                Desativar política
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {testResult ? <RoutingTestResultView result={testResult} /> : null}

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar a política de {item.useCase.label}?</AlertDialogTitle>
            <AlertDialogDescription>O Use Case volta para a configuração legada do ambiente imediatamente. A política é arquivada (histórico preservado).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                deactivate.mutate(item.useCase.key)
                setConfirmDeactivate(false)
              }}
            >
              Desativar política
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function LegacyRouteLine({ legacy }: { legacy: LegacyRoute }) {
  if (!legacy) return <p className="text-xs text-muted-foreground">Configuração legada: sem rota legada para este Use Case.</p>
  return (
    <p className="text-xs text-muted-foreground" data-testid="legacy-route">
      Configuração legada (comparação): <span className="font-mono">{legacy.model}</span> · {legacy.providerKey} · tier {legacy.tier} · {legacy.mode}
    </p>
  )
}

function RoutingTestResultView({ result }: { result: RoutingTestResult }) {
  return (
    <section className="space-y-3 rounded-lg border p-3" data-testid="routing-test-result">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Resultado do teste ({result.source === "DRAFT" ? "rascunho" : result.source === "ACTIVE" ? "política ativa" : "legado"})</p>
        <Badge variant="outline">Nenhuma chamada paga</Badge>
        {result.budgetBlocked ? <Badge variant="destructive">Orçamento com limite rígido atingido</Badge> : null}
      </div>
      {result.selected ? (
        <p className="text-sm">
          Selecionado: <span className="font-medium">{result.selected.displayName}</span> ({result.selected.connectionName}) — motivo: {result.selected.reason}
        </p>
      ) : (
        <p className="text-sm text-destructive">Nenhum modelo elegível{result.source === "LEGACY" ? " — o Use Case usa a configuração legada." : "."}</p>
      )}
      {result.chain.length > 0 ? (
        <ol className="space-y-1 text-xs">
          {result.chain.map((candidate) => (
            <li key={candidate.modelId} className="rounded bg-muted/50 px-2 py-1">
              <span className="font-medium">
                {candidate.position + 1}. {candidate.displayName}
              </span>{" "}
              · {candidate.connectionName} · {candidate.reason} · capacidades: {candidate.capabilities.join(", ") || "nenhuma"} · preço: {candidate.pricing ? `${formatPerMillion(candidate.pricing.inputPerMillion, candidate.pricing.currency)} entrada, ${formatPerMillion(candidate.pricing.outputPerMillion, candidate.pricing.currency)} saída` : "sem preço"} · latência recente:{" "}
              {formatLatency(candidate.recentLatencyMs)}
            </li>
          ))}
        </ol>
      ) : null}
      {result.skipped.length > 0 ? (
        <div className="text-xs">
          <p className="font-medium">Descartados</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {result.skipped.map((skipped) => (
              <li key={skipped.modelId}>
                {skipped.displayName ?? skipped.modelId}: {skipped.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.notes.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {result.fallbackOn.length > 0 ? <p className="text-xs text-muted-foreground">Fallback em: {result.fallbackOn.map((category) => AI_FALLBACK_CATEGORY_LABELS[category as keyof typeof AI_FALLBACK_CATEGORY_LABELS] ?? category).join(", ")}</p> : null}
      <LegacyRouteLine legacy={result.legacy} />
    </section>
  )
}
