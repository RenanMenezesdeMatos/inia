import { OUTPUT_SURFACE_LABELS, PERIOD_WINDOW_LABELS } from "@/schemas/admin/workflow-graph.schema"

import type { DemoExample, DemoPanel, DemoScene } from "../demo-types"

const AGENT = "Especialista de Qualidade de Atendimento"

const triggerPanel: DemoPanel = {
  title: "Gatilho",
  where: "Clique no nó Gatilho do canvas ou abra Configurações do workflow › 2 Gatilho (é a mesma configuração).",
  fields: [
    { label: "Tipo de gatilho", value: "Por agenda", option: true },
    { label: "Modo da agenda", value: "Horário/calendário", option: true },
    { label: "Frequência", value: "Diariamente", option: true },
    { label: "Horários", value: "09:00 e 15:00", illustrative: true, hint: "Um horário por vez, em \"Adicionar horário\"." },
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
    { label: "Quantas chamadas amostrar", value: "1", illustrative: true, hint: "O campo aceita de 1 a 10 e já vem com 2. Aqui, 1: veja o cuidado abaixo." },
    { label: "Período avaliado", value: PERIOD_WINDOW_LABELS.TODAY, option: true },
  ],
}

const outputPanel: DemoPanel = {
  title: "Output",
  where: "Paleta › Entregar › Output, ligado depois do \"Chamar agente\".",
  fields: [
    { label: "Destinatário", value: "O próprio colaborador", option: true },
    { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
    { label: "Conteúdo a publicar", value: `Resultado de: ${AGENT}`, hint: "No Acompanhamento do próprio colaborador, o resultado vai inteiro." },
  ],
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
    "Em \"Horários\", adicione 09:00 e depois 15:00. A prévia \"Próximas execuções\" mostra os dois.",
    "Em Configurações do workflow › Alvo da avaliação, deixe \"Colaboradores individualmente\" e, em População, escolha quem participa.",
  ],
  shots: ["agenda-dois-horarios"],
  caution:
    "Não troque o segundo horário por um Aguardar de 6 horas: a espera prenderia a mesma execução, e o momento da tarde passaria a depender do da manhã. Outro cuidado: publicar às 10:00 faz o horário das 09:00 de hoje rodar em até 1 minuto; o diálogo de Publicar mostra esse impacto antes de confirmar.",
})

const analysisScene = (id: string, time: string): DemoScene => ({
  id,
  nodeId: "analise",
  title: `Período avaliado: de 00:00 até as ${time}`,
  summary: `O momento do disparo é uma coisa; o período analisado é outra. Às ${time}, "Hoje" significa o dia até agora. O agente sorteia uma chamada da Bianca nesse período e a analisa contra a transcrição.`,
  panel: agentPanel,
  input: [`Chamadas da Bianca hoje, até as ${time}: ${time === "09:00" ? "4" : "19"} (fictício).`, "A transcrição da chamada sorteada."],
  output: ["O resultado do agente: evidência citada literalmente, comportamento, procedimento e recomendação.", "Nada foi entregue ainda: quem entrega é o Output."],
  howTo: [
    "Adicione \"Chamar agente\" depois do Gatilho e escolha o agente.",
    "Em Fonte de dados › O que avaliar, escolha \"Amostra de chamadas (monitoria)\".",
    "Ajuste \"Quantas chamadas amostrar\" e \"Período avaliado\".",
  ],
  shots: ["agente-amostra-monitoria"],
  caution:
    "A amostra é sorteada de novo em cada execução, então a chamada das 09:00 pode voltar às 15:00. E com mais de uma chamada o agente analisa todas, mas só o resultado da última segue para o Output: cada chamada a mais custa uma análise de IA sem gerar outra entrega.",
})

const deliveryScene = (id: string, time: string, evidence: string, recommendation: string): DemoScene => ({
  id,
  nodeId: "entrega",
  title: `Orientação das ${time} no Acompanhamento`,
  summary: "O Output é a única etapa que torna o resultado visível para alguém. Aqui, publica um feedback no Acompanhamento da própria Bianca.",
  panel: outputPanel,
  input: ["O resultado do agente desta execução."],
  output: ["Um feedback publicado para a Bianca, com a evidência registrada em um caso de supervisão."],
  preview: {
    kind: "agent-feedback",
    audience: "O que a Bianca vê no Acompanhamento",
    originLabel: "Monitoria",
    title: time === "09:00" ? "Confirmação de dados na abertura" : "Combinado de retorno com o cliente",
    when: `Atendimento de hoje, antes das ${time}`,
    timestamp: `Hoje, ${time.slice(0, 2)}:02`,
    evidence,
    behavior: time === "09:00" ? "O atendimento seguiu direto para o pedido, sem confirmar os dados de quem estava na linha." : "A solução foi explicada, mas o atendimento terminou sem dizer quando o cliente teria retorno.",
    procedure: time === "09:00" ? "Procedimento de abertura: confirmar a identidade antes de consultar a conta (fictício)." : "Procedimento de encerramento: informar prazo e próximo passo (fictício).",
    recommendation,
  },
  howTo: ["Adicione o Output depois do \"Chamar agente\".", "Destinatário: \"O próprio colaborador\". Onde entregar: \"Acompanhamento\".", "Em \"Conteúdo a publicar\", escolha o resultado do agente."],
  shots: ["output-acompanhamento"],
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
  deliveryScene(
    "entrega-09",
    "09:00",
    "\"Pode me passar o número da fatura, por favor?\" (transcrição fictícia)",
    "Antes de consultar a conta, confirme nome e CPF: \"Para sua segurança, posso confirmar seu nome completo?\" Vale testar já nos próximos atendimentos da manhã.",
  ),
  endScene("fim-09", "09:00"),
  triggerScene("gatilho-15", "15:00", "São 15:00 no fuso da organização."),
  analysisScene("analise-15", "15:00"),
  deliveryScene(
    "entrega-15",
    "15:00",
    "\"Pronto, já resolvi aqui. Mais alguma coisa?\" (transcrição fictícia)",
    "Ao encerrar, diga o que acontece depois: \"O ajuste aparece na próxima fatura, em até 2 dias úteis.\" Vale aplicar nos atendimentos de hoje à tarde.",
  ),
  endScene("fim-15", "15:00"),
  {
    ...triggerScene("gatilho-15-vazio", "15:00", "São 15:00, mas a Bianca entrou de folga hoje (fictício)."),
    summary: "O disparo acontece mesmo assim: o gatilho olha o relógio e a população, não a produção do dia. Só no passo seguinte se descobre que não há o que analisar.",
  },
  {
    id: "analise-vazia",
    nodeId: "analise",
    title: "Sem chamada no período, não há análise",
    summary: "O sorteio não encontra nenhuma chamada da Bianca hoje. O agente não é acionado, nenhuma IA é consumida e esta etapa termina sem resultado.",
    panel: agentPanel,
    input: ["Chamadas da Bianca hoje: 0 (fictício)."],
    output: ["Nenhum conteúdo para entregar."],
    howTo: ["A configuração é a mesma: o que muda são os dados do dia. Esta configuração não tem uma saída \"Sem dados\": ela só existe em Condições de indicador."],
    shots: ["agente-amostra-monitoria"],
  },
  {
    id: "sem-entrega",
    nodeId: "entrega",
    title: "Dois horários não garantem duas entregas",
    summary: "O Output não encontra conteúdo e não entrega uma mensagem vazia: a execução é encerrada. Falta de chamada não é desempenho ruim, e a Bianca não recebe nada a respeito.",
    panel: outputPanel,
    input: ["Nenhum conteúdo vindo do agente."],
    output: ["Nada entregue. A execução aparece em Execuções como encerrada com falha, sem efeito para a pessoa."],
    preview: {
      kind: "nothing",
      title: "A Bianca não recebe nada neste horário",
      text: "A orientação da manhã continua no Acompanhamento. A da tarde simplesmente não existe hoje.",
      adminNote: "Quem administra vê em Execuções: \"Execução encerrada com falha. O conteúdo de Orientação ao colaborador não está disponível. Nada foi entregue.\"",
    },
    howTo: ["Confira esse registro na aba Execuções do Workflow. Ele indica falta de conteúdo, não um erro de configuração."],
    stopsHere: "failed",
  },
]

export const DOIS_MOMENTOS_DO_DIA: DemoExample = {
  slug: "dois-momentos-do-dia",
  objective: "orientar",
  title: "Orientação em dois momentos do dia",
  problem: "A orientação chega no dia seguinte, quando já não dá para ajustar o atendimento do dia.",
  whenToUse: "Rotina diária em horários fixos, em que analisar uma amostra de chamadas já ajuda.",
  startsWith: "Agenda diária, às 09:00 e às 15:00",
  recipient: "O próprio colaborador, no Acompanhamento",
  persona: { name: "Bianca", role: "operadora de atendimento (fictícia)", need: "\"Quero uma orientação pela manhã e outra à tarde, para ajustar o atendimento no mesmo dia.\"" },
  goal: "Levar à Bianca, duas vezes ao dia, uma orientação baseada em uma chamada dela.",
  expectedResult: "Até duas orientações por dia. Até duas, e não sempre duas: sem chamada no período, aquele horário não entrega nada.",
  brief: [
    { question: "Quem participa e como definir a abrangência?", answer: "Colaboradores da Abrangência do Workflow, filtrados em População (\"Quais colaboradores?\"). Cada pessoa tem a própria execução." },
    { question: "Quando o fluxo começa?", answer: "Duas vezes por dia, às 09:00 e às 15:00, no fuso da organização. Cada horário é um disparo independente." },
    { question: "De onde vêm os dados e qual período?", answer: "Da fonte \"Amostra de chamadas (monitoria)\", com período \"Hoje\": do início do dia até o momento do disparo." },
    { question: "Como as condições determinam o caminho?", answer: "Este exemplo não tem Condição. Quem decide se há entrega são os dados: sem chamada no período, não há conteúdo." },
    { question: "Como a análise vira orientação?", answer: "O próprio agente devolve evidência, comportamento, procedimento e recomendação, e a evidência precisa ser uma citação literal da transcrição." },
    { question: "Como chega ao colaborador?", answer: "Pelo Output, como feedback no Acompanhamento dele." },
    { question: "Quais desfechos alternativos existem?", answer: "Horário sem chamada: nada é entregue e a execução fica registrada como encerrada com falha." },
  ],
  support: {
    title: "O que o produto permite hoje",
    intro: "O pedido original era gerar o feedback oficial de monitoria duas vezes ao dia, por agenda. Os dois horários existem, mas essa combinação exata não é aceita. O exemplo usa o caminho que publica de verdade.",
    works: [
      "Vários horários no mesmo gatilho \"Por agenda\", cada um com execuções próprias.",
      "\"Chamar agente\" com a fonte \"Amostra de chamadas (monitoria)\" numa agenda.",
      "Publicar o resultado do agente no Acompanhamento do próprio colaborador, com a evidência literal conferida.",
    ],
    limits: [
      "\"Gerar feedback\" do tipo Monitoria não publica com Agenda: ele precisa da interação do gatilho (Flag de canal ou Manual com interação).",
      "O formato \"Avaliação de processo\" também exige essa interação. Com Agenda, a etapa não passa pelo motor de feedback.",
      "A amostra é sorteada a cada execução, sem controle de quais chamadas já foram analisadas, e não há saída \"sem chamadas\" neste caminho.",
    ],
    alternative: "Precisa do motor de feedback? Use um gatilho por chamada, como no exemplo da nota URA. Expedientes diferentes? \"Relativo ao expediente\" calcula o horário de cada pessoa, mas guarda um momento só por Workflow: dois momentos pedem dois Workflows.",
  },
  scenarios: [
    { id: "manha", label: "Disparo das 09:00", description: "Com chamadas no período: a orientação da manhã chega.", scenes: ["gatilho-09", "analise-09", "entrega-09", "fim-09"] },
    { id: "tarde", label: "Disparo das 15:00", description: "Outra execução, com outro sorteio: a orientação da tarde chega.", scenes: ["gatilho-15", "analise-15", "entrega-15", "fim-15"] },
    { id: "sem-dados", label: "Sem dados no horário", description: "O disparo acontece, mas não há chamada no período e nada é entregue.", scenes: ["gatilho-15-vazio", "analise-vazia", "sem-entrega"] },
  ],
  scenes: Object.fromEntries(scenes.map((scene) => [scene.id, scene])),
  mapLabels: { gatilho: "09:00 e 15:00", analise: "Analisar chamada", entrega: "Entregar", fim: "Fim" },
}
