#!/usr/bin/env node
// `npm run dev` / `npm start` — sobe backend (API) e frontend juntos, com a saída de cada um identificada.
// Ctrl+C encerra os dois. Para rodar separados: `npm --prefix backend run dev` e `npm --prefix frontend run dev`.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const mode = process.argv[2] === "start" ? "start" : "dev"
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

for (const [file, hint] of [["backend/.env", "npm run env:init"], ["backend/node_modules", "npm run install:all"], ["frontend/node_modules", "npm run install:all"]]) {
  if (!existsSync(join(root, file))) {
    console.error(`✗ Falta ${file} — rode antes: ${hint}`)
    process.exit(1)
  }
}
if (mode === "start" && (!existsSync(join(root, "backend/dist")) || !existsSync(join(root, "frontend/.next")))) {
  console.error("✗ Falta o build — rode antes: npm run build")
  process.exit(1)
}

// Portas: a API usa PORT do backend/.env (padrão 3333); a interface usa INIA_WEB_PORT (variável de ambiente, ou a
// linha INIA_WEB_PORT do frontend/.env.local que o `npm run env:init -- --app-url …` grava; padrão 3000).
const backendEnv = existsSync(join(root, "backend/.env")) ? readFileSync(join(root, "backend/.env"), "utf8") : ""
const frontendEnv = existsSync(join(root, "frontend/.env.local")) ? readFileSync(join(root, "frontend/.env.local"), "utf8") : ""
const apiPort = /^PORT=(\d+)/m.exec(backendEnv)?.[1] ?? "3333"
const webPort = process.env.INIA_WEB_PORT ?? /^INIA_WEB_PORT=(\d+)/m.exec(frontendEnv)?.[1] ?? "3000"
// Com o IIS na frente (npm run env:init -- --public-url …), a interface escuta só na própria máquina.
const webHost = process.env.INIA_WEB_HOST ?? /^INIA_WEB_HOST=(\S+)/m.exec(frontendEnv)?.[1] ?? null

const colors = { api: "\u001b[36m", web: "\u001b[35m" }
const reset = "\u001b[0m"
const children = []
let stopping = false

function run(name, directory) {
  // A API lê a própria porta do backend/.env; a interface recebe PORT só para ela.
  const { PORT: _ignored, ...base } = process.env
  const env = name === "web" ? { ...base, PORT: webPort } : base
  // No Windows o npm é um .cmd, que o Node só inicia através do shell.
  const args = name === "web" && webHost ? ["run", mode, "--", "-H", webHost] : ["run", mode]
  const child = spawn(npm, args, { cwd: join(root, directory), env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" })
  const prefix = `${colors[name]}[${name}]${reset} `
  const pipe = (stream, target) => {
    let buffer = ""
    stream.on("data", (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) target.write(`${prefix}${line}\n`)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${prefix}encerrou (código ${code}). Parando o outro serviço.`)
      shutdown(code ?? 1)
    }
  })
  children.push(child)
}

function shutdown(code) {
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM")
  setTimeout(() => process.exit(code), 500)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

console.log(`INIA (${mode === "dev" ? "desenvolvimento" : "produção"}) — aplicação em http://localhost:${webPort} · API em http://localhost:${apiPort} · Ctrl+C para parar`)
run("api", "backend")
run("web", "frontend")
