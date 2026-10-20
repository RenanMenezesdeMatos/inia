#!/usr/bin/env node
// `npm run doctor` — confere os pré-requisitos e a configuração ANTES de instalar/atualizar, sem alterar nada:
// Node/npm, arquivos de ambiente, segredos, conexão com o banco INTERNO, migrations pendentes e instalação.
import { execSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkInternalDatabase, describeDatabaseUrl, loadPg } from "./internal-database.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
let problems = 0
const ok = (message) => console.log(`  ✓ ${message}`)
const warn = (message) => console.log(`  ! ${message}`)
const bad = (message) => {
  problems += 1
  console.log(`  ✗ ${message}`)
}

function readEnv(file) {
  const values = {}
  if (!existsSync(file)) return null
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2]
  }
  return values
}

console.log("Pré-requisitos")
const major = Number(process.versions.node.split(".")[0])
if (major >= 24) ok(`Node.js ${process.versions.node}`)
else bad(`Node.js ${process.versions.node} — a INIA exige 24 ou mais novo`)
try {
  ok(`npm ${execSync("npm --version", { encoding: "utf8" }).trim()}`)
} catch {
  bad("npm não encontrado")
}
try {
  ok(`Docker Compose ${execSync("docker compose version --short", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()} (opcional)`)
} catch {
  warn("Docker Compose não encontrado (opcional: só para subir o PostgreSQL e os bancos de exemplo)")
}

console.log("\nArquivos de ambiente")
const backendEnv = readEnv(join(root, "backend/.env"))
if (!backendEnv) bad("backend/.env não existe — rode npm run env:init")
else ok("backend/.env")
if (!existsSync(join(root, "frontend/.env.local")) && !existsSync(join(root, "frontend/.env"))) warn("frontend/.env.local não existe — o frontend usa http://localhost:3333 como API (npm run env:init cria)")
else ok("frontend/.env.local")
for (const directory of ["backend", "frontend"]) {
  if (!existsSync(join(root, directory, "node_modules"))) bad(`${directory}/node_modules não existe — rode npm run install:all`)
}

if (backendEnv) {
  console.log("\nSegredos e integrações")
  if (!backendEnv.JWT_SECRET || backendEnv.JWT_SECRET.startsWith("troque") || backendEnv.JWT_SECRET === "change-me") bad("JWT_SECRET ausente ou com o valor de exemplo")
  else ok("JWT_SECRET definido")
  if (!backendEnv.DATA_HUB_SECRET_KEY) (backendEnv.NODE_ENV === "production" ? bad : warn)("DATA_HUB_SECRET_KEY vazio (em desenvolvimento usa uma chave fixa de teste — nunca com dados reais)")
  else ok("DATA_HUB_SECRET_KEY definido")
  if (!backendEnv.GEMINI_API_KEY) warn("GEMINI_API_KEY vazio — os recursos de IA ficam indisponíveis até configurar")
  else ok("GEMINI_API_KEY definido")
  // Em produção a API não sobe sem o endereço público da interface, nem com curinga (R-33).
  if (!backendEnv.CORS_ORIGIN) (backendEnv.NODE_ENV === "production" ? bad : warn)("CORS_ORIGIN vazio — em produção a API não sobe sem o endereço público da interface (npm run env:init grava)")
  else if (backendEnv.CORS_ORIGIN.includes("*")) bad("CORS_ORIGIN com curinga (*) — informe o endereço exato da interface")
  else ok(`CORS_ORIGIN ${backendEnv.CORS_ORIGIN}`)

  console.log("\nCópia de segurança do banco")
  const backupTask = process.platform === "win32" ? "deploy\\windows\\backup\\agendar-backup.ps1 -Pasta D:\\backup\\inia" : "um agendamento diário de npm run db:backup -- --dir <pasta>"
  warn(`confira se o backup diário está agendado (${backupTask}) e faça um teste de restauração: npm run db:restore-check -- --dir <pasta>`)

  console.log("\nBanco INTERNO da INIA")
  const url = backendEnv.DATABASE_URL
  if (!url) bad("DATABASE_URL vazio no backend/.env")
  else if (/troque-esta-senha/.test(url)) bad("DATABASE_URL ainda tem a senha de exemplo — rode npm run env:init ou npm run db:connect")
  else if (!/^postgres(ql)?:\/\//.test(url)) bad("DATABASE_URL não é PostgreSQL. O banco interno da INIA é sempre PostgreSQL; SQL Server, MySQL e MariaDB entram como bancos EXTERNOS pela Central de Dados.")
  else if (existsSync(join(root, "backend/node_modules/pg"))) {
    const pg = loadPg(root)
    const result = await checkInternalDatabase(pg, url, { timeoutMs: 5000 })
    if (!result.connected) {
      // Credencial recusada no PostgreSQL que deveria ser o do Docker = quase sempre OUTRO PostgreSQL respondendo na
      // mesma porta (o Docker/Colima nem sempre acusa a porta ocupada).
      const composeEnv = readEnv(join(root, ".env"))
      const target = new URL(url)
      const composePort = composeEnv?.INIA_POSTGRES_PORT || "5432"
      const pointsToCompose = composeEnv && ["localhost", "127.0.0.1"].includes(target.hostname) && (target.port || "5432") === composePort
      const refused = result.problems.some((line) => /recusou o usuário|não existe nesse servidor|recusou o acesso/.test(line))
      if (pointsToCompose && refused) bad(`não conectou — parece que OUTRO PostgreSQL (fora do Docker) responde na porta ${composePort}. Troque a porta do banco da INIA: npm run env:init -- --postgres-port ${Number(composePort) + 1} e depois npm run db:up`)
      else for (const line of result.problems) bad(/^não conectou/.test(line) ? `${line}${/recusou a conexão/.test(line) && pointsToCompose ? " (npm run db:up)" : ""}` : line)
    } else {
      ok(`conectado: ${describeDatabaseUrl(url)}`)
      for (const line of result.info) ok(line)
      for (const line of result.warnings) warn(line)
      for (const line of result.problems) bad(line)
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 })
      try {
        await client.connect()
        if (result.state === "EMPTY") warn("banco vazio — falta a primeira instalação: npm run setup")
        else {
          const migrationsTable = await client.query("select to_regclass('public.schema_migrations') is not null as exists")
          if (migrationsTable.rows[0].exists) {
            const applied = new Set((await client.query("select name from schema_migrations")).rows.map((row) => row.name))
            const pending = readdirSync(join(root, "backend/migrations")).filter((file) => file.endsWith(".sql") && !applied.has(file))
            if (pending.length) warn(`${pending.length} migration(s) pendente(s) — rode npm run update`)
            else ok("migrations em dia")
          }
          if (result.state === "INSTALLED") {
            const info = (await client.query("select installed_at, demo_data from installation_info")).rows[0]
            ok(`instalação registrada em ${info.installed_at.toISOString().slice(0, 10)}${info.demo_data ? " (com dados de demonstração)" : ""}`)
          } else warn("sem instalação registrada (banco criado antes do npm run setup)")
        }
      } finally {
        await client.end().catch(() => {})
      }
    }
  }
}

console.log(problems ? `\n${problems} problema(s) para resolver.` : "\nTudo certo.")
process.exit(problems ? 1 : 0)
