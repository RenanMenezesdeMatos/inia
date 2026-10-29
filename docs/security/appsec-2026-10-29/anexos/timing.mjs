// Tempo de resposta do login: e-mails inexistentes × contas existentes com senha errada (UMA tentativa por conta, sem bloqueio).
import { login } from "./lib.mjs"
const t = async (email) => { const s = performance.now(); const r = await login(email, "Senha-Errada-Teste-1"); return { ms: performance.now() - s, status: r.status } }
const unknown = [], known = []
for (let i = 10; i < 22; i++) {
  unknown.push(await t(`inexistente${i}@demo.invalid`))
  known.push(await t(`operador00${i}.demo@inia.local`))
}
const stats = (xs) => { const v = xs.map((x) => x.ms).sort((a, b) => a - b); return { n: v.length, median: Math.round(v[Math.floor(v.length / 2)]), min: Math.round(v[0]), max: Math.round(v.at(-1)), statuses: [...new Set(xs.map((x) => x.status))] } }
console.log(JSON.stringify({ unknown: stats(unknown), known: stats(known) }))
