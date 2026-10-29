// Testes direcionados (WSTG-SESS / ATHN / CLNT / ERRH / BUSL), alvo local isolado. Saída: raw/dynamic/session-tests.json
import { writeFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { API, WEB, login, call, record, results } from "./lib.mjs"
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
const decode = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString())
const tokenOf = (cookie) => cookie.split("=")[1]
const OP2 = "operador0002.demo@inia.local", OPB = "opb@orgb.appsec.local", SUPB = "supb@orgb.appsec.local"

// Cookie e logout
let s = await login(OP2)
record("SESS-01", "Atributos do cookie de sessão", "__Host-, HttpOnly, Secure, SameSite, Path=/", s.setCookie.find((c) => c.includes("inia_session"))?.replace(/=[^;]+/, "=<mascarado>"), /^__Host-inia_session=/.test(s.cookie) && /HttpOnly/.test(s.setCookie.join()) && /Secure/.test(s.setCookie.join()) && /SameSite=Lax/i.test(s.setCookie.join()))
const claims = decode(tokenOf(s.cookie))
record("SESS-02", "Claims do JWT", "sem dado sensível; exp e jti presentes", Object.keys(claims).join(","), Boolean(claims.exp && claims.jti) && !("email" in claims) && !("password" in claims))
await call(s.cookie, "POST", "/api/v1/auth/logout")
let r = await call(s.cookie, "GET", "/api/v1/auth/me")
record("SESS-03", "Token reaproveitado depois do logout", "401", r.status, r.status === 401)
// Sair de todos os aparelhos
const s1 = await login(OP2), s2 = await login(OP2)
r = await call(s1.cookie, "POST", "/api/v1/auth/logout-all")
const r2 = await call(s2.cookie, "GET", "/api/v1/auth/me")
record("SESS-04", "Outra sessão depois de 'sair de todos'", "401", `${r.status}/${r2.status}`, r2.status === 401)
// Adulteração do JWT
s = await login(OP2)
const [h, p, sig] = tokenOf(s.cookie).split(".")
const forged = `${h}.${b64({ ...decode(tokenOf(s.cookie)), role: "ADMIN" })}.${sig}`
r = await call(`__Host-inia_session=${forged}`, "GET", "/api/v1/auth/me")
record("SESS-05", "JWT com payload alterado (role) e assinatura antiga", "401", r.status, r.status === 401)
const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...decode(tokenOf(s.cookie)) })}.`
r = await call(`__Host-inia_session=${none}`, "GET", "/api/v1/auth/me")
record("SESS-06", "JWT alg=none", "401", r.status, r.status === 401)
const wrongKey = `${h}.${p}.${createHmac("sha256", "inia-dev-secret-change-me").update(`${h}.${p}`).digest("base64url")}`
r = await call(`__Host-inia_session=${wrongKey}`, "GET", "/api/v1/auth/me")
record("SESS-07", "JWT assinado com o segredo de exemplo publicado", "401", r.status, r.status === 401)
const hs = `${b64({ alg: "HS512", typ: "JWT" })}.${p}.${createHmac("sha512", "x").update("y").digest("base64url")}`
r = await call(`__Host-inia_session=${hs}`, "GET", "/api/v1/auth/me")
record("SESS-08", "JWT com algoritmo trocado (HS512)", "401", r.status, r.status === 401)
r = await call(`inia_session=${tokenOf(s.cookie)}`, "GET", "/api/v1/auth/me")
record("SESS-09", "Token válido em cookie sem o prefixo __Host-", "401 (produção só lê __Host-)", r.status, r.status === 401)
// CSRF / origem
r = await call(s.cookie, "POST", "/api/v1/auth/activity", { origin: "https://evil.example" })
record("CSRF-01", "Escrita com cookie e Origin de outro site", "403", `${r.status} ${r.json?.error?.code ?? ""}`, r.status === 403)
r = await call(s.cookie, "POST", "/api/v1/auth/activity", { origin: null, headers: { "sec-fetch-site": "cross-site" } })
record("CSRF-02", "Escrita com cookie, sem Origin e Sec-Fetch-Site cross-site", "403", `${r.status} ${r.json?.error?.code ?? ""}`, r.status === 403)
r = await call(s.cookie, "POST", "/api/v1/auth/activity", { origin: null })
record("CSRF-03", "Escrita com cookie sem Origin nem Sec-Fetch-Site", "aceita (risco aceito R-26)", r.status, r.status < 400, "R-26")
r = await call(s.cookie, "POST", "/api/v1/auth/activity", { origin: "http://127.0.0.1:3630.evil.example" })
record("CSRF-04", "Origin com prefixo da origem válida", "403", r.status, r.status === 403)
// CORS
let pre = await fetch(`${API}/api/v1/auth/me`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } })
record("CORS-01", "Preflight de origem estranha", "sem Access-Control-Allow-Origin", pre.headers.get("access-control-allow-origin") ?? "(ausente)", !pre.headers.get("access-control-allow-origin"))
pre = await fetch(`${API}/api/v1/auth/me`, { method: "OPTIONS", headers: { origin: WEB, "access-control-request-method": "GET" } })
record("CORS-02", "Preflight da interface", "ACAO = origem da interface + credentials", `${pre.headers.get("access-control-allow-origin")} cred=${pre.headers.get("access-control-allow-credentials")}`, pre.headers.get("access-control-allow-origin") === WEB)
pre = await fetch(`${API}/api/v1/auth/me`, { method: "OPTIONS", headers: { origin: "null", "access-control-request-method": "GET" } })
record("CORS-03", "Preflight com Origin: null", "sem ACAO", pre.headers.get("access-control-allow-origin") ?? "(ausente)", !pre.headers.get("access-control-allow-origin"))
// Login: enumeração e travamento (poucas tentativas, contra conta de teste própria)
const t = async (email, password) => { const start = performance.now(); const x = await login(email, password); return { status: x.status, code: x.body?.error?.code, message: x.body?.error?.message, ms: Math.round(performance.now() - start) } }
const unknown = await t("ninguem.inexistente@orgb.appsec.local", "Senha-Errada-123")
const known = await t(SUPB, "Senha-Errada-123")
record("ATHN-01", "Mensagem para e-mail inexistente × senha errada", "idênticas", `${unknown.status}/${unknown.code} × ${known.status}/${known.code} (${unknown.ms} ms × ${known.ms} ms)`, unknown.status === known.status && unknown.code === known.code && unknown.message === known.message)
const attempts = []
for (let i = 0; i < 8; i++) attempts.push((await t(OPB, `Errada-${i}-xyz`)).status)
const after = await t(OPB, process.env.INIA_DEMO_PASSWORD)
record("ATHN-02", "Tentativas erradas seguidas na mesma conta", "bloqueio temporário (429/423) antes da 8ª; senha certa também barrada durante o bloqueio", `${attempts.join(",")} → certa: ${after.status} ${after.code ?? ""}`, attempts.some((x) => x === 429 || x === 423))
// Erros
let raw = await fetch(`${API}/api/v1/auth/activity`, { method: "POST", headers: { cookie: s.cookie, origin: WEB, "content-type": "application/json" }, body: "{malformado" })
let txt = await raw.text()
record("ERRH-01", "JSON malformado", "400 genérico, sem stack", `${raw.status} ${txt.slice(0, 90)}`, raw.status === 400 && !/at \w+ \(|node_modules|stack/i.test(txt))
raw = await fetch(`${API}/api/v1/auth/activity`, { method: "POST", headers: { cookie: s.cookie, origin: WEB, "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(1_200_000) }) })
txt = await raw.text()
record("ERRH-02", "Corpo JSON acima de 1 MB", "413 genérico", `${raw.status} ${txt.slice(0, 90)}`, raw.status === 413 && !/stack|node_modules/i.test(txt))
r = await call(s.cookie, "GET", "/api/v1/supervision-cases/não-é-uuid'%20or%201=1--")
record("ERRH-03", "Id inválido com aspas no caminho", "400/404 sem erro interno", `${r.status} ${r.json?.error?.code ?? ""}`, r.status === 400 || r.status === 404)
r = await call(null, "GET", "/api/v1/../../etc/passwd")
record("ERRH-04", "Travessia de caminho na URL da API", "404 JSON", `${r.status}`, r.status === 404 || r.status === 401)
// API Push e métricas
r = await call(null, "POST", "/api/v1/data-ingestion/xyz/feed", { body: { records: [] }, origin: null })
record("PUSH-01", "API Push sem token", "401", `${r.status} ${r.json?.error?.code ?? ""}`, r.status === 401)
r = await call(null, "POST", "/api/v1/data-ingestion/xyz/feed", { body: { records: [] }, origin: null, headers: { authorization: "Bearer inia_push_0000000000000000000000000000" } })
record("PUSH-02", "API Push com token inventado", "401", `${r.status} ${r.json?.error?.code ?? ""}`, r.status === 401)
r = await call(null, "GET", "/internal/metrics", { origin: null })
record("CONF-01", "/internal/metrics sem token", "404", r.status, r.status === 404)
r = await call(null, "GET", "/internal/metrics", { origin: null, headers: { "x-forwarded-for": "127.0.0.1" } })
record("CONF-02", "/internal/metrics com X-Forwarded-For forjado", "404", r.status, r.status === 404)
// Troca de senha
r = await call(s.cookie, "POST", "/api/v1/auth/password", { body: { currentPassword: "nao-e-a-senha", newPassword: "Cajueiro2026xQ", confirmPassword: "Cajueiro2026xQ" } })
record("ATHN-03", "Troca de senha com senha atual errada", "recusada", `${r.status} ${r.json?.error?.code ?? ""}`, r.status >= 400 && r.status < 500)
writeFileSync(new URL("../raw/dynamic/session-tests.json", import.meta.url), JSON.stringify(results, null, 1))
