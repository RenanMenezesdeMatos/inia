/**
 * RELÓGIO — "que instante é agora?" (UTC absoluto). Abstração única e mínima para que todo caminho
 * temporal de decisão (disponibilidade D-1/D-2, reconciliação, classificação, alertas de horizonte e
 * de fonte, cargas da Central) seja determinístico em teste (`fixedClock`) e real em produção
 * (`systemClock`). NÃO confundir com o fuso da organização: o Clock dá o instante; o timezone da
 * organização (`organization-timezone.ts`) dá a leitura civil/local desse instante.
 *
 * Regra: timestamp semanticamente relevante escrito pela aplicação (detected_at, resolved_at,
 * classified_at, superseded_at, created_at de alertas, queued_at/finished_at de cargas) recebe o
 * valor do Clock em vez de `now()` do banco — `now()` fica só para defaults técnicos (updated_at etc.).
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

/** Relógio parado num instante (testes/provas): o mesmo `now` em toda a chamada. */
export function fixedClock(instant: Date | string): Clock {
  const at = new Date(instant)
  if (Number.isNaN(at.getTime())) throw new Error(`fixedClock: instante inválido "${String(instant)}"`)
  return { now: () => new Date(at.getTime()) }
}

/** Aceita um Clock ou um instante e devolve o instante — para funções que recebem `now` explícito. */
export function instantOf(clock: Clock | Date): Date {
  return clock instanceof Date ? clock : clock.now()
}
