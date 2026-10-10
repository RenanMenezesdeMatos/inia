/**
 * Indicator Diagnosis V1.0.1 — exporta os insumos REAIS do smoke do diagnóstico do fechamento (resposta do Agent, saída do nó de
 * origem com os trechos apresentados, transcrições/contexto das chamadas da amostra e as versões publicadas da base) para uma
 * fixture JSON congelada — o replay offline (sem modelo, sem banco) que prova a auditoria de inconsistência e o reparo.
 *   npx tsx scripts/dev/export-prv-smoke-fixture.ts <enrollmentId> <agentRunId> <outFile>
 */
import { writeFileSync } from "node:fs"
import { pool } from "../../src/infrastructure/database/pool.js"
import { createPostgresMonitoringContextLoader, createPostgresPublishedKnowledgeLoader } from "../../src/modules/reliable-feedback/infrastructure/postgres-feedback-context-loaders.js"

const [enrollmentId, agentRunId, outFile] = process.argv.slice(2)
const enrollment = (await pool.query<{ organization_id: string; node_outputs: Record<string, { sample: { handle: string; interactionId: string }[]; personId: string; assessment: { knowledgeExcerpts: { documentId: string }[] } }> }>("select organization_id, node_outputs from workflow_enrollments where id = $1", [enrollmentId])).rows[0]!
const source = enrollment.node_outputs.agent!
const raw = (await pool.query<{ output_text: string }>("select output_text from agent_runs where id = $1", [agentRunId])).rows[0]!.output_text
const loadContext = createPostgresMonitoringContextLoader(pool)
const contexts = await Promise.all(source.sample.map(async (entry) => ({ ...entry, context: await loadContext(enrollment.organization_id, entry.interactionId, source.personId) })))
const documentIds = [...new Set(source.assessment.knowledgeExcerpts.map((excerpt) => excerpt.documentId))]
const published = [...(await createPostgresPublishedKnowledgeLoader(pool)(enrollment.organization_id, documentIds)).values()]
writeFileSync(outFile!, `${JSON.stringify({ organizationId: enrollment.organization_id, personId: source.personId, agentRawOutput: raw, sourceNodeOutput: source, contexts, published }, null, 1)}\n`)
console.log(`fixture: ${source.sample.length} chamadas, ${published.length} documento(s)`)
await pool.end()
