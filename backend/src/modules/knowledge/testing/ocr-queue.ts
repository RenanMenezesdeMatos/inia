import type pg from "pg"
import { processKnowledgeOcrJobs, type KnowledgeOcrDeps } from "../application/knowledge-ocr-jobs.js"

/**
 * Roda a fila de leitura de PDF digitalizado (OCR) só para as bases de uma prova (pelo prefixo do título). O banco de teste é dividido com outras
 * provas: as leituras delas ficam com a posse adiada enquanto isto roda e voltam para a fila no fim, como estavam.
 */
export async function runOcrQueueFor(pool: pg.Pool, titlePrefix: string, deps: KnowledgeOcrDeps = {}): Promise<number> {
  const others = `document_id not in (select id from knowledge_documents where title like $1)`
  const held = (await pool.query<{ id: string }>(`update knowledge_ocr_jobs set lease_until = now() + interval '1 hour' where status = 'QUEUED' and lease_until is null and ${others} returning id`, [`${titlePrefix}%`])).rows.map((row) => row.id)
  try {
    let total = 0
    for (let round = 0; round < 10; round += 1) {
      const processed = await processKnowledgeOcrJobs(pool as never, deps)
      total += processed
      if (processed === 0) break
    }
    return total
  } finally {
    await pool.query(`update knowledge_ocr_jobs set lease_until = null where id = any($1::uuid[]) and status = 'QUEUED'`, [held])
  }
}
