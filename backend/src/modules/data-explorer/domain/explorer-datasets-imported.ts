import { SENSITIVE_LEAVE_STATUSES } from "../../org-structure/domain/management-metrics.js"
import { EMPLOYMENT_STATUS_LABELS, LEGACY_EMPLOYMENT_STATUS_MAP, type EmploymentStatus } from "../../people/domain/employment-status.js"
import { SCHEDULE_EXCEPTION_CODES, type ScheduleExceptionCode } from "../../people/domain/schedule-exception.js"
import type { ExplorerColumn, ExplorerDataset } from "./explorer-catalog-types.js"

/**
 * CONJUNTOS IMPORTADOS APROVADOS. Regras da lista:
 *  - nome da pessoa só em Colaboradores; nos demais, a matrícula (minimização: é a chave que as próprias cargas usam);
 *  - afastamento sensível (INSS, maternidade, paternidade) e atestado saem mascarados na expressão, então a máscara vale para exibir, filtrar,
 *    buscar e exportar (a regra de `leaveTypeVisible`: fora da cadeia de gestão, o tipo do afastamento não aparece);
 *  - texto bruto da fonte (situação bruta, motivo da exceção, conteúdo da transcrição) e referências internas ficam fora;
 *  - nenhuma coluna de conta, e-mail, foto, perfil pessoal ou custódia.
 */
export const RECORD_STATUS_COLUMN = "record_status"

/** Vale em todo conjunto cancelável. A situação fica nos registros ativos e cancelados; o motivo foi escrito à mão e entra como dado pessoal na auditoria. */
const CANCELLATION_JOIN = "left join data_record_cancellations dc on dc.id = t.cancellation_id and dc.organization_id = t.organization_id"
const recordStatusColumn: ExplorerColumn = {
  key: RECORD_STATUS_COLUMN,
  label: "Situação do registro",
  description: "Cancelado continua guardado, mas não entra em nenhum cálculo.",
  type: "ENUM",
  sql: "(case when t.cancelled_at is null then 'ACTIVE' else 'CANCELLED' end)",
  nullable: false,
  options: [
    { value: "ACTIVE", label: "Ativo" },
    { value: "CANCELLED", label: "Cancelado" },
  ],
}
const cancellationDetailColumns: ExplorerColumn[] = [
  { key: "cancelled_at", label: "Cancelado em", type: "DATETIME", sql: "t.cancelled_at", nullable: true, filterable: true, hiddenByDefault: true },
  { key: "cancel_reason", label: "Motivo do cancelamento", type: "TEXT", sql: "dc.reason", nullable: true, personal: true, hiddenByDefault: true },
]

export const PROTECTED_LEAVE = "AFASTAMENTO_PROTEGIDO"
export const PROTECTED_REASON = "MOTIVO_PROTEGIDO"

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ")

/** Situação funcional canônica, com afastamento sensível mascarado. Construída só com constantes do domínio. */
export function maskedEmploymentStatusSql(column: string): string {
  const legacy = Object.entries(LEGACY_EMPLOYMENT_STATUS_MAP).map(([code, canonical]) => `when '${code}' then '${canonical}'`).join(" ")
  const canonical = `(case ${column} ${legacy} else ${column} end)`
  return `(case when ${canonical} in (${quoted(SENSITIVE_LEAVE_STATUSES)}) then '${PROTECTED_LEAVE}' else ${canonical} end)`
}

const VISIBLE_STATUSES = (Object.keys(EMPLOYMENT_STATUS_LABELS) as EmploymentStatus[]).filter((status) => !(SENSITIVE_LEAVE_STATUSES as readonly string[]).includes(status))
const EMPLOYMENT_STATUS_OPTIONS = [...VISIBLE_STATUSES.map((status) => ({ value: status, label: EMPLOYMENT_STATUS_LABELS[status] })), { value: PROTECTED_LEAVE, label: "AFASTAMENTO (protegido)" }]

const EXCEPTION_LABELS: Record<ScheduleExceptionCode, string> = {
  BANCO_HORAS: "Banco de horas",
  DAY_OFF: "Day off",
  FOLGA_EXTRAORDINARIA: "Folga extraordinária",
  ATESTADO: "Atestado",
  AJUSTE_ESCALA: "Ajuste de escala",
}
const EXCEPTION_OPTIONS = [...SCHEDULE_EXCEPTION_CODES.filter((code) => code !== "ATESTADO").map((code) => ({ value: code, label: EXCEPTION_LABELS[code] })), { value: PROTECTED_REASON, label: "Motivo protegido" }]

const LEVEL_OPTIONS = [
  { value: "OPERATOR", label: "Operador" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "COORDINATOR", label: "Coordenador" },
  { value: "MANAGER", label: "Gerente" },
  { value: "SENIOR_MANAGER", label: "Gerente sênior" },
  { value: "DIRECTOR", label: "Diretor" },
  { value: "ADMIN", label: "Fora da hierarquia" },
]
const QUARTILE_OPTIONS = ["Q1", "Q2", "Q3", "Q4"].map((value) => ({ value, label: value }))
const GRANULARITY_OPTIONS = [
  { value: "DAILY", label: "Diária" },
  { value: "MONTHLY", label: "Mensal" },
  { value: "HOURLY", label: "Por hora" },
  { value: "INTERACTION", label: "Por interação" },
  { value: "CUSTOM", label: "Período próprio" },
]
const SUBJECT_TYPE_OPTIONS = [
  { value: "PERSON", label: "Pessoa" },
  { value: "TEAM", label: "Grupo" },
  { value: "OPERATION", label: "Operação" },
  { value: "ORGANIZATION", label: "Organização" },
]
const GOAL_SUBJECT_OPTIONS = [
  { value: "PERSON", label: "Pessoa" },
  { value: "TEAM", label: "Grupo" },
  { value: "SUBTEAM", label: "Subgrupo" },
]

const person = (alias: string, column: string) => `left join people ${alias} on ${alias}.id = t.${column} and ${alias}.organization_id = t.organization_id`
const team = (alias: string, column: string) => `left join teams ${alias} on ${alias}.id = t.${column} and ${alias}.organization_id = t.organization_id`
const subteam = (alias: string, column: string) => `left join subteams ${alias} on ${alias}.id = t.${column} and ${alias}.organization_id = t.organization_id`
const indicator = `left join indicator_definitions_all d on d.id = t.indicator_definition_id and d.organization_id = t.organization_id`

const matricula = (key: string, label: string, sql: string, extra: Partial<ExplorerColumn> = {}): ExplorerColumn => ({ key, label, type: "TEXT", sql, nullable: true, personal: true, filterable: true, search: "EXACT", ...extra })
const indicatorCode: ExplorerColumn = { key: "indicator", label: "Indicador", type: "TEXT", sql: "d.code", nullable: true, filterable: true, search: "EXACT" }
const createdAt = (hiddenByDefault = true): ExplorerColumn => ({ key: "created_at", label: "Registrado em", type: "DATETIME", sql: "t.created_at", nullable: false, filterable: true, hiddenByDefault })
const number = (key: string, label: string, sql: string, nullable = true, extra: Partial<ExplorerColumn> = {}): ExplorerColumn => ({ key, label, type: "NUMBER", sql, nullable, filterable: true, ...extra })

export const IMPORTED_DATASETS: readonly ExplorerDataset[] = [
  {
    code: "collaborators",
    label: "Colaboradores",
    description: "Cadastro de pessoas vindo das cargas de Colaboradores e Estrutura. Sem conta de acesso, e-mail, foto ou dados pessoais do perfil.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `people t ${team("tm", "team_id")} ${subteam("st", "subteam_id")} ${person("mgr", "reports_to_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "name", direction: "ASC" },
    columns: [
      matricula("matricula", "Matrícula", "t.matricula", { sortable: true }),
      { key: "name", label: "Nome", type: "TEXT", sql: "t.name", nullable: false, personal: true, filterable: true, sortable: true, search: "CONTAINS" },
      { key: "level", label: "Nível hierárquico", type: "ENUM", sql: "t.role", nullable: false, filterable: true, sortable: true, options: LEVEL_OPTIONS },
      { key: "job_title", label: "Cargo", type: "TEXT", sql: "t.job_title", nullable: true, filterable: true, sortable: true, search: "CONTAINS" },
      { key: "group", label: "Grupo", type: "TEXT", sql: "tm.name", nullable: true, filterable: true, sortable: true },
      { key: "subgroup", label: "Subgrupo", type: "TEXT", sql: "st.name", nullable: true, filterable: true, sortable: true },
      matricula("manager_matricula", "Matrícula do gestor", "mgr.matricula"),
      { key: "employment_status", label: "Situação funcional", description: "Afastamentos sensíveis aparecem como protegidos.", type: "ENUM", sql: maskedEmploymentStatusSql("t.current_employment_status"), nullable: false, personal: true, filterable: true, sortable: true, options: EMPLOYMENT_STATUS_OPTIONS },
      { key: "active", label: "Ativo", type: "BOOLEAN", sql: "t.active", nullable: false, filterable: true, sortable: true },
      { key: "hired_at", label: "Admissão", type: "DATE", sql: "t.hired_at", nullable: true, personal: true, filterable: true, sortable: true, hiddenByDefault: true },
      { key: "operational_capital", label: "Capital operacional", type: "TEXT", sql: "t.operational_capital_code", nullable: true, filterable: true, hiddenByDefault: true },
      createdAt(),
    ],
  },
  {
    code: "groups",
    label: "Grupos",
    description: "Grupos da estrutura organizacional.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `teams t left join operations op on op.id = t.operation_id and op.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "name", direction: "ASC" },
    columns: [
      { key: "name", label: "Grupo", type: "TEXT", sql: "t.name", nullable: false, filterable: true, sortable: true, search: "CONTAINS" },
      { key: "external_code", label: "Código externo", type: "TEXT", sql: "t.external_code", nullable: true, filterable: true, sortable: true, search: "EXACT" },
      { key: "operation", label: "Operação", type: "TEXT", sql: "op.name", nullable: true, filterable: true, sortable: true },
      createdAt(false),
    ],
  },
  {
    code: "subgroups",
    label: "Subgrupos",
    description: "Subgrupos da estrutura organizacional.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `subteams t ${team("tm", "team_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "name", direction: "ASC" },
    columns: [
      { key: "name", label: "Subgrupo", type: "TEXT", sql: "t.name", nullable: false, filterable: true, sortable: true, search: "CONTAINS" },
      { key: "group", label: "Grupo", type: "TEXT", sql: "tm.name", nullable: true, filterable: true, sortable: true, search: "CONTAINS" },
      { key: "external_code", label: "Código externo", type: "TEXT", sql: "t.external_code", nullable: true, filterable: true, sortable: true, search: "EXACT" },
      createdAt(false),
    ],
  },
  {
    code: "interactions",
    label: "Interações",
    description: "Atendimentos importados. O conteúdo das conversas não faz parte deste conjunto.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `interactions t ${person("op", "operator_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "started_at", direction: "DESC" },
    columns: [
      { key: "protocol", label: "Protocolo", type: "TEXT", sql: "t.external_id", nullable: false, filterable: true, sortable: true, search: "EXACT" },
      matricula("operator_matricula", "Matrícula do operador", "op.matricula"),
      { key: "started_at", label: "Início", type: "DATETIME", sql: "t.started_at", nullable: false, filterable: true, sortable: true },
      { key: "ended_at", label: "Fim", type: "DATETIME", sql: "t.ended_at", nullable: false, filterable: true },
      { key: "reason", label: "Motivo", type: "TEXT", sql: "t.reason", nullable: false, filterable: true, search: "EXACT" },
      { key: "sub_reason", label: "Submotivo", type: "TEXT", sql: "t.sub_reason", nullable: true, filterable: true, search: "EXACT" },
      { key: "channel", label: "Canal", type: "TEXT", sql: "t.channel", nullable: false, filterable: true },
      createdAt(),
    ],
  },
  {
    code: "transcripts",
    label: "Transcrições (somente dados da carga)",
    description: "Mostra se a transcrição chegou, com versão e tamanho. O texto da conversa nunca aparece: ele tem dados pessoais de clientes.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `transcripts t left join interactions i on i.id = t.interaction_id and i.organization_id = t.organization_id left join people op on op.id = i.operator_id and op.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "created_at", direction: "DESC" },
    columns: [
      { key: "protocol", label: "Protocolo", type: "TEXT", sql: "i.external_id", nullable: true, filterable: true, search: "EXACT" },
      matricula("operator_matricula", "Matrícula do operador", "op.matricula"),
      number("version", "Versão", "t.version", false),
      { key: "language", label: "Idioma", type: "TEXT", sql: "t.language", nullable: false, filterable: true },
      number("confidence", "Confiança", "t.confidence"),
      { key: "characters", label: "Tamanho (caracteres)", type: "NUMBER", sql: "char_length(t.content)", nullable: false },
      { key: "created_at", label: "Registrado em", type: "DATETIME", sql: "t.created_at", nullable: false, filterable: true, sortable: true },
    ],
  },
  {
    code: "interaction_flags",
    label: "Flags das interações",
    description: "Flags calculadas pela origem e recebidas junto com cada interação.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `interaction_flags t left join interactions i on i.id = t.interaction_id and i.organization_id = t.organization_id left join channel_flags_all f on f.id = t.channel_flag_id and f.organization_id = t.organization_id`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "received_at", direction: "DESC" },
    columns: [
      { key: "protocol", label: "Protocolo", type: "TEXT", sql: "i.external_id", nullable: true, filterable: true, search: "EXACT" },
      { key: "flag", label: "Flag", type: "TEXT", sql: "f.flag_name", nullable: true, filterable: true, search: "EXACT" },
      { key: "channel", label: "Canal", type: "TEXT", sql: "f.channel", nullable: true, filterable: true },
      { key: "value_boolean", label: "Valor (sim/não)", type: "BOOLEAN", sql: "t.value_boolean", nullable: true, filterable: true },
      number("value_numeric", "Valor (número)", "t.value_numeric"),
      { key: "received_at", label: "Recebida em", type: "DATETIME", sql: "t.received_at", nullable: false, filterable: true, sortable: true },
    ],
  },
  {
    code: "indicator_measurements",
    label: "Medições de indicador",
    description: "Medições operacionais importadas, diárias ou por período. Conjunto grande: filtre por indicador, matrícula ou período.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `indicator_measurements_all t ${indicator} left join people p on t.subject_type = 'PERSON' and p.id = t.subject_id and p.organization_id = t.organization_id ${CANCELLATION_JOIN}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "period_start", direction: "DESC" },
    cancellation: { table: "indicator_measurements_all", contractKey: "INDICATOR_MEASUREMENTS", rule: "MEASUREMENT", tracksExecutions: true, evidenceSourceTypes: ["indicator_measurement", "indicator_period_summary"], ownerSql: "r.subject_type = 'PERSON' and r.subject_id = $1::uuid", affectsOfficialResult: false },
    columns: [
      recordStatusColumn,
      indicatorCode,
      { key: "subject_type", label: "Medido", type: "ENUM", sql: "t.subject_type", nullable: false, filterable: true, options: SUBJECT_TYPE_OPTIONS, hiddenByDefault: true },
      matricula("subject_matricula", "Matrícula", "p.matricula"),
      { key: "period_start", label: "Início do período", type: "DATETIME", sql: "t.period_start", nullable: false, filterable: true, sortable: true },
      { key: "period_end", label: "Fim do período", type: "DATETIME", sql: "t.period_end", nullable: false, filterable: true, hiddenByDefault: true },
      { key: "granularity", label: "Granularidade", type: "ENUM", sql: "t.granularity", nullable: false, filterable: true, options: GRANULARITY_OPTIONS },
      number("value", "Valor", "t.value", false),
      number("numerator", "Numerador", "t.numerator"),
      number("denominator", "Denominador", "t.denominator"),
      number("sample_count", "Amostra", "t.sample_count"),
      { key: "source", label: "Origem", type: "TEXT", sql: "t.source", nullable: false, filterable: true, hiddenByDefault: true },
      createdAt(),
      ...cancellationDetailColumns,
    ],
  },
  {
    code: "official_closures",
    label: "Fechamento oficial por indicador",
    description: "Resultado mensal oficial por pessoa e indicador, como a fonte enviou.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `employee_indicator_performance_all t ${indicator} ${person("p", "person_id")} ${subteam("st", "subteam_id")} ${CANCELLATION_JOIN}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "reference_period", direction: "DESC" },
    cancellation: { table: "employee_indicator_performance_all", contractKey: "OFFICIAL_INDICATOR_PERFORMANCE", rule: "OFFICIAL_CLOSURE", tracksExecutions: false, evidenceSourceTypes: ["employee_indicator_performance", "employee_performance"], ownerSql: "r.person_id = $1::uuid", affectsOfficialResult: true },
    columns: [
      recordStatusColumn,
      { key: "reference_period", label: "Competência", type: "MONTH", sql: "t.reference_period", nullable: false, filterable: true, sortable: true },
      indicatorCode,
      matricula("matricula", "Matrícula", "p.matricula"),
      { key: "subgroup", label: "Subgrupo", type: "TEXT", sql: "st.name", nullable: true, filterable: true },
      number("value", "Valor", "t.value", false),
      number("target_value", "Meta", "t.target_value"),
      number("achievement_percent", "Atingimento (%)", "t.achievement_percent"),
      number("weight_percent", "Peso (%)", "t.weight_percent"),
      { key: "quartile", label: "Quartil", type: "ENUM", sql: "t.quartile", nullable: true, filterable: true, options: QUARTILE_OPTIONS },
      number("numerator", "Numerador", "t.numerator", true, { hiddenByDefault: true }),
      number("denominator", "Denominador", "t.denominator", true, { hiddenByDefault: true }),
      { key: "source", label: "Origem", type: "TEXT", sql: "t.source", nullable: false, filterable: true, hiddenByDefault: true },
      createdAt(),
      ...cancellationDetailColumns,
    ],
  },
  {
    code: "prv_closures",
    label: "Fechamento oficial de PRV",
    description: "Atingimento consolidado mensal por pessoa, como a fonte enviou.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `employee_prv_performance_all t ${person("p", "person_id")} ${subteam("st", "subteam_id")} ${CANCELLATION_JOIN}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "reference_period", direction: "DESC" },
    cancellation: { table: "employee_prv_performance_all", contractKey: "PRV_PERFORMANCE", rule: "NONE", tracksExecutions: false, evidenceSourceTypes: ["employee_performance"], ownerSql: "r.person_id = $1::uuid", affectsOfficialResult: true },
    columns: [
      recordStatusColumn,
      { key: "reference_period", label: "Competência", type: "MONTH", sql: "t.reference_period", nullable: false, filterable: true, sortable: true },
      matricula("matricula", "Matrícula", "p.matricula"),
      { key: "subgroup", label: "Subgrupo", type: "TEXT", sql: "st.name", nullable: true, filterable: true },
      number("achievement_percent", "Atingimento (%)", "t.achievement_percent", false),
      { key: "quartile", label: "Quartil", type: "ENUM", sql: "t.quartile", nullable: false, filterable: true, options: QUARTILE_OPTIONS },
      { key: "source", label: "Origem", type: "TEXT", sql: "t.source", nullable: false, filterable: true, hiddenByDefault: true },
      createdAt(),
      ...cancellationDetailColumns,
    ],
  },
  {
    code: "goals",
    label: "Metas",
    description: "Metas por indicador e alvo (pessoa, Grupo ou Subgrupo), com vigência.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `goals_all t ${indicator} left join people p on t.subject_type = 'PERSON' and p.id = t.subject_id and p.organization_id = t.organization_id left join teams tm on t.subject_type = 'TEAM' and tm.id = t.subject_id and tm.organization_id = t.organization_id left join subteams st on t.subject_type = 'SUBTEAM' and st.id = t.subject_id and st.organization_id = t.organization_id ${CANCELLATION_JOIN}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "valid_from", direction: "DESC" },
    cancellation: { table: "goals_all", contractKey: "GOALS", rule: "GOAL", tracksExecutions: false, evidenceSourceTypes: [], ownerSql: "r.subject_type = 'PERSON' and r.subject_id = $1::uuid", affectsOfficialResult: false },
    columns: [
      recordStatusColumn,
      { ...indicatorCode, sortable: true },
      { key: "subject_type", label: "Tipo de alvo", type: "ENUM", sql: "t.subject_type", nullable: false, filterable: true, options: GOAL_SUBJECT_OPTIONS },
      { key: "subject", label: "Alvo", description: "Matrícula, Grupo ou Subgrupo.", type: "TEXT", sql: "coalesce(p.matricula, tm.name, st.name)", nullable: true, personal: true, filterable: true, search: "EXACT" },
      number("target_value", "Meta", "t.target_value", false),
      { key: "valid_from", label: "Início da vigência", type: "DATE", sql: "t.valid_from", nullable: false, filterable: true, sortable: true },
      { key: "valid_until", label: "Fim da vigência", type: "DATE", sql: "t.valid_until", nullable: true, filterable: true, sortable: true },
      createdAt(),
      ...cancellationDetailColumns,
    ],
  },
  {
    code: "work_shifts",
    label: "Jornadas",
    description: "Jornada prevista por pessoa, com vigência.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `employee_work_shifts t ${person("p", "person_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "effective_from", direction: "DESC" },
    columns: [
      matricula("matricula", "Matrícula", "p.matricula", { sortable: true }),
      { key: "start_time", label: "Entrada", type: "TIME", sql: "t.start_time", nullable: false, filterable: true },
      number("work_minutes", "Minutos de trabalho", "t.work_minutes", false),
      { key: "schedule_type", label: "Regime", type: "TEXT", sql: "t.schedule_type", nullable: true, filterable: true },
      { key: "effective_from", label: "Início da vigência", type: "DATE", sql: "t.effective_from", nullable: false, filterable: true, sortable: true },
      { key: "effective_to", label: "Fim da vigência", type: "DATE", sql: "t.effective_to", nullable: true, filterable: true },
      createdAt(),
    ],
  },
  {
    code: "schedule_days",
    label: "Escalas de trabalho",
    description: "Calendário por pessoa e dia, como a fonte enviou.",
    origin: "IMPORTED",
    volume: "LARGE",
    from: `employee_schedule_days t ${person("p", "person_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "schedule_date", direction: "DESC" },
    columns: [
      { key: "schedule_date", label: "Dia", type: "DATE", sql: "t.schedule_date", nullable: false, filterable: true, sortable: true },
      matricula("matricula", "Matrícula", "p.matricula"),
      { key: "scheduled_to_work", label: "Escalado", type: "BOOLEAN", sql: "t.scheduled_to_work", nullable: false, filterable: true },
      { key: "shift_start", label: "Entrada", type: "TIME", sql: "t.shift_start", nullable: true, filterable: true },
      { key: "shift_end", label: "Saída", type: "TIME", sql: "t.shift_end", nullable: true, filterable: true },
      { key: "schedule_type", label: "Regime", type: "TEXT", sql: "t.schedule_type", nullable: true, filterable: true },
      { key: "source", label: "Origem", type: "TEXT", sql: "t.source", nullable: false, filterable: true, hiddenByDefault: true },
      { key: "updated_at", label: "Atualizado em", type: "DATETIME", sql: "t.updated_at", nullable: false, filterable: true, hiddenByDefault: true },
    ],
  },
  {
    code: "schedule_exceptions",
    label: "Exceções de escala",
    description: "Day off, banco de horas e outras exceções. Atestado aparece como motivo protegido; o texto bruto do motivo não aparece.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `employee_schedule_exceptions t ${person("p", "person_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "exception_date", direction: "DESC" },
    columns: [
      { key: "exception_date", label: "Dia", type: "DATE", sql: "t.exception_date", nullable: false, filterable: true, sortable: true },
      matricula("matricula", "Matrícula", "p.matricula"),
      { key: "code", label: "Tipo", type: "ENUM", sql: `(case when t.code = 'ATESTADO' then '${PROTECTED_REASON}' else t.code end)`, nullable: false, personal: true, filterable: true, options: EXCEPTION_OPTIONS },
      { key: "active", label: "Vigente", type: "BOOLEAN", sql: "t.active", nullable: false, filterable: true },
      { key: "origin", label: "Registrada por", type: "ENUM", sql: "t.origin", nullable: false, filterable: true, options: [{ value: "CENTRAL_DATA", label: "Central de Dados" }, { value: "SUPERVISOR_MANUAL", label: "Supervisor" }, { value: "SYSTEM_RECONCILIATION", label: "Reconciliação" }] },
      { key: "source", label: "Origem", type: "TEXT", sql: "t.source", nullable: false, filterable: true, hiddenByDefault: true },
      { key: "cancelled_at", label: "Cancelada em", type: "DATETIME", sql: "t.cancelled_at", nullable: true, filterable: true, hiddenByDefault: true },
      createdAt(),
    ],
  },
  {
    code: "status_periods",
    label: "Situação funcional por período",
    description: "Linha do tempo da situação funcional. Afastamentos sensíveis aparecem como protegidos; o texto bruto da fonte não aparece.",
    origin: "IMPORTED",
    volume: "SMALL",
    from: `employee_status_periods t ${person("p", "person_id")}`,
    key: { sql: "t.id", cast: "uuid" },
    defaultSort: { column: "effective_from", direction: "DESC" },
    columns: [
      matricula("matricula", "Matrícula", "p.matricula"),
      { key: "status", label: "Situação", type: "ENUM", sql: maskedEmploymentStatusSql("t.status"), nullable: false, personal: true, filterable: true, options: EMPLOYMENT_STATUS_OPTIONS },
      { key: "effective_from", label: "Início", type: "DATE", sql: "t.effective_from", nullable: false, filterable: true, sortable: true },
      { key: "effective_to", label: "Fim", type: "DATE", sql: "t.effective_to", nullable: true, filterable: true },
      { key: "authoritative", label: "Fonte autoritativa", type: "BOOLEAN", sql: "t.authoritative", nullable: false, filterable: true },
      { key: "source", label: "Origem", type: "TEXT", sql: "t.source", nullable: false, filterable: true, hiddenByDefault: true },
      { key: "observed_at", label: "Observada em", type: "DATETIME", sql: "t.observed_at", nullable: false, filterable: true, hiddenByDefault: true },
    ],
  },
]
