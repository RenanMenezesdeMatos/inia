import { ReportFormPage } from "@/components/reports/report-form"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReportFormPage reportId={id} />
}
