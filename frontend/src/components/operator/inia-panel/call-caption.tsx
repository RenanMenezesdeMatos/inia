"use client"

import { useEffect, useState } from "react"

const MAX_WORDS = 8
const MIN_WORDS_AT_PAUSE = 4

/** Legendas por trecho (como no cinema), nunca palavra a palavra: quebra na pontuação e, sem ela, em até 8 palavras. Estável quando o texto
 * cresce: só o último trecho muda. */
export function captionPhrases(text: string): { text: string; endWord: number }[] {
  const phrases: { text: string; endWord: number }[] = []
  let current: string[] = []
  let count = 0
  for (const word of text.replace(/[*_`#>|]/g, " ").split(/\s+/).filter(Boolean)) {
    current.push(word)
    count += 1
    if (/[.?!…]["”)]?$/.test(word) || (/[,;:]$/.test(word) && current.length >= MIN_WORDS_AT_PAUSE) || current.length >= MAX_WORDS) {
      phrases.push({ text: current.join(" "), endWord: count })
      current = []
    }
  }
  if (current.length > 0) phrases.push({ text: current.join(" "), endWord: count })
  return phrases
}

export function captionAt(text: string, heardWords: number): string {
  const phrases = captionPhrases(text)
  return (phrases.find((phrase) => heardWords < phrase.endWord) ?? phrases.at(-1))?.text ?? ""
}

/**
 * Legenda de vídeo (YouTube, filmes): texto branco, centralizado, com um fundo preto translúcido que abraça cada linha, logo acima dos
 * controles. Só existe quando a voz entrega o TEXTO do que está sendo dito; aparece no ritmo da voz (`heardWords`, o mesmo relógio do balão
 * do palco). Escondida de leitores de tela: a mesma fala está na conversa.
 */
export function CallCaption({ text, heardWords, bottom }: { text: string; heardWords(): number; bottom: number }) {
  const [phrase, setPhrase] = useState(() => captionAt(text, 0))
  useEffect(() => {
    const update = () => setPhrase(captionAt(text, heardWords()))
    update()
    const timer = window.setInterval(update, 120)
    return () => window.clearInterval(timer)
  }, [text, heardWords])
  if (!phrase) return null
  return (
    <p aria-hidden data-testid="inia-call-caption" className="pointer-events-none absolute inset-x-0 z-10 px-[4%] text-center leading-[1.5] text-balance pointer-coarse:pb-1.5" style={{ bottom, fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif', fontSize: "clamp(11.5px, 3.3cqw, 22px)" }}>
      <span className="box-decoration-clone rounded-[2px] bg-[rgb(8_8_8/0.55)] px-[0.45em] py-[0.12em] font-medium text-white [text-shadow:0_0_3px_rgb(0_0_0/0.9)]">{phrase}</span>
    </p>
  )
}
