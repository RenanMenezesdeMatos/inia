import { FeedDetailPage } from "@/components/admin/data-hub/feed-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FeedDetailPage feedId={id} />
}
