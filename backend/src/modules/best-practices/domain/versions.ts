/**
 * VERSÕES da base de boas práticas — contratos. Mudar a lógica, um prompt ou os critérios de evidência exige subir a versão
 * correspondente (nunca editar em silêncio): a análise grava as versões na proveniência e a codificação de uma chamada só é
 * reaproveitada com a MESMA versão do prompt de codificação e a mesma definição do comportamento.
 *
 *   BEST_PRACTICE_ANALYSIS_V1 (20/10/2026) — grupos pelo resultado OFICIAL (quartil) do indicador, comparação dentro de cada contexto
 *     (motivo/submotivo), descoberta contrastiva → codificação CEGA ao grupo → números por código → verificação de obrigação só para o
 *     que se sustentou → padrões com versão por análise.
 */
/**
 *   BEST_PRACTICE_ANALYSIS_V2 (22/10/2026) — população também por SUBGRUPO (melhores do subgrupo × demais do subgrupo, mesmo quartil
 *     oficial); cada contexto sustentado guarda o NÍVEL da análise (motivo × motivo › submotivo), para "(sem submotivo)" nunca valer
 *     como o motivo inteiro.
 */
/**
 *   BEST_PRACTICE_ANALYSIS_V3 (22/10/2026) — o resultado também pode ser o SINAL DA CHAMADA (ex.: nota da URA): grupos de chamadas boas ×
 *     ruins pelo critério cadastrado no sinal (`channel_flags.call_outcome`); mesmos contextos, amostra, codificação cega, critérios
 *     de evidência (média por operador dentro de cada grupo) e verificação de obrigação.
 */
export const BEST_PRACTICE_ANALYSIS_LOGIC_VERSION = "BEST_PRACTICE_ANALYSIS_V3" as const
/** V2 (22/10/2026): o GRUPO A é "melhores resultados no RESULTADO informado" (indicador ou sinal da chamada); cabeçalho "RESULTADO:". */
/** V3 (22/10/2026, `BEST_PRACTICE_HOW_IT_HELPS_V1`): cada candidato traz `howItHelps`, um RASCUNHO de como o comportamento pode ajudar
 * no resultado, para quem revisa corrigir e aprovar (nunca conclusão; não entra na definição nem no hash). */
export const BEST_PRACTICE_DISCOVERY_PROMPT_VERSION = "BEST_PRACTICE_DISCOVERY_PROMPT_V3" as const
export const BEST_PRACTICE_CODING_PROMPT_VERSION = "BEST_PRACTICE_CODING_PROMPT_V1" as const
/** V2 (22/10/2026, `PRODUCT_IN_FEEDBACK_V1`): cada fonte vai com o seu "Vale para"; regra de um produto só obriga ou proíbe nas chamadas
 * dele — candidato que só seria obrigação ou conflito por uma regra de produto específico fica UNCERTAIN (validação humana). */
export const BEST_PRACTICE_OBLIGATION_PROMPT_VERSION = "BEST_PRACTICE_OBLIGATION_PROMPT_V2" as const
/** Critérios de força e de sustentação (evidence-criteria.ts). */
export const BEST_PRACTICE_EVIDENCE_VERSION = "BEST_PRACTICE_EVIDENCE_V1" as const
/** Recomendação ao operador (guidance.ts): o que entra, como cada número é dito e quando nada é dito. */
/** V2 (22/10/2026): prática descoberta pelo sinal diz "chamadas com resultado bom × ruim", nunca "operadores com melhores resultados". */
/** V3 (22/10/2026): a força mostrada é a do contexto que casou; a fala sugerida só aparece no assunto de onde saiu (ou editada na revisão). */
/** V4 (22/10/2026, `BEST_PRACTICE_HOW_IT_HELPS_V1`): "Como ajuda no resultado" (aprovado na revisão) entra na orientação e é o único
 * fundamento para ligar a prática ao resultado. */
export const BEST_PRACTICE_GUIDANCE_VERSION = "BEST_PRACTICE_GUIDANCE_V4" as const
/**
 * Escolha das práticas para uma pessoa (selection-levels.ts). V1 (22/10/2026): por assunto, o primeiro nível com prática disponível
 * vence — subgrupo + submotivo → grupo + submotivo → subgrupo + motivo → grupo + motivo → nada; níveis nunca se misturam num assunto.
 */
/** V2 (22/10/2026, `PRODUCT_IN_FEEDBACK_V1`): no feedback, a prática vista só nas chamadas de um produto só entra quando o feedback é
 * daquele produto; sem produto estabelecido no feedback, só as gerais (`practiceProductOf`/`productMatches`). Chat, voz e liderança
 * continuam como na V1. */
export const BEST_PRACTICE_SELECTION_VERSION = "BEST_PRACTICE_SELECTION_V2" as const
/**
 * "Como isso ajuda no resultado" (`BEST_PRACTICE_HOW_IT_HELPS_V1`, 22/10/2026, migration 159): texto opcional da prática, escrito por quem
 * revisa ou aprovado a partir do rascunho da descoberta; só ele permite ao feedback, ao chat e à voz dizer COMO a prática ajuda no
 * indicador ou no sinal. Reanálise nunca sobrescreve o texto vigente.
 */
export const BEST_PRACTICE_HOW_IT_HELPS_VERSION = "BEST_PRACTICE_HOW_IT_HELPS_V1" as const
