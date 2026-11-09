// Levantamento antes de implantar a correção da Condição na execução individual (docs/dev/memoria/workflows.md): só leitura, sem dados
// pessoais. A conexão abre em modo somente leitura, e o endereço do banco nunca é impresso.
//
// Na raiz do projeto, lendo o banco de backend/.env (Node 20 ou mais novo):
//   node --env-file=backend/.env docs/qa/workflows/levantamento-condicao-individual.mjs
//
// Fora do repositório (colado na máquina virtual, por exemplo), diga onde está o backend, para achar o pacote `pg`:
//   INIA_BACKEND_DIR=C:\inia\backend node --env-file=C:\inia\backend\.env levantamento-condicao-individual.mjs
//
// A saída é curta de propósito: o "Executar comando" do portal do Azure só mostra os últimos 4 KB.

import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendDir = process.env.INIA_BACKEND_DIR ?? path.resolve(scriptDir, "../../../backend")
const pg = createRequire(path.join(backendDir, "package.json"))("pg")

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL não definida. Use --env-file apontando para o .env do backend.")
  process.exit(1)
}

const MAX_ITEMS = 12
const client = new pg.Client({ connectionString, options: "-c default_transaction_read_only=on" })
const short = (text) => (typeof text === "string" && text.length > 40 ? `${text.slice(0, 39)}…` : text)

/** Os nós entre "Aplicar individualmente" e "Consolidar resultados": mesma regra de `resolveNodeContexts`. */
function nodesOnIndividualPath(graph) {
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]))
  const trigger = (graph?.nodes ?? []).find((node) => node.type === "trigger")
  if (!trigger) return []
  const contextOf = new Map([[trigger.id, "STRUCTURE"]])
  const pending = [trigger.id]
  while (pending.length > 0) {
    const id = pending.shift()
    const type = nodes.get(id)?.type
    const next = type === "select_employees" ? "COLLECTION" : type === "apply_individually" ? "EMPLOYEE" : type === "consolidate_results" ? "CONSOLIDATED" : contextOf.get(id)
    for (const edge of graph.edges ?? []) {
      if (edge.source !== id || contextOf.has(edge.target)) continue
      contextOf.set(edge.target, next)
      pending.push(edge.target)
    }
  }
  return [...contextOf].filter(([, context]) => context === "EMPLOYEE").map(([id]) => nodes.get(id)).filter(Boolean)
}

/** O que muda ao implantar. Quem não aparece aqui já respondia pela pessoa. */
function effectOf(config) {
  const query = config.historicalQuery
  if (config.performanceQuery || !query) return null
  if (query.source === "OPERATIONAL_QUARTILE") return "quartil operacional: era sempre Sem dados, passa a responder"
  if (query.source === "PRV_ACHIEVEMENT") return "atingimento do PRV: era da estrutura, passa a ser da pessoa"
  if (query.source === "INDICATOR_ACHIEVEMENT") return "atingimento do indicador: era da estrutura, passa a ser da pessoa"
  return "valor do indicador: era da estrutura, passa a ser da pessoa"
}

await client.connect()
try {
  const versions = (await client.query(`
    select w.name, w.active, w.active_version_id = v.id live, v.graph,
           (select count(*)::int from workflow_enrollments e where e.version_id = v.id and e.parent_enrollment_id is not null and e.status in ('active', 'waiting')) running
    from workflow_versions v join workflows w on w.id = v.workflow_id`)).rows
  const drafts = (await client.query(`select w.name, w.active, w.draft_graph graph from workflows w where w.draft_graph is not null`)).rows

  const findings = (rows) => rows.flatMap((row) => nodesOnIndividualPath(row.graph).filter((node) => node.type === "condition").map((node) => ({ ...row, node, effect: effectOf(node.config ?? {}) })).filter((item) => item.effect))
  const live = findings(versions.filter((row) => row.live && row.active))
  const others = findings(versions.filter((row) => row.running > 0 && !(row.live && row.active)))
  const inDraft = findings(drafts)

  console.log(`Versões no ar com Condição afetada: ${live.length}`)
  for (const item of live.slice(0, MAX_ITEMS)) console.log(`- ${short(item.name)} / ${short(item.node.label)}: ${item.effect} (execuções individuais em andamento: ${item.running})`)
  console.log(`Versões antigas com execução em andamento afetada: ${others.length}`)
  for (const item of others.slice(0, MAX_ITEMS)) console.log(`- ${short(item.name)} / ${short(item.node.label)}: ${item.effect} (em andamento: ${item.running})`)
  console.log(`Rascunhos com Condição afetada, ao publicar: ${inDraft.length}`)
  for (const item of inDraft.slice(0, MAX_ITEMS)) console.log(`- ${short(item.name)} / ${short(item.node.label)}: ${item.effect}`)
  console.log(live.length + others.length === 0 ? "Conclusão: nada no ar muda de resultado." : "Conclusão: confira com quem opera estes Workflows antes de implantar.")
} finally {
  await client.end()
}
