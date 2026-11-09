"use client"

import { Badge } from "@/components/ui/badge"

import { workflowRunState, type WorkflowRunStateKey } from "./workflow-run-state"

const BADGE_VARIANT: Record<WorkflowRunStateKey, "default" | "outline" | "secondary"> = { LIVE: "default", DRAFT: "outline", INACTIVE: "secondary" }

/** O que está rodando, no mesmo texto na lista e no editor. */
export function WorkflowRunStateBadge({ workflow }: { workflow: { published: boolean; active: boolean } }) {
  const state = workflowRunState(workflow)
  return (
    <Badge variant={BADGE_VARIANT[state.key]} title={state.description} data-testid="workflow-run-state" data-state={state.key}>
      {state.label}
    </Badge>
  )
}
