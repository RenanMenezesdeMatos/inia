import { RunDetailPage } from "@/components/admin/data-hub/run-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RunDetailPage runId={id} />
}
