"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Plug } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { AdminApiError } from "@/lib/admin/admin-api"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { useCreateFeedMutation, useCreatePushTokenMutation, useCreateSourceMutation, useDataContractsQuery, useDataSourceQuery, useSetFeedStatusMutation, useTestConnectionMutation, useUpdateSourceMutation } from "@/queries/admin/use-data-hub-queries"
import { fetchSourceSample, previewSourceMapping, uploadFile } from "@/services/admin/data-hub-service"
import { CONTRACT_CATEGORY_LABELS, LOAD_MODE_LABELS, SOURCE_KIND_DESCRIPTIONS, SOURCE_KIND_LABELS, SOURCE_KINDS, availabilityPolicyLabel, cadenceLabel, cadenceProblem, type AvailabilityPolicy, type Cadence, type ConnectionTest, type DataContract, type FeedMapping, type Preview, type Sample, type Source, type SourceDetail, type SourceKind } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

import { CadenceSelect } from "./cadence-select"
import { ConfigAccessPanel, isConfigLocked } from "./config-access/config-access-panel"
import { useConfigUnlockPrompt } from "./config-access/use-config-unlock-prompt"
import { AvailabilityPolicyField, ConnectionForm, connectionDraftValid, draftFromSource, emptyConnectionDraft, toSourcePayload, type ConnectionDraft } from "./connection-form"
import { ContractPayloadExample } from "./contracts-tab"
import { FeedConnectorForm, connectorDraftValid, emptyConnectorDraft, toConnectorConfig, type ConnectorDraft } from "./feed-connector-form"
import { MappingEditor } from "./mapping-editor"
import { PreviewTable } from "./preview-table"
import { ConnectionHealthBadge, SOURCE_KIND_ICONS } from "./status-badges"
import { DatabaseWizard } from "./database/database-wizard"

const STEPS = ["Tipo da conexão", "Configurar conexão", "Testar conexão", "Adicionar feed", "Buscar amostra", "Mapear campos", "Validar", "Frequência", "Revisar", "Ativar"] as const
/** Em uma fonte existente o wizard começa aqui: conexão, autenticação e segredos já existem e são reutilizados. */
const ADD_FEED_FIRST_STEP = 3

const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

function Stepper({ current, offset = 0 }: { current: number; offset?: number }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Etapas">
      {STEPS.slice(offset).map((label, index) => {
        const position = index + offset
        return (
          <li key={label} className={cn("inline-flex items-center gap-1", position === current ? "font-semibold text-primary" : position < current ? "text-foreground" : "text-muted-foreground")} aria-current={position === current ? "step" : undefined}>
            <span className={cn("inline-flex size-5 items-center justify-center rounded-full border text-[10px]", position < current ? "border-primary bg-primary text-primary-foreground" : position === current ? "border-primary" : "border-border")}>{position < current ? <Check className="size-3" /> : index + 1}</span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Wizard "Nova fonte": tipo → conexão → teste → feed → contrato → amostra → mapeamento →
 * validação → frequência → revisão → ativação. Nada é aplicado ao domínio antes da ativação; a
 * amostra e a validação são somente leitura.
 *
 * Com `?sourceId=` o mesmo wizard vira "Adicionar feed" a uma fonte existente: pula tipo,
 * conexão e teste (reaproveita conexão, autenticação e segredos) e começa na escolha do
 * contrato — uma fonte, muitos feeds (ex.: API RH › Colaboradores + Ausências + Escalas). Fonte com
 * credencial guardada pede a credencial antes de continuar: quem configura precisa conhecê-la.
 */
export function SourceWizard() {
  const params = useSearchParams()
  const sourceId = params.get("sourceId")
  const presetContractKey = params.get("contractKey")
  if (!sourceId) return params.get("kind") === "DATABASE" ? <DatabaseWizard /> : <Wizard presetContractKey={presetContractKey} />
  return <AddFeedWizard sourceId={sourceId} presetContractKey={presetContractKey} />
}

function AddFeedWizard({ sourceId, presetContractKey }: { sourceId: string; presetContractKey: string | null }) {
  const query = useDataSourceQuery(sourceId)
  // "Adicionar outro conjunto desta conexão" aponta para este mesmo endereço: trocar a rodada remonta o assistente do zero.
  const [round, setRound] = useState(0)
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" aria-hidden />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a fonte para adicionar o feed." onRetry={() => query.refetch()} />
  // Banco externo: a mesma conexão alimenta outro conjunto de dados — começa na escolha da tabela/visão.
  if (query.data.kind === "DATABASE") return <DatabaseWizard key={`${query.data.id}:${round}`} existing={query.data} onAddAnother={() => setRound((current) => current + 1)} />
  return <Wizard key={query.data.id} existing={query.data} presetContractKey={presetContractKey} />
}

function Wizard({ existing = null, presetContractKey }: { existing?: SourceDetail | null; presetContractKey: string | null }) {
  const router = useRouter()
  const prompt = useConfigUnlockPrompt()
  const contractsQuery = useDataContractsQuery()
  const createSource = useCreateSourceMutation()
  const updateSource = useUpdateSourceMutation()
  const testConnection = useTestConnectionMutation()
  const createFeed = useCreateFeedMutation()
  const setFeedStatus = useSetFeedStatusMutation()
  const createToken = useCreatePushTokenMutation()

  const addingFeed = existing !== null
  const firstStep = addingFeed ? ADD_FEED_FIRST_STEP : 0
  const needsPassword = isConfigLocked(existing?.configAccess)
  const [step, setStep] = useState(firstStep)
  const [kind, setKind] = useState<SourceKind | null>(existing?.kind ?? null)
  const [connection, setConnection] = useState<ConnectionDraft>(() => (existing ? draftFromSource(existing) : emptyConnectionDraft()))
  const [source, setSource] = useState<Source | null>(existing)
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const [feedKey, setFeedKey] = useState("")
  const [feedName, setFeedName] = useState("")
  const [contractKey, setContractKey] = useState(presetContractKey ?? "")
  const [connector, setConnector] = useState<ConnectorDraft>(emptyConnectorDraft())
  const [uploadedRawId, setUploadedRawId] = useState<string | null>(null)
  const [uploadedSheets, setUploadedSheets] = useState<string[]>([])
  const [pushExample, setPushExample] = useState("")
  const [sample, setSample] = useState<Sample | null>(null)
  const [mapping, setMapping] = useState<FeedMapping>({ fields: [] })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [cadence, setCadence] = useState<Cadence>({ kind: "MANUAL" })
  const [availabilityPolicy, setAvailabilityPolicy] = useState<AvailabilityPolicy | null>(null)
  const [loadMode, setLoadMode] = useState<"DELTA" | "SNAPSHOT">("DELTA")
  const [authoritative, setAuthoritative] = useState(false)
  const [failOnAnyRejection, setFailOnAnyRejection] = useState(false)
  const [sourceNamespace, setSourceNamespace] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ feedId: string; token: string | null } | null>(null)

  const contracts = contractsQuery.data?.contracts ?? []
  const contract: DataContract | undefined = contracts.find((entry) => entry.key === contractKey)
  const remote = kind === "API_PULL" || kind === "SFTP" || kind === "DATABASE"
  const connectorConfig = useMemo(() => (kind ? toConnectorConfig(kind, connector) : null), [kind, connector])

  function fail(err: unknown, fallback: string) {
    setError(err instanceof AdminApiError ? err.message : err instanceof Error ? err.message : fallback)
  }

  async function saveSource(): Promise<Source | null> {
    if (!kind) return null
    const payload = toSourcePayload(kind, connection)
    try {
      const current = source
      const saved = current ? await prompt.guarded(() => updateSource.mutateAsync({ id: current.id, input: payload })) : await createSource.mutateAsync(payload)
      setSource(saved)
      return saved
    } catch {
      return null
    }
  }

  async function runTest(current: Source) {
    try {
      const outcome = await testConnection.mutateAsync(current.id)
      setTest(outcome)
    } catch {
      // toast já exibido
    }
  }

  async function loadSample() {
    if (!source || !kind || !connectorConfig || !contract) return
    setBusy(true)
    setError(null)
    try {
      if (kind === "API_PUSH") {
        const records = pushExample.trim() ? (JSON.parse(pushExample) as { records?: unknown[] }).records ?? JSON.parse(pushExample) : contract.examples
        const list = (Array.isArray(records) ? records : []) as Record<string, unknown>[]
        const columns = [...new Set(list.flatMap((record) => Object.keys(record)))]
        setSample({ columns, records: list, totalRecords: list.length, detail: pushExample.trim() ? "Payload de exemplo informado" : "Exemplo do contrato", suggestedMapping: { fields: contract.fields.filter((field) => columns.includes(field.key)).map((field) => ({ target: field.key, source: field.key, transforms: [] })) } })
        setMapping((current) => (current.fields.length ? current : { fields: contract.fields.filter((field) => columns.includes(field.key)).map((field) => ({ target: field.key, source: field.key, transforms: [] })) }))
      } else {
        const fetched = await prompt.guarded(() => fetchSourceSample(source.id, { connectorConfig, contractKey: contract.key, rawObjectId: kind === "FILE_UPLOAD" ? uploadedRawId : null }))
        setSample(fetched)
        if (fetched.sheets?.length) setUploadedSheets(fetched.sheets)
        setMapping((current) => (current.fields.length ? current : fetched.suggestedMapping))
      }
      setPreview(null)
    } catch (err) {
      fail(err, "Não foi possível buscar a amostra.")
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    if (!source || !contract || !sample) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await prompt.guarded(() => previewSourceMapping(source.id, { contractKey: contract.key, mapping, sample: { columns: sample.columns, records: sample.records } })))
    } catch (err) {
      fail(err, "Não foi possível validar a amostra.")
    } finally {
      setBusy(false)
    }
  }

  async function activate() {
    if (!source || !kind || !connectorConfig || !contract) return
    setBusy(true)
    setError(null)
    try {
      const feed = await prompt.guarded(() => createFeed.mutateAsync({ sourceId: source.id, input: { feedKey, name: feedName, contractKey: contract.key, connectorConfig, mapping, loadMode, cadence, authoritative, failOnAnyRejection, availabilityPolicy, sourceNamespace: sourceNamespace.trim() || undefined } }))
      await prompt.guarded(() => setFeedStatus.mutateAsync({ id: feed.id, action: "ACTIVATE" }))
      let token: string | null = null
      if (kind === "API_PUSH") token = (await createToken.mutateAsync({ sourceId: source.id, label: `Token ${feedName}`, feedId: feed.id })).token ?? null
      setResult({ feedId: feed.id, token })
    } catch (err) {
      fail(err, "Não foi possível ativar a fonte.")
    } finally {
      setBusy(false)
    }
  }

  async function next() {
    setError(null)
    if (step === 1) {
      const saved = await saveSource()
      if (!saved) return
      if (!remote) return setStep(3)
      setStep(2)
      void runTest(saved)
      return
    }
    if (step === 3 && kind === "FILE_UPLOAD" && !uploadedRawId) return setError("Envie um arquivo de exemplo para continuar.")
    if (step === 3) {
      setStep(4)
      void loadSample()
      return
    }
    if (step === 5) {
      setStep(6)
      void runPreview()
      return
    }
    setStep(step + 1)
  }

  const canContinue = (() => {
    switch (step) {
      case 0:
        return kind !== null
      case 1:
        return kind !== null && connectionDraftValid(kind, connection, true)
      case 2:
        return true
      case 3:
        return !needsPassword && Boolean(kind && contract && /^[a-z0-9][a-z0-9-_]{1,63}$/.test(feedKey) && feedName.trim().length >= 2 && connectorDraftValid(kind, connector))
      case 4:
        return sample !== null
      case 5:
        return contract !== undefined && contract.fields.filter((field) => field.required).every((field) => mapping.fields.some((entry) => entry.target === field.key))
      case 6:
        return preview !== null && preview.mappingProblems.length === 0
      case 7:
        return !remote || cadenceProblem(cadence) === null
      default:
        return true
    }
  })()

  if (result) {
    const endpoint = source && kind === "API_PUSH" ? `${API_URL}/api/v1/data-ingestion/${source.publicId}/${feedKey}` : null
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-emerald-600 dark:text-emerald-300" aria-hidden /> {addingFeed ? "Feed ativado" : "Fonte ativada"}
          </CardTitle>
          <CardDescription>
            {source?.name} · feed {feedName} ({contract?.label}).{remote ? " A primeira sincronização pode ser disparada em Sincronizar agora." : kind === "FILE_UPLOAD" ? " Envie arquivos pela tela Importar arquivo." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {endpoint ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Integração API Push</p>
              <div className="space-y-1">
                <Label htmlFor="push-endpoint">Endpoint</Label>
                <div className="flex gap-2">
                  <Input id="push-endpoint" readOnly value={`POST ${endpoint}`} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" aria-label="Copiar endpoint" onClick={() => navigator.clipboard.writeText(endpoint).then(() => toast.success("Endpoint copiado."))}>
                    <Copy />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="push-token">Token (exibido só agora — guarde com segurança)</Label>
                <div className="flex gap-2">
                  <Input id="push-token" readOnly value={result.token ?? ""} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" aria-label="Copiar token" onClick={() => navigator.clipboard.writeText(result.token ?? "").then(() => toast.success("Token copiado."))}>
                    <Copy />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Headers: <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>, <code className="font-mono">Idempotency-Key: &lt;id do lote&gt;</code>, <code className="font-mono">Content-Type: application/json</code>. Mesmo lote com a mesma chave nunca duplica.
              </p>
              {contract ? (
                <div className="space-y-1">
                  <Label>Payload de exemplo</Label>
                  <ContractPayloadExample contract={contract} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/admin/data-hub/sources/${source!.id}`)}>Abrir a fonte</Button>
            {kind === "FILE_UPLOAD" ? (
              <Button variant="outline" asChild>
                <Link href={`/admin/data-hub/import?feedId=${result.feedId}`}>Importar um arquivo agora</Link>
              </Button>
            ) : null}
            <Button variant="ghost" asChild>
              <Link href="/admin/data-hub">Voltar à Central</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{addingFeed ? `Adicionar feed em ${existing.name}` : "Nova fonte"}</CardTitle>
        <CardDescription>
          <Stepper current={step} offset={firstStep} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {addingFeed && step === ADD_FEED_FIRST_STEP ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="add-feed-reuse-note">
            <span>
              Conexão reutilizada: <span className="font-medium text-foreground">{SOURCE_KIND_LABELS[existing.kind]}</span> · autenticação já configurada na fonte{existing.configAccess.required ? "; para adicionar um feed, informe a credencial dela." : "."}
            </span>
            {remote ? <ConnectionHealthBadge health={existing.connectionHealth} error={existing.connectionError} checkedAt={existing.connectionCheckedAt} /> : null}
          </div>
        ) : null}
        {prompt.dialog}
        {addingFeed && step === ADD_FEED_FIRST_STEP ? <ConfigAccessPanel sourceId={existing.id} kind={existing.kind} access={existing.configAccess} /> : null}
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {SOURCE_KINDS.map((option) => {
              const Icon = SOURCE_KIND_ICONS[option]
              return (
                <button key={option} type="button" onClick={() => (option === "DATABASE" ? router.push("/admin/data-hub/sources/new?kind=DATABASE") : setKind(option))} className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50", kind === option ? "border-primary bg-primary/5" : "border-border")} aria-pressed={kind === option}>
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">{SOURCE_KIND_LABELS[option]}</span>
                    <span className="block text-sm text-muted-foreground">{SOURCE_KIND_DESCRIPTIONS[option]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}

        {step === 1 && kind ? <ConnectionForm kind={kind} draft={connection} onChange={setConnection} secretsMode={source ? "rotate" : "create"} /> : null}

        {step === 2 && source ? (
          <div className="space-y-3">
            {testConnection.isPending ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Testando a conexão…
              </p>
            ) : test ? (
              <div role="status" className={cn("rounded-lg border p-3 text-sm", test.health === "HEALTHY" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200")}>
                <p className="font-medium">{test.health === "HEALTHY" ? "Conexão OK" : "Conexão com erro"}</p>
                <p>{test.detail}</p>
                {test.errorCode ? <p className="mt-1 font-mono text-xs">{test.errorCode}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => runTest(source)} disabled={testConnection.isPending}>
                <Plug /> Testar novamente
              </Button>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Ajustar conexão
              </Button>
            </div>
            {test?.health === "ERROR" ? <p className="text-xs text-muted-foreground">Você pode continuar configurando o feed; a amostra e a sincronização só funcionam com a conexão OK.</p> : null}
          </div>
        ) : null}

        {step === 3 && kind && !needsPassword ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="feed-name">Nome do feed</Label>
                <Input
                  id="feed-name"
                  value={feedName}
                  onChange={(event) => {
                    setFeedName(event.target.value)
                    if (!feedKey || feedKey === slug(feedName)) setFeedKey(slug(event.target.value))
                  }}
                  placeholder="Ex.: Colaboradores"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="feed-key">Chave do feed</Label>
                <Input id="feed-key" value={feedKey} onChange={(event) => setFeedKey(event.target.value)} placeholder="colaboradores" />
                <p className="text-xs text-muted-foreground">Minúsculas, números, hífen. Aparece na URL do push e nos logs.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="feed-contract">Contrato de dados (o formato que a INIA entende)</Label>
              <Select value={contractKey} onValueChange={(value) => { setContractKey(value); setMapping({ fields: [] }); setSample(null); setPreview(null) }}>
                <SelectTrigger id="feed-contract" className="w-full">
                  <SelectValue placeholder="Selecione o conjunto de dados" />
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
            <div className="space-y-2">
              <p className="text-sm font-medium">Conector</p>
              <FeedConnectorForm kind={kind} draft={connector} onChange={setConnector} sheets={uploadedSheets} />
            </div>
            {kind === "FILE_UPLOAD" && source ? (
              <div className="space-y-1.5">
                <Label htmlFor="wizard-file">Arquivo de exemplo (.csv ou .xlsx)</Label>
                <Input
                  id="wizard-file"
                  type="file"
                  accept=".csv,.xlsx,text/csv"
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    setBusy(true)
                    setError(null)
                    try {
                      const uploaded = await uploadFile({ file, sourceId: source.id, contractKey: contractKey || undefined, encoding: connector.encoding, delimiter: connector.delimiter })
                      setUploadedRawId(uploaded.rawObjectId)
                      setUploadedSheets(uploaded.sheets)
                      setConnector((current) => ({ ...current, format: uploaded.format, sheet: current.sheet || uploaded.sheets[0] || "" }))
                      toast.success(`${uploaded.filename}: ${uploaded.totalRecords} registro(s), ${uploaded.columns.length} coluna(s).`)
                    } catch (err) {
                      fail(err, "Não foi possível ler o arquivo.")
                    } finally {
                      setBusy(false)
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">O arquivo é retido para amostra e validação; nada é aplicado até a importação.</p>
              </div>
            ) : null}
            {kind === "API_PUSH" && contract ? (
              <div className="space-y-1.5">
                <Label htmlFor="push-example">Payload de exemplo (opcional)</Label>
                <Textarea id="push-example" rows={5} value={pushExample} onChange={(event) => setPushExample(event.target.value)} placeholder={JSON.stringify({ records: contract.examples.slice(0, 1) }, null, 2)} className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">Cole um JSON como o cliente vai enviar para mapear os campos. Vazio = usa o exemplo do contrato.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-3">
            {busy ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando amostra…
              </p>
            ) : sample ? (
              <>
                <p className="text-sm">
                  {sample.records.length} registro(s) de amostra{sample.totalRecords > sample.records.length ? ` (de ${sample.totalRecords})` : ""} · {sample.columns.length} coluna(s){sample.detail ? ` · ${sample.detail}` : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sample.columns.map((column) => (
                    <span key={column} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                      {column}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={loadSample} disabled={busy}>
              Buscar novamente
            </Button>
          </div>
        ) : null}

        {step === 5 && contract && sample ? <MappingEditor contract={contract} columns={sample.columns} value={mapping} onChange={setMapping} suggestion={sample.suggestedMapping} /> : null}

        {step === 6 && contract ? (
          busy || !preview ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Validando a amostra…
            </p>
          ) : (
            <div className="space-y-3">
              <PreviewTable preview={preview} contract={contract} />
              <Button variant="outline" size="sm" onClick={() => setStep(5)}>
                Ajustar mapeamento
              </Button>
            </div>
          )
        ) : null}

        {step === 7 ? (
          <div className="space-y-5">
            {remote ? <CadenceSelect value={cadence} onChange={setCadence} /> : <p className="text-sm text-muted-foreground">{kind === "FILE_UPLOAD" ? "Importação manual: cada arquivo enviado vira uma carga." : "API Push: cada envio do cliente vira uma carga."}</p>}
            {contract ? <AvailabilityPolicyField value={availabilityPolicy} onChange={setAvailabilityPolicy} contractKey={contract.key} /> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="load-mode">Modo de carga</Label>
                <Select value={loadMode} onValueChange={(value) => setLoadMode(value as "DELTA" | "SNAPSHOT")}>
                  <SelectTrigger id="load-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DELTA">{LOAD_MODE_LABELS.DELTA}</SelectItem>
                    <SelectItem value="SNAPSHOT">{LOAD_MODE_LABELS.SNAPSHOT}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Em ambos os modos, ausência de um registro NUNCA desativa nada nesta versão.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="namespace">Namespace de origem (opcional)</Label>
                <Input id="namespace" value={sourceNamespace} onChange={(event) => setSourceNamespace(event.target.value)} placeholder="Ex.: api-operacional" />
                <p className="text-xs text-muted-foreground">Identidade da origem em medições e fechamentos (coluna source). Padrão: id público da fonte.</p>
              </div>
            </div>
            <div className="space-y-3">
              {contract?.category === "MASTER" ? (
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={authoritative} onCheckedChange={setAuthoritative} aria-label="Fonte autoritativa" />
                  <span>
                    <span className="font-medium">Fonte autoritativa deste cadastro</span>
                    <span className="block text-xs text-muted-foreground">Só um feed autoritativo ativo por contrato de dado mestre — duas fontes nunca brigam pelo mesmo cadastro.</span>
                  </span>
                </label>
              ) : null}
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={failOnAnyRejection} onCheckedChange={setFailOnAnyRejection} aria-label="Exigir carga íntegra" />
                <span>
                  <span className="font-medium">Exigir carga íntegra</span>
                  <span className="block text-xs text-muted-foreground">Qualquer registro rejeitado impede a carga inteira (padrão: válidos entram, inválidos vão para a quarentena).</span>
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {step === 8 && kind && contract ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Fonte</dt><dd>{connection.name} · {SOURCE_KIND_LABELS[kind]}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Conexão</dt><dd>{!remote ? "Não se aplica" : addingFeed ? `Reutilizada (${existing.connectionHealth === "HEALTHY" ? "OK" : existing.connectionHealth === "ERROR" ? "com erro" : "não testada"})` : test?.health === "HEALTHY" ? "OK" : test ? "Com erro" : "Não testada"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Feed</dt><dd>{feedName} ({feedKey})</dd></div>
            <div><dt className="text-xs text-muted-foreground">Contrato</dt><dd>{contract.label} · {contract.key}@{contract.version}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Campos mapeados</dt><dd>{mapping.fields.length} ({contract.fields.filter((field) => field.required).length} obrigatórios)</dd></div>
            <div><dt className="text-xs text-muted-foreground">Validação da amostra</dt><dd>{preview ? `${preview.valid} válido(s), ${preview.rejected} com erro` : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Frequência</dt><dd>{remote ? cadenceLabel(cadence) : "Sob demanda"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Dados esperados</dt><dd>{availabilityPolicyLabel(availabilityPolicy)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Modo</dt><dd>{LOAD_MODE_LABELS[loadMode]}{authoritative ? " · autoritativo" : ""}{failOnAnyRejection ? " · íntegra" : ""}</dd></div>
          </dl>
        ) : null}

        {step === 9 ? (
          <div className="space-y-3">
            <p className="text-sm">Ao ativar, o feed passa a aceitar cargas{remote ? " e entra na cadência configurada" : ""}. Nada foi aplicado ao domínio até agora.</p>
            <Button onClick={activate} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} {addingFeed ? "Ativar feed" : "Ativar fonte e feed"}
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t pt-4">
          {addingFeed && step === firstStep ? (
            <Button variant="ghost" asChild>
              <Link href={`/admin/data-hub/sources/${existing.id}`}>
                <ArrowLeft /> Voltar à fonte
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep(Math.max(firstStep, step === 3 && !remote ? 1 : step - 1))} disabled={step === firstStep || busy}>
              <ArrowLeft /> Voltar
            </Button>
          )}
          {step < 9 ? (
            <Button onClick={next} disabled={!canContinue || busy || createSource.isPending || updateSource.isPending}>
              {createSource.isPending || updateSource.isPending ? <Loader2 className="animate-spin" /> : null} Continuar <ArrowRight />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}
