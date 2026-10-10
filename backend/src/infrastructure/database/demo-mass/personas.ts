/**
 * Personas de performance — "histórias" de 6 meses, não números soltos. Cada operador recebe UMA
 * persona (deck embaralhado por equipe de Supervisor, pra toda equipe ter mistura) e ela dita o
 * nível de atingimento de cada indicador em cada competência (ver performance-generator.ts).
 */
export const PERSONAS = [
  "ALTA_PERFORMANCE",
  "MEDIA",
  "CRITICO",
  "EM_EVOLUCAO",
  "EM_QUEDA",
  "EFICIENTE_BAIXA_QUALIDADE",
  "QUALIDADE_BOA_TMA_RUIM",
  "PRV_PARCIAL",
  "DADOS_INCOMPLETOS",
  "VOLATIL",
] as const
export type Persona = (typeof PERSONAS)[number]

/** Deck de 25 cartas = distribuição por equipe de 25 operadores (≈ 16/28/8/12/8/4/4/8/4/8 %). */
export const PERSONA_DECK: readonly Persona[] = [
  ...Array<Persona>(4).fill("ALTA_PERFORMANCE"),
  ...Array<Persona>(7).fill("MEDIA"),
  ...Array<Persona>(2).fill("CRITICO"),
  ...Array<Persona>(3).fill("EM_EVOLUCAO"),
  ...Array<Persona>(2).fill("EM_QUEDA"),
  "EFICIENTE_BAIXA_QUALIDADE",
  "QUALIDADE_BOA_TMA_RUIM",
  ...Array<Persona>(2).fill("PRV_PARCIAL"),
  "DADOS_INCOMPLETOS",
  ...Array<Persona>(2).fill("VOLATIL"),
]

export const PERSONA_LABELS: Record<Persona, string> = {
  ALTA_PERFORMANCE: "Alta performance consistente (Q1 recorrente)",
  MEDIA: "Performance média — bate alguns, perde outros",
  CRITICO: "Crítico consistente (Q4 recorrente)",
  EM_EVOLUCAO: "Em evolução — começa mal e melhora mês a mês",
  EM_QUEDA: "Em queda — começa bem e piora mês a mês",
  EFICIENTE_BAIXA_QUALIDADE: "TMA bom, Qualidade ruim",
  QUALIDADE_BOA_TMA_RUIM: "Qualidade boa, TMA ruim",
  PRV_PARCIAL: "PRV parcial — metade dos indicadores bons, metade ruins",
  DADOS_INCOMPLETOS: "Dados incompletos — 1 ou 2 competências sem determinado indicador",
  VOLATIL: "Volátil — alterna meses muito bons e ruins",
}
