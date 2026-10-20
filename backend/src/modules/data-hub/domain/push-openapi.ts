import type { DataContract, DataContractField } from "./data-contract.js"
import { DATA_RUN_ERROR_CODES } from "./error-codes.js"
import type { FeedMapping, Transform } from "./mapping.js"

/**
 * OpenAPI 3.1 da API Push de UMA fonte (B21): um caminho por feed de push, com o corpo descrito pelos nomes de campo DO CLIENTE
 * (o mapeamento do feed) e os tipos que o contrato espera. Gerado na hora a partir do que está configurado — nunca um arquivo
 * escrito à mão que envelhece. Não carrega segredo: o token vai no header e aparece só ao ser criado.
 */
export const PUSH_OPENAPI_VERSION = "PUSH_OPENAPI_V1"

export type PushOpenApiFeed = {
  feedKey: string
  name: string
  status: string
  extractPath: string
  mapping: FeedMapping
  contract: DataContract
}

export type PushOpenApiInput = {
  serverUrl: string
  source: { publicId: string; name: string }
  feeds: readonly PushOpenApiFeed[]
}

type JsonSchema = Record<string, unknown>

/** Transformações que fazem o valor chegar como TEXTO e virar o tipo do contrato do lado da INIA. */
const TEXT_TRANSFORMS = new Set<Transform["kind"]>(["PARSE_DATE", "PARSE_DECIMAL", "BOOLEAN_MAP", "CODE_MAP"])

function fieldSchema(field: DataContractField, transforms: readonly Transform[]): JsonSchema {
  const base: JsonSchema = { description: `${field.label} → ${field.key}. ${field.description}`.trim(), examples: [field.example] }
  const parse = transforms.find((transform) => TEXT_TRANSFORMS.has(transform.kind))
  if (parse) {
    const hint = parse.kind === "PARSE_DATE" ? ` Formato: ${parse.format}.` : parse.kind === "PARSE_DECIMAL" ? ` Separador decimal: "${parse.decimalSeparator}".` : parse.kind === "BOOLEAN_MAP" ? ` Verdadeiro: ${parse.trueValues.join(", ")}; falso: ${parse.falseValues.join(", ")}.` : " Código convertido pelo de-para do feed."
    return { ...base, type: "string", description: `${base.description}${hint}` }
  }
  switch (field.type) {
    case "INTEGER":
      return { ...base, type: ["integer", "string"] }
    case "DECIMAL":
      return { ...base, type: ["number", "string"] }
    case "BOOLEAN":
      return { ...base, type: ["boolean", "string"] }
    case "DATE":
      return { ...base, type: "string", format: "date" }
    case "DATETIME":
      return { ...base, type: "string", format: "date-time" }
    case "TIME":
      return { ...base, type: "string", pattern: "^\\d{2}:\\d{2}(:\\d{2})?$" }
    case "MONTH":
      return { ...base, type: "string", pattern: "^\\d{4}-\\d{2}$" }
    case "ENUM":
      return { ...base, type: "string", ...(field.enumValues ? { enum: [...field.enumValues] } : {}) }
    default:
      return { ...base, type: "string", ...(field.maxLength ? { maxLength: field.maxLength } : {}) }
  }
}

/** Corpo esperado de um feed: `{ <extractPath>: [ { <campo do cliente>: … } ] }`. Campo fixo (constante) não vem do cliente. */
export function pushRecordSchema(feed: PushOpenApiFeed): JsonSchema {
  const mapped = feed.mapping.fields.length > 0 ? feed.mapping.fields : feed.contract.fields.map((field) => ({ target: field.key, source: field.key, transforms: [] as Transform[] }))
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const nested: string[] = []
  for (const entry of mapped) {
    const field = feed.contract.fields.find((candidate) => candidate.key === entry.target)
    if (!field || !entry.source) continue
    // Caminho com ponto/colchete (`dados.cliente.id`): o OpenAPI não descreve isso como propriedade plana — fica na descrição.
    if (/[.[\]]/.test(entry.source)) {
      nested.push(`${entry.source} → ${field.key}`)
      continue
    }
    properties[entry.source] = fieldSchema(field, entry.transforms)
    const hasDefault = entry.transforms.some((transform) => transform.kind === "DEFAULT" || transform.kind === "CONSTANT")
    if (field.required && !hasDefault) required.push(entry.source)
  }
  const description = [
    `Contrato ${feed.contract.key}@${feed.contract.version} — ${feed.contract.label}.`,
    feed.contract.atLeastOne?.length ? `Ao menos um de cada grupo: ${feed.contract.atLeastOne.map((group) => group.join(" ou ")).join("; ")} (nomes do contrato).` : null,
    nested.length > 0 ? `Campos em caminho aninhado: ${nested.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ")
  return { type: "object", description, properties, ...(required.length > 0 ? { required } : {}), additionalProperties: true }
}

function bodySchema(feed: PushOpenApiFeed): JsonSchema {
  const record = pushRecordSchema(feed)
  const path = feed.extractPath.trim()
  const list: JsonSchema = { type: "array", minItems: 1, items: record }
  if (!path) return list
  // `a.b` → { a: { b: [ … ] } }
  return path
    .split(".")
    .reverse()
    .reduce<JsonSchema>((inner, key) => ({ type: "object", required: [key], properties: { [key]: inner } }), list)
}

function bodyExample(feed: PushOpenApiFeed): unknown {
  const mapped = feed.mapping.fields.length > 0 ? feed.mapping.fields : feed.contract.fields.map((field) => ({ target: field.key, source: field.key, transforms: [] as Transform[] }))
  const records = feed.contract.examples.slice(0, 2).map((example) =>
    Object.fromEntries(mapped.filter((entry) => entry.source && !/[.[\]]/.test(entry.source) && example[entry.target] !== undefined).map((entry) => [entry.source!, example[entry.target]])),
  )
  const path = feed.extractPath.trim()
  if (!path) return records
  return path
    .split(".")
    .reverse()
    .reduce<unknown>((inner, key) => ({ [key]: inner }), records)
}

const errorResponse = (description: string, codes: string[]) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
      examples: Object.fromEntries(codes.map((code) => [code, { value: { error: { code, message: (DATA_RUN_ERROR_CODES as Record<string, string>)[code] ?? description } } }])),
    },
  },
})

export function buildPushOpenApi(input: PushOpenApiInput): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const feed of input.feeds) {
    paths[`/api/v1/data-ingestion/${input.source.publicId}/${feed.feedKey}`] = {
      post: {
        operationId: `push_${feed.feedKey.replace(/[^A-Za-z0-9_]/g, "_")}`,
        summary: `${feed.name} (${feed.contract.label})`,
        description: [
          `Envia um lote de ${feed.contract.label.toLowerCase()} para a INIA. Processamento assíncrono: a resposta 202 traz o id da carga.`,
          feed.status !== "ACTIVE" ? `Atenção: este feed está ${feed.status} — envios recebem 409 até ele ser ativado.` : null,
          "Mesma Idempotency-Key com o mesmo corpo devolve a mesma carga (deduplicated: true); com outro corpo, 422.",
        ]
          .filter(Boolean)
          .join(" "),
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: { "application/json": { schema: bodySchema(feed), example: bodyExample(feed) } } },
        responses: {
          "202": { description: "Lote recebido e enfileirado.", content: { "application/json": { schema: { $ref: "#/components/schemas/Accepted" } } } },
          "401": errorResponse("Token ausente, inválido, revogado, vencido ou usado fora dos IPs autorizados (a mensagem é a mesma de propósito).", ["DATA_PUSH_UNAUTHORIZED"]),
          "409": errorResponse("Fonte pausada ou feed inativo.", []),
          "413": { description: "Corpo maior que 10 MB." },
          "422": errorResponse("Corpo vazio ou Idempotency-Key repetida com outro conteúdo.", ["DATA_PUSH_EMPTY_BODY", "DATA_PUSH_IDEMPOTENCY_CONFLICT"]),
          "429": { description: "Limite por token excedido (60 por minuto). Respeite o header Retry-After.", headers: { "Retry-After": { schema: { type: "integer" } } } },
        },
      },
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: `INIA — API Push — ${input.source.name}`,
      version: PUSH_OPENAPI_VERSION,
      description:
        "Gerado pela INIA a partir dos feeds de push desta fonte e do contrato de cada um. O token é criado na tela da fonte (Central de Dados) e aparece uma única vez; ele pode ter validade e IPs autorizados.",
    },
    servers: [{ url: input.serverUrl }],
    security: [{ pushToken: [] }],
    paths,
    components: {
      securitySchemes: { pushToken: { type: "http", scheme: "bearer", description: "Token de push da fonte (inia_push_…)." } },
      parameters: {
        IdempotencyKey: { name: "Idempotency-Key", in: "header", required: false, description: "Identificador do lote (até 200 caracteres). Recomendado: reenviar com a mesma chave nunca duplica.", schema: { type: "string", maxLength: 200 } },
      },
      schemas: {
        Accepted: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: { runId: { type: "string", format: "uuid" }, status: { type: "string" }, deduplicated: { type: "boolean" }, feedKey: { type: "string" }, contract: { type: "string", examples: ["INTERACTIONS@2"] } },
              required: ["runId", "status", "deduplicated", "feedKey", "contract"],
            },
          },
          required: ["data"],
        },
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } }, required: ["error"] },
      },
    },
  }
}
