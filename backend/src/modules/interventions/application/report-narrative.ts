import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { narrativeIssues, reportNarrativeSchema, REPORT_NARRATIVE_CONTRACT, type IntelligenceReport, type ReportNarrative } from "../domain/intelligence-report.js"

/**
 * NARRATIVA do relatório de inteligência — a IA redige A PARTIR da parte estruturada (fatos, fontes, diagnóstico, incertezas e
 * ações, cada um com marcador) e devolve JSON verificado por código: todo marcador citado existe, hipóteses ficam separadas e
 * dizem o que falta confirmar. O modelo não recebe (nem pode devolver) resultado de regra: ele não decide nada.
 * Cada tentativa vira uma linha (pronta ou falha). Falha nunca apaga o fundamento; repetir nunca toca nas intervenções.
 */
export type NarrativeWriter = (input: { organizationId: string; system: string; user: string; stage: "REPORT_NARRATIVE" | "INTERVENTION_DRAFT" }) => Promise<string>

/** Escritor de produção: o gateway único (uso/custo registrados; policy de IA da organização quando houver). */
export const gatewayNarrativeWriter: NarrativeWriter = async (input) => {
  const call = async () => {
    const route = routeFor({ purpose: "INTERVENTION_WRITING", phase: "SYNTHESIS", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(input.system, input.user) })
    const reply = await withLlmScope({ role: "intervention_writer", agentId: null }, () =>
      generateForRoute({
        classification: { phase: "SYNTHESIS", purpose: "INTERVENTION_WRITING", source: "INTERVENTION", semanticType: "INTERVENTION_REPORT", tags: [`stage:${input.stage}`] },
        systemPrompt: input.system,
        contents: [{ role: "user", text: input.user }],
        tools: [],
        structuredOutput: true,
        route,
      }),
    )
    return reply.kind === "text" ? reply.text : ""
  }
  // Dentro de um nó de Workflow o contexto (organização + correlação da execução) já existe; fora dele, abre o da organização.
  return currentAiOrganizationId() === input.organizationId ? call() : runWithAiOrganization(input.organizationId, call)
}

export const REPORT_NARRATIVE_SYSTEM = [
  "Você redige a narrativa de um relatório de acompanhamento para um líder de operação, em português do Brasil, linguagem de negócio, clara e respeitosa.",
  "Use SOMENTE o relatório fornecido. Cada parágrafo cita os marcadores que o sustentam (F = fato, S = fonte, D = diagnóstico, U = incerteza, A = ação).",
  "Nunca invente fato, causa, número, evidência ou resultado. Não reavalie as regras nem mude as ações: elas já foram decididas por regra e estão no relatório.",
  "Dado ausente ou insuficiente NÃO é desempenho ruim: diga que falta o dado. Sem diagnóstico sustentado, não diga o que a pessoa deve treinar.",
  "Hipóteses ficam separadas dos fatos e sempre dizem o que falta para confirmá-las. Avaliação de continuidade é uma solicitação de decisão humana, nunca um desligamento decidido.",
  `Responda só com JSON no formato ${REPORT_NARRATIVE_CONTRACT}: {"situation":{"text":"...","refs":["F1"]},"analysis":[{"text":"...","refs":["F1","S1"]}],"hypotheses":[{"text":"...","refs":["D1"],"toConfirm":"..."}],"leaderGuidance":[{"action":"A1","text":"..."}]}.`,
].join("\n")

/** O que vai ao modelo: o relatório sem ids técnicos (marcadores no lugar) — nunca UUID, nunca regra para reavaliar. */
export function narrativeInput(report: IntelligenceReport): string {
  return JSON.stringify({
    colaborador: report.subject.personName,
    indicador: report.subject.indicatorName,
    periodo: report.situation.period,
    situacao: report.situation.summary,
    fatos: report.facts.map((fact) => ({ marcador: fact.handle, fato: fact.statement, condicao: fact.status === "MET" ? "atendida" : "não atendida" })),
    fontes: report.sources.map((source) => ({ marcador: source.handle, tipo: source.kind, descricao: source.label, data: source.occurredAt })),
    diagnostico: report.diagnosis.map((item) => ({ marcador: item.handle, indicador: item.indicatorCode, periodo: item.period, padroes: item.patterns.map((pattern) => pattern.title) })),
    incertezas: report.uncertainties.map((item) => ({ marcador: item.handle, descricao: item.statement })),
    dadosFaltantes: report.missingData,
    intervencoesAnteriores: report.priorInterventions.map((item) => ({ tipo: item.typeName, situacao: item.status, aberta: item.openedAt.slice(0, 10), resultadoOperacional: item.operationalResult })),
    acoes: report.actions.map((action) => ({ marcador: action.handle, tipo: action.typeName, decisao: action.statusLabel, justificativa: action.justification, responsavel: action.responsible?.name ?? null, prazo: action.dueAt, proximosPassos: action.nextSteps, criteriosDeResultado: action.resultCriteria })),
  })
}

export function parseNarrative(raw: string, report: IntelligenceReport): { ok: true; narrative: ReportNarrative } | { ok: false; error: string } {
  let json: unknown
  try {
    json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""))
  } catch {
    return { ok: false, error: "A resposta da IA não é um JSON válido." }
  }
  const parsed = reportNarrativeSchema.safeParse(json)
  if (!parsed.success) return { ok: false, error: `A resposta da IA não segue o contrato: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}` }
  const issues = narrativeIssues(parsed.data, report)
  if (issues.length > 0) return { ok: false, error: `A resposta da IA cita o que não está no relatório: ${issues.slice(0, 3).join(" ")}` }
  return { ok: true, narrative: parsed.data }
}

export type NarrativeResult = { status: "READY" | "FAILED"; attempt: number; error: string | null }

/** Gera (ou tenta de novo) a narrativa. Nunca lança por falha do modelo: registra a tentativa e devolve o estado. */
export async function generateReportNarrative(db: Database, input: { organizationId: string; reportId: string; requestedBy?: string | null }, writer: NarrativeWriter = gatewayNarrativeWriter): Promise<NarrativeResult> {
  const report = (await db.query<{ structured: IntelligenceReport }>(`select structured from intervention_reports where id = $1 and organization_id = $2`, [input.reportId, input.organizationId])).rows[0]
  if (!report) throw new DomainError("Relatório não encontrado.", "INTERVENTION_REPORT_NOT_FOUND", 404)
  const ready = (await db.query(`select 1 from intervention_report_narratives where report_id = $1 and status = 'READY'`, [input.reportId])).rowCount
  if (ready) {
    const attempt = (await db.query<{ attempt: number }>(`select max(attempt) attempt from intervention_report_narratives where report_id = $1`, [input.reportId])).rows[0]!.attempt
    return { status: "READY", attempt, error: null }
  }
  let outcome: { ok: true; narrative: ReportNarrative } | { ok: false; error: string }
  try {
    outcome = parseNarrative(await writer({ organizationId: input.organizationId, system: REPORT_NARRATIVE_SYSTEM, user: narrativeInput(report.structured), stage: "REPORT_NARRATIVE" }), report.structured)
  } catch (error) {
    outcome = { ok: false, error: `Falha ao gerar a narrativa: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000) }
  }
  // Duas tentativas simultâneas: o número da tentativa é único por relatório; a que perde recalcula o próximo.
  for (let retry = 0; retry < 3; retry += 1) {
    const next = (await db.query<{ next: number }>(`select coalesce(max(attempt), 0) + 1 next from intervention_report_narratives where report_id = $1`, [input.reportId])).rows[0]!.next
    const inserted = await db.query(
      `insert into intervention_report_narratives (organization_id, report_id, attempt, status, narrative, error, requested_by) values ($1,$2,$3,$4,$5,$6,$7) on conflict (report_id, attempt) do nothing`,
      [input.organizationId, input.reportId, next, outcome.ok ? "READY" : "FAILED", outcome.ok ? JSON.stringify(outcome.narrative) : null, outcome.ok ? null : outcome.error, input.requestedBy ?? null],
    )
    if (inserted.rowCount) return { status: outcome.ok ? "READY" : "FAILED", attempt: next, error: outcome.ok ? null : outcome.error }
  }
  return { status: "FAILED", attempt: 0, error: "Não foi possível registrar a tentativa." }
}
