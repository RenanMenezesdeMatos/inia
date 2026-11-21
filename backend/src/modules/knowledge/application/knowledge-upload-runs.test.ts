import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { startKnowledgeUploadRun } from "./knowledge-upload-runs.js"

const INPUT = { id: "11111111-1111-4111-8111-111111111111", organizationId: "org", accountId: "acc", kind: "CREATE" as const, documentId: null, title: "Base", filename: "manual.pdf", sourceType: "PDF" as const, sizeBytes: 10 }

/** Banco falso: grava as consultas; `failUpdates` faz toda atualização falhar. */
function fakeDb(options: { inserted?: boolean; failUpdates?: boolean } = {}) {
  const calls: { sql: string; params: unknown[] }[] = []
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.startsWith("insert")) return { rows: options.inserted === false ? [] : [{ id: INPUT.id }] }
      if (sql.startsWith("update") && options.failUpdates) throw new Error("conexão caiu")
      return { rows: [] }
    },
  } as never as { calls: { sql: string; params: unknown[] }[]; query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }
}

const stagesWritten = (db: ReturnType<typeof fakeDb>) => db.calls.filter((call) => call.sql.startsWith("update")).map((call) => JSON.parse(call.params[1] as string) as { key: string; state: string }[])

describe("acompanhamento do envio", () => {
  it("sem id ou com id já usado, não grava nada e o envio segue igual", async () => {
    const noId = fakeDb()
    const tracker = await startKnowledgeUploadRun(noId as never, { ...INPUT, id: null })
    tracker.start("TEXT")
    await tracker.complete({ documentId: "d", versionId: null, ocrJobId: null })
    expect(noId.calls).toEqual([])

    const repeated = fakeDb({ inserted: false })
    const again = await startKnowledgeUploadRun(repeated as never, INPUT)
    again.start("TEXT")
    expect(repeated.calls.filter((call) => call.sql.startsWith("update"))).toEqual([])
  })

  it("grava cada passo em ordem e só marca a gravação concluída no fim", async () => {
    const db = fakeDb()
    const tracker = await startKnowledgeUploadRun(db as never, INPUT)
    tracker.start("CHECK")
    tracker.finish("CHECK", "DONE", { detail: "ok" })
    tracker.start("SAVE")
    await tracker.complete({ documentId: "doc", versionId: "ver", ocrJobId: null })
    const written = stagesWritten(db).map((stages) => `${stages.find((stage) => stage.key === "CHECK")!.state}/${stages.find((stage) => stage.key === "SAVE")!.state}`)
    expect(written).toEqual(["RUNNING/PENDING", "DONE/PENDING", "DONE/RUNNING", "DONE/DONE"])
    expect(db.calls.at(-1)!.sql).toMatch(/status = 'DONE'/)
  })

  it("falha: grava o motivo na etapa em andamento e devolve o mesmo erro; gravação que falha nunca derruba o envio", async () => {
    const db = fakeDb()
    const tracker = await startKnowledgeUploadRun(db as never, INPUT)
    tracker.start("TEXT")
    const error = new DomainError("Há muitos arquivos sendo lidos agora.", "KNOWLEDGE_EXTRACTION_BUSY", 503)
    expect(await tracker.fail(error)).toBe(error)
    const last = db.calls.at(-1)!
    expect(last.sql).toMatch(/status = 'FAILED'/)
    expect(last.params.slice(2)).toEqual(["KNOWLEDGE_EXTRACTION_BUSY", "Há muitos arquivos sendo lidos agora."])
    expect(stagesWritten(db).at(-1)!.find((stage) => stage.key === "TEXT")!.state).toBe("FAILED")

    const broken = fakeDb({ failUpdates: true })
    const fragile = await startKnowledgeUploadRun(broken as never, INPUT)
    fragile.start("TEXT")
    await expect(fragile.complete({ documentId: "doc", versionId: null, ocrJobId: null })).resolves.toBeUndefined()
    // Erro que não é de domínio vira uma mensagem clara, sem detalhe interno.
    const unexpected = fakeDb()
    await (await startKnowledgeUploadRun(unexpected as never, INPUT)).fail(new Error("relation does not exist"))
    expect(unexpected.calls.at(-1)!.params.slice(2)).toEqual(["KNOWLEDGE_UPLOAD_FAILED", expect.stringMatching(/^Erro inesperado/)])
  })
})
