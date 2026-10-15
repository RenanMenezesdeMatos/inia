import { z } from "zod"
import { flowGraphSchema } from "./workflow-graph.schema"
import { consolidatedStructureSchema } from "./consolidated-structure-schema"
import { populationFilterSchema } from "./population-filter-schema"

export const weekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])
export type Weekday = z.infer<typeof weekdaySchema>

export const WEEKDAY_ORDER: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
export const WEEKDAY_LABELS: Record<Weekday, string> = { MON: "Segunda", TUE: "Terça", WED: "Quarta", THU: "Quinta", FRI: "Sexta", SAT: "Sábado", SUN: "Domingo" }
export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" }

/** Espelho de `scheduleFrequencySchema` no backend (trigger-config-schema.ts) — QUANDO o
 * workflow executa, nunca QUAIS dados analisar (isso é papel da Condition/histórico). Ausente no
 * trigger = comportamento legado (ver `effectiveScheduleFrequency` abaixo). */
export const scheduleFrequencySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DAILY") }),
  z.object({ type: z.literal("EVERY_N_DAYS") }),
  z.object({ type: z.literal("WEEKLY"), weekdays: z.array(weekdaySchema).min(1) }),
  z.object({ type: z.literal("MONTHLY"), mode: z.enum(["DAY_OF_MONTH", "LAST_DAY"]), day: z.number().int().min(1).max(31).optional() }),
])
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>

export const scheduleAnchorSchema = z.enum(["START", "PERCENTAGE", "END"])
export type ScheduleAnchor = z.infer<typeof scheduleAnchorSchema>

/** Espelho de `relativeScheduleSchema` no backend — agendamento relativo ao EXPEDIENTE PREVISTO
 * do colaborador (horário de entrada + carga horária), nunca de telemetria de login real (que
 * não existe hoje). Ver docs/workflow-engine-wiki.md, "expediente previsto x login real". */
export const relativeScheduleSchema = z.object({
  anchor: scheduleAnchorSchema,
  offsetMinutes: z.number().int().min(0).max(1440).optional(),
  percentage: z.number().min(0).max(100).optional(),
})
export type RelativeSchedule = z.infer<typeof relativeScheduleSchema>

/** Espelho de `manualTriggerContextSchema` (backend trigger-config-schema.ts) — QUAL dado real cada disparo manual precisa
 * trazer (é ele que decide o que os nós podem ler): só o colaborador, uma interação dele ou uma medição do indicador. */
export const manualTriggerContextSchema = z.enum(["COLLABORATOR", "INTERACTION", "INDICATOR_MEASUREMENT"])
export type ManualTriggerContext = z.infer<typeof manualTriggerContextSchema>

export const MANUAL_TRIGGER_CONTEXT_LABELS: Record<ManualTriggerContext, string> = {
  COLLABORATOR: "Colaborador",
  INTERACTION: "Interação do colaborador",
  INDICATOR_MEASUREMENT: "Medição de indicador do colaborador",
}

export const MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS: Record<ManualTriggerContext, string> = {
  COLLABORATOR: "Cada execução recebe só o colaborador. Os nós \"Chamar agente\" definem a fonte de dados (indicador ou monitoria no período).",
  INTERACTION: "Cada execução recebe uma interação real do colaborador (com transcrição) — para monitoria e avaliação de processo.",
  INDICATOR_MEASUREMENT: "Cada execução recebe uma medição real do indicador escolhido para o colaborador — para feedback e diagnóstico de indicador.",
}

export const workflowTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("channel_flag"),
    channelFlagId: z.string(),
    channel: z.string(),
    flagName: z.string(),
    valueType: z.enum(["BOOLEAN", "NUMERIC"]),
  }),
  z.object({
    kind: z.literal("indicator"),
    indicatorCode: z.string(),
    indicatorName: z.string(),
    unit: z.string(),
    valueType: z.literal("NUMERIC"),
  }),
  z.object({
    kind: z.literal("schedule"),
    mode: z.enum(["CALENDAR", "RELATIVE_TO_SHIFT"]).optional(),
    times: z.array(z.string()).optional(),
    intervalDays: z.number().int().min(1).catch(1),
    anchorDate: z.string().nullable().optional(),
    frequency: scheduleFrequencySchema.optional(),
    relative: relativeScheduleSchema.optional(),
  }),
  z.object({
    kind: z.literal("manual"),
    context: manualTriggerContextSchema,
    indicatorCode: z.string().optional(),
    indicatorName: z.string().optional(),
    unit: z.string().optional(),
  }),
])
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>

/**
 * ORIGEM DE DADOS da execução — espelho de `triggerDataOriginOf` (backend): o Manual herda a origem do contexto declarado
 * (interação ≈ Flag, medição ≈ Indicador, colaborador ≈ Agenda individual). É a pergunta que o editor e a validação fazem
 * ("esta execução carrega uma interação? uma medição?"), nunca "qual foi o botão".
 */
export type TriggerDataOrigin = "channel_flag" | "indicator" | "schedule"
export function triggerDataOrigin(trigger: { kind: string; context?: string }): TriggerDataOrigin {
  if (trigger.kind === "manual") return trigger.context === "INTERACTION" ? "channel_flag" : trigger.context === "INDICATOR_MEASUREMENT" ? "indicator" : "schedule"
  return trigger.kind === "channel_flag" || trigger.kind === "indicator" ? trigger.kind : "schedule"
}

/** `frequency` ausente no trigger = comportamento legado (workflows criados antes desta
 * evolução): intervalDays > 1 sempre significava "a cada N dias", senão "todo dia". Mesma regra
 * do backend (`effectiveFrequency`, schedule-recurrence.ts). */
function effectiveScheduleFrequency(trigger: Extract<WorkflowTrigger, { kind: "schedule" }>): ScheduleFrequency {
  if (trigger.frequency) return trigger.frequency
  return trigger.intervalDays > 1 ? { type: "EVERY_N_DAYS" } : { type: "DAILY" }
}

function joinWeekdayLabels(weekdays: Weekday[]): string {
  const ordered = WEEKDAY_ORDER.filter((day) => weekdays.includes(day)).map((day) => WEEKDAY_SHORT_LABELS[day])
  if (ordered.length <= 1) return ordered.join("")
  if (ordered.length === 2) return ordered.join(" e ")
  return `${ordered.slice(0, -1).join(", ")} e ${ordered[ordered.length - 1]}`
}

/** Frase amigável do momento relativo ao expediente ("15 min após início do expediente", "50%
 * da jornada", "30 min antes do fim do expediente") — nunca mostra estrutura técnica
 * (anchor/offsetMinutes/percentage crus). Reaproveitada pelo card do Trigger e pelo formulário. */
export function describeRelativeSchedule(relative: RelativeSchedule): string {
  if (relative.anchor === "START") {
    return relative.offsetMinutes !== undefined ? `${relative.offsetMinutes} min após início do expediente` : "Após o início do expediente"
  }
  if (relative.anchor === "END") {
    return relative.offsetMinutes !== undefined ? `${relative.offsetMinutes} min antes do fim do expediente` : "Antes do fim do expediente"
  }
  if (relative.percentage === undefined) return "Percentual da jornada não definido"
  if (relative.percentage === 0) return "Início do expediente"
  if (relative.percentage === 100) return "Fim do expediente"
  return `${relative.percentage}% da jornada`
}

/**
 * ÚNICA função que produz a frase amigável da recorrência da Agenda — reaproveitada por
 * `triggerLabel`, `triggerBadgeText` e o card do Trigger no canvas (node-visuals.ts). Nunca
 * mostra cron técnico nem estrutura interna (Parte 13/39 do pedido de evolução da Agenda).
 */
export function describeScheduleFrequency(trigger: Extract<WorkflowTrigger, { kind: "schedule" }>): string {
  if (trigger.mode === "RELATIVE_TO_SHIFT") {
    return trigger.relative ? describeRelativeSchedule(trigger.relative) : "Momento do expediente não definido"
  }
  const frequency = effectiveScheduleFrequency(trigger)
  const times = trigger.times ?? []
  const timesText = times.length > 0 ? times.join(" · ") : "sem horário definido"
  switch (frequency.type) {
    case "DAILY":
      return `Todos os dias às ${timesText}`
    case "EVERY_N_DAYS":
      return trigger.intervalDays > 1 ? `A cada ${trigger.intervalDays} dias às ${timesText}` : `Todos os dias às ${timesText}`
    case "WEEKLY":
      return `${joinWeekdayLabels(frequency.weekdays)} às ${timesText}`
    case "MONTHLY":
      if (frequency.mode === "LAST_DAY") return `Último dia do mês às ${timesText}`
      return frequency.day !== undefined ? `Todo dia ${frequency.day} às ${timesText}` : `Dia do mês não definido`
  }
}

/** A execução carrega um VALOR de gatilho comparável pela Condition em modo "Valor do gatilho"? Flag e Indicador sim; o
 * Manual só com medição (o valor da medição escolhida); Agenda e Manual por colaborador/interação não. */
export function triggerProvidesValue(trigger: WorkflowTrigger): boolean {
  if (trigger.kind === "channel_flag" || trigger.kind === "indicator") return true
  return trigger.kind === "manual" && trigger.context === "INDICATOR_MEASUREMENT"
}

export function triggerValueIsBoolean(trigger: WorkflowTrigger): boolean {
  return trigger.kind === "channel_flag" && trigger.valueType === "BOOLEAN"
}

/** "Executar agora" · o que cada disparo manual pede ("interação do colaborador", "medição de TMA"…). */
export function describeManualTrigger(trigger: Extract<WorkflowTrigger, { kind: "manual" }>): string {
  if (trigger.context === "INDICATOR_MEASUREMENT") return `Medição de ${trigger.indicatorName ?? trigger.indicatorCode ?? "indicador"} do colaborador`
  return MANUAL_TRIGGER_CONTEXT_LABELS[trigger.context]
}

export function triggerLabel(trigger: WorkflowTrigger): string {
  if (trigger.kind === "channel_flag") return trigger.flagName
  if (trigger.kind === "indicator") return trigger.indicatorName
  if (trigger.kind === "manual") return `Executar agora · ${describeManualTrigger(trigger)}`
  return describeScheduleFrequency(trigger)
}

export function triggerBadgeText(trigger: WorkflowTrigger): string {
  if (trigger.kind === "channel_flag") return `${trigger.channel} · ${trigger.flagName}`
  if (trigger.kind === "indicator") return `Indicador · ${trigger.indicatorName}`
  if (trigger.kind === "manual") return `Manual · ${describeManualTrigger(trigger)}`
  return `Agenda · ${describeScheduleFrequency(trigger)}`
}

/** O que difere entre a configuração do RASCUNHO e a PUBLICADA (backend `configurationChanges`). */
export const workflowConfigurationChangeSchema = z.enum(["TRIGGER", "SCOPE", "ANALYSIS"])
export type WorkflowConfigurationChange = z.infer<typeof workflowConfigurationChangeSchema>
export const WORKFLOW_CONFIGURATION_CHANGE_LABELS: Record<WorkflowConfigurationChange, string> = {
  TRIGGER: "Gatilho",
  SCOPE: "Abrangência",
  ANALYSIS: "Alvo da avaliação / população",
}

/**
 * Configuração do RASCUNHO (Gatilho, Abrangência, Modo de avaliação) — o que o editor edita. Só passa a valer no
 * runtime ao Publicar; até lá os campos de topo do Workflow (`trigger`, `scopeType`…) continuam sendo a configuração
 * PUBLICADA, que é a que o agendador, a ingestão e o "Executar agora" usam (incidente de 2026-10-05).
 */
export const workflowDraftConfigurationSchema = z.object({
  trigger: workflowTriggerSchema,
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  consolidatedStructure: consolidatedStructureSchema.nullable().optional(),
  populationFilter: populationFilterSchema.nullable().optional(),
})
export type WorkflowDraftConfiguration = z.infer<typeof workflowDraftConfigurationSchema>

export const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.coerce.string(),
  published: z.boolean(),
  trigger: workflowTriggerSchema,
  activeEnrollments: z.number(),
  // Modo de avaliação (Individual x Consolidado) — nunca um campo próprio: derivado de
  // consolidatedStructure (presente = Consolidado). populationFilter só é relevante em modo
  // Individual (ausente = todos os colaboradores elegíveis da Abrangência).
  consolidatedStructure: consolidatedStructureSchema.nullable().optional(),
  populationFilter: populationFilterSchema.nullable().optional(),
  draftConfiguration: workflowDraftConfigurationSchema.optional(),
  configurationChanges: z.array(workflowConfigurationChangeSchema).default([]),
})
export type Workflow = z.infer<typeof workflowSchema>

/**
 * O Workflow como o EDITOR o enxerga: a configuração do rascunho no lugar da publicada (grafo, validação, nó Gatilho,
 * Configurações). Quem precisa do que está rodando (Executar agora, listagem) usa o próprio `workflow`.
 */
export function withDraftConfiguration<T extends Workflow>(workflow: T): T {
  const draft = workflow.draftConfiguration
  if (!draft) return workflow
  return {
    ...workflow,
    trigger: draft.trigger,
    scopeType: draft.scopeType,
    teamId: draft.teamId,
    teamName: draft.teamName,
    subteamId: draft.subteamId,
    subteamName: draft.subteamName,
    consolidatedStructure: draft.consolidatedStructure ?? null,
    populationFilter: draft.populationFilter ?? null,
  }
}

/** Impacto de pôr uma configuração no ar — publicar um Workflow ativo ou ativar um publicado (backend go-live-impact.ts). */
export const goLiveImpactSchema = z.object({
  reason: z.enum(["PUBLISH", "ACTIVATE"]),
  triggerKind: z.enum(["channel_flag", "indicator", "schedule", "manual"]),
  goesLive: z.boolean(),
  firstPublication: z.boolean(),
  configurationChanges: z.array(workflowConfigurationChangeSchema),
  schedule: z
    .object({
      mode: z.enum(["CALENDAR", "RELATIVE_TO_SHIFT"]),
      evaluation: z.enum(["INDIVIDUAL", "CONSOLIDATED"]),
      population: z.number(),
      enrollmentsPerOccurrence: z.number(),
      immediate: z.object({ enrollments: z.number(), alreadyEnrolled: z.number(), scheduledFor: z.array(z.string()) }),
      firstFireAt: z.string().nullable(),
      firesImmediately: z.boolean(),
      timezone: z.string(),
    })
    .nullable(),
  requiresConfirmation: z.boolean(),
  reasons: z.array(z.enum(["IMMEDIATE_CATCH_UP", "LARGE_POPULATION"])),
  threshold: z.number(),
  fingerprint: z.string(),
})
export type GoLiveImpact = z.infer<typeof goLiveImpactSchema>

/** Códigos do 409 "confirme o impacto" — a tela trata como diálogo, nunca como toast de erro. */
export const GO_LIVE_CONFIRMATION_CODES = ["WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED", "WORKFLOW_ACTIVATION_CONFIRMATION_REQUIRED"]

/** Impacto que veio no `details` de um 409 de confirmação (null quando o erro é outro). */
export function goLiveImpactFromError(error: unknown): GoLiveImpact | null {
  const candidate = error as { code?: unknown; details?: { impact?: unknown } } | null
  if (!candidate || typeof candidate.code !== "string" || !GO_LIVE_CONFIRMATION_CODES.includes(candidate.code)) return null
  const parsed = goLiveImpactSchema.safeParse(candidate.details?.impact)
  return parsed.success ? parsed.data : null
}

/** Resultado do dry-run de publicação (`POST /admin/workflows/:id/validate`) — a MESMA validação
 * do botão Publicar, sem gravar nada. `error.nodeId` aponta o nó responsável quando a regra é de
 * um nó (destinatário ambíguo/não encontrado, agente inativo…), pra UI navegar até ele. */
export const workflowValidationResultSchema = z.object({
  valid: z.boolean(),
  error: z.object({ code: z.string(), message: z.string(), nodeId: z.string().nullable().optional() }).nullable(),
})
export type WorkflowValidationResult = z.infer<typeof workflowValidationResultSchema>

export const workflowDetailSchema = workflowSchema.extend({
  draftGraph: flowGraphSchema,
  publishedGraph: flowGraphSchema.nullable(),
})
export type WorkflowDetail = z.infer<typeof workflowDetailSchema>

export const workflowEnrollmentEventSchema = z.object({
  nodeId: z.string(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.string(),
})
export type WorkflowEnrollmentEvent = z.infer<typeof workflowEnrollmentEventSchema>

export const workflowEnrollmentSchema = z.object({
  id: z.string(),
  currentNodeId: z.string(),
  /** Origem MANUAL ("Executar agora"): quem executou, para quem — null nas execuções por Flag/Indicador/Agenda. */
  manualRun: z
    .object({ id: z.string(), requestedAt: z.coerce.string(), requestedByName: z.string(), collaboratorName: z.string(), context: manualTriggerContextSchema })
    .nullable()
    .optional(),
  status: z.enum(["active", "waiting", "completed", "failed", "dead"]),
  nextEvalAt: z.coerce.string(),
  createdAt: z.coerce.string(),
  updatedAt: z.coerce.string(),
  events: z.array(workflowEnrollmentEventSchema),
})
export type WorkflowEnrollment = z.infer<typeof workflowEnrollmentSchema>

export const ENROLLMENT_STATUS_LABELS: Record<WorkflowEnrollment["status"], string> = {
  active: "Em andamento",
  waiting: "Aguardando",
  completed: "Concluído",
  failed: "Falhou",
  dead: "Desistiu",
}
