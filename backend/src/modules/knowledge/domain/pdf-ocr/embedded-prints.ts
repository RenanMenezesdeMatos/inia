import type { OcrBox } from "./hocr.js"

/**
 * Prints pela posição das imagens que o próprio PDF guarda, para as páginas sem camada de texto que NÃO são digitalização.
 *
 * Por que existe (20/11/2026): uma instrução de trabalho impressa do navegador pelo "Microsoft: Print To PDF" chega com o texto desenhado como
 * contorno vetorial (sem camada de texto: a página vai para o OCR) e com cada print como uma imagem própria, com posição exata. A regra da tinta
 * (`print-regions.ts`) só reconhece print pela letra menor que a do corpo, e ali o print do login tinha a letra do mesmo tamanho do corpo: ficou
 * como texto, com o lixo da leitura da tela misturado aos passos. Quando o PDF diz onde estão as imagens, isso é a verdade, e não um palpite.
 *
 * Como a página é classificada:
 *  - `SCAN`: uma imagem (ou várias emendadas) cobre a página quase inteira. É digitalização: os prints estão DENTRO dessa imagem e só a regra da
 *    tinta acha (`PDF_PRINT_RULE_V1`, sem mudança).
 *  - `EMBEDDED`: a página não tem imagem do tamanho da página. Todo print de tela precisa ser uma imagem do PDF (não há outro jeito de pôr pixels
 *    numa página), então os prints são as imagens, e a regra da tinta NÃO é aplicada: o resto é desenho vetorial (o texto contornado), e a regra
 *    cortaria como print uma área de letra pequena de verdade (rodapé, tabela).
 *
 * Fatiamento: geradores como o "Print To PDF" e o Word guardam uma imagem em tiras (no arquivo de 20/11, tiras de 7 pixels de altura). As tiras que
 * se encostam e têm a mesma largura viram uma imagem só antes de qualquer decisão.
 *
 * Fundo: imagem com desenho vetorial por cima (caixa de botão com o texto desenhado sobre ela) não é print; o texto de cima é do documento. Conta-se
 * o número de pequenos desenhos pintados DEPOIS da imagem e dentro dela (letras contornadas).
 *
 * V2 (20/11/2026, run-8, SB-01): página com operações ou imagens demais (PDF montado para prender o leitor) não é classificada pelas imagens —
 * segue a regra da tinta, como a página digitalizada (`maxPageOperators`, `maxPlacements`), e só os primeiros `maxPrintsPerPage` prints são
 * recortados à tinta. Páginas normais (manuais, "Print To PDF") têm resultado igual ao da V1.
 *
 * V3 (21/11/2026, QA-07 da run-8, comprovado com `scripts/dev/pdf-ocr-eval/gerar-digitalizado.ts`): digitalização cuja imagem NÃO cobre 85% da
 * página (app de celular, Carta impressa em A4, margem branca do scanner — no teste, 70% da área) era tomada por um print só e a página inteira
 * saía do texto (539 de 539 palavras perdidas). Agora, depois da primeira leitura, a página `EMBEDDED` volta a ser `SCAN` quando uma imagem cobre
 * ao menos `scanLikeAreaShare` da página e quase todo o texto lido está dentro das imagens (fora delas, menos de `scanLikeOutsideWords` das
 * palavras). No "Print To PDF" o texto contornado fica FORA das imagens, então ele continua `EMBEDDED`.
 */
export const PDF_EMBEDDED_PRINT_RULE = {
  version: "PDF_EMBEDDED_PRINTS_V3",
  /** V3: a maior imagem cobre ao menos isto da área da página… */
  scanLikeAreaShare: 0.35,
  /** …e menos que isto das palavras lidas está fora de todas as imagens: a imagem é a página digitalizada, não um print. */
  scanLikeOutsideWords: 0.1,
  /** Com menos palavras lidas que isto, a página não tem texto para decidir: fica como estava. */
  scanLikeMinWords: 15,
  /** Acima disto, a lista de operações da página não é percorrida: a página segue a regra da tinta. */
  maxPageOperators: 300_000,
  /** Acima disto (antes de emendar as tiras), idem — o emendar é quadrático. */
  maxPlacements: 400,
  /** Prints recortados à tinta por página, no máximo. */
  maxPrintsPerPage: 60,
  /** Página digitalizada: uma imagem cobre pelo menos isto da largura E da altura da página. */
  fullPageShare: 0.85,
  /** Tiras emendadas: no máximo este vão vertical (pontos) e quase a mesma posição horizontal (pontos). */
  stripGap: 1.5,
  stripAlign: 2,
  /** Imagem pequena demais é ícone, enfeite ou linha: a mesma área mínima da leitura das imagens do PDF (0,5% da página). */
  minPageShare: 0.005,
  /** Lado mínimo em pontos (linha separadora feita de imagem de 1 ponto fica de fora). */
  minSide: 12,
  /** Com tantos desenhos pequenos por cima, a imagem é fundo de texto vetorial e não print. */
  overlayMarks: 12,
} as const

export type PdfImagePlacement = OcrBox & {
  /** Pequenos desenhos (letras contornadas, ícones) pintados depois da imagem com o centro dentro dela. */
  marksOver: number
}

export type ScannedPageSource = "SCAN" | "EMBEDDED"

const overlapX = (a: OcrBox, b: OcrBox) => Math.min(a.right, b.right) - Math.max(a.left, b.left)
const overlapY = (a: OcrBox, b: OcrBox) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)

/** Junta as tiras de uma mesma imagem: vizinhas na vertical com as mesmas bordas laterais, ou na horizontal com as mesmas bordas de cima e de baixo. */
export function mergeStrips(placements: readonly PdfImagePlacement[]): PdfImagePlacement[] {
  const rule = PDF_EMBEDDED_PRINT_RULE
  const boxes = placements.map((box) => ({ ...box }))
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!
        const b = boxes[j]!
        const sameColumn = Math.abs(a.left - b.left) <= rule.stripAlign && Math.abs(a.right - b.right) <= rule.stripAlign
        const sameRow = Math.abs(a.top - b.top) <= rule.stripAlign && Math.abs(a.bottom - b.bottom) <= rule.stripAlign
        const verticalGap = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)
        const horizontalGap = Math.max(a.left, b.left) - Math.min(a.right, b.right)
        if ((sameColumn && verticalGap <= rule.stripGap) || (sameRow && horizontalGap <= rule.stripGap)) {
          boxes[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom), marksOver: a.marksOver + b.marksOver }
          boxes.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return boxes
}

/** Uma imagem contida em outra (miniatura sobre o print, o número vermelho sobre a tela) não vira um segundo corte. */
function dropContained(boxes: readonly OcrBox[]): OcrBox[] {
  return boxes.filter((box, index) => !boxes.some((other, otherIndex) => otherIndex !== index && overlapX(box, other) >= box.right - box.left - 0.5 && overlapY(box, other) >= box.bottom - box.top - 0.5 && (other.right - other.left) * (other.bottom - other.top) > (box.right - box.left) * (box.bottom - box.top)))
}

export type ScannedPageClassification = { source: ScannedPageSource; prints: OcrBox[] }

/** Classifica a página sem camada de texto e, quando ela não é digitalização, devolve os prints pela posição das imagens (em pontos, origem no alto). */
export function classifyScannedPage(placements: readonly PdfImagePlacement[], pageWidth: number, pageHeight: number): ScannedPageClassification {
  const rule = PDF_EMBEDDED_PRINT_RULE
  const clipped = placements
    .map((box) => ({ ...box, left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(pageWidth, box.right), bottom: Math.min(pageHeight, box.bottom) }))
    .filter((box) => box.right > box.left && box.bottom > box.top)
  const images = mergeStrips(clipped)
  if (images.some((box) => box.right - box.left >= pageWidth * rule.fullPageShare && box.bottom - box.top >= pageHeight * rule.fullPageShare)) return { source: "SCAN", prints: [] }
  const prints = images
    .filter((box) => box.marksOver < rule.overlayMarks)
    .filter((box) => box.right - box.left >= rule.minSide && box.bottom - box.top >= rule.minSide && (box.right - box.left) * (box.bottom - box.top) >= pageWidth * pageHeight * rule.minPageShare)
    .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }))
  return { source: "EMBEDDED", prints: dropContained(prints).sort((a, b) => a.top - b.top || a.left - b.left) }
}

/**
 * V3: a página que a posição das imagens chamou de `EMBEDDED` é, na verdade, digitalização com margem? Decide pelo texto da primeira leitura:
 * imagem grande + quase nenhuma palavra fora das imagens = o texto do documento está dentro da imagem, e cortá-la como print apagaria a página.
 */
export function embeddedLooksScanned(prints: readonly OcrBox[], words: readonly OcrBox[], pageWidth: number, pageHeight: number): boolean {
  const rule = PDF_EMBEDDED_PRINT_RULE
  if (prints.length === 0 || words.length < rule.scanLikeMinWords) return false
  const largest = Math.max(...prints.map((box) => (box.right - box.left) * (box.bottom - box.top)))
  if (largest < pageWidth * pageHeight * rule.scanLikeAreaShare) return false
  const inside = (word: OcrBox) => prints.some((box) => {
    const x = (word.left + word.right) / 2
    const y = (word.top + word.bottom) / 2
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
  })
  return words.filter((word) => !inside(word)).length < words.length * rule.scanLikeOutsideWords
}
