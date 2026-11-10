/**
 * AVISO DE ATENDIMENTO NOVO NA ÁREA DO ANJO (design_draft.md seção 14, D9): um som curto e o título da aba piscando até a aba voltar
 * a ter foco. Os navegadores só deixam tocar áudio depois de um gesto da pessoa: o som é preparado (`prime`) no clique em "Ficar
 * disponível" (e no primeiro clique ou tecla na área), e só então `play` consegue tocar. O som é sintetizado pela Web Audio — nenhum
 * arquivo de áudio é baixado. Sem Web Audio (navegador antigo, testes), tudo vira nada sem erro.
 */
type AudioContextConstructor = new () => AudioContext

export type AttendanceChime = { prime(): void; play(): void; dispose(): void }

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null
  const candidate = window as Window & { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor }
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null
}

export function createAttendanceChime(): AttendanceChime {
  let context: AudioContext | null = null
  const prime = () => {
    try {
      const Constructor = audioContextConstructor()
      if (!Constructor) return
      context ??= new Constructor()
      if (context.state === "suspended") void context.resume().catch(() => undefined)
    } catch {
      // Navegador recusou criar o áudio: o aviso fica só no título e na aba aberta.
    }
  }
  /** Dois toques curtos e baixos (880 Hz e 1320 Hz, ~0,35 s no total). */
  const play = () => {
    try {
      if (!context) prime()
      if (!context || context.state === "closed") return
      const start = context.currentTime + 0.01
      for (const [offset, frequency, duration] of [[0, 880, 0.14], [0.17, 1320, 0.18]] as const) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = "sine"
        oscillator.frequency.setValueAtTime(frequency, start + offset)
        gain.gain.setValueAtTime(0.0001, start + offset)
        gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start + offset)
        oscillator.stop(start + offset + duration + 0.02)
      }
    } catch {
      // Sem som não é falha da área: o título e a aba aberta continuam avisando.
    }
  }
  const dispose = () => {
    const current = context
    context = null
    if (current && current.state !== "closed") void current.close().catch(() => undefined)
  }
  return { prime, play, dispose }
}

export const NEW_ATTENDANCE_TITLE = "• Novo atendimento — INIA"
const BLINK_INTERVAL_MS = 1_000

const tabHasFocus = () => typeof document !== "undefined" && !document.hidden && document.hasFocus()

/**
 * Título da aba alternando entre o aviso e o título original até a aba ter foco. Com a aba já em foco, não pisca (a pessoa já vê o
 * atendimento aberto). Devolve a função que para e restaura o título.
 */
export function blinkTabTitle(text: string = NEW_ATTENDANCE_TITLE): () => void {
  if (typeof document === "undefined" || tabHasFocus()) return () => undefined
  const original = document.title
  let showing = true
  document.title = text
  const timer = window.setInterval(() => {
    showing = !showing
    document.title = showing ? text : original
  }, BLINK_INTERVAL_MS)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener("focus", stop)
    document.removeEventListener("visibilitychange", onVisibility)
    document.title = original
  }
  const onVisibility = () => {
    if (tabHasFocus()) stop()
  }
  window.addEventListener("focus", stop)
  document.addEventListener("visibilitychange", onVisibility)
  return stop
}
