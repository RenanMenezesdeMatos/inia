import type { ResponseTimes } from "./catalogs.js"

/**
 * TEMPOS DE RESPOSTA DE UM GRUPO — decisão da escrita (migrations 194 e 203). A linha do Grupo NUNCA é apagada: "Usar o padrão" a marca
 * `custom = false` e sobe a versão. Assim a versão otimista só cresce: quem abriu a tela antes de uma volta ao padrão (ou antes de os
 * tempos próprios serem recriados) recebe 409, em vez de a versão voltar a 0/1 e a edição concorrente passar por cima.
 * Sem linha nenhuma = versão 0 (Grupo que nunca teve tempos próprios).
 */
export type GroupTimesRow = { custom: boolean; version: number; times: ResponseTimes }

export type GroupTimesPlan =
  | { kind: "CONFLICT"; current: { custom: boolean; times: ResponseTimes; version: number } }
  | { kind: "NONE" }
  /** Volta ao padrão: a linha fica, `custom = false`, versão + 1; `from` = os tempos próprios que deixam de valer. */
  | { kind: "USE_DEFAULT"; from: ResponseTimes; nextVersion: number }
  /** Tempos próprios gravados (linha nova com versão 1 ou a existente com versão + 1); `from` = o que valia antes. */
  | { kind: "SET"; from: ResponseTimes; times: ResponseTimes; nextVersion: number }

const sameTimes = (a: ResponseTimes, b: ResponseTimes) => a.operatorRequeueMinutes === b.operatorRequeueMinutes && a.operatorCloseMinutes === b.operatorCloseMinutes && a.anjoRequeueMinutes === b.anjoRequeueMinutes

export function planGroupResponseTimes(current: GroupTimesRow | null, input: { times: ResponseTimes | null; version: number }, organizationTimes: ResponseTimes): GroupTimesPlan {
  const version = current?.version ?? 0
  const custom = current?.custom === true
  const effective = custom ? current!.times : organizationTimes
  if (version !== input.version) return { kind: "CONFLICT", current: { custom, times: effective, version } }
  if (!input.times) return custom ? { kind: "USE_DEFAULT", from: current!.times, nextVersion: version + 1 } : { kind: "NONE" }
  if (custom && sameTimes(current!.times, input.times)) return { kind: "NONE" }
  return { kind: "SET", from: effective, times: input.times, nextVersion: version + 1 }
}
