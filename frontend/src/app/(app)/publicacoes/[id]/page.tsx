import { PublicationReadingPage } from "@/components/publications/publication-reading-page"

/** Leitura de um comunicado no ar por quem o recebeu (link citado pela INIA no chat). O servidor confere a visibilidade (senão 404). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PublicationReadingPage id={id} />
}
