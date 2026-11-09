/**
 * VERSÃO VIGENTE de uma base de conhecimento: a mais recente já DECIDIDA — publicada ou arquivada —, ignorando rascunho ou versão
 * aprovada ainda não publicada. A base vale para a INIA quando a vigente está PUBLICADA:
 *   - rascunho em edição não tira do ar a versão publicada (antes o material dos Feedbacks dava 404 e o chat dizia "não encontrei");
 *   - arquivar tira do ar, mesmo havendo versões publicadas anteriores (publicar uma versão nova não arquiva as antigas, e os Agents
 *     voltavam a usar a anterior quando a mais recente era arquivada).
 * Uma regra só para material, Agents/especialistas, motor de feedback e feedback confiável (validação funcional de 20/10/2026, D2 e
 * D13). Uso: `join lateral (${liveKnowledgeVersion("kd.id", "id, version")}) kv on true` + `kv.status = 'PUBLISHED'`.
 */
export function liveKnowledgeVersion(documentRef: string, columns: string): string {
  return `select ${columns}, status from knowledge_versions where document_id = ${documentRef} and status in ('PUBLISHED', 'ARCHIVED') order by version desc limit 1`
}

/** A base está disponível para consulta: a versão vigente está publicada (rascunho, processamento e falha não contam; arquivada tira do ar). */
export function knowledgeAvailableSql(documentRef: string): string {
  return `(select lv.status from (${liveKnowledgeVersion(documentRef, "id")}) lv) = 'PUBLISHED'`
}

/**
 * O arquivo original da versão vigente (nunca o de um rascunho ou de uma atualização que ainda não está em uso, PEN-008). Sem versão
 * vigente vale o arquivo mais recente: a base só tem rascunho e só o administrador chega aqui. Versão sem o vínculo só existe em dado
 * anterior ao registro por versão (`d.source_type` diz se a base é de arquivo).
 */
export const LIVE_FILE_QUERY = `
  select d.title, d.original_filename, d.source_type, f.file_data
    from knowledge_documents d
    join knowledge_files f on f.knowledge_document_id = d.id
    left join lateral (select file_id from knowledge_versions where document_id = d.id and status in ('PUBLISHED', 'ARCHIVED') order by version desc limit 1) lv on true
   where d.id = $1 and d.organization_id = $2 and d.deleted_at is null
     and (f.id = lv.file_id or (lv.file_id is null and d.source_type <> 'TEXT'))
   order by f.created_at desc limit 1`
export type LiveFileRow = { title: string; original_filename: string | null; source_type: string | null; file_data: Buffer }
