/**
 * Rota canônica da página de um material da Base de Conhecimento (`/materiais/:id`) — espelho no backend de
 * `frontend/src/lib/knowledge/material-href.ts` (o teste garante que as duas montam a MESMA URL). O link nasce do id REAL do
 * material/documento, nunca de texto produzido por IA. A autorização continua sendo decidida ao abrir
 * (`GET /api/v1/knowledge-materials/:id`, pelo alcance da base): um link num feedback não concede acesso.
 */
export function buildKnowledgeMaterialHref(materialId: string): string {
  return `/materiais/${encodeURIComponent(materialId)}`
}
