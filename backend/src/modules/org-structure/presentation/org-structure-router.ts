import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { canManageScope, coversOrganization, getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

const subjectSchema = z.object({ name: z.string().trim().min(2), description: z.string().trim().optional() })
const subteamSchema = z.object({ name: z.string().trim().min(2) })

async function fetchTeamsWithSubteams(db: Database, organizationId: string) {
  const teams = await db.query<{ id: string; name: string; operationId: string }>(
    `select id, name, operation_id "operationId" from teams where organization_id = $1 order by name`,
    [organizationId],
  )
  const subteams = await db.query<{ id: string; teamId: string; name: string }>(
    `select id, team_id "teamId", name from subteams where organization_id = $1 order by name`,
    [organizationId],
  )
  return teams.rows.map((team) => ({
    ...team,
    subteams: subteams.rows.filter((subteam) => subteam.teamId === team.id),
  }))
}

export function createOrgStructureRouter(db: Database) {
  const router = Router()

  router.get("/teams", async (request, response) => {
    const data = await fetchTeamsWithSubteams(db, request.user!.organizationId)
    response.json({ data })
  })

  // Times/subgrupos que O ADMIN ATUAL pode administrar — nunca a org inteira pra quem é
  // restrito (Parte 3/10 do pedido). Usado só pelos seletores de Alcance de Workflow/Agent/
  // Orchestrator; as demais telas (Usuários, Conhecimento etc.) continuam usando /teams sem
  // filtro, que segue correto pra elas. `unrestricted` diz ao frontend se deve oferecer a opção
  // "Todos os grupos" — reaproveita getManageableScopes, nunca uma segunda lógica de permissão.
  router.get("/teams/manageable", async (request, response) => {
    const allTeams = await fetchTeamsWithSubteams(db, request.user!.organizationId)
    const scopes = await getManageableScopes(db, request.user!, "configuration.manage")
    if (scopes.unrestricted || scopes.allTeams) {
      return response.json({ data: { teams: allTeams, unrestricted: true } })
    }
    const teams = allTeams
      .filter((team) => scopes.teamIds.has(team.id) || team.subteams.some((subteam) => scopes.subteamIds.has(subteam.id)))
      .map((team) => ({
        ...team,
        subteams: scopes.teamIds.has(team.id) ? team.subteams : team.subteams.filter((subteam) => scopes.subteamIds.has(subteam.id)),
      }))
    response.json({ data: { teams, unrestricted: false } })
  })

  // Subgrupo novo só dentro de um Grupo do escopo de quem cria, e o Grupo precisa ser desta organização (achado U-F8).
  router.post("/teams/:teamId/subteams", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = subteamSchema.parse(request.body)
    const teamId = z.string().uuid().safeParse(request.params.teamId)
    const team = teamId.success ? await db.query(`select id from teams where id = $1 and organization_id = $2`, [teamId.data, organizationId]) : null
    if (!team?.rows[0]) return response.status(404).json({ error: { code: "TEAM_NOT_FOUND", message: "Grupo não encontrado." } })
    if (!canManageScope(await getManageableScopes(db, request.user!, "configuration.manage"), { scopeType: "TEAM", teamId: teamId.data!, subteamId: null })) {
      throw new DomainError("Você só pode criar Subgrupos nos Grupos do seu escopo.", "FORBIDDEN", 403)
    }
    const result = await db.query(
      `insert into subteams(organization_id, team_id, name) values ($1,$2,$3) returning id, team_id "teamId", name`,
      [organizationId, request.params.teamId, input.name],
    ).catch(duplicateAs("Esse Grupo já tem um Subgrupo com esse nome.", "SUBTEAM_NAME_TAKEN"))
    response.status(201).json({ data: result.rows[0] })
  })

  router.get("/subjects", async (request, response) => {
    const result = await db.query(
      `select id, name, description, active from subjects where organization_id = $1 order by name`,
      [request.user!.organizationId],
    )
    response.json({ data: result.rows })
  })

  // Catálogo de assuntos vale para a organização inteira.
  router.post("/subjects", async (request, response) => {
    const organizationId = request.user!.organizationId
    const input = subjectSchema.parse(request.body)
    if (!coversOrganization(await getManageableScopes(db, request.user!, "configuration.manage"))) {
      throw new DomainError("O catálogo de assuntos vale para a organização inteira: só quem a administra toda pode alterá-lo.", "ORGANIZATION_SCOPE_REQUIRED", 403)
    }
    const result = await db.query(
      `insert into subjects(organization_id, name, description) values ($1,$2,$3) returning id, name, description, active`,
      [organizationId, input.name, input.description ?? null],
    ).catch(duplicateAs("Já existe um assunto com esse nome.", "SUBJECT_NAME_TAKEN"))
    response.status(201).json({ data: result.rows[0] })
  })

  return router
}

/** Nome repetido (restrição única do banco) é erro de quem cadastra — 409 com a mensagem certa, nunca 500 (ZAP, AppSec 29/10). */
function duplicateAs(message: string, code: string) {
  return (error: unknown): never => {
    if ((error as { code?: string }).code === "23505") throw new DomainError(message, code, 409)
    throw error
  }
}
