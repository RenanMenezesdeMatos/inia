import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { listMyAlignments, markMyAlignmentRead } from "./my-alignments.js"
import { alignmentReachesPersonSql } from "./structure-alignments.js"

/**
 * AL-02 — o público da pessoa é aplicado NO SQL, antes do teto de linhas: com mais de 1000 versões de outros públicos na organização,
 * o alinhamento vigente da pessoa não pode ficar de fora. Sem banco: a prova é a consulta enviada (o predicado de público, o mesmo da
 * leitura da liderança, vem antes do `limit`) e o sujeito resolvido nos parâmetros; o comportamento contra o Postgres está em
 * `my-alignments-proof` (1001 versões de outro Grupo).
 */
const TEAM = "11111111-1111-4111-8111-111111111111"
const SUBTEAM = "22222222-2222-4222-8222-222222222222"

function recordingDb() {
  const queries: { sql: string; params: unknown[] }[] = []
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql: sql.replace(/\s+/g, " "), params })
      if (sql.includes("from people p join organizations o")) return { rows: [{ team_id: TEAM, subteam_id: SUBTEAM, universe_now: "B2C", universe_at: "B2C", enforced: true }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Pick<Database, "query">
  return { db, queries }
}

describe("alinhamentos da pessoa da sessão (AL-02)", () => {
  it("o público (universo + vínculo de Grupo/Subgrupo) entra no SQL antes do teto de linhas, com o sujeito da sessão", async () => {
    const { db, queries } = recordingDb()
    const now = new Date("2026-11-19T12:00:00Z")
    expect(await listMyAlignments(db, { organizationId: "org", personId: "person", now })).toEqual([])
    const versions = queries.find((query) => query.sql.includes("from operational_alignment_versions v"))!
    const audience = alignmentReachesPersonSql("v", "me", "org").replace(/\s+/g, " ")
    expect(versions.sql).toContain(audience)
    expect(versions.sql.indexOf(audience)).toBeLessThan(versions.sql.lastIndexOf("limit 1000"))
    expect(versions.params).toEqual(["org", now, "person", "B2C", TEAM, SUBTEAM, true])
  })
})

/**
 * "Li o alinhamento" (QA-06 / QA-11) — idempotente também em leituras SIMULTÂNEAS: a requisição que perde a corrida cai no
 * `on conflict do nothing` e o `select` do mesmo comando ainda não enxerga a linha da outra (volta vazio). Tem de devolver a leitura
 * já gravada, nunca 500. Sem banco: o dublê devolve vazio no comando de inserção para quem perde a corrida.
 */
function readsDb(options: { visible?: boolean } = {}) {
  const reads = new Map<string, Date>()
  let inserts = 0
  const now = new Date("2026-11-19T12:00:00Z")
  const version = {
    alignment_id: "al-1", version_id: "ver-1", version: 1, title: "Fatura pelo app", guidance: "Oriente o app.", justification: "Campanha", change_reason: null, affected_topic: null,
    processes: [], product_name: null, operating_universe: "B2C", scope_type: "UNIVERSE", links: [], starts_on: "2026-11-18", ends_on: "2026-11-30", time_zone: "America/Sao_Paulo",
    effective_from: new Date("2026-11-18T03:00:00Z"), effective_until: new Date("2026-12-01T03:00:00Z"), ended_at: null, published_at: new Date("2026-11-17T12:00:00Z"),
    responsible_name: null, responsible_job_title: null, published_by_name: null, published_by_job_title: null, read_at: null,
  }
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from people p join organizations o")) return { rows: [{ team_id: TEAM, subteam_id: SUBTEAM, universe_now: "B2C", universe_at: "B2C", enforced: true }], rowCount: 1 }
      if (sql.includes("from operational_alignment_versions v")) return { rows: options.visible === false ? [] : [version], rowCount: 1 }
      if (sql.includes("insert into operational_alignment_reads")) {
        inserts += 1
        const key = `${params[1]}:${params[3]}`
        // Quem perde a corrida: conflito + fotografia anterior à confirmação da outra = nenhuma linha.
        if (reads.has(key)) return { rows: [], rowCount: 0 }
        reads.set(key, new Date(now.getTime() + inserts))
        return { rows: [{ read_at: reads.get(key) }], rowCount: 1 }
      }
      if (sql.includes("from operational_alignment_reads")) {
        const read = reads.get(`${params[0]}:${params[1]}`)
        return { rows: read ? [{ read_at: read }] : [], rowCount: read ? 1 : 0 }
      }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Pick<Database, "query">
  return { db, now, reads }
}

describe("\"Li o alinhamento\" (QA-06)", () => {
  const input = { organizationId: "org", personId: "person", alignmentId: "al-1", versionId: "ver-1" }

  it("duas leituras simultâneas da mesma versão devolvem a mesma leitura (nenhuma falha) e gravam uma linha só", async () => {
    const { db, now, reads } = readsDb()
    const [first, second] = await Promise.all([markMyAlignmentRead(db, { ...input, now }), markMyAlignmentRead(db, { ...input, now })])
    expect(second.readAt).toBe(first.readAt)
    expect(reads.size).toBe(1)
    expect((await markMyAlignmentRead(db, { ...input, now })).readAt).toBe(first.readAt)
  })

  it("versão que a pessoa não vê (fora do público, excluída, outra versão) = 404, sem gravar", async () => {
    const { db, now, reads } = readsDb({ visible: false })
    await expect(markMyAlignmentRead(db, { ...input, now })).rejects.toMatchObject({ code: "OPERATIONAL_ALIGNMENT_NOT_FOUND", statusCode: 404 })
    expect(reads.size).toBe(0)
  })
})
