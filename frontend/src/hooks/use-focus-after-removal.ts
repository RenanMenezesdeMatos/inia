import { useEffect, useRef, type RefObject } from "react"

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * FOCO DEPOIS DE REMOVER UM SELO — o botão removido leva o foco junto (cai no `body`). Chame `removing(index)` no clique: quando a lista
 * encolhe, o foco vai para o próximo selo (ou o anterior, no fim); sem nenhum, para o controle que vem antes da lista (ex.: o filtro).
 * Cada selo traz `data-removable`.
 */
export function useFocusAfterRemoval<T extends HTMLElement>(listRef: RefObject<T | null>, count: number) {
  const pending = useRef<{ index: number; fallback: HTMLElement | null } | null>(null)
  useEffect(() => {
    const removed = pending.current
    if (!removed) return
    pending.current = null
    // Só quando o foco realmente se perdeu (quem removeu pode ter levado o foco para outro lugar).
    if (document.activeElement && document.activeElement !== document.body) return
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-removable]") ?? []
    ;(items[Math.min(removed.index, items.length - 1)] ?? removed.fallback)?.focus()
  }, [count, listRef])
  return (index: number) => {
    const list = listRef.current
    const siblings = [...(list?.parentElement?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((element) => !list!.contains(element))
    const before = siblings.filter((element) => list!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)
    pending.current = { index, fallback: before.at(-1) ?? siblings[0] ?? null }
  }
}
