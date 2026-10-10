import { stripEditorialListStructure } from "./knowledge-list.js"

/**
 * Normalização para comparação LITERAL com a Base de Conhecimento: só formatação (espaços, aspas, marcação markdown) —
 * nunca palavras. Fonte única: a verificação da camada de confiabilidade (reliable-feedback/domain/process-assessment.ts)
 * e o contrato da avaliação de processo (agents/domain/process-assessment-contract.ts) usam esta mesma função.
 */
export function normalizeForKnowledgeMatch(text: string): string {
  return text
    .replace(/[“”‘’"'`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * V1.7.1f — normalização ESTRUTURAL para a citação LITERAL de um trecho da base (a MESMA função na fonte e na citação).
 * Além de `normalizeForKnowledgeMatch`, tolera só diferenças de FORMATAÇÃO de lista: marcadores (-, *, •, +), caixas de
 * seleção ([ ], [x]) e numeração editorial ("1.", "2)", "(3)") no começo de linha, logo depois de ":"/";" (lista achatada numa
 * linha) ou do fim de um item (V1.7.1k), e quebras de linha/espaços. Nenhuma palavra muda: paráfrase, palavra trocada ou item pulado continuam não literais.
 * Não substitui `normalizeForKnowledgeMatch` (identidade de prática e demais comparações continuam como estavam).
 */
export function normalizeForLiteralQuote(text: string): string {
  // V1.7.1k — a estrutura editorial vem da representação canônica de lista (`knowledge-list.ts`): também "(1)" e o marcador que
  // segue o FIM de um item ("…claras?” - “Ficou…"), como nas listas de perguntas achatadas pelo retrieval.
  return normalizeForKnowledgeMatch(stripEditorialListStructure(text))
}
