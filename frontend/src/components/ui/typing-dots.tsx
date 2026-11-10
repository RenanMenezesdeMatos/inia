import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/**
 * TRÊS PONTOS DE "DIGITANDO" (kit, só apresentação): sobem e acendem em sequência. Decorativos — quem usa escreve ao lado, em texto,
 * quem está digitando. Sem animação para quem pediu movimento reduzido no sistema.
 */
export function TypingDots({ className, ...props }: ComponentProps<"span">) {
  return (
    <span data-slot="typing-dots" aria-hidden className={cn("inline-flex items-center gap-1", className)} {...props}>
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="size-1.5 rounded-full bg-current animate-[typing-dot_1.2s_ease-in-out_infinite] motion-reduce:animate-none" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  )
}
