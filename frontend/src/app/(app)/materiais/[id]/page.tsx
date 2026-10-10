import { KnowledgeMaterialPage } from "@/components/knowledge-material/knowledge-material-page"

/** Página real de um material da Base de Conhecimento para o leitor comum — destino do link
 * "Acessar material" de um Feedback (`buildKnowledgeMaterialHref`). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <KnowledgeMaterialPage materialId={id} />
}
