"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Check, Database, Loader2, Plug } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminApiError } from "@/lib/admin/admin-api"
import { cn } from "@/lib/utils"
import { useCreateSourceMutation, useDataContractsQuery, useUpdateSourceMutation } from "@/queries/admin/use-data-hub-queries"
import { createFeed, fetchSourceSample, previewSourceMapping, setFeedStatus, syncFeedNow, testDatabaseConnection } from "@/services/admin/data-hub-service"
import {
  CONTRACT_CATEGORY_LABELS,
  DATABASE_ENGINE_HINTS,
  DATABASE_ENGINE_LABELS,
  DATABASE_ENGINES,
  cadenceLabel,
  cadenceProblem,
  type AvailabilityPolicy,
  type Cadence,
  type ConnectionTest,
  type DataContract,
  type DatabaseEngine,
  type DatabaseObjectDescription,
  type FeedMapping,
  type Preview,
  type Sample,
  type Source,
  type SourceDetail,
} from "@/schemas/admin/data-hub.schema"

import { CadenceSelect } from "../cadence-select"
import { ConfigAccessPanel, isConfigLocked } from "../config-access/config-access-panel"
import { useConfigUnlockPrompt } from "../config-access/use-config-unlock-prompt"
import { AvailabilityPolicyField } from "../connection-form"
import { MappingEditor } from "../mapping-editor"
import { PreviewTable } from "../preview-table"
import { ConnectionHealthBadge } from "../status-badges"
import { DatabaseConnectionFields, DatabaseTestResult, databaseDraftProblems, draftSignature, emptyDatabaseDraft, switchEngine, toDatabaseConfig, type DatabaseDraft } from "./database-connection-fields"
import { DatabaseObjectPicker, type DatabaseObjectRef } from "./database-object-picker"
import { DatabaseSyncSettings, describeSync, suggestSync, syncDraftValid, toDatabaseSync, type DatabaseSyncDraft } from "./database-sync-settings"

/**
 * "Conectar banco de dados" — fluxo guiado da Central para bancos EXTERNOS (SQL Server, PostgreSQL, MariaDB, MySQL):
 * banco → conexão e teste → tabela/visão → conjunto de dados da INIA e leitura → amostra e mapeamento → validar,
 * frequência e ativar. Testar, descobrir, amostrar e validar nunca escrevem nada; a importação só começa ao ativar.
 * Com uma conexão existente (`existing`), começa na escolha da tabela: a mesma conexão alimenta vários conjuntos, mas ler as tabelas
 * do cliente exige informar a senha do banco, que vale 30 minutos para esta pessoa.
 */
const STEPS = ["Banco", "Conexão", "Tabela ou visão", "Conjunto de dados", "Amostra e mapeamento", "Validar e ativar"] as const
const FIRST_DATASET_STEP = 2

function Stepper({ current, offset }: { current: number; offset: number }) {
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

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
}

function message(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : error instanceof Error ? error.message : fallback
}

export function DatabaseWizard({ existing = null, onAddAnother }: { existing?: SourceDetail | null; onAddAnother?: () => void }) {
  const prompt = useConfigUnlockPrompt()
  const contractsQuery = useDataContractsQuery()
  const createSource = useCreateSourceMutation()
  const updateSource = useUpdateSourceMutation()
  const addingDataset = existing !== null
  const firstStep = addingDataset ? FIRST_DATASET_STEP : 0
  const needsPassword = isConfigLocked(existing?.configAccess)

  const [step, setStep] = useState(firstStep)
  const [draft, setDraft] = useState<DatabaseDraft>(() => emptyDatabaseDraft("SQLSERVER"))
  const [engineChosen, setEngineChosen] = useState(false)
  const [test, setTest] = useState<{ result: ConnectionTest; signature: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [source, setSource] = useState<Source | null>(existing)
  const [object, setObject] = useState<DatabaseObjectRef | null>(null)
  const [description, setDescription] = useState<DatabaseObjectDescription | null>(null)
  const [contractKey, setContractKey] = useState("")
  const [datasetName, setDatasetName] = useState("")
  const [sync, setSync] = useState<DatabaseSyncDraft | null>(null)
  const [sample, setSample] = useState<Sample | null>(null)
  const [mapping, setMapping] = useState<FeedMapping>({ fields: [] })
  const [reviewed, setReviewed] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [cadence, setCadence] = useState<Cadence>({ kind: "DAILY", time: "06:00" })
  const [availabilityPolicy, setAvailabilityPolicy] = useState<AvailabilityPolicy | null>(null)
  const [authoritative, setAuthoritative] = useState(false)
  const [importNow, setImportNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ feedId: string; runId: string | null } | null>(null)

  const contracts = contractsQuery.data?.contracts ?? []
  const contract: DataContract | undefined = contracts.find((entry) => entry.key === contractKey)
  const problems = databaseDraftProblems(draft, !source)
  const testedOk = test?.result.health === "HEALTHY" && test.signature === draftSignature(draft)

  const onDescribed = useCallback((next: DatabaseObjectDescription | null) => {
    setDescription(next)
    if (next) setSync((current) => current ?? suggestSync(next))
  }, [])

  const connectorConfig = useMemo(() => {
    if (!object || !sync) return null
    return { connector: "DATABASE", database: { object, sync: toDatabaseSync(sync), batchSize: sync.batchSize, maxRowsPerRun: sync.maxRowsPerRun } }
  }, [object, sync])

  async function runTest() {
    setTesting(true)
    setError(null)
    const signature = draftSignature(draft)
    try {
      const outcome = await testDatabaseConnection({ config: toDatabaseConfig(draft), password: draft.password || undefined, sourceId: source?.id })
      setTest({ result: outcome, signature })
    } catch (err) {
      setError(message(err, "Não foi possível testar a conexão."))
    } finally {
      setTesting(false)
    }
  }

  async function saveConnection(): Promise<Source | null> {
    const payload = { name: draft.name.trim(), config: { kind: "DATABASE", database: toDatabaseConfig(draft) }, secrets: draft.password ? { password: draft.password } : undefined }
    try {
      const current = source
      const saved = current ? await prompt.guarded(() => updateSource.mutateAsync({ id: current.id, input: payload })) : await createSource.mutateAsync(payload)
      setSource(saved)
      setDraft((current) => ({ ...current, password: "" }))
      setTest(null)
      return saved
    } catch {
      return null
    }
  }

  async function loadSample() {
    if (!source || !connectorConfig || !contract) return
    setBusy(true)
    setError(null)
    try {
      const fetched = await prompt.guarded(() => fetchSourceSample(source.id, { connectorConfig, contractKey: contract.key }))
      setSample(fetched)
      setMapping((current) => (current.fields.length ? current : fetched.suggestedMapping))
      setPreview(null)
    } catch (err) {
      setError(message(err, "Não foi possível ler a amostra."))
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
      setError(message(err, "Não foi possível validar a amostra."))
    } finally {
      setBusy(false)
    }
  }

  async function activate() {
    if (!source || !connectorConfig || !contract) return
    setBusy(true)
    setError(null)
    const base = slug(datasetName) || "dados"
    try {
      // Chave técnica derivada do nome; se já existir nesta conexão, tenta "-2", "-3"…
      const input = { name: datasetName.trim(), contractKey: contract.key, connectorConfig, mapping, cadence, availabilityPolicy, authoritative, loadMode: "DELTA" as const }
      let feed = null
      for (let attempt = 1; !feed; attempt += 1) {
        try {
          const feedKey = attempt === 1 ? base : `${base}-${attempt}`
          feed = await prompt.guarded(() => createFeed(source.id, { ...input, feedKey }))
        } catch (err) {
          if (!(err instanceof AdminApiError && err.code === "DATA_FEED_KEY_CONFLICT") || attempt >= 20) throw err
        }
      }
      const createdId = feed.id
      await prompt.guarded(() => setFeedStatus(createdId, "ACTIVATE"))
      const run = importNow ? await syncFeedNow(feed.id) : null
      setResult({ feedId: feed.id, runId: run?.id ?? null })
    } catch (err) {
      setError(message(err, "Não foi possível ativar o conjunto de dados."))
    } finally {
      setBusy(false)
    }
  }

  async function next() {
    setError(null)
    if (step === 1) {
      const saved = await saveConnection()
      if (saved) setStep(2)
      return
    }
    if (step === 3 && contract && object && !datasetName.trim()) setDatasetName(`${contract.label} · ${object.name}`)
    if (step === 3) {
      // Ao entrar na amostra, lê do banco; ao entrar na validação, valida a amostra com o mapeamento.
      setSample(null)
      setPreview(null)
      setReviewed(false)
      setStep(4)
      void loadSample()
      return
    }
    if (step === 4) {
      setPreview(null)
      setStep(5)
      void runPreview()
      return
    }
    setStep(step + 1)
  }

  const requiredMapped = contract ? contract.fields.filter((field) => field.required).every((field) => mapping.fields.some((entry) => entry.target === field.key)) : false
  const canContinue = (() => {
    switch (step) {
      case 0:
        return engineChosen
      case 1:
        return problems.length === 0 && testedOk
      case 2:
        return !needsPassword && Boolean(object && description)
      case 3:
        return Boolean(contract && sync && syncDraftValid(sync) && datasetName.trim().length >= 2)
      case 4:
        return Boolean(sample && requiredMapped && reviewed)
      default:
        return false
    }
  })()

  if (result && source) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-emerald-600 dark:text-emerald-300" aria-hidden /> Conjunto de dados ativado
          </CardTitle>
          <CardDescription>
            {datasetName} · {source.name}. {result.runId ? "A primeira importação já está na fila — acompanhe abaixo." : `A primeira importação acontece na frequência escolhida (${cadenceLabel(cadence)}) ou em "Sincronizar agora".`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {result.runId ? (
            <Button asChild>
              <Link href={`/admin/data-hub/runs/${result.runId}`}>Acompanhar a importação</Link>
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link href={`/admin/data-hub/feeds/${result.feedId}`}>Abrir o conjunto de dados</Link>
          </Button>
          {onAddAnother ? (
            // Já no endereço "adicionar conjunto" desta conexão: navegar para ele não remontaria nada — quem nos montou recomeça.
            <Button variant="outline" onClick={onAddAnother}>
              Adicionar outro conjunto desta conexão
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href={`/admin/data-hub/sources/new?sourceId=${source.id}`}>Adicionar outro conjunto desta conexão</Link>
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link href={`/admin/data-hub/sources/${source.id}`}>Abrir a conexão</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-5 text-primary" aria-hidden /> {addingDataset ? `Adicionar conjunto de dados — ${existing.name}` : "Conectar banco de dados"}
        </CardTitle>
        <CardDescription>
          <Stepper current={step} offset={firstStep} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {prompt.dialog}
        {addingDataset && step === FIRST_DATASET_STEP ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="database-reuse-note">
              <span>Conexão reutilizada: servidor e usuário já estão guardados. Listar as tabelas do cliente exige a senha do banco.</span>
              <ConnectionHealthBadge health={existing.connectionHealth} error={existing.connectionError} checkedAt={existing.connectionCheckedAt} />
            </div>
            <ConfigAccessPanel sourceId={existing.id} kind={existing.kind} access={existing.configAccess} />
          </>
        ) : null}

        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo do banco">
            {DATABASE_ENGINES.map((engine: DatabaseEngine) => (
              <button
                key={engine}
                type="button"
                role="radio"
                aria-checked={engineChosen && draft.engine === engine}
                onClick={() => {
                  setDraft((current) => switchEngine(current, engine))
                  setEngineChosen(true)
                  setTest(null)
                }}
                className={cn("flex items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50", engineChosen && draft.engine === engine ? "border-primary bg-primary/5" : "border-border")}
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Database className="size-4.5" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{DATABASE_ENGINE_LABELS[engine]}</span>
                  <span className="block text-sm text-muted-foreground">{DATABASE_ENGINE_HINTS[engine]}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <DatabaseConnectionFields draft={draft} onChange={(nextDraft) => setDraft(nextDraft)} passwordMode={source ? "rotate" : "create"} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={runTest} disabled={testing || problems.length > 0}>
                {testing ? <Loader2 className="animate-spin" /> : <Plug />} Testar conexão
              </Button>
              {problems.length > 0 ? <span className="text-xs text-muted-foreground">{problems[0]}</span> : !testedOk ? <span className="text-xs text-muted-foreground">Teste a conexão para continuar.</span> : null}
            </div>
            {test && test.signature === draftSignature(draft) ? <DatabaseTestResult result={test.result} /> : null}
          </div>
        ) : null}

        {step === 2 && source && !needsPassword ? <DatabaseObjectPicker sourceId={source.id} value={object} onChange={(nextObject) => { setObject(nextObject); setDescription(null); setSync(null) }} onDescribed={onDescribed} /> : null}

        {step === 3 && description && sync ? (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="db-contract">Qual conjunto de dados da INIA esta {description.kind === "VIEW" ? "visão" : "tabela"} alimenta?</Label>
              <Select
                value={contractKey}
                onValueChange={(value) => {
                  setContractKey(value)
                  setMapping({ fields: [] })
                  const chosen = contracts.find((entry) => entry.key === value)
                  if (chosen && object) setDatasetName(`${chosen.label} · ${object.name}`)
                }}
              >
                <SelectTrigger id="db-contract" className="w-full">
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
            <div className="space-y-1.5">
              <Label htmlFor="db-dataset-name">Nome deste conjunto de dados</Label>
              <Input id="db-dataset-name" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="Ex.: Colaboradores do RH" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Como ler a cada carga</p>
              <DatabaseSyncSettings description={description} value={sync} onChange={setSync} />
              {contract && contract.category === "MASTER" ? <p className="text-xs text-muted-foreground">Cadastros como este entram de uma vez em cada carga (para o gestor que vem na mesma carga ser reconhecido).</p> : null}
            </div>
          </div>
        ) : null}

        {step === 4 && contract ? (
          busy && !sample ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Lendo uma amostra de até 20 linhas…
            </p>
          ) : sample ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm">{sample.detail}</p>
                <div className={cn(TABLE_FRAME, "max-h-64 overflow-auto")}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {sample.columns.map((column) => (
                          <TableHead key={column} className="font-mono text-xs whitespace-nowrap">
                            {column}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sample.records.slice(0, 5).map((record, index) => (
                        <TableRow key={index}>
                          {sample.columns.map((column) => (
                            <TableCell key={column} className="max-w-48 truncate text-xs">
                              {record[column] === null || record[column] === undefined ? <span className="text-muted-foreground">—</span> : typeof record[column] === "object" ? JSON.stringify(record[column]) : String(record[column])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Associe as colunas aos campos da INIA</p>
                <p className="text-xs text-muted-foreground">A sugestão é feita só pelo nome das colunas — confira cada campo obrigatório: a INIA não adivinha equivalências de negócio.</p>
                <MappingEditor contract={contract} columns={sample.columns} value={mapping} onChange={(nextMapping) => { setMapping(nextMapping); setReviewed(false) }} suggestion={sample.suggestedMapping} />
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <Switch checked={reviewed} onCheckedChange={setReviewed} disabled={!requiredMapped} aria-label="Conferi os campos obrigatórios" />
                <span>
                  <span className="font-medium">Conferi as associações dos campos obrigatórios</span>
                  <span className="block text-xs text-muted-foreground">{requiredMapped ? "Confirme que cada coluna escolhida significa mesmo o campo da INIA." : "Ainda há campo obrigatório sem coluna."}</span>
                </span>
              </label>
              <Button variant="outline" size="sm" onClick={loadSample} disabled={busy}>
                Ler a amostra de novo
              </Button>
            </div>
          ) : null
        ) : null}

        {step === 5 && contract ? (
          <div className="space-y-5">
            {busy && !preview ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Validando a amostra…
              </p>
            ) : preview ? (
              <PreviewTable preview={preview} contract={contract} />
            ) : null}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <CadenceSelect value={cadence} onChange={setCadence} />
              <AvailabilityPolicyField value={availabilityPolicy} onChange={setAvailabilityPolicy} contractKey={contract.key} />
              {contract.category === "MASTER" ? (
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={authoritative} onCheckedChange={setAuthoritative} aria-label="Fonte oficial deste cadastro" />
                  <span>
                    <span className="font-medium">Fonte oficial deste cadastro</span>
                    <span className="block text-xs text-muted-foreground">Só uma fonte oficial por cadastro mestre — duas fontes nunca brigam pelo mesmo dado.</span>
                  </span>
                </label>
              ) : null}
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={importNow} onCheckedChange={setImportNow} aria-label="Fazer a primeira importação agora" />
                <span>
                  <span className="font-medium">Fazer a primeira importação agora</span>
                  <span className="block text-xs text-muted-foreground">Desligado: a primeira carga acontece na frequência escolhida.</span>
                </span>
              </label>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Origem</dt><dd>{source?.name} · {object ? `${object.schema}.${object.name}` : ""}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Conjunto da INIA</dt><dd>{contract.label}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Leitura</dt><dd>{sync ? describeSync(sync) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Frequência</dt><dd>{cadenceLabel(cadence)}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Até aqui nada foi gravado nos dados da INIA. Ao ativar, a importação usa o mesmo processo de validação: o que não passar fica na quarentena com o motivo.</p>
            <Button onClick={activate} disabled={busy || !preview || preview.mappingProblems.length > 0 || preview.valid === 0 || cadenceProblem(cadence) !== null}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Ativar {importNow ? "e importar" : ""}
            </Button>
            {preview && preview.valid === 0 ? <p className="text-xs text-destructive">Nenhuma linha da amostra é válida — ajuste o mapeamento antes de ativar.</p> : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between border-t pt-4">
          {addingDataset && step === firstStep ? (
            <Button variant="ghost" asChild>
              <Link href={`/admin/data-hub/sources/${existing.id}`}>
                <ArrowLeft /> Voltar à conexão
              </Link>
            </Button>
          ) : step === 0 ? (
            <Button variant="ghost" asChild>
              <Link href="/admin/data-hub">
                <ArrowLeft /> Central de Dados
              </Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep(Math.max(firstStep, step - 1))} disabled={busy}>
              <ArrowLeft /> Voltar
            </Button>
          )}
          {step < 5 ? (
            <Button onClick={next} disabled={!canContinue || busy || createSource.isPending || updateSource.isPending}>
              {createSource.isPending || updateSource.isPending ? <Loader2 className="animate-spin" /> : null} {step === 1 ? "Salvar e continuar" : "Continuar"} <ArrowRight />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
