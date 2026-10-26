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
