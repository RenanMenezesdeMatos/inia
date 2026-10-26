/**
 * WORKFLOW MANUAL "TESTE BP · Feedback de TMA pela medição (manual)" (22/10/2026, pedido do usuário) — para o cenário `tma-reparo.ts`.
 *
 * O "Feedback de indicador · TMA (execução manual)" que já existe investiga o FECHAMENTO OFICIAL (setembro); este investiga uma MEDIÇÃO
 * (Executar agora → escolher a medição diária → janela de 7 dias até ela × os 28 dias antes). Mesmo grafo do de fechamento (o mesmo
 * Agent de diagnóstico de TMA → Gerar feedback de indicador → Acompanhamento do colaborador), sem a fonte de fechamento no nó do Agent.
 * Abrangência: só o Subgrupo da Larissa. Criado e publicado pelas MESMAS validações da tela (trigger, grafo, publicação), sem
 * HTTP. Nada dispara sozinho: só "Executar agora".
 *
 *   npx tsx scripts/dev/larissa-scenario/boas-praticas/tma-reparo-workflow.ts            # ensaio
 *   npx tsx scripts/dev/larissa-scenario/boas-praticas/tma-reparo-workflow.ts --apply
 *   npx tsx scripts/dev/larissa-scenario/boas-praticas/tma-reparo-workflow.ts --reset    # apaga o Workflow (só se não tiver execução)
 */
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { normalizeManualTrigger, validateManualTrigger } from "../../../../src/modules/workflows/application/validate-workflow-for-publish.js"
import { publishWorkflow } from "../../../../src/modules/workflows/application/publish-workflow.js"
import { triggerConfigSchema } from "../../../../src/modules/workflows/domain/trigger-config-schema.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const ACTOR = "9d1ab2fb-8001-49ac-a250-abf63b37578b" // a conta do usuário (pedido dele)
const TEAM = "de006e47-4ec0-4b54-8a7e-8bd28f7cc6e0"
const SUBTEAM = "de003187-930c-4686-88af-7a9a2e802a4e" // Diagnóstico IA — Operadores com gravações (Larissa)
const SOURCE_WORKFLOW = "070161c4-b1bd-428e-b033-d84147e8780b" // Feedback de indicador · TMA (execução manual)
const NAME = "TESTE BP · Feedback de TMA pela medição (manual)"
const apply = process.argv.includes("--apply")
const reset = process.argv.includes("--reset")

type Node = { id: string; type: string; config?: Record<string, unknown> }
try {
  const existing = (await pool.query<{ id: string; active_version_id: string | null }>(`select id, active_version_id from workflows where organization_id = $1 and name = $2`, [ORG, NAME])).rows[0] ?? null
  if (reset) {
    if (!existing) console.log("Nada a remover.")
    else {
      const runs = Number((await pool.query<{ n: string }>(`select count(*) n from workflow_enrollments where workflow_id = $1`, [existing.id])).rows[0]!.n)
      if (runs > 0) throw new Error(`Recusado: o Workflow tem ${runs} execução(ões) — o histórico fica.`)
      await pool.query(`delete from workflows where id = $1 and organization_id = $2`, [existing.id, ORG])
      console.log(`Removido: ${existing.id}`)
    }
  } else if (existing?.active_version_id) {
    console.log(`Já existe e está publicado: ${existing.id}`)
  } else {
    const source = (await pool.query<{ graph: { nodes: Node[]; edges: unknown[] } }>(`select v.graph from workflows w join workflow_versions v on v.id = w.active_version_id where w.id = $1 and w.organization_id = $2`, [SOURCE_WORKFLOW, ORG])).rows[0]
    if (!source) throw new Error("Workflow de origem (TMA por fechamento) não encontrado")
    // Mesmo grafo; o nó do Agent deixa de ler o fechamento oficial (a medição chega pelo gatilho).
    const graph = { ...source.graph, nodes: source.graph.nodes.map((node) => (node.config && "scheduledDataSource" in node.config ? { ...node, config: Object.fromEntries(Object.entries(node.config).filter(([key]) => key !== "scheduledDataSource")) } : node)) }
    const trigger = normalizeManualTrigger(triggerConfigSchema.parse({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" }))
    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", name: NAME, trigger, scope: { scopeType: "SUBTEAM", teamId: TEAM, subteamId: SUBTEAM }, nodes: graph.nodes.map((node) => `${node.type}:${String(node.config?.actionType ?? node.config?.outputContract ?? "")}`) }, null, 1))
    if (apply) {
      if (trigger.kind === "manual") validateManualTrigger(trigger)
      const id = existing?.id ?? (await pool.query<{ id: string }>(
        `insert into workflows(organization_id, name, description, scope_type, team_id, subteam_id, trigger_config, draft_graph, created_by, draft_scope_type, draft_team_id, draft_subteam_id, draft_trigger_config)
         values ($1, $2, $3, 'SUBTEAM', $4, $5, $6, $7, $8, 'SUBTEAM', $4, $5, $6) returning id`,
        [ORG, NAME, "Teste da base de boas práticas: Executar agora numa medição diária de TMA da Larissa.", TEAM, SUBTEAM, JSON.stringify(trigger), JSON.stringify(graph), ACTOR],
      )).rows[0]!.id
      await pool.query(`update workflows set draft_graph = $1, updated_at = now() where id = $2 and organization_id = $3`, [JSON.stringify(graph), id, ORG])
      // Gatilho manual não pede confirmação de impacto (nada dispara sozinho); `publishWorkflow` recusaria se pedisse.
      const published = await publishWorkflow(pool, { organizationId: ORG, workflowId: id, actorPersonId: ACTOR, confirmation: null, canManageScope: () => true })
      console.log(`Publicado: ${id} (${published ? "ok" : "não encontrado"})`)
    }
  }
} finally {
  await pool.end()
}
