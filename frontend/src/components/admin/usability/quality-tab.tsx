"use client"

import { useState, type FormEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  useClassifyUsabilityPersonMutation,
  useReprocessUsabilityMutation,
  useUnclassifyUsabilityPersonMutation,
  useUpdateUsabilitySettingsMutation,
  useUsabilityPeopleSearch,
  useUsabilityTabQuery,
} from "@/queries/admin/use-usability-queries"
import type { Coverage, MetricDefinition, UsabilityQuality } from "@/schemas/admin/usability.schema"
import type { UsabilityQuery } from "@/services/admin/usability-service"

import { formatCount, formatInstant, formatMs } from "./usability-format"
import { DataTable, EmptyNote, ExportButton, Section, StatTile, usePanel } from "./usability-shared"
import { TabFrame } from "./usability-tab-frame"
import { DateRangePicker } from "@/components/ui/date-picker"

type Collection = { enabled: boolean; rawRetentionDays: number; factRetentionMonths: number; timezone: string; timezoneSource: string; disabledIntervals: { from: string; to: string }[] }
type Family = { family: string; label: string; firstEventAt: string | null; lastEventAt: string | null; lastReceivedAt: string | null; coverage: Coverage }
type Official = { source: string; label: string; since: string | null; coverage: Coverage }
type Ingestion = { batches: number; received: number; accepted: number; duplicates: number; rejected: number; beaconBatches: number; clockOffsetMedianMs: number | null; clockOffsetP95Ms: number | null; deliveryDelayP95Ms: number | null; lastBatchAt: string | null; rejections: { reason: string; label: string; count: number }[]; timestamps: { status: string; source: string; count: number }[]; unknownLoss: string }
type Projection = { runs: { kind: string; startedAt: string; finishedAt: string | null; processed: number; failed: number }[]; pendingDays: number; oldestPendingAt: string | null; retriedDays: number; lagSeconds: number }
type CatalogRow = { key: string; label: string; kind: string; areaLabel: string; routeTemplate: string | null; instrumentation: string; firstObservedAt: string | null; lastObservedAt: string | null; views: number }
type EventRow = { name: string; familyLabel: string; emitter: string; authority: string; purpose: string; moment: string; correlation: string; dedupe: string; sensitivity: string; qualifiesActivity: boolean }
type Classification = { personId: string; name: string; classification: string; reason: string; classifiedAt: string }

const INSTRUMENTATION_LABELS: Record<string, string> = { INSTRUMENTED: "Instrumentada", PARTIAL: "Parcial", NOT_INSTRUMENTED: "Sem instrumentação" }
const TIMESTAMP_LABELS: Record<string, string> = { OK: "No horário", LATE: "Chegou atrasado (> 10 min)", CLIENT_CLOCK_CORRECTED: "Relógio do aparelho corrigido" }
const CLASSIFICATION_LABELS: Record<string, string> = { TEST: "Teste", DEMO: "Demonstração", AUTOMATION: "Automação" }
const RUN_LABELS: Record<string, string> = { ACTIVITY: "Sessões e tempo ativo", ELIGIBILITY: "Elegibilidade", RETENTION: "Retenção" }

export function QualityTab({ query }: { query: UsabilityQuery }) {
  const result = useUsabilityTabQuery("quality", query)
  return <TabFrame result={result}>{(data) => <QualityContent data={data} />}</TabFrame>
}

function QualityContent({ data }: { data: UsabilityQuality }) {
  const { timezone, can } = usePanel()
  const collection = data.collection as unknown as Collection
  const families = data.families as unknown as Family[]
  const officials = data.officialSources as unknown as Official[]
  const ingestion = data.ingestion as unknown as Ingestion
  const projection = data.projection as unknown as Projection
  const catalog = data.catalog as unknown as CatalogRow[]
  const events = data.events as unknown as EventRow[]
  const classifications = data.classifications as unknown as Classification[] | null
  const eligibility = data.eligibility as { trackingStartedAt: string | null; note: string }
  const authFailures = data.authFailures as { installationWide: number; note: string } | null
  const coverageText = (coverage: Coverage) => (coverage.status === "FULL" ? "Cobertura total no período" : coverage.status === "NONE" ? "Sem medição no período" : `Parcial — desde ${formatInstant(coverage.from, timezone)}`)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Coleta" value={collection.enabled ? "Ligada" : "Desligada"} hint={`Fuso ${collection.timezone} (${collection.timezoneSource === "OVERRIDE" ? "definido aqui" : "da operação"})`} />
        <StatTile label="Retenção" value={`${collection.rawRetentionDays} dias`} hint={`eventos brutos · fatos diários por ${collection.factRetentionMonths} meses · marcos sempre`} />
        <StatTile label="Processamento" value={projection.pendingDays ? `${formatCount(projection.pendingDays)} dia(s) pendente(s)` : "Em dia"} hint={projection.oldestPendingAt ? `mais antigo desde ${formatInstant(projection.oldestPendingAt, timezone)}` : `atraso ${Math.round(projection.lagSeconds / 60)} min`} />
        <StatTile label="Elegibilidade registrada desde" value={eligibility.trackingStartedAt ? formatInstant(eligibility.trackingStartedAt, timezone) : "Ainda não"} hint={eligibility.note} />
      </div>

      {collection.disabledIntervals.length ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" role="note">
          Coleta desligada em: {collection.disabledIntervals.map((interval) => `${formatInstant(interval.from, timezone)} → ${formatInstant(interval.to, timezone)}`).join("; ")}. Nesses intervalos os números aparecem como “sem dados”.
        </p>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Cobertura por tipo de evento" description="Início da medição de cada família. Antes disso, nunca zero — sem dados." actions={<ExportButton table="families" />}>
          <DataTable
            rows={families}
            rowKey={(row) => row.family}
            caption="Famílias de eventos"
            columns={[
              { key: "label", header: "Família", cell: (row) => row.label },
              { key: "first", header: "Primeiro evento", cell: (row) => <span className="text-xs">{formatInstant(row.firstEventAt, timezone)}</span> },
              { key: "last", header: "Último recebido", cell: (row) => <span className="text-xs">{formatInstant(row.lastReceivedAt, timezone)}</span> },
              { key: "coverage", header: "No período", cell: (row) => <span className="text-xs">{coverageText(row.coverage)}</span> },
            ]}
          />
        </Section>
        <Section title="Fontes oficiais" description="Dados de negócio (feedbacks, conversas, workflows) vêm das tabelas do produto, não do navegador.">
          <DataTable
            rows={officials}
            rowKey={(row) => row.source}
            caption="Fontes oficiais"
            columns={[
              { key: "label", header: "Fonte", cell: (row) => row.label },
              { key: "since", header: "Disponível desde", cell: (row) => <span className="text-xs">{formatInstant(row.since, timezone)}</span> },
              { key: "coverage", header: "No período", cell: (row) => <span className="text-xs">{coverageText(row.coverage)}</span> },
            ]}
          />
        </Section>
      </div>

      <Section title="Recebimento dos eventos" description={ingestion.unknownLoss} metricId="quality.ingestion" actions={<ExportButton table="ingestion" />}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Recebidos" value={formatCount(ingestion.received)} hint={`${formatCount(ingestion.batches)} lote(s) · ${formatCount(ingestion.beaconBatches)} no fechamento da página`} />
            <StatTile label="Aceitos" value={formatCount(ingestion.accepted)} hint={`${formatCount(ingestion.duplicates)} duplicado(s) ignorado(s)`} />
            <StatTile label="Recusados" value={formatCount(ingestion.rejected)} />
            <StatTile label="Atraso de entrega (p95)" value={formatMs(ingestion.deliveryDelayP95Ms)} hint={`relógio do aparelho: mediana ${formatMs(ingestion.clockOffsetMedianMs)} · p95 ${formatMs(ingestion.clockOffsetP95Ms)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DataTable rows={ingestion.rejections.filter((row) => row.count > 0)} rowKey={(row) => row.reason} empty="Nenhum evento recusado no período." caption="Motivos de recusa" columns={[{ key: "label", header: "Motivo da recusa", cell: (row) => row.label }, { key: "count", header: "Eventos", align: "right", cell: (row) => formatCount(row.count) }]} />
            <DataTable rows={ingestion.timestamps} rowKey={(row) => `${row.status}|${row.source}`} caption="Horário dos eventos" columns={[{ key: "status", header: "Horário", cell: (row) => TIMESTAMP_LABELS[row.status] ?? row.status }, { key: "source", header: "Origem", cell: (row) => (row.source === "CLIENT" ? "Navegador" : "Servidor") }, { key: "count", header: "Eventos", align: "right", cell: (row) => formatCount(row.count) }]} />
          </div>
          {authFailures ? <p className="text-xs text-muted-foreground">Falhas de login na última hora: {formatCount(authFailures.installationWide)}. {authFailures.note}</p> : null}
        </div>
      </Section>

      <Section title="Processamento" description="Sessões, tempo ativo e elegibilidade são recalculados por pessoa × dia; evento atrasado reprocessa o dia do fato.">
        <DataTable
          rows={projection.runs}
          rowKey={(row) => row.kind}
          caption="Últimas execuções"
          columns={[
            { key: "kind", header: "Processo", cell: (row) => RUN_LABELS[row.kind] ?? row.kind },
            { key: "at", header: "Última execução", cell: (row) => <span className="text-xs">{formatInstant(row.finishedAt ?? row.startedAt, timezone)}</span> },
            { key: "processed", header: "Processados", align: "right", cell: (row) => formatCount(row.processed) },
            { key: "failed", header: "Falhas", align: "right", cell: (row) => formatCount(row.failed) },
          ]}
        />
      </Section>

      {can.manage ? <ManageCard collection={collection} classifications={classifications ?? []} /> : null}

      <Section title="Catálogo de telas e cobertura da instrumentação" description="Telas que o painel reconhece. “Parcial” = só a rota; painéis e elementos dela ainda não são medidos." actions={<ExportButton table="catalog" />}>
        <DataTable
          rows={catalog}
          rowKey={(row) => row.key}
          caption="Catálogo de telas"
          columns={[
            {
              key: "label",
              header: "Tela",
              cell: (row) => (
                <div className="space-y-0.5">
                  <p>{row.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{row.routeTemplate ?? row.key}</p>
                </div>
              ),
            },
            { key: "area", header: "Área", cell: (row) => <span className="text-xs">{row.areaLabel}</span> },
            { key: "instr", header: "Instrumentação", cell: (row) => <Badge variant={row.instrumentation === "INSTRUMENTED" ? "secondary" : "outline"} className="font-normal">{INSTRUMENTATION_LABELS[row.instrumentation] ?? row.instrumentation}</Badge> },
            { key: "views", header: "Visualizações", align: "right", cell: (row) => formatCount(row.views) },
            { key: "last", header: "Última vista", cell: (row) => <span className="text-xs">{row.lastObservedAt ? formatInstant(row.lastObservedAt, timezone) : "Nunca observada"}</span> },
          ]}
        />
      </Section>

      <DictionaryCard dictionary={data.dictionary} versions={data.versions} />

      <Section title="Catálogo de eventos" description="Todo evento tem esquema fechado; propriedades fora dele são recusadas. Nenhum evento guarda conteúdo digitado, senha ou áudio." actions={<ExportButton table="events" />}>
        <DataTable
          rows={events}
          rowKey={(row) => row.name}
          caption="Catálogo de eventos"
          columns={[
            { key: "name", header: "Evento", cell: (row) => <span className="font-mono text-xs">{row.name}</span> },
            { key: "family", header: "Família", cell: (row) => <span className="text-xs">{row.familyLabel}</span> },
            { key: "origin", header: "Origem", cell: (row) => <span className="text-xs">{row.emitter === "CLIENT" ? "Navegador" : "Servidor"} · {row.authority}</span> },
            { key: "purpose", header: "Para que serve", cell: (row) => <span className="text-xs">{row.purpose}</span> },
            { key: "dedupe", header: "Deduplicação", cell: (row) => <span className="text-xs">{row.dedupe}</span> },
            { key: "activity", header: "Conta como atividade", cell: (row) => (row.qualifiesActivity ? "Sim" : "Não") },
          ]}
        />
      </Section>
    </div>
  )
}

function DictionaryCard({ dictionary, versions }: { dictionary: MetricDefinition[]; versions: Record<string, string | number> }) {
  return (
    <Section title="Dicionário de métricas" description={`Versões: ${Object.entries(versions).map(([key, value]) => `${key} ${value}`).join(" · ")}`} actions={<ExportButton table="dictionary" />}>
      <ul className="divide-y">
        {dictionary.map((metric) => (
          <li key={metric.id} className="py-2">
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {metric.label} <span className="font-mono text-[11px] font-normal text-muted-foreground">{metric.id}</span>
              </summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
                <dt className="text-muted-foreground">Definição</dt>
                <dd>{metric.definition}</dd>
                <dt className="text-muted-foreground">Fórmula</dt>
                <dd className="font-mono">{metric.formula}</dd>
                <dt className="text-muted-foreground">Unidade</dt>
                <dd>{metric.unit}</dd>
                <dt className="text-muted-foreground">Fonte</dt>
                <dd>{metric.source}</dd>
                <dt className="text-muted-foreground">Base</dt>
                <dd>{metric.denominator ?? "—"}</dd>
                <dt className="text-muted-foreground">Deduplicação</dt>
                <dd>{metric.dedupe}</dd>
                <dt className="text-muted-foreground">Cobertura</dt>
                <dd>{metric.coverage}</dd>
                <dt className="text-muted-foreground">Exclusões</dt>
                <dd>{metric.exclusions}</dd>
                <dt className="text-muted-foreground">Limitações</dt>
                <dd>{metric.limitations}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Configuração (só com `usability.manage` na organização inteira): coleta, retenção, fuso, classificação e reprocessamento. Tudo auditado e com motivo. */
function ManageCard({ collection, classifications }: { collection: Collection; classifications: Classification[] }) {
  const { timezone } = usePanel()
  const settings = useUpdateUsabilitySettingsMutation()
  const reprocess = useReprocessUsabilityMutation()
  const classify = useClassifyUsabilityPersonMutation()
  const unclassify = useUnclassifyUsabilityPersonMutation()
  const [enabled, setEnabled] = useState(collection.enabled)
  const [rawDays, setRawDays] = useState(String(collection.rawRetentionDays))
  const [factMonths, setFactMonths] = useState(String(collection.factRetentionMonths))
  const [tz, setTz] = useState(collection.timezoneSource === "OVERRIDE" ? collection.timezone : "")
  const [settingsReason, setSettingsReason] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [reprocessReason, setReprocessReason] = useState("")
  const [search, setSearch] = useState("")
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null)
  const [kind, setKind] = useState<"TEST" | "DEMO" | "AUTOMATION">("TEST")
  const [classifyReason, setClassifyReason] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeReason, setRemoveReason] = useState("")
  const results = useUsabilityPeopleSearch(person ? "" : search)

  function saveSettings(event: FormEvent) {
    event.preventDefault()
    settings.mutate({ collectionEnabled: enabled, rawRetentionDays: Number(rawDays), factRetentionMonths: Number(factMonths), timezoneOverride: tz.trim() ? tz.trim() : null, reason: settingsReason }, { onSuccess: () => setSettingsReason("") })
  }
  function runReprocess(event: FormEvent) {
    event.preventDefault()
    reprocess.mutate({ from, to, reason: reprocessReason }, { onSuccess: () => setReprocessReason("") })
  }
  function addClassification(event: FormEvent) {
    event.preventDefault()
    if (!person) return
    classify.mutate({ personId: person.id, classification: kind, reason: classifyReason }, { onSuccess: () => { setPerson(null); setSearch(""); setClassifyReason("") } })
  }

  return (
    <Section title="Configuração da monitoria" description="Cada mudança exige um motivo e fica registrada na auditoria.">
      <div className="grid gap-6 xl:grid-cols-3">
        <form className="space-y-3" onSubmit={saveSettings} aria-label="Coleta e retenção">
          <p className="text-sm font-medium">Coleta e retenção</p>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Coleta ligada" /> Coleta ligada nesta organização
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="usability-raw-days" className="text-xs">Eventos brutos (dias)</Label>
              <Input id="usability-raw-days" type="number" min={7} max={400} value={rawDays} onChange={(event) => setRawDays(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="usability-fact-months" className="text-xs">Fatos diários (meses)</Label>
              <Input id="usability-fact-months" type="number" min={1} max={60} value={factMonths} onChange={(event) => setFactMonths(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="usability-tz" className="text-xs">Fuso (vazio = o da operação)</Label>
            <Input id="usability-tz" placeholder="America/Fortaleza" value={tz} onChange={(event) => setTz(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="usability-settings-reason" className="text-xs">Motivo</Label>
            <Textarea id="usability-settings-reason" rows={2} value={settingsReason} onChange={(event) => setSettingsReason(event.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={settings.isPending || settingsReason.trim().length < 3}>
            Salvar configuração
          </Button>
        </form>

        <form className="space-y-3" onSubmit={runReprocess} aria-label="Reprocessar">
          <p className="text-sm font-medium">Reprocessar sessões e tempo ativo</p>
          <p className="text-xs text-muted-foreground">Recalcula os dias escolhidos a partir dos eventos brutos ainda guardados. Não altera dados de negócio.</p>
          <div className="space-y-1">
            <Label htmlFor="usability-reprocess-period" className="text-xs">Dias (de – até)</Label>
            <DateRangePicker id="usability-reprocess-period" value={{ from: from || undefined, to: to || undefined }} onChange={(range) => (setFrom(range.from ?? ""), setTo(range.to ?? ""))} className="sm:w-full" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="usability-reprocess-reason" className="text-xs">Motivo</Label>
            <Textarea id="usability-reprocess-reason" rows={2} value={reprocessReason} onChange={(event) => setReprocessReason(event.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={reprocess.isPending || !from || !to || from > to || reprocessReason.trim().length < 3}>
            Reprocessar
          </Button>
          {reprocess.data ? <p className="text-xs text-muted-foreground" role="status">{formatCount(reprocess.data.personDays)} pessoa(s)-dia na fila.</p> : null}
        </form>

        <div className="space-y-3">
          <p className="text-sm font-medium">Contas de teste, demonstração e automação</p>
          <p className="text-xs text-muted-foreground">Ficam fora dos números por padrão (há filtro para incluí-las).</p>
          <form className="space-y-2" onSubmit={addClassification} aria-label="Classificar pessoa">
            {person ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                {person.name}
                <Button type="button" variant="ghost" size="sm" onClick={() => setPerson(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <Label htmlFor="usability-classify-search" className="text-xs">Pessoa</Label>
                <Input id="usability-classify-search" type="search" placeholder="Nome ou matrícula" value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" />
                {search.trim().length >= 2 ? (
                  <ul className="max-h-36 overflow-y-auto rounded-md border" aria-label="Pessoas encontradas">
                    {results.data?.map((option) => (
                      <li key={option.id}>
                        <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setPerson({ id: option.id, name: option.name })}>
                          {option.name} <span className="text-xs text-muted-foreground">{option.matricula ?? ""}</span>
                        </button>
                      </li>
                    ))}
                    {results.data?.length === 0 ? <li className="px-3 py-1.5 text-xs text-muted-foreground">Ninguém encontrado.</li> : null}
                  </ul>
                ) : null}
              </>
            )}
            <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
              <SelectTrigger aria-label="Classificação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input aria-label="Motivo da classificação" placeholder="Motivo" value={classifyReason} onChange={(event) => setClassifyReason(event.target.value)} />
            <Button type="submit" size="sm" disabled={classify.isPending || !person || classifyReason.trim().length < 3}>
              Classificar
            </Button>
          </form>
          {classifications.length === 0 ? (
            <EmptyNote>Nenhuma pessoa classificada.</EmptyNote>
          ) : (
            <ul className="divide-y rounded-md border">
              {classifications.map((row) => (
                <li key={row.personId} className="space-y-2 px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p>
                        {row.name} <Badge variant="outline" className="ml-1 font-normal">{CLASSIFICATION_LABELS[row.classification] ?? row.classification}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.reason} · {formatInstant(row.classifiedAt, timezone)}
                      </p>
                    </div>
                    {removing === row.personId ? null : (
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setRemoving(row.personId); setRemoveReason("") }}>
                        Remover
                      </Button>
                    )}
                  </div>
                  {removing === row.personId ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        unclassify.mutate({ personId: row.personId, reason: removeReason }, { onSuccess: () => setRemoving(null) })
                      }}
                    >
                      <Input aria-label={`Motivo para remover a classificação de ${row.name}`} placeholder="Motivo" value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} className="h-8 min-w-0 flex-1" autoFocus />
                      <Button type="submit" size="sm" disabled={unclassify.isPending || removeReason.trim().length < 3}>
                        Confirmar
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                        Cancelar
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  )
}
