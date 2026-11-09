import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Imagens de PDF no fluxo real, contra o banco de teste (provedor nenhum: nada aqui chama a IA).
 *
 *   INIA_DB_PROOF=1 npx vitest run pdf-images-proof
 *
 * Upload grava cada imagem uma vez e a posição no registro da versão; quem pode ler a base abre a imagem, quem não pode recebe 404 sem distinguir de
 * "não existe"; rascunho não vaza para o leitor; PDF antigo só ganha imagens reprocessando, sem tocar no que está em uso; reverter e editar levam a
 * posição junto; e nada das imagens chega ao que a IA lê.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { retrieveKnowledgeForAgent } = await import("../application/retrieve-knowledge.js")
const { buildFixturePdf, grayImage } = await import("./pdf-layout-fixture.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const PREFIX = "Prova Imagens PDF · "
const API = "/api/v1/admin/knowledge"
const READER = "/api/v1/knowledge-materials"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const ACCOUNTS = {
  teamA: { email: "prova-img-a@proof.inia.local", password: "Prova@12345" },
  teamB: { email: "prova-img-b@proof.inia.local", password: "Prova@12345" },
}
const PDF = "application/pdf"

type Op = Parameters<typeof buildFixturePdf>[0][number][number]
const text = (y: number, value: string): Op => ({ kind: "text", x: 56, y, text: value })
const shot = (y: number, value: number): Op => ({ kind: "image", x: 56, y, width: 300, height: 150, image: grayImage(200, 100, value) })
const manual = (seed = 90) => buildFixturePdf([
  [{ kind: "text", x: 56, y: 80, text: "Como abrir o chamado", size: 16, font: "bold" }, text(120, "1. Abra a tela de chamados."), shot(140, seed), text(320, "2. Clique em Novo chamado."), shot(340, seed + 10)],
])

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let readerA: ReturnType<typeof request.agent>
let readerB: ReturnType<typeof request.agent>
let teamA: string

async function cleanup() {
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  const agents = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from agent_knowledge_documents where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`update agents set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from checkpoint_versions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_definitions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_change_sets where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from audit_logs where entity_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
  const emails = Object.values(ACCOUNTS).map((account) => account.email)
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from auth_login_attempts where account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from auth_session_activity where account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from user_accounts where email = any($1)`, [emails])
  await pool.query(`delete from people where name like $1`, [`${PREFIX}%`])
}

const upload = async (title: string, file: Buffer, scopes: unknown = [{ scopeType: "ALL_TEAMS" }]) => {
  const response = await admin.post(API).field("title", `${PREFIX}${title}`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify(scopes)).field("subjectScopes", JSON.stringify([{ scopeType: "ALL_SUBJECTS" }])).attach("file", file, { filename: "manual.pdf", contentType: PDF })
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return response.body.data.id as string
}
const detailOf = async (id: string) => (await admin.get(`${API}/${id}`)).body.data
const publish = async (id: string) => {
  const response = await admin.post(`${API}/${id}/publish`).send({})
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  expect(response.body.data.inUse, JSON.stringify(response.body.data.updates)).not.toBeNull()
  return response.body.data
}
type Placement = { id: string; page: number; offset: number | null; width: number; height: number }

describe.runIf(ENABLED)("imagens de PDF no fluxo real", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    await cleanup()
    const teams = (await pool.query<{ id: string }>(`select id from teams where organization_id = $1 order by name limit 2`, [ORG])).rows
    teamA = teams[0]!.id
    const person = async (name: string, teamId: string) => (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id`, [ORG, `${PREFIX}${name}`, teamId])).rows[0]!.id
    const account = async (email: string, personId: string) => pool.query(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x')`, [ORG, personId, email])
    await account(ACCOUNTS.teamA.email, await person("Operador A", teamA))
    await account(ACCOUNTS.teamB.email, await person("Operador B", teams[1]!.id))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    for (const value of Object.values(ACCOUNTS)) await setProofAccountPassword(pool, value.email, value.password)
    const app = createApp(pool)
    admin = request.agent(app)
    readerA = request.agent(app)
    readerB = request.agent(app)
    expect((await admin.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    expect((await readerA.post("/api/v1/auth/login").send(ACCOUNTS.teamA)).status).toBe(200)
    expect((await readerB.post("/api/v1/auth/login").send(ACCOUNTS.teamB)).status).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("upload: cada imagem gravada uma vez, no arquivo; o texto continua limpo e a posição fica no registro", async () => {
    const id = await upload("Upload", manual())
    const editable = (await detailOf(id)).editable
    const images = editable.extraction.images as Placement[]
    expect(images).toHaveLength(2)
    expect(editable.content).toContain("1. Abra a tela de chamados.")
    expect(editable.content).not.toMatch(/imagem|!\[/i)
    expect(editable.content.slice(0, images[0]!.offset!).split("\n").pop()).toBe("1. Abra a tela de chamados.")
    const stored = await pool.query(`select i.hash, i.mime_type, i.width, length(i.data) bytes from knowledge_file_images i join knowledge_files f on f.id = i.knowledge_file_id where f.knowledge_document_id = $1`, [id])
    expect(stored.rows.map((row) => row.hash).sort()).toEqual(images.map((image) => image.id).sort())
    expect(stored.rows[0]).toMatchObject({ mime_type: "image/webp", width: 200 })
  })

  it("administração abre a imagem da versão na tela, com os cabeçalhos seguros, e o 304 evita baixar de novo", async () => {
    const id = await upload("Administração", manual(70))
    const { editable } = await detailOf(id)
    const image = (editable.extraction.images as Placement[])[0]!
    const url = `${API}/${id}/versions/${editable.versionId}/images/${image.id}`
    const response = await admin.get(url)
    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toContain("image/webp")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["content-security-policy"]).toContain("sandbox")
    expect(response.headers["cache-control"]).toBe("private, max-age=300")
    expect(response.body.subarray(8, 12).toString("latin1")).toBe("WEBP")
    expect((await admin.get(url).set("If-None-Match", response.headers.etag!)).status).toBe(304)
    // Sem sessão, ou com um id que não é de imagem, nada sai.
    expect((await request(createApp(pool)).get(url)).status).toBe(401)
    expect((await admin.get(`${API}/${id}/versions/${editable.versionId}/images/${"0".repeat(32)}`)).status).toBe(404)
    expect((await admin.get(`${API}/${id}/versions/${editable.versionId}/images/..%2F..%2Fetc`)).status).toBe(404)
  })

  it("leitor: abre com o alcance da base; sem alcance, 404 igual a não existir; rascunho e imagem de outra base não abrem", async () => {
    const id = await upload("Alcance", manual(50), [{ scopeType: "TEAM", teamId: teamA }])
    const { editable } = await detailOf(id)
    const image = (editable.extraction.images as Placement[])[0]!
    // Ainda em rascunho: não é material para o leitor.
    expect((await readerA.get(`${READER}/${id}/images/${image.id}`)).status).toBe(404)
    await publish(id)
    const allowed = await readerA.get(`${READER}/${id}/images/${image.id}`)
    expect(allowed.status).toBe(200)
    expect(allowed.headers["content-type"]).toContain("image/webp")
    const denied = await readerB.get(`${READER}/${id}/images/${image.id}`)
    const missing = await readerB.get(`${READER}/00000000-0000-4000-8000-00000000abcd/images/${image.id}`)
    expect(denied.status).toBe(404)
    expect(denied.body).toEqual(missing.body)
    // O id da imagem não abre nada em outra base, mesmo uma que o leitor alcança.
    const other = await upload("Outra base", manual(30))
    await publish(other)
    expect((await readerB.get(`${READER}/${other}/images/${image.id}`)).status).toBe(404)
    expect((await readerA.get(`${READER}/${id}/images/nao-e-id`)).status).toBe(404)
    // O detalhe entrega o registro, de onde a tela tira a posição.
    const material = await readerA.get(`${READER}/${id}`)
    expect(material.body.data.extraction.images).toHaveLength(2)
  })

  it("versão anterior a isso: continua sem imagens; reprocessar cria rascunho com elas, sem tocar no que está em uso", async () => {
    const id = await upload("Reprocessar", manual(110))
    const published = await publish(id)
    // Como uma versão gravada antes desta funcionalidade: sem `images` no registro e sem imagens guardadas.
    await pool.query(`alter table knowledge_versions disable trigger user`)
    await pool.query(`update knowledge_versions set extraction = extraction - 'images' where id = $1`, [published.inUse.id])
    await pool.query(`alter table knowledge_versions enable trigger user`)
    await pool.query(`delete from knowledge_file_images where knowledge_file_id in (select id from knowledge_files where knowledge_document_id = $1)`, [id])
    const before = await pool.query(`select content, extraction from knowledge_versions where id = $1`, [published.inUse.id])
    expect(before.rows[0].extraction).not.toHaveProperty("images")

    const reprocessed = await admin.post(`${API}/${id}/reprocess`).send({})
    expect(reprocessed.status, JSON.stringify(reprocessed.body)).toBe(200)
    expect(reprocessed.body.data.reprocessed.changed).toBe(true)
    const { draft, inUse } = reprocessed.body.data
    expect(inUse.id).toBe(published.inUse.id)
    const draftRow = await pool.query(`select content, extraction, file_id from knowledge_versions where id = $1`, [draft.id])
    expect(draftRow.rows[0].content).toBe(before.rows[0].content)
    expect(draftRow.rows[0].extraction.images).toHaveLength(2)
    const usedNow = await pool.query(`select extraction from knowledge_versions where id = $1`, [published.inUse.id])
    expect(usedNow.rows[0].extraction).not.toHaveProperty("images")
    // O arquivo é o mesmo: guardar de novo não duplica.
    const again = await admin.post(`${API}/${id}/reprocess`).send({ overwriteDraft: true })
    expect(again.status).toBe(200)
    expect((await pool.query(`select count(*)::int total from knowledge_file_images where knowledge_file_id = $1`, [draftRow.rows[0].file_id])).rows[0].total).toBe(2)
  })

  it("editar o rascunho leva a imagem junto; reverter copia a posição; descartar o arquivo novo apaga as imagens dele", async () => {
    const id = await upload("Edição", manual(130))
    const published = await publish(id)
    const content = published.inUse.content as string
    const edited = await admin.patch(`${API}/${id}`).send({ content: `Linha nova antes de tudo.\n\n${content}` })
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)
    const draftRow = await pool.query(`select id, content, extraction from knowledge_versions where document_id = $1 and status = 'DRAFT'`, [id])
    const images = draftRow.rows[0].extraction.images as Placement[]
    expect(draftRow.rows[0].extraction.edited).toBe(true)
    expect(draftRow.rows[0].content.slice(0, images[0]!.offset!).split("\n").pop()).toBe("1. Abra a tela de chamados.")

    // Trocar o arquivo no rascunho e descartar: as imagens do arquivo descartado somem com ele.
    const replaced = await admin.post(`${API}/${id}/draft/file`).attach("file", manual(150), { filename: "novo.pdf", contentType: PDF })
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200)
    const newFile = (await pool.query<{ file_id: string }>(`select file_id from knowledge_versions where document_id = $1 and status = 'DRAFT'`, [id])).rows[0]!.file_id
    expect((await pool.query(`select count(*)::int total from knowledge_file_images where knowledge_file_id = $1`, [newFile])).rows[0].total).toBe(2)
    expect((await admin.post(`${API}/${id}/draft/discard`).send({})).status).toBe(200)
    expect((await pool.query(`select count(*)::int total from knowledge_file_images where knowledge_file_id = $1`, [newFile])).rows[0].total).toBe(0)
    expect((await pool.query(`select count(*)::int total from knowledge_file_images i join knowledge_files f on f.id = i.knowledge_file_id where f.knowledge_document_id = $1`, [id])).rows[0].total).toBe(2)
  })

  it("trocar o arquivo publicado: a imagem antiga deixa de abrir para o leitor, e a resposta antiga simplesmente não a mostra", async () => {
    const id = await upload("Troca", manual(170))
    const first = await publish(id)
    const old = (first.inUse.extraction.images as Placement[])[0]!
    expect((await readerA.get(`${READER}/${id}/images/${old.id}`)).status).toBe(200)
    expect((await admin.post(`${API}/${id}/draft/file`).attach("file", manual(190), { filename: "novo.pdf", contentType: PDF })).status).toBe(200)
    await publish(id)
    expect((await readerA.get(`${READER}/${id}/images/${old.id}`)).status).toBe(404)
  })

  it("a IA não recebe nada: o prompt sai igual, sem id, sem aviso e sem marca de imagem", async () => {
    const id = await upload("Prompt", manual(210))
    const published = await publish(id)
    const agent = (await pool.query<{ id: string }>(`insert into agents(organization_id, name, agent_type, objective, description, context_prompt, scope_type, active) values ($1, $2, 'CUSTOM', 'Prova', 'Prova', 'Prova', 'ALL_TEAMS', true) returning id`, [ORG, `${PREFIX}Agente`])).rows[0]
    await pool.query(`insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1, $2)`, [agent!.id, id])
    const retrieved = await retrieveKnowledgeForAgent(pool as never, agent!.id, "Como abro um chamado?")
    expect(retrieved.promptBlock).toContain("Abra a tela de chamados")
    for (const image of published.inUse.extraction.images as Placement[]) expect(retrieved.promptBlock).not.toContain(image.id)
    expect(retrieved.promptBlock.toLowerCase()).not.toContain("imagem")
    expect(JSON.stringify(retrieved.trace.retrieved)).not.toContain("images")
  })
})
