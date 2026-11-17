"use client"

import { BackLink } from "@/components/ui/back-link"
import { SURFACE_CARD } from "@/components/ui/surface"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/states"
import { cn } from "@/lib/utils"
import { useKnowledgeDocumentQuery } from "@/queries/admin/use-knowledge-queries"

import { KNOWLEDGE_LIST_HREF, knowledgeDetailHref } from "./knowledge-editor/knowledge-editor-form"
import { KnowledgeEditor } from "./knowledge-editor/knowledge-editor"
import { RestrictedEditableNotice } from "./knowledge-restricted-draft"

/**
 * Cadastro e edição da base: o editor nos moldes de Publicações (`knowledge-editor/`). As rotas `/admin/knowledge/new` e
 * `/admin/knowledge/[id]/edit` continuam usando estes dois pontos de entrada.
 */
export function CreateKnowledgePage() {
  return <KnowledgeEditor document={null} />
}

export function EditKnowledgePage({ documentId }: { documentId: string }) {
  const detailQuery = useKnowledgeDocumentQuery(documentId)
  if (detailQuery.isLoading) return <EditorSkeleton />
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <BackLink href={KNOWLEDGE_LIST_HREF} label="Base de conhecimento" />
        <ErrorState message="Não foi possível abrir esta base de conhecimento." description={detailQuery.error instanceof Error ? detailQuery.error.message : undefined} onRetry={() => void detailQuery.refetch()} />
      </div>
    )
  }
  // Versão em edição fora do alcance de quem lê: o editor abriria vazio e a API recusaria salvar ou trocar o arquivo (403).
  if (detailQuery.data.editable?.restricted) {
    return (
      <div className="space-y-4">
        <BackLink href={knowledgeDetailHref(documentId)} label="Base" />
        <RestrictedEditableNotice document={detailQuery.data} className="max-w-2xl p-3 text-sm" />
      </div>
    )
  }
  // O formulário nasce uma vez com os valores carregados (o `key` remonta se a base mudar); o detalhe ao vivo segue para a situação e a
  // publicação — um refetch em segundo plano não sobrescreve o que está sendo escrito.
  return <KnowledgeEditor key={detailQuery.data.id} document={detailQuery.data} />
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando a base">
      <Skeleton className="h-8 w-32" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className={cn(SURFACE_CARD, "space-y-4 p-6")}><Skeleton className="h-9 w-2/3" /><Skeleton className="h-80 w-full" /></div>
        <div className={cn(SURFACE_CARD, "space-y-3 p-4")}><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      </div>
    </div>
  )
}
