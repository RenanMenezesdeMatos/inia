import type { Database } from "../../../infrastructure/database/pool.js"
import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { TRIAGE_REASON_LABELS } from "../domain/closing-triage.js"
import { INVESTIGATION_PLANNER_SYSTEM_PROMPT, parseInvestigationPlan, renderInvestigationPlannerTurn, type InvestigationStepSelection, type PlannerFacts, type StepChoice } from "../domain/investigation-steps.js"
import { referencePeriodLabel } from "../domain/prv-closing.js"
import type { IndicatorInvestigationPlan } from "./prepare-prv-closing.js"

/**
 * INDICATOR DIAGNOSIS V2 — PLANEJADOR DA INVESTIGAÇÃO (a IA lê a estratégia e ESCOLHE passos). Limitado por construção:
 *
 *   UMA chamada estruturada (+ no máximo UM retry técnico quando a resposta não é o JSON do contrato — mesma tarefa, só o aviso de
 *   formato); nenhum loop, nenhuma Tool, nenhum número calculado pelo modelo. Resposta inválida duas vezes = padrão determinístico
 *   (todos os passos permitidos e disponíveis), registrado. Falha de transporte sobe (o motor aplica o retry por categoria).
 *
 * O que entra: objetivo + instruções da estratégia (escritas pela operação), passos permitidos com a disponibilidade REAL, fatos
 * iniciais do sistema. O que sai: só códigos de passo + propósito curto (sem raciocínio livre, sem id). O sistema valida a escolha.
 */
export const INVESTIGATION_PLANNER_TAG = "stage:INDICATOR_INVESTIGATION_PLAN" as const
const FORMAT_NOTICE = "A resposta anterior não respeitou o formato. Responda SOMENTE com o objeto JSON do contrato, sem texto antes/depois e sem campos adicionais."

export type PlannerRecorder = {
  start(db: Database, input: { organizationId: string; agentId: string; source: "WORKFLOW"; inputContext: string }): Promise<string>
  complete(db: Database, runId: string, outputText: string): Promise<void>
  fail(db: Database, runId: string, message: string, outputText?: string | null): Promise<void>
}

export type PlannerGenerate = (input: Parameters<typeof generateForRoute>[0]) => Promise<{ kind: string; text?: string }>

function factsOf(plan: IndicatorInvestigationPlan, periodLabel: string, previousValue: number | null): PlannerFacts {
  const snapshot = plan.snapshot
  const value = (amount: number) => formatIndicatorValue(amount, snapshot.unit)
  const official = plan.decision.official
  const signalByKey = new Map((plan.signal?.distribution?.reasons ?? []).map((reason) => [reason.key, reason.signaled]))
  return {
    indicator: { name: snapshot.indicatorName, unit: snapshot.unit, direction: snapshot.direction },
    period: periodLabel,
    official: {
      value: value(official.value),
      target: official.target === null ? null : value(official.target),
      position: official.withinReference === null ? null : official.withinReference ? "dentro da referência" : "fora da referência",
      quartile: official.quartile,
      previous: previousValue !== null ? `${value(previousValue)}${plan.decision.official.previousQuartile ? ` (quartil ${plan.decision.official.previousQuartile})` : ""}` : plan.decision.official.previousQuartile ? `quartil ${plan.decision.official.previousQuartile}` : null,
    },
    triage: `${plan.decision.decision === "INVESTIGATE" ? "investigar (desenvolvimento)" : plan.decision.decision === "RECOGNIZE" ? "investigar (reconhecimento)" : "não investigar"} — ${plan.decision.reasons.map((reason) => TRIAGE_REASON_LABELS[reason]).join("; ")}`,
    population: {
      interactions: plan.interactionsInPeriod,
      reasons: plan.mixRows.current.slice().sort((a, b) => b.interactions - a.interactions || a.label.localeCompare(b.label)).slice(0, 8).map((row) => ({ label: row.label, interactions: row.interactions, signaled: plan.signal ? signalByKey.get(row.key) ?? 0 : null })),
    },
    signal: plan.signal?.distribution ? { label: plan.signal.distribution.signalLabel, signaled: plan.signal.distribution.signaled, previousSignaled: plan.signal.evolution ? plan.signal.evolution.previous.signaled : null } : null,
  }
}

export async function planInvestigationSteps(db: Database, input: { organizationId: string; agentId: string; plan: IndicatorInvestigationPlan; previousValue?: number | null; recorder: PlannerRecorder; generate?: PlannerGenerate }): Promise<{ choice: StepChoice[] | null; planner: InvestigationStepSelection["planner"] }> {
  const { plan } = input
  const parameters = plan.parameters
  const agent = (await db.query<{ name: string; objective: string | null }>(`select name, objective from agents where id = $1 and organization_id = $2`, [input.agentId, input.organizationId])).rows[0]
  const userTurn = [
    agent ? `Agent investigador: ${agent.name}${agent.objective ? ` — ${agent.objective}` : ""}` : null,
    renderInvestigationPlannerTurn({ objective: parameters.investigation.objective, instructions: parameters.investigation.instructions, steps: plan.steps.availability, allowed: parameters.investigation.allowedSteps, facts: factsOf(plan, referencePeriodLabel(plan.snapshot.referencePeriod), input.previousValue ?? null) }),
  ].filter(Boolean).join("\n\n")
  const runId = await input.recorder.start(db, { organizationId: input.organizationId, agentId: input.agentId, source: "WORKFLOW", inputContext: userTurn })
  const generate: PlannerGenerate = input.generate ?? generateForRoute
  const route = routeFor({ purpose: "PLANNING", phase: "PLANNING", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: Math.ceil((INVESTIGATION_PLANNER_SYSTEM_PROMPT.length + userTurn.length) / 4) })
  let attempts = 0
  let lastError: string | null = null
  let lastRaw = ""
  try {
    for (const notice of [null, FORMAT_NOTICE]) {
      attempts += 1
      const reply = await withLlmScope<{ kind: string; text?: string }>({ role: "agent", agentId: input.agentId }, () => generate({
        classification: { phase: "PLANNING", purpose: "PLANNING", source: "AGENT", semanticType: "INVESTIGATION", tags: [INVESTIGATION_PLANNER_TAG] },
        systemPrompt: INVESTIGATION_PLANNER_SYSTEM_PROMPT,
        contents: [{ role: "user", text: notice ? `${userTurn}\n\n${notice}` : userTurn }],
        tools: [],
        structuredOutput: true,
        route,
      }))
      lastRaw = reply.kind === "text" ? reply.text ?? "" : ""
      const parsed = parseInvestigationPlan(lastRaw)
      if (parsed.ok) {
        await input.recorder.complete(db, runId, lastRaw)
        return { choice: parsed.choice, planner: { status: "SELECTED", agentRunId: runId, attempts, error: null } }
      }
      lastError = parsed.error
    }
  } catch (error) {
    await input.recorder.fail(db, runId, error instanceof Error ? error.message : String(error))
    throw error
  }
  // Contrato violado duas vezes: o padrão determinístico (todos os permitidos e disponíveis) — nunca um passo inventado.
  await input.recorder.fail(db, runId, `INVESTIGATION_PLAN_CONTRACT_INVALID:${lastError}`, lastRaw.slice(0, 60_000))
  return { choice: null, planner: { status: "FALLBACK_DEFAULT", agentRunId: runId, attempts, error: lastError } }
}
