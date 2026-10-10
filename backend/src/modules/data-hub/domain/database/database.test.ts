import { describe, expect, it } from "vitest"
import { DataRunError } from "../error-codes.js"
import { mapRecord } from "../mapping.js"
import { requireDataContract } from "../contract-registry.js"
import { mysqlColumn, postgresColumn, sqlServerCastType, sqlServerColumn, type DatabaseColumn } from "./column-types.js"
import { classifyDatabaseError, sanitizeDriverMessage, type DatabaseErrorContext } from "./database-errors.js"
import { databaseConfigSchema, resolveDatabaseConnection } from "./database-engine.js"
import { orderColumnsOf, planPage, readDatabaseCheckpoint, startPointOf, subtractMinutesFromDateText } from "./database-sync.js"
import { dialectFor } from "./sql-dialect.js"
import { normalizeDatabaseValue } from "./value-normalization.js"

const column = (overrides: Partial<DatabaseColumn> & { name: string }): DatabaseColumn => ({ nativeType: "integer", category: "INTEGER", nullable: false, primaryKeyPosition: null, supported: true, cursorEligible: true, keyEligible: true, castType: "int", ...overrides })

describe("configuração da conexão", () => {
  it("aplica padrões por banco: porta, TLS e instância nomeada do SQL Server sem porta", () => {
    const pg = resolveDatabaseConnection(databaseConfigSchema.parse({ engine: "POSTGRESQL", host: "db.cliente.local", database: "rh", username: "leitura" }), "x")
    expect(pg).toMatchObject({ port: 5432, tlsMode: "PREFERRED", connectTimeoutMs: 15_000 })
    const ms = resolveDatabaseConnection(databaseConfigSchema.parse({ engine: "SQLSERVER", host: "sql01", instanceName: "SQLEXPRESS", database: "rh", username: "leitura", port: 1433 }), "x")
    expect(ms).toMatchObject({ port: null, instanceName: "SQLEXPRESS", tlsMode: "REQUIRED" })
  })

  it("recusa host com protocolo/usuário, instância fora do SQL Server e TLS inexistente no motor", () => {
    expect(databaseConfigSchema.safeParse({ engine: "MARIADB", host: "mysql://user:senha@host", database: "x", username: "y" }).success).toBe(false)
    expect(databaseConfigSchema.safeParse({ engine: "MARIADB", host: "host:3306", database: "x", username: "y" }).success).toBe(false)
    expect(databaseConfigSchema.safeParse({ engine: "POSTGRESQL", host: "h", instanceName: "X", database: "x", username: "y" }).success).toBe(false)
    expect(databaseConfigSchema.safeParse({ engine: "SQLSERVER", host: "h", database: "x", username: "y", tls: { mode: "PREFERRED" } }).success).toBe(false)
    expect(databaseConfigSchema.safeParse({ engine: "POSTGRESQL", host: "h", database: "x", username: "y", tls: { mode: "REQUIRED", caCertificate: "-----BEGIN CERTIFICATE-----" } }).success).toBe(false)
  })
})

describe("SQL gerado (só SELECT, identificadores delimitados, valores como parâmetro)", () => {
  const object = { schema: 'ven"das', name: "pedidos" }
  const cursor = column({ name: "atualizado_em", nativeType: "datetime2(7)", category: "DATETIME", castType: "datetime2(7)" })
  const key = column({ name: "id", nativeType: "bigint", castType: "bigint" })
  const value = column({ name: "valor]x", nativeType: "decimal(12,2)", category: "DECIMAL", castType: "decimal(12,2)" })

  it("PostgreSQL: aspas duplicadas, posição em texto exato e parâmetros posicionais sem tipo", () => {
    const statement = dialectFor("POSTGRESQL").page({ object, select: [value], order: [cursor, key], after: ["2026-09-01 08:00:00.123456", "10"], limit: 101 })
    expect(statement.sql).toContain(`FROM "ven""das"."pedidos"`)
    expect(statement.sql).toContain(`("atualizado_em")::text AS "__inia_p0"`)
    expect(statement.sql).toContain(`("atualizado_em" > $1 OR ("atualizado_em" = $2 AND ("id" > $3)))`)
    expect(statement.sql).toMatch(/ORDER BY "atualizado_em", "id" LIMIT 101$/)
    expect(statement.params).toEqual(["2026-09-01 08:00:00.123456", "2026-09-01 08:00:00.123456", "10"])
    expect(statement.sql.trim().toUpperCase().startsWith("SELECT")).toBe(true)
  })

  it("SQL Server: colchetes duplicados, TOP, CONVERT 126 para data/hora e CAST do parâmetro para o tipo exato da coluna", () => {
    const statement = dialectFor("SQLSERVER").page({ object, select: [value], order: [cursor, key], after: ["2026-09-01T08:00:00.1234567", "10"], limit: 101 })
    expect(statement.sql).toMatch(/^SELECT TOP \(101\) \[valor]]x]/)
    expect(statement.sql).toContain("CONVERT(nvarchar(64), [atualizado_em], 126) AS [__inia_p0]")
    expect(statement.sql).toContain("[atualizado_em] > CAST(@p1 AS datetime2(7))")
    expect(statement.sql).toContain("[id] > CAST(@p3 AS bigint)")
  })

  it("MySQL/MariaDB: crases duplicadas, CAST AS CHAR e um ? por ocorrência", () => {
    const statement = dialectFor("MARIADB").page({ object: { schema: "rh", name: "a`b" }, select: [value], order: [cursor], atOrAfterFirst: "2026-09-01 07:50:00", limit: 11 })
    expect(statement.sql).toContain("FROM `rh`.`a``b`")
    expect(statement.sql).toContain("`atualizado_em` >= ?")
    expect(statement.params).toEqual(["2026-09-01 07:50:00"])
  })

  it("grupo empatado é lido por igualdade; colunas de ordenação vazias nunca entram", () => {
    const statement = dialectFor("POSTGRESQL").page({ object, select: [value], order: [cursor], equalTo: ["2026-09-01 08:00:00"], limit: 5001 })
    expect(statement.sql).toContain(`"atualizado_em" IS NOT NULL AND "atualizado_em" = $1`)
  })

  it("busca na descoberta é parâmetro (nunca concatenada)", () => {
    const statement = dialectFor("SQLSERVER").listObjects("'; drop table x; --", 50)
    expect(statement.sql).not.toContain("drop table")
    expect(statement.params).toEqual(["'; drop table x; --"])
  })

  it("identificador inválido é recusado", () => {
    expect(() => dialectFor("POSTGRESQL").quote("a\u0000b")).toThrow()
    expect(() => dialectFor("POSTGRESQL").quote("x".repeat(129))).toThrow()
  })
})

describe("tipos de coluna", () => {
  it("categorias e elegibilidade por banco", () => {
    expect(postgresColumn({ name: "a", nativeType: "timestamp(3) without time zone", typtype: "b", nullable: false, primaryKeyPosition: null })).toMatchObject({ category: "DATETIME", cursorEligible: true })
    expect(postgresColumn({ name: "a", nativeType: "bytea", typtype: "b", nullable: true, primaryKeyPosition: null })).toMatchObject({ category: "BINARY", supported: false })
    expect(postgresColumn({ name: "a", nativeType: "double precision", typtype: "b", nullable: true, primaryKeyPosition: null })).toMatchObject({ category: "FLOAT", cursorEligible: false, keyEligible: false })
    expect(sqlServerColumn({ name: "a", typeName: "nvarchar", maxLength: -1, precision: 0, scale: 0, nullable: true, primaryKeyPosition: null })).toMatchObject({ category: "TEXT", keyEligible: false })
    expect(sqlServerColumn({ name: "a", typeName: "rowversion", maxLength: 8, precision: 0, scale: 0, nullable: false, primaryKeyPosition: null })).toMatchObject({ category: "BINARY", supported: false })
    expect(mysqlColumn({ name: "a", dataType: "timestamp", columnType: "timestamp(6)", nullable: false, primaryKeyPosition: 1 })).toMatchObject({ category: "DATETIME_TZ", cursorEligible: true, primaryKeyPosition: 1 })
    expect(mysqlColumn({ name: "a", dataType: "bit", columnType: "bit(1)", nullable: false, primaryKeyPosition: null })).toMatchObject({ category: "BOOLEAN" })
  })

  it("SQL Server: tipo do CAST só a partir do catálogo", () => {
    expect(sqlServerCastType("nvarchar", 40, 0, 0)).toBe("nvarchar(20)")
    expect(sqlServerCastType("decimal", 9, 12, 2)).toBe("decimal(12,2)")
    expect(sqlServerCastType("datetime2", 8, 27, 7)).toBe("datetime2(7)")
    expect(sqlServerCastType("geography", -1, 0, 0)).toBeNull()
  })
})

describe("paginação sem pular nem repetir linha", () => {
  const positions = (values: string[]) => values.map((value) => [value])

  it("última página, página cheia e empate na fronteira", () => {
    expect(planPage(positions(["a", "b"]), 3)).toEqual({ take: 2, reachedEnd: true, tieGroup: null })
    expect(planPage(positions(["a", "b", "c", "d"]), 3)).toEqual({ take: 3, reachedEnd: false, tieGroup: null })
    // "c" aparece dos dois lados da fronteira: a página termina antes do grupo empatado.
    expect(planPage(positions(["a", "b", "c", "c"]), 3)).toEqual({ take: 2, reachedEnd: false, tieGroup: null })
    expect(planPage(positions(["a", "c", "c", "c"]), 3)).toEqual({ take: 1, reachedEnd: false, tieGroup: null })
    // A página inteira é um grupo empatado: quem chama lê o grupo de uma vez.
    expect(planPage(positions(["c", "c", "c", "c"]), 3)).toEqual({ take: 0, reachedEnd: false, tieGroup: ["c"] })
  })

  it("ordem = campo de atualização + chaves; checkpoint de outra configuração é descartado", () => {
    const sync = { mode: "INCREMENTAL" as const, cursorColumn: "atualizado_em", keyColumns: ["id", "atualizado_em"], lookbackMinutes: 0 }
    expect(orderColumnsOf(sync)).toEqual(["atualizado_em", "id"])
    const stored = { kind: "DATABASE", mode: "INCREMENTAL", orderColumns: ["atualizado_em"], position: ["x"], reachedEnd: true, updatedAt: "" }
    expect(readDatabaseCheckpoint(stored, sync)).toEqual({ checkpoint: null, discarded: true })
    expect(readDatabaseCheckpoint({ ...stored, orderColumns: ["atualizado_em", "id"] }, sync).checkpoint).not.toBeNull()
  })

  it("releitura de segurança só ao começar um ciclo novo e só para data/hora", () => {
    const sync = { mode: "INCREMENTAL" as const, cursorColumn: "c", keyColumns: [], lookbackMinutes: 30 }
    const done = { kind: "DATABASE" as const, mode: "INCREMENTAL" as const, orderColumns: ["c"], position: ["2026-09-01 08:00:00.5"], reachedEnd: true, updatedAt: "" }
    expect(startPointOf(sync, done, "DATETIME")).toEqual({ kind: "LOOKBACK", firstColumnFrom: "2026-09-01 07:30:00" })
    expect(startPointOf(sync, { ...done, reachedEnd: false }, "DATETIME")).toEqual({ kind: "AFTER", position: done.position })
    expect(startPointOf(sync, { ...done, position: ["42"] }, "INTEGER")).toEqual({ kind: "AFTER", position: ["42"] })
    expect(startPointOf({ mode: "FULL", keyColumns: ["id"] }, { ...done, mode: "FULL", orderColumns: ["id"], position: ["9"] }, null)).toEqual({ kind: "BEGINNING" })
  })

  it("subtrai minutos preservando separador e fuso do texto do banco", () => {
    expect(subtractMinutesFromDateText("2026-09-01T00:10:00.1234567-03:00", 20, "DATETIME_TZ")).toBe("2026-08-31T23:50:00-03:00")
    expect(subtractMinutesFromDateText("2026-09-01", 60, "DATE")).toBe("2026-08-31")
    expect(subtractMinutesFromDateText("não é data", 5, "DATETIME")).toBeNull()
  })
})

describe("normalização de valores (igual na amostra, na carga e no reprocessamento)", () => {
  it("datas como texto do banco, Date em UTC do SQL Server, decimais exatos e binários fora", () => {
    expect(normalizeDatabaseValue("2026-09-01 08:00:00.123456", { category: "DATETIME" })).toBe("2026-09-01T08:00:00.123")
    expect(normalizeDatabaseValue("2026-09-01 08:00:00+00", { category: "DATETIME_TZ" })).toBe("2026-09-01T08:00:00+00:00")
    expect(normalizeDatabaseValue("2026-09-01 08:00:00", { category: "DATETIME_TZ" })).toBe("2026-09-01T08:00:00Z")
    expect(normalizeDatabaseValue(new Date(Date.UTC(2026, 8, 1, 0, 0, 0)), { category: "DATE" })).toBe("2026-09-01")
    expect(normalizeDatabaseValue(new Date(Date.UTC(2026, 8, 1, 8, 5, 3, 250)), { category: "DATETIME" })).toBe("2026-09-01T08:05:03.250")
    expect(normalizeDatabaseValue("12345678901234567.89", { category: "DECIMAL" })).toBe("12345678901234567.89")
    expect(normalizeDatabaseValue(Buffer.from([1]), { category: "BOOLEAN" })).toBe(true)
    expect(normalizeDatabaseValue(Buffer.from("abc"), { category: "BINARY" })).toBeNull()
    expect(normalizeDatabaseValue(10n, { category: "INTEGER" })).toBe("10")
  })

  it("data/hora sem fuso com frações vira o instante certo no fuso da organização", () => {
    const contract = requireDataContract("INTERACTIONS")
    const mapping = { fields: [{ target: "externalInteractionId", source: "id", transforms: [] }, { target: "externalEmployeeId", source: "m", transforms: [] }, { target: "channel", source: "c", transforms: [] }, { target: "startedAt", source: "s", transforms: [] }] }
    const { record } = mapRecord(contract, mapping, { id: "1", m: "X", c: "VOICE", s: "2026-09-01T08:00:00.123" }, { timeZone: "America/Sao_Paulo" })
    expect(record.startedAt).toBe("2026-09-01T11:00:00.123Z")
  })
})

describe("erros dos drivers viram códigos estáveis, sem a senha", () => {
  const context: DatabaseErrorContext = { engine: "POSTGRESQL", host: "db", port: 5432, database: "rh", username: "leitura", phase: "CONNECT", secrets: ["S3nh@Forte"] }

  it("autenticação, rede, tempo, TLS, banco inexistente, permissão e esquema", () => {
    const code = (error: unknown, extra: Partial<DatabaseErrorContext> = {}) => classifyDatabaseError(error, { ...context, ...extra }).code
    expect(code({ code: "28P01", message: "password authentication failed for user \"leitura\"" })).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(code({ code: "ELOGIN", message: "Login failed for user 'leitura'." }, { engine: "SQLSERVER" })).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(code({ code: "ELOGIN", message: "Cannot open database \"rh\" requested by the login." }, { engine: "SQLSERVER" })).toBe("DATA_SOURCE_NOT_FOUND")
    expect(code({ errno: 1045, code: "ER_ACCESS_DENIED_ERROR", message: "Access denied for user 'leitura'@'x' (using password: YES)" }, { engine: "MYSQL" })).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(code({ errno: 1044, code: "ER_DBACCESS_DENIED_ERROR", message: "Access denied for user 'leitura'@'%' to database 'rh'" }, { engine: "MARIADB" })).toBe("DATA_SOURCE_NOT_FOUND")
    expect(code({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.0.0.1:5432" })).toBe("DATA_SOURCE_UNREACHABLE")
    expect(code({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND db.cliente" })).toBe("DATA_SOURCE_UNREACHABLE")
    expect(code(new Error("timeout expired"))).toBe("DATA_SOURCE_TIMEOUT")
    expect(code({ code: "57014", message: "canceling statement due to statement timeout" }, { phase: "QUERY" })).toBe("DATA_SOURCE_TIMEOUT")
    expect(code({ code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self-signed certificate" })).toBe("DATA_SOURCE_TLS_FAILED")
    expect(code(new Error("The server does not support SSL connections"))).toBe("DATA_SOURCE_TLS_FAILED")
    expect(code({ code: "3D000", message: "database \"rh\" does not exist" })).toBe("DATA_SOURCE_NOT_FOUND")
    expect(code({ code: "42501", message: "permission denied for table x" }, { phase: "QUERY" })).toBe("DATA_SOURCE_PERMISSION_DENIED")
    expect(code({ number: 229, message: "The SELECT permission was denied on the object 'x'" }, { engine: "SQLSERVER", phase: "QUERY" })).toBe("DATA_SOURCE_PERMISSION_DENIED")
    expect(code({ code: "42703", message: "column \"nome\" does not exist" }, { phase: "QUERY" })).toBe("DATA_SCHEMA_CHANGED")
    expect(code({ errno: 1146, message: "Table 'rh.x' doesn't exist" }, { engine: "MYSQL", phase: "QUERY" })).toBe("DATA_SCHEMA_CHANGED")
  })

  it("a senha nunca aparece na mensagem; DataRunError passa intacto", () => {
    const error = classifyDatabaseError(new Error("connect failed for postgres://leitura:S3nh@Forte@db/rh with S3nh@Forte"), context)
    expect(error.message).not.toContain("S3nh@Forte")
    expect(sanitizeDriverMessage("x S3nh@Forte y", ["S3nh@Forte"])).toBe("x *** y")
    const original = new DataRunError("DATA_SCHEMA_CHANGED", "mudou")
    expect(classifyDatabaseError(original, context)).toBe(original)
  })
})
