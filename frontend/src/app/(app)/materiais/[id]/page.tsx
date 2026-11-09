import { KnowledgeMaterialPage } from "@/components/knowledge-material/knowledge-material-page"

/** Página real de um material da Base de Conhecimento para o leitor comum — destino do link
 * "Acessar material" de um Feedback (`buildKnowledgeMaterialHref`). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string | string[]; versao?: string | string[] }> }) {
  const { id } = await params
  const { pagina, versao } = await searchParams
  const page = typeof pagina === "string" && /^\d{1,5}$/.test(pagina) ? Number(pagina) : undefined
  return <KnowledgeMaterialPage materialId={id} citedPage={page} citedVersionId={typeof versao === "string" ? versao : undefined} />
}
