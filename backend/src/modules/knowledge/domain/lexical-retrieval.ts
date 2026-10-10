import type { KnowledgeChunk } from "./knowledge-chunking.js"

/**
 * Retrieval lexical (BM25 sobre trechos) — puro, sem banco, sem embeddings, sem serviço externo.
 *
 * Escolha deliberada de escopo: as bases operacionais da INIA são poucas dezenas de documentos
 * por agente, e o objetivo aqui é "menor contexto que ainda produz resposta correta" (não busca
 * semântica aberta). BM25 com normalização de acentos e radical curto resolve o caso real —
 * "contestação de fatura" recupera as seções de Contestação, não as de Parcelamento — sem
 * infraestrutura de vetores. Se um dia embeddings forem necessários, esta função é o único ponto
 * a trocar: a entrada (trechos) e a saída (trechos ranqueados sob orçamento) não mudam.
 */
export type RankedChunk = KnowledgeChunk & {
  score: number
  /** O título do documento casou com o ASSUNTO da pergunta e o trecho foi escolhido pelo DETALHE pedido (busca em duas etapas). */
  anchored?: boolean
}

/** Opções de tokenização: siglas do Glossário geral (ex.: PJ, TT) — só contam escritas em MAIÚSCULAS, para "ME" (Mudança
 * de Endereço) nunca casar com o pronome "me". */
export type TokenizeOptions = { acronyms?: ReadonlySet<string> }

/** Opções do ranqueamento: `contextTerms` = termos que vieram da EXPANSÃO de uma sigla ("PJ" → "pessoa jurídica"). Eles
 * ajudam a achar o documento, mas descrevem o assunto, não o detalhe pedido — pesam pouco na escolha da seção. */
export type RankOptions = TokenizeOptions & { contextTerms?: ReadonlySet<string> }
const CONTEXT_TERM_WEIGHT = 0.25
/** Dentro de documento ancorado, termo que também está no TÍTULO pesa menos que o detalhe pedido — mas continua contando:
 * um título pode cobrir mais de um subtema ("Auxílio Creche e Auxílio Babá") e "babá" ainda distingue as seções. */
const TITLE_TERM_WEIGHT_IN_ANCHORED = 0.35
/** Dentro de documento ancorado, o termo pedido no TÍTULO DA SEÇÃO ("17. Documentos…", "39. Como solicitar?", "50. Prazo…")
 * é o sinal mais forte de que a seção responde à pergunta — bônus de 1 × idf (termo do título do documento: 0,35 × idf). */
const HEADING_DETAIL_BONUS = 1
const HEADING_TITLE_TERM_BONUS = 0.35

/** Palavras de PERGUNTA (radicais): dizem que há uma pergunta, não sobre o quê. Saem da consulta quando sobra outro termo —
 * "quais documentos são necessários" procura "documentos", não "necessário". */
const QUESTION_FILLERS = new Set(["necess", "precis", "fazer", "faco", "faz", "pode", "posso", "podem", "devo", "deve", "quero", "querem", "saber", "ajuda", "ajudar", "consigo", "funcio", "explic", "entend"])
function meaningfulQueryTerms(terms: readonly string[]): string[] {
  const kept = terms.filter((term) => !QUESTION_FILLERS.has(term))
  return kept.length > 0 ? kept : [...terms]
}

export type RetrievalBudget = {
  /** Máximo de trechos incluídos no prompt. */
  maxChunks: number
  /** Máximo de caracteres somados dos trechos incluídos (≈ tokens × 3,5 em português). */
  maxTotalChars: number
  /** Trechos com score abaixo desta fração do melhor score são descartados — evita "encher" o
   * orçamento com trechos irrelevantes só porque sobrou espaço. */
  minRelativeScore: number
}

export const DEFAULT_RETRIEVAL_BUDGET: RetrievalBudget = { maxChunks: 8, maxTotalChars: 9000, minRelativeScore: 0.2 }

const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "em", "no", "na", "nos", "nas", "um", "uma", "uns", "umas",
  "que", "com", "sem", "por", "para", "pra", "pro", "ao", "aos", "se", "sua", "seu", "suas", "seus", "ele", "ela", "eles", "elas",
  "eu", "voce", "nos", "meu", "minha", "isso", "isto", "esse", "essa", "este", "esta", "aquele", "aquela", "mas", "mais", "muito",
  "ja", "nao", "sim", "ser", "esta", "estao", "foi", "era", "tem", "ter", "tinha", "tambem", "como", "quando", "onde", "qual",
  "quais", "sobre", "entre", "ate", "depois", "antes", "aqui", "ali", "la", "pelo", "pela", "pelos", "pelas", "cliente", "operador", "operadora", "atendente",
  "bom", "boa", "dia", "tarde", "noite", "ola", "obrigado", "obrigada", "senhor", "senhora", "entao", "tá", "ta", "né", "ne",
])

const STEM_LENGTH = 6

/** Minúsculas, sem acentos, só letras/dígitos, sem stopwords, radical curto (6 primeiras letras —
 * "contestação"/"contestar"/"contestada" caem no mesmo termo). */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  // Siglas têm 2 letras e seriam descartadas pelo filtro de tamanho: entram como termo próprio ("#pj") quando aparecem em
  // maiúsculas e estão no glossário da organização.
  const acronyms = options.acronyms && options.acronyms.size > 0 ? (text.match(/\b[A-Z][A-Z0-9]{1,5}\b/g) ?? []).filter((token) => options.acronyms!.has(token)).map((token) => `#${token.toLowerCase()}`) : []
  return [...acronyms, ...text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .map((token) => (token.length > STEM_LENGTH ? token.slice(0, STEM_LENGTH) : token))]
}

const BM25_K1 = 1.4
const BM25_B = 0.75
const MIN_MATCHED_TERMS = 2

type IndexedChunk = { chunk: KnowledgeChunk; termFrequency: Map<string, number>; length: number; headingTerms: Set<string> }

function indexChunk(chunk: KnowledgeChunk, options: TokenizeOptions): IndexedChunk {
  // Cabeçalho da seção conta como conteúdo (e pesa em dobro): "## Etapas de contestação" é o
  // sinal mais forte de que a seção trata de contestação.
  const tokens = [...tokenize(chunk.heading, options), ...tokenize(chunk.heading, options), ...tokenize(chunk.text, options)]
  const termFrequency = new Map<string, number>()
  for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)
  return { chunk, termFrequency, length: tokens.length, headingTerms: new Set(tokenize(chunk.heading, options)) }
}

/**
 * ÂNCORA DE DOCUMENTO (busca em duas etapas). Numa base operacional o ASSUNTO costuma estar no título do documento
 * ("Troca de Titularidade entre Empresas") e o DETALHE numa seção ("17. Documentos da empresa cedente") que não repete o
 * assunto. Um documento é ANCORADO quando o título contém ≥ 2 termos da pergunta (ou todos, se ela tiver 1) que sejam
 * DISTINTIVOS — presentes no título de no máximo metade dos documentos (palavras de todo título, como "procedimento",
 * nunca ancoram sozinhas). Documento único: todo termo do título distingue.
 */
export type DocumentAnchor = { documentId: string; documentTitle: string; matchedTitleTerms: string[] }

export function documentAnchors(query: string, chunks: readonly KnowledgeChunk[], options: TokenizeOptions = {}): { anchored: DocumentAnchor[]; candidates: DocumentAnchor[] } {
  const queryTerms = meaningfulQueryTerms([...new Set(tokenize(query, options))])
  const titles = new Map<string, string>()
  for (const chunk of chunks) if (!titles.has(chunk.documentId)) titles.set(chunk.documentId, chunk.documentTitle)
  const titleTerms = new Map([...titles].map(([id, title]) => [id, new Set(tokenize(title, options))]))
  const titleFrequency = new Map<string, number>()
  for (const terms of titleTerms.values()) for (const term of terms) titleFrequency.set(term, (titleFrequency.get(term) ?? 0) + 1)
  const maxTitleFrequency = titles.size <= 1 ? 1 : Math.max(1, Math.floor(titles.size / 2))
  const candidates: DocumentAnchor[] = []
  for (const [documentId, documentTitle] of titles) {
    const matchedTitleTerms = queryTerms.filter((term) => titleTerms.get(documentId)!.has(term) && (titleFrequency.get(term) ?? 0) <= maxTitleFrequency)
    if (matchedTitleTerms.length > 0) candidates.push({ documentId, documentTitle, matchedTitleTerms })
  }
  candidates.sort((left, right) => right.matchedTitleTerms.length - left.matchedTitleTerms.length || left.documentTitle.localeCompare(right.documentTitle, "pt-BR"))
  const required = Math.min(MIN_MATCHED_TERMS, queryTerms.length)
  return { anchored: candidates.filter((candidate) => candidate.matchedTitleTerms.length >= required), candidates }
}

/**
 * Ranqueamento em duas etapas:
 *   1. documentos ANCORADOS pelo título: a seção precisa ter ao menos 1 termo da pergunta que NÃO está no título (o detalhe
 *      pedido: "documentos", "prazo") — o assunto já foi garantido pelo título. Termos do título ainda pontuam, com peso
 *      menor (distinguem subtemas do mesmo documento). Pergunta só com o assunto pontua pela pergunta inteira. Vêm primeiro.
 *   2. qualquer outro trecho: a regra de sempre — ≥ 2 termos distintos da pergunta no próprio trecho.
 */
export function rankChunks(query: string, chunks: KnowledgeChunk[], options: RankOptions = {}): RankedChunk[] {
  const queryTerms = meaningfulQueryTerms([...new Set(tokenize(query, options))])
  if (queryTerms.length === 0 || chunks.length === 0) return []

  const indexed = chunks.map((chunk) => indexChunk(chunk, options))
  const averageLength = indexed.reduce((sum, item) => sum + item.length, 0) / indexed.length || 1
  const documentFrequency = new Map<string, number>()
  for (const term of queryTerms) {
    documentFrequency.set(term, indexed.filter((item) => item.termFrequency.has(term)).length)
  }
  const bm25 = (item: IndexedChunk, terms: readonly string[], titleTerms: ReadonlySet<string> | null = null) => {
    let score = 0
    let matched = 0
    let matchedDetail = 0
    for (const term of terms) {
      const tf = item.termFrequency.get(term)
      if (!tf) continue
      matched += 1
      const inTitle = titleTerms?.has(term) ?? false
      if (!inTitle) matchedDetail += 1
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5))
      const weight = (options.contextTerms?.has(term) ? CONTEXT_TERM_WEIGHT : 1) * (inTitle ? TITLE_TERM_WEIGHT_IN_ANCHORED : 1)
      score += weight * idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * item.length) / averageLength)))
      if (titleTerms && item.headingTerms.has(term) && !options.contextTerms?.has(term)) score += idf * (inTitle ? HEADING_TITLE_TERM_BONUS : HEADING_DETAIL_BONUS)
    }
    return { score, matched, matchedDetail }
  }

  const titleTermsOf = new Map<string, Set<string>>()
  for (const anchor of documentAnchors(query, chunks, options).anchored) titleTermsOf.set(anchor.documentId, new Set(tokenize(anchor.documentTitle, options)))

  // Um trecho FORA de documento ancorado precisa casar com pelo menos 2 termos distintos da consulta (quando ela tem 2+):
  // com um único termo em comum ("verificar", "protocolo"), uma pergunta de RH ainda "recuperava"
  // seções de faturamento por coincidência de vocabulário — ruído que só gasta tokens.
  const requiredMatches = Math.min(MIN_MATCHED_TERMS, queryTerms.length)
  const anchoredRanked: RankedChunk[] = []
  const ranked: RankedChunk[] = []
  for (const item of indexed) {
    const title = titleTermsOf.get(item.chunk.documentId)
    if (title) {
      // Pergunta só com o assunto ("troca de titularidade"): nada a distinguir além do título — pontua por ele, sem desconto.
      const onlySubject = queryTerms.every((term) => title.has(term))
      const { score, matched, matchedDetail } = bm25(item, queryTerms, onlySubject ? null : title)
      if (score > 0 && (onlySubject ? matched >= 1 : matchedDetail >= 1)) {
        anchoredRanked.push({ ...item.chunk, score, anchored: true })
        continue
      }
    }
    const { score, matched } = bm25(item, queryTerms)
    if (score > 0 && matched >= requiredMatches) ranked.push({ ...item.chunk, score })
  }
  const order = (left: RankedChunk, right: RankedChunk) => right.score - left.score || left.documentId.localeCompare(right.documentId) || left.index - right.index
  return [...anchoredRanked.sort(order), ...ranked.sort(order)]
}

/** Aplica o orçamento aos trechos já ranqueados — corta por relevância relativa, quantidade e
 * total de caracteres, nesta ordem. Nunca inclui um trecho "pela metade". */
export function selectWithinBudget(ranked: RankedChunk[], budget: RetrievalBudget = DEFAULT_RETRIEVAL_BUDGET): RankedChunk[] {
  const best = ranked[0]?.score ?? 0
  const selected: RankedChunk[] = []
  let totalChars = 0
  for (const chunk of ranked) {
    if (selected.length >= budget.maxChunks) break
    if (chunk.score < best * budget.minRelativeScore) break
    if (totalChars + chunk.text.length > budget.maxTotalChars) continue
    selected.push(chunk)
    totalChars += chunk.text.length
  }
  return selected
}

/** Aproximação de tokens para texto em português (≈ 3,5 caracteres por token) — só para
 * telemetria/orçamento; o número oficial continua sendo o `usageMetadata` devolvido pelo modelo. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.5)
}
