import type { Database } from "../../../infrastructure/database/pool.js"
import { indicatorWindowDays } from "../../assistant/application/build-operator-context.js"
import type { KnowledgeTrace } from "../../knowledge/application/retrieve-knowledge.js"
import { consultedDocumentsOf, renderConsultationRelation, type FeedbackConsultation } from "../domain/session-consultation.js"

type Queryable = Pick<Database, "query">

/**
 * Documentos cuja versão PUBLICADA atual (a que o especialista consulta — maior versão publicada) nasceu ou passou a valer
 * DEPOIS do instante dado: a orientação de hoje pode ser diferente da usada no feedback. Só leitura de `knowledge_versions`.
 */
export async function documentsUpdatedAfter(db: Queryable, organizationId: string, documentIds: readonly string[], after: Date): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  const result = await db.query<{ document_id: string }>(
    `select current.document_id from (
       select distinct on (document_id) document_id, created_at, effective_from from knowledge_versions
        where organization_id = $1 and document_id = any($2::uuid[]) and status = 'PUBLISHED'
        order by document_id, version desc
     ) current
     where current.created_at > $3 or (current.effective_from is not null and current.effective_from > $3)`,
    [organizationId, [...new Set(documentIds)], after],
  )
  return new Set(result.rows.map((row) => row.document_id))
}

/**
 * RELAÇÃO COM O FEEDBACK de uma resposta de especialista dentro da sessão (ver session-consultation.ts no domínio): documentos
 * consultados × materiais do feedback (por id), documento com versão nova depois da publicação do feedback e a janela dos
 * números atuais (o mesmo período pedido ao especialista).
 */
export async function consultationRelationFor(db: Queryable, organizationId: string, consultation: FeedbackConsultation, result: { periodDays?: number | undefined; knowledge?: KnowledgeTrace | undefined }): Promise<string> {
  const documents = consultedDocumentsOf(result.knowledge?.retrieved ?? [])
  const updated = await documentsUpdatedAfter(db, organizationId, documents.map((document) => document.documentId), new Date(consultation.publishedAt))
  return renderConsultationRelation(consultation, {
    documents: documents.map((document) => ({ ...document, updatedAfterFeedback: updated.has(document.documentId) })),
    indicatorWindowDays: indicatorWindowDays(result.periodDays),
  })
}
