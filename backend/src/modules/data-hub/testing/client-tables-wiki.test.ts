import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { DATA_CONTRACTS, requireDataContract } from "../domain/contract-registry.js"
import { DATABASE_BATCH_SIZE_DEFAULT, DATABASE_MAX_ROWS_PER_RUN_DEFAULT } from "../domain/database/database-sync.js"
import { DATA_RECORD_ERROR_CODES } from "../domain/error-codes.js"
import { dialectFor } from "../domain/database/sql-dialect.js"
import { mapRecord, suggestMapping, type SourceRecord } from "../domain/mapping.js"
import { retryDelayMs } from "../domain/run-status.js"
import { CLIENT_DATABASE_PAGE, loadClientTablesSpec, specColumn, type ClientTablesSpec, type SpecTable } from "./client-tables-spec.js"

/**
 * A página da Wiki que vai para o time de dados do cliente diz a verdade? Confere o SQL e cada campo contra o registro de
 * contratos, o mapeamento sugerido e o gerador de SQL da carga. A prova em banco real é `client-tables-proof`.
 */
const TIME_ZONE = "America/Fortaleza"
/** Colunas sem correspondência automática por nome: associadas à mão na tela. */
const MANUAL_COLUMNS = new Set(["colaboradores.situacao_funcional", "ausencias.tipo"])
/** Estes contratos não têm tabela própria: os vínculos já vêm em `colaboradores`. */
const CONTRACTS_WITHOUT_TABLE = new Set(["ORGANIZATIONAL_STRUCTURE"])

const collapse = (sql: string) => sql.replace(/\s+/g, " ").trim()

let spec: ClientTablesSpec

/** O exemplo como a carga recebe: a leitura do banco entrega data e hora com "T" (`normalizeDatabaseRow`). */
function exampleRecord(table: SpecTable): SourceRecord {
  return Object.fromEntries(spec.columnsOf(table).map((column) => [column.name, column.sqlType.startsWith("datetime2") && typeof column.example === "string" ? column.example.replace(" ", "T") : column.example]))
}

function mappingOf(table: SpecTable) {
  return { fields: table.columns.filter((column) => column.field).map((column) => ({ target: column.field!, source: column.name, transforms: [] })) }
}

describe("Tabelas no banco do cliente (Wiki) × contratos da INIA", () => {
  beforeAll(async () => {
    spec = await loadClientTablesSpec()
  })

  it("todo contrato tem tabela, na versão atual, e cada tabela aponta para um contrato real", () => {
    const documented = spec.CLIENT_TABLES.map((table) => table.contractKey)
    expect(new Set(documented).size).toBe(documented.length)
    expect([...documented].sort()).toEqual(DATA_CONTRACTS.map((contract) => contract.key).filter((key) => !CONTRACTS_WITHOUT_TABLE.has(key)).sort())
    for (const table of spec.CLIENT_TABLES) expect(table.contractVersion, table.name).toBe(requireDataContract(table.contractKey).version)
  })

  it("cada campo existe no contrato, todo campo obrigatório tem coluna NOT NULL, e os tamanhos cabem no contrato", () => {
    for (const table of spec.CLIENT_TABLES) {
      const contract = requireDataContract(table.contractKey)
      const fields = new Map(contract.fields.map((field) => [field.key, field]))
      const byField = new Map(table.columns.filter((column) => column.field).map((column) => [column.field!, column]))
      expect(byField.size, `${table.name}: dois campos na mesma coluna do contrato`).toBe(table.columns.filter((column) => column.field).length)
      for (const column of table.columns) {
        const field = fields.get(column.field ?? "")
        expect(field, `${table.name}.${column.name} → ${column.field}`).toBeDefined()
        const length = /^n?(?:var)?char\((\d+)\)$/.exec(column.sqlType)?.[1]
        if (length && field?.maxLength) expect(Number(length), `${table.name}.${column.name}`).toBeLessThanOrEqual(field.maxLength)
        if (field?.type === "ENUM") for (const value of field.enumValues ?? []) expect(column.description, `${table.name}.${column.name}`).toContain(value)
        expect(column.description.length, `${table.name}.${column.name} sem explicação`).toBeGreaterThan(5)
      }
      for (const field of contract.fields.filter((candidate) => candidate.required)) expect(byField.get(field.key)?.required, `${table.name}: ${field.key} obrigatório`).toBe(true)
      for (const group of contract.atLeastOne ?? []) expect(group.some((key) => byField.has(key)), `${table.name}: ${group.join("/")}`).toBe(true)
    }
  })

  it("as chaves existem, a leitura usa no máximo 3 colunas de desempate e toda coluna de chave é obrigatória", () => {
    for (const table of spec.CLIENT_TABLES) {
      const columns = new Map(table.columns.map((column) => [column.name, column]))
      expect(table.readKeys.length, table.name).toBeLessThanOrEqual(3)
      for (const key of [...table.primaryKey, ...table.readKeys]) expect(columns.get(key)?.required, `${table.name}.${key}`).toBe(true)
      for (const key of table.readKeys) expect(specColumn(columns.get(key)!).keyEligible, `${table.name}.${key}`).toBe(true)
    }
  })

  it("os nomes das colunas caem sozinhos no mapeamento sugerido, salvo as associadas à mão", () => {
    for (const table of spec.CLIENT_TABLES) {
      const contract = requireDataContract(table.contractKey)
      const suggested = suggestMapping(contract, spec.columnsOf(table).map((column) => column.name), [exampleRecord(table)])
      const byTarget = new Map(suggested.fields.map((field) => [field.target, field.source]))
      for (const column of table.columns) {
        const id = `${table.name}.${column.name}`
        if (MANUAL_COLUMNS.has(id)) expect(byTarget.has(column.field!), `${id} agora é sugerida: tire da lista manual`).toBe(false)
        else expect(byTarget.get(column.field!), id).toBe(column.name)
      }
    }
  })

  it("o exemplo de cada campo passa pelo mapeamento e pelas regras do contrato", () => {
    for (const table of spec.CLIENT_TABLES) {
      const contract = requireDataContract(table.contractKey)
      const mapped = mapRecord(contract, mappingOf(table), exampleRecord(table), { timeZone: TIME_ZONE })
      expect(mapped.errors, table.name).toEqual([])
      expect(contract.validateRecord?.(mapped.record) ?? [], table.name).toEqual([])
    }
  })

  it("o SQL mostrado na página é o que o gerador da carga produz", () => {
    const table = spec.CLIENT_TABLES.find((candidate) => candidate.name === "indicadores_diarios")!
    const columns = new Map(spec.columnsOf(table).map((column) => [column.name, specColumn(column)]))
    const query = {
      object: { schema: spec.CLIENT_SCHEMA, name: table.name },
      select: table.columns.map((column) => columns.get(column.name)!),
      order: [spec.UPDATED_AT_COLUMN, ...table.readKeys].map((name) => columns.get(name)!),
      limit: DATABASE_BATCH_SIZE_DEFAULT + 1,
    }
    const dialect = dialectFor("SQLSERVER")
    expect(collapse(spec.EXAMPLE_FIRST_READ_SQL)).toBe(`SET LOCK_TIMEOUT 10000; ${dialect.page({ ...query, after: null }).sql}`)
    const next = dialect.page({ ...query, after: ["2026-09-16T06:10:00", "OP-10234", "TMA", "2026-09-15"] }).sql
    expect(next).toContain(collapse(spec.EXAMPLE_NEXT_READ_FILTER_SQL))
    const session = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../infrastructure/external-databases/sqlserver-session.ts"), "utf8")
    expect(session).toContain("SET LOCK_TIMEOUT 10000;")
  })

  it("os scripts continuam válidos sem quebras de linha: nada de GO nem de comentário de linha", () => {
    for (const script of [spec.clientTablesScript(), spec.clientReaderScript()]) {
      expect(script).not.toMatch(/^\s*GO\s*$/im)
      expect(script).not.toContain("--")
      // Sem as quebras, nenhuma instrução pode colar na seguinte nem duas palavras podem virar uma.
      for (const line of script.split("\n").filter((candidate) => candidate.trim())) expect(line.trimEnd(), line).toMatch(/^\s|[;,(]$|^CREATE TABLE/)
    }
  })

  it("os números da página são os que a carga usa", () => {
    const page = readFileSync(CLIENT_DATABASE_PAGE, "utf8")
    const format = (value: number) => value.toLocaleString("pt-BR")
    expect(page).toContain(`Páginas de ${format(DATABASE_BATCH_SIZE_DEFAULT)} linhas`)
    expect(page).toContain(`até ${format(DATABASE_MAX_ROWS_PER_RUN_DEFAULT)} linhas por carga`)
    const waits: number[] = []
    for (let attempt = 1; retryDelayMs("SCHEDULE", attempt) !== null; attempt += 1) waits.push(retryDelayMs("SCHEDULE", attempt)! / 60_000)
    expect(page).toContain(`${waits.slice(0, -1).join(", ")} e ${waits.at(-1)} minutos`)
  })

  // ---- DER: chaves primárias e estrangeiras --------------------------------------------------
  const tableNamed = (name: string) => spec.CLIENT_TABLES.find((table) => table.name === name)!

  it("cada relação liga colunas reais à chave primária da outra tabela, com o mesmo tipo", () => {
    for (const relation of spec.CLIENT_RELATIONS) {
      const id = `${relation.table}.${relation.column} → ${relation.targetTable}.${relation.targetColumn}`
      const column = tableNamed(relation.table).columns.find((entry) => entry.name === relation.column)
      const target = tableNamed(relation.targetTable)
      expect(column, id).toBeDefined()
      expect(target.primaryKey, id).toEqual([relation.targetColumn])
      expect(Object.keys(DATA_RECORD_ERROR_CODES), id).toContain(relation.rejection)
      // A página diz que os tipos já batem para quem quiser criar FOREIGN KEY; a condicional aponta para três tabelas.
      if (!relation.condition) expect(column!.sqlType, id).toBe(target.columns.find((entry) => entry.name === relation.targetColumn)!.sqlType)
    }
  })

  it("nenhuma coluna que aponta para outra tabela ou cadastro fica fora do DER", () => {
    const REFERENCE_FIELDS = new Set(["externalEmployeeId", "reportsToExternalId", "groupExternalCode", "subgroupExternalCode", "externalInteractionId", "subjectExternalCode"])
    const CATALOG_FIELDS = new Set(["indicatorCode", "flagName"])
    for (const table of spec.CLIENT_TABLES) {
      for (const column of table.columns) {
        const id = `${table.name}.${column.name}`
        if (CATALOG_FIELDS.has(column.field ?? "")) expect(spec.CLIENT_INIA_REFERENCES.some((reference) => reference.table === table.name && reference.column === column.name), id).toBe(true)
        if (!REFERENCE_FIELDS.has(column.field ?? "")) continue
        const ownIdentity = table.primaryKey.length === 1 && table.primaryKey[0] === column.name
        if (!ownIdentity) expect(spec.CLIENT_RELATIONS.some((relation) => relation.table === table.name && relation.column === column.name), id).toBe(true)
      }
    }
  })

  it("a chave primária de cada tabela é a identidade do contrato, e a carga recusa o que o DER diz", () => {
    /** Em medições, o dia vira o período na carga: a identidade do contrato guarda início e fim. */
    const DERIVED_IDENTITY = new Set(["indicadores_diarios.data"])
    for (const table of spec.CLIENT_TABLES) {
      const contract = requireDataContract(table.contractKey, table.contractVersion)
      for (const key of table.primaryKey) {
        const column = table.columns.find((entry) => entry.name === key)!
        if (!DERIVED_IDENTITY.has(`${table.name}.${key}`)) expect(contract.naturalKey, `${table.name}.${key}`).toContain(column.field)
      }
    }
    const writers = ["master-data-writers.ts", "interaction-writers.ts", "performance-writers.ts"].map((file) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../application/writers", file), "utf8")).join("\n")
    for (const { rejection } of [...spec.CLIENT_RELATIONS, ...spec.CLIENT_INIA_REFERENCES]) expect(writers, rejection).toContain(rejection)
  })
})
