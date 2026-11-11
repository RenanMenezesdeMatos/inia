/**
 * O que cada indicador da tela quer dizer: definição, fórmula, base considerada, exclusões e a data de referência. É o texto das dicas
 * (ícone "i") e da tabela de cobertura; o inventário completo, com fontes e campos, está em `docs/dev/indicadores-de-sucesso-da-inia.md`.
 */
export type Definition = {
  title: string
  what: string
  formula: string
  base: string
  excludes: string
  reference: string
}

export const DEFINITIONS = {
  responseTime: {
    title: "Tempo médio de resposta (texto)",
    what: "Tempo entre o servidor receber a pergunta e gravar a resposta completa da INIA (depois do streaming e da conferência). Não é o tempo até o primeiro trecho aparecer na tela.",
    formula: "Soma dos tempos medidos ÷ quantidade de respostas medidas (cada resposta pesa igual; nunca média das médias diárias).",
    base: "Perguntas digitadas no chat livre, com a resposta ligada à pergunta pela chave do envio.",
    excludes:
      "Pergunta sem resposta, registro antigo sem chave, texto digitado com a voz ligada, conversas por voz (sem medida confiável), sessões de feedback, recados e treino. Ausente nunca vale zero.",
    reference: "Data da pergunta",
  },
  positiveReplies: {
    title: "Respostas úteis no chat",
    what: "Das respostas da INIA avaliadas pelo colaborador, quantas ele marcou como úteis. Mostra a percepção de quem avaliou — não prova que a resposta estava correta.",
    formula: "Respostas com “útil” vigente ÷ respostas com “útil” ou “não foi útil” vigente.",
    base: "Respostas da INIA no chat livre (texto e voz), com a avaliação vigente hoje (cada resposta conta uma vez, mesmo trocada).",
    excludes: "Avaliação retirada, resposta sem avaliação e etapa de esclarecimento aguardando escolha.",
    reference: "Data da resposta",
  },
  ratedReplies: {
    title: "Respostas avaliadas",
    what: "Quantas respostas da INIA receberam “útil” ou “não foi útil”.",
    formula: "Respostas com avaliação vigente ÷ respostas da INIA no período.",
    base: "Respostas da INIA no chat livre (texto e voz).",
    excludes: "Avaliação retirada e etapa de esclarecimento aguardando escolha.",
    reference: "Data da resposta",
  },
  consultationSignals: {
    title: "Respostas com falha na consulta",
    what: "Respostas em que o próprio sistema registrou que a INIA não encontrou nas bases, achou as bases insuficientes, não concluiu a consulta ou teve o especialista impedido. Registrado por código no momento da resposta, sem IA.",
    formula: "Respostas com ao menos um sinal ÷ respostas com registro de sinais. Uma resposta pode ter mais de um sinal: as parcelas podem somar mais de 100%.",
    base: "Respostas da INIA no chat livre com registro de sinais (respostas anteriores ao início do registro não entram; a data de início está na cobertura).",
    excludes: "Respostas anteriores ao registro. “Pergunta sem resposta” é contada na pergunta, à parte.",
    reference: "Data da resposta",
  },
  conformity: {
    title: "Conformidade das respostas (conferência automática)",
    what: "Conferências automáticas das respostas contra as regras cadastradas (assuntos proibidos da Governança e limites de atuação do Agent). Mede conformidade com regras, não correção: uma resposta sem violação não é necessariamente correta.",
    formula: "Conferências sem violação ÷ conferências conclusivas (sem violação + com violação). A conferência que falhou fica à parte.",
    base: "Conferências gravadas no chat de texto, na resposta de especialista da voz e na fala da INIA.",
    excludes: "Conferências de execuções de Agent, de especialistas e de Workflow; conversas de treino.",
    reference: "Data da conferência",
  },
  anjoAssertiveness: {
    title: "Assertividade segundo o Anjo",
    what: "Não é calculável com os dados gravados. O Anjo é uma pessoa do apoio humano: ao encerrar um atendimento, ele classifica POR QUE o operador precisou de ajuda e o RESULTADO do atendimento. Ele não marca a resposta da INIA como correta, parcialmente correta, incorreta ou inconclusiva.",
    formula: "Exigiria uma classificação por resposta (correta / parcial / incorreta / inconclusiva). Essa classificação não existe.",
    base: "—",
    excludes: "Nenhum valor é estimado a partir de outras classificações.",
    reference: "—",
  },
  supportReasons: {
    title: "Por que o operador precisou do Anjo",
    what: "Classificação feita pelo Anjo ao encerrar o atendimento (um motivo por atendimento). É o motivo do pedido de apoio — não o motivo da chamada do cliente nem um julgamento da resposta da INIA.",
    formula: "Atendimentos com o motivo ÷ atendimentos classificados.",
    base: "Atendimentos do Apoio com Anjo iniciados no período, no Grupo/Subgrupo gravado no pedido.",
    excludes: "Atendimentos ainda sem classificação (aparecem na cobertura).",
    reference: "Data de início do atendimento",
  },
  routes: {
    title: "Assunto da procura, pela rota da INIA",
    what: "O especialista (Agent) ou a ferramenta que a própria INIA acionou para responder — é o assunto como a INIA o entendeu. Não é o motivo da chamada do cliente nem o motivo de uma avaliação negativa.",
    formula: "Respostas com a rota ÷ respostas da INIA no período. Uma resposta pode ter mais de uma rota: as participações podem somar mais de 100%.",
    base: "Respostas da INIA no chat livre (texto e voz).",
    excludes: "Etapa de esclarecimento aguardando escolha; ferramentas que não são rota (conferência da resposta, escolha do operador).",
    reference: "Data da resposta",
  },
  feedbackAcknowledgement: {
    title: "Ciência dos feedbacks",
    what: "O próprio colaborador confirmou, com login e senha, que LEU o feedback. Ciência não é concordância nem utilidade.",
    formula: "Feedbacks com ciência ÷ feedbacks disponibilizados.",
    base: "Feedbacks publicados no Acompanhamento e entregas de feedback de atendimento a pessoas do seu alcance, menos os seus.",
    excludes: "Feedbacks ocultados do Acompanhamento.",
    reference: "Data da disponibilização (a ciência pode ter vindo depois)",
  },
  feedbackRating: {
    title: "Feedbacks avaliados",
    what: "Feedbacks com “útil” ou “não foi útil” vigente (“Este conteúdo foi útil?”).",
    formula: "Feedbacks com avaliação vigente ÷ feedbacks disponibilizados.",
    base: "A mesma coorte de feedbacks disponibilizados no período.",
    excludes: "Avaliação retirada (contada à parte).",
    reference: "Data da disponibilização",
  },
  feedbackPositive: {
    title: "Utilidade positiva dos feedbacks",
    what: "Dos feedbacks avaliados, quantos o colaborador marcou como úteis. É percepção de utilidade — não prova que o feedback estava correto.",
    formula: "Feedbacks com “útil” vigente ÷ feedbacks com avaliação vigente.",
    base: "Feedbacks disponibilizados no período com avaliação vigente.",
    excludes: "Avaliação retirada; feedback sem avaliação.",
    reference: "Data da disponibilização",
  },
  feedbackNegative: {
    title: "Avaliação negativa dos feedbacks",
    what: "Dos feedbacks avaliados, quantos estão hoje como “não foi útil”. Avaliação negativa não é erro comprovado.",
    formula: "Feedbacks com “não foi útil” vigente ÷ feedbacks com avaliação vigente.",
    base: "Feedbacks disponibilizados no período com avaliação vigente.",
    excludes: "Avaliação retirada; feedback sem avaliação.",
    reference: "Data da disponibilização",
  },
  contestation: {
    title: "Contestação pelo colaborador",
    what: "Feedbacks contestados: o colaborador marcou “não foi útil” com motivo e descrição, e a contestação está vigente ou já foi respondida pela revisão (a regra da fila de Contestações).",
    formula: "Feedbacks contestados ÷ feedbacks disponibilizados.",
    base: "Feedbacks disponibilizados no período a pessoas do seu alcance, menos os seus.",
    excludes: "Contestação retirada antes de ser respondida.",
    reference: "Data da disponibilização",
  },
  procedence: {
    title: "Procedência entre contestações revisadas",
    what: "Das contestações que já receberam decisão da revisão humana, quantas foram consideradas procedentes (a contestação tinha razão). “Procedente” não é aprovação do feedback. As procedentes em parte e as pendentes aparecem separadas.",
    formula: "Contestações procedentes ÷ contestações revisadas (procedente + procedente em parte + feedback mantido).",
    base: "Contestações dos feedbacks disponibilizados no período, com decisão.",
    excludes: "Contestações pendentes (sem decisão). O resultado das revisadas não se estende às demais.",
    reference: "Data da disponibilização do feedback (a revisão pode ter vindo depois)",
  },
} satisfies Record<string, Definition>
export type DefinitionKey = keyof typeof DEFINITIONS
