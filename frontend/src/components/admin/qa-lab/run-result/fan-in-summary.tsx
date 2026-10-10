"use client"

import { AlertTriangle, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"
import { personLabel } from "../qa-lab-format"

type EmployeeFanInOutput = {
  kind: "EMPLOYEE_FAN_IN"
  expectedCount: number
  completedCount: number
  failedCount: number
  children: { employeeId: string; status: "completed" | "failed"; failureReason?: string }[]
}

export function isEmployeeFanInOutput(value: unknown): value is EmployeeFanInOutput {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "EMPLOYEE_FAN_IN"
}

/** "Consolidar resultados" (fan-in/JOIN) — nunca mostra o JSON cru: contagens Esperados/
 * Concluídos/Falharam + lista ✓/! por colaborador, por nome (mesmo padrão de CollectionSummaryCard
 * acima). Enquanto a barreira ainda não liberou, o próprio step fica "waiting" (rótulo genérico de
 * QA_STEP_STATUS_LABELS já cobre isso — quem decide se libera são os colaboradores individuais
 * logo abaixo, cada um com seu próprio Human Review/Wait pendente). */
export function FanInSummaryCard({ output, people }: { output: EmployeeFanInOutput; people: QaRun["trace"]["people"] }) {
  const counts: { label: string; value: number; className?: string }[] = [
    { label: "Esperados", value: output.expectedCount },
    { label: "Concluídos", value: output.completedCount, className: "text-emerald-600 dark:text-emerald-400" },
    { label: "Falharam", value: output.failedCount, className: output.failedCount > 0 ? "text-red-600 dark:text-red-400" : undefined },
  ]
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Consolidação</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        {counts.map((item) => (
          <div key={item.label}>
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={cn("font-semibold", item.className)}>{item.value}</p>
          </div>
        ))}
      </div>
      {output.children.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {output.children.map((child) => (
            <li key={child.employeeId} className="flex items-center gap-1.5 text-xs">
              {child.status === "completed" ? <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />}
              <span>{personLabel(people, child.employeeId)}</span>
              <span className="text-muted-foreground">— {child.status === "completed" ? "concluída" : `falhou${child.failureReason ? ` (${child.failureReason})` : ""}`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">0 execuções esperadas — resultado legítimo, não é um erro.</p>
      )}
    </div>
  )
}
