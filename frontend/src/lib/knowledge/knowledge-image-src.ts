const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? process.env.INIA_API_URL ?? "http://localhost:3333"

/**
 * Endereço de uma imagem de PDF de base. Sempre pela API, que confere o acesso a cada pedido: leitor comum pelo material em vigor, administração
 * pela versão que está na tela. O id é o hash da imagem dentro do arquivo e, sozinho, não abre nada.
 */
export function knowledgeMaterialImageSrc(materialId: string, imageId: string): string {
  return `${API_URL}/api/v1/knowledge-materials/${encodeURIComponent(materialId)}/images/${encodeURIComponent(imageId)}`
}

export function knowledgeVersionImageSrc(documentId: string, versionId: string, imageId: string): string {
  return `${API_URL}/api/v1/admin/knowledge/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/images/${encodeURIComponent(imageId)}`
}
