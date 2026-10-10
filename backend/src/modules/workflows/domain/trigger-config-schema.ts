import { z } from "zod"

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:mm.")

export const weekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])

/**
 * Recorrência da Agenda (evolução do Trigger "Por agenda") — QUANDO o workflow executa, nunca
 * QUAIS dados analisar (isso é papel da Condition/histórico, ver schedule-recurrence.ts). Ausente
 * no trigger_config = comportamento legado (ver `effectiveFrequency` em schedule-recurrence.ts):
 * nunca é obrigatório popular esse campo pra um gatilho por agenda continuar funcionando.
 */
export const scheduleFrequencySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DAILY") }),
  // Usa o `intervalDays` já existente na variante "schedule" (não duplica o campo) — só marca
  // explicitamente que a intenção é "a cada N dias" em vez de "todo dia".
  z.object({ type: z.literal("EVERY_N_DAYS") }),
  z.object({ type: z.literal("WEEKLY"), weekdays: z.array(weekdaySchema).min(1) }),
  // Um único branch MONTHLY (discriminatedUnion exige valores de "type" únicos entre branches —
  // "DAY_OF_MONTH" x "LAST_DAY" viram um sub-campo `mode`, não dois branches de "type" repetido).
  // `day` fica opcional na FORMA (só é semanticamente obrigatório quando mode = DAY_OF_MONTH) —
  // a exigência em si é checada em `validateScheduleTrigger` (workflow-router.ts), com mensagem
  // amigável, no mesmo padrão já usado pro resto das Conditions/Actions deste motor. `day` aceita
  // 1-31 (não só 1-28) — um dia que não existe no mês corrente simplesmente pula aquela
  // ocorrência (ver isDateDue em schedule-recurrence.ts), nunca cai silenciosamente pro dia 30
  // nem escorrega pro mês seguinte. Quem quer "sempre o último dia" usa mode: LAST_DAY.
  z.object({
    type: z.literal("MONTHLY"),
    mode: z.enum(["DAY_OF_MONTH", "LAST_DAY"]),
    day: z.number().int().min(1).max(31).optional(),
  }),
])
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>

export const scheduleAnchorSchema = z.enum(["START", "PERCENTAGE", "END"])

/**
 * Agendamento relativo ao expediente do colaborador (2ª evolução do Trigger "Por agenda") —
 * QUANDO executar em função da jornada PREVISTA dele (horário de entrada + carga horária), nunca
 * de telemetria de login real (que não existe hoje — ver shift-schedule.ts). Um único objeto
 * (não um discriminatedUnion de 3 branches — mesmo motivo do MONTHLY acima: "type"/"anchor"
 * precisa ser único por branch dentro de um discriminatedUnion): `offsetMinutes` e `percentage`
 * ficam opcionais na FORMA, exigidos semanticamente pelo anchor escolhido em
 * `validateScheduleTrigger` (workflow-router.ts).
 */
export const relativeScheduleSchema = z.object({
  anchor: scheduleAnchorSchema,
  // START: minutos depois do início do expediente. END: minutos antes do fim.
  offsetMinutes: z.number().int().min(0).max(1440).optional(),
  // PERCENTAGE: 0 = início do expediente, 100 = fim. 0 e 100 são aceitos de propósito (Parte 8
  // do pedido) — cobrem "início"/"fim" com a mesma regra genérica, sem precisar de outro anchor.
  percentage: z.number().min(0).max(100).optional(),
})
export type RelativeSchedule = z.infer<typeof relativeScheduleSchema>

/**
 * Gatilho MANUAL — o Workflow só começa quando alguém com permissão clica "Executar agora" e escolhe UM colaborador
 * (nunca a população inteira). `context` declara QUAL dado real cada disparo precisa trazer, porque é ele que decide o
 * que os nós podem ler (a mesma matriz dos outros gatilhos, ver `triggerDataOriginOf`):
 *   COLLABORATOR           → só o colaborador (como uma Agenda individual: cada "Chamar agente" define a fonte de dados);
 *   INTERACTION            → uma interação EXISTENTE do colaborador (como a Flag: transcrição, monitoria, avaliação de processo);
 *   INDICATOR_MEASUREMENT  → uma medição EXISTENTE do indicador `indicatorCode` do colaborador (como o gatilho por Indicador).
 * Nada é fabricado: sem interação/medição real, não há disparo. Salvar, publicar, reiniciar ou ingerir dados nunca dispara.
 */
export const manualTriggerContextSchema = z.enum(["COLLABORATOR", "INTERACTION", "INDICATOR_MEASUREMENT"])
export type ManualTriggerContext = z.infer<typeof manualTriggerContextSchema>

export const triggerConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("channel_flag"), channelFlagId: z.string().uuid() }),
  z.object({ kind: z.literal("indicator"), indicatorCode: z.string().trim().min(1) }),
  z.object({
    kind: z.literal("schedule"),
    // Ausente = legado = CALENDAR (toda Agenda existente antes desta evolução era de calendário).
    mode: z.enum(["CALENDAR", "RELATIVE_TO_SHIFT"]).optional(),
    // Só semanticamente obrigatório quando mode é CALENDAR (ou ausente) — checado em
    // `validateScheduleTrigger`, não aqui, mesmo padrão já usado pro `day` do MONTHLY.
    times: z.array(timeOfDaySchema).min(1).max(12).optional(),
    // A cada quantos dias dispara (1 = todo dia, comportamento padrão). Só é de fato consultado
    // quando frequency está ausente (legado) ou é EVERY_N_DAYS — DAILY/WEEKLY/MONTHLY ignoram
    // este campo. A contagem começa em `anchorDate` (data de criação do workflow) — o front nunca
    // envia esse campo, o backend preenche na criação e ele fica estável mesmo que
    // times/intervalDays sejam editados depois.
    intervalDays: z.number().int().min(1).max(90).default(1),
    anchorDate: z.iso.date().optional(),
    // Ausente = legado (ver `effectiveFrequency`): intervalDays > 1 vira EVERY_N_DAYS, senão DAILY.
    // Só relevante quando mode é CALENDAR (ou ausente).
    frequency: scheduleFrequencySchema.optional(),
    // Só relevante (e semanticamente obrigatório) quando mode é RELATIVE_TO_SHIFT.
    relative: relativeScheduleSchema.optional(),
  }),
  z.object({
    kind: z.literal("manual"),
    context: manualTriggerContextSchema,
    // Só semanticamente obrigatório quando context = INDICATOR_MEASUREMENT — checado em `validateManualTrigger`
    // (mesmo padrão do `day` do MONTHLY: forma aqui, regra com mensagem amigável na validação).
    indicatorCode: z.string().trim().min(1).optional(),
  }),
])
export type TriggerConfig = z.infer<typeof triggerConfigSchema>
export type ManualTrigger = Extract<TriggerConfig, { kind: "manual" }>

/**
 * ORIGEM DE DADOS de uma execução — o que a matrícula carrega e, portanto, o que cada nó pode ler. Os três gatilhos por
 * evento/agenda são a própria origem; o Manual herda a origem do contexto que declara (interação ≈ Flag, medição ≈
 * Indicador, colaborador ≈ Agenda individual). É ESTA a pergunta que a validação de publicação e o domínio do feedback
 * fazem ("existe uma interação? uma medição?") — nunca "qual foi o botão", que continua identificável pela origem manual
 * gravada no disparo (`workflow_manual_runs`).
 */
export type TriggerDataOrigin = "channel_flag" | "indicator" | "schedule"
export function triggerDataOriginOf(trigger: TriggerConfig): TriggerDataOrigin {
  if (trigger.kind !== "manual") return trigger.kind
  if (trigger.context === "INTERACTION") return "channel_flag"
  if (trigger.context === "INDICATOR_MEASUREMENT") return "indicator"
  return "schedule"
}

/** Indicador da medição que dispara (gatilho por Indicador ou Manual com medição) — null nos demais. */
export function triggerIndicatorCodeOf(trigger: TriggerConfig): string | null {
  if (trigger.kind === "indicator") return trigger.indicatorCode
  if (trigger.kind === "manual" && trigger.context === "INDICATOR_MEASUREMENT") return trigger.indicatorCode ?? null
  return null
}

export const MANUAL_TRIGGER_CONTEXT_LABELS: Record<ManualTriggerContext, string> = {
  COLLABORATOR: "Colaborador",
  INTERACTION: "Interação do colaborador",
  INDICATOR_MEASUREMENT: "Medição de indicador do colaborador",
}
