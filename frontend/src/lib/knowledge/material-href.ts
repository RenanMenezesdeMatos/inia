/**
 * Rota canônica da página de um material da Base de Conhecimento para o leitor comum (operador,
 * gestão, admin): `/materiais/:id`. É o ÚNICO lugar que monta essa URL — o link "Acessar material"
 * de um Feedback nasce daqui a partir do id do material real, nunca de texto produzido pela IA.
 * A página é a mesma base publicada que o admin edita em `/admin/knowledge/:id`; a autorização é
 * decidida pelo backend (`GET /api/v1/knowledge-materials/:id`) pelo alcance da base.
 */
export function buildKnowledgeMaterialHref(materialId: string): string {
  return `/materiais/${encodeURIComponent(materialId)}`
}

/** O material aberto na página citada por uma fonte. `versao`: a página vale para aquela versão; a tela avisa se o material já está em outra. */
export function buildKnowledgeMaterialPageHref(materialId: string, citation: { page: number; versionId: string }): string {
  return `${buildKnowledgeMaterialHref(materialId)}?pagina=${citation.page}&versao=${encodeURIComponent(citation.versionId)}`
}
