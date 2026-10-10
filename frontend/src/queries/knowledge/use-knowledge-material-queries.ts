import { useQuery } from "@tanstack/react-query"

import { fetchKnowledgeMaterial, fetchKnowledgeMaterialFile, fetchKnowledgeMaterialPreview } from "@/services/knowledge/knowledge-material-service"

const materialKey = (id: string) => ["knowledge-material", id] as const

export function useKnowledgeMaterialQuery(id: string) {
  return useQuery({ queryKey: materialKey(id), queryFn: () => fetchKnowledgeMaterial(id), retry: false })
}

// Binário do arquivo original — não muda depois do upload; fica em cache enquanto a página está aberta.
export function useKnowledgeMaterialFileQuery(id: string | null) {
  return useQuery({ queryKey: [...materialKey(id ?? ""), "file"], queryFn: () => fetchKnowledgeMaterialFile(id!), enabled: id !== null, staleTime: Infinity, retry: false })
}

export function useKnowledgeMaterialPreviewQuery(id: string | null) {
  return useQuery({ queryKey: [...materialKey(id ?? ""), "preview"], queryFn: () => fetchKnowledgeMaterialPreview(id!), enabled: id !== null, staleTime: Infinity, retry: false })
}
