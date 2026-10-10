"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"
import { cn } from "@/lib/utils"

function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.Group>) { return <ResizablePrimitive.Group data-slot="resizable-panel-group" className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)} {...props}/> }
const ResizablePanel = ResizablePrimitive.Panel
function ResizableHandle({ withHandle, className, ...props }: React.ComponentProps<typeof ResizablePrimitive.Separator> & { withHandle?: boolean }) { return <ResizablePrimitive.Separator data-slot="resizable-handle" className={cn("relative flex w-px items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full", className)} {...props}>{withHandle ? <div className="z-10 flex h-8 w-4 items-center justify-center rounded-sm border bg-background"><GripVertical className="size-3"/></div> : null}</ResizablePrimitive.Separator> }
export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
