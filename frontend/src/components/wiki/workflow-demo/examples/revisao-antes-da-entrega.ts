import { ESCALATION_ROLE_LABELS, FEEDBACK_DOMAIN_LABELS, OUTPUT_SURFACE_LABELS } from "@/schemas/admin/workflow-graph.schema"
import type { FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"

import type { DemoExample, DemoPanel, DemoScene } from "../demo-types"

const ORCHESTRATOR = "Orquestrador · Atendimento multidomínio"

const reviewPanel: DemoPanel = {
  title: "Revisão humana",
  where: "Paleta › Decidir e esperar › Revisão humana.",
  fields: [
    { label: "Revisor", value: "Cargo relativo ao operador", option: true },
    { label: "Cargo", value: ESCALATION_ROLE_LABELS.SUPERVISOR, option: true },
    { label: "Conteúdo a revisar (opcional)", value: "Feedback confiável: Gerar feedback" },
    { label: "Instrução para o revisor (opcional)", value: "Confira se a orientação é justa e se as citações sustentam o que ela diz." },
  ],
}

const VIEW: FeedbackView = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Contestação de cobrança", subtitle: "Atendimento de ontem" },
  card: "A contestação foi registrada, mas sem o protocolo.",
  greeting: "Elisa, olhei o atendimento sobre a contestação de cobrança.",
  narrative: [
    "Você ouviu o cliente e registrou a contestação com calma, mesmo com ele irritado. Isso ajudou a conversa a avançar.",
    "O ajuste é informar o protocolo antes de encerrar, como o procedimento pede: é ele que permite acompanhar a contestação depois.",
  ],
  developments: [],
  maintain: null,
  attention: [],
  materials: [],
  context: null,
  kind: "MONITORING",
}

const scenes: DemoScene[] = [
  {
    id: "gatilho",
    nodeId: "gatilho",
    title: "Uma chamada chega marcada com contestação",
    summary: "A flag é verdadeiro ou falso e chega calculada com a interação. O Workflow começa para o operador daquela chamada.",
    panel: {
      title: "Gatilho",
      where: "Clique no nó Gatilho do canvas.",
      fields: [
        { label: "Tipo de gatilho", value: "Flag de canal", option: true },
        { label: "Flag do canal", value: "VOICE · contestacao" },
      ],
    },
    input: ["Chamada da Elisa com contestacao = verdadeiro (fictício)."],
    output: ["Uma execução da Elisa, com a chamada e a transcrição."],
    howTo: ["Crie o Workflow com o tipo de gatilho \"Flag de canal\" e escolha a flag."],
    shots: ["flag-contestacao"],
  },
  {
    id: "condicao",
    nodeId: "condicao",
    title: "A flag veio verdadeira: caminho Sim",
    summary: "Numa flag de verdadeiro ou falso, a Condição pergunta como ela deve vir. Só a saída Sim segue para a análise.",
    panel: {
      title: "Condição",
      where: "Paleta › Decidir e esperar › Condição.",
      fields: [
        { label: "Baseado em", value: "Valor do gatilho", option: true },
        { label: "Quando a flag vier", value: "Verdadeira", option: true },
      ],
    },
    input: ["Valor do gatilho: verdadeiro."],
    output: ["Saída Sim: segue para o Orquestrador."],
    howTo: ["Adicione a Condição e ligue Não a um nó Fim."],
    shots: ["condicao-contestacao"],
  },
  {
    id: "orquestrador",
    nodeId: "orquestrador",
    title: "A IA escolhe quais especialistas chamar",
    summary: "Uma contestação pode envolver fatura e cancelamento. O Orquestrador aciona só os especialistas necessários e sintetiza um único resultado. Se um agente resolve, prefira \"Chamar agente\".",
    panel: {
      title: "Orquestrador",
      where: "Paleta › Analisar com IA › Orquestrador.",
      fields: [
        { label: "Orquestrador", value: ORCHESTRATOR, hint: "Só aparecem os publicados, com acionamento por workflows." },
        { label: "Instrução", value: "Identifique os domínios presentes na chamada, acione só os especialistas necessários e sintetize um único resultado, com citação literal." },
        { label: "Roteamento", value: "Decidido pela IA", option: true, hint: "\"Domínios fixos deste disparo\" dispensa a escolha quando o assunto já é conhecido." },
      ],
    },
    input: ["A instrução do nó.", "A transcrição da chamada."],
    output: ["Uma síntese, ainda sem efeito para ninguém."],
    howTo: ["Adicione o Orquestrador, escolha um publicado e escreva a instrução.", "Em \"Roteamento\", deixe a IA decidir ou fixe os domínios."],
    shots: ["orquestrador"],
  },
  {
    id: "feedback",
    nodeId: "feedback",
    title: "A síntese vira uma orientação",
    summary: "\"Gerar feedback\" confere a citação na transcrição e escreve a mensagem. Em seguida, ela espera um olhar humano.",
    panel: {
      title: "Gerar feedback",
      where: "Paleta › Analisar com IA › Gerar feedback.",
      fields: [
        { label: "Tipo de ação", value: "Gerar feedback", option: true },
        { label: "Origem", value: `Analisar com os especialistas — Orquestrador: ${ORCHESTRATOR}` },
        { label: "Tipo", value: FEEDBACK_DOMAIN_LABELS.MONITORING, option: true },
      ],
    },
    input: ["O resultado do Orquestrador."],
    output: ["Mensagem pronta, que ainda não foi entregue."],
    howTo: ["Adicione \"Gerar feedback\" e escolha o Orquestrador como Origem."],
    shots: ["gerar-feedback-orquestrador"],
  },
  {
    id: "revisao",
    nodeId: "revisao",
    title: "O fluxo para até o Supervisor decidir",
    summary: "A Revisão humana é a única etapa que espera alguém. A execução fica parada em Pendências, sem prazo, até a decisão. Escolha acima a decisão que quer ver: esta é só uma demonstração.",
    panel: reviewPanel,
    input: ["A mensagem de \"Gerar feedback\".", "A instrução para o revisor."],
    output: ["Uma pendência para o Supervisor da Elisa, com aviso no sino."],
    preview: {
      kind: "review",
      audience: "O que o Supervisor vê em Pendências",
      title: "Revisão do Supervisor",
      instruction: "Confira se a orientação é justa e se as citações sustentam o que ela diz.",
      content: "Elisa, olhei o atendimento sobre a contestação de cobrança. Você ouviu o cliente e registrou a contestação com calma. O ajuste é informar o protocolo antes de encerrar.",
      decisions: ["Aprovar", "Reprovar", "Escalar"],
    },
    howTo: ["Adicione a Revisão humana e escolha o Revisor.", "Ligue as três saídas: Aprovado, Reprovado e Escalar."],
    shots: ["revisao-humana"],
    caution: "Sem prazo significa sem prazo: se ninguém decidir, a execução continua parada. E o colaborador analisado nunca revisa o próprio caso.",
  },
  {
    id: "aprovado",
    nodeId: "entrega",
    title: "Aprovado: a orientação é entregue",
    summary: "Só agora o conteúdo chega à Elisa. Foi o Output que entregou, não a decisão.",
    panel: {
      title: "Output",
      where: "Paleta › Entregar › Output, na saída Aprovado.",
      fields: [
        { label: "Destinatário", value: "O próprio colaborador", option: true },
        { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
        { label: "Conteúdo a publicar", value: "Feedback confiável: Gerar feedback" },
      ],
    },
    input: ["Decisão: Aprovado.", "A mensagem de \"Gerar feedback\"."],
    output: ["Feedback publicado no Acompanhamento da Elisa."],
    preview: { kind: "feedback", audience: "O que a Elisa vê no Acompanhamento", originLabel: "Contestação", title: "Contestação de cobrança", when: "Atendimento de ontem", view: VIEW },
    howTo: ["Ligue a saída Aprovado ao Output."],
    shots: ["output-feedback-aprovado"],
  },
  {
    id: "fim-aprovado",
    nodeId: "fim",
    title: "Jornada concluída",
    summary: "Execução concluída. A decisão do Supervisor fica registrada.",
    input: ["O caminho chegou ao fim."],
    output: ["Execução concluída."],
    howTo: ["Ligue o Output a um nó Fim."],
  },
  {
    id: "reprovado",
    nodeId: "fim",
    title: "Reprovado: a Elisa não recebe nada",
    summary: "O Supervisor entendeu que a orientação não se sustenta. A saída Reprovado leva ao Fim: nada é publicado, e a decisão fica registrada.",
    input: ["Decisão: Reprovado."],
    output: ["Execução concluída, sem entrega."],
    preview: { kind: "nothing", title: "Nada chega à Elisa", text: "A orientação reprovada não aparece no Acompanhamento dela." },
    howTo: ["Ligue a saída Reprovado a um nó Fim."],
  },
  {
    id: "escalonar",
    nodeId: "escalonar",
    title: "Escalar: o caso sobe para o Gerente",
    summary: "O Supervisor pediu uma segunda opinião. O Escalonar encaminha a orientação ao Gerente, e este caminho se encerra. Esse encaminhamento não é uma nova revisão: a execução não fica esperando o Gerente.",
    panel: {
      title: "Escalonar",
      where: "Paleta › Entregar › Escalonar, na saída Escalar.",
      fields: [
        { label: "Destino", value: "Cargo relativo ao operador", option: true },
        { label: "Cargo", value: ESCALATION_ROLE_LABELS.MANAGER, option: true },
        { label: "Conteúdo a escalonar (opcional)", value: "Feedback confiável: Gerar feedback" },
        { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
        { label: "Motivo (opcional)", value: "O Supervisor pediu uma segunda opinião sobre esta orientação." },
        { label: "Após escalonar", value: "Encerrar este branch", option: true },
      ],
    },
    input: ["Decisão: Escalar.", "A mensagem de \"Gerar feedback\"."],
    output: ["Um escalonamento no Acompanhamento do Gerente. A Elisa não recebe a orientação por este caminho."],
    preview: { kind: "notice", audience: "O que o Gerente vê no Acompanhamento", family: "ESCALATION", originLabel: null, title: "Encaminhar ao Gerente", text: "O Supervisor pediu uma segunda opinião sobre esta orientação. Junto vem a orientação revisada (fictícia).", surface: "Acompanhamento" },
    howTo: ["Ligue a saída Escalar a um Escalonar.", "Em \"Após escalonar\", escolha \"Encerrar este branch\"."],
    shots: ["escalonar-gerente"],
    stopsHere: "closed",
  },
]

export const REVISAO_ANTES_DA_ENTREGA: DemoExample = {
  slug: "revisao-antes-da-entrega",
  objective: "liderar",
  title: "Revisão humana antes da entrega",
  problem: "Uma orientação sobre um caso sensível não deveria chegar à pessoa sem alguém conferir.",
  whenToUse: "Quando o assunto é delicado ou tem impacto na pessoa, e a liderança deve decidir antes.",
  startsWith: "Flag VOICE · contestacao, a cada chamada marcada",
  recipient: "O colaborador, se aprovado; o Gerente, se escalado",
  persona: { name: "Elisa", role: "operadora de atendimento (fictícia)", need: "Um cliente contestou uma cobrança, e o caso envolve mais de um assunto." },
  goal: "Gerar a orientação com IA e só entregar depois da decisão do Supervisor.",
  expectedResult: "A decisão do Supervisor define o caminho: entregar, não entregar ou encaminhar.",
  brief: [
    { question: "Quem participa?", answer: "O operador da chamada; o Supervisor dele revisa, resolvido pela hierarquia." },
    { question: "Quando o fluxo começa?", answer: "Quando uma chamada chega com a flag de contestação." },
    { question: "De onde vêm os dados e qual período?", answer: "Da própria chamada que disparou: não há período a escolher." },
    { question: "Como as condições determinam o caminho?", answer: "A Condição confirma o valor da flag; a Revisão humana abre três saídas: Aprovado, Reprovado e Escalar." },
    { question: "Como a análise vira orientação?", answer: "O Orquestrador sintetiza os especialistas e \"Gerar feedback\" escreve a mensagem." },
    { question: "Como chega a cada pessoa?", answer: "Ao colaborador pelo Output, só se aprovado. Ao Gerente pelo Escalonar, se escalado." },
    { question: "Quais desfechos alternativos existem?", answer: "Reprovado: nada é publicado. Escalar: o caso sobe, e este caminho termina." },
  ],
  scenarios: [
    { id: "aprovar", label: "Aprovar", description: "A orientação chega à Elisa.", scenes: ["gatilho", "condicao", "orquestrador", "feedback", "revisao", "aprovado", "fim-aprovado"] },
    { id: "reprovar", label: "Reprovar", description: "A orientação não é publicada.", scenes: ["gatilho", "condicao", "orquestrador", "feedback", "revisao", "reprovado"] },
    { id: "escalar", label: "Escalar", description: "O caso sobe para o Gerente.", scenes: ["gatilho", "condicao", "orquestrador", "feedback", "revisao", "escalonar"] },
  ],
  scenes: Object.fromEntries(scenes.map((scene) => [scene.id, scene])),
  mapLabels: { gatilho: "Contestação", condicao: "Confirmada?", orquestrador: "Orquestrador", feedback: "Gerar feedback", revisao: "Revisão humana", entrega: "Entregar", escalonar: "Escalonar", fim: "Fim" },
}
