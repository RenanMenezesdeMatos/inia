import { login, call } from "./lib.mjs"
const op = await login("operador0001.demo@inia.local")
const me = (await call(op.cookie, "GET", "/api/v1/auth/me")).json.data
const carla = await login("carla.nunes@inia.com")
const roles = await call(carla.cookie, "GET", `/api/v1/admin/access/accounts/${me.sub}/roles`)
console.log("carla lê papéis do operador:", roles.status)
const carlaMe = (await call(carla.cookie, "GET", "/api/v1/auth/me")).json.data
const carlaRoles = await call(carla.cookie, "GET", `/api/v1/admin/access/accounts/${carlaMe.sub}/roles`)
const carlaAssignment = JSON.stringify(carlaRoles.json).match(/"id":"([0-9a-f-]{36})"/)?.[1]
for (const body of [{ roleCode: "ADMINISTRADOR_GERAL", scopeType: "ORGANIZATION" }, { roleCode: "ADMINISTRADOR_GERAL", scope: { type: "ORGANIZATION" } }, { roleCode: "LEITOR_DE_CONVERSAS_INIA", scopeType: "ORGANIZATION" }]) {
  const r = await call(op.cookie, "POST", `/api/v1/admin/access/accounts/${me.sub}/roles`, { body })
  console.log("operador → auto-atribuir", JSON.stringify(body), r.status, r.json?.error?.code, (r.json?.error?.details ? JSON.stringify(r.json.error.details).slice(0, 160) : ""))
}
const d = await call(op.cookie, "DELETE", `/api/v1/admin/access/accounts/${carlaMe.sub}/roles/${carlaAssignment}`)
console.log("operador → revogar papel da admin geral:", d.status, d.json?.error?.code)
const g = await call(op.cookie, "POST", "/api/v1/admin/access/roles/ANALISTA_DE_ACOMPANHAMENTO/grant-to-leaders", { body: { scopeType: "ORGANIZATION" } })
console.log("operador → grant-to-leaders:", g.status, g.json?.error?.code, JSON.stringify(g.json?.error?.details ?? "").slice(0, 160))
const after = await call(carla.cookie, "GET", `/api/v1/admin/access/accounts/${me.sub}/roles`)
console.log("papéis do operador depois:", after.status, JSON.stringify(after.json).slice(0, 200))
const ai = await call(op.cookie, "GET", "/api/v1/admin/ai/me")
console.log("operador /admin/ai/me:", ai.status, JSON.stringify(ai.json).slice(0, 200))
