import { afterEach, describe, expect, it, vi } from "vitest"

import { compareKnowledgeVersions, fetchKnowledgeDocument, fetchKnowledgeDocumentsPage, fetchKnowledgeVersions, publishKnowledgeDocument, revertKnowledgeVersion, updateKnowledgeDocument, type KnowledgeListParams } from "./knowledge-service"

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminGetBlob: vi.fn(), adminSend: vi.fn(), adminUpload: vi.fn() }))
vi.mock("@/lib/admin/admin-api", () => api)

const LIST_PARAMS: KnowledgeListParams = { page: 1, pageSize: 20, documentType: [], sourceType: [], status: [], createdAt: {} }

// As formas abaixo são as que `knowledge-router.ts` e `knowledge-version-history.ts` devolvem: o contrato não pode quebrar no zod.
const ROW = {
  id: "kb-1",
  title: "Segunda via",
  documentType: "PROCEDURE",
  sourceType: "TEXT",
  originalFilename: null,
  mimeType: null,
  fileSizeBytes: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: null,
  authorName: null,
  status: "PUBLISHED",
  excerpt: null,
  inUseVersion: 4,
  draftVersion: 5,
  updateVersion: null,
  updateStatus: null,
  orgScopes: [],
  subjectScopes: [],
}

const DETAIL = {
  ...ROW,
  latestVersion: { version: 5, content: "Rascunho", status: "DRAFT", createdAt: "2026-11-03T09:00:00.000Z" },
  inUse: { id: "v4", version: 4, status: "PUBLISHED", content: "Em uso", publishedAt: null, publishedByName: null, changeSummary: null },
  archived: null,
  draft: { id: "v5", version: 5, status: "DRAFT", content: "Rascunho", config: null, textAvailable: true, changeSummary: null, updatedAt: "2026-11-03T09:00:00.000Z", updatedByName: null },
  updates: [{ id: "v6", version: 6, status: "FAILED", requestedAt: null, requestedByName: null, errorCode: "X", errorMessage: "Falhou" }],
  editable: { versionId: "v5", version: 5, status: "DRAFT", content: "Rascunho", config: { title: "T", documentType: "FAQ", sourceType: "PDF", file: { id: "f", filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, checksum: "c" }, orgScopes: [{ scopeType: "ALL_TEAMS", teamId: null, subteamId: null }], subjectScopes: [{ scopeType: "ALL_SUBJECTS" }], productNodeIds: [] }, textAvailable: true },
}

afterEach(() => vi.clearAllMocks())

describe("knowledge-service", () => {
  it("filtro Rascunho também traz as bases com a marca Aprovada", async () => {
    api.adminGet.mockResolvedValue({ items: [ROW], total: 1, page: 1, pageSize: 20 })
    await fetchKnowledgeDocumentsPage({ ...LIST_PARAMS, status: ["DRAFT", "FAILED"] })
    const query = new URLSearchParams(String(api.adminGet.mock.calls[0]?.[0]).split("?")[1])
    expect(query.getAll("status")).toEqual(["DRAFT", "FAILED", "APPROVED"])
  })

  it("filtro sem Rascunho não inclui Aprovada", async () => {
    api.adminGet.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    await fetchKnowledgeDocumentsPage({ ...LIST_PARAMS, status: ["PUBLISHED"] })
    expect(new URLSearchParams(String(api.adminGet.mock.calls[0]?.[0]).split("?")[1]).getAll("status")).toEqual(["PUBLISHED"])
  })

  it("aceita o detalhe como a API devolve", async () => {
    api.adminGet.mockResolvedValue(DETAIL)
    const detail = await fetchKnowledgeDocument("kb-1")
    expect(detail.inUse?.version).toBe(4)
    expect(detail.updates[0]?.status).toBe("FAILED")
    expect(detail.editable?.config?.file?.filename).toBe("a.pdf")
  })

  it("aceita o histórico com linha completa e linha restrita", async () => {
    api.adminGet.mockResolvedValue([
      {
        id: "v2",
        number: 2,
        status: "PUBLISHED",
        situation: "IN_USE",
        createdAt: "2026-10-01T10:00:00.000Z",
        publishedAt: "2026-10-02T10:00:00.000Z",
        restricted: false,
        origin: "REVERT",
        authorName: null,
        updatedAt: null,
        updatedByName: null,
        publishRequestedAt: null,
        publishRequestedByName: null,
        publishedByName: null,
        changeSummary: null,
        revertedFromNumber: 1,
        errorCode: null,
        errorMessage: null,
        supersededReason: null,
        textAvailable: true,
        hasConfig: false,
        usageCount: 3,
        lastUsedAt: null,
      },
      { id: "v1", number: 1, status: "PUBLISHED", situation: "REPLACED", createdAt: "2026-10-01T10:00:00.000Z", publishedAt: null, restricted: true },
    ])
    const versions = await fetchKnowledgeVersions("kb-1")
    expect(versions[0]).toMatchObject({ restricted: false, revertedFromNumber: 1 })
    expect(versions[1]).toEqual({ id: "v1", number: 1, status: "PUBLISHED", situation: "REPLACED", createdAt: "2026-10-01T10:00:00.000Z", publishedAt: null, restricted: true })
  })

  it("comparação: pede as versões na ordem e aceita as partes não comparáveis", async () => {
    api.adminGet.mockResolvedValue({
      from: { id: "a", number: 1, status: "PUBLISHED" },
      to: { id: "b", number: 2, status: "PUBLISHED" },
      configuration: { comparable: false, reason: "NOT_RECORDED", versions: [1] },
      file: { change: "NONE", from: null, to: null },
      content: { comparable: false, reason: "TEXT_UNAVAILABLE", versions: [2] },
    })
    const comparison = await compareKnowledgeVersions("kb-1", "a", "b")
    expect(api.adminGet.mock.calls[0]?.[0]).toBe("/api/v1/admin/knowledge/kb-1/versions/compare?from=a&to=b")
    expect(comparison.configuration.comparable).toBe(false)
    expect(comparison.content.comparable).toBe(false)
  })

  it("salvar o rascunho nunca envia status e só manda o que foi informado", async () => {
    api.adminSend.mockResolvedValue(DETAIL)
    await updateKnowledgeDocument("kb-1", { title: "T", documentType: "FAQ", orgScope: { scopeType: "ALL_TEAMS" }, subjectScope: { scopeType: "ALL_SUBJECTS" } })
    expect(api.adminSend).toHaveBeenCalledWith("/api/v1/admin/knowledge/kb-1", "PATCH", { title: "T", documentType: "FAQ", orgScopes: [{ scopeType: "ALL_TEAMS" }], subjectScopes: [{ scopeType: "ALL_SUBJECTS" }] })
  })

  it("publicar e reverter usam as rotas do ciclo de vida", async () => {
    api.adminSend.mockResolvedValue(DETAIL)
    await publishKnowledgeDocument("kb-1", { changeSummary: "S", reactivate: true })
    expect(api.adminSend).toHaveBeenLastCalledWith("/api/v1/admin/knowledge/kb-1/publish", "POST", { changeSummary: "S", reactivate: true })
    await revertKnowledgeVersion("kb-1", "v2", { discardDraft: true })
    expect(api.adminSend).toHaveBeenLastCalledWith("/api/v1/admin/knowledge/kb-1/versions/v2/revert", "POST", { discardDraft: true })
  })
})
