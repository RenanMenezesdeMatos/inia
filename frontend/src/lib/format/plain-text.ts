/** Letra, número ou `_` (Unicode): `_` no meio de uma palavra (HOLD_FOR_QA) não é itálico. */
const WORD = "[\\p{L}\\p{N}_]"
const NOT_WORD = "[^\\p{L}\\p{N}_]"

/**
 * Markdown → TEXTO CORRIDO, para onde a marcação não pode aparecer nem ser renderizada (o balão da INIA no palco, que mostra a
 * fala no ritmo da voz). Tira a marcação e mantém as palavras como estão: `**10min20s**,` vira `10min20s,` (sem espaço novo — o
 * balão conta palavras para acompanhar a voz), `[Abrir processo](/materiais/…)` vira `Abrir processo`, `## Título` vira `Título`.
 * Também serve para texto que AINDA está chegando: um `**` ou um link sem fechamento no fim não aparece.
 *
 * Conteúdo rico continua passando por `components/rich-content/rich-content.tsx`; transcrição literal não passa por aqui.
 */
export function plainTextOf(markdown: string): string {
  const lines = markdown
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    // Link ainda chegando: "[Abrir processo](/mate".
    .replace(/\[([^\]\n]+)\]\([^)\n]*$/, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1")
    .split("\n")
    .map((line) =>
      line
        // Separador de tabela e linha horizontal.
        .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/, "")
        .replace(/^\s*(?:[*_]\s*){3,}$/, "")
        .replace(/^\s*(?:>\s?)+/, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*[-*+•]\s+/, "")
        .replace(/^(\s*(?:\d+[.)]\s+)?)\[[ xX]\]\s+/, "$1")
        .replace(/\s*\|\s*/g, " "),
    )
    .join("\n")
  return emphasisFree(lines)
    .replace(/[ \t]+/g, " ")
    .replace(/^ | $/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Ênfases em par (negrito, itálico, tachado, código) viram só o texto; o que sobra sem par (texto ainda chegando) some. */
function emphasisFree(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*(\S(?:[^\n]*?\S)?)\*\*/g, "$1")
    .replace(new RegExp(`(^|${NOT_WORD})__(\\S(?:[^\\n]*?\\S)?)__(?!${WORD})`, "gu"), "$1$2")
    .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, "$1")
    .replace(new RegExp(`(^|${NOT_WORD})_(\\S(?:[^_\\n]*?\\S)?)_(?!${WORD})`, "gu"), "$1$2")
    .replace(/~~(\S(?:[^\n]*?\S)?)~~/g, "$1")
    .replace(/\*+|~~|`+/g, "")
    .replace(/(^|[\s(“"'])_+(?=\S)/gmu, "$1")
    .replace(/(\S)_+(?=$|[\s.,;:!?)”"'])/gmu, "$1")
}
