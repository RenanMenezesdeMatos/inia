// Varreduras de autorização sobre o inventário de rotas (ver raw/dynamic/routes-clean.json).
//  S1 sem sessão · S2 operador → rotas /admin · S3 admin geral da org B → objetos da org A (comparado com a admin da org A)
//  S4 admin geral da org B lendo listas → procura ids/nome da org A na resposta.
import { readFileSync, writeFileSync } from "node:fs"
import { login, call } from "./lib.mjs"
const routes = JSON.parse(readFileSync(new URL("../raw/dynamic/routes-clean.json", import.meta.url)))
const samples = readFileSync(new URL("./samples-orgA.txt", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("|")[1])
const RANDOM = "3f1e2d4c-5b6a-4789-8abc-def012345678"
const fill = (path, value) => path.replace(/:[A-Za-z_]+/g, value)
const PUBLIC = new Set(["GET /health", "GET /ready", "POST /api/v1/auth/login"])
const out = { S1: [], S2: [], S3: [], S4: [] }
const sessions = {}
async function session(email) {
  if (!sessions[email]) sessions[email] = (await login(email)).cookie
  return sessions[email]
}
async function as(email, method, path, opts) {
  let r = await call(await session(email), method, path, opts)
  if (r.status === 401) { sessions[email] = null; r = await call(await session(email), method, path, opts) }
  return r
}
// S1 — sem sessão (com Origin válido nas escritas, para que só a autenticação decida)
for (const { method, path } of routes) {
  if (PUBLIC.has(`${method} ${path}`)) continue
  const r = await call(null, method, fill(path, RANDOM), { body: method === "GET" || method === "DELETE" ? undefined : {} })
  out.S1.push({ method, path, status: r.status, code: r.json?.error?.code ?? null })
}
// S2 — operador comum em toda rota /api/v1/admin (todas as operações)
const OP = "operador0001.demo@inia.local"
for (const { method, path } of routes.filter((r) => r.path.startsWith("/api/v1/admin"))) {
  const r = await as(OP, method, fill(path, RANDOM), { body: method === "GET" || method === "DELETE" ? undefined : {} })
  out.S2.push({ method, path, status: r.status, code: r.json?.error?.code ?? null })
}
// S3 — objetos da org A: a admin A precisa obter 200; então a admin B tenta o mesmo caminho
const A = "carla.nunes@inia.com", B = "adminb@orgb.appsec.local"
for (const { method, path } of routes.filter((r) => r.method === "GET" && /:[A-Za-z_]+/.test(r.path) && !r.path.includes("/auth/"))) {
  for (const id of samples) {
    const p = fill(path, id)
    const a = await as(A, "GET", p)
    if (a.status !== 200) continue
    const b = await as(B, "GET", p)
    out.S3.push({ path, id, aStatus: a.status, bStatus: b.status, bSnippet: b.status === 200 ? b.text.slice(0, 160) : b.json?.error?.code ?? null })
  }
}
// S4 — listas sem parâmetro lidas pela admin B: algum id da org A (prefixo de00 da massa) ou o nome da org A?
for (const { path } of routes.filter((r) => r.method === "GET" && !/:[A-Za-z_]+/.test(r.path) && r.path.startsWith("/api/v1"))) {
  const r = await as(B, "GET", path, { raw: true })
  const hits = (r.text.match(/de00[0-9a-f]{4}-[0-9a-f-]{27,}/g) ?? []).length
  out.S4.push({ path, status: r.status, orgAIds: hits, orgAName: r.text.includes("INIA Demonstração"), bytes: r.text.length })
}
writeFileSync(new URL("../raw/dynamic/sweeps.json", import.meta.url), JSON.stringify(out, null, 1))
const s1bad = out.S1.filter((x) => x.status < 400 || x.status >= 500)
const s2bad = out.S2.filter((x) => x.status < 400 || x.status >= 500)
const s3bad = out.S3.filter((x) => x.bStatus === 200)
const s4bad = out.S4.filter((x) => x.status === 200 && (x.orgAIds > 0 || x.orgAName))
console.log(JSON.stringify({ S1: { total: out.S1.length, statuses: tally(out.S1.map((x) => x.status)), suspicious: s1bad },
  S2: { total: out.S2.length, statuses: tally(out.S2.map((x) => x.status)), suspicious: s2bad },
  S3: { pairs: out.S3.length, routesWithAOk: new Set(out.S3.map((x) => x.path)).size, bStatuses: tally(out.S3.map((x) => x.bStatus)), leaks: s3bad },
  S4: { total: out.S4.length, statuses: tally(out.S4.map((x) => x.status)), leaks: s4bad } }, null, 1))
function tally(values) { return values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {}) }
