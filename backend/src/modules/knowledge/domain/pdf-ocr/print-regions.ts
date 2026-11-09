import type { OcrBox, OcrWord } from "./hocr.js"

/**
 * Onde estão os prints numa página digitalizada, para cortá-los como imagem e o Tesseract não ler o texto de dentro deles como se fosse do documento.
 * O Tesseract identifica o texto e o tamanho de cada letra; a regra junta isso às áreas contínuas de tinta da página: uma faixa de tinta cujo texto é
 * bem menor que o do corpo do documento (letra de tela) é print, e uma faixa grande sem texto também (foto, desenho).
 *
 * Os números foram travados antes do teste com manuais que a regra nunca tinha visto (06/11/2026) e não mudam sem medir de novo. Em 07/11, com o código
 * daqui: 43 de 159 e 84 de 159 prints achados em manuais novos, nenhuma palavra real tirada do texto em páginas limpas; em escaneamento simulado,
 * duas áreas de texto real pequeno com fundo (tabela, quadro) foram cortadas como imagem (105 de 57.021 e 26 de 56.957 palavras). Duas correções
 * declaradas antes da validação (limite 0,75; faixa de cor sólida não corta) não evitaram a perda na validação e ficaram de fora. Errar para o lado
 * de deixar um print como texto é o aceitável aqui. Ver docs/dev/pdf-para-markdown/relatorio.md.
 */
export const PDF_PRINT_RULE = {
  version: "PDF_PRINT_RULE_V1",
  /** Pixel colorido: diferença entre o maior e o menor canal. */
  saturation: 28,
  /** Pixel escuro: abaixo do tom mais comum da página (o papel) menos isto. */
  darkerThanPaper: 17,
  /** Uma linha de pixels tem tinta com pelo menos isto de pixels de tinta. */
  inkPerRow: 3,
  /** Altura mínima de uma faixa contínua de tinta, em pontos. */
  minBandHeight: 24,
  /** Espaço em branco que separa duas colunas dentro da faixa, em pontos. */
  columnGap: 14,
  /** Largura mínima de uma área, em fração da largura da página. */
  minWidthShare: 0.1,
  /** Print: a letra mediana da área é no máximo isto da letra do corpo do documento. */
  smallTextRatio: 0.8,
  /** Com menos palavras que isto, a área conta como imagem sem texto. */
  minWords: 3,
  /** Imagem sem texto: altura e área mínimas, em pontos. */
  minBlankHeight: 40,
  minBlankArea: 3000,
  /** Áreas marcadas que se encostam na vertical (até isto, em pontos, e com metade da largura em comum) viram um print só. */
  mergeGap: 16,
  mergeOverlap: 0.5,
  /** O corpo do documento: palavras lidas com confiança acima disto, fora das faixas altas (que podem ser prints). */
  bodyConfidence: 80,
  tallBand: 60,
} as const

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export const isInside = (word: OcrBox, box: OcrBox): boolean => {
  const x = (word.left + word.right) / 2
  const y = (word.top + word.bottom) / 2
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/**
 * As faixas contínuas de tinta da página desenhada (RGBA), separadas em colunas, em pontos. `scale` = pixels por ponto. A cor do papel é o tom mais
 * comum da página, então papel amarelado ou acinzentado de digitalização também funciona.
 */
export function inkBands(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, scale: number): OcrBox[] {
  const rule = PDF_PRINT_RULE
  const histogram = new Int32Array(256)
  for (let index = 0; index + 2 < rgba.length; index += 16) histogram[Math.round((rgba[index]! + rgba[index + 1]! + rgba[index + 2]!) / 3)]! += 1
  let paper = 255
  let most = 0
  for (let tone = 0; tone < 256; tone += 1) {
    if (histogram[tone]! > most) {
      most = histogram[tone]!
      paper = tone
    }
  }
  const darkLimit = paper - rule.darkerThanPaper
  const ink = new Uint8Array(width * height)
  for (let index = 0, pixel = 0; pixel < ink.length; index += 4, pixel += 1) {
    const red = rgba[index]!
    const green = rgba[index + 1]!
    const blue = rgba[index + 2]!
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > rule.saturation || (red + green + blue) / 3 < darkLimit) ink[pixel] = 1
  }
  const rowInk = new Int32Array(height)
  for (let y = 0; y < height; y += 1) {
    let count = 0
    for (let x = 0, offset = y * width; x < width; x += 1) count += ink[offset + x]!
    rowInk[y] = count
  }
  const bands: OcrBox[] = []
  const minHeight = Math.round(rule.minBandHeight * scale)
  const gap = Math.round(rule.columnGap * scale)
  let y = 0
  while (y < height) {
    if (rowInk[y]! < rule.inkPerRow) {
      y += 1
      continue
    }
    let end = y
    while (end + 1 < height && rowInk[end + 1]! >= rule.inkPerRow) end += 1
    if (end - y + 1 >= minHeight) {
      const columnInk = new Int32Array(width)
      for (let row = y; row <= end; row += 1) for (let x = 0, offset = row * width; x < width; x += 1) columnInk[x]! += ink[offset + x]!
      let x = 0
      while (x < width) {
        if (columnInk[x] === 0) {
          x += 1
          continue
        }
        let last = x
        let cursor = x
        while (cursor + 1 < width && cursor - last < gap) {
          cursor += 1
          if (columnInk[cursor]! > 0) last = cursor
        }
        if (last - x >= width * rule.minWidthShare) bands.push({ left: x / scale, right: (last + 1) / scale, top: y / scale, bottom: (end + 1) / scale })
        x = cursor + 1
      }
    }
    y = end + 1
  }
  return bands
}

/** A altura da letra do corpo do documento, pelas palavras de todas as páginas lidas. */
export function documentBodyHeight(pages: readonly { words: readonly OcrWord[]; bands: readonly OcrBox[] }[]): number {
  const rule = PDF_PRINT_RULE
  const heights = pages.flatMap((page) => page.words.filter((word) => word.confidence > rule.bodyConfidence && !page.bands.some((band) => band.bottom - band.top > rule.tallBand && isInside(word, band))).map((word) => word.bottom - word.top))
  return median(heights) || median(pages.flatMap((page) => page.words.map((word) => word.bottom - word.top)))
}

/** As áreas da página que são prints, já juntadas. */
export function printRegions(bands: readonly OcrBox[], words: readonly OcrWord[], bodyHeight: number): OcrBox[] {
  const rule = PDF_PRINT_RULE
  const marked = bands
    .filter((band) => {
      const inside = words.filter((word) => isInside(word, band))
      if (inside.length >= rule.minWords) return median(inside.map((word) => word.bottom - word.top)) <= bodyHeight * rule.smallTextRatio
      return band.bottom - band.top >= rule.minBlankHeight && (band.right - band.left) * (band.bottom - band.top) > rule.minBlankArea
    })
    .sort((a, b) => a.top - b.top)
  const merged: OcrBox[] = []
  for (const band of marked) {
    const last = merged[merged.length - 1]
    if (last && band.top - last.bottom <= rule.mergeGap && Math.min(last.right, band.right) - Math.max(last.left, band.left) > rule.mergeOverlap * Math.min(last.right - last.left, band.right - band.left)) {
      last.bottom = Math.max(last.bottom, band.bottom)
      last.left = Math.min(last.left, band.left)
      last.right = Math.max(last.right, band.right)
    } else merged.push({ ...band })
  }
  return merged
}
