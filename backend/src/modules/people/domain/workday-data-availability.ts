import { combineSourceAvailability, describeAvailabilityPolicy, resolveSourceAvailability, type AvailabilityPolicy, type SourceAvailabilityState } from "../../data-hub/domain/data-availability.js"
import type { WorkActivityEvidenceSources } from "./work-activity-evidence.js"

/**
 * DISPONIBILIDADE DOS DADOS DE UM DIA DE TRABALHO — "os dados que poderiam explicar este dia já
 * deveriam ter chegado?". É a pergunta que a INIA faz ANTES de concluir qualquer ausência:
 *   1. evidência de atividade (interações; indicadores marcados como prova): cada fonte relevante
 *      precisa ter passado do seu `expectedAvailableAt` (o ÚLTIMO prazo entre elas decide) e ter
 *      entregado de fato — só fontes configuradas como evidência participam (PRV não é esperado);
 *   2. situação funcional (EMPLOYEES / EMPLOYEE_ABSENCES): férias, afastamento, atestado podem ainda
 *      não estar refletidos — RH dentro do SLA = aguardar; RH atrasado = alerta de dado.
 * Resultado (por dia, para a ORGANIZAÇÃO — nunca por pessoa):
 *   READY                — tudo chegou: "sem evidência" é informação;
 *   WAITING_FOR_SOURCES  — algum prazo ainda não venceu (aguardando D-1/D-2 ou RH);
 *   DATA_SOURCE_DELAY    — prazo vencido e a fonte não entregou: problema de DADO (alerta administrativo),
 *                          nunca "fulano sem produção";
 *   AVAILABILITY_UNKNOWN — alguma fonte relevante sem política de disponibilidade: a INIA não assume
 *                          D+1 por padrão e não conclui ausência.
 */
export type WorkdayAvailabilityState = "READY" | "WAITING_FOR_SOURCES" | "DATA_SOURCE_DELAY" | "AVAILABILITY_UNKNOWN"

export const WORKDAY_AVAILABILITY_LABELS: Record<WorkdayAvailabilityState, string> = {
  READY: "Dados fechados",
  WAITING_FOR_SOURCES: "Aguardando dados",
  DATA_SOURCE_DELAY: "Fonte atrasada",
  AVAILABILITY_UNKNOWN: "Disponibilidade não configurada",
}

export type AvailabilitySourceGroup = "WORK_ACTIVITY" | "EMPLOYMENT"

export const AVAILABILITY_SOURCE_GROUP_LABELS: Record<AvailabilitySourceGroup, string> = {
  WORK_ACTIVITY: "Evidência de produção",
  EMPLOYMENT: "Situação funcional (RH)",
}

/** Uma fonte relevante da organização (feed da Central, ou indicador com override), já com metadata de carga. */
export type AvailabilitySourceInput = {
  key: string
  label: string
  group: AvailabilitySourceGroup
  policy: AvailabilityPolicy | null
  lastSuccessAt: Date | null
  lastDataLocalDate: string | null
  /** Só informativo (explica o atraso): FRESH | STALE | NEVER, último erro. */
  freshness: string | null
  lastErrorCode: string | null
}

export type AvailabilitySourceStatus = {
  key: string
  label: string
  group: AvailabilitySourceGroup
  state: SourceAvailabilityState
  policyLabel: string
  expectedAt: string | null
  freshness: string | null
  lastErrorCode: string | null
}

export type WorkdayDataAvailability = {
  date: string
  state: WorkdayAvailabilityState
  /** Qual grupo decidiu o estado quando não está READY (a UI diz "Aguardando D-1" ou "Aguardando RH"). */
  decidedBy: AvailabilitySourceGroup | null
  workActivity: { state: SourceAvailabilityState; configured: boolean; expectedAt: string | null }
  employment: { state: SourceAvailabilityState; configured: boolean; expectedAt: string | null }
  sources: AvailabilitySourceStatus[]
}

export type WorkdayAvailabilityInput = {
  date: string
  now: Date
  timeZone: string
  evidenceSources: WorkActivityEvidenceSources
  /** Fontes relevantes: `WORK_ACTIVITY` (uma por evidência habilitada) e `EMPLOYMENT` (feeds de situação). */
  sources: AvailabilitySourceInput[]
}

function toDayState(state: SourceAvailabilityState): WorkdayAvailabilityState {
  switch (state) {
    case "READY":
      return "READY"
    case "WAITING":
      return "WAITING_FOR_SOURCES"
    case "DELAYED":
      return "DATA_SOURCE_DELAY"
    case "UNKNOWN":
      return "AVAILABILITY_UNKNOWN"
  }
}

function latest(dates: (Date | null)[]): string | null {
  const max = dates.reduce<Date | null>((acc, date) => (date && (!acc || date.getTime() > acc.getTime()) ? date : acc), null)
  return max ? max.toISOString() : null
}

/**
 * Função pura. Grupo de evidência: se a organização tem fontes de evidência habilitadas mas NENHUMA
 * entrada de disponibilidade as cobre, é UNKNOWN (sem feed configurado não há como saber quando o
 * dado chega). Grupo de situação: sem feed de situação configurado = cadastro manual/legado —
 * nada a esperar (READY); com feed sem política = UNKNOWN.
 */
export function resolveWorkdayDataAvailability(input: WorkdayAvailabilityInput): WorkdayDataAvailability {
  const statuses: AvailabilitySourceStatus[] = input.sources.map((source) => {
    const resolved = resolveSourceAvailability({ policy: source.policy, workDate: input.date, now: input.now, timeZone: input.timeZone, lastSuccessAt: source.lastSuccessAt, lastDataLocalDate: source.lastDataLocalDate })
    return { key: source.key, label: source.label, group: source.group, state: resolved.state, policyLabel: describeAvailabilityPolicy(source.policy), expectedAt: resolved.expectedAt?.toISOString() ?? null, freshness: source.freshness, lastErrorCode: source.lastErrorCode }
  })
  const work = statuses.filter((source) => source.group === "WORK_ACTIVITY")
  const employment = statuses.filter((source) => source.group === "EMPLOYMENT")
  const evidenceEnabled = input.evidenceSources.interactions || input.evidenceSources.indicatorCodes.length > 0
  const workState: SourceAvailabilityState = !evidenceEnabled ? "READY" : combineSourceAvailability(work.map((source) => source.state))
  const employmentState: SourceAvailabilityState = employment.length === 0 ? "READY" : combineSourceAvailability(employment.map((source) => source.state))
  const expectedOf = (group: AvailabilitySourceStatus[]) => latest(group.map((source) => (source.expectedAt ? new Date(source.expectedAt) : null)))
  const decidedBy: AvailabilitySourceGroup | null = workState !== "READY" ? "WORK_ACTIVITY" : employmentState !== "READY" ? "EMPLOYMENT" : null
  return {
    date: input.date,
    state: toDayState(decidedBy === "WORK_ACTIVITY" ? workState : decidedBy === "EMPLOYMENT" ? employmentState : "READY"),
    decidedBy,
    workActivity: { state: workState, configured: work.length > 0, expectedAt: expectedOf(work) },
    employment: { state: employmentState, configured: employment.length > 0, expectedAt: expectedOf(employment) },
    sources: statuses,
  }
}
