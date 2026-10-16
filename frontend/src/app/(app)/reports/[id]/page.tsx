import { ReportDetailPage } from "@/components/reports/report-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReportDetailPage reportId={id} />
}
