import { FAILURE_COPY } from "@/lib/errors/failure"

/**
 * As duas artes de "sem conexão" ALTERNAM entre ocorrências novas (roteador, celular, roteador…) e ficam FIXAS enquanto a tela de
 * uma ocorrência está aberta. A escolha é por ocorrência (chave = referência), guardada na memória: renderizar de novo (inclusive
 * o render duplo do StrictMode) devolve a mesma arte. O contador entre ocorrências fica no localStorage (sobrevive a recarregar).
 * Nunca roda no servidor: as telas de sem conexão só existem no navegador (sem divergência na hidratação).
 */
const COUNTER_KEY = "inia.offline-art-counter"
const chosen = new Map<string, number>()
let memoryCounter = 0

function nextIndex(): number {
  let counter = memoryCounter
  try {
    counter = Number(window.localStorage.getItem(COUNTER_KEY) ?? memoryCounter) || 0
    window.localStorage.setItem(COUNTER_KEY, String(counter + 1))
  } catch {
    // Sem localStorage: alterna só nesta aba.
  }
  memoryCounter = counter + 1
  return counter % 2
}

export function offlineArtFor(occurrence: string): string {
  let index = chosen.get(occurrence)
  if (index === undefined) {
    index = nextIndex()
    chosen.set(occurrence, index)
  }
  return FAILURE_COPY.offline.arts[index]!
}
