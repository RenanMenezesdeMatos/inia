"use client"

import { useId, useState } from "react"
import { CalendarClock, Hand, Radio, TrendingUp, type LucideIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { useChannelFlagsQuery } from "@/queries/admin/use-channel-flag-queries"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import { useSchedulePreviewQuery, useUpdateWorkflowTriggerMutation } from "@/queries/admin/use-workflow-queries"
import type { WorkflowTriggerInput } from "@/services/admin/workflow-service"
import {
  MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS,
  MANUAL_TRIGGER_CONTEXT_LABELS,
  manualTriggerContextSchema,
  triggerDataOrigin,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT_LABELS,
  type RelativeSchedule,
  type ScheduleAnchor,
  type ScheduleFrequency,
  type Weekday,
  type WorkflowTrigger,
} from "@/schemas/admin/workflow.schema"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { cn } from "@/lib/utils"

import { TimeListEditor } from "./time-list-editor"

type ScheduleTrigger = Extract<WorkflowTriggerInput, { kind: "schedule" }>
type ScopeInput = { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string }

function scheduleModeOf(trigger: ScheduleTrigger): "CALENDAR" | "RELATIVE_TO_SHIFT" {
  return trigger.mode === "RELATIVE_TO_SHIFT" ? "RELATIVE_TO_SHIFT" : "CALENDAR"
}

/** Um gatilho só está pronto pra salvar quando tem um valor concreto escolhido — evita
 * mandar pro backend um channelFlagId/indicatorCode vazio só por ter trocado o tipo, e pra
 * Agenda, os campos que cada frequência/momento exige (Parte 28/30 do pedido de agendamento
 * relativo ao expediente). */
export function isTriggerComplete(trigger: WorkflowTriggerInput): boolean {
  if (trigger.kind === "channel_flag") return Boolean(trigger.channelFlagId)
  if (trigger.kind === "indicator") return Boolean(trigger.indicatorCode)
  if (trigger.kind === "manual") return trigger.context !== "INDICATOR_MEASUREMENT" || Boolean(trigger.indicatorCode)
  if (scheduleModeOf(trigger) === "RELATIVE_TO_SHIFT") {
    const relative = trigger.relative
    if (!relative) return false
    if (relative.anchor === "PERCENTAGE") return relative.percentage !== undefined
    return relative.offsetMinutes !== undefined
  }
  const times = trigger.times ?? []
  if (times.length === 0) return false
  if (trigger.frequency?.type === "WEEKLY") return trigger.frequency.weekdays.length > 0
  if (trigger.frequency?.type === "MONTHLY") return trigger.frequency.mode === "LAST_DAY" || trigger.frequency.day !== undefined
  return true // DAILY / EVERY_N_DAYS (explícito ou legado) — só precisa de horário
}

const TRIGGER_KIND_OPTIONS: { kind: WorkflowTriggerInput["kind"]; label: string; description: string; icon: LucideIcon }[] = [
  { kind: "channel_flag", label: "Flag de canal", description: "Evento de interação", icon: Radio },
  { kind: "indicator", label: "Indicador", description: "Evento de medição", icon: TrendingUp },
  { kind: "schedule", label: "Por agenda", description: "Recorrência de calendário", icon: CalendarClock },
  { kind: "manual", label: "Manual", description: "Executar agora", icon: Hand },
]

type ScheduleFrequencyKind = ScheduleFrequency["type"]

const FREQUENCY_KIND_OPTIONS: { kind: ScheduleFrequencyKind; label: string }[] = [
  { kind: "DAILY", label: "Diariamente" },
  { kind: "WEEKLY", label: "Semanalmente" },
  { kind: "MONTHLY", label: "Mensalmente" },
  { kind: "EVERY_N_DAYS", label: "A cada X dias" },
]

const SCHEDULE_MODE_OPTIONS: { mode: "CALENDAR" | "RELATIVE_TO_SHIFT"; label: string }[] = [
  { mode: "CALENDAR", label: "Horário/calendário" },
  { mode: "RELATIVE_TO_SHIFT", label: "Relativo ao expediente" },
]

function scheduleFrequencyKindOf(trigger: ScheduleTrigger): ScheduleFrequencyKind {
  if (trigger.frequency) return trigger.frequency.type
  return trigger.intervalDays > 1 ? "EVERY_N_DAYS" : "DAILY"
}

/**
 * Corpo do Trigger "Por agenda" — Modo da agenda no topo (Calendário/Relativo ao expediente,
 * evolução do agendamento relativo ao expediente), depois só os campos do modo escolhido.
 */
function ScheduleTriggerFields({ value, onChange, scope }: { value: ScheduleTrigger; onChange: (next: ScheduleTrigger) => void; scope?: ScopeInput }) {
  const mode = scheduleModeOf(value)
  const modeId = useId()

  function setMode(next: "CALENDAR" | "RELATIVE_TO_SHIFT") {
    if (next === "CALENDAR") onChange({ kind: "schedule", mode: "CALENDAR", times: [], intervalDays: 1, frequency: { type: "DAILY" } })
    else onChange({ kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1, relative: { anchor: "PERCENTAGE", percentage: 50 } })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={modeId}>Modo da agenda</Label>
        <Select value={mode} onValueChange={(next) => setMode(next as "CALENDAR" | "RELATIVE_TO_SHIFT")}>
          <SelectTrigger id={modeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.mode} value={option.mode}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "RELATIVE_TO_SHIFT" ? (
        <RelativeScheduleFields value={value} onChange={onChange} scope={scope} />
      ) : (
        <CalendarScheduleFields value={value} onChange={onChange} />
      )}
    </div>
  )
}

/**
 * Configuração de recorrência de CALENDÁRIO do Trigger "Por agenda" (Diariamente/Semanalmente/
 * Mensalmente/A cada X dias). Mostra só os campos relevantes pra frequência escolhida (Parte 11
 * do pedido — evitar formulário grande) e uma prévia das próximas execuções calculada pelo MESMO
 * endpoint/lógica que o checador real do backend usa (Parte 10).
 */
function CalendarScheduleFields({ value, onChange }: { value: ScheduleTrigger; onChange: (next: ScheduleTrigger) => void }) {
  const kind = scheduleFrequencyKindOf(value)
  const isComplete = isTriggerComplete(value)
  const previewQuery = useSchedulePreviewQuery(value, undefined, isComplete)

  function setFrequencyKind(next: ScheduleFrequencyKind) {
    if (next === "DAILY") onChange({ ...value, frequency: { type: "DAILY" } })
    else if (next === "EVERY_N_DAYS") onChange({ ...value, frequency: { type: "EVERY_N_DAYS" }, intervalDays: value.intervalDays > 1 ? value.intervalDays : 2 })
    else if (next === "WEEKLY") onChange({ ...value, frequency: { type: "WEEKLY", weekdays: [] } })
    else onChange({ ...value, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH" } })
  }

  const monthly = value.frequency?.type === "MONTHLY" ? value.frequency : undefined
  const weekly = value.frequency?.type === "WEEKLY" ? value.frequency : undefined
  const fieldId = useId()

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-frequency`}>Frequência</Label>
        <Select value={kind} onValueChange={(next) => setFrequencyKind(next as ScheduleFrequencyKind)}>
          <SelectTrigger id={`${fieldId}-frequency`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_KIND_OPTIONS.map((option) => (
              <SelectItem key={option.kind} value={option.kind}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-times`}>Horários</Label>
        <TimeListEditor id={`${fieldId}-times`} times={value.times ?? []} onChange={(times) => onChange({ ...value, times })} />
      </div>

      {kind === "WEEKLY" ? (
        <div className="space-y-1.5">
          <Label>Dias da semana</Label>
          <ToggleGroup
            type="multiple"
            value={weekly?.weekdays ?? []}
            onValueChange={(weekdays) => onChange({ ...value, frequency: { type: "WEEKLY", weekdays: weekdays as Weekday[] } })}
            className="flex-wrap justify-start"
          >
            {WEEKDAY_ORDER.map((day) => (
              <ToggleGroupItem key={day} value={day} className="text-xs">
                {WEEKDAY_SHORT_LABELS[day]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}

      {kind === "MONTHLY" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-monthly-mode`}>Executar</Label>
            <Select
              value={monthly?.mode ?? "DAY_OF_MONTH"}
              onValueChange={(mode) =>
                onChange({
                  ...value,
                  frequency: { type: "MONTHLY", mode: mode as "DAY_OF_MONTH" | "LAST_DAY", day: mode === "DAY_OF_MONTH" ? monthly?.day : undefined },
                })
              }
            >
              <SelectTrigger id={`${fieldId}-monthly-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY_OF_MONTH">Dia do mês</SelectItem>
                <SelectItem value="LAST_DAY">Último dia do mês</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {monthly?.mode === "DAY_OF_MONTH" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-monthly-day`}>Dia</Label>
              <Input
                id={`${fieldId}-monthly-day`}
                type="number"
                min={1}
                max={31}
                value={monthly.day ?? ""}
                onChange={(event) => {
                  const day = event.target.value ? Math.min(31, Math.max(1, Number(event.target.value) || 1)) : undefined
                  onChange({ ...value, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day } })
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {kind === "EVERY_N_DAYS" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-interval`}>A cada quantos dias</Label>
          <Input
            id={`${fieldId}-interval`}
            type="number"
            min={1}
            max={90}
            value={value.intervalDays}
            onChange={(event) => onChange({ ...value, intervalDays: Math.max(1, Number(event.target.value) || 1) })}
            className="w-24"
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Próximas execuções</Label>
        {!isComplete ? (
          <p className="text-xs text-muted-foreground">Complete a configuração pra ver a prévia.</p>
        ) : previewQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Calculando…</p>
        ) : previewQuery.data?.mode === "CALENDAR" && (previewQuery.data.occurrences.length > 0 || previewQuery.data.catchUpToday.length > 0) ? (
          <div className="space-y-1">
            {previewQuery.data.catchUpToday.length > 0 ? (
              // O agendador recupera os horários de HOJE já vencidos: entrar no ar hoje (publicar/ativar) dispara na hora.
              <p className="rounded-md border border-amber-500/50 bg-amber-500/5 p-1.5 text-xs text-amber-800 dark:text-amber-200" data-testid="schedule-preview-catch-up">
                Hoje às {previewQuery.data.catchUpToday.map((iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })).join(", ")} já passou: se este
                gatilho entrar no ar hoje (ao publicar ou ativar), essa execução começa em até 1 minuto.
              </p>
            ) : null}
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {previewQuery.data.occurrences.map((iso) => (
                <li key={iso}>{new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma execução encontrada nos próximos dias.</p>
        )}
      </div>
    </div>
  )
}

const ANCHOR_OPTIONS: { anchor: ScheduleAnchor; label: string }[] = [
  { anchor: "START", label: "Após o início" },
  { anchor: "PERCENTAGE", label: "Percentual da jornada" },
  { anchor: "END", label: "Antes do fim" },
]

const PERCENTAGE_PRESETS: { label: string; value: number }[] = [
  { label: "Início", value: 0 },
  { label: "25%", value: 25 },
  { label: "Meio (50%)", value: 50 },
  { label: "75%", value: 75 },
  { label: "Final", value: 100 },
]

function defaultRelativeFor(anchor: ScheduleAnchor): RelativeSchedule {
  if (anchor === "PERCENTAGE") return { anchor, percentage: 50 }
  return { anchor, offsetMinutes: 15 }
}

/**
 * Agendamento relativo ao EXPEDIENTE PREVISTO do colaborador (horário de entrada + carga
 * horária) — nunca de telemetria de login real, que não existe hoje (ver
 * docs/workflow-engine-wiki.md). Três estratégias genéricas cobrem início/meio/fim da jornada
 * (Parte 6 do pedido): Após o início, Percentual da jornada, Antes do fim — sem criar enums
 * rígidos por preset, todos resolvidos pela mesma estrutura anchor/offsetMinutes/percentage.
 */
function RelativeScheduleFields({ value, onChange, scope }: { value: ScheduleTrigger; onChange: (next: ScheduleTrigger) => void; scope?: ScopeInput }) {
  const relative = value.relative ?? defaultRelativeFor("PERCENTAGE")
  const isComplete = isTriggerComplete(value)
  const previewQuery = useSchedulePreviewQuery(value, scope, isComplete)
  const fieldId = useId()

  function setAnchor(anchor: ScheduleAnchor) {
    onChange({ ...value, relative: defaultRelativeFor(anchor) })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-anchor`}>Momento</Label>
        <Select value={relative.anchor} onValueChange={(next) => setAnchor(next as ScheduleAnchor)}>
          <SelectTrigger id={`${fieldId}-anchor`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANCHOR_OPTIONS.map((option) => (
              <SelectItem key={option.anchor} value={option.anchor}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {relative.anchor === "START" || relative.anchor === "END" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-offset`}>{relative.anchor === "START" ? "Quantidade (minutos após o início)" : "Antecedência (minutos antes do fim)"}</Label>
          <Input
            id={`${fieldId}-offset`}
            type="number"
            min={0}
            max={1440}
            value={relative.offsetMinutes ?? ""}
            onChange={(event) => {
              const offsetMinutes = event.target.value ? Math.max(0, Number(event.target.value) || 0) : undefined
              onChange({ ...value, relative: { anchor: relative.anchor, offsetMinutes } })
            }}
            className="w-32"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-percentage`}>Percentual da jornada</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${fieldId}-percentage`}
              type="number"
              min={0}
              max={100}
              value={relative.percentage ?? ""}
              onChange={(event) => {
                const percentage = event.target.value ? Math.min(100, Math.max(0, Number(event.target.value) || 0)) : undefined
                onChange({ ...value, relative: { anchor: "PERCENTAGE", percentage } })
              }}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">%</span>
            <div className="flex flex-wrap gap-1">
              {PERCENTAGE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onChange({ ...value, relative: { anchor: "PERCENTAGE", percentage: preset.value } })}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    relative.percentage === preset.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Calculado a partir da jornada PREVISTA de cada colaborador (horário de entrada + carga horária cadastrados) — não é telemetria de login real.
      </p>

      <div className="space-y-1.5">
        <Label>Próximas execuções</Label>
        {!isComplete ? (
          <p className="text-xs text-muted-foreground">Complete a configuração pra ver a prévia.</p>
        ) : previewQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Calculando…</p>
        ) : previewQuery.data?.mode === "RELATIVE_TO_SHIFT" ? (
          <div className="space-y-1">
            {previewQuery.data.examples.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {previewQuery.data.examples.map((example) => (
                  <li key={example.name}>
                    {example.name} — {new Date(example.iso).toLocaleString("pt-BR", { timeStyle: "short" })}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum colaborador com jornada válida no escopo escolhido.</p>
            )}
            <p className="text-xs text-muted-foreground">
              {previewQuery.data.totalEligible} colaborador(es) no escopo
              {previewQuery.data.withoutValidShift > 0 ? ` — ${previewQuery.data.withoutValidShift} sem jornada configurada` : ""}.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma execução encontrada.</p>
        )}
      </div>
    </div>
  )
}

/**
 * Corpo do seletor de gatilho — reaproveitado tanto na criação de workflow
 * (CreateWorkflowDialog) quanto na edição direto no nó Gatilho do canvas. Ao trocar o tipo,
 * os campos abaixo mudam na hora (o valor só é considerado "pronto" — e salvo pelo chamador —
 * quando isTriggerComplete for true).
 */
export function TriggerFields({
  value,
  onChange,
  scope,
}: {
  value: WorkflowTriggerInput
  onChange: (next: WorkflowTriggerInput) => void
  scope?: ScopeInput
}) {
  const flagsQuery = useChannelFlagsQuery()
  const indicatorsQuery = useIndicatorsWithRulesQuery()
  const fieldId = useId()

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Tipo de gatilho</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TRIGGER_KIND_OPTIONS.map((option) => {
            const Icon = option.icon
            const selected = value.kind === option.kind
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => {
                  if (selected) return
                  if (option.kind === "channel_flag") onChange({ kind: "channel_flag", channelFlagId: "" })
                  else if (option.kind === "indicator") onChange({ kind: "indicator", indicatorCode: "" })
                  else if (option.kind === "manual") onChange({ kind: "manual", context: "INTERACTION" })
                  else onChange({ kind: "schedule", mode: "CALENDAR", times: [], intervalDays: 1, frequency: { type: "DAILY" } })
                }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition-colors",
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted",
                )}
              >
                <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
                <span className="text-xs font-medium">{option.label}</span>
                <span className="text-[10px] text-muted-foreground">{option.description}</span>
              </button>
            )
          })}
        </div>
      </div>

      {value.kind === "schedule" ? (
        <ScheduleTriggerFields value={value} onChange={onChange} scope={scope} />
      ) : value.kind === "manual" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Dados de cada execução</Label>
            <Select
              value={value.context}
              onValueChange={(context) => {
                const parsed = manualTriggerContextSchema.parse(context)
                onChange(parsed === "INDICATOR_MEASUREMENT" ? { kind: "manual", context: parsed, indicatorCode: "" } : { kind: "manual", context: parsed })
              }}
            >
              <SelectTrigger className="w-full" aria-label="Dados de cada execução">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {manualTriggerContextSchema.options.map((context) => (
                  <SelectItem key={context} value={context}>
                    {MANUAL_TRIGGER_CONTEXT_LABELS[context]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS[value.context]}</p>
          </div>
          {value.context === "INDICATOR_MEASUREMENT" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-manual-indicator`}>Indicador</Label>
              <Select value={value.indicatorCode ?? ""} onValueChange={(indicatorCode) => onChange({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode })}>
                <SelectTrigger id={`${fieldId}-manual-indicator`} className="w-full">
                  <SelectValue placeholder="Selecione o indicador" />
                </SelectTrigger>
                <SelectContent>
                  {indicatorsQuery.data?.map((indicator) => (
                    <SelectItem key={indicator.code} value={indicator.code}>
                      {indicator.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <p className="rounded-md border border-dashed bg-muted/40 p-2 text-xs text-muted-foreground">
            Só começa quando alguém com permissão clica em <strong>Executar agora</strong> e escolhe um colaborador. Salvar, publicar ou receber dados nunca dispara este workflow.
          </p>
        </div>
      ) : value.kind === "channel_flag" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-flag`}>Flag do canal</Label>
          <Select value={value.channelFlagId} onValueChange={(channelFlagId) => onChange({ kind: "channel_flag", channelFlagId })}>
            <SelectTrigger id={`${fieldId}-flag`} className="w-full">
              <SelectValue placeholder="Selecione a flag" />
            </SelectTrigger>
            <SelectContent>
              {flagsQuery.data?.map((flag) => (
                <SelectItem key={flag.id} value={flag.id}>
                  {flag.channel} · {flag.flagName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-indicator`}>Indicador</Label>
          <Select value={value.indicatorCode} onValueChange={(indicatorCode) => onChange({ kind: "indicator", indicatorCode })}>
            <SelectTrigger id={`${fieldId}-indicator`} className="w-full">
              <SelectValue placeholder="Selecione o indicador" />
            </SelectTrigger>
            <SelectContent>
              {indicatorsQuery.data?.map((indicator) => (
                <SelectItem key={indicator.code} value={indicator.code}>
                  {indicator.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

export function triggerToInput(trigger: WorkflowTrigger): WorkflowTriggerInput {
  if (trigger.kind === "channel_flag") return { kind: "channel_flag", channelFlagId: trigger.channelFlagId }
  if (trigger.kind === "indicator") return { kind: "indicator", indicatorCode: trigger.indicatorCode }
  if (trigger.kind === "manual") return trigger.context === "INDICATOR_MEASUREMENT" ? { kind: "manual", context: trigger.context, indicatorCode: trigger.indicatorCode ?? "" } : { kind: "manual", context: trigger.context }
  return {
    kind: "schedule",
    mode: trigger.mode,
    times: trigger.times,
    intervalDays: trigger.intervalDays,
    frequency: trigger.frequency,
    relative: trigger.relative,
  }
}

const TRIGGER_KIND_LABELS: Record<WorkflowTriggerInput["kind"], string> = {
  channel_flag: "Flag de canal",
  indicator: "Indicador",
  schedule: "Por agenda",
  manual: "Manual",
}

export type TriggerKindImpact = { nodeId: string; message: string }

/**
 * Trocar o TIPO do Gatilho (Agenda↔Flag↔Indicador) é uma mudança ESTRUTURAL (Parte 37 do
 * pedido) — pode invalidar a Estrutura Consolidada/Filtro Populacional já configurados (só
 * fazem sentido pra Agenda) e Conditions em modo "Valor do gatilho" (Agenda não fornece um).
 * Espelha exatamente as mesmas regras já aplicadas no backend (workflow-router.ts:
 * `triggerAllowsConsolidatedMode`/`triggerAllowsPopulationFilter`) e no frontend
 * (`ConditionForm`'s modeSelector) — nunca inventa uma regra nova, só antecipa a mesma
 * validação ANTES de tentar salvar, com uma lista do que precisa mudar em vez de um erro cru.
 */
export function analyzeTriggerKindChangeImpact({
  graph,
  newTrigger,
  consolidatedStructure,
  populationFilter,
}: {
  graph: FlowGraph
  newTrigger: WorkflowTriggerInput
  consolidatedStructure: { kind: string } | null
  populationFilter: { kind: string } | null
}): TriggerKindImpact[] {
  const impacts: TriggerKindImpact[] = []
  const allowsConsolidatedMode = newTrigger.kind === "schedule" && newTrigger.mode !== "RELATIVE_TO_SHIFT"
  const allowsPopulationFilter = newTrigger.kind === "schedule"

  if (consolidatedStructure && !allowsConsolidatedMode) {
    impacts.push({
      nodeId: "",
      message:
        newTrigger.kind !== "schedule"
          ? `A Estrutura Consolidada configurada só é válida para Agenda de calendário${newTrigger.kind === "manual" ? " (o Manual executa para um colaborador por vez)" : ""} — troque o Alvo da avaliação para Individual antes.`
          : "Agendamentos relativos ao expediente são sempre individuais — troque o Alvo da avaliação para Individual antes.",
    })
  }
  if (populationFilter && populationFilter.kind !== "ALL" && !allowsPopulationFilter) {
    impacts.push({
      nodeId: "",
      message: 'O Filtro Populacional configurado só é válido para Agenda — troque o filtro para "Todos os colaboradores elegíveis" antes.',
    })
  }
  // Sem valor de gatilho: Agenda, e Manual fora do contexto "Medição" (o Manual com medição carrega o valor dela).
  const providesTriggerValue = newTrigger.kind === "channel_flag" || newTrigger.kind === "indicator" || (newTrigger.kind === "manual" && triggerDataOrigin(newTrigger) === "indicator")
  if (!providesTriggerValue) {
    for (const node of graph.nodes) {
      if (node.type !== "condition") continue
      const isLegacyTriggerValueMode = !node.config.group && !node.config.historicalQuery && !node.config.performanceQuery && node.config.sourcePath === undefined
      if (isLegacyTriggerValueMode) {
        impacts.push({ nodeId: node.id, message: `O nó "${node.label}" compara o valor do gatilho, mas ${newTrigger.kind === "manual" ? "o gatilho Manual" : "Agenda"} não fornece um — escolha outra origem para essa Condition antes.` })
      }
    }
  }
  return impacts
}

/**
 * Edição do Gatilho como UMA configuração, reaproveitada em DUAS superfícies visuais — o nó
 * Gatilho do canvas e a seção "Gatilho" do Sheet de Configurações (Parte 8/9 do pedido: nunca
 * dois estados independentes `triggerConfigSheet`/`triggerConfigNode`). `trigger` é o do RASCUNHO:
 * tudo o que se salva aqui fica no rascunho e só vale no runtime ao Publicar (incidente de
 * 2026-10-05). Estado local desacoplado do valor salvo: ajustar um campo do MESMO tipo (horário,
 * flag, indicador) reflete e salva no rascunho na hora. Trocar o TIPO em si (Parte 37-40) pausa
 * numa confirmação com análise de impacto — comparando com o tipo que está NA TELA, não com o
 * salvo: depois de confirmar a troca, completar os campos do tipo novo nunca pergunta de novo.
 */
export function TriggerConfigEditor({
  trigger,
  workflowId,
  scope,
  graph,
  consolidatedStructure,
  populationFilter,
}: {
  trigger: WorkflowTrigger
  workflowId: string
  scope?: ScopeInput
  graph: FlowGraph
  consolidatedStructure: { kind: string } | null
  populationFilter: { kind: string } | null
}) {
  const updateTriggerMutation = useUpdateWorkflowTriggerMutation(workflowId)
  const [draft, setDraft] = useState<WorkflowTriggerInput>(() => triggerToInput(trigger))
  const [pendingKindChange, setPendingKindChange] = useState<WorkflowTriggerInput | null>(null)

  // Gatilho salvo mudou: o rascunho recomeça dele (ajuste na renderização, sem render extra). Só quando o CONTEÚDO
  // muda: o refetch devolve outro objeto igual a cada gravação de outra configuração — comparar a referência fazia um
  // tipo novo ainda incompleto voltar ao tipo salvo.
  const savedKey = JSON.stringify(triggerToInput(trigger))
  const [syncedKey, setSyncedKey] = useState(savedKey)
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey)
    setDraft(JSON.parse(savedKey) as WorkflowTriggerInput)
  }

  function handleChange(next: WorkflowTriggerInput) {
    if (next.kind !== draft.kind) {
      setPendingKindChange(next)
      return
    }
    setDraft(next)
    if (isTriggerComplete(next)) updateTriggerMutation.mutate(next)
  }

  function confirmKindChange() {
    if (!pendingKindChange) return
    setDraft(pendingKindChange)
    if (isTriggerComplete(pendingKindChange)) updateTriggerMutation.mutate(pendingKindChange)
    setPendingKindChange(null)
  }

  const impact = pendingKindChange ? analyzeTriggerKindChangeImpact({ graph, newTrigger: pendingKindChange, consolidatedStructure, populationFilter }) : []

  return (
    <>
      <TriggerFields value={draft} onChange={handleChange} scope={scope} />
      <AlertDialog open={pendingKindChange !== null} onOpenChange={(open) => !open && setPendingKindChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar tipo de gatilho</AlertDialogTitle>
            <AlertDialogDescription>
              {TRIGGER_KIND_LABELS[draft.kind]} → {pendingKindChange ? TRIGGER_KIND_LABELS[pendingKindChange.kind] : ""}. Essa alteração muda o contexto do Workflow.
              A troca fica no rascunho: o workflow publicado continua com o gatilho atual até você Publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {impact.length > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-destructive">Itens que precisam de revisão antes de continuar:</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {impact.map((item) => (
                  <li key={item.nodeId || item.message}>{item.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Não encontramos conflito com a configuração atual deste workflow.</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingKindChange(null)}>{impact.length > 0 ? "Entendi, vou revisar" : "Cancelar"}</AlertDialogCancel>
            {impact.length === 0 ? <AlertDialogAction onClick={confirmKindChange}>Confirmar troca</AlertDialogAction> : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
