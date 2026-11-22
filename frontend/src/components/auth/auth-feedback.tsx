import { toneSurface } from "@/components/ui/surface"
import { cn } from "@/lib/utils"

type AuthFeedbackProps = {
  type: "error" | "success" | "warning"
  message: string
}

/** Aviso das telas de login (raio do kit, 16 px). Erro e alerta são anunciados ao leitor de tela. */
export function AuthFeedback({ type, message }: AuthFeedbackProps) {
  return (
    <div
      role={type === "success" ? "status" : "alert"}
      className={cn(
        "px-4 py-3 text-sm",
        type === "error" && "rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive",
        type === "success" && "rounded-2xl border border-primary/20 bg-primary/10 text-primary",
        type === "warning" && toneSurface("warning"),
      )}
    >
      {message}
    </div>
  )
}
