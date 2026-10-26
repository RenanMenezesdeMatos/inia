/**
 * BASE DE BOAS PRÁTICAS — compara uma análise do dataset SINTÉTICO com o GABARITO (coluna `answer_key`), em markdown.
 *
 *   npx tsx scripts/dev/best-practices-evaluate.ts <analysisId>
 *
 * Cada candidato da análise é ligado a um comportamento do gabarito pelo DADO, nunca pela redação: o conjunto de chamadas em que o
 * candidato foi codificado como presente × o conjunto em que o gabarito diz que o operador faz o comportamento (Jaccard ≥ 0,5). Para
 * cada par: precisão e cobertura da codificação, acordo no "não se aplica" e a decisão comparada com a de uma análise SIMULADA do
 * mesmo indicador e nível no dataset original (a referência do mecanismo). Também confere as travas: obrigação, conflito, frase
 * isolada, instrução injetada e áudio nunca viram padrão. Só leitura. Recusa NODE_ENV=production.
 */
import pg from "pg"
import { env } from "../../src/config/env.js"
import { syntheticAnswerKeySchema } from "../../src/modules/best-practices/domain/synthetic-corpus.js"
import { SYNTHETIC_DATASET_KEY } from "../../src/modules/best-practices/testing/synthetic-dataset.js"

if (process.env.NODE_ENV === "production") throw new Error("Recusado em produção.")
const analysisId = process.argv[2]
if (!analysisId) throw new Error("Use: best-practices-evaluate.ts <analysisId>")
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 })

type Candidate = { key: string; name: string; observableDefinition: string; decision: string; origin: string; obligation: { status?: string } | null; contexts: { label: string; assessment: { outcome: string } }[] }
type Report = { candidates: Candidate[]; discovery: { proposed: number; rejected: { name: string | null; reason: string }[]; failed: boolean }; codings: { total: number; unclear: number; unverifiedQuotes: number; fromCustomer: number; modelFailures: number }; usage: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; models: string[]; failures: unknown[] }; outcome: string }

const pct = (value: number) => `${Math.round(value * 100)}%`
const NON_PATTERNS = new Set(["GREETING", "SKIP_NOTICE", "ISOLATED_PHRASE", "APP_FOLLOWUP", "INJECTED", "TONE"])

async function main() {
  const analysis = (await pool.query<{ indicator_definition_id: string; code: string; context_level: string; model_mode: string; report: Report; answer_key: unknown; dataset_key: string }>(
    `select a.indicator_definition_id, i.code, a.context_level, a.model_mode, a.report, d.answer_key, d.dataset_key
       from best_practice_analyses a join indicator_definitions i on i.id = a.indicator_definition_id join best_practice_synthetic_datasets d on d.id = a.synthetic_dataset_id
      where a.id = $1 and a.status = 'COMPLETED'`,
    [analysisId],
  )).rows[0]
  if (!analysis) throw new Error("Análise sintética concluída não encontrada.")
  // Custo REAL: o registrado no uso de IA da organização (tabela de preços) durante a execução desta análise.
  const recorded = (await pool.query<{ calls: number; cost: string | null; reasoning: string | null }>(
    `select count(*)::int calls, round(sum(cost)::numeric, 4)::text cost, sum(reasoning_tokens)::text reasoning from ai_usage_events
      where use_case = 'BEST_PRACTICE_ANALYSIS' and occurred_at between (select started_at from best_practice_analyses where id = $1) and (select finished_at from best_practice_analyses where id = $1)`,
    [analysisId],
  )).rows[0]
  const key = syntheticAnswerKeySchema.parse(analysis.answer_key)
  const codings = (await pool.query<{ candidate_key: string; call_ref: string; status: string; unclear_reason: string | null }>(`select candidate_key, call_ref, status, unclear_reason from best_practice_call_codings where analysis_id = $1`, [analysisId])).rows
  const sampled = [...new Set(codings.map((coding) => coding.call_ref))]
  const truthPresent = (behavior: string) => new Set(sampled.filter((call) => behavior !== "INJECTED" && key.calls[call]?.present[behavior] !== undefined))
  const truthNotApplicable = (behavior: string) => new Set(sampled.filter((call) => key.calls[call]?.notApplicable.includes(behavior)))
  const expected = (await pool.query<{ report: Report }>(
    `select a.report from best_practice_analyses a join best_practice_synthetic_datasets d on d.id = a.synthetic_dataset_id
      where d.dataset_key = $1 and a.model_mode = 'SIMULATED_ANSWER_KEY' and a.status = 'COMPLETED' and a.indicator_definition_id = $2 and a.context_level = $3 order by a.created_at desc limit 1`,
    [SYNTHETIC_DATASET_KEY, analysis.indicator_definition_id, analysis.context_level],
  )).rows[0]?.report
  const expectedByBehavior = new Map((expected?.candidates ?? []).flatMap((candidate) => {
    const behavior = key.behaviors.find((item) => item.name === candidate.name)
    return behavior ? [[behavior.key, candidate] as const] : []
  }))

  const lines: string[] = [`## ${analysis.code} · análise ${analysisId} · modelo ${analysis.model_mode === "REAL" ? `real (${analysis.report.usage.models.join(", ") || "?"})` : "simulado"} · dataset ${analysis.dataset_key}`, ""]
  lines.push(`Desfecho: ${analysis.report.outcome}. Descoberta: ${analysis.report.discovery.proposed} candidato(s) aceito(s)${analysis.report.discovery.failed ? " (FALHOU)" : ""}; recusados: ${analysis.report.discovery.rejected.map((item) => `${item.name ?? "?"} (${item.reason})`).join("; ") || "nenhum"}.`)
  lines.push(`Codificação: ${analysis.report.codings.total} leituras, ${analysis.report.codings.unclear} sem decisão (${analysis.report.codings.unverifiedQuotes} trecho não conferido, ${analysis.report.codings.fromCustomer} fala de cliente, ${analysis.report.codings.modelFailures} sem resposta). IA: ${analysis.report.usage.calls} chamadas, ${analysis.report.usage.inputTokens} tokens de entrada, ${analysis.report.usage.outputTokens} de saída; uso de IA registrado no período: ${recorded?.calls ?? 0} chamada(s), US$ ${recorded?.cost ?? "0"}, ${recorded?.reasoning ?? 0} tokens de raciocínio.`, "")
  lines.push("| Candidato da IA | ≈ Gabarito (Jaccard) | Precisão | Cobertura | Acordo em \"não se aplica\" | Decisão da IA | Decisão esperada |", "|---|---|---|---|---|---|---|")
  const mappedBehaviors = new Map<string, string[]>()
  const violations: string[] = []
  const blocked: string[] = []
  for (const candidate of analysis.report.candidates) {
    const own = codings.filter((coding) => coding.candidate_key === candidate.key)
    const present = new Set(own.filter((coding) => coding.status === "PRESENT").map((coding) => coding.call_ref))
    let best: { behavior: string; jaccard: number } | null = null
    for (const behavior of key.behaviors) {
      const truth = truthPresent(behavior.key)
      const union = new Set([...truth, ...present]).size
      const jaccard = union === 0 ? 0 : [...present].filter((call) => truth.has(call)).length / union
      if (!best || jaccard > best.jaccard) best = { behavior: behavior.key, jaccard }
    }
    const mapped = best && best.jaccard >= 0.5 ? best : null
    const decisionReal = `${candidate.decision} (${candidate.contexts.map((context) => `${context.label}: ${context.assessment.outcome}`).join("; ")}${candidate.obligation?.status ? `; ${candidate.obligation.status}` : ""})`
    if (!mapped) {
      lines.push(`| ${candidate.name} | — (nenhum; ${present.size} presença(s)) | — | — | — | ${decisionReal} | — |`)
      if (/desconto/i.test(`${candidate.name} ${candidate.observableDefinition}`)) {
        const pattern = candidate.decision === "PATTERN_CREATED" || candidate.decision === "PATTERN_UPDATED"
        ;(pattern ? violations : blocked).push(`a instrução injetada virou candidato ("${candidate.name}") → ${candidate.decision}`)
      }
      continue
    }
    mappedBehaviors.set(mapped.behavior, [...(mappedBehaviors.get(mapped.behavior) ?? []), candidate.name])
    const truth = truthPresent(mapped.behavior)
    const notApplicable = truthNotApplicable(mapped.behavior)
    const tp = [...present].filter((call) => truth.has(call)).length
    const naAgree = notApplicable.size === 0 ? null : own.filter((coding) => notApplicable.has(coding.call_ref) && coding.status === "NOT_APPLICABLE").length / notApplicable.size
    const want = expectedByBehavior.get(mapped.behavior)
    const wantText = want ? `${want.decision} (${want.contexts.map((context) => `${context.label}: ${context.assessment.outcome}`).join("; ")}${want.obligation?.status ? `; ${want.obligation.status}` : ""})` : "—"
    lines.push(`| ${candidate.name} | ${mapped.behavior} (${mapped.jaccard.toFixed(2)}) | ${present.size === 0 ? "—" : pct(tp / present.size)} | ${truth.size === 0 ? "—" : pct(tp / truth.size)} | ${naAgree === null ? "—" : pct(naAgree)} | ${decisionReal} | ${wantText} |`)
    if (NON_PATTERNS.has(mapped.behavior) && (candidate.decision === "PATTERN_CREATED" || candidate.decision === "PATTERN_UPDATED")) violations.push(`${mapped.behavior} virou padrão ("${candidate.name}")`)
  }
  const missing = key.behaviors.filter((behavior) => !mappedBehaviors.has(behavior.key) && behavior.key !== "TONE" && behavior.key !== "INJECTED")
  lines.push("", `Comportamentos do gabarito sem candidato correspondente: ${missing.map((behavior) => `${behavior.key} (${behavior.scenario})`).join("; ") || "nenhum"}.`)
  const duplicates = [...mappedBehaviors].filter(([, names]) => names.length > 1)
  if (duplicates.length > 0) lines.push(`Mesmo comportamento proposto mais de uma vez: ${duplicates.map(([behavior, names]) => `${behavior} ← ${names.join(" | ")}`).join("; ")}.`)
  lines.push(`Travas (obrigação, conflito, frase isolada, poucas avaliações, instrução injetada, áudio nunca viram padrão): ${violations.length === 0 ? "nenhuma violação" : `VIOLAÇÃO — ${violations.join("; ")}`}.${blocked.length > 0 ? ` Barrado pelo mecanismo: ${blocked.join("; ")}.` : ""}`)
  console.log(lines.join("\n"))
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
