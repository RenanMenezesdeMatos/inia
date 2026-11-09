import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { EXPLORER_DATASETS, findExplorerDataset } from "./explorer-catalog.js"
import { compileCountQuery, compileExportQuery, compilePageQuery } from "./explorer-compiler.js"
import { decodeExplorerCursor, encodeExplorerCursor } from "./explorer-cursor.js"
import { explorerLimitsFrom } from "./explorer-limits.js"
import { filterColumnsOf, parseExplorerRequest, resolveExplorerQuery, resolvePageSize } from "./explorer-query.js"

const limits = explorerLimitsFrom({ DATA_EXPLORER_DEFAULT_PAGE_SIZE: 25, DATA_EXPLORER_MAX_PAGE_SIZE: 100, DATA_EXPLORER_QUERY_TIMEOUT_MS: 5_000, DATA_EXPLORER_CANCEL_MAX_ROWS: 10_000, DATA_EXPLORER_COUNT_CAP: 10_000, DATA_EXPLORER_EXPORT_MAX_ROWS: 20_000, DATA_EXPLORER_EXPORT_MAX_BYTES: 20_971_520, DATA_EXPLORER_EXPORT_MAX_DURATION_MS: 60_000 })
const ORG = "00000000-0000-4000-8000-000000000001"
const interactions = findExplorerDataset("interactions")!
const collaborators = findExplorerDataset("collaborators")!

const resolve = (body: Record<string, unknown>, dataset = interactions) => resolveExplorerQuery(parseExplorerRequest({ dataset: dataset.code, ...body }), dataset, limits)
const page = (body: Record<string, unknown>, dataset = interactions) => compilePageQuery(resolve(body, dataset), { organizationId: ORG, timeZone: "America/Fortaleza", pageSize: 25, cursor: null })
const where = (...children: unknown[]) => ({ type: "group", logic: "AND", children })
const condition = (column: string, operator: string, extra: Record<string, unknown> = {}) => ({ type: "condition", column, operator, ...extra })

const codeOf = (action: () => unknown): string | null => {
  try {
    action()
    return null
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
}

describe("forma do pedido", () => {
  it.each([
    [{ dataset: "interactions", organizationId: "00000000-0000-4000-8000-000000000002" }],
    [{ dataset: "interactions", table: "user_accounts" }],
    [{ dataset: "interactions", sql: "select 1" }],
    [{ dataset: "user_accounts; drop table people" }],
    [{ dataset: "INTERACTIONS" }],
    [{ dataset: "interactions", columns: ["name; drop table people"] }],
    [{ dataset: "interactions", columns: ["\"password_hash\""] }],
    [{ dataset: "interactions", sort: { column: "started_at", direction: "DESC; drop table people" } }],
    [{ dataset: "interactions", sort: { column: "started_at", direction: "DESC", nulls: "FIRST" } }],
    [{ dataset: "interactions", pageSize: "100" }],
    [{ dataset: "interactions", pageSize: -1 }],
    [null],
    [[]],
  ])("recusa %j", (body) => {
    expect(codeOf(() => parseExplorerRequest(body))).toBe("DATA_EXPLORER_INVALID_REQUEST")
  })
})

describe("identificadores só pelos metadados", () => {
  it.each(["password_hash", "email", "content", "operator_id", "organization_id", "constructor", "__proto__", "tostring"])("coluna %s é recusada em seleção, filtro e ordenação", (column) => {
    const shaped = /^[a-z][a-z0-9_]*$/.test(column)
    if (shaped) {
      expect(codeOf(() => resolve({ columns: [column] }))).toBe("DATA_EXPLORER_COLUMN_NOT_ALLOWED")
      expect(codeOf(() => resolve({ sort: { column, direction: "ASC" } }))).toBe("DATA_EXPLORER_COLUMN_NOT_ALLOWED")
    }
    expect(codeOf(() => resolve({ filter: where(condition(column, "EQ", { value: "x" })) }))).toBe("DATA_EXPLORER_COLUMN_NOT_ALLOWED")
  })

  it("coluna sem filtro ou sem ordenação é recusada", () => {
    expect(codeOf(() => resolve({ sort: { column: "reason", direction: "ASC" } }))).toBe("DATA_EXPLORER_SORT_NOT_ALLOWED")
    expect(codeOf(() => resolveExplorerQuery(parseExplorerRequest({ dataset: "transcripts", filter: where(condition("characters", "GT", { value: 1 })) }), findExplorerDataset("transcripts")!, limits))).toBe("DATA_EXPLORER_FILTER_NOT_ALLOWED")
  })

  it("operador fora da tabela do tipo é recusado", () => {
    expect(codeOf(() => resolve({ filter: where(condition("reason", "GT", { value: "a" })) }))).toBe("DATA_EXPLORER_OPERATOR_NOT_ALLOWED")
    expect(codeOf(() => resolve({ filter: where(condition("started_at", "IN", { values: ["2026-01-01"] })) }))).toBe("DATA_EXPLORER_OPERATOR_NOT_ALLOWED")
    expect(codeOf(() => resolve({ filter: where(condition("reason", "DROP", { value: "a" })) }))).toBe("DATA_EXPLORER_OPERATOR_NOT_ALLOWED")
    expect(codeOf(() => resolve({ filter: where(condition("reason", 1 as unknown as string, { value: "a" })) }))).toBe("DATA_EXPLORER_OPERATOR_NOT_ALLOWED")
  })
})

describe("nenhum valor entra no texto do SQL", () => {
  const ATTACK = `x'; drop table people; --`
  const everyColumnSql = EXPLORER_DATASETS.flatMap((dataset) => dataset.columns)

  it("filtro de texto, lista, busca e posição vão só como parâmetro", () => {
    const query = resolve({ filter: where(condition("reason", "EQ", { value: ATTACK }), condition("protocol", "IN", { values: [ATTACK, "b"] })), search: ATTACK })
    const cursorSort = "2026-01-01 00:00:00+00"
    const cursorKey = "00000000-0000-4000-8000-000000000009"
    const compiled = compilePageQuery(query, { organizationId: ORG, timeZone: "America/Fortaleza", pageSize: 25, cursor: { sort: cursorSort, key: cursorKey } })
    expect(compiled.sql).not.toContain("drop table")
    expect(compiled.sql).not.toContain(ATTACK)
    expect(compiled.sql).not.toContain(cursorKey)
    expect(compiled.params).toContain(ATTACK)
    expect(compiled.params).toContainEqual([ATTACK, "b"])
    expect(compiled.params).toContain(cursorSort)
  })

  it("começa sempre pela organização vinda de fora do pedido, nas três formas", () => {
    const query = resolve({ filter: where(condition("reason", "EQ", { value: "a" })) })
    const compiled = [compilePageQuery(query, { organizationId: ORG, timeZone: "UTC", pageSize: 25, cursor: null }), compileCountQuery(query, { organizationId: ORG, timeZone: "UTC", cap: 10 }), compileExportQuery(query, { organizationId: ORG, timeZone: "UTC", maxRows: 10 })]
    for (const { sql, params } of compiled) {
      expect(sql).toMatch(/where t\.organization_id = \$1::uuid/)
      expect(params[0]).toBe(ORG)
    }
  })

  it("só produz SELECT, com um único comando e com LIMIT", () => {
    for (const dataset of EXPLORER_DATASETS) {
      const query = resolveExplorerQuery(parseExplorerRequest({ dataset: dataset.code }), dataset, limits)
      for (const { sql } of [compilePageQuery(query, { organizationId: ORG, timeZone: "UTC", pageSize: 25, cursor: null }), compileCountQuery(query, { organizationId: ORG, timeZone: "UTC", cap: 10 }), compileExportQuery(query, { organizationId: ORG, timeZone: "UTC", maxRows: 10 })]) {
        expect(sql.startsWith("select ")).toBe(true)
        expect(sql).not.toContain(";")
        expect(sql).toMatch(/limit \$\d+::int/)
        expect(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy)\b/i.test(sql), `${dataset.code}: ${sql}`).toBe(false)
      }
    }
    expect(everyColumnSql.length).toBeGreaterThan(100)
  })

  it("texto na busca escapa os curingas do LIKE", () => {
    const compiled = page({ search: "50%_a" }, collaborators)
    expect(compiled.params).toContain("%50\\%\\_a%")
  })

  it("apelidos de saída são fixos, nunca nascem do pedido", () => {
    expect(page({ columns: ["protocol", "reason"] }).sql).toMatch(/as c0, .* as c1, /)
  })
})

describe("valores conferidos pelo tipo", () => {
  it.each([
    ["started_at", "EQ", { value: "2026-02-30" }],
    ["started_at", "EQ", { value: "2026-01-01' or 1=1 --" }],
    ["started_at", "BETWEEN", { values: ["2026-02-01", "2026-01-01"] }],
    ["started_at", "BETWEEN", { values: ["2026-01-01"] }],
    ["reason", "EQ", { value: "" }],
    ["reason", "EQ", { value: "a\u0000b" }],
    ["reason", "EQ", { value: "x".repeat(201) }],
    ["reason", "EQ", { value: 1 }],
    ["reason", "IN", { values: [] }],
    ["reason", "IN", { value: "a" }],
    ["reason", "EQ", {}],
  ])("%s %s %j é recusado", (column, operator, extra) => {
    expect(codeOf(() => resolve({ filter: where(condition(column, operator, extra)) }))).toBe("DATA_EXPLORER_INVALID_VALUE")
  })

  it("número fora do formato é recusado", () => {
    const dataset = findExplorerDataset("indicator_measurements")!
    for (const value of ["1e9", "1; drop table", "NaN", "Infinity", "", "1".repeat(30)]) {
      expect(codeOf(() => resolve({ filter: where(condition("value", "GT", { value })) }, dataset)), value).toBe("DATA_EXPLORER_INVALID_VALUE")
    }
    expect(codeOf(() => resolve({ filter: where(condition("value", "BETWEEN", { values: ["9", "1"] })) }, dataset))).toBe("DATA_EXPLORER_INVALID_VALUE")
    expect(codeOf(() => resolve({ filter: where(condition("value", "GT", { value: -1.5 })) }, dataset))).toBeNull()
  })

  it("lista fechada só aceita as opções, e o valor mascarado não vira filtro", () => {
    expect(codeOf(() => resolve({ filter: where(condition("employment_status", "EQ", { value: "INSS" })) }, collaborators))).toBe("DATA_EXPLORER_INVALID_VALUE")
    expect(codeOf(() => resolve({ filter: where(condition("employment_status", "IN", { values: ["MATERNIDADE"] })) }, collaborators))).toBe("DATA_EXPLORER_INVALID_VALUE")
    expect(codeOf(() => resolve({ filter: where(condition("employment_status", "EQ", { value: "AFASTAMENTO_PROTEGIDO" })) }, collaborators))).toBeNull()
  })

  it("instante recebe dia civil e vira intervalo no fuso da organização, usando a mesma coluna", () => {
    const compiled = compilePageQuery(resolve({ filter: where(condition("started_at", "EQ", { value: "2026-03-09" })) }), { organizationId: ORG, timeZone: "America/Sao_Paulo", pageSize: 25, cursor: null })
    expect(compiled.sql).toMatch(/t\.started_at >= \(\(\$2::date\)::timestamp at time zone \$3\) and t\.started_at < \(\(\$4::date \+ 1\)::timestamp at time zone \$5\)/)
    expect(compiled.params).toEqual([ORG, "2026-03-09", "America/Sao_Paulo", "2026-03-09", "America/Sao_Paulo", 26])
  })
})

describe("limites do pedido", () => {
  it("tamanho de página acima do máximo é recusado, nunca reduzido em silêncio", () => {
    expect(codeOf(() => resolvePageSize(parseExplorerRequest({ dataset: "interactions", pageSize: 101 }), limits))).toBe("DATA_EXPLORER_PAGE_SIZE_EXCEEDED")
    expect(resolvePageSize(parseExplorerRequest({ dataset: "interactions" }), limits)).toBe(25)
    expect(resolvePageSize(parseExplorerRequest({ dataset: "interactions", pageSize: 100 }), limits)).toBe(100)
  })

  it("quantidade de condições e de colunas", () => {
    const many = Array.from({ length: limits.maxFilterConditions + 1 }, () => condition("reason", "EQ", { value: "a" }))
    expect(codeOf(() => resolve({ filter: where(...many) }))).toBe("DATA_EXPLORER_FILTER_LIMIT")
    expect(codeOf(() => resolve({ filter: where(...many.slice(1)) }))).toBeNull()
    expect(codeOf(() => resolve({ columns: [] }))).toBe("DATA_EXPLORER_NO_COLUMNS")
    expect(codeOf(() => resolve({ columns: Array.from({ length: limits.maxSelectedColumns + 1 }, () => "reason") }))).toBe("DATA_EXPLORER_TOO_MANY_COLUMNS")
  })

  it("profundidade: até 3 níveis; mais que isso recusa sem estourar a pilha", () => {
    const nested = (levels: number): unknown => (levels === 1 ? where(condition("reason", "EQ", { value: "a" })) : { type: "group", logic: "OR", children: [nested(levels - 1)] })
    expect(codeOf(() => resolve({ filter: nested(limits.maxFilterDepth) }))).toBeNull()
    expect(codeOf(() => resolve({ filter: nested(limits.maxFilterDepth + 1) }))).toBe("DATA_EXPLORER_FILTER_LIMIT")
    // Corpo montado à mão, muito além do que a tela envia.
    let deep: unknown = condition("reason", "EQ", { value: "a" })
    for (let index = 0; index < 50_000; index += 1) deep = { type: "group", logic: "AND", children: [deep] }
    expect(codeOf(() => resolve({ filter: deep }))).toBe("DATA_EXPLORER_FILTER_LIMIT")
  })

  it("lista de valores e busca", () => {
    expect(codeOf(() => resolve({ filter: where(condition("reason", "IN", { values: Array.from({ length: limits.maxListValues + 1 }, (_, index) => `v${index}`) })) }))).toBe("DATA_EXPLORER_LIST_LIMIT")
    expect(codeOf(() => resolve({ search: "a" }))).toBe("DATA_EXPLORER_SEARCH_LENGTH")
    expect(codeOf(() => resolve({ search: "a".repeat(limits.maxSearchLength + 1) }))).toBe("DATA_EXPLORER_SEARCH_LENGTH")
  })

  it("grupo vazio, condição solta na raiz e campo extra são recusados", () => {
    expect(codeOf(() => resolve({ filter: where() }))).toBe("DATA_EXPLORER_INVALID_REQUEST")
    expect(codeOf(() => resolve({ filter: condition("reason", "EQ", { value: "a" }) }))).toBe("DATA_EXPLORER_INVALID_REQUEST")
    expect(codeOf(() => resolve({ filter: where(condition("reason", "EQ", { value: "a", raw: "1=1" })) }))).toBe("DATA_EXPLORER_INVALID_REQUEST")
    expect(codeOf(() => resolve({ filter: { type: "group", logic: "XOR", children: [condition("reason", "EQ", { value: "a" })] } }))).toBe("DATA_EXPLORER_INVALID_REQUEST")
  })

  it("auditoria recebe só as colunas das condições, nunca os valores", () => {
    const query = resolve({ filter: where(condition("reason", "EQ", { value: "cpf 123" }), { type: "group", logic: "OR", children: [condition("protocol", "EQ", { value: "p-1" })] }) })
    expect(filterColumnsOf(query.filter).sort()).toEqual(["protocol", "reason"])
    expect(JSON.stringify(filterColumnsOf(query.filter))).not.toContain("cpf 123")
  })
})

describe("posição da página", () => {
  const query = resolve({})

  it("ida e volta preserva microssegundos", () => {
    const position = { sort: "2026-10-06 14:05:00.123456+00", key: "00000000-0000-4000-8000-000000000009" }
    expect(decodeExplorerCursor(query, encodeExplorerCursor(query, position))).toEqual(position)
  })

  it("não serve em outra ordenação nem em outro conjunto", () => {
    const encoded = encodeExplorerCursor(query, { sort: "2026-10-06 14:05:00+00", key: "00000000-0000-4000-8000-000000000009" })
    expect(codeOf(() => decodeExplorerCursor(resolve({ sort: { column: "started_at", direction: "ASC" } }), encoded))).toBe("DATA_EXPLORER_INVALID_CURSOR")
    expect(codeOf(() => decodeExplorerCursor(resolve({}, findExplorerDataset("transcripts")!), encoded))).toBe("DATA_EXPLORER_INVALID_CURSOR")
  })

  it.each([
    ["não é base64 de JSON", "isto não é posição"],
    ["valor com injeção", (fingerprintOf: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: "2026-01-01'; drop table people; --", k: "00000000-0000-4000-8000-000000000009" })).toString("base64url")],
    ["chave com injeção", (fingerprintOf: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: "2026-01-01 00:00:00+00", k: "1 or 1=1" })).toString("base64url")],
    ["vazio em coluna obrigatória", (fingerprintOf: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: null, k: "00000000-0000-4000-8000-000000000009" })).toString("base64url")],
    ["data que não existe", (fingerprintOf: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: "2026-99-99 12:00:00+00", k: "00000000-0000-4000-8000-000000000009" })).toString("base64url")],
    ["dia que não existe no mês", (fingerprintOf: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: "2026-02-30 12:00:00+00", k: "00000000-0000-4000-8000-000000000009" })).toString("base64url")],
    ["hora que não existe", (fingerprintOf: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: "2026-02-20 99:00:00+00", k: "00000000-0000-4000-8000-000000000009" })).toString("base64url")],
  ])("recusa %s", (_label, build) => {
    const valid = JSON.parse(Buffer.from(encodeExplorerCursor(query, { sort: "2026-10-06 14:05:00+00", key: "00000000-0000-4000-8000-000000000009" }), "base64url").toString()) as { f: string }
    const raw = typeof build === "string" ? build : build(valid.f)
    expect(codeOf(() => decodeExplorerCursor(query, raw))).toBe("DATA_EXPLORER_INVALID_CURSOR")
  })

  it("chave numérica fora do bigint é recusada, e data antiga de verdade continua valendo", () => {
    const usage = findExplorerDataset("ai_usage")!
    const usageQuery = resolve({}, usage)
    const fingerprintOf = (JSON.parse(Buffer.from(encodeExplorerCursor(usageQuery, { sort: "2026-10-06 14:05:00+00", key: "1" }), "base64url").toString()) as { f: string }).f
    const raw = (k: string) => Buffer.from(JSON.stringify({ f: fingerprintOf, s: "2026-10-06 14:05:00+00", k })).toString("base64url")
    expect(codeOf(() => decodeExplorerCursor(usageQuery, raw("9999999999999999999")))).toBe("DATA_EXPLORER_INVALID_CURSOR")
    expect(decodeExplorerCursor(usageQuery, raw("9223372036854775807")).key).toBe("9223372036854775807")
    const oldDate = "1899-12-31 00:00:00+00"
    expect(decodeExplorerCursor(query, encodeExplorerCursor(query, { sort: oldDate, key: "00000000-0000-4000-8000-000000000009" })).sort).toBe(oldDate)
  })

  it("coluna que aceita vazio usa os dois ramos; coluna obrigatória compara por linha", () => {
    const required = compilePageQuery(query, { organizationId: ORG, timeZone: "UTC", pageSize: 25, cursor: { sort: "2026-10-06 14:05:00+00", key: "00000000-0000-4000-8000-000000000009" } })
    expect(required.sql).toMatch(/\(t\.started_at, t\.id\) < \(\$\d::timestamptz, \$\d::uuid\)/)
    const nullable = resolve({ sort: { column: "matricula", direction: "ASC" } }, collaborators)
    const afterValue = compilePageQuery(nullable, { organizationId: ORG, timeZone: "UTC", pageSize: 25, cursor: { sort: "M1", key: "00000000-0000-4000-8000-000000000009" } })
    expect(afterValue.sql).toMatch(/\(\(t\.matricula, t\.id\) > \(\$\d::text, \$\d::uuid\) or t\.matricula is null\)/)
    const afterNull = compilePageQuery(nullable, { organizationId: ORG, timeZone: "UTC", pageSize: 25, cursor: { sort: null, key: "00000000-0000-4000-8000-000000000009" } })
    expect(afterNull.sql).toMatch(/\(t\.matricula is null and t\.id > \$\d::uuid\)/)
  })
})
