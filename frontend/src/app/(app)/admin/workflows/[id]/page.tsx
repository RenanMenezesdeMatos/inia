import { WorkflowEditorPage } from "@/components/admin/workflows/workflow-editor-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WorkflowEditorPage workflowId={id} />
}
