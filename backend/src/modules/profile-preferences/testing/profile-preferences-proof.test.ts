/**
 * PROVA contra o banco de TESTE real: preferências pessoais do perfil (migration 097).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run profile-preferences-proof
 *
 * - A pessoa só edita as PRÓPRIAS preferências (não existe parâmetro de pessoa; campos profissionais são recusados).
 * - A carga EMPLOYEES da Central de Dados atualiza o cadastro (nome, Grupo) e NÃO toca no nome escolhido, na foto nem na capa.
 * - /auth/me devolve a identidade AO VIVO (sem novo login); a IA (chat/voz e saudação de feedback) usa o nome escolhido inteiro.
 * - Isolamento entre contas e entre organizações; imagem substituída/removida sai do banco.
 * Organizações PRÓPRIAS da prova, apagadas no fim. Nenhuma chamada de modelo.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { createDataHubContext, type DataHubContext } from "../../data-hub/application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../../data-hub/application/feed-service.js"
import type { DataFeedRow } from "../../data-hub/application/records.js"
import { enqueueRun } from "../../data-hub/application/run-service.js"
import { executeRun } from "../../data-hub/application/run-pipeline.js"
import { createSource } from "../../data-hub/application/source-service.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, MockHttpClient } from "../../data-hub/testing/fakes.js"
import { createPostgresRecipientLoader } from "../../reliable-feedback/infrastructure/postgres-feedback-context-loaders.js"
import { loadAddressingContext } from "../application/addressing-context.js"
import { loadPersonPresentations } from "../application/person-presentation-loader.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000a1a1"
const OPERATION = "de00ee00-0000-4000-8000-00000000a1a2"
const OTHER_ORG = "de00ee00-0000-4000-8000-00000000a1b1"
const OTHER_OPERATION = "de00ee00-0000-4000-8000-00000000a1b2"
const PASSWORD = "Proof@12345"

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let employeesFeed: DataFeedRow

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }
const FIELDS = ["externalEmployeeId", "name", "role", "jobTitle", "groupExternalCode", "reportsToExternalId"]

/** PNG mínimo (assinatura + IHDR) — o backend valida pelo conteúdo, nunca pela extensão. */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write("IHDR", 12, "latin1")
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

async function importEmployees(rows: string[][], filename: string) {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: employeesFeed.sourceId, feedId: employeesFeed.id, filename, contentType: "text/csv", content: csv([FIELDS, ...rows]) })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed: employeesFeed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  const finished = (await executeRun(ctx, run.id))!
  expect(finished.status).toBe("COMPLETED")
}

const personId = async (organizationId: string, matricula: string) => (await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = $2`, [organizationId, matricula])).rows[0]!.id

async function account(organizationId: string, person: string, email: string) {
  await db.query(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4)`, [organizationId, person, email, await hashPassword(PASSWORD)])
}

async function cleanup() {
  for (const org of [ORG, OTHER_ORG]) {
    await db.query(`delete from person_profile_preferences where organization_id = $1`, [org])
    await db.query(`delete from person_profile_images where organization_id = $1`, [org])
    await db.query(`delete from user_accounts where organization_id = $1`, [org])
    await db.query(`delete from data_sources where organization_id = $1`, [org])
    await db.query(`delete from data_raw_objects where organization_id = $1`, [org])
    await db.query(`delete from employee_status_periods where organization_id = $1`, [org])
    await db.query(`delete from audit_logs where organization_id = $1`, [org])
    await db.query(`update people set reports_to_id = null where organization_id = $1`, [org])
    await db.query(`delete from people where organization_id = $1`, [org])
    await db.query(`delete from teams where organization_id = $1`, [org])
    await db.query(`delete from operations where organization_id = $1`, [org])
    await db.query(`delete from organizations where id = $1`, [org])
  }
}

describe.skipIf(!ENABLED)("Preferências do perfil — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    ctx = createDataHubContext(db, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => new Date() } })
    await cleanup()
    await db.query(`insert into organizations (id, name, slug) values ($1, 'PP Proof', 'pp-proof'), ($2, 'PP Outra', 'pp-outra')`, [ORG, OTHER_ORG])
    await db.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'PP Operação', 'America/Fortaleza'), ($3, $4, 'PP Outra Operação', 'America/Fortaleza')`, [OPERATION, ORG, OTHER_OPERATION, OTHER_ORG])
    await db.query(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'PP Grupo A', 'PP_A'), ($1, $2, 'PP Grupo B', 'PP_B')`, [ORG, OPERATION])
    const source = await createSource(ctx, ORG, null, { name: "PP RH", config: { kind: "FILE_UPLOAD" } })
    employeesFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "pp-colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "pp-rh", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: { fields: FIELDS.map((field) => ({ target: field, source: field, transforms: [] })) } })).id, "ACTIVATE")
    await importEmployees([["PP-SUP-01", "Paula Supervisora", "SUPERVISOR", "Supervisora", "PP_A", ""], ["PP-OP-01", "Larissa Monteiro", "OPERATOR", "Analista I", "PP_A", "PP-SUP-01"], ["PP-OP-02", "Maria Clara Souza", "OPERATOR", "Analista I", "PP_A", "PP-SUP-01"]], "pp-base.csv")
    await account(ORG, await personId(ORG, "PP-OP-01"), "pp.larissa@proof.inia.local")
    await account(ORG, await personId(ORG, "PP-SUP-01"), "pp.paula@proof.inia.local")
    await account(ORG, await personId(ORG, "PP-OP-02"), "pp.mariaclara@proof.inia.local")
    const other = (await db.query<{ id: string }>(`insert into people (organization_id, name, role) values ($1, 'Outra Org', 'OPERATOR') returning id`, [OTHER_ORG])).rows[0]!.id
    await account(OTHER_ORG, other, "pp.outra@proof.inia.local")
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  const login = async (email: string) => {
    const agent = request.agent(createApp(db))
    expect((await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD })).status).toBe(200)
    return agent
  }

  it("Larissa vira “Lari” com foto; a carga do cliente renomeia e troca o Grupo sem tocar nas preferências", async () => {
    const larissa = await login("pp.larissa@proof.inia.local")
    const larissaId = await personId(ORG, "PP-OP-01")

    const saved = await larissa.put("/api/v1/me/profile").field("preferredName", "  Lari ").field("avatar", "replace").field("cover", "preset").field("coverPreset", "aurora").attach("avatar", png(512, 512), { filename: "foto.png", contentType: "image/png" })
    expect(saved.status).toBe(200)
    expect(saved.body.data).toMatchObject({ registeredName: "Larissa Monteiro", preferredName: "Lari", displayName: "Lari", addressName: "Lari", avatarSource: "CUSTOM", cover: { kind: "PRESET", preset: "aurora" } })
    const avatarUrl: string = saved.body.data.avatarUrl
    expect(avatarUrl).toMatch(/^\/api\/v1\/profile-images\/[0-9a-f-]{36}$/)

    // Atualização cadastral pelo cliente: nome e Grupo mudam.
    await importEmployees([["PP-OP-01", "Larissa Monteiro Santos", "OPERATOR", "Analista II", "PP_B", "PP-SUP-01"]], "pp-update.csv")
    expect((await db.query(`select name, job_title from people where id = $1`, [larissaId])).rows[0]).toEqual({ name: "Larissa Monteiro Santos", job_title: "Analista II" })
    expect((await personId(ORG, "PP-OP-01"))).toBe(larissaId) // identidade estável

    // Sessão ANTIGA (sem novo login) já enxerga o cadastro novo e mantém a preferência.
    const me = await larissa.get("/api/v1/auth/me")
    expect(me.body.data).toMatchObject({ name: "Larissa Monteiro Santos", preferredName: "Lari", displayName: "Lari", addressName: "Lari", avatarUrl, avatarSource: "CUSTOM", jobTitle: "Analista II", teamName: "PP Grupo B" })
    const image = await larissa.get(avatarUrl)
    expect(image.status).toBe(200)
    expect(image.headers["content-type"]).toBe("image/png")

    // IA: chat/voz recebem o nome escolhido como DADO; a saudação do feedback usa o mesmo nome.
    expect(await loadAddressingContext(db, ORG, larissaId)).toContain('"Lari"')
    expect(await createPostgresRecipientLoader(db)(ORG, larissaId)).toEqual({ firstName: "Lari" })
    const session = await larissa.get("/api/v1/me/profile")
    expect(session.body.data.professional).toMatchObject({ jobTitle: "Analista II", teamName: "PP Grupo B", matricula: "PP-OP-01" })
  })

  it("nome composto é respeitado inteiro pela IA; sem preferência, vale o primeiro nome cadastral", async () => {
    const mariaId = await personId(ORG, "PP-OP-02")
    expect(await createPostgresRecipientLoader(db)(ORG, mariaId)).toEqual({ firstName: "Maria" })
    const maria = await login("pp.mariaclara@proof.inia.local")
    expect((await maria.put("/api/v1/me/profile").field("preferredName", "Maria Clara")).status).toBe(200)
    expect(await createPostgresRecipientLoader(db)(ORG, mariaId)).toEqual({ firstName: "Maria Clara" })
    expect(await loadAddressingContext(db, ORG, mariaId)).toContain('"Maria Clara"')
  })

  it("ninguém edita outra pessoa nem dados profissionais; organizações isoladas", async () => {
    const larissaId = await personId(ORG, "PP-OP-01")
    const paula = await login("pp.paula@proof.inia.local")
    // Campos fora das preferências são recusados (400) — nem id de pessoa, nem nome cadastral, nem cargo/equipe.
    for (const field of ["personId", "name", "jobTitle", "teamId", "matricula", "role"]) {
      expect((await paula.put("/api/v1/me/profile").field(field, larissaId).field("preferredName", "Invasora")).status).toBe(400)
    }
    expect((await paula.put("/api/v1/me/profile").field("preferredName", "Paulinha")).status).toBe(200)
    const presentations = await loadPersonPresentations(db, ORG, [larissaId, await personId(ORG, "PP-SUP-01")])
    expect(presentations.get(larissaId)?.displayName).toBe("Lari")
    expect(presentations.get(await personId(ORG, "PP-SUP-01"))?.displayName).toBe("Paulinha")

    // Outra organização: nem a apresentação nem a imagem vazam.
    const outra = await login("pp.outra@proof.inia.local")
    const larissaAvatar = presentations.get(larissaId)!.avatarUrl!
    expect((await outra.get(larissaAvatar)).status).toBe(404)
    expect((await loadPersonPresentations(db, OTHER_ORG, [larissaId])).size).toBe(0)
    expect((await request(createApp(db)).get(larissaAvatar)).status).toBe(401)
  })

  it("validação, substituição e remoção de imagem; valores inválidos nunca gravam", async () => {
    const larissa = await login("pp.larissa@proof.inia.local")
    const before = (await larissa.get("/api/v1/me/profile")).body.data
    expect((await larissa.put("/api/v1/me/profile").field("preferredName", "Lari 2")).body.error.code).toBe("PROFILE_PREFERRED_NAME_INVALID")
    expect((await larissa.put("/api/v1/me/profile").field("preferredName", "A".repeat(61))).body.error.code).toBe("PROFILE_PREFERRED_NAME_TOO_LONG")
    const notImage = await larissa.put("/api/v1/me/profile").field("avatar", "replace").attach("avatar", Buffer.from("<svg onload=alert(1)>"), { filename: "x.png", contentType: "image/png" })
    expect(notImage.status).toBe(422)
    expect(notImage.body.error.code).toBe("IMAGE_UNSUPPORTED_TYPE")
    expect((await larissa.put("/api/v1/me/profile").field("avatar", "replace").attach("avatar", png(800, 300), { filename: "w.png", contentType: "image/png" })).body.error.code).toBe("IMAGE_NOT_SQUARE")
    expect((await larissa.get("/api/v1/me/profile")).body.data).toEqual(before)

    // Substituir a foto apaga a anterior; capa personalizada; remover volta ao fallback.
    const replaced = await larissa.put("/api/v1/me/profile").field("avatar", "replace").field("cover", "custom").attach("avatar", png(300, 300), { filename: "nova.png", contentType: "image/png" }).attach("cover", png(1600, 400), { filename: "capa.png", contentType: "image/png" })
    expect(replaced.status).toBe(200)
    expect(replaced.body.data.avatarUrl).not.toBe(before.avatarUrl)
    expect(replaced.body.data.cover.kind).toBe("CUSTOM")
    expect((await larissa.get(before.avatarUrl)).status).toBe(404)
    const removed = await larissa.put("/api/v1/me/profile").field("avatar", "remove").field("cover", "default")
    expect(removed.body.data).toMatchObject({ avatarUrl: null, avatarSource: "NONE", cover: { kind: "DEFAULT", preset: "inia", imageUrl: null }, preferredName: "Lari" })
    expect(Number((await db.query(`select count(*) from person_profile_images where organization_id = $1 and person_id = $2`, [ORG, await personId(ORG, "PP-OP-01")])).rows[0].count)).toBe(0)
    // Limpar o nome volta ao cadastral.
    const cleared = await larissa.put("/api/v1/me/profile").field("preferredName", "   ")
    expect(cleared.body.data).toMatchObject({ preferredName: null, displayName: "Larissa Monteiro Santos", addressName: "Larissa" })
    // Auditoria sem conteúdo pessoal.
    const audit = (await db.query<{ payload: unknown }>(`select payload from audit_logs where organization_id = $1 and action = 'PROFILE_PREFERENCES_UPDATED' order by created_at desc limit 1`, [ORG])).rows[0]!
    expect(JSON.stringify(audit.payload)).not.toContain("Lari")
  })
})
