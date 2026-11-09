"use client"

import { useState, type ReactNode } from "react"
import { FlaskConical, Plus, Server, Settings2, Trash2 } from "lucide-react"

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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatAiDateTime, formatCount, formatLatency, formatMoney, formatPerMillion, formatTokens, LOCAL_API_COST_ZERO_LABEL, normalizeDecimalInput, parseOptionalInt } from "@/lib/admin/ai-format"
import {
  useAddAiModelPricingMutation,
  useAiCan,
  useAiConnectionsQuery,
  useAiModelPricingQuery,
  useAiModelsQuery,
  useCreateAiModelMutation,
  useDeleteAiModelMutation,
  useTestAiModelMutation,
  useUpdateAiModelMutation,
} from "@/queries/admin/use-ai-management-queries"
import type { UpdateAiModelInput } from "@/services/admin/ai-management-service"
import {
  AI_CAPABILITIES,
  AI_CAPABILITY_LABELS,
  AI_MODEL_KIND_LABELS,
  AI_MODEL_KINDS,
  AI_QUALITY_TIER_LABELS,
  AI_QUALITY_TIERS,
  CAPABILITY_SOURCE_LABELS,
  CURRENCY_PATTERN,
  DECIMAL_PATTERN,
  SPEECH_INSTRUCTIONS_MAX_LENGTH,
  SPEECH_VOICE_PATTERN,
  type AiCapability,
  type AiModel,
  type ModelTestResult,
} from "@/schemas/admin/ai-management.schema"

import { CapabilityBadges, EnabledBadge, InfoCallout, ModelPriceCell, MoneyList } from "./ai-shared"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

/**
 * Modelos: algo utilizável por UMA conexão. O `providerModelId` nunca muda (o nome amigável sim);
 * capacidade marcada aqui vira MANUAL (declarada pelo admin) e a sincronização nunca a sobrescreve.
 * Preço é VERSIONADO: um preço novo fecha o vigente, o histórico fica.
 */
const ALL = "ALL"
const NO_TIER = "NONE"

export function ModelsTab() {
  const can = useAiCan()
  const canWrite = can("AI_CONFIG_WRITE")
  const [connectionFilter, setConnectionFilter] = useState(ALL)
  const connectionsQuery = useAiConnectionsQuery()
  const modelsQuery = useAiModelsQuery(connectionFilter === ALL ? null : connectionFilter)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = editingId ? (modelsQuery.data?.find((model) => model.id === editingId) ?? null) : null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Modelos</CardTitle>
            <CardDescription>Sincronize pela conexão ou cadastre manualmente. Capacidades, tier e preço orientam o roteamento.</CardDescription>
          </div>
          {canWrite ? (
            <Button onClick={() => setCreating(true)} disabled={(connectionsQuery.data ?? []).length === 0}>
              <Plus /> Cadastrar modelo manualmente
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Conexão</Label>
          <Select value={connectionFilter} onValueChange={setConnectionFilter}>
            <SelectTrigger className="w-64" aria-label="Filtrar por conexão">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as conexões</SelectItem>
              {(connectionsQuery.data ?? []).map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {modelsQuery.isPending ? (
          <ListSkeleton view="list" rows={4} />
        ) : modelsQuery.isError ? (
          <ListErrorState message="Não foi possível carregar os modelos." onRetry={() => modelsQuery.refetch()} />
        ) : modelsQuery.data.length === 0 ? (
          <ListEmptyState icon={Server} title="Nenhum modelo" description="Use &quot;Sincronizar modelos&quot; numa conexão (aba Conexões) ou cadastre um modelo manualmente." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Conexão</TableHead>
                  <TableHead>Capacidades</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Preço vigente</TableHead>
                  <TableHead className="text-right">Requests 30d</TableHead>
                  <TableHead>Custo 30d</TableHead>
                  <TableHead>Políticas</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelsQuery.data.map((model) => (
                  <ModelRow key={model.id} model={model} canWrite={canWrite} onEdit={() => setEditingId(model.id)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Cadastrar modelo manualmente</DialogTitle>
            <DialogDescription>Para modelos que a conexão não lista (ou providers sem descoberta). O id do provider não pode ser alterado depois.</DialogDescription>
          </DialogHeader>
          {creating ? <CreateModelForm connections={connectionsQuery.data ?? []} defaultConnectionId={connectionFilter === ALL ? null : connectionFilter} onDone={() => setCreating(false)} /> : null}
        </DialogContent>
      </Dialog>

      <ModelEditSheet model={editing} canWrite={canWrite} onOpenChange={(open) => (open ? null : setEditingId(null))} />
    </Card>
  )
}

function ModelRow({ model, canWrite, onEdit }: { model: AiModel; canWrite: boolean; onEdit: () => void }) {
  return (
    <TableRow className={model.enabled && model.connectionEnabled ? undefined : "opacity-60"} data-testid={`model-row-${model.id}`}>
      <TableCell>
        <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={onEdit}>
          {model.displayName}
        </button>
        <p className="font-mono text-xs text-muted-foreground">{model.providerModelId}</p>
        {model.qualityTier ? <p className="text-xs text-muted-foreground">Tier: {AI_QUALITY_TIER_LABELS[model.qualityTier] ?? model.qualityTier} (declarado)</p> : null}
      </TableCell>
      <TableCell className="text-sm">
        {model.connectionName}
        <p className="text-xs text-muted-foreground">{model.providerName ?? model.providerKey}</p>
      </TableCell>
      <TableCell className="max-w-64">
        <CapabilityBadges capabilities={model.capabilities} />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2">
            {canWrite ? <ModelEnabledSwitch model={model} /> : null}
            <EnabledBadge enabled={model.enabled} onLabel="Habilitado" offLabel="Desabilitado" />
          </div>
          {!model.connectionEnabled ? <Badge variant="outline">Conexão desabilitada</Badge> : null}
          {model.missingFromLastSync ? <Badge variant="outline">Não listado na última sincronização</Badge> : null}
        </div>
      </TableCell>
      <TableCell>
        <ModelPriceCell model={model} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(model.usage30d.requests)}
        {model.usage30d.errors > 0 ? <span className="block text-xs text-muted-foreground">{formatCount(model.usage30d.errors)} erro(s)</span> : null}
      </TableCell>
      <TableCell className="text-sm">
        <MoneyList costByCurrency={model.usage30d.costByCurrency} empty="—" />
      </TableCell>
      <TableCell>
        {model.policies.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {model.policies.map((policy) => (
              <Badge key={`${policy.useCase}-${policy.status}`} variant={policy.status === "ACTIVE" ? "secondary" : "outline"} className="text-[11px]">
                {policy.useCase}
                {policy.status === "ACTIVE" ? "" : " (rascunho)"}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label={`Configurar ${model.displayName}`} onClick={onEdit}>
            <Settings2 className="h-4 w-4" />
          </Button>
          {canWrite ? (
            <>
              <TestModelButton model={model} />
              <DeleteModelButton model={model} />
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------- Atualização com confirmação (409)

/**
 * Desabilitar um modelo de política ATIVA devolve 409 AI_MODEL_IN_USE_ACTIVE: a tela mostra o
 * impacto e só reenvia com `acknowledgeActivePolicyImpact: true` depois da confirmação explícita.
 */
function useModelUpdateWithConfirm(onSaved?: () => void): { submit: (input: UpdateAiModelInput) => void; pending: boolean; error: Error | null; dialog: ReactNode } {
  const update = useUpdateAiModelMutation()
  const [pendingInput, setPendingInput] = useState<UpdateAiModelInput | null>(null)
  const [impact, setImpact] = useState<string | null>(null)

  function submit(input: UpdateAiModelInput) {
    update.mutate(input, {
      onSuccess: () => onSaved?.(),
      onError: (error) => {
        if (error instanceof AdminApiError && error.code === "AI_MODEL_IN_USE_ACTIVE") {
          setPendingInput(input)
          setImpact(error.message)
        }
      },
    })
  }

  const dialog = (
    <AlertDialog
      open={pendingInput !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPendingInput(null)
          setImpact(null)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desabilitar modelo em uso?</AlertDialogTitle>
          <AlertDialogDescription>{impact}</AlertDialogDescription>
        </AlertDialogHeader>
        <InfoCallout tone="warn">A política ativa fica sem este candidato e pode se tornar inválida. Não há troca silenciosa de modelo: revise o roteamento do Use Case em seguida.</InfoCallout>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              if (pendingInput) submit({ ...pendingInput, acknowledgeActivePolicyImpact: true })
              setPendingInput(null)
              setImpact(null)
            }}
          >
            Desabilitar mesmo assim
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const silentConflict = update.error instanceof AdminApiError && update.error.code === "AI_MODEL_IN_USE_ACTIVE"
  return { submit, pending: update.isPending, error: update.isError && !silentConflict ? (update.error as Error) : null, dialog }
}

function ModelEnabledSwitch({ model }: { model: AiModel }) {
  const { submit, pending, dialog } = useModelUpdateWithConfirm()
  return (
    <>
      <Switch checked={model.enabled} disabled={pending} aria-label={model.enabled ? `Desabilitar ${model.displayName}` : `Habilitar ${model.displayName}`} onCheckedChange={(checked) => submit({ id: model.id, enabled: checked })} />
      {dialog}
    </>
  )
}

// ---------------------------------------------------------------- Testar / excluir

function TestModelButton({ model }: { model: AiModel }) {
  const test = useTestAiModelMutation()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ModelTestResult | null>(null)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setResult(null)
      }}
    >
      <Button size="icon" variant="ghost" aria-label={`Testar ${model.displayName}`} onClick={() => setOpen(true)}>
        <FlaskConical className="h-4 w-4" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Testar {model.displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            O teste faz UMA requisição mínima real ao provider ({model.providerModelId}) e pode gerar custo. Sem repetição e sem fallback; o uso aparece no painel como teste de modelo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {result ? <ModelTestResultView result={result} /> : null}
        {test.isError ? <p className="text-sm text-destructive">{(test.error as Error).message}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{result ? "Fechar" : "Cancelar"}</AlertDialogCancel>
          {result ? null : (
            <Button disabled={test.isPending} onClick={() => test.mutate(model.id, { onSuccess: setResult })}>
              {test.isPending ? "Testando..." : "Fazer 1 requisição de teste"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ModelTestResultView({ result }: { result: ModelTestResult }) {
  return (
    <div className="space-y-1 rounded-lg border p-3 text-sm" data-testid="model-test-result">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.status === "OK" ? "secondary" : "destructive"}>{result.status === "OK" ? "Respondeu" : "Erro"}</Badge>
        <span className="text-xs text-muted-foreground">Latência {formatLatency(result.latencyMs)}</span>
        <span className="text-xs text-muted-foreground">{formatAiDateTime(result.testedAt)}</span>
      </div>
      <p className="text-xs">{result.message}</p>
      {result.outputPreview ? <p className="rounded bg-muted px-2 py-1 font-mono text-xs">{result.outputPreview}</p> : null}
      <p className="text-xs text-muted-foreground">
        Tokens: entrada {formatTokens(result.usage.inputTokens)} · saída {formatTokens(result.usage.outputTokens)} · total {formatTokens(result.usage.totalTokens)}
      </p>
      <p className="text-xs text-muted-foreground">Custo: {result.cost.amount && result.cost.currency ? formatMoney(result.cost.amount, result.cost.currency) : "desconhecido (sem preço configurado)"}</p>
    </div>
  )
}

function DeleteModelButton({ model }: { model: AiModel }) {
  const remove = useDeleteAiModelMutation()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) remove.reset()
      }}
    >
      <Button size="icon" variant="ghost" aria-label={`Excluir ${model.displayName}`} onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {model.displayName}?</AlertDialogTitle>
          <AlertDialogDescription>O modelo sai das telas e do roteamento; os preços e o histórico de uso continuam. {RESTORE_NOTE} Modelos em políticas (ativas ou rascunho) não podem ser excluídos.</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {(remove.error as Error).message}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={async () => {
              try {
                await remove.mutateAsync(model.id)
                setOpen(false)
              } catch {
                // exibido acima (409 AI_MODEL_IN_USE)
              }
            }}
          >
            Excluir
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------- Formulários

function CapabilityToggles({ value, onChange, sources }: { value: Partial<Record<AiCapability, boolean>>; onChange: (next: Partial<Record<AiCapability, boolean>>) => void; sources?: Record<string, { source: string }> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {AI_CAPABILITIES.map((capability) => (
        <label key={capability} className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label={AI_CAPABILITY_LABELS[capability]} className="h-4 w-4 rounded border-input" checked={value[capability] === true} onChange={(event) => onChange({ ...value, [capability]: event.target.checked })} />
          <span>
            {AI_CAPABILITY_LABELS[capability]}
            {sources?.[capability] ? <span className="ml-1 text-xs text-muted-foreground">({CAPABILITY_SOURCE_LABELS[sources[capability]!.source] ?? sources[capability]!.source})</span> : null}
          </span>
        </label>
      ))}
    </div>
  )
}

function TierSelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-48" aria-label="Tier de qualidade">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TIER}>Não declarado</SelectItem>
        {AI_QUALITY_TIERS.map((tier) => (
          <SelectItem key={tier} value={tier}>
            {AI_QUALITY_TIER_LABELS[tier]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CreateModelForm({ connections, defaultConnectionId, onDone }: { connections: { id: string; name: string }[]; defaultConnectionId: string | null; onDone: () => void }) {
  const create = useCreateAiModelMutation()
  const [connectionId, setConnectionId] = useState(defaultConnectionId ?? connections[0]?.id ?? "")
  const [providerModelId, setProviderModelId] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [kind, setKind] = useState<string>("GENERATIVE")
  const [contextWindow, setContextWindow] = useState("")
  const [maxOutputTokens, setMaxOutputTokens] = useState("")
  const [capabilities, setCapabilities] = useState<Partial<Record<AiCapability, boolean>>>({})
  const [tier, setTier] = useState(NO_TIER)
  const [timeoutSeconds, setTimeoutSeconds] = useState("")

  const context = parseOptionalInt(contextWindow)
  const maxOutput = parseOptionalInt(maxOutputTokens)
  const timeout = timeoutSeconds.trim() ? Number(timeoutSeconds) : null
  const valid = connectionId && providerModelId.trim() && !Number.isNaN(context) && !Number.isNaN(maxOutput) && (timeout === null || (timeout >= 1 && timeout <= 300))

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Conexão *</Label>
        <Select value={connectionId} onValueChange={setConnectionId}>
          <SelectTrigger className="w-full" aria-label="Conexão do modelo">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {connection.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ai-model-id">Id do modelo no provider *</Label>
          <Input id="ai-model-id" value={providerModelId} maxLength={200} placeholder="ex.: gpt-4.1-mini" onChange={(event) => setProviderModelId(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-model-alias">Nome amigável</Label>
          <Input id="ai-model-alias" value={displayName} maxLength={120} placeholder="Opcional" onChange={(event) => setDisplayName(event.target.value)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-full" aria-label="Tipo do modelo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODEL_KINDS.map((item) => (
                <SelectItem key={item} value={item}>
                  {AI_MODEL_KIND_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-model-context">Janela de contexto</Label>
          <Input id="ai-model-context" inputMode="numeric" value={contextWindow} placeholder="tokens" onChange={(event) => setContextWindow(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-model-max-output">Máx. de saída</Label>
          <Input id="ai-model-max-output" inputMode="numeric" value={maxOutputTokens} placeholder="tokens" onChange={(event) => setMaxOutputTokens(event.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Capacidades (declaradas pelo admin)</Label>
        <CapabilityToggles value={capabilities} onChange={setCapabilities} />
        <p className="text-xs text-muted-foreground">Capacidade não marcada = desconhecida: o modelo não é elegível para Use Cases que a exigem.</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-1.5">
          <Label>Tier de qualidade (declarado pelo admin)</Label>
          <TierSelect value={tier} onChange={setTier} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-model-timeout">Timeout (segundos)</Label>
          <Input id="ai-model-timeout" type="number" min={1} max={300} className="w-32" value={timeoutSeconds} placeholder="da conexão" onChange={(event) => setTimeoutSeconds(event.target.value)} />
        </div>
      </div>
      {create.isError ? <p className="text-sm text-destructive">{(create.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              {
                connectionId,
                providerModelId: providerModelId.trim(),
                ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
                kind,
                contextWindow: context,
                maxOutputTokens: maxOutput,
                capabilities: Object.fromEntries(Object.entries(capabilities).map(([capability, supported]) => [capability, { supported: Boolean(supported) }])),
                qualityTier: tier === NO_TIER ? null : tier,
                timeoutMs: timeout === null ? null : Math.round(timeout * 1000),
              },
              { onSuccess: onDone },
            )
          }
        >
          {create.isPending ? "Salvando..." : "Cadastrar modelo"}
        </Button>
      </div>
    </div>
  )
}

function ModelEditSheet({ model, canWrite, onOpenChange }: { model: AiModel | null; canWrite: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={model !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
        {model ? (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{model.displayName}</SheetTitle>
                <Badge variant="outline" className="font-mono">
                  {model.providerModelId}
                </Badge>
                <Badge variant="outline">{model.origin === "DISCOVERED" ? "Descoberto" : "Manual"}</Badge>
              </div>
              <SheetDescription>
                {model.connectionName} · {model.providerName ?? model.providerKey}
                {model.lastSeenAt ? ` · visto pelo provider em ${formatAiDateTime(model.lastSeenAt)}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-4">
              <ModelSettingsForm key={model.id} model={model} canWrite={canWrite} />
              <PricingSection model={model} canWrite={canWrite} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ModelSettingsForm({ model, canWrite }: { model: AiModel; canWrite: boolean }) {
  const initialCapabilities = Object.fromEntries(AI_CAPABILITIES.map((capability) => [capability, model.capabilities[capability]?.supported === true])) as Partial<Record<AiCapability, boolean>>
  const [displayName, setDisplayName] = useState(model.displayName)
  const [enabled, setEnabled] = useState(model.enabled)
  const [capabilities, setCapabilities] = useState(initialCapabilities)
  const [contextWindow, setContextWindow] = useState(model.contextWindow ? String(model.contextWindow) : "")
  const [maxOutputTokens, setMaxOutputTokens] = useState(model.maxOutputTokens ? String(model.maxOutputTokens) : "")
  const [tier, setTier] = useState(model.qualityTier ?? NO_TIER)
  const [timeoutSeconds, setTimeoutSeconds] = useState(model.timeoutMs ? String(Math.round(model.timeoutMs / 1000)) : "")
  const [voice, setVoice] = useState(model.speech?.voice ?? "")
  const [voiceInstructions, setVoiceInstructions] = useState(model.speech?.instructions ?? "")
  const { submit, pending, error, dialog } = useModelUpdateWithConfirm()

  const context = parseOptionalInt(contextWindow)
  const maxOutput = parseOptionalInt(maxOutputTokens)
  const timeout = timeoutSeconds.trim() ? Number(timeoutSeconds) : null
  const voiceValid = voice.trim() === "" || SPEECH_VOICE_PATTERN.test(voice.trim())
  const valid = displayName.trim().length > 0 && !Number.isNaN(context) && !Number.isNaN(maxOutput) && (timeout === null || (timeout >= 1 && timeout <= 300)) && voiceValid && voiceInstructions.length <= SPEECH_INSTRUCTIONS_MAX_LENGTH
  // A voz só aparece para modelo de áudio (ou que já tem voz): é o que a "Voz do recado do avatar" exige do modelo.
  const showVoice = Boolean(capabilities.AUDIO) || model.speech !== null
  const nextSpeech = voice.trim() ? { voice: voice.trim(), instructions: voiceInstructions.trim() || null } : null
  const speechChanged = JSON.stringify(nextSpeech) !== JSON.stringify(model.speech ?? null)

  function handleSave() {
    // Só as capacidades ALTERADAS viram MANUAL; as demais mantêm a origem (descoberta/inferida).
    const changed = AI_CAPABILITIES.filter((capability) => capabilities[capability] !== initialCapabilities[capability])
    submit({
      id: model.id,
      displayName: displayName.trim(),
      enabled,
      contextWindow: context,
      maxOutputTokens: maxOutput,
      qualityTier: tier === NO_TIER ? null : tier,
      timeoutMs: timeout === null ? null : Math.round(timeout * 1000),
      ...(changed.length > 0 ? { capabilities: Object.fromEntries(changed.map((capability) => [capability, { supported: Boolean(capabilities[capability]) }])) } : {}),
      ...(speechChanged ? { speech: nextSpeech } : {}),
    })
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Configuração</h3>
      {model.costLabel !== "NOT_LOCAL" ? <InfoCallout>{model.costLabel === "API_COST_ZERO" ? LOCAL_API_COST_ZERO_LABEL : "Modelo local: o custo de API depende do preço configurado abaixo; o custo computacional não é medido."}</InfoCallout> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ai-edit-model-alias">Nome amigável</Label>
          <Input id="ai-edit-model-alias" value={displayName} disabled={!canWrite} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Switch id="ai-edit-model-enabled" checked={enabled} disabled={!canWrite} onCheckedChange={setEnabled} />
          <Label htmlFor="ai-edit-model-enabled">{enabled ? "Habilitado" : "Desabilitado"}</Label>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Capacidades</Label>
        <CapabilityToggles value={capabilities} onChange={setCapabilities} sources={model.capabilities} />
        <p className="text-xs text-muted-foreground">Alterar uma capacidade a registra como declarada pelo admin; a sincronização nunca sobrescreve o que foi declarado.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-edit-model-context">Janela de contexto</Label>
          <Input id="ai-edit-model-context" inputMode="numeric" disabled={!canWrite} value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-edit-model-max">Máx. de saída</Label>
          <Input id="ai-edit-model-max" inputMode="numeric" disabled={!canWrite} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-edit-model-timeout">Timeout (segundos)</Label>
          <Input id="ai-edit-model-timeout" type="number" min={1} max={300} disabled={!canWrite} value={timeoutSeconds} placeholder="da conexão" onChange={(event) => setTimeoutSeconds(event.target.value)} />
        </div>
      </div>
      {showVoice ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ai-edit-model-voice">Voz (síntese de voz)</Label>
            <Input id="ai-edit-model-voice" disabled={!canWrite} value={voice} maxLength={60} placeholder="ex.: marin" aria-invalid={!voiceValid} onChange={(event) => setVoice(event.target.value)} />
            <p className="text-xs text-muted-foreground">Nome da voz no provider (na OpenAI: marin, cedar, coral…). Usada quando este modelo atende a “Voz do recado do avatar”; vazio = sem voz.</p>
            {!voiceValid ? <p className="text-xs text-destructive">Use só letras, números, espaço, ponto, hífen ou sublinhado.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-edit-model-voice-instructions">Instrução de tom (opcional)</Label>
            <Textarea id="ai-edit-model-voice-instructions" disabled={!canWrite || !voice.trim()} value={voiceInstructions} maxLength={SPEECH_INSTRUCTIONS_MAX_LENGTH} rows={2} placeholder="ex.: Fale como uma supervisora calorosa, em português do Brasil." onChange={(event) => setVoiceInstructions(event.target.value)} />
            <p className="text-xs text-muted-foreground">Como a voz deve soar. O texto do recado nunca muda. Não funciona com tts-1 e tts-1-hd.</p>
          </div>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label>Tier de qualidade (declarado pelo admin — não é benchmark)</Label>
        <TierSelect value={tier} onChange={setTier} disabled={!canWrite} />
      </div>
      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button disabled={!valid || pending} onClick={handleSave}>
            {pending ? "Salvando..." : "Salvar modelo"}
          </Button>
        </div>
      ) : null}
      {dialog}
    </section>
  )
}

function PricingSection({ model, canWrite }: { model: AiModel; canWrite: boolean }) {
  const pricingQuery = useAiModelPricingQuery(model.id)
  const add = useAddAiModelPricingMutation()
  const [currency, setCurrency] = useState(model.currentPricing?.currency ?? "USD")
  const [input, setInput] = useState("")
  const [output, setOutput] = useState("")
  const [cached, setCached] = useState("")
  const [reasoning, setReasoning] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [note, setNote] = useState("")

  const decimals = [input, output].map(normalizeDecimalInput)
  const optionalDecimals = [cached, reasoning].map(normalizeDecimalInput)
  const valid = CURRENCY_PATTERN.test(currency) && decimals.every((value) => DECIMAL_PATTERN.test(value)) && optionalDecimals.every((value) => value === "" || DECIMAL_PATTERN.test(value))

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Preço por milhão de tokens</h3>
      <p className="text-xs text-muted-foreground">
        Preço versionado: um preço novo fecha o vigente na data de início e o histórico é preservado — custos já registrados continuam com a versão aplicada. Não há conversão de moeda.
      </p>
      {pricingQuery.isPending ? (
        <ListSkeleton view="list" rows={2} />
      ) : pricingQuery.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar o histórico de preços.</p>
      ) : pricingQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{model.isLocal ? "Sem preço. Para um modelo local sem tarifa de API, registre 0 — o custo computacional continua não medido." : "Sem preço: o custo das chamadas deste modelo fica como desconhecido."}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vigência</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead>Cache</TableHead>
                <TableHead>Raciocínio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricingQuery.data.map((pricing) => (
                <TableRow key={pricing.id}>
                  <TableCell className="text-xs">
                    {formatAiDateTime(pricing.effectiveFrom)} → {pricing.effectiveTo ? formatAiDateTime(pricing.effectiveTo) : <Badge variant="secondary">vigente</Badge>}
                    {pricing.note ? <p className="text-muted-foreground">{pricing.note}</p> : null}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{formatPerMillion(pricing.inputPerMillion, pricing.currency)}</TableCell>
                  <TableCell className="text-xs tabular-nums">{formatPerMillion(pricing.outputPerMillion, pricing.currency)}</TableCell>
                  <TableCell className="text-xs tabular-nums">{pricing.cachedInputPerMillion ? formatPerMillion(pricing.cachedInputPerMillion, pricing.currency) : "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums">{pricing.reasoningPerMillion ? formatPerMillion(pricing.reasoningPerMillion, pricing.currency) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {canWrite ? (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Novo preço</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-price-currency">Moeda *</Label>
              <Input id="ai-price-currency" value={currency} maxLength={3} className="font-mono uppercase" onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-price-input">Entrada / 1M *</Label>
              <Input id="ai-price-input" inputMode="decimal" value={input} placeholder="0.30" onChange={(event) => setInput(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-price-output">Saída / 1M *</Label>
              <Input id="ai-price-output" inputMode="decimal" value={output} placeholder="2.50" onChange={(event) => setOutput(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-price-cached">Entrada em cache / 1M</Label>
              <Input id="ai-price-cached" inputMode="decimal" value={cached} placeholder="opcional" onChange={(event) => setCached(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-price-reasoning">Raciocínio / 1M</Label>
              <Input id="ai-price-reasoning" inputMode="decimal" value={reasoning} placeholder="opcional" aria-describedby="ai-price-reasoning-hint" onChange={(event) => setReasoning(event.target.value)} />
              <p id="ai-price-reasoning-hint" className="text-xs text-muted-foreground">
                Preencha só se o provider informa o raciocínio FORA da saída (ex.: Gemini — use o preço de saída). Se ele já vem dentro da saída (ex.: OpenAI), deixe vazio para não cobrar duas vezes.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-price-from">Vigente a partir de</Label>
              <Input id="ai-price-from" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-price-note">Observação</Label>
            <Textarea id="ai-price-note" rows={2} maxLength={300} value={note} placeholder="Ex.: tabela pública de setembro" onChange={(event) => setNote(event.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">Valores decimais com ponto ou vírgula. Em branco, a vigência começa agora.</p>
          {add.isError ? <p className="text-sm text-destructive">{(add.error as Error).message}</p> : null}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!valid || add.isPending}
              onClick={() =>
                add.mutate(
                  {
                    modelId: model.id,
                    currency,
                    inputPerMillion: decimals[0]!,
                    outputPerMillion: decimals[1]!,
                    cachedInputPerMillion: optionalDecimals[0] || null,
                    reasoningPerMillion: optionalDecimals[1] || null,
                    ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
                    note: note.trim() || null,
                  },
                  {
                    onSuccess: () => {
                      setInput("")
                      setOutput("")
                      setCached("")
                      setReasoning("")
                      setEffectiveFrom("")
                      setNote("")
                    },
                  },
                )
              }
            >
              Registrar novo preço
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
