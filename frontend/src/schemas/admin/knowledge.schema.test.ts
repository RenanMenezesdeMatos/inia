import { describe, expect, it } from "vitest"

import { hasRestrictedDraft, knowledgeDocumentDetailSchema } from "./knowledge.schema"

// A forma que `knowledge-router.ts › fetchDocumentDetail` devolve. Desde d7c5be69, rascunho, última versão e versão editável cujo alcance
// quem lê não alcança saem só com número e situação (`restricted: true`).
const DETAIL = {
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
  latestVersion: { version: 5, content: "Rascunho", status: "DRAFT", createdAt: "2026-11-03T09:00:00.000Z" },
  inUse: { id: "v4", version: 4, status: "PUBLISHED", content: "Em uso", publishedAt: null, publishedByName: null, changeSummary: null },
  archived: null,
  draft: { id: "v5", version: 5, status: "DRAFT", content: "Rascunho", config: null, textAvailable: true, changeSummary: null, updatedAt: "2026-11-03T09:00:00.000Z", updatedByName: "Caio Alves" },
  updates: [],
  editable: { versionId: "v5", version: 5, status: "DRAFT", content: "Rascunho", config: null, textAvailable: true },
}

describe("detalhe da base: versão fora do alcance de quem lê", () => {
  it("resposta anterior à regra, sem o campo, vale como não restrita", () => {
    const detail = knowledgeDocumentDetailSchema.parse(DETAIL)
    expect(detail.draft?.restricted).toBe(false)
    expect(detail.editable?.restricted).toBe(false)
    expect(detail.latestVersion?.restricted).toBe(false)
    expect(hasRestrictedDraft(detail)).toBe(false)
  })

  it("rascunho restrito chega sem texto nem configuração e marcado", () => {
    const detail = knowledgeDocumentDetailSchema.parse({
      ...DETAIL,
      latestVersion: { ...DETAIL.latestVersion, content: "", restricted: true },
      draft: { ...DETAIL.draft, content: "", extraction: null, config: null, textAvailable: false, ocr: null, restricted: true },
      editable: { ...DETAIL.editable, content: "", extraction: null, config: null, textAvailable: false, restricted: true },
    })
    expect(detail.latestVersion?.restricted).toBe(true)
    expect(detail.editable?.restricted).toBe(true)
    expect(hasRestrictedDraft(detail)).toBe(true)
    expect(detail.draft?.updatedByName).toBe("Caio Alves")
  })
})
