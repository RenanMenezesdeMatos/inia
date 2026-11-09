import { AGENT_OUTPUT_CONTRACT_LABELS, COMPARATOR_LABELS, FEEDBACK_DOMAIN_LABELS, OUTPUT_SURFACE_LABELS } from "@/schemas/admin/workflow-graph.schema"
import type { FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"

import type { DemoExample, DemoPanel, DemoScene } from "../demo-types"

const AGENT = "Especialista de Experiência do Cliente"

const triggerPanel: DemoPanel = {
  title: "Gatilho",
  where: "Clique no nó Gatilho do canvas.",
  fields: [
    { label: "Tipo de gatilho", value: "Flag de canal", option: true },
    { label: "Flag do canal", value: "VOICE · nota_ura", hint: "A lista vem do catálogo de flags da Administração." },
  ],
}

const conditionPanel: DemoPanel = {
  title: "Condição",
  where: "Paleta › Decidir e esperar › Condição. O limite fica aqui, no campo \"Valor\".",
  fields: [
    { label: "Baseado em", value: "Valor do gatilho", option: true },
    { label: "Condição", value: COMPARATOR_LABELS.LTE, option: true },
    { label: "Valor", value: "2", illustrative: true, hint: "Limite só de exemplo: não é política oficial." },
  ],
}

const agentPanel: DemoPanel = {
  title: "Chamar agente",
  where: "Paleta › Analisar com IA › Chamar agente, ligado à saída \"Sim\" da Condição.",
  fields: [
    { label: "Tipo de ação", value: "Chamar agente", option: true },
    { label: "Agente", value: AGENT },
    { label: "Formato da análise", value: AGENT_OUTPUT_CONTRACT_LABELS.PROCESS_ASSESSMENT, option: true },
  ],
}

const feedbackPanel: DemoPanel = {
  title: "Gerar feedback",
  where: "Paleta › Analisar com IA › Gerar feedback, logo depois do agente.",
  fields: [
    { label: "Tipo de ação", value: "Gerar feedback", option: true },
    { label: "Origem", value: `Analisar a chamada — Agente: ${AGENT}`, hint: "A origem é escolhida por você: nunca é \"o nó anterior\" implícito." },
    { label: "Tipo", value: FEEDBACK_DOMAIN_LABELS.MONITORING, option: true },
  ],
}

const outputPanel: DemoPanel = {
  title: "Output",
  where: "Paleta › Entregar › Output.",
  fields: [
    { label: "Destinatário", value: "O próprio colaborador", option: true },
    { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
    { label: "Conteúdo a publicar", value: "Feedback confiável: Gerar feedback", hint: "Com gatilho por Flag, o Acompanhamento do colaborador só aceita o que passou por \"Gerar feedback\"." },
  ],
}

const FEEDBACK_VIEW: FeedbackView = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Dúvida sobre cobrança na fatura", subtitle: "Atendimento de hoje" },
  card: "O cliente saiu sem saber quando a cobrança seria revista.",
  greeting: "Caio, olhei o atendimento sobre a cobrança na fatura.",
  narrative: [
    "Você identificou a cobrança rapidamente e explicou o motivo com clareza. Esse cuidado continua valendo.",
    "O ponto a ajustar está no fechamento: o atendimento terminou sem dizer quando a revisão seria concluída, e o procedimento pede esse prazo. Informar o próximo passo evita que o cliente fique em dúvida depois de desligar.",
  ],
  developments: [
    {
      key: "prazo-de-retorno",
      title: "Informar o prazo da revisão",
      whatHappened: "A revisão foi aberta, mas o cliente não recebeu o prazo de retorno.",
      call: { kind: "QUOTES", quotes: [{ speaker: "OPERATOR", intro: "No encerramento, você disse:", text: "Pronto, já abri a revisão aqui. Mais alguma coisa?", truncated: false }] },
      adjustment: ["Depois de abrir a revisão, diga o prazo e como o cliente será avisado."],
      guidance: { rules: [{ text: "Informar prazo e canal de retorno ao registrar uma revisão de cobrança.", section: "Encerramento" }], avoid: [], examples: [] },
      sources: [{ documentId: "documento-ficticio", documentTitle: "Procedimento de revisão de cobrança (fictício)", section: "Encerramento", href: null }],
      whyItMatters: ["Sem o prazo, o cliente tende a ligar de novo para saber o andamento."],
      howToApply: null,
      suggestedResponse: "A revisão está aberta e o retorno sai em até 5 dias úteis, por SMS.",
      itemIndexes: [0],
    },
  ],
  maintain: null,
  attention: [],
  materials: [],
  context: "A nota do cliente foi o motivo da análise. Ela sozinha não diz o que aconteceu: a conversa é que sustenta o que está aqui.",
  kind: "MONITORING",
}

const scenes: DemoScene[] = [
  {
    id: "gatilho-baixa",
    nodeId: "gatilho",
    title: "Chega uma nota de uma chamada",
    summary: "A nota vem junto com a interação, como flag numérica. Cada chamada avaliada inicia uma execução, sempre para o operador daquela chamada.",
    panel: triggerPanel,
    input: ["Chamada do Caio sobre cobrança, com nota_ura = 2 (fictício)."],
    output: ["Uma execução do Caio, com o valor 2 disponível para a Condição."],
    howTo: ["Crie o Workflow com o tipo de gatilho \"Flag de canal\".", "Em \"Flag do canal\", escolha VOICE · nota_ura."],
    shots: ["flag-nota-ura"],
    caution: "Esta nota é de UMA avaliação. A escala vem de quem envia o dado, então confirme se é de 1 a 5 ou de 0 a 10 antes de definir o limite. Reenviar a mesma nota da mesma chamada não abre outra execução.",
  },
  {
    id: "condicao-baixa",
    nodeId: "condicao",
    title: "2 é menor ou igual a 2: caminho Sim",
    summary: "A Condição compara o valor do gatilho com o limite. A regra é determinística: não usa IA nem decide sobre a pessoa, só escolhe o próximo passo.",
    panel: conditionPanel,
    input: ["Valor do gatilho: 2.", "Limite de exemplo: 2."],
    output: ["Saída Sim: segue para a análise da chamada."],
    howTo: ["Adicione uma Condição depois do Gatilho.", "\"Baseado em\": Valor do gatilho. \"Condição\": é menor ou igual a. \"Valor\": o limite da sua operação.", "Ligue as duas saídas: Sim e Não."],
    shots: ["condicao-nota-ura"],
    caution: "Aqui só existem Sim e Não. A saída \"Sem dados\" só aparece em Condições de indicador com agregação de valor. Sem nota, a flag não chega e o Workflow nem começa.",
  },
  {
    id: "analise",
    nodeId: "analise",
    title: "A nota aponta para a chamada; a análise busca o que aconteceu",
    summary: "O agente lê a transcrição contra o procedimento oficial, etapa a etapa. Uma nota baixa pode vir de prazo, sistema ou preço: é a conversa que mostra se há algo a orientar.",
    panel: agentPanel,
    input: ["Transcrição da chamada.", "Bases de conhecimento do agente."],
    output: ["Etapas avaliadas, com a fala literal e o trecho do procedimento.", "Nada foi entregue: isso ainda é análise."],
    howTo: ["Ligue \"Chamar agente\" à saída Sim.", "Escolha o agente e o \"Formato da análise\": Avaliação de processo (feedback com base)."],
    shots: ["agente-avaliacao-processo"],
  },
  {
    id: "feedback",
    nodeId: "feedback",
    title: "A análise vira uma orientação",
    summary: "\"Gerar feedback\" transforma a análise em mensagem e confere citações, regras e privacidade. Ele gera o conteúdo, mas não entrega nada.",
    panel: feedbackPanel,
    input: ["O resultado do agente."],
    output: ["Mensagem pronta para publicar, em tom de orientação e com a base citada."],
    howTo: ["Adicione \"Gerar feedback\" depois do agente.", "Escolha a Origem e o Tipo: Monitoria."],
    shots: ["gerar-feedback"],
  },
  {
    id: "entrega",
    nodeId: "entrega",
    title: "O Caio recebe a orientação no Acompanhamento",
    summary: "O Output publica a mensagem. A orientação começa pelo que deu certo, aponta o ajuste com a fala da chamada e sugere o que dizer, sem tratar a nota como culpa.",
    panel: outputPanel,
    input: ["A mensagem de \"Gerar feedback\"."],
    output: ["Feedback publicado, com o caso de supervisão e a evidência registrados."],
    preview: { kind: "feedback", audience: "O que o Caio vê no Acompanhamento", originLabel: "Nota da URA", title: "Dúvida sobre cobrança na fatura", when: "Atendimento de hoje", view: FEEDBACK_VIEW },
    howTo: ["Adicione o Output depois de \"Gerar feedback\".", "Destinatário: \"O próprio colaborador\". Onde entregar: \"Acompanhamento\".", "Em \"Conteúdo a publicar\", escolha \"Gerar feedback\"."],
    shots: ["output-feedback", "acompanhamento-colaborador"],
    caution: "Cada chamada recebe no máximo uma monitoria do motor. Se a mesma chamada já foi monitorada por outro Workflow, não há nova análise nem nova entrega.",
  },
  {
    id: "fim-baixa",
    nodeId: "fim",
    title: "Jornada concluída",
    summary: "A execução termina. O feedback fica no Acompanhamento até o Caio confirmar a ciência.",
    input: ["O caminho chegou ao fim."],
    output: ["Execução concluída, com o feedback contado em Resultados."],
    howTo: ["Ligue o Output a um nó Fim. Antes de publicar, teste no QA Lab: ele simula o caminho sem entregar nada."],
  },
  {
    id: "gatilho-boa",
    nodeId: "gatilho",
    title: "Chega uma nota de outra chamada",
    summary: "O gatilho não filtra por valor: toda nota recebida inicia uma execução. Quem decide o caminho é a Condição.",
    panel: triggerPanel,
    input: ["Chamada do Caio com nota_ura = 4 (fictício)."],
    output: ["Uma execução do Caio, com o valor 4 disponível para a Condição."],
    howTo: ["A configuração é a mesma do caminho anterior."],
    shots: ["flag-nota-ura"],
  },
  {
    id: "condicao-boa",
    nodeId: "condicao",
    title: "4 não é menor ou igual a 2: caminho Não",
    summary: "A nota está dentro do esperado neste exemplo. Nenhuma IA é acionada e nada é analisado.",
    panel: conditionPanel,
    input: ["Valor do gatilho: 4.", "Limite de exemplo: 2."],
    output: ["Saída Não: segue direto para o Fim."],
    howTo: ["Ligue a saída Não a um nó Fim, ou a outro caminho, se quiser reconhecer boas notas."],
    shots: ["condicao-nota-ura"],
  },
  {
    id: "fim-boa",
    nodeId: "fim",
    title: "Termina sem nenhuma mensagem",
    summary: "Nada chega ao Caio, e isso é o esperado. Este Workflow só orienta notas abaixo do limite. Para reconhecer bons resultados, veja o exemplo dos destaques do mês.",
    input: ["O caminho chegou ao fim."],
    output: ["Execução concluída, sem entrega."],
    preview: { kind: "nothing", title: "Nenhuma mensagem", text: "O Caio não recebe aviso nenhum sobre esta nota." },
    howTo: ["Confira em Execuções: o caminho percorrido fica registrado."],
  },
  {
    id: "feedback-abstem",
    nodeId: "feedback",
    title: "Sem evidência suficiente, não há orientação",
    summary: "Nota baixa não prova falha. Se a análise não sustenta nenhum ponto a orientar, \"Gerar feedback\" se abstém e encerra a execução com o motivo, sem esperar ninguém.",
    panel: feedbackPanel,
    input: ["Análise sem nada material: o atendimento seguiu o procedimento (fictício)."],
    output: ["Nenhuma mensagem. O motivo fica registrado na execução."],
    preview: {
      kind: "nothing",
      title: "O Caio não recebe uma orientação sem base",
      text: "Ele seguiu o procedimento e a nota ruim pode ter outra causa. O produto prefere não dizer nada a afirmar algo que a chamada não sustenta.",
    },
    howTo: ["Nada a configurar: o motor decide isso sozinho. O motivo aparece em Execuções e em Resultados."],
    stopsHere: "closed",
  },
]

export const NOTA_URA_BAIXA: DemoExample = {
  slug: "nota-ura-baixa",
  objective: "orientar",
  title: "Feedback por nota URA baixa",
  problem: "Um cliente deu nota baixa na pesquisa, e ninguém olha o que aconteceu naquela conversa.",
  whenToUse: "Quando uma única avaliação baixa já justifica olhar a chamada e, se houver base, orientar.",
  startsWith: "Flag VOICE · nota_ura, a cada chamada avaliada",
  recipient: "O próprio colaborador, no Acompanhamento",
  persona: { name: "Caio", role: "operador de atendimento (fictício)", need: "Um cliente respondeu a pesquisa com nota 2 depois de uma ligação sobre cobrança." },
  goal: "Entender o que aconteceu na chamada e, se houver base, orientar o Caio.",
  expectedResult: "Com nota abaixo do limite e evidência na chamada, uma orientação construtiva no Acompanhamento. Nos outros casos, nada é enviado.",
  brief: [
    { question: "Qual nota é considerada?", answer: "A flag VOICE · nota_ura: a nota de UMA chamada, respondida na URA ao final dela. A escala vem de quem envia o dado: confirme a da sua operação." },
    { question: "É uma avaliação ou um agregado?", answer: "Uma avaliação individual. O agregado existe como indicador, com outro caminho: veja a comparação logo abaixo." },
    { question: "Quando o fluxo começa?", answer: "Quando a interação chega com a flag. Sem resposta na pesquisa, a flag não chega e nada começa." },
    { question: "Onde configurar o limite?", answer: "Na Condição: \"Baseado em\" Valor do gatilho, \"Condição\" é menor ou igual a, \"Valor\" 2. O 2 é só um exemplo." },
    { question: "O que acontece abaixo do limite?", answer: "Saída Sim: o agente analisa a chamada, \"Gerar feedback\" escreve a orientação e o Output entrega." },
    { question: "E dentro do esperado?", answer: "Saída Não: a execução termina, sem IA e sem mensagem." },
    { question: "E sem dados?", answer: "Não existe saída \"Sem dados\" aqui: sem nota, o Workflow não começa. Dado ausente nunca vira desempenho ruim." },
    { question: "Como chega ao destinatário?", answer: "Pelo Output, no Acompanhamento do próprio colaborador, que pode confirmar a ciência." },
  ],
  scenarios: [
    { id: "baixa", label: "Nota abaixo do limite", description: "A nota é 2 e a chamada sustenta um ponto a orientar.", scenes: ["gatilho-baixa", "condicao-baixa", "analise", "feedback", "entrega", "fim-baixa"] },
    { id: "boa", label: "Nota dentro do esperado", description: "A nota é 4: nada é analisado nem enviado.", scenes: ["gatilho-boa", "condicao-boa", "fim-boa"] },
    { id: "sem-base", label: "Nota baixa, sem evidência", description: "A nota é 2, mas a chamada seguiu o procedimento: não há orientação.", scenes: ["gatilho-baixa", "condicao-baixa", "analise", "feedback-abstem"] },
  ],
  scenes: Object.fromEntries(scenes.map((scene) => [scene.id, scene])),
  mapLabels: { gatilho: "Chegou a nota", condicao: "Nota ≤ 2?", analise: "Analisar chamada", feedback: "Gerar feedback", entrega: "Entregar", fim: "Fim" },
}
