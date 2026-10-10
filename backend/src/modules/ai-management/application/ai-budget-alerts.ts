import type { Database } from "../../../infrastructure/database/pool.js"
import { personIdsWithOrganizationWidePermission } from "../../access/application/permission-holders.js"
import type { AiBudget, AiBudgetEvaluation } from "../domain/ai-budget.js"

/**
 * ALERTAS DE ORÇAMENTO (§52) — reaproveitam o Sino (`alerts`, dedupe por orçamento × mês ×
 * limiar), no mesmo padrão dos avisos administrativos da Central de Dados. Nenhum sistema paralelo
 * de notificação. Idempotente: rodar de novo no mesmo mês não duplica.
 */
export const AI_BUDGET_ALERT_TYPE = "AI_BUDGET_THRESHOLD"

type Queryable = Pick<Database, "query">

export function budgetAlertDedupeKey(budgetId: string, month: string, threshold: number, recipientId: string): string {
  return `ai_budget:${budgetId}:${month}:${threshold}:${recipientId}`
}

function scopeLabel(budget: AiBudget): string {
  return budget.scope === "GLOBAL" ? "global" : budget.scope === "USE_CASE" ? `do Use Case ${budget.scopeKey}` : `do provider ${budget.scopeKey}`
}

export async function syncBudgetAlerts(db: Queryable, organizationId: string, budgets: readonly AiBudget[], evaluations: readonly AiBudgetEvaluation[], now: Date, timezone: string): Promise<number> {
  const reached = evaluations.filter((evaluation) => evaluation.reachedThresholds.length > 0)
  if (reached.length === 0) return 0
  const month = now.toLocaleDateString("sv-SE", { timeZone: timezone }).slice(0, 7)
  // V1.5.8: quem recebe = contas com `ai.manage` na organização inteira (papéis), nunca o nível hierárquico "ADMIN".
  const admins = { rows: (await personIdsWithOrganizationWidePermission(db, organizationId, "ai.manage")).map((id) => ({ id })) }
  let created = 0
  for (const evaluation of reached) {
    const budget = budgets.find((item) => item.id === evaluation.budgetId)
    if (!budget) continue
    const threshold = Math.max(...evaluation.reachedThresholds)
    const severity = threshold >= 100 ? "HIGH" : threshold >= 90 ? "MEDIUM" : "INFO"
    const title = `Orçamento de IA ${scopeLabel(budget)}: ${threshold}% atingido`
    const description = `Gasto estimado no mês: ${evaluation.spent} de ${evaluation.limit} ${evaluation.currency}${evaluation.percent !== null ? ` (${evaluation.percent}%)` : ""}.${budget.hardLimit && threshold >= 100 ? " Bloqueio ativado: novas chamadas pagas deste escopo são recusadas (AI_BUDGET_EXCEEDED)." : ""}${evaluation.unknownCostCalls > 0 ? ` ${evaluation.unknownCostCalls} chamada(s) sem custo conhecido não entram nesta soma.` : ""}`
    for (const admin of admins.rows) {
      const inserted = await db.query(
        `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (dedupe_key) do nothing`,
        [organizationId, admin.id, title, description, severity, AI_BUDGET_ALERT_TYPE, budgetAlertDedupeKey(budget.id, month, threshold, admin.id), now],
      )
      created += inserted.rowCount ?? 0
    }
  }
  return created
}
