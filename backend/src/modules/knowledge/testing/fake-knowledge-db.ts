import { createHash } from "node:crypto"
import type { Database } from "../../../infrastructure/database/pool.js"

export type FakeKnowledgeDocument = { id: string; title: string; content: string }

/**
 * Banco falso das bases de um Agent para `retrieveKnowledgeForAgent`: responde às duas consultas da busca (as versões
 * publicadas vinculadas ao Agent, sem o texto, e depois o texto dessas versões), filtrando pelo agentId — o mesmo contrato
 * de isolamento que o SQL real aplica. A versão é derivada do conteúdo: texto diferente = versão diferente, como no banco
 * (versão publicada nunca tem o texto alterado). Qualquer outra consulta (glossário, governança) volta vazia.
 */
export function fakeKnowledgeDb(links: Record<string, FakeKnowledgeDocument[]>, organizationId = "org-test"): Database & { queries: string[] } {
  const versionIdOf = (document: FakeKnowledgeDocument) => `${document.id}@${createHash("sha1").update(`${document.title}\n${document.content}`).digest("hex").slice(0, 12)}`
  const contentByVersion = new Map(Object.values(links).flat().map((document) => [versionIdOf(document), document.content]))
  const queries: string[] = []
  return {
    queries,
    query: async (sql: string, params: unknown[] = []) => {
      queries.push(sql)
      if (sql.includes("from agent_knowledge_documents")) {
        const documents = links[String(params[0])] ?? []
        return { rows: documents.map((document) => ({ id: document.id, title: document.title, versionId: versionIdOf(document), version: 1, organizationId })) }
      }
      if (sql.includes("from knowledge_versions where id = any")) {
        const ids = (params[0] as string[]) ?? []
        return { rows: ids.flatMap((id) => (contentByVersion.has(id) ? [{ id, content: contentByVersion.get(id)! }] : [])) }
      }
      return { rows: [] }
    },
  } as unknown as Database & { queries: string[] }
}
