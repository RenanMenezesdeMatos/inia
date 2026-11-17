/**
 * ATIVIDADES ESCALADAS — o que a escala prevê para cada horário de um dia de trabalho: o horário em que a pessoa deve estar LOGADA
 * para atendimento, as PAUSAS programadas e OUTRAS atividades (treinamento, feedback, reunião…). Chegam pela Central de Dados
 * (contrato WORK_SCHEDULE_ACTIVITIES, ex.: `MIS_FAT_ATIVIDADE_ESCALADO`); a INIA não gera, não aprova e não infere atividade.
 *
 * O TIPO decide como a atividade aparece; o NOME é o da fonte, preservado como veio ("Pausa NR17", "Lanche"…). O nome da fonte vira
 * tipo pelo "Mapear códigos" do feed — atividade que ninguém classificou vai para a quarentena, nunca vira pausa por palpite.
 */
export const SCHEDULE_ACTIVITY_TYPES = ["LOGGED_IN", "BREAK", "OTHER"] as const
export type ScheduleActivityType = (typeof SCHEDULE_ACTIVITY_TYPES)[number]

export const SCHEDULE_ACTIVITY_TYPE_LABELS: Record<ScheduleActivityType, string> = {
  LOGGED_IN: "Logado para atendimento",
  BREAK: "Pausa programada",
  OTHER: "Outra atividade",
}

/** "LOGADO", "PAUSA", "OUTRA" (e os códigos) → tipo. Só mapeamentos explícitos; nome de atividade da fonte entra por "Mapear códigos". */
export function normalizeScheduleActivityType(raw: string | null | undefined): ScheduleActivityType | null {
  if (raw === null || raw === undefined) return null
  const key = raw.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase().replace(/[\s-]+/g, "_")
  if (key === "LOGGED_IN" || key === "LOGADO" || key === "LOGIN") return "LOGGED_IN"
  if (key === "BREAK" || key === "PAUSA") return "BREAK"
  if (key === "OTHER" || key === "OUTRA" || key === "OUTRA_ATIVIDADE") return "OTHER"
  return null
}
