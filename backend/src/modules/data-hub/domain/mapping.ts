import { z } from "zod"
import type { CanonicalRecord, DataContract, DataContractField } from "./data-contract.js"
import type { RecordError } from "./error-codes.js"

/**
 * Mapping — "como o formato do cliente vira o formato da INIA".
 *
 * Declarativo e determinístico: campo de origem (coluna ou dot path JSON) → campo do contrato,
 * com transformações simples e seguras. NUNCA JavaScript arbitrário, eval ou expressão
 * executável; NUNCA IA para sugerir coluna (a sugestão automática é por nome, e o usuário
 * confirma).
 */
export const DATE_FORMATS = ["ISO", "dd/MM/yyyy", "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy HH:mm", "MM/dd/yyyy", "yyyyMMdd", "yyyy-MM-dd HH:mm:ss"] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export const transformSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TRIM") }),
  z.object({ kind: z.literal("UPPERCASE") }),
  z.object({ kind: z.literal("LOWERCASE") }),
  z.object({ kind: z.literal("PARSE_DATE"), format: z.enum(DATE_FORMATS) }),
  z.object({ kind: z.literal("PARSE_DECIMAL"), decimalSeparator: z.enum([".", ","]) }),
  z.object({ kind: z.literal("BOOLEAN_MAP"), trueValues: z.array(z.string()).min(1), falseValues: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("DEFAULT"), value: z.string() }),
  z.object({ kind: z.literal("CONSTANT"), value: z.string() }),
  z.object({ kind: z.literal("CODE_MAP"), map: z.record(z.string(), z.string()), otherwise: z.enum(["KEEP", "EMPTY"]).default("KEEP") }),
])
export type Transform = z.infer<typeof transformSchema>

export const fieldMappingSchema = z.object({
  target: z.string().min(1),
  /** Nome da coluna (CSV/Excel) ou dot path (JSON: `data.items[0].id`). `null` = só constante/default. */
  source: z.string().min(1).nullable(),
  transforms: z.array(transformSchema).default([]),
})
export type FieldMapping = z.infer<typeof fieldMappingSchema>

export const feedMappingSchema = z.object({
  fields: z.array(fieldMappingSchema).default([]),
  /** Fuso para interpretar data/hora SEM offset (padrão: fuso da organização em tempo de execução). */
  timeZone: z.string().min(1).optional(),
})
export type FeedMapping = z.infer<typeof feedMappingSchema>

export type SourceRecord = Record<string, unknown>
export type MappedValue = string | number | boolean | null

// ---------------------------------------------------------------------------------------------
// Extração do valor de origem
// ---------------------------------------------------------------------------------------------
/** `a.b[0].c` sobre um objeto; coluna simples é só a chave. Nunca executa nada. */
export function extractPath(record: SourceRecord, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, path)) return record[path]
  const parts = path.split(".").flatMap((segment) => {
    const tokens: (string | number)[] = []
    const regex = /([^[\]]+)|\[(\d+)\]/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(segment)) !== null) {
      if (match[1] !== undefined) tokens.push(match[1])
      else if (match[2] !== undefined) tokens.push(Number(match[2]))
    }
    return tokens
  })
  let current: unknown = record
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof part === "number") {
      if (!Array.isArray(current)) return undefined
      current = current[part]
    } else {
      if (typeof current !== "object") return undefined
      current = (current as Record<string, unknown>)[part]
    }
  }
  return current
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
}

// ---------------------------------------------------------------------------------------------
// Transformações
// ---------------------------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0")

/** Devolve `AAAA-MM-DD` ou `AAAA-MM-DDTHH:mm:ss` (sem fuso; quem interpreta é a coerção do tipo). */
export function parseDateWithFormat(raw: string, format: DateFormat): string | null {
  const value = raw.trim()
  const dmY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  switch (format) {
    case "ISO":
      return value
    case "dd/MM/yyyy":
    case "dd/MM/yyyy HH:mm":
    case "dd/MM/yyyy HH:mm:ss": {
      const match = dmY.exec(value)
      if (!match) return null
      const [, day, month, year, hour, minute, second] = match
      const date = `${year}-${pad(Number(month))}-${pad(Number(day))}`
      if (hour === undefined) return date
      return `${date}T${pad(Number(hour))}:${minute}:${second ?? "00"}`
    }
    case "MM/dd/yyyy": {
      const match = mdY.exec(value)
      if (!match) return null
      const [, month, day, year] = match
      return `${year}-${pad(Number(month))}-${pad(Number(day))}`
    }
    case "yyyyMMdd": {
      const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
      if (!match) return null
      return `${match[1]}-${match[2]}-${match[3]}`
    }
    case "yyyy-MM-dd HH:mm:ss": {
      const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value)
      if (!match) return null
      return `${match[1]}T${match[2]}`
    }
  }
}

export function parseDecimal(raw: string, decimalSeparator: "." | ","): number | null {
  let text = raw.trim().replace(/\s/g, "")
  if (decimalSeparator === ",") text = text.replace(/\./g, "").replace(",", ".")
  else text = text.replace(/,/g, "")
  if (!/^[-+]?\d*(\.\d+)?$/.test(text) || text === "" || text === "-" || text === "+") return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** Decimal sem formato declarado: `1.234,56` e `123,45` são BR; `1,234.56` e `123.45` são EN. */
export function parseDecimalAuto(raw: string): number | null {
  const text = raw.trim()
  const lastComma = text.lastIndexOf(",")
  const lastDot = text.lastIndexOf(".")
  if (lastComma === -1 && lastDot === -1) return parseDecimal(text, ".")
  if (lastComma > lastDot) return parseDecimal(text, ",")
  return parseDecimal(text, ".")
}

export function applyTransforms(value: unknown, transforms: readonly Transform[]): { value: MappedValue; error: string | null } {
  let current: MappedValue = value === undefined ? null : (value as MappedValue)
  if (typeof current === "object" && current !== null) current = JSON.stringify(current)
  for (const transform of transforms) {
    switch (transform.kind) {
      case "CONSTANT":
        current = transform.value
        break
      case "DEFAULT":
        if (isEmpty(current)) current = transform.value
        break
      case "TRIM":
        if (typeof current === "string") current = current.trim()
        break
      case "UPPERCASE":
        if (typeof current === "string") current = current.toUpperCase()
        break
      case "LOWERCASE":
        if (typeof current === "string") current = current.toLowerCase()
        break
      case "PARSE_DATE": {
        if (isEmpty(current)) break
        if (typeof current !== "string") current = String(current)
        const parsed = parseDateWithFormat(current, transform.format)
        if (parsed === null) return { value: current, error: `Data "${current}" não segue o formato ${transform.format}.` }
        current = parsed
        break
      }
      case "PARSE_DECIMAL": {
        if (isEmpty(current)) break
        if (typeof current === "number") break
        const parsed = parseDecimal(String(current), transform.decimalSeparator)
        if (parsed === null) return { value: current, error: `Número "${current}" inválido para separador "${transform.decimalSeparator}".` }
        current = parsed
        break
      }
      case "BOOLEAN_MAP": {
        if (isEmpty(current) || typeof current === "boolean") break
        const text = String(current).trim().toLowerCase()
        if (transform.trueValues.some((candidate) => candidate.toLowerCase() === text)) current = true
        else if (transform.falseValues.some((candidate) => candidate.toLowerCase() === text)) current = false
        else return { value: current, error: `Valor "${current}" não está entre os valores verdadeiro/falso configurados.` }
        break
      }
      case "CODE_MAP": {
        if (isEmpty(current)) break
        const text = String(current)
        if (Object.prototype.hasOwnProperty.call(transform.map, text)) current = transform.map[text]!
        else if (transform.otherwise === "EMPTY") current = null
        break
      }
    }
  }
  if (typeof current === "string" && current.trim() === "") current = null
  return { value: current, error: null }
}

// ---------------------------------------------------------------------------------------------
// Coerção para o tipo do contrato
// ---------------------------------------------------------------------------------------------
const BOOLEAN_TRUE = new Set(["true", "1", "sim", "s", "yes", "y", "verdadeiro", "ativo"])
const BOOLEAN_FALSE = new Set(["false", "0", "nao", "não", "n", "no", "falso", "inativo"])

export type CoercionContext = { timeZone: string }

/** Instante ISO (UTC) de uma data/hora local sem offset — só usado quando a origem não informa fuso. */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?)?$/.exec(local)
  if (!match) return null
  const [, y, mo, d, h = "00", mi = "00", s = "00", fraction] = match
  // Frações de segundo (banco externo: datetime2/timestamp(6)) — milissegundos preservados, o resto truncado.
  const milliseconds = fraction ? Number(fraction.slice(1, 4).padEnd(3, "0")) : 0
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (Number.isNaN(guess)) return null
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const asLocal = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  }
  // Offset do fuso naquele instante (duas iterações cobrem transições de horário de verão).
  let instant = guess - (asLocal(guess) - guess)
  instant = guess - (asLocal(instant) - instant)
  return new Date(instant + milliseconds).toISOString()
}

function coerce(field: DataContractField, value: MappedValue, context: CoercionContext): { value: MappedValue; error: RecordError | null } {
  if (value === null) return { value: null, error: null }
  const fail = (code: RecordError["code"], message: string): { value: MappedValue; error: RecordError } => ({ value: null, error: { code, field: field.key, message } })
  switch (field.type) {
    case "STRING": {
      const text = typeof value === "string" ? value.trim() : String(value)
      if (field.maxLength && text.length > field.maxLength) return fail("DATA_TYPE_INVALID", `Texto excede ${field.maxLength} caracteres.`)
      return { value: text, error: null }
    }
    case "INTEGER": {
      const number = typeof value === "number" ? value : parseDecimalAuto(String(value))
      if (number === null || !Number.isInteger(number)) return fail("DATA_INVALID_NUMBER", `"${value}" não é um número inteiro.`)
      return { value: number, error: null }
    }
    case "DECIMAL": {
      const number = typeof value === "number" ? value : parseDecimalAuto(String(value))
      if (number === null) return fail("DATA_INVALID_NUMBER", `"${value}" não é um número.`)
      return { value: number, error: null }
    }
    case "BOOLEAN": {
      if (typeof value === "boolean") return { value, error: null }
      const text = String(value).trim().toLowerCase()
      if (BOOLEAN_TRUE.has(text)) return { value: true, error: null }
      if (BOOLEAN_FALSE.has(text)) return { value: false, error: null }
      return fail("DATA_TYPE_INVALID", `"${value}" não é um booleano reconhecido (use sim/não, true/false, 1/0).`)
    }
    case "DATE": {
      const text = typeof value === "string" ? value.trim() : String(value)
      const iso = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(text)?.[1] ?? parseDateWithFormat(text, "dd/MM/yyyy")?.slice(0, 10) ?? null
      if (!iso || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return fail("DATA_INVALID_DATE", `"${value}" não é uma data válida (use AAAA-MM-DD ou configure o formato).`)
      return { value: iso, error: null }
    }
    case "DATETIME": {
      const text = typeof value === "string" ? value.trim() : String(value)
      const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(text)
      if (hasOffset) {
        const parsed = Date.parse(text)
        if (Number.isNaN(parsed)) return fail("DATA_INVALID_DATE", `"${value}" não é uma data/hora válida.`)
        return { value: new Date(parsed).toISOString(), error: null }
      }
      const local = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?$/.test(text) ? text : parseDateWithFormat(text, "dd/MM/yyyy HH:mm:ss")
      const iso = local ? zonedLocalToIso(local, context.timeZone) : null
      if (!iso) return fail("DATA_INVALID_DATE", `"${value}" não é uma data/hora válida (use ISO 8601 ou configure o formato).`)
      return { value: iso, error: null }
    }
    case "TIME": {
      const text = typeof value === "string" ? value.trim() : String(value)
      const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text)
      if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return fail("DATA_TYPE_INVALID", `"${value}" não é um horário HH:mm.`)
      return { value: `${pad(Number(match[1]))}:${match[2]}`, error: null }
    }
    case "MONTH": {
      const text = typeof value === "string" ? value.trim() : String(value)
      const iso = /^(\d{4}-\d{2})(?:-\d{2})?$/.exec(text)?.[1] ?? /^(\d{2})\/(\d{4})$/.exec(text)?.slice(1).reverse().join("-") ?? null
      if (!iso || Number(iso.slice(5)) < 1 || Number(iso.slice(5)) > 12) return fail("DATA_INVALID_DATE", `"${value}" não é uma competência AAAA-MM.`)
      return { value: iso, error: null }
    }
    case "ENUM": {
      const text = String(value).trim().toUpperCase()
      if (!field.enumValues?.includes(text)) return fail("DATA_INVALID_ENUM", `"${value}" não está entre: ${field.enumValues?.join(", ")}.`)
      return { value: text, error: null }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Aplicação do mapping + validação estrutural do contrato
// ---------------------------------------------------------------------------------------------
export type MappedRecordResult = { record: CanonicalRecord; errors: RecordError[] }

export function mapRecord(contract: DataContract, mapping: FeedMapping, source: SourceRecord, context: CoercionContext): MappedRecordResult {
  const record: CanonicalRecord = {}
  const errors: RecordError[] = []
  const byTarget = new Map(mapping.fields.map((field) => [field.target, field]))

  for (const field of contract.fields) {
    const fieldMapping = byTarget.get(field.key)
    let value: MappedValue = null
    if (fieldMapping) {
      const raw = fieldMapping.source ? extractPath(source, fieldMapping.source) : null
      const transformed = applyTransforms(raw, fieldMapping.transforms)
      if (transformed.error) {
        errors.push({ code: field.type === "DATE" || field.type === "DATETIME" ? "DATA_INVALID_DATE" : "DATA_TYPE_INVALID", field: field.key, message: transformed.error })
        record[field.key] = null
        continue
      }
      const coerced = coerce(field, transformed.value, context)
      if (coerced.error) errors.push(coerced.error)
      value = coerced.value
    }
    record[field.key] = value
    if (field.required && value === null && !errors.some((error) => error.field === field.key)) {
      errors.push({ code: "DATA_REQUIRED_FIELD_MISSING", field: field.key, message: `${field.label} é obrigatório.` })
    }
  }

  for (const group of contract.atLeastOne ?? []) {
    if (!group.some((key) => record[key] !== null && record[key] !== undefined)) {
      errors.push({ code: "DATA_REQUIRED_FIELD_MISSING", field: group[0] ?? null, message: `Informe ao menos um de: ${group.join(", ")}.` })
    }
  }

  if (errors.length === 0 && contract.validateRecord) errors.push(...contract.validateRecord(record))
  return { record, errors }
}

/** Problemas do mapping em si (antes de qualquer registro): obrigatórios sem origem, alvo inexistente. */
export function validateMapping(contract: DataContract, mapping: FeedMapping): string[] {
  const problems: string[] = []
  const targets = new Set(contract.fields.map((field) => field.key))
  for (const field of mapping.fields) {
    if (!targets.has(field.target)) problems.push(`Campo "${field.target}" não existe no contrato ${contract.key}.`)
    if (field.source === null && !field.transforms.some((transform) => transform.kind === "CONSTANT" || transform.kind === "DEFAULT")) {
      problems.push(`Campo "${field.target}" sem origem precisa de um valor fixo ou padrão.`)
    }
  }
  const mapped = new Set(mapping.fields.map((field) => field.target))
  for (const field of contract.fields) {
    if (field.required && !mapped.has(field.key)) problems.push(`Campo obrigatório "${field.label}" (${field.key}) não está mapeado.`)
  }
  for (const group of contract.atLeastOne ?? []) {
    if (!group.some((key) => mapped.has(key))) problems.push(`Mapeie ao menos um de: ${group.join(", ")}.`)
  }
  return problems
}

// ---------------------------------------------------------------------------------------------
// Sugestão automática (determinística, por nome — o usuário confirma)
// ---------------------------------------------------------------------------------------------
const SYNONYMS: Record<string, string[]> = {
  externalEmployeeId: ["matricula", "matriculacolaborador", "idcolaborador", "employeeid", "idfuncionario", "funcionario", "operador", "idoperador", "colaboradorid", "login", "re"],
  name: ["nome", "nomecolaborador", "nomecompleto", "colaborador", "fullname"],
  role: ["nivel", "nivelhierarquico", "papel", "perfil", "funcao", "cargo_plataforma", "platformrole"],
  jobTitle: ["cargo", "titulo", "jobtitle", "posicao"],
  groupExternalCode: ["grupo", "codigogrupo", "codgrupo", "team", "teamcode", "equipe", "operacao", "celula"],
  subgroupExternalCode: ["subgrupo", "codigosubgrupo", "codsubgrupo", "subteam", "subteamcode", "subequipe"],
  reportsToExternalId: ["gestor", "matriculagestor", "gestormatricula", "supervisor", "matriculasupervisor", "reportsto", "lider", "managerid", "idgestor"],
  hiredAt: ["admissao", "dataadmissao", "hiredat", "dtadmissao"],
  active: ["ativo", "situacao", "status", "active"],
  email: ["email", "emailacesso", "usuario"],
  externalCode: ["codigo", "cod", "code", "id", "externalcode"],
  operationName: ["operacao", "operation"],
  startTime: ["entrada", "horaentrada", "inicio", "horainicio", "starttime"],
  workMinutes: ["cargahoraria", "minutos", "jornada", "workminutes", "cargaminutos"],
  effectiveFrom: ["vigenciainicio", "iniciovigencia", "effectivefrom", "de"],
  effectiveTo: ["vigenciafim", "fimvigencia", "effectiveto", "ate"],
  indicatorCode: ["indicador", "codigoindicador", "codindicador", "indicator", "kpi", "metrica"],
  subjectType: ["tiposujeito", "tipo", "subjecttype", "nivel"],
  subjectExternalCode: ["sujeito", "codigosujeito", "subject", "alvo"],
  targetValue: ["meta", "target", "valormeta", "objetivo"],
  validFrom: ["validade_inicio", "validfrom", "vigencia", "iniciovigencia"],
  validUntil: ["validade_fim", "validuntil", "fimvigencia"],
  date: ["data", "dia", "date", "datareferencia", "dtreferencia", "competenciadia"],
  periodStart: ["periodoinicio", "inicioperiodo", "periodstart", "datainicio"],
  periodEnd: ["periodofim", "fimperiodo", "periodend", "datafim"],
  granularity: ["granularidade", "granularity"],
  value: ["valor", "value", "resultado", "medicao"],
  numerator: ["numerador", "numerator", "total", "ocorrencias", "soma"],
  denominator: ["denominador", "denominator", "volume", "elegiveis", "base", "quantidade"],
  sampleCount: ["amostra", "samplecount", "qtdamostra", "observacoes", "n"],
  referencePeriod: ["competencia", "mes", "mesreferencia", "referencia", "periodo", "referenceperiod", "anomes"],
  achievementPercent: ["atingimento", "atingimentopercentual", "achievement", "pctatingimento", "percentual"],
  weightPercent: ["peso", "weight", "pesopercentual"],
  quartile: ["quartil", "quartile"],
  externalInteractionId: ["idinteracao", "interacao", "protocolo", "callid", "idchamada", "chamada", "interactionid", "ucid"],
  channel: ["canal", "channel"],
  reason: ["motivo", "assunto", "razao", "reason", "tipochamada"],
  startedAt: ["inicio", "datainicio", "horainicio", "startedat", "inicioatendimento"],
  endedAt: ["fim", "datafim", "horafim", "endedat", "fimatendimento", "termino"],
  transcriptContent: ["transcricao", "transcript", "texto", "conteudo"],
  transcriptLanguage: ["idioma", "language", "lingua"],
  transcriptConfidence: ["confianca", "confidence"],
  content: ["conteudo", "texto", "transcricao", "transcript", "content"],
  version: ["versao", "version"],
  language: ["idioma", "language", "lingua"],
  confidence: ["confianca", "confidence"],
  flagName: ["flag", "nomeflag", "sinal", "flagname"],
}

export function normalizeColumnName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Os valores de amostra cabem no tipo do campo? (sim/não, data, número, opção…). Usado só para NÃO sugerir uma
 * associação cujos valores claramente não são daquele campo — ex.: coluna "situacao" com EM_PRODUCAO/FERIAS não vira
 * o campo sim/não "Ativo". Texto aceita qualquer valor.
 */
export function sampleFitsField(field: DataContractField, values: readonly unknown[], timeZone = "UTC"): boolean {
  if (field.type === "STRING") return true
  const present = values.filter((value) => !isEmpty(value)).slice(0, 50)
  if (present.length === 0) return true
  return present.every((value) => {
    const transformed = applyTransforms(value, [])
    return !transformed.error && !coerce(field, transformed.value, { timeZone }).error
  })
}

/** Sugestão de mapping por nome (exato normalizado, depois sinônimos), conferida contra os valores da amostra. Nunca IA. */
export function suggestMapping(contract: DataContract, sourceColumns: readonly string[], sampleRecords: readonly SourceRecord[] = []): FeedMapping {
  const normalized = sourceColumns.map((column) => ({ column, key: normalizeColumnName(column) }))
  const used = new Set<string>()
  const fields: FieldMapping[] = []
  for (const field of contract.fields) {
    const candidates = [normalizeColumnName(field.key), normalizeColumnName(field.label), ...(SYNONYMS[field.key] ?? []).map(normalizeColumnName)]
    const match = candidates
      .flatMap((candidate) => normalized.filter((entry) => entry.key === candidate && !used.has(entry.column)))
      .find((entry) => sampleFitsField(field, sampleRecords.map((record) => extractPath(record, entry.column))))
    if (!match) continue
    used.add(match.column)
    fields.push({ target: field.key, source: match.column, transforms: field.type === "STRING" ? [{ kind: "TRIM" }] : [] })
  }
  return { fields }
}
