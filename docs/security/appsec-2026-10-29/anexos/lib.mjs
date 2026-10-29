// Utilitários dos testes dinâmicos locais (alvo único: API e interface isoladas em 127.0.0.1). Senhas vêm do ambiente e
// nunca são impressas; cookies de sessão aparecem mascarados nos registros.
export const API = process.env.APPSEC_API ?? "http://127.0.0.1:3633"
export const WEB = process.env.APPSEC_WEB ?? "http://127.0.0.1:3630"
export const PASSWORD = process.env.INIA_DEMO_PASSWORD
if (!API.startsWith("http://127.0.0.1:")) throw new Error("alvo não autorizado")
export const mask = (value) => (typeof value === "string" ? value.replace(/(inia_session=|inia_device=)[^;,\s]+/g, "$1<mascarado>") : value)
export async function login(email, password = PASSWORD, extraHeaders = {}) {
  const response = await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: WEB, ...extraHeaders }, body: JSON.stringify({ email, password }), redirect: "manual" })
  const setCookie = response.headers.getSetCookie?.() ?? []
  const session = setCookie.map((c) => c.split(";")[0]).find((c) => c.includes("inia_session="))
  const body = await response.json().catch(() => null)
  return { status: response.status, cookie: session ?? null, setCookie, body }
}
export async function call(cookie, method, path, { body, headers = {}, origin = WEB, raw = false } = {}) {
  const h = { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...headers }
  let payload
  if (body !== undefined) { h["content-type"] = h["content-type"] ?? "application/json"; payload = typeof body === "string" || body instanceof Uint8Array || body instanceof FormData ? body : JSON.stringify(body) }
  if (body instanceof FormData) delete h["content-type"]
  const response = await fetch(`${API}${path}`, { method, headers: h, body: payload, redirect: "manual" })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: response.status, json, text: raw ? text : text.slice(0, 300), headers: response.headers }
}
export const results = []
export function record(id, title, expectation, observed, pass, note = "") {
  results.push({ id, title, expectation, observed, verdict: pass ? "OK" : "FALHOU", note })
  console.log(`${pass ? "OK    " : "FALHOU"} ${id} ${title} — esperado: ${expectation}; observado: ${observed}${note ? ` (${note})` : ""}`)
}
