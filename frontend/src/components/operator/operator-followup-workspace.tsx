import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"
import { OperatorDailyFeedbackFeed } from "./operator-daily-feedback-feed"
import { OperatorIniaChat } from "./operator-inia-chat"
import { FollowupWorkspaceShell } from "./followup-workspace-shell"

/**
 * Acompanhamento do PRÓPRIO operador (perfil visitado por outra pessoa não usa este componente): os feedbacks e recados à esquerda e o
 * painel da INIA à direita, na área que para logo abaixo das abas (`docked`).
 */
export function OperatorFollowupWorkspace({ indicators, operator, highlightItemKey = null }: { indicators: OperatorIndicatorsData; operator: OperatorProfile; highlightItemKey?: string | null }) {
  return <FollowupWorkspaceShell docked feedbackInvites feed={<OperatorDailyFeedbackFeed indicators={indicators} highlightItemKey={highlightItemKey}/>} renderChat={({ onCollapse, hidden }) => <OperatorIniaChat indicators={indicators} operator={operator} onCollapse={onCollapse} hidden={hidden}/>}/>
}
