// TESTE (pago, com teto) de pré-seleção de argumentários PELA IA: a IA lê só nome + quando se aplica + quando não se aplica de cada
// argumentário e a conversa, e devolve os que PODEM valer (na dúvida, inclui). Mede quantos "aplica" do gabarito ficariam de fora.
// Modelo do dev (gemini-3.8-flash). Rede: só a API do Gemini. Teto rígido de gasto; resultados gravados para retomar sem repetir.
//
//   cd backend && npx tsx ../docs/dev/varredura-prompts/argumentarios-ia.mts <gabarito.json> <resultados.jsonl> <limite_de_chamadas> <teto_usd>
import { appendFileSync, existsSync, readFileSync } from "node:fs"
const [GABARITO, RESULTADOS, LIMITE, TETO] = process.argv.slice(2)
const limit = Number(LIMITE ?? 8)
const cap = Number(TETO ?? 0.95)
const realFetch = globalThis.fetch
;(globalThis as any).fetch = async (url: string, init: any) => {
  if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) throw new Error("REDE BLOQUEADA (só a API do Gemini)")
  return realFetch(url, init)
}
const key = readFileSync(".env", "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.replace(/^["']|["']$/g, "")
if (!key) throw new Error("sem GEMINI_API_KEY")
const MODEL = "gemini-3.8-flash"
const PRICE = { input: 0.75, output: 3.75 } // US$ por milhão (vigente até 31/12/2026; tabela ai_model_pricing)

const SYSTEM = [
  "Você faz a PRÉ-SELEÇÃO dos argumentários para a análise de uma chamada de atendimento.",
  "Uma etapa seguinte vai ler cada argumentário escolhido por inteiro e decidir, com cuidado, se ele se aplica e se foi cumprido. Aqui você só tira da lista os que CLARAMENTE não têm relação com o que aconteceu nesta conversa.",
  "Na dúvida, INCLUA. Deixar de fora um argumentário que valia é um erro grave (a análise perde um ponto); incluir um a mais custa pouco.",
  "Leia a conversa inteira. O \"quando se aplica\" descreve uma situação de atendimento, não palavras a procurar. Argumentários de condução geral valem sempre que a situação descrita acontece, qualquer que seja o assunto.",
  'Responda só com JSON: {"selecionados": ["A1", "A7"]} — os códigos da lista, sem repetir. Lista vazia se nenhum pode valer.',
].join("\n\n")

const data = (JSON.parse(readFileSync(GABARITO!, "utf8")) as any[]).filter((r) => r.applies.length > 0)
// Ordem fixa e embaralhada (semente 9): o teto corta uma amostra, não sempre as mesmas análises do começo.
let seed = 9
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
data.sort(() => rand() - 0.5)

const done = new Map<string, any>()
if (existsSync(RESULTADOS!)) for (const line of readFileSync(RESULTADOS!, "utf8").split("\n").filter(Boolean)) {
  const row = JSON.parse(line)
  done.set(row.run, row)
}
let spent = [...done.values()].reduce((sum, row) => sum + row.cost, 0)

function userTurn(r: any): string {
  const list = r.scripts.map((s: any, i: number) => `A${i + 1} · ${s.name}${s.trigger ? ` · Quando se aplica: ${s.trigger}` : ""}${s.notApplicableWhen ? ` · Quando não se aplica: ${s.notApplicableWhen}` : ""}`)
  return [`Assunto registrado: ${r.subject ?? "não informado"}`, `Canal: ${r.channel}`, r.signals.length ? `Sinais: ${r.signals.join("; ")}` : "", "", "CONVERSA:", r.transcript, "", `ARGUMENTÁRIOS (${r.scripts.length}):`, ...list].filter((x) => x !== null).join("\n")
}

let calls = 0
for (const r of data) {
  if (done.has(r.run)) continue
  if (calls >= limit) break
  if (spent >= cap - 0.02) {
    console.log(JSON.stringify({ parou: "teto de gasto", gasto: +spent.toFixed(4) }))
    break
  }
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: userTurn(r) }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { selecionados: { type: "ARRAY", items: { type: "STRING" } } }, required: ["selecionados"] } },
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) })
  if (!response.ok) {
    console.log(JSON.stringify({ erro: response.status }))
    break
  }
  const json: any = await response.json()
  const usage = json.usageMetadata ?? {}
  const cost = ((usage.promptTokenCount ?? 0) * PRICE.input + ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) * PRICE.output) / 1e6
  spent += cost
  calls++
  let selected: string[] = []
  try {
    selected = JSON.parse(json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "{}").selecionados ?? []
  } catch {
    selected = []
  }
  const ids = new Set(selected.map((code) => r.scripts[Number(String(code).replace(/\D/g, "")) - 1]?.id).filter(Boolean))
  const row = { run: r.run, applies: r.applies, selectedIds: [...ids], sent: r.scripts.length, keptChars: r.scripts.filter((s: any) => ids.has(s.id)).reduce((sum: number, s: any) => sum + s.renderedChars, 0), totalChars: r.scripts.reduce((sum: number, s: any) => sum + s.renderedChars, 0), input: usage.promptTokenCount, output: usage.candidatesTokenCount, thoughts: usage.thoughtsTokenCount ?? 0, cost }
  appendFileSync(RESULTADOS!, JSON.stringify(row) + "\n")
  done.set(r.run, row)
}

const rows = [...done.values()]
const applies = rows.reduce((sum, row) => sum + row.applies.length, 0)
const kept = rows.reduce((sum, row) => sum + row.applies.filter((id: string) => row.selectedIds.includes(id)).length, 0)
console.log(
  JSON.stringify({
    analises: rows.length,
    aplica: applies,
    recuperacao: `${((100 * kept) / Math.max(1, applies)).toFixed(1)}% (${applies - kept} perdidos)`,
    analisesSemPerda: rows.filter((row) => row.applies.every((id: string) => row.selectedIds.includes(id))).length,
    escolhidosPorAnalise: +(rows.reduce((sum, row) => sum + row.selectedIds.length, 0) / Math.max(1, rows.length)).toFixed(1),
    tokensMantidos: `${((100 * rows.reduce((s, r) => s + r.keptChars, 0)) / Math.max(1, rows.reduce((s, r) => s + r.totalChars, 0))).toFixed(0)}%`,
    porChamada: { entrada: Math.round(rows.reduce((s, r) => s + r.input, 0) / rows.length), saida: Math.round(rows.reduce((s, r) => s + r.output, 0) / rows.length), raciocinio: Math.round(rows.reduce((s, r) => s + r.thoughts, 0) / rows.length), custo: +(spent / rows.length).toFixed(4) },
    gastoTotal: +spent.toFixed(4),
  }),
)
