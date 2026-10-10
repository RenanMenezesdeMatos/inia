import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { resolveOrganizationalStructureFreshness } from "../../people/application/employment-status-freshness.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { postgresHierarchyReader } from "../../workflows/application/organizational-recipient.js"
import { loadManagementMetrics } from "../application/load-management-metrics.js"
import { buildPersonOrganizationStructure, type PersonOrganizationStructureDeps } from "../application/person-organization-structure.js"

const paramsSchema = z.object({ personId: z.string().uuid() })

/** E-mail corporativo = o da conta de acesso (`user_accounts`), em UMA consulta para todos os nós. */
async function loadCorporateEmails(db: Database, personIds: string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map()
  const result = await db.query<{ person_id: string; email: string }>(`select person_id, email from user_accounts where person_id = any($1::uuid[])`, [personIds])
  return new Map(result.rows.map((row) => [row.person_id, row.email]))
}

/**
 * `GET /api/v1/people/:personId/organization-structure` — a aba Estrutura do perfil e a navegação
 * progressiva (pessoa focal + cadeia acima + subordinados diretos). Só leitura, sem IA; a
 * permissão é decidida pelo builder (qualquer pessoa ativa da organização é focável; a ficha e as
 * métricas gerenciais continuam restritas). Editar a estrutura continua sendo papel da
 * Administração/Central de Dados.
 */
export function createPersonOrganizationStructureRouter(db: Database, deps?: Partial<PersonOrganizationStructureDeps>, now: () => Date = () => new Date()) {
  const router = Router()
  const resolved: PersonOrganizationStructureDeps = {
    analytics: deps?.analytics ?? new PgAnalyticsReadRepository(db),
    hierarchy: deps?.hierarchy ?? postgresHierarchyReader(db),
    corporateEmails: deps?.corporateEmails ?? (async (personIds) => loadCorporateEmails(db, personIds)),
    structureFreshness: deps?.structureFreshness ?? (async (organizationId) => resolveOrganizationalStructureFreshness(db, organizationId, now(), await resolveOrganizationTimezone(db, organizationId))),
    managementMetrics: deps?.managementMetrics ?? ((organizationId, roots, at) => loadManagementMetrics(db, organizationId, roots, at)),
    now,
  }

  router.get("/:personId/organization-structure", async (request, response, next) => {
    try {
      const { personId } = paramsSchema.parse(request.params)
      response.json({ data: await buildPersonOrganizationStructure(resolved, request.user!, personId) })
    } catch (error) {
      next(error)
    }
  })

  return router
}
