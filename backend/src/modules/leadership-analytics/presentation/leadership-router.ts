import { Router, type Request } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ANALYTICS_SUBJECT_KINDS } from "../../performance-analytics/domain/analytics-subject.js"
import { isGroupingDimension } from "../../performance-analytics/domain/hierarchy-levels.js"
import { buildLeadershipHome, loadLeadershipSession, toolDependencies, type LeadershipSession } from "../application/leadership-context.js"
import { executeLeadershipTool, isLeadershipTool } from "../application/leadership-toolset.js"

const subjectQuerySchema = z.object({
  subjectKind: z.enum(ANALYTICS_SUBJECT_KINDS as [string, ...string[]]).optional(),
  subjectId: z.string().uuid().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
})

/**
 * Leituras determinísticas da liderança — as MESMAS funções que as ferramentas do chat executam, sem IA: o cartão "Onde atuar
 * hoje" do Acompanhamento e a verificação dos números. O sujeito vindo da query é validado contra o escopo da sessão.
 */
export function createLeadershipRouter(db: Database, loadSession: (request: Request) => Promise<LeadershipSession | null> = (request) => loadLeadershipSession(db, request.user!)) {
  const router = Router()

  const requireSession = async (request: Request): Promise<LeadershipSession> => {
    const session = await loadSession(request)
    if (!session) throw new DomainError("Disponível para quem lidera uma estrutura ou tem acesso de consulta a indicadores.", "LEADERSHIP_SCOPE_REQUIRED", 403)
    return session
  }

  /** Executa a MESMA ferramenta do chat com a estrutura da query (validada contra o escopo dentro dela) e devolve o cartão. */
  const run = async (request: Request, name: string, extra: Record<string, unknown>) => {
    const session = await requireSession(request)
    const query = subjectQuerySchema.parse(request.query)
    const result = await executeLeadershipTool(toolDependencies(session), name, { ...extra, subject_kind: query.subjectKind, subject_id: query.subjectId, competencia: query.period })
    if (result.issue) {
      const status = result.issue.kind === "NOT_FOUND" && query.subjectId ? 403 : 422
      throw new DomainError(status === 403 ? "Você não tem acesso a esta estrutura." : result.issue.message, status === 403 ? "STRUCTURE_ACCESS_DENIED" : "LEADERSHIP_QUERY_UNRESOLVED", status, result.issue.candidates.length > 0 ? { candidates: result.issue.candidates } : undefined)
    }
    return result.card
  }

  router.get("/home", async (request, response) => {
    const session = await loadSession(request)
    if (!session) {
      response.json({ data: { enabled: false, priorities: null, suggestions: [] } })
      return
    }
    response.json({ data: { enabled: true, ...(await buildLeadershipHome(session)) } })
  })

  router.get("/overview", async (request, response) => {
    response.json({ data: await run(request, "leadership_structure_overview", {}) })
  })

  router.get("/indicator-analysis", async (request, response) => {
    const indicator = z.string().trim().min(1).max(120).parse(request.query.indicator)
    const groupBy = request.query.groupBy
    if (groupBy !== undefined && !isGroupingDimension(groupBy)) throw new DomainError("Agrupamento inválido.", "INVALID_GROUPING", 400)
    response.json({ data: await run(request, "leadership_indicator_analysis", { indicador: indicator, agrupar_por: groupBy }) })
  })

  router.get("/people", async (request, response) => {
    const query = z.object({ indicator: z.string().trim().max(120).optional(), situation: z.enum(["BELOW_REFERENCE", "NO_DATA", "IMPROVING", "WITHIN_REFERENCE"]).optional(), pendingOnly: z.enum(["true", "false"]).optional() }).parse(request.query)
    response.json({ data: await run(request, "leadership_people", { indicador: query.indicator, situacao: query.situation, so_pendentes: query.pendingOnly === "true" }) })
  })

  // Consulta flexível — os mesmos argumentos que a INIA monta (ver `leadership_indicator_query`), validados no backend.
  router.post("/query", async (request, response) => {
    // O sujeito vem só da query (validado em `run`); no corpo, apenas os argumentos da consulta.
    const toolArgs = Object.fromEntries(Object.entries(z.record(z.string(), z.unknown()).parse(request.body ?? {})).filter(([key]) => key !== "subject_kind" && key !== "subject_id"))
    response.json({ data: await run(request, "leadership_indicator_query", toolArgs) })
  })

  // Qualquer ferramenta da liderança com os argumentos que a INIA montaria — mesma execução e escopo do chat, sem IA (validação/telas).
  router.post("/tools/:name", async (request, response) => {
    const name = String(request.params.name)
    if (!isLeadershipTool(name)) throw new DomainError("Ferramenta desconhecida.", "LEADERSHIP_TOOL_NOT_FOUND", 404)
    const toolArgs = Object.fromEntries(Object.entries(z.record(z.string(), z.unknown()).parse(request.body ?? {})).filter(([key]) => key !== "subject_kind" && key !== "subject_id"))
    response.json({ data: await run(request, name, toolArgs) })
  })

  router.get("/priorities", async (request, response) => {
    response.json({ data: await run(request, "leadership_priorities", {}) })
  })

  return router
}
