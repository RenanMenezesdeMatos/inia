import { Bot, Clock, Flag, GitBranch, GitMerge, Play, Send, ShieldCheck, Split, UsersRound, Zap, type LucideIcon } from "lucide-react"

import type { PlatformRole } from "@/schemas/auth/auth.schema"
import type { FlowNodeType, OutputSurface, OutputTargetType } from "@/schemas/admin/workflow-graph.schema"
import { NODE_TYPE_LABELS, OUTPUT_SURFACE_LABELS, OUTPUT_TARGET_LABELS } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"
import type { NotificationKind } from "@/schemas/notifications/notifications.schema"
import { NOTIFICATION_KIND_LABELS } from "@/schemas/notifications/notifications.schema"

/**
 * Referência da Wiki com COBERTURA GARANTIDA PELO TIPO: cada catálogo abaixo é um `Record` cujas
 * chaves são o enum real do produto (FlowNodeType, OutputSurface, NotificationKind, PlatformRole…).
 * Um node/surface/tipo novo que entre no schema sem entrar aqui quebra o typecheck — a Wiki nunca
 * documenta node inexistente nem esquece um que exista (regras 34, 96, 120 e 136 do pedido).
 * Os rótulos exibidos vêm dos mesmos mapas de labels usados pelas telas.
 */

// ---------------------------------------------------------------------------------------------
// Nodes do Workflow Engine — todos os 11 tipos reais do Builder
// ---------------------------------------------------------------------------------------------

export type NodeContext = "STRUCTURE" | "EMPLOYEE_COLLECTION" | "EMPLOYEE" | "CONSOLIDATED_RESULT"

export const NODE_CONTEXT_LABELS: Record<NodeContext, string> = {
  STRUCTURE: "Estrutura",
  EMPLOYEE_COLLECTION: "Coleção de colaboradores",
  EMPLOYEE: "Colaborador individual",
  CONSOLIDATED_RESULT: "Resultado consolidado",
}

export type NodeDoc = {
  type: FlowNodeType
  label: string
  icon: LucideIcon
  iconClass: string
  iconBgClass: string
  /** Frase de uma linha — o "para quê". */
  summary: string
  purpose: string
  whenToUse: string
  input: string
  output: string
  settings: string[]
  limitations: string[]
  example: string
  /** Em quais contextos o node é aceito — inferido da posição no grafo, nunca configurado à mão. */
  acceptedIn: NodeContext[]
  /** Só aparece na paleta em modo Consolidado (Estrutura). */
  consolidatedOnly: boolean
}

export const WIKI_NODES: Record<FlowNodeType, NodeDoc> = {
  trigger: {
    type: "trigger",
    label: NODE_TYPE_LABELS.trigger,
    icon: Play,
    iconClass: "text-sky-600 dark:text-sky-300",
    iconBgClass: "bg-sky-100 dark:bg-sky-950",
    summary: "Inicia a execução — o QUANDO.",
    purpose: "Todo Workflow tem exatamente um Gatilho. Ele define o evento (Flag de canal, Indicador) ou a cadência (Agenda) que matricula alguém no Workflow.",
    whenToUse: "Sempre — é criado junto com o Workflow e configurado na seção 2 (Gatilho) das Configurações, ou clicando no próprio nó no canvas (é a mesma configuração).",
    input: "Uma interação com flag calculada, uma nova medição de indicador ou o relógio (calendário ou jornada prevista do colaborador).",
    output: "O valor bruto do gatilho (valor da flag ou da medição) ou o contexto de jornada (Agenda relativa). Agenda de calendário sem colaborador associado não tem valor de gatilho resolvível.",
    settings: ["Tipo: Flag de canal, Indicador ou Agenda", "Flag/Indicador escolhido, ou frequência, horários e fuso da Agenda", "Agenda: calendário (Individual ou Consolidado) ou relativa ao expediente (sempre Individual)"],
    limitations: ["Trocar o TIPO do gatilho é mudança estrutural — o editor mostra análise de impacto e o backend revalida", "Chat e Avatar não são gatilhos: são superfícies de entrega"],
    example: "Flag de canal VOICE · rechamada → cada chamada com rechamada = true matricula o operador daquela chamada.",
    acceptedIn: ["STRUCTURE", "EMPLOYEE"],
    consolidatedOnly: false,
  },
  wait: {
    type: "wait",
    label: NODE_TYPE_LABELS.wait,
    icon: Clock,
    iconClass: "text-amber-600 dark:text-amber-300",
    iconBgClass: "bg-amber-100 dark:bg-amber-950",
    summary: "Pausa por uma duração fixa e retoma sozinho.",
    purpose: "Esperar um tempo antes de continuar, sem intervenção humana. O prazo fica gravado, então sobrevive a um reinício do motor.",
    whenToUse: "Quando o passo seguinte só faz sentido depois de um intervalo (ex.: reavaliar depois de X dias). Na prática, a cadência do próprio Trigger por Agenda costuma resolver o mesmo caso com menos peças — nenhum dos 10 Workflows operacionais usa Aguardar.",
    input: "Qualquer contexto — só passa adiante o que já existia.",
    output: "Nada novo; a execução retoma automaticamente no próximo ciclo após o prazo.",
    settings: ["Duração da pausa"],
    limitations: ["Não espera por evento externo — é tempo fixo", "Não existe timeout/SLA para Revisão humana (isso não é Aguardar)"],
    example: "Orientação publicada → Aguardar 7 dias → Condition reavalia o indicador.",
    acceptedIn: ["STRUCTURE", "EMPLOYEE_COLLECTION", "EMPLOYEE", "CONSOLIDATED_RESULT"],
    consolidatedOnly: false,
  },
  condition: {
    type: "condition",
    label: NODE_TYPE_LABELS.condition,
    icon: GitBranch,
    iconClass: "text-violet-600 dark:text-violet-300",
    iconBgClass: "bg-violet-100 dark:bg-violet-950",
    summary: "Decide o próximo caminho — o QUÊ avaliar.",
    purpose: "Uma regra determinística que a própria engine resolve (2,84 < 3,3? Q4 = Q4? 78% < 80%?), sem depender de IA. Cada saída é um ramo: TRUE, FALSE e, quando aplicável, SEM DADOS.",
    whenToUse: "Sempre que a decisão pode ser expressa como comparação de um valor: valor do gatilho, resultado de um node anterior, variável, histórico de medições, atingimento, PRV ou quartil.",
    input: "Valor do gatilho, resultado de node anterior, variável, ou consulta histórica/de performance do colaborador (ou da estrutura, em modo Consolidado).",
    output: "Ramo escolhido: Sim (TRUE), Não (FALSE) ou Sem dados. Nenhum valor novo além da avaliação registrada no trace.",
    settings: ["Modo: Valor simples, Grupo E/OU, ou Indicador/PRV", "Fonte, agregação (Quantidade de ocorrências, Média ponderada, Média simples, Soma, Último valor, Mínimo, Máximo — conforme o indicador), período", "Comparar com: valor fixo, Meta vigente ou período anterior", "Quartil com Recorrência (\"Q4 em 3 dos últimos 3 fechamentos\")"],
    limitations: ["Grupo E/OU só compõe valores do contexto de execução — nunca Histórico/Performance diretamente", "Quartil do indicador/PRV não existe em modo Consolidado (não há colaborador individual como sujeito)"],
    example: "Atingimento consolidado do PRV, Média dos últimos 3 fechamentos < 80% → Sim: Chamar agente; Não: Fim; Sem dados: Fim.",
    acceptedIn: ["STRUCTURE", "EMPLOYEE_COLLECTION", "EMPLOYEE", "CONSOLIDATED_RESULT"],
    consolidatedOnly: false,
  },
  select_employees: {
    type: "select_employees",
    label: NODE_TYPE_LABELS.select_employees,
    icon: UsersRound,
    iconClass: "text-teal-600 dark:text-teal-300",
    iconBgClass: "bg-teal-100 dark:bg-teal-950",
    summary: "Cria uma coleção com um subconjunto da estrutura — não executa ninguém ainda.",
    purpose: "Reduzir a Estrutura Consolidada (ou uma coleção anterior) a quem interessa, com a mesma engine determinística das Conditions: Por critério (\"quais atendem a esta condição?\") ou Por ranking (\"quais são os N primeiros depois de ordenar?\").",
    whenToUse: "Em Workflows Consolidados, antes de \"Aplicar individualmente\", quando só parte da estrutura deve ser analisada (Q4 recorrente, 5 piores em Qualidade, 2 maiores quedas por Subgrupo…).",
    input: "Estrutura (contexto STRUCTURE) ou coleção anterior (EMPLOYEE_COLLECTION). Um segundo filtro avalia só quem já está na coleção — nunca reexpande.",
    output: "Coleção de colaboradores (EMPLOYEE_COLLECTION) com contagens: avaliados, selecionados, não atenderam, sem dados — e, no ranking, posição e valor de cada selecionado.",
    settings: ["Modo de seleção: Por critério ou Por ranking", "Por critério: o mesmo builder de Condition", "Por ranking: Ranquear por Valor ou Evolução; Melhores/Piores ou Maiores/Menores; N; agregação; período; Separar ranking por Grupo/Subgrupo"],
    limitations: ["Zero IA — sempre determinístico", "Zero selecionados não é erro: coleção vazia", "Sem seleção por IA/ranking semântico, coleção de estruturas ou coleções aninhadas"],
    example: "Equipe do Supervisor → Por ranking → 5 piores em Qualidade, Média, últimos 3 meses → 5 colaboradores (entre os que têm dados).",
    acceptedIn: ["STRUCTURE", "EMPLOYEE_COLLECTION", "CONSOLIDATED_RESULT"],
    consolidatedOnly: true,
  },
  apply_individually: {
    type: "apply_individually",
    label: NODE_TYPE_LABELS.apply_individually,
    icon: Split,
    iconClass: "text-orange-600 dark:text-orange-300",
    iconBgClass: "bg-orange-100 dark:bg-orange-950",
    summary: "Fan-out: 1 coleção → N execuções individuais.",
    purpose: "Criar uma execução separada, de verdade, para cada colaborador da coleção. Cada filho continua o grafo a partir do node seguinte, na mesma versão publicada do pai.",
    whenToUse: "Depois de \"Selecionar colaboradores\", quando cada pessoa precisa da sua própria análise, revisão ou entrega.",
    input: "Coleção de colaboradores (EMPLOYEE_COLLECTION).",
    output: "N execuções em contexto EMPLOYEE. O pai fica concluído logo após o fan-out (ou espera no Join, se houver \"Consolidar resultados\").",
    settings: ["Sem configuração própria — a origem é a coleção anterior"],
    limitations: ["Sem fan-out dentro de fan-out (nested)", "Sem limite operacional explícito de tamanho nesta versão"],
    example: "Coleção com João, Maria e Pedro → 3 execuções; aprovar a Revisão humana de João nunca decide a de Maria.",
    acceptedIn: ["EMPLOYEE_COLLECTION"],
    consolidatedOnly: true,
  },
  consolidate_results: {
    type: "consolidate_results",
    label: NODE_TYPE_LABELS.consolidate_results,
    icon: GitMerge,
    iconClass: "text-cyan-600 dark:text-cyan-300",
    iconBgClass: "bg-cyan-100 dark:bg-cyan-950",
    summary: "Fan-in (JOIN): N execuções individuais → 1 resultado consolidado.",
    purpose: "Esperar TODAS as execuções nascidas de um \"Aplicar individualmente\" chegarem a um estado terminal e continuar a execução consolidada exatamente uma vez, com um resultado tipado (quem concluiu, quem falhou, decisões e resultados de cada um).",
    whenToUse: "Quando a gestão precisa de uma visão da equipe depois das análises individuais — síntese pelo Orquestrador gerencial ou Output direto com a lista consolidada.",
    input: "Execuções filhas em contexto EMPLOYEE (cada uma só registra a chegada e termina).",
    output: "Resultado consolidado (CONSOLIDATED_RESULT): estrutura, coleção e o resultado de cada colaborador, com nomes resolvidos.",
    settings: ["Sem configuração própria — pareado ao \"Aplicar individualmente\" pela topologia do grafo (o painel mostra qual)"],
    limitations: ["Um Join por Apply; nenhum caminho individual pode escapar do fan-out sem passar pelo Join (publish bloqueia)", "Sem quorum, timeout ou fail-fast configuráveis", "Join vazio (0 filhos) não chama IA — o Orquestrador seguinte é pulado (EMPTY_FAN_IN)"],
    example: "3 diagnósticos individuais revisados → Consolidar resultados → Orquestrador · Gerencial → Resumo executivo ao Gerente.",
    acceptedIn: ["EMPLOYEE"],
    consolidatedOnly: true,
  },
  action: {
    type: "action",
    label: NODE_TYPE_LABELS.action,
    icon: Zap,
    iconClass: "text-fuchsia-600 dark:text-fuchsia-300",
    iconBgClass: "bg-fuchsia-100 dark:bg-fuchsia-950",
    summary: "Chamar agente, Gerar feedback, Definir variável ou Escalonar.",
    purpose: "Executar algo sobre um colaborador individual. \"Chamar agente\" é a forma de acionar um Agent especialista diretamente (Agent não é um node próprio). \"Escalonar\" transfere responsabilidade para um cargo da hierarquia.",
    whenToUse: "Chamar agente quando o Workflow já sabe qual competência precisa; Gerar feedback logo depois do Agent/Orquestrador para transformar o resultado dele em feedback oficial (monitoria ou indicador) pela camada de confiabilidade; Definir variável para guardar um valor reutilizado; Escalonar quando alguém acima precisa assumir.",
    input: "Contexto EMPLOYEE: o colaborador, a interação/transcrição (se houver), medições e o que os nodes anteriores produziram.",
    output: "Chamar agente: o resultado do Agent (feedback de monitoria/indicador ou Conformidade de processo). Gerar feedback: a mensagem do motor de feedback, nascida do diagnóstico registrado (publicável → segue; sem nada material ou sem evidência suficiente → encerra sem Output, com o motivo; nunca espera QA). Escalonar: um alerta para o destinatário, com o conteúdo. Sempre segue pela saída \"Sempre\" — exceto Escalonar com \"Encerrar branch\".",
    settings: ["Tipo: Chamar agente, Definir variável ou Escalonar (\"Definir configuração\" só em nodes legados já existentes)", "Chamar agente: Agent, instrução e Formato da análise (Feedback de monitoria ou Conformidade de processo — este só com gatilho por Flag)", "Chamar agente: Ferramentas nesta execução — restringe as capacidades de investigação do Agent (efetivas = Agent ∩ Workflow; nunca concede)", "Escalonar: cargo-alvo, conteúdo, superfícies e Continuar/Encerrar branch", "Gerar feedback: Origem (o \"Chamar agente\" ou \"Orquestrador\" anterior cujo resultado vira feedback) e Tipo (Automático, Monitoria ou Indicador) — modelo, prompt e validadores não são configuráveis", "Feedback direto de atendimento (legado): só em nodes já existentes; Workflows publicados continuam executando"],
    limitations: ["Exige colaborador individual — nunca aceita coleção ou resultado consolidado diretamente", "Um agente-coordenador (tipo Orquestrador) não pode ser chamado direto aqui", "Gerar feedback: monitoria exige uma chamada com transcrição (gatilho por Flag ou manual); indicador usa a medição do gatilho ou o fechamento oficial da agenda (\"Chamar agente\" com Diagnóstico do indicador); Orquestrador ainda não recebe o dado oficial do indicador"],
    example: "Chamar agente → Especialista de Faturamento, Formato: Conformidade de processo → etapas CONFORME / NÃO CONFORME / NÃO FOI POSSÍVEL CONFIRMAR / NÃO APLICÁVEL.",
    acceptedIn: ["EMPLOYEE"],
    consolidatedOnly: false,
  },
  orchestrator: {
    type: "orchestrator",
    label: NODE_TYPE_LABELS.orchestrator,
    icon: Bot,
    iconClass: "text-indigo-600 dark:text-indigo-300",
    iconBgClass: "bg-indigo-100 dark:bg-indigo-950",
    summary: "Aciona um Orchestrator publicado com uma instrução fixa.",
    purpose: "Coordenar especialistas quando a análise tem mais de uma competência, ou sintetizar N resultados depois de \"Consolidar resultados\". É o único node de IA aceito também em contexto consolidado.",
    whenToUse: "Interação com mais de um aspecto (fatura + cancelamento), ou síntese gerencial pós-JOIN. Se um único Agent resolve, use \"Chamar agente\" — uma request, não duas.",
    input: "Instrução textual do node + o contexto compartilhado (transcrição/entrada ou resultado consolidado).",
    output: "Texto e, quando o Orchestrator declara, Resultado estruturado (ex.: Síntese › Severidade) utilizável em Conditions e Outputs.",
    settings: ["Orchestrator (só os publicados e com acionamento que inclua workflows)", "Instrução"],
    limitations: ["Pós-JOIN roda sem especialistas (só síntese)", "Orchestrator só de chat/voz não pode ser usado num Workflow", "Ambiente sem chave de IA → falha controlada com retry limitado"],
    example: "Consolidar resultados → Orquestrador · Gerencial (consolidado): \"Resuma os diagnósticos e as decisões das revisões\".",
    acceptedIn: ["EMPLOYEE", "CONSOLIDATED_RESULT"],
    consolidatedOnly: false,
  },
  human_review: {
    type: "human_review",
    label: NODE_TYPE_LABELS.human_review,
    icon: ShieldCheck,
    iconClass: "text-rose-600 dark:text-rose-300",
    iconBgClass: "bg-rose-100 dark:bg-rose-950",
    summary: "Pausa a execução até uma pessoa decidir.",
    purpose: "Colocar um humano no circuito antes de um efeito visível: a execução fica aguardando em Pendências até Aprovar, Reprovar ou Escalar.",
    whenToUse: "Antes de publicar um feedback gerado por IA para o operador, quando a nota é crítica, quando há risco de impacto na pessoa.",
    input: "Conteúdo do contexto de execução (o resultado a revisar) e uma instrução para o revisor.",
    output: "Ramos Aprovado, Reprovado e Escalar — só as decisões conectadas aparecem para o revisor.",
    settings: ["Quem revisa: cargo na hierarquia do operador, cargo na hierarquia de quem decidiu uma revisão anterior, ou pessoa específica", "Conteúdo a revisar", "Instrução"],
    limitations: ["Sem prazo/SLA — aguarda indefinidamente", "Exige colaborador individual (cada revisão pertence a UMA pessoa)"],
    example: "Supervisor revisa o feedback; Aprovado → Output ao operador; Reprovado → não publica; Escalar → Escalonar ao Gerente com o conteúdo.",
    acceptedIn: ["EMPLOYEE"],
    consolidatedOnly: false,
  },
  output: {
    type: "output",
    label: NODE_TYPE_LABELS.output,
    icon: Send,
    iconClass: "text-emerald-600 dark:text-emerald-300",
    iconBgClass: "bg-emerald-100 dark:bg-emerald-950",
    summary: "Entrega o conteúdo — QUEM + ONDE + O QUÊ.",
    purpose: "O único node com permissão de gerar efeito visível para operador ou gestor: publica um feedback no Acompanhamento do próprio operador, ou um acompanhamento/notificação para alguém da gestão.",
    whenToUse: "No fim de todo caminho que precisa chegar a alguém. Individual: \"O próprio operador\" (só em contexto EMPLOYEE). Consolidado: destinatário de gestão resolvido pela estrutura.",
    input: "Uma fonte do contexto de execução — para o próprio operador no Acompanhamento, precisa ser o resultado inteiro de um Agent ou Orchestrator (nunca um sub-campo).",
    output: "Feedback publicado (operador) ou alerta com o conteúdo (gestão); referência do caso.",
    settings: ["Destinatário: O próprio operador, Supervisor do operador, Gerente do operador, Cargo específico, Pessoa específica", "Superfícies: Acompanhamento, Avatar, Chat, Pendências, Notificação", "Fonte do conteúdo"],
    limitations: ["\"O próprio operador\" não existe depois de \"Consolidar resultados\"", "Destinatário de gestão por estrutura precisa resolver para exatamente uma pessoa (NOT_FOUND / AMBIGUOUS bloqueiam a publicação)"],
    example: "Output → O próprio operador · Acompanhamento, fonte: resultado do Especialista de Experiência do Cliente.",
    acceptedIn: ["STRUCTURE", "EMPLOYEE_COLLECTION", "EMPLOYEE", "CONSOLIDATED_RESULT"],
    consolidatedOnly: false,
  },
  end: {
    type: "end",
    label: NODE_TYPE_LABELS.end,
    icon: Flag,
    iconClass: "text-slate-600 dark:text-slate-300",
    iconBgClass: "bg-slate-100 dark:bg-slate-800",
    summary: "Encerra a execução.",
    purpose: "Terminar um caminho explicitamente. Sempre terminal, sem saída.",
    whenToUse: "Em todo ramo que não leva a lugar nenhum (FALSE, Sem dados, Reprovado). Um nó sem aresta de saída bloqueia a publicação — o Fim deixa a intenção explícita.",
    input: "Qualquer contexto — inclusive uma coleção (terminar uma execução consolidada mantendo a coleção no histórico é permitido).",
    output: "Nenhuma.",
    settings: ["Nenhuma"],
    limitations: [],
    example: "Condition \"Nota da URA ≤ 2?\" → Não → Fim.",
    acceptedIn: ["STRUCTURE", "EMPLOYEE_COLLECTION", "EMPLOYEE", "CONSOLIDATED_RESULT"],
    consolidatedOnly: false,
  },
}

export const WIKI_NODE_ORDER: FlowNodeType[] = ["trigger", "condition", "action", "orchestrator", "human_review", "output", "wait", "end", "select_employees", "apply_individually", "consolidate_results"]

// ---------------------------------------------------------------------------------------------
// Surfaces (onde algo aparece) — todas as reais, com o estado de consumo de cada uma
// ---------------------------------------------------------------------------------------------

export type SurfaceDoc = {
  surface: OutputSurface
  label: string
  /** "reader" = tem tela que lê; "persisted" = gravado, sem tela dedicada; "hidden" = existe no domínio, não aparece no Builder. */
  status: "reader" | "persisted" | "hidden"
  whatHappens: string
  whoReads: string
}

export const WIKI_SURFACES: Record<OutputSurface, SurfaceDoc> = {
  FOLLOW_UP: {
    surface: "FOLLOW_UP",
    label: OUTPUT_SURFACE_LABELS.FOLLOW_UP,
    status: "reader",
    whatHappens: "Para \"O próprio operador\": publica um Feedback de verdade (com evidência) no caso do operador — feedback oficial de monitoria/indicador (gatilho por Flag/Indicador) só a partir de \"Gerar feedback\", uma vez por nó Output. Para a gestão: cria um alerta cujo título é o rótulo do nó Output e cuja descrição carrega o conteúdo.",
    whoReads: "Operador na aba Acompanhamento; Supervisor e acima no Acompanhamento da estrutura (resultados e escalonamentos).",
  },
  NOTIFICATION: {
    surface: "NOTIFICATION",
    label: OUTPUT_SURFACE_LABELS.NOTIFICATION,
    status: "reader",
    whatHappens: "Cria um alerta endereçado ao destinatário (mesmo canal do Escalonar).",
    whoReads: "O sino de Notificações do destinatário — clicar leva ao Acompanhamento com o item destacado.",
  },
  INBOX: {
    surface: "INBOX",
    label: OUTPUT_SURFACE_LABELS.INBOX,
    status: "persisted",
    whatHappens: "Grava a saída do Workflow para o destinatário, auditável na aba Execuções do Admin e no QA Lab.",
    whoReads: "Ninguém ainda: a aba Pendências real lista SOMENTE Revisões humanas. Um Output nesta superfície não vira pendência.",
  },
  AVATAR: {
    surface: "AVATAR",
    label: OUTPUT_SURFACE_LABELS.AVATAR,
    status: "reader",
    whatHappens: "Deixa um RECADO DE VOZ para o destinatário: o convite \"Tenho um recado para você\" aparece no painel da INIA com \"Ouvir agora\" e \"Depois\". O avatar nunca fala antes do aceite; o clique em \"Ouvir agora\" já inicia a fala (um resumo curto do mesmo conteúdo confiável, sem ler marcação). Só conta como entregue quando a fala termina — aceitar, falhar ou parar no meio não é entrega.",
    whoReads: "O próprio destinatário, no painel da INIA do Acompanhamento (o recado também fica escrito, em \"Ler o recado\"). \"Discreto\" não avisa no sino; \"Avisar\"/\"Destacar\" avisam.",
  },
  CHAT: {
    surface: "CHAT",
    label: OUTPUT_SURFACE_LABELS.CHAT,
    status: "reader",
    whatHappens: "Abre uma CONVERSA NOVA da INIA com o destinatário, com a primeira mensagem destacada (\"Recado\"). Nunca escreve na conversa que a pessoa já está usando. Quando ela responde, a INIA usa o conteúdo que originou a conversa.",
    whoReads: "O próprio destinatário, no chat da INIA (aviso \"Nova conversa da INIA\" no painel e em Conversas anteriores; \"Avisar\"/\"Destacar\" também avisam no sino).",
  },
  CUSTOM_SURFACE: {
    surface: "CUSTOM_SURFACE",
    label: OUTPUT_SURFACE_LABELS.CUSTOM_SURFACE,
    status: "hidden",
    whatHappens: "Existe no domínio como preparação para novas telas, mas não há cadastro administrativo de superfícies customizadas.",
    whoReads: "Não aparece no Builder até esse cadastro existir.",
  },
}

// ---------------------------------------------------------------------------------------------
// Destinatários de Output
// ---------------------------------------------------------------------------------------------

export type OutputTargetDoc = { type: OutputTargetType; label: string; resolution: string; contexts: NodeContext[] }

export const WIKI_OUTPUT_TARGETS: Record<OutputTargetType, OutputTargetDoc> = {
  CURRENT_OPERATOR: { type: "CURRENT_OPERATOR", label: OUTPUT_TARGET_LABELS.CURRENT_OPERATOR, resolution: "O colaborador da execução individual.", contexts: ["EMPLOYEE"] },
  SUPERVISOR_OF_OPERATOR: { type: "SUPERVISOR_OF_OPERATOR", label: OUTPUT_TARGET_LABELS.SUPERVISOR_OF_OPERATOR, resolution: "Sobe a cadeia de quem reporta a quem a partir do operador (individual) ou resolve pela estrutura (consolidado).", contexts: ["EMPLOYEE", "STRUCTURE", "CONSOLIDATED_RESULT", "EMPLOYEE_COLLECTION"] },
  MANAGER_OF_OPERATOR: { type: "MANAGER_OF_OPERATOR", label: OUTPUT_TARGET_LABELS.MANAGER_OF_OPERATOR, resolution: "Idem, para o cargo Gerente.", contexts: ["EMPLOYEE", "STRUCTURE", "CONSOLIDATED_RESULT", "EMPLOYEE_COLLECTION"] },
  ROLE: { type: "ROLE", label: OUTPUT_TARGET_LABELS.ROLE, resolution: "Coordenador, Supervisor, Gerente, Gerente sênior ou Diretor — pela cadeia do operador ou pela estrutura.", contexts: ["EMPLOYEE", "STRUCTURE", "CONSOLIDATED_RESULT", "EMPLOYEE_COLLECTION"] },
  USER: { type: "USER", label: OUTPUT_TARGET_LABELS.USER, resolution: "Uma pessoa fixa, escolhida no editor.", contexts: ["EMPLOYEE", "STRUCTURE", "CONSOLIDATED_RESULT", "EMPLOYEE_COLLECTION"] },
}

// ---------------------------------------------------------------------------------------------
// Triggers — as quatro famílias reais (Flag, Indicador, Agenda, Manual)
// ---------------------------------------------------------------------------------------------

export type TriggerKind = WorkflowTrigger["kind"]

export type TriggerDoc = { kind: TriggerKind; label: string; summary: string; evaluationMode: string; example: string }

export const WIKI_TRIGGERS: Record<TriggerKind, TriggerDoc> = {
  channel_flag: {
    kind: "channel_flag",
    label: "Flag de canal",
    summary: "Algo aconteceu numa interação específica — a flag já chega calculada junto com a interação.",
    evaluationMode: "Sempre Individual: o sujeito é o operador da interação.",
    example: "VOICE · rechamada, VOICE · nota_ura, VOICE · contestacao, VOICE · detrator",
  },
  indicator: {
    kind: "indicator",
    label: "Indicador",
    summary: "Uma nova medição de um indicador específico chegou para um colaborador.",
    evaluationMode: "Sempre Individual: o sujeito é o colaborador da medição.",
    example: "Nova medição de TMA, de Aderência, de Nota da Pesquisa na URA",
  },
  schedule: {
    kind: "schedule",
    label: "Agenda",
    summary: "Quando este Workflow deve executar — nunca o que analisar. Calendário (diário, semanal, mensal, a cada X dias, último dia do mês) ou relativa ao expediente de cada colaborador.",
    evaluationMode: "Calendário: Individual ou Consolidado (única escolha real). Relativa ao expediente: sempre Individual.",
    example: "Todo dia 5 às 09:00 · Toda segunda às 09:00 · 15 min após o início do expediente de cada um",
  },
  manual: {
    kind: "manual",
    label: "Manual",
    summary:
      "Só começa quando alguém com permissão clica em \"Executar agora\" e escolhe um colaborador. O gatilho declara quais dados cada execução traz: só o colaborador, uma interação real dele ou uma medição real de um indicador.",
    evaluationMode: "Sempre Individual: o sujeito é o colaborador escolhido no disparo (nunca a população inteira).",
    example: "Executar agora · Interação do colaborador · Executar agora · Medição de TMA do colaborador",
  },
}

// ---------------------------------------------------------------------------------------------
// Notificações (sino)
// ---------------------------------------------------------------------------------------------

export type NotificationDoc = { kind: NotificationKind; label: string; productMeaning: string; whereItLeads: string }

export const WIKI_NOTIFICATIONS: Record<NotificationKind, NotificationDoc> = {
  HUMAN_REVIEW: { kind: "HUMAN_REVIEW", label: NOTIFICATION_KIND_LABELS.HUMAN_REVIEW, productMeaning: "Uma revisão humana aguarda a sua decisão.", whereItLeads: "Aba Pendências, com a revisão aberta." },
  WORKFLOW_OUTPUT: { kind: "WORKFLOW_OUTPUT", label: NOTIFICATION_KIND_LABELS.WORKFLOW_OUTPUT, productMeaning: "Um Workflow entregou um resultado para você (ex.: resumo mensal da equipe).", whereItLeads: "Acompanhamento, com o item destacado." },
  INIA_MESSAGE: { kind: "INIA_MESSAGE", label: NOTIFICATION_KIND_LABELS.INIA_MESSAGE, productMeaning: "Um Workflow deixou um recado para você com a INIA: uma conversa nova no chat ou um recado de voz (o avatar só fala quando você aceitar ouvir).", whereItLeads: "Painel da INIA no Acompanhamento: abre a conversa ou destaca o convite \"Tenho um recado para você\"." },
  ESCALATION: { kind: "ESCALATION", label: NOTIFICATION_KIND_LABELS.ESCALATION, productMeaning: "Um caso foi escalonado para você (Escalonar de um Workflow ou \"Escalar\" numa revisão).", whereItLeads: "Acompanhamento, com o escalonamento destacado." },
  WORKDAY_RECONCILIATION: { kind: "WORKDAY_RECONCILIATION", label: NOTIFICATION_KIND_LABELS.WORKDAY_RECONCILIATION, productMeaning: "Um colaborador da sua equipe estava programado para trabalhar, o turno terminou e nenhuma evidência de produção chegou — você confirma o que aconteceu (não trabalhou / trabalhou e os dados não chegaram / corrigir escala).", whereItLeads: "Aba Pendências, com a pendência de produção aberta." },
  CALENDAR_NOTICE: { kind: "CALENDAR_NOTICE", label: NOTIFICATION_KIND_LABELS.CALENDAR_NOTICE, productMeaning: "Aviso do calendário operacional: produção observada num dia planejado como folga/day off (divergência), produção com situação funcional não produtiva (inconsistência) ou calendário de escalas perto do fim (Admin).", whereItLeads: "Calendário da equipe (no dia/colaborador) ou Administração › Central de Dados › Calendário operacional." },
  OTHER: { kind: "OTHER", label: NOTIFICATION_KIND_LABELS.OTHER, productMeaning: "Aviso genérico endereçado a você.", whereItLeads: "Marca como lido; sem destino específico." },
}

// ---------------------------------------------------------------------------------------------
// Papéis — o que cada um enxerga (princípio, não matriz gigante: capabilities vêm do backend)
// ---------------------------------------------------------------------------------------------

export type RoleDoc = { role: PlatformRole; label: string; sees: string; peopleTab: string | null; pendingTab: string }

export const WIKI_ROLES: Record<PlatformRole, RoleDoc> = {
  OPERATOR: { role: "OPERATOR", label: "Operador", sees: "A si mesmo: Acompanhamento (o que a INIA e a gestão entregam), Indicadores (PRV oficial, composição, indicadores, histórico).", peopleTab: null, pendingTab: "Só enquanto houver uma pendência endereçada a ele." },
  SUPERVISOR: { role: "SUPERVISOR", label: "Supervisor", sees: "A equipe direta (quem reporta a ele): atingimento consolidado, distribuição por quartil, membros, Acompanhamento da estrutura.", peopleTab: "Equipe", pendingTab: "Sim — pode ser alvo de Revisão humana e Escalonar." },
  COORDINATOR: { role: "COORDINATOR", label: "Coordenador", sees: "A estrutura abaixo dele (Supervisores e suas equipes): consolidado, Agrupar por Supervisor/Grupo/Subgrupo, drill-down.", peopleTab: "Estrutura", pendingTab: "Sim." },
  MANAGER: { role: "MANAGER", label: "Gerente", sees: "A estrutura abaixo dele (Coordenadores ou Supervisores diretos, conforme a cadeia real): consolidado, agrupamentos, drill-down.", peopleTab: "Estrutura", pendingTab: "Sim." },
  SENIOR_MANAGER: { role: "SENIOR_MANAGER", label: "Gerente Sênior", sees: "A estrutura abaixo dele (Gerentes → …): consolidado, agrupamentos, drill-down.", peopleTab: "Estrutura", pendingTab: "Sim." },
  DIRECTOR: { role: "DIRECTOR", label: "Diretor", sees: "Toda a estrutura abaixo dele (Gerentes Sêniores → …): consolidado, agrupamentos, drill-down.", peopleTab: "Estrutura", pendingTab: "Sim." },
  ADMIN: { role: "ADMIN", label: "Fora da hierarquia", sees: "Pessoa fora da hierarquia operacional (ex.: conta de administração). Não concede nada por si: o que ela administra vem dos papéis de acesso da conta (Administrador geral, Administrador, Administrador de acessos, QA de feedback), cada um com escopo. Não amplia Indicadores, Estrutura nem Calendário.", peopleTab: null, pendingTab: "Só enquanto houver uma pendência endereçada a ela." },
}

export const WIKI_ROLE_ORDER: PlatformRole[] = ["OPERATOR", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR", "ADMIN"]
