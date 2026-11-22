import { AGENT_OUTPUT_CONTRACT_LABELS, FEEDBACK_DOMAIN_LABELS, OUTPUT_SURFACE_LABELS, PERIOD_WINDOW_LABELS } from "@/schemas/admin/workflow-graph.schema"
import type { FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"

import type { DemoExample, DemoPanel, DemoScene } from "../demo-types"

const AGENT = "Especialista de Qualidade de Atendimento"

const triggerPanel: DemoPanel = {
  title: "Gatilho",
  where: "Clique no nó Gatilho do canvas ou abra Configurações do workflow › 2 Gatilho (é a mesma configuração).",
  fields: [
    { label: "Tipo de gatilho", value: "Por agenda", option: true },
    { label: "Modo da agenda", value: "Horário/calendário", option: true },
    { label: "Frequência", value: "Diariamente", option: true, hint: "Também dá para escolher a cada N dias, semanal ou mensal: é o ritmo da monitoria." },
    { label: "Horários", value: "09:00 e 15:00", illustrative: true, hint: "Cada horário é uma monitoria por pessoa. Um horário por vez, em \"Adicionar horário\"." },
    { label: "Alvo da avaliação", value: "Colaboradores individualmente", option: true },
    { label: "Quais colaboradores?", value: "Equipe de Supervisor", option: true, hint: "Cada pessoa da equipe tem a própria execução." },
  ],
}

const agentPanel: DemoPanel = {
  title: "Chamar agente",
  where: "Paleta › Analisar com IA › Chamar agente. No painel, role até \"Fonte de dados\": com gatilho por agenda ela é obrigatória.",
  fields: [
    { label: "Tipo de ação", value: "Chamar agente", option: true },
    { label: "Agente", value: AGENT },
    { label: "O que avaliar", value: "Amostra de chamadas (monitoria)", option: true },
    { label: "Período avaliado", value: PERIOD_WINDOW_LABELS.TODAY, option: true },
    { label: "Formato da análise", value: `Monitoria aleatória — ${AGENT_OUTPUT_CONTRACT_LABELS.PROCESS_ASSESSMENT}`, option: true, hint: "Já vem escolhido ao usar a amostra de chamadas. Cada execução sorteia UMA chamada." },
  ],
}

const feedbackPanel: DemoPanel = {
  title: "Gerar feedback",
  where: "Paleta › Analisar com IA › Gerar feedback, logo depois do agente.",
  fields: [
    { label: "Tipo de ação", value: "Gerar feedback", option: true },
    { label: "Origem", value: `Sortear e analisar uma chamada — Agente: ${AGENT}` },
    { label: "Tipo", value: FEEDBACK_DOMAIN_LABELS.MONITORING, option: true },
  ],
}

const outputPanel: DemoPanel = {
  title: "Output",
  where: "Paleta › Entregar › Output, ligado depois de \"Gerar feedback\".",
  fields: [
    { label: "Destinatário", value: "O próprio colaborador", option: true },
    { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
    { label: "Conteúdo a publicar", value: "Feedback confiável: Gerar feedback" },
  ],
}

const MORNING_VIEW: FeedbackView = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Segunda via da fatura", subtitle: "Atendimento de hoje" },
  card: "A conta foi consultada antes de confirmar quem estava na linha.",
  greeting: "Bianca, olhei um atendimento seu desta manhã, sobre a segunda via da fatura.",
  narrative: [
    "Você encontrou a fatura rápido e enviou a segunda via pelo canal que o cliente pediu.",
    "O ponto a ajustar está na abertura: a conta foi consultada antes de confirmar a identidade, e o procedimento pede essa confirmação primeiro.",
  ],
  developments: [
    {
      key: "confirmar-identidade",
      title: "Confirmar a identidade antes de consultar a conta",
      whatHappened: "O atendimento seguiu direto para a fatura, sem confirmar os dados de quem estava na linha.",
      call: { kind: "QUOTES", quotes: [{ speaker: "OPERATOR", intro: "Na abertura, você disse:", text: "Pode me passar o número da fatura, por favor?", truncated: false }] },
      adjustment: ["Antes de abrir a conta, confirme nome completo e CPF."],
      guidance: { rules: [{ text: "Confirmar a identidade do titular antes de consultar dados da conta.", section: "Abertura" }], avoid: [], examples: [] },
      sources: [{ documentId: "documento-ficticio", documentTitle: "Procedimento de abertura (fictício)", section: "Abertura", href: null }],
      whyItMatters: ["Protege o cliente: os dados da conta só podem ser informados ao titular."],
      howToApply: null,
      suggestedResponse: "Para sua segurança, posso confirmar seu nome completo e o CPF?",
      itemIndexes: [0],
    },
  ],
  maintain: null,
  attention: [],
  materials: [],
  context: "Chamada sorteada para a monitoria de qualidade do período: não foi escolhida por nenhum problema.",
  kind: "MONITORING",
}

const AFTERNOON_VIEW: FeedbackView = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "Ajuste de cobrança", subtitle: "Atendimento de hoje" },
  card: "Atendimento completo: abertura, solução e combinado de retorno.",
  greeting: "Bianca, olhei um atendimento seu desta tarde, sobre um ajuste de cobrança.",
  narrative: [
    "Este atendimento seguiu o procedimento do começo ao fim: você confirmou a identidade, explicou a cobrança e encerrou dizendo quando o ajuste aparece.",
    "Continue fazendo o combinado de retorno: é ele que evita a ligação de volta.",
  ],
  developments: [],
  maintain: {
    summary: "O que vale manter",
    evidence: [
      { title: "Combinado de retorno no encerramento", statement: "Você informou o prazo e onde o cliente vai ver o ajuste.", quotes: [{ speaker: "OPERATOR", intro: "No encerramento, você disse:", text: "O ajuste aparece na próxima fatura, em até 2 dias úteis.", truncated: false }], itemIndex: 0, phase: "CLOSING" },
    ],
  },
  attention: [],
  materials: [],
  context: "Chamada sorteada para a monitoria de qualidade do período. Atendimento sem ajuste também recebe retorno: o reconhecimento mostra o que manter.",
  kind: "MONITORING",
}

const triggerScene = (id: string, time: string, input: string): DemoScene => ({
  id,
  nodeId: "gatilho",
  title: `${time}: nasce uma execução só para este horário`,
  summary: `Cada horário da lista é um disparo próprio. Às ${time}, o agendador cria uma execução para cada colaborador elegível, e a da Bianca não depende do que aconteceu no outro horário.`,
  panel: triggerPanel,
  input: [input, "Bianca faz parte da população do Workflow."],
  output: [`Uma execução da Bianca, identificada pelo horário ${time}.`, "Duas execuções no dia, uma por horário, nunca a mesma execução continuada."],
  howTo: [
    "Em Administração › Atendimento com IA › Workflows, crie o Workflow e escolha o tipo de gatilho \"Por agenda\".",
    "Escolha a frequência (aqui, diariamente) e adicione os horários: 09:00 e depois 15:00. A prévia \"Próximas execuções\" mostra os dois.",
    "Em Configurações do workflow › Alvo da avaliação, deixe \"Colaboradores individualmente\" e, em População, escolha quem participa.",
  ],
  shots: ["agenda-dois-horarios"],
  caution:
    "Não troque o segundo horário por um Aguardar de 6 horas: a espera prenderia a mesma execução, e o momento da tarde passaria a depender do da manhã. Outro cuidado: publicar às 10:00 faz o horário das 09:00 de hoje rodar em até 1 minuto; o diálogo de Publicar mostra esse impacto antes de confirmar.",
})

const analysisScene = (id: string, time: string): DemoScene => ({
  id,
  nodeId: "analise",
  title: `Sorteio de uma chamada de hoje, até as ${time}`,
  summary: `Às ${time}, "Hoje" significa o dia até agora. O sorteio escolhe UMA chamada da Bianca entre as que dá para avaliar e a analisa pelo motor de feedback, como uma chamada que chegou por Flag: etapa a etapa, contra os processos da base.`,
  panel: agentPanel,
  input: [
    `Chamadas da Bianca hoje, até as ${time}: ${time === "09:00" ? "4" : "19"} (fictício).`,
    "Entram no sorteio só as que têm transcrição, que não são curtas (regra geral em Governança › Chamadas curtas) e que ainda não tiveram monitoria.",
  ],
  output: ["A análise da chamada sorteada, gravada na memória do motor.", "Nada foi entregue ainda: o feedback é escrito no passo seguinte."],
  howTo: [
    "Adicione \"Chamar agente\" depois do Gatilho e escolha o agente.",
    "Em Fonte de dados › O que avaliar, escolha \"Amostra de chamadas (monitoria)\". O \"Formato da análise\" já vem como monitoria aleatória.",
    "Escolha o \"Período avaliado\".",
  ],
  caution:
    "O sorteio não olha o resultado da chamada: é por isso que ele mostra o dia a dia real, e não só os problemas. A chamada analisada às 09:00 não volta às 15:00, porque cada chamada recebe uma monitoria só.",
})

const feedbackScene = (id: string, time: string): DemoScene => ({
  id,
  nodeId: "feedback",
  title: time === "09:00" ? "A análise vira orientação" : "Atendimento correto também tem retorno",
  summary:
    time === "09:00"
      ? "\"Gerar feedback\" transforma a análise em mensagem e confere citações, regras e privacidade. Ele gera o conteúdo, mas não entrega nada."
      : "Na chamada da tarde não há o que ajustar. O feedback sai mesmo assim, como reconhecimento: mostra à Bianca o que ela fez certo, com a fala da própria chamada.",
  panel: feedbackPanel,
  input: ["A análise da chamada sorteada."],
  output: [time === "09:00" ? "Mensagem pronta para publicar, com o ajuste e a base citada." : "Mensagem de reconhecimento pronta para publicar."],
  howTo: ["Adicione \"Gerar feedback\" depois do agente.", "Escolha a Origem (o agente) e o Tipo: Monitoria."],
  shots: ["gerar-feedback"],
})

const deliveryScene = (id: string, time: string): DemoScene => ({
  id,
  nodeId: "entrega",
  title: `Feedback das ${time} no Acompanhamento`,
  summary: "O Output é a única etapa que torna o resultado visível para alguém. Aqui, publica o feedback no Acompanhamento da própria Bianca.",
  panel: outputPanel,
  input: ["A mensagem de \"Gerar feedback\"."],
  output: ["Feedback publicado para a Bianca, com o caso de supervisão e a evidência registrados."],
  preview: {
    kind: "feedback",
    audience: "O que a Bianca vê no Acompanhamento",
    originLabel: "Monitoria aleatória",
    title: time === "09:00" ? "Segunda via da fatura" : "Ajuste de cobrança",
    when: `Atendimento de hoje, antes das ${time}`,
    timestamp: `Hoje, ${time.slice(0, 2)}:04`,
    view: time === "09:00" ? MORNING_VIEW : AFTERNOON_VIEW,
  },
  howTo: ["Adicione o Output depois de \"Gerar feedback\".", "Destinatário: \"O próprio colaborador\". Onde entregar: \"Acompanhamento\".", "Em \"Conteúdo a publicar\", escolha \"Gerar feedback\"."],
  shots: ["output-feedback"],
})

const endScene = (id: string, time: string): DemoScene => ({
  id,
  nodeId: "fim",
  title: `A execução das ${time} termina aqui`,
  summary: time === "09:00" ? "Termina só a execução da manhã. Às 15:00 nasce outra, do zero, com o próprio sorteio." : "A execução da tarde termina sem depender da manhã. Amanhã, o relógio dispara os dois horários de novo.",
  input: ["O caminho chegou ao fim."],
  output: ["Execução concluída, visível em Execuções e em Resultados."],
  howTo: ["Ligue o Output a um nó Fim. Toda saída precisa estar ligada para publicar."],
})

const scenes: DemoScene[] = [
  triggerScene("gatilho-09", "09:00", "São 09:00 no fuso da organização."),
  analysisScene("analise-09", "09:00"),
  feedbackScene("feedback-09", "09:00"),
  deliveryScene("entrega-09", "09:00"),
  endScene("fim-09", "09:00"),
  triggerScene("gatilho-15", "15:00", "São 15:00 no fuso da organização."),
  analysisScene("analise-15", "15:00"),
  feedbackScene("feedback-15", "15:00"),
  deliveryScene("entrega-15", "15:00"),
  endScene("fim-15", "15:00"),
  {
    ...triggerScene("gatilho-15-vazio", "15:00", "São 15:00, mas a Bianca entrou de folga hoje (fictício)."),
    summary: "O disparo acontece mesmo assim: o gatilho olha o relógio e a população, não a produção do dia. Só no passo seguinte se descobre que não há o que sortear.",
  },
  {
    id: "analise-vazia",
    nodeId: "analise",
    title: "Sem chamada para sortear, não há análise",
    summary: "O sorteio não encontra nenhuma chamada da Bianca hoje que dê para avaliar. Nenhuma IA é consumida: a etapa só registra que não havia chamada.",
    panel: agentPanel,
    input: ["Chamadas da Bianca hoje: 0 (fictício)."],
    output: ["\"Nenhuma chamada sorteada\", com o motivo: nenhuma chamada no período, ou todas já monitoradas."],
    howTo: ["A configuração é a mesma: o que muda são os dados do dia."],
  },
  {
    id: "sem-feedback",
    nodeId: "feedback",
    title: "Dois horários não garantem duas entregas",
    summary: "Sem chamada sorteada, \"Gerar feedback\" não escreve nada e a execução termina ali. Falta de chamada não é desempenho ruim, e a Bianca não recebe nada a respeito.",
    panel: feedbackPanel,
    input: ["Nenhuma chamada analisada."],
    output: ["Nada entregue. Em Resultados, o motivo aparece como \"Monitoria aleatória sem chamada para sortear no período\"."],
    preview: {
      kind: "nothing",
      title: "A Bianca não recebe nada neste horário",
      text: "O feedback da manhã continua no Acompanhamento. O da tarde simplesmente não existe hoje.",
      adminNote: "Quem administra vê em Resultados que não houve chamada para sortear, com o detalhe do motivo.",
    },
    howTo: ["Confira esse registro na aba Resultados do Workflow. Ele indica falta de chamada, não um erro de configuração."],
    stopsHere: "closed",
  },
]

export const DOIS_MOMENTOS_DO_DIA: DemoExample = {
  slug: "dois-momentos-do-dia",
  objective: "orientar",
  title: "Monitoria aleatória em dois momentos do dia",
  problem: "A orientação chega no dia seguinte, quando já não dá para ajustar o atendimento do dia, e só aparece quando algo deu errado.",
  whenToUse: "Rotina de monitoria de qualidade: um feedback por pessoa em horários fixos, com chamadas sorteadas, inclusive as que deram certo.",
  startsWith: "Agenda diária, às 09:00 e às 15:00",
  recipient: "O próprio colaborador, no Acompanhamento",
  persona: { name: "Bianca", role: "operadora de atendimento (fictícia)", need: "\"Quero um retorno pela manhã e outro à tarde, para ajustar o atendimento no mesmo dia e saber o que estou fazendo bem.\"" },
  goal: "Levar à Bianca, duas vezes ao dia, o feedback oficial de monitoria sobre uma chamada dela sorteada no período.",
  expectedResult: "Até dois feedbacks por dia. Até dois, e não sempre dois: sem chamada que dê para avaliar no período, aquele horário não entrega nada.",
  brief: [
    { question: "Quem participa e como definir a abrangência?", answer: "Colaboradores da Abrangência do Workflow, filtrados em População (\"Quais colaboradores?\"). Cada pessoa tem a própria execução." },
    { question: "Quando o fluxo começa?", answer: "Duas vezes por dia, às 09:00 e às 15:00, no fuso da organização. Cada horário é um disparo independente e uma monitoria por pessoa." },
    { question: "De onde vêm os dados e qual período?", answer: "Da fonte \"Amostra de chamadas (monitoria)\", com período \"Hoje\": uma chamada sorteada entre as de hoje até o momento do disparo." },
    { question: "Quais chamadas podem ser sorteadas?", answer: "As que têm transcrição, que não são curtas (regra geral da organização, em Governança) e que ainda não tiveram monitoria." },
    { question: "Como a análise vira orientação?", answer: "O motor de feedback avalia a chamada contra os processos da base, e \"Gerar feedback\" escreve a mensagem com as falas literais da chamada." },
    { question: "E se a chamada estiver perfeita?", answer: "O feedback sai como reconhecimento: mostra o que vale manter. A monitoria aleatória existe para o dia a dia, não só para os erros." },
    { question: "Quais desfechos alternativos existem?", answer: "Horário sem chamada que dê para avaliar: nada é entregue, e Resultados mostra o motivo." },
  ],
  support: {
    title: "O que o produto permite hoje",
    intro: "Monitoria aleatória por agenda com o feedback oficial do motor: a frequência é a do gatilho e cada execução sorteia uma chamada por pessoa.",
    works: [
      "Vários horários no mesmo gatilho \"Por agenda\", e frequência diária, a cada N dias, semanal ou mensal.",
      "\"Chamar agente\" com \"Amostra de chamadas\" sorteando uma chamada e analisando pelo motor de feedback.",
      "\"Gerar feedback\" de monitoria a partir da chamada sorteada, com reconhecimento quando não há o que ajustar.",
    ],
    limits: [
      "Uma chamada por execução: para mais monitorias, aumente a frequência ou os horários do gatilho.",
      "Só no modo Individual (sem Estrutura Consolidada).",
      "O \"Orquestrador\" ainda não sorteia chamadas: a monitoria aleatória é do \"Chamar agente\".",
    ],
    alternative: "Quer analisar uma chamada por um sinal dela (nota baixa, rechamada)? Use o gatilho por Flag, como no exemplo da nota URA. Expedientes diferentes? \"Relativo ao expediente\" calcula o horário de cada pessoa, mas guarda um momento só por Workflow: dois momentos pedem dois Workflows.",
  },
  scenarios: [
    { id: "manha", label: "Disparo das 09:00", description: "Chamada sorteada com um ponto a ajustar: o feedback da manhã chega.", scenes: ["gatilho-09", "analise-09", "feedback-09", "entrega-09", "fim-09"] },
    { id: "tarde", label: "Disparo das 15:00", description: "Outra execução, outro sorteio, chamada correta: chega um reconhecimento.", scenes: ["gatilho-15", "analise-15", "feedback-15", "entrega-15", "fim-15"] },
    { id: "sem-dados", label: "Sem chamada no horário", description: "O disparo acontece, mas não há chamada para sortear e nada é entregue.", scenes: ["gatilho-15-vazio", "analise-vazia", "sem-feedback"] },
  ],
  scenes: Object.fromEntries(scenes.map((scene) => [scene.id, scene])),
  mapLabels: { gatilho: "09:00 e 15:00", analise: "Sortear e analisar", feedback: "Gerar feedback", entrega: "Entregar", fim: "Fim" },
}
