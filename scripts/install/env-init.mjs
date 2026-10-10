#!/usr/bin/env node
// `npm run env:init` — cria os arquivos de ambiente a partir dos modelos versionados, com SEGREDOS ALEATÓRIOS:
//   .env (raiz, Docker Compose) · backend/.env · frontend/.env.local
// Nunca sobrescreve um arquivo que já existe (rode de novo sem medo). Opções:
//   --own-postgres     não cria o .env do Compose; o banco interno é um PostgreSQL seu (local ou em outro servidor) —
//                      depois rode npm run db:connect
//   --postgres-port N  porta publicada pelo Compose. Sem a opção, usa 5432 ou, se ela já estiver ocupada na máquina
//                      (outro PostgreSQL), a primeira livre a partir de 5433. Com os arquivos já criados, a opção TROCA
//                      a porta no .env da raiz e no DATABASE_URL do backend (senhas mantidas) — depois: npm run db:up.
//   --public-url URL   UM endereço pelo qual as pessoas acessam a INIA, com IIS/proxy na frente (ex.:
//                      https://inia.empresa.local ou http://servidor:8080). API e interface ficam só em 127.0.0.1.
//   --app-url URL --api-url URL  alternativa sem proxy: duas portas abertas, uma para a interface e outra para a API
//                      (ex.: http://srv-app:3000 e http://srv-app:3333). Pode rodar de novo para trocar.
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import net from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { withExamplePasswords } from "./example-databases.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const args = process.argv.slice(2)
// Instalação que já existe SEM o .env do Docker = PostgreSQL próprio: rodar de novo (para trocar endereço/porta) não
// cria o .env do Docker.
const ownPostgres = args.includes("--own-postgres") || (existsSync(join(root, "backend/.env")) && !existsSync(join(root, ".env")))
const portIndex = args.indexOf("--postgres-port")
const explicitPort = portIndex >= 0 ? Number(args[portIndex + 1]) : null
if (explicitPort !== null && (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535)) {
  console.error("✗ --postgres-port inválida.")
  process.exit(1)
}

// Endereços pelos quais as PESSOAS acessam a INIA quando ela roda num servidor (não no próprio computador).
function urlOption(name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  try {
    const url = new URL(args[index + 1])
    if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search) throw new Error()
    return url
  } catch {
    console.error(`✗ ${name} precisa ser um endereço como http://srv-app:3000 (sem caminho).`)
    process.exit(1)
  }
}
const appUrl = urlOption("--app-url")
const apiUrl = urlOption("--api-url")
const publicUrl = urlOption("--public-url")
if ((appUrl && !apiUrl) || (!appUrl && apiUrl)) {
  console.error("✗ Informe os dois: --app-url (interface) e --api-url (API), por exemplo --app-url http://srv-app:3000 --api-url http://srv-app:3333")
  process.exit(1)
}
if (publicUrl && (appUrl || apiUrl)) {
  console.error("✗ Use --public-url (um endereço só, com o IIS na frente) OU --app-url/--api-url (duas portas abertas), não os dois.")
  process.exit(1)
}

/** Porta livre = ninguém aceita conexão nela E dá para abri-la em 127.0.0.1 (outro PostgreSQL na máquina ocupa a 5432). */
function accepts(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.setTimeout(500)
    socket.once("connect", () => (socket.destroy(), resolve(true)))
    socket.once("timeout", () => (socket.destroy(), resolve(false)))
    socket.once("error", () => resolve(false))
  })
}
function bindable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)))
  })
}
async function isPortFree(port) {
  const [v4, v6, bind] = await Promise.all([accepts("127.0.0.1", port), accepts("::1", port), bindable(port)])
  return !v4 && !v6 && bind
}
async function choosePort() {
  for (let candidate = 5432; candidate <= 5452; candidate += 1) if (await isPortFree(candidate)) return candidate
  return 5432
}

const secret = (bytes) => randomBytes(bytes).toString("hex")
const created = []
const kept = []

function setValue(text, key, value) {
  const line = new RegExp(`^${key}=.*$`, "m")
  return line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`
}

function readValue(text, key) {
  return new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1]?.trim() ?? ""
}

function writeFrom(example, target, transform) {
  const targetPath = join(root, target)
  if (existsSync(targetPath)) {
    kept.push(target)
    return readFileSync(targetPath, "utf8")
  }
  const content = transform(readFileSync(join(root, example), "utf8"))
  writeFileSync(targetPath, content, { mode: 0o600 })
  created.push(target)
  return content
}

const notes = []

// 0) Troca de porta numa instalação já configurada: só a porta muda (senhas e banco ficam como estão).
if (!ownPostgres && explicitPort !== null && existsSync(join(root, ".env"))) {
  const composePath = join(root, ".env")
  const compose = readFileSync(composePath, "utf8")
  const previous = readValue(compose, "INIA_POSTGRES_PORT") || "5432"
  writeFileSync(composePath, setValue(compose, "INIA_POSTGRES_PORT", String(explicitPort)), { mode: 0o600 })
  const backendPath = join(root, "backend/.env")
  if (existsSync(backendPath)) {
    let backend = readFileSync(backendPath, "utf8")
    for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
      const value = readValue(backend, key)
      if (value.includes(`@localhost:${previous}/`)) backend = setValue(backend, key, value.replace(`@localhost:${previous}/`, `@localhost:${explicitPort}/`))
    }
    writeFileSync(backendPath, backend, { mode: 0o600 })
  }
  console.log(`✓ porta do PostgreSQL do Docker trocada de ${previous} para ${explicitPort} (.env e backend/.env; senhas mantidas).`)
  console.log("\nAgora suba o banco de novo: npm run db:up")
  process.exit(0)
}

// 1) Compose (banco interno no Docker): senha aleatória e porta livre.
let composeEnv = null
if (!ownPostgres) {
  let port = explicitPort
  if (port === null && !existsSync(join(root, ".env"))) {
    port = await choosePort()
    if (port !== 5432) notes.push(`A porta 5432 já está em uso nesta máquina (provavelmente outro PostgreSQL). O banco interno da INIA no Docker vai usar a porta ${port}.`)
  }
  composeEnv = writeFrom(".env.example", ".env", (text) => withExamplePasswords(setValue(setValue(text, "INIA_POSTGRES_PASSWORD", secret(16)), "INIA_POSTGRES_PORT", String(port ?? 5432))).text)
  // .env de antes das senhas dos bancos de exemplo saírem do código: completa só o que falta (o resto fica como está).
  const completed = withExamplePasswords(composeEnv)
  if (completed.generated.length > 0) {
    writeFileSync(join(root, ".env"), completed.text, { mode: 0o600 })
    composeEnv = completed.text
    notes.push(`Senhas dos bancos externos de exemplo geradas no .env da raiz (${completed.generated.join(", ")}).`)
  }
}

// 2) Backend: segredos aleatórios e DATABASE_URL apontando para o banco do Compose (se usado).
writeFrom("backend/.env.example", "backend/.env", (text) => {
  let next = setValue(text, "JWT_SECRET", secret(48))
  next = setValue(next, "DATA_HUB_SECRET_KEY", secret(32))
  next = setValue(next, "INIA_DEMO_PASSWORD", `Demo-${secret(8)}`)
  if (composeEnv) {
    const user = readValue(composeEnv, "INIA_POSTGRES_USER") || "inia"
    const password = readValue(composeEnv, "INIA_POSTGRES_PASSWORD")
    const database = readValue(composeEnv, "INIA_POSTGRES_DB") || "inia"
    const composePort = readValue(composeEnv, "INIA_POSTGRES_PORT") || "5432"
    const base = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:${composePort}`
    next = setValue(next, "DATABASE_URL", `${base}/${database}`)
    next = setValue(next, "TEST_DATABASE_URL", `${base}/${database}_test`)
  }
  return next
})

// 3) Frontend.
writeFrom("frontend/.env.example", "frontend/.env.local", (text) => text)

// 4a) Endereço ÚNICO (IIS/proxy na frente): as pessoas acessam um endereço só; o proxy manda /api para a API e o resto
//     para a interface. API e interface escutam só na própria máquina (127.0.0.1) — nada exposto além do proxy.
if (publicUrl) {
  const origin = `${publicUrl.protocol}//${publicUrl.host}`
  const https = publicUrl.protocol === "https:"
  const backendPath = join(root, "backend/.env")
  let backend = readFileSync(backendPath, "utf8")
  const apiPort = readValue(backend, "PORT") || "3333"
  backend = setValue(backend, "CORS_ORIGIN", origin)
  backend = setValue(backend, "HOST", "127.0.0.1")
  // Servidor = modo produção SEMPRE (segredos obrigatórios, dados de demonstração recusados). O que muda sem HTTPS é só o
  // atributo Secure do cookie de sessão: em HTTP o navegador o descartaria e ninguém conseguiria entrar.
  backend = setValue(backend, "NODE_ENV", "production")
  backend = setValue(backend, "SESSION_COOKIE_SECURE", https ? "true" : "false")
  // Só o IIS/proxy na própria máquina informa o IP do cliente (X-Forwarded-For) — usado nos limites de tentativas.
  backend = setValue(backend, "TRUST_PROXY", "loopback")
  writeFileSync(backendPath, backend, { mode: 0o600 })
  const frontendPath = join(root, "frontend/.env.local")
  let frontend = readFileSync(frontendPath, "utf8")
  const webPort = readValue(frontend, "INIA_WEB_PORT") || "3000"
  frontend = setValue(frontend, "NEXT_PUBLIC_INIA_API_URL", origin)
  frontend = setValue(frontend, "INIA_API_URL", `http://127.0.0.1:${apiPort}`)
  frontend = setValue(frontend, "INIA_WEB_PORT", webPort)
  frontend = setValue(frontend, "INIA_WEB_HOST", "127.0.0.1")
  writeFileSync(frontendPath, frontend, { mode: 0o600 })
  console.log(`✓ endereço único configurado: ${origin} (interface interna 127.0.0.1:${webPort} · API interna 127.0.0.1:${apiPort})`)
  notes.push(`O IIS (ou outro proxy) precisa atender ${origin} e encaminhar /api e /health para http://127.0.0.1:${apiPort} e o resto para http://127.0.0.1:${webPort} — ver deploy/windows/iis/web.config. O endereço entra no build da interface: rode npm run build depois de mudar.`)
  if (!https) notes.push("Endereço sem HTTPS: a INIA roda em modo produção, mas o cookie de sessão não pode ser marcado como seguro (SESSION_COOKIE_SECURE=false) e nada trafega criptografado. Use só em rede interna; com certificado, rode de novo com https://.")
}

// 4b) Endereços públicos (servidor da aplicação): o navegador das pessoas chama a API direto, então a API precisa
//    aceitar a origem da interface (CORS) e a interface precisa saber o endereço da API (embutido no build).
if (appUrl && apiUrl) {
  const origin = (url) => `${url.protocol}//${url.host}`
  const apiPort = apiUrl.port || (apiUrl.protocol === "https:" ? "443" : "80")
  const backendPath = join(root, "backend/.env")
  let backend = readFileSync(backendPath, "utf8")
  backend = setValue(backend, "CORS_ORIGIN", origin(appUrl))
  if (apiUrl.port) backend = setValue(backend, "PORT", apiUrl.port)
  // Servidor = modo produção; sem HTTPS só o atributo Secure do cookie sai (ver acima). Sem proxy na frente: o IP é o da conexão.
  backend = setValue(backend, "NODE_ENV", "production")
  backend = setValue(backend, "SESSION_COOKIE_SECURE", apiUrl.protocol === "https:" && appUrl.protocol === "https:" ? "true" : "false")
  backend = setValue(backend, "TRUST_PROXY", "false")
  writeFileSync(backendPath, backend, { mode: 0o600 })
  const frontendPath = join(root, "frontend/.env.local")
  let frontend = readFileSync(frontendPath, "utf8")
  frontend = setValue(frontend, "NEXT_PUBLIC_INIA_API_URL", origin(apiUrl))
  // Chamadas feitas pelo próprio servidor da interface ficam na mesma máquina.
  frontend = setValue(frontend, "INIA_API_URL", apiUrl.port ? `http://localhost:${apiPort}` : origin(apiUrl))
  if (appUrl.port) frontend = setValue(frontend, "INIA_WEB_PORT", appUrl.port)
  writeFileSync(frontendPath, frontend, { mode: 0o600 })
  console.log(`✓ endereços configurados: interface ${origin(appUrl)} · API ${origin(apiUrl)}`)
  notes.push(`As pessoas acessam ${origin(appUrl)}; o navegador delas também chama ${origin(apiUrl)} — libere as duas portas para a rede delas. O endereço da API entra no build da interface: depois de mudar, rode npm run build de novo (o modo de desenvolvimento lê na hora).`)
}

for (const file of created) console.log(`✓ criado ${file}`)
for (const file of kept) console.log(`• mantido ${file} (já existia — segredos e banco preservados)`)
for (const note of notes) console.log(`\n! ${note}`)
if (ownPostgres) console.log("\nAgora aponte a INIA para o seu PostgreSQL: npm run db:connect (pergunta servidor, banco, usuário e senha, confere tudo e grava no backend/.env).")
console.log("\nSegredos gerados ficam só nestes arquivos (fora do Git). Guarde o DATA_HUB_SECRET_KEY: ele cifra as senhas dos bancos externos.")
