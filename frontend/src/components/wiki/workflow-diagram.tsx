import { ArrowDown, GitBranch } from "lucide-react"

import { cn } from "@/lib/utils"

export type DiagramNode = {
  label: string
  kind: "trigger" | "condition" | "select_employees" | "apply_individually" | "consolidate_results" | "orchestrator" | "human_review" | "action" | "output" | "end"
  branches?: { label: string; tone?: "positive" | "negative" | "neutral" }[]
}

const KIND_STYLES: Record<DiagramNode["kind"], string> = {
  trigger: "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:text-sky-200",
  condition: "border-violet-400/50 bg-violet-500/10 text-violet-900 dark:text-violet-200",
  select_employees: "border-teal-400/50 bg-teal-500/10 text-teal-900 dark:text-teal-200",
  apply_individually: "border-cyan-400/50 bg-cyan-500/10 text-cyan-900 dark:text-cyan-200",
  consolidate_results: "border-lime-400/50 bg-lime-500/10 text-lime-900 dark:text-lime-200",
  orchestrator: "border-indigo-400/50 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200",
  human_review: "border-rose-400/50 bg-rose-500/10 text-rose-900 dark:text-rose-200",
  action: "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-900 dark:text-fuchsia-200",
  output: "border-emerald-400/50 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
  end: "border-slate-400/50 bg-slate-500/10 text-slate-700 dark:text-slate-300",
}

const BRANCH_TONE: Record<NonNullable<DiagramNode["branches"]>[number]["tone"] & string, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-rose-600 dark:text-rose-400",
  neutral: "text-muted-foreground",
}

/** Diagrama simplificado — cards + conectores CSS, sem reproduzir o React Flow do Builder
 * (Parte 44 do pedido: nunca uma biblioteca de diagramação só pra Wiki). */
export function WorkflowDiagram({ nodes }: { nodes: DiagramNode[] }) {
  return (
    <div className="flex flex-col items-start gap-0 overflow-x-auto rounded-lg border border-border bg-muted/20 p-4">
      {nodes.map((node, index) => (
        <div key={index} className="flex w-full flex-col items-start">
          <div className={cn("rounded-md border px-3 py-2 text-xs font-medium shadow-xs", KIND_STYLES[node.kind])}>{node.label}</div>
          {node.branches && node.branches.length > 0 ? (
            <div className="ml-2 flex flex-col gap-1.5 border-l border-dashed border-border py-2 pl-4">
              {node.branches.map((branch) => (
                <div key={branch.label} className="flex items-center gap-1.5 text-xs">
                  <GitBranch className="size-3 text-muted-foreground" />
                  <span className={cn("font-mono font-medium", BRANCH_TONE[branch.tone ?? "neutral"])}>{branch.label}</span>
                </div>
              ))}
            </div>
          ) : index < nodes.length - 1 ? (
            <div className="py-1.5 pl-3.5">
              <ArrowDown className="size-3.5 text-muted-foreground" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
