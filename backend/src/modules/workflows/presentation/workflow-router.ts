import { Router } from "express"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createWorkflowResultsRouter } from "./workflow-results-router.js"
import { signalWorkflowWork } from "../application/workflow-work-signal.js"
import type { WorkflowRouterOptions } from "./workflow-router/shared.js"
import { registerWorkflowQueryRoutes } from "./workflow-router/query-routes.js"
import { registerWorkflowEnrollmentRoutes } from "./workflow-router/enrollment-routes.js"
import { registerWorkflowDefinitionRoutes } from "./workflow-router/definition-routes.js"
import { registerWorkflowLifecycleRoutes } from "./workflow-router/lifecycle-routes.js"
import { registerWorkflowManualRunRoutes } from "./workflow-router/manual-run-routes.js"
import { registerWorkflowVariableRoutes } from "./workflow-router/variable-routes.js"

export type { WorkflowRouterOptions } from "./workflow-router/shared.js"

const defaultRouterOptions: WorkflowRouterOptions = {
  onManualRunCreated: () => signalWorkflowWork(),
}

export function createWorkflowRouter(db: Database, overrides: Partial<WorkflowRouterOptions> = {}) {
  const options: WorkflowRouterOptions = { ...defaultRouterOptions, ...overrides }
  const router = Router()
  // V1.5.13 — aba "Resultados" (read model; organização da sessão e escopo por pessoa — ver workflow-results-router.ts).
  router.use(createWorkflowResultsRouter(db))
  registerWorkflowQueryRoutes(router, db)
  registerWorkflowEnrollmentRoutes(router, db)
  registerWorkflowDefinitionRoutes(router, db)
  registerWorkflowLifecycleRoutes(router, db)
  registerWorkflowManualRunRoutes(router, db, options)
  registerWorkflowVariableRoutes(router, db)

  return router
}
