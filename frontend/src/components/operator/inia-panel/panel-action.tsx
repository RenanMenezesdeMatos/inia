import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Ação do cabeçalho do painel da INIA: um ícone com nome (dica e leitor de tela). `collapse`: o botão que recebe o foco quando o painel reabre. */
export function PanelAction({ label, onClick, disabled = false, pressed, usageElement, collapse = false, children }: { label: string; onClick(): void; disabled?: boolean; pressed?: boolean; usageElement?: string; collapse?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="pointer-coarse:size-10" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed} data-usage-element={usageElement} data-chat-collapse={collapse ? "" : undefined}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="inia-tooltip-genie">{label}</TooltipContent>
    </Tooltip>
  )
}
