import type { Database } from "../../../infrastructure/database/pool.js"
import { findTool } from "../../investigation/domain/tool-catalog.js"
import type { ToolResult } from "../../investigation/domain/tool-output.js"
import { HandleRegistry } from "../../investigation/domain/handle-registry.js"
import { defaultInvestigationToolState, loadSubject, type ToolContext } from "../../investigation/application/tool-context.js"
import { executeTool } from "../../investigation/application/tool-executor.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { ReusedCatalogTool } from "../domain/investigation-toolbox.js"

/**
 * EXECUTOR das ferramentas do CATÁLOGO de investigação para o motor (produção). Reaproveita tudo do catálogo — consultas,
 * cálculos, validação de argumentos (zod), escopo por organização/colaborador, qualidade e proveniência — sem duplicar nada.
 * O sujeito (colaborador), o indicador e o período padrão vêm da EXECUÇÃO do motor; os argumentos já chegam traduzidos e com
 * identidades reais (handles resolvidos pelo motor). Nenhuma destas ferramentas chama modelo.
 */
export type CatalogToolCall = { tool: ReusedCatalogTool; args: Record<string, unknown> }
export type CatalogToolScope = { organizationId: string; personId: string; agentId: string | null; indicatorCode: string; window: { start: Date; end: Date; label: string }; now: Date }
export type CatalogToolRunner = (call: CatalogToolCall, scope: CatalogToolScope) => Promise<ToolResult>

export const TOOL_TIMEOUT_MS = 40_000

export function createCatalogToolRunner(db: Database): CatalogToolRunner {
  const contexts = new Map<string, Promise<ToolContext>>()
  const contextOf = (scope: CatalogToolScope) => {
    const key = [scope.organizationId, scope.personId, scope.indicatorCode, scope.window.start.toISOString(), scope.window.end.toISOString()].join("|")
    let context = contexts.get(key)
    if (!context) {
      context = (async () => ({
        db,
        organizationId: scope.organizationId,
        agentId: scope.agentId,
        now: scope.now,
        timeZone: await resolveOrganizationTimezone(db, scope.organizationId),
        subject: await loadSubject(db, scope.organizationId, scope.personId, { indicatorCode: scope.indicatorCode }),
        defaultPeriod: scope.window,
        workdayCache: new Map(),
        knowledgeCandidates: new Map(),
        knowledgeExcerpts: new Map(),
        collectedFacts: [],
        telemetry: { requests: [] },
        handles: new HandleRegistry(),
        investigation: defaultInvestigationToolState(),
      }))()
      contexts.set(key, context)
    }
    return context
  }
  return async (call, scope) => {
    const tool = findTool(call.tool)
    if (!tool || tool.usesLlm) throw new Error(`Ferramenta ${call.tool} não é executável pelo motor.`)
    const context = await contextOf(scope)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        executeTool(context, tool, call.args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Tempo esgotado na ferramenta ${call.tool}.`)), TOOL_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
