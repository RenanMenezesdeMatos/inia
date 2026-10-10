"use client"

import { createContext, useContext } from "react"
import type { NodeDescribeContext } from "./node-visuals"

const WorkflowEditorContext = createContext<NodeDescribeContext>({})

export const WorkflowEditorProvider = WorkflowEditorContext.Provider

export function useWorkflowEditorContext(): NodeDescribeContext {
  return useContext(WorkflowEditorContext)
}
