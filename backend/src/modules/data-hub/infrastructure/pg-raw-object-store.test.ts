import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { asBuffer, PgRawObjectStore } from "./pg-raw-object-store.js"

/**
 * Objeto bruto (até 50 MB): quem só precisa saber se ele existe (importar um upload, reprocessar) lê os metadados, sem a coluna
 * `content`; e nenhum caminho copia o conteúdo à toa (o Buffer do driver/do upload já é um Uint8Array).
 */
const ROW = { id: "raw-1", filename: "medicoes.csv", content_type: "text/csv", byte_size: 3, checksum_sha256: "abc", created_at: new Date("2026-10-01T10:00:00Z"), expires_at: new Date("2026-10-31T10:00:00Z") }
const META = { id: "raw-1", filename: "medicoes.csv", contentType: "text/csv", byteSize: 3, checksumSha256: "abc", createdAt: "2026-10-01T10:00:00.000Z", expiresAt: "2026-10-31T10:00:00.000Z" }

function fakeDb(rows: unknown[]) {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>(async () => ({ rows, rowCount: rows.length }))
  return { db: { query } as unknown as Database, query }
}

describe("PgRawObjectStore", () => {
  it("getMeta não lê o conteúdo e respeita a organização", async () => {
    const { db, query } = fakeDb([ROW])
    expect(await new PgRawObjectStore(db).getMeta("raw-1", "org-1")).toEqual(META)
    const [sql, params] = query.mock.calls[0]!
    expect(sql).not.toMatch(/\bcontent\b(?!_type)/)
    expect(sql).toContain("organization_id = $2::uuid")
    expect(params).toEqual(["raw-1", "org-1"])
  })

  it("getMeta de objeto inexistente (ou de outra organização) é null", async () => {
    expect(await new PgRawObjectStore(fakeDb([]).db).getMeta("raw-x", "org-1")).toBeNull()
  })

  it("get devolve os mesmos metadados e o Buffer do driver sem cópia", async () => {
    const content = Buffer.from("a;b")
    const raw = await new PgRawObjectStore(fakeDb([{ ...ROW, content }]).db).get("raw-1")
    expect(raw?.meta).toEqual(META)
    expect(raw?.content).toBe(content)
  })

  it("put grava uma vista sobre a mesma memória (Buffer como veio; Uint8Array sem cópia)", async () => {
    const { db, query } = fakeDb([{ id: "raw-1", created_at: ROW.created_at, expires_at: ROW.expires_at }])
    const backing = new Uint8Array([0, 97, 59, 98, 0])
    const content = backing.subarray(1, 4)
    const meta = await new PgRawObjectStore(db).put({ organizationId: "org-1", sourceId: null, feedId: null, filename: null, contentType: "text/csv", content })
    expect(meta.byteSize).toBe(3)
    const sent = query.mock.calls[0]![1]![7] as Buffer
    expect(Buffer.isBuffer(sent)).toBe(true)
    expect(sent.buffer).toBe(backing.buffer)
    expect(sent.toString()).toBe("a;b")
    const buffer = Buffer.from("x")
    expect(asBuffer(buffer)).toBe(buffer)
  })
})
