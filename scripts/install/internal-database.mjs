// Banco INTERNO da INIA (PostgreSQL) — montagem do endereço e verificações, usadas pelo `npm run db:connect` e pelo
// `npm run doctor`. Serve tanto para o PostgreSQL do Docker quanto para um PostgreSQL em OUTRO servidor (por exemplo,
// na área de dados da empresa). Nunca imprime a senha.
import { createRequire } from "node:module"
import { isIP } from "node:net"
import { existsSync } from "node:fs"
import { join } from "node:path"

export const MINIMUM_POSTGRES_VERSION = 150000
export const REQUIRED_EXTENSIONS = ["pgcrypto", "btree_gist"]

/** Modos de criptografia oferecidos (nomes da INIA → parâmetro do driver). */
export const SSL_MODES = {
  disabled: { label: "sem criptografia", sslmode: "disable" },
  encrypted: { label: "criptografada (aceita o certificado do servidor sem conferir)", sslmode: "no-verify" },
  verified: { label: "criptografada e com o certificado conferido", sslmode: "verify-full" },
}

export function loadPg(root) {
  if (!existsSync(join(root, "backend/node_modules/pg"))) throw new Error("backend/node_modules não existe — rode npm run install:all")
  return createRequire(join(root, "backend/package.json"))("pg")
}

export function buildDatabaseUrl({ host, port = 5432, database, user, password, ssl = "encrypted", ca = null }) {
  const mode = SSL_MODES[ssl]
  if (!mode) throw new Error(`Criptografia inválida: ${ssl} (use disabled, encrypted ou verified).`)
  if (ssl === "verified" && !ca) throw new Error("A criptografia conferida (verified) precisa do arquivo da autoridade certificadora: --ca caminho/do/arquivo.pem")
  // Com IP, o driver não confere o nome do certificado contra o endereço — então exigimos o NOME que está no certificado.
  if (ssl === "verified" && isIP(host)) throw new Error(`Com a criptografia conferida, informe o NOME do servidor que está no certificado (ex.: srv-dados.empresa.local), não o IP ${host}. Sem esse nome, use --ssl encrypted.`)
  const url = new URL(`postgresql://${host}`)
  url.port = String(port)
  url.pathname = `/${database}`
  url.username = user
  url.password = password
  url.searchParams.set("sslmode", mode.sslmode)
  if (ca) url.searchParams.set("sslrootcert", ca)
  return url.toString()
}

/** "servidor:porta/banco (criptografia)" — sem usuário nem senha. */
export function describeDatabaseUrl(connectionString) {
  const url = new URL(connectionString)
  const sslmode = url.searchParams.get("sslmode")
  const mode = Object.values(SSL_MODES).find((entry) => entry.sslmode === sslmode)
  return `${url.hostname}:${url.port || 5432}${url.pathname}${mode ? ` (${mode.label})` : ""}`
}

/** Explica, em linguagem de gente, por que o banco interno não respondeu. */
export function explainConnectionError(error, connectionString) {
  const message = String(error?.message ?? error)
  const url = new URL(connectionString)
  const where = `${url.hostname}:${url.port || 5432}`
  const code = error?.code
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `o nome do servidor "${url.hostname}" não foi encontrado (DNS). Confira o endereço.`
  if (code === "ECONNREFUSED") return `${where} recusou a conexão. O PostgreSQL está no ar e aceitando conexões pela rede (listen_addresses)? A porta está liberada no firewall para este servidor?`
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) return `${where} não respondeu a tempo. Quase sempre é firewall entre este servidor e o servidor do banco (libere a porta ${url.port || 5432} para o IP deste servidor).`
  if (code === "28P01") return "o PostgreSQL recusou o usuário ou a senha."
  if (code === "28000" && /pg_hba/i.test(message)) {
    const encryptionHint = /no encryption/i.test(message) ? " O servidor só aceita conexão criptografada: use --ssl encrypted." : ""
    return `o servidor do banco não autoriza conexões vindas deste servidor (falta uma linha no pg_hba.conf para o IP desta máquina, o usuário e o banco).${encryptionHint}`
  }
  if (code === "28000") return `o PostgreSQL recusou o acesso: ${message}`
  if (code === "3D000") return `o banco "${url.pathname.slice(1)}" não existe nesse servidor. Peça à equipe do banco para criá-lo (vazio), com o seu usuário como dono.`
  if (/does not support SSL/i.test(message)) return "o servidor não tem criptografia ligada. Use --ssl disabled ou peça para ligar o SSL no PostgreSQL."
  if (/self[- ]signed|unable to verify|unable to get local issuer|certificate/i.test(message)) return `o certificado do servidor não pôde ser conferido (${message}). Use --ssl encrypted (criptografa sem conferir) ou informe a autoridade certificadora com --ssl verified --ca arquivo.pem.`
  if (/Hostname\/IP does not match|altnames/i.test(message)) return "o certificado do servidor foi emitido para outro nome. Use no --host o nome que está no certificado, ou --ssl encrypted."
  return message
}

/**
 * Confere o banco interno sem alterar nada: versão, criptografia, permissões para criar as tabelas, extensões e se o
 * banco está vazio ou já tem a INIA. Devolve problemas (impedem instalar), avisos e informações.
 */
export async function checkInternalDatabase(pg, connectionString, { timeoutMs = 8000 } = {}) {
  const problems = []
  const warnings = []
  const info = []
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => {})
    return { connected: false, problems: [`não conectou: ${explainConnectionError(error, connectionString)}`], warnings, info, state: null }
  }
  try {
    const server = (
      await client.query(
        `select current_setting('server_version') as version, current_setting('server_version_num')::int as num,
                current_database() as database, current_user as "user",
                coalesce((select rolsuper from pg_roles where rolname = current_user), false) as superuser,
                has_database_privilege(current_database(), 'CREATE') as database_create,
                has_schema_privilege('public', 'CREATE') as schema_create,
                coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl,
                (select pg_encoding_to_char(encoding) from pg_database where datname = current_database()) as encoding`,
      )
    ).rows[0]
    info.push(`PostgreSQL ${server.version} · banco "${server.database}" · usuário "${server.user}"${server.superuser ? " (superusuário)" : ""}`)
    if (server.num < MINIMUM_POSTGRES_VERSION) problems.push(`a INIA precisa do PostgreSQL 15 ou mais novo (este é o ${server.version}).`)
    if (server.encoding !== "UTF8") problems.push(`o banco está em ${server.encoding}; a INIA precisa de UTF8. Peça para recriá-lo vazio: create database ${server.database} owner ${server.user} encoding 'UTF8' template template0;`)
    if (server.ssl) info.push("conexão criptografada (TLS)")
    else warnings.push("conexão SEM criptografia — aceitável só em rede interna confiável; para ligar, use --ssl encrypted.")
    if (!server.schema_create) problems.push(`o usuário "${server.user}" não pode criar tabelas no schema public. O jeito mais simples: o usuário ser o DONO do banco (create database ... owner ${server.user}).`)

    const extensions = (
      await client.query(
        `select e.name, e.installed_version,
                coalesce((select bool_or(v.trusted) from pg_available_extension_versions v where v.name = e.name), false) as trusted
           from pg_available_extensions e where e.name = any($1::text[])`,
        [REQUIRED_EXTENSIONS],
      )
    ).rows
    for (const name of REQUIRED_EXTENSIONS) {
      const extension = extensions.find((row) => row.name === name)
      if (!extension) problems.push(`a extensão ${name} não está disponível nesse PostgreSQL (pacote "contrib" do PostgreSQL não instalado no servidor).`)
      else if (!extension.installed_version && !server.superuser && !(extension.trusted && server.database_create)) {
        problems.push(`o usuário não consegue ativar a extensão ${name}. Peça à equipe do banco para rodar, nesse banco: create extension if not exists ${name};`)
      }
    }

    const tables = (await client.query(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).rows[0].n
    let state = tables === 0 ? "EMPTY" : "HAS_TABLES"
    if (tables > 0) {
      const marker = (await client.query(`select to_regclass('public.installation_info') is not null as exists`)).rows[0].exists
      if (marker && (await client.query("select count(*)::int as n from installation_info")).rows[0].n > 0) state = "INSTALLED"
    }
    return { connected: true, problems, warnings, info, state, tables }
  } finally {
    await client.end().catch(() => {})
  }
}
