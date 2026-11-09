/**
 * Medição SEM IA: mesmos PDFs e mesmas perguntas, com a extração anterior (`getText`, texto corrido) e a nova (Markdown). A busca é a de produção
 * (`chunkKnowledgeDocument` + `rankChunks` + `selectWithinBudget`, com os limites padrão), sobre todas as bases juntas, como um especialista com várias bases.
 *
 *   npx tsx scripts/dev/pdf-markdown-eval/measure-offline.ts <pasta-do-corpus> <arquivo-de-saída.json>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { PDFParse } from "pdf-parse"
import { chunkKnowledgeDocument, type KnowledgeChunk } from "../../../src/modules/knowledge/domain/knowledge-chunking.js"
import { buildKnowledgeIndex, DEFAULT_RETRIEVAL_BUDGET, rankChunks, selectWithinBudget } from "../../../src/modules/knowledge/domain/lexical-retrieval.js"
import { withChunkPages } from "../../../src/modules/knowledge/domain/pdf-markdown/page-map.js"
import { pdfLayoutToMarkdown } from "../../../src/modules/knowledge/domain/pdf-markdown/pdf-markdown.js"
import { readPdfLayout } from "../../../src/modules/knowledge/infrastructure/pdf-layout-reader.js"
import { extractPlainPdfText } from "../../../src/modules/knowledge/infrastructure/text-extractor.js"
import { GOLD, HEADINGS, RELATIONS, SENTENCES } from "./gold.js"

const fold = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()
const median = (values: readonly number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0
const TITLES: Record<string, string> = { simples: "Segunda via de fatura", "manual-tabelas": "Manual de prazos de reparo", "duas-colunas-linha": "Boletim de retenção (linhas)", "duas-colunas-coluna": "Boletim de retenção (colunas)", escaneado: "Regulamento de devolução", misto: "Guia de clientes corporativos", "manual-chrome-tags": "Manual de cancelamento (tags)", "manual-chrome-sem-tags": "Manual de cancelamento (sem tags)", "it-013": "Instalar a INIA na VM", "it-008": "Central de Dados" }

type Version = "antes" | "depois"
const REPETITIONS = 5

async function plainPerPage(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    return (await parser.getText({ pageJoiner: "" })).pages.map((page) => page.text)
  } finally {
    await parser.destroy()
  }
}

async function main() {
  const [corpus, output] = process.argv.slice(2)
  if (!corpus || !output) throw new Error("Uso: measure-offline.ts <corpus> <saída.json>")
  const files = readdirSync(corpus).filter((file) => file.endsWith(".pdf")).sort()
  const documents: { doc: string; before: string; after: string; extraction: ReturnType<typeof pdfLayoutToMarkdown>["extraction"]; pagesBefore: string[] }[] = []
  const timing: { doc: string; pages: number; sizeBytes: number; beforeMs: number; afterMs: number; beforeRuns: number[]; afterRuns: number[] }[] = []
  for (const file of files) {
    const doc = basename(file, ".pdf")
    const buffer = readFileSync(join(corpus, file))
    const beforeRuns: number[] = []
    const afterRuns: number[] = []
    let before = ""
    let converted: ReturnType<typeof pdfLayoutToMarkdown> | null = null
    // Ordem alternada: nenhuma versão fica sempre com o processo já aquecido.
    for (let run = 0; run < REPETITIONS; run += 1) {
      const order = run % 2 === 0 ? ["before", "after"] : ["after", "before"]
      for (const which of order) {
        const start = performance.now()
        if (which === "before") {
          before = await extractPlainPdfText(buffer)
          beforeRuns.push(performance.now() - start)
        } else {
          converted = pdfLayoutToMarkdown(await readPdfLayout(buffer))
          afterRuns.push(performance.now() - start)
        }
      }
    }
    documents.push({ doc, before, after: converted!.markdown, extraction: converted!.extraction, pagesBefore: await plainPerPage(buffer) })
    timing.push({ doc, pages: converted!.extraction.pageCount, sizeBytes: buffer.length, beforeMs: Math.round(median(beforeRuns)), afterMs: Math.round(median(afterRuns)), beforeRuns: beforeRuns.map(Math.round), afterRuns: afterRuns.map(Math.round) })
  }

  const chunksOf = (version: Version): KnowledgeChunk[] => documents.flatMap((document) => {
    const content = version === "antes" ? document.before : document.after
    const chunks = chunkKnowledgeDocument({ id: document.doc, title: TITLES[document.doc] ?? document.doc, content })
    return version === "depois" ? withChunkPages(chunks, content, document.extraction) : chunks
  })
  const tableless = (text: string) => fold(text.replace(/\|/g, " ").replace(/\\/g, ""))

  const retrieval = (version: Version) => {
    const chunks = chunksOf(version)
    const index = buildKnowledgeIndex(chunks)
    return GOLD.filter((question) => !question.unanswerable).map((question) => {
      const ranked = rankChunks(question.question, index)
      const selected = selectWithinBudget(ranked, DEFAULT_RETRIEVAL_BUDGET)
      const hasAll = (chunk: KnowledgeChunk) => chunk.documentId === question.doc && question.sameChunk.every((needle) => tableless(chunk.text).includes(fold(needle)))
      const rank = ranked.findIndex(hasAll)
      const selectedHit = selected.find(hasAll)
      const inAnyChunk = chunks.some(hasAll)
      return { id: question.id, doc: question.doc, kind: question.kind, rank: rank < 0 ? null : rank + 1, top3: rank >= 0 && rank < 3, inBudget: Boolean(selectedHit), existsInOneChunk: inAnyChunk, pages: selectedHit?.pages ?? null, pageRight: selectedHit?.pages ? [question.page, ...(question.alsoOnPages ?? [])].some((page) => page >= selectedHit.pages!.from && page <= selectedHit.pages!.to) : false, singlePage: selectedHit?.pages ? selectedHit.pages.from === selectedHit.pages.to : false, hitChars: selectedHit?.text.length ?? 0, promptChars: selected.reduce((sum, chunk) => sum + chunk.text.length, 0) }
    })
  }

  // Tabelas: na versão nova, dado e título da coluna na mesma tabela Markdown; na anterior, dado e nome da linha na mesma linha do texto (não há como ligar à coluna).
  const relationCheck = RELATIONS.map((relation) => {
    const document = documents.find((candidate) => candidate.doc === relation.doc)!
    const beforeSameLine = document.before.split("\n").some((line) => fold(line).includes(fold(relation.row)) && fold(line).includes(fold(relation.value)))
    // O título da coluna vai junto da linha no trecho que a busca entrega? Sem isso, a IA recebe valores sem saber de que coluna são.
    const chunkHasHeader = (content: string) => chunkKnowledgeDocument({ id: relation.doc, title: "", content }).some((chunk) => tableless(chunk.text).includes(fold(relation.row)) && tableless(chunk.text).includes(fold(relation.value)) && tableless(chunk.text).includes(fold(relation.header)))
    const blocks = document.after.split("\n\n").filter((block) => block.startsWith("|"))
    const afterColumn = blocks.some((block) => {
      const lines = block.split("\n")
      const cells = (line: string) => line.replace(/^\|\s?|\s?\|$/g, "").split(" | ").map(fold)
      const header = cells(lines[0]!)
      const column = header.indexOf(fold(relation.header))
      return column >= 0 && lines.slice(2).some((line) => {
        const row = cells(line)
        return row.some((cell) => cell === fold(relation.row)) && row[column] === fold(relation.value)
      })
    })
    return { ...relation, beforeSameLine, afterColumn, beforeHeaderInChunk: chunkHasHeader(document.before), afterHeaderInChunk: chunkHasHeader(document.after) }
  })

  // Frase inteira, na ordem, sem texto de outra coluna no meio.
  const sentenceCheck = SENTENCES.map((sentence) => {
    const document = documents.find((candidate) => candidate.doc === sentence.doc)!
    const contiguous = (content: string) => fold(content).includes(fold(sentence.text))
    return { ...sentence, before: contiguous(document.before), after: contiguous(tableless(document.after)) }
  })

  const isHeading = (content: string, title: string) => content.split("\n").some((line) => /^#{1,6}\s/.test(line) && fold(line.replace(/^#+\s+/, "")) === fold(title))
  const headings = Object.entries(HEADINGS).map(([doc, expected]) => {
    const document = documents.find((candidate) => candidate.doc === doc)!
    return { doc, expected: expected.length, before: expected.filter((title) => isHeading(document.before, title)).length, after: expected.filter((title) => isHeading(document.after, title)).length, missingAfter: expected.filter((title) => !isHeading(document.after, title)) }
  })

  // Nenhuma palavra do texto anterior pode sumir sem motivo. O que sobra são as margens repetidas, que a conversão tira de propósito.
  const wordsOf = (text: string) => {
    const counts = new Map<string, number>()
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1)
    return counts
  }
  const preservation = documents.map((document) => {
    // Linha que aparece igual em metade das páginas é cabeçalho ou rodapé: sai da conta, porque tirá-la é de propósito.
    const lineKey = (line: string) => fold(line).replace(/\d+/g, "#")
    const seen = new Map<string, number>()
    for (const page of document.pagesBefore) for (const key of new Set(page.split("\n").map(lineKey))) seen.set(key, (seen.get(key) ?? 0) + 1)
    const threshold = Math.max(2, Math.ceil(document.pagesBefore.length * 0.5))
    const body = document.pagesBefore.flatMap((page) => page.split("\n")).filter((line) => (seen.get(lineKey(line)) ?? 0) < threshold).join("\n")
    const after = wordsOf(document.after)
    // Palavra partida no fim da linha: conta inteira se o texto novo a traz inteira; se não, as duas partes.
    const before = wordsOf(body.replace(/(\p{L}+)-\n(\p{Ll}+)/gu, (whole, left: string, right: string) => (after.has(`${left}${right}`.toLowerCase()) ? `${left}${right}` : `${left} ${right}`)))
    let total = 0
    let missing = 0
    const missingWords: string[] = []
    for (const [word, count] of before) {
      total += count
      const lost = count - (after.get(word) ?? 0)
      if (lost > 0) {
        missing += lost
        if (missingWords.length < 15) missingWords.push(word)
      }
    }
    return { doc: document.doc, wordsBefore: total, missing, missingWords, repeatedLinesRemoved: document.extraction.repeatedLinesRemoved }
  })

  // A detecção de imagem sem decodificar precisa dar a mesma classificação de páginas que a leitura com as imagens decodificadas.
  const imageParity = await Promise.all(files.map(async (file) => {
    const buffer = readFileSync(join(corpus, file))
    const statuses = (pages: Awaited<ReturnType<typeof readPdfLayout>>) => pdfLayoutToMarkdown(pages).extraction.pages.map((page) => page.status)
    const fast = statuses(await readPdfLayout(buffer))
    const decoded = statuses(await readPdfLayout(buffer, { decodeImages: true }))
    return { doc: basename(file, ".pdf"), pages: fast.length, differentPages: fast.flatMap((status, index) => (status === decoded[index] ? [] : [{ page: index + 1, fast: status, decoded: decoded[index] }])) }
  }))

  // Quanto tempo a API fica sem atender ninguém durante a leitura: o maior intervalo entre dois disparos de um relógio de 5 ms. O pdf.js no Node roda na mesma thread.
  async function longestStall(work: () => Promise<unknown>) {
    let last = performance.now()
    let longest = 0
    const timer = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 5)
    const started = performance.now()
    await new Promise((resume) => setImmediate(resume))
    await work()
    const total = performance.now() - started
    longest = Math.max(longest, performance.now() - last)
    clearInterval(timer)
    return { totalMs: Math.round(total), longestStallMs: Math.round(longest) }
  }
  const eventLoop = []
  for (const name of ["it-008", "escaneado-40-paginas", "manual-tabelas"]) {
    const path = join(corpus, `${name}.pdf`)
    if (!files.includes(`${name}.pdf`)) continue
    const buffer = readFileSync(path)
    eventLoop.push({ doc: name, antes: await longestStall(() => extractPlainPdfText(buffer)), depois: await longestStall(async () => pdfLayoutToMarkdown(await readPdfLayout(buffer))), depoisComImagens: await longestStall(async () => pdfLayoutToMarkdown(await readPdfLayout(buffer, { decodeImages: true }))) })
  }

  const pageCoverage = documents.map((document) => ({ doc: document.doc, pages: document.extraction.pageCount, tagged: document.extraction.taggedPages, statuses: document.extraction.pages.reduce<Record<string, number>>((all, page) => ({ ...all, [page.status]: (all[page.status] ?? 0) + 1 }), {}), noTextPages: document.extraction.pages.filter((page) => page.status === "NO_TEXT").map((page) => page.page), partialPages: document.extraction.pages.filter((page) => page.status === "PARTIAL").map((page) => page.page), beforePagesWithText: document.pagesBefore.filter((page) => page.trim()).length, tables: document.extraction.tables, headings: document.extraction.headings, charsBefore: document.before.length, charsAfter: document.after.length, chunksBefore: chunkKnowledgeDocument({ id: document.doc, title: "", content: document.before }).length, chunksAfter: chunkKnowledgeDocument({ id: document.doc, title: "", content: document.after }).length }))

  const antes = retrieval("antes")
  const depois = retrieval("depois")
  const summary = (rows: typeof antes) => ({ n: rows.length, top3: rows.filter((row) => row.top3).length, inBudget: rows.filter((row) => row.inBudget).length, existsInOneChunk: rows.filter((row) => row.existsInOneChunk).length, pageRight: rows.filter((row) => row.pageRight).length, singlePage: rows.filter((row) => row.singlePage).length, medianHitChars: median(rows.map((row) => row.hitChars)), medianPromptChars: median(rows.map((row) => row.promptChars)) })
  const report = { generatedAt: new Date().toISOString(), budget: DEFAULT_RETRIEVAL_BUDGET, retrieval: { antes: summary(antes), depois: summary(depois), rows: antes.map((row, index) => ({ id: row.id, doc: row.doc, kind: row.kind, antes: { rank: row.rank, inBudget: row.inBudget, one: row.existsInOneChunk }, depois: { rank: depois[index]!.rank, inBudget: depois[index]!.inBudget, one: depois[index]!.existsInOneChunk, pages: depois[index]!.pages, pageRight: depois[index]!.pageRight } })) }, relations: { n: relationCheck.length, beforeSameLine: relationCheck.filter((row) => row.beforeSameLine).length, afterColumn: relationCheck.filter((row) => row.afterColumn).length, beforeHeaderInChunk: relationCheck.filter((row) => row.beforeHeaderInChunk).length, afterHeaderInChunk: relationCheck.filter((row) => row.afterHeaderInChunk).length, rows: relationCheck }, eventLoop, sentences: { n: sentenceCheck.length, before: sentenceCheck.filter((row) => row.before).length, after: sentenceCheck.filter((row) => row.after).length, rows: sentenceCheck }, imageParity, headings, preservation, pageCoverage, timing: timing.map(({ doc, pages, sizeBytes, beforeMs, afterMs }) => ({ doc, pages, sizeBytes, beforeMs, afterMs, addedMs: afterMs - beforeMs })) }
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ retrieval: { antes: report.retrieval.antes, depois: report.retrieval.depois }, relations: { n: report.relations.n, antesMesmaLinha: report.relations.beforeSameLine, depoisColuna: report.relations.afterColumn, antesCabecalhoNoTrecho: report.relations.beforeHeaderInChunk, depoisCabecalhoNoTrecho: report.relations.afterHeaderInChunk }, frases: { n: report.sentences.n, antes: report.sentences.before, depois: report.sentences.after, faltamDepois: report.sentences.rows.filter((row) => !row.after).map((row) => row.text.slice(0, 50)) }, relacoesFaltando: report.relations.rows.filter((row) => !row.afterColumn).map((row) => row.row), paridade: report.imageParity.filter((row) => row.differentPages.length > 0), api: report.eventLoop, headings: report.headings.map((row) => `${row.doc}: ${row.before}→${row.after}/${row.expected}${row.missingAfter.length ? ` falta ${row.missingAfter.join(";")}` : ""}`), preservation: report.preservation.map((row) => `${row.doc}: ${row.missing}/${row.wordsBefore} ${row.missingWords.slice(0, 8).join(",")}`), timing: report.timing.map((row) => `${row.doc} p=${row.pages} ${row.beforeMs}→${row.afterMs}ms`), coverage: report.pageCoverage.map((row) => `${row.doc}: ${JSON.stringify(row.statuses)} chunks ${row.chunksBefore}→${row.chunksAfter} chars ${row.charsBefore}→${row.charsAfter}`) }, null, 1))
  for (const row of report.retrieval.rows) console.log(row.id.padEnd(3), row.doc.padEnd(24), "antes", String(row.antes.rank).padEnd(5), row.antes.inBudget ? "orc" : "---", row.antes.one ? "um" : "--", "| depois", String(row.depois.rank).padEnd(5), row.depois.inBudget ? "orc" : "---", row.depois.one ? "um" : "--", JSON.stringify(row.depois.pages), row.depois.pageRight ? "ok" : "")
}

void main()
