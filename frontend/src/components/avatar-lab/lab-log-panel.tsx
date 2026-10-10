"use client"

import type { LabSnapshot } from "@/lib/avatar/lab/lab-controller"
import { cn } from "@/lib/utils"
import { LabSection } from "./lab-fields"

const SOURCE_LABEL = { fixture: "captura", live: "real", lab: "lab" } as const

/** Transcrição da resposta em andamento + log de eventos (poucas linhas por turno, estado do React é ok). */
export function LabLogPanel({ snapshot }: { snapshot: LabSnapshot }) {
  const entries = [...snapshot.log].reverse()
  return (
    <LabSection title="Transcrição e eventos">
      <p className="min-h-10 rounded-md bg-muted/60 p-2 text-sm">{snapshot.assistantText || <span className="text-muted-foreground">(sem resposta em andamento)</span>}</p>
      <ol className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[11px]">
        {entries.map((entry) => (
          <li key={entry.id} className={cn("flex gap-2", entry.tone === "error" ? "text-destructive" : entry.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            <span className="shrink-0 tabular-nums">{new Date(entry.at).toLocaleTimeString("pt-BR", { hour12: false })}</span>
            <span className="shrink-0">[{SOURCE_LABEL[entry.source]}]</span>
            <span className={cn("min-w-0 break-words", entry.tone === "info" && "text-foreground/90")}>{entry.text}</span>
          </li>
        ))}
      </ol>
    </LabSection>
  )
}
