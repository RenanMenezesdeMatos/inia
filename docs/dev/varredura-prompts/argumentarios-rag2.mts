// TESTE (grátis) de duas técnicas para o RAG achar argumentários: (1) comparar por TRECHO da conversa (janelas de 3 falas; vale o trecho
// mais parecido) em vez da conversa inteira; (2) ENRIQUECER o texto do argumentário com os campos completos do cadastro (orientação,
// pontos exigidos, o que evitar, referência da monitoria). Embeddings locais (bge-m3 no Ollama). Banco só leitura; rede só o Ollama.
//
//   cd backend && npx tsx ../docs/dev/varredura-prompts/argumentarios-rag2.mts <gabarito.json>
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const require = createRequire(B + "/package.json")
const pg = require("pg")
const realFetch = globalThis.fetch
;(globalThis as any).fetch = async (url: string, init: any) => {
  if (!String(url).startsWith("http://localhost:11434/")) throw new Error("REDE BLOQUEADA (só o Ollama local)")
  return realFetch(url, init)
}
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 2 })
const data = (JSON.parse(readFileSync(process.argv[2]!, "utf8")) as any[]).filter((r) => r.scripts.length > 0)

// Campos completos de cada argumentário (versão publicada mais recente; a da data da chamada raramente difere no dev).
const ids = [...new Set(data.flatMap((r) => r.scripts.map((s: any) => s.id)))]
const content = new Map<string, any>()
for (const row of (await db.query(`select distinct on (script_id) script_id, content from argument_script_versions where script_id = any($1::uuid[]) and status = 'PUBLISHED' order by script_id, version desc`, [ids])).rows) content.set(row.script_id, row.content)
await db.end()
const flat = (value: unknown): string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(flat) : value && typeof value === "object" ? Object.entries(value as Record<string, unknown>).filter(([k]) => ["text", "point", "description", "condition"].includes(k)).flatMap(([, v]) => flat(v)) : []

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 32) {
    const response = await fetch("http://localhost:11434/api/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "bge-m3", input: texts.slice(i, i + 32), truncate: true }) })
    if (!response.ok) throw new Error(`ollama ${response.status}`)
    out.push(...((await response.json()) as any).embeddings)
  }
  return out
}
const cos = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / Math.sqrt(na * nb)
}
const cache = new Map<string, number[]>()
async function vectors(texts: string[]) {
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))]
  if (missing.length) {
    const got = await embed(missing)
    missing.forEach((t, i) => cache.set(t, got[i]!))
  }
  return texts.map((t) => cache.get(t)!)
}

const scriptText = {
  gatilho: (s: any) => [s.name, s.trigger ? `Quando: ${s.trigger}` : "", s.notApplicableWhen ? `Não se aplica quando: ${s.notApplicableWhen}` : ""].filter(Boolean).join("\n"),
  completo: (s: any) => {
    const c = content.get(s.id) ?? {}
    return [s.name, c.trigger ? `Quando: ${c.trigger}` : "", ...flat(c.operatorGuidance), ...flat(c.requiredPoints), ...flat(c.avoid), c.monitoringReference ?? "", c.suggestedScript ?? ""].filter(Boolean).join("\n").slice(0, 6000)
  },
}
const windowsOf = (transcript: string, size = 3) => {
  const turns = transcript.split("\n").filter((line) => line.trim())
  if (turns.length <= size) return [turns.join("\n")]
  const out: string[] = []
  for (let i = 0; i + size <= turns.length; i++) out.push(turns.slice(i, i + size).join("\n"))
  return out
}

/** Ordena os argumentários da análise por parecença (conversa inteira ou o melhor trecho). */
async function rank(r: any, sKind: keyof typeof scriptText, mode: "inteira" | "trecho" | "ambos") {
  const scriptVecs = await vectors(r.scripts.map(scriptText[sKind]))
  const whole = mode !== "trecho" ? (await vectors([r.transcript]))[0]! : null
  const wins = mode !== "inteira" ? await vectors(windowsOf(r.transcript)) : []
  return r.scripts
    .map((s: any, i: number) => {
      const v = scriptVecs[i]!
      const scores = [...(whole ? [cos(whole, v)] : []), ...wins.map((w) => cos(w, v))]
      return { s, score: Math.max(...scores) }
    })
    .sort((a: any, b: any) => b.score - a.score)
}

const sent = new Map<string, number>()
const applied = new Map<string, number>()
for (const r of data) {
  for (const s of r.scripts) sent.set(s.id, (sent.get(s.id) ?? 0) + 1)
  for (const id of r.applies) applied.set(id, (applied.get(id) ?? 0) + 1)
}
const rateWithout = (r: any, id: string) => {
  const n = (sent.get(id) ?? 0) - 1
  const a = (applied.get(id) ?? 0) - (r.applies.includes(id) ? 1 : 0)
  return n > 0 ? a / n : 0
}

async function evaluate(label: string, sKind: keyof typeof scriptText, mode: "inteira" | "trecho" | "ambos", withFrequent: boolean, ks: number[]) {
  for (const k of ks) {
    let applies = 0, kept = 0, keptChars = 0, totalChars = 0, keptCount = 0
    for (const r of data) {
      const always = withFrequent ? r.scripts.filter((s: any) => rateWithout(r, s.id) >= 0.1) : []
      const alwaysIds = new Set(always.map((s: any) => s.id))
      const ranked = (await rank(r, sKind, mode)).filter((x: any) => !alwaysIds.has(x.s.id))
      const chosen = new Set([...alwaysIds, ...ranked.slice(0, k).map((x: any) => x.s.id)])
      applies += r.applies.length
      kept += r.applies.filter((id: string) => chosen.has(id)).length
      keptCount += chosen.size
      totalChars += r.scripts.reduce((sum: number, s: any) => sum + s.renderedChars, 0)
      keptChars += r.scripts.filter((s: any) => chosen.has(s.id)).reduce((sum: number, s: any) => sum + s.renderedChars, 0)
    }
    console.log(JSON.stringify({ teste: label, k, recuperacao: `${((100 * kept) / applies).toFixed(1)}% (${applies - kept} perdidos de ${applies})`, enviados: +(keptCount / data.length).toFixed(1), tokensMantidos: `${((100 * keptChars) / totalChars).toFixed(0)}%` }))
  }
}

const KS = [5, 10, 15, 20]
await evaluate("base: conversa inteira × gatilho", "gatilho", "inteira", false, KS)
await evaluate("1) por trecho × gatilho", "gatilho", "trecho", false, KS)
await evaluate("2) conversa inteira × argumentário completo", "completo", "inteira", false, KS)
await evaluate("1+2) por trecho × argumentário completo", "completo", "trecho", false, KS)
await evaluate("1+2) por trecho e inteira × completo", "completo", "ambos", false, KS)
await evaluate("frequentes + 1+2) por trecho × completo", "completo", "trecho", true, [0, 3, 5, 8])
console.log(JSON.stringify({ vetoresCalculados: cache.size }))
