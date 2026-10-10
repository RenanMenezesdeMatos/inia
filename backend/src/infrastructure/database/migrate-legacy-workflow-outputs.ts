/**
 * Script de execução única — roda depois do deploy que introduz o node Output (não faz parte
 * do pipeline `db:migrate` de schema): reescreve o draft e a versão publicada ativa de cada
 * workflow legado (sem nenhum node Output) para religar um Output(CURRENT_OPERATOR, FOLLOW_UP)
 * depois de cada CALL_AGENT terminal — ver `appendMissingOutputNodes` para a lógica pura e o
 * porquê. Sem isso, workflows já publicados parariam de publicar Feedback, já que CALL_AGENT
 * deixou de fazer isso sozinho.
 *
 * `workflow_versions` é imutável por design (enrollments em voo ficam presas à versão que
 * pegaram) — por isso este script nunca faz UPDATE numa versão publicada existente, sempre
 * insere uma versão nova e só então repõe `active_version_id`.
 */
import { flowGraphSchema } from "../../modules/workflows/domain/graph-schema.js"
import { appendMissingOutputNodes } from "../../modules/workflows/application/legacy-output-migration.js"
import { pool } from "./pool.js"

async function run(): Promise<void> {
  const client = await pool.connect()
  try {
    const workflows = await client.query<{ id: string; name: string; draft_graph: unknown; active_version_id: string | null }>(
      `select id, name, draft_graph, active_version_id from workflows`,
    )

    let draftsPatched = 0
    let versionsPatched = 0

    for (const workflow of workflows.rows) {
      await client.query("begin")
      try {
        const draftGraph = flowGraphSchema.parse(workflow.draft_graph)
        const draftResult = appendMissingOutputNodes(draftGraph)
        if (draftResult.changed) {
          await client.query(`update workflows set draft_graph = $1, updated_at = now() where id = $2`, [JSON.stringify(draftResult.graph), workflow.id])
          draftsPatched++
          process.stdout.write(`draft_graph patched: ${workflow.name} (${workflow.id})\n`)
        }

        if (workflow.active_version_id) {
          const versionRow = await client.query<{ graph: unknown }>(`select graph from workflow_versions where id = $1`, [workflow.active_version_id])
          const publishedGraph = flowGraphSchema.parse(versionRow.rows[0]?.graph)
          const versionResult = appendMissingOutputNodes(publishedGraph)
          if (versionResult.changed) {
            const inserted = await client.query<{ id: string }>(
              `insert into workflow_versions(workflow_id, graph, created_by) values ($1,$2,null) returning id`,
              [workflow.id, JSON.stringify(versionResult.graph)],
            )
            await client.query(`update workflows set active_version_id = $1, updated_at = now() where id = $2`, [inserted.rows[0]!.id, workflow.id])
            versionsPatched++
            process.stdout.write(`published version patched: ${workflow.name} (${workflow.id}) -> version ${inserted.rows[0]!.id}\n`)
          }
        }

        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        process.stderr.write(`failed to migrate workflow ${workflow.id} (${workflow.name}): ${error instanceof Error ? error.message : error}\n`)
      }
    }

    process.stdout.write(`done — ${draftsPatched} draft(s) e ${versionsPatched} versão(ões) publicada(s) atualizadas.\n`)
  } finally {
    client.release()
    await pool.end()
  }
}

await run()
