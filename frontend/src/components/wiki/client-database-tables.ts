/**
 * Tabelas que o cliente cria no banco dele para a INIA ler (SQL Server). Fonte única da página
 * `/wiki/central-de-dados/banco-do-cliente`: o SQL e a explicação de cada campo saem daqui, então não divergem.
 *
 * `field` é o campo do contrato de dados da INIA que a coluna alimenta. Um teste do backend lê este arquivo e confere tudo
 * contra o registro de contratos e contra o gerador de SQL da leitura; uma prova roda o script num SQL Server real.
 * Por isso este arquivo não importa nada: só dados e texto.
 */
export type ClientColumn = {
  name: string
  sqlType: string
  required: boolean
  /** Campo do contrato. `null` = só controla a leitura, não vira dado na INIA. */
  field: string | null
  description: string
  example: string | number | boolean | null
}

export type ClientTableGroup = "Cadastro" | "Atendimentos" | "Indicadores" | "Jornada e ausências"

export type ClientTable = {
  name: string
  contractKey: string
  /** Versão atual do contrato no registro do backend (o teste confere). */
  contractVersion: number
  group: ClientTableGroup
  need: "Base" | "Complementar"
  purpose: string
  /** Completa a frase "Uma linha por…". */
  grain: string
  primaryKey: string[]
  /** Colunas de desempate da leitura, depois de `atualizado_em` (no máximo 3). */
  readKeys: string[]
  /** Colunas de negócio. `atualizado_em` entra sozinha, no fim de toda tabela. */
  columns: ClientColumn[]
}

export const CLIENT_SCHEMA = "inia"
export const CLIENT_READER_LOGIN = "inia_leitura"
export const UPDATED_AT_COLUMN = "atualizado_em"

const updatedAtColumn: ClientColumn = {
  name: UPDATED_AT_COLUMN,
  sqlType: "datetime2(3)",
  required: true,
  field: null,
  description: "Quando a linha foi criada ou alterada. Precisa mudar sempre que qualquer campo da linha mudar: é por ele que a INIA sabe o que ler. Não vira dado na INIA.",
  example: "2026-09-16 06:10:00",
}

const matricula = (description: string): ClientColumn => ({ name: "matricula", sqlType: "varchar(64)", required: true, field: "externalEmployeeId", description, example: "OP-10234" })
const indicador: ClientColumn = { name: "indicador", sqlType: "varchar(40)", required: true, field: "indicatorCode", description: "Código do indicador. Precisa estar cadastrado na INIA com o mesmo código.", example: "TMA" }
const subgrupo = (description: string): ClientColumn => ({ name: "subgrupo", sqlType: "varchar(128)", required: false, field: "subgroupExternalCode", description, example: "B2C_RETENCAO/PREMIUM" })
const idChamada = (description: string): ClientColumn => ({ name: "id_chamada", sqlType: "varchar(128)", required: true, field: "externalInteractionId", description, example: "CALL-2026-000123" })
const quartil = (required: boolean, description: string): ClientColumn => ({ name: "quartil", sqlType: "char(2)", required, field: "quartile", description, example: "Q2" })
const regime = (description: string): ClientColumn => ({ name: "regime", sqlType: "varchar(16)", required: false, field: "scheduleType", description, example: "6x1" })

export const CLIENT_TABLES: ClientTable[] = [
  {
    name: "grupos",
    contractKey: "GROUPS",
    contractVersion: 1,
    group: "Cadastro",
    need: "Base",
    purpose: "Os grupos da operação, como Retenção ou Suporte.",
    grain: "grupo",
    primaryKey: ["codigo"],
    readKeys: ["codigo"],
    columns: [
      { name: "codigo", sqlType: "varchar(64)", required: true, field: "externalCode", description: "Código estável do grupo. É a identidade dele: não deve mudar.", example: "B2C_RETENCAO" },
      { name: "nome", sqlType: "nvarchar(120)", required: true, field: "name", description: "Nome de exibição do grupo.", example: "Retenção B2C" },
    ],
  },
  {
    name: "subgrupos",
    contractKey: "SUBGROUPS",
    contractVersion: 1,
    group: "Cadastro",
    need: "Base",
    purpose: "Os subgrupos dentro de cada grupo.",
    grain: "subgrupo",
    primaryKey: ["codigo"],
    readKeys: ["codigo"],
    columns: [
      { name: "codigo", sqlType: "varchar(128)", required: true, field: "externalCode", description: "Código estável do subgrupo, único em toda a operação.", example: "B2C_RETENCAO/PREMIUM" },
      { name: "grupo", sqlType: "varchar(64)", required: true, field: "groupExternalCode", description: "Código do grupo ao qual o subgrupo pertence.", example: "B2C_RETENCAO" },
      { name: "nome", sqlType: "nvarchar(120)", required: true, field: "name", description: "Nome de exibição do subgrupo.", example: "Premium" },
    ],
  },
  {
    name: "colaboradores",
    contractKey: "EMPLOYEES",
    contractVersion: 1,
    group: "Cadastro",
    need: "Base",
    purpose: "As pessoas da operação e a posição de cada uma na estrutura. Importar uma pessoa nunca dá acesso à INIA.",
    grain: "colaborador",
    primaryKey: ["matricula"],
    readKeys: ["matricula"],
    columns: [
      matricula("Matrícula do colaborador. É a identidade da pessoa: não deve mudar e nunca é o nome."),
      { name: "nome", sqlType: "nvarchar(160)", required: true, field: "name", description: "Nome cadastral.", example: "Mariana Alves" },
      { name: "nivel", sqlType: "varchar(20)", required: true, field: "role", description: "Nível na hierarquia: OPERATOR, SUPERVISOR, COORDINATOR, MANAGER, SENIOR_MANAGER ou DIRECTOR.", example: "OPERATOR" },
      { name: "cargo", sqlType: "nvarchar(120)", required: false, field: "jobTitle", description: "Cargo descritivo, em texto livre.", example: "Analista de Atendimento I" },
      { name: "grupo", sqlType: "varchar(64)", required: false, field: "groupExternalCode", description: "Código do grupo da pessoa.", example: "B2C_RETENCAO" },
      subgrupo("Código do subgrupo da pessoa. Precisa pertencer ao grupo informado."),
      { name: "gestor_matricula", sqlType: "varchar(64)", required: false, field: "reportsToExternalId", description: "Matrícula do gestor direto. O gestor precisa estar nesta mesma tabela. Vazio = topo da cadeia.", example: "SUP-0042" },
      { name: "data_admissao", sqlType: "date", required: false, field: "hiredAt", description: "Data de admissão.", example: "2024-03-11" },
      { name: "ativo", sqlType: "bit", required: false, field: "active", description: "1 = cadastro ativo, 0 = inativo. Vazio mantém o valor atual.", example: true },
      { name: "email", sqlType: "varchar(160)", required: false, field: "email", description: "E-mail corporativo, usado para ligar a pessoa à conta de acesso que já exista. Nunca cria conta.", example: "mariana.alves@empresa.com" },
      { name: "situacao_funcional", sqlType: "nvarchar(40)", required: false, field: "currentStatus", description: "Situação atual: EM PRODUÇÃO, TRANSFERIDO, FÉRIAS, INSS, PILOTO, MATERNIDADE, PATERNIDADE, APOSENTADO ou ATIVIDADE OFF. Códigos próprios podem ser convertidos na configuração. Valor desconhecido vai para a quarentena.", example: "EM PRODUÇÃO" },
      { name: "situacao_vigente_desde", sqlType: "date", required: false, field: "statusEffectiveFrom", description: "Desde quando a situação vale. Vazio = a partir da carga.", example: "2024-03-11" },
      { name: "capital_operacional", sqlType: "varchar(40)", required: false, field: "operationalCapitalCode", description: "Capital cujos feriados valem para a pessoa. Não é endereço nem lotação.", example: "FORTALEZA" },
    ],
  },
  {
    name: "chamadas",
    contractKey: "INTERACTIONS",
    contractVersion: 2,
    group: "Atendimentos",
    need: "Base",
    purpose: "Os atendimentos realizados por cada colaborador.",
    grain: "atendimento",
    primaryKey: ["id_chamada"],
    readKeys: ["id_chamada"],
    columns: [
      idChamada("Identificador único do atendimento na origem, como o protocolo ou o call id."),
      matricula("Matrícula de quem atendeu. Precisa existir em colaboradores."),
      { name: "canal", sqlType: "varchar(32)", required: false, field: "channel", description: "Canal do atendimento. Vazio = VOICE, o único canal disponível hoje.", example: "VOICE" },
      { name: "motivo", sqlType: "nvarchar(200)", required: true, field: "reason", description: "Motivo do contato: a categoria mais genérica, como a origem cadastra.", example: "Fatura" },
      { name: "submotivo", sqlType: "nvarchar(200)", required: false, field: "subReason", description: "Recorte específico dentro do motivo. Vazio mantém o que já foi recebido.", example: "Segunda via" },
      { name: "inicio", sqlType: "datetime2(0)", required: true, field: "startedAt", description: "Início do atendimento, no horário local da operação.", example: "2026-09-15 14:02:10" },
      { name: "fim", sqlType: "datetime2(0)", required: true, field: "endedAt", description: "Fim do atendimento, no horário local da operação. Precisa ser depois do início.", example: "2026-09-15 14:11:42" },
    ],
  },
  {
    name: "transcricoes",
    contractKey: "TRANSCRIPTS",
    contractVersion: 1,
    group: "Atendimentos",
    need: "Base",
    purpose: "O texto da gravação de cada atendimento. A INIA lê texto, não áudio: a gravação precisa estar transcrita.",
    grain: "atendimento e versão da transcrição",
    primaryKey: ["id_chamada", "versao"],
    readKeys: ["id_chamada", "versao"],
    columns: [
      idChamada("O atendimento desta transcrição. Precisa existir em chamadas."),
      { name: "versao", sqlType: "int", required: true, field: "version", description: "Versão da transcrição, a partir de 1. Reenviar a mesma versão substitui o texto.", example: 1 },
      { name: "conteudo", sqlType: "nvarchar(max)", required: true, field: "content", description: "Texto integral, sem resumo. O formato esperado é uma fala por linha, começando por Operador: ou Cliente:. Mínimo de 10 caracteres.", example: "Operador: Bom dia, em que posso ajudar?\nCliente: Preciso da segunda via da minha fatura." },
      { name: "idioma", sqlType: "varchar(16)", required: false, field: "language", description: "Idioma do texto. Vazio = pt-BR.", example: "pt-BR" },
      { name: "confianca", sqlType: "decimal(4,3)", required: false, field: "confidence", description: "Confiança da transcrição, de 0 a 1, se a ferramenta informar.", example: 0.94 },
    ],
  },
  {
    name: "flags_chamada",
    contractKey: "INTERACTION_FLAGS",
    contractVersion: 1,
    group: "Atendimentos",
    need: "Base",
    purpose: "Sinais já calculados pela origem sobre cada atendimento, como rechamada ou nota de URA. A INIA não calcula flags: ela recebe o valor pronto.",
    grain: "atendimento e flag",
    primaryKey: ["id_chamada", "flag"],
    readKeys: ["id_chamada", "flag"],
    columns: [
      idChamada("O atendimento deste sinal. Precisa existir em chamadas."),
      { name: "flag", sqlType: "varchar(64)", required: true, field: "flagName", description: "Nome da flag. Precisa estar cadastrada na INIA com o mesmo nome.", example: "rechamada" },
      { name: "valor", sqlType: "varchar(32)", required: true, field: "value", description: "true ou false nas flags de sim/não; um número nas flags numéricas.", example: "true" },
    ],
  },
  {
    name: "indicadores_diarios",
    contractKey: "INDICATOR_MEASUREMENTS",
    contractVersion: 1,
    group: "Indicadores",
    need: "Base",
    purpose: "O resultado de cada indicador por pessoa em cada dia. É o resultado daquele dia, nunca o acumulado do mês. A INIA calcula o período somando os dias.",
    grain: "colaborador, indicador e dia",
    primaryKey: ["matricula", "indicador", "data"],
    readKeys: ["matricula", "indicador", "data"],
    columns: [
      matricula("Matrícula do colaborador medido. Precisa existir em colaboradores."),
      indicador,
      { name: "data", sqlType: "date", required: true, field: "date", description: "O dia da medição, no calendário da operação.", example: "2026-09-15" },
      { name: "valor", sqlType: "decimal(18,4)", required: true, field: "value", description: "Resultado do dia, na unidade do indicador. Precisa bater com numerador ÷ denominador quando eles forem enviados.", example: 450 },
      { name: "numerador", sqlType: "decimal(18,4)", required: false, field: "numerator", description: "Total do dia, como os segundos falados no TMA. Exigido em indicadores de taxa e de média ponderada. Nos de soma, média simples e último valor, deixe vazio: a linha com numerador e denominador vai para a quarentena.", example: 8100 },
      { name: "denominador", sqlType: "decimal(18,4)", required: false, field: "denominator", description: "Base do dia, como os atendimentos no TMA. Exigido em indicadores de taxa e de média ponderada. Nos de soma, média simples e último valor, deixe vazio: a linha com numerador e denominador vai para a quarentena.", example: 18 },
      { name: "amostra", sqlType: "int", required: false, field: "sampleCount", description: "Quantidade de observações do dia, se existir.", example: 18 },
    ],
  },
  {
    name: "fechamentos_mensais",
    contractKey: "OFFICIAL_INDICATOR_PERFORMANCE",
    contractVersion: 2,
    group: "Indicadores",
    need: "Base",
    purpose: "O resultado oficial do mês por pessoa e indicador, já calculado pela origem. A INIA guarda como veio e nunca recalcula.",
    grain: "colaborador, indicador e mês",
    primaryKey: ["matricula", "indicador", "competencia"],
    readKeys: ["matricula", "indicador", "competencia"],
    columns: [
      matricula("Matrícula do colaborador. Precisa existir em colaboradores."),
      indicador,
      { name: "competencia", sqlType: "char(7)", required: true, field: "referencePeriod", description: "Mês de referência, no formato AAAA-MM.", example: "2026-08" },
      { name: "valor", sqlType: "decimal(18,4)", required: true, field: "value", description: "Resultado oficial do mês.", example: 468 },
      { name: "numerador", sqlType: "decimal(18,4)", required: false, field: "numerator", description: "Total do mês que gera o valor. Vem sempre junto com o denominador e precisa bater com o valor.", example: 380016 },
      { name: "denominador", sqlType: "decimal(18,4)", required: false, field: "denominator", description: "Base do mês, maior que zero. Vem sempre junto com o numerador.", example: 812 },
      { name: "meta", sqlType: "decimal(18,4)", required: false, field: "targetValue", description: "Meta oficial do mês.", example: 480 },
      { name: "atingimento", sqlType: "decimal(9,2)", required: false, field: "achievementPercent", description: "Atingimento oficial, em %.", example: 102.5 },
      { name: "peso", sqlType: "decimal(9,2)", required: false, field: "weightPercent", description: "Peso do indicador na composição do PRV, em %.", example: 25 },
      quartil(false, "Quartil oficial: Q1, Q2, Q3 ou Q4 (Q1 = melhor)."),
      subgrupo("Subgrupo de referência do fechamento. Vazio = subgrupo atual da pessoa."),
    ],
  },
  {
    name: "metas",
    contractKey: "GOALS",
    contractVersion: 1,
    group: "Indicadores",
    need: "Base",
    purpose: "A meta vigente de cada indicador para um grupo, um subgrupo ou uma pessoa.",
    grain: "indicador, sujeito e início de vigência",
    primaryKey: ["indicador", "tipo_sujeito", "sujeito", "inicio_vigencia"],
    readKeys: ["indicador", "sujeito", "inicio_vigencia"],
    columns: [
      indicador,
      { name: "tipo_sujeito", sqlType: "varchar(20)", required: true, field: "subjectType", description: "A quem a meta se aplica: GROUP, SUBGROUP ou EMPLOYEE.", example: "GROUP" },
      { name: "sujeito", sqlType: "varchar(128)", required: true, field: "subjectExternalCode", description: "Código do grupo ou do subgrupo, ou matrícula do colaborador.", example: "B2C_RETENCAO" },
      { name: "meta", sqlType: "decimal(18,4)", required: true, field: "targetValue", description: "Valor da meta, na unidade do indicador.", example: 480 },
      { name: "inicio_vigencia", sqlType: "date", required: true, field: "validFrom", description: "Primeiro dia em que a meta vale.", example: "2026-01-01" },
      { name: "fim_vigencia", sqlType: "date", required: false, field: "validUntil", description: "Último dia em que a meta vale. Vazio = sem fim definido.", example: "2026-12-31" },
    ],
  },
  {
    name: "prv_mensal",
    contractKey: "PRV_PERFORMANCE",
    contractVersion: 1,
    group: "Indicadores",
    need: "Complementar",
    purpose: "O atingimento consolidado do PRV por pessoa e mês, já calculado pela origem. A INIA nunca calcula o PRV.",
    grain: "colaborador e mês",
    primaryKey: ["matricula", "competencia"],
    readKeys: ["matricula", "competencia"],
    columns: [
      matricula("Matrícula do colaborador. Precisa existir em colaboradores."),
      { name: "competencia", sqlType: "char(7)", required: true, field: "referencePeriod", description: "Mês de referência, no formato AAAA-MM.", example: "2026-08" },
      { name: "atingimento", sqlType: "decimal(9,2)", required: true, field: "achievementPercent", description: "Atingimento consolidado oficial, em %.", example: 97.8 },
      quartil(true, "Quartil oficial do PRV: Q1, Q2, Q3 ou Q4 (Q1 = melhor)."),
      subgrupo("Subgrupo de referência. Vazio = subgrupo atual da pessoa."),
    ],
  },
  {
    name: "ausencias",
    contractKey: "EMPLOYEE_ABSENCES",
    contractVersion: 2,
    group: "Jornada e ausências",
    need: "Complementar",
    purpose: "Períodos de férias e afastamentos, para a INIA não tratar esses dias como falta de resultado.",
    grain: "colaborador, tipo e início",
    primaryKey: ["matricula", "tipo", "inicio"],
    readKeys: ["matricula", "tipo", "inicio"],
    columns: [
      matricula("Matrícula do colaborador. Precisa existir em colaboradores."),
      { name: "tipo", sqlType: "nvarchar(40)", required: true, field: "type", description: "FÉRIAS, INSS, MATERNIDADE, PATERNIDADE ou ATIVIDADE OFF. Códigos próprios podem ser convertidos na configuração.", example: "FÉRIAS" },
      { name: "inicio", sqlType: "date", required: true, field: "startDate", description: "Primeiro dia da ausência.", example: "2026-10-05" },
      { name: "fim", sqlType: "date", required: false, field: "endDate", description: "Último dia da ausência. Vazio = em aberto.", example: "2026-10-14" },
      { name: "vigente", sqlType: "bit", required: false, field: "active", description: "0 cancela a ausência que a INIA já recebeu. Vazio = vigente.", example: true },
    ],
  },
  {
    name: "escalas",
    contractKey: "WORK_SCHEDULE_DAYS",
    contractVersion: 1,
    group: "Jornada e ausências",
    need: "Complementar",
    purpose: "O calendário de quem deveria trabalhar em cada data. Sem esta tabela, a INIA não sabe onde cai a folga de quem trabalha em 6x1.",
    grain: "colaborador e data",
    primaryKey: ["matricula", "data"],
    readKeys: ["matricula", "data"],
    columns: [
      matricula("Matrícula do colaborador. Precisa existir em colaboradores."),
      { name: "data", sqlType: "date", required: true, field: "scheduleDate", description: "O dia do calendário. Dia sem linha não é folga: é um dia sem informação.", example: "2026-09-16" },
      { name: "trabalha", sqlType: "bit", required: true, field: "scheduledToWork", description: "1 = programado para trabalhar, 0 = folga programada.", example: true },
      { name: "inicio_do_turno", sqlType: "time(0)", required: false, field: "shiftStart", description: "Início do turno. Só quando trabalha.", example: "08:00:00" },
      { name: "fim_do_turno", sqlType: "time(0)", required: false, field: "shiftEnd", description: "Fim do turno. Só quando trabalha.", example: "14:20:00" },
      regime("Regime do dia: 5x2 ou 6x1. Só esses valores."),
    ],
  },
  {
    name: "excecoes_calendario",
    contractKey: "WORK_SCHEDULE_EXCEPTIONS",
    contractVersion: 1,
    group: "Jornada e ausências",
    need: "Complementar",
    purpose: "Dias que fogem da escala, como day off e banco de horas. A folga normal da escala não entra aqui.",
    grain: "colaborador, data e tipo",
    primaryKey: ["matricula", "data", "tipo_da_excecao"],
    readKeys: ["matricula", "data", "tipo_da_excecao"],
    columns: [
      matricula("Matrícula do colaborador. Precisa existir em colaboradores."),
      { name: "data", sqlType: "date", required: true, field: "date", description: "O dia da exceção.", example: "2026-09-23" },
      { name: "tipo_da_excecao", sqlType: "varchar(40)", required: true, field: "exceptionCode", description: "BANCO_HORAS, DAY_OFF, FOLGA_EXTRAORDINARIA, ATESTADO ou AJUSTE_ESCALA. Códigos próprios podem ser convertidos na configuração.", example: "BANCO_HORAS" },
      { name: "motivo", sqlType: "nvarchar(200)", required: false, field: "reason", description: "Texto original do motivo. Em atestado, só o motivo: nunca diagnóstico nem CID.", example: "Compensação de horas do sábado" },
      { name: "vigente", sqlType: "bit", required: false, field: "active", description: "0 cancela a exceção. Vazio = vigente.", example: true },
    ],
  },
  {
    name: "jornadas",
    contractKey: "WORK_SCHEDULES",
    contractVersion: 1,
    group: "Jornada e ausências",
    need: "Complementar",
    purpose: "O horário de entrada e a carga horária de cada pessoa, com vigência.",
    grain: "colaborador e início de vigência",
    primaryKey: ["matricula", "inicio_vigencia"],
    readKeys: ["matricula", "inicio_vigencia"],
    columns: [
      matricula("Matrícula do colaborador. Precisa existir em colaboradores."),
      { name: "hora_entrada", sqlType: "time(0)", required: true, field: "startTime", description: "Horário de entrada, no fuso da operação.", example: "08:00:00" },
      { name: "carga_minutos", sqlType: "int", required: true, field: "workMinutes", description: "Duração da jornada em minutos, de 1 a 1440.", example: 360 },
      { name: "inicio_vigencia", sqlType: "date", required: true, field: "effectiveFrom", description: "Primeiro dia em que a jornada vale.", example: "2026-01-01" },
      { name: "fim_vigencia", sqlType: "date", required: false, field: "effectiveTo", description: "Último dia em que a jornada vale. Vazio = sem fim definido.", example: "2026-12-31" },
      regime("Regime de escala: 5x2 ou 6x1. Só esses valores."),
    ],
  },
]

/**
 * Relação entre duas tabelas do cliente: a coluna de uma guarda o valor da chave primária de outra. O script não cria FOREIGN KEY;
 * quem confere é a carga da INIA, que recusa a linha com `rejection` quando o valor não existe. O teste do backend confere colunas,
 * tipos e códigos contra as tabelas, os contratos e os erros da carga.
 */
export type ClientRelation = {
  table: string
  column: string
  targetTable: string
  targetColumn: string
  rejection: string
  /** Só vale para parte das linhas. */
  condition?: string
  note?: string
}

const employeeRelation = (table: string): ClientRelation => ({ table, column: "matricula", targetTable: "colaboradores", targetColumn: "matricula", rejection: "DATA_EMPLOYEE_NOT_FOUND" })
const subgroupRelation = (table: string): ClientRelation => ({ table, column: "subgrupo", targetTable: "subgrupos", targetColumn: "codigo", rejection: "DATA_SUBGROUP_NOT_FOUND" })
const callRelation = (table: string): ClientRelation => ({ table, column: "id_chamada", targetTable: "chamadas", targetColumn: "id_chamada", rejection: "DATA_INTERACTION_NOT_FOUND" })

export const CLIENT_RELATIONS: ClientRelation[] = [
  { table: "subgrupos", column: "grupo", targetTable: "grupos", targetColumn: "codigo", rejection: "DATA_GROUP_NOT_FOUND" },
  { table: "colaboradores", column: "grupo", targetTable: "grupos", targetColumn: "codigo", rejection: "DATA_GROUP_NOT_FOUND" },
  { ...subgroupRelation("colaboradores"), note: "O subgrupo precisa ser do grupo informado na mesma linha." },
  { table: "colaboradores", column: "gestor_matricula", targetTable: "colaboradores", targetColumn: "matricula", rejection: "DATA_EMPLOYEE_NOT_FOUND", note: "O gestor pode vir na mesma carga. Ninguém reporta a si mesmo." },
  employeeRelation("chamadas"),
  callRelation("transcricoes"),
  callRelation("flags_chamada"),
  employeeRelation("indicadores_diarios"),
  employeeRelation("fechamentos_mensais"),
  subgroupRelation("fechamentos_mensais"),
  { table: "metas", column: "sujeito", targetTable: "grupos", targetColumn: "codigo", rejection: "DATA_GROUP_NOT_FOUND", condition: "tipo_sujeito = GROUP" },
  { table: "metas", column: "sujeito", targetTable: "subgrupos", targetColumn: "codigo", rejection: "DATA_SUBGROUP_NOT_FOUND", condition: "tipo_sujeito = SUBGROUP" },
  { table: "metas", column: "sujeito", targetTable: "colaboradores", targetColumn: "matricula", rejection: "DATA_EMPLOYEE_NOT_FOUND", condition: "tipo_sujeito = EMPLOYEE" },
  employeeRelation("prv_mensal"),
  subgroupRelation("prv_mensal"),
  employeeRelation("ausencias"),
  employeeRelation("escalas"),
  employeeRelation("excecoes_calendario"),
  employeeRelation("jornadas"),
]

/** Código que aponta para um cadastro da própria INIA: não há tabela dele no banco do cliente. */
export type ClientIniaReference = { table: string; column: string; catalog: string; rejection: string }

export const CLIENT_INIA_REFERENCES: ClientIniaReference[] = [
  { table: "indicadores_diarios", column: "indicador", catalog: "Indicadores", rejection: "DATA_INDICATOR_NOT_FOUND" },
  { table: "fechamentos_mensais", column: "indicador", catalog: "Indicadores", rejection: "DATA_INDICATOR_NOT_FOUND" },
  { table: "metas", column: "indicador", catalog: "Indicadores", rejection: "DATA_INDICATOR_NOT_FOUND" },
  { table: "flags_chamada", column: "flag", catalog: "Flags de canal", rejection: "DATA_FLAG_NOT_FOUND" },
]

/** Quando concatenar um código na chave. Trechos entre crases são nomes de coluna ou valores. */
export const CLIENT_KEY_RULES: { situation: string; rule: string; example: string }[] = [
  { situation: "O código da origem já é único sozinho", rule: "Use o código como ele é, sem concatenar.", example: "`colaboradores.matricula`, `chamadas.id_chamada`, `grupos.codigo`" },
  { situation: "A linha só é identificada por várias informações", rule: "Use chave composta, com uma coluna para cada parte. Não junte as partes em uma coluna.", example: "`indicadores_diarios`: `matricula` + `indicador` + `data`" },
  { situation: "O código só é único dentro de outro cadastro", rule: "Concatene na própria coluna do código, porque ela precisa ser única na organização inteira.", example: "`subgrupos.codigo` = `B2C_RETENCAO/PREMIUM`" },
  { situation: "O mesmo identificador pode se repetir entre sistemas de origem", rule: "Acrescente um prefixo do sistema, para o código continuar único.", example: "`chamadas.id_chamada` = `URA1-2026000123`" },
]

/** Por que uma chave composta não vira uma coluna concatenada. */
export const CLIENT_KEY_REASONS: string[] = [
  "A INIA confere cada parte separadamente. Com `matricula` e `indicador` juntos em uma coluna, ela não saberia se o colaborador e o indicador existem.",
  "Cada coluna vai para um campo próprio no mapeamento. Não existe campo para um valor concatenado nessas tabelas.",
  "As mesmas colunas ordenam a leitura e permitem retomar uma carga do ponto em que parou.",
]

/** Cuidados com o valor das chaves. */
export const CLIENT_KEY_CARE: string[] = [
  "O valor da chave estrangeira precisa ser idêntico ao da chave primária, inclusive maiúsculas e minúsculas. Se `subgrupos.codigo` é concatenado, `colaboradores.subgrupo`, `fechamentos_mensais.subgrupo`, `prv_mensal.subgrupo` e `metas.sujeito` trazem o mesmo valor concatenado.",
  "A barra em `B2C_RETENCAO/PREMIUM` é só uma convenção: a INIA não separa o código nas partes. O grupo vem na coluna `subgrupos.grupo`.",
  "A chave precisa ser estável. Se o código mudar, a INIA entende como um registro novo e o antigo continua lá.",
  "O script não cria `FOREIGN KEY`: a INIA confere cada relação na carga, e a linha que não encontra o registro vai para a quarentena com o motivo. Se o time de dados quiser criar no banco, os tipos já batem, menos em `metas.sujeito`, que aponta para três tabelas conforme `tipo_sujeito`.",
]

/** Colunas da tabela como ficam no banco: as de negócio e `atualizado_em` no fim. */
export function columnsOf(table: ClientTable): ClientColumn[] {
  return [...table.columns, updatedAtColumn]
}

function columnSql(table: ClientTable, column: ClientColumn): string {
  if (column.name === UPDATED_AT_COLUMN) return `  ${column.name} ${column.sqlType} NOT NULL CONSTRAINT df_${table.name}_${UPDATED_AT_COLUMN} DEFAULT SYSDATETIME()`
  return `  ${column.name} ${column.sqlType} ${column.required ? "NOT NULL" : "NULL"}`
}

/**
 * CREATE TABLE e índice de leitura de uma tabela. Os scripts não usam GO nem comentário de linha: se as quebras de linha se
 * perderem no caminho até o banco (já aconteceu), eles continuam rodando igual.
 */
export function createTableSql(table: ClientTable): string {
  const lines = [...columnsOf(table).map((column) => columnSql(table, column)), `  CONSTRAINT pk_${table.name} PRIMARY KEY (${table.primaryKey.join(", ")})`]
  return [
    `CREATE TABLE ${CLIENT_SCHEMA}.${table.name} (`,
    lines.join(",\n"),
    ");",
    `CREATE INDEX ix_${table.name}_leitura ON ${CLIENT_SCHEMA}.${table.name} (${[UPDATED_AT_COLUMN, ...table.readKeys].join(", ")});`,
  ].join("\n")
}

/** Script completo, pronto para rodar no SQL Server Management Studio ou no sqlcmd. */
export function clientTablesScript(): string {
  return [`IF SCHEMA_ID('${CLIENT_SCHEMA}') IS NULL EXEC('CREATE SCHEMA ${CLIENT_SCHEMA}');`, ...CLIENT_TABLES.map(createTableSql)].join("\n\n")
}

/** Usuário só de leitura, restrito ao schema da INIA. */
export function clientReaderScript(): string {
  return [
    `CREATE LOGIN ${CLIENT_READER_LOGIN} WITH PASSWORD = 'TROQUE_POR_UMA_SENHA_FORTE';`,
    `CREATE USER ${CLIENT_READER_LOGIN} FOR LOGIN ${CLIENT_READER_LOGIN};`,
    `GRANT SELECT ON SCHEMA::${CLIENT_SCHEMA} TO ${CLIENT_READER_LOGIN};`,
  ].join("\n")
}

/** Primeira leitura de `indicadores_diarios`. Um teste do backend confere este texto com o gerador de SQL da carga. */
export const EXAMPLE_FIRST_READ_SQL = `SET LOCK_TIMEOUT 10000; SELECT TOP (1001)
  [matricula], [indicador], [data], [valor], [numerador], [denominador], [amostra],
  CONVERT(nvarchar(64), [atualizado_em], 126) AS [__inia_p0],
  CAST([matricula] AS nvarchar(450)) AS [__inia_p1],
  CAST([indicador] AS nvarchar(450)) AS [__inia_p2],
  CONVERT(nvarchar(64), [data], 126) AS [__inia_p3]
FROM [inia].[indicadores_diarios]
WHERE [atualizado_em] IS NOT NULL
  AND [matricula] IS NOT NULL
  AND [indicador] IS NOT NULL
  AND [data] IS NOT NULL
ORDER BY [atualizado_em], [matricula], [indicador], [data]`

/** Trecho que a leitura seguinte acrescenta ao WHERE: continua depois da última linha lida. */
export const EXAMPLE_NEXT_READ_FILTER_SQL = `AND ([atualizado_em] > CAST(@p1 AS datetime2(3))
  OR ([atualizado_em] = CAST(@p2 AS datetime2(3))
    AND ([matricula] > CAST(@p3 AS varchar(64))
      OR ([matricula] = CAST(@p4 AS varchar(64))
        AND ([indicador] > CAST(@p5 AS varchar(40))
          OR ([indicador] = CAST(@p6 AS varchar(40))
            AND ([data] > CAST(@p7 AS date))))))))`
