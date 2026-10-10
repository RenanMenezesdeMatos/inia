/**
 * EXCEÇÃO INDIVIDUAL DE CALENDÁRIO — alteração excepcional ao calendário programado de UMA pessoa
 * em UMA data (banco de horas, day off, folga extraordinária, atestado, ajuste de escala). Não
 * confundir com a folga normal do 6x1 (`employee_schedule_days.scheduled_to_work = false`).
 *
 * O motor decide pelo EFEITO (nesta V1 só NON_WORKING); o código explica o porquê e nunca vira
 * `if code === DAY_OFF` espalhado. Texto original da fonte fica em `rawReason`.
 *
 * ATESTADO é só um MOTIVO OPERACIONAL genérico: a INIA nunca armazena diagnóstico, CID, descrição
 * médica ou documento clínico — não é prontuário.
 * AJUSTE_ESCALA é o override operacional registrado pela resolução "Corrigir escala" de uma
 * pendência: a escala de origem (Central) NÃO é adulterada; fica registrado que, naquela data, a
 * pessoa não estava programada de fato.
 */
export const SCHEDULE_EXCEPTION_CODES = ["BANCO_HORAS", "DAY_OFF", "FOLGA_EXTRAORDINARIA", "ATESTADO", "AJUSTE_ESCALA"] as const
export type ScheduleExceptionCode = (typeof SCHEDULE_EXCEPTION_CODES)[number]

export const SCHEDULE_EXCEPTION_LABELS: Record<ScheduleExceptionCode, string> = {
  BANCO_HORAS: "Banco de horas",
  DAY_OFF: "Day off",
  FOLGA_EXTRAORDINARIA: "Folga extraordinária",
  ATESTADO: "Atestado",
  AJUSTE_ESCALA: "Ajuste de escala",
}

/** Motivos que o Supervisor pode PROVISIONAR diretamente (AJUSTE_ESCALA só nasce de "Corrigir escala"). */
export const SUPERVISOR_PROVISIONABLE_CODES = ["DAY_OFF", "BANCO_HORAS", "ATESTADO", "FOLGA_EXTRAORDINARIA"] as const satisfies readonly ScheduleExceptionCode[]

export const SCHEDULE_EXCEPTION_EFFECTS = ["NON_WORKING"] as const
export type ScheduleExceptionEffect = (typeof SCHEDULE_EXCEPTION_EFFECTS)[number]

/** Efeito de cada código — definido pelo catálogo, o cliente não precisa enviar. */
export const SCHEDULE_EXCEPTION_EFFECT_BY_CODE: Record<ScheduleExceptionCode, ScheduleExceptionEffect> = {
  BANCO_HORAS: "NON_WORKING",
  DAY_OFF: "NON_WORKING",
  FOLGA_EXTRAORDINARIA: "NON_WORKING",
  ATESTADO: "NON_WORKING",
  AJUSTE_ESCALA: "NON_WORKING",
}

/**
 * ORIGEM da exceção — quem a registrou (classificação de produto; `source` guarda o namespace do feed).
 *  - CENTRAL_DATA: chegou pela Central de Dados (contrato WORK_SCHEDULE_EXCEPTIONS);
 *  - SUPERVISOR_MANUAL: provisionada/registrada pelo Supervisor no Calendário da equipe ou ao resolver uma pendência;
 *  - SYSTEM_RECONCILIATION: reservado — a INIA NUNCA cria exceção sozinha por ausência de produção (isso vira pendência).
 * Um cliente pode usar só a Central, só o Supervisor ou os dois; conflito entre origens nunca é sobrescrita silenciosa.
 */
export const SCHEDULE_EXCEPTION_ORIGINS = ["CENTRAL_DATA", "SUPERVISOR_MANUAL", "SYSTEM_RECONCILIATION"] as const
export type ScheduleExceptionOrigin = (typeof SCHEDULE_EXCEPTION_ORIGINS)[number]
export const SCHEDULE_EXCEPTION_ORIGIN_LABELS: Record<ScheduleExceptionOrigin, string> = {
  CENTRAL_DATA: "Central de Dados",
  SUPERVISOR_MANUAL: "Registrada pelo Supervisor",
  SYSTEM_RECONCILIATION: "Reconciliação do sistema",
}

export type ScheduleException = {
  date: string
  code: ScheduleExceptionCode
  effect: ScheduleExceptionEffect
  rawReason: string | null
}

/** Texto da fonte → código. Só mapeamentos explícitos (código ou rótulo pt-BR sem acento); o resto é null. */
export function normalizeScheduleExceptionCode(raw: string | null | undefined): ScheduleExceptionCode | null {
  if (raw === null || raw === undefined) return null
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
  if (key === "BANCO_HORAS" || key === "BANCO_DE_HORAS") return "BANCO_HORAS"
  if (key === "DAY_OFF" || key === "DAYOFF") return "DAY_OFF"
  if (key === "FOLGA_EXTRAORDINARIA") return "FOLGA_EXTRAORDINARIA"
  if (key === "ATESTADO" || key === "ATESTADO_MEDICO") return "ATESTADO"
  if (key === "AJUSTE_ESCALA" || key === "AJUSTE_DE_ESCALA") return "AJUSTE_ESCALA"
  return null
}
