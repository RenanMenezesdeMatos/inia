/**
 * Resumo da rodada com IA, sem chamar a IA de novo: lê `respostas.json` e confere a página citada contra o texto de cada página do PDF.
 * A conferência procura todas as palavras do dado na página, porque, em duas colunas gravadas linha a linha, a frase não aparece seguida no texto corrido.
 *
 *   npx tsx scripts/dev/pdf-markdown-eval/report-answers.ts <corpus> <pasta-das-respostas>
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PDFParse } from "pdf-parse"
import { GOLD } from "./gold.js"

type Result = { id: string; arm: "antes" | "depois"; sample: number; kind: string; status: string; answer: string; factsExpected: string[]; factsFound: string[]; correct: boolean; abstained: boolean; sources: { documentId: string; heading: string; pages: { from: number; to: number } | null }[]; rightDocument: boolean; goldPage: number; steps: number; calls: { stage: string; ms: number; usage: { inputTokens: number; cachedTokens: number; reasoningTokens: number; outputTokens: number } | null }[]; ms: number; firstPromptBytes: number; error: string | null }

const fold = (text: string) => text.normalize("NFC").toLowerCase()
const wordsOf = (text: string) => fold(text).match(/[\p{L}\p{N}]+/gu) ?? []
const median = (values: readonly number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0

async function pagesOf(corpus: string, doc: string): Promise<string[]> {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(join(corpus, `${doc}.pdf`))) })
  try {
    return (await parser.getText({ pageJoiner: "" })).pages.map((page) => page.text)
  } finally {
    await parser.destroy()
  }
}

async function main() {
  const [corpus, folder] = process.argv.slice(2)
  if (!corpus || !folder) throw new Error("Uso: report-answers.ts <corpus> <pasta>")
  const data = JSON.parse(readFileSync(join(folder, "respostas.json"), "utf8")) as { results: Result[]; budget: unknown; model: string }
  const docOf = (id: string) => {
    const doc = GOLD.find((question) => question.id === id)!.doc
    return doc === "manual-chrome-tags" ? "manual-chrome-sem-tags" : doc === "duas-colunas-coluna" ? "duas-colunas-linha" : doc
  }
  const cache = new Map<string, string[]>()
  const rows: { id: string; arm: string; sample: number; kind: string; status: string; correct: boolean; abstained: boolean; rightDocument: boolean; pageCited: boolean; pageVerified: boolean; pageExact: boolean; sources: string[]; calls: number; seconds: number; input: number; output: number; thinking: number; firstPromptBytes: number; steps: number; error: string | null; answer: string }[] = []
  for (const result of data.results) {
    const doc = docOf(result.id)
    // O certo vem sempre do gabarito atual, nunca do que a rodada gravou: um critério corrigido vale para todas as respostas já guardadas.
    const gold = GOLD.find((question) => question.id === result.id)!
    const haystack = fold(result.answer).replace(/\s+/g, " ")
    const correct = gold.unanswerable ? !haystack.includes("210") : gold.answerFacts.every((fact) => haystack.includes(fold(fact)))
    const cited = result.sources.filter((source) => source.pages)
    for (const source of cited) if (!cache.has(source.documentId)) cache.set(source.documentId, await pagesOf(corpus, source.documentId))
    // A página citada confere se tem todas as palavras de algum dado esperado, em qualquer base citada: mais de uma base pode trazer o mesmo dado.
    const verified = gold.answerFacts.length > 0 && cited.some((source) => {
      const pages = cache.get(source.documentId)!
      for (let page = source.pages!.from; page <= source.pages!.to; page += 1) {
        const onPage = new Set(wordsOf((pages[page - 1] ?? "").replace(/-\n/g, "")))
        if (gold.answerFacts.some((fact) => wordsOf(fact).every((word) => onPage.has(word)))) return true
      }
      return false
    })
    const exact = cited.some((source) => source.documentId === doc && source.pages!.from === result.goldPage && source.pages!.to === result.goldPage)
    const usage = result.calls.reduce((sum, call) => ({ input: sum.input + (call.usage?.inputTokens ?? 0), output: sum.output + (call.usage?.outputTokens ?? 0), thinking: sum.thinking + (call.usage?.reasoningTokens ?? 0) }), { input: 0, output: 0, thinking: 0 })
    rows.push({ id: result.id, arm: result.arm, sample: result.sample, kind: result.kind, status: result.status, correct, abstained: result.abstained, rightDocument: result.rightDocument, pageCited: cited.length > 0, pageVerified: verified, pageExact: exact, sources: result.sources.map((source) => `${source.heading || "(sem título)"}${source.pages ? ` p.${source.pages.from}${source.pages.to !== source.pages.from ? `-${source.pages.to}` : ""}` : ""}`), calls: result.calls.length, seconds: Math.round(result.ms / 100) / 10, ...usage, firstPromptBytes: result.firstPromptBytes, steps: result.steps, error: result.error, answer: result.answer })
  }
  const armSummary = (arm: "antes" | "depois") => {
    const list = rows.filter((row) => row.arm === arm)
    const answerable = list.filter((row) => row.kind !== "escaneado")
    return {
      n: list.length,
      answerable: answerable.length,
      answered: answerable.filter((row) => row.status === "ANSWERED").length,
      correct: answerable.filter((row) => row.correct).length,
      rightDocument: answerable.filter((row) => row.rightDocument).length,
      pageCited: answerable.filter((row) => row.pageCited).length,
      pageVerified: answerable.filter((row) => row.pageVerified).length,
      correctAndPageVerified: answerable.filter((row) => row.correct && row.pageVerified).length,
      pageExact: answerable.filter((row) => row.pageExact).length,
      unanswerable: list.filter((row) => row.kind === "escaneado").length,
      unanswerableNotInvented: list.filter((row) => row.kind === "escaneado" && row.correct).length,
      medianSeconds: median(list.map((row) => row.seconds)),
      medianCalls: median(list.map((row) => row.calls)),
      medianFirstPromptBytes: median(list.map((row) => row.firstPromptBytes)),
      inputTokens: list.reduce((sum, row) => sum + row.input, 0),
      outputTokens: list.reduce((sum, row) => sum + row.output + row.thinking, 0),
      errors: list.filter((row) => row.error).length,
    }
  }
  const byId = [...new Set(rows.map((row) => row.id))].map((id) => {
    const pair = (arm: string) => rows.filter((row) => row.id === id && row.arm === arm)
    const score = (list: typeof rows) => `${list.filter((row) => row.correct).length}/${list.length}`
    return { id, antes: score(pair("antes")), depois: score(pair("depois")), paginaDepois: `${pair("depois").filter((row) => row.pageVerified).length}/${pair("depois").length}`, statusAntes: pair("antes").map((row) => row.status).join(","), statusDepois: pair("depois").map((row) => row.status).join(",") }
  })
  const report = { model: data.model, budget: data.budget, antes: armSummary("antes"), depois: armSummary("depois"), byId, rows }
  writeFileSync(join(folder, "resumo.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ budget: report.budget, antes: report.antes, depois: report.depois }, null, 1))
  console.table(byId)
  for (const row of rows.filter((candidate) => !candidate.correct || candidate.status !== "ANSWERED" || (candidate.arm === "depois" && !candidate.pageVerified && candidate.kind !== "escaneado"))) console.log(`\n--- ${row.id} ${row.arm} #${row.sample} ${row.status} certo=${row.correct} página=${row.pageVerified} fontes=${row.sources.join(" | ")}\n${row.answer.slice(0, 500)}${row.error ? `\nERRO ${row.error}` : ""}`)
}

void main()
