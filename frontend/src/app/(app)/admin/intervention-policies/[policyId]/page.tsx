import { PolicyDetailPage } from "@/components/admin/intervention-policies/policy-detail-page"

export default async function Page({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params
  return <PolicyDetailPage policyId={policyId} />
}
