import mysql from "mysql2/promise"
import sql from "mssql"
import pg from "pg"
import type { DatabaseEngine } from "../domain/database/database-engine.js"

/**
 * Administração dos bancos EXTERNOS de prova (`compose.yaml`, perfil external-examples) — só para os testes:
 * cria/derruba a área `inia_prova` e o usuário SOMENTE LEITURA `inia_prova_leitura`, insere e altera linhas como se
 * fosse o sistema do cliente. A INIA nunca usa estas credenciais de administrador: lê sempre com o usuário de leitura.
 * Portas/credenciais podem ser trocadas por variáveis INIA_PROOF_<MOTOR>_* (ver `adminTargets`). As senhas nunca ficam no
 * código: exporte as do .env da raiz (as mesmas do compose.yaml) antes da prova — INIA_EXAMPLES_ADMIN_PASSWORD (administrador
 * dos contêineres) e INIA_EXAMPLES_READER_PASSWORD (usada também para o `inia_prova_leitura` que a prova cria).
 */
export type ProofTarget = {
  engine: DatabaseEngine
  host: string
  port: number
  adminUser: string
  adminPassword: string
  /** Banco onde a INIA conecta e esquema onde ficam as tabelas da prova. */
  database: string
  schema: string
  readerUser: string
  readerPassword: string
}

const env = (name: string, fallback: string) => process.env[name] ?? fallback
const EXAMPLES_ADMIN_PASSWORD = process.env.INIA_EXAMPLES_ADMIN_PASSWORD ?? ""
const PROOF_READER_PASSWORD = process.env.INIA_EXAMPLES_READER_PASSWORD ?? ""

export function adminTargets(): Record<DatabaseEngine, ProofTarget> {
  return {
    POSTGRESQL: { engine: "POSTGRESQL", host: env("INIA_PROOF_POSTGRES_HOST", "127.0.0.1"), port: Number(env("INIA_PROOF_POSTGRES_PORT", "55432")), adminUser: env("INIA_PROOF_POSTGRES_ADMIN", "exemplo_admin"), adminPassword: env("INIA_PROOF_POSTGRES_ADMIN_PASSWORD", EXAMPLES_ADMIN_PASSWORD), database: "inia_exemplo", schema: "inia_prova", readerUser: "inia_prova_leitura", readerPassword: PROOF_READER_PASSWORD },
    MARIADB: { engine: "MARIADB", host: env("INIA_PROOF_MARIADB_HOST", "127.0.0.1"), port: Number(env("INIA_PROOF_MARIADB_PORT", "53306")), adminUser: "root", adminPassword: env("INIA_PROOF_MARIADB_ADMIN_PASSWORD", EXAMPLES_ADMIN_PASSWORD), database: "inia_prova", schema: "inia_prova", readerUser: "inia_prova_leitura", readerPassword: PROOF_READER_PASSWORD },
    MYSQL: { engine: "MYSQL", host: env("INIA_PROOF_MYSQL_HOST", "127.0.0.1"), port: Number(env("INIA_PROOF_MYSQL_PORT", "53307")), adminUser: "root", adminPassword: env("INIA_PROOF_MYSQL_ADMIN_PASSWORD", EXAMPLES_ADMIN_PASSWORD), database: "inia_prova", schema: "inia_prova", readerUser: "inia_prova_leitura", readerPassword: PROOF_READER_PASSWORD },
    SQLSERVER: { engine: "SQLSERVER", host: env("INIA_PROOF_SQLSERVER_HOST", "127.0.0.1"), port: Number(env("INIA_PROOF_SQLSERVER_PORT", "51433")), adminUser: "sa", adminPassword: env("INIA_PROOF_SQLSERVER_ADMIN_PASSWORD", EXAMPLES_ADMIN_PASSWORD), database: "inia_prova", schema: "dbo", readerUser: "inia_prova_leitura", readerPassword: PROOF_READER_PASSWORD },
  }
}

export interface ExternalAdmin {
  exec(statement: string): Promise<void>
  close(): Promise<void>
}

export async function openAdmin(target: ProofTarget, database?: string): Promise<ExternalAdmin> {
  if (!target.adminPassword || !target.readerPassword) {
    throw new Error("Exporte INIA_EXAMPLES_ADMIN_PASSWORD e INIA_EXAMPLES_READER_PASSWORD (as do .env da raiz, usadas pelo compose.yaml) antes da prova.")
  }
  if (target.engine === "POSTGRESQL") {
    const client = new pg.Client({ host: target.host, port: target.port, user: target.adminUser, password: target.adminPassword, database: database ?? target.database })
    await client.connect()
    return { exec: async (statement) => void (await client.query(statement)), close: () => client.end() }
  }
  if (target.engine === "SQLSERVER") {
    const pool = new sql.ConnectionPool({ server: target.host, port: target.port, user: target.adminUser, password: target.adminPassword, database: database ?? "master", options: { encrypt: true, trustServerCertificate: true }, pool: { max: 1 } })
    await pool.connect()
    return { exec: async (statement) => void (await pool.request().batch(statement)), close: () => pool.close() }
  }
  const connection = await mysql.createConnection({ host: target.host, port: target.port, user: target.adminUser, password: target.adminPassword, multipleStatements: true, ...(database ? { database } : {}) })
  return { exec: async (statement) => void (await connection.query(statement)), close: () => connection.end() }
}

export type ProofValue = string | number | null

export function literal(target: ProofTarget, value: ProofValue): string {
  if (value === null) return "NULL"
  if (typeof value === "number") return String(value)
  return `${target.engine === "SQLSERVER" ? "N" : ""}'${value.replace(/'/g, "''")}'`
}

export function table(target: ProofTarget, name: string): string {
  if (target.engine === "POSTGRESQL") return `"${target.schema}"."${name}"`
  if (target.engine === "SQLSERVER") return `[${target.schema}].[${name}]`
  return `\`${target.schema}\`.\`${name}\``
}

export async function insertRows(admin: ExternalAdmin, target: ProofTarget, name: string, columns: string[], rows: ProofValue[][]): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500)
    await admin.exec(`insert into ${table(target, name)} (${columns.join(", ")}) values ${chunk.map((row) => `(${row.map((value) => literal(target, value)).join(", ")})`).join(", ")}`)
  }
}

/** Tipos por motor para as tabelas da prova. */
export function types(target: ProofTarget) {
  switch (target.engine) {
    case "POSTGRESQL":
      return { key: "varchar(30)", text: "varchar(120)", timestamp: "timestamp(6)", date: "date", decimal: "numeric(14,4)", bigint: "bigint" }
    case "SQLSERVER":
      return { key: "varchar(30)", text: "nvarchar(120)", timestamp: "datetime2(7)", date: "date", decimal: "decimal(14,4)", bigint: "bigint" }
    default:
      return { key: "varchar(30)", text: "varchar(120)", timestamp: "datetime(6)", date: "date", decimal: "decimal(14,4)", bigint: "bigint" }
  }
}

/** (Re)cria a área de prova e o usuário somente leitura, do zero. */
export async function resetProofArea(target: ProofTarget, ddl: (target: ProofTarget) => string[]): Promise<void> {
  if (target.engine === "POSTGRESQL") {
    const admin = await openAdmin(target)
    try {
      await admin.exec(`drop schema if exists ${target.schema} cascade`)
      await admin.exec(`do $$ begin if exists (select 1 from pg_roles where rolname = '${target.readerUser}') then execute 'drop owned by ${target.readerUser}'; execute 'drop role ${target.readerUser}'; end if; end $$`)
      await admin.exec(`create role ${target.readerUser} login password '${target.readerPassword}'`)
      await admin.exec(`create schema ${target.schema}`)
      for (const statement of ddl(target)) await admin.exec(statement)
      await admin.exec(`grant connect on database ${target.database} to ${target.readerUser}; grant usage on schema ${target.schema} to ${target.readerUser}; grant select on all tables in schema ${target.schema} to ${target.readerUser}`)
    } finally {
      await admin.close()
    }
    return
  }
  if (target.engine === "SQLSERVER") {
    const master = await openAdmin(target, "master")
    try {
      await master.exec(`if db_id('${target.database}') is not null begin alter database [${target.database}] set single_user with rollback immediate; drop database [${target.database}]; end`)
      await master.exec(`create database [${target.database}]`)
      await master.exec(`if not exists (select 1 from sys.server_principals where name = '${target.readerUser}') create login [${target.readerUser}] with password = '${target.readerPassword}', check_policy = off`)
    } finally {
      await master.close()
    }
    const admin = await openAdmin(target, target.database)
    try {
      for (const statement of ddl(target)) await admin.exec(statement)
      await admin.exec(`create user [${target.readerUser}] for login [${target.readerUser}]; alter role db_datareader add member [${target.readerUser}]`)
    } finally {
      await admin.close()
    }
    return
  }
  const admin = await openAdmin(target)
  try {
    await admin.exec(`drop database if exists \`${target.database}\`; create database \`${target.database}\` character set utf8mb4; drop user if exists '${target.readerUser}'@'%'; create user '${target.readerUser}'@'%' identified by '${target.readerPassword}'`)
    await admin.exec(`use \`${target.database}\``)
    for (const statement of ddl(target)) await admin.exec(statement)
    await admin.exec(`grant select on \`${target.database}\`.* to '${target.readerUser}'@'%'; flush privileges`)
  } finally {
    await admin.close()
  }
}

export async function adminExec(target: ProofTarget, statement: string): Promise<void> {
  const admin = await openAdmin(target, target.engine === "SQLSERVER" || target.engine === "POSTGRESQL" ? target.database : target.database)
  try {
    await admin.exec(statement)
  } finally {
    await admin.close()
  }
}
