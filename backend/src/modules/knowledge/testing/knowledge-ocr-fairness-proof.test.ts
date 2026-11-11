import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * A fila do OCR reveza as organizações (auditoria de segurança, rodada 2): com um leitor só no conjunto, a ordem de chegada deixava uma organização com
 * vários PDFs longos segurar as das outras por horas. Contra o banco de teste, numa transação desfeita no fim; nenhuma leitura de verdade acontece.
 *
 *   INIA_DB_PROOF=1 npx vitest run knowledge-ocr-fairness-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"

const { env } = await import("../../../config/env.js")
const { processKnowledgeOcrJobs } = await import("../application/knowledge-ocr-jobs.js")

const ORG = "00000000-0000-4000-8000-000000000001"

let client: pg.Client

async function queueJob(organizationId: string, label: string, minutesAgo: number): Promise<void> {
  const document = (await client.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1, $2, 'MANUAL') returning id`, [organizationId, `Prova fila OCR · ${label}`])).rows[0]!.id
  const version = (await client.query<{ id: string }>(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1, $2, 1, '', 'DRAFT', 'x') returning id`, [organizationId, document])).rows[0]!.id
  const file = (await client.query<{ id: string }>(`insert into knowledge_files (knowledge_document_id, file_data, checksum) values ($1, $2, 'x') returning id`, [document, Buffer.from(label)])).rows[0]!.id
  await client.query(
    `insert into knowledge_ocr_jobs (organization_id, document_id, version_id, file_id, pages_total, base_content_hash, created_at) values ($1, $2, $3, $4, 1, 'x', now() - make_interval(mins => $5))`,
    [organizationId, document, version, file, minutesAgo],
  )
}

describe.runIf(ENABLED)("fila do OCR — revezamento entre organizações", () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: env.TEST_DATABASE_URL })
    await client.connect()
    await client.query("begin")
    // As leituras de outras provas ficam fora desta rodada (desfeito no fim, com o resto).
    await client.query(`update knowledge_ocr_jobs set lease_until = now() + interval '1 hour' where status in ('QUEUED', 'RUNNING')`)
  })

  afterAll(async () => {
    await client.query("rollback")
    await client.end()
  })

  it("dois PDFs de uma organização e um de outra: o da outra não espera os dois", async () => {
    const other = (await client.query<{ id: string }>(`insert into organizations (name, slug) values ('Prova fila OCR', 'prova-fila-ocr-' || gen_random_uuid()) returning id`)).rows[0]!.id
    await queueJob(ORG, "A1", 30)
    await queueJob(ORG, "A2", 20)
    await queueJob(other, "B1", 10)
    const order: string[] = []
    const processed = await processKnowledgeOcrJobs(client as never, {
      extract: async (buffer) => {
        order.push(buffer.toString())
        return { text: "", extraction: null, images: [], scannedPages: [] }
      },
    })
    expect(processed).toBe(3)
    expect(order).toHaveLength(3)
    expect(order.indexOf("A1")).toBeLessThan(order.indexOf("A2"))
    expect(order.indexOf("B1")).toBeLessThan(order.indexOf("A2"))
  })
})
