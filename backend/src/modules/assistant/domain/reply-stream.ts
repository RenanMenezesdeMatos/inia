/**
 * TEXTO EM FLUXO SEM MARCADOR INTERNO. A resposta do modelo pode terminar com linhas internas (`SUPPORT_MATERIALS_JSON:`,
 * `STRUCTURED_RESULT_JSON:`, `EVIDENCE_JSON:`) que são lidas pelo código e nunca mostradas. Em fluxo, o texto vai para a tela
 * enquanto chega — exceto:
 *
 *  - uma linha que COMEÇA com um marcador: dali em diante nada mais sai (o marcador e o que vier depois ficam com o código);
 *  - a última linha ainda incompleta que pode virar um marcador (ex.: "SUPP"): espera o próximo pedaço decidir.
 *
 * O texto final (depois dos parsers de sempre) é conferido com o que foi mostrado por `reconcileShownText`.
 */
export type MarkerSafeText = {
  push(chunk: string): void
  /** O que já foi entregue (sempre um prefixo do texto recebido). */
  emitted(): string
}

export function createMarkerSafeText(markers: readonly string[], out: (text: string) => void): MarkerSafeText {
  let buffer = ""
  let emittedLength = 0
  let blocked = false
  return {
    push(chunk) {
      if (blocked || !chunk) return
      buffer += chunk
      let safeEnd = buffer.length
      // Início da linha em que o texto ainda não entregue começa.
      let lineStart = buffer.lastIndexOf("\n", emittedLength - 1) + 1
      for (;;) {
        const newline = buffer.indexOf("\n", lineStart)
        const line = (newline === -1 ? buffer.slice(lineStart) : buffer.slice(lineStart, newline)).trimStart()
        if (markers.some((marker) => line.startsWith(marker))) {
          blocked = true
          safeEnd = lineStart
          break
        }
        if (newline === -1) {
          if (markers.some((marker) => marker.startsWith(line))) safeEnd = lineStart
          break
        }
        lineStart = newline + 1
      }
      if (safeEnd > emittedLength) {
        out(buffer.slice(emittedLength, safeEnd))
        emittedLength = safeEnd
      }
    },
    emitted: () => buffer.slice(0, emittedLength),
  }
}

/**
 * O que falta enviar para a tela mostrar EXATAMENTE `finalText`, dado o que já foi mostrado em fluxo: o restante (texto final
 * começa com o mostrado — o caso normal) ou, se o texto final mudou o que já estava na tela, retirar e mandar o texto inteiro.
 * Espaços no fim do que foi mostrado não contam (os parsers aparam o texto final).
 */
export function reconcileShownText(shown: string, finalText: string): { retract: boolean; append: string } {
  if (!shown) return { retract: false, append: finalText }
  if (finalText.startsWith(shown)) return { retract: false, append: finalText.slice(shown.length) }
  const trimmed = shown.trimEnd()
  if (finalText.startsWith(trimmed) && finalText.length >= trimmed.length) {
    const rest = finalText.slice(trimmed.length)
    // O mostrado tinha espaços/quebras a mais no fim que o texto final não tem: só sobra acrescentar o que vier depois deles.
    if (rest.trim() === "") return { retract: false, append: "" }
  }
  return { retract: true, append: finalText }
}
