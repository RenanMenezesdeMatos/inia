"use client"

import { useState } from "react"
import { Cpu, KeyRound, Plug, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"

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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { AdminApiError } from "@/lib/admin/admin-api"
import { formatAiDateTime, formatLatency } from "@/lib/admin/ai-format"
import { cn } from "@/lib/utils"
import {
  useAiCan,
  useAiConnectionsQuery,
  useAiProvidersQuery,
  useCreateAiConnectionMutation,
  useDeleteAiConnectionMutation,
  useRemoveAiConnectionSecretMutation,
  useReplaceAiConnectionHeadersMutation,
  useReplaceAiConnectionSecretMutation,
  useSyncAiConnectionModelsMutation,
  useTestAiConnectionMutation,
  useUpdateAiConnectionMutation,
} from "@/queries/admin/use-ai-management-queries"
import type { AiConnection, AiProvider, ConnectionTestResult } from "@/schemas/admin/ai-management.schema"

import { ConnectionTestResultView, ConnectionTestStatusBadge, EnabledBadge, InfoCallout, ProviderIcon } from "./ai-shared"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

/**
 * Conexões de IA. O formulário é montado pela METADATA do provider (`/providers`): credencial
 * obrigatória/opcional/nenhuma, endpoint exigido/padrão, local ou remoto, cabeçalhos — nenhuma
 * tela por provider. A API key só entra: a tela mostra apenas a máscara que o backend devolve.
 */
const DEFAULT_TIMEOUT_SECONDS = 60

/** Vagas da conexão: em branco = sem limite próprio; senão um inteiro de 1 a 1000. */
function parseConcurrentCalls(text: string): { value: number | null; valid: boolean } {
  if (text.trim() === "") return { value: null, valid: true }
  const value = Number(text)
  return { value, valid: Number.isInteger(value) && value >= 1 && value <= 1000 }
}

/**
 * Chamadas simultâneas da conexão em TODAS as instâncias da INIA (APIs e processamentos) — o limite por acesso que o provedor
 * informa. A INIA divide essas vagas entre as instâncias e guarda um quarto delas para chat e voz.
 */
function ConcurrentCallsField({ id, value, disabled, onChange }: { id: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const { valid } = parseConcurrentCalls(value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Chamadas simultâneas</Label>
      <Input id={id} type="number" min={1} max={1000} className="w-32" placeholder="Sem limite" disabled={disabled} value={value} aria-invalid={!valid} onChange={(event) => onChange(event.target.value)} />
      <p className={cn("text-xs", valid ? "text-muted-foreground" : "text-destructive")}>
        {valid ? "Quantas chamadas esta conexão aceita ao mesmo tempo, somando todas as instâncias da INIA (o limite por acesso do provedor). Um quarto fica reservado para chat e voz. Em branco = sem limite próprio." : "Use um número inteiro de 1 a 1000, ou deixe em branco."}
      </p>
    </div>
  )
}

function isLocalProvider(provider: AiProvider): boolean {
  return provider.deployment === "LOCAL" || provider.deployment === "REMOTE_OR_LOCAL"
}

function syncSummary(report: { discovered: number; created: number; updated: number; missing: number }): string {
  return `${report.discovered} modelo(s) encontrado(s): ${report.created} novo(s), ${report.updated} atualizado(s)${report.missing > 0 ? `, ${report.missing} não listado(s) mais pelo provider` : ""}.`
}

export function ConnectionsTab() {
  const can = useAiCan()
  const canWrite = can("AI_CONFIG_WRITE")
  const connectionsQuery = useAiConnectionsQuery()
  const providersQuery = useAiProvidersQuery()
  const providers = providersQuery.data ?? []
  const [creating, setCreating] = useState<null | "all" | "local">(null)
  const [configuringId, setConfiguringId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({})

  const configuring = configuringId ? (connectionsQuery.data?.find((connection) => connection.id === configuringId) ?? null) : null
  const providerOf = (key: string) => providers.find((provider) => provider.key === key) ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Conexões</CardTitle>
            <CardDescription>Uma conexão = um provider + endpoint + credencial da organização. Os modelos pertencem a uma conexão.</CardDescription>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCreating("local")}>
                <Cpu /> Adicionar modelo local
              </Button>
              <Button onClick={() => setCreating("all")}>
                <Plus /> Nova conexão
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {connectionsQuery.isPending ? (
          <ListSkeleton view="list" rows={3} />
        ) : connectionsQuery.isError ? (
          <ListErrorState message="Não foi possível carregar as conexões." onRetry={() => connectionsQuery.refetch()} />
        ) : connectionsQuery.data.length === 0 ? (
          <ListEmptyState
            icon={Plug}
            title="Nenhuma conexão de IA"
            description="Sem conexões, todos os usos continuam na configuração legada do ambiente. Adicione um provider para começar."
            action={
              canWrite ? (
                <Button onClick={() => setCreating("all")}>
                  <Plus /> Nova conexão
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Modelos</TableHead>
                  <TableHead>Saúde</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectionsQuery.data.map((connection) => (
                  <ConnectionRow
                    key={connection.id}
                    connection={connection}
                    provider={providerOf(connection.providerKey)}
                    canWrite={canWrite}
                    testResult={testResults[connection.id] ?? null}
                    onTested={(result) => setTestResults((current) => ({ ...current, [connection.id]: result }))}
                    onConfigure={() => setConfiguringId(connection.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <NewConnectionSheet open={creating !== null} mode={creating ?? "all"} providers={providers} canWriteSecrets={can("AI_SECRETS_WRITE")} onOpenChange={(open) => (open ? null : setCreating(null))} />
      <ConnectionConfigSheet
        connection={configuring}
        provider={configuring ? providerOf(configuring.providerKey) : null}
        canWrite={canWrite}
        canWriteSecrets={can("AI_SECRETS_WRITE")}
        testResult={configuring ? (testResults[configuring.id] ?? null) : null}
        onTested={(id, result) => setTestResults((current) => ({ ...current, [id]: result }))}
        onOpenChange={(open) => (open ? null : setConfiguringId(null))}
      />
    </Card>
  )
}

function ConnectionRow({
  connection,
  provider,
  canWrite,
  testResult,
  onTested,
  onConfigure,
}: {
  connection: AiConnection
  provider: AiProvider | null
  canWrite: boolean
  testResult: ConnectionTestResult | null
  onTested: (result: ConnectionTestResult) => void
  onConfigure: () => void
}) {
  const test = useTestAiConnectionMutation()
  const sync = useSyncAiConnectionModelsMutation()
  const health = testResult ?? (connection.health.status ? { status: connection.health.status, latencyMs: connection.health.latencyMs, message: connection.health.message, checkedAt: connection.health.checkedAt } : null)

  return (
    <TableRow className={connection.enabled ? undefined : "opacity-60"} data-testid={`connection-row-${connection.id}`}>
      <TableCell>
        <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={onConfigure}>
          {connection.name}
        </button>
        <p className="text-xs text-muted-foreground">
          {connection.isLocal ? "Local · " : ""}
          {connection.effectiveBaseUrl ?? "Endpoint padrão"}
        </p>
        {connection.credential.configured ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="connection-masked-key">
            <KeyRound className="size-3" aria-hidden /> {connection.credential.maskedValue}
          </p>
        ) : connection.provider?.credential === "REQUIRED" ? (
          <p className="text-xs text-destructive">Credencial não configurada</p>
        ) : null}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <ProviderIcon icon={connection.provider?.icon} />
          {connection.provider?.name ?? connection.providerKey}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {canWrite ? <ConnectionEnabledSwitch connection={connection} /> : null}
          <EnabledBadge enabled={connection.enabled} />
        </div>
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {connection.enabledModelCount}/{connection.modelCount}
      </TableCell>
      <TableCell className="min-w-48 max-w-72 whitespace-normal">{health ? <ConnectionTestResultView result={health} /> : <ConnectionTestStatusBadge status={null} />}</TableCell>
      <TableCell className="text-sm">{connection.lastUsedAt ? formatAiDateTime(connection.lastUsedAt) : <span className="text-muted-foreground">Nunca</span>}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button size="icon" variant="ghost" aria-label={`Configurar ${connection.name}`} onClick={onConfigure}>
            <Settings2 className="h-4 w-4" />
          </Button>
          {canWrite ? (
            <>
              <Button size="icon" variant="ghost" aria-label={`Testar ${connection.name}`} disabled={test.isPending} onClick={() => test.mutate(connection.id, { onSuccess: onTested })}>
                <Plug className={cn("h-4 w-4", test.isPending && "animate-pulse")} />
              </Button>
              {provider?.supportsModelDiscovery ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Sincronizar modelos de ${connection.name}`}
                  disabled={sync.isPending || !connection.enabled}
                  onClick={() => sync.mutate(connection.id, { onSuccess: (report) => toast.success(syncSummary(report)) })}
                >
                  <RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} />
                </Button>
              ) : null}
              <DeleteConnectionButton connection={connection} />
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function ConnectionEnabledSwitch({ connection }: { connection: AiConnection }) {
  const update = useUpdateAiConnectionMutation("Status da conexão atualizado.")
  const [confirming, setConfirming] = useState(false)
  const apply = (enabled: boolean) => update.mutate({ id: connection.id, enabled })
  return (
    <>
      <Switch
        checked={connection.enabled}
        disabled={update.isPending}
        aria-label={connection.enabled ? `Desabilitar ${connection.name}` : `Habilitar ${connection.name}`}
        onCheckedChange={(checked) => (!checked && connection.activePolicyUseCases.length > 0 ? setConfirming(true) : apply(checked))}
      />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desabilitar {connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta conexão atende política(s) ativa(s): {connection.activePolicyUseCases.join(", ")}. Desabilitada, os modelos dela deixam de ser candidatos — sem troca silenciosa: uma política sem candidato válido falha em vez de usar outro modelo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                apply(false)
                setConfirming(false)
              }}
            >
              Desabilitar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DeleteConnectionButton({ connection }: { connection: AiConnection }) {
  const remove = useDeleteAiConnectionMutation()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) remove.reset()
      }}
    >
      <Button size="icon" variant="ghost" aria-label={`Excluir ${connection.name}`} onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {connection.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A conexão e os modelos dela saem das telas e do roteamento, e a credencial é revogada. O histórico de uso continua. {RESTORE_NOTE} Se a conexão estiver em uma política de roteamento, a exclusão é bloqueada — prefira desabilitar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {remove.error instanceof AdminApiError && remove.error.code === "AI_CONNECTION_IN_USE" ? `Não é possível excluir: ${remove.error.message}` : (remove.error as Error).message}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={async () => {
              try {
                await remove.mutateAsync(connection.id)
                setOpen(false)
              } catch {
                // exibido acima (409 AI_CONNECTION_IN_USE com as dependências)
              }
            }}
          >
            {remove.isPending ? "Excluindo..." : "Excluir"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------- Nova conexão

type HeaderRow = { name: string; value: string }

function headersRecord(rows: HeaderRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.value]))
}

function HeadersEditor({ rows, onChange, idPrefix }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void; idPrefix: string }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <Input aria-label={`Nome do cabeçalho ${index + 1}`} id={`${idPrefix}-name-${index}`} value={row.name} placeholder="X-Tenant" onChange={(event) => onChange(rows.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))} />
          <Input aria-label={`Valor do cabeçalho ${index + 1}`} type="password" autoComplete="off" value={row.value} placeholder="valor" onChange={(event) => onChange(rows.map((item, position) => (position === index ? { ...item, value: event.target.value } : item)))} />
          <Button type="button" size="icon" variant="ghost" aria-label={`Remover cabeçalho ${index + 1}`} onClick={() => onChange(rows.filter((_, position) => position !== index))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, { name: "", value: "" }])}>
        <Plus /> Adicionar cabeçalho
      </Button>
      <p className="text-xs text-muted-foreground">Os valores são cifrados como a API key e nunca voltam para a tela; só os nomes ficam visíveis.</p>
    </div>
  )
}

function NewConnectionSheet({ open, mode, providers, canWriteSecrets, onOpenChange }: { open: boolean; mode: "all" | "local"; providers: AiProvider[]; canWriteSecrets: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{mode === "local" ? "Adicionar modelo local" : "Nova conexão"}</SheetTitle>
          <SheetDescription>{mode === "local" ? "Conecte um servidor de modelos local (LM Studio, Ollama ou compatível com OpenAI) ao backend da INIA." : "Escolha o provider e informe como a INIA chega até ele."}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{open ? <NewConnectionForm key={mode} mode={mode} providers={providers} canWriteSecrets={canWriteSecrets} onDone={() => onOpenChange(false)} /> : null}</div>
      </SheetContent>
    </Sheet>
  )
}

export function NewConnectionForm({ mode, providers, canWriteSecrets, onDone }: { mode: "all" | "local"; providers: AiProvider[]; canWriteSecrets: boolean; onDone: () => void }) {
  const create = useCreateAiConnectionMutation()
  const available = mode === "local" ? providers.filter(isLocalProvider) : providers
  const [providerKey, setProviderKey] = useState<string | null>(mode === "local" ? (available.find((provider) => provider.deployment === "LOCAL")?.key ?? available[0]?.key ?? null) : null)
  const provider = available.find((item) => item.key === providerKey) ?? null
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [isLocal, setIsLocal] = useState(mode === "local")
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(DEFAULT_TIMEOUT_SECONDS))
  const [concurrentText, setConcurrentText] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [headers, setHeaders] = useState<HeaderRow[]>([])

  const endpointRequired = Boolean(provider?.baseUrlRequired && !provider.defaultBaseUrl)
  const timeout = Number(timeoutSeconds)
  const timeoutValid = Number.isFinite(timeout) && timeout >= 1 && timeout <= 300
  const credentialMissing = provider?.credential === "REQUIRED" && apiKey.trim().length < 4
  const concurrent = parseConcurrentCalls(concurrentText)
  const canSubmit = provider !== null && name.trim().length > 0 && (!endpointRequired || baseUrl.trim().length > 0) && timeoutValid && concurrent.valid && !credentialMissing && (provider.credential === "NONE" || canWriteSecrets || provider.credential === "OPTIONAL")

  async function handleSubmit() {
    if (!provider) return
    const customHeaders = provider.supportsCustomHeaders ? headersRecord(headers) : {}
    await create.mutateAsync({
      providerKey: provider.key,
      name: name.trim(),
      baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
      ...(provider.deployment === "REMOTE_OR_LOCAL" ? { isLocal } : {}),
      timeoutMs: Math.round(timeout * 1000),
      ...(concurrent.value !== null ? { maxConcurrentCalls: concurrent.value } : {}),
      ...(provider.credential !== "NONE" && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(Object.keys(customHeaders).length > 0 ? { customHeaders } : {}),
    })
    onDone()
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Provider</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider">
          {available.map((item) => (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={item.key === providerKey}
              onClick={() => {
                setProviderKey(item.key)
                setIsLocal(item.deployment === "LOCAL" || (mode === "local" && item.deployment === "REMOTE_OR_LOCAL"))
              }}
              className={cn("flex items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60", item.key === providerKey && "border-primary bg-primary/5")}
            >
              <ProviderIcon icon={item.icon} className="mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {provider ? (
        <div className="space-y-4" data-testid="connection-form-fields">
          {provider.notes.length > 0 ? (
            <InfoCallout>
              {provider.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </InfoCallout>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="ai-connection-name">Nome *</Label>
            <Input id="ai-connection-name" value={name} maxLength={120} placeholder={`Ex.: ${provider.name} produção`} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ai-connection-endpoint">{endpointRequired ? "Endpoint *" : "Endpoint"}</Label>
            <Input id="ai-connection-endpoint" value={baseUrl} maxLength={500} placeholder={provider.defaultBaseUrl ?? "https://servidor.exemplo/v1"} onChange={(event) => setBaseUrl(event.target.value)} />
            <p className="text-xs text-muted-foreground">
              {provider.defaultBaseUrl ? `Deixe em branco para usar o padrão: ${provider.defaultBaseUrl}` : "Informe a URL base do servidor (http:// ou https://, sem usuário/senha na URL)."}
            </p>
          </div>

          {provider.deployment === "REMOTE_OR_LOCAL" ? (
            <div className="flex items-center gap-2">
              <Switch id="ai-connection-local" checked={isLocal} onCheckedChange={setIsLocal} />
              <Label htmlFor="ai-connection-local">Endpoint local? {isLocal ? "Sim — custo de API tratado como local" : "Não — servidor remoto"}</Label>
            </div>
          ) : null}

          {provider.credential === "NONE" ? (
            <p className="text-xs text-muted-foreground">Este provider não usa credencial.</p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="ai-connection-key">
                {provider.credentialLabel || "API key"}
                {provider.credential === "REQUIRED" ? " *" : ""}
              </Label>
              <Input id="ai-connection-key" type="password" autoComplete="off" value={apiKey} disabled={!canWriteSecrets} onChange={(event) => setApiKey(event.target.value)} />
              <p className="text-xs text-muted-foreground">
                {canWriteSecrets ? "A chave é cifrada no servidor e nunca é exibida de novo — depois de salva, só a máscara aparece." : "Você não tem permissão para gravar credenciais de IA."}
              </p>
            </div>
          )}

          {provider.supportsCustomHeaders ? (
            <div className="space-y-1.5">
              <Label>Cabeçalhos personalizados</Label>
              {canWriteSecrets ? <HeadersEditor rows={headers} onChange={setHeaders} idPrefix="ai-new-header" /> : <p className="text-xs text-muted-foreground">Você não tem permissão para gravar cabeçalhos.</p>}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="ai-connection-timeout">Timeout (segundos)</Label>
            <Input id="ai-connection-timeout" type="number" min={1} max={300} className="w-32" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} />
          </div>

          <ConcurrentCallsField id="ai-connection-concurrent" value={concurrentText} onChange={setConcurrentText} />

          {create.isError ? <p className="text-sm text-destructive">{(create.error as Error).message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onDone}>
              Cancelar
            </Button>
            <Button disabled={!canSubmit || create.isPending} onClick={handleSubmit}>
              {create.isPending ? "Salvando..." : "Criar conexão"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Selecione um provider para continuar.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Configurar conexão

function ConnectionConfigSheet({
  connection,
  provider,
  canWrite,
  canWriteSecrets,
  testResult,
  onTested,
  onOpenChange,
}: {
  connection: AiConnection | null
  provider: AiProvider | null
  canWrite: boolean
  canWriteSecrets: boolean
  testResult: ConnectionTestResult | null
  onTested: (id: string, result: ConnectionTestResult) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={connection !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        {connection ? (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{connection.name}</SheetTitle>
                <Badge variant="outline" className="gap-1">
                  <ProviderIcon icon={connection.provider?.icon} className="size-3" />
                  {connection.provider?.name ?? connection.providerKey}
                </Badge>
                <EnabledBadge enabled={connection.enabled} />
              </div>
              <SheetDescription>{connection.activePolicyUseCases.length > 0 ? `Atende política(s) ativa(s): ${connection.activePolicyUseCases.join(", ")}.` : "Nenhuma política ativa usa esta conexão."}</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-4">
              <ConnectionSettingsForm key={connection.id + connection.updatedAt} connection={connection} provider={provider} canWrite={canWrite} />
              <CredentialSection connection={connection} provider={provider} canWriteSecrets={canWriteSecrets} />
              {provider?.supportsCustomHeaders ? <HeadersSection connection={connection} canWriteSecrets={canWriteSecrets} /> : null}
              <ConnectionChecks connection={connection} provider={provider} canWrite={canWrite} testResult={testResult} onTested={(result) => onTested(connection.id, result)} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ConnectionSettingsForm({ connection, provider, canWrite }: { connection: AiConnection; provider: AiProvider | null; canWrite: boolean }) {
  const update = useUpdateAiConnectionMutation()
  const [name, setName] = useState(connection.name)
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl ?? "")
  const [isLocal, setIsLocal] = useState(connection.isLocal)
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(Math.round(connection.timeoutMs / 1000)))
  const [concurrentText, setConcurrentText] = useState(connection.maxConcurrentCalls === null ? "" : String(connection.maxConcurrentCalls))
  const timeout = Number(timeoutSeconds)
  const timeoutValid = Number.isFinite(timeout) && timeout >= 1 && timeout <= 300
  const concurrent = parseConcurrentCalls(concurrentText)
  const endpointRequired = Boolean(provider?.baseUrlRequired && !provider.defaultBaseUrl)
  const canSave = canWrite && name.trim().length > 0 && timeoutValid && concurrent.valid && (!endpointRequired || baseUrl.trim().length > 0)

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Configuração</h3>
      {provider?.notes.length ? (
        <InfoCallout>
          {provider.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </InfoCallout>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="ai-edit-name">Nome</Label>
        <Input id="ai-edit-name" value={name} disabled={!canWrite} maxLength={120} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-edit-endpoint">{endpointRequired ? "Endpoint *" : "Endpoint"}</Label>
        <Input id="ai-edit-endpoint" value={baseUrl} disabled={!canWrite} placeholder={provider?.defaultBaseUrl ?? ""} maxLength={500} onChange={(event) => setBaseUrl(event.target.value)} />
        {provider?.defaultBaseUrl ? <p className="text-xs text-muted-foreground">Em branco = padrão ({provider.defaultBaseUrl}).</p> : null}
      </div>
      {provider?.deployment === "REMOTE_OR_LOCAL" ? (
        <div className="flex items-center gap-2">
          <Switch id="ai-edit-local" checked={isLocal} disabled={!canWrite} onCheckedChange={setIsLocal} />
          <Label htmlFor="ai-edit-local">Endpoint local?</Label>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="ai-edit-timeout">Timeout (segundos)</Label>
        <Input id="ai-edit-timeout" type="number" min={1} max={300} className="w-32" disabled={!canWrite} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} />
      </div>
      <ConcurrentCallsField id="ai-edit-concurrent" value={concurrentText} disabled={!canWrite} onChange={setConcurrentText} />
      {update.isError ? <p className="text-sm text-destructive">{(update.error as Error).message}</p> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            disabled={!canSave || update.isPending}
            onClick={() =>
              update.mutate({
                id: connection.id,
                name: name.trim(),
                baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
                timeoutMs: Math.round(timeout * 1000),
                maxConcurrentCalls: concurrent.value,
                ...(provider?.deployment === "REMOTE_OR_LOCAL" ? { isLocal } : {}),
              })
            }
          >
            {update.isPending ? "Salvando..." : "Salvar configuração"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function CredentialSection({ connection, provider, canWriteSecrets }: { connection: AiConnection; provider: AiProvider | null; canWriteSecrets: boolean }) {
  const replace = useReplaceAiConnectionSecretMutation()
  const remove = useRemoveAiConnectionSecretMutation()
  const [replacing, setReplacing] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (provider?.credential === "NONE") {
    return (
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Credencial</h3>
        <p className="text-xs text-muted-foreground">Este provider não usa credencial.</p>
      </section>
    )
  }
  const label = provider?.credentialLabel || "API key"
  return (
    <section className="space-y-3" data-testid="credential-section">
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden />
        {connection.credential.configured ? (
          <>
            <span className="font-mono" data-testid="credential-masked">
              {connection.credential.maskedValue}
            </span>
            {connection.credential.updatedAt ? <span className="text-xs text-muted-foreground">desde {formatAiDateTime(connection.credential.updatedAt)}</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground">Não configurada{provider?.credential === "REQUIRED" ? " (obrigatória)" : ""}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">O valor não pode ser exibido — só substituído ou removido.</p>
      {canWriteSecrets ? (
        replacing ? (
          <div className="space-y-2">
            <Label htmlFor="ai-new-key">Nova {label.toLowerCase()}</Label>
            <Input id="ai-new-key" type="password" autoComplete="off" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={newKey.trim().length < 4 || replace.isPending}
                onClick={() =>
                  replace.mutate(
                    { id: connection.id, apiKey: newKey.trim(), expectedBaseUrl: connection.effectiveBaseUrl },
                    {
                      onSuccess: () => {
                        setNewKey("")
                        setReplacing(false)
                      },
                    },
                  )
                }
              >
                {replace.isPending ? "Salvando..." : "Salvar chave"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNewKey("")
                  setReplacing(false)
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
              {connection.credential.configured ? "Substituir chave" : "Informar chave"}
            </Button>
            {connection.credential.configured ? (
              <Button size="sm" variant="outline" onClick={() => setConfirmRemove(true)}>
                Remover chave
              </Button>
            ) : null}
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Você não tem permissão para gravar credenciais de IA.</p>
      )}
      <AlertDialog
        open={confirmRemove}
        onOpenChange={(next) => {
          setConfirmRemove(next)
          if (!next) remove.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a chave de {connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>A chave é revogada imediatamente. Chamadas que dependem dela passam a falhar até uma nova ser informada.</AlertDialogDescription>
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
                  await remove.mutateAsync(connection.id)
                  setConfirmRemove(false)
                } catch {
                  // exibido acima (409 AI_CONNECTION_IN_USE)
                }
              }}
            >
              Remover chave
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function HeadersSection({ connection, canWriteSecrets }: { connection: AiConnection; canWriteSecrets: boolean }) {
  const replace = useReplaceAiConnectionHeadersMutation()
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<HeaderRow[]>([])
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Cabeçalhos personalizados</h3>
      {connection.customHeaderNames.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {connection.customHeaderNames.map((header) => (
            <Badge key={header} variant="outline" className="font-mono">
              {header}: ••••
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum cabeçalho configurado.</p>
      )}
      {canWriteSecrets ? (
        editing ? (
          <div className="space-y-2">
            <HeadersEditor rows={rows} onChange={setRows} idPrefix="ai-edit-header" />
            <p className="text-xs text-muted-foreground">Salvar substitui TODOS os cabeçalhos (lista vazia remove).</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={replace.isPending} onClick={() => replace.mutate({ id: connection.id, customHeaders: headersRecord(rows), expectedBaseUrl: connection.effectiveBaseUrl }, { onSuccess: () => setEditing(false) })}>
                Salvar cabeçalhos
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setRows(connection.customHeaderNames.map((header) => ({ name: header, value: "" })))
              setEditing(true)
            }}
          >
            Substituir cabeçalhos
          </Button>
        )
      ) : null}
    </section>
  )
}

function ConnectionChecks({ connection, provider, canWrite, testResult, onTested }: { connection: AiConnection; provider: AiProvider | null; canWrite: boolean; testResult: ConnectionTestResult | null; onTested: (result: ConnectionTestResult) => void }) {
  const test = useTestAiConnectionMutation()
  const sync = useSyncAiConnectionModelsMutation()
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const last = testResult ?? (connection.health.status ? { status: connection.health.status, latencyMs: connection.health.latencyMs, message: connection.health.message, checkedAt: connection.health.checkedAt } : null)
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Verificação</h3>
      <p className="text-xs text-muted-foreground">
        Testar conexão não gera custo: {provider?.supportsModelDiscovery ? "a INIA lista os modelos do provider." : "este provider não oferece verificação automática — use \"Testar modelo\" na aba Modelos."}
      </p>
      {last ? <ConnectionTestResultView result={last} /> : <ConnectionTestStatusBadge status={null} />}
      {syncMessage ? <p className="text-xs text-muted-foreground">{syncMessage}</p> : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(connection.id, { onSuccess: onTested })}>
            <Plug /> {test.isPending ? "Testando..." : "Testar conexão"}
          </Button>
          {provider?.supportsModelDiscovery ? (
            <Button size="sm" variant="outline" disabled={sync.isPending || !connection.enabled} onClick={() => sync.mutate(connection.id, { onSuccess: (report) => setSyncMessage(syncSummary(report)) })}>
              <RefreshCw /> {sync.isPending ? "Sincronizando..." : "Sincronizar modelos"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {connection.enabledModelCount} de {connection.modelCount} modelo(s) habilitado(s) · último uso {connection.lastUsedAt ? formatAiDateTime(connection.lastUsedAt) : "nunca"} · latência do último teste {formatLatency(connection.health.latencyMs)}
      </p>
    </section>
  )
}
