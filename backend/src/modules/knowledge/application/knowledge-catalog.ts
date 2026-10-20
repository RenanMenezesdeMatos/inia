import type { Database } from "../../../infrastructure/database/pool.js"
import type { KnowledgeChunk } from "../domain/knowledge-chunking.js"
import type { CatalogSource } from "../domain/knowledge-catalog.js"
import { resolveAccessibleKnowledgeMaterials } from "./knowledge-material-access.js"
import { loadAgentKnowledgeSnapshot } from "./retrieve-knowledge.js"

/**
 * As bases que o esclarecimento pode mostrar à IA: as AUTORIZADAS aos especialistas do Orquestrador de quem pergunta (a mesma
 * leitura em cache por versão da busca de sempre — publicadas, da organização, no alcance do Agent) E que ESSA PESSOA pode ler
 * (`resolveAccessibleKnowledgeMaterials`, a regra da página do material). Uma base fora do alcance da pessoa nunca vira opção,
 * fonte ou link. A mesma base vinculada a dois especialistas entra uma vez, com os dois como proveniência. Nenhuma busca por
 * palavra: a pergunta nem entra aqui.
 */
export type ReadableKnowledgeRequest = { organizationId: string; viewerPersonId: string; agentIds: readonly string[] }

export type ReadableKnowledgeSource = CatalogSource & { agentIds: string[] }

export type ReadableKnowledge = {
  /** Por id, em ordem de título. */
  sources: ReadonlyMap<string, ReadableKnowledgeSource>
  /** Bases autorizadas aos especialistas que a pessoa não pode ler (ficaram de fora). */
  excludedByAccess: number
  /** Glossário ativo da organização (termo → definição), entregue inteiro como dado — sem detectar siglas na pergunta. */
  glossary: { term: string; definition: string }[]
}

type SnapshotDocument = { id: string; title: string; versionId: string; documentType: string; organizationId: string }

export type ReadableKnowledgePorts = {
  snapshot: (agentId: string) => Promise<{ documents: SnapshotDocument[]; chunks: KnowledgeChunk[] }>
  accessible: (organizationId: string, viewerPersonId: string, documentIds: string[]) => Promise<Set<string>>
  glossary: (organizationId: string) => Promise<{ term: string; definition: string }[]>
}

export const MAX_GLOSSARY_TERMS = 80

export function postgresReadableKnowledgePorts(db: Database): ReadableKnowledgePorts {
  return {
    snapshot: (agentId) => loadAgentKnowledgeSnapshot(db, agentId),
    accessible: async (organizationId, viewerPersonId, documentIds) => new Set((await resolveAccessibleKnowledgeMaterials(db, { organizationId, viewer: { personId: viewerPersonId }, materialIds: documentIds })).keys()),
    glossary: async (organizationId) => {
      try {
        const result = await db.query<{ term: string; definition: string }>(`select term, definition from glossary_terms where organization_id = $1 and active order by term limit $2`, [organizationId, MAX_GLOSSARY_TERMS])
        return result.rows.map((row) => ({ term: row.term.trim(), definition: row.definition.trim() }))
      } catch (error) {
        // Glossário é apoio: falha = sem glossário, nunca sem resposta.
        console.error(JSON.stringify({ event: "clarification_glossary_load_failed", message: (error as Error).message }))
        return []
      }
    },
  }
}

export async function loadReadableKnowledge(request: ReadableKnowledgeRequest, ports: ReadableKnowledgePorts): Promise<ReadableKnowledge> {
  const agentIds = [...new Set(request.agentIds.filter(Boolean))]
  const snapshots = await Promise.all(agentIds.map(async (agentId) => ({ agentId, snapshot: await ports.snapshot(agentId) })))
  const merged = new Map<string, { document: SnapshotDocument; chunks: KnowledgeChunk[]; agentIds: string[] }>()
  for (const { agentId, snapshot } of snapshots) {
    for (const document of snapshot.documents) {
      if (document.organizationId !== request.organizationId) continue
      const existing = merged.get(document.id)
      if (existing) {
        if (!existing.agentIds.includes(agentId)) existing.agentIds.push(agentId)
        continue
      }
      merged.set(document.id, { document, chunks: snapshot.chunks.filter((chunk) => chunk.documentId === document.id), agentIds: [agentId] })
    }
  }
  const accessible = merged.size > 0 ? await ports.accessible(request.organizationId, request.viewerPersonId, [...merged.keys()]) : new Set<string>()
  const readable = [...merged.values()]
    .filter((entry) => accessible.has(entry.document.id))
    .sort((left, right) => left.document.title.localeCompare(right.document.title, "pt-BR"))
    .map((entry): ReadableKnowledgeSource => ({ documentId: entry.document.id, documentTitle: entry.document.title, versionId: entry.document.versionId, documentType: entry.document.documentType ?? null, chunks: entry.chunks, agentIds: entry.agentIds }))
  const glossary = readable.length > 0 ? (await ports.glossary(request.organizationId)).slice(0, MAX_GLOSSARY_TERMS) : []
  return { sources: new Map(readable.map((source) => [source.documentId, source])), excludedByAccess: merged.size - readable.length, glossary }
}
