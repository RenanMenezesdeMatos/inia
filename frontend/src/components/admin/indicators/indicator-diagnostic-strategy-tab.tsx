"use client"

import { useEffect, useState } from "react"
import { ChevronDown, FlaskConical, Lock, ShieldCheck } from "lucide-react"

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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { IndicatorDiagnosticSimulationDialog } from "@/components/admin/indicators/indicator-diagnostic-simulation-dialog"
import { AdminApiError } from "@/lib/admin/admin-api"
import { useChannelFlagsQuery } from "@/queries/admin/use-channel-flag-queries"
import {
  useDiscardStrategyDraftMutation,
  usePublishStrategyMutation,
  useSaveStrategyDraftMutation,
  useSetStrategyActiveMutation,
  useStrategyOverviewQuery,
} from "@/queries/admin/use-indicator-diagnostic-strategy-queries"
import {
  SIGNAL_EFFECT_LABELS,
  SIGNAL_OPERATOR_LABELS,
  signalLabelOf,
  STRATEGY_STATUS_LABELS,
  type PopulationSignalConfig,
  type SignalOperator,
  type StrategyConfig,
  type StrategyIssue,
  type StrategyOverview,
  type StrategyStatus,
} from "@/schemas/admin/indicator-diagnostic-strategy.schema"

/**
 * V1.6.2 — aba "Diagnóstico com IA" do indicador: configura COMO a INIA investiga (a estratégia versionada que o runtime
 * executa). Tudo que aparece vem do catálogo de capacidades do backend para ESTE indicador — nada é oferecido sem efeito.
 * Rascunho é editável; versão publicada é só leitura ("Editar" cria o próximo rascunho). Guardrails são exibidos, nunca
 * configuráveis.
 */
/**
 * Selo ÚNICO do status da estratégia (listagem, card e aba usam o mesmo): só "Configurado" tem destaque; rascunho pendente
 * sobre uma publicada aparece junto — a vigente não muda até publicar.
 */
export function DiagnosticStrategyStatusBadge({ status, draftPending = false }: { status: StrategyStatus; draftPending?: boolean }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge variant={status === "PUBLISHED" ? "secondary" : "outline"} className={status === "NOT_CONFIGURED" || status === "INACTIVE" ? "text-muted-foreground" : undefined}>{STRATEGY_STATUS_LABELS[status]}</Badge>
      {draftPending && status === "PUBLISHED" ? <span className="text-xs text-muted-foreground">rascunho pendente</span> : null}
    </span>
  )
}

type Limits = StrategyOverview["capabilities"]["sampling"]["limits"]
const limit = (limits: Limits, key: string, field: string, fallback: number) => limits[key]?.[field] ?? fallback

function NumberField({ id, label, value, min, max, disabled, hint, error, onChange }: { id: string; label: string; value: number | null; min: number; max: number; disabled: boolean; hint?: string; error?: string; onChange: (value: number | null) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <Input id={id} type="number" inputMode="numeric" className="w-28" min={min} max={max} value={value ?? ""} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

/**
 * Onde cada pendência de publicação aparece: o backend devolve `field` (caminho na configuração) — nunca se interpreta o
 * texto da mensagem. A seção recolhida que contém o campo abre sozinha e o erro fica junto do campo.
 */
type SectionKey = "investigation" | "sampling" | "domains" | "peer" | "triage" | "signal"
function sectionOfField(field: string): SectionKey {
  if (field.startsWith("populationSignal")) return "signal"
  if (field === "allowedBusinessDomainIds") return "domains"
  if (field.startsWith("closingTriage")) return "triage"
  if (field.startsWith("peerComparison.")) return "peer"
  if (field === "segmentation.minimumSegmentInteractions" || field.startsWith("interactionInvestigation.")) return "sampling"
  return "investigation"
}
const FIELD_INPUTS: Record<string, string> = {
  "interactionInvestigation.maxInteractions": "max",
  "interactionInvestigation.minimumAnalyzed": "min",
  "segmentation.minimumSegmentInteractions": "segment",
  "interactionInvestigation.minimumCoveragePercent": "coverage",
  "interactionInvestigation.maxRepairInteractions": "repair",
  "peerComparison.minimumPopulation": "pop",
  "peerComparison.minimumContributors": "contrib",
  "peerComparison.minimumObservedInteractions": "obs",
  "populationSignal.condition": "signal-value",
}

function SectionErrors({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null
  return <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
}

function Section({ id, title, description, children, errors, open, onOpenChange, collapsible = false }: { id?: string; title: string; description?: string; children: React.ReactNode; errors?: string[]; open?: boolean; onOpenChange?: (open: boolean) => void; collapsible?: boolean }) {
  if (!collapsible) {
    return (
      <section id={id} className="space-y-3 rounded-lg border p-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <SectionErrors errors={errors} />
        {children}
      </section>
    )
  }
  return (
    <Collapsible id={id} open={open} onOpenChange={onOpenChange} className={errors && errors.length > 0 ? "rounded-lg border border-destructive/60" : "rounded-lg border"}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 p-4 text-left">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">
        <SectionErrors errors={errors} />
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToggleRow({ id, label, description, checked, disabled, lockedLabel, onChange }: { id: string; label: string; description: string; checked: boolean; disabled: boolean; lockedLabel?: string | null; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {lockedLabel ? <p className="mt-0.5 text-xs text-muted-foreground">{lockedLabel}</p> : null}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

/** Ligar/desligar respeitando as dependências do runtime (desligar um pré-requisito desliga o que depende dele). */
function toggle(config: StrategyConfig, code: "SEGMENTATION" | "INTERACTIONS" | "PROCESS_ASSESSMENT" | "PEER_COMPARISON", enabled: boolean, defaultDimension: string | null): StrategyConfig {
  const next = structuredClone(config)
  if (code === "SEGMENTATION") {
    next.segmentation.enabled = enabled
    if (enabled && next.segmentation.dimensions.length === 0 && defaultDimension) next.segmentation.dimensions = [defaultDimension]
    if (!enabled) return toggle(next, "INTERACTIONS", false, defaultDimension)
  }
  if (code === "INTERACTIONS") {
    next.interactionInvestigation.enabled = enabled
    // Nesta versão os atendimentos investigados são avaliados pelos processos: os dois andam juntos.
    next.processAssessment.enabled = enabled
    if (!enabled) next.peerComparison.enabled = false
  }
  if (code === "PROCESS_ASSESSMENT") {
    next.processAssessment.enabled = enabled
    next.interactionInvestigation.enabled = enabled
    if (!enabled) next.peerComparison.enabled = false
  }
  if (code === "PEER_COMPARISON") next.peerComparison.enabled = enabled
  return next
}

export function IndicatorDiagnosticStrategyTab({ indicatorId }: { indicatorId: string }) {
  const overviewQuery = useStrategyOverviewQuery(indicatorId)
  const overview = overviewQuery.data
  if (overviewQuery.isLoading || !overview) return <Skeleton className="h-64 w-full" />
  // O editor recomeça quando a VERSÃO em foco muda (novo rascunho, publicação, descarte) — nunca a cada refetch.
  return <StrategyEditor key={`${overview.draft?.id ?? "-"}|${overview.published?.id ?? "-"}`} indicatorId={indicatorId} overview={overview} />
}

function StrategyEditor({ indicatorId, overview }: { indicatorId: string; overview: StrategyOverview }) {
  const saveDraft = useSaveStrategyDraftMutation()
  const publish = usePublishStrategyMutation()
  const discard = useDiscardStrategyDraftMutation()
  const setActive = useSetStrategyActiveMutation()
  // O formulário edita o RASCUNHO; sem rascunho mostra a versão publicada (só leitura). "Configurar"/"Editar" abre um
  // rascunho LOCAL (a partir de `newDraftTemplate`): nada é gravado até "Salvar rascunho" ou "Publicar".
  const [config, setConfig] = useState<StrategyConfig | null>(() => structuredClone(overview.draft?.config ?? overview.published?.config ?? null))
  const [dirty, setDirty] = useState(false)
  const [localDraft, setLocalDraft] = useState(false)
  const [publishIssues, setPublishIssues] = useState<StrategyIssue[]>([])
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(() => new Set(overview.draft ? overview.draftIssues.map((issue) => sectionOfField(issue.field)) : []))
  const [focusField, setFocusField] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [testing, setTesting] = useState(false)
  const editable = overview.draft !== null || localDraft
  const capabilities = overview.capabilities
  const limits = capabilities.sampling.limits
  const defaultDimension = capabilities.dimensions[0]?.code ?? null
  const busy = saveDraft.isPending || publish.isPending || discard.isPending || setActive.isPending
  const update = (next: StrategyConfig) => {
    setConfig(next)
    setDirty(true)
    setPublishIssues([])
  }

  function startLocalDraft() {
    setConfig(structuredClone(overview.newDraftTemplate))
    setLocalDraft(true)
    setDirty(true)
    setPublishIssues([])
  }
  function cancelLocalDraft() {
    setConfig(structuredClone(overview.published?.config ?? null))
    setLocalDraft(false)
    setDirty(false)
    setPublishIssues([])
  }
  const sectionOpen = (key: SectionKey) => openSections.has(key)
  const setSectionOpen = (key: SectionKey) => (open: boolean) =>
    setOpenSections((current) => {
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })

  async function handlePublish() {
    if (!config) return
    setPublishIssues([])
    try {
      if (dirty) {
        await saveDraft.mutateAsync({ indicatorId, config })
        // Já está gravado: se a publicação falhar, o rascunho salvo não é mais "alteração não salva".
        setDirty(false)
      }
      await publish.mutateAsync(indicatorId)
    } catch (error) {
      const received = error instanceof AdminApiError ? (error.details as { issues?: Partial<StrategyIssue>[] } | undefined)?.issues : undefined
      // Pendência sem `field` continua no resumo "Antes de publicar"; só as com campo abrem a seção e marcam o campo.
      const list: StrategyIssue[] = (received ?? []).filter((issue) => typeof issue.message === "string").map((issue) => ({ code: issue.code ?? "", field: typeof issue.field === "string" ? issue.field : "", message: issue.message! }))
      setPublishIssues(list.length > 0 ? list : [{ code: "PUBLISH_FAILED", field: "", message: error instanceof Error ? error.message : "Não foi possível publicar." }])
      const located = list.filter((issue) => issue.field !== "")
      if (located.length > 0) {
        setOpenSections((current) => new Set([...current, ...located.map((issue) => sectionOfField(issue.field))]))
        setFocusField(located[0]!.field)
      }
    }
  }

  // Leva ao primeiro erro depois que a seção abriu: o campo numérico recebe foco; os demais, a seção entra na tela.
  useEffect(() => {
    if (focusField === null) return
    const frame = window.requestAnimationFrame(() => {
      const inputPrefix = FIELD_INPUTS[focusField]
      const input = inputPrefix ? document.getElementById(`${inputPrefix}-${indicatorId}`) : null
      const target = input ?? document.getElementById(`strategy-section-${sectionOfField(focusField)}-${indicatorId}`)
      target?.scrollIntoView?.({ block: "center", behavior: "smooth" })
      if (input instanceof HTMLElement) input.focus({ preventScroll: true })
      setFocusField(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusField, indicatorId])

  const sourceEnabled = (code: string) => (code === "INTERACTIONS" ? config?.interactionInvestigation.enabled : code === "PROCESS_ASSESSMENT" || code === "KNOWLEDGE" ? config?.processAssessment.enabled : code === "PEER_COMPARISON" ? config?.peerComparison.enabled : false) ?? false
  const requirementMet = (requirement: string) => (requirement === "SEGMENTATION" ? config?.segmentation.enabled : requirement === "INTERACTIONS" ? config?.interactionInvestigation.enabled : requirement === "PROCESS_ASSESSMENT" ? config?.processAssessment.enabled : true) ?? false
  const issueList = publishIssues.length > 0 ? publishIssues : dirty ? [] : overview.draft ? overview.draftIssues : []
  const issues = issueList.map((issue) => issue.message)
  const fieldError = (field: string) => issueList.find((issue) => issue.field === field)?.message
  const sectionErrors = (key: SectionKey) => issueList.filter((issue) => issue.field !== "" && sectionOfField(issue.field) === key && !FIELD_INPUTS[issue.field]).map((issue) => issue.message)

  return (
    <div className="space-y-4" data-testid="diagnostic-strategy-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <DiagnosticStrategyStatusBadge status={overview.status} />
            {overview.published ? <span className="text-xs text-muted-foreground">Versão publicada: v{overview.published.version}</span> : null}
            {overview.draft ? <span className="text-xs text-muted-foreground">Rascunho: v{overview.draft.version}</span> : null}
            {localDraft && !overview.draft ? <span className="text-xs text-muted-foreground">Novo rascunho (ainda não salvo)</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">Define como a INIA investiga este indicador antes de dar feedback. O que pode ser afirmado é regra do produto e não muda aqui.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {overview.published || overview.draft ? (
            <Button size="sm" variant="outline" onClick={() => setTesting(true)}>
              <FlaskConical /> Testar diagnóstico
            </Button>
          ) : null}
          {!editable ? (
            <Button size="sm" disabled={busy} onClick={startLocalDraft}>
              {overview.published ? "Editar estratégia" : "Configurar estratégia"}
            </Button>
          ) : null}
          {overview.published ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setActive.mutate({ indicatorId, active: !overview.active })}>
              {overview.active ? "Desativar" : "Ativar"}
            </Button>
          ) : null}
        </div>
      </div>

      {!config ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Diagnóstico com IA não configurado. Sem estratégia publicada, o feedback deste indicador mostra só o resultado oficial — nenhuma orientação é gerada.
        </p>
      ) : (
        <>
          <SignalSection indicatorId={indicatorId} config={config} editable={editable} savedSignal={(overview.draft ?? overview.published)?.config.populationSignal ?? null} errors={sectionErrors("signal")} conditionError={fieldError("populationSignal.condition")} onChange={update} />

          {!capabilities.indicator.decomposable ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Este indicador ainda não possui uma dimensão operacional disponível para diagnóstico aprofundado. Ele continua produzindo o resultado oficial e, sem evidência, o comportamento definido abaixo.
            </p>
          ) : (
            <Section id={`strategy-section-investigation-${indicatorId}`} errors={sectionErrors("investigation")} title="Como investigar este indicador" description="Só aparecem as capacidades que a INIA já sabe executar para este indicador.">
              <ToggleRow id={`seg-${indicatorId}`} label="Segmentar o resultado" description="Localiza onde o resultado se concentra antes de olhar atendimentos." checked={config.segmentation.enabled} disabled={!editable} onChange={(value) => update(toggle(config, "SEGMENTATION", value, defaultDimension))} />
              {config.segmentation.enabled ? (
                <div className="space-y-2 rounded-md bg-muted/40 p-3">
                  <p className="text-xs font-medium">Dimensões de análise</p>
                  {capabilities.dimensions.map((dimension) => (
                    <label key={dimension.code} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={config.segmentation.dimensions.includes(dimension.code)}
                        disabled={!editable}
                        onChange={(event) => update({ ...config, segmentation: { ...config.segmentation, dimensions: event.target.checked ? [...config.segmentation.dimensions, dimension.code] : config.segmentation.dimensions.filter((code) => code !== dimension.code) } })}
                      />
                      <span>
                        {dimension.label}
                        <span className="block text-xs text-muted-foreground">{dimension.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              {capabilities.configurableSources.map((source) => {
                const blocked = source.requires.find((requirement) => !requirementMet(requirement))
                return (
                  <ToggleRow
                    key={source.code}
                    id={`${source.code}-${indicatorId}`}
                    label={source.label}
                    description={source.description}
                    checked={sourceEnabled(source.code)}
                    disabled={!editable || source.lockedOnWith !== null || Boolean(blocked)}
                    lockedLabel={source.lockedOnWith ? "Incluída automaticamente quando processos são avaliados." : blocked ? "Depende da opção anterior." : null}
                    onChange={(value) => update(toggle(config, source.code as "INTERACTIONS" | "PROCESS_ASSESSMENT" | "PEER_COMPARISON", value, defaultDimension))}
                  />
                )
              })}
            </Section>
          )}

          <Section title="Fontes utilizadas pela investigação">
            <ul className="space-y-1 text-sm">
              {capabilities.mandatorySources.map((source) => (
                <li key={source.code} className="flex items-center justify-between gap-2">
                  <span>{source.label}</span>
                  <Badge variant="outline"><Lock className="h-3 w-3" /> Sempre</Badge>
                </li>
              ))}
              {capabilities.configurableSources.map((source) => (
                <li key={source.code} className="flex items-center justify-between gap-2">
                  <span>{source.label}</span>
                  <Badge variant={sourceEnabled(source.code) ? "secondary" : "outline"}>{sourceEnabled(source.code) ? "Usada" : "Não usada"}</Badge>
                </li>
              ))}
            </ul>
          </Section>

          {config.interactionInvestigation.enabled ? (
            <Section collapsible id={`strategy-section-sampling-${indicatorId}`} open={sectionOpen("sampling")} onOpenChange={setSectionOpen("sampling")} errors={sectionErrors("sampling")} title="Amostragem" description="Seleção determinística e reproduzível — nunca aleatória.">
              <div className="flex flex-wrap gap-4">
                <NumberField id={`max-${indicatorId}`} error={fieldError("interactionInvestigation.maxInteractions")} label="Máximo de atendimentos" value={config.interactionInvestigation.maxInteractions} min={limit(limits, "maxInteractions", "min", 3)} max={limit(limits, "maxInteractions", "max", 10)} disabled={!editable} onChange={(value) => update({ ...config, interactionInvestigation: { ...config.interactionInvestigation, maxInteractions: value ?? 0 } })} />
                <NumberField id={`min-${indicatorId}`} error={fieldError("interactionInvestigation.minimumAnalyzed")} label="Amostra mínima" value={config.interactionInvestigation.minimumAnalyzed} min={limit(limits, "minimumAnalyzed", "floor", 3)} max={config.interactionInvestigation.maxInteractions} disabled={!editable} hint={`Mínimo do produto: ${limit(limits, "minimumAnalyzed", "floor", 3)}`} onChange={(value) => update({ ...config, interactionInvestigation: { ...config.interactionInvestigation, minimumAnalyzed: value ?? 0 } })} />
                <NumberField id={`segment-${indicatorId}`} error={fieldError("segmentation.minimumSegmentInteractions")} label="Atendimentos por motivo" value={config.segmentation.minimumSegmentInteractions} min={limit(limits, "minimumSegmentInteractions", "floor", 3)} max={limit(limits, "minimumSegmentInteractions", "max", 50)} disabled={!editable} hint="Mínimo de atendimentos transcritos para investigar um motivo" onChange={(value) => update({ ...config, segmentation: { ...config.segmentation, minimumSegmentInteractions: value ?? 0 } })} />
                <NumberField id={`coverage-${indicatorId}`} error={fieldError("interactionInvestigation.minimumCoveragePercent")} label="Cobertura mínima (%)" value={config.interactionInvestigation.minimumCoveragePercent} min={1} max={100} disabled={!editable} hint="Opcional: parte dos atendimentos do motivo que precisa ser analisada" onChange={(value) => update({ ...config, interactionInvestigation: { ...config.interactionInvestigation, minimumCoveragePercent: value } })} />
                <NumberField id={`repair-${indicatorId}`} error={fieldError("interactionInvestigation.maxRepairInteractions")} label="Revisões da avaliação" value={config.interactionInvestigation.maxRepairInteractions ?? config.interactionInvestigation.maxInteractions} min={0} max={config.interactionInvestigation.maxInteractions} disabled={!editable} hint="Atendimentos que podem ter uma revisão única quando a avaliação volta incompleta ou contraditória" onChange={(value) => update({ ...config, interactionInvestigation: { ...config.interactionInvestigation, maxRepairInteractions: value ?? undefined } })} />
              </div>
            </Section>
          ) : null}

          {config.interactionInvestigation.enabled ? (
            <Section collapsible id={`strategy-section-domains-${indicatorId}`} open={sectionOpen("domains")} onOpenChange={setSectionOpen("domains")} errors={sectionErrors("domains")} title="Domínios que podem participar" description="Universo permitido: o Agent do Workflow precisa ser de um destes domínios. Nenhum marcado = qualquer Agent.">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {overview.domains.map((domain) => {
                  const selected = config.allowedBusinessDomainIds.includes(domain.id)
                  return (
                    <label key={domain.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected} disabled={!editable || (!domain.active && !selected)} onChange={(event) => update({ ...config, allowedBusinessDomainIds: event.target.checked ? [...config.allowedBusinessDomainIds, domain.id] : config.allowedBusinessDomainIds.filter((id) => id !== domain.id) })} />
                      <span>{domain.name}{domain.active ? "" : " (desativado)"}</span>
                    </label>
                  )
                })}
                {overview.domains.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum domínio de negócio cadastrado.</p> : null}
              </div>
              <p className="text-xs text-muted-foreground">As bases de conhecimento continuam vindo dos Agents: o indicador não escolhe documentos.</p>
            </Section>
          ) : null}

          {config.peerComparison.enabled ? (
            <Section collapsible id={`strategy-section-peer-${indicatorId}`} open={sectionOpen("peer")} onOpenChange={setSectionOpen("peer")} errors={sectionErrors("peer")} title="Comparação com grupo de referência" description="Só agregado, com as regras do produto. Os mínimos podem ser aumentados, nunca reduzidos.">
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {capabilities.peerRules.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
              <div className="flex flex-wrap gap-4">
                <NumberField id={`pop-${indicatorId}`} error={fieldError("peerComparison.minimumPopulation")} label="Pessoas no grupo" value={config.peerComparison.minimumPopulation} min={limit(limits, "peerMinimumPopulation", "floor", 4)} max={limit(limits, "peerMinimumPopulation", "max", 100)} disabled={!editable} onChange={(value) => update({ ...config, peerComparison: { ...config.peerComparison, minimumPopulation: value ?? 0 } })} />
                <NumberField id={`contrib-${indicatorId}`} error={fieldError("peerComparison.minimumContributors")} label="Pessoas contribuindo" value={config.peerComparison.minimumContributors} min={limit(limits, "peerMinimumContributors", "floor", 4)} max={limit(limits, "peerMinimumContributors", "max", 100)} disabled={!editable} onChange={(value) => update({ ...config, peerComparison: { ...config.peerComparison, minimumContributors: value ?? 0 } })} />
                <NumberField id={`obs-${indicatorId}`} error={fieldError("peerComparison.minimumObservedInteractions")} label="Atendimentos observados" value={config.peerComparison.minimumObservedInteractions} min={limit(limits, "peerMinimumObservedInteractions", "floor", 5)} max={limit(limits, "peerMinimumObservedInteractions", "max", 500)} disabled={!editable} onChange={(value) => update({ ...config, peerComparison: { ...config.peerComparison, minimumObservedInteractions: value ?? 0 } })} />
              </div>
            </Section>
          ) : null}

          <ClosingTriageSection indicatorId={indicatorId} config={config} editable={editable} errors={sectionErrors("triage")} onChange={update} />

          {config.investigation || config.populationSignal ? <GuidedInvestigationSection config={config} steps={capabilities.investigationSteps ?? []} /> : null}

          <Section title="Quando a INIA não encontrar evidência suficiente" description="Sem diagnóstico acionável não existe orientação: a escolha é o que fazer com o fato.">
            <RadioGroup value={config.noDiagnosisBehavior} onValueChange={(value) => update({ ...config, noDiagnosisBehavior: value as StrategyConfig["noDiagnosisBehavior"] })} disabled={!editable} aria-label="Quando a INIA não encontrar evidência suficiente">
              {capabilities.noDiagnosisBehaviors.map((behavior) => (
                <label key={behavior.code} className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value={behavior.code} id={`nodiag-${behavior.code}-${indicatorId}`} className="mt-0.5" />
                  <span>
                    {behavior.label}
                    <span className="block text-xs text-muted-foreground">{behavior.description}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </Section>

          <Section collapsible title="Sempre aplicado pela INIA" description="Garantias do produto — não são configuráveis.">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {capabilities.guardrails.map((rule) => (
                <li key={rule} className="flex items-start gap-1.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {rule}</li>
              ))}
            </ul>
          </Section>

          {dirty ? <p className="text-xs text-muted-foreground">Alterações não salvas — salve o rascunho para testar ou publicar.</p> : null}

          {issues.length > 0 && editable ? (
            <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="alert">
              <p className="font-medium">Antes de publicar:</p>
              <ul className="list-disc pl-5">{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>
            </div>
          ) : null}

          {editable ? (
            <div className="flex flex-wrap justify-end gap-2">
              {overview.draft ? (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmDiscard(true)}>Descartar rascunho</Button>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={cancelLocalDraft}>Cancelar</Button>
              )}
              <Button variant="outline" disabled={busy || !dirty} onClick={() => saveDraft.mutate({ indicatorId, config })}>Salvar rascunho</Button>
              <Button disabled={busy} onClick={handlePublish}>{publish.isPending ? "Publicando..." : "Publicar estratégia"}</Button>
            </div>
          ) : null}

          {overview.history.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Histórico: {overview.history.map((entry) => `v${entry.version}${entry.status === "PUBLISHED" ? " (vigente)" : ""}${entry.publishedByName ? ` por ${entry.publishedByName}` : ""}`).join(" · ")}. Versões publicadas não mudam; execuções seguem a versão com que começaram.
            </p>
          ) : null}
        </>
      )}

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar rascunho?</AlertDialogTitle>
            <AlertDialogDescription>As alterações ainda não publicadas desta versão serão perdidas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={discard.isPending}
              onClick={() => {
                discard.mutate(indicatorId)
                setConfirmDiscard(false)
              }}
            >
              Descartar rascunho
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {testing ? <IndicatorDiagnosticSimulationDialog indicatorId={indicatorId} hasDraft={overview.draft !== null} hasPublished={overview.published !== null} onClose={() => setTesting(false)} /> : null}
    </div>
  )
}

const QUARTILES = ["Q1", "Q2", "Q3", "Q4"] as const
const EMPTY_TRIAGE: NonNullable<StrategyConfig["closingTriage"]> = { enabled: false, developmentQuartiles: [], belowTarget: false, quartileWorsened: false, recognitionQuartiles: [] }

/**
 * Indicator Diagnosis V1 — TRIAGEM DO FECHAMENTO DO PRV: quais fechamentos oficiais deste indicador abrem investigação. É a regra do
 * indicador (nunca do código): desenvolvimento por quartil, fora da referência ou piora de quartil; reconhecimento por quartil.
 * Resultado fora da meta não prova erro — a triagem só decide onde olhar.
 */
function ClosingTriageSection({ indicatorId, config, editable, errors, onChange }: { indicatorId: string; config: StrategyConfig; editable: boolean; errors: string[]; onChange: (next: StrategyConfig) => void }) {
  const triage = config.closingTriage ?? EMPTY_TRIAGE
  const set = (patch: Partial<NonNullable<StrategyConfig["closingTriage"]>>) => onChange({ ...config, closingTriage: { ...triage, ...patch } })
  const toggleQuartile = (field: "developmentQuartiles" | "recognitionQuartiles", quartile: (typeof QUARTILES)[number], checked: boolean) => set({ [field]: checked ? [...triage[field], quartile].sort() : triage[field].filter((entry) => entry !== quartile) })
  return (
    <Section id={`strategy-section-triage-${indicatorId}`} errors={errors} title="Fechamento do PRV" description="Quando o fechamento oficial deste indicador abre investigação no diagnóstico do fechamento. Q1 = melhor quartil, Q4 = pior.">
      <ToggleRow id={`triage-${indicatorId}`} label="Investigar a partir do fechamento oficial" description="Usado pelo Workflow com a fonte “Fechamentos oficiais” e o formato “Diagnóstico do fechamento do PRV”." checked={triage.enabled} disabled={!editable} onChange={(enabled) => set({ enabled })} />
      {triage.enabled ? (
        <div className="space-y-3 pl-1">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Investigar desenvolvimento nos quartis</legend>
            <div className="flex flex-wrap gap-4">
              {QUARTILES.map((quartile) => (
                <label key={quartile} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={triage.developmentQuartiles.includes(quartile)} disabled={!editable} onChange={(event) => toggleQuartile("developmentQuartiles", quartile, event.target.checked)} />
                  <span>{quartile}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ToggleRow id={`triage-below-${indicatorId}`} label="Investigar quando o resultado oficial estiver fora da referência" description="Atingimento oficial abaixo de 100% (ou, sem ele, valor × meta × sentido do indicador)." checked={triage.belowTarget} disabled={!editable} onChange={(belowTarget) => set({ belowTarget })} />
          <ToggleRow id={`triage-worse-${indicatorId}`} label="Investigar quando o quartil piorar" description="Comparado ao fechamento anterior do mesmo indicador." checked={triage.quartileWorsened} disabled={!editable} onChange={(quartileWorsened) => set({ quartileWorsened })} />
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Reconhecimento nos quartis</legend>
            <p className="text-xs text-muted-foreground">Investiga só práticas consistentes (nunca procura ponto a corrigir). Nunca elogia resultado fora da referência.</p>
            <div className="flex flex-wrap gap-4">
              {QUARTILES.map((quartile) => (
                <label key={quartile} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={triage.recognitionQuartiles.includes(quartile)} disabled={!editable} onChange={(event) => toggleQuartile("recognitionQuartiles", quartile, event.target.checked)} />
                  <span>{quartile}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
    </Section>
  )
}

/**
 * `POPULATION_SIGNAL_V2` — o SINAL NAS CHAMADAS: a flag (já calculada pela fonte) que marca nas chamadas o evento que o indicador
 * reflete. Sim/não marca sozinha; numérica precisa da condição (ex.: nota_ura ≤ 2). O admin declara o que a chamada sinalizada
 * representa — a INIA nunca deduz isso do nome da flag. Com o sinal salvo, o indicador passa a se decompor pelas chamadas.
 */
function SignalSection({ indicatorId, config, editable, savedSignal, errors, conditionError, onChange }: { indicatorId: string; config: StrategyConfig; editable: boolean; savedSignal: PopulationSignalConfig | null; errors: string[]; conditionError?: string; onChange: (next: StrategyConfig) => void }) {
  const flagsQuery = useChannelFlagsQuery()
  const signal = config.populationSignal
  const [operator, setOperator] = useState<SignalOperator>(signal?.condition?.operator ?? "LTE")
  const flags = (flagsQuery.data ?? []).filter((flag) => flag.active || flag.flagName === signal?.flagName)
  const names = [...new Set(flags.map((flag) => flag.flagName))].sort((a, b) => a.localeCompare(b, "pt-BR"))
  const typeOf = (name: string) => flags.find((flag) => flag.flagName === name)?.valueType ?? null
  const numeric = signal ? typeOf(signal.flagName) === "NUMERIC" : false
  const setSignal = (next: PopulationSignalConfig | undefined) => {
    const updated = structuredClone(config)
    if (next) updated.populationSignal = next
    else {
      delete updated.populationSignal
      // Avaliar atendimentos vinculados ao sinal deixa de fazer sentido sem sinal.
      if (updated.processAssessment.population === "LINKED_PREVIOUS_OF_SIGNAL") delete updated.processAssessment.population
    }
    onChange(updated)
  }
  const chooseFlag = (name: string) => {
    const base: PopulationSignalConfig = { kind: "INTERACTION_FLAG", flagName: name, ...(signal?.effect ? { effect: signal.effect } : {}) }
    setSignal(base)
  }
  const pendingSave = JSON.stringify(signal ?? null) !== JSON.stringify(savedSignal ?? null)
  return (
    <Section id={`strategy-section-signal-${indicatorId}`} errors={errors} title="Sinal nas chamadas" description="A marca, já calculada pela fonte, que identifica nas chamadas o evento que o indicador reflete. Com ela, a INIA localiza onde o resultado mudou e analisa primeiro as chamadas sinalizadas.">
      {!editable ? (
        signal ? (
          <dl className="grid gap-1 text-sm">
            <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Chamadas com</dt><dd className="font-medium">“{signalLabelOf(signal)}”</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Representam</dt><dd>{signal.effect ? SIGNAL_EFFECT_LABELS[signal.effect].description : "o mesmo sentido do indicador (versão anterior à declaração)"}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum sinal: o indicador só se decompõe pela própria unidade (duração ou volume), quando ela permite.</p>
        )
      ) : (
        <div className="space-y-3">
          <ToggleRow id={`signal-${indicatorId}`} label="Usar um sinal das chamadas" description="Ex.: a flag rechamada, ou a nota da URA abaixo de um valor." checked={Boolean(signal)} disabled={names.length === 0} onChange={(value) => (value ? chooseFlag(names[0]!) : setSignal(undefined))} lockedLabel={flagsQuery.isLoading ? "Carregando as flags…" : names.length === 0 ? "Nenhuma flag ativa no catálogo." : null} />
          {signal ? (
            <div className="space-y-3 rounded-md bg-muted/40 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`signal-flag-${indicatorId}`} className="text-sm">Flag</Label>
                  <Select value={signal.flagName} onValueChange={chooseFlag}>
                    <SelectTrigger id={`signal-flag-${indicatorId}`} className="w-56" aria-label="Flag do sinal"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {names.map((name) => <SelectItem key={name} value={name}>{name} · {typeOf(name) === "NUMERIC" ? "numérica" : "sim/não"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {numeric ? (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor={`signal-operator-${indicatorId}`} className="text-sm">Quando o valor for</Label>
                      <Select value={operator} onValueChange={(value) => {
                        setOperator(value as SignalOperator)
                        if (signal.condition) setSignal({ ...signal, condition: { operator: value as SignalOperator, value: signal.condition.value } })
                      }}>
                        <SelectTrigger id={`signal-operator-${indicatorId}`} className="w-44" aria-label="Condição do valor"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(SIGNAL_OPERATOR_LABELS) as SignalOperator[]).map((code) => <SelectItem key={code} value={code}>{SIGNAL_OPERATOR_LABELS[code]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`signal-value-${indicatorId}`} className="text-sm">Valor</Label>
                      <Input id={`signal-value-${indicatorId}`} type="number" inputMode="decimal" step="any" className="w-24" value={signal.condition?.value ?? ""} aria-invalid={conditionError ? true : undefined} onChange={(event) => {
                        const raw = event.target.value
                        const { condition: _previous, ...rest } = signal
                        void _previous
                        setSignal(raw === "" || !Number.isFinite(Number(raw)) ? rest : { ...rest, condition: { operator, value: Number(raw) } })
                      }} />
                    </div>
                  </>
                ) : null}
              </div>
              {conditionError ? <p className="text-xs text-destructive">{conditionError}</p> : null}
              <fieldset className="space-y-1">
                <legend className="text-sm">A chamada com o sinal representa</legend>
                <RadioGroup value={signal.effect ?? ""} onValueChange={(value) => setSignal({ ...signal, effect: value as "ADVERSE" | "FAVORABLE" })} aria-label="O que a chamada com o sinal representa">
                  {(Object.keys(SIGNAL_EFFECT_LABELS) as ("ADVERSE" | "FAVORABLE")[]).map((effect) => (
                    <label key={effect} className="flex items-start gap-2 text-sm">
                      <RadioGroupItem value={effect} id={`signal-effect-${effect}-${indicatorId}`} className="mt-0.5" />
                      <span>
                        {SIGNAL_EFFECT_LABELS[effect].label}
                        <span className="block text-xs text-muted-foreground">{SIGNAL_EFFECT_LABELS[effect].description}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
              {config.processAssessment.population === "LINKED_PREVIOUS_OF_SIGNAL" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-2 text-xs">
                  <span>Esta versão pede avaliar os atendimentos ANTERIORES vinculados ao sinal — os dados não trazem esse vínculo, então só os atendimentos do próprio período são avaliados.</span>
                  <Button size="sm" variant="outline" onClick={() => {
                    const updated = structuredClone(config)
                    delete updated.processAssessment.population
                    onChange(updated)
                  }}>Avaliar os próprios atendimentos</Button>
                </div>
              ) : null}
              {pendingSave ? <p className="text-xs text-muted-foreground">Salve o rascunho para a tela mostrar o que o sinal libera (segmentação e análise das chamadas).</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  )
}

/**
 * Indicator Diagnosis V2 — investigação orientada pela IA e sinal da população: SOMENTE LEITURA nesta tela (a edição ainda não tem
 * interface; os campos são preservados ao salvar um rascunho). O que a IA lê e entre o que ela pode escolher — o sistema valida.
 */
function GuidedInvestigationSection({ config, steps }: { config: StrategyConfig; steps: { code: string; label: string }[] }) {
  const investigation = config.investigation
  const labelOf = (code: string) => steps.find((step) => step.code === code)?.label ?? code
  return (
    <Section title="Investigação orientada pela IA" description="Lida pela IA a cada diagnóstico; ela só escolhe entre os passos permitidos e disponíveis — os números e a comparação com grupo são sempre do sistema.">
      <dl className="grid gap-2 text-sm">
        {config.populationSignal ? (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Sinal da população</dt>
            <dd>Flag “{signalLabelOf(config.populationSignal)}” (calculada pela fonte){config.processAssessment.population === "LINKED_PREVIOUS_OF_SIGNAL" ? " · processos avaliados nos atendimentos anteriores vinculados ao sinal" : ""}</dd>
          </div>
        ) : null}
        {investigation ? (
          <>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Modo</dt>
              <dd>{investigation.mode === "AGENT_SELECTED" ? "A IA escolhe os passos" : "Passos fixos"}</dd>
            </div>
            {investigation.objective ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Objetivo</dt>
                <dd className="whitespace-pre-line">{investigation.objective}</dd>
              </div>
            ) : null}
            {investigation.instructions ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Instruções de investigação</dt>
                <dd className="whitespace-pre-line">{investigation.instructions}</dd>
              </div>
            ) : null}
            {investigation.allowedSteps.length > 0 ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Passos permitidos</dt>
                <dd><ul className="list-disc pl-5">{investigation.allowedSteps.map((step) => <li key={step}>{labelOf(step)}</li>)}</ul></dd>
              </div>
            ) : null}
            {investigation.prohibitedClaims.length > 0 ? (
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Frases que nenhum texto gerado pode conter</dt>
                <dd><ul className="list-disc pl-5">{investigation.prohibitedClaims.map((claim) => <li key={claim}>“{claim}”</li>)}</ul></dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
    </Section>
  )
}
