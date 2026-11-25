import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { canAnywhere } from "../../access/domain/access-decision.js"
import type { Permission } from "../../access/domain/permissions.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { sessionUser } from "../../auth/presentation/session-user.js"
import { OPERATING_UNIVERSES } from "../../operating-universe/domain/operating-universe.js"
import { listScopeUnitOptions } from "../application/scope-unit-options.js"
import { decodeOptionsCursor, encodeOptionsCursor, idListParam } from "./options-query.js"

/**
 * Permissões de quem edita o alcance nos cadastros (o seletor pede a da tela; a lista vem restrita ao escopo dela). Lista fechada:
 * o parâmetro nunca vira uma permissão qualquer.
 */
export const SCOPE_PICKER_PERMISSIONS = [
  "configuration.manage",
  "agents.manage",
  "workflows.manage",
  "knowledge.manage",
  "operational_alignments.manage",
  "communications.publish_organization",
  "communications.publish_team",
  // Filtros e campos de Grupo/Subgrupo de outras telas (24/11/2026): mesma rota, escopo da permissão da própria tela.
  "people.manage",
  "access.users.view",
  "access.roles.assign",
  "intervention_policies.edit",
  "human_support.manage",
] as const satisfies readonly Permission[]

const uuid = z.string().uuid()

const listQuerySchema = z.object({
  kind: z.enum(["TEAM", "SUBTEAM"]),
  permission: z.enum(SCOPE_PICKER_PERMISSIONS),
  search: z.string().trim().max(100).optional(),
  universes: z.string().optional().transform((raw, context) => {
    if (!raw) return undefined
    const values = raw.split(",").map((value) => value.trim()).filter(Boolean)
    for (const value of values) if (!(OPERATING_UNIVERSES as readonly string[]).includes(value)) { context.addIssue({ code: "custom", message: "Universo inválido." }); return z.NEVER }
    return values as (typeof OPERATING_UNIVERSES)[number][]
  }),
  teamId: uuid.optional(),
  /** Só estes Grupos e os Subgrupos deles (ex.: os Grupos do agente). Até 40: cabe na URL padrão do IIS. */
  withinTeamIds: z.string().optional().transform((raw, context) => {
    if (raw === undefined) return undefined
    const values = raw.split(",").map((value) => value.trim()).filter(Boolean)
    if (values.length === 0 || values.length > 40 || values.some((value) => !uuid.safeParse(value).success)) { context.addIssue({ code: "custom", message: "Lista de Grupos inválida." }); return z.NEVER }
    return values
  }),
  /** "all" só para filtros/relatórios que precisam ver também os sem operador em produção; o padrão é a regra das novas escolhas. */
  eligibility: z.enum(["production", "all"]).optional(),
  /**
   * "filter": filtro de lista (o Grupo-pai de um Subgrupo do escopo ou do universo também aparece, com ou sem gente em produção);
   * "reach" (padrão): alcance ou alvo de um cadastro, só o que a conta administra inteiro.
   */
  purpose: z.enum(["reach", "filter"]).default("reach"),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  // Até 300: o mesmo teto dos vínculos de um conteúdo (`scopeLinksInputSchema`), para a edição resolver todos os já escolhidos (run-10 QA-06).
  ids: idListParam,
})

/**
 * `GET /api/v1/admin/scope-units` — Grupos ou Subgrupos para os seletores de alcance, com busca (sem maiúsculas nem acentos, pelo nome e,
 * no Subgrupo, também pelo Grupo-pai), universo, Grupo-pai, permissão de quem edita e elegibilidade (operador em produção) aplicados no
 * servidor ANTES da paginação por cursor. `ids=` resolve escolhas já salvas (marcadas `eligible: false` quando perderam a elegibilidade).
 */
export function createScopeUnitOptionsRouter(db: Database) {
  const router = Router()
  const accessRepository = createPostgresAccessRepository(db)
  router.get("/", async (request, response) => {
    const query = listQuerySchema.parse(request.query)
    const user = sessionUser(request)
    const access = await accessRepository.loadContext(user.organizationId, user.sub)
    if (!canAnywhere(access, query.permission)) throw new DomainError("Você não tem permissão para esta ação.", "FORBIDDEN", 403)
    const scopes = await getManageableScopes(db, user, query.permission)
    const page = await listScopeUnitOptions(db, {
      organizationId: user.organizationId,
      kind: query.kind,
      search: query.search,
      universes: query.universes,
      teamId: query.teamId,
      withinTeamIds: query.withinTeamIds,
      eligibleOnly: (query.eligibility ?? (query.purpose === "filter" ? "all" : "production")) === "production",
      includeParentTeams: query.purpose === "filter",
      scopes,
      cursor: decodeOptionsCursor(query.cursor),
      limit: query.limit,
      ids: query.ids,
    })
    response.json({ data: { items: page.items, nextCursor: page.nextCursor ? encodeOptionsCursor(page.nextCursor) : null } })
  })
  return router
}
