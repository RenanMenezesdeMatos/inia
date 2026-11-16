// VARREDURA dos prompts do MOTOR DE FEEDBACK (análise da chamada e revisão), montados pelas funções REAIS com execuções do banco de dev.
// Mede: peso de cada parte, texto repetido DENTRO do pedido (rótulos por item e conteúdo), marcadores [L-n] e o que a revisão reenvia
// da análise. Só leitura, rede bloqueada, nenhuma IA. Saída: só números e trechos que são TEXTO DO CÓDIGO (nunca base ou transcrição).
//
//   cd backend && NODE_OPTIONS=--max-old-space-size=6144 npx tsx ../docs/dev/varredura-prompts/motor.mts
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
const B = new URL("../../../backend", import.meta.url).pathname.replace(/\/$/, "")
const require = createRequire(B + "/package.json")
const pg = require("pg")
;(globalThis as any).fetch = async () => {
  throw new Error("REDE BLOQUEADA")
}
const db = new pg.Pool({ connectionString: "postgresql://renanmenezes@localhost:5432/inia", options: "-c default_transaction_read_only=on -c statement_timeout=30000", max: 4 })
if ((await db.query("show default_transaction_read_only")).rows[0].default_transaction_read_only !== "on") throw new Error("não está em leitura")

const { loadInteractionForAnalysis, loadAgentProfile, loadAgentDocumentsAt } = await import(B + "/src/modules/feedback-engine/infrastructure/postgres-engine-loaders.ts")
const { loadArgumentScriptsInForce } = await import(B + "/src/modules/argument-scripts/infrastructure/argument-script-loaders.ts")
const { loadProductCatalogAt } = await import(B + "/src/modules/product-catalog/infrastructure/product-catalog-loaders.ts")
const { projectTranscript, renderTranscriptForModel } = await import(B + "/src/modules/investigation/domain/transcript-projection.ts")
const { rawSubjectOf } = await import(B + "/src/modules/interactions/domain/interaction-subject.ts")
const { selectDocumentsForCall } = await import(B + "/src/modules/feedback-engine/domain/document-selection.ts")
const { buildProcedureContext, transcriptStatusOf, renderProcedureForModel, renderArgumentScriptsForModel } = await import(B + "/src/modules/feedback-engine/domain/procedure.ts")
const { productContextOf, scopeLabelFor, renderProductCatalogForModel } = await import(B + "/src/modules/feedback-engine/domain/product-applicability.ts")
const { renderCallAnalysisUserTurn } = await import(B + "/src/modules/feedback-engine/domain/call-analysis-prompt.ts")
const { obligationAnalysisContractFor } = await import(B + "/src/modules/feedback-engine/domain/obligation-analysis-prompt.ts")
const { obligationReviewContractFor, renderObligationReviewUserTurn } = await import(B + "/src/modules/feedback-engine/domain/obligation-review.ts")
const { interactionMetadataOf, TRANSCRIPT_MAX_CHARS } = await import(B + "/src/modules/feedback-engine/application/analyze-call.ts")

// Texto do código que monta o pedido: só trechos que aparecem AQUI podem ser mostrados na saída (rótulos, nunca conteúdo de base).
const CODE = ["src/modules/feedback-engine/domain/procedure.ts", "src/modules/feedback-engine/domain/product-applicability.ts", "src/modules/feedback-engine/domain/call-analysis-prompt.ts", "src/modules/feedback-engine/domain/obligation-review.ts", "src/modules/investigation/domain/transcript-projection.ts"]
  .map((file) => readFileSync(`${B}/${file}`, "utf8"))
  .join("\n")

const K = 3.99
const tok = (chars: number) => Math.round(chars / K)
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

/**
 * Trechos de 8 palavras que aparecem mais de uma vez no texto: quantos caracteres estão em trechos repetidos (2ª ocorrência em diante).
 * `only` = conta só os trechos aceitos (ex.: os que são texto do código). Cobertura por caractere: trechos sobrepostos contam uma vez.
 */
function repeated(text: string, size = 8, only?: (phrase: string) => boolean): { chars: number; phrases: Map<string, number> } {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ w: m[0], at: m.index! }))
  const seen = new Map<string, number>()
  const covered = new Uint8Array(text.length)
  const phrases = new Map<string, number>()
  for (let i = 0; i + size <= words.length; i++) {
    const key = words.slice(i, i + size).map((x) => x.w).join(" ")
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count >= 2 && (!only || only(key))) {
      const start = words[i]!.at
      const end = words[i + size - 1]!.at + words[i + size - 1]!.w.length
      for (let c = start; c < end; c++) covered[c] = 1
      phrases.set(key, count)
    }
  }
  let chars = 0
  for (const v of covered) chars += v
  return { chars, phrases }
}
const HANDLE = /\[[A-Z]{1,2}\d+\]/g
const handleChars = (text: string) => [...text.matchAll(HANDLE)].reduce((sum, m) => sum + m[0].length + 1, 0)

const runs = (
  await db.query(`
  select id, organization_id, interaction_id, agent_id, started_at, trigger
    from feedback_analysis_runs
   where kind = 'CALL_ANALYSIS' and status = 'COMPLETED' and started_at >= now() - interval '45 days' and interaction_id is not null
   order by started_at`)
).rows

type Row = Record<string, number>
const rows: Row[] = []
const labelPhrases = new Map<string, { runs: number; occurrences: number }>()
let skipped = 0
for (const run of runs) {
  const interaction = await loadInteractionForAnalysis(db, run.organization_id, run.interaction_id)
  const agent = run.agent_id ? await loadAgentProfile(db, run.organization_id, run.agent_id) : null
  if (!interaction || !agent) {
    skipped++
    continue
  }
  const projection = projectTranscript(interaction.transcript?.content ?? "", { maxChars: TRANSCRIPT_MAX_CHARS })
  const transcriptStatus = interaction.transcript ? transcriptStatusOf(projection) : "UNAVAILABLE"
  const subject = interaction.subjectCanonical?.name ?? rawSubjectOf(interaction)
  const candidates = await loadAgentDocumentsAt(db, run.organization_id, agent.id, interaction.startedAt)
  const scripts = await loadArgumentScriptsInForce(db, run.organization_id, { teamId: interaction.teamId, subteamId: interaction.subteamId }, interaction.startedAt)
  const catalog = await loadProductCatalogAt(db, run.organization_id, interaction.startedAt, [...candidates.map((d: any) => d.documentId), ...scripts.map((s: any) => s.scriptId)])
  const productScoped = new Set((catalog?.scopes ?? []).map((scope: any) => scope.sourceId)) as Set<string>
  const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript?.content ?? "", productScoped })
  const context = buildProcedureContext(selection.selected, scripts)
  const products = productContextOf(catalog, { presentedSourceIds: context.documents.map((d: any) => d.documentId), metadata: interactionMetadataOf(interaction, subject) })
  if (products) for (const document of context.documents) document.productScopeLabel = scopeLabelFor(products, document.documentId)

  const specialist = { name: agent.name, guidance: [agent.objective, agent.contextPrompt].filter(Boolean).join("\n\n") || null }
  const view = { dateLabel: new Date(interaction.startedAt).toISOString().slice(0, 10), channel: interaction.channel, subject, durationSeconds: interaction.endedAt ? (interaction.endedAt.getTime() - interaction.startedAt.getTime()) / 1000 : null, signals: interaction.flags.map((f: any) => `${f.name} = ${f.value}`), selectionReason: run.trigger?.selectionReason ?? "" }
  const contract = obligationAnalysisContractFor(Boolean(products))
  const review = obligationReviewContractFor(Boolean(products))
  const turn = renderCallAnalysisUserTurn({ specialist, interaction: view, projection, transcriptStatus, context, products })
  const reviewTurn = renderObligationReviewUserTurn({ projection, transcriptStatus, subject, context, targets: { claims: [], linesToAssess: [], notAssessed: [] } as any, products })
  const transcript = renderTranscriptForModel(projection)
  const proc = renderProcedureForModel(context)
  const scr = renderArgumentScriptsForModel(context)
  const prodCat = products ? renderProductCatalogForModel(products) : ""
  const analysis = contract.systemPrompt + "\n" + turn
  const reviewPrompt = review.systemPrompt + "\n" + reviewTurn

  // Repetido dentro de cada parte e no pedido inteiro.
  const repAll = repeated(analysis)
  const repProc = repeated(proc)
  const repScr = repeated(scr)
  // Rótulos do código repetidos por item (frase de 8 palavras que existe no código e aparece 2+ vezes no pedido).
  const isCode = (phrase: string) => CODE.includes(phrase)
  const labelChars = repeated(analysis, 8, isCode).chars
  for (const [phrase, count] of repAll.phrases) {
    if (!CODE.includes(phrase)) continue
    const entry = labelPhrases.get(phrase) ?? { runs: 0, occurrences: 0 }
    entry.runs++
    entry.occurrences += count
    labelPhrases.set(phrase, entry)
  }
  // Mesmo texto em procedimento E argumentário (anotação "mesmo texto de [..] na base"): conteúdo enviado duas vezes.
  const sameText = (context.sameText ?? []) as any[]
  const sameTextLines = new Set(sameText.map((entry) => entry.lineHandle))
  const sameTextChars = context.documents.flatMap((d: any) => d.sections.flatMap((s: any) => s.lines)).filter((line: any) => sameTextLines.has(line.handle)).reduce((sum: number, line: any) => sum + String(line.text).length, 0)
  // Quanto da revisão (por linhas) já foi enviado na análise.
  const analysisLines = new Set(analysis.split("\n").map((line) => line.trim()).filter((line) => line.length >= 30))
  const reviewLines = reviewPrompt.split("\n").map((line) => line.trim())
  const reviewReused = reviewLines.filter((line) => line.length >= 30 && analysisLines.has(line)).reduce((sum, line) => sum + line.length + 1, 0)
  const ws = (text: string) => (text.match(/[ \t]{2,}|\n{3,}|[ \t]+\n/g) ?? []).reduce((sum, m) => sum + m.length - 1, 0)

  rows.push({
    analysis: analysis.length, sys: contract.systemPrompt.length, spec: specialist.guidance?.length ?? 0, transcript: transcript.length, proc: proc.length, scr: scr.length, prodCat: prodCat.length,
    review: reviewPrompt.length, reviewSys: review.systemPrompt.length, reviewReused,
    repAll: repAll.chars, repProc: repProc.chars, repScr: repScr.chars, labelChars, sameTextChars, sameTextLines: sameTextLines.size,
    handles: handleChars(analysis), whitespace: ws(analysis), docs: selection.selected.length, scripts: context.documents.filter((d: any) => d.kind === "ARGUMENT_SCRIPT").length,
  })
}

const m = (key: string) => tok(avg(rows.map((r) => r[key]!)))
const pct = (a: string, b: string) => +(100 * avg(rows.map((r) => r[a]! / Math.max(1, r[b]!)))).toFixed(1)
console.log(JSON.stringify({ execucoes: runs.length, reconstruidas: rows.length, puladas: skipped, documentosPorChamada: +avg(rows.map((r) => r.docs!)).toFixed(1), argumentariosPorChamada: +avg(rows.map((r) => r.scripts!)).toFixed(1) }))
console.log(
  JSON.stringify({
    analise_tokens: { total: m("analysis"), instrucoes: m("sys"), especialista: m("spec"), transcricao: m("transcript"), procedimentos: m("proc"), argumentarios: m("scr"), catalogoProdutos: m("prodCat") },
    revisao_tokens: { total: m("review"), instrucoes: m("reviewSys"), jaEnviadoNaAnalise: m("reviewReused"), pctJaEnviado: pct("reviewReused", "review") },
  }),
)
console.log(
  JSON.stringify({
    repetidoDentroDaAnalise: { tokens: m("repAll"), pct: pct("repAll", "analysis") },
    repetidoNosProcedimentos: { tokens: m("repProc"), pct: pct("repProc", "proc") },
    repetidoNosArgumentarios: { tokens: m("repScr"), pct: pct("repScr", "scr") },
    rotulosDoCodigoRepetidosPorItem: { tokens: m("labelChars"), pctDaAnalise: pct("labelChars", "analysis") },
    mesmoTextoNaBaseENoArgumentario: { tokens: m("sameTextChars"), linhas: +avg(rows.map((r) => r.sameTextLines!)).toFixed(1) },
    marcadoresDeLinha: { tokens: m("handles"), pct: pct("handles", "analysis") },
    espacosSobrando: { tokens: m("whitespace") },
  }),
)
const top = [...labelPhrases.entries()].sort((a, b) => b[1].occurrences - a[1].occurrences).slice(0, 12)
for (const [phrase, entry] of top) console.log(JSON.stringify({ rotulo: phrase.slice(0, 110), execucoes: entry.runs, ocorrenciasMedias: +(entry.occurrences / entry.runs).toFixed(1) }))
await db.end()
