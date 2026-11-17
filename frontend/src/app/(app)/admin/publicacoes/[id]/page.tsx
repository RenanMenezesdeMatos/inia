import { PublicationEditorPage } from "@/components/publications/publication-editor-page"

/** Editar uma publicação do autor (outra pessoa ou retirada = 404 no servidor). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PublicationEditorPage id={id} />
}
