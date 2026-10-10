#!/usr/bin/env node
// `npm run db:connect` — aponta a INIA para um banco INTERNO (PostgreSQL) em OUTRO servidor, por exemplo na área de dados
// da empresa. Pergunta (ou recebe por opção) servidor, porta, banco, usuário, senha e criptografia, CONFERE tudo
// (rede, senha, versão, permissões, extensões) e só então grava DATABASE_URL no backend/.env. Não cria nem altera nada
// no banco — quem cria as tabelas é o `npm run setup`.
//
// Sem terminal interativo:
//   INIA_DB_PASSWORD='...' npm run db:connect -- --host srv-dados --port 5432 --database inia --user inia_app --ssl encrypted
// Opções: --ssl disabled | encrypted (padrão) | verified (com --ca arquivo.pem)   --yes (não pede confirmação)
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { buildDatabaseUrl, checkInternalDatabase, describeDatabaseUrl, loadPg, SSL_MODES } from "./internal-database.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const backendEnvPath = join(root, "backend/.env")
const { values } = parseArgs({
  options: {
    host: { type: "string" },
    port: { type: "string" },
    database: { type: "string" },
    user: { type: "string" },
    ssl: { type: "string" },
    ca: { type: "string" },
    yes: { type: "boolean", default: false },
  },
})

const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!existsSync(backendEnvPath)) fail("backend/.env não existe. Rode antes: node scripts/install/env-init.mjs --own-postgres --public-url https://SEU-ENDERECO")

const interactive = process.stdin.isTTY && process.stdout.isTTY

function ask(question, { hidden = false, fallback = "" } = {}) {
  return new Promise((resolveAnswer) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const suffix = fallback ? ` [${fallback}]` : ""
    if (hidden) {
      // Não ecoa a senha no terminal.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text)
      }
    }
    rl.question(`${question}${suffix}: `, (answer) => {
      if (hidden) rl.output.write("\n")
      rl.close()
      resolveAnswer(answer.trim() || fallback)
    })
  })
}

async function value(key, question, fallback = "") {
  if (values[key]) return values[key]
  if (!interactive) return fallback
  return ask(question, { fallback })
}

console.log("INIA — banco interno em outro servidor (PostgreSQL)\n")
const host = await value("host", "Servidor do PostgreSQL (nome ou IP)")
const port = Number(await value("port", "Porta", "5432"))
const database = await value("database", "Nome do banco (criado vazio pela equipe do banco)", "inia")
const user = await value("user", "Usuário (dono do banco)")
let password = process.env.INIA_DB_PASSWORD ?? ""
if (!password && interactive) password = await ask("Senha", { hidden: true })
let ssl = values.ssl
if (!ssl && interactive) {
  console.log("\nCriptografia da conexão:")
  console.log(`  1) ${SSL_MODES.encrypted.label}  ← recomendado em rede interna`)
  console.log(`  2) ${SSL_MODES.verified.label}  (precisa do arquivo .pem da autoridade)`)
  console.log(`  3) ${SSL_MODES.disabled.label}`)
  const choice = await ask("Escolha", { fallback: "1" })
  ssl = { 1: "encrypted", 2: "verified", 3: "disabled" }[choice] ?? choice
}
ssl = ssl || "encrypted"
let ca = values.ca ?? null
if (ssl === "verified" && !ca && interactive) ca = await ask("Caminho do arquivo .pem da autoridade certificadora")
if (ca) {
  ca = isAbsolute(ca) ? ca : resolve(process.cwd(), ca)
  if (!existsSync(ca)) fail(`Arquivo da autoridade certificadora não encontrado: ${ca}`)
}

const missing = [!host && "--host", !user && "--user", !password && "senha (INIA_DB_PASSWORD)", !Number.isInteger(port) && "--port"].filter(Boolean)
if (missing.length) fail(`Faltou informar: ${missing.join(", ")}.`)

let url
try {
  url = buildDatabaseUrl({ host, port, database, user, password, ssl, ca })
} catch (error) {
  fail(error.message)
}

console.log(`\nConferindo ${describeDatabaseUrl(url)}…`)
const pg = loadPg(root)
const result = await checkInternalDatabase(pg, url)
for (const line of result.info) console.log(`  ✓ ${line}`)
for (const line of result.warnings) console.log(`  ! ${line}`)
for (const line of result.problems) console.log(`  ✗ ${line}`)
if (!result.connected || result.problems.length) fail("Nada foi gravado. Resolva os itens acima (o guia docs/instalacao/dois-servidores-windows.md e a IT-INIA-003 têm os comandos para a equipe do banco) e rode de novo.")

const stateLabel = { EMPTY: "banco vazio — pronto para npm run setup", INSTALLED: "a INIA já está instalada nesse banco — use npm run update", HAS_TABLES: "o banco já tem tabelas que não são de uma instalação registrada da INIA (o setup vai recusar)" }[result.state]
console.log(`  ${result.state === "HAS_TABLES" ? "!" : "✓"} ${stateLabel}`)

if (!values.yes && interactive) {
  const confirm = await ask("\nGravar este banco como o banco interno da INIA no backend/.env? (s/n)", { fallback: "s" })
  if (!/^s/i.test(confirm)) fail("Cancelado — nada foi gravado.")
}

const current = readFileSync(backendEnvPath, "utf8")
const line = /^DATABASE_URL=.*$/m
const next = line.test(current) ? current.replace(line, () => `DATABASE_URL=${url}`) : `${current.trimEnd()}\nDATABASE_URL=${url}\n`
writeFileSync(backendEnvPath, next, { mode: 0o600 })
console.log(`\n✓ backend/.env atualizado: a INIA agora usa ${describeDatabaseUrl(url)}.`)
console.log(result.state === "INSTALLED" ? "Próximo passo: npm run update" : "Próximo passo: npm run setup")
