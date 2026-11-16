"use client"

import { useElapsed } from "../anjo/use-clock"
import { describeElapsed, formatElapsed } from "@/lib/format/date"

/**
 * CRONÔMETRO AO VIVO (pedido do responsável em 2026-11-12): conta a cada segundo a partir de um instante que veio do SERVIDOR (entrada
 * na fila, troca de estado do Anjo, queda da conexão), pelo relógio do servidor (`offsetMs`). Não chama o servidor: só este elemento
 * redesenha a cada segundo; os dados continuam vindo da releitura de 5 s. "05:07" até 1 hora, "1:25:07" depois; o leitor de tela ouve
 * por extenso ("1 h 25 min").
 */
export function LiveTimer({ since, offsetMs = 0, prefix = "", testId }: { since: string | null | undefined; offsetMs?: number; prefix?: string; testId?: string }) {
  const elapsed = useElapsed(since, offsetMs)
  if (elapsed === null || !since) return <span className="text-muted-foreground">—</span>
  return (
    <time dateTime={since} title={`Desde ${new Date(since).toLocaleString("pt-BR")}`} aria-label={`${prefix}${describeElapsed(elapsed)}`} className="font-mono tabular-nums" data-testid={testId}>
      {prefix}
      {formatElapsed(elapsed)}
    </time>
  )
}
