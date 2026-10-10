import { demoId } from "./demo-ids.js"

/**
 * Flags de canal usadas pela massa. As quatro primeiras JÁ EXISTEM no catálogo real (migrations
 * 015/019) e são reutilizadas pelo nome; as demais são criadas pelo seed via o mesmo contrato
 * (`channel_flags`, canal VOICE, BOOLEAN) só se ainda não existirem — nunca duplicadas.
 */
export const DEMO_CHANNEL = "VOICE"

export type DemoFlagSpec = { name: string; valueType: "BOOLEAN" | "NUMERIC"; description: string; existing: boolean }

export const DEMO_FLAGS: readonly DemoFlagSpec[] = [
  { name: "nota_ura", valueType: "NUMERIC", description: "Nota de satisfação respondida na URA ao final da chamada.", existing: true },
  { name: "rechamada", valueType: "BOOLEAN", description: "Chamada identificada como novo contato sobre o mesmo motivo de uma chamada anterior.", existing: true },
  { name: "tempo_silencio", valueType: "NUMERIC", description: "Tempo total de silêncio na chamada, em segundos.", existing: true },
  { name: "tdna", valueType: "NUMERIC", description: "Taxa de desconexão não autorizada.", existing: true },
  { name: "cancelamento", valueType: "BOOLEAN", description: "Cliente manifestou intenção de cancelar produto ou contrato durante a chamada.", existing: false },
  { name: "contestacao", valueType: "BOOLEAN", description: "Cliente contestou uma cobrança ou lançamento em fatura.", existing: false },
  { name: "transferencia", valueType: "BOOLEAN", description: "Chamada transferida para outra área ou nível de atendimento.", existing: false },
  { name: "detrator", valueType: "BOOLEAN", description: "Cliente encerrou insatisfeito, com ameaça de reclamação externa ou de cancelamento.", existing: false },
]

export function demoFlagId(name: string): string {
  return demoId(`channel-flag:${DEMO_CHANNEL}:${name}`)
}
