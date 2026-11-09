/**
 * TESTE DA EXCEÇÃO POR PRODUTO DENTRO DE UMA BASE GERAL (22/10/2026) — ver `excecao-conteudo.ts`. Separado de `cenario-produtos.ts` para
 * não mudar a configuração nem o horário das chamadas do cenário principal.
 *
 *   npx tsx scripts/dev/larissa-scenario/produtos/excecao.ts               # ensaio: mostra o plano, nada gravado
 *   npx tsx scripts/dev/larissa-scenario/produtos/excecao.ts --configurar  # base (publicada, "Vale para" grupo A) + agente só com ela
 *   npx tsx scripts/dev/larissa-scenario/produtos/excecao.ts --chamadas    # EX01–EX03 da Larissa, depois da base
 *
 * A configuração entra pela API (a mesma da tela), com a conta demo de administrador; as chamadas entram direto no banco (sem ingestão:
 * nada dispara sozinho). Avaliar: `avaliar.ts EX01 --modo completa`.
 */
import { createHash } from "node:crypto"
import "../../../../src/config/env.js"
import { resolveDemoPassword } from "../../../../src/infrastructure/database/demo-mass/demo-constants.js"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { CHAMADAS_EXCECAO, EXCECAO_AGENT, EXCECAO_DOCUMENT } from "./excecao-conteudo.js"

const API = process.env.INIA_API_URL ?? "http://127.0.0.1:3333/api/v1"
const ADMIN_EMAIL = "gerente02.demo@inia.local"
const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const CALL_SPACING_MS = 60_000

const idOf = (name: string) => {
  const hex = createHash("sha256").update(`inia-scenario-produtos:${name}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const transcriptOf = (lines: readonly string[], operator: string) => lines
  .map((line) => line.replace("{OPERADOR}", operator))
  .map((line) => (line.startsWith("O: ") ? `Operador: ${line.slice(3)}` : line.startsWith("C: ") ? `Cliente: ${line.slice(3)}` : line))
  .join("\n")

let cookie = ""
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const response = await fetch(`${API}${path}`, { method, headers: { ...(isForm ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }) })
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length > 0) cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ")
  const json = (await response.json().catch(() => null)) as { data?: T } | null
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json)}`)
  return (json?.data ?? json) as T
}

type Context = { org: string; teamId: string; subteamId: string; nodes: Map<string, string>; subjectId: string; domainId: string }
async function contextOf(): Promise<Context> {
  const person = (await pool.query<{ organization_id: string; team_id: string; subteam_id: string }>(`select organization_id, team_id, subteam_id from people where id = $1`, [LARISSA])).rows[0]!
  const nodes = new Map((await pool.query<{ code: string; id: string }>(`select code, id from product_catalog_nodes where organization_id = $1`, [person.organization_id])).rows.map((row) => [row.code, row.id]))
  const subjectId = (await pool.query<{ id: string }>(`select id from subjects where organization_id = $1 and name = 'Segunda via'`, [person.organization_id])).rows[0]?.id
  const domainId = (await pool.query<{ id: string }>(`select id from business_domains where organization_id = $1 and code = $2 and active`, [person.organization_id, EXCECAO_AGENT.domain])).rows[0]?.id
  if (!subjectId || !domainId) throw new Error("Assunto \"Segunda via\" ou domínio de faturamento não encontrado — rode o cenário principal antes.")
  return { org: person.organization_id, teamId: person.team_id, subteamId: person.subteam_id, nodes, subjectId, domainId }
}
const scopeOf = (ctx: Context) => ({ scopeType: "SUBTEAM", teamId: ctx.teamId, subteamId: ctx.subteamId })
const existing = async (table: "knowledge_documents" | "agents", column: "title" | "name", value: string, org: string) =>
  (await pool.query<{ id: string }>(`select id from ${table} where organization_id = $1 and ${column} = $2${table === "knowledge_documents" ? " and deleted_at is null" : ""} limit 1`, [org, value])).rows[0]?.id ?? null

async function configure(ctx: Context) {
  await call("POST", "/auth/login", { email: ADMIN_EMAIL, password: resolveDemoPassword(process.env.INIA_DEMO_PASSWORD) })
  let documentId = await existing("knowledge_documents", "title", EXCECAO_DOCUMENT.title, ctx.org)
  if (!documentId) {
    const form = new FormData()
    form.set("title", EXCECAO_DOCUMENT.title)
    form.set("documentType", "PROCEDURE")
    form.set("content", EXCECAO_DOCUMENT.content)
    form.set("orgScopes", JSON.stringify([scopeOf(ctx)]))
    form.set("subjectScopes", JSON.stringify([{ scopeType: "SUBJECT", subjectId: ctx.subjectId }]))
    documentId = (await call<{ id: string }>("POST", "/admin/knowledge", form)).id
    await call("PATCH", `/admin/knowledge/${documentId}`, { status: "PUBLISHED" })
  }
  const nodeIds = EXCECAO_DOCUMENT.products.map((code) => {
    const id = ctx.nodes.get(code)
    if (!id) throw new Error(`Categoria ${code} não cadastrada.`)
    return id
  })
  // Os produtos de uma base ficam no rascunho: só valem depois de publicar (PEN-008).
  const scope = await call<{ pending: { version: number } | null }>("PUT", `/admin/product-catalog/sources/KNOWLEDGE_DOCUMENT/${documentId}/scope`, { nodeIds })
  if (scope.pending) await call("POST", `/admin/knowledge/${documentId}/publish`, {})
  console.log(`Base: ${EXCECAO_DOCUMENT.title} → ${EXCECAO_DOCUMENT.products.join(", ")}`)
  if (!(await existing("agents", "name", EXCECAO_AGENT.name, ctx.org))) {
    await call("POST", "/admin/agents", {
      name: EXCECAO_AGENT.name,
      agentType: "CUSTOM",
      objective: EXCECAO_AGENT.objective,
      description: EXCECAO_AGENT.description,
      contextPrompt: EXCECAO_AGENT.contextPrompt,
      ...scopeOf(ctx),
      knowledgeDocumentIds: [documentId],
      actionLimitsEnabled: false,
      actionLimits: null,
      recommendSupportMaterials: false,
      investigationCapabilities: [],
      specialtyKind: "DOMAIN",
      businessDomainId: ctx.domainId,
      capability: null,
      consolidatedInput: false,
    })
  }
  console.log(`Agente: ${EXCECAO_AGENT.name} (só a base acima)`)
}

/** Quando a base passou a valer (versão publicada e "Vale para"): as chamadas entram depois disso. */
async function configuredAt(ctx: Context): Promise<Date> {
  const at = (await pool.query<{ at: Date | null }>(
    `select greatest(
        (select max(coalesce(v.effective_from, v.created_at)) from knowledge_versions v join knowledge_documents d on d.id = v.document_id where d.organization_id = $1 and d.title = $2 and d.deleted_at is null),
        (select max(a.effective_from) from product_scope_assignments a join knowledge_documents d on d.id = a.source_id where d.organization_id = $1 and d.title = $2 and d.deleted_at is null)) at`,
    [ctx.org, EXCECAO_DOCUMENT.title],
  )).rows[0]?.at
  if (!at) throw new Error("A base da exceção não existe: rode --configurar antes.")
  return at
}

async function insertCalls(ctx: Context) {
  const base = new Date((await configuredAt(ctx)).getTime() + CALL_SPACING_MS)
  const lastEnd = base.getTime() + (CHAMADAS_EXCECAO.length - 1) * CALL_SPACING_MS + Math.max(...CHAMADAS_EXCECAO.map((entry) => entry.durationSeconds)) * 1000
  if (lastEnd > Date.now()) throw new Error(`Ainda cedo: as chamadas precisam ter terminado depois da base. Rode de novo em ${Math.ceil((lastEnd - Date.now()) / 60_000)} min.`)
  const client = await pool.connect()
  try {
    await client.query("begin")
    for (const [index, entry] of CHAMADAS_EXCECAO.entries()) {
      const startedAt = new Date(base.getTime() + index * CALL_SPACING_MS)
      const interactionId = idOf(`interaction:${entry.key}`)
      await client.query(
        `insert into interactions (id, organization_id, operator_id, reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, $4, 'VOICE', $5, $6, $7)
         on conflict (id) do update set reason = excluded.reason, started_at = excluded.started_at, ended_at = excluded.ended_at`,
        [interactionId, ctx.org, LARISSA, entry.reason, startedAt, new Date(startedAt.getTime() + entry.durationSeconds * 1000), `SCENARIO-PRODUTOS-${entry.key}`],
      )
      await client.query(
        `insert into transcripts (id, organization_id, interaction_id, version, content, language, confidence) values ($1, $2, $3, 1, $4, 'pt-BR', 0.9)
         on conflict (id) do update set content = excluded.content`,
        [idOf(`transcript:${entry.key}`), ctx.org, interactionId, transcriptOf(entry.lines, "Larissa")],
      )
      console.log(`${entry.key} ${startedAt.toISOString()} · ${entry.intent.expectedIdentification}${entry.intent.failures.length > 0 ? ` · erra ${entry.intent.failures.join(", ")}` : ""}`)
    }
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'DEV_SCENARIO_PRODUTOS_CALLS_APPLIED', 'person', $2, $3)`, [ctx.org, LARISSA, JSON.stringify({ calls: CHAMADAS_EXCECAO.map((entry) => entry.key) })])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  const ctx = await contextOf()
  if (process.argv.includes("--configurar")) return await configure(ctx)
  if (process.argv.includes("--chamadas")) return await insertCalls(ctx)
  console.log(`ENSAIO — nada gravado.\nBase: ${EXCECAO_DOCUMENT.title} → ${EXCECAO_DOCUMENT.products.join(", ")}\nAgente: ${EXCECAO_AGENT.name}`)
  for (const entry of CHAMADAS_EXCECAO) console.log(`${entry.key} · ${entry.intent.expectedIdentification} · ${entry.intent.note.slice(0, 120)}`)
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
