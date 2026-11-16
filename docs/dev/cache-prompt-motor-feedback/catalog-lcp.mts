// Experimento natural em PRACTICE_IDENTITY: reconstrói o catálogo de práticas como estava em cada chamada e mede o prefixo comum real.
// Só leitura, rede bloqueada, só números na saída.
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const OUT = import.meta.dirname
const require = createRequire(B + "/package.json")
const pg = require("pg")
;(globalThis as any).fetch = async () => { throw new Error("REDE BLOQUEADA NESTE DIAGNÓSTICO") }
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 2 })
if ((await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only !== "on") throw new Error("não está em leitura")
const { renderPracticeIdentityTurn, PRACTICE_IDENTITY_SYSTEM_PROMPT } = await import(B + "/src/modules/feedback-engine/domain/practice-identity.ts")
const lcp = (a: string, b: string) => { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; return i }
const CHARS_PER_TOKEN = Number(process.argv[2] ?? 3.9)

const calls = (await db.query(`
  with c as (
    select r.organization_id org, x.value->>'stage' stage, (x.value->>'inputTokens')::int inp, r.started_at, r.completed_at
    from feedback_analysis_runs r, jsonb_array_elements(r.metrics->'calls') x
    where r.started_at >= now()-interval '32 days' and x.value->>'stage'='PRACTICE_IDENTITY'
  )
  select distinct on (ev.id) ev.id, ev.occurred_at, ev.input_tokens, ev.cached_tokens, ev.duration_ms, c.org
  from ai_usage_events ev join c on c.inp=ev.input_tokens and ev.occurred_at between c.started_at - interval '2 min' and coalesce(c.completed_at, c.started_at + interval '30 min') + interval '2 min'
  where ev.use_case='FEEDBACK_ANALYSIS' and ev.occurred_at >= now()-interval '30 days'
  order by ev.id`)).rows.sort((a: any, b: any) => a.occurred_at - b.occurred_at)

const practices = (await db.query(`select organization_id org, practice_key, title, created_at from knowledge_practices order by created_at, practice_key`)).rows
const members = (await db.query(`select organization_id org, practice_key, source_title, section_heading, rule_text, assigned_at, line_key from knowledge_practice_members order by assigned_at, line_key`)).rows
const byKey = new Map<string, any[]>()
for (const m of members) { const k = `${m.org}|${m.practice_key}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(m) }

// O pedido em T é montado ANTES da chamada; `occurred_at` é o fim dela: desconta a duração.
const catalogAt = (org: string, t: number) => practices.filter((p: any) => p.org === org && p.created_at.getTime() < t).map((p: any) => ({
  practiceKey: p.practice_key, title: p.title, shortTitle: null,
  examples: (byKey.get(`${org}|${p.practice_key}`) ?? []).filter((m) => m.assigned_at.getTime() < t).slice(0, 2).map((m) => ({ sourceTitle: m.source_title, heading: m.section_heading, text: m.rule_text })),
}))

const rows = calls.map((c: any) => {
  const t = c.occurred_at.getTime() - (c.duration_ms ?? 0)
  const cat = catalogAt(c.org, t)
  const text = PRACTICE_IDENTITY_SYSTEM_PROMPT + "\n" + renderPracticeIdentityTurn(cat, [])
  return { t, end: c.occurred_at.getTime(), ent: c.input_tokens, cache: c.cached_tokens ?? 0, text, n: cat.length }
})

const out: any[] = []
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]!
  let bestLcp = 0, bestGap = null as number | null, prevEnd = null as number | null
  // Só pode ter sido cacheado por pedido anterior já iniciado; considera todos os anteriores do mesmo dia (24 h).
  for (let j = i - 1; j >= 0 && r.t - rows[j]!.t < 86_400_000; j--) {
    const l = lcp(rows[j]!.text, r.text)
    if (l > bestLcp) { bestLcp = l; bestGap = (r.t - rows[j]!.t) / 1000 }
  }
  const prev = i > 0 ? rows[i - 1]! : null
  out.push({ dia: new Date(r.end).toISOString().slice(0, 10), ent: r.ent, cache: r.cache, praticas: r.n, catalogoTok: Math.round(r.text.length / CHARS_PER_TOKEN), lcpAntTok: prev ? Math.round(lcp(prev.text, r.text) / CHARS_PER_TOKEN) : 0, gapAntS: prev ? Math.round((r.t - prev.t) / 1000) : null, melhorLcpTok: Math.round(bestLcp / CHARS_PER_TOKEN), melhorGapS: bestGap === null ? null : Math.round(bestGap) })
}
writeFileSync(OUT + "/catalog-lcp.json", JSON.stringify(out, null, 0))

const bucket = (name: string, f: (x: any) => boolean) => { const s = out.filter(f); return { faixa: name, n: s.length, acertos: s.filter((x) => x.cache > 0).length, cacheMedioNosAcertos: Math.round(s.filter((x) => x.cache > 0).reduce((a, x) => a + x.cache, 0) / Math.max(1, s.filter((x) => x.cache > 0).length)) } }
const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length))
console.log(JSON.stringify({
  chamadas: out.length, sistemaChars: PRACTICE_IDENTITY_SYSTEM_PROMPT.length,
  fidelidade_tokens: { entradaMedia: avg(out.map((x) => x.ent)), catalogoReconstruidoMedio: avg(out.map((x) => x.catalogoTok)), razaoMedia: +(out.reduce((a, x) => a + x.catalogoTok / x.ent, 0) / out.length).toFixed(3) },
  porLCP_comChamadaAnterior: [bucket("LCP >= 20 mil e intervalo <= 5 min", (x) => x.lcpAntTok >= 20000 && x.gapAntS !== null && x.gapAntS <= 300), bucket("LCP >= 10 mil e intervalo <= 5 min", (x) => x.lcpAntTok >= 10000 && x.gapAntS !== null && x.gapAntS <= 300), bucket("LCP >= 10 mil e intervalo <= 2 min", (x) => x.lcpAntTok >= 10000 && x.gapAntS !== null && x.gapAntS <= 120), bucket("LCP >= 4,1 mil e intervalo <= 5 min", (x) => x.lcpAntTok >= 4100 && x.gapAntS !== null && x.gapAntS <= 300), bucket("LCP < 4,1 mil ou intervalo > 5 min", (x) => !(x.lcpAntTok >= 4100 && x.gapAntS !== null && x.gapAntS <= 300))],
  lcpAnterior: { p10: [...out].map((x) => x.lcpAntTok).sort((a, b) => a - b)[Math.floor(out.length * 0.1)], p50: [...out].map((x) => x.lcpAntTok).sort((a, b) => a - b)[Math.floor(out.length * 0.5)], p90: [...out].map((x) => x.lcpAntTok).sort((a, b) => a - b)[Math.floor(out.length * 0.9)] },
  acertos: out.filter((x) => x.cache > 0).map((x) => ({ dia: x.dia, ent: x.ent, cache: x.cache, catalogoTok: x.catalogoTok, lcpAntTok: x.lcpAntTok, gapAntS: x.gapAntS, melhorLcpTok: x.melhorLcpTok, melhorGapS: x.melhorGapS })),
}, null, 1))
await db.end()
