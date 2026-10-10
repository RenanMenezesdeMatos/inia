import { cn } from "@/lib/utils"

export type TextLimits = { min: number; max: number }

/** A partir de quanto do limite o contador avisa que está perto do fim. */
const NEAR_LIMIT_RATIO = 0.9

const formatCount = (value: number) => value.toLocaleString("pt-BR")

/**
 * Estado do contador. O máximo é conferido no texto como está (o que o contador mostra); o mínimo,
 * sem os espaços das pontas — o backend faz trim antes de validar, então espaço sozinho não conta.
 */
export function characterCountState(value: string, { min, max }: TextLimits) {
  const length = value.length
  const remaining = max - length
  return {
    length,
    remaining,
    over: remaining < 0,
    nearLimit: remaining >= 0 && length >= Math.ceil(max * NEAR_LIMIT_RATIO),
    belowMin: min > 0 && value.trim().length < min,
  }
}

export function isWithinTextLimits(value: string, limits: TextLimits) {
  const state = characterCountState(value, limits)
  return !state.over && !state.belowMin
}

function remainingText(remaining: number) {
  if (remaining < 0) return `${formatCount(-remaining)} acima do limite`
  if (remaining === 0) return "limite atingido"
  return remaining === 1 ? "falta 1" : `faltam ${formatCount(remaining)}`
}

/**
 * Contagem de caracteres embaixo de um campo: "1.234 de 12.000 caracteres · faltam 10.766".
 * Não corta o texto (colar um prompt longo nunca perde o fim em silêncio): passar do limite deixa o
 * contador em vermelho e quem usa decide o que bloquear. Ligue o campo com `aria-describedby={id}`.
 */
export function CharacterCounter({ id, value, limits, className }: { id: string; value: string; limits: TextLimits; className?: string }) {
  const state = characterCountState(value, limits)
  const showMin = state.belowMin && value.trim().length > 0

  return (
    <div className={cn("flex items-start justify-between gap-3 text-xs", className)}>
      <span className="text-muted-foreground">{showMin ? `Mínimo de ${formatCount(limits.min)} caracteres.` : null}</span>
      <span
        id={id}
        data-state={state.over ? "over" : state.nearLimit ? "near" : "ok"}
        className={cn(
          "shrink-0 tabular-nums",
          state.over ? "font-medium text-destructive" : state.nearLimit ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {formatCount(state.length)} de {formatCount(limits.max)} caracteres · {remainingText(state.remaining)}
      </span>
      {/* Anúncio só na troca de estado (não a cada tecla): o texto não muda enquanto continua acima do limite. */}
      <span className="sr-only" aria-live="polite">
        {state.over ? `Limite de ${formatCount(limits.max)} caracteres excedido.` : ""}
      </span>
    </div>
  )
}
