import { DatabaseZap } from "lucide-react"

import { cn } from "@/lib/utils"
import type { SourceManager } from "@/schemas/admin/user-account.schema"

/** "Vem da base RH Corporativo · Colaboradores — altere na origem": fonte e conjunto de dados da Central que mandam no campo. */
export function sourceManagedText(manager: SourceManager): string {
  return `Vem da base ${manager.sourceName} · ${manager.feedName} — altere na origem`
}

/**
 * Aviso sob um campo da pessoa que a base do cliente controla. O campo fica desabilitado: a próxima carga da Central
 * sobrescreveria qualquer edição feita aqui, então a correção é na origem. Sem `manager`, não mostra nada (campo da INIA).
 */
export function SourceManagedNotice({ manager, id, className }: { manager: SourceManager | null; id?: string; className?: string }) {
  if (!manager) return null
  return (
    <p id={id} data-testid="source-managed-notice" className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <DatabaseZap className="size-3 shrink-0" aria-hidden />
      {sourceManagedText(manager)}
    </p>
  )
}
