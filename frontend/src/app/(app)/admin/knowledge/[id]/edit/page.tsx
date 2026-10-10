import { EditKnowledgePage } from "@/components/admin/knowledge/knowledge-form-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EditKnowledgePage documentId={id} />
}
