/**
 * AVALIADOR da bateria — o ÚNICO lugar que lê o gabarito (`ground-truth.json`). Aplica a avaliação POR DIMENSÃO
 * (`scoring.ts`) ao resultado de `run-battery.ts` e grava um relatório Markdown ao lado do JSON.
 *
 * O relatório nunca diz "mensagem correta": status e tom certos não comprovam diagnóstico nem utilidade. Cada dimensão diz como
 * foi medida (estrutural, auxiliar léxica, inspeção humana); caso usado para ajustar a implementação aparece como REGRESSÃO.
 * "Decisões que passaram na verificação por código" = formato/evidência conferidos — não correção no mundo real.
 *
 *   npx tsx scripts/feedback-engine/evaluation/score-battery.ts scripts/feedback-engine/evaluation/results/<arquivo>.json
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DIMENSION_LABELS, scoreCase, summarize, type CaseResult, type CaseScore, type Truth } from "./scoring.js"

const here = dirname(fileURLToPath(import.meta.url))
const file = process.argv[2]
if (!file) throw new Error("uso: score-battery.ts <results.json>")
const run = JSON.parse(readFileSync(file, "utf8")) as { model: string; ranAt: string; cases: (CaseResult & { latencyMs: number; calls: unknown[]; cost: { estimatedUsd: number } })[] }
const truth = JSON.parse(readFileSync(join(here, "ground-truth.json"), "utf8")) as { forbiddenMessagePhrases: string[]; cases: Record<string, Truth> }

function renderReport(scores: readonly CaseScore[], meta: { model: string; ranAt: string; cost: number; calls: number }, messages: Record<string, string>): string {
  const summary = summarize(scores)
  const dims = Object.keys(DIMENSION_LABELS) as (keyof CaseScore["dimensions"])[]
  const mark = { PASS: "✅", FAIL: "❌", NEEDS_INSPECTION: "🔎", NOT_APPLICABLE: "—" } as const
  const methodOf = (dim: keyof CaseScore["dimensions"]) => scores[0]?.dimensions[dim].method ?? "STRUCTURAL"
  const METHOD = { STRUCTURAL: "estrutural", AUXILIARY_LEXICAL: "auxiliar (léxico)", HUMAN: "inspeção humana" } as const
  const totals = (group: "independent" | "regression") => dims.map((dim) => {
    const counts = summary[group][dim]
    return `| ${DIMENSION_LABELS[dim]} | ${METHOD[methodOf(dim)]} | ${counts.PASS} | ${counts.FAIL} | ${counts.NEEDS_INSPECTION} | ${counts.NOT_APPLICABLE} |`
  })
  return [
    `# Bateria de avaliação do motor de feedback`,
    ``,
    `Modelo: ${meta.model} · executada em ${meta.ranAt} · ${scores.length} casos (${summary.cases.independent} independentes, ${summary.cases.regression} de regressão) · ${meta.calls} chamadas de modelo · custo estimado US$ ${meta.cost.toFixed(3)} · gabarito separado do runtime.`,
    ``,
    `> Não há total de "mensagem correta". Estrutural = comparação determinística com o gabarito; auxiliar = sinal de palavras que só aponta o que ler; inspeção humana = não automatizado. Casos de regressão foram usados para ajustar a implementação e não contam como prova independente.`,
    ``,
    ...(summary.cases.independent > 0 ? [`## Casos independentes`, ``, `| Dimensão | Método | ✅ | ❌ | 🔎 inspecionar | — |`, `|---|---|---|---|---|---|`, ...totals("independent"), ``] : [`## Casos independentes`, ``, `Nenhum: todos os casos desta bateria já foram usados para ajustar a implementação.`, ``]),
    `## Casos de regressão`,
    ``,
    `| Dimensão | Método | ✅ | ❌ | 🔎 inspecionar | — |`,
    `|---|---|---|---|---|---|`,
    ...totals("regression"),
    ``,
    `## Por caso`,
    ``,
    ...scores.flatMap((score) => [
      `### ${score.id}${score.independent ? "" : " (regressão)"}`,
      ``,
      ...(score.calibrationNote ? [`_${score.calibrationNote}_`, ``] : []),
      ...dims.map((dim) => {
        const check = score.dimensions[dim] as CaseScore["dimensions"][typeof dim] & { items?: string[]; signals?: string[]; flagged?: string[]; nearDuplicates?: string[]; missed?: string[] }
        const extra = [...(check.items ?? []), ...(check.signals ?? []), ...(check.flagged ?? []).map((text) => `“${text.slice(0, 140)}”`), ...(check.nearDuplicates ?? [])]
        return `- ${mark[check.status]} **${DIMENSION_LABELS[dim]}** (${METHOD[check.method]}): ${check.detail}${extra.length > 0 ? `\n  - ${extra.join("\n  - ")}` : ""}`
      }),
      ...(messages[score.id] ? [``, messages[score.id]!] : []),
      ``,
    ]),
  ].join("\n")
}

const scores = run.cases.filter((result) => truth.cases[result.id]).map((result) => scoreCase(result, truth.cases[result.id]!, truth.forbiddenMessagePhrases))
const messages = Object.fromEntries(run.cases.map((result) => [result.id, result.message?.kind === "PUBLISHABLE" ? `> ${[result.message.card ? `**${result.message.card}**` : "", ...result.message.paragraphs].filter(Boolean).join("\n>\n> ")}` : `Mensagem: ${result.message?.kind ?? "—"} ${result.message?.reason ?? ""}`]))
const report = renderReport(scores, { model: run.model, ranAt: run.ranAt, cost: run.cases.reduce((sum, result) => sum + (result.cost?.estimatedUsd ?? 0), 0), calls: run.cases.reduce((sum, result) => sum + (result.calls?.length ?? 0), 0) }, messages)
const out = file.replace(/\.json$/, ".dimensions.md")
writeFileSync(out, report)
console.log(report.split("\n## Por caso")[0])
console.log(`\nRelatório: ${out}`)
