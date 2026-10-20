import { describe, expect, it } from "vitest"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { loadReadableKnowledge, type ReadableKnowledgePorts } from "./knowledge-catalog.js"

/** Bases fictícias, só para este teste. */
const ORG = "org-1"
type Base = { id: string; title: string; content: string; agents: string[]; organizationId?: string }
const BASES: Base[] = [
  { id: "kb-a", title: "Procedimento Alfa (fictícia)", content: "## 1. Documentos\nDocumentos da solicitação alfa.", agents: ["agent-1", "agent-2"] },
  { id: "kb-b", title: "Procedimento Beta (fictícia)", content: "## 1. Documentos\nDocumentos da solicitação beta.", agents: ["agent-2"] },
  { id: "kb-restrita", title: "Procedimento Restrito (fictícia)", content: "## 1. Documentos\nDocumentos restritos.", agents: ["agent-1"] },
  { id: "kb-outra-org", title: "Procedimento de Outra Organização (fictícia)", content: "## 1. Documentos\nDocumentos externos.", agents: ["agent-1"], organizationId: "org-2" },
]

function ports(accessible: (id: string) => boolean, seen: { accessibleAsked: string[][] } = { accessibleAsked: [] }): ReadableKnowledgePorts {
  return {
    snapshot: async (agentId) => {
      const mine = BASES.filter((base) => base.agents.includes(agentId))
      return { documents: mine.map((base) => ({ id: base.id, title: base.title, versionId: `${base.id}-v1`, documentType: "PROCEDURE", organizationId: base.organizationId ?? ORG })), chunks: mine.flatMap((base) => chunkKnowledgeDocument(base)) }
    },
    accessible: async (_organizationId, _viewer, ids) => {
      seen.accessibleAsked.push(ids)
      return new Set(ids.filter(accessible))
    },
    glossary: async () => [{ term: "PJ", definition: "Pessoa jurídica" }],
  }
}

describe("bases que o esclarecimento pode mostrar — autorização e acesso de quem pergunta", () => {
  it("une as bases de vários especialistas (a mesma base entra uma vez, com os dois como proveniência), em ordem de título", async () => {
    const result = await loadReadableKnowledge({ organizationId: ORG, viewerPersonId: "p-1", agentIds: ["agent-1", "agent-2"] }, ports(() => true))
    expect([...result.sources.keys()]).toEqual(["kb-a", "kb-b", "kb-restrita"])
    expect(result.sources.get("kb-a")!.agentIds.sort()).toEqual(["agent-1", "agent-2"])
    expect(result.glossary).toEqual([{ term: "PJ", definition: "Pessoa jurídica" }])
  })

  it("base que a pessoa não pode ler nunca entra (nem como opção, fonte ou link) — e a contagem fica registrada", async () => {
    const result = await loadReadableKnowledge({ organizationId: ORG, viewerPersonId: "p-1", agentIds: ["agent-1", "agent-2"] }, ports((id) => id !== "kb-restrita"))
    expect(result.sources.has("kb-restrita")).toBe(false)
    expect(result.excludedByAccess).toBe(1)
  })

  it("base de outra organização é ignorada antes de qualquer checagem de acesso", async () => {
    const seen = { accessibleAsked: [] as string[][] }
    const result = await loadReadableKnowledge({ organizationId: ORG, viewerPersonId: "p-1", agentIds: ["agent-1"] }, ports(() => true, seen))
    expect(result.sources.has("kb-outra-org")).toBe(false)
    expect(seen.accessibleAsked.flat()).not.toContain("kb-outra-org")
  })

  it("só bases dos agentes pedidos; sem base legível, nem o glossário é lido", async () => {
    const only = await loadReadableKnowledge({ organizationId: ORG, viewerPersonId: "p-1", agentIds: ["agent-2"] }, ports(() => true))
    expect([...only.sources.keys()]).toEqual(["kb-a", "kb-b"])
    const none = await loadReadableKnowledge({ organizationId: ORG, viewerPersonId: "p-1", agentIds: ["agent-1", "agent-2"] }, ports(() => false))
    expect(none.sources.size).toBe(0)
    expect(none.glossary).toEqual([])
  })
})
