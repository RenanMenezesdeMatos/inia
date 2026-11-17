import { PublicationModerationPage } from "@/components/publications/moderation/publication-moderation-page"

/** Moderação de uma publicação de outra pessoa (o backend exige `communications.moderate`). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PublicationModerationPage id={id} />
}
