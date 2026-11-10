# Apoio com Anjo — conceito para brainstorm

* **Autor:** Renan Menezes
* **Data:** 2026-11-09
* **Contexto do sistema:** ver `levantamento.md` nesta pasta (estado atual do código, com arquivo e linha).

## O que é a INIA

A INIA é uma supervisora virtual com IA para operações de atendimento (call center). O operador conversa com ela num chat (texto e voz) para tirar dúvidas de processo e consultar os próprios resultados. As respostas vêm de agentes especialistas que consultam bases de conhecimento. O backend é um monólito modular em TypeScript/Express com PostgreSQL; roda como N instâncias de API e M workers atrás do IIS (ARR, sem afinidade de sessão).

## Problema

Hoje não se sabe quanto a INIA resolve a necessidade do colaborador no chat, nem em quais situações ele precisa de uma pessoa. O chat grava curtir/descurtir sem motivo, e não existe caminho para um humano ajudar. Ausência de descurtida ou de pedido de ajuda **não** prova que a resposta foi correta nem que a dúvida foi resolvida.

## Objetivo

1. Medir a percepção do colaborador sobre cada resposta da INIA, a necessidade de apoio humano, o motivo identificado pelo apoio humano e o resultado desse apoio — como quatro coisas separadas.
2. Dar ao operador um caminho explícito para falar com uma pessoa ("Anjo") quando a INIA não resolve.

## Regras já decididas pelo dono do produto

### Entrada no apoio

* Descurtir uma resposta da INIA registra a avaliação e abre um formulário simples: motivo (lista fechada) e a pergunta "Você ainda precisa de ajuda com isso?". Se a resposta for sim — com qualquer motivo — aparece a opção "Falar com um Anjo".
* Botão permanente e discreto "Chamar apoio" no chat, visível quando o apoio está ligado para o escopo da pessoa.
* Quando a INIA registra, por sinal **estruturado** (nunca por frase no texto da IA), que não encontrou a informação ou não conseguiu consultá-la, ela oferece a opção de falar com um Anjo.
* Oferta não cria atendimento. O pedido só existe quando o operador confirma explicitamente. Cliques repetidos não criam pedidos duplicados.
* O Anjo vê só a troca que originou o pedido (a pergunta e a resposta da INIA), o motivo da descurtida e o que o operador escrever. Antes de enviar, o operador vê exatamente o que será compartilhado. Pelo botão, sem resposta associada, só o que ele escrever.

### Papel, configuração e escopo

* "Anjo" é um papel de acesso específico, concedido por escopo (organização, Grupo ou Subgrupo) pela estrutura de papéis que já existe; tudo é validado no servidor.
* O Administrador geral liga e desliga a funcionalidade, habilita para Grupos e Subgrupos e configura quais Anjos atendem cada escopo.
* Ter o papel Anjo não dá acesso amplo às conversas: o Anjo vê o que foi compartilhado nos pedidos que atende.
* Papel novo "Coordenador de Anjos" (com escopo) e o Administrador geral veem relatórios (agregados e por Anjo), conversas de apoio e motivos de pausa do escopo, com registro LGPD de cada leitura. O operador nunca vê o motivo de pausa, nem em respostas de API destinadas a ele.
* Desligar o apoio (geral ou de um Grupo/Subgrupo): pedidos novos são bloqueados na hora; pedidos na fila são cancelados com aviso ao operador; atendimentos em andamento continuam até alguém encerrar.

### Disponibilidade, fila e espera

* O Anjo declara disponibilidade, entra em pausa escolhendo um motivo (lanche, pessoal, processo, reunião), recebe e conversa com operadores, e classifica cada atendimento.
* Distribuição **automática**: o sistema oferece o pedido ao Anjo disponível do escopo livre há mais tempo. O Anjo tem 30 s para aceitar; recusou ou deixou passar, o pedido vai ao próximo e mantém o lugar na fila. Quem deixa passar sem responder sai de "Disponível" até voltar por conta própria.
* Capacidade: até 2 atendimentos simultâneos por Anjo por padrão; o Administrador geral ajusta por Anjo, de 1 a 5.
* Sem nenhum Anjo em serviço no escopo (ninguém disponível, ocupado ou em pausa): o pedido não é criado; aparece "Nenhum Anjo disponível agora" e a tentativa é registrada. Com Anjos em serviço (mesmo todos ocupados ou em pausa), o pedido entra na fila e expira se ninguém aceitar em 20 min (ajustável pelo Administrador geral).
* Espera estimada mostrada ao operador = **mediana** do tempo de espera dos atendimentos dos últimos 14 dias do mesmo Subgrupo (senão Grupo, senão organização), com mínimo de 10 atendimentos; abaixo disso, "Ainda não há histórico para estimar" — nunca zero nem tempo inventado. Indicação explícita de que é estimativa. "Anjos ocupados" é diferente de "nenhum Anjo disponível".
* O operador pode cancelar o pedido na fila.

### Conversa humana

* O operador sempre percebe que pediu ajuda humana, quando está na fila, quem entrou, quando está falando com o Anjo e quando o atendimento foi encerrado.
* A INIA não lê as mensagens humanas entre operador e Anjo — nem no contexto, nem em resumos, ferramentas ou qualquer caminho que envie texto a um modelo.
* Autoria, ordenação, auditoria e a distinção entre mensagem de IA e mensagem humana são preservadas.

### Encerramento, classificação e avaliação

* O operador pode encerrar a conexão com o Anjo a qualquer momento, sem impedir a classificação posterior do Anjo. O Anjo também pode encerrar.
* Atendimento encerrado nunca é reaberto; nova necessidade = novo pedido, preservando o histórico.
* O Anjo classifica o **motivo do encaminhamento**: falta de processo cadastrado; falta de alinhamento ou orientação disponível; pergunta mal formulada; informação existente em processo que poderia ter sido encontrada; informação que poderia ter sido obtida pelo sistema ou por outra IA (por exemplo a "IAjuda"). Título do processo/sistema/IA obrigatório nos dois últimos casos, opcional em "pergunta mal formulada"; link sempre opcional.
* O Anjo registra o **resultado** separado do motivo (existir um processo não prova que a dúvida foi resolvida).
* O operador avalia ao encerrar: "Sua dúvida foi resolvida?" (Sim / Em parte / Não) e estrelas de 1 a 5 — ambos opcionais, contados separados, alteráveis por 24 h com histórico.

### Medição

Funil com respostas avaliadas e cobertura, curtidas/descurtidas e motivos, ofertas e solicitações efetivas, origem da solicitação, pedidos atendidos/cancelados/abandonados/expirados, espera e duração, classificação do Anjo, resolução declarada e estrelas com cobertura. Denominadores, períodos, escopos e dado ausente explícitos. Nenhuma taxa chamada de "assertividade" sem dizer exatamente o que mede. A avaliação do feedback do Acompanhamento, a avaliação da resposta da INIA e a avaliação do atendimento do Anjo ficam separadas. A Monitoria de usabilidade (desligada) não pode ser religada como efeito colateral, e conteúdo sensível não é duplicado em eventos analíticos.

## Propostas de solução (ainda em discussão)

1. **Sala de apoio no mesmo painel.** O apoio é uma conversa própria ("Apoio com Anjo") exibida no mesmo painel do chat, como as conversas anteriores já são. Nela tudo o que se digita vai só ao Anjo e a voz da INIA fica desligada; a conversa com a INIA continua acessível por um selo de estado ("Apoio: na fila há 3 min", "Apoio: com Ana").
2. **Mensagens humanas em tabelas próprias**, nunca em `assistant_interactions`; um teste de estrutura impede que caminhos de IA as leiam.
3. **Atualização por espera longa (long-poll)**: o navegador faz uma requisição que o servidor segura por até ~25 s e responde assim que algo muda; um `NOTIFY` do PostgreSQL acorda a espera e uma releitura curta no banco cobre falhas do `NOTIFY`. Compatível com várias APIs sem afinidade; reautentica a cada requisição; não depende de WebSocket no IIS.
4. **Sinais de "não encontrei" gravados com a resposta** (consulta às bases sem trecho, esclarecimento que concluiu que as bases não sustentam, consulta que falhou, especialista bloqueado, resposta que não foi gerada) e a oferta registrada com o motivo.
5. **Presença**: disponibilidade declarada pelo Anjo + posse de conexão com prazo renovada pela área de trabalho aberta + capacidade. A sessão continua expirando após 30 min sem ação (regra de segurança); a área de trabalho pergunta "Ainda está aí?" antes disso.
