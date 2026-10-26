/**
 * CENÁRIO "PRODUTOS — SEGUNDA VIA E REPARO" DA LARISSA MONTEIRO (DEMO-OP-0001) — teste de ponta a ponta do cadastro de produtos (21/10/2026).
 *
 * Conteúdo FICTÍCIO (`conteudo.ts`): bases de conhecimento e argumentários de segunda via e reparo com "Vale para" geral, por categoria,
 * por produto e por vários produtos, e prazos que mudam por produto; a categoria "Soluciona TI" com o produto Vivo Soluciona TI; dois
 * agentes de teste (um por processo) ligados só a essas bases; dois Workflows MANUAIS ("Executar agora" numa chamada → Gerar feedback →
 * Acompanhamento da Larissa); e 15 chamadas da Larissa (`chamadas-*.ts`) que testam cada forma de o produto aparecer.
 *
 * Tudo nasce com "TESTE PRODUTOS ·" e alcance só no Subgrupo da Larissa ("Diagnóstico IA — Operadores com gravações"). A configuração
 * entra pela API (como a tela faria — mesmas validações e auditoria), com a conta demo de administrador; as chamadas entram direto no
 * banco com ids determinísticos (nenhuma passa pela ingestão: nenhum Workflow dispara sozinho). Nada roda IA: o feedback só acontece
 * quando alguém clicar "Executar agora" nos Workflows de teste.
 *
 * As chamadas precisam ser POSTERIORES à configuração (o motor lê o cadastro, as bases e os argumentários vigentes na hora da chamada, e
 * nada disso é retroativo): por isso são duas etapas — `--configurar` e, alguns minutos depois, `--chamadas` (que põe as chamadas logo
 * depois da última configuração e recusa se ainda não houver tempo para elas terem terminado).
 *
 *   npx tsx scripts/dev/larissa-scenario/produtos/cenario-produtos.ts               # ensaio: mostra o plano, nada gravado
 *   npx tsx scripts/dev/larissa-scenario/produtos/cenario-produtos.ts --configurar  # produto, bases, argumentários, agentes, Workflows
 *   npx tsx scripts/dev/larissa-scenario/produtos/cenario-produtos.ts --chamadas    # as 15 chamadas da Larissa
 *   npx tsx scripts/dev/larissa-scenario/produtos/cenario-produtos.ts --reset       # remove o que o cenário criou (o produto fica)
 *
 * Precisa da API em http://127.0.0.1:3333 (npm run dev) e de INIA_DEMO_PASSWORD no backend/.env.
 */
import { createHash } from "node:crypto"
import "../../../../src/config/env.js"
import { resolveDemoPassword } from "../../../../src/infrastructure/database/demo-mass/demo-constants.js"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { AGENTS, ARGUMENT_SCRIPTS, DOCUMENTS, PREFIX, SOLUCIONA_TI, WORKFLOWS } from "./conteudo.js"
import type { NodeCode, Process, ProductScenarioCall } from "./tipos.js"

const API = process.env.INIA_API_URL ?? "http://127.0.0.1:3333/api/v1"
const ADMIN_EMAIL = "gerente02.demo@inia.local"
const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const SUBJECT_NAME: Record<Process, string> = { SEGUNDA_VIA: "Segunda via", REPARO: "Reparo" }
/** As chamadas só carregam quando usadas (a configuração não depende delas). */
async function callsOf(): Promise<ProductScenarioCall[]> {
  const [{ CHAMADAS_SEGUNDA_VIA }, { CHAMADAS_REPARO }, { CHAMADAS_EXTRAS }] = await Promise.all([import("./chamadas-segunda-via.js"), import("./chamadas-reparo.js"), import("./chamadas-extras.js")])
  // As extras ficam no FIM: o horário de cada chamada sai da posição na fila, e as 15 primeiras não podem mudar.
  return [...CHAMADAS_SEGUNDA_VIA, ...CHAMADAS_REPARO, ...CHAMADAS_EXTRAS]
}
/** Intervalo entre o início de uma chamada e o da próxima (as chamadas ficam em fila logo depois da configuração). */
const CALL_SPACING_MS = 60_000

const idOf = (name: string) => {
  const hex = createHash("sha256").update(`inia-scenario-produtos:${name}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const transcriptOf = (lines: readonly string[], operator: string) => lines
  .map((line) => line.replace("{OPERADOR}", operator))
  .map((line) => (line.startsWith("O: ") ? `Operador: ${line.slice(3)}` : line.startsWith("C: ") ? `Cliente: ${line.slice(3)}` : line))
  .join("\n")

// ---------------------------------------------------------------------------------------------
// API (a mesma que a tela usa)
// ---------------------------------------------------------------------------------------------
let cookie = ""
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const response = await fetch(`${API}${path}`, { method, headers: { ...(isForm ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }) })
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length > 0) cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ")
  const json = (await response.json().catch(() => null)) as { data?: T; error?: unknown } | null
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json)}`)
  return (json?.data ?? json) as T
}
const login = () => call("POST", "/auth/login", { email: ADMIN_EMAIL, password: resolveDemoPassword(process.env.INIA_DEMO_PASSWORD) })

type Context = { org: string; teamId: string; subteamId: string; nodes: Map<string, string>; subjects: Map<string, string>; domains: Map<string, string> }

async function contextOf(): Promise<Context> {
  const person = (await pool.query<{ organization_id: string; team_id: string; subteam_id: string }>(`select organization_id, team_id, subteam_id from people where id = $1`, [LARISSA])).rows[0]!
  const nodes = new Map((await pool.query<{ code: string; id: string }>(`select code, id from product_catalog_nodes where organization_id = $1`, [person.organization_id])).rows.map((row) => [row.code, row.id]))
  const subjects = new Map((await pool.query<{ name: string; id: string }>(`select name, id from subjects where organization_id = $1`, [person.organization_id])).rows.map((row) => [row.name, row.id]))
  const domains = new Map((await pool.query<{ code: string; id: string }>(`select code, id from business_domains where organization_id = $1 and active`, [person.organization_id])).rows.map((row) => [row.code, row.id]))
  return { org: person.organization_id, teamId: person.team_id, subteamId: person.subteam_id, nodes, subjects, domains }
}
const scopeOf = (ctx: Context) => ({ scopeType: "SUBTEAM", teamId: ctx.teamId, subteamId: ctx.subteamId })
const nodeIdsOf = (ctx: Context, codes: readonly NodeCode[]) => codes.map((code) => {
  const id = ctx.nodes.get(code)
  if (!id) throw new Error(`Produto/categoria ${code} não cadastrado — rode --configurar (ele cria a Soluciona TI) ou cadastre pela tela.`)
  return id
})
const existing = async (table: "knowledge_documents" | "argument_scripts" | "agents" | "workflows", column: "title" | "name", value: string, org: string) => {
  const deleted = table === "knowledge_documents" ? " and deleted_at is null" : ""
  return (await pool.query<{ id: string }>(`select id from ${table} where organization_id = $1 and ${column} = $2${deleted} limit 1`, [org, value])).rows[0]?.id ?? null
}

// ---------------------------------------------------------------------------------------------
// --configurar
// ---------------------------------------------------------------------------------------------
async function configure(ctx: Context) {
  await login()
  // 1. Categoria "Soluciona TI" e o produto (um só, com os vários nomes em "Como chamam").
  if (!ctx.nodes.has(SOLUCIONA_TI.category.code)) {
    const category = await call<{ id: string }>("POST", "/admin/product-catalog/nodes", { kind: "FAMILY", parentId: null, ...SOLUCIONA_TI.category })
    ctx.nodes.set(SOLUCIONA_TI.category.code, category.id)
  }
  if (!ctx.nodes.has(SOLUCIONA_TI.product.code)) {
    const product = await call<{ id: string }>("POST", "/admin/product-catalog/nodes", { kind: "PRODUCT", parentId: ctx.nodes.get(SOLUCIONA_TI.category.code), ...SOLUCIONA_TI.product })
    ctx.nodes.set(SOLUCIONA_TI.product.code, product.id)
  }
  console.log(`Produto: ${SOLUCIONA_TI.product.name} (categoria ${SOLUCIONA_TI.category.name})`)

  // 2. Bases de conhecimento: publicadas, só no Subgrupo, no assunto do processo, com o "Vale para".
  const documentIds = new Map<string, string>()
  for (const document of DOCUMENTS) {
    let id = await existing("knowledge_documents", "title", document.title, ctx.org)
    if (!id) {
      const form = new FormData()
      form.set("title", document.title)
      form.set("documentType", "PROCEDURE")
      form.set("content", document.content)
      form.set("orgScopes", JSON.stringify([scopeOf(ctx)]))
      form.set("subjectScopes", JSON.stringify([{ scopeType: "SUBJECT", subjectId: ctx.subjects.get(SUBJECT_NAME[document.process]) }]))
      id = (await call<{ id: string }>("POST", "/admin/knowledge", form)).id
      await call("PATCH", `/admin/knowledge/${id}`, { status: "PUBLISHED" })
    }
    await call("PUT", `/admin/product-catalog/sources/KNOWLEDGE_DOCUMENT/${id}/scope`, { nodeIds: nodeIdsOf(ctx, document.products) })
    documentIds.set(document.key, id)
    console.log(`Base: ${document.title} → ${document.products.length === 0 ? "todos os produtos" : document.products.join(", ")}`)
  }

  // 3. Argumentários: publicados, só no Subgrupo, com o "Vale para".
  for (const script of ARGUMENT_SCRIPTS) {
    let id = await existing("argument_scripts", "name", script.name, ctx.org)
    if (!id) {
      const created = await call<{ id: string }>("POST", "/admin/argument-scripts", {
        name: script.name,
        businessDomainId: ctx.domains.get(script.process === "SEGUNDA_VIA" ? AGENTS.SEGUNDA_VIA.domain : AGENTS.REPARO.domain),
        scope: scopeOf(ctx),
        content: {
          schemaVersion: 1,
          trigger: script.trigger,
          notApplicableWhen: script.notApplicableWhen,
          operatorGuidance: script.guidance,
          requiredPoints: script.requiredPoints.map((group) => ({ mode: group.mode, items: group.items.map((text) => ({ text, condition: null })) })),
          avoid: script.avoid.map((text) => ({ text })),
          suggestedScript: script.suggestedScript,
          monitoringReference: null,
        },
        sourceReference: "Cenário de teste do cadastro de produtos (conteúdo fictício)",
      })
      id = created.id
      await call("POST", `/admin/argument-scripts/${id}/publish`, {})
    }
    await call("PUT", `/admin/product-catalog/sources/ARGUMENT_SCRIPT/${id}/scope`, { nodeIds: nodeIdsOf(ctx, script.products) })
    console.log(`Argumentário: ${script.name} → ${script.products.length === 0 ? "todos os produtos" : script.products.join(", ")}`)
  }

  // 4. Agentes (um por processo) e 5. Workflows manuais.
  for (const process of ["SEGUNDA_VIA", "REPARO"] as const) {
    const spec = AGENTS[process]
    let agentId = await existing("agents", "name", spec.name, ctx.org)
    if (!agentId) {
      agentId = (await call<{ id: string }>("POST", "/admin/agents", {
        name: spec.name,
        agentType: "CUSTOM",
        objective: spec.objective,
        description: spec.description,
        contextPrompt: spec.contextPrompt,
        ...scopeOf(ctx),
        knowledgeDocumentIds: DOCUMENTS.filter((document) => document.process === process).map((document) => documentIds.get(document.key)!),
        actionLimitsEnabled: false,
        actionLimits: null,
        recommendSupportMaterials: false,
        investigationCapabilities: [],
        specialtyKind: "DOMAIN",
        businessDomainId: ctx.domains.get(spec.domain),
        capability: null,
        consolidatedInput: false,
      })).id
    }
    let workflowId = await existing("workflows", "name", WORKFLOWS[process], ctx.org)
    if (!workflowId) {
      workflowId = (await call<{ id: string }>("POST", "/admin/workflows", { name: WORKFLOWS[process], description: "Teste do cadastro de produtos: Executar agora numa chamada da Larissa.", ...scopeOf(ctx), trigger: { kind: "manual", context: "INTERACTION" } })).id
      await call("PUT", `/admin/workflows/${workflowId}/draft`, {
        graph: {
          nodes: [
            { id: "trigger", type: "trigger", label: "Gatilho", config: {}, position: { x: 0, y: 0 } },
            { id: "agent", type: "action", label: spec.name.replace(`${PREFIX} `, ""), config: { actionType: "CALL_AGENT", agentId, outputContract: "PROCESS_ASSESSMENT" }, position: { x: 0, y: 160 } },
            { id: "feedback", type: "action", label: "Gerar feedback", config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "MONITORING" }, position: { x: 0, y: 320 } },
            { id: "output", type: "output", label: "Feedback para a pessoa", config: { source: "nodeOutputs.feedback", target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"] }, position: { x: 0, y: 480 } },
            { id: "end", type: "end", label: "Fim", config: {}, position: { x: 0, y: 640 } },
          ],
          edges: [
            { id: "trigger-agent", source: "trigger", target: "agent", sourceHandle: "always" },
            { id: "agent-feedback", source: "agent", target: "feedback", sourceHandle: "always" },
            { id: "feedback-output", source: "feedback", target: "output", sourceHandle: "always" },
            { id: "output-end", source: "output", target: "end", sourceHandle: "always" },
          ],
        },
      })
      await call("POST", `/admin/workflows/${workflowId}/publish`, {})
    }
    console.log(`Agente: ${spec.name} · Workflow: ${WORKFLOWS[process]}`)
  }
}

// ---------------------------------------------------------------------------------------------
// --chamadas
// ---------------------------------------------------------------------------------------------
/** Quando a configuração do cenário passou a valer (a mais recente): as chamadas entram depois disso. */
async function configuredAt(ctx: Context): Promise<Date> {
  const titles = DOCUMENTS.map((document) => document.title)
  const names = ARGUMENT_SCRIPTS.map((script) => script.name)
  const row = (await pool.query<{ at: Date | null; documents: number; scripts: number }>(
    `select greatest(
        (select max(a.effective_from) from product_scope_assignments a join knowledge_documents d on d.id = a.source_id where d.organization_id = $1 and d.title = any($2::text[]) and d.deleted_at is null),
        (select max(a.effective_from) from product_scope_assignments a join argument_scripts s on s.id = a.source_id where s.organization_id = $1 and s.name = any($3::text[])),
        (select max(v.effective_from) from argument_script_versions v join argument_scripts s on s.id = v.script_id where s.organization_id = $1 and s.name = any($3::text[])),
        (select max(coalesce(v.effective_from, v.created_at)) from knowledge_versions v join knowledge_documents d on d.id = v.document_id where d.organization_id = $1 and d.title = any($2::text[]) and d.deleted_at is null)
      ) at,
      (select count(*)::int from knowledge_documents where organization_id = $1 and title = any($2::text[]) and deleted_at is null) documents,
      (select count(*)::int from argument_scripts where organization_id = $1 and name = any($3::text[])) scripts`,
    [ctx.org, titles, names],
  )).rows[0]!
  if (!row.at || row.documents < titles.length || row.scripts < names.length) throw new Error("A configuração do cenário não está completa: rode --configurar antes.")
  return row.at
}

async function insertCalls(ctx: Context) {
  const CALLS = await callsOf()
  const base = new Date((await configuredAt(ctx)).getTime() + CALL_SPACING_MS)
  const lastEnd = base.getTime() + (CALLS.length - 1) * CALL_SPACING_MS + Math.max(...CALLS.map((entry) => entry.durationSeconds)) * 1000
  if (lastEnd > Date.now()) throw new Error(`Ainda cedo: as chamadas vão de ${base.toISOString()} a ${new Date(lastEnd).toISOString()} (depois da configuração) e precisam ter terminado. Rode de novo em ${Math.ceil((lastEnd - Date.now()) / 60_000)} min.`)
  const client = await pool.connect()
  try {
    await client.query("begin")
    for (const [index, entry] of CALLS.entries()) {
      const startedAt = new Date(base.getTime() + index * CALL_SPACING_MS)
      const endedAt = new Date(startedAt.getTime() + entry.durationSeconds * 1000)
      const interactionId = idOf(`interaction:${entry.key}`)
      await client.query(
        `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, $4, 'VOICE', $5, $6, $7)
         on conflict (id) do update set reason = excluded.reason, started_at = excluded.started_at, ended_at = excluded.ended_at`,
        [interactionId, ctx.org, LARISSA, entry.reason, startedAt, endedAt, `SCENARIO-PRODUTOS-${entry.key}`],
      )
      await client.query(
        `insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence) values ($1, $2, $3, 1, $4, 'pt-BR', 0.9)
         on conflict (id) do update set content = excluded.content`,
        [idOf(`transcript:${entry.key}`), ctx.org, interactionId, transcriptOf(entry.lines, "Larissa")],
      )
      console.log(`${entry.key} ${startedAt.toISOString()} ${entry.reason} · ${entry.intent.expectedIdentification}${entry.intent.failures.length > 0 ? ` · erra ${entry.intent.failures.join(", ")}` : ""}`)
    }
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'DEV_SCENARIO_PRODUTOS_CALLS_APPLIED', 'person', $2, $3)`, [ctx.org, LARISSA, JSON.stringify({ calls: CALLS.map((entry) => entry.key) })])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------------------------
// --reset (o produto e a categoria ficam: são cadastro da organização)
// ---------------------------------------------------------------------------------------------
async function reset(ctx: Context) {
  const CALLS = await callsOf()
  const ids = CALLS.map((entry) => idOf(`interaction:${entry.key}`))
  await pool.query(`delete from transcripts where interaction_id = any($1::uuid[])`, [ids])
  let removed = 0
  for (const id of ids) {
    // Chamada que já foi analisada (avaliação, execução de Workflow, feedback) fica: o histórico aponta para ela.
    const result = await pool.query(`delete from interactions where id = $1`, [id]).catch(() => null)
    removed += result?.rowCount ?? 0
  }
  console.log(`Chamadas removidas: ${removed} de ${ids.length} (as que já foram analisadas ficam)`)
  await login()
  for (const name of Object.values(WORKFLOWS)) {
    const id = await existing("workflows", "name", name, ctx.org)
    if (id) await call("DELETE", `/admin/workflows/${id}`).catch((error: Error) => console.log(`Workflow ${name}: ${error.message}`))
  }
  for (const spec of Object.values(AGENTS)) {
    const id = await existing("agents", "name", spec.name, ctx.org)
    if (id) await call("DELETE", `/admin/agents/${id}`).catch((error: Error) => console.log(`Agente ${spec.name}: ${error.message}`))
  }
  for (const script of ARGUMENT_SCRIPTS) {
    const id = await existing("argument_scripts", "name", script.name, ctx.org)
    if (id) await call("DELETE", `/admin/argument-scripts/${id}`).catch((error: Error) => console.log(`Argumentário ${script.name}: ${error.message}`))
  }
  for (const document of DOCUMENTS) {
    const id = await existing("knowledge_documents", "title", document.title, ctx.org)
    if (id) await call("DELETE", `/admin/knowledge/${id}`).catch((error: Error) => console.log(`Base ${document.title}: ${error.message}`))
  }
  console.log("Configuração do cenário removida (o que não pôde sair está listado acima).")
}

async function main() {
  const ctx = await contextOf()
  try {
    if (process.argv.includes("--reset")) return await reset(ctx)
    if (process.argv.includes("--configurar")) return await configure(ctx)
    if (process.argv.includes("--chamadas")) return await insertCalls(ctx)
    console.log(JSON.stringify({
      modo: "ENSAIO (nada gravado)",
      produto: SOLUCIONA_TI,
      bases: DOCUMENTS.map((document) => `${document.title} → ${document.products.length === 0 ? "todos" : document.products.join(", ")}`),
      argumentarios: ARGUMENT_SCRIPTS.map((script) => `${script.name} → ${script.products.length === 0 ? "todos" : script.products.join(", ")}`),
      agentes: Object.values(AGENTS).map((spec) => spec.name),
      workflows: Object.values(WORKFLOWS),
      chamadas: (await callsOf().catch(() => [] as ProductScenarioCall[])).map((entry) => `${entry.key} ${entry.reason} · ${entry.intent.expectedIdentification}${entry.intent.failures.length > 0 ? ` · erra ${entry.intent.failures.join(", ")}` : ""}`),
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
