/**
 * VARREDURA (somente leitura): versões de Workflow que ainda podem rodar com uma etapa de Orquestrador cuja versão fixada é de
 * alcance incompatível com o do Workflow. A publicação recusa isso desde afb29bec (`WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN`)
 * e a execução falha a etapa com o mesmo código; versões publicadas antes continuam lá até alguém publicar de novo.
 *
 * "Pode rodar" = a versão vigente de um Workflow não excluído (ligado ou pausado) ou uma versão com execução ainda por terminar
 * (`active`, `waiting`, `blocked`). A versão consultada é a mesma da execução (`resolve-orchestrator.ts › loadOrchestratorVersion`):
 * a fixada na etapa ou, sem ela, a de origem da migração. A regra é a MESMA `scopesAreCompatible` da publicação e da execução,
 * contra o alcance atual do Workflow (o que o motor usa). Roda numa transação READ ONLY e termina com ROLLBACK.
 *
 *   npx tsx scripts/dev/orchestrator-version-scope-sweep.ts [organizationId]
 */
import { pool, type Database } from "../../src/infrastructure/database/pool.js"
import { scopesAreCompatible } from "../../src/modules/auth/application/manageable-scopes.js"

type Row = {
  organizationId: string
  workflowId: string
  workflowName: string
  workflowActive: boolean
  scopeType: string
  teamId: string | null
  subteamId: string | null
  workflowVersionId: string
  currentVersion: boolean
  runningEnrollments: number
  nodeId: string
  nodeLabel: string
  orchestratorId: string
  orchestratorName: string | null
  pinnedVersionId: string | null
  versionId: string | null
  versionNumber: number | null
  versionScopeType: string | null
  versionTeamId: string | null
  versionSubteamId: string | null
}

const SQL = `
  with runnable as (
    select v.id, v.workflow_id, v.graph, (w.active_version_id = v.id) "currentVersion",
           (select count(*)::int from workflow_enrollments e where e.version_id = v.id and e.status in ('active', 'waiting', 'blocked')) "runningEnrollments"
      from workflow_versions v
      join workflows w on w.id = v.workflow_id
     where ($1::uuid is null or w.organization_id = $1)
  )
  select w.organization_id "organizationId", w.id "workflowId", w.name "workflowName", w.active "workflowActive",
         w.scope_type "scopeType", w.team_id "teamId", w.subteam_id "subteamId",
         r.id "workflowVersionId", r."currentVersion", r."runningEnrollments",
         n.node->>'id' "nodeId", n.node->>'label' "nodeLabel", n.node->'config'->>'orchestratorId' "orchestratorId", o.name "orchestratorName",
         n.node->'config'->>'orchestratorVersionId' "pinnedVersionId",
         ov.id "versionId", ov.version_number "versionNumber",
         ov.config->>'scopeType' "versionScopeType", ov.config->>'teamId' "versionTeamId", ov.config->>'subteamId' "versionSubteamId"
    from runnable r
    join workflows w on w.id = r.workflow_id
    cross join lateral jsonb_array_elements(r.graph->'nodes') n(node)
    left join assistant_orchestrators_all o on o.id::text = n.node->'config'->>'orchestratorId'
    left join lateral (
      select av.id, av.version_number, av.config
        from assistant_orchestrator_versions av
       where av.orchestrator_id::text = n.node->'config'->>'orchestratorId'
         and (n.node->'config'->>'orchestratorVersionId' is null or av.id::text = n.node->'config'->>'orchestratorVersionId')
       order by (av.origin = 'MIGRATION') desc, av.version_number asc
       limit 1
    ) ov on true
   where n.node->>'type' = 'orchestrator' and (r."currentVersion" or r."runningEnrollments" > 0)
   order by w.name, r."currentVersion" desc, n.node->>'label'`

const organizationId = process.argv[2] ?? null
const client = await pool.connect()
try {
  await client.query("begin read only")
  const db = client as unknown as Database
  const rows = (await client.query<Row>(SQL, [organizationId])).rows
  const incompatible: (Row & { pin: "FIXADA" | "MIGRACAO" })[] = []
  let withoutVersion = 0
  let withoutScope = 0
  for (const row of rows) {
    if (!row.versionId) {
      withoutVersion += 1
      continue
    }
    if (!row.versionScopeType) {
      withoutScope += 1
      continue
    }
    const compatible = await scopesAreCompatible(db, { scopeType: row.scopeType, teamId: row.teamId, subteamId: row.subteamId }, { scopeType: row.versionScopeType, teamId: row.versionTeamId, subteamId: row.versionSubteamId })
    if (!compatible) incompatible.push({ ...row, pin: row.pinnedVersionId ? "FIXADA" : "MIGRACAO" })
  }
  console.log(JSON.stringify({ etapasConferidas: rows.length, semVersao: withoutVersion, versaoSemAlcance: withoutScope, incompativeis: incompatible.length, itens: incompatible }, null, 2))
} finally {
  await client.query("rollback")
  client.release()
  await pool.end()
}
