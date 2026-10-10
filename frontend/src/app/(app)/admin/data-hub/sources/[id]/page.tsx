import { SourceDetailPage } from "@/components/admin/data-hub/source-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SourceDetailPage sourceId={id} />
}
