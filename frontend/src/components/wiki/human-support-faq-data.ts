/**
 * FAQ DA OPERAÇÃO DOS ANJOS (Apoio com Anjo) — fonte ÚNICA da página `/wiki/apoio-com-anjo/faq` e do prompt de referência que ela
 * oferece para copiar (`buildHumanSupportPrompt`). Pedido do responsável em 2026-11-16: tudo sobre a operação e as regras de negócio —
 * quando se aplica, o que é cada coisa e como é contado.
 *
 * Os números são os PADRÕES do produto; os tempos de resposta e da pausa "Desconexão" são configuráveis (ver a seção de tempos). Fonte
 * das regras: `backend/src/modules/human-support/**` e `docs/dev/memoria/apoio-com-anjo.md`. Mudou uma regra lá? Mude aqui também —
 * a FAQ e o prompt mudam juntos.
 */
export type FaqItem = { q: string; a: string }
export type FaqSection = { id: string; title: string; eyebrow: string; items: FaqItem[] }

export const HUMAN_SUPPORT_FAQ: FaqSection[] = [
  {
    id: "conceitos",
    title: "O que é cada coisa",
    eyebrow: "Conceitos",
    items: [
      { q: "O que é o Apoio com Anjo?", a: "É a ajuda de uma PESSOA quando a resposta da INIA não resolve a dúvida do operador. Operador e Anjo conversam numa sala própria, separada do chat com a INIA. Nada é criado sozinho: o pedido só nasce quando o operador confirma o pedido de ajuda." },
      { q: "Quem é o Anjo?", a: "A pessoa da equipe de apoio que atende os pedidos. Ser Anjo é um PAPEL de acesso (não um cargo), concedido pelo Administrador geral, com um alcance: a organização inteira, um Grupo ou um Subgrupo. O Anjo só recebe pedidos de operadores desse alcance e nunca atende a si mesmo." },
      { q: "Quem é o Coordenador de Anjos?", a: "Quem acompanha a operação: lê os pedidos e as conversas do seu alcance (Grupo ou Subgrupo, ou a organização inteira), vê a Monitoria Online, os indicadores e a jornada dos Anjos, transfere atendimentos e ajusta os tempos de resposta do próprio Grupo. Também é um papel concedido pelo Administrador geral. O Coordenador não atende." },
      { q: "E o Administrador geral?", a: "Configura tudo (liga/desliga, capacidade, papéis), acompanha a organização inteira e muda o padrão dos tempos. Ele não atende pedidos." },
      { q: "Por que o operador vê \"Apoio\" e não \"Anjo\"?", a: "Na tela do operador, quem atende se chama \"Apoio\": \"Falar com o Apoio\", \"Ana (Apoio) recebeu seu pedido\", \"Mensagem para o Apoio\". Nenhuma mensagem que o operador lê diz \"Anjo\". Na área do Anjo e nos painéis da coordenação o nome continua \"Anjo\"." },
      { q: "A INIA lê a conversa com o Anjo?", a: "Não. A INIA não lê, não resume e não aprende com a sala de apoio. Podem ler a conversa: o operador, o Anjo do atendimento, o Coordenador de Anjos do alcance e o Administrador geral. Cada leitura pela coordenação fica registrada (quem viu a conversa de quem)." },
      { q: "O que é um pedido e o que é um atendimento?", a: "O PEDIDO é a necessidade do operador, com protocolo AP-XXXXXX, do momento em que é criado até terminar. O ATENDIMENTO é cada período em que um Anjo cuida do pedido. Um pedido pode ter mais de um atendimento: por exemplo, quando o Anjo cai, perde o atendimento por falta de resposta ou a coordenação transfere." },
      { q: "O que é \"acolhimento\"?", a: "É o momento em que o Anjo recebe o atendimento. A atribuição é DIRETA: não existe oferta para aceitar nem oferta expirada. Por isso a demora real do Anjo é medida até a PRIMEIRA RESPOSTA dele." },
    ],
  },
  {
    id: "liga-desliga",
    title: "Liga/desliga, papéis e capacidade",
    eyebrow: "Configuração",
    items: [
      { q: "O apoio vale para todo mundo?", a: "Não. Tudo nasce DESLIGADO. Vale para um operador quando a chave geral da organização está ligada E o estado do Subgrupo dele está Ligado — ou, se o Subgrupo está em \"Herdar\", o estado do Grupo. Sem estado próprio (herdar até o fim) é desligado. Operador sem Grupo nunca tem apoio." },
      { q: "O que acontece ao desligar um Grupo ou Subgrupo?", a: "No mesmo comando, os pedidos que estavam NA FILA desse escopo são cancelados (\"Cancelado: apoio desligado\"). Os atendimentos em andamento continuam até o fim. Novos pedidos ficam bloqueados." },
      { q: "Quem concede os papéis de Anjo e de Coordenador de Anjos?", a: "Só o Administrador geral. Cargo nunca dá acesso: um supervisor só é Anjo se tiver o papel. Tirar o papel de um Anjo com atendimento aberto interrompe esse atendimento, e o pedido volta à frente da fila." },
      { q: "Quantos atendimentos um Anjo faz ao mesmo tempo?", a: "A capacidade padrão da organização é 2 atendimentos simultâneos (pode ser de 1 a 5). Cada Anjo pode ter uma capacidade própria, também de 1 a 5, definida pelo Administrador geral." },
    ],
  },
  {
    id: "pedir",
    title: "Quando o operador pode pedir ajuda",
    eyebrow: "Operador",
    items: [
      { q: "Quando o apoio é oferecido?", a: "Só depois de o operador tentar com a INIA. São dois caminhos: (1) a sugestão abaixo de uma resposta em que a consulta não encontrou a informação, não teve conhecimento suficiente, falhou, foi impedida ou ficou sem resposta — sinais calculados pelo sistema, nunca procurando frases no texto; (2) a descurtida da resposta com \"Sim\" em \"Você ainda precisa de ajuda com isso?\". Não há botão fixo no chat." },
      { q: "Quais são os motivos da descurtida?", a: "Informação errada; Não respondeu o que perguntei; Não encontrou a informação; Resposta incompleta; Difícil de entender; Outro. O comentário é opcional (obrigatório em \"Outro\"), de 3 a 1.000 caracteres. A descurtida com motivo só existe no chat livre." },
      { q: "O que o Anjo recebe junto com o pedido?", a: "A pergunta, a resposta da INIA, o motivo e o comentário da descurtida (quando houver) e a nota opcional do operador (até 2.000 caracteres). A janela do pedido mostra exatamente essa cópia antes de confirmar." },
      { q: "Um operador pode ter vários pedidos?", a: "Não. No máximo UM pedido aberto por operador (na fila, em atendimento ou aguardando o retorno dele). Pedido encerrado nunca reabre: nova necessidade, novo pedido. Há também um limite de 10 pedidos por hora por pessoa (a prévia da janela conta)." },
      { q: "E se não houver ninguém em serviço?", a: "O botão fica desabilitado com \"Ninguém do Apoio em serviço agora.\" e a tentativa é registrada para o painel (no máximo uma por pessoa a cada 10 minutos). \"Em serviço\" = Anjo com o papel cobrindo o operador, a área aberta (conexão viva) e fora de Indisponível e da pausa \"Desconexão\"." },
    ],
  },
  {
    id: "disponibilidade",
    title: "Disponibilidade que o operador vê",
    eyebrow: "Antes de pedir e na fila",
    items: [
      { q: "Quais mensagens de disponibilidade existem?", a: "Pela primeira regra que valer: (1) apoio desligado → \"O Apoio ainda não está disponível para sua equipe.\"; (2) ninguém em serviço → \"Ninguém do Apoio em serviço agora.\" (não dá para pedir); (3) alguém pode receber agora → \"Há pessoas do Apoio disponíveis: seu pedido vai direto para uma delas.\"; (4) alguém Disponível, mas todos sem vaga → \"Todas as pessoas do Apoio estão em atendimento.\"; (5) todos em pausa → \"Ninguém do Apoio disponível no momento. Aguarde: seu pedido está na fila.\"" },
      { q: "O operador sabe quem está em pausa?", a: "Nunca. O operador só vê o estado geral acima. Quantos Anjos estão em pausa, o motivo da pausa e a programação do Anjo nunca chegam à tela dele." },
    ],
  },
  {
    id: "fila",
    title: "Fila, distribuição e prazo",
    eyebrow: "Quem recebe e quando",
    items: [
      { q: "Como o pedido chega a um Anjo?", a: "Na hora, sem aceite. A distribuição roda depois de cada ação e a cada 3 segundos. Pode receber o Anjo que: tem o papel cobrindo o Grupo/Subgrupo do pedido, está Disponível, com a área aberta, sem pausa ou indisponibilidade programada, com vaga (abaixo da capacidade) e não é o próprio operador. Entre os elegíveis, vai para quem tem MENOS atendimentos; empatados, para quem recebeu há mais tempo." },
      { q: "O universo de atuação (B2B, B2C, B2X) muda quem atende?", a: "Sim, quando a organização ativa o universo de atuação. A partir daí o pedido só vai para o Anjo do MESMO universo do operador (o do cadastro dele), ou para o Anjo que tem a permissão de todos os universos no Grupo/Subgrupo do pedido; operador ainda sem universo só é atendido por quem tem essa permissão. A disponibilidade que o operador vê, a contagem de \"ninguém em serviço\" e a lista de Anjos para transferência seguem a mesma regra. No painel, o Coordenador só vê e transfere pedidos de operadores do universo dele, salvo com a permissão de todos os universos no lugar do pedido. Sem a ativação, nada muda." },
      { q: "Qual é a ordem da fila?", a: "Por ordem de entrada na fila. O pedido que volta por culpa do Anjo (Anjo caiu, Anjo ficou sem responder, coordenação devolveu) mantém a entrada original e volta à FRENTE. O pedido do operador que ficou sem responder e depois voltou entra no FIM da fila." },
      { q: "Como é calculada a espera estimada?", a: "Pelos pedidos dos últimos 14 dias: primeiro do mesmo Subgrupo; se houver menos de 10 pedidos atribuídos, do Grupo; depois da organização. A tela diz \"cerca de N min\" ou \"mais de N min\"; sem histórico, não estima." },
      { q: "Quanto tempo o pedido fica na fila?", a: "Até o PRAZO da fila: o tempo em que 90% dos pedidos daquela mesma população receberam um Anjo, limitado entre 10 e 25 minutos. Sem histórico, 20 minutos. Vencido o prazo sem Anjo, o pedido termina como Expirado (\"Ninguém do Apoio pôde atender a tempo\"). Quando o pedido volta à fila, ganha um prazo novo." },
      { q: "O que acontece se o operador fechar a INIA enquanto espera na fila?", a: "Se a tela do operador ficar 2 minutos sem dar sinal, o pedido termina como Abandonado (\"INIA fechada pelo operador\"). O operador também pode cancelar o pedido a qualquer momento na fila." },
    ],
  },
  {
    id: "atendimento",
    title: "Durante o atendimento",
    eyebrow: "Sala de apoio",
    items: [
      { q: "Como funciona a conversa?", a: "Mensagens de até 4.000 caracteres. Há \"digitando…\" (vale por 8 segundos depois do último sinal), tiques de enviada, entregue e lida, e som a cada mensagem recebida, dos dois lados. Ao abrir a sala, a voz da INIA é encerrada e o avatar sai de cena." },
      { q: "Quem encerra o atendimento?", a: "O operador ou o Anjo, a qualquer momento (\"Encerrado pelo operador\" / \"Encerrado pelo Anjo\"). Se o operador ficar mais de 5 minutos sem a INIA aberta, o Anjo pode encerrar como \"Operador sem a INIA aberta\" — isso conta como abandono do operador." },
      { q: "O que acontece com a conversa da INIA depois do atendimento?", a: "Quando termina um atendimento que estava em andamento, a conversa com a INIA de onde o pedido saiu é encerrada (\"Encerrada após o Apoio\"); a próxima pergunta abre uma conversa nova. Pedido que saiu da fila sem atendimento não mexe na conversa." },
    ],
  },
  {
    id: "tempos",
    title: "Tempos de resposta",
    eyebrow: "Quem ficou sem responder",
    items: [
      { q: "Como o sistema sabe de quem é a vez?", a: "Pela última mensagem humana do atendimento: se a última foi do Anjo, a vez é do operador; se foi do operador (ou o Anjo ainda não escreveu), a vez é do Anjo." },
      { q: "O operador ficou sem responder. O que acontece?", a: "Padrão 15 minutos, contados a partir da ÚLTIMA MENSAGEM DO ANJO: o atendimento termina, o Anjo fica livre e o pedido passa a \"Aguardando seu retorno\" (no painel, \"Aguardando o operador\"). O operador vê até que horas pode voltar. Se escrever, o pedido entra no FIM da fila; ele também pode cancelar." },
      { q: "E se o operador não voltar?", a: "Padrão 20 minutos, contados TAMBÉM da última mensagem do Anjo (não de quando o pedido passou a aguardar): com 15 e 20, o operador tem mais 5 minutos depois de o Anjo ficar livre. Vencido, o pedido é encerrado como abandono do operador (\"Abandonado: o operador não voltou\")." },
      { q: "O Anjo ficou sem responder. O que acontece?", a: "Padrão 15 minutos, contados a partir da ÚLTIMA MENSAGEM DO OPERADOR — ou do início do atendimento, se o Anjo ainda não escreveu: o Anjo PERDE o atendimento. Conta como abandono do Anjo, o histórico dele marca \"Perdido: você ficou sem responder\" e não há classificação nem avaliação. O pedido volta à FRENTE da fila, para qualquer Anjo — inclusive o mesmo." },
      { q: "E se ao voltar à fila não houver ninguém em serviço?", a: "Vale a mesma regra de quem pede sem ninguém em serviço: o pedido não fica esperando — é encerrado (\"Encerrado: ninguém do Apoio em serviço\", estado Expirado) e a tentativa sem Anjo é registrada. Vale quando o Anjo ficou sem responder e quando o operador volta de \"Aguardando seu retorno\" (o operador é avisado antes de escrever, e isso não conta como abandono dele). O Anjo que CAIU (rede, sessão) é diferente: o pedido volta à frente da fila e espera, porque ele pode voltar." },
      { q: "Quem muda esses tempos?", a: "Em Painel dos Anjos › Monitoria Online › \"Tempos de resposta\". O PADRÃO DA ORGANIZAÇÃO só muda quem acompanha a organização inteira (Administrador geral ou Coordenador com escopo de organização). Cada GRUPO pode ter tempos próprios, mudados pelo Coordenador de Anjos daquele Grupo (só do próprio Grupo) ou por quem acompanha a organização; \"Usar o padrão da organização\" desfaz (a versão da edição continua subindo: quem estava com a tela aberta antes recebe o aviso de que os tempos mudaram). Subgrupo segue o Grupo. Limites: volta à fila de 1 a 120 minutos; encerramento até 240 e sempre depois da volta à fila do operador. Valem na hora, também nos atendimentos em andamento, com histórico e auditoria." },
    ],
  },
  {
    id: "presenca",
    title: "Estados e presença do Anjo",
    eyebrow: "Área do Anjo",
    items: [
      { q: "Quais são os estados do Anjo?", a: "Disponível (recebe pedidos); Em atendimento (rótulo de quem está Disponível com atendimento aberto); Em pausa, com motivo — Lanche, Pessoal, Atividade de processo, Reunião (escolhidos pelo Anjo) ou Desconexão (só o sistema põe); Indisponível (o mesmo que offline: não recebe e fica fora do tempo online)." },
      { q: "Onde o Anjo trabalha?", a: "Na aba \"Apoio\" do próprio perfil (a última aba), com o estado no topo e as abas \"Atendimento\" e \"Seus atendimentos\". O atalho ao lado do sino mostra atendimentos e mensagens novas. A área funciona em UMA aba do navegador por vez." },
      { q: "O que é estar \"online\"?", a: "Ter a área do Anjo aberta com a sessão válida. A área renova a conexão a cada poucos segundos; sem sinal por 75 segundos, a conexão vence." },
      { q: "E se a conexão do Anjo cair?", a: "O operador é avisado (\"O Apoio está sem conexão\"). Há 3 minutos de carência: se o Anjo voltar, tudo continua (\"O Apoio voltou\"). Passou disso, o atendimento é Interrompido, o pedido volta à FRENTE da fila e o Anjo fica Indisponível. Queda de rede NÃO conta como abandono do Anjo." },
      { q: "E se o Anjo deslogar ou a sessão terminar?", a: "Ele fica Indisponível na hora. Os atendimentos abertos seguem a mesma carência de 3 minutos; passado esse tempo, são interrompidos e voltam à fila — e isso CONTA como abandono do Anjo (ele saiu e derrubou o operador). Entrar de novo não o deixa Disponível: ele precisa escolher Disponível." },
      { q: "O Anjo pode pausar com atendimento aberto?", a: "Pode programar. Sem atendimento, pausa e Indisponível valem na hora. Com atendimento, \"Pausa\" e \"Ficar indisponível\" viram PROGRAMAÇÃO: ele não recebe novos pedidos (mesmo com vaga) e o estado muda no instante em que termina o último atendimento. Dá para alterar ou cancelar a programação." },
    ],
  },
  {
    id: "desconexao",
    title: "Pausa \"Desconexão\"",
    eyebrow: "Anjo que não responde ninguém",
    items: [
      { q: "Quando o Anjo entra em pausa \"Desconexão\"?", a: "Quando fica 20 minutos (padrão) sem responder NINGUÉM. A contagem começa no primeiro retorno que ele ficou devendo a um operador — atendimento aberto cuja última mensagem não é dele, ou atendimento que ele já perdeu por falta de resposta. Se ele mandar mensagem em QUALQUER atendimento, ou mudar o próprio estado, a contagem recomeça." },
      { q: "O que acontece nessa pausa?", a: "O sistema põe o Anjo em pausa \"Desconexão\": ele não recebe pedidos e não conta como \"em serviço\". Os atendimentos que ainda estiverem com ele seguem a regra do Anjo sem responder (voltam à fila no tempo deles)." },
      { q: "E se ele não voltar?", a: "Depois de 10 minutos (padrão) na pausa sem voltar — escolher um estado, como \"Voltar\" —, ele fica Indisponível. O motivo fica registrado." },
      { q: "Onde aparece o motivo?", a: "Na área do Anjo (\"O sistema pôs você em pausa “Desconexão”… até HH:MM\" e, depois, \"Você ficou Indisponível porque não voltou da pausa\"); na Monitoria Online (\"Sem responder ninguém · Indisponível às HH:MM\" e \"Indisponível pelo sistema: não respondia ninguém\"); e na linha do tempo da presença do Anjo, na Jornada." },
      { q: "Quem muda os 20 e os 10 minutos?", a: "São da organização inteira (um Anjo pode atender vários Grupos), no padrão da organização em \"Tempos de resposta\": 1 a 240 minutos para entrar na pausa e 1 a 120 minutos na pausa. O Coordenador de um Grupo só vê os valores. O Anjo nunca escolhe essa pausa." },
    ],
  },
  {
    id: "transferencia",
    title: "Transferência pela coordenação",
    eyebrow: "Quando o Anjo precisa sair",
    items: [
      { q: "Quem transfere um atendimento?", a: "O Coordenador de Anjos (nos pedidos do alcance dele) e o Administrador geral, pelo Painel dos Anjos, num pedido em atendimento. O próprio Anjo não transfere." },
      { q: "Para quem?", a: "Para um Anjo que pode receber AGORA (mesma regra da distribuição). Os outros aparecem desabilitados com o motivo. Sem ninguém, dá para \"Devolver à frente da fila\": o pedido mantém a entrada original e não volta para o Anjo que saiu." },
      { q: "O operador fica sabendo do motivo?", a: "Não. O motivo é obrigatório (3 a 500 caracteres) e fica só para a coordenação e na auditoria. O operador vê apenas que a conversa passou para outra pessoa do Apoio. Atendimento transferido não tem classificação nem avaliação e não conta como abandono." },
    ],
  },
  {
    id: "classificacao",
    title: "Classificação e avaliação",
    eyebrow: "Depois do atendimento",
    items: [
      { q: "O que o Anjo classifica?", a: "Ao encerrar, três escolhas: o MOTIVO de o operador ter precisado dele (Falta de processo cadastrado; Falta de alinhamento ou orientação disponível; Pergunta mal formulada; Informação existente em processo que poderia ter sido encontrada; Informação que poderia ter sido obtida pelo sistema ou por outra IA; Sem acesso à ferramenta ou ao sistema; Ferramenta ou sistema indisponível; Outro), o RESULTADO (Resolvido no atendimento; Orientado, depende de ação do operador; Encaminhado à liderança ou a outra área; Não resolvido) e a PERTINÊNCIA (Pertinente ou Não pertinente). Motivo e resultado são independentes: nada vira \"resolvido\" sozinho." },
      { q: "Todo atendimento é classificado?", a: "Quase todos. Só dois não pedem classificação: o transferido pela coordenação e o que o Anjo perdeu por ficar sem responder. Os demais pedem, inclusive quando o OPERADOR abandonou (parou de responder e deixou o Anjo livre, ou saiu da INIA no meio) e quando o atendimento foi interrompido porque o Anjo caiu — ele classifica ao voltar. A classificação fica pendente na área do Anjo até ser feita." },
      { q: "O operador abandonou o atendimento. Ele ainda avalia?", a: "Pode avaliar, em até 24 horas depois do fim, como em qualquer atendimento concluído. Não avaliam: o atendimento interrompido (o Anjo caiu), o transferido e o que o Anjo perdeu por falta de resposta." },
      { q: "Como o operador avalia?", a: "Depois do atendimento: \"Sua dúvida foi resolvida?\" (Sim, Em parte, Não) e de 1 a 5 estrelas, gravados juntos em \"Enviar avaliação\". Vale por 24 horas depois do fim; dá para atualizar dentro desse prazo. Atendimento interrompido não é avaliado." },
      { q: "A avaliação do Anjo se mistura com a da INIA?", a: "Nunca. São três avaliações separadas: o feedback no Acompanhamento, a resposta da INIA (curtir/descurtir) e o atendimento do Anjo. Ausência de descurtida ou de pedido nunca prova que a resposta resolveu." },
    ],
  },
  {
    id: "abandono",
    title: "Abandonos",
    eyebrow: "Como é contado",
    items: [
      { q: "O que é abandono na espera?", a: "Pedidos que entraram na fila no período e terminaram porque o operador desistiu antes de um Anjo assumir: fechou a INIA (2 minutos sem sinal) ou cancelou. Taxa = abandonos ÷ pedidos do período. Expirado (ninguém atendeu a tempo) aparece à parte e NÃO é abandono — quem encerra é o sistema." },
      { q: "O que é abandono do operador no atendimento?", a: "Saiu da INIA no meio (encerrado como \"Operador sem a INIA aberta\") ou parou de responder (o Anjo foi liberado e o pedido passou a aguardar o operador). Se depois ele não volta, o pedido aparece em \"Como os pedidos terminaram\" como \"Abandonado: o operador não voltou\" — é o mesmo abandono, não conta duas vezes." },
      { q: "O que é abandono do Anjo?", a: "Parou de responder (perdeu o atendimento) ou saiu — deslogou, o login venceu ou a conta foi desligada — derrubando o operador. Tem número e taxa próprios: no bloco de Abandonos, no card \"Abandonos do Anjo\" e na coluna da tabela por Anjo." },
      { q: "O que NÃO conta como abandono?", a: "Encerramento normal (pelo Anjo ou pelo operador), transferência pela coordenação, queda de REDE do Anjo e papel de Anjo retirado pela coordenação. A queda de rede e o papel retirado aparecem à parte, marcados \"não conta como abandono\"." },
      { q: "Como vejo quem abandonou?", a: "Clique no número de cada card de Abandonos (\"Ver quem\"), em Indicadores ou na Monitoria Online: abre a lista de quem abandonou — operadores que desistiram na espera, Anjos que abandonaram o atendimento ou operadores que abandonaram já em atendimento —, mais recentes primeiro, com data e hora, o motivo, o outro lado do atendimento, o Grupo e o protocolo do pedido de origem (clicar abre a conversa). A lista usa o mesmo período, os mesmos filtros e a mesma regra do número, só com quem está no seu alcance, e é paginada." },
      { q: "Qual é a base das taxas de abandono no atendimento?", a: "Os atendimentos acolhidos no período e já encerrados, sem os transferidos. A taxa do Anjo e a do operador usam essa mesma base." },
    ],
  },
  {
    id: "indicadores",
    title: "Indicadores e como são calculados",
    eyebrow: "Painel dos Anjos",
    items: [
      { q: "Quais regras valem para todos os indicadores?", a: "Período de até 92 dias, em datas do fuso da organização. Toda taxa mostra numerador e denominador. Sem base = \"Sem dados\" (nunca 0%). Base pequena (menos de 5) = \"Poucos dados\". Toda média diz quantos itens entraram nela." },
      { q: "Quais indicadores medem as respostas da INIA?", a: "Respostas da INIA no chat; respostas avaliadas (curtida ou descurtida); curtidas entre as avaliadas (é a opinião de quem avaliou, não \"assertividade\"); motivos das descurtidas; descurtidas com pedido de ajuda; respostas em que a consulta falhou (marcadas pelo sistema)." },
      { q: "Quais indicadores medem pedidos e atendimentos?", a: "Sugestões de falar com um Anjo (por origem); pedidos de apoio (por origem); tentativas sem Anjo em serviço (no máximo 1 por pessoa a cada 10 min); como os pedidos terminaram; espera até receber um Anjo (90% dos pedidos em até…); primeira resposta do Anjo (mediana e 90%); duração do atendimento (interrompidos à parte); por que o operador precisou do Anjo; resultado do atendimento; dúvida resolvida, segundo o operador; estrelas do atendimento (média com 5 notas ou mais)." },
      { q: "O que significam os tempos do Anjo?", a: "Espera do operador: da entrada na fila até um Anjo assumir (pedido devolvido conta desde a primeira entrada). Tempo médio de acolhimento: do recebimento do atendimento até a PRIMEIRA RESPOSTA do Anjo. Tempo médio de atendimento: do recebimento até o encerramento, nos atendimentos encerrados (concluídos normalmente separados dos encerrados por outros motivos)." },
      { q: "Como é contada a jornada (tempo online)?", a: "Tempo online = Disponível + Em atendimento + Em pausa (por motivo, incluindo Desconexão). Indisponível (o mesmo que offline) fica fora. Atendimentos ao mesmo tempo contam uma vez. Dia produtivo = (Disponível aguardando + Em atendimento) ÷ tempo online. Os dias são cortados à meia-noite no fuso da organização." },
      { q: "O que é pertinência e falta de retorno?", a: "Pertinência = Pertinente ÷ (Pertinente + Não pertinente), só sobre os classificados com pertinência. Falta de retorno = atendimentos encerrados porque alguém parou de responder ÷ encerrados (sem os transferidos), separando de quem faltou o retorno: do Anjo ou do operador." },
      { q: "O que é \"sem Anjo logado\"?", a: "Pedidos que saíram da fila sem nenhum atendimento quando não havia nenhum Anjo em serviço no escopo — um indicador da operação, sem culpa individual. Pedidos anteriores ao registro aparecem como \"sem registro\"." },
    ],
  },
  {
    id: "onde-fica",
    title: "Onde fica cada coisa",
    eyebrow: "Telas",
    items: [
      { q: "Onde a coordenação acompanha?", a: "Administração › Monitoramento › Painel dos Anjos: Pedidos (lista e conversa somente leitura, transferência), Indicadores (período), Monitoria Online (o agora: operação, fila, quem aguarda, abandonos de hoje, \"Tempos de resposta\") e Jornada e atendimentos (todos os Anjos e cada Anjo, com a linha do tempo da presença). As áreas e cards podem ser reposicionados, redimensionados e escondidos; a disposição fica salva por pessoa." },
      { q: "Onde se configura?", a: "Administração › Plataforma › Configuração dos Anjos (Administrador geral): chave geral, capacidade padrão, liga/desliga por Grupo e Subgrupo, Anjos e capacidade de cada um. Os tempos de resposta ficam na Monitoria Online." },
      { q: "Onde o Anjo vê o próprio histórico?", a: "Na área do Anjo, aba \"Seus atendimentos\" (com \"Perdido: você ficou sem responder\" quando for o caso) e \"Sua jornada\"." },
    ],
  },
]

const PROMPT_INTRO = `Você é um assistente que explica a operação do "Apoio com Anjo" da INIA (Supervisora Virtual com IA) para operadores, Anjos, Coordenadores de Anjos e administradores.

Regras para responder:
- Responda em português do Brasil, de forma curta e direta, com base SOMENTE nas regras abaixo.
- Se a pergunta não estiver coberta pelas regras, diga que não está documentado e sugira procurar a coordenação ou a Wiki (/wiki/apoio-com-anjo); nunca invente regra, número ou prazo.
- Os números são os padrões do produto. Os tempos de resposta e os da pausa "Desconexão" podem ter sido ajustados pela organização ou pelo Grupo: quando citar um tempo, diga que é o padrão.
- Para o operador, quem atende se chama "Apoio" (nunca "Anjo").
- Nunca diga que a INIA lê a conversa com o Anjo, e nunca revele ao operador pausas, motivos de pausa ou o motivo de uma transferência.

REGRAS DA OPERAÇÃO DOS ANJOS`

/** O prompt de referência: instruções + todas as perguntas e respostas da FAQ, na mesma ordem (fonte única). */
export function buildHumanSupportPrompt(sections: readonly FaqSection[] = HUMAN_SUPPORT_FAQ): string {
  const body = sections.map((section) => [`## ${section.title}`, ...section.items.map((item) => `- P: ${item.q}\n  R: ${item.a}`)].join("\n")).join("\n\n")
  return `${PROMPT_INTRO}\n\n${body}\n`
}
