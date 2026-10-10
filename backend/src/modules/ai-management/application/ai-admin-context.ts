import type { Database } from "../../../infrastructure/database/pool.js"
import { recordAudit } from "../../data-hub/application/records.js"
import type { AdapterRegistry } from "../infrastructure/adapters/adapter-registry.js"
import type { AiRuntimeService } from "./ai-runtime-service.js"

/** Dependências das operações administrativas de IA — a mesma instância de runtime que o gateway usa (invalidação imediata). */
export type AiAdminContext = {
  db: Database
  runtime: AiRuntimeService
  adapters: AdapterRegistry
  now: () => Date
}

export type Actor = { organizationId: string; personId: string | null }

type Queryable = Pick<Database, "query">

/** Audit trail (§60) — `audit_logs`, mesmo helper da Central de Dados. O payload NUNCA leva segredo. */
export function auditAi(db: Queryable, actor: Actor, action: string, entityType: string, entityId: string, payload: Record<string, unknown> = {}): Promise<void> {
  return recordAudit(db, { organizationId: actor.organizationId, actorId: actor.personId, action, entityType, entityId, payload })
}
