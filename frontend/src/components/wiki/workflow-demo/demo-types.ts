import type { FeedbackEntryFamily } from "@/components/feedbacks/feedback-entry-header"
import type { FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"

import type { DemoGraphDefinition } from "./demo-graphs"

/**
 * Roteiros das demonstrações da Wiki de Workflows: textos, telas e resultados FIXOS.
 *
 * Nada aqui é avaliado. Um desfecho é só uma lista de cenas já escritas; escolher outro desfecho troca a lista. O player não lê
 * o grafo para decidir nada, não compara valores e não chama nenhum serviço.
 */

/** Um campo da configuração ilustrativa, com o mesmo rótulo do editor. */
export type DemoField = {
  label: string
  value: string
  /** `value` é uma opção real do produto (conferido no teste de fidelidade). Falso = valor de exemplo livre (nome, limite, texto). */
  option?: boolean
  /** Limite ou valor ilustrativo: a tela marca como "exemplo", para nunca parecer política oficial. */
  illustrative?: boolean
  hint?: string
}

export type DemoPanel = {
  /** Título do painel como aparece no editor. */
  title: string
  /** Como chegar a este painel. */
  where: string
  fields: DemoField[]
}

export type DemoPreview =
  /** Feedback do motor (`Gerar feedback`): renderizado pelo mesmo componente do Acompanhamento. */
  | { kind: "feedback"; audience: string; originLabel: string; title: string; when: string; timestamp?: string; view: FeedbackView }
  /** Feedback publicado direto do resultado de um agente: as quatro partes de um feedback publicável. */
  | { kind: "agent-feedback"; audience: string; originLabel: string; title: string; when: string; timestamp?: string; evidence: string; behavior: string; procedure: string; recommendation: string }
  /** Aviso ou conteúdo entregue a alguém da liderança (sino, Acompanhamento da estrutura). */
  | { kind: "notice"; audience: string; family: FeedbackEntryFamily; originLabel: string | null; title: string; text: string; surface: string }
  /** Revisão parada em Pendências, à espera de uma decisão. */
  | { kind: "review"; audience: string; title: string; instruction: string; content: string; decisions: string[] }
  /** Nada chega a ninguém. */
  | { kind: "nothing"; title: string; text: string; adminNote?: string }

export type DemoScene = {
  id: string
  /** Nó do grafo em foco. */
  nodeId: string
  title: string
  /** O que acontece neste passo, em poucas frases. */
  summary: string
  panel?: DemoPanel
  /** Dados fictícios que chegam ao passo. */
  input: string[]
  /** O que o passo produz ou encaminha. */
  output: string[]
  preview?: DemoPreview
  /** Como reproduzir no módulo real. */
  howTo: string[]
  /** Prints reais deste passo (`demo-shots.ts`). */
  shots?: string[]
  caution?: string
  /** Estado de término mostrado no mapa quando a cena encerra o caminho sem chegar ao Fim. */
  stopsHere?: "failed" | "closed"
}

export type DemoScenario = {
  id: string
  /** Rótulo da escolha ("Nota abaixo do limite"). */
  label: string
  /** O que este desfecho mostra, em uma frase. */
  description: string
  /** Cenas, em ordem. */
  scenes: string[]
}

export type DemoObjective = "orientar" | "reconhecer" | "acompanhar" | "liderar"

export type DemoBriefItem = { question: string; answer: string }

export type DemoExample = {
  /** Âncora da seção e chave do grafo. */
  slug: string
  objective: DemoObjective
  title: string
  /** Problema de negócio, numa frase. */
  problem: string
  whenToUse: string
  startsWith: string
  recipient: string
  /** A pessoa fictícia e a necessidade dela. */
  persona: { name: string; role: string; need: string }
  goal: string
  expectedResult: string
  /** A jornada completa, respondendo às perguntas de sempre. */
  brief: DemoBriefItem[]
  /** Quando o pedido precisou ser adaptado ao que o produto suporta. */
  support?: { title: string; intro: string; works: string[]; limits: string[]; alternative?: string }
  scenarios: DemoScenario[]
  scenes: Record<string, DemoScene>
  /** Rótulos curtos para o mapa, por id de nó. */
  mapLabels: Record<string, string>
}

export type DemoExampleWithGraph = DemoExample & { definition: DemoGraphDefinition }

/** Print real (ou ilustração) com marcações numeradas. Coordenadas em % da imagem. */
export type DemoShot = {
  id: string
  src: string
  width: number
  height: number
  alt: string
  caption: string
  /** Real: tirado da tela do produto, com dados fictícios. Ilustração: representação, nunca apresentada como print. */
  kind: "print" | "illustration"
  markers: { n: number; x: number; y: number; text: string }[]
}
