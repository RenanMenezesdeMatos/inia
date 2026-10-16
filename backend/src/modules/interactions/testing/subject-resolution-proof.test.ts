import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveCanonicalSubject, upsertInteractionSubjectCatalog } from "../application/interaction-subject-catalog.js"
import { canonicalReasonSql, canonicalSubjectSql, reasonKeySql, subjectFilterSql, subjectKeySql } from "../domain/interaction-subject.js"

/**
 * PROVA DA `SUBJECT_RESOLUTION_V2` contra o banco de TESTE real (migrations 145 e 146 aplicadas):
 *   INIA_DB_PROOF=1 npx vitest run subject-resolution-proof
 * Catálogo gravado pelo MESMO serviço do produto (alias do texto e alias do par motivo + submotivo, inclusive o mesmo submotivo
 * em dois motivos e um par ambíguo recusado) e interações com e sem submotivo, conferidas pelas MESMAS expressões SQL que os
 * segmentos, o diagnóstico e as Tools usam. Tudo numa transação desfeita no fim: nada fica no banco.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"

describe.skipIf(!ENABLED)("SUBJECT_RESOLUTION_V2 — submotivo preferencial e alias por par (banco de teste real)", () => {
  let pool: pg.Pool
  let client: pg.PoolClient
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
    const report = await upsertInteractionSubjectCatalog(client as unknown as Database, ORG, {
      definitions: ["qa_sr_fatura", "qa_sr_segunda_via", "qa_sr_outros_cob", "qa_sr_outros_fat", "qa_sr_dupla_a", "qa_sr_dupla_b"].map((code) => ({ code, name: `QA ${code}` })),
      aliases: [
        { code: "qa_sr_fatura", rawSubject: "QA SR Fatura" },
        { code: "qa_sr_segunda_via", rawSubject: "QA SR Segunda via" },
        { code: "qa_sr_outros_cob", rawReason: "QA SR Cobrança", rawSubject: "QA SR Outros" },
        { code: "qa_sr_outros_fat", rawReason: "QA SR Fatura", rawSubject: "QA SR Outros" },
        { code: "qa_sr_dupla_a", rawReason: "QA SR Fatura", rawSubject: "QA SR Dupla" },
        { code: "qa_sr_dupla_b", rawReason: "QA SR Fatura", rawSubject: "QA SR Dupla" },
      ],
    })
    expect(report.ambiguousRejected).toEqual(["qa sr fatura › qa sr dupla"])
    expect(report.aliases).toBe(4)
    const operator = (await client.query<{ id: string }>(`select id from people where organization_id = $1 and role = 'OPERATOR' and active order by id limit 1`, [ORG])).rows[0]!.id
    const calls: [string, string, string | null][] = [
      ["A", "QA SR Fatura", "QA SR Segunda via"],
      ["B", "QA SR Fatura", "QA SR Sem alias"],
      ["C", "QA SR Cobrança", "QA SR Outros"],
      ["D", "QA SR Fatura", "QA SR Outros"],
      ["E", "QA SR Fatura", null],
      ["F", "QA SR Segunda via", null],
      ["G", "QA SR Fatura", "QA SR Dupla"],
    ]
    for (const [key, reason, subReason] of calls) {
      ids[key] = (await client.query<{ id: string }>(
        `insert into interactions (organization_id, operator_id, reason, sub_reason, channel, started_at, ended_at, external_id)
         values ($1, $2, $3, $4, 'VOICE', now() - interval '1 hour', now() - interval '50 minutes', $5) returning id`,
        [ORG, operator, reason, subReason, `QA-SUBJECT-RESOLUTION-${key}`],
      )).rows[0]!.id
    }
  })

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  const resolved = async (key: string) =>
    (await client.query<{ subject: string | null; reason: string | null; subject_key: string | null; reason_key: string | null }>(
      `select ${canonicalSubjectSql("i")} subject, ${canonicalReasonSql("i")} reason, ${subjectKeySql("i")} subject_key, ${reasonKeySql("i")} reason_key from interactions i where i.id = $1`,
      [ids[key]],
    )).rows[0]!

  it("com submotivo: par > texto do submotivo; submotivo sem alias fica no bruto dele (nunca sobe para o canônico do motivo)", async () => {
    expect(await resolved("A")).toEqual({ subject: "qa_sr_segunda_via", reason: "qa_sr_fatura", subject_key: "qa_sr_segunda_via", reason_key: "qa_sr_fatura" })
    expect(await resolved("B")).toEqual({ subject: null, reason: "qa_sr_fatura", subject_key: "QA SR Sem alias", reason_key: "qa_sr_fatura" })
    expect(await resolved("C")).toEqual({ subject: "qa_sr_outros_cob", reason: null, subject_key: "qa_sr_outros_cob", reason_key: "QA SR Cobrança" })
    expect(await resolved("D")).toEqual({ subject: "qa_sr_outros_fat", reason: "qa_sr_fatura", subject_key: "qa_sr_outros_fat", reason_key: "qa_sr_fatura" })
    // Par ambíguo não foi gravado: o submotivo fica no bruto.
    expect((await resolved("G")).subject_key).toBe("QA SR Dupla")
  })

  it("sem submotivo: o motivo resolve como na V1 (o texto do alias vale para o motivo)", async () => {
    expect(await resolved("E")).toEqual({ subject: "qa_sr_fatura", reason: "qa_sr_fatura", subject_key: "qa_sr_fatura", reason_key: "qa_sr_fatura" })
    expect(await resolved("F")).toEqual({ subject: "qa_sr_segunda_via", reason: "qa_sr_segunda_via", subject_key: "qa_sr_segunda_via", reason_key: "qa_sr_segunda_via" })
  })

  it("pedido solto: código canônico resolve; texto que só existe como par não resolve (um alias de par só vale dentro do motivo)", async () => {
    const db = client as unknown as Database
    expect((await resolveCanonicalSubject(db, ORG, "qa_sr_outros_cob")).mode).toBe("CANONICAL")
    expect((await resolveCanonicalSubject(db, ORG, "QA SR Segunda via")).canonical?.code).toBe("qa_sr_segunda_via")
    expect(await resolveCanonicalSubject(db, ORG, "QA SR Outros")).toEqual({ requested: "QA SR Outros", canonical: null, mode: "RAW_EXACT" })
  })

  it("filtros nos dois níveis: assunto pelo canônico ou pelo submotivo exato; motivo pelo canônico do motivo ou pelo motivo exato", async () => {
    const matching = async (filter: { clause: string; param: string }) =>
      (await client.query<{ id: string }>(`select i.id from interactions i where i.id = any($1::uuid[])${filter.clause} order by i.external_id`, [Object.values(ids), filter.param])).rows.map((row) => Object.keys(ids).find((key) => ids[key] === row.id))
    expect(await matching(subjectFilterSql({ requested: "qa_sr_segunda_via", canonical: { code: "qa_sr_segunda_via", name: "x" }, mode: "CANONICAL" }, 2))).toEqual(["A", "F"])
    expect(await matching(subjectFilterSql({ requested: "QA SR Sem alias", canonical: null, mode: "RAW_EXACT" }, 2))).toEqual(["B"])
    expect(await matching(subjectFilterSql({ requested: "fatura", canonical: { code: "qa_sr_fatura", name: "x" }, mode: "CANONICAL" }, 2, "i", "REASON"))).toEqual(["A", "B", "D", "E", "G"])
    expect(await matching(subjectFilterSql({ requested: "QA SR Cobrança", canonical: null, mode: "RAW_EXACT" }, 2, "i", "REASON"))).toEqual(["C"])
  })
})
