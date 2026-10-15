"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, FileUp, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useCreateFeedMutation, useCreateSourceMutation, useDataContractsQuery, useDataRunQuery, useDataSourcesQuery, useImportFileMutation, useUpdateFeedMutation } from "@/queries/admin/use-data-hub-queries"
import { fetchSourceSample, previewSourceMapping, uploadFile } from "@/services/admin/data-hub-service"
import { CONTRACT_CATEGORY_LABELS, type DataContract, type FeedMapping, type FeedSummary, type Preview, type Sample, type SourceSummary, type UploadResult } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

import { formatCount, formatDuration } from "./data-hub-format"
import { FileOptionsFields, emptyConnectorDraft, toConnectorConfig, type ConnectorDraft } from "./feed-connector-form"
import { MappingEditor } from "./mapping-editor"
import { PreviewTable } from "./preview-table"
import { RunStatusBadge } from "./status-badges"

const STEPS = ["Upload", "Tipo de dado", "Configuração", "Mapeamento", "Validação", "Importar", "Resultado"] as const
const NEW_FEED = "__new__"

/**
 * Importação manual de CSV/Excel: upload → contrato/feed → aba/separador → mapeamento →
 * validação (zero efeitos) → importar (cria a carga, processada fora do request) → resultado.
 */
export function FileImportFlow() {
  const params = useSearchParams()
  const presetFeedId = params.get("feedId")
  const contractsQuery = useDataContractsQuery()
  const sourcesQuery = useDataSourcesQuery()
  const createSource = useCreateSourceMutation()
  const createFeed = useCreateFeedMutation()
  const updateFeed = useUpdateFeedMutation()
  const importFile = useImportFileMutation()

  const [step, setStep] = useState(0)
  const [upload, setUpload] = useState<UploadResult | null>(null)
  const [connector, setConnector] = useState<ConnectorDraft>(emptyConnectorDraft())
  const [feedChoice, setFeedChoice] = useState<string>(presetFeedId ?? "")
  const [contractKey, setContractKey] = useState("")
  const [newFeedName, setNewFeedName] = useState("")
  // O nome sugerido acompanha o tipo de dado até a pessoa digitar o próprio.
  const [newFeedNameTyped, setNewFeedNameTyped] = useState(false)
  const [sample, setSample] = useState<Sample | null>(null)
  const [mapping, setMapping] = useState<FeedMapping>({ fields: [] })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const runQuery = useDataRunQuery(runId ?? "")

  const fileSources: SourceSummary[] = useMemo(() => (sourcesQuery.data ?? []).filter((source) => source.kind === "FILE_UPLOAD"), [sourcesQuery.data])
  const fileFeeds: { feed: FeedSummary; source: SourceSummary }[] = useMemo(() => fileSources.flatMap((source) => source.feeds.map((feed) => ({ feed, source }))), [fileSources])
  const chosen = fileFeeds.find((entry) => entry.feed.id === feedChoice) ?? null
  const contracts = contractsQuery.data?.contracts ?? []
  const contract: DataContract | undefined = contracts.find((entry) => entry.key === (chosen ? chosen.feed.contractKey : contractKey))
  const targetSource = chosen?.source ?? fileSources[0] ?? null

  // Feed já existente: o mapeamento salvo é o ponto de partida até o usuário mexer.
  const effectiveMapping: FeedMapping = mapping.fields.length > 0 ? mapping : (chosen?.feed.mapping ?? mapping)

  function fail(err: unknown, fallback: string) {
    setError(err instanceof AdminApiError ? err.message : err instanceof Error ? err.message : fallback)
  }

  function chooseContract(key: string) {
    setContractKey(key)
    setMapping({ fields: [] })
    setSample(null)
    setPreview(null)
    const chosenContract = contracts.find((entry) => entry.key === key)
    if (chosenContract && !newFeedNameTyped) setNewFeedName(suggestedFeedName(chosenContract, upload))
  }

  /** "Importar outro arquivo": recomeça do zero — nada do arquivo anterior (nome do feed, tipo, separador, mapeamento) passa adiante. */
  function restart() {
    setStep(0)
    setUpload(null)
    setConnector(emptyConnectorDraft())
    setFeedChoice(presetFeedId ?? "")
    setContractKey("")
    setNewFeedName("")
    setNewFeedNameTyped(false)
    setSample(null)
    setMapping({ fields: [] })
    setPreview(null)
    setError(null)
    setRunId(null)
  }

  async function doUpload(selected: File) {
    setBusy(true)
    setError(null)
    try {
      const uploaded = await uploadFile({ file: selected, sourceId: targetSource?.id, encoding: connector.encoding, delimiter: connector.delimiter })
      setUpload(uploaded)
      setConnector((current) => ({ ...current, format: uploaded.format, sheet: uploaded.sheets[0] ?? "" }))
      if (contract && !newFeedNameTyped) setNewFeedName(suggestedFeedName(contract, uploaded))
      setSample(null)
      setPreview(null)
    } catch (err) {
      fail(err, "Não foi possível ler o arquivo.")
    } finally {
      setBusy(false)
    }
  }

  async function ensureSource(): Promise<SourceSummary | { id: string } | null> {
    if (targetSource) return targetSource
    try {
      return await createSource.mutateAsync({ name: "Importação manual", description: "Arquivos CSV/Excel enviados pela Central de Dados.", config: { kind: "FILE_UPLOAD" } })
    } catch {
      return null
    }
  }

  async function loadSample() {
    if (!upload || !contract) return
    const source = await ensureSource()
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      const fetched = await fetchSourceSample(source.id, { connectorConfig: toConnectorConfig("FILE_UPLOAD", connector), contractKey: contract.key, rawObjectId: upload.rawObjectId })
      setSample(fetched)
      setMapping((current) => (current.fields.length ? current : chosen ? chosen.feed.mapping : fetched.suggestedMapping))
      setPreview(null)
    } catch (err) {
      fail(err, "Não foi possível ler a amostra.")
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    if (!sample || !contract) return
    const source = await ensureSource()
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await previewSourceMapping(source.id, { contractKey: contract.key, mapping: effectiveMapping, sample: { columns: sample.columns, records: sample.records } }))
    } catch (err) {
      fail(err, "Não foi possível validar a amostra.")
    } finally {
      setBusy(false)
    }
  }

  async function doImport() {
    if (!upload || !contract) return
    const source = await ensureSource()
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      let feedId = chosen?.feed.id ?? null
      const connectorConfig = toConnectorConfig("FILE_UPLOAD", connector)
      if (feedId) {
        await updateFeed.mutateAsync({ id: feedId, input: { contractVersion: contract.version, mapping: effectiveMapping, connectorConfig } })
      } else {
        const created = await createFeed.mutateAsync({ sourceId: source.id, input: { feedKey: slug(newFeedName || contract.label), name: newFeedName || contract.label, contractKey: contract.key, connectorConfig, mapping: effectiveMapping } })
        feedId = created.id
      }
      const run = await importFile.mutateAsync({ feedId, rawObjectId: upload.rawObjectId })
      setRunId(run.id)
      setStep(6)
    } catch (err) {
      fail(err, "Não foi possível iniciar a importação.")
    } finally {
      setBusy(false)
    }
  }

  async function next() {
    setError(null)
    if (step === 2) {
      setStep(3)
      await loadSample()
      return
    }
    if (step === 3) {
      setStep(4)
      await runPreview()
      return
    }
    setStep(step + 1)
  }

  const canContinue = (() => {
    switch (step) {
      case 0:
        return upload !== null
      case 1:
        return chosen !== null || (Boolean(contract) && newFeedName.trim().length >= 2)
      case 2:
        return true
      case 3:
        return contract !== undefined && contract.fields.filter((field) => field.required).every((field) => effectiveMapping.fields.some((entry) => entry.target === field.key))
      case 4:
        return preview !== null && preview.mappingProblems.length === 0 && preview.valid > 0
      default:
        return true
    }
  })()

  const run = runQuery.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUp className="size-5 text-primary" aria-hidden /> Importar arquivo
        </CardTitle>
        <CardDescription>
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Etapas">
            {STEPS.map((label, index) => (
              <li key={label} className={cn("inline-flex items-center gap-1", index === step ? "font-semibold text-primary" : index < step ? "text-foreground" : "text-muted-foreground")} aria-current={index === step ? "step" : undefined}>
                <span className={cn("inline-flex size-5 items-center justify-center rounded-full border text-[10px]", index < step ? "border-primary bg-primary text-primary-foreground" : index === step ? "border-primary" : "border-border")}>{index < step ? <Check className="size-3" /> : index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 0 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="import-file">Arquivo (.csv ou .xlsx)</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx,text/csv"
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null
                  if (selected) void doUpload(selected)
                }}
              />
              <p className="text-xs text-muted-foreground">Até 50 MB. Macros nunca são executadas. O arquivo fica retido por 30 dias para reprocessamento.</p>
            </div>
            {busy ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Lendo o arquivo…
              </p>
            ) : upload ? (
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{upload.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {upload.format} · {formatCount(upload.totalRecords)} registro(s) · {upload.columns.length} coluna(s){upload.detail ? ` · ${upload.detail}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {upload.columns.map((column) => (
                    <span key={column} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                      {column}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="import-feed">Para qual feed?</Label>
              <Select value={feedChoice || NEW_FEED} onValueChange={(value) => { setFeedChoice(value === NEW_FEED ? "" : value); setMapping({ fields: [] }); setSample(null); setPreview(null) }}>
                <SelectTrigger id="import-feed" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_FEED}>Novo feed (escolher o tipo de dado)</SelectItem>
                  {fileFeeds.map(({ feed, source }) => (
                    <SelectItem key={feed.id} value={feed.id}>
                      {feed.name} · {feed.contractLabel} ({source.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Reaproveitar um feed mantém o mapeamento já validado; um feed novo guarda o mapeamento para as próximas importações.</p>
            </div>
            {!chosen ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="import-contract">Tipo de dado (contrato)</Label>
                  <Select value={contractKey} onValueChange={chooseContract}>
                    <SelectTrigger id="import-contract" className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {contracts.map((entry) => (
                        <SelectItem key={entry.key} value={entry.key}>
                          {entry.label} · {CONTRACT_CATEGORY_LABELS[entry.category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {contract ? <p className="text-xs text-muted-foreground">{contract.description}</p> : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="import-feed-name">Nome do novo feed</Label>
                  <Input
                    id="import-feed-name"
                    value={newFeedName}
                    onChange={(event) => {
                      setNewFeedName(event.target.value)
                      setNewFeedNameTyped(event.target.value.trim().length > 0)
                    }}
                    placeholder={contract ? suggestedFeedName(contract, upload) : "Ex.: Colaboradores (CSV)"}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 && upload ? <FileOptionsFields draft={connector} onChange={setConnector} sheets={upload.sheets} /> : null}

        {step === 3 && contract ? (
          busy || !sample ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Lendo a amostra…
            </p>
          ) : (
            <MappingEditor contract={contract} columns={sample.columns} value={effectiveMapping} onChange={setMapping} suggestion={sample.suggestedMapping} />
          )
        ) : null}

        {step === 4 && contract ? (
          busy || !preview ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Validando a amostra…
            </p>
          ) : (
            <PreviewTable preview={preview} contract={contract} />
          )
        ) : null}

        {step === 5 && upload && contract ? (
          <div className="space-y-3 text-sm">
            <p>
              Importar <strong>{upload.filename}</strong> ({formatCount(upload.totalRecords)} registro(s)) como <strong>{contract.label}</strong>
              {chosen ? ` pelo feed ${chosen.feed.name}` : ` num feed novo "${newFeedName || contract.label}"`}.
            </p>
            <p className="text-muted-foreground">A carga é processada em segundo plano; registros válidos entram no domínio pelos mesmos caminhos da ingestão em tempo real (inclusive gatilhos de Workflow) e os inválidos vão para a quarentena.</p>
            <Button onClick={doImport} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />} Importar agora
            </Button>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-3">
            {!run ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Carga na fila…
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <RunStatusBadge status={run.status} errorMessage={run.errorMessage} />
                  <span className="text-sm text-muted-foreground">{run.stages[run.stages.length - 1]?.detail ?? ""}</span>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Recebidos", run.recordsReceived],
                    ["Válidos", run.recordsValid],
                    ["Inseridos", run.recordsInserted],
                    ["Atualizados", run.recordsUpdated],
                    ["Inalterados", run.recordsUnchanged],
                    // Ex.: ausência cancelada pela fonte (Vigente? = não) — só aparece quando houve.
                    ...(run.recordsDeactivated > 0 ? [["Desativados", run.recordsDeactivated]] : []),
                    ["Rejeitados", run.recordsRejected],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg border border-border p-2">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-lg tabular-nums">{formatCount(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
                {run.errorMessage ? <p className="text-sm text-destructive">{run.errorMessage}</p> : null}
                {run.durationMs !== null ? <p className="text-xs text-muted-foreground">Duração: {formatDuration(run.durationMs)}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href={`/admin/data-hub/runs/${run.id}`}>Ver detalhe da carga</Link>
                  </Button>
                  <Button variant="outline" onClick={restart}>
                    Importar outro arquivo
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link href="/admin/data-hub">Voltar à Central</Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {step < 6 ? (
          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || busy}>
              <ArrowLeft /> Voltar
            </Button>
            {step < 5 ? (
              <Button onClick={next} disabled={!canContinue || busy}>
                Continuar <ArrowRight />
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function suggestedFeedName(contract: DataContract, upload: UploadResult | null): string {
  return `${contract.label} (${upload?.format === "XLSX" ? "Excel" : "CSV"})`
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "feed"
}
