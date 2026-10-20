"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, Copy, FileDown, KeyRound, Pause, Play, Plug, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { useCreatePushTokenMutation, useDataSourceQuery, useDeleteSourceMutation, useRevokePushTokenMutation, useRotatePushTokenMutation, useRotateSecretsMutation, useSetSourceStatusMutation, useSyncFeedMutation, useTestConnectionMutation, useUpdateSourceMutation } from "@/queries/admin/use-data-hub-queries"
import { REMOTE_SOURCE_KINDS, SOURCE_KIND_LABELS, type PushToken, type SourceDetail } from "@/schemas/admin/data-hub.schema"
import { downloadPushOpenApi } from "@/services/admin/data-hub-service"

import { ConnectionForm, connectionDraftValid, draftFromSource, toSourcePayload } from "./connection-form"
import { DatabaseConfigurationTab } from "./database/database-configuration"
import { formatCount, formatDateTime, formatFuture, formatRelative } from "./data-hub-format"
import { FeedsTable } from "./feeds-tab"
import { RunsTab } from "./runs-tab"
import { ConnectionHealthBadge, FreshnessBadge, SourceKindBadge, SourceStatusBadge } from "./status-badges"

const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ConfigurationTab({ source }: { source: SourceDetail }) {
  const update = useUpdateSourceMutation()
  const rotate = useRotateSecretsMutation()
  const [draft, setDraft] = useState(() => draftFromSource(source))
  const payload = toSourcePayload(source.kind, draft)
  const remote = source.kind === "API_PULL" || source.kind === "SFTP"
  return (
    <div className="space-y-6">
      <ConnectionForm kind={source.kind} draft={draft} onChange={setDraft} secretsMode={remote ? "rotate" : "hidden"} />
      {source.secrets.length > 0 ? (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" aria-hidden /> Credenciais configuradas
          </p>
          <ul className="mt-1 text-xs text-muted-foreground">
            {source.secrets.map((secret) => (
              <li key={secret.purpose}>
                {secret.purpose} · configurada em {formatDateTime(secret.createdAt)}
                {secret.rotatedAt ? ` · rotacionada em ${formatDateTime(secret.rotatedAt)}` : ""} · valor nunca exibido
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!connectionDraftValid(source.kind, draft, false) || update.isPending} onClick={() => update.mutate({ id: source.id, input: { name: payload.name, description: payload.description, config: payload.config } })}>
          Salvar configuração
        </Button>
        {remote ? (
          <Button variant="outline" disabled={!payload.secrets || rotate.isPending} onClick={() => rotate.mutate({ id: source.id, secrets: payload.secrets! }, { onSuccess: () => setDraft((current) => ({ ...current, token: "", apiKey: "", password: "", clientSecret: "", privateKey: "", passphrase: "" })) })}>
            <KeyRound /> Rotacionar credencial
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Validade do token novo (R-28): vencido, o token é recusado sozinho; "Sem validade" fica para integrações que não conseguem rotacionar. */
const TOKEN_VALIDITY_OPTIONS = [
  { value: "90", label: "90 dias" },
  { value: "180", label: "180 dias" },
  { value: "365", label: "1 ano" },
  { value: "730", label: "2 anos" },
  { value: "none", label: "Sem validade" },
] as const

/** "10.0.0.5, 10.1.0.0/24" → lista; vazio = qualquer origem. A validação de cada endereço é do backend. */
function parseNetworks(text: string): string[] | null {
  const networks = text.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean)
  return networks.length > 0 ? networks : null
}

function tokenStatus(token: PushToken, now = Date.now()): string {
  if (token.revokedAt) return `Revogado em ${formatDateTime(token.revokedAt)}`
  if (token.expiresAt && Date.parse(token.expiresAt) <= now) return `Vencido em ${formatDateTime(token.expiresAt)}`
  return "Ativo"
}

function PushTokensCard({ source }: { source: SourceDetail }) {
  const create = useCreatePushTokenMutation()
  const revoke = useRevokePushTokenMutation()
  const rotateToken = useRotatePushTokenMutation()
  const [label, setLabel] = useState("")
  const [validity, setValidity] = useState<string>("365")
  const [networks, setNetworks] = useState("")
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null)
  const [downloadingSpec, setDownloadingSpec] = useState(false)
  const endpointBase = `${API_URL}/api/v1/data-ingestion/${source.publicId}`

  async function downloadSpec() {
    setDownloadingSpec(true)
    try {
      const { blob, filename } = await downloadPushOpenApi(source.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename ?? `inia-api-push-${source.publicId}.openapi.json`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    } catch {
      toast.error("Não foi possível gerar o OpenAPI. Tente de novo.")
    } finally {
      setDownloadingSpec(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Tokens de push</CardTitle>
          <CardDescription>
            Endpoint: <code className="font-mono text-xs">POST {endpointBase}/&lt;chave-do-feed&gt;</code>. O segredo aparece só ao criar ou rotacionar.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={downloadingSpec} onClick={() => void downloadSpec()} title="Especificação dos envios desta fonte, para o time que integra (Postman, Swagger)">
          <FileDown aria-hidden /> {downloadingSpec ? "Gerando…" : "Baixar OpenAPI"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {revealed ? (
          <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
            <Label>Novo token — copie agora, não será exibido de novo</Label>
            <div className="flex gap-2">
              <Input readOnly value={revealed.token} className="font-mono text-xs" />
              <Button variant="outline" size="icon" aria-label="Copiar token" onClick={() => navigator.clipboard.writeText(revealed.token).then(() => toast.success("Token copiado."))}>
                <Copy />
              </Button>
            </div>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Rótulo (ex.: Integração RH)" aria-label="Rótulo do token" />
          <Select value={validity} onValueChange={setValidity}>
            <SelectTrigger aria-label="Validade do token">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOKEN_VALIDITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={networks} onChange={(event) => setNetworks(event.target.value)} placeholder="IPs autorizados (opcional, ex.: 10.0.0.0/24)" aria-label="IPs ou redes autorizadas" />
          <Button
            disabled={label.trim().length < 2 || create.isPending}
            onClick={() =>
              create.mutate(
                { sourceId: source.id, label: label.trim(), expiresInDays: validity === "none" ? null : Number(validity), allowedNetworks: parseNetworks(networks) },
                { onSuccess: (token) => { setRevealed({ id: token.id, token: token.token ?? "" }); setLabel(""); setNetworks("") } },
              )
            }
          >
            <Plus /> Novo token
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Com IPs autorizados, o token só funciona quando o envio vem desses endereços (um IP ou uma rede, separados por vírgula). Vazio = qualquer origem.
          Rotacionar mantém a validade e os IPs do token.
        </p>
        {source.tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum token ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Prefixo</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {source.tokens.map((token) => (
                  <TableRow key={token.id} className={token.revokedAt ? "opacity-60" : undefined}>
                    <TableCell>
                      <div>{token.label}</div>
                      {token.allowedNetworks ? <div className="text-xs text-muted-foreground">Só de {token.allowedNetworks.join(", ")}</div> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{token.tokenPrefix}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(token.createdAt)}</TableCell>
                    <TableCell className="text-xs">{token.lastUsedAt ? formatRelative(token.lastUsedAt) : "nunca"}</TableCell>
                    <TableCell className="text-xs">{token.expiresAt ? `Até ${formatDateTime(token.expiresAt)}` : "Sem validade"}</TableCell>
                    <TableCell className="text-xs">{tokenStatus(token)}</TableCell>
                    <TableCell>
                      {!token.revokedAt ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => rotateToken.mutate({ sourceId: source.id, tokenId: token.id }, { onSuccess: (rotated) => setRevealed({ id: rotated.id, token: rotated.token ?? "" }) })}>
                            <RefreshCw /> Rotacionar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ sourceId: source.id, tokenId: token.id })}>
                            Revogar
                          </Button>
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
    </Card>
  )
}

export function SourceDetailPage({ sourceId }: { sourceId: string }) {
  const router = useRouter()
  const query = useDataSourceQuery(sourceId)
  const test = useTestConnectionMutation()
  const status = useSetSourceStatusMutation()
  const sync = useSyncFeedMutation()
  const remove = useDeleteSourceMutation()
  const [deleteOpen, setDeleteOpen] = useState(false)

  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" aria-hidden />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a fonte." onRetry={() => query.refetch()} />
  const source = query.data
  const remote = REMOTE_SOURCE_KINDS.includes(source.kind)
  const syncable = source.feeds.filter((feed) => feed.status === "ACTIVE" || feed.status === "DEGRADED")
  const rejected = source.feeds.reduce((sum, feed) => sum + (feed.lastRun?.recordsRejected ?? 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/data-hub?tab=sources">
              <ArrowLeft /> Fontes
            </Link>
          </Button>
          <h1 className="truncate text-xl font-semibold tracking-tight">{source.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceKindBadge kind={source.kind} />
            <SourceStatusBadge status={source.status} />
            {remote ? <ConnectionHealthBadge health={source.connectionHealth} error={source.connectionError} checkedAt={source.connectionCheckedAt} /> : null}
            <FreshnessBadge freshness={source.feedCount ? source.freshness : null} lastSuccessAt={source.lastSuccessAt} />
          </div>
          {source.description ? <p className="text-sm text-muted-foreground">{source.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {remote ? (
            <Button variant="outline" onClick={() => test.mutate(source.id, { onSuccess: (result) => (result.health === "HEALTHY" ? toast.success(`Conexão OK: ${result.detail}`) : toast.error(`Conexão com erro: ${result.detail}`)) })} disabled={test.isPending}>
              <Plug /> Testar conexão
            </Button>
          ) : null}
          {remote && syncable.length > 0 && source.status !== "DRAFT" ? (
            <Button
              onClick={async () => {
                for (const feed of syncable) {
                  try {
                    await sync.mutateAsync(feed.id)
                  } catch {
                    // toast já exibido
                  }
                }
              }}
              disabled={sync.isPending}
            >
              <RefreshCw /> Sincronizar agora
            </Button>
          ) : null}
          {source.status === "ACTIVE" || source.status === "ERROR" ? (
            <Button variant="outline" onClick={() => status.mutate({ id: source.id, action: "PAUSE" })}>
              <Pause /> Pausar
            </Button>
          ) : null}
          {source.status === "PAUSED" || source.status === "ERROR" ? (
            <Button variant="outline" onClick={() => status.mutate({ id: source.id, action: "RESUME" })}>
              <Play /> Retomar
            </Button>
          ) : null}
          {source.status === "DRAFT" ? (
            <Button variant="outline" onClick={() => status.mutate({ id: source.id, action: "ACTIVATE" })}>
              <Play /> Ativar
            </Button>
          ) : null}
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Remover fonte">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover {source.name}?</AlertDialogTitle>
                <AlertDialogDescription>A fonte e seus feeds saem da Central (histórico de cargas e linhagem são preservados para auditoria). Os dados já aplicados ao domínio continuam existindo — a Central nunca apaga dado do domínio.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(source.id, { onSuccess: () => router.push("/admin/data-hub?tab=sources") })}>
                  Remover
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="feeds">Feeds</TabsTrigger>
            <TabsTrigger value="runs">Cargas</TabsTrigger>
            <TabsTrigger value="quality">Qualidade</TabsTrigger>
            <TabsTrigger value="config">Configuração</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4 space-y-4">
          {source.transportWarning ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="source-transport-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {source.transportWarning}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Última carga" value={formatRelative(source.lastRunAt)} hint={formatDateTime(source.lastRunAt)} />
            <Stat label="Último sucesso" value={formatRelative(source.lastSuccessAt)} hint={formatDateTime(source.lastSuccessAt)} />
            <Stat label="Último dado recebido" value={source.lastDataAt ? formatRelative(source.lastDataAt) : "—"} hint="Maior data de negócio aplicada" />
            <Stat label="Próxima sincronização" value={formatFuture(source.nextSyncAt)} hint={remote ? "Pela cadência dos feeds" : "Sob demanda"} />
            <Stat label="Últimos registros" value={formatCount(source.lastRecordsReceived)} hint="Na carga mais recente" />
            <Stat label="Rejeitados" value={formatCount(rejected)} hint="Nas últimas cargas dos feeds" />
            <Stat label="Feeds" value={`${source.activeFeedCount}/${source.feedCount}`} hint="ativos / total" />
            <Stat label="Conexão verificada" value={formatRelative(source.connectionCheckedAt)} hint={source.connectionError ?? (remote ? "Testar conexão para atualizar" : "Não se aplica")} />
          </div>
          {source.kind === "API_PUSH" ? <PushTokensCard source={source} /> : null}
        </TabsContent>
        <TabsContent value="feeds" className="mt-4 space-y-3">
          {source.feeds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum feed nesta fonte. Adicione um feed reutilizando esta conexão{source.kind === "FILE_UPLOAD" ? " ou importe um arquivo" : ""}.</p>
          ) : (
            <FeedsTable rows={source.feeds.map((feed) => ({ feed, source }))} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/admin/data-hub/sources/new?sourceId=${source.id}`} data-testid="add-feed">
                <Plus /> {source.kind === "DATABASE" ? "Adicionar conjunto de dados" : "Adicionar feed"}
              </Link>
            </Button>
            {source.kind === "FILE_UPLOAD" ? (
              <Button variant="outline" asChild>
                <Link href="/admin/data-hub/import">Importar arquivo</Link>
              </Button>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunsTab sourceId={source.id} />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          {source.feeds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem feeds, sem qualidade a reportar.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feed</TableHead>
                    <TableHead>Dados</TableHead>
                    <TableHead>Último erro</TableHead>
                    <TableHead>Esquema observado</TableHead>
                    <TableHead className="text-right">Rejeitados (última carga)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {source.feeds.map((feed) => (
                    <TableRow key={feed.id}>
                      <TableCell>
                        <Link href={`/admin/data-hub/feeds/${feed.id}`} className="font-medium hover:underline">
                          {feed.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <FreshnessBadge freshness={feed.status === "DRAFT" ? null : feed.freshness} lastSuccessAt={feed.lastSuccessAt} />
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">{feed.lastErrorCode ? `${feed.lastErrorCode}: ${feed.lastErrorMessage ?? ""}` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{feed.schemaFingerprint ? `${feed.schemaFingerprint.columns.length} coluna(s) · ${feed.schemaFingerprint.hash}${feed.schemaChangedAt ? ` · mudou em ${formatDateTime(feed.schemaChangedAt)}` : ""}` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(feed.lastRun?.recordsRejected ?? null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="config" className="mt-4">
          {source.kind === "DATABASE" ? <DatabaseConfigurationTab key={source.updatedAt} source={source} /> : <ConfigurationTab key={source.updatedAt} source={source} />}
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Tipo: {SOURCE_KIND_LABELS[source.kind]} · id público {source.publicId} · criada em {formatDateTime(source.createdAt)}
      </p>
    </div>
  )
}
