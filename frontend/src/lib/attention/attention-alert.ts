/**
 * CHAMAR A ATENÇÃO DE QUEM NÃO ESTÁ OLHANDO A TELA (Apoio com Anjo: atendimento novo e mensagem nova, dos dois lados): um som curto e o
 * título da aba piscando até a página voltar a ser vista.
 *
 * Os navegadores só deixam tocar áudio depois de um gesto da pessoa: o som é preparado (`prime`) no primeiro clique ou tecla da página,
 * e só então `play` consegue tocar — inclusive com a aba escondida. O som é sintetizado pela Web Audio (nenhum arquivo é baixado). Sem
 * Web Audio (navegador antigo, testes), tudo vira nada sem erro.
 */
type AudioContextConstructor = new () => AudioContext

export type Chime = { prime(): void; play(): void; dispose(): void }

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null
  const candidate = window as Window & { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor }
  return candidate.AudioContext ?? candidate.webkitAudioContext ?? null
}

export function createChime(): Chime {
  let context: AudioContext | null = null
  const prime = () => {
    try {
      const Constructor = audioContextConstructor()
      if (!Constructor) return
      context ??= new Constructor()
      if (context.state === "suspended") void context.resume().catch(() => undefined)
    } catch {
      // Navegador recusou criar o áudio: o aviso fica só no título e na tela.
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
      // Sem som não é falha da tela: o título e o aviso na tela continuam.
    }
  }
  const dispose = () => {
    const current = context
    context = null
    if (current && current.state !== "closed") void current.close().catch(() => undefined)
  }
  return { prime, play, dispose }
}

/**
 * Prepara o som no primeiro clique ou tecla da página (quem já estava com a tela aberta ao recarregar não passa por outro gesto).
 * Devolve a função que remove os ouvintes.
 */
export function primeChimeOnFirstGesture(chime: Chime): () => void {
  if (typeof document === "undefined") return () => undefined
  const prime = () => chime.prime()
  document.addEventListener("pointerdown", prime, { once: true })
  document.addEventListener("keydown", prime, { once: true })
  return () => {
    document.removeEventListener("pointerdown", prime)
    document.removeEventListener("keydown", prime)
  }
}

const BLINK_INTERVAL_MS = 1_000

/** A página está sendo vista: aba visível E janela em foco (a mesma regra do "lida"). */
export const pageIsSeen = () => typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()

/** Um pisca-pisca por aba: começar outro (ou parar) devolve o título original antes. */
let stopActiveBlink: (() => void) | null = null

/**
 * Título da aba alternando entre o aviso e o título original até a página voltar a ser vista. Com a página já vista, não pisca (a
 * pessoa já está olhando). Devolve a função que para e restaura o título.
 */
export function blinkTabTitle(text: string): () => void {
  if (typeof document === "undefined" || pageIsSeen()) return () => undefined
  stopActiveBlink?.()
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
    document.removeEventListener("visibilitychange", onSeen)
    document.title = original
    if (stopActiveBlink === stop) stopActiveBlink = null
  }
  // A janela ganhou o foco: a pessoa voltou. Aba que volta a ficar visível só conta com a janela em foco.
  const onSeen = () => {
    if (pageIsSeen()) stop()
  }
  window.addEventListener("focus", stop)
  document.addEventListener("visibilitychange", onSeen)
  stopActiveBlink = stop
  return stop
}

/** Título da aba quando chega mensagem nova da outra ponta do apoio e a pessoa não está vendo a página. */
export const newMessageTitle = (senderName: string) => `• Nova mensagem de ${senderName} — INIA`

/** Para o pisca-pisca desta aba, se houver (ex.: a pessoa abriu a conversa em outra aba). */
export function stopTabTitleBlink(): void {
  stopActiveBlink?.()
}
