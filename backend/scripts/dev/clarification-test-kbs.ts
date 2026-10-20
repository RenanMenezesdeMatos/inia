/**
 * BASES DE TESTE do esclarecimento pelas bases (só desenvolvimento). Publica as bases FICTÍCIAS de `clarification-test-kbs/*.md` —
 * mudança de endereço de cinco produtos (uma base por produto) e troca de titularidade (Empresa: PJ×PJ / PJ×PF / PF×PJ com as
 * situações de cada um; Residencial) — com alcance "Todos os grupos", num especialista de teste próprio, vinculado ao Orquestrador
 * do chat. Serve para ver a IA afunilar entre bases e dentro de uma base, no texto e na voz, para quem atende e para quem lidera.
 *
 *   npx tsx scripts/dev/clarification-test-kbs.ts setup [--orchestrator="ORQUESTRADOR"]
 *   npx tsx scripts/dev/clarification-test-kbs.ts status
 *   npx tsx scripts/dev/clarification-test-kbs.ts cleanup
 *
 * Idempotente: rodar de novo publica versão nova só da base cujo arquivo mudou. A limpeza mexe SÓ no que este script criou (as
 * bases pelos títulos exatos dos arquivos, o especialista pelo nome): desvincula, desativa o especialista e exclui as bases
 * logicamente (`deleted_at`). Recusado em produção.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { env } from "../../src/config/env.js"
import { toolNameForAgent } from "../../src/modules/assistant/domain/orchestrator-schema.js"

if (process.env.NODE_ENV === "production") throw new Error("Bases de teste recusadas em produção.")

const TITLE_PREFIX = "[Teste esclarecimento] "
const AGENT_NAME = "Especialista de teste — esclarecimento pelas bases"
const AGENT_OBJECTIVE = "Responder dúvidas de procedimento usando as bases fictícias de teste do esclarecimento pelas bases."
const AGENT_DESCRIPTION = "Especialista de TESTE (desenvolvimento): mudança de endereço por produto e troca de titularidade (empresa e residencial). Bases fictícias."
const AGENT_PROMPT = "Responda só com o que está nas bases de teste vinculadas. Elas são fictícias e existem para testar o esclarecimento de perguntas ambíguas."

const [mode = "status", ...flags] = process.argv.slice(2)
const orchestratorName = flags.find((flag) => flag.startsWith("--orchestrator="))?.slice("--orchestrator=".length) ?? "ORQUESTRADOR"
const folder = join(dirname(fileURLToPath(import.meta.url)), "clarification-test-kbs")

type Base = { title: string; content: string }
function loadBases(): Base[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const content = readFileSync(join(folder, name), "utf8").trim()
      const heading = content.split("\n")[0]!.replace(/^#\s+/, "").trim()
      return { title: `${TITLE_PREFIX}${heading}`, content }
    })
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 })

async function orchestrator(client: pg.PoolClient) {
  const result = await client.query<{ id: string; organization_id: string }>(`select id, organization_id from assistant_orchestrators where name = $1 and active order by created_at desc limit 1`, [orchestratorName])
  const row = result.rows[0]
  if (!row) throw new Error(`Orquestrador "${orchestratorName}" não encontrado (ativo).`)
  return { id: row.id, organizationId: row.organization_id }
}

async function testAgentId(client: pg.PoolClient, organizationId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(`select id from agents where organization_id = $1 and name = $2 order by created_at limit 1`, [organizationId, AGENT_NAME])
  return result.rows[0]?.id ?? null
}

async function setup() {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const target = await orchestrator(client)
    const documentIds: string[] = []
    for (const base of loadBases()) {
      const existing = await client.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title = $2 and deleted_at is null order by created_at limit 1`, [target.organizationId, base.title])
      let documentId = existing.rows[0]?.id
      if (!documentId) {
        documentId = (await client.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1, $2, 'PROCEDURE', 'TEXT') returning id`, [target.organizationId, base.title])).rows[0]!.id
        await client.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, $3, 'PUBLISHED', $4)`, [target.organizationId, documentId, base.content, hash(base.content)])
        console.log(`+ base criada: ${base.title}`)
      } else {
        const latest = await client.query<{ version: number; content_hash: string }>(`select version, content_hash from knowledge_versions where document_id = $1 order by version desc limit 1`, [documentId])
        if (latest.rows[0]?.content_hash !== hash(base.content)) {
          await client.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, $3, $4, 'PUBLISHED', $5)`, [target.organizationId, documentId, (latest.rows[0]?.version ?? 0) + 1, base.content, hash(base.content)])
          await client.query(`update knowledge_documents set updated_at = now() where id = $1`, [documentId])
          console.log(`~ nova versão publicada: ${base.title}`)
        } else console.log(`= sem mudança: ${base.title}`)
      }
      const scoped = await client.query(`select 1 from knowledge_document_org_scopes where knowledge_document_id = $1 and scope_type = 'ALL_TEAMS'`, [documentId])
      if (scoped.rowCount === 0) await client.query(`insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1, 'ALL_TEAMS')`, [documentId])
      documentIds.push(documentId)
    }
    let agentId = await testAgentId(client, target.organizationId)
    if (!agentId) {
      agentId = (await client.query<{ id: string }>(
        `insert into agents (organization_id, name, agent_type, objective, description, context_prompt, active, scope_type, recommend_support_materials, investigation_capabilities, action_limits_enabled)
         values ($1, $2, 'CUSTOM', $3, $4, $5, true, 'ALL_TEAMS', false, '{}', false) returning id`,
        [target.organizationId, AGENT_NAME, AGENT_OBJECTIVE, AGENT_DESCRIPTION, AGENT_PROMPT],
      )).rows[0]!.id
      console.log(`+ especialista de teste criado: ${AGENT_NAME}`)
    } else await client.query(`update agents set active = true, updated_at = now() where id = $1`, [agentId])
    for (const documentId of documentIds) await client.query(`insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1, $2) on conflict do nothing`, [agentId, documentId])
    const linked = await client.query(`select 1 from assistant_orchestrator_specialists where orchestrator_id = $1 and agent_id = $2`, [target.id, agentId])
    if (linked.rowCount === 0) {
      await client.query(`insert into assistant_orchestrator_specialists (orchestrator_id, agent_id, tool_name) values ($1, $2, $3)`, [target.id, agentId, toolNameForAgent(agentId)])
      console.log(`+ especialista vinculado ao Orquestrador "${orchestratorName}"`)
    }
    await client.query("commit")
    console.log(`Pronto: ${documentIds.length} bases de teste publicadas e vinculadas.`)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function status() {
  const client = await pool.connect()
  try {
    const target = await orchestrator(client)
    const agentId = await testAgentId(client, target.organizationId)
    const titles = loadBases().map((base) => base.title)
    const rows = await client.query<{ title: string; version: number; chars: number; deleted: boolean }>(
      `select d.title, v.version, length(v.content) chars, d.deleted_at is not null deleted
         from knowledge_documents d join lateral (select version, content from knowledge_versions where document_id = d.id order by version desc limit 1) v on true
        where d.organization_id = $1 and d.title = any($2::text[]) order by d.title`,
      [target.organizationId, titles],
    )
    for (const row of rows.rows) console.log(`${row.deleted ? "x" : "•"} ${row.title} — v${row.version}, ${row.chars} caracteres${row.deleted ? " (excluída)" : ""}`)
    const linked = agentId ? (await client.query(`select 1 from assistant_orchestrator_specialists where orchestrator_id = $1 and agent_id = $2`, [target.id, agentId])).rowCount : 0
    console.log(`Especialista de teste: ${agentId ?? "não existe"}${agentId ? ` · vinculado ao "${orchestratorName}": ${linked ? "sim" : "não"}` : ""}`)
  } finally {
    client.release()
  }
}

async function cleanup() {
  const client = await pool.connect()
  try {
    await client.query("begin")
    const target = await orchestrator(client)
    const agentId = await testAgentId(client, target.organizationId)
    if (agentId) {
      await client.query(`delete from assistant_orchestrator_specialists where agent_id = $1`, [agentId])
      await client.query(`delete from agent_knowledge_documents where agent_id = $1`, [agentId])
      await client.query(`update agents set active = false, updated_at = now() where id = $1`, [agentId])
    }
    const removed = await client.query(`update knowledge_documents set deleted_at = now() where organization_id = $1 and title = any($2::text[]) and deleted_at is null`, [target.organizationId, loadBases().map((base) => base.title)])
    await client.query("commit")
    console.log(`Limpo: especialista ${agentId ? "desvinculado e desativado" : "inexistente"}; ${removed.rowCount ?? 0} bases excluídas (lógica).`)
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

try {
  if (mode === "setup") await setup()
  else if (mode === "cleanup") await cleanup()
  else if (mode === "status") await status()
  else throw new Error(`Modo desconhecido: ${mode} (use setup, status ou cleanup).`)
} finally {
  await pool.end()
}
