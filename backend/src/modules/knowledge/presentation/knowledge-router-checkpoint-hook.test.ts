import { describe, expect, it, vi } from "vitest"

const sync = vi.fn(async () => ({ status: "SYNCED" }))
vi.mock("../../checkpoint-registry/application/checkpoint-registry-service.js", () => ({ syncCheckpointRegistry: (...args: unknown[]) => sync(...(args as [])) }))
const { processKnowledgeVersion } = await import("../application/knowledge-versions.js")

const DOC = "d0c00000-0000-4000-8000-000000000001"
const VERSION = "ve000000-0000-4000-8000-000000000001"

// Organização da base — a sincronização usa a dela.
const ORG = "00000000-0000-4000-8000-0000000000e5"

/** Checkpoint Registry — a versão que fica pronta dispara a extração/reconciliação; a que falha não; falha na sincronização nunca desfaz. */
function dbWith(input: { content: string }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("set processing_lease_until = now() + interval")) return { rows: [{ id: VERSION, document_id: DOC, organization_id: ORG, version: 2, content: input.content, text_status: input.content ? "AVAILABLE" : "UNAVAILABLE", config: null, file_id: null, processing_attempts: 1 }] }
    if (sql.includes("select deleted_at from knowledge_documents")) return { rows: [{ deleted_at: null }] }
    if (sql.includes("select now() as at")) return { rows: [{ at: new Date() }] }
    if (sql.includes("select status, publish_requested_by_name")) return { rows: [{ status: "PROCESSING", publish_requested_by_name: "Pessoa" }] }
    if (sql.includes("returning id")) return { rows: [{ id: VERSION }] }
    return { rows: [] }
  })
  return { query, connect: async () => ({ query, release: () => undefined }) } as never
}

describe("Base de Conhecimento → Checkpoint Registry (gancho da publicação)", () => {
  it("a versão pronta dispara a sincronização; a que falha, não; erro na sincronização não desfaz a publicação", async () => {
    sync.mockClear()
    expect(await processKnowledgeVersion(dbWith({ content: "Conteúdo da versão nova" }), VERSION, { actorPersonId: "person-1" })).toBe("PUBLISHED")
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync.mock.calls[0]).toEqual([expect.anything(), { organizationId: ORG, personId: "person-1" }, DOC])
    expect(await processKnowledgeVersion(dbWith({ content: "" }), VERSION)).toBe("FAILED")
    expect(sync).toHaveBeenCalledTimes(1)
    sync.mockRejectedValueOnce(new Error("falhou"))
    expect(await processKnowledgeVersion(dbWith({ content: "Outra versão" }), VERSION)).toBe("PUBLISHED")
  })
})
