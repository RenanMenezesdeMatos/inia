import { BRAZILIAN_CAPITALS, capitalLabel, normalizeCapitalCode } from "../../../people/domain/brazilian-capitals.js"
import { EMPLOYMENT_STATUS_LABELS, normalizeEmploymentStatus } from "../../../people/domain/employment-status.js"
import { normalizeScheduleExceptionCode, SCHEDULE_EXCEPTION_CODES, SCHEDULE_EXCEPTION_LABELS } from "../../../people/domain/schedule-exception.js"
import { normalizeScheduleActivityType, SCHEDULE_ACTIVITY_TYPE_LABELS, SCHEDULE_ACTIVITY_TYPES } from "../../../people/domain/schedule-activity.js"
import { normalizeScheduleType, SCHEDULE_TYPE_LABELS } from "../../../people/domain/work-schedule.js"
import type { DataContract, DataContractField } from "../data-contract.js"

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

const activityTypeDisplay = (value: unknown): string | null => {
  const type = typeof value === "string" ? normalizeScheduleActivityType(value) : null
  return type ? SCHEDULE_ACTIVITY_TYPE_LABELS[type] : null
}

export const OPERATIONAL_CAPITAL_HELP = `Capital brasileira cuja jurisdição de FERIADOS vale para o colaborador (não é endereço, residência nem lotação). Só os códigos do catálogo das 27 capitais (${BRAZILIAN_CAPITALS.map((capital) => capital.code).join(", ")}) ou o nome oficial; abreviações da empresa ("FOR", "CE-FOR") entram por 'Mapear códigos'. A UF é derivada — não envie UF. Ausente = mantém a atual.`

/**
 * NÍVEL HIERÁRQUICO do colaborador (dado ORGANIZACIONAL da carga do cliente — V1.5.7). Não é papel de acesso: importar ou
 * alterar um colaborador NUNCA concede privilégio no INIA (acesso = atribuição explícita de papel a uma conta, modules/access).
 * "ADMIN" não é nível organizacional e não é aceito pela carga (a linha vai para a quarentena).
 */
import { JOB_POSITION_LEVELS } from "../../../people/domain/job-position.js"
import { OPERATING_UNIVERSES } from "../../../operating-universe/domain/operating-universe.js"

/** Os níveis que a base pode mandar = os perfis de cargo (`people/domain/job-position.ts`). */
export const ORGANIZATIONAL_LEVELS = JOB_POSITION_LEVELS

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
    { key: "role", label: "Nível hierárquico", type: "STRING", required: true, maxLength: 120, description: `Cargo como a base escreve ("OPERADOR", "ASSISTENTE RELACIONAMENTO", "GERENTE SR"…), cadastrado em Central de Dados › Cargos, ou o código do nível (${ORGANIZATIONAL_LEVELS.join(", ")}). O cargo diz o perfil da pessoa na estrutura; nunca concede acesso ao INIA. Cargo não cadastrado vai para a quarentena.`, example: "OPERADOR" },
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
    { key: "operatingUniverse", label: "Universo de atuação", type: "ENUM", required: false, enumValues: OPERATING_UNIVERSES, description: "EXCEÇÃO: só quando o colaborador atende um universo diferente do Grupo/Subgrupo dele (o universo normal vem da carga de Grupos). Vazio = herda do Grupo. Ausente na carga = mantém o atual. Com o filtro ativo, pessoa NOVA sem universo (nem próprio nem do Grupo) vai para a quarentena.", example: "B2B" },
    { key: "operatingUniverseEffectiveFrom", label: "Universo vigente desde", type: "DATE", required: false, description: "Quando a exceção passou a valer, se a fonte informar. Ausente = a partir desta carga.", example: "2026-11-01" },
  ],
  naturalKey: ["externalEmployeeId"],
  dependencies: ["GROUPS", "SUBGROUPS"],
  foreignKeys: [
    { field: "groupExternalCode", references: [{ contract: "GROUPS", field: "externalCode" }] },
    { field: "subgroupExternalCode", references: [{ contract: "SUBGROUPS", field: "externalCode" }] },
    { field: "reportsToExternalId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  displayNormalizers: { currentStatus: employmentStatusDisplay, operationalCapitalCode: capitalDisplay },
  examples: [
    { externalEmployeeId: "OP-10234", name: "Mariana Alves", role: "OPERATOR", jobTitle: "Analista de Atendimento I", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: "B2C_RETENCAO/PREMIUM", reportsToExternalId: "SUP-0042", hiredAt: "2024-03-11", active: true, email: null, currentStatus: "EM PRODUÇÃO", statusEffectiveFrom: null, sourceUpdatedAt: null, operationalCapitalCode: "FORTALEZA", operatingUniverse: null, operatingUniverseEffectiveFrom: null },
    { externalEmployeeId: "SUP-0042", name: "Carlos Menezes", role: "SUPERVISOR", jobTitle: "Supervisor de Atendimento", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: null, reportsToExternalId: "GER-0007", hiredAt: "2021-08-02", active: true, email: null, currentStatus: "FERIAS", statusEffectiveFrom: "2026-09-09", sourceUpdatedAt: "2026-09-15T08:00:00-03:00", operationalCapitalCode: "RECIFE", operatingUniverse: null, operatingUniverseEffectiveFrom: null },
    { externalEmployeeId: "OP-20871", name: "Bruno Tavares", role: "OPERATOR", jobTitle: "Analista de Atendimento I", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: "B2C_RETENCAO/PADRAO", reportsToExternalId: "SUP-0042", hiredAt: "2025-02-03", active: true, email: null, currentStatus: "EM PRODUÇÃO", statusEffectiveFrom: null, sourceUpdatedAt: null, operationalCapitalCode: "FORTALEZA", operatingUniverse: null, operatingUniverseEffectiveFrom: null },
    // O gestor citado nos exemplos acima também é uma linha da tabela (a legenda da tela diz que ele precisa existir aqui); topo da cadeia = sem gestor.
    { externalEmployeeId: "GER-0007", name: "Helena Prado", role: "MANAGER", jobTitle: "Gerente de Operações", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: null, reportsToExternalId: null, hiredAt: "2019-05-06", active: true, email: null, currentStatus: "EM PRODUÇÃO", statusEffectiveFrom: null, sourceUpdatedAt: null, operationalCapitalCode: "RECIFE", operatingUniverse: null, operatingUniverseEffectiveFrom: null },
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
  foreignKeys: [
    { field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
    { field: "reportsToExternalId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
    { field: "groupExternalCode", references: [{ contract: "GROUPS", field: "externalCode" }] },
    { field: "subgroupExternalCode", references: [{ contract: "SUBGROUPS", field: "externalCode" }] },
  ],
  writeSemantics: "UPSERT",
  writePolicy: "ATOMIC",
  businessTimeField: null,
  examples: [
    { externalEmployeeId: "OP-10234", reportsToExternalId: "SUP-0042", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: "B2C_RETENCAO/PREMIUM" },
    { externalEmployeeId: "OP-20871", reportsToExternalId: "SUP-0042", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: "B2C_RETENCAO/PADRAO" },
    { externalEmployeeId: "SUP-0042", reportsToExternalId: "GER-0007", groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: null },
    { externalEmployeeId: "GER-0007", reportsToExternalId: null, groupExternalCode: "B2C_RETENCAO", subgroupExternalCode: null },
  ],
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
    { key: "operatingUniverse", label: "Universo de atuação", type: "ENUM", required: false, enumValues: OPERATING_UNIVERSES, description: "Público que o Grupo atende: B2B, B2C ou B2X (universos separados). Os operadores do Grupo herdam este universo. Ausente = mantém o atual; para ativar o filtro por universo, todo Grupo com operadores precisa dele. Códigos diferentes da fonte se traduzem em \"Mapear códigos\".", example: "B2C" },
    { key: "operatingUniverseEffectiveFrom", label: "Universo vigente desde", type: "DATE", required: false, description: "Quando o Grupo passou a atender esse universo, se a fonte informar. Só importa numa troca: os indicadores do período anterior ficam no universo antigo. Ausente = a partir desta carga.", example: "2026-11-01" },
  ],
  naturalKey: ["externalCode"],
  dependencies: [],
  foreignKeys: [],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [
    { externalCode: "B2C_RETENCAO", name: "B2C · Retenção", operationName: "Atendimento B2C", operatingUniverse: "B2C", operatingUniverseEffectiveFrom: null },
    { externalCode: "B2C_SUPORTE", name: "B2C · Suporte técnico", operationName: "Atendimento B2C", operatingUniverse: "B2C", operatingUniverseEffectiveFrom: null },
    { externalCode: "B2B_EMPRESAS", name: "B2B · Empresas", operationName: "Atendimento B2B", operatingUniverse: "B2B", operatingUniverseEffectiveFrom: "2026-03-01" },
  ],
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
    { key: "operatingUniverse", label: "Universo de atuação", type: "ENUM", required: false, enumValues: OPERATING_UNIVERSES, description: "Só quando o Subgrupo atende um universo DIFERENTE do Grupo-pai (raro). Vazio = herda do Grupo.", example: "B2X" },
    { key: "operatingUniverseEffectiveFrom", label: "Universo vigente desde", type: "DATE", required: false, description: "Quando o Subgrupo passou a atender esse universo, se a fonte informar. Ausente = a partir desta carga.", example: "2026-11-01" },
  ],
  naturalKey: ["externalCode"],
  dependencies: ["GROUPS"],
  foreignKeys: [
    { field: "groupExternalCode", references: [{ contract: "GROUPS", field: "externalCode" }] },
  ],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [
    { externalCode: "B2C_RETENCAO/PREMIUM", groupExternalCode: "B2C_RETENCAO", name: "Premium", operatingUniverse: null, operatingUniverseEffectiveFrom: null },
    { externalCode: "B2C_RETENCAO/PADRAO", groupExternalCode: "B2C_RETENCAO", name: "Padrão", operatingUniverse: null, operatingUniverseEffectiveFrom: null },
    { externalCode: "B2C_SUPORTE/EMPRESARIAL", groupExternalCode: "B2C_SUPORTE", name: "Suporte empresarial", operatingUniverse: "B2X", operatingUniverseEffectiveFrom: "2026-06-01" },
  ],
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
  foreignKeys: [
    { field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
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
  examples: [
    { externalEmployeeId: "OP-10234", startTime: "08:00", workMinutes: 360, effectiveFrom: "2026-01-01", effectiveTo: null, scheduleType: "6x1" },
    { externalEmployeeId: "OP-20871", startTime: "14:00", workMinutes: 360, effectiveFrom: "2026-01-01", effectiveTo: "2026-09-30", scheduleType: "6x1" },
    { externalEmployeeId: "OP-20871", startTime: "16:00", workMinutes: 360, effectiveFrom: "2026-10-01", effectiveTo: null, scheduleType: "6x1" },
    { externalEmployeeId: "SUP-0042", startTime: "08:00", workMinutes: 480, effectiveFrom: "2026-01-01", effectiveTo: null, scheduleType: "5x2" },
  ],
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
  foreignKeys: [
    { field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
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
    { externalEmployeeId: "OP-20871", scheduleDate: "2026-09-19", scheduledToWork: true, shiftStart: "14:00", shiftEnd: "20:20", scheduleType: "6x1", sourceUpdatedAt: "2026-09-18T17:30:00-03:00", externalScheduleId: "WS-2026-09-19-20871" },
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
  foreignKeys: [
    { field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
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
    { externalEmployeeId: "OP-20871", date: "2026-09-25", exceptionCode: "FOLGA_EXTRAORDINARIA", reason: "Folga extraordinária por convocação eleitoral", active: true, sourceUpdatedAt: "2026-09-20T10:00:00-03:00", externalExceptionId: "EXC-2026-09-25-20871" },
  ],
}

/**
 * ATIVIDADES ESCALADAS — o que a escala prevê para cada horário do dia: horário de LOGIN para atendimento, PAUSAS programadas e
 * OUTRAS atividades (treinamento, feedback…). Uma linha por colaborador × data × atividade, com início e fim. Alimenta a "Minha
 * jornada" do operador. A carga de uma data traz o DIA INTEIRO da pessoa: atividade que ficou de fora de uma carga mais nova daquele
 * dia é desativada (nunca apagada). Exemplo de origem: `MIS_FAT_ATIVIDADE_ESCALADO` (SNOMAMATRCOMPL, DDTDATA_ESCALADA, SNOATIVIDADE,
 * SNOINICIO, SNOFIM). Destino: `employee_schedule_activities`.
 */
export const WORK_SCHEDULE_ACTIVITIES_CONTRACT: DataContract = {
  key: "WORK_SCHEDULE_ACTIVITIES",
  version: 1,
  label: "Atividades escaladas",
  description: "Horário de login para atendimento, pausas programadas e outras atividades previstas na escala, por colaborador e data, com início e fim. A carga de uma data traz o dia inteiro da pessoa: atividade que não vier numa carga mais nova daquele dia deixa de valer (fica no histórico, desativada). O tipo (login, pausa, outra) vem do nome da atividade na fonte por 'Mapear códigos' — atividade sem tipo vai para a quarentena, nunca vira pausa por palpite. Exemplo de origem: tabela MIS_FAT_ATIVIDADE_ESCALADO (SNOMAMATRCOMPL, DDTDATA_ESCALADA, SNOATIVIDADE, SNOINICIO, SNOFIM). Destino: `employee_schedule_activities`.",
  category: "MASTER",
  targetEntity: "employee_schedule_activities",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir). Ex.: SNOMAMATRCOMPL.", example: "OP-10234" },
    { key: "scheduleDate", label: "Data", type: "DATE", required: true, description: "Dia da escala a que a atividade pertence (AAAA-MM-DD ou formato configurado no mapeamento). Ex.: DDTDATA_ESCALADA.", example: "2026-11-17" },
    { key: "activityName", label: "Atividade", type: "STRING", required: true, maxLength: 120, description: "Nome da atividade como a fonte escreve, preservado (é o que o operador lê). Ex.: SNOATIVIDADE.", example: "Pausa NR17" },
    { key: "activityType", label: "Tipo da atividade", type: "STRING", required: true, maxLength: 40, description: `${SCHEDULE_ACTIVITY_TYPES.map((type) => `${type} (${SCHEDULE_ACTIVITY_TYPE_LABELS[type]})`).join(", ")} — também aceita LOGADO, PAUSA e OUTRA. Quando a fonte só tem o nome da atividade (ex.: SNOATIVIDADE), mapeie a MESMA coluna aqui e use 'Mapear códigos' para dar um tipo a cada nome. Nome sem tipo vai para a quarentena.`, example: "PAUSA" },
    { key: "startTime", label: "Início", type: "TIME", required: true, description: "HH:mm no fuso da operação. Ex.: SNOINICIO.", example: "10:20" },
    { key: "endTime", label: "Fim", type: "TIME", required: true, description: "HH:mm no fuso da operação. Fim menor que o início = termina no dia seguinte. Ex.: SNOFIM.", example: "10:30" },
    { key: "sourceUpdatedAt", label: "Atualizado na fonte em", type: "DATETIME", required: false, description: "Quando a fonte diz que a escala desse dia mudou, se confiável.", example: "2026-11-16T18:00:00-03:00" },
    { key: "externalActivityId", label: "ID da atividade na fonte", type: "STRING", required: false, maxLength: 64, description: "Identificador do registro no sistema de escala (rastreabilidade).", example: "ATV-2026-11-17-10234-3" },
  ],
  naturalKey: ["externalEmployeeId", "scheduleDate", "startTime", "activityName"],
  dependencies: ["EMPLOYEES"],
  foreignKeys: [
    { field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: "scheduleDate",
  displayNormalizers: { activityType: activityTypeDisplay },
  validateRecord: (record) => {
    const errors = []
    if (typeof record.activityType === "string" && !normalizeScheduleActivityType(record.activityType)) {
      errors.push({ code: "DATA_INVALID_ENUM" as const, field: "activityType", message: `Tipo de atividade "${record.activityType}" não é reconhecido — use LOGADO, PAUSA ou OUTRA, ou classifique o nome da fonte em 'Mapear códigos'.` })
    }
    if (typeof record.startTime === "string" && record.startTime === record.endTime) {
      errors.push({ code: "DATA_CONTRACT_VIOLATION" as const, field: "endTime", message: "Início e fim da atividade são iguais." })
    }
    return errors
  },
  examples: [
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-11-17", activityName: "Logado", activityType: "LOGADO", startTime: "08:00", endTime: "14:20", sourceUpdatedAt: null, externalActivityId: null },
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-11-17", activityName: "Pausa NR17", activityType: "PAUSA", startTime: "10:20", endTime: "10:30", sourceUpdatedAt: null, externalActivityId: null },
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-11-17", activityName: "Lanche", activityType: "PAUSA", startTime: "11:40", endTime: "12:00", sourceUpdatedAt: null, externalActivityId: null },
    { externalEmployeeId: "OP-10234", scheduleDate: "2026-11-17", activityName: "Feedback", activityType: "OUTRA", startTime: "13:00", endTime: "13:20", sourceUpdatedAt: null, externalActivityId: null },
    { externalEmployeeId: "OP-20871", scheduleDate: "2026-11-17", activityName: "Treinamento de produto", activityType: "OUTRA", startTime: "22:30", endTime: "00:30", sourceUpdatedAt: "2026-11-16T18:00:00-03:00", externalActivityId: "ATV-2026-11-17-20871-2" },
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
  foreignKeys: [
    { field: "indicatorCode", references: [{ catalog: "Catálogo de indicadores da INIA" }] },
    { field: "subjectExternalCode", references: [{ contract: "GROUPS", field: "externalCode" }, { contract: "SUBGROUPS", field: "externalCode" }, { contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  validateRecord: (record) => {
    if (typeof record.validUntil === "string" && typeof record.validFrom === "string" && record.validUntil < record.validFrom) {
      return [{ code: "DATA_CONTRACT_VIOLATION", field: "validUntil", message: "Fim da vigência anterior ao início." }]
    }
    return []
  },
  examples: [
    { indicatorCode: "TMA", subjectType: "GROUP", subjectExternalCode: "B2C_RETENCAO", targetValue: 480, validFrom: "2026-01-01", validUntil: null },
    { indicatorCode: "TMA", subjectType: "SUBGROUP", subjectExternalCode: "B2C_RETENCAO/PREMIUM", targetValue: 460, validFrom: "2026-01-01", validUntil: null },
    { indicatorCode: "FCR", subjectType: "EMPLOYEE", subjectExternalCode: "OP-20871", targetValue: 78, validFrom: "2026-09-01", validUntil: "2026-12-31" },
  ],
}

export const ABSENCE_TYPES_HELP = "Tipo como a fonte entrega, normalizado para uma situação TEMPORAL real: FÉRIAS, INSS, MATERNIDADE, PATERNIDADE ou ATIVIDADE OFF (EM PRODUÇÃO não é ausência). Valores próprios da fonte (FER, LIC…) entram por 'Mapear códigos'; desconhecido vai para a quarentena."

const ABSENCE_ENTITY = {
  key: "EMPLOYEE_ABSENCES",
  label: "Ausências (férias/afastamentos)",
  category: "MASTER",
  targetEntity: "employee_status_periods",
  naturalKey: ["externalEmployeeId", "type", "startDate"],
  dependencies: ["EMPLOYEES"],
  foreignKeys: [
    { field: "externalEmployeeId", references: [{ contract: "EMPLOYEES", field: "externalEmployeeId" }] },
  ],
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
} satisfies Omit<DataContract, "version" | "description" | "fields" | "examples">

const ABSENCE_FIELDS_V1 = [
  { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, maxLength: 64, description: "Matrícula do colaborador (precisa existir).", example: "OP-10234" },
  { key: "type", label: "Tipo (bruto)", type: "STRING", required: true, maxLength: 40, description: ABSENCE_TYPES_HELP, example: "FERIAS" },
  { key: "startDate", label: "Início", type: "DATE", required: true, description: "Primeiro dia da ausência.", example: "2026-09-09" },
  { key: "endDate", label: "Fim", type: "DATE", required: false, description: "Último dia (inclusivo). Vazio = em aberto.", example: "2026-09-20" },
  { key: "sourceUpdatedAt", label: "Atualizado na fonte em", type: "DATETIME", required: false, description: "Quando a fonte diz que o registro mudou, se confiável.", example: "2026-09-08T18:00:00-03:00" },
] as const satisfies readonly DataContractField[]

/** Versão 1 (sem "Vigente?"), congelada: feeds criados antes da versão 2 continuam nela até o mapeamento ser salvo de novo. */
export const EMPLOYEE_ABSENCES_CONTRACT_V1: DataContract = {
  ...ABSENCE_ENTITY,
  version: 1,
  description: "Períodos explícitos de férias, INSS, maternidade, paternidade ou atividade off por colaborador. Cada linha vira um período na situação funcional (mesma camada canônica do cadastro), com datas efetivas que têm precedência sobre a inferência do snapshot. Destino: `employee_status_periods`.",
  fields: ABSENCE_FIELDS_V1,
  examples: [{ externalEmployeeId: "OP-10234", type: "FERIAS", startDate: "2026-09-09", endDate: "2026-09-20", sourceUpdatedAt: null }],
}

/**
 * Versão 2: "Vigente? = não" desfaz a ausência daquela identidade (matrícula + tipo + início) — o
 * RH cancelou as férias inteiras. O período sai da situação funcional (auditado em `audit_logs`),
 * e os dias voltam a seguir as outras fontes; nada é inventado no lugar.
 */
export const EMPLOYEE_ABSENCES_CONTRACT: DataContract = {
  ...ABSENCE_ENTITY,
  version: 2,
  description: "Períodos explícitos de férias, INSS, maternidade, paternidade ou atividade off por colaborador. Cada linha vira um período na situação funcional (mesma camada canônica do cadastro), com datas efetivas que têm precedência sobre a inferência do snapshot. \"Vigente? = não\" cancela a ausência já recebida: o período sai (auditado) e os dias voltam a seguir as outras fontes. Destino: `employee_status_periods`.",
  fields: [
    ...ABSENCE_FIELDS_V1.slice(0, 4),
    { key: "active", label: "Vigente?", type: "BOOLEAN", required: false, description: "false cancela a ausência desta matrícula, tipo e início, se ela veio desta fonte: o período sai da situação funcional (registro auditado) e os dias voltam a seguir as outras fontes. Ausente = vigente; reenviar como vigente recria o período.", example: true },
    ABSENCE_FIELDS_V1[4],
  ],
  examples: [
    { externalEmployeeId: "OP-10234", type: "FERIAS", startDate: "2026-09-09", endDate: "2026-09-20", active: true, sourceUpdatedAt: null },
    { externalEmployeeId: "OP-10234", type: "FERIAS", startDate: "2026-10-05", endDate: "2026-10-14", active: false, sourceUpdatedAt: "2026-09-30T18:00:00-03:00" },
    { externalEmployeeId: "OP-20871", type: "INSS", startDate: "2026-10-20", endDate: null, active: true, sourceUpdatedAt: "2026-10-20T09:15:00-03:00" },
  ],
}
