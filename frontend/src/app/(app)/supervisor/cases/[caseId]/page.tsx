import { SupervisionCasePage } from "@/components/supervision-cases/supervision-case-page"
import { fetchSupervisionCase } from "@/services/supervision-cases"

export default async function Page({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  return <SupervisionCasePage item={await fetchSupervisionCase(caseId)} />
}
