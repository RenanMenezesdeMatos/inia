import { COMPARATOR_LABELS, ESCALATION_ROLE_LABELS, FEEDBACK_DOMAIN_LABELS, HISTORICAL_AGGREGATION_LABELS, HISTORICAL_COMPARE_TO_LABELS, INDICATOR_OUTPUT_CONTRACT_LABELS, OUTPUT_SURFACE_LABELS, OUTPUT_TARGET_LABELS } from "@/schemas/admin/workflow-graph.schema"
import type { FeedbackView } from "@/schemas/feedbacks/feedback-view.schema"

import type { DemoExample, DemoPanel, DemoScene } from "../demo-types"

const AGENT = "Especialista de Eficiência Operacional"

const triggerPanel: DemoPanel = {
  title: "Gatilho",
  where: "Clique no nó Gatilho do canvas.",
  fields: [
    { label: "Tipo de gatilho", value: "Indicador", option: true },
    { label: "Indicador", value: "TMA", hint: "A lista vem do catálogo de indicadores." },
  ],
}

const conditionPanel = (title: string): DemoPanel => ({
  title,
  where: "Paleta › Decidir e esperar › Condição.",
  fields: [
    { label: "Baseado em", value: "Indicador / PRV", option: true },
    { label: "O que deseja analisar?", value: "Valor do indicador", option: true },
    { label: "Indicador", value: "TMA" },
    { label: "Analisar", value: HISTORICAL_AGGREGATION_LABELS.WEIGHTED_AVERAGE, option: true, hint: "O editor só oferece o que faz sentido para este indicador." },
    { label: "Período", value: "Últimos X dias", option: true },
    { label: "Quantidade de dias", value: "7", illustrative: true },
    { label: "Referência da comparação", value: HISTORICAL_COMPARE_TO_LABELS.GOAL, option: true, hint: "A meta é lida na hora da execução, nunca digitada aqui." },
    { label: "Média ponderada", value: COMPARATOR_LABELS.GT, option: true },
  ],
})

const agentPanel: DemoPanel = {
  title: "Chamar agente",
  where: "Paleta › Analisar com IA › Chamar agente, na saída \"Sim\".",
  fields: [
    { label: "Tipo de ação", value: "Chamar agente", option: true },
    { label: "Agente", value: AGENT },
    { label: "Formato da análise", value: INDICATOR_OUTPUT_CONTRACT_LABELS.FEEDBACK, option: true, hint: "Com estratégia publicada no indicador, \"Diagnóstico do indicador (feedback com base)\" investiga as chamadas." },
  ],
}

const feedbackPanel: DemoPanel = {
  title: "Gerar feedback",
  where: "Paleta › Analisar com IA › Gerar feedback.",
  fields: [
    { label: "Tipo de ação", value: "Gerar feedback", option: true },
    { label: "Origem", value: `Analisar o indicador — Agente: ${AGENT}` },
    { label: "Tipo", value: FEEDBACK_DOMAIN_LABELS.INDICATOR, option: true },
  ],
}

const outputPanel: DemoPanel = {
  title: "Output",
  where: "Paleta › Entregar › Output.",
  fields: [
    { label: "Destinatário", value: "O próprio colaborador", option: true },
    { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.FOLLOW_UP, option: true },
    { label: "Conteúdo a publicar", value: "Feedback confiável: Gerar feedback" },
  ],
}

const waitPanel: DemoPanel = {
  title: "Aguardar",
  where: "Paleta › Decidir e esperar › Aguardar.",
  fields: [
    { label: "Duração", value: "7", illustrative: true },
    { label: "Unidade", value: "Dias", option: true },
  ],
}

const escalatePanel: DemoPanel = {
  title: "Escalonar",
  where: "Paleta › Entregar › Escalonar, na saída \"Sim\" da reavaliação.",
  fields: [
    { label: "Destino", value: "Cargo relativo ao operador", option: true },
    { label: "Cargo", value: ESCALATION_ROLE_LABELS.SUPERVISOR, option: true },
    { label: "Conteúdo a escalonar (opcional)", value: "Feedback confiável: Gerar feedback" },
    { label: "Onde entregar", value: `${OUTPUT_SURFACE_LABELS.FOLLOW_UP} e ${OUTPUT_SURFACE_LABELS.NOTIFICATION}` },
    { label: "Motivo (opcional)", value: "O TMA seguiu acima da meta 7 dias depois da orientação." },
    { label: "Após escalonar", value: "Encerrar este branch", option: true },
  ],
}

const variablePanel: DemoPanel = {
  title: "Definir variável",
  where: "Paleta › Organizar › Definir variável. A variável é criada no próprio painel do Workflow.",
  fields: [
    { label: "Variável", value: "Recado de evolução" },
    { label: "Origem do valor", value: "Valor fixo", option: true },
    { label: "Valor", value: "O TMA voltou para a meta depois da orientação. Vale reconhecer a evolução." },
  ],
}

const recognitionPanel: DemoPanel = {
  title: "Output",
  where: "Paleta › Entregar › Output.",
  fields: [
    { label: "Destinatário", value: OUTPUT_TARGET_LABELS.SUPERVISOR_OF_OPERATOR, option: true },
    { label: "Onde entregar", value: OUTPUT_SURFACE_LABELS.NOTIFICATION, option: true },
    { label: "Conteúdo a publicar", value: "Variável: Recado de evolução" },
  ],
}

const VIEW: FeedbackView = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "TMA", subtitle: "Últimos 7 dias" },
  card: "O TMA dos últimos 7 dias ficou acima da meta.",
  greeting: "Dora, este é o seu TMA da última semana.",
  narrative: [
    "Nos últimos 7 dias, seu TMA ficou em 7min10s, e a meta do seu grupo é 6min (valores fictícios).",
    "O número mostra o que aconteceu, mas não explica o porquê. Se algo nos atendimentos desta semana fugiu do habitual, vale comentar com a sua liderança.",
  ],
  developments: [],
  maintain: null,
  attention: [],
  materials: [],
  context: null,
  kind: "INDICATOR",
}

const scenes: DemoScene[] = [
  {
    id: "gatilho",
    nodeId: "gatilho",
    title: "Chega uma nova medição de TMA",
    summary: "O gatilho por Indicador começa a cada medição nova do colaborador. O momento é o da chegada do dado, e o período analisado é definido depois, na Condição.",
    panel: triggerPanel,
    input: ["Nova medição de TMA da Dora (fictício)."],
    output: ["Uma execução da Dora, com a medição disponível para as etapas seguintes."],
    howTo: ["Crie o Workflow com o tipo de gatilho \"Indicador\" e escolha o TMA."],
    shots: ["gatilho-indicador"],
    caution: "Se as medições são diárias, cada dia inicia uma execução. O feedback do mesmo indicador e período não é repetido, mas as execuções em espera se acumulam. Uma Agenda semanal pode ser mais simples.",
  },
  {
    id: "fora-sim",
    nodeId: "fora-da-meta",
    title: "A média de 7 dias está acima da meta: caminho Sim",
    summary: "A Condição não olha só a medição do dia: calcula a média ponderada dos últimos 7 dias e compara com a meta vigente do grupo.",
    panel: conditionPanel("Condição"),
    input: ["TMA dos últimos 7 dias: 7min10s (fictício).", "Meta vigente: 6min (fictícia)."],
    output: ["Saída Sim: segue para a análise."],
    howTo: ["Em \"Baseado em\", escolha Indicador / PRV.", "Escolha o indicador, \"Analisar\" e o período.", "Em \"Referência da comparação\", escolha Meta vigente.", "Ligue as três saídas: Sim, Não e Sem dados."],
    shots: ["condicao-indicador"],
  },
  {
    id: "analise",
    nodeId: "analise",
    title: "O agente lê o resultado oficial",
    summary: "Neste formato, o feedback fica no resultado oficial do período. Para orientar sobre o comportamento, é preciso o diagnóstico do indicador, que investiga as chamadas.",
    panel: agentPanel,
    input: ["A medição e os dados oficiais do indicador."],
    output: ["O resultado do agente."],
    howTo: ["Ligue \"Chamar agente\" à saída Sim e escolha o \"Formato da análise\"."],
    shots: ["agente-indicador"],
  },
  {
    id: "feedback",
    nodeId: "feedback",
    title: "O resultado vira mensagem",
    summary: "\"Gerar feedback\" do tipo Indicador usa os dados oficiais do sistema (valor, meta e período) e valida o texto. Ele nunca diz que um comportamento causou o resultado.",
    panel: feedbackPanel,
    input: ["O resultado do agente."],
    output: ["Mensagem pronta para publicar."],
    howTo: ["Adicione \"Gerar feedback\" e escolha a Origem e o Tipo: Indicador."],
    shots: ["gerar-feedback-indicador"],
  },
  {
    id: "entrega",
    nodeId: "entrega",
    title: "A Dora vê o resultado e o contexto",
    summary: "O Output entrega no Acompanhamento. A jornada não termina aqui: ainda vai olhar a evolução.",
    panel: outputPanel,
    input: ["A mensagem de \"Gerar feedback\"."],
    output: ["Feedback publicado."],
    preview: { kind: "feedback", audience: "O que a Dora vê no Acompanhamento", originLabel: "TMA", title: "TMA", when: "Últimos 7 dias", view: VIEW },
    howTo: ["Adicione o Output, com o destinatário \"O próprio colaborador\" e o conteúdo \"Gerar feedback\"."],
    shots: ["output-feedback"],
  },
  {
    id: "espera",
    nodeId: "espera",
    title: "A execução dorme por 7 dias",
    summary: "Aguardar é uma pausa de tempo fixo. O prazo fica gravado e sobrevive a um reinício. Não espera um evento nem uma pessoa: passado o prazo, retoma sozinho.",
    panel: waitPanel,
    input: ["O que a execução já produziu."],
    output: ["Nada novo: retoma com o mesmo contexto, 7 dias depois."],
    howTo: ["Adicione Aguardar depois do Output e informe a duração e a unidade."],
    shots: ["aguardar"],
    caution: "Use Aguardar quando o próximo passo depende do que esta execução já fez. Para rodar em horários fixos, use a Agenda.",
  },
  {
    id: "reavaliacao-melhorou",
    nodeId: "reavaliacao",
    title: "7 dias depois, a média voltou para a meta: caminho Não",
    summary: "A pergunta é \"ainda acima da meta?\". A resposta é não: a Dora evoluiu.",
    panel: conditionPanel("Condição (reavaliação)"),
    input: ["TMA dos últimos 7 dias: 5min50s (fictício).", "Meta vigente: 6min (fictícia)."],
    output: ["Saída Não: segue para o reconhecimento."],
    howTo: ["Repita a mesma consulta numa segunda Condição.", "Lembre-se: a saída Sim significa \"ainda fora\"."],
    shots: ["condicao-indicador"],
  },
  {
    id: "recado",
    nodeId: "recado",
    title: "Guardar o recado numa variável",
    summary: "Definir variável guarda um valor na memória desta execução, para usar depois. Aqui, o texto que o Supervisor vai receber.",
    panel: variablePanel,
    input: ["Um valor fixo, escrito no próprio nó."],
    output: ["A variável \"Recado de evolução\" preenchida nesta execução."],
    howTo: ["Crie a variável do tipo Texto.", "Adicione Definir variável, com \"Origem do valor\": Valor fixo."],
    shots: ["definir-variavel"],
    caution: "Variável é memória da execução, não um indicador. E não serve de conteúdo para o Acompanhamento do próprio colaborador.",
  },
  {
    id: "reconhecer",
    nodeId: "reconhecer",
    title: "O Supervisor fica sabendo da evolução",
    summary: "Um Output para a liderança, no sino. O reconhecimento é da liderança: o aviso abre espaço para ela elogiar a Dora.",
    panel: recognitionPanel,
    input: ["A variável \"Recado de evolução\"."],
    output: ["Um aviso no sino do Supervisor da Dora."],
    preview: { kind: "notice", audience: "O que o Supervisor vê no sino", family: "WORKFLOW_OUTPUT", originLabel: null, title: "Avisar o Supervisor da evolução", text: "O TMA voltou para a meta depois da orientação. Vale reconhecer a evolução.", surface: "Notificação" },
    howTo: ["Adicione o Output com o destinatário \"Supervisor do operador\" e \"Notificação\" em \"Onde entregar\".", "Em \"Conteúdo a publicar\", escolha a variável."],
    shots: ["output-lider"],
  },
  {
    id: "fim-melhorou",
    nodeId: "fim",
    title: "Jornada concluída",
    summary: "A Dora recebeu o dado, teve tempo de ajustar, e a liderança soube da evolução.",
    input: ["O caminho chegou ao fim."],
    output: ["Execução concluída."],
    howTo: ["Ligue o Output a um nó Fim."],
  },
  {
    id: "reavaliacao-seguiu",
    nodeId: "reavaliacao",
    title: "7 dias depois, a média segue acima da meta: caminho Sim",
    summary: "O resultado não mudou. Mesmo assim, ele não determina a resposta sozinho: quem olha a causa e a recorrência é a liderança, para onde o caso vai agora.",
    panel: conditionPanel("Condição (reavaliação)"),
    input: ["TMA dos últimos 7 dias: 7min (fictício).", "Meta vigente: 6min (fictícia)."],
    output: ["Saída Sim: encaminha ao Supervisor."],
    howTo: ["Repita a mesma consulta numa segunda Condição e ligue a saída Sim ao Escalonar."],
    shots: ["condicao-indicador"],
  },
  {
    id: "escalonar",
    nodeId: "escalonar",
    title: "O caso é encaminhado, sem esperar resposta",
    summary: "Escalonar passa o caso para alguém da hierarquia e o Workflow segue, ou encerra este caminho. Não aguarda decisão: quem para o fluxo é a Revisão humana.",
    panel: escalatePanel,
    input: ["A mensagem já gerada, como conteúdo."],
    output: ["Um escalonamento no Acompanhamento e no sino do Supervisor."],
    preview: { kind: "notice", audience: "O que o Supervisor vê", family: "ESCALATION", originLabel: null, title: "Encaminhar ao Supervisor", text: "O TMA seguiu acima da meta 7 dias depois da orientação. Junto vem a mensagem enviada à Dora (fictícia).", surface: "Acompanhamento e Notificação" },
    howTo: ["Adicione Escalonar à saída Sim.", "Escolha o Destino e o Cargo.", "Em \"Após escalonar\", escolha \"Encerrar este branch\"."],
    shots: ["escalonar"],
    stopsHere: "closed",
  },
  {
    id: "fora-nao",
    nodeId: "fora-da-meta",
    title: "A média está dentro da meta: caminho Não",
    summary: "A medição do dia pode até ter subido, mas a média da semana segue na meta. Nada a orientar.",
    panel: conditionPanel("Condição"),
    input: ["TMA dos últimos 7 dias: 5min40s (fictício).", "Meta vigente: 6min (fictícia)."],
    output: ["Saída Não: vai para o Fim."],
    howTo: ["Ligue a saída Não a um nó Fim."],
    shots: ["condicao-indicador"],
  },
  {
    id: "fim-dentro",
    nodeId: "fim",
    title: "Termina sem nenhuma mensagem",
    summary: "Nenhuma IA acionada e nada entregue.",
    input: ["O caminho chegou ao fim."],
    output: ["Execução concluída, sem entrega."],
    preview: { kind: "nothing", title: "Nenhuma mensagem", text: "A Dora não recebe aviso." },
    howTo: ["Nada a fazer: é o caminho esperado."],
  },
  {
    id: "fora-sem-dados",
    nodeId: "fora-da-meta",
    title: "Sem dados suficientes: caminho Sem dados",
    summary: "Com médias, a Condição tem uma terceira saída. Dado ausente nunca é desempenho ruim, e por isso não cai em Sim nem em Não.",
    panel: conditionPanel("Condição"),
    input: ["Nenhuma medição válida na janela de 7 dias (fictício)."],
    output: ["Saída Sem dados: vai para o Fim."],
    howTo: ["Ligue a saída Sem dados: a publicação cobra todas as saídas.", "\"Mínimo de medições\" e \"Cobertura mínima de dias\" ajustam quando considerar dados insuficientes."],
    shots: ["condicao-indicador"],
  },
  {
    id: "fim-sem-dados",
    nodeId: "fim",
    title: "Termina sem conclusão sobre a pessoa",
    summary: "Nada foi afirmado sobre a Dora: a falta de dado é um problema do dado, não dela.",
    input: ["O caminho chegou ao fim."],
    output: ["Execução concluída, sem entrega."],
    preview: { kind: "nothing", title: "Nenhuma mensagem", text: "A Dora não recebe aviso." },
    howTo: ["Se quiser alguém olhando a carga de dados, ligue Sem dados a um Output para a liderança, como faz o Modelo 19."],
  },
]

export const ORIENTAR_E_REAVALIAR: DemoExample = {
  slug: "orientar-e-reavaliar",
  objective: "acompanhar",
  title: "Indicador fora da meta: orientar e reavaliar",
  problem: "O indicador saiu da meta, a orientação foi dada, e ninguém volta para ver se melhorou.",
  whenToUse: "Quando faz sentido dar um tempo depois da orientação e então olhar de novo.",
  startsWith: "Nova medição do indicador TMA",
  recipient: "O colaborador e, depois, o Supervisor",
  persona: { name: "Dora", role: "operadora de atendimento (fictícia)", need: "O TMA da Dora passou da meta na última semana." },
  goal: "Mostrar o resultado à Dora, esperar 7 dias e reagir conforme a evolução.",
  expectedResult: "Com melhora, a liderança é avisada para reconhecer. Sem melhora, o caso vai à liderança. Sem dados, nada se conclui.",
  brief: [
    { question: "Quem participa e como definir a abrangência?", answer: "Quem tem medição do indicador, dentro da Abrangência do Workflow. Com este gatilho, a execução é sempre individual." },
    { question: "Quando o fluxo começa?", answer: "Quando chega uma nova medição do indicador escolhido." },
    { question: "De onde vêm os dados e qual período?", answer: "Das medições do indicador. O período é uma escolha da Condição: aqui, os últimos 7 dias, não o dia do disparo." },
    { question: "Como as condições determinam o caminho?", answer: "Sim, Não e Sem dados, comparando a média ponderada com a meta vigente, duas vezes: agora e 7 dias depois." },
    { question: "Como a análise vira orientação?", answer: "\"Gerar feedback\" do tipo Indicador usa os dados oficiais. Orientação sobre comportamento exige o formato de diagnóstico." },
    { question: "Como chega a cada pessoa?", answer: "Ao colaborador pelo Output no Acompanhamento. À liderança por Output no sino ou por Escalonar." },
    { question: "Quais desfechos alternativos existem?", answer: "Melhorou, seguiu fora, já estava dentro da meta, ou sem dados." },
  ],
  scenarios: [
    { id: "melhorou", label: "Melhorou em 7 dias", description: "Voltou para a meta: a liderança é avisada para reconhecer.", scenes: ["gatilho", "fora-sim", "analise", "feedback", "entrega", "espera", "reavaliacao-melhorou", "recado", "reconhecer", "fim-melhorou"] },
    { id: "seguiu", label: "Seguiu fora da meta", description: "Não mudou: o caso vai à liderança, que olha a causa.", scenes: ["gatilho", "fora-sim", "analise", "feedback", "entrega", "espera", "reavaliacao-seguiu", "escalonar"] },
    { id: "dentro", label: "Dentro da meta", description: "A média da semana está na meta: nada a orientar.", scenes: ["gatilho", "fora-nao", "fim-dentro"] },
    { id: "sem-dados", label: "Sem dados", description: "Sem medições na janela: nada é concluído sobre a pessoa.", scenes: ["gatilho", "fora-sem-dados", "fim-sem-dados"] },
  ],
  scenes: Object.fromEntries(scenes.map((scene) => [scene.id, scene])),
  mapLabels: { gatilho: "Nova medição", "fora-da-meta": "Acima da meta?", analise: "Analisar", feedback: "Gerar feedback", entrega: "Entregar", espera: "Aguardar 7 dias", reavaliacao: "Ainda acima?", escalonar: "Escalonar", recado: "Guardar recado", reconhecer: "Avisar líder", fim: "Fim" },
}
