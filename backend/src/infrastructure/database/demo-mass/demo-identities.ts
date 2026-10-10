import type { Gender } from "./names.js"
import type { Persona } from "./personas.js"

/**
 * Identidades canônicas da massa — o que a documentação DEV aponta como "cenário conhecido".
 * A UI mostra só o nome (nunca "Demo Q4"); o perfil de teste vive aqui e em docs/dev.
 *
 * Todos os operadores canônicos ficam na equipe do Supervisor 01 (Coordenador 01 → Gerente 01,
 * "B2C · Atendimento Geral", COM coordenador → Gerente Sênior 01 → Diretor), pra um único
 * caminho de drill-down cobrir todas as personas.
 */
export type CanonicalOperator = {
  operatorOrdinal: number
  name: string
  gender: Gender
  persona: Persona
  scenario: string
  /** Competências sem NOTA_URA (cenário "sem dado URA"). */
  missingUraPeriods?: readonly string[]
}

export const CANONICAL_OPERATORS: readonly CanonicalOperator[] = [
  { operatorOrdinal: 1, name: "Larissa Monteiro", gender: "F", persona: "ALTA_PERFORMANCE", scenario: "Alta performance consistente — Q1 recorrente" },
  { operatorOrdinal: 2, name: "Mariana Alves", gender: "F", persona: "CRITICO", scenario: "Crítica consistente — Q4 recorrente (3+ meses)" },
  { operatorOrdinal: 3, name: "Beatriz Nogueira", gender: "F", persona: "EM_EVOLUCAO", scenario: "Em evolução — abril ruim, setembro acima da meta" },
  { operatorOrdinal: 4, name: "Rafael Cardoso", gender: "M", persona: "EM_QUEDA", scenario: "Em queda — abril acima da meta, setembro crítico" },
  { operatorOrdinal: 5, name: "Camila Fonseca", gender: "F", persona: "QUALIDADE_BOA_TMA_RUIM", scenario: "Qualidade boa com TMA alto" },
  { operatorOrdinal: 6, name: "Diego Tavares", gender: "M", persona: "MEDIA", scenario: "Média, SEM Nota URA em jul/ago 2026 (lacuna de dado)", missingUraPeriods: ["2026-07", "2026-08"] },
  { operatorOrdinal: 7, name: "Thiago Moreira", gender: "M", persona: "VOLATIL", scenario: "Volátil — alterna meses muito bons e ruins" },
  { operatorOrdinal: 8, name: "Juliana Sampaio", gender: "F", persona: "EFICIENTE_BAIXA_QUALIDADE", scenario: "TMA ótimo com Qualidade ruim" },
  { operatorOrdinal: 9, name: "Henrique Barros", gender: "M", persona: "PRV_PARCIAL", scenario: "PRV parcial — metade dos indicadores acima, metade abaixo" },
  { operatorOrdinal: 10, name: "Renata Queiroz", gender: "F", persona: "DADOS_INCOMPLETOS", scenario: "Dados incompletos — competências sem determinado indicador" },
  // Donos das transcrições canônicas fora de "B2C · Atendimento Geral" (nome fixo pra gênero bater com o texto).
  { operatorOrdinal: 251, name: "Aline Castro", gender: "F", persona: "MEDIA", scenario: "B2C · Faturamento — dona da canônica 001 (curta, correta)" },
  { operatorOrdinal: 252, name: "Marcos Vieira", gender: "M", persona: "CRITICO", scenario: "B2C · Faturamento — dono da canônica 002 (longa, com falhas)" },
  { operatorOrdinal: 501, name: "Gabriela Duarte", gender: "F", persona: "ALTA_PERFORMANCE", scenario: "B2C · Retenção — dona da canônica 004 (longa, correta)" },
  { operatorOrdinal: 502, name: "Leandro Farias", gender: "M", persona: "EM_QUEDA", scenario: "B2C · Retenção — dono da canônica 005 (média, falha aparente)" },
  { operatorOrdinal: 626, name: "Vitor Macedo", gender: "M", persona: "ALTA_PERFORMANCE", scenario: "B2C · Suporte Técnico — dono da canônica 006 (longa, troubleshooting completo)" },
  { operatorOrdinal: 627, name: "Patrícia Leite", gender: "F", persona: "MEDIA", scenario: "B2C · Suporte Técnico — dona da canônica 007 (média, etapa não confirmável)" },
]

/** Onde cada uma das 10 transcrições canônicas fica (operador por Grupo compatível com o tema). */
export const CANONICAL_INTERACTION_OWNERS: Record<string, number> = {
  "DEMO-QA-INTERACTION-001": 251, // B2C · Faturamento — Supervisor 11 (Gerente 03, com coordenador)
  "DEMO-QA-INTERACTION-002": 252,
  "DEMO-QA-INTERACTION-003": 6, // Diego Tavares — B2C · Atendimento Geral
  "DEMO-QA-INTERACTION-004": 501, // B2C · Retenção — Supervisor 21 (Gerente 05)
  "DEMO-QA-INTERACTION-005": 502,
  "DEMO-QA-INTERACTION-006": 626, // B2C · Suporte Técnico — Supervisor 26 (Gerente 06)
  "DEMO-QA-INTERACTION-007": 627,
  "DEMO-QA-INTERACTION-008": 2, // Mariana Alves
  "DEMO-QA-INTERACTION-009": 1, // Larissa Monteiro
  "DEMO-QA-INTERACTION-010": 4, // Rafael Cardoso
}

/**
 * Flags propositalmente imperfeitas (fixture de teste, NÃO ground truth produtivo):
 *  FP = flag `rechamada` marcada numa chamada em que ninguém menciona contato anterior;
 *  FN = chamada claramente de rechamada SEM a flag.
 */
export const IMPERFECT_FLAG_INTERACTIONS = [
  { externalId: "DEMO-QA-FLAG-FP-001", operatorOrdinal: 7, kind: "FALSE_POSITIVE" as const },
  { externalId: "DEMO-QA-FLAG-FP-002", operatorOrdinal: 3, kind: "FALSE_POSITIVE" as const },
  { externalId: "DEMO-QA-FLAG-FN-001", operatorOrdinal: 7, kind: "FALSE_NEGATIVE" as const },
  { externalId: "DEMO-QA-FLAG-FN-002", operatorOrdinal: 9, kind: "FALSE_NEGATIVE" as const },
]
