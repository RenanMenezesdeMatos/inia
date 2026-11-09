import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { findUseCase } from "../../../shared/application/model-routing/ai-use-cases.js"
import { AI_BUDGET_SCOPES, DEFAULT_WARNING_THRESHOLDS, validateBudgetInput, type AiBudgetEvaluation } from "../domain/ai-budget.js"
import { findAiProvider } from "../domain/ai-provider-catalog.js"
import { auditAi, type Actor, type AiAdminContext } from "./ai-admin-context.js"
import { syncBudgetAlerts } from "./ai-budget-alerts.js"
import { budgetFromRow } from "./ai-runtime-store.js"

/** ORÇAMENTOS (§49–§52, §96): global, por Use Case ou por provider — sempre com moeda explícita. */
export const budgetSchema = z.object({
  scope: z.enum(AI_BUDGET_SCOPES),
  scopeKey: z.string().trim().nullish(),
  currency: z.string().trim().toUpperCase(),
  monthlyAmount: z.union([z.string().trim(), z.number().positive()]).transform(String),
  warningThresholds: z.array(z.number().int()).max(5).optional(),
  hardLimit: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

export type BudgetView = { id: string; scope: string; scopeKey: string | null; scopeLabel: string; currency: string; monthlyAmount: string; warningThresholds: number[]; hardLimit: boolean; enabled: boolean; evaluation: AiBudgetEvaluation | null }

type BudgetRow = Parameters<typeof budgetFromRow>[0]

function scopeLabel(scope: string, scopeKey: string | null): string {
  if (scope === "GLOBAL") return "Global (todos os usos)"
  if (scope === "USE_CASE") return findUseCase(scopeKey ?? "")?.label ?? scopeKey ?? ""
  return findAiProvider(scopeKey ?? "")?.name ?? scopeKey ?? ""
}

export async function listBudgets(context: AiAdminContext, organizationId: string): Promise<BudgetView[]> {
  const rows = await context.db.query<BudgetRow>(`select id, scope, scope_key, currency, monthly_amount::text, warning_thresholds, hard_limit, enabled from ai_budgets where organization_id = $1 order by scope, scope_key nulls first`, [organizationId])
  const evaluations = await context.runtime.budgetEvaluations(organizationId)
  return rows.rows.map((row) => ({ id: row.id, scope: row.scope, scopeKey: row.scope_key, scopeLabel: scopeLabel(row.scope, row.scope_key), currency: row.currency, monthlyAmount: row.monthly_amount, warningThresholds: row.warning_thresholds, hardLimit: row.hard_limit, enabled: row.enabled, evaluation: evaluations.find((evaluation) => evaluation.budgetId === row.id) ?? null }))
}

function validate(input: z.infer<typeof budgetSchema>) {
  const scopeKey = input.scope === "GLOBAL" ? null : (input.scopeKey ?? null)
  const issues = validateBudgetInput({ scope: input.scope, scopeKey, currency: input.currency, monthlyAmount: input.monthlyAmount, warningThresholds: input.warningThresholds ?? DEFAULT_WARNING_THRESHOLDS })
  if (input.scope === "USE_CASE" && scopeKey && !findUseCase(scopeKey)) issues.push("Use Case desconhecido.")
  if (input.scope === "PROVIDER" && scopeKey && !findAiProvider(scopeKey)) issues.push("Provider desconhecido.")
  if (issues.length > 0) throw new DomainError(issues.join(" "), "AI_BUDGET_INVALID", 422, { issues })
  return scopeKey
}

async function afterWrite(context: AiAdminContext, organizationId: string): Promise<void> {
  context.runtime.invalidate(organizationId)
  const snapshot = await context.runtime.snapshot(organizationId)
  await syncBudgetAlerts(context.db, organizationId, snapshot.budgets, await context.runtime.budgetEvaluations(organizationId), context.now(), snapshot.timezone)
}

export async function createBudget(context: AiAdminContext, actor: Actor, rawInput: unknown): Promise<BudgetView[]> {
  const input = budgetSchema.parse(rawInput)
  const scopeKey = validate(input)
  try {
    const inserted = await context.db.query<{ id: string }>(
      `insert into ai_budgets (organization_id, scope, scope_key, currency, monthly_amount, warning_thresholds, hard_limit, enabled, created_by, updated_by, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $10) returning id`,
      [actor.organizationId, input.scope, scopeKey, input.currency, input.monthlyAmount, input.warningThresholds ?? DEFAULT_WARNING_THRESHOLDS, input.hardLimit ?? false, input.enabled ?? true, actor.personId, context.now()],
    )
    await auditAi(context.db, actor, "AI_BUDGET_CREATED", "ai_budget", inserted.rows[0]!.id, { scope: input.scope, scopeKey, currency: input.currency, monthlyAmount: input.monthlyAmount, hardLimit: input.hardLimit ?? false })
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new DomainError("Já existe orçamento para este escopo e moeda.", "AI_BUDGET_DUPLICATE", 409)
    throw error
  }
  await afterWrite(context, actor.organizationId)
  return listBudgets(context, actor.organizationId)
}

export async function updateBudget(context: AiAdminContext, actor: Actor, id: string, rawInput: unknown): Promise<BudgetView[]> {
  const input = budgetSchema.parse(rawInput)
  const scopeKey = validate(input)
  const updated = await context.db.query(
    `update ai_budgets set scope = $3, scope_key = $4, currency = $5, monthly_amount = $6, warning_thresholds = $7, hard_limit = $8, enabled = $9, updated_by = $10, updated_at = $11 where organization_id = $1 and id = $2`,
    [actor.organizationId, id, input.scope, scopeKey, input.currency, input.monthlyAmount, input.warningThresholds ?? DEFAULT_WARNING_THRESHOLDS, input.hardLimit ?? false, input.enabled ?? true, actor.personId, context.now()],
  )
  if ((updated.rowCount ?? 0) === 0) throw new DomainError("Orçamento não encontrado.", "AI_BUDGET_NOT_FOUND", 404)
  await auditAi(context.db, actor, "AI_BUDGET_UPDATED", "ai_budget", id, { scope: input.scope, scopeKey, currency: input.currency, monthlyAmount: input.monthlyAmount, hardLimit: input.hardLimit ?? false, enabled: input.enabled ?? true })
  await afterWrite(context, actor.organizationId)
  return listBudgets(context, actor.organizationId)
}

export async function deleteBudget(context: AiAdminContext, actor: Actor, id: string): Promise<BudgetView[]> {
  // Exclusão lógica (migration 177): volta pela Central de Dados, desligado.
  const deleted = await context.db.query(`update ai_budgets_all set enabled = false, deleted_at = now(), deleted_by_person_id = $3, updated_at = now() where organization_id = $1 and id = $2 and deleted_at is null`, [actor.organizationId, id, actor.personId])
  if ((deleted.rowCount ?? 0) === 0) throw new DomainError("Orçamento não encontrado.", "AI_BUDGET_NOT_FOUND", 404)
  await auditAi(context.db, actor, "AI_BUDGET_DELETED", "ai_budget", id, {})
  context.runtime.invalidate(actor.organizationId)
  return listBudgets(context, actor.organizationId)
}
