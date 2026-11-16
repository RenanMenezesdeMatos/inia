// Roteamento: reconstrói o prompt de sistema do Orquestrador com perguntas reais gravadas. Só leitura, rede bloqueada, só números.
import { createRequire } from "node:module"
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const require = createRequire(B + "/package.json")
const pg = require("pg")
;(globalThis as any).fetch = async () => { throw new Error("REDE BLOQUEADA") }
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 4 })
if ((await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only !== "on") throw new Error("não está em leitura")
const { resolveOrchestratorForSubject } = await import(B + "/src/modules/assistant/application/resolve-orchestrator.ts")
const lcp = (a: string, b: string) => { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; return i }
const q = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]! }
const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length))
const K = 3.99

const msgs = (await db.query(`
  select i.organization_id org, i.operator_id person, i.content, i.occurred_at
  from assistant_interactions i
  where i.role='user' and i.occurred_at >= now()-interval '30 days' and length(i.content) between 8 and 600
  order by i.occurred_at desc limit 160`)).rows

const rows: any[] = []; const errors = new Map<string, number>(); let noOrch = 0
for (const m of msgs) {
  try {
    const o = await resolveOrchestratorForSubject(db, m.org, m.person, "INTERACTIVE", m.content)
    if (!o) { noOrch++; continue }
    rows.push({ orch: o.orchestratorId, person: m.person, sys: o.systemPrompt, toolsChars: JSON.stringify(o.tools).length, nTools: o.tools.length, mode: o.knowledge?.mode ?? "?", at: m.occurred_at.getTime() })
  } catch (e) { const k = e instanceof Error ? e.message.slice(0, 80) : "erro"; errors.set(k, (errors.get(k) ?? 0) + 1) }
}
console.log("mensagens:", msgs.length, "reconstruídas:", rows.length, "sem orquestrador:", noOrch, "erros:", JSON.stringify([...errors.entries()].slice(0, 4)))
const byO = new Map<string, any[]>(); for (const r of rows) { if (!byO.has(r.orch)) byO.set(r.orch, []); byO.get(r.orch)!.push(r) }
for (const [id, rs] of [...byO.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
  const lens = rs.map((r) => r.sys.length)
  // LCP de TODOS os pares do mesmo orquestrador (amostra limitada): o que é realmente fixo entre perguntas.
  const pairs: number[] = []; const consec: number[] = []
  for (let i = 1; i < rs.length; i++) { consec.push(lcp(rs[i - 1].sys, rs[i].sys)); for (let j = Math.max(0, i - 12); j < i; j++) pairs.push(lcp(rs[j].sys, rs[i].sys)) }
  const minLcp = pairs.length ? Math.min(...pairs) : 0
  const modes: Record<string, number> = {}; for (const r of rs) modes[r.mode] = (modes[r.mode] ?? 0) + 1
  console.log(JSON.stringify({ orquestrador: id.slice(0, 8), mensagens: rs.length, pessoas: new Set(rs.map((r) => r.person)).size, modos: modes, sistema_tokens: { p10: Math.round(q(lens, 0.1) / K), p50: Math.round(q(lens, 0.5) / K), p90: Math.round(q(lens, 0.9) / K) }, tools: { n: rs[0].nTools, tokens: Math.round(rs[0].toolsChars / K) }, lcpSeguidas_tokens: { p10: Math.round(q(consec, 0.1) / K), p50: Math.round(q(consec, 0.5) / K), p90: Math.round(q(consec, 0.9) / K) }, lcpMinimoEntrePares_tokens: Math.round(minLcp / K), sistemasDistintos: new Set(rs.map((r) => r.sys)).size }))
  // Onde cai o primeiro byte variável: mostra só o RÓTULO estrutural antes do ponto de quebra (nunca conteúdo de pergunta).
  const at = q(consec, 0.5); const ctx = rs[0].sys.slice(Math.max(0, at - 70), at).replace(/\s+/g, " ")
  console.log("  perto do ponto de quebra (texto fixo do prompt):", JSON.stringify(ctx))
}
await db.end()
