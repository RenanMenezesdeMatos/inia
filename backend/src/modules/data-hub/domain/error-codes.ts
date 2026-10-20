/**
 * Códigos estáveis de erro da Central de Dados — o que a UI agrupa ("800 × EMPLOYEE_NOT_FOUND")
 * e o que o Run guarda como causa. Convenção do projeto: código em MAIÚSCULO com prefixo do
 * domínio (`DATA_*`), mensagem em português para o usuário.
 *
 * Dois grupos: erros de EXECUÇÃO (fonte/conexão/esquema — encerram ou reprogramam o Run) e
 * erros de REGISTRO (uma linha vai para a quarentena, o Run continua).
 */
export const DATA_RUN_ERROR_CODES = {
  DATA_SOURCE_AUTH_FAILED: "Falha de autenticação na fonte.",
  DATA_SOURCE_UNREACHABLE: "Não foi possível alcançar a fonte.",
  DATA_SOURCE_TIMEOUT: "A fonte demorou demais para responder.",
  DATA_SOURCE_RESPONSE_INVALID: "A fonte respondeu com um formato inesperado.",
  DATA_SOURCE_TLS_FAILED: "Falha na conexão segura (TLS/certificado) com a fonte.",
  DATA_SOURCE_PERMISSION_DENIED: "O usuário da fonte não tem permissão para ler estes dados.",
  DATA_SOURCE_NOT_FOUND: "Banco de dados, instância, tabela ou visão não encontrado na fonte.",
  DATA_SOURCE_VOLUME_LIMIT: "O volume lido passou do limite configurado para esta carga.",
  DATA_SOURCE_DESTINATION_DENIED: "O endereço da fonte não é permitido pela política de destinos do servidor da INIA.",
  DATA_SCHEMA_CHANGED: "A estrutura dos dados de origem mudou e um campo obrigatório deixou de existir.",
  DATA_MAPPING_INVALID: "O mapeamento do feed está incompleto ou inválido.",
  DATA_FILE_INVALID: "O arquivo não pôde ser lido.",
  DATA_FILE_ALREADY_PROCESSED: "Este arquivo já foi processado anteriormente.",
  DATA_RAW_EXPIRED: "O conteúdo bruto desta carga já foi descartado pela retenção.",
  DATA_CONTRACT_UNKNOWN: "Contrato de dados desconhecido.",
  DATA_FEED_INACTIVE: "O feed não está ativo.",
  DATA_RUN_ATOMIC_REJECTED: "Contrato atômico: nenhum registro foi aplicado porque houve rejeições.",
  DATA_NO_VALID_RECORDS: "Nenhum registro da carga é válido.",
  DATA_INTERNAL_ERROR: "Erro interno ao processar a carga.",
} as const
export type DataRunErrorCode = keyof typeof DATA_RUN_ERROR_CODES

export const DATA_RECORD_ERROR_CODES = {
  DATA_REQUIRED_FIELD_MISSING: "Campo obrigatório ausente.",
  DATA_TYPE_INVALID: "Valor com tipo inválido.",
  DATA_INVALID_DATE: "Data inválida.",
  DATA_INVALID_NUMBER: "Número inválido.",
  DATA_INVALID_ENUM: "Valor fora das opções permitidas.",
  DATA_REFERENCE_NOT_FOUND: "Referência não encontrada na INIA.",
  DATA_EMPLOYEE_NOT_FOUND: "Colaborador não encontrado.",
  DATA_INDICATOR_NOT_FOUND: "Indicador não encontrado ou inativo.",
  DATA_GROUP_NOT_FOUND: "Grupo não encontrado.",
  DATA_SUBGROUP_NOT_FOUND: "Subgrupo não encontrado.",
  DATA_INTERACTION_NOT_FOUND: "Interação não encontrada.",
  DATA_FLAG_NOT_FOUND: "Flag de canal não cadastrada.",
  DATA_DUPLICATE: "Registro duplicado dentro da mesma carga.",
  DATA_CONTRACT_VIOLATION: "O registro viola uma regra do contrato.",
  DATA_INDICATOR_CAPABILITY: "O indicador não suporta esta granularidade/capacidade.",
  DATA_COMPONENT_MISSING: "Componente exigido pela estratégia do indicador ausente.",
  /** Aviso (não rejeição): a situação funcional recebida conflitou com um período existente e a precedência decidiu. */
  DATA_EMPLOYMENT_STATUS_UNKNOWN: "Situação funcional não reconhecida — a INIA nunca converte desconhecido em 'em produção'; mapeie o valor da fonte com 'Mapear códigos'.",
  DATA_EMPLOYMENT_STATUS_CONFLICT: "Conflito de situação funcional resolvido pela precedência de evidência (registro aplicado; veja a mensagem).",
  /** Aviso (não rejeição): a exceção de calendário recebida diverge do que o Supervisor registrou/cancelou — mantido o registro do Supervisor, nada sobrescrito em silêncio. */
  DATA_SCHEDULE_EXCEPTION_CONFLICT: "Conflito entre a exceção de calendário da Central e a registrada pelo Supervisor (mantido o registro do Supervisor; veja a mensagem).",
  /** Aviso (não rejeição): a matrícula nova foi gravada na pessoa cadastrada à mão cuja conta de login tem o e-mail do registro — nenhuma pessoa nova. */
  DATA_PERSON_LINKED_BY_EMAIL: "Matrícula ligada pela conta de login (mesmo e-mail) a uma pessoa já cadastrada na INIA sem matrícula (registro aplicado; veja a mensagem).",
  /** Aviso (não rejeição): a pessoa ligada pelo e-mail foi para outro Grupo/nível de liderança — o acesso foi desabilitado até quem tem custódia liberar de novo. */
  DATA_PERSON_LINK_ACCESS_DISABLED: "Pessoa ligada pelo e-mail foi para outro Grupo ou nível de liderança: o acesso foi desabilitado até quem administra o lugar novo liberar de novo (registro aplicado; veja a mensagem).",
  /** Aviso (não rejeição): pessoa nova com o mesmo nome de uma pessoa ativa sem matrícula — a INIA nunca junta por nome. */
  DATA_POSSIBLE_DUPLICATE_PERSON: "Possível pessoa duplicada: mesmo nome de uma pessoa cadastrada na INIA sem matrícula (registro aplicado; a INIA não junta por nome).",
} as const

/** Códigos que registram um AVISO rastreável na quarentena sem contar o registro como rejeitado. */
export const WARNING_RECORD_ERROR_CODES: ReadonlySet<DataRecordErrorCode> = new Set(["DATA_EMPLOYMENT_STATUS_CONFLICT", "DATA_SCHEDULE_EXCEPTION_CONFLICT", "DATA_PERSON_LINKED_BY_EMAIL", "DATA_PERSON_LINK_ACCESS_DISABLED", "DATA_POSSIBLE_DUPLICATE_PERSON"])
export type DataRecordErrorCode = keyof typeof DATA_RECORD_ERROR_CODES

/** Erros de execução que valem retry com backoff (transitórios). Os demais são definitivos. */
export const TRANSIENT_RUN_ERROR_CODES: ReadonlySet<DataRunErrorCode> = new Set(["DATA_SOURCE_UNREACHABLE", "DATA_SOURCE_TIMEOUT"])

export function describeErrorCode(code: string): string {
  return (DATA_RUN_ERROR_CODES as Record<string, string>)[code] ?? (DATA_RECORD_ERROR_CODES as Record<string, string>)[code] ?? code
}

/** Erro de execução do Run — carrega o código estável e se é transitório. */
export class DataRunError extends Error {
  constructor(
    readonly code: DataRunErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? DATA_RUN_ERROR_CODES[code])
    this.name = "DataRunError"
  }

  get transient(): boolean {
    return TRANSIENT_RUN_ERROR_CODES.has(this.code)
  }
}

/** Erro de um registro individual — vai para a quarentena, nunca derruba a carga inteira. */
export type RecordError = { code: DataRecordErrorCode; field: string | null; message: string }
