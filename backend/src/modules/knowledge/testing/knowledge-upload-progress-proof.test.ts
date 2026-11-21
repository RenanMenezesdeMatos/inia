import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Andamento do envio de arquivo de base (migration 243) no fluxo real, contra o banco de teste (nada chama a IA).
 *
 *   INIA_DB_PROOF=1 npx vitest run knowledge-upload-progress-proof
 *
 * O envio grava cada etapa; a tela consulta pelo id que gerou e vê o estado real: PDF com print (texto, imagens, Markdown, gravação), DOCX (sem
 * imagens, Markdown nem OCR), PDF digitalizado (OCR na fila e depois lido pela fila de verdade), arquivo recusado (a etapa que falhou com o motivo e
 * nada aguardando à toa), troca de arquivo do rascunho, e o envio de outra conta não aparece.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { buildFixturePdf, grayImage, paragraph } = await import("./pdf-layout-fixture.js")
const { buildScannedPdf } = await import("./scanned-pdf-fixture.js")
const { docxWithLines, DOCX_CONTENT_TYPE } = await import("./knowledge-file-fixtures.js")
const { runOcrQueueFor } = await import("./ocr-queue.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const PREFIX = "Prova Envio Etapas · "
const API = "/api/v1/admin/knowledge"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const PDF = "application/pdf"

type Stage = { key: string; state: string; detail: string | null; warning: string | null; errorCode: string | null; errorMessage: string | null; progress: { done: number; total: number } | null }
type Run = { id: string; kind: string; status: string; finished: boolean; documentId: string | null; filename: string; sourceType: string; errorCode: string | null; errorMessage: string | null; stages: Stage[] }

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>

async function cleanup() {
  const documents = (await pool.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and title like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from knowledge_upload_runs where document_id = any($1::uuid[]) or title like $2`, [documents, `${PREFIX}%`])
  await pool.query(`delete from knowledge_ocr_jobs where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_versions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_definitions where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from checkpoint_change_sets where knowledge_document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from audit_logs where entity_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
  await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
}

const send = (title: string, file: Buffer, filename: string, contentType: string, uploadId: string) =>
  admin.post(API).field("uploadId", uploadId).field("title", `${PREFIX}${title}`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }])).field("subjectScopes", JSON.stringify([{ scopeType: "ALL_SUBJECTS" }])).attach("file", file, { filename, contentType })

const runOf = async (id: string): Promise<Run> => {
  const response = await admin.get(`${API}/uploads/${id}`)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.data as Run
}
const states = (run: Run) => Object.fromEntries(run.stages.map((stage) => [stage.key, stage.state]))
const stage = (run: Run, key: string) => run.stages.find((item) => item.key === key)!

const manual = () => buildFixturePdf([[
  { kind: "text", x: 56, y: 80, text: "Como abrir o chamado", size: 16, font: "bold" },
  { kind: "text", x: 56, y: 120, text: "1. Abra a tela de chamados." },
  { kind: "image", x: 56, y: 140, width: 300, height: 150, image: grayImage(200, 100, 90) },
  { kind: "text", x: 56, y: 320, text: "2. Clique em Novo chamado." },
]])
const RULES = "A devolução atrasada de equipamento gera multa de R$ 210,00 por item, cobrada na fatura seguinte ao fim do prazo de 30 dias corridos."
const scannedPage = () => {
  const first = paragraph(RULES, { x: 56, y: 130, width: 480 })
  return [{ kind: "text" as const, x: 56, y: 80, text: "Regulamento de devolução", size: 18, font: "bold" as const }, ...first.ops]
}

describe.runIf(ENABLED)("andamento do envio de arquivo de base no fluxo real", () => {
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

  it("PDF com print: cada etapa concluída com o que achou, a base ligada ao envio e nada mais a esperar", async () => {
    const uploadId = randomUUID()
    const response = await send("Manual", manual(), "manual.pdf", PDF, uploadId)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    const run = await runOf(uploadId)
    expect(run).toMatchObject({ kind: "CREATE", status: "DONE", finished: true, documentId: response.body.data.id, filename: "manual.pdf", sourceType: "PDF" })
    expect(states(run)).toEqual({ CHECK: "DONE", TEXT: "DONE", IMAGES: "DONE", MARKDOWN: "DONE", SAVE: "DONE", OCR: "SKIPPED" })
    expect(stage(run, "TEXT").detail).toBe("1 página lida.")
    expect(stage(run, "IMAGES").detail).toBe("1 imagem separada e posicionada no texto.")
    expect(stage(run, "OCR").detail).toMatch(/Nenhuma página digitalizada/)
    // Voltar depois: o envio está na lista da conta e na da base.
    const recent = (await admin.get(`${API}/uploads`)).body.data as Run[]
    expect(recent.map((item) => item.id)).toContain(uploadId)
    expect(((await admin.get(`${API}/uploads?documentId=${run.documentId}`)).body.data as Run[]).map((item) => item.id)).toEqual([uploadId])
  })

  it("DOCX: texto extraído e gravado; imagens, Markdown e OCR aparecem como não aplicáveis, nunca como concluídos", async () => {
    const uploadId = randomUUID()
    const response = await send("Procedimento", docxWithLines(["Confirme o e-mail.", "Encerre o atendimento."]), "procedimento.docx", DOCX_CONTENT_TYPE, uploadId)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    const run = await runOf(uploadId)
    expect(run).toMatchObject({ status: "DONE", finished: true, sourceType: "DOCX" })
    expect(states(run)).toEqual({ CHECK: "DONE", TEXT: "DONE", IMAGES: "SKIPPED", MARKDOWN: "SKIPPED", SAVE: "DONE", OCR: "SKIPPED" })
  })

  it("PDF digitalizado: gravado com o OCR na fila; a etapa acompanha a fila de verdade até concluir", async () => {
    const uploadId = randomUUID()
    const response = await send("Digitalizado", await buildScannedPdf([scannedPage()]), "digitalizado.pdf", PDF, uploadId)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    const queued = await runOf(uploadId)
    expect(queued).toMatchObject({ status: "DONE", finished: false })
    expect(stage(queued, "TEXT").detail).toBe("1 página lida, 1 digitalizada (sem texto selecionável).")
    expect(stage(queued, "OCR")).toMatchObject({ state: "PENDING", detail: "1 página digitalizada na fila de leitura." })

    // Lendo: o andamento é o que a fila grava.
    await pool.query(`update knowledge_ocr_jobs set status = 'RUNNING', stage = 'READING', pages_done = 0, lease_until = null where document_id = $1`, [queued.documentId])
    expect(stage(await runOf(uploadId), "OCR")).toMatchObject({ state: "RUNNING", progress: { done: 0, total: 1 } })
    await pool.query(`update knowledge_ocr_jobs set status = 'QUEUED', stage = null, attempts = 0 where document_id = $1`, [queued.documentId])

    expect(await runOcrQueueFor(pool, PREFIX)).toBeGreaterThan(0)
    const read = await runOf(uploadId)
    expect(read).toMatchObject({ status: "DONE", finished: true })
    expect(stage(read, "OCR")).toMatchObject({ state: "DONE", detail: expect.stringContaining("1 página lida") })
  })

  it("arquivo recusado: a conferência falha com o motivo, o resto fica como não feito e a base não existe", async () => {
    const uploadId = randomUUID()
    const response = await send("Falso", Buffer.from("isto não é um PDF de verdade"), "falso.pdf", PDF, uploadId)
    expect(response.status).toBe(422)
    const run = await runOf(uploadId)
    expect(run).toMatchObject({ status: "FAILED", finished: true, documentId: null, errorCode: "KNOWLEDGE_FILE_TYPE_MISMATCH" })
    expect(states(run)).toEqual({ CHECK: "FAILED", TEXT: "SKIPPED", IMAGES: "SKIPPED", MARKDOWN: "SKIPPED", SAVE: "SKIPPED", OCR: "SKIPPED" })
    expect(stage(run, "CHECK")).toMatchObject({ errorCode: "KNOWLEDGE_FILE_TYPE_MISMATCH", errorMessage: response.body.error.message })
  })

  it("trocar o arquivo do rascunho também é acompanhado, ligado à base", async () => {
    const created = await send("Troca", docxWithLines(["Versão um do procedimento."]), "v1.docx", DOCX_CONTENT_TYPE, randomUUID())
    expect(created.status).toBe(201)
    const uploadId = randomUUID()
    const replaced = await admin.post(`${API}/${created.body.data.id}/draft/file`).field("uploadId", uploadId).attach("file", manual(), { filename: "v2.pdf", contentType: PDF })
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200)
    const run = await runOf(uploadId)
    expect(run).toMatchObject({ kind: "REPLACE_FILE", status: "DONE", finished: true, documentId: created.body.data.id, sourceType: "PDF" })
    expect(states(run)).toMatchObject({ TEXT: "DONE", IMAGES: "DONE", MARKDOWN: "DONE", SAVE: "DONE" })
  })

  it("sem id o envio funciona como antes; id repetido não sobrescreve; envio de outra conta não aparece", async () => {
    const plain = await admin.post(API).field("title", `${PREFIX}Sem id`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }])).field("subjectScopes", JSON.stringify([{ scopeType: "ALL_SUBJECTS" }])).attach("file", manual(), { filename: "sem-id.pdf", contentType: PDF })
    expect(plain.status).toBe(201)

    const uploadId = randomUUID()
    expect((await send("Primeiro", manual(), "primeiro.pdf", PDF, uploadId)).status).toBe(201)
    expect((await send("Repetido", manual(), "repetido.pdf", PDF, uploadId)).status).toBe(201)
    expect((await runOf(uploadId)).filename).toBe("primeiro.pdf")

    const other = (await pool.query<{ id: string }>(`select id from user_accounts where organization_id = $1 and email <> $2 order by email limit 1`, [ORG, ADMIN.email])).rows[0]!.id
    await pool.query(`update knowledge_upload_runs set account_id = $2 where id = $1`, [uploadId, other])
    expect((await admin.get(`${API}/uploads/${uploadId}`)).status).toBe(404)
    expect(((await admin.get(`${API}/uploads`)).body.data as Run[]).map((item) => item.id)).not.toContain(uploadId)
    expect((await admin.get(`${API}/uploads/nao-e-um-id`)).status).toBe(404)
  })
})
