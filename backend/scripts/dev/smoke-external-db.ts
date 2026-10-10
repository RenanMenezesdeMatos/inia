import { DriverExternalDatabaseConnector } from "../../src/modules/data-hub/infrastructure/external-databases/external-database-connector.js"
import { resolveDatabaseConnection, type DatabaseEngine } from "../../src/modules/data-hub/domain/database/database-engine.js"
import { dialectFor } from "../../src/modules/data-hub/domain/database/sql-dialect.js"
import { mysqlColumn, postgresColumn, sqlServerColumn } from "../../src/modules/data-hub/domain/database/column-types.js"
import { normalizeDatabaseRow } from "../../src/modules/data-hub/domain/database/value-normalization.js"

const targets: { engine: DatabaseEngine; port: number; schema: string }[] = [
  { engine: "POSTGRESQL", port: 55432, schema: "public" },
  { engine: "MARIADB", port: 53306, schema: "inia_exemplo" },
  { engine: "MYSQL", port: 53307, schema: "inia_exemplo" },
]
const only = process.argv[2]
// Senha do `inia_leitura` dos bancos de exemplo: a do .env da raiz (INIA_EXAMPLES_READER_PASSWORD), nunca do código.
const readerPassword = process.env.INIA_EXAMPLES_READER_PASSWORD
if (!readerPassword) throw new Error("Exporte INIA_EXAMPLES_READER_PASSWORD (do .env da raiz) antes de rodar o smoke.")
const connector = new DriverExternalDatabaseConnector()
for (const target of targets.filter((t) => !only || t.engine === only)) {
  const connection = resolveDatabaseConnection({ engine: target.engine, host: "127.0.0.1", port: target.port, database: "inia_exemplo", username: "inia_leitura", connectTimeoutMs: 5000, queryTimeoutMs: 30000 }, readerPassword)
  const session = await connector.open(connection)
  const dialect = dialectFor(session.flavor)
  console.log(`== ${target.engine}: ${session.serverVersion} tls=${session.tlsActive} readOnly=${session.readOnlyEnforced} warn=${await session.privilegeWarning()}`)
  const objects = await session.query(dialect.listObjects(null, 50))
  console.log("objects", objects.map((o) => `${o.schema_name}.${o.object_name}:${o.object_kind}:${o.estimated_rows}`).join(" "))
  const cols = await session.query(dialect.describeColumns({ schema: target.schema, name: "medicoes_diarias" }))
  const columns = cols.map((row) => target.engine === "POSTGRESQL" ? postgresColumn({ name: String(row.column_name), nativeType: String(row.native_type), typtype: row.typtype as string, nullable: Boolean(row.nullable), primaryKeyPosition: row.pk_position === null ? null : Number(row.pk_position) }) : target.engine === "SQLSERVER" ? sqlServerColumn({ name: String(row.column_name), typeName: String(row.type_name), maxLength: Number(row.max_length), precision: Number(row.precision), scale: Number(row.scale), nullable: Boolean(row.nullable), primaryKeyPosition: row.pk_position === null ? null : Number(row.pk_position) }) : mysqlColumn({ name: String(row.column_name), dataType: String(row.data_type), columnType: String(row.column_type), nullable: Number(row.nullable) === 1, primaryKeyPosition: row.pk_position === null ? null : Number(row.pk_position) }))
  console.log("columns", columns.map((c) => `${c.name}:${c.nativeType}:${c.category}${c.primaryKeyPosition ? ":pk" : ""}${c.cursorEligible ? ":cursor" : ""}`).join(" "))
  const byName = new Map(columns.map((c) => [c.name, c]))
  const sample = await session.query(dialect.sample({ schema: target.schema, name: "medicoes_diarias" }, columns, 2))
  console.log("sample", JSON.stringify(sample.map((r) => normalizeDatabaseRow(r, columns))))
  const order = [byName.get("atualizado_em")!, byName.get("id")!]
  const page = await session.query(dialect.page({ object: { schema: target.schema, name: "medicoes_diarias" }, select: columns, order, limit: 3 }))
  console.log("page positions", page.map((r) => [r.__inia_p0, r.__inia_p1]))
  const after = [String(page[1]!.__inia_p0), String(page[1]!.__inia_p1)]
  const page2 = await session.query(dialect.page({ object: { schema: target.schema, name: "medicoes_diarias" }, select: columns, order, after, limit: 2 }))
  console.log("after", after, "->", page2.map((r) => [r.__inia_p0, r.__inia_p1]))
  try {
    await session.query({ sql: "insert into colaboradores (matricula, nome, nivel, atualizado_em) values ('X1','x','OPERATOR', '2026-01-01')", params: [] })
    console.log("WRITE SUCCEEDED (unexpected)")
  } catch (error) {
    console.log("write refused:", (error as Error).message.slice(0, 120))
  }
  await session.close()
}
