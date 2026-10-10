import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { getManageableScopes } from "../../auth/application/manageable-scopes.js"
import { resolveOfficialClosure } from "../application/official-closure.js"


/**
 * Somente leitura — o dado de performance (atingimento/peso/PRV/quartil) vem sempre de uma
 * fonte externa (ver employee-performance-schema.ts), nunca é editado pelo admin. Existe só pra
 * permitir inspeção manual dos dados de teste (Parte 24 do pedido); a inspeção detalhada
 * continua via SQL direto, mesmo padrão já usado no restante desta base.
 */
export function createEmployeePerformanceRouter(db: Database) {
  const router = Router()

  router.get("/", async (request, response) => {
    const organizationId = request.user!.organizationId
    const personIdInput = typeof request.query.personId === "string" ? request.query.personId : undefined
    if (personIdInput !== undefined && !z.string().uuid().safeParse(personIdInput).success) return response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Colaborador inválido." } })
    const personId = personIdInput
    // Atingimento, peso, PRV (remuneração variável) e quartil são dado sensível: só das pessoas do escopo de quem consulta
    // (achado A-F03) — administrador de Grupo/Subgrupo não lê a organização inteira.
    const scopes = await getManageableScopes(db, request.user!, "configuration.manage")
    const organizationWide = scopes.unrestricted || scopes.allTeams
    const teamIds = scopes.unrestricted ? [] : [...scopes.teamIds]
    const subteamIds = scopes.unrestricted ? [] : [...scopes.subteamIds]
    // Guard central: só competências fechadas no fuso da organização (official-closure-policy.ts).
    const closure = await resolveOfficialClosure(db, organizationId, new Date())

    const indicatorRows = await db.query(
      `select eip.id, p.name "personName", eip.person_id "personId", idef.code "indicatorCode", idef.name "indicatorName",
              st.name "subteamName", eip.reference_period "referencePeriod", eip.value, eip.target_value "targetValue",
              eip.achievement_percent "achievementPercent", eip.weight_percent "weightPercent", eip.quartile, eip.source
       from employee_indicator_performance eip
       join people p on p.id = eip.person_id
       join indicator_definitions idef on idef.id = eip.indicator_definition_id
       left join subteams st on st.id = eip.subteam_id
       where eip.organization_id = $1 and ($2::uuid is null or eip.person_id = $2) and eip.reference_period <= $3
         and ($4::boolean or p.team_id = any($5::uuid[]) or p.subteam_id = any($6::uuid[]))
       order by p.name, idef.name, eip.reference_period desc`,
      [organizationId, personId ?? null, closure.lastClosedPeriod, organizationWide, teamIds, subteamIds],
    )

    const prvRows = await db.query(
      `select epp.id, p.name "personName", epp.person_id "personId", st.name "subteamName",
              epp.reference_period "referencePeriod", epp.achievement_percent "achievementPercent", epp.quartile, epp.source
       from employee_prv_performance epp
       join people p on p.id = epp.person_id
       left join subteams st on st.id = epp.subteam_id
       where epp.organization_id = $1 and ($2::uuid is null or epp.person_id = $2) and epp.reference_period <= $3
         and ($4::boolean or p.team_id = any($5::uuid[]) or p.subteam_id = any($6::uuid[]))
       order by p.name, epp.reference_period desc`,
      [organizationId, personId ?? null, closure.lastClosedPeriod, organizationWide, teamIds, subteamIds],
    )

    response.json({ data: { indicators: indicatorRows.rows, prv: prvRows.rows, lastClosedPeriod: closure.lastClosedPeriod } })
  })

  return router
}
