import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"
import { OperatorDailyFeedbackFeed } from "./operator-daily-feedback-feed"
import { OperatorIniaChat } from "./operator-inia-chat"
import { FollowupWorkspaceShell } from "./followup-workspace-shell"

export function OperatorFollowupWorkspace({ indicators, operator }: { indicators: OperatorIndicatorsData; operator: OperatorProfile }) {
  return <FollowupWorkspaceShell feedbackInvites feed={<OperatorDailyFeedbackFeed indicators={indicators}/>} renderChat={({ onCollapse, hidden }) => <OperatorIniaChat indicators={indicators} operator={operator} onCollapse={onCollapse} hidden={hidden}/>}/>
}
