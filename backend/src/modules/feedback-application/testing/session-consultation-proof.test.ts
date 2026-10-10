/**
 * PROVA contra o banco de TESTE real — relação das consultas da sessão de feedback com a base de conhecimento. Zero modelo;
 * fixture apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run session-consultation-proof
 *
 * Prova: um documento "ganhou versão nova depois do feedback" só quando a versão PUBLICADA atual (a que o especialista consulta)
 * nasceu ou passou a valer depois da publicação do feedback; rascunho novo não conta; versão antiga substituída não conta;
 * outra organização nunca é lida.
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DEFAULT_RETRIEVAL_BUDGET } from "../../knowledge/domain/lexical-retrieval.js"
import { consultationRelationFor, documentsUpdatedAfter } from "../application/session-consultation.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const FEEDBACK_AT = new Date("2026-09-10T13:00:00.000Z")
const BEFORE = "2026-08-01T12:00:00.000Z"
const AFTER = "2026-10-06T12:00:00.000Z"

describe.skipIf(!ENABLED)("Consultas da sessão de feedback — prova Postgres", () => {
  let pool: pg.Pool
  const db = () => pool as unknown as Database
  const documents: string[] = []
  let otherOrg: string | null = null

  async function document(title: string, versions: { version: number; status: string; createdAt: string; effectiveFrom?: string | null }[], organizationId = ORG): Promise<string> {
    const id = (await pool.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1, $2, 'PROCEDURE') returning id`, [organizationId, `[PROVA CONSULTA] ${title}`])).rows[0]!.id
    documents.push(id)
    for (const entry of versions) {
      await pool.query(
        `insert into knowledge_versions (organization_id, document_id, version, content, status, effective_from, content_hash, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [organizationId, id, entry.version, `conteúdo v${entry.version}`, entry.status, entry.effectiveFrom ?? null, `hash-${id}-${entry.version}`, entry.createdAt],
      )
    }
    return id
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
  })

  afterAll(async () => {
    if (documents.length > 0) {
      await pool.query(`delete from knowledge_versions where document_id = any($1::uuid[])`, [documents])
      await pool.query(`delete from knowledge_documents where id = any($1::uuid[])`, [documents])
    }
    if (otherOrg) await pool.query(`delete from organizations where id = $1`, [otherOrg])
    await pool.end()
  })

  it("só a versão publicada atual decide: nova depois do feedback, ou vigência depois dele", async () => {
    const unchanged = await document("Sem mudança", [{ version: 1, status: "PUBLISHED", createdAt: BEFORE }])
    const republished = await document("Versão nova", [{ version: 1, status: "ARCHIVED", createdAt: BEFORE }, { version: 2, status: "PUBLISHED", createdAt: AFTER }])
    const scheduled = await document("Vigência depois", [{ version: 1, status: "PUBLISHED", createdAt: BEFORE, effectiveFrom: AFTER }])
    // Vigência retroativa (versão criada depois, valendo desde antes): a orientação de hoje ainda pode ser outra que a do feedback.
    const retroactive = await document("Vigência retroativa", [{ version: 1, status: "PUBLISHED", createdAt: BEFORE }, { version: 2, status: "PUBLISHED", createdAt: AFTER, effectiveFrom: "2026-07-01T03:00:00.000Z" }])
    const draftOnly = await document("Rascunho novo", [{ version: 1, status: "PUBLISHED", createdAt: BEFORE }, { version: 2, status: "DRAFT", createdAt: AFTER }])

    const updated = await documentsUpdatedAfter(db(), ORG, [unchanged, republished, scheduled, retroactive, draftOnly], FEEDBACK_AT)
    expect([...updated].sort()).toEqual([republished, scheduled, retroactive].sort())
    expect(await documentsUpdatedAfter(db(), ORG, [], FEEDBACK_AT)).toEqual(new Set())
  })

  it("outra organização nunca é lida", async () => {
    otherOrg = (await pool.query<{ id: string }>(`insert into organizations (name, slug) values ('[PROVA CONSULTA] Outra organização', $1) returning id`, [`prova-consulta-${Date.now()}`])).rows[0]!.id
    const foreign = await document("De outra organização", [{ version: 1, status: "PUBLISHED", createdAt: AFTER }], otherOrg)
    expect(await documentsUpdatedAfter(db(), ORG, [foreign], FEEDBACK_AT)).toEqual(new Set())
  })

  it("a relação calculada marca o mesmo documento do feedback e a versão nova", async () => {
    const same = await document("Procedimento do feedback", [{ version: 1, status: "ARCHIVED", createdAt: BEFORE }, { version: 2, status: "PUBLISHED", createdAt: AFTER }])
    const consultation = { applicationId: "app", subject: "TMA", periodLabel: "Agosto de 2026", publishedAt: FEEDBACK_AT.toISOString(), domain: "INDICATOR" as const, indicatorNames: ["TMA"], materials: [{ documentId: same, title: "Procedimento do feedback" }], timeZone: "America/Sao_Paulo" }
    const knowledge = { mode: "RETRIEVAL" as const, authorizedDocuments: [], retrieved: [{ documentId: same, documentTitle: "Procedimento do feedback", heading: "35. Prazo da análise", excerpt: "x", score: 1 }], injectedChars: 1, estimatedTokens: 1, authorizedChars: 1, budget: DEFAULT_RETRIEVAL_BUDGET }
    const relation = await consultationRelationFor(db(), ORG, consultation, { periodDays: 30, knowledge })
    expect(relation).toContain("é o MESMO documento usado neste feedback. Este documento ganhou versão nova depois deste feedback")
    expect(relation).toContain("são dos últimos 30 dias até agora")
  })
})
