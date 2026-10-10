import { BRAZILIAN_CAPITALS, capitalLabel, normalizeCapitalCode } from "../../../people/domain/brazilian-capitals.js"
import { EMPLOYMENT_STATUS_LABELS, normalizeEmploymentStatus } from "../../../people/domain/employment-status.js"
import { normalizeScheduleExceptionCode, SCHEDULE_EXCEPTION_CODES, SCHEDULE_EXCEPTION_LABELS } from "../../../people/domain/schedule-exception.js"
import { normalizeScheduleType, SCHEDULE_TYPE_LABELS } from "../../../people/domain/work-schedule.js"
import type { DataContract } from "../data-contract.js"

/**
 * Contratos de DADO MESTRE: colaboradores, estrutura hierárquica, grupos, subgrupos, jornadas
 * e metas. Identidade sempre por identificador externo estável (matrícula, código do grupo) —
 * nunca por nome. Ausência numa carga NUNCA desativa ninguém (DELTA por padrão; SNAPSHOT com
 * desativação por ausência é evolução futura, opt-in explícito).
 */
export const EMPLOYMENT_STATUS_HELP = "Situação funcional como a fonte entrega. A INIA reconhece as nove situações reais (EM PRODUÇÃO, TRANSFERIDO, FÉRIAS, INSS, PILOTO, MATERNIDADE, PATERNIDADE, APOSENTADO, ATIVIDADE OFF) — códigos próprios da fonte (PROD, FER…) entram por 'Mapear códigos'. Desconhecido vai para a quarentena (DATA_EMPLOYMENT_STATUS_UNKNOWN), nunca vira 'em produção por palpite'. Conceito diferente de `active` (cadastro/conta)."

const employmentStatusDisplay = (value: unknown): string | null => {
  const status = typeof value === "string" ? normalizeEmploymentStatus(value) : null
  return status ? EMPLOYMENT_STATUS_LABELS[status] : null
}
const scheduleTypeDisplay = (value: unknown): string | null => {
  const type = typeof value === "string" ? normalizeScheduleType(value) : null
  return type ? SCHEDULE_TYPE_LABELS[type] : null
}
const capitalDisplay = (value: unknown): string | null => (typeof value === "string" ? capitalLabel(normalizeCapitalCode(value)) : null)
const exceptionCodeDisplay = (value: unknown): string | null => {
  const code = typeof value === "string" ? normalizeScheduleExceptionCode(value) : null
  return code ? SCHEDULE_EXCEPTION_LABELS[code] : null
}

export const OPERATIONAL_CAPITAL_HELP = `Capital brasileira cuja jurisdição de FERIADOS vale para o colaborador (não é endereço, residência nem lotação). Só os códigos do catálogo das 27 capitais (${BRAZILIAN_CAPITALS.map((capital) => capital.code).join(", ")}) ou o nome oficial; abreviações da empresa ("FOR", "CE-FOR") entram por 'Mapear códigos'. A UF é derivada — não envie UF. Ausente = mantém a atual.`

/**
 * NÍVEL HIERÁRQUICO do colaborador (dado ORGANIZACIONAL da carga do cliente — V1.5.7). Não é papel de acesso: importar ou
 * alterar um colaborador NUNCA concede privilégio no INIA (acesso = atribuição explícita de papel a uma conta, modules/access).
 * "ADMIN" não é nível organizacional e não é aceito pela carga (a linha vai para a quarentena).
 */
export const ORGANIZATIONAL_LEVELS = ["OPERATOR", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"] as const

export const EMPLOYEES_CONTRACT: DataContract = {
  key: "EMPLOYEES",
  version: 1,
  label: "Colaboradores",
  description: "Cadastro de pessoas da operação: identificador corporativo, nome, nível hierárquico, cargo, grupo/subgrupo, gestor direto e situação. Destino: `people`. Nunca concede acesso ao INIA.",
  category: "MASTER",
  targetEntity: "people",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Identificador corporativo estável do colaborador (matrícula). É a identidade — nunca o nome.", example: "OP-10234" },
    { key: "name", label: "Nome", type: "STRING", required: true, maxLength: 160, description: "Nome cadastral do colaborador. Não altera o nome pelo qual a pessoa escolheu ser chamada, nem a foto e a capa do perfil — preferências pessoais não são dados de carga.", example: "Mariana Alves" },
    { key: "role", label: "Nível hierárquico", type: "ENUM", required: true, enumValues: ORGANIZATIONAL_LEVELS, description: "Nível da pessoa na estrutura (operador, supervisor, coordenador, gerente…). Dado organizacional: define a posição na hierarquia, nunca acesso ao INIA.", example: "OPERATOR" },
    { key: "jobTitle", label: "Cargo", type: "STRING", required: false, maxLength: 120, description: "Cargo/função descritiva (texto livre).", example: "Analista de Atendimento I" },
    { key: "groupExternalCode", label: "Código do Grupo", type: "STRING", required: false, maxLength: 64, description: "Código externo do Grupo (precisa existir na INIA).", example: "B2C_RETENCAO" },
    { key: "subgroupExternalCode", label: "Código do Subgrupo", type: "STRING", required: false, maxLength: 128, description: "Código externo do Subgrupo (precisa existir e pertencer ao Grupo informado).", example: "B2C_RETENCAO/PREMIUM" },
    { key: "reportsToExternalId", label: "Matrícula do gestor direto", type: "STRING", required: false, maxLength: 64, description: "Matrícula de quem a pessoa reporta. Pode vir na mesma carga.", example: "SUP-0042" },
    { key: "hiredAt", label: "Data de admissão", type: "DATE", required: false, description: "Data de admissão (AAAA-MM-DD ou formato configurado no mapeamento).", example: "2024-03-11" },
    { key: "active", label: "Ativo", type: "BOOLEAN", required: false, description: "Situação do colaborador. Ausente = mantém o atual (novo cadastro nasce ativo).", example: true },
    { key: "email", label: "E-mail de acesso", type: "STRING", required: false, maxLength: 160, description: "E-mail da conta de acesso. Só atualiza a conta se ela já existir — a Central nunca cria senha.", example: "mariana.alves@empresa.com" },
    { key: "currentStatus", label: "Situação funcional (bruta)", type: "STRING", required: false, maxLength: 40, description: EMPLOYMENT_STATUS_HELP, example: "FERIAS" },
    { key: "statusEffectiveFrom", label: "Situação vigente desde", type: "DATE", required: false, description: "Quando a situação passou a valer, SE a fonte informar. Ausente = conhecida a partir desta carga (nunca retroage por suposição).", example: "2026-09-09" },
    { key: "sourceUpdatedAt", label: "Atualizado na fonte em", type: "DATETIME", required: false, description: "Quando a fonte diz que o registro mudou (freshness), se confiável.", example: "2026-09-15T08:00:00-03:00" },
    { key: "operationalCapitalCode", label: "Capital operacional", type: "STRING", required: false, maxLength: 40, description: OPERATIONAL_CAPITAL_HELP, example: "FORTALEZA" },
  ],
  naturalKey: ["externalEmployeeId"],
  dependencies: ["GROUPS", "SUBGROUPS"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  displayNormalizers: { currentStatus: employmentStatusDisplay, operationalCapitalCode: capitalDisplay },
  examples: [
    { externalEmployeeId: "OP-10234", name: "Mariana Alves", role: "OPERATOR", jobTitle: "Analista de Atendimento I", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: "B2C_RETENCAO/PREMIUM", reportsToExternalId: "SUP-0042", hiredAt: "2024-03-11", active: true, email: null, currentStatus: "EM PRODUÇÃO", statusEffectiveFrom: null, sourceUpdatedAt: null, operationalCapitalCode: "FORTALEZA" },
    { externalEmployeeId: "SUP-0042", name: "Carlos Menezes", role: "SUPERVISOR", jobTitle: "Supervisor de Atendimento", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: null, reportsToExternalId: "GER-0007", hiredAt: "2021-08-02", active: true, email: null, currentStatus: "FERIAS", statusEffectiveFrom: "2026-09-09", sourceUpdatedAt: "2026-09-15T08:00:00-03:00", operationalCapitalCode: "RECIFE" },
  ],
}

export const ORGANIZATIONAL_STRUCTURE_CONTRACT: DataContract = {
  key: "ORGANIZATIONAL_STRUCTURE",
  version: 1,
  label: "Estrutura organizacional",
  description: "Somente os vínculos hierárquicos de pessoas já cadastradas: quem reporta a quem e em qual Grupo/Subgrupo. Atômico: uma hierarquia meio aplicada é pior do que nenhuma. Destino: `people` (reports_to_id, team_id, subteam_id).",
  category: "MASTER",
  targetEntity: "people",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
    { key: "reportsToExternalId", label: "Matrícula do gestor direto", type: "STRING", required: false, maxLength: 64, description: "Matrícula do gestor. Vazio = topo da cadeia.", example: "SUP-0042" },
    { key: "groupExternalCode", label: "Código do Grupo", type: "STRING", required: false, maxLength: 64, description: "Código externo do Grupo.", example: "B2C_RETENCAO" },
    { key: "subgroupExternalCode", label: "Código do Subgrupo", type: "STRING", required: false, maxLength: 128, description: "Código externo do Subgrupo.", example: "B2C_RETENCAO/PREMIUM" },
  ],
  naturalKey: ["externalEmployeeId"],
  dependencies: ["EMPLOYEES", "GROUPS", "SUBGROUPS"],
  writeSemantics: "UPSERT",
  writePolicy: "ATOMIC",
  businessTimeField: null,
  examples: [{ externalEmployeeId: "OP-10234", reportsToExternalId: "SUP-0042", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: "B2C_RETENCAO/PREMIUM" }],
}

export const GROUPS_CONTRACT: DataContract = {
  key: "GROUPS",
  version: 1,
  label: "Grupos",
  description: "Grupos da operação (Abrangência de Workflows, Agents e metas). Identidade pelo código externo; o nome é apresentação. Destino: `teams`.",
  category: "MASTER",
  targetEntity: "teams",
  fields: [
    { key: "externalCode", label: "Código externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Código estável do Grupo.", example: "B2C_RETENCAO" },
    { key: "name", label: "Nome", type: "STRING", required: true, maxLength: 120, description: "Nome de exibição do Grupo.", example: "B2C · Retenção" },
    { key: "operationName", label: "Operação", type: "STRING", required: false, maxLength: 120, description: "Nome da Operação (fuso/calendário). Ausente = operação padrão da organização.", example: "Atendimento B2C" },
  ],
  naturalKey: ["externalCode"],
  dependencies: [],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [{ externalCode: "B2C_RETENCAO", name: "B2C · Retenção", operationName: "Atendimento B2C" }],
}

export const SUBGROUPS_CONTRACT: DataContract = {
  key: "SUBGROUPS",
  version: 1,
  label: "Subgrupos",
  description: "Subgrupos dentro de um Grupo existente. Destino: `subteams`.",
  category: "MASTER",
  targetEntity: "subteams",
  fields: [
    { key: "externalCode", label: "Código externo", type: "STRING", required: true, identity: true, maxLength: 128, description: "Código estável do Subgrupo (único na organização).", example: "B2C_RETENCAO/PREMIUM" },
    { key: "groupExternalCode", label: "Código do Grupo", type: "STRING", required: true, maxLength: 64, description: "Grupo pai (precisa existir).", example: "B2C_RETENCAO" },
    { key: "name", label: "Nome", type: "STRING", required: true, maxLength: 120, description: "Nome de exibição.", example: "Premium" },
  ],
  naturalKey: ["externalCode"],
  dependencies: ["GROUPS"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [{ externalCode: "B2C_RETENCAO/PREMIUM", groupExternalCode: "B2C_RETENCAO", name: "Premium" }],
}

export const WORK_SCHEDULES_CONTRACT: DataContract = {
  key: "WORK_SCHEDULES",
  version: 1,
  label: "Jornadas de trabalho",
  description: "Jornada prevista por colaborador (horário de entrada e carga horária), com vigência. Base do Trigger 'por agenda relativa ao expediente'. Destino: `employee_work_shifts`.",
  category: "MASTER",
  targetEntity: "employee_work_shifts",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
    { key: "startTime", label: "Horário de entrada", type: "TIME", required: true, description: "HH:mm no fuso da operação.", example: "08:00" },
    { key: "workMinutes", label: "Carga horária (minutos)", type: "INTEGER", required: true, description: "Minutos de jornada (1–1440).", example: 360 },
    { key: "effectiveFrom", label: "Vigente a partir de", type: "DATE", required: true, description: "Início da vigência.", example: "2026-01-01" },
    { key: "effectiveTo", label: "Vigente até", type: "DATE", required: false, description: "Fim da vigência (vazio = aberta).", example: "2026-12-31" },
    { key: "scheduleType", label: "Regime", type: "STRING", required: false, maxLength: 16, description: "Regime de escala vigente: 5x2 ou 6x1 (só esses valores). É metadata — quem diz se a pessoa trabalha em cada data é o contrato Escalas de trabalho (calendário).", example: "6x1" },
  ],
  naturalKey: ["externalEmployeeId", "effectiveFrom"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  displayNormalizers: { scheduleType: scheduleTypeDisplay },
  validateRecord: (record) => {
    const errors = []
    const minutes = record.workMinutes
    if (typeof minutes === "number" && (minutes < 1 || minutes > 1440)) errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "workMinutes", message: "Carga horária precisa estar entre 1 e 1440 minutos." })
    if (typeof record.effectiveTo === "string" && typeof record.effectiveFrom === "string" && record.effectiveTo < record.effectiveFrom) {
      errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "effectiveTo", message: "Fim da vigência anterior ao início." })
    }
    if (typeof record.scheduleType === "string" && record.scheduleType.trim() !== "" && !normalizeScheduleType(record.scheduleType)) {
      errors.push({ code: "DATA_INVALID_ENUM" as const, field: "scheduleType", message: `Regime "${record.scheduleType}" não é reconhecido — use 5x2 ou 6x1.` })
    }
    return errors
  },
  examples: [{ externalEmployeeId: "OP-10234", startTime: "08:00", workMinutes: 360, effectiveFrom: "2026-01-01", effectiveTo: null, scheduleType: "6x1" }],
}

/**
 * ESCALAS DE TRABALHO (calendário programado por dia) — a evidência real de "deveria trabalhar
 * nesta data?". Uma linha por colaborador × data: trabalha (true) ou folga (false). Ausência de
 * linha NUNCA é folga (é "a fonte não informou"); por isso o feed costuma ser um snapshot de
 * horizonte (ex.: D-7 até D+30). Em modo DELTA a INIA só atualiza as datas recebidas.
 * Destino: `employee_schedule_days`. Regime 5x2/6x1 é metadata (Jornadas de trabalho).
 */
export const WORK_SCHEDULE_DAYS_CONTRACT: DataContract = {
  key: "WORK_SCHEDULE_DAYS",
  version: 1,
  label: "Escalas de trabalho",
  description: "Calendário programado por colaborador e data: trabalha ou folga, com horário do turno e regime (5x2/6x1) opcionais. É a fonte de verdade da elegibilidade operacional junto com a situação funcional: um 6x1 tem a folga onde a escala diz (quarta pode ser folga; domingo não é folga por suposição). Destino: `employee_schedule_days`.",
  category: "MASTER",
  targetEntity: "employee_schedule_days",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
    { key: "scheduleDate", label: "Data", type: "DATE", required: true, description: "Dia do calendário (AAAA-MM-DD ou formato configurado no mapeamento).", example: "2026-09-16" },
    { key: "scheduledToWork", label: "Trabalha?", type: "BOOLEAN", required: true, description: "true = programado para trabalhar; false = folga programada. Use 'Mapear sim/não' para T/F, S/N, TRABALHA/FOLGA.", example: true },
    { key: "shiftStart", label: "Início do turno", type: "TIME", required: false, description: "HH:mm no fuso da operação (só quando trabalha).", example: "08:00" },
    { key: "shiftEnd", label: "Fim do turno", type: "TIME", required: false, description: "HH:mm no fuso da operação (só quando trabalha).", example: "14:20" },
    { key: "scheduleType", label: "Regime", type: "STRING", required: false, maxLength: 16, description: "5x2 ou 6x1 (só esses valores) — metadata informativa do dia.", example: "6x1" },
    { key: "sourceUpdatedAt", label: "Atualizado na fonte em", type: "DATETIME", required: false, description: "Quando a fonte diz que a escala desse dia mudou, se confiável.", example: "2026-09-10T18:00:00-03:00" },
    { key: "externalScheduleId", label: "ID da escala na fonte", type: "STRING", required: false, maxLength: 64, description: "Identificador do registro no sistema de escala (rastreabilidade).", example: "WS-2026-09-16-10234" },
  ],
  naturalKey: ["externalEmployeeId", "scheduleDate"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "scheduleDate",
  displayNormalizers: { scheduleType: scheduleTypeDisplay },
  validateRecord: (record) => {
    const errors = []
    if (typeof record.scheduleType === "string" && record.scheduleType.trim() !== "" && !normalizeScheduleType(record.scheduleType)) {
      errors.push({ code: "DATA_INVALID_ENUM" as const, field: "scheduleType", message: `Regime "${record.scheduleType}" não é reconhecido — use 5x2 ou 6x1.` })
    }
    if (record.scheduledToWork === false && (typeof record.shiftStart === "string" || typeof record.shiftEnd === "string")) {
      errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "shiftStart", message: "Folga programada não pode ter horário de turno." })
    }
    return errors
  },
  examples: [
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-09-16", scheduledToWork: false, shiftStart: null, shiftEnd: null, scheduleType: "6x1", sourceUpdatedAt: null, externalScheduleId: "WS-2026-09-16-10234" },
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-09-19", scheduledToWork: true, shiftStart: "08:00", shiftEnd: "14:20", scheduleType: "6x1", sourceUpdatedAt: null, externalScheduleId: "WS-2026-09-19-10234" },
  ],
}

/**
 * EXCEÇÕES DE CALENDÁRIO — alterações excepcionais ao calendário programado de uma pessoa em uma
 * data (banco de horas, day off, folga extraordinária). NÃO é a folga normal do 6x1 (essa é
 * Escalas de trabalho com trabalha = false). O efeito (NON_WORKING) é definido pelo catálogo — o
 * cliente não precisa enviar. Destino: `employee_schedule_exceptions`.
 */
export const WORK_SCHEDULE_EXCEPTIONS_CONTRACT: DataContract = {
  key: "WORK_SCHEDULE_EXCEPTIONS",
  version: 1,
  label: "Exceções de calendário",
  description: "Exceções individuais ao calendário programado: banco de horas, day off, folga extraordinária e atestado (só o motivo — nunca diagnóstico/CID) por colaborador e data. A escala original é preservada em Escalas de trabalho; a exceção vence a escala naquele dia (dia não elegível — medição preservada, fora do cálculo), salvo produção observada. Folga normal do 6x1 NÃO é exceção. Opcional: o Supervisor também pode registrar exceções no Calendário da equipe; quando as duas origens divergem, a INIA não sobrescreve — registra aviso de conflito. Destino: `employee_schedule_exceptions`.",
  category: "MASTER",
  targetEntity: "employee_schedule_exceptions",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
    { key: "date", label: "Data", type: "DATE", required: true, description: "Dia da exceção (AAAA-MM-DD ou formato configurado no mapeamento).", example: "2026-09-16" },
    { key: "exceptionCode", label: "Tipo da exceção", type: "STRING", required: true, maxLength: 40, description: `${Object.entries(SCHEDULE_EXCEPTION_LABELS).map(([code, label]) => `${code} (${label})`).join(", ")}. Códigos próprios da fonte entram por 'Mapear códigos'. Efeito: não produtivo — definido pelo catálogo.`, example: "DAY_OFF" },
    { key: "reason", label: "Motivo (texto da fonte)", type: "STRING", required: false, maxLength: 200, description: "Texto original do motivo, preservado como veio.", example: "Compensação de horas do sábado 12/09" },
    { key: "active", label: "Vigente?", type: "BOOLEAN", required: false, description: "false cancela a exceção (a linha fica, sem efeito). Ausente = vigente.", example: true },
    { key: "sourceUpdatedAt", label: "Atualizado na fonte em", type: "DATETIME", required: false, description: "Quando a fonte diz que a exceção mudou, se confiável.", example: "2026-09-15T18:00:00-03:00" },
    { key: "externalExceptionId", label: "ID da exceção na fonte", type: "STRING", required: false, maxLength: 64, description: "Identificador do registro no sistema de origem (rastreabilidade).", example: "EXC-2026-09-16-10234" },
  ],
  naturalKey: ["externalEmployeeId", "date", "exceptionCode"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "date",
  displayNormalizers: { exceptionCode: exceptionCodeDisplay },
  validateRecord: (record) => {
    const errors = []
    if (typeof record.exceptionCode === "string" && !normalizeScheduleExceptionCode(record.exceptionCode)) {
      errors.push({ code: "DATA_INVALID_ENUM" as const, field: "exceptionCode", message: `Tipo de exceção "${record.exceptionCode}" não é reconhecido — use ${SCHEDULE_EXCEPTION_CODES.join(", ")} ou mapeie o código da fonte.` })
    }
    return errors
  },
  examples: [
    { externalEmployeeId: "OP-10234", date: "2026-09-16", exceptionCode: "DAY_OFF", reason: "Day off concedido pela supervisão", active: true, sourceUpdatedAt: null, externalExceptionId: "EXC-2026-09-16-10234" },
    { externalEmployeeId: "OP-10234", date: "2026-09-23", exceptionCode: "BANCO_HORAS", reason: "Compensação de horas do sábado 12/09", active: true, sourceUpdatedAt: null, externalExceptionId: "EXC-2026-09-23-10234" },
  ],
}

export const GOAL_SUBJECT_TYPES = ["GROUP", "SUBGROUP", "EMPLOYEE"] as const

export const GOALS_CONTRACT: DataContract = {
  key: "GOALS",
  version: 1,
  label: "Metas",
  description: "Meta vigente de um indicador para um Grupo, Subgrupo ou colaborador, com período de validade. Destino: `goals`.",
  category: "PERFORMANCE",
  targetEntity: "goals",
  fields: [
    { key: "indicatorCode", label: "Código do indicador", type: "STRING", required: true, maxLength: 40, description: "Código do catálogo de indicadores da INIA (precisa existir).", example: "TMA" },
    { key: "subjectType", label: "Tipo do sujeito", type: "ENUM", required: true, enumValues: GOAL_SUBJECT_TYPES, description: "A quem a meta se aplica.", example: "GROUP" },
    { key: "subjectExternalCode", label: "Código/matrícula do sujeito", type: "STRING", required: true, identity: true, maxLength: 128, description: "Código do Grupo/Subgrupo ou matrícula do colaborador.", example: "B2C_RETENCAO" },
    { key: "targetValue", label: "Meta", type: "DECIMAL", required: true, description: "Valor da meta na unidade do indicador.", example: 480 },
    { key: "validFrom", label: "Válida a partir de", type: "DATE", required: true, description: "Início da vigência.", example: "2026-01-01" },
    { key: "validUntil", label: "Válida até", type: "DATE", required: false, description: "Fim da vigência (vazio = aberta).", example: "2026-12-31" },
  ],
  naturalKey: ["indicatorCode", "subjectType", "subjectExternalCode", "validFrom"],
  dependencies: ["GROUPS", "SUBGROUPS", "EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  validateRecord: (record) => {
    if (typeof record.validUntil === "string" && typeof record.validFrom === "string" && record.validUntil < record.validFrom) {
      return [{ code: "DATA_CONTRACT_VIOLATION", field: "validUntil", message: "Fim da vigência anterior ao início." }]
    }
    return []
  },
  examples: [{ indicatorCode: "TMA", subjectType: "GROUP", subjectExternalCode: "B2C_RETENCAO", targetValue: 480, validFrom: "2026-01-01", validUntil: null }],
}

export const ABSENCE_TYPES_HELP = "Tipo como a fonte entrega, normalizado para uma situação TEMPORAL real: FÉRIAS, INSS, MATERNIDADE, PATERNIDADE ou ATIVIDADE OFF (EM PRODUÇÃO não é ausência). Valores próprios da fonte (FER, LIC…) entram por 'Mapear códigos'; desconhecido vai para a quarentena."

export const EMPLOYEE_ABSENCES_CONTRACT: DataContract = {
  key: "EMPLOYEE_ABSENCES",
  version: 1,
  label: "Ausências (férias/afastamentos)",
  description: "Períodos explícitos de férias, INSS, maternidade, paternidade ou atividade off por colaborador. Cada linha vira um período na situação funcional (mesma camada canônica do cadastro), com datas efetivas que têm precedência sobre a inferência do snapshot. Destino: `employee_status_periods`.",
  category: "MASTER",
  targetEntity: "employee_status_periods",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
    { key: "type", label: "Tipo (bruto)", type: "STRING", required: true, maxLength: 40, description: ABSENCE_TYPES_HELP, example: "FERIAS" },
    { key: "startDate", label: "Início", type: "DATE", required: true, description: "Primeiro dia da ausência.", example: "2026-09-09" },
    { key: "endDate", label: "Fim", type: "DATE", required: false, description: "Último dia (inclusivo). Vazio = em aberto.", example: "2026-09-20" },
    { key: "sourceUpdatedAt", label: "Atualizado na fonte em", type: "DATETIME", required: false, description: "Quando a fonte diz que o registro mudou, se confiável.", example: "2026-09-08T18:00:00-03:00" },
  ],
  naturalKey: ["externalEmployeeId", "type", "startDate"],
  dependencies: ["EMPLOYEES"],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "startDate",
  displayNormalizers: { type: employmentStatusDisplay },
  validateRecord: (record) => {
    if (typeof record.endDate === "string" && typeof record.startDate === "string" && record.endDate < record.startDate) {
      return [{ code: "DATA_CONTRACT_VIOLATION", field: "endDate", message: "Fim da ausência anterior ao início." }]
    }
    return []
  },
  examples: [{ externalEmployeeId: "OP-10234", type: "FERIAS", startDate: "2026-09-09", endDate: "2026-09-20", sourceUpdatedAt: null }],
}
