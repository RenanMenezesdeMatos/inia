import { KnowledgeDetailPage } from "@/components/admin/knowledge/knowledge-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <KnowledgeDetailPage documentId={id} />
}
