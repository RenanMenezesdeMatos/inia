// TESTE (grátis) de pré-seleção de argumentários por RAG com vetores: embeddings locais (bge-m3 no Ollama) da conversa × de cada
// argumentário; mantém os K mais parecidos e mede quantos dos "aplica" do gabarito ficariam de fora. Rede: só o Ollama local.
//
//   cd backend && npx tsx ../docs/dev/varredura-prompts/argumentarios-rag.mts <gabarito.json>
import { readFileSync } from "node:fs"
const realFetch = globalThis.fetch
;(globalThis as any).fetch = async (url: string, init: any) => {
  if (!String(url).startsWith("http://localhost:11434/")) throw new Error("REDE BLOQUEADA (só o Ollama local)")
  return realFetch(url, init)
}
const data = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as any[]

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += 16) {
    const response = await fetch("http://localhost:11434/api/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "bge-m3", input: texts.slice(i, i + 16), truncate: true }) })
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

// Textos dos argumentários (dois jeitos) e das conversas (dois jeitos), com cache por texto.
const scriptText = {
  gatilho: (s: any) => [s.name, s.trigger ? `Quando: ${s.trigger}` : "", s.notApplicableWhen ? `Não se aplica quando: ${s.notApplicableWhen}` : ""].filter(Boolean).join("\n"),
  nome: (s: any) => [s.name, s.trigger ?? ""].join("\n"),
}
const callText = {
  conversa: (r: any) => r.transcript,
  assuntoEConversa: (r: any) => [`Assunto: ${r.subject ?? "não informado"}`, r.signals.length ? `Sinais: ${r.signals.join("; ")}` : "", r.transcript].filter(Boolean).join("\n"),
}
const cache = new Map<string, number[]>()
async function vectors(texts: string[]) {
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))]
  const got = await embed(missing)
  missing.forEach((t, i) => cache.set(t, got[i]!))
  return texts.map((t) => cache.get(t)!)
}

const KS = [3, 5, 8, 10, 12, 15, 20]
for (const [sName, sFn] of Object.entries(scriptText)) {
  for (const [cName, cFn] of Object.entries(callText)) {
    let applies = 0
    const keptAt = new Map<number, number>(KS.map((k) => [k, 0]))
    const fullAt = new Map<number, number>(KS.map((k) => [k, 0]))
    const tokensAt = new Map<number, number>(KS.map((k) => [k, 0]))
    const worstRank: number[] = []
    let totalChars = 0
    for (const r of data) {
      if (r.scripts.length === 0) continue
      const [callVec] = await vectors([cFn(r)])
      const scriptVecs = await vectors(r.scripts.map(sFn))
      const ranked = r.scripts.map((s: any, i: number) => ({ s, score: cos(callVec!, scriptVecs[i]!) })).sort((a: any, b: any) => b.score - a.score)
      const rankOf = new Map(ranked.map((x: any, i: number) => [x.s.id, i + 1]))
      const appliesHere = r.applies.filter((id: string) => rankOf.has(id))
      applies += appliesHere.length
      worstRank.push(appliesHere.length ? Math.max(...appliesHere.map((id: string) => rankOf.get(id)!)) : 0)
      totalChars += r.scripts.reduce((sum: number, s: any) => sum + s.renderedChars, 0)
      for (const k of KS) {
        const kept = appliesHere.filter((id: string) => rankOf.get(id)! <= k).length
        keptAt.set(k, keptAt.get(k)! + kept)
        if (kept === appliesHere.length) fullAt.set(k, fullAt.get(k)! + 1)
        tokensAt.set(k, tokensAt.get(k)! + ranked.slice(0, k).reduce((sum: number, x: any) => sum + x.s.renderedChars, 0))
      }
    }
    const n = data.filter((r) => r.scripts.length > 0).length
    const sorted = [...worstRank].sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        argumentario: sName,
        chamada: cName,
        aplica: applies,
        recuperacao: Object.fromEntries(KS.map((k) => [`top${k}`, `${((100 * keptAt.get(k)!) / applies).toFixed(1)}% (${applies - keptAt.get(k)!} perdidos; ${((100 * fullAt.get(k)!) / n).toFixed(0)}% das análises sem perda; ${((100 * tokensAt.get(k)!) / totalChars).toFixed(0)}% dos tokens)`])),
        posicaoDoPiorAplicavel: { p50: sorted[Math.floor(n * 0.5)], p90: sorted[Math.floor(n * 0.9)], max: sorted[n - 1] },
      }),
    )
  }
}

// HÍBRIDO: sempre os argumentários que costumam valer (taxa de "aplica" ≥ 10% nas OUTRAS análises — sem olhar a própria) + os K
// mais parecidos entre os demais. Mostra se o RAG ajuda quando os genéricos já vão sempre.
{
  const sent = new Map<string, number>()
  const applied = new Map<string, number>()
  for (const r of data) {
    for (const s of r.scripts) sent.set(s.id, (sent.get(s.id) ?? 0) + 1)
    for (const id of r.applies) applied.set(id, (applied.get(id) ?? 0) + 1)
  }
  for (const k of [0, 3, 5, 8]) {
    let applies = 0, kept = 0, keptChars = 0, totalChars = 0, keptCount = 0
    for (const r of data) {
      if (r.scripts.length === 0) continue
      const rateWithout = (id: string) => {
        const n = (sent.get(id) ?? 0) - 1
        const a = (applied.get(id) ?? 0) - (r.applies.includes(id) ? 1 : 0)
        return n > 0 ? a / n : 0
      }
      const always = r.scripts.filter((s: any) => rateWithout(s.id) >= 0.1)
      const rest = r.scripts.filter((s: any) => rateWithout(s.id) < 0.1)
      const [callVec] = await vectors([callText.conversa(r)])
      const restVecs = await vectors(rest.map(scriptText.gatilho))
      const top = rest.map((s: any, i: number) => ({ s, score: cos(callVec!, restVecs[i]!) })).sort((a: any, b: any) => b.score - a.score).slice(0, k).map((x: any) => x.s)
      const chosen = new Set([...always, ...top].map((s: any) => s.id))
      const appliesHere = r.applies.filter((id: string) => r.scripts.some((s: any) => s.id === id))
      applies += appliesHere.length
      kept += appliesHere.filter((id: string) => chosen.has(id)).length
      keptCount += chosen.size
      totalChars += r.scripts.reduce((sum: number, s: any) => sum + s.renderedChars, 0)
      keptChars += r.scripts.filter((s: any) => chosen.has(s.id)).reduce((sum: number, s: any) => sum + s.renderedChars, 0)
    }
    console.log(JSON.stringify({ hibrido: `frequentes + top${k} por vetor`, recuperacao: `${((100 * kept) / applies).toFixed(1)}% (${applies - kept} perdidos de ${applies})`, argumentariosEnviados: +(keptCount / data.filter((r) => r.scripts.length > 0).length).toFixed(1), tokensMantidos: `${((100 * keptChars) / totalChars).toFixed(0)}%` }))
  }
}

