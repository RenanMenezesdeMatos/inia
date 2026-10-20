/**
 * PROVA com Docker: o processo REAL da INIA (API + processamento, `src/main/server.ts`) sobrevive à queda do banco interno e
 * volta sozinho quando ele volta — o que acontece num reinício do PostgreSQL ou na troca para uma réplica (failover). Usa um
 * PostgreSQL próprio num contêiner (nada no banco de desenvolvimento nem no de teste) e apaga o contêiner no fim.
 *
 *   INIA_DOCKER_PROOF=1 npx vitest run database-outage-proof
 *
 * Mede também quanto tempo a INIA leva para perceber a queda (/ready = 503) e para voltar (/ready = 200).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createServer } from "node:net"
import { join } from "node:path"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runMigrations } from "../run-migrations.js"

const ENABLED = process.env.INIA_DOCKER_PROOF === "1"
const IMAGE = process.env.INIA_DOCKER_PROOF_IMAGE ?? "postgres:17"
const CONTAINER = `inia-outage-proof-${randomBytes(4).toString("hex")}`
const PASSWORD = randomBytes(12).toString("hex")
const BACKEND = join(import.meta.dirname, "../../../..")

let dbPort = 0
let apiPort = 0
let server: ChildProcess | null = null
let serverLog = ""

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })
}

const databaseUrl = () => `postgresql://postgres:${PASSWORD}@127.0.0.1:${dbPort}/inia`

async function waitForDatabase(timeoutMs: number) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 1_000 })
    try {
      await client.connect()
      await client.query("select 1")
      await client.end()
      return
    } catch {
      await client.end().catch(() => {})
      await sleep(300)
    }
  }
  throw new Error("o PostgreSQL do contêiner não respondeu a tempo")
}

async function ready(): Promise<number> {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/ready`, { signal: AbortSignal.timeout(5_000) })
    return response.status
  } catch {
    return 0
  }
}

/** Espera o /ready responder `status`; devolve quantos ms levou. */
async function waitForReady(status: number, timeoutMs: number): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if ((await ready()) === status) return Date.now() - start
    await sleep(250)
  }
  throw new Error(`/ready não chegou a ${status} em ${timeoutMs} ms. Log do servidor:\n${serverLog.slice(-3000)}`)
}

describe.skipIf(!ENABLED)("Queda e volta do banco interno — prova com Docker", () => {
  beforeAll(async () => {
    dbPort = await freePort()
    apiPort = await freePort()
    // Porta fixa no contêiner: depois de parar e iniciar de novo, o banco volta no MESMO endereço (como num failover com DNS/IP fixo).
    docker("run", "-d", "--name", CONTAINER, "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-e", "POSTGRES_DB=inia", "-p", `127.0.0.1:${dbPort}:5432`, IMAGE)
    await waitForDatabase(60_000)
    const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 })
    const client = await pool.connect()
    try {
      await runMigrations(client, () => {})
    } finally {
      client.release()
      await pool.end()
    }
    server = spawn(join(BACKEND, "node_modules/.bin/tsx"), ["src/main/server.ts"], {
      cwd: BACKEND,
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl(),
        PORT: String(apiPort),
        HOST: "127.0.0.1",
        INIA_PROCESS_ROLE: "all",
        WORKER_HEALTH_PORT: "0",
        INIA_DATABASE_SESSION: "server",
        // Conexão nova desiste rápido enquanto o banco está fora (o padrão é 10 s); limites de comando curtos para o teto do
        // lado da aplicação (maior limite + 5 s = 9 s) aparecer em segundos.
        DATABASE_CONNECTION_TIMEOUT_MS: "3000",
        // Controle negativo: INIA_DOCKER_PROOF_STATEMENT_TIMEOUT_MS=0 tira os limites (e o teto) — o caso travado deve falhar.
        DATABASE_STATEMENT_TIMEOUT_MS: process.env.INIA_DOCKER_PROOF_STATEMENT_TIMEOUT_MS ?? "4000",
        DATABASE_WORKER_STATEMENT_TIMEOUT_MS: process.env.INIA_DOCKER_PROOF_STATEMENT_TIMEOUT_MS ?? "4000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    server.stdout?.on("data", (chunk) => (serverLog += String(chunk)))
    server.stderr?.on("data", (chunk) => (serverLog += String(chunk)))
    await waitForReady(200, 90_000)
  }, 240_000)

  afterAll(async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM")
      await sleep(1_000)
      if (server.exitCode === null) server.kill("SIGKILL")
    }
    try {
      docker("rm", "-f", CONTAINER)
    } catch {
      // contêiner já removido
    }
  }, 30_000)

  it("banco parado: o processo continua de pé e o /ready avisa (503); banco de volta: a INIA volta sozinha (200)", async () => {
    expect(await ready()).toBe(200)

    docker("stop", "-t", "1", CONTAINER)
    const detectMs = await waitForReady(503, 20_000)
    const health = await fetch(`http://127.0.0.1:${apiPort}/health`)
    expect(health.status).toBe(200)
    // Uma rota que precisa do banco responde erro (nunca trava, nunca derruba o processo).
    const me = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "ninguem@prova.inia.local", password: "qualquer" }),
      signal: AbortSignal.timeout(15_000),
    })
    expect(me.status).toBeGreaterThanOrEqual(500)
    // Deixa o processamento em segundo plano (Workflows, tarefas periódicas) bater no banco fora algumas vezes.
    await sleep(5_000)
    expect(server!.exitCode).toBeNull()

    docker("start", CONTAINER)
    const recoverMs = await waitForReady(200, 60_000)
    expect(server!.exitCode).toBeNull()
    // Depois da volta, uma rota com banco responde normalmente (login recusado = o banco foi consultado).
    const again = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "ninguem@prova.inia.local", password: "qualquer" }),
    })
    expect(again.status).toBe(401)
    console.log(JSON.stringify({ event: "database_outage_proof", detectMs, recoverAfterStartMs: recoverMs }))
  }, 180_000)

  it("banco TRAVADO (rede cortada, sem resposta nem recusa): o /ready avisa, as rotas respondem erro em tempo finito e tudo volta", async () => {
    expect(await waitForReady(200, 30_000)).toBeGreaterThanOrEqual(0)
    const login = () =>
      fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "ninguem@prova.inia.local", password: "qualquer" }),
        signal: AbortSignal.timeout(60_000),
      }).then((response) => response.status, () => 0)
    // Conexões já abertas no pool (o caso perigoso: o comando vai por uma conexão que o banco não responde mais).
    expect(await login()).toBe(401)
    docker("pause", CONTAINER)
    try {
      const detectMs = await waitForReady(503, 20_000)
      // Mais pedidos ao mesmo tempo do que conexões no pool: nenhum fica pendurado além do teto e o processo segue de pé.
      const started = Date.now()
      const statuses = await Promise.all(Array.from({ length: 25 }, login))
      const answeredMs = Date.now() - started
      console.log(JSON.stringify({ event: "database_frozen_proof", detectMs, statuses: [...new Set(statuses)], answeredMs }))
      expect(statuses.every((status) => status >= 500)).toBe(true)
      expect(answeredMs).toBeLessThan(45_000)
      // A conferência de prontidão não prende conexões: continua respondendo na hora.
      const probeStarted = Date.now()
      expect(await ready()).toBe(503)
      expect(Date.now() - probeStarted).toBeLessThan(5_000)
      expect(server!.exitCode).toBeNull()
    } finally {
      docker("unpause", CONTAINER)
    }
    await waitForReady(200, 60_000)
    expect(await login()).toBe(401)
  }, 180_000)
})
