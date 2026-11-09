import { AGENT_OUTPUT_CONTRACT_LABELS, COMPARATOR_LABELS, ESCALATION_ROLE_LABELS, FEEDBACK_DOMAIN_LABELS, OUTPUT_SURFACE_LABELS, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"

import type { DemoField } from "./demo-types"
import type { ActionKind } from "./demo-catalog"

/**
 * Guia prático de cada nó e modalidade. A finalidade, a entrada e a saída já estão na referência (`wiki-reference.ts`, renderizada na
 * página de Nodes); aqui fica só o que ensina a usar. Cobertura garantida pelo tipo: nó novo no schema sem guia quebra o typecheck.
 */
export type NodeGuide = {
  /** Uma situação real em que é útil. */
  situation: string
  /** Onde encontrar e como configurar. */
  where: string
  /** Valores de exemplo, com os rótulos do editor. */
  values: DemoField[]
  /** Cena demonstrativa: o que entra, o que sai. */
  scene: {
    receives: string
    produces: string
    /** Saídas ou resultados possíveis, quando o nó tem mais de um. Só alternam textos já escritos. */
    outcomes?: { label: string; text: string }[]
  }
  caution?: string
}

export const NODE_GUIDES: Record<FlowNodeType, NodeGuide> = {
  trigger: {
    situation: "Toda jornada começa aqui: uma chamada que chegou, uma medição nova, um horário ou um clique.",
    where: "Já vem no canvas. Clique nele, ou abra Configurações do workflow › Gatilho: é a mesma configuração. Cada modalidade tem um guia próprio logo abaixo.",
    values: [{ label: "Tipo de gatilho", value: "Por agenda", option: true }],
    scene: { receives: "Um evento, um horário ou um clique", produces: "Uma execução para cada colaborador envolvido (ou uma só, da estrutura, no modo Consolidado)" },
    caution: "Mudar o gatilho fica em rascunho até Publicar. O Workflow publicado continua como estava.",
  },
  wait: {
    situation: "Dar 7 dias para a pessoa aplicar a orientação antes de olhar o indicador de novo.",
    where: "Paleta › Decidir e esperar › Aguardar.",
    values: [
      { label: "Duração", value: "7", illustrative: true },
      { label: "Unidade", value: "Dias", option: true },
    ],
    scene: { receives: "O que a execução já tem", produces: "Nada novo: retoma sozinha depois do prazo, com o mesmo contexto" },
    caution: "Não troque um horário de Agenda por uma espera: dois horários são dois disparos, e a espera prende uma execução só. Aguardar também não espera evento nem pessoa.",
  },
  condition: {
    situation: "Só analisar a chamada quando a nota da URA ficou abaixo do limite.",
    where: "Paleta › Decidir e esperar › Condição. Comece em \"Baseado em\": os demais campos mudam conforme a escolha.",
    values: [
      { label: "Baseado em", value: "Valor do gatilho", option: true },
      { label: "Condição", value: COMPARATOR_LABELS.LTE, option: true },
      { label: "Valor", value: "2", illustrative: true },
    ],
    scene: {
      receives: "Um valor: do gatilho, de um nó anterior, de uma variável ou de um indicador",
      produces: "Uma saída, e nada além disso",
      outcomes: [
        { label: "Sim", text: "A comparação bateu. O fluxo segue pelo caminho ligado a Sim." },
        { label: "Não", text: "A comparação não bateu. O fluxo segue pelo caminho ligado a Não." },
        { label: "Sem dados", text: "Só em Condições de indicador com agregação de valor (como Média): faltou dado no período. Dado ausente nunca é resultado ruim, e por isso não cai em Sim nem em Não." },
      ],
    },
    caution: "\"Sem dados\" só existe em Condições de indicador com agregação de valor. Com \"Quantidade de ocorrências\", zero é uma resposta válida. Numa flag, sem valor o fluxo nem começa.",
  },
  select_employees: {
    situation: "Olhar uma estrutura inteira e ficar só com o melhor de cada Subgrupo.",
    where: "Paleta › Analisar uma estrutura. Esse grupo só aparece com \"Uma estrutura consolidada\" no Alvo da avaliação.",
    values: [
      { label: "Modo de seleção", value: "Por ranking", option: true },
      { label: "Posição", value: "Melhores desempenhos", option: true },
      { label: "Selecionar", value: "1", illustrative: true },
      { label: "Separar ranking por", value: "Subgrupo", option: true },
    ],
    scene: { receives: "A estrutura, ou uma coleção anterior", produces: "Uma lista de colaboradores, sem nenhuma análise individual ainda" },
    caution: "Selecionar não executa ninguém. Sem \"Aplicar individualmente\", a lista só fica no histórico. Zero selecionados não é erro.",
  },
  apply_individually: {
    situation: "Cada pessoa da lista precisa da própria análise, revisão ou mensagem.",
    where: "Paleta › Analisar uma estrutura › Aplicar individualmente, logo depois de uma seleção. Não tem configuração.",
    values: [{ label: "Origem", value: "O \"Selecionar colaboradores\" anterior" }],
    scene: { receives: "Uma coleção com N pessoas", produces: "N execuções separadas" },
    caution: "Aprovar a revisão de uma pessoa nunca decide a de outra. Não dá para aplicar dentro de outro aplicar. Uma Condição depois daqui olha só a pessoa daquela execução; no quartil operacional, a comparação é com a coleção selecionada.",
  },
  consolidate_results: {
    situation: "Depois de analisar cada pessoa, dar à liderança uma visão só.",
    where: "Paleta › Analisar uma estrutura › Consolidar resultados, no fim do caminho individual. Não tem configuração.",
    values: [{ label: "Aguardar", value: "Todas as execuções", option: true }],
    scene: { receives: "O estado final de cada execução individual", produces: "Um resultado consolidado, com quem concluiu, quem falhou e o que cada um produziu" },
    caution: "Espera todas as execuções, sem prazo: uma revisão humana parada segura a consolidação. Depois daqui não existe \"O próprio colaborador\".",
  },
  action: {
    situation: "É o nó que faz algo sobre um colaborador: analisar, escrever, guardar ou encaminhar. Cada modalidade tem um guia próprio na seção \"Ação: os tipos\".",
    where: "Cada modalidade é um item próprio na paleta. Dentro do painel, o campo \"Tipo de ação\" troca a modalidade.",
    values: [{ label: "Tipo de ação", value: "Chamar agente", option: true }],
    scene: { receives: "O colaborador da execução e o que os nós anteriores produziram", produces: "Depende da modalidade" },
    caution: "A Ação exige um colaborador individual. Em modo Consolidado, ela só funciona depois de \"Aplicar individualmente\".",
  },
  orchestrator: {
    situation: "Uma contestação pode envolver fatura e cancelamento, e a IA deve escolher quais especialistas chamar.",
    where: "Paleta › Analisar com IA › Orquestrador. Só aparecem os publicados com acionamento por workflows.",
    values: [
      { label: "Orquestrador", value: "Orquestrador · Atendimento multidomínio" },
      { label: "Instrução", value: "Identifique os domínios da chamada e acione só os especialistas necessários." },
      { label: "Roteamento", value: "Decidido pela IA", option: true },
    ],
    scene: { receives: "A instrução do nó e a transcrição, ou o resultado consolidado", produces: "Uma síntese, e campos estruturados quando o Orquestrador os declara" },
    caution: "Se um único agente resolve, prefira \"Chamar agente\": é uma chamada de IA, não duas.",
  },
  human_review: {
    situation: "Conferir uma orientação sobre um caso sensível antes de ela chegar à pessoa.",
    where: "Paleta › Decidir e esperar › Revisão humana.",
    values: [
      { label: "Revisor", value: "Cargo relativo ao operador", option: true },
      { label: "Cargo", value: ESCALATION_ROLE_LABELS.SUPERVISOR, option: true },
      { label: "Conteúdo a revisar (opcional)", value: "Feedback confiável: Gerar feedback" },
    ],
    scene: {
      receives: "O conteúdo a revisar e a instrução para o revisor",
      produces: "Uma pendência, e o fluxo parado até a decisão",
      outcomes: [
        { label: "Aprovado", text: "O fluxo segue. Em geral, para o Output que entrega ao colaborador." },
        { label: "Reprovado", text: "O fluxo segue pela saída Reprovado, em geral para o Fim. Nada é entregue ao colaborador." },
        { label: "Escalar", text: "O fluxo segue pela saída Escalar, em geral para um Escalonar, que encaminha o conteúdo a quem está acima." },
      ],
    },
    caution: "Não há prazo: sem decisão, a execução continua parada. O colaborador analisado nunca revisa o próprio caso.",
  },
  output: {
    situation: "Levar a orientação ao Acompanhamento do colaborador, ou um aviso ao sino do Supervisor.",
    where: "Paleta › Entregar › Output. Preencha quem recebe, onde aparece e o que entregar.",
    values: [
      { label: "Destinatário", value: "O próprio colaborador", option: true },
      { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
      { label: "Conteúdo a publicar", value: "Feedback confiável: Gerar feedback" },
    ],
    scene: { receives: "O conteúdo escolhido", produces: "Algo visível para alguém: é a única etapa que faz isso, além do Escalonar" },
    caution: "Conteúdo ausente nunca vira entrega vazia: a execução é encerrada e nada é entregue. Depois de \"Consolidar resultados\", o destinatário precisa ser alguém da gestão.",
  },
  intervention_policy: {
    situation: "Todo mês, verificar se cabe observar, orientar, treinar ou abrir um plano para cada pessoa, sempre pelos critérios da política publicada.",
    where: "Paleta › Analisar com IA › Avaliar política de acompanhamento. A política é criada em Administração › Políticas de acompanhamento.",
    values: [
      { label: "Política de acompanhamento", value: "Acompanhamento de TMA (fictícia)" },
      { label: "Modo", value: "Somente recomendar", option: true },
    ],
    scene: {
      receives: "O colaborador e a versão da política em vigor",
      produces: "Uma avaliação registrada e um resultado para usar em Condições",
      outcomes: [
        { label: "Recomendada", text: "O responsável recebe a recomendação, e aceita ou descarta no caso de supervisão." },
        { label: "Nenhuma regra atendida", text: "Não há nada a fazer. A avaliação fica registrada." },
        { label: "Inconclusiva", text: "Faltaram dados: a política não conclui, e nada é afirmado sobre a pessoa." },
      ],
    },
    caution: "Critérios, prazos e aprovações são da política, e o nó não os sobrescreve. Ele nunca decide nem executa desligamento: a avaliação de continuidade é sempre decisão humana.",
  },
  end: {
    situation: "Encerrar de forma explícita os caminhos que não levam a lugar nenhum: Não, Sem dados, Reprovado.",
    where: "Paleta › Organizar › Fim. Já vem um no canvas, e vários caminhos podem apontar para o mesmo.",
    values: [],
    scene: { receives: "Qualquer contexto", produces: "Nada: a execução termina" },
    caution: "Saída sem ligação bloqueia a publicação. Ligar ao Fim deixa a intenção clara.",
  },
}

/** Modalidades do Gatilho. A Agenda aparece duas vezes: de calendário e relativa ao expediente são escolhas bem diferentes. */
export type TriggerModality = "channel_flag" | "indicator" | "schedule" | "schedule_relative" | "manual"

export const TRIGGER_MODALITY_LABELS: Record<TriggerModality, string> = {
  channel_flag: "Flag de canal",
  indicator: "Indicador",
  schedule: "Por agenda: horário/calendário",
  schedule_relative: "Por agenda: relativo ao expediente",
  manual: "Manual",
}

export const TRIGGER_GUIDES: Record<TriggerModality, NodeGuide> = {
  channel_flag: {
    situation: "Reagir a cada chamada com nota baixa na URA, contestação ou rechamada.",
    where: "Nó Gatilho › Tipo de gatilho: Flag de canal. A lista de flags vem do catálogo da Administração.",
    values: [
      { label: "Tipo de gatilho", value: "Flag de canal", option: true },
      { label: "Flag do canal", value: "VOICE · nota_ura" },
    ],
    scene: { receives: "Uma interação que chegou com a flag já calculada", produces: "Uma execução do operador daquela chamada, com a transcrição disponível" },
    caution: "Sempre individual. Reenviar a mesma flag com o mesmo valor não abre outra execução. Chat e Avatar não são gatilhos, mas lugares de entrega.",
  },
  indicator: {
    situation: "Olhar o TMA sempre que chega uma medição nova de um colaborador.",
    where: "Nó Gatilho › Tipo de gatilho: Indicador.",
    values: [
      { label: "Tipo de gatilho", value: "Indicador", option: true },
      { label: "Indicador", value: "TMA" },
    ],
    scene: { receives: "Uma medição nova", produces: "Uma execução do dono da medição, com o valor disponível para a Condição" },
    caution: "Sempre individual. Medições diárias significam uma execução por dia.",
  },
  schedule: {
    situation: "Rodar todo dia às 09:00 e às 15:00, ou todo dia 5 do mês.",
    where: "Nó Gatilho › Tipo de gatilho: Por agenda › Modo da agenda: Horário/calendário.",
    values: [
      { label: "Modo da agenda", value: "Horário/calendário", option: true },
      { label: "Frequência", value: "Diariamente", option: true },
      { label: "Horários", value: "09:00 e 15:00", illustrative: true },
    ],
    scene: { receives: "O relógio, no fuso da organização", produces: "Uma execução por colaborador, para cada horário; ou uma só, da estrutura, no modo Consolidado" },
    caution: "A Agenda não traz chamada nem medição: o \"Chamar agente\" define a Fonte de dados. Publicar depois de um horário de hoje dispara esse horário em até 1 minuto, e o diálogo de Publicar mostra o impacto antes.",
  },
  schedule_relative: {
    situation: "Rodar no meio do expediente de cada pessoa, mesmo com turnos diferentes.",
    where: "Nó Gatilho › Tipo de gatilho: Por agenda › Modo da agenda: Relativo ao expediente.",
    values: [
      { label: "Modo da agenda", value: "Relativo ao expediente", option: true },
      { label: "Momento", value: "Percentual da jornada", option: true },
      { label: "Percentual da jornada", value: "50", illustrative: true },
    ],
    scene: { receives: "A jornada prevista de cada colaborador", produces: "Uma execução por colaborador, no horário calculado para cada um" },
    caution: "Sempre individual, e um momento só por Workflow. Usa a jornada prevista no cadastro, não o login real.",
  },
  manual: {
    situation: "Testar o fluxo com uma chamada específica de uma pessoa, ou rodar sob demanda.",
    where: "Nó Gatilho › Tipo de gatilho: Manual. Depois de publicar, aparece o botão \"Executar agora\".",
    values: [
      { label: "Tipo de gatilho", value: "Manual", option: true },
      { label: "Dados de cada execução", value: "Interação do colaborador", option: true },
    ],
    scene: { receives: "O clique de quem tem permissão, com o colaborador escolhido", produces: "Uma execução, com a interação ou a medição escolhida" },
    caution: "A execução é real, com as entregas configuradas. Para testar sem efeito, use o QA Lab.",
  },
}

/** Modalidades da Ação oferecidas em nós novos. As legadas (Definir configuração, Feedback direto) só existem em nós já criados. */
export type ActiveActionKind = Exclude<ActionKind, "SET_CONFIG_VALUE" | "GENERATE_INTERACTION_FEEDBACK">

export const ACTION_GUIDES: Record<ActiveActionKind, NodeGuide> = {
  CALL_AGENT: {
    situation: "Você sabe qual especialista deve analisar: faturamento, qualidade, reconhecimento.",
    where: "Paleta › Analisar com IA › Chamar agente. Com gatilho por Agenda, role até \"Fonte de dados\", que é obrigatória.",
    values: [
      { label: "Agente", value: "Especialista de Experiência do Cliente" },
      { label: "Formato da análise", value: AGENT_OUTPUT_CONTRACT_LABELS.PROCESS_ASSESSMENT, option: true },
    ],
    scene: { receives: "A transcrição, a medição ou a fonte de dados da Agenda", produces: "O resultado do agente, que ainda não chega a ninguém" },
    caution: "O agente nunca publica sozinho. Sem um Output ou um Escalonar com conteúdo, o Workflow não publica.",
  },
  GENERATE_FEEDBACK: {
    situation: "Transformar a análise em uma orientação clara, com a base citada, antes de entregar.",
    where: "Paleta › Analisar com IA › Gerar feedback, depois de um \"Chamar agente\" ou \"Orquestrador\".",
    values: [
      { label: "Origem", value: "Analisar a chamada — Agente: Especialista de Experiência do Cliente" },
      { label: "Tipo", value: FEEDBACK_DOMAIN_LABELS.MONITORING, option: true },
    ],
    scene: {
      receives: "O resultado da Origem",
      produces: "A mensagem de feedback, que ainda não foi entregue",
      outcomes: [
        { label: "Pode publicar", text: "A mensagem passa nas conferências, e o fluxo segue para o Output." },
        { label: "Sem base suficiente", text: "Não há nada material a dizer: o nó encerra a execução com o motivo, sem esperar ninguém, e nada é entregue." },
      ],
    },
    caution: "Monitoria exige Flag de canal ou Manual com interação. Indicador exige gatilho por Indicador, Manual com medição, ou o diagnóstico de fechamento na Agenda. Este nó não entrega: quem entrega é o Output.",
  },
  ESCALATE: {
    situation: "O indicador seguiu fora da meta, e a liderança precisa assumir.",
    where: "Paleta › Entregar › Escalonar.",
    values: [
      { label: "Destino", value: "Cargo relativo ao operador", option: true },
      { label: "Cargo", value: ESCALATION_ROLE_LABELS.SUPERVISOR, option: true },
      { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.NOTIFICATION, option: true },
      { label: "Após escalonar", value: "Continuar o fluxo", option: true },
    ],
    scene: { receives: "O colaborador e, se escolhido, um conteúdo", produces: "Um escalonamento para o destino; o fluxo segue ou encerra aquele caminho" },
    caution: "Escalonar não espera resposta. Se alguém precisa decidir antes de o fluxo seguir, use Revisão humana. Com um feedback como conteúdo, entregue em Acompanhamento ou Notificação: ele é do colaborador analisado.",
  },
  SET_VARIABLE: {
    situation: "Guardar um valor para usar mais adiante, como o texto de um aviso à liderança.",
    where: "Paleta › Organizar › Definir variável.",
    values: [
      { label: "Variável", value: "Recado de evolução" },
      { label: "Origem do valor", value: "Valor fixo", option: true },
      { label: "Valor", value: "O TMA voltou para a meta." },
    ],
    scene: { receives: "Um valor fixo, ou o valor do gatilho, de um nó anterior ou de outra variável", produces: "A variável preenchida nesta execução" },
    caution: "É memória da execução, não um indicador. Usou uma vez só? Referencie direto. E variável não serve de conteúdo para o Acompanhamento do próprio colaborador.",
  },
}
