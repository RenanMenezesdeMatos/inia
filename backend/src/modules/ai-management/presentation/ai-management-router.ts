import { Router, type NextFunction, type Request, type Response } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { AI_USE_CASES } from "../../../shared/application/model-routing/ai-use-cases.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { aiPermissionsFor, type AiPermission } from "../domain/ai-permissions.js"
import type { Actor, AiAdminContext } from "../application/ai-admin-context.js"
import { listBudgets, createBudget, updateBudget, deleteBudget } from "../application/ai-budget-service.js"
import { createConnection, deleteConnection, getConnection, listConnections, listProviders, removeConnectionSecret, replaceConnectionHeaders, replaceConnectionSecret, syncConnectionModels, testConnection, updateConnection } from "../application/ai-connection-service.js"
import { addPricing, createModel, deleteModel, getModel, listModels, listPricing, testModel, updateModel } from "../application/ai-model-service.js"
import { activateDraft, deactivatePolicy, discardDraft, legacyEnvironmentSummary, listRouting, saveDraft, testRouting } from "../application/ai-policy-service.js"
import { connectionsHealth, usageDashboard } from "../application/ai-usage-service.js"
import { usageRanking, usageRankingContext, type RankingViewer } from "../application/ai-usage-ranking-service.js"

/**
 * /api/v1/admin/ai — administração de Providers, Conexões, Modelos, Roteamento, Custos e
 * Orçamentos. Organização SEMPRE da sessão (nunca do corpo/URL); permissão verificada no backend
 * a cada request (§57, §59). Nenhuma rota devolve segredo.
 */
declare module "express-serve-static-core" {
  interface Request {
    aiPermissions?: AiPermission[]
  }
}

const idParam = z.uuid()
const useCaseParam = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)

function actorOf(request: Request): Actor {
  return { organizationId: request.user!.organizationId, personId: request.user!.personId ?? null }
}

export function createAiManagementRouter(context: Omit<AiAdminContext, "db"> & { db: Database }) {
  const router = Router()

  // Permissões derivadas das atribuições de papel reais (modelo geral de acesso, lidas do banco a cada request — nunca do JWT).
  router.use(async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const access = request.access ?? (await createPostgresAccessRepository(context.db).loadContext(request.user!.organizationId, request.user!.sub))
      request.access = access
      request.aiPermissions = aiPermissionsFor(access)
      next()
    } catch (error) {
      next(error)
    }
  })

  const can = (...permissions: AiPermission[]) => (request: Request, response: Response, next: NextFunction) => {
    if (permissions.every((permission) => request.aiPermissions?.includes(permission))) return next()
    return response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não tem permissão para esta ação de IA." } })
  }

  router.get("/me", (request, response) => response.json({ data: { permissions: request.aiPermissions ?? [] } }))
  router.get("/providers", can("AI_CONFIG_READ"), (_request, response) => response.json({ data: listProviders() }))
  router.get("/use-cases", can("AI_CONFIG_READ"), (_request, response) => response.json({ data: AI_USE_CASES }))
  router.get("/legacy", can("AI_CONFIG_READ"), (_request, response) => response.json({ data: legacyEnvironmentSummary() }))

  router.get("/overview", can("AI_USAGE_READ"), async (request, response) => {
    const org = actorOf(request).organizationId
    const [usage, health, connections, models, routing, budgets] = await Promise.all([
      usageDashboard(context, org, request.query),
      connectionsHealth(context, org),
      listConnections(context, org),
      listModels(context, org),
      listRouting(context, org),
      listBudgets(context, org),
    ])
    response.json({
      data: {
        usage,
        health,
        budgets,
        counts: { connections: connections.length, activeConnections: connections.filter((item) => item.enabled).length, models: models.length, activeModels: models.filter((item) => item.enabled && item.connectionEnabled).length, activePolicies: routing.filter((item) => item.active).length },
        onboarding: {
          hasConnection: connections.length > 0,
          hasCredential: connections.some((item) => item.credential.configured || item.provider?.credential !== "REQUIRED"),
          hasTestedConnection: connections.some((item) => item.health.status === "CONNECTED"),
          hasModel: models.some((item) => item.enabled),
          hasActivePolicy: routing.some((item) => item.active),
        },
        legacy: legacyEnvironmentSummary(),
      },
    })
  })
  router.get("/usage", can("AI_USAGE_READ"), async (request, response) => response.json({ data: await usageDashboard(context, actorOf(request).organizationId, request.query) }))
  router.get("/health", can("AI_USAGE_READ"), async (request, response) => response.json({ data: await connectionsHealth(context, actorOf(request).organizationId) }))

  // Quem mais usa (ranking por estrutura): permissão explícita; o recorte de pessoas sai do escopo da conta, no serviço.
  // Pessoa = a da CONTA lida do banco neste request (escopo "Minha estrutura"), não a foto do JWT.
  const rankingViewer = (request: Request): RankingViewer => ({ organizationId: request.user!.organizationId, personId: request.access!.personId, access: request.access! })
  router.get("/usage/ranking/context", can("AI_USAGE_RANKING_READ"), async (request, response) => response.json({ data: await usageRankingContext(context, rankingViewer(request)) }))
  router.get("/usage/ranking", can("AI_USAGE_RANKING_READ"), async (request, response) => response.json({ data: await usageRanking(context, rankingViewer(request), request.query) }))

  // Conexões
  router.get("/connections", can("AI_CONFIG_READ"), async (request, response) => response.json({ data: await listConnections(context, actorOf(request).organizationId) }))
  router.post("/connections", can("AI_CONFIG_WRITE"), async (request, response) => {
    // Informar credencial na criação também é escrita de segredo.
    const body = (request.body ?? {}) as Record<string, unknown>
    if ((body.apiKey || body.customHeaders) && !request.aiPermissions?.includes("AI_SECRETS_WRITE")) return response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não tem permissão para gravar credenciais de IA." } })
    return response.status(201).json({ data: await createConnection(context, actorOf(request), body) })
  })
  router.get("/connections/:id", can("AI_CONFIG_READ"), async (request, response) => response.json({ data: await getConnection(context, actorOf(request).organizationId, idParam.parse(request.params.id)) }))
  router.patch("/connections/:id", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await updateConnection(context, actorOf(request), idParam.parse(request.params.id), request.body) }))
  router.delete("/connections/:id", can("AI_CONFIG_WRITE"), async (request, response) => {
    await deleteConnection(context, actorOf(request), idParam.parse(request.params.id))
    response.status(204).end()
  })
  router.put("/connections/:id/secret", can("AI_SECRETS_WRITE"), async (request, response) => response.json({ data: await replaceConnectionSecret(context, actorOf(request), idParam.parse(request.params.id), request.body) }))
  router.delete("/connections/:id/secret", can("AI_SECRETS_WRITE"), async (request, response) => response.json({ data: await removeConnectionSecret(context, actorOf(request), idParam.parse(request.params.id)) }))
  router.put("/connections/:id/headers", can("AI_SECRETS_WRITE"), async (request, response) => response.json({ data: await replaceConnectionHeaders(context, actorOf(request), idParam.parse(request.params.id), request.body) }))
  router.post("/connections/:id/test", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await testConnection(context, actorOf(request), idParam.parse(request.params.id)) }))
  router.post("/connections/:id/sync-models", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await syncConnectionModels(context, actorOf(request), idParam.parse(request.params.id)) }))

  // Modelos e preços
  router.get("/models", can("AI_CONFIG_READ"), async (request, response) => {
    const connectionId = typeof request.query.connectionId === "string" ? idParam.parse(request.query.connectionId) : undefined
    response.json({ data: await listModels(context, actorOf(request).organizationId, { connectionId }) })
  })
  router.post("/models", can("AI_CONFIG_WRITE"), async (request, response) => response.status(201).json({ data: await createModel(context, actorOf(request), request.body) }))
  router.get("/models/:id", can("AI_CONFIG_READ"), async (request, response) => response.json({ data: await getModel(context, actorOf(request).organizationId, idParam.parse(request.params.id)) }))
  router.patch("/models/:id", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await updateModel(context, actorOf(request), idParam.parse(request.params.id), request.body) }))
  router.delete("/models/:id", can("AI_CONFIG_WRITE"), async (request, response) => {
    await deleteModel(context, actorOf(request), idParam.parse(request.params.id))
    response.status(204).end()
  })
  router.post("/models/:id/test", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await testModel(context, actorOf(request), idParam.parse(request.params.id)) }))
  router.get("/models/:id/pricing", can("AI_CONFIG_READ"), async (request, response) => response.json({ data: await listPricing(context, actorOf(request).organizationId, idParam.parse(request.params.id)) }))
  router.post("/models/:id/pricing", can("AI_CONFIG_WRITE"), async (request, response) => response.status(201).json({ data: await addPricing(context, actorOf(request), idParam.parse(request.params.id), request.body) }))

  // Roteamento por Use Case
  router.get("/routing", can("AI_CONFIG_READ"), async (request, response) => response.json({ data: await listRouting(context, actorOf(request).organizationId) }))
  router.put("/routing/:useCase/draft", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await saveDraft(context, actorOf(request), useCaseParam.parse(request.params.useCase), request.body) }))
  router.delete("/routing/:useCase/draft", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await discardDraft(context, actorOf(request), useCaseParam.parse(request.params.useCase)) }))
  router.post("/routing/:useCase/activate", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await activateDraft(context, actorOf(request), useCaseParam.parse(request.params.useCase)) }))
  router.post("/routing/:useCase/deactivate", can("AI_CONFIG_WRITE"), async (request, response) => response.json({ data: await deactivatePolicy(context, actorOf(request), useCaseParam.parse(request.params.useCase)) }))
  router.post("/routing/:useCase/test", can("AI_CONFIG_READ"), async (request, response) => {
    const body = z.object({ source: z.enum(["ACTIVE", "DRAFT"]).optional(), estimatedInputTokens: z.number().int().positive().nullish() }).parse(request.body ?? {})
    response.json({ data: await testRouting(context, actorOf(request).organizationId, useCaseParam.parse(request.params.useCase), { ...(body.source ? { source: body.source } : {}), estimatedInputTokens: body.estimatedInputTokens ?? null }) })
  })

  // Orçamentos
  router.get("/budgets", can("AI_USAGE_READ"), async (request, response) => response.json({ data: await listBudgets(context, actorOf(request).organizationId) }))
  router.post("/budgets", can("AI_BUDGET_WRITE"), async (request, response) => response.status(201).json({ data: await createBudget(context, actorOf(request), request.body) }))
  router.put("/budgets/:id", can("AI_BUDGET_WRITE"), async (request, response) => response.json({ data: await updateBudget(context, actorOf(request), idParam.parse(request.params.id), request.body) }))
  router.delete("/budgets/:id", can("AI_BUDGET_WRITE"), async (request, response) => response.json({ data: await deleteBudget(context, actorOf(request), idParam.parse(request.params.id)) }))

  return router
}
