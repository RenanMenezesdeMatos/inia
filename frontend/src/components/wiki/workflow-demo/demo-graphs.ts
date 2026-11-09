import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

/**
 * Os grafos das demonstrações da Wiki, como o editor os grava: mesmos tipos de nó, mesmas saídas, mesma configuração.
 *
 * NUNCA são executados, salvos nem enviados à API. Servem a três coisas:
 *   - desenhar o mapa da jornada na demonstração (`demo-journey-map.tsx`);
 *   - provar, nos testes, que cada exemplo é publicável na validação real do produto: a do editor
 *     (`demo-catalog.test.ts`) e a do backend (`wiki-demo-graphs.parity.test.ts`). Exemplo que o módulo recusa quebra o teste;
 *   - abrir o editor real, com dados fictícios, para as capturas (`docs/dev/wiki-capturas/`).
 *
 * Este arquivo só tem dados e importa só tipos: a API simulada das capturas o lê direto com o Node, sem o bundler.
 * Os ids são fictícios de propósito.
 */

/** Distância, em pixels do canvas, entre as colunas e as linhas do mapa. */
export const DEMO_CELL = { x: 320, y: 190 } as const
const at = (column: number, row: number) => ({ x: column * DEMO_CELL.x, y: row * DEMO_CELL.y })
const edge = (source: string, sourceHandle: string, target: string) => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target })

const FICTIONAL_AGENT = {
  qualidade: "00000000-0000-4000-8000-00000000a001",
  experiencia: "00000000-0000-4000-8000-00000000a002",
  eficiencia: "00000000-0000-4000-8000-00000000a003",
  reconhecimento: "00000000-0000-4000-8000-00000000a004",
  sintese: "00000000-0000-4000-8000-00000000a005",
} as const
const FICTIONAL_ORCHESTRATOR = "00000000-0000-4000-8000-00000000b001"
const FICTIONAL_POLICY = "00000000-0000-4000-8000-00000000c001"
export const FICTIONAL_VARIABLE = "00000000-0000-4000-8000-00000000d001"
const FICTIONAL_DIRECTOR = "00000000-0000-4000-8000-00000000e001"
const FICTIONAL_FLAG = { notaUra: "00000000-0000-4000-8000-00000000f001", contestacao: "00000000-0000-4000-8000-00000000f002" } as const

/** O gatilho como o editor grava (só o que o rascunho guarda; nomes de exibição ficam nos roteiros). */
export type DemoTriggerConfig =
  | { kind: "channel_flag"; channelFlagId: string; channel: "VOICE"; flagName: string; valueType: "BOOLEAN" | "NUMERIC" }
  | { kind: "indicator"; indicatorCode: string; indicatorName: string; unit: string; valueType: "NUMERIC" }
  | { kind: "schedule"; mode: "CALENDAR"; times: string[]; intervalDays: number; frequency: { type: "DAILY" } | { type: "MONTHLY"; mode: "DAY_OF_MONTH"; day: number } }

export type DemoGraphDefinition = {
  /** Mesmo id do roteiro (`DemoExample.slug`). */
  slug: string
  name: string
  trigger: DemoTriggerConfig
  /** Estrutura Consolidada, quando o modo é Consolidado. Ausente = Individual. */
  consolidatedStructure?: { kind: "DIRECTOR_STRUCTURE"; directorId: string }
  graph: FlowGraph
}

const INDICATOR_WEEK_QUERY = {
  kind: "INDICATOR_THRESHOLD_COUNT",
  indicatorCode: "TMA",
  aggregation: "WEIGHTED_AVERAGE",
  source: "MEASUREMENT",
  period: { kind: "ROLLING_DAYS", days: 7 },
  compareTo: { kind: "GOAL" },
} as const

export const DEMO_GRAPHS: DemoGraphDefinition[] = [
  {
    slug: "dois-momentos-do-dia",
    name: "Exemplo · Orientação em dois momentos do dia",
    trigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00", "15:00"], intervalDays: 1, frequency: { type: "DAILY" } },
    graph: {
      nodes: [
        { id: "gatilho", type: "trigger", label: "Todo dia às 09:00 e às 15:00", position: at(0, 0), config: {} },
        {
          id: "analise",
          type: "action",
          label: "Analisar uma chamada do dia",
          position: at(0, 1),
          config: { actionType: "CALL_AGENT", agentId: FICTIONAL_AGENT.qualidade, scheduledDataSource: { kind: "MONITORING", sampleSize: 1, period: "TODAY" } },
        },
        { id: "entrega", type: "output", label: "Orientação ao colaborador", position: at(0, 2), config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.analise" } },
        { id: "fim", type: "end", label: "Fim", position: at(0, 3), config: {} },
      ],
      edges: [edge("gatilho", "always", "analise"), edge("analise", "always", "entrega"), edge("entrega", "always", "fim")],
    },
  },
  {
    slug: "nota-ura-baixa",
    name: "Exemplo · Feedback por nota URA baixa",
    trigger: { kind: "channel_flag", channelFlagId: FICTIONAL_FLAG.notaUra, channel: "VOICE", flagName: "nota_ura", valueType: "NUMERIC" },
    graph: {
      nodes: [
        { id: "gatilho", type: "trigger", label: "Chegou uma nota na URA", position: at(0, 0), config: {} },
        { id: "condicao", type: "condition", label: "Nota da URA ≤ 2?", position: at(0, 1), config: { comparator: "LTE", thresholdNumeric: 2 } },
        { id: "analise", type: "action", label: "Analisar a chamada", position: at(0, 2), config: { actionType: "CALL_AGENT", agentId: FICTIONAL_AGENT.experiencia, outputContract: "PROCESS_ASSESSMENT" } },
        { id: "feedback", type: "action", label: "Gerar feedback", position: at(0, 3), config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "analise", feedbackDomain: "MONITORING" } },
        { id: "entrega", type: "output", label: "Orientação ao colaborador", position: at(0, 4), config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        { id: "fim", type: "end", label: "Fim", position: at(1, 5), config: {} },
      ],
      edges: [
        edge("gatilho", "always", "condicao"),
        edge("condicao", "true", "analise"),
        edge("condicao", "false", "fim"),
        edge("analise", "always", "feedback"),
        edge("feedback", "always", "entrega"),
        edge("entrega", "always", "fim"),
      ],
    },
  },
  {
    slug: "orientar-e-reavaliar",
    name: "Exemplo · Indicador fora da meta: orientar e reavaliar",
    trigger: { kind: "indicator", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", valueType: "NUMERIC" },
    graph: {
      nodes: [
        { id: "gatilho", type: "trigger", label: "Nova medição de TMA", position: at(1, 0), config: {} },
        { id: "fora-da-meta", type: "condition", label: "TMA médio (7 dias) acima da meta?", position: at(1, 1), config: { comparator: "GT", historicalQuery: INDICATOR_WEEK_QUERY } },
        { id: "analise", type: "action", label: "Analisar o indicador", position: at(0, 2), config: { actionType: "CALL_AGENT", agentId: FICTIONAL_AGENT.eficiencia } },
        { id: "feedback", type: "action", label: "Gerar feedback", position: at(0, 3), config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "analise", feedbackDomain: "INDICATOR" } },
        { id: "entrega", type: "output", label: "Orientação ao colaborador", position: at(0, 4), config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        { id: "espera", type: "wait", label: "Aguardar 7 dias", position: at(0, 5), config: { durationMs: 7 * 86_400_000 } },
        { id: "reavaliacao", type: "condition", label: "TMA ainda acima da meta?", position: at(0, 6), config: { comparator: "GT", historicalQuery: INDICATOR_WEEK_QUERY } },
        {
          id: "escalonar",
          type: "action",
          label: "Encaminhar ao Supervisor",
          position: at(0, 7),
          config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.feedback", surfaces: ["FOLLOW_UP", "NOTIFICATION"], reason: "O TMA seguiu acima da meta 7 dias depois da orientação.", continuation: "END_BRANCH" },
        },
        { id: "recado", type: "action", label: "Guardar o recado de evolução", position: at(1, 7), config: { actionType: "SET_VARIABLE", variableId: FICTIONAL_VARIABLE, value: "O TMA voltou para a meta depois da orientação. Vale reconhecer a evolução." } },
        { id: "reconhecer", type: "output", label: "Avisar o Supervisor da evolução", position: at(1, 8), config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: `variables.${FICTIONAL_VARIABLE}` } },
        { id: "fim", type: "end", label: "Fim", position: at(2, 9), config: {} },
      ],
      edges: [
        edge("gatilho", "always", "fora-da-meta"),
        edge("fora-da-meta", "true", "analise"),
        edge("fora-da-meta", "false", "fim"),
        edge("fora-da-meta", "no_data", "fim"),
        edge("analise", "always", "feedback"),
        edge("feedback", "always", "entrega"),
        edge("entrega", "always", "espera"),
        edge("espera", "always", "reavaliacao"),
        edge("reavaliacao", "true", "escalonar"),
        edge("reavaliacao", "false", "recado"),
        edge("reavaliacao", "no_data", "fim"),
        edge("recado", "always", "reconhecer"),
        edge("reconhecer", "always", "fim"),
      ],
    },
  },
  {
    slug: "revisao-antes-da-entrega",
    name: "Exemplo · Revisão humana antes da entrega",
    trigger: { kind: "channel_flag", channelFlagId: FICTIONAL_FLAG.contestacao, channel: "VOICE", flagName: "contestacao", valueType: "BOOLEAN" },
    graph: {
      nodes: [
        { id: "gatilho", type: "trigger", label: "Chamada com contestação", position: at(0, 0), config: {} },
        { id: "condicao", type: "condition", label: "Contestação confirmada?", position: at(0, 1), config: { comparator: "EQUALS", thresholdBoolean: true } },
        {
          id: "orquestrador",
          type: "orchestrator",
          label: "Analisar com os especialistas",
          position: at(0, 2),
          config: { orchestratorId: FICTIONAL_ORCHESTRATOR, instruction: "Identifique os domínios presentes na chamada, acione só os especialistas necessários e sintetize um único resultado, com citação literal da transcrição." },
        },
        { id: "feedback", type: "action", label: "Gerar feedback", position: at(0, 3), config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "orquestrador", feedbackDomain: "MONITORING" } },
        {
          id: "revisao",
          type: "human_review",
          label: "Revisão do Supervisor",
          position: at(0, 4),
          config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.feedback", instruction: "Confira se a orientação é justa e se as citações sustentam o que ela diz." },
        },
        { id: "entrega", type: "output", label: "Orientação ao colaborador", position: at(0, 5), config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        {
          id: "escalonar",
          type: "action",
          label: "Encaminhar ao Gerente",
          position: at(1, 5),
          config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, contentSource: "nodeOutputs.feedback", surfaces: ["FOLLOW_UP"], reason: "O Supervisor pediu uma segunda opinião sobre esta orientação.", continuation: "END_BRANCH" },
        },
        { id: "fim", type: "end", label: "Fim", position: at(2, 6), config: {} },
      ],
      edges: [
        edge("gatilho", "always", "condicao"),
        edge("condicao", "true", "orquestrador"),
        edge("condicao", "false", "fim"),
        edge("orquestrador", "always", "feedback"),
        edge("feedback", "always", "revisao"),
        edge("revisao", "approved", "entrega"),
        edge("revisao", "rejected", "fim"),
        edge("revisao", "escalated", "escalonar"),
        edge("entrega", "always", "fim"),
      ],
    },
  },
  {
    slug: "destaques-do-mes",
    name: "Exemplo · Reconhecer os destaques do mês",
    trigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 2 } },
    consolidatedStructure: { kind: "DIRECTOR_STRUCTURE", directorId: FICTIONAL_DIRECTOR },
    graph: {
      nodes: [
        { id: "gatilho", type: "trigger", label: "Todo dia 2 às 09:00", position: at(0, 0), config: {} },
        {
          id: "selecionar",
          type: "select_employees",
          label: "Melhor PRV de cada Subgrupo",
          position: at(0, 1),
          config: { selectionMode: "RANKING", ranking: { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "BEST", count: 1, rankingBasis: "VALUE", partitionBy: "SUBTEAM" } },
        },
        { id: "aplicar", type: "apply_individually", label: "Aplicar individualmente", position: at(0, 2), config: {} },
        { id: "agente", type: "action", label: "Escrever o reconhecimento", position: at(0, 3), config: { actionType: "CALL_AGENT", agentId: FICTIONAL_AGENT.reconhecimento, outputContract: "RECOGNITION", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } } },
        { id: "entrega", type: "output", label: "Reconhecimento ao colaborador", position: at(0, 4), config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agente" } },
        { id: "consolidar", type: "consolidate_results", label: "Consolidar resultados", position: at(0, 5), config: {} },
        {
          id: "sintese",
          type: "action",
          label: "Resumir para a liderança",
          position: at(0, 6),
          config: { actionType: "CALL_AGENT", agentId: FICTIONAL_AGENT.sintese, instruction: "Monte a visão dos destaques do mês. Todos os listados são reconhecidos pela posição, inclusive quem ficou fora da meta: diga quem se destacou, com quais números e quem ficou fora da meta. Nos próximos passos, comece reconhecendo cada pessoa listada pela posição dela. Quem aparecer como sem reconhecimento fica fora dos destaques: diga apenas que não houve comparação. Os resultados não mostram a causa: não explique por que eles aconteceram nem sugira melhoria de processo ou técnica." },
        },
        { id: "resumo", type: "output", label: "Destaques do mês à Diretoria", position: at(0, 7), config: { target: { type: "ROLE", role: "DIRECTOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.sintese" } },
        { id: "fim", type: "end", label: "Fim", position: at(0, 8), config: {} },
      ],
      edges: [
        edge("gatilho", "always", "selecionar"),
        edge("selecionar", "always", "aplicar"),
        edge("aplicar", "always", "agente"),
        edge("agente", "always", "entrega"),
        edge("entrega", "always", "consolidar"),
        edge("consolidar", "always", "sintese"),
        edge("sintese", "always", "resumo"),
        edge("resumo", "always", "fim"),
      ],
    },
  },
  {
    slug: "politica-de-acompanhamento",
    name: "Exemplo · Avaliar a política de acompanhamento",
    trigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } },
    graph: {
      nodes: [
        { id: "gatilho", type: "trigger", label: "Todo dia 5 às 09:00", position: at(0, 0), config: {} },
        { id: "politica", type: "intervention_policy", label: "Avaliar política de acompanhamento", position: at(0, 1), config: { policyId: FICTIONAL_POLICY, mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [] } },
        { id: "inconclusiva", type: "condition", label: "Ficou inconclusiva?", position: at(0, 2), config: { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.politica.structuredResult.inconclusive" } },
        { id: "recado", type: "action", label: "Guardar o aviso de dados", position: at(0, 3), config: { actionType: "SET_VARIABLE", variableId: FICTIONAL_VARIABLE, value: "A política não concluiu a avaliação por falta de dados. Vale conferir a carga antes de qualquer conversa." } },
        { id: "avisar", type: "output", label: "Avisar o Supervisor", position: at(0, 4), config: { target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["NOTIFICATION"], source: `variables.${FICTIONAL_VARIABLE}` } },
        { id: "fim", type: "end", label: "Fim", position: at(1, 5), config: {} },
      ],
      edges: [
        edge("gatilho", "always", "politica"),
        edge("politica", "always", "inconclusiva"),
        edge("inconclusiva", "true", "recado"),
        edge("inconclusiva", "false", "fim"),
        edge("recado", "always", "avisar"),
        edge("avisar", "always", "fim"),
      ],
    },
  },
]
