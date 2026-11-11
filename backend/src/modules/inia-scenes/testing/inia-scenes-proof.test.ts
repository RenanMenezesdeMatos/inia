import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { localDateOf, localMomentOf } from "../domain/inia-scene.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

/**
 * PROVA do cenário da INIA contra o banco de TESTE real (API + permissões + regra de qual cenário vale hoje):
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run inia-scenes-proof
 * Só o Administrador geral configura (o Administrador comum, mesmo com escopo de organização, recebe 403); a operadora vê o
 * cenário que vale hoje e a imagem. Tudo o que a prova cria é apagado no fim (cenários "QA Cenário · …", concessão temporária).
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const PASSWORD = "Inia@123"
const ADMIN_GERAL = "carla.nunes@inia.com"
const ADMIN = "roberto.alves@inia.com"
const OPERATOR = "juliana.prado@inia.com"
const PREFIX = "QA Cenário · "
const OTHER_ORG = "00000000-0000-4000-8000-0000000000e7"

/** PNG mínimo (assinatura + IHDR): suficiente para a validação pelo conteúdo. */
function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0)
  data.writeUInt32BE(13, 8)
  data.write("IHDR", 12, "latin1")
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  // IEND: o removedor de metadados recusa PNG que não fecha (nunca grava os bytes originais).
  return Buffer.concat([data, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])])
}
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

let pool: pg.Pool
let app: ReturnType<typeof createApp>
let grantId: string | null = null
let today: string
const agents: Record<string, ReturnType<typeof request.agent>> = {}

async function cleanup() {
  await pool.query(`delete from inia_scene_settings where organization_id = $1`, [ORG])
  await pool.query(`delete from inia_scenes where organization_id in ($1, $3) and name like $2`, [ORG, `${PREFIX}%`, OTHER_ORG])
  await pool.query(`delete from organizations where id = $1`, [OTHER_ORG])
}

async function login(email: string) {
  await setProofAccountPassword(pool, email, PASSWORD)
  const agent = request.agent(app)
  const response = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD })
  expect(response.status).toBe(200)
  return agent
}

describe.skipIf(!ENABLED)("Cenário da INIA — só o Administrador geral configura; a operadora vê o que vale hoje (banco de teste real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    today = localDateOf(new Date(), await resolveOrganizationTimezone(pool, ORG))
    // Administrador COMUM com escopo de organização: tem configuration.manage, mas não inia_experience.manage.
    const account = (await pool.query<{ id: string }>(`select id from user_accounts where email = $1`, [ADMIN])).rows[0]!
    grantId = (await pool.query<{ id: string }>(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR', 'ORGANIZATION', now()) returning id`, [ORG, account.id])).rows[0]!.id
    app = createApp(pool)
    agents.geral = await login(ADMIN_GERAL)
    agents.admin = await login(ADMIN)
    agents.operator = await login(OPERATOR)
  })

  afterAll(async () => {
    await cleanup()
    if (grantId) await pool.query(`delete from access_role_assignments where id = $1`, [grantId])
    await pool.end()
  })

  it("capability e permissão: só o Administrador geral; Administrador comum e operadora recebem 403", async () => {
    const me = async (name: string) => (await agents[name]!.get("/api/v1/auth/me")).body.data.access.capabilities.canManageIniaScenes
    expect(await me("geral")).toBe(true)
    expect(await me("admin")).toBe(false)
    expect(await me("operator")).toBe(false)
    for (const name of ["admin", "operator"]) {
      expect((await agents[name]!.get("/api/v1/admin/inia-scenes")).status).toBe(403)
      expect((await agents[name]!.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Intruso`).attach("image", png(1920, 1080), "x.png")).status).toBe(403)
    }
    expect((await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene).toBeNull()
  })

  it("padrão, agendado no período, conflito de período/nome, imagem e volta ao padrão quando o agendamento sai", async () => {
    const geral = agents.geral!
    const created = await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Call center`).attach("image", png(1920, 1080), "call-center.png")
    expect(created.status).toBe(201)
    const callCenterId = created.body.data.id as string
    expect((await geral.put("/api/v1/admin/inia-scenes/default").send({ sceneId: callCenterId })).status).toBe(200)

    let current = (await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene
    // Sem desfoque informado = padrão 0,5 px.
    expect(current).toMatchObject({ id: callCenterId, name: `${PREFIX}Call center`, reason: "DEFAULT", width: 1920, height: 1080, blur: 0.5 })
    // Desfoque por cenário: ajustado na edição; fora de 0–3 px = 422 e nada muda.
    // Centésimos de px: o que o slider mostra é o que a coluna guarda.
    expect((await geral.patch(`/api/v1/admin/inia-scenes/${callCenterId}`).field("blur", "1.37")).status).toBe(200)
    expect((await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene.blur).toBe(1.37)
    expect((await geral.patch(`/api/v1/admin/inia-scenes/${callCenterId}`).field("blur", "5")).body.error.code).toBe("INIA_SCENE_BLUR_INVALID")
    expect((await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene.blur).toBe(1.37)

    // Agendado cobrindo HOJE (data local da organização) vence o padrão.
    const seasonal = await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Outubro Rosa`).field("scheduleStart", addDays(today, -1)).field("scheduleEnd", addDays(today, 1)).field("blur", "0").attach("image", png(1600, 900), "rosa.png")
    expect(seasonal.status).toBe(201)
    const seasonalId = seasonal.body.data.id as string
    current = (await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene
    expect(current).toMatchObject({ id: seasonalId, reason: "SCHEDULED", blur: 0 })
    const overview = (await geral.get("/api/v1/admin/inia-scenes")).body.data
    expect(overview.current).toMatchObject({ sceneId: seasonalId, reason: "SCHEDULED", imageReason: "PRIMARY" })
    // Agendados primeiro (pela data de início), sem período depois.
    expect(overview.scenes.map((scene: { name: string; status: string; isDefault: boolean }) => [scene.name, scene.status, scene.isDefault])).toEqual([[`${PREFIX}Outubro Rosa`, "LIVE", false], [`${PREFIX}Call center`, "STANDBY", true]])

    // Um dia em comum com outro período = conflito nomeado; nome repetido (sem diferenciar maiúsculas) = conflito.
    const overlap = await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Natal`).field("scheduleStart", addDays(today, 1)).field("scheduleEnd", addDays(today, 5)).attach("image", png(1920, 1080), "natal.png")
    expect(overlap.status).toBe(409)
    expect(overlap.body.error).toMatchObject({ code: "INIA_SCENE_PERIOD_OVERLAP", details: { conflictingSceneName: `${PREFIX}Outubro Rosa` } })
    const duplicate = await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}CALL CENTER`).attach("image", png(1920, 1080), "x.png")
    expect(duplicate.body.error.code).toBe("INIA_SCENE_NAME_TAKEN")

    // Imagem validada pelo conteúdo: retrato e SVG recusados; sem imagem = 422.
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Retrato`).attach("image", png(1080, 1920), "r.png")).body.error.code).toBe("SCENE_IMAGE_NOT_LANDSCAPE")
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Svg`).attach("image", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "x.png")).body.error.code).toBe("SCENE_IMAGE_UNSUPPORTED_TYPE")
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Sem imagem`)).body.error.code).toBe("INIA_SCENE_IMAGE_REQUIRED")
    // Campo fora do contrato (ex.: outra organização) é recusado.
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Org`).field("organizationId", "x").attach("image", png(1920, 1080), "x.png")).status).toBe(400)

    // A operadora busca a imagem do cenário que vale hoje (mesma organização); id desconhecido = 404. O endereço antigo
    // (`/:cenário/image`) continua servindo a imagem principal.
    const image = await agents.operator!.get(new URL(current.imageUrl, "http://x").pathname)
    expect(image.status).toBe(200)
    expect(image.headers["content-type"]).toBe("image/png")
    expect((await agents.operator!.get(`/api/v1/inia-scenes/${seasonalId}/image`)).status).toBe(200)
    expect((await agents.operator!.get("/api/v1/inia-scenes/00000000-0000-4000-8000-00000000dead/image")).status).toBe(404)
    expect((await agents.operator!.get("/api/v1/inia-scenes/images/00000000-0000-4000-8000-00000000dead")).status).toBe(404)

    // Tirar o agendamento: volta sozinho ao padrão. Trocar a imagem troca a URL (cache nunca serve a antiga).
    expect((await geral.patch(`/api/v1/admin/inia-scenes/${seasonalId}`).field("schedule", "clear")).status).toBe(200)
    expect((await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene).toMatchObject({ id: callCenterId, reason: "DEFAULT" })
    const before = (await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene.imageUrl
    expect((await geral.patch(`/api/v1/admin/inia-scenes/${callCenterId}`).attach("image", png(2560, 1440), "novo.png")).status).toBe(200)
    const after = (await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene
    expect(after.imageUrl).not.toBe(before)
    expect(after).toMatchObject({ width: 2560, height: 1440 })

    // Excluir o cenário padrão = palco de sempre (nenhum cenário).
    expect((await geral.delete(`/api/v1/admin/inia-scenes/${callCenterId}`)).status).toBe(200)
    expect((await agents.operator!.get("/api/v1/inia-scenes/current")).body.data.scene).toBeNull()

    const actions = (await pool.query<{ action: string }>(`select action from audit_logs where organization_id = $1 and entity_type = 'inia_scene' and (entity_id = $2 or entity_id = $3) order by created_at`, [ORG, callCenterId, seasonalId])).rows.map((row) => row.action)
    expect(actions).toEqual(["INIA_SCENE_CREATED", "INIA_SCENE_DEFAULT_CHANGED", "INIA_SCENE_UPDATED", "INIA_SCENE_CREATED", "INIA_SCENE_UPDATED", "INIA_SCENE_UPDATED", "INIA_SCENE_DELETED"])
  })

  it("várias imagens com faixas de horário: dia/noite, sobreposição recusada, troca atômica, escurecimento e imagem por id", async () => {
    const geral = agents.geral!
    const timeZone = await resolveOrganizationTimezone(pool, ORG)
    const manifest = (entries: Array<Record<string, unknown>>) => JSON.stringify(entries)
    const dayNight = [{ label: "Dia", start: "06:00", end: "18:00", primary: true, file: "file-0" }, { label: "Noite", start: "18:00", end: "06:00", primary: false, file: "file-1" }]

    // Sobreposição (17:00–06:00 encosta no dia) = 422 nomeando as duas imagens; nada é criado.
    const overlapping = await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Sobreposto`).field("images", manifest([dayNight[0]!, { ...dayNight[1]!, start: "17:00" }])).attach("file-0", png(1920, 1080), "dia.png").attach("file-1", png(1920, 1080), "noite.png")
    expect(overlapping.status).toBe(422)
    expect(overlapping.body.error).toMatchObject({ code: "INIA_SCENE_IMAGE_SLOT_OVERLAP", message: 'Os horários de "Dia" e "Noite" se sobrepõem das 17:00 às 18:00. Ajuste as faixas para não coincidirem.', details: { imageIndexes: [0, 1] } })
    // Sem principal, arquivo não referenciado e faixa inválida também são recusados.
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Sem principal`).field("images", manifest(dayNight.map((entry) => ({ ...entry, primary: false })))).attach("file-0", png(1920, 1080), "a.png").attach("file-1", png(1920, 1080), "b.png")).body.error.code).toBe("INIA_SCENE_PRIMARY_IMAGE_REQUIRED")
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Sobra`).field("images", manifest([dayNight[0]!])).attach("file-0", png(1920, 1080), "a.png").attach("file-1", png(1920, 1080), "b.png")).body.error.code).toBe("INIA_SCENE_IMAGES_INVALID")
    expect((await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Faixa`).field("images", manifest([{ ...dayNight[0]!, end: "06:00" }])).attach("file-0", png(1920, 1080), "a.png")).body.error.code).toBe("SCENE_SLOT_EMPTY")
    expect((await pool.query(`select count(*)::int n from inia_scenes where organization_id = $1 and name = any($2)`, [ORG, ["Sobreposto", "Sem principal", "Sobra", "Faixa"].map((name) => `${PREFIX}${name}`)])).rows[0].n).toBe(0)

    // Padrão com dia (1920) e noite (1600), escurecimento 35 %.
    const created = await geral.post("/api/v1/admin/inia-scenes").field("name", `${PREFIX}Padrão dia e noite`).field("dim", "35").field("images", manifest(dayNight)).attach("file-0", png(1920, 1080), "dia.png").attach("file-1", png(1600, 900), "noite.png")
    expect(created.status).toBe(201)
    const sceneId = created.body.data.id as string
    expect((await geral.put("/api/v1/admin/inia-scenes/default").send({ sceneId })).status).toBe(200)
    const overview = (await geral.get("/api/v1/admin/inia-scenes")).body.data
    const summary = overview.scenes.find((scene: { id: string }) => scene.id === sceneId)
    expect(summary).toMatchObject({ dim: 35, blur: 0.5, images: [{ label: "Dia", start: "06:00", end: "18:00", isPrimary: true, width: 1920 }, { label: "Noite", start: "18:00", end: "06:00", isPrimary: false, width: 1600 }] })

    // O que a operadora vê depende do horário LOCAL de agora; `nextChangeAt` é a próxima troca (06:00 ou 18:00 locais).
    const minute = localMomentOf(new Date(), timeZone).minute
    const expectedLabel = minute >= 360 && minute < 1080 ? "Dia" : "Noite"
    const state = (await agents.operator!.get("/api/v1/inia-scenes/current")).body.data
    expect(state.scene).toMatchObject({ id: sceneId, reason: "DEFAULT", imageReason: "SLOT", imageLabel: expectedLabel, dim: 35 })
    expect(state.upcoming.imageUrl).not.toBe(state.scene.imageUrl)
    const nextLocal = localMomentOf(new Date(state.nextChangeAt), timeZone)
    expect(nextLocal.minute).toBe(expectedLabel === "Dia" ? 1080 : 360)
    expect(Date.parse(state.nextChangeAt)).toBeGreaterThan(Date.parse(state.now))
    expect(Date.parse(state.nextChangeAt) - Date.parse(state.now)).toBeLessThanOrEqual(12 * 60 * 60_000)
    // A imagem é servida pelo id dela; a URL muda quando o arquivo muda.
    const served = await agents.operator!.get(new URL(state.scene.imageUrl, "http://x").pathname)
    expect(served.status).toBe(200)

    // Troca ATÔMICA: trocar a noite por um arquivo inválido falha e nada muda (nem o rótulo, nem o escurecimento).
    const [day, night] = summary.images as Array<{ id: string; imageUrl: string }>
    const broken = await geral.patch(`/api/v1/admin/inia-scenes/${sceneId}`).field("dim", "80").field("images", manifest([{ id: day!.id, label: "Manhã", start: "06:00", end: "18:00", primary: true }, { id: night!.id, label: "Noite", start: "18:00", end: "06:00", primary: false, file: "file-0" }])).attach("file-0", png(1080, 1920), "retrato.png")
    expect(broken.body.error).toMatchObject({ code: "SCENE_IMAGE_NOT_LANDSCAPE", details: { imageIndex: 1 } })
    const unchanged = (await geral.get("/api/v1/admin/inia-scenes")).body.data.scenes.find((scene: { id: string }) => scene.id === sceneId)
    expect(unchanged.dim).toBe(35)
    expect(unchanged.images.map((image: { label: string }) => image.label)).toEqual(["Dia", "Noite"])

    // Troca válida numa transação: a noite vira a principal, ganha um arquivo novo, entra uma terceira imagem (tarde) e o
    // escurecimento sobe para 80 %. Trocar "Dia" ⇄ principal não esbarra nos índices únicos.
    const updated = await geral.patch(`/api/v1/admin/inia-scenes/${sceneId}`).field("dim", "80").field("images", manifest([
      { id: day!.id, label: "Manhã", start: "06:00", end: "12:00", primary: false },
      { label: "Tarde", start: "12:00", end: "18:00", primary: false, file: "file-0" },
      { id: night!.id, label: "Noite", start: "18:00", end: "06:00", primary: true, file: "file-1" },
    ])).attach("file-0", png(2000, 1000), "tarde.png").attach("file-1", png(2560, 1440), "noite-nova.png")
    expect(updated.status).toBe(200)
    const after = updated.body.data.scenes.find((scene: { id: string }) => scene.id === sceneId)
    expect(after.dim).toBe(80)
    expect(after.images.map((image: { label: string; start: string; isPrimary: boolean; width: number }) => [image.label, image.start, image.isPrimary, image.width])).toEqual([["Manhã", "06:00", false, 1920], ["Tarde", "12:00", false, 2000], ["Noite", "18:00", true, 2560]])
    expect(after.images[2].imageUrl).not.toBe(night!.imageUrl)
    expect(after.imageUrl).toBe(after.images[2].imageUrl)
    // Remover a tarde: a imagem sai do banco junto com a troca.
    const removed = await geral.patch(`/api/v1/admin/inia-scenes/${sceneId}`).field("images", manifest([{ id: day!.id, label: "Dia", start: "06:00", end: "18:00", primary: true }, { id: night!.id, label: "Noite", start: "18:00", end: "06:00", primary: false }]))
    expect(removed.status).toBe(200)
    expect((await pool.query(`select count(*)::int n from inia_scene_images where scene_id = $1`, [sceneId])).rows[0].n).toBe(2)
    // Fora do contrato: imagem de outro cenário no manifesto = 409; escurecimento fora de 0–100 = 422.
    expect((await geral.patch(`/api/v1/admin/inia-scenes/${sceneId}`).field("images", manifest([{ id: "00000000-0000-4000-8000-00000000beef", label: "Outra", primary: true }]))).status).toBe(409)
    expect((await geral.patch(`/api/v1/admin/inia-scenes/${sceneId}`).field("dim", "120")).body.error.code).toBe("INIA_SCENE_DIM_INVALID")

    const audit = (await pool.query<{ payload: { dim?: number; images?: unknown[]; removedImages?: Array<{ label: string }> } }>(`select payload from audit_logs where organization_id = $1 and entity_type = 'inia_scene' and entity_id = $2 and action = 'INIA_SCENE_UPDATED' order by created_at`, [ORG, sceneId])).rows
    expect(audit[0]!.payload).toMatchObject({ dim: 80 })
    expect(audit[1]!.payload.removedImages).toEqual([expect.objectContaining({ label: "Tarde" })])
  })

  it("isolamento e consistência no banco: imagem de outra organização = 404; cenário nunca fica sem principal", async () => {
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Outra organização (QA)', 'qa-outra-org-cenarios') on conflict do nothing`, [OTHER_ORG])
    const client = await pool.connect()
    let foreignImageId: string
    try {
      await client.query("begin")
      const scene = (await client.query<{ id: string }>(`insert into inia_scenes (organization_id, name) values ($1, $2) returning id`, [OTHER_ORG, `${PREFIX}Outra org`])).rows[0]!
      foreignImageId = (await client.query<{ id: string }>(`insert into inia_scene_images (organization_id, scene_id, label, is_primary, mime_type, byte_size, width, height, sha256, data) values ($1, $2, 'Principal', true, 'image/png', 33, 1920, 1080, repeat('a', 64), $3) returning id`, [OTHER_ORG, scene.id, png(1920, 1080)])).rows[0]!.id
      await client.query("commit")
    } finally {
      client.release()
    }
    expect((await agents.operator!.get(`/api/v1/inia-scenes/images/${foreignImageId}`)).status).toBe(404)

    // Gatilho adiado: cenário sem imagem, ou com duas principais, não chega ao commit.
    const orphan = pool.query(`with scene as (insert into inia_scenes (organization_id, name) values ($1, $2) returning id) select id from scene`, [ORG, `${PREFIX}Sem imagem`])
    await expect(orphan).rejects.toMatchObject({ code: "23514" })
    const sceneRow = (await pool.query<{ id: string }>(`select s.id from inia_scenes s where s.organization_id = $1 and s.name = $2`, [OTHER_ORG, `${PREFIX}Outra org`])).rows[0]!
    const withoutPrimary = pool.query(`update inia_scene_images set is_primary = false where scene_id = $1`, [sceneRow.id])
    await expect(withoutPrimary).rejects.toMatchObject({ code: "23514" })
  })
})
