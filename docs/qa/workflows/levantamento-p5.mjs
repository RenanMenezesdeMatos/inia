// Levantamento para a P5 (propostas.md, "Verificação anterior à implantação"): só leitura, sem dados pessoais. A conexão abre em modo somente
// leitura, e o endereço do banco nunca é impresso.
//
// Na raiz do projeto, lendo o banco de backend/.env (Node 20 ou mais novo):
//   node --env-file=backend/.env docs/qa/workflows/levantamento-p5.mjs
//
// Fora do repositório (colado na máquina virtual, por exemplo), diga onde está o backend, para achar o pacote `pg`:
//   INIA_BACKEND_DIR=C:\inia\backend node --env-file=C:\inia\backend\.env levantamento-p5.mjs
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

const MAX_ITEMS = 8
const client = new pg.Client({ connectionString, options: "-c default_transaction_read_only=on" })

const query = async (sql) => (await client.query(sql)).rows
const short = (text) => (typeof text === "string" && text.length > 40 ? `${text.slice(0, 39)}…` : text)
const nodeIdOfPath = (value) => (typeof value === "string" && value.startsWith("nodeOutputs.") ? value.slice("nodeOutputs.".length).split(".")[0] || null : null)

/** Campos que guardam um caminho de conteúdo. Mesmos de `findNodeDependents` (frontend) e das regras de publicação. */
function pathsOf(node) {
  const config = node.config ?? {}
  const paths = []
  if (node.type === "output") paths.push(["source", config.source])
  if (node.type === "condition") {
    paths.push(["sourcePath", config.sourcePath])
    for (const rule of config.group?.rules ?? []) paths.push(["group.sourcePath", rule.sourcePath])
  }
  if (node.type === "human_review") paths.push(["contentSource", config.contentSource])
  if (node.type === "action" && config.actionType === "ESCALATE") paths.push(["contentSource", config.contentSource])
  if (node.type === "action" && config.actionType === "SET_VARIABLE") paths.push(["sourcePath", config.sourcePath])
  return paths.filter(([, value]) => typeof value === "string" && value)
}

function directReferencesOf(node) {
  const config = node.config ?? {}
  const references = []
  if (config.sourceNodeId) references.push(["sourceNodeId", config.sourceNodeId])
  for (const nodeId of config.analysisSourceNodeIds ?? []) if (nodeId) references.push(["analysisSourceNodeIds", nodeId])
  const previous = (config.reviewTarget ?? config.target)?.previousReviewNodeId
  if (previous) references.push(["previousReviewNodeId", previous])
  return references
}

function ancestorsOf(graph, nodeId) {
  const seen = new Set()
  const stack = [nodeId]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const edge of graph.edges ?? []) {
      if (edge.target === current && !seen.has(edge.source)) {
        seen.add(edge.source)
        stack.push(edge.source)
      }
    }
  }
  return seen
}

/** Origem em variável em Output, Revisão e Escalonar: antes da P5b o motor não lia o valor (WF-41), e esses fluxos passam a entregá-lo. */
const readsVariableAtRuntimeBug = (node) => node.type === "output" || node.type === "human_review" || (node.type === "action" && node.config?.actionType === "ESCALATE")

function scan(rows) {
  const found = { grafos: rows.length, referencias: 0, ausentes: 0, foraDoCaminho: 0, origemEmVariavel: 0, itens: [] }
  for (const row of rows) {
    const graph = row.graph
    if (!graph?.nodes) continue
    const ids = new Set(graph.nodes.map((node) => node.id))
    for (const node of graph.nodes) {
      const ancestors = ancestorsOf(graph, node.id)
      const note = (kind, field) => found.itens.push({ tipo: kind, workflow: short(row.name), ligado: row.active, etapa: short(node.label), campo: field, emAndamento: row.running ?? 0 })
      const check = (field, nodeId) => {
        found.referencias += 1
        if (!ids.has(nodeId)) {
          found.ausentes += 1
          note("ausente", field)
        } else if (!ancestors.has(nodeId)) {
          found.foraDoCaminho += 1
          note("fora do caminho", field)
        }
      }
      for (const [field, value] of pathsOf(node)) {
        const nodeId = nodeIdOfPath(value)
        if (nodeId) check(field, nodeId)
        if (value.startsWith("variables.") && readsVariableAtRuntimeBug(node)) {
          found.origemEmVariavel += 1
          note("variável", field)
        }
      }
      for (const [field, nodeId] of directReferencesOf(node)) check(field, nodeId)
    }
  }
  found.itens = found.itens.slice(0, MAX_ITEMS)
  return found
}

await client.connect()
try {
  await client.query("begin read only")

  const versions = await query(`
    select w.name, w.active, w.active_version_id = v.id live, v.graph,
           (select count(*)::int from workflow_enrollments e where e.version_id = v.id and e.status in ('active', 'waiting')) running
    from workflow_versions v join workflows w on w.id = v.workflow_id`)
  const drafts = await query(`select w.name, w.active, w.draft_graph graph from workflows w`)

  const [totals] = await query(`
    select (select count(*)::int from workflows) workflows,
           (select count(*)::int from workflows where active_version_id is not null) publicados,
           (select count(*)::int from workflows where active_version_id is not null and active) ligados,
           (select count(*)::int from workflow_enrollments) execucoes,
           (select count(*)::int from workflow_enrollments where status = 'blocked') bloqueadas`)

  const [latestMigration] = await query(`select max(name) migracao from schema_migrations`)

  const waitingReviews = await query(`
    with waiting as (
      select e.id, e.workflow_id, e.current_node_id, node->'config'->'reviewTarget'->>'type' alvo
      from workflow_enrollments e
      join workflow_versions v on v.id = e.version_id, jsonb_array_elements(v.graph->'nodes') node
      where e.status = 'waiting' and node->>'id' = e.current_node_id and node->>'type' = 'human_review'
    )
    select w.name workflow, w.active ligado, waiting.alvo, count(*)::int execucoes,
           count(*) filter (where not exists (
             select 1 from alerts a
             where a.dedupe_key = 'workflow_human_review:' || waiting.id || ':' || waiting.current_node_id
               and a.status in ('OPEN', 'SEEN', 'ACKNOWLEDGED')
           ))::int sem_aviso_vivo
    from waiting join workflows w on w.id = waiting.workflow_id
    group by 1, 2, 3 order by 5 desc, 4 desc`)

  const liveReviews = await query(`
    select node->'config'->'reviewTarget'->>'type' alvo, node->'config'->'reviewTarget'->>'role' cargo, count(*)::int etapas,
           count(*) filter (where w.active)::int em_ligados
    from workflows w join workflow_versions v on v.id = w.active_version_id, jsonb_array_elements(v.graph->'nodes') node
    where node->>'type' = 'human_review'
    group by 1, 2 order by 3 desc`)

  const exposure = await query(`
    with recursive chain as (
      select p.id operator_id, p.reports_to_id current_id, array[p.id] seen
      from people p where p.active and p.role = 'OPERATOR'
      union all
      select c.operator_id, m.reports_to_id, c.seen || m.id
      from chain c join people m on m.id = c.current_id
      where not m.id = any(c.seen)
    ),
    managers as (select c.operator_id, m.role, m.active from chain c join people m on m.id = c.current_id),
    roles as (select distinct role from people where role not in ('OPERATOR', 'ADMIN'))
    select r.role cargo,
           (select count(*)::int from people p where p.active and p.role = 'OPERATOR'
             and not exists (select 1 from managers m where m.operator_id = p.id and m.role = r.role)) sem_na_cadeia,
           (select count(distinct m.operator_id)::int from managers m where m.role = r.role and not m.active) com_inativo_na_cadeia
    from roles r order by 1`)
  const [operators] = await query(`select count(*)::int operadores_ativos from people where active and role = 'OPERATOR'`)

  const publishers = await query(`
    select case when v.created_by is null then 'sem autor' when p.active then 'autor ativo' else 'autor inativo' end situacao, count(*)::int versoes
    from workflows w join workflow_versions v on v.id = w.active_version_id left join people p on p.id = v.created_by
    group by 1 order by 1`)

  await client.query("rollback")

  console.log(JSON.stringify({
    quando: new Date().toISOString(),
    banco: { ...totals, ...latestMigration },
    p5b: {
      noAr: scan(versions.filter((row) => row.live)),
      antigas: scan(versions.filter((row) => !row.live)),
      rascunhos: scan(drafts),
    },
    p5c: {
      esperandoRevisao: waitingReviews.slice(0, MAX_ITEMS).map((row) => ({ ...row, workflow: short(row.workflow) })),
      revisoesNoAr: liveReviews,
      ...operators,
      exposicaoPorCargo: exposure,
      autorDasVersoesNoAr: publishers,
    },
  }))
} finally {
  await client.end()
}
