/**
 * O que o conversor de PDF lê de uma página: puro, sem pdf.js. O adaptador (`infrastructure/pdf-layout-reader.ts`) preenche estes
 * tipos a partir do arquivo; as coordenadas são em pontos, com a origem no canto superior esquerdo da página (y cresce para baixo).
 */
export const PDF_MARKDOWN_VERSION = "PDF_MARKDOWN_V1" as const

/** O que o próprio PDF declara sobre um texto, pela árvore de estrutura (PDF com tags). Nunca é deduzido da aparência. */
export type PdfRunHint =
  | { kind: "HEADING"; level: number; blockId: string }
  | { kind: "LIST_ITEM"; depth: number; blockId: string }
  | { kind: "TABLE_CELL"; tableId: string; row: number; col: number; header: boolean }
  | { kind: "CODE"; blockId: string }

export type PdfRun = {
  text: string
  /** Início do texto na linha de base. */
  x: number
  y: number
  width: number
  fontSize: number
  bold: boolean
  mono: boolean
  /** Texto fora da horizontal (ex.: carimbo na margem): não participa das linhas da página. */
  rotated: boolean
  hint: PdfRunHint | null
}

/** Traço horizontal ou vertical desenhado na página (linha ou retângulo fino): a matéria-prima das tabelas com grade. */
export type PdfRule = { orientation: "H" | "V"; at: number; from: number; to: number }

export type PdfPageLayout = {
  page: number
  width: number
  height: number
  /** Na ordem em que estão no arquivo. */
  runs: PdfRun[]
  rules: PdfRule[]
  /** Fração da página coberta por imagens (0 a 1). */
  imageShare: number
  imageCount: number
  /** Desenhos vetoriais da página: distingue uma página em branco de uma com texto desenhado como figura. */
  drawnPaths: number
  tagged: boolean
}

/**
 * TEXT = texto lido; PARTIAL = texto lido e uma imagem grande cujo conteúdo não é lido; NO_TEXT = há conteúdo visual, sem camada de
 * texto (página digitalizada); BLANK = nada na página; UNREADABLE = o arquivo traz caracteres sem correspondência legível.
 */
export type PdfPageStatus = "TEXT" | "PARTIAL" | "NO_TEXT" | "BLANK" | "UNREADABLE"

/** Imagem de uma página, grande o bastante para ser conteúdo (print). A posição é em pontos; `width` e `height` são os pixels guardados. */
export type PdfPageImage = { id: string; page: number; left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * Onde uma imagem aparece no texto, sem fazer parte dele: `offset` é o fim da linha depois da qual ela vem (0 = antes de tudo; null = perdeu
 * o lugar numa edição grande demais para comparar). A IA não recebe imagens e nada aqui entra no que ela lê.
 */
export type PdfImagePlacement = { id: string; page: number; offset: number | null; width: number; height: number }

export type PdfPageCoverage = {
  page: number
  status: PdfPageStatus
  /** Caracteres da página no Markdown, sem espaços. */
  chars: number
  headings: number
  tables: number
  /** Onde o texto da página começa no Markdown; null = a página não tem texto nele. */
  offset: number | null
}

export const PDF_OCR_VERSION = "PDF_OCR_V1" as const

/**
 * Páginas digitalizadas lidas pelo Tesseract (OCR). O texto delas veio da imagem da página, com erros possíveis de leitura: quem publica confere com o
 * PDF. `prints` = áreas cortadas como imagem (a regra está em `domain/pdf-ocr/print-regions.ts`); `failedPages` e `skippedPages` ficaram sem texto.
 */
export type PdfOcrRecord = {
  version: typeof PDF_OCR_VERSION
  engine: string
  printRule: string
  pages: number[]
  failedPages: number[]
  skippedPages: number[]
  prints: number
}

/** Registro da conversão, guardado junto da versão. `edited` = o texto foi alterado depois da conversão. */
export type PdfExtraction = {
  version: typeof PDF_MARKDOWN_VERSION
  pageCount: number
  pages: PdfPageCoverage[]
  headings: number
  tables: number
  /** Linhas iguais repetidas nas margens (cabeçalho e rodapé) que ficaram de fora. A primeira ocorrência de cada texto fixo fica. */
  repeatedLinesRemoved: number
  taggedPages: number
  edited: boolean
  /** As imagens do documento. Ausente = as imagens não foram lidas (versão anterior a isso, ou a leitura falhou), o que não quer dizer que o PDF não tem nenhuma. */
  images?: PdfImagePlacement[] | undefined
  /** Imagens que ficaram de fora pelo limite por documento. */
  imagesOmitted?: number | undefined
  /** Ausente = nenhuma página foi lida por OCR. */
  ocr?: PdfOcrRecord | undefined
}

export type PdfMarkdownResult = { markdown: string; extraction: PdfExtraction }
