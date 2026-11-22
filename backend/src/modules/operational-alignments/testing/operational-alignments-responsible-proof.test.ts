/**
 * PROVA contra o banco de TESTE real — responsável e cargo do alinhamento (migration 221, integração com Publicações): o analista
 * cadastra e publica em nome da supervisora que DEFINIU a orientação; o cargo dela é copiado do cadastro (`people.job_title`) e fica na
 * versão publicada mesmo se mudar depois; a regra lida do banco leva quem definiu e quem publicou; o texto da CONVERSA atribui a
 * decisão a quem definiu e o de AVALIAÇÃO (monitoria) não traz autoria; responsável que não lidera ninguém é recusado; a mudança de
 * responsável entra no rastro. ZERO chamada de modelo (conferência de assunto proibido injetada). Transação desfeita no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operational-alignments-responsible-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createAlignment, getAlignment, publishAlignment, responsibleOptions, updateAlignment } from "../application/operational-alignment-service.js"
import { renderAlignmentsForConversation } from "../domain/operational-alignment.js"
import { resolveOperationalAlignmentsFor } from "../infrastructure/operational-alignment-loaders.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

function savepointDb(connection: pg.PoolClient): Database {
  const proxy = { query: (sql: string, params?: unknown[]) => (sql === "begin" ? connection.query("savepoint service_tx") : sql === "commit" ? connection.query("release savepoint service_tx") : sql === "rollback" ? connection.query("rollback to savepoint service_tx") : connection.query(sql, params)), release: () => undefined }
  return { query: (sql: string, params?: unknown[]) => connection.query(sql, params), connect: async () => proxy } as unknown as Database
}

describe.skipIf(!ENABLED)("Alinhamentos operacionais — responsável e cargo (migration 221)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("analista publica em nome da supervisora: cargo copiado na publicação, autoria no chat e nunca na avaliação", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const ouvidoria = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name, operating_universe) values ($1, $2, 'Proof AR Ouvidoria', 'B2C') returning id", [ORG, operation])).rows[0]!.id
    const doc = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, operating_universe) values ($1, 'Proof AR — PR Fatura', 'PROCEDURE', 'B2C') returning id", [ORG])).rows[0]!.id
    await client.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, 'Conteúdo', 'PUBLISHED', md5($3))", [ORG, doc, doc])
    const person = async (name: string, jobTitle: string | null, reportsTo: string | null = null) => (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, job_title, reports_to_id) values ($1, $2, 'SUPERVISOR', $3, $4, $5) returning id", [ORG, name, ouvidoria, jobTitle, reportsTo])).rows[0]!.id
    const supervisora = await person("Ana Prova Souza", "Supervisora de Atendimento")
    await person("Operador Prova", null, supervisora)
    const analista = await person("Bruno Prova Lima", "Analista de Processos")
    const operador = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Operadora Prova', 'OPERATOR', $2) returning id", [ORG, ouvidoria])).rows[0]!.id
    const account = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id", [ORG, analista, `proof-ar-${Date.now()}@proof.inia.local`])).rows[0]!.id
    const actor = { organizationId: ORG, personId: analista, accountId: account, sub: account }
    const scopes = { unrestricted: false as const, allTeams: true, teamIds: new Set<string>(), subteamIds: new Set<string>() }
    const db = savepointDb(client)
    const reason = (await client.query<{ id: string }>("select id from operational_alignment_reasons where organization_id = $1 order by position limit 1", [ORG])).rows[0]!.id
    const body = { reasonId: reason, requestSubjectIds: [], title: "Proof AR — Fatura pelo app", guidance: "Oriente o cliente a acessar a fatura pelo App Meu Telnova ou pelo site.", affectedDocumentIds: [doc], affectedTopic: "Envio da fatura", justification: "Envio por e-mail suspenso durante a troca do sistema.", operatingUniverse: "B2C", scopeType: "TEAM", teamId: ouvidoria, subteamId: null, productId: null, startsOn: "2026-11-10", endsOn: "2026-11-30" }

    // Opções: lideranças (alguém abaixo) e quem cadastra; a operadora não aparece.
    const options = await responsibleOptions(db, actor, { search: "prova" })
    expect(options.map((option) => option.name)).toEqual(["Bruno Prova Lima", "Ana Prova Souza"])
    // Responsável que não lidera ninguém: recusado.
    await expect(createAlignment(db, actor, scopes, { ...body, responsiblePersonId: operador })).rejects.toMatchObject({ code: "OPERATIONAL_ALIGNMENT_RESPONSIBLE_INVALID" })

    const created = await createAlignment(db, actor, scopes, { ...body, responsiblePersonId: supervisora })
    expect(created.draft).toMatchObject({ responsible: { id: supervisora, name: "Ana Prova Souza", jobTitle: "Supervisora de Atendimento" }, createdBy: "Bruno Prova Lima" })
    // A supervisora muda de cargo antes da publicação: a publicação copia o cargo DO DIA em que passa a valer.
    await client.query("update people set job_title = 'Coordenadora de Atendimento' where id = $1", [supervisora])
    const published = await publishAlignment(db, actor, scopes, created.id, {}, { prohibitedTopicCheck: async () => ({ outcome: "ALLOWED", model: null, durationMs: 0 }) })
    expect(published.current).toMatchObject({ responsible: { name: "Ana Prova Souza", jobTitle: "Coordenadora de Atendimento" }, publishedBy: "Bruno Prova Lima" })
    // Depois de publicada, mudar o cadastro não reescreve a versão.
    await client.query("update people set job_title = 'Gerente de Atendimento' where id = $1", [supervisora])
    expect((await getAlignment(db, ORG, scopes, created.id)).current).toMatchObject({ responsible: { jobTitle: "Coordenadora de Atendimento" } })

    const resolution = await resolveOperationalAlignmentsFor(client, { organizationId: ORG, personId: operador, at: new Date("2026-11-15T15:00:00Z"), documentIds: [doc] })
    const mine = resolution.applied.filter((candidate) => candidate.title === "Proof AR — Fatura pelo app")
    expect(mine[0]).toMatchObject({ definedBy: { name: "Ana Prova Souza", jobTitle: "Coordenadora de Atendimento" }, publishedBy: { name: "Bruno Prova Lima", jobTitle: "Analista de Processos" } })
    const conversation = renderAlignmentsForConversation({ ...resolution, applied: mine })
    expect(conversation).toContain("Definido por: Ana Prova Souza (Coordenadora de Atendimento) · publicado por: Bruno Prova Lima (Analista de Processos)")
    expect(conversation).toContain("COMECE pelo que fazer")
    const evaluation = renderAlignmentsForConversation({ ...resolution, applied: mine }, { evaluation: true })
    expect(evaluation).not.toContain("Ana Prova Souza")
    expect(evaluation).not.toContain("Definido por")

    // Trocar o responsável numa nova versão entra no rastro como campo alterado.
    await updateAlignment(db, actor, scopes, created.id, { ...body, responsiblePersonId: analista, changeReason: "A decisão passou para a área de processos." })
    const event = (await client.query<{ details: { changedFields: string[] } }>("select details from operational_alignment_events where alignment_id = $1 and event_type = 'DRAFT_SAVED' order by occurred_at desc limit 1", [created.id])).rows[0]!
    expect(event.details.changedFields).toContain("responsiblePersonId")
  })
})
