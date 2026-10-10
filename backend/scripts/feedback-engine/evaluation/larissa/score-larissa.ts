/**
 * AVALIADOR da validação focal da Larissa — o único que lê `ground-truth.json`. Aplica as dimensões de `scoring.ts` às chamadas
 * e confere a investigação do indicador; soma o orçamento pelo livro-razão da fronteira HTTP. Nenhuma chamada de modelo.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/score-larissa.ts <results/paid-….json>
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DIMENSION_LABELS, scoreCase, type CaseResult, type CaseScore, type Truth } from "../scoring.js"

const here = dirname(fileURLToPath(import.meta.url))
const file = process.argv[2]
if (!file) throw new Error("uso: score-larissa.ts <artefato.json>")
type Quote = { turn: string; speaker: string | null; quote: string }
type Artifact = {
  kind: string
  model: string
  ranAt: string
  selection: { person: { id: string; name: string; matricula: string; team: string | null; subteam: string | null }; calls: { key: string; externalId: string; interactionId: string; durationSeconds: number }[]; indicator: { code: string; referencePeriod: string; value: number; target: number | null } }
  budget: { totals: { requests: number; blocked: number; spentUsd: number; unknownUsage: number; promptTokens: number; outputAndThoughtsTokens: number }; ledger: { index: number; label: string; status: number | string; spentUsd: number; reservedUsd: number; usageKnown: boolean; promptTokens: number | null; totalTokens: number | null; thoughtsTokens: number | null }[] } | null
  cumulative?: { requests: number; spentUsd: number }
  otherCollaboratorsAnalyzed: number
  distinctCallsAnalyzed: number
  steps: Record<string, { status: string; reason?: string; result?: Record<string, unknown> }>
}
const artifact = JSON.parse(readFileSync(file, "utf8")) as Artifact
const truth = JSON.parse(readFileSync(join(here, "ground-truth.json"), "utf8")) as { forbiddenMessagePhrases: string[]; cases: Record<string, Truth & { notes?: string }>; indicator: { scenario: string; official: { value: number; target: number; withinTarget: boolean; previous: number; movement: string }; acceptableConclusions: string[]; forbiddenConclusions: string[]; mustHaveLimitationAbout: string[]; maxNewCallAnalyses: number; message: { outcome: string[]; tone: string[] }; forbiddenInMessage: string[] } }

type StoredMessage = { status: string; abstainReason: string | null; tone: string | null; card: string | null; paragraphs: string[]; sentences: { text: string; stance: string; source: string; basis: string | null }[]; developments: { title: string; rules: string[]; reading: string | null; guidanceProposed: unknown }[]; strengths: { title: string; rules: string[] }[]; composition: { analysis?: { id: string; accepted: boolean; verdict: string | null }[]; leaksRemoved?: unknown[]; attempts?: { writer: number; verifier: number } } | null; limitations: string[]; context: string[]; text: string | null }

const caseResultOf = (key: string): CaseResult => {
  const analysisStep = artifact.steps[`analysis:${key}`]
  const messageStep = artifact.steps[`monitoring:${key}`]
  const analysis = analysisStep?.result?.analysis as { outcome: string; scenario: { procedureTitle: string | null; pathAssessment: string }; criteria: { text: string; heading: string | null; status: string; evidenceKind: string; evidence: Quote[]; ruleConflict: boolean }[] } | null | undefined
  const message = messageStep?.result?.message as StoredMessage | undefined
  return {
    id: key,
    error: analysisStep?.status === "DONE" ? null : `${analysisStep?.status ?? "NÃO EXECUTADA"}: ${analysisStep?.reason ?? ""}`,
    analysis: analysis ? { outcome: analysis.outcome, procedure: analysis.scenario.procedureTitle, pathAssessment: analysis.scenario.pathAssessment, criteria: analysis.criteria.map((criterion) => ({ text: criterion.text, heading: criterion.heading, status: criterion.status, evidenceKind: criterion.evidenceKind, evidence: criterion.evidence.map((quote) => `${quote.turn} ${quote.speaker ?? ""}: ${quote.quote}`), ruleConflict: criterion.ruleConflict })) } : null,
    message: message ? { kind: message.status, reason: message.abstainReason, tone: message.tone, card: message.card, paragraphs: message.paragraphs, sentences: message.sentences, developmentRules: message.developments.map((finding) => finding.rules), strengthRules: message.strengths.map((finding) => finding.rules), composition: message.composition } : null,
  }
}

const scores: CaseScore[] = Object.entries(truth.cases).map(([key, expected]) => scoreCase(caseResultOf(key), expected, truth.forbiddenMessagePhrases))
const mark = { PASS: "✅", FAIL: "❌", NEEDS_INSPECTION: "🔎", NOT_APPLICABLE: "—" } as const
const METHOD = { STRUCTURAL: "estrutural", AUXILIARY_LEXICAL: "auxiliar (léxico)", HUMAN: "inspeção humana" } as const
const lower = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

// Indicador.
const indicatorStep = artifact.steps["investigation:TMA"]
const investigation = ((indicatorStep?.result?.stored as unknown[] | undefined)?.[0] ?? null) as { conclusion: string; official: { value: number; target: number | null; withinTarget: boolean | null; movement: string | null; previous: { value: number } | null }; limitations: string[]; localization: { limitations: string[] }; evidence: { focusReason: string; analyzedCalls: number; newlyAnalyzed: number; universe: number; patterns: { text: string; classification: string; eligible: number; met: number; notMet: number; partial: number }[] }[]; budget: { callAnalyses: number } } | null
const indicatorMessage = indicatorStep?.result?.message as StoredMessage | undefined
const indicatorChecks: { label: string; status: keyof typeof mark; detail: string }[] = []
if (!investigation) indicatorChecks.push({ label: "Investigação", status: "FAIL", detail: indicatorStep?.reason ?? "não executada" })
else {
  const official = investigation.official
  const intact = official.value === truth.indicator.official.value && official.target === truth.indicator.official.target && official.withinTarget === truth.indicator.official.withinTarget && official.previous?.value === truth.indicator.official.previous && official.movement === truth.indicator.official.movement
  indicatorChecks.push({ label: "Fato oficial intacto", status: intact ? "PASS" : "FAIL", detail: `${official.value} (meta ${official.target}) · anterior ${official.previous?.value} · ${official.movement}` })
  indicatorChecks.push({ label: "Conclusão", status: truth.indicator.forbiddenConclusions.includes(investigation.conclusion) ? "FAIL" : truth.indicator.acceptableConclusions.includes(investigation.conclusion) ? "PASS" : "NEEDS_INSPECTION", detail: investigation.conclusion })
  const limitations = [...investigation.limitations, ...investigation.localization.limitations, ...(indicatorMessage?.limitations ?? [])]
  indicatorChecks.push({ label: "Limitação da localização declarada", status: limitations.some((text) => truth.indicator.mustHaveLimitationAbout.some((term) => lower(text).includes(lower(term)))) ? "PASS" : "FAIL", detail: limitations.join(" | ") || "nenhuma" })
  indicatorChecks.push({ label: "Análises novas pela investigação", status: investigation.budget.callAnalyses <= truth.indicator.maxNewCallAnalyses ? "PASS" : "FAIL", detail: `${investigation.budget.callAnalyses} (evidência: ${investigation.evidence.map((entry) => `${entry.focusReason} ${entry.analyzedCalls}/${entry.universe}, novas ${entry.newlyAnalyzed}`).join("; ") || "nenhuma"})` })
  indicatorChecks.push({ label: "Padrões observados (não causais)", status: "NEEDS_INSPECTION", detail: investigation.evidence.flatMap((entry) => entry.patterns.filter((pattern) => pattern.classification !== "NONE").map((pattern) => `${pattern.classification}: “${pattern.text.slice(0, 70)}” ${pattern.met}✓/${pattern.notMet + pattern.partial}✗ de ${pattern.eligible}`)).join("; ") || "nenhum" })
}
if (indicatorMessage) {
  const text = [indicatorMessage.card ?? "", ...indicatorMessage.paragraphs].join(" ")
  indicatorChecks.push({ label: "Decisão e tom", status: truth.indicator.message.outcome.includes(indicatorMessage.status) && (indicatorMessage.status !== "PUBLISHABLE" || truth.indicator.message.tone.includes(indicatorMessage.tone ?? "")) ? "PASS" : "FAIL", detail: `${indicatorMessage.status} ${indicatorMessage.tone ?? indicatorMessage.abstainReason ?? ""}` })
  const forbidden = truth.indicator.forbiddenInMessage.filter((term) => lower(text).includes(lower(term)))
  indicatorChecks.push({ label: "Sem 'seja mais rápida' / causa / garantia (auxiliar)", status: forbidden.length > 0 ? "NEEDS_INSPECTION" : "PASS", detail: forbidden.length > 0 ? forbidden.join(", ") : "nenhuma marca léxica (não prova ausência)" })
}
indicatorChecks.push({ label: "Colegas analisados", status: artifact.otherCollaboratorsAnalyzed === 0 ? "PASS" : "FAIL", detail: String(artifact.otherCollaboratorsAnalyzed) })

const budget = artifact.budget
const byStep = new Map<string, { requests: number; spent: number; unknown: number; prompt: number; total: number; thoughts: number; statuses: string[] }>()
for (const entry of budget?.ledger ?? []) {
  const stepName = entry.label.split(" · ")[0]!
  const current = byStep.get(stepName) ?? { requests: 0, spent: 0, unknown: 0, prompt: 0, total: 0, thoughts: 0, statuses: [] }
  if (entry.status !== "BLOCKED") current.requests += 1
  current.spent += entry.spentUsd
  current.unknown += entry.usageKnown ? 0 : 1
  current.prompt += entry.promptTokens ?? 0
  current.total += entry.totalTokens ?? 0
  current.thoughts += entry.thoughtsTokens ?? 0
  current.statuses.push(`${entry.label.split(" · ")[1] ?? ""}=${entry.status}`)
  byStep.set(stepName, current)
}

const messageBlock = (message: StoredMessage | undefined) => !message ? "_(sem mensagem)_" : message.status !== "PUBLISHABLE" ? `Abstenção: ${message.abstainReason}` : [`> **${message.card ?? ""}**`, ...message.paragraphs.map((paragraph) => `>\n> ${paragraph}`), "", `Fundamento das frases: ${message.sentences.map((sentence) => `${sentence.stance}/${sentence.basis ?? sentence.source}`).join(", ")}`].join("\n")
const report = [
  `# Validação focal — ${artifact.selection.person.name} (${artifact.selection.person.matricula})`,
  ``,
  `Modelo real ${artifact.model} · ${artifact.kind} · ${artifact.ranAt} · ${artifact.selection.person.team ?? ""} / ${artifact.selection.person.subteam ?? ""}`,
  ``,
  `> Uma pessoa, 3 chamadas e 1 indicador: resultado FOCAL. Não é taxa de qualidade da operação. Estrutural = comparação com o gabarito registrado antes da rodada; auxiliar = sinal léxico que aponta o que ler; inspeção humana = leitura do texto contra a regra.`,
  ``,
  `## Orçamento (fronteira HTTP)`,
  ``,
  budget ? `Requisições pagas: **${budget.totals.requests}** / 12 · bloqueadas pela trava: ${budget.totals.blocked} · custo estimado **US$ ${budget.totals.spentUsd.toFixed(4)}** / 1,00 · tokens de entrada ${budget.totals.promptTokens} · saída+raciocínio ${budget.totals.outputAndThoughtsTokens} · uso desconhecido: ${budget.totals.unknownUsage}${artifact.cumulative ? ` · acumulado na task: ${artifact.cumulative.requests} req / US$ ${artifact.cumulative.spentUsd.toFixed(4)}` : ""}` : "Sem livro-razão (dry-run).",
  ``,
  `| Etapa | Requisições | Tokens entrada | Tokens totais | Raciocínio | Custo US$ | Tentativas |`,
  `|---|---|---|---|---|---|---|`,
  ...[...byStep.entries()].map(([name, entry]) => `| ${name} | ${entry.requests} | ${entry.prompt} | ${entry.total} | ${entry.thoughts} | ${entry.spent.toFixed(4)}${entry.unknown ? ` (${entry.unknown} sem uso → reserva)` : ""} | ${entry.statuses.join(", ")} |`),
  ``,
  `Chamadas distintas analisadas: ${artifact.distinctCallsAnalyzed} · outros colaboradores analisados: ${artifact.otherCollaboratorsAnalyzed}.`,
  ``,
  `## Chamadas`,
  ``,
  ...scores.flatMap((score) => {
    const call = artifact.selection.calls.find((entry) => entry.key === score.id)!
    const dims = Object.keys(DIMENSION_LABELS) as (keyof CaseScore["dimensions"])[]
    return [
      `### ${score.id} — ${call.externalId} (${call.durationSeconds} s)`,
      ``,
      `_${truth.cases[score.id]!.scenario}_`,
      ``,
      ...dims.map((dim) => {
        const check = score.dimensions[dim] as CaseScore["dimensions"][typeof dim] & { items?: string[]; signals?: string[]; flagged?: string[]; nearDuplicates?: string[] }
        const extra = [...(check.items ?? []), ...(check.signals ?? []), ...(check.flagged ?? []).map((text) => `“${text.slice(0, 160)}”`), ...(check.nearDuplicates ?? [])]
        return `- ${mark[check.status]} **${DIMENSION_LABELS[dim]}** (${METHOD[check.method]}): ${check.detail}${extra.length > 0 ? `\n  - ${extra.join("\n  - ")}` : ""}`
      }),
      ``,
      messageBlock(artifact.steps[`monitoring:${score.id}`]?.result?.message as StoredMessage | undefined),
      ``,
    ]
  }),
  `## Indicador — ${artifact.selection.indicator.code} ${artifact.selection.indicator.referencePeriod}`,
  ``,
  `_${truth.indicator.scenario}_`,
  ``,
  ...indicatorChecks.map((check) => `- ${mark[check.status]} **${check.label}**: ${check.detail}`),
  ``,
  messageBlock(indicatorMessage),
  ``,
  `## Etapas`,
  ``,
  ...Object.entries(artifact.steps).map(([name, entry]) => `- ${name}: ${entry.status}${entry.reason ? ` — ${entry.reason}` : ""}`),
].join("\n")
const out = file.replace(/\.json$/, ".md")
writeFileSync(out, `${report}\n`)
console.log(report)
