import { HeartHandshake, PhoneCall, Sparkles, Stethoscope, TrendingUp, Waypoints, type LucideIcon } from "lucide-react"

import type { AgentType } from "@/schemas/admin/agent.schema"

export const AGENT_TYPE_ICONS: Record<AgentType, LucideIcon> = {
  CALL_FEEDBACK: PhoneCall,
  INDICATOR_FEEDBACK: TrendingUp,
  DIAGNOSTICS: Stethoscope,
  ORCHESTRATOR: Waypoints,
  HR: HeartHandshake,
  CUSTOM: Sparkles,
}
