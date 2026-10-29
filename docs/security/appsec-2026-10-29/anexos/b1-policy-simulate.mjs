// Prova do B1: Gerente com o papel GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO (sem people.manage) simula a política de exemplo sobre a
// Supervisora subordinada que está em afastamento sensível (INSS, período sintético inserido no banco descartável).
import { writeFileSync } from "node:fs"
import { login, call } from "./lib.mjs"
const SUP06 = "de003fdf-b93b-4781-8fc9-6085c6ec2e0d", GERENTE02 = "de00ac02-9ba0-4638-8fa4-30241766aeef"
const POLICY = "de00a1e3-0000-4000-8000-000000000001"
const carla = await login("carla.nunes@inia.com")
const grant = await call(carla.cookie, "POST", `/api/v1/admin/access/accounts/${GERENTE02}/roles`, { body: { roleCode: "GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO", scope: { type: "ORGANIZATION" } } })
console.log("papel concedido pela admin geral:", grant.status, grant.json?.error?.code ?? "")
const g = await login("gerente02.demo@inia.local")
const people = await call(g.cookie, "GET", `/api/v1/admin/users?search=Rosana`)
console.log("gerente → /admin/users (people.manage):", people.status, people.json?.error?.code ?? "")
const sim = await call(g.cookie, "POST", `/api/v1/admin/intervention-policies/policies/${POLICY}/simulate`, { body: { personId: SUP06, version: "DRAFT" }, raw: true })
const text = sim.text
const hits = [...new Set(text.match(/[^"]{0,60}(INSS|MATERNIDADE|PATERNIDADE)[^"]{0,40}/g) ?? [])]
console.log("gerente → simulate sobre a supervisora:", sim.status, sim.json?.error?.code ?? "", "| ocorrências:", hits.slice(0, 4))
const lead = await call(g.cookie, "GET", `/api/v1/supervisor/operators/${SUP06}`, { raw: true })
console.log("gerente → ficha da supervisora (tela gerencial): ", lead.status, /INSS/.test(lead.text) ? "contém INSS" : "não contém INSS", /motivo protegido|AFASTAMENTO_PROTEGIDO|SENSITIVE_LEAVE/.test(lead.text) ? "(mostra 'protegido')" : "")
writeFileSync(new URL("../raw/dynamic/b1-evidence.json", import.meta.url), JSON.stringify({ grant: grant.status, adminUsers: people.status, simulate: sim.status, occurrences: hits, leadershipProfileStatus: lead.status, leadershipProfileHasINSS: /INSS/.test(lead.text) }, null, 1))
