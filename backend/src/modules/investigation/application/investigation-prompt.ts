import type { SystemPromptParts } from "../../agents/application/build-system-prompt.js"
import { assemblePrompt, promptProfile, type AssembledPrompt, type PromptComponent, type PromptPhase, type PromptProfile } from "../../../shared/application/prompting/prompt-components.js"
import { INVESTIGATION_CAPABILITY_LABELS, type InvestigationCapability } from "../domain/capabilities.js"
import type { ToolDefinition } from "../domain/tool-catalog.js"
import { renderCommonParametersNote, type ToolSchemaMode } from "../domain/tool-declarations.js"
import { renderStopContract } from "../domain/evidence-sufficiency.js"
import type { InvestigationPeriod, InvestigationSubject } from "./tool-context.js"

/**
 * COMPONENTES DO PROMPT DA INVESTIGAÇÃO (V1.3 — §12–15). Duas versões da política:
 * - `INVESTIGATION_POLICY` (V1.1/V1.2, perfil CURRENT): texto histórico, braço de controle;
 * - `INVESTIGATION_POLICY_COMPACT` (perfil COMPACT): as MESMAS regras, sem repetir o que o
 *   prompt da rodada já diz (o pedido de várias chamadas de uma vez e a instrução das NOTAS
 *   ficam só no turno do usuário) e sem a lista de capacidades (as declarações já nomeiam as
 *   Tools). Nenhuma regra de segurança foi removida: valor informacional, contexto inicial,
 *   subgrupo antes de grupo, uma camada de histórico, segmentar com hipótese, jornada/KB sob
 *   demanda, reserva para evidência profunda, causa só com evidência, pares agregados, qualidade
 *   do dado, nunca inventar/calcular, parar com evidência suficiente.
 */
export const INVESTIGATION_POLICY = `REGRAS DA INVESTIGAÇÃO (ferramentas de investigação operacional):
- Valor informacional: faça uma nova consulta SOMENTE se o resultado puder confirmar, refutar ou alterar uma hipótese relevante. Não consulte "porque existe". Peça em UMA resposta todas as consultas independentes de que precisa (várias chamadas de função de uma vez — elas rodam em paralelo); o orçamento de chamadas e de rodadas é limitado.
- O contexto inicial já traz o fato principal (indicador em foco: valor, meta, amostra, cobertura, atualidade, dimensões disponíveis; interação em foco: contexto). Parta dele e formule hipóteses; não repita consultas cujo resultado já está no contexto ou no ledger.
- Referência de comparação: compare com o SUBGRUPO primeiro; amplie para o GRUPO só se isso acrescentar evidência necessária à conclusão — não peça os dois automaticamente.
- Histórico: escolha UMA camada (OPERATIONAL ou OFFICIAL) conforme a pergunta; não consulte as duas por padrão e nunca misture seus valores.
- Dimensões: segmente com hipótese, não porque a dimensão existe. Se um recorte devolver amostra insuficiente (ex.: por assunto), não insista nele — escolha outro caminho ou declare a limitação.
- Jornada (inspect_work_context): só quando há relação plausível com o indicador, cobertura/produção sugerem problema, ou uma hipótese que ela testa. Dados completos e elegíveis não exigem calendário.
- Base de conhecimento (query_knowledge): só quando há evidência/lacuna a confrontar com procedimento, a pergunta é procedural ou o material ajuda a concluir — não porque a capacidade existe.
- Reserva para evidência profunda: se a resposta pretende afirmar algo sobre COMO o colaborador atende ("você faz X", "você demora em Y", "você repete Z"), reserve chamadas para find_interactions → get_interaction_context/analyze_interactions quando houver interações suficientes. Sem transcrição analisada, não conclua nada sobre comportamento na chamada; sem segmentação, nada sobre concentração.
- Nunca conclua causa sem evidência; diferencie correlação de causalidade (uma flag coexistir com um resultado não é causa). Comparações com pares são sempre agregadas: nunca cite ou infira dados de um colega individual.
- Qualidade do dado (amostra, cobertura, atualidade, disponibilidade) manda: amostra insuficiente não vira afirmação definitiva — diga que é insuficiente. Zero conclusões fortes é um resultado aceitável.
- Não invente fatos, números, procedimentos ou materiais; não faça cálculo manual quando existe ferramenta — use os números exatamente como devolvidos, citando as referências F-n do ledger.
- Pare quando houver evidência suficiente: em vez de chamar ferramentas, escreva as NOTAS DA INVESTIGAÇÃO em texto (fatos principais com refs F-n, hipóteses sustentadas, hipóteses descartadas, limitações). As notas não são a resposta final.`

export const INVESTIGATION_POLICY_COMPACT = `REGRAS DA INVESTIGAÇÃO (ferramentas de investigação operacional):
- Consulte SOMENTE o que pode confirmar, refutar ou mudar uma hipótese relevante; nunca "porque a ferramenta existe". O orçamento de chamadas e rodadas é limitado.
- O contexto inicial já traz o fato principal (indicador: valor, meta, amostra, cobertura, dimensões; interação: contexto). Parta dele; não repita o que já está no contexto ou no ledger.
- Comparação: SUBGRUPO primeiro; GRUPO só se acrescentar evidência necessária. Histórico: UMA camada (OPERATIONAL ou OFFICIAL), nunca as duas misturadas.
- Segmente com hipótese; recorte com amostra insuficiente não se insiste — outro caminho ou limitação declarada.
- Jornada (inspect_work_context) só com relação plausível com o indicador ou cobertura/produção suspeitas. Base de conhecimento (query_knowledge) só quando há evidência/lacuna a confrontar com procedimento.
- Para afirmar COMO o colaborador atende ("você faz X"), reserve chamadas para find_interactions → get_interaction_context/analyze_interactions. Sem transcrição analisada, nada sobre comportamento; sem segmentação, nada sobre concentração.
- Causa só com evidência (coexistência de flag/assunto não é causa). Pares sempre agregados — nunca dados de um colega.
- Qualidade do dado manda: amostra insuficiente não vira afirmação; zero conclusões fortes é aceitável.
- Nunca invente fatos, números, procedimentos ou materiais; nunca calcule à mão — use os números como devolvidos, citando as refs F-n do ledger. Contagens de análise de transcrições ("trecho verificado em ≥N de M analisadas") são limite inferior dentro da amostra — nunca prevalência no período.
- Hipóteses materiais nascem do que os dados mostram: inconsistência literal entre o que foi dito e o que foi feito, evidência que contradiz a conclusão, diferença entre momentos do período, concentração em um contexto, fator observável de contexto. Poucas hipóteses materiais de cada vez (no máximo 4 abertas); curiosidade sem impacto na conclusão não é hipótese.
- Fontes de evidência: cada rodada lista as fontes desta execução e o que cada uma responde. Antes de parar, pergunte que TIPO de evidência ainda mudaria a conclusão (evolução no tempo, eventos por interação, concentração, o que deveria acontecer) — e consulte uma fonte só se a lacuna for material. Base de conhecimento não é etapa obrigatória: só quando a conclusão depende de procedimento.
- Tempo: ter evidência de vários blocos da janela (B1, B2, B3) é COBERTURA; afirmar que algo mudou, aumentou, passou a acontecer ou ficou estável entre eles é RELAÇÃO temporal — só com uma comparação validada entre blocos (a análise de interações devolve "comparação temporal"; histórico/compare_periods comparam o INDICADOR, não o comportamento). "Nenhuma diferença sustentada" é resultado válido.
- Com evidência suficiente, pare: escreva as NOTAS DA INVESTIGAÇÃO (fatos com refs F-n, hipóteses sustentadas, descartadas, limitações) — não são a resposta final.`

export type InvestigationPromptInput = {
  /** Prompt legado inteiro (perfil CURRENT) — a junção histórica de build-system-prompt.ts. */
  systemPrompt: string
  parts: SystemPromptParts | null
  capabilities: InvestigationCapability[]
  tools: ToolDefinition[]
  subject: InvestigationSubject
  defaultPeriod: InvestigationPeriod
  /** Handle da interação em foco (I1) já registrado pelo runtime. */
  interactionHandle: string | null
  schemaMode: ToolSchemaMode
}

function describeTools(tools: ToolDefinition[], capabilities: InvestigationCapability[]): string {
  const byCapability = capabilities.map((capability) => `- ${INVESTIGATION_CAPABILITY_LABELS[capability]}: ${tools.filter((tool) => tool.capability === capability).map((tool) => tool.key).join(", ")}`)
  return `Capacidades habilitadas nesta execução:\n${byCapability.join("\n")}`
}

function describeSubject(input: InvestigationPromptInput): string {
  return [
    `Colaborador em foco: ${input.subject.operatorName ?? "(sem nome)"}${input.subject.teamName ? ` · Grupo ${input.subject.teamName}` : ""}${input.subject.subteamName ? ` · Subgrupo ${input.subject.subteamName}` : ""}.`,
    `Período padrão da investigação: ${input.defaultPeriod.label}.`,
    input.subject.indicatorCode ? `Indicador em foco: ${input.subject.indicatorCode}.` : null,
    input.interactionHandle ? `Interação em foco: ${input.interactionHandle} (get_interaction_context sem argumentos a devolve).` : null,
  ].filter(Boolean).join("\n")
}

const PLANNING_PHASES: PromptPhase[] = ["PLANNING", "INVESTIGATION_NOTES"]

/** Componentes das requests do runtime (planejamento e notas). */
export function investigationPromptComponents(input: InvestigationPromptInput, profile: PromptProfile = promptProfile()): PromptComponent[] {
  if (profile === "CURRENT" || !input.parts) {
    // V1.2 literal: tudo no prompt de sistema, na mesma ordem (o prompt do Agent contém a KB recuperada → dinâmico).
    return [
      { id: "agent.prompt.legacy", version: 1, phases: "ALL", static: false, content: input.systemPrompt },
      { id: "investigation.policy", version: 1, phases: PLANNING_PHASES, static: true, content: INVESTIGATION_POLICY },
      { id: "investigation.capabilities", version: 1, phases: PLANNING_PHASES, static: true, content: describeTools(input.tools, input.capabilities) },
      { id: "investigation.stop-contract", version: 1, phases: PLANNING_PHASES, static: true, content: renderStopContract() },
      { id: "investigation.subject", version: 1, phases: "ALL", static: false, content: describeSubject(input) },
    ]
  }
  return [
    { id: "agent.identity", version: 1, phases: "ALL", static: true, content: input.parts.identity },
    { id: "agent.expectations", version: 1, phases: "ALL", static: true, content: input.parts.expectations },
    { id: "agent.restrictions", version: 1, phases: "ALL", static: true, content: input.parts.restrictions },
    { id: "investigation.policy", version: 3, phases: PLANNING_PHASES, static: true, content: INVESTIGATION_POLICY_COMPACT },
    ...(input.schemaMode === "COMPACT" ? [{ id: "investigation.common-parameters", version: 1, phases: PLANNING_PHASES, static: true, content: renderCommonParametersNote({ mode: "COMPACT", indicatorInFocus: Boolean(input.subject.indicatorCode) }) } satisfies PromptComponent] : []),
    // Contrato de parada (V1.3.1): estado investigativo estruturado ao propor STOP — a aplicação valida.
    { id: "investigation.stop-contract", version: 1, phases: PLANNING_PHASES, static: true, content: renderStopContract() },
    // Planejamento só precisa saber QUE bases existem (query_knowledge); o texto recuperado entra na síntese.
    { id: "knowledge.titles", version: 1, phases: PLANNING_PHASES, static: true, content: input.parts.knowledgeTitles },
    { id: "investigation.subject", version: 1, phases: "ALL", static: false, content: describeSubject(input) },
  ]
}

export function assembleInvestigationPrompt(phase: PromptPhase, input: InvestigationPromptInput, profile: PromptProfile = promptProfile()): AssembledPrompt {
  // Sem as partes do prompt do Agent só existe a composição da V1.2 — tudo no sistema.
  const effective: PromptProfile = input.parts ? profile : "CURRENT"
  return assemblePrompt(phase, investigationPromptComponents(input, effective), effective)
}
