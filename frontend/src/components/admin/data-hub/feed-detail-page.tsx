"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Save, Trash2 } from "lucide-react"

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useDataContractsQuery, useDataFeedQuery, useDeleteFeedMutation, useSetFeedStatusMutation, useSyncFeedMutation, useUpdateFeedMutation } from "@/queries/admin/use-data-hub-queries"
import { fetchFeedSample, previewFeedMapping } from "@/services/admin/data-hub-service"
import { REMOTE_SOURCE_KINDS, availabilityPolicyLabel, cadenceLabel, type AvailabilityPolicy, type Cadence, type DatabaseFeedConfig, type FeedMapping, type Preview, type Sample, type SourceKind } from "@/schemas/admin/data-hub.schema"

import { AvailabilityPolicyField, CadenceSelect } from "./connection-form"
import { formatDateTime, formatFuture, formatRelative } from "./data-hub-format"
import { FeedConnectorForm, connectorDraftFrom, toConnectorConfig } from "./feed-connector-form"
import { MappingEditor } from "./mapping-editor"
import { PreviewTable } from "./preview-table"
import { RunsTab } from "./runs-tab"
import { FeedStatusBadge, FreshnessBadge } from "./status-badges"
import { DatabaseCheckpointSummary, DatabaseFeedConnector, configFromSyncDraft, syncDraftFromConfig } from "./database/database-feed-settings"

export function FeedDetailPage({ feedId }: { feedId: string }) {
  const query = useDataFeedQuery(feedId)
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" aria-hidden />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar o feed." onRetry={() => query.refetch()} />
  // Estado do editor nasce do feed carregado; uma atualização persistida (updatedAt) remonta o editor.
  return <FeedEditor key={query.data.updatedAt} feed={query.data} />
}

type LoadedFeed = NonNullable<ReturnType<typeof useDataFeedQuery>["data"]>

function FeedEditor({ feed }: { feed: LoadedFeed }) {
  const router = useRouter()
  const contractsQuery = useDataContractsQuery()
  const update = useUpdateFeedMutation()
  const status = useSetFeedStatusMutation()
  const sync = useSyncFeedMutation()
  const remove = useDeleteFeedMutation()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mapping, setMapping] = useState<FeedMapping>(feed.mapping)
  const [cadence, setCadence] = useState<Cadence>(feed.cadence)
  const [availabilityPolicy, setAvailabilityPolicy] = useState<AvailabilityPolicy | null>(feed.availabilityPolicy ?? null)
  const [authoritative, setAuthoritative] = useState<boolean>(feed.authoritative)
  const [failOnAnyRejection, setFailOnAnyRejection] = useState<boolean>(feed.failOnAnyRejection)
  const [sample, setSample] = useState<Sample | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connector, setConnector] = useState(() => connectorDraftFrom(feed.connectorConfig))

  const contract = contractsQuery.data?.contracts.find((entry) => entry.key === feed.contractKey)
  const kind = (feed.source?.kind ?? "FILE_UPLOAD") as SourceKind
  const remote = REMOTE_SOURCE_KINDS.includes(kind)
  const databaseConfig = kind === "DATABASE" ? (feed.connectorConfig.database as DatabaseFeedConfig) : null
  const [databaseSync, setDatabaseSync] = useState(() => (databaseConfig ? syncDraftFromConfig(databaseConfig) : null))
  const columns = sample?.columns ?? feed.schemaFingerprint?.columns ?? mapping.fields.map((field) => field.source).filter((source): source is string => Boolean(source))

  async function loadSample() {
    setBusy(true)
    setError(null)
    try {
      const fetched = await fetchFeedSample(feed.id)
      setSample(fetched)
      setPreview(null)
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Não foi possível buscar a amostra (fontes de arquivo/push precisam de um envio; use a importação).")
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    if (!sample) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await previewFeedMapping(feed.id, { mapping, sample: { columns: sample.columns, records: sample.records } }))
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Não foi possível validar.")
    } finally {
      setBusy(false)
    }
  }

  function save() {
    const connectorConfig = databaseConfig && databaseSync ? { connector: "DATABASE", database: configFromSyncDraft(databaseConfig, databaseSync) } : toConnectorConfig(kind, connector)
    update.mutate({ id: feed.id, input: { mapping, cadence, authoritative, failOnAnyRejection, availabilityPolicy, connectorConfig } })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={feed.source ? `/admin/data-hub/sources/${feed.source.id}` : "/admin/data-hub?tab=feeds"}>
              <ArrowLeft /> {feed.source?.name ?? "Feeds"}
            </Link>
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">{feed.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <FeedStatusBadge status={feed.status} />
            <FreshnessBadge freshness={feed.status === "DRAFT" ? null : feed.freshness} lastSuccessAt={feed.lastSuccessAt} />
            <span className="text-xs text-muted-foreground">
              {feed.contractLabel} · {feed.contractKey}@{feed.contractVersion} · chave {feed.feedKey} · {cadenceLabel(feed.cadence)}{feed.availabilityPolicy ? ` · dados esperados: ${availabilityPolicyLabel(feed.availabilityPolicy)}` : ""}
            </span>
          </div>
          {feed.lastErrorCode ? (
            <p className="text-xs text-destructive">
              Último erro: {feed.lastErrorCode} — {feed.lastErrorMessage}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {remote && feed.status !== "DRAFT" ? (
            <Button variant="outline" onClick={() => sync.mutate(feed.id)} disabled={sync.isPending}>
              <RefreshCw /> Sincronizar agora
            </Button>
          ) : null}
          {feed.status === "ACTIVE" || feed.status === "DEGRADED" ? (
            <Button variant="outline" onClick={() => status.mutate({ id: feed.id, action: "PAUSE" })}>
              <Pause /> Pausar
            </Button>
          ) : (
            <Button variant="outline" onClick={() => status.mutate({ id: feed.id, action: feed.status === "DRAFT" ? "ACTIVATE" : "RESUME" })}>
              <Play /> {feed.status === "DRAFT" ? "Ativar" : "Retomar"}
            </Button>
          )}
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Remover conjunto de dados">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover {feed.name}?</AlertDialogTitle>
                <AlertDialogDescription>Este conjunto de dados sai da Central e deixa de ser sincronizado{feed.source ? ` (a conexão ${feed.source.name} e os outros conjuntos dela continuam)` : ""}. O histórico de cargas e a linhagem são preservados para auditoria. Os dados já aplicados ao domínio continuam existindo — a Central nunca apaga dado do domínio.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(feed.id, { onSuccess: () => router.push(feed.source ? `/admin/data-hub/sources/${feed.source.id}` : "/admin/data-hub?tab=feeds") })}>
                  Remover
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-3"><dt className="text-xs text-muted-foreground">Último sucesso</dt><dd>{formatRelative(feed.lastSuccessAt)}</dd></div>
        <div className="rounded-lg border border-border p-3"><dt className="text-xs text-muted-foreground">Último dado</dt><dd>{feed.lastDataAt ? formatDateTime(feed.lastDataAt) : "—"}</dd></div>
        <div className="rounded-lg border border-border p-3"><dt className="text-xs text-muted-foreground">Próxima sincronização</dt><dd>{formatFuture(feed.nextSyncAt)}</dd></div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{databaseConfig ? "Leitura" : "Checkpoint"}</dt>
          <dd className={databaseConfig ? undefined : "truncate font-mono text-xs"}>{databaseConfig ? <DatabaseCheckpointSummary feedId={feed.id} checkpoint={feed.checkpoint} /> : feed.checkpoint ? JSON.stringify(feed.checkpoint) : "—"}</dd>
        </div>
      </dl>

      <Tabs defaultValue="mapping">
        <TabsList>
          <TabsTrigger value="mapping">Mapeamento</TabsTrigger>
          <TabsTrigger value="settings">Conector e frequência</TabsTrigger>
          <TabsTrigger value="runs">Cargas</TabsTrigger>
        </TabsList>
        <TabsContent value="mapping" className="mt-4 space-y-4">
          {contract ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {remote ? (
                  <Button variant="outline" size="sm" onClick={loadSample} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : null} Buscar amostra da fonte
                  </Button>
                ) : null}
                {sample ? (
                  <Button variant="outline" size="sm" onClick={runPreview} disabled={busy}>
                    Validar com a amostra
                  </Button>
                ) : null}
                <span className="text-xs text-muted-foreground">Colunas conhecidas: {columns.length}{feed.schemaFingerprint ? ` (esquema observado ${formatDateTime(feed.schemaFingerprint.observedAt)})` : ""}</span>
              </div>
              <MappingEditor contract={contract} columns={columns} value={mapping} onChange={(next) => { setMapping(next); setPreview(null) }} suggestion={sample?.suggestedMapping ?? null} />
              {preview ? <PreviewTable preview={preview} contract={contract} /> : null}
            </>
          ) : (
            <Skeleton className="h-40" aria-hidden />
          )}
        </TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Conector</CardTitle>
              <CardDescription>Como este conjunto de dados é buscado ou recebido.</CardDescription>
            </CardHeader>
            <CardContent>
              {databaseConfig && databaseSync && feed.source ? <DatabaseFeedConnector sourceId={feed.source.id} config={databaseConfig} draft={databaseSync} onChange={setDatabaseSync} /> : <FeedConnectorForm kind={kind} draft={connector} onChange={setConnector} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Frequência, disponibilidade e política</CardTitle>
              <CardDescription>A cadência define o &quot;atrasado&quot; (freshness); a disponibilidade esperada define quando o dado de um dia já deveria ter chegado (SLA D-1/D-2); a política define o que acontece com rejeições.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {remote ? <CadenceSelect value={cadence} onChange={setCadence} /> : <p className="text-sm text-muted-foreground">Feed sob demanda (arquivo ou push).</p>}
              <AvailabilityPolicyField value={availabilityPolicy} onChange={setAvailabilityPolicy} contractKey={feed.contractKey} />
              <div className="grid gap-3 sm:grid-cols-2">
                {contract?.category === "MASTER" ? (
                  <label className="flex items-start gap-3 text-sm">
                    <Switch checked={authoritative} onCheckedChange={setAuthoritative} aria-label="Fonte autoritativa" />
                    <span>
                      <span className="font-medium">Fonte autoritativa deste cadastro</span>
                      <span className="block text-xs text-muted-foreground">Uma por contrato de dado mestre.</span>
                    </span>
                  </label>
                ) : null}
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={failOnAnyRejection} onCheckedChange={setFailOnAnyRejection} aria-label="Exigir carga íntegra" />
                  <span>
                    <span className="font-medium">Exigir carga íntegra</span>
                    <span className="block text-xs text-muted-foreground">Qualquer rejeição impede a carga inteira.</span>
                  </span>
                </label>
              </div>
              <div className="space-y-1.5">
                <Label>Namespace de origem</Label>
                <Input readOnly value={feed.sourceNamespace ?? feed.source?.publicId ?? ""} className="font-mono text-xs" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunsTab feedId={feed.id} />
        </TabsContent>
      </Tabs>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end border-t pt-4">
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar feed
        </Button>
      </div>
    </div>
  )
}
