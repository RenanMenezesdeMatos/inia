"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * O Radix envolve o conteúdo num `display: table` (inline), que cresce até a largura do filho mais largo: uma tabela em markdown
 * numa resposta alargava a lista inteira além do painel e cortava a borda direita de TODAS as mensagens (sem barra horizontal, o
 * excesso fica escondido). Como bloco, o conteúdo tem a largura do viewport e quem é largo rola dentro de si (`overflow-x-auto`).
 */
function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("inia-scroll-fade relative", className)} {...props}><ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className="size-full rounded-[inherit] outline-none [&>div]:block!">{children}</ScrollAreaPrimitive.Viewport><ScrollBar/><ScrollAreaPrimitive.Corner/></ScrollAreaPrimitive.Root>
}

function ScrollBar({ className, orientation = "vertical", ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return <ScrollAreaPrimitive.ScrollAreaScrollbar data-slot="scroll-area-scrollbar" orientation={orientation} className={cn("flex touch-none p-px transition-colors select-none", orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent", orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent", className)} {...props}><ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="relative flex-1 rounded-full bg-border"/></ScrollAreaPrimitive.ScrollAreaScrollbar>
}

export { ScrollArea, ScrollBar }
