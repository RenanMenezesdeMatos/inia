import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * PDF digitalizado no fluxo real, contra o banco de teste e com o motor de OCR de verdade (nenhuma IA é chamada).
 *
 *   INIA_DB_PROOF=1 npx vitest run knowledge-ocr-proof
 *
 * O envio cria o rascunho e a fila de leitura; enquanto lê, publicar e editar o texto são recusados; a leitura grava o texto, as imagens cortadas e o
 * registro no MESMO rascunho; rascunho trocado ou alterado no meio não recebe o texto; sem o motor, a leitura falha com o motivo.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { runOcrQueueFor } = await import("./ocr-queue.js")
const { buildFixturePdf, grayImage, paragraph } = await import("./pdf-layout-fixture.js")
const { buildScannedPdf } = await import("./scanned-pdf-fixture.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const PREFIX = "Prova OCR PDF · "
const API = "/api/v1/admin/knowledge"
const READER = "/api/v1/knowledge-materials"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const PDF = "application/pdf"

type Page = Parameters<typeof buildFixturePdf>[0][number]
const RULES = "A devolução atrasada de equipamento gera multa de R$ 210,00 por item, cobrada na fatura seguinte ao fim do prazo de 30 dias corridos."
const scannedPage = (): Page => {
  const first = paragraph(RULES, { x: 56, y: 130, width: 480 })
  return [{ kind: "text", x: 56, y: 80, text: "Regulamento de devolução", size: 18, font: "bold" }, ...first.ops, { kind: "image", x: 56, y: first.y + 20, width: 300, height: 150, image: grayImage(300, 150, 90) }]
}

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>

async function cleanup() {
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from knowledge_ocr_jobs where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_versions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_definitions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_change_sets where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from audit_logs where entity_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
}

const upload = async (title: string, file: Buffer) => {
  const response = await admin.post(API).field("title", `${PREFIX}${title}`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }])).field("subjectScopes", JSON.stringify([{ scopeType: "ALL_SUBJECTS" }])).attach("file", file, { filename: "digitalizado.pdf", contentType: PDF })
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return response.body.data as { id: string; ocr: { status: string; pages: number } | null }
}
const detailOf = async (id: string) => (await admin.get(`${API}/${id}`)).body.data
/** Só os documentos desta prova: a fila do banco de teste pode ter leituras de outras provas, que ficam como estão. */
const runQueue = (deps: Parameters<typeof runOcrQueueFor>[2] = {}) => runOcrQueueFor(pool, PREFIX, deps)
const jobOf = async (documentId: string) => (await pool.query<{ status: string; error_code: string | null; error_message: string | null }>(`select status, error_code, error_message from knowledge_ocr_jobs where document_id = $1 order by created_at desc limit 1`, [documentId])).rows[0]

describe.runIf(ENABLED)("PDF digitalizado (OCR) no fluxo real", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    await cleanup()
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    admin = request.agent(createApp(pool))
    expect((await admin.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("envio: o PDF só de imagem vira rascunho sem texto e a leitura entra na fila; publicar e editar o texto esperam", async () => {
    const created = await upload("Fila", await buildScannedPdf([scannedPage()]))
    expect(created.ocr).toEqual({ status: "QUEUED", pages: 1 })
    const detail = await detailOf(created.id)
    expect(detail.draft).toMatchObject({ content: "", textAvailable: false })
    expect(detail.draft.ocr).toMatchObject({ status: "QUEUED", pagesTotal: 1, pagesDone: 0 })
    const publish = await admin.post(`${API}/${created.id}/publish`).send({})
    expect(publish.status).toBe(409)
    expect(publish.body.error.code).toBe("KNOWLEDGE_OCR_RUNNING")
    const edit = await admin.patch(`${API}/${created.id}`).send({ content: "Texto digitado no meio da leitura." })
    expect(edit.status).toBe(409)
    expect(edit.body.error.code).toBe("KNOWLEDGE_OCR_RUNNING")
    // Trocar só o título não mexe no texto que está sendo lido.
    expect((await admin.patch(`${API}/${created.id}`).send({ title: `${PREFIX}Fila (título novo)` })).status).toBe(200)
  })

  it("a leitura grava o texto, a imagem cortada e o registro no mesmo rascunho; depois disso, publica normalmente", async () => {
    const created = await upload("Leitura", await buildScannedPdf([scannedPage()]))
    const draftBefore = (await detailOf(created.id)).draft
    expect(await runQueue()).toBeGreaterThanOrEqual(1)
    const detail = await detailOf(created.id)
    expect(detail.draft.id).toBe(draftBefore.id)
    expect(detail.draft.ocr).toMatchObject({ status: "DONE" })
    expect(detail.draft.textAvailable).toBe(true)
    expect(detail.draft.content).toContain("30 dias corridos")
    expect(detail.draft.content).toContain("R$ 210,00")
    expect(detail.draft.extraction.ocr).toMatchObject({ version: "PDF_OCR_V1", pages: [1], prints: 1 })
    const imageId = detail.draft.extraction.images[0].id as string
    const stored = await pool.query(`select i.hash from knowledge_file_images i join knowledge_versions v on v.file_id = i.knowledge_file_id where v.id = $1`, [detail.draft.id])
    expect(stored.rows.map((row) => row.hash)).toContain(imageId)
    const audit = await pool.query(`select payload from audit_logs where entity_id = $1 and action = 'KNOWLEDGE_OCR_COMPLETED'`, [created.id])
    expect(audit.rows[0]?.payload).toMatchObject({ pagesRead: 1, prints: 1 })

    const published = await admin.post(`${API}/${created.id}/publish`).send({})
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    expect(published.body.data.inUse.content).toContain("30 dias corridos")
    const material = await admin.get(`${READER}/${created.id}`)
    expect(material.status).toBe(200)
    expect(JSON.stringify(material.body)).toContain("PDF_OCR_V1")
  })

  it("rascunho alterado por fora no meio da leitura não recebe o texto", async () => {
    const created = await upload("Alterado", await buildScannedPdf([scannedPage()]))
    const draftId = (await detailOf(created.id)).draft.id as string
    await pool.query(`update knowledge_versions set content = 'Texto que alguém gravou direto.', content_hash = md5('x') where id = $1`, [draftId])
    await runQueue()
    expect(await jobOf(created.id)).toMatchObject({ status: "CANCELLED", error_code: "KNOWLEDGE_OCR_DRAFT_CHANGED" })
    expect((await detailOf(created.id)).draft.content).toBe("Texto que alguém gravou direto.")
  })

  it("trocar o arquivo do rascunho encerra a leitura do anterior; reprocessar pede uma leitura nova", async () => {
    const created = await upload("Troca", await buildScannedPdf([scannedPage()]))
    // Publica primeiro uma versão com texto, para ter o que trocar no rascunho.
    await pool.query(`update knowledge_ocr_jobs set status = 'CANCELLED' where document_id = $1`, [created.id])
    expect((await admin.patch(`${API}/${created.id}`).send({ content: "Versão digitada para publicar antes da troca." })).status).toBe(200)
    expect((await admin.post(`${API}/${created.id}/publish`).send({})).status).toBe(200)

    const replaced = await admin.post(`${API}/${created.id}/draft/file`).attach("file", await buildScannedPdf([scannedPage()]), { filename: "nova.pdf", contentType: PDF })
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200)
    expect(replaced.body.data.draft.ocr).toMatchObject({ status: "QUEUED" })
    const withText = await admin.post(`${API}/${created.id}/draft/file`).attach("file", buildFixturePdf([paragraph("Agora o PDF tem texto selecionável.", { x: 56, y: 100, width: 480 }).ops]), { filename: "texto.pdf", contentType: PDF })
    expect(withText.status).toBe(200)
    const jobs = (await pool.query<{ status: string; error_code: string | null }>(`select status, error_code from knowledge_ocr_jobs where document_id = $1 order by created_at`, [created.id])).rows
    expect(jobs.at(-1)).toEqual({ status: "CANCELLED", error_code: "KNOWLEDGE_OCR_REPLACED" })
    expect(withText.body.data.draft.ocr).toMatchObject({ status: "CANCELLED" })

    const back = await admin.post(`${API}/${created.id}/draft/file`).attach("file", await buildScannedPdf([scannedPage()]), { filename: "de-novo.pdf", contentType: PDF })
    await pool.query(`update knowledge_ocr_jobs set status = 'CANCELLED' where document_id = $1 and status = 'QUEUED'`, [created.id])
    expect(back.status).toBe(200)
    const reprocessed = await admin.post(`${API}/${created.id}/reprocess`).send({ overwriteDraft: true })
    expect(reprocessed.status, JSON.stringify(reprocessed.body)).toBe(200)
    expect(reprocessed.body.data.reprocessed.ocrPages).toBe(1)
    expect(reprocessed.body.data.draft.ocr).toMatchObject({ status: "QUEUED" })
  })

  it("sem os arquivos do motor, a leitura falha com o motivo e o rascunho fica como estava", async () => {
    const created = await upload("Sem motor", await buildScannedPdf([scannedPage()]))
    await runQueue({ engineDirectory: "/nao/existe/" })
    const job = await jobOf(created.id)
    expect(job).toMatchObject({ status: "FAILED", error_code: "KNOWLEDGE_OCR_UNAVAILABLE" })
    expect(job!.error_message).toMatch(/backend\/vendor\/tesseract/)
    expect((await detailOf(created.id)).draft).toMatchObject({ content: "", ocr: { status: "FAILED" } })
  })
})
