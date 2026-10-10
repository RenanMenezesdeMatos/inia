import { EditAgentPage } from "@/components/admin/agents/agent-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EditAgentPage agentId={id} />
}
