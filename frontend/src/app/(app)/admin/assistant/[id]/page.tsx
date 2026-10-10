import { OrchestratorEditorPage } from "@/components/admin/assistant/orchestrator-editor-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OrchestratorEditorPage orchestratorId={id} />
}
