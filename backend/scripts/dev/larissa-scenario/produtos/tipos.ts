/**
 * Formato do cenário "PRODUTOS — segunda via e reparo" da Larissa Monteiro (DEMO-OP-0001), criado em 21/10/2026 para testar o cadastro de
 * produtos (`PRODUCT_APPLICABILITY_V2`) de ponta a ponta. Todo o conteúdo é FICTÍCIO (prazos, canais e regras inventados para o teste) e
 * vem marcado com "TESTE PRODUTOS ·" — nunca é procedimento real da operação.
 *
 * Chamadas: "O:" = operador, "C:" = cliente; `{OPERADOR}` = primeiro nome de quem atende. `intent` é só documentação do cenário — o motor
 * NUNCA recebe isto; ele lê a transcrição, o assunto e o cadastro. Números vão inteiros na transcrição (como a fonte grava); a máscara que
 * preserva o formato (`SUBJECT_PII_MASK_V2`) é aplicada só no texto que vai à IA e ao colaborador.
 */
export type NodeCode = "FIXA_BASICA" | "MOVEL" | "VOZ_AVANCADA" | "DADOS_AVANCADOS" | "SOLUCIONA_TI" | "LINHA_ANALOGICA" | "BANDA_LARGA" | "LINHA_MOVEL" | "SIP" | "DDR" | "IP_DEDICADO" | "COLOCATION" | "VIVO_SOLUCIONA_TI"
export type Process = "SEGUNDA_VIA" | "REPARO"

/** Base de conhecimento do teste: `products` vazio = vale para todos os produtos (geral). */
export type TestDocument = { key: string; process: Process; title: string; products: NodeCode[]; content: string }

/** Argumentário do teste (mesmo contrato da tela: situação, orientações deve/pode, pontos da fala, o que evitar, sugestão). */
export type TestArgumentScript = {
  key: string
  process: Process
  name: string
  products: NodeCode[]
  trigger: string
  notApplicableWhen: string | null
  guidance: { text: string; modality: "MUST" | "MAY" }[]
  requiredPoints: { mode: "ALL" | "ANY"; items: string[] }[]
  avoid: string[]
  suggestedScript: string | null
}

/** O que a chamada testa: como o produto aparece, o que deveria acontecer e onde o operador acerta ou erra (só documentação). */
export type ScenarioIntent = {
  /** Como o produto do pedido aparece na conversa (cliente diz, indício, operador + contexto, só operador, conflito…). */
  product: string
  /** O que a INIA deveria concluir sobre o produto (produto, categoria, não identificado, conflito). */
  expectedIdentification: string
  good: boolean
  /** Regras descumpridas (chaves do conteúdo, ex.: "LA1", "S2") — vazio quando a chamada é bem conduzida. */
  failures: string[]
  note: string
}

export type ProductScenarioCall = {
  key: string
  process: Process
  date: string
  time: string
  durationSeconds: number
  reason: "Segunda via" | "Reparo"
  intent: ScenarioIntent
  lines: string[]
}
