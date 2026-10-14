/**
 * Fala da INIA no PALCO (sessão de feedback): o balão sobre a cabeça dela mostra o que está sendo dito, no ritmo da voz
 * (`heard` = quantas palavras já soaram); quando ela termina (`ended`), a fala POUSA na mensagem `landOn` da conversa e o balão
 * some. No painel nada disso existe (a legenda continua na conversa).
 */
export type StageUtterance = { key: number; text: string; ended: boolean; landOn: string | null; heard: () => number }

/** Sem alinhamento com o áudio (voz do sistema), ~2,6 palavras por segundo. */
export const STAGE_WORD_MS = 385

/**
 * Texto SEM voz no balão (INIA no mudo, ou a apresentação no mudo): ritmo de leitura (~4 palavras/s). Uma resposta escrita que
 * termina de chegar mostra o resto em no máximo READ_MAX_REMAINING_MS; depois o balão segura um instante e pousa na conversa.
 */
export const READ_WORD_MS = 230

const READ_MAX_REMAINING_MS = 8000

export const READ_HOLD_MS = 1200

/** Relógio do texto sem voz: quantas palavras já apareceram, nunca à frente do texto que já chegou (sem rajadas). */
export function createReadingClock(available: () => number) {
  let shown = 0
  let last = performance.now()
  let carry = 0
  let msPerWord = READ_WORD_MS
  const heard = () => {
    const now = performance.now()
    carry += now - last
    last = now
    const steps = Math.floor(carry / msPerWord)
    if (steps > 0) {
      carry -= steps * msPerWord
      shown = Math.min(available(), shown + steps)
    }
    if (shown >= available()) carry = 0
    return shown
  }
  return {
    heard,
    /** O texto inteiro chegou: o que falta aparece em até READ_MAX_REMAINING_MS. Devolve em quanto tempo o balão pode pousar. */
    finish(total: number): number {
      const remaining = Math.max(0, total - heard())
      if (remaining > 0) msPerWord = Math.min(READ_WORD_MS, READ_MAX_REMAINING_MS / remaining)
      return remaining * msPerWord + READ_HOLD_MS
    },
  }
}

export const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/** Fala terminada sem a mensagem chegar (falha ao gravar, queda): o balão some sozinho depois disso. */
export const STAGE_LAND_WAIT_MS = 2500
