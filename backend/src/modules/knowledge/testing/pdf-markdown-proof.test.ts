import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * PDF → Markdown no fluxo real, contra o banco de teste (provedor nenhum: nada aqui chama a IA).
 *
 *   INIA_DB_PROOF=1 npx vitest run pdf-markdown-proof
 *
 * Upload, publicação, trechos com página na busca, prévia do que a IA lê, reprocessamento (só rascunho, versão em uso intacta), comparação de
 * versões do mesmo arquivo, edição do texto e imutabilidade do registro. Página digitalizada passa pela leitura (OCR) antes de seguir, como no fluxo
 * real antes de publicar; a leitura em si está em knowledge-ocr-proof.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { retrieveKnowledgeForAgent } = await import("../application/retrieve-knowledge.js")
const { buildFixturePdf, gridTable, grayImage, PAGE_HEIGHT, PAGE_WIDTH, paragraph } = await import("./pdf-layout-fixture.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { runOcrQueueFor } = await import("./ocr-queue.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const PREFIX = "Prova PDF Markdown · "
const API = "/api/v1/admin/knowledge"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const PDF = "application/pdf"

type Op = Parameters<typeof buildFixturePdf>[0][number][number]
const mixedPdf = () =>
  buildFixturePdf([
    [{ kind: "text", x: 56, y: 80, text: "Manual de prova", size: 20, font: "bold" }, { kind: "text", x: 56, y: 120, text: "1. Prazos", size: 14, font: "bold" }, ...gridTable([["Produto", "Prazo"], ["Fibra", "24 horas"], ["Cabo", "48 horas"]], { x: 56, y: 140, columnWidths: [200, 200], style: "stroke" }).ops] as Op[],
    [{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: grayImage() }] as Op[],
    [{ kind: "text", x: 56, y: 80, text: "2. Encerramento", size: 14, font: "bold" }, ...paragraph("O atendimento termina depois de informar o protocolo ao cliente e registrar o aceite no sistema.", { x: 56, y: 110, width: 480 }).ops] as Op[],
  ])
const scannedPdf = () => buildFixturePdf([[{ kind: "image", x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, image: grayImage() }]])

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>

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
}

const upload = async (title: string, file: Buffer) => {
  const response = await admin.post(API).field("title", `${PREFIX}${title}`).field("documentType", "MANUAL").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }])).attach("file", file, { filename: `${title}.pdf`, contentType: PDF })
  // Com página digitalizada, a leitura (OCR) termina antes de seguir: publicar e editar o texto esperam por ela.
  if (response.status === 201 && response.body.data.ocr) await runOcrQueueFor(pool, PREFIX)
  return response
}
const detailOf = async (id: string) => (await admin.get(`${API}/${id}`)).body.data
const publish = async (id: string) => {
  const response = await admin.post(`${API}/${id}/publish`).send({})
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  expect(response.body.data.inUse, JSON.stringify(response.body.data.updates)).not.toBeNull()
  return response.body.data
}
type ExtractionPage = { page: number; status: string; offset: number | null }

describe.runIf(ENABLED)("PDF → Markdown no fluxo real", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 2 })
    await cleanup()
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    admin = request.agent(createApp())
    const login = await admin.post("/api/v1/auth/login").send(ADMIN)
    expect(login.status, JSON.stringify(login.body)).toBe(200)
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("upload: o conteúdo é Markdown, o arquivo fica intacto e a cobertura aponta a página digitalizada", async () => {
    const file = mixedPdf()
    const created = await upload("Misto", file)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const detail = await detailOf(created.body.data.id)
    expect(detail.editable.content).toContain("# Manual de prova")
    expect(detail.editable.content).toContain("| Fibra | 24 horas |")
    // A página 2 é uma imagem lisa, sem camada de texto: passou pelo OCR, que não achou tinta nem texto nela, e por isso ela conta como em branco.
    expect(detail.editable.extraction.pages.map((page: ExtractionPage) => page.status)).toEqual(["TEXT", "BLANK", "TEXT"])
    expect(detail.editable.extraction.ocr.pages).toEqual([2])
    const original = await admin.get(`${API}/${created.body.data.id}/file`).buffer(true).parse((response, done) => {
      const parts: Buffer[] = []
      response.on("data", (part: Buffer) => parts.push(part))
      response.on("end", () => done(null, Buffer.concat(parts)))
    })
    expect(Buffer.compare(original.body as Buffer, file)).toBe(0)
  })

  it("PDF sem texto em nenhuma página vira rascunho com a leitura por OCR; sem nada para ler, a leitura termina com o motivo e o rascunho fica sem texto", async () => {
    const response = await upload("So imagem", scannedPdf())
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    expect(response.body.data.ocr).toEqual({ status: "QUEUED", pages: 1 })
    const draft = (await detailOf(response.body.data.id)).draft
    expect(draft).toMatchObject({ content: "", textAvailable: false })
    expect(draft.ocr).toMatchObject({ status: "FAILED", errorCode: "KNOWLEDGE_OCR_NO_TEXT" })
  })

  it("publicada: a busca entrega o trecho com a página, o prompt mostra a página e a prévia mostra os mesmos trechos", async () => {
    const created = await upload("Busca", mixedPdf())
    const id = created.body.data.id as string
    const published = await publish(id)
    const [agent] = (await pool.query<{ id: string }>(`insert into agents(organization_id, name, agent_type, objective, description, context_prompt, scope_type, active) values ($1, $2, 'CUSTOM', 'Prova', 'Prova', 'Prova', 'ALL_TEAMS', true) returning id`, [ORG, `${PREFIX}Agente`])).rows
    await pool.query(`insert into agent_knowledge_documents(agent_id, knowledge_document_id) values ($1, $2)`, [agent!.id, id])
    const retrieved = await retrieveKnowledgeForAgent(pool as never, agent!.id, "prazo do produto")
    const closing = retrieved.trace.retrieved.find((excerpt) => excerpt.heading === "2. Encerramento")
    expect(closing?.pages).toEqual({ from: 3, to: 3 })
    expect(retrieved.promptBlock).toContain("[Seção: 2. Encerramento · p. 3]")
    expect(retrieved.promptBlock).toContain("[Seção: 1. Prazos · p. 1]")

    const preview = await admin.get(`${API}/${id}/versions/${published.inUse.id}/ai-preview`)
    expect(preview.status).toBe(200)
    expect(preview.body.data.chunks.map((chunk: { heading: string; pages: unknown }) => [chunk.heading, chunk.pages])).toEqual([["1. Prazos", { from: 1, to: 1 }], ["2. Encerramento", { from: 3, to: 3 }]])
    // Trecho que já está igual ao documento não traz texto próprio para a tela.
    expect(preview.body.data.chunks.map((chunk: { displayText: string | null }) => chunk.displayText)).toEqual([null, null])
  })

  it("versão antiga com texto corrido: reprocessar cria rascunho com o mesmo arquivo, sem tocar no que está em uso, e a comparação diz que é reconversão", async () => {
    const created = await upload("Antiga", mixedPdf())
    const id = created.body.data.id as string
    // A versão como era antes da conversão: texto corrido, sem registro.
    const legacyText = "Manual de prova\n1. Prazos\nProduto Prazo\nFibra 24 horas\nCabo 48 horas\n\n2. Encerramento\nO atendimento termina depois de informar o protocolo ao cliente e registrar o aceite no sistema."
    await pool.query(`update knowledge_versions set content = $2, extraction = null where document_id = $1`, [id, legacyText])
    const published = await publish(id)
    expect(published.inUse.extraction ?? null).toBeNull()

    const reprocessed = await admin.post(`${API}/${id}/reprocess`).send({})
    expect(reprocessed.status, JSON.stringify(reprocessed.body)).toBe(200)
    const after = reprocessed.body.data
    expect(after.reprocessed.changed).toBe(true)
    expect(after.inUse.id).toBe(published.inUse.id)
    expect(after.inUse.content).toBe(legacyText)
    expect(after.draft.extraction.version).toBe("PDF_MARKDOWN_V1")
    expect(after.draft.content).toContain("| Fibra | 24 horas |")
    expect(after.draft.config.file.checksum).toBe(published.editable.config.file.checksum)

    const compare = await admin.get(`${API}/${id}/versions/compare`).query({ from: published.inUse.id, to: after.draft.id })
    expect(compare.status).toBe(200)
    expect(compare.body.data.file.change).toBe("UNCHANGED")
    expect(compare.body.data.reconversion.from).toBeNull()
    expect(compare.body.data.reconversion.to).toBe("PDF_MARKDOWN_V1")
    expect(compare.body.data.reconversion.onlyInFrom).toBe(0)
    expect(compare.body.data.reconversion.onlyInTo).toBe(0)

    // Sem nada novo no arquivo, repetir não cria outra versão.
    const again = await admin.post(`${API}/${id}/reprocess`).send({})
    expect(again.status).toBe(200)
    expect(again.body.data.draft.id).toBe(after.draft.id)

    const audit = await pool.query(`select 1 from audit_logs where entity_id = $1 and action = 'KNOWLEDGE_VERSION_REPROCESSED'`, [id])
    expect(audit.rows.length).toBeGreaterThan(0)
  })

  it("rascunho com outro texto só é substituído com confirmação", async () => {
    const created = await upload("Rascunho", mixedPdf())
    const id = created.body.data.id as string
    await publish(id)
    const edited = await admin.patch(`${API}/${id}`).send({ content: "# Texto digitado à mão\nConteúdo que alguém escreveu no rascunho." })
    expect(edited.status).toBe(200)
    const blocked = await admin.post(`${API}/${id}/reprocess`).send({})
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe("KNOWLEDGE_DRAFT_PENDING")
    expect((await detailOf(id)).draft.content).toContain("Texto digitado à mão")
    const confirmed = await admin.post(`${API}/${id}/reprocess`).send({ overwriteDraft: true })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data.draft.content).toContain("# Manual de prova")
  })

  it("editar o texto do rascunho mantém a origem das páginas e registra que foi editado", async () => {
    const created = await upload("Edicao", mixedPdf())
    const id = created.body.data.id as string
    const before = (await detailOf(id)).editable
    const content = before.content.replace("## 2. Encerramento", "Linha acrescentada à mão.\n\n## 2. Encerramento")
    const edited = await admin.patch(`${API}/${id}`).send({ content })
    expect(edited.status).toBe(200)
    const extraction = edited.body.data.editable.extraction
    expect(extraction.edited).toBe(true)
    expect(extraction.pages.find((page: ExtractionPage) => page.page === 3).offset).toBe(content.indexOf("## 2. Encerramento"))
  })

  it("reverter leva junto o registro da versão; o registro de uma versão publicada não muda", async () => {
    const created = await upload("Reverter", mixedPdf())
    const id = created.body.data.id as string
    const first = await publish(id)
    await admin.patch(`${API}/${id}`).send({ content: "# Outro conteúdo\nTexto digitado para a segunda versão, sem nenhum arquivo novo." })
    await publish(id)
    const reverted = await admin.post(`${API}/${id}/versions/${first.inUse.id}/revert`).send({})
    expect(reverted.status, JSON.stringify(reverted.body)).toBe(200)
    expect(reverted.body.data.inUse.extraction.version).toBe("PDF_MARKDOWN_V1")
    await expect(pool.query(`update knowledge_versions set extraction = null where id = $1`, [first.inUse.id])).rejects.toThrow(/imutável/)
  })

  it("base digitada e versão sem registro continuam como antes: nada de página nos trechos nem no prompt", async () => {
    const created = await admin.post(API).field("title", `${PREFIX}Digitada`).field("documentType", "MANUAL").field("content", "# Regras\nConteúdo digitado à mão, sem nenhum arquivo por trás dele.").field("orgScopes", JSON.stringify([{ scopeType: "ALL_TEAMS" }]))
    const id = created.body.data.id as string
    const published = await publish(id)
    const preview = await admin.get(`${API}/${id}/versions/${published.inUse.id}/ai-preview`)
    expect(preview.body.data.extraction).toBeNull()
    expect(preview.body.data.chunks[0].pages).toBeNull()
    const reprocess = await admin.post(`${API}/${id}/reprocess`).send({})
    expect(reprocess.status).toBe(409)
  })
})
