# Apoio com Anjo e avaliação da resolutividade do chat

* **Autor:** Renan Menezes
* **Status:** Aprovado — v4 (aprovado pelo dono do produto em 09/11/2026). Parte A (A0/A1) e Parte B (B0/B1) implementadas em 09/11/2026, sem commit; o piloto (B1 ligada num Subgrupo) depende do roteiro do IIS e das migrations 181/182 no ambiente. Ajustes de detalhe em [Notas da implementação da Parte A](#notas-da-implementação-da-parte-a) e [da Parte B](#notas-da-implementação-da-parte-b). Revisão EGM concluída na v3.1; v4 aplica as decisões D1–D12 do dono do produto, entre elas a atribuição direta ao Anjo no lugar da oferta com aceite; ver [Decisões](#decisões-do-dono-do-produto) e [review/goldfish_review_report.md](review/goldfish_review_report.md)
* **Data:** 2026-11-09
* **Insumos:** [concepts_brief.md](concepts_brief.md) (brainstorm), [levantamento.md](levantamento.md) (estado atual do código, base `b2fca0dd`), [feature_concept.md](feature_concept.md).

--------------------------------------------------------------------------------

## Overview

O operador de atendimento conversa com a INIA para tirar dúvidas de processo. Hoje não se sabe quanto ela resolve, nem quando ele precisa de uma pessoa. A entrega tem duas partes, e a primeira não depende da segunda:

* **Parte A — resolutividade do chat.** Motivo da descurtida e a pergunta "Você ainda precisa de ajuda com isso?"; sinais gravados por código quando a INIA não encontrou a informação ou não conseguiu consultá-la. Os dados são coletados desde a Parte A; as medidas M1–M6 aparecem no painel da Parte B (D7).
* **Parte B — Apoio com Anjo.** O operador pede ajuda; o sistema entrega o pedido direto a um Anjo disponível (pessoa com papel próprio); os dois conversam numa sala do mesmo painel do chat, sem que nenhum texto vá a um modelo de IA; o Anjo classifica o atendimento e o operador o avalia; medidas M7–M18, incluindo quanto tempo o Anjo leva para responder.

## The Problem

O chat grava curtir/descurtir sem motivo (`backend/migrations/158_assistant_interaction_ratings.sql`) e não existe caminho para um humano ajudar. A ausência de descurtida ou de pedido de ajuda não prova que a resposta estava certa nem que a dúvida foi resolvida, e hoje não há outro dado. Sem um caminho humano, também não se sabe **por que** a INIA falhou: falta de processo cadastrado, pergunta mal formulada, informação que existia e não foi encontrada.

## Goals

* **G1.** O formulário de descurtida de resposta da INIA no chat livre envia, numa só chamada, um motivo de lista fechada e a resposta a "ainda precisa de ajuda?".
* **G2.** Toda mensagem da INIA gravada no chat livre é gravada junto com uma lista de sinais calculada por código (vazia quando nada aconteceu). Os sinais estão na seção 3.
* **G3.** O operador pede um Anjo pelo botão permanente, pela descurtida com necessidade declarada ou pela sugestão após um sinal, e sempre vê em texto se está na fila (e até quando), quem recebeu o pedido, se o Anjo já respondeu, se o Anjo está sem conexão e se o atendimento acabou.
* **G4.** Nenhuma mensagem do apoio chega a um modelo de IA. Garantido pelos testes de estrutura da seção 10 (servidor e navegador) e por encerrar a sessão de voz ao abrir a sala.
* **G5.** Um pedido nunca fica com dois Anjos ao mesmo tempo e cliques repetidos nunca criam dois pedidos, com várias APIs atrás do IIS sem afinidade — garantido pelos índices únicos e pela distribuição sob trava da seção 8.
* **G6.** O Administrador geral liga e desliga a funcionalidade, habilita por Grupo e Subgrupo e define quem atende cada escopo, com validação no servidor.
* **G7.** Funil com numerador, denominador, período, recorte e dado ausente explícitos, calculado só a partir das tabelas do chat e do apoio — sem eventos da Monitoria de usabilidade — e visível só para Coordenador de Anjos e Administrador geral.

## Non-Goals

* Mudar a avaliação do feedback do Acompanhamento ("Este conteúdo foi útil?" e a contestação).
* A IA ler, resumir ou aprender com conversas humanas.
* Anexos, áudio ou voz na sala de apoio.
* WebSocket.
* `LISTEN/NOTIFY` nesta versão.
* Campo novo no prompt para o modelo declarar "não sei".
* Anjo atendendo por "Minha estrutura".
* Pedido de apoio feito pela liderança em nome de um operador.
* Anjo devolver ou transferir um pedido para outro Anjo.
* Sugestão de Anjo na sessão de feedback e em conversas de recado.
* Integração com a IAjuda ou outra IA.
* Ligar a Monitoria de usabilidade.
* Tela "quem lê suas conversas" (trabalho não commitado de outra frente).
* Mostrar os números da resposta da INIA em "Conversas com a INIA" (D7).
* Corrigir `assistant_interaction_agents.outcome = FAILED`, que hoje nunca é gravado (`assistant-conversations.ts:204-208`): proposta de PR próprio.

## Glossário

Termos de produto. Códigos entre parênteses.

| Termo | Significado |
| --- | --- |
| Operador | Colaborador que conversa com a INIA. |
| **Anjo** (`ANJO`) | Pessoa com o papel de acesso Anjo (pode ser supervisor, assistente ou outra função); atende pedidos de apoio dos escopos do papel. Para o operador: "uma pessoa da equipe de apoio". |
| **Coordenador de Anjos** (`COORDENADOR_DE_ANJOS`) | Papel que vê o painel do apoio: funil, pedidos, conversas de apoio, tentativas sem Anjo, presença e pausas de um escopo. |
| Administrador geral (`ADMINISTRADOR_GERAL`) | Papel existente de autoridade ampla na organização. |
| Bases de conhecimento | Documentos que a INIA consulta para responder. |
| Especialista | Agente de IA que a INIA aciona para consultar bases ou dados e devolver o resultado. |
| Esclarecimento pelas bases | Fluxo em que a INIA pergunta ao operador o que falta para responder; termina respondido, "as bases não sustentam" ou "sem convergência". |
| Chat livre | Conversa do operador com a INIA aberta por ele (`assistant_conversations.origin = USER`). Diferente da **sessão de feedback** (conversa sobre um feedback publicado, "Ouvir com a INIA") e do **recado** (mensagem de um Workflow no chat). |
| Acompanhamento | Área onde o colaborador lê feedbacks publicados; tem avaliação e contestação próprias. |
| Monitoria de usabilidade | Coleta de uso de telas do produto, hoje desligada. |
| IAjuda | Outra IA da empresa, citada só como texto na classificação. |
| **Formulário da descurtida** | Popover aberto pelo polegar para baixo, com motivo, comentário e "ainda precisa de ajuda?". |
| **Sinal** | Código gravado com a mensagem da INIA dizendo o que aconteceu na consulta (seção 3). Não é motivo. |
| **Sugestão de apoio** | A tela propõe "Falar com um Anjo" depois de um sinal ou de uma descurtida com necessidade. Não cria nada. |
| **Pedido** | Existe quando o operador confirma. Tem protocolo (ex.: `AP-7K2QX9`). **Pedido aberto** = Na fila ou Em atendimento. Estados: Na fila (`WAITING`), Em atendimento (`IN_PROGRESS`), Encerrado (`CLOSED`), Cancelado (`CANCELLED` — pelo operador ou porque o escopo foi desligado), Expirado (`EXPIRED`), Abandonado (`ABANDONED`). |
| Origem do pedido | `BUTTON`, `DISLIKE` ou `SIGNAL` (seção 7). |
| **Prazo da fila** | Até quando o pedido espera um Anjo antes de expirar; calculado pelo sistema a partir do histórico e mostrado ao operador como horário (seção 9). |
| **Cópia da troca** | O que o Anjo recebe do chat: texto da pergunta, texto da resposta da INIA (quando houver), motivo e comentário da descurtida (quando houver) e a nota do operador. Fica gravada no pedido. |
| **Atribuição** | O sistema entrega o pedido a um Anjo disponível com vaga; o atendimento começa nesse instante, sem aceite. |
| **Atendimento** | Da atribuição até o fim. Um pedido pode ter mais de um atendimento. **Primeira resposta** = primeira mensagem do Anjo no atendimento. **Interrompido** = atendimento encerrado porque o Anjo ficou sem conexão por 3 min (a **carência**) ou perdeu o papel; o pedido volta para a fila. |
| Sala de apoio | Vista do painel do chat em que o operador conversa com o Anjo. **Selo de apoio** = indicador na vista da INIA que leva à sala. |
| Área do Anjo | Página de trabalho do Anjo (`/apoio`). |
| Estado declarado do Anjo | Disponível (`AVAILABLE`), Em pausa (`PAUSED`, com motivo), Indisponível (`OFFLINE`). |
| Motivo da pausa | Lanche, Pessoal, Atividade de processo, Reunião. Nunca visto pelo operador. |
| **Conectado** | A área do Anjo está aberta e chamando o servidor (calculado, nunca gravado como estado). **Sem conexão** = o contrário. |
| **Em serviço** | Disponível ou Em pausa, e conectado. |
| Capacidade / vaga | Quantos atendimentos o Anjo pode ter ao mesmo tempo (padrão 2, de 1 a 5). |
| Motivo da descurtida · Motivo do encaminhamento · Resultado · Resolução declarada | Escolhido pelo operador ao descurtir · classificado pelo Anjo · declarado pelo Anjo · resposta do operador a "Sua dúvida foi resolvida?". |
| Escopo · escopo congelado · alcance | Organização, Grupo ou Subgrupo · Grupo/Subgrupo do operador gravados no pedido na criação · o que um papel com escopo deixa ver (seção 5). |
| Chave geral · estado do escopo | Liga/desliga da organização · Herdar, Ligado ou Desligado por Grupo/Subgrupo. **Desligar** sempre se refere a eles; parar um processo da API chama-se **dreno**. |
| Chave de idempotência | Id gerado pelo navegador para um pedido (`clientRequestId`) ou mensagem (`clientMessageId`): reenviar com o mesmo id devolve o que já foi criado. |
| Chamada de estado · chamada longa | `GET /me/state`; quando o servidor segura a resposta até algo mudar (seção 11). |
| Versão por pessoa | Número que sobe a cada mudança que a pessoa vê; a chamada longa compara com ele. |

## Open Questions

* **OQ1.** A chamada longa pelo ARR nunca foi validada num Windows real. A validação é pré-condição da fase B1 ([Fases](#fases)); a reserva por chamada curta está no plano desde o início.
* **OQ2.** O Anjo vê as notas que recebe? Proposta desta versão: não vê (nem agregadas); só o Coordenador de Anjos e o Administrador geral.
* **OQ3.** Lista de Resultado declarada pelo Anjo. Proposta: Resolvido no atendimento · Orientado, depende de ação do operador · Encaminhado à liderança ou a outra área · Não resolvido.
* **OQ4.** Rótulo do botão permanente. Proposta: "Falar com um Anjo", com dica "Pedir ajuda a uma pessoa da equipe de apoio" — o mesmo texto das sugestões.

### Decisões do dono do produto

Respostas de 09/11/2026 às decisões abertas da v3.1:

* **D1.** Entrega em duas partes, A antes de B.
* **D2.** **Atribuição direta** (substitui a oferta com 30 s para aceitar, decidida no brainstorm): o pedido vai direto a um Anjo disponível com vaga e já fica Em atendimento; se o Anjo não responder, continua Em atendimento; o tempo até a primeira resposta do Anjo é medido (M12) — inclusive por Anjo (M18).
* **D3.** Com todos os Anjos em serviço em pausa, o pedido entra na fila e o operador vê "Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila."
* **D4.** Sem Anjo em serviço, o botão "Pedir ajuda" fica desabilitado; a tentativa é registrada e aparece no painel do apoio (lista "Sem Anjo em serviço" e M9), para Coordenador de Anjos e Administrador geral.
* **D5.** O Anjo relê os atendimentos que fez (enquanto tiver o papel de Anjo).
* **D6.** A classificação do Anjo entra na exportação de dados do operador (LGPD).
* **D7.** Os números da resposta da INIA (M1–M6) só aparecem no painel do apoio, para Coordenador de Anjos e Administrador geral.
* **D8.** Tirar a rolagem da lista de interações do aviso de inatividade vale para todo o app.
* **D9.** Mantidas: um pedido aberto por operador; "Outro (descreva)" na classificação; pausa com atendimento aberto só impede novas atribuições; reduzir a capacidade não corta atendimento; som e título da aba quando um atendimento chega ao Anjo.
* **D10.** A resposta da INIA sempre vai ao Anjo como contexto. Consequência aceita: quando a pergunta for de quem lidera, a resposta pode trazer resultados de outros colaboradores, e o Anjo os vê; a prévia mostra ao operador exatamente o que será compartilhado.
* **D11.** Presença, pausas e números de um Anjo são vistos pelo Coordenador de Anjos cujo escopo cobre um dos escopos do papel do Anjo; Anjo com escopo de organização só por Coordenador de organização e Administrador geral.
* **D12.** Prazo da fila calculado pelo sistema a partir do histórico (seção 9), mostrado ao operador como horário; ninguém o configura.

## Critical User Journeys (CUJs)

### CUJ 1: Operador descurte, ainda precisa de ajuda e é atendido

* **Given:** apoio ligado para o Subgrupo do operador; Anjo A sem atendimento e Anjo B com um, ambos disponíveis e conectados.
* **When:** o operador clica no polegar para baixo de uma resposta, escolhe "Informação errada", responde "Sim" a "Você ainda precisa de ajuda com isso?" e envia; clica em "Falar com um Anjo"; vê a prévia ("O Anjo verá: sua pergunta, a resposta da INIA, o motivo, seu comentário e o que você escrever"); escreve uma nota e clica em "Pedir ajuda".
* **Then:** o pedido é criado com protocolo e origem `DISLIKE` e, na mesma hora, atribuído ao Anjo A (o com menos atendimentos); a sala de apoio abre no painel com "Ana (Anjo) recebeu seu pedido. Aguardando a primeira resposta."; a área de Ana toca um som e abre o atendimento com a cópia da troca; quando Ana escreve, o tempo até a primeira resposta é gravado; nada da sala entra no histórico da INIA.

### CUJ 2: A INIA não encontra e sugere o Anjo

* **Given:** apoio ligado; pergunta que nenhuma base cobre.
* **When:** a resposta é gravada; o especialista consultou as bases e nenhum trecho serviu, e nenhuma ferramenta trouxe dado.
* **Then:** a resposta é gravada com o sinal `KNOWLEDGE_NOT_FOUND`; abaixo dela aparece "A INIA não encontrou essa informação nas bases. Falar com um Anjo"; o servidor registra a sugestão elegível; nada é criado até o operador confirmar.

### CUJ 3: Nenhum Anjo em serviço

* **Given:** apoio ligado; nenhum Anjo do escopo conectado.
* **When:** o operador abre "Falar com um Anjo".
* **Then:** a janela mostra "Nenhum Anjo em serviço agora" e o botão "Pedir ajuda" fica desabilitado; a tentativa é registrada (D4) e aparece no painel do apoio; o texto digitado continua na janela; se um Anjo ficar disponível com a janela aberta, o botão é habilitado.

### CUJ 4: Todos os Anjos ocupados ou em pausa

* **Given:** apoio ligado; os Anjos do escopo estão conectados, mas sem vaga ou em pausa.
* **When:** o operador pede ajuda.
* **Then:** o pedido entra na fila; o operador vê "Todos os Anjos estão em atendimento" (ou, com todos em pausa, "Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila.", D3), a espera estimada e "Seu pedido fica na fila até 14:35"; assim que um Anjo fica disponível com vaga, o pedido é atribuído; se o horário passar, o pedido expira com aviso.

### CUJ 5: Anjo trabalha um turno

* **Given:** pessoa com o papel Anjo no Grupo X.
* **When:** abre a área do Anjo, clica "Ficar disponível", recebe um atendimento, responde, entra em pausa "Lanche" com o atendimento aberto, encerra o atendimento, classifica e volta a ficar disponível.
* **Then:** a pausa só impede novas atribuições; a classificação fica pendente até ser enviada sem impedir atribuições; o operador nunca vê o motivo da pausa.

### CUJ 6: Anjo perde a conexão no meio do atendimento

* **Given:** atendimento em andamento.
* **When:** a área do Anjo para de chamar o servidor (rede, aba fechada ou sessão expirada).
* **Then:** até 75 s depois da última chamada (prazo da conexão) mais até 3 s (distribuição), o operador vê a mensagem de sistema "O Anjo está sem conexão. Aguardando…"; se o Anjo voltar em até 3 min **contados do fim do prazo de 75 s**, aparece "O Anjo voltou" e tudo segue; se não, o atendimento termina como Interrompido, o pedido volta para a frente da fila e o operador é avisado; o Anjo que saiu ainda pode classificar.

### CUJ 7: Administrador geral habilita um Grupo e exclui um Subgrupo

* **Given:** chave geral ligada; Grupo X com Subgrupos X1 e X2.
* **When:** marca Grupo X como Ligado e X2 como Desligado; concede o papel Anjo a três pessoas com escopo Grupo X; ajusta a capacidade de uma delas para 3.
* **Then:** a tela mostra X1 "Ligado (herdado do Grupo)" e X2 "Desligado", com os Anjos que atendem cada um; operadores de X2 não veem o botão nem a sugestão de Anjo (a descurtida continua com motivo e pergunta).

### CUJ 8: Desligar o escopo com fila e atendimento em andamento

* **Given:** Subgrupo com um pedido na fila e um atendimento em andamento.
* **When:** o Administrador geral desliga o Subgrupo.
* **Then:** pedidos novos são recusados na hora; o pedido da fila é cancelado com "O apoio com Anjo foi desativado para sua equipe"; o atendimento em andamento continua até alguém encerrar.

### CUJ 9: Coordenador acompanha

* **Given:** pessoa com o papel Coordenador de Anjos no Grupo X, sem nenhum outro papel administrativo.
* **When:** entra em Administração (área isolada: só as telas do Coordenador abrem, como já acontece com "Conversas com a INIA", `frontend/src/app/(app)/admin/layout.tsx:23-26`) › Monitoramento › Apoio com Anjo.
* **Then:** vê o funil do período (M1–M17) com numerador e denominador, a lista de tentativas sem Anjo em serviço, os Anjos que atendem o Grupo X com pausas, tempo até a primeira resposta e números (M18), e pode abrir uma conversa de apoio; a abertura fica no registro LGPD (uma linha para o operador e uma para cada Anjo do pedido).

## Technical Plan (Architecture)

### 1. Módulos e fronteiras

```text
navegador                                         backend (N APIs + M processamentos, PostgreSQL)
──────────                                        ─────────────────────────────────────────────
chat da INIA (operator-inia-chat)                 realtime-router (apresentação)
  formulário da descurtida ── PUT rating ───────▶   ├─▶ assistant: avaliação + detalhes; mensagem + sinais (mesma transação)
  sinais na mensagem ◀─── GET messages ─────────    ├─▶ human-support.recordSuggestion (injetada; só registra o evento)
  selo de apoio                                      └─ (assistant nunca importa human-support)
sala de apoio (components/human-support)  ──▶     human-support (apresentação → aplicação)
  campo próprio, sem microfone                       ├─▶ assistant.buildSupportContext (cópia da troca)
área do Anjo (/apoio)                     ──▶        ├─▶ access.personIdsWithPermissionCovering / assignmentScopesOf
                                                     └─ tarefa periódica `human-support-dispatch` (3 s)
painel do apoio (Coordenador, Adm. geral)  ───▶   human-support.metrics ─▶ assistant.replyFunnel (M1–M6)
```

* Módulo novo `backend/src/modules/human-support/{domain,application,presentation,testing}` (sem `infrastructure/`: o SQL fica na aplicação, como em `feedback-rating`).
* `assistant` nunca importa `human-support`. O `realtime-router` chama `assistant` (avaliação, sinais) e a função `recordSuggestion` recebida por injeção (`createApp` a passa; ausente = nada é registrado).
* O que `human-support` usa de fora, e nada mais:

| De onde | O quê | Para quê |
| --- | --- | --- |
| `assistant/application/support-context.ts` | `buildSupportContext` | prévia e criação do pedido (seção 7) |
| `assistant/application/reply-funnel.ts` | `replyFunnel` | M1–M6 no painel do apoio |
| `access/application/permission-holders.ts` | `personIdsWithPermissionCovering(db, organizationId, permission, { teamId, subteamId })` → ids | quem atende um escopo |
| `access/application/permission-holders.ts` | `assignmentScopesOf(db, organizationId, permission, personIds)` → `Map<personId, AccessScope[]>` (nova) | escopos de cada Anjo: "Ficar disponível", passo 6 da distribuição, aba Anjos, alcance D11 |
| `profile-preferences/application/person-presentation-loader.ts` | `loadPersonPresentations(db, organizationId, personIds)` | nome preferido e foto de operador e Anjo |
| Tabelas estruturais da organização, só leitura | `people` (`id`, `team_id`, `subteam_id`, `active`), `teams`, `subteams` (nomes, Grupo do Subgrupo) | lugar da pessoa (liga/desliga, escopo congelado) e nomes de Grupo/Subgrupo |

Nenhuma outra tabela de outro módulo é lida (nem `access_role_assignments`, nem `user_accounts`, nem tabelas do `assistant`).

### 2. Parte A — avaliação da resposta

**Tela.** Os polegares continuam onde estão (`frontend/src/components/operator/operator-inia-chat/chat-message-list.tsx:119`). Curtir grava como hoje. O polegar para baixo **só abre** o formulário da descurtida (Popover, nunca Sheet), `operator-inia-chat/dislike-form.tsx`:

* Motivo, obrigatório (`CHAT_DISLIKE_REASONS_V1`):
  * Informação errada (`WRONG_INFORMATION`)
  * Não respondeu o que perguntei (`DID_NOT_ANSWER`)
  * Não encontrou a informação (`NOT_FOUND`)
  * Resposta incompleta (`INCOMPLETE`)
  * Difícil de entender (`HARD_TO_UNDERSTAND`)
  * Outro (`OTHER`)
* Comentário: opcional, até 1000 caracteres; obrigatório (3–1000) em "Outro".
* "Você ainda precisa de ajuda com isso?" Sim / Não, obrigatório.
* "Enviar" grava tudo numa chamada e espera a confirmação; falha aparece no formulário.
* Fechar sem enviar não grava nada.
* Depois de enviar com "Sim": se o apoio estiver ligado para a pessoa (Parte B presente e ligada), o formulário mostra "Falar com um Anjo", que abre a janela de pedido com `interactionId` e `ratingId`; senão, "O apoio com Anjo ainda não está disponível para sua equipe."
* Clicar de novo no polegar descurtido reabre o formulário preenchido, com "Retirar avaliação" (grava `NONE`). Curtir depois de descurtir grava `UP`.
* O formulário aparece só nas respostas do chat livre. Sessão de feedback e recado continuam com os polegares de hoje.
* O pedido de apoio, se existir, não muda com alterações posteriores da avaliação.

**Contrato** (corpo e resposta completos no [Apêndice C](#apêndice-c--contratos)). `PUT /api/v1/realtime/conversations/:conversationId/messages/:interactionId/rating` aceita `{ value: "UP" | "NONE" }` ou `{ value: "DOWN", details? }` e devolve a avaliação vigente com `ratingId` e `details`.

Hoje cada avaliação é uma linha nova; a anterior recebe `superseded_at`; a vigente é a sem `superseded_at`; o mesmo valor repetido não grava (`assistant/domain/assistant-interaction-rating.ts:21-23`). Regras novas, nesta ordem:

1. `DOWN` sem `details` sobre uma vigente `DOWN` com detalhes: não grava nada.
2. `DOWN` sem `details` nos outros casos: grava como hoje (sem detalhes). É o que abas antigas e a sessão de feedback mandam; o funil conta como "motivo não informado". O servidor **não** recusa `DOWN` sem detalhes, em nenhuma fase, para que abas antigas nunca percam a descurtida em silêncio.
3. `DOWN` com `details` diferentes da vigente: grava nova versão.

**Armazenamento.** `assistant_interaction_rating_details` (módulo `assistant`), uma linha por versão `DOWN` com detalhes, com `person_id` (para entrar na exportação do titular). DDL no [Apêndice B](#apêndice-b--ddl). `ConversationStore.rate`, `ConversationStore.ratingsOf` e `loadConversationRatings` (`assistant-interaction-ratings.ts:56`) passam a devolver também `ratingId` e `details`.

### 3. Parte A — sinais da mensagem

**Códigos** (`SUPPORT_SIGNALS_V1`, `assistant/domain/reply-signals.ts`). Um resultado de especialista **tem conteúdo** quando a consulta às bases (`KnowledgeTrace.mode`) foi `RETRIEVAL` ou `FULL`, ou quando alguma ferramenta de investigação dele terminou `COMPLETED` (`toolTrace`). Um resultado direto do backend (dados de resultados, liderança, processo) tem conteúdo quando trouxe cartão ou texto não vazio. `NONE` = nenhuma base autorizada para o especialista; `NO_MATCH` = buscou e nenhum trecho serviu (`retrieve-knowledge.ts:46-47, 357, 417`). O rastro do Orquestrador nunca conta (ele normalmente não tem base, `resolve-orchestrator.ts:45-47`).

| Código | Quando (sobre os resultados da chamada que gravou a mensagem) |
| --- | --- |
| `KNOWLEDGE_NOT_FOUND` | Houve ao menos um especialista consultado, nenhum resultado tem conteúdo e nenhum falhou |
| `KNOWLEDGE_INSUFFICIENT` | O esclarecimento pelas bases terminou `INSUFFICIENT` ou `NOT_CONVERGED` (`clarification-state.ts:93`) |
| `CONSULTATION_FAILED` | Algum resultado falhou (passa a ter `failed: true` em `runOrchestratedReply`; hoje vira só `TOOL_FAILED_TEXT`, `run-orchestrated-reply.ts:160, 418`), ou a conferência da resposta falhou e trocou o texto (decisão de 10/11/2026) |
| `SPECIALIST_BLOCKED` | Alguma chamada de especialista foi bloqueada (`calls[].outcome = BLOCKED_*`, `run-orchestrated-reply.ts:38`) |
| `NO_REPLY` | O turno de texto terminou em erro (evento SSE `error`), não por cancelamento do operador; gravado na **mensagem do operador** |

**Gravação.** `assistant_reply_signals` (DDL no [Apêndice B](#apêndice-b--ddl)), lista que **pode ser vazia**. A linha é gravada por `ConversationStore.append` na mesma transação da mensagem da INIA, quando a conversa é do chat livre (o insert confere `origin = 'USER'` da conversa); `append` recebe `signals` e, sem eles, grava lista vazia. Assim toda mensagem da INIA do chat livre depois da data de corte tem linha; "sem linha" = anterior ao corte. `NO_REPLY` é gravado por `ConversationStore.markNoReply(scope, questionId)` na linha da pergunta. Na voz, cada mensagem tem os sinais da chamada (`/tool-call`) que a produziu.

**Fonte dos sinais por ramo** (`realtime-router.ts`):

| Ramo | Sinais |
| --- | --- |
| `/messages` com Orquestrador (ORCHESTRATED) | `signalsOf` sobre `reply.results`, `reply.calls`, `reply.directResults` |
| `/messages` com esclarecimento (CLARIFICATION) | `KNOWLEDGE_INSUFFICIENT` se o estado terminou assim; etapa aguardando escolha: vazia |
| `/messages` de liderança (LEADERSHIP) | `KNOWLEDGE_INSUFFICIENT` se a consulta de processo terminou num esclarecimento insuficiente; senão vazia |
| `/messages` DATA_ONLY, PERSONA_STREAM, REPORT_PROPOSAL | vazia |
| `/messages` em conversa de feedback | não grava (não é chat livre) |
| `/messages`, evento `error` | `NO_REPLY` na pergunta |
| `/tool-call` especialista | `signalsOf` sobre o resultado desse especialista |
| `/tool-call` especialista bloqueado | `SPECIALIST_BLOCKED` |
| `/tool-call` `answerVoiceAsk` | como ORCHESTRATED |
| `/tool-call` SELF_TOOL, liderança, oferta de report, guarda de proteção | vazia |
| `/voice-turn` | vazia |

O rastreamento do turno (`chat-turn-trace.ts`, `note`) ganha `replyInteractionId` e `supportSignals` (códigos separados por vírgula).

**Sugestão** (Parte B). `GET …/messages` devolve `signals` em cada mensagem (`null` = não calculado). A tela mostra a sugestão quando a mensagem tem sinal e o estado do apoio (`/me/state`, seção 11) diz que o apoio está ligado; com pedido aberto, a sugestão vira "Você já tem um pedido de apoio — ver". `NO_REPLY` aparece abaixo da pergunta do operador quando nenhuma mensagem da INIA veio depois dela. Textos, sem termo interno:

* `KNOWLEDGE_NOT_FOUND`, `KNOWLEDGE_INSUFFICIENT`: "A INIA não encontrou essa informação nas bases."
* `CONSULTATION_FAILED`, `SPECIALIST_BLOCKED`: "A INIA não conseguiu concluir a consulta."
* `NO_REPLY`: "A INIA não conseguiu responder."

No navegador, `ConversationRef` passa a ler `userMessageId` (o servidor já o manda no evento `conversation`, `realtime-router.ts:1269`) e o balão de erro do `send` (`operator-inia-chat.tsx:1506-1530`) guarda esse id e `signals: ["NO_REPLY"]`. O caminho de envio (voz ou texto) não muda.

O servidor registra a **sugestão elegível**: depois de gravar uma mensagem com sinal não vazio, ou uma descurtida com `stillNeedsHelp = true`, o `realtime-router` — que sabe a origem da conversa (`ResolvedConversation.origin`) — chama `recordSuggestion({ organizationId, personId, interactionId, origin })` só para conversas do chat livre; a função grava `SUGGESTION_ELIGIBLE` só se o apoio estiver ligado para a pessoa (uma vez por mensagem e origem). Falha dela vai para log e nunca muda a resposta da rota. "Elegível" e não "mostrada": a tela pode mostrar outro texto (pedido já aberto).

### 4. Parte A — funil das respostas

`assistant/application/reply-funnel.ts` exporta `replyFunnel(db, organizationId, period, placement)`, com M1–M6 (seção 15). `placement` = organização inteira ou listas de Grupos e Subgrupos (escopos de Coordenador nunca são "Minha estrutura"), aplicado sobre o Grupo/Subgrupo **atual** de cada pessoa. Só o painel do apoio (Parte B) chama a função (D7); na Parte A os dados são coletados, sem tela.

### 5. Parte B — papéis, permissões e liga/desliga

**Permissões** (`access/domain/permissions.ts`):

| Permissão | Texto | Escopos |
| --- | --- | --- |
| `human_support.attend` | "Atender pedidos de apoio" | organização, Grupo, Subgrupo |
| `human_support.coordinate` | "Acompanhar o apoio com Anjo" | organização, Grupo, Subgrupo |
| `human_support.manage` | "Configurar o apoio com Anjo" | só organização |

**Papéis** (`access/domain/roles.ts`):

* `ANJO` — "Anjo", "Atende pedidos de apoio dos operadores do escopo, no chat da INIA." Permissões `[human_support.attend]`; `allowedScopes` organização, Grupo, Subgrupo; `delegates []`.
* `COORDENADOR_DE_ANJOS` — "Coordenador de Anjos", "Acompanha o painel do apoio: funil, pedidos, conversas de apoio, tentativas sem Anjo e presença dos Anjos do escopo." Permissões `[human_support.coordinate]`; mesmos escopos; `delegates []`.
* `ADMINISTRADOR_GERAL` ganha `human_support.coordinate` e `human_support.manage` — **não** `attend` — e passa a delegar `ANJO` e `COORDENADOR_DE_ANJOS`. Nenhum outro papel os delega.

**Capacidades** (`access-decision.ts › accessCapabilities`, fora de `canAccessAdministration`): `canAttendHumanSupport` (`attend` em qualquer escopo), `canCoordinateHumanSupport` (`coordinate` em qualquer escopo), `canManageHumanSupport` (`manage` com escopo de organização). O Coordenador sem outro papel entra numa área isolada da Administração (CUJ 9).

**Quem atende quem.** Uma só fonte: a atribuição ativa de um papel com `human_support.attend`. `personIdsWithPermissionCovering` devolve as contas e pessoas ativas cuja atribuição ativa **cobre** o Grupo/Subgrupo dado — organização cobre todos; Grupo cobre o próprio Grupo e todos os Subgrupos dele; Subgrupo cobre só a si; "Minha estrutura" nunca. Pessoa sem Subgrupo é coberta por organização ou pelo Grupo dela; pessoa sem Grupo, só por organização. Quem chama exclui o próprio operador.

**Alcance do Coordenador de Anjos** (`scopeCovers`, `access/domain/access-scope.ts`):

* Pedidos, conversas, classificações, avaliações e tentativas sem Anjo: o escopo do Coordenador cobre o escopo congelado do pedido ou da tentativa.
* Números da resposta da INIA (M1–M6): pessoas cujo Grupo/Subgrupo atual o escopo do Coordenador cobre.
* Presença, pausas e números de um Anjo: o escopo do Coordenador cobre ao menos um escopo das atribuições `ANJO` da pessoa (D11). Anjo com escopo de organização: só Coordenador de organização.
* Administrador geral: tudo da organização.

**Liga/desliga** (`human-support/domain/enablement.ts`):

```text
ligado(pessoa) = chave_geral = LIGADO
                 E valor(Subgrupo da pessoa), se ≠ HERDAR; senão valor(Grupo da pessoa), se ≠ HERDAR; senão DESLIGADO
pessoa sem Subgrupo: usa o Grupo; sem Grupo: DESLIGADO
```

Tabelas `human_support_settings` (uma por organização; ausência = desligado) e `human_support_scope_settings` (`INHERIT | ON | OFF`, nunca apagada — voltar a herdar é gravar `INHERIT`). Histórico em `human_support_setting_events` e auditoria `HUMAN_SUPPORT_SETTINGS_CHANGED` / `HUMAN_SUPPORT_SCOPE_STATE_CHANGED` / `HUMAN_SUPPORT_CAPACITY_CHANGED` (`audit_logs`). Tudo nasce desligado.

**Desligar** (chave geral ou escopo), no mesmo comando: pedidos Na fila cujo escopo congelado ficou desligado → Cancelados (causa `SCOPE_DISABLED`) com mensagem de sistema; atendimentos em andamento continuam. Pedido novo em escopo desligado → 409 `HUMAN_SUPPORT_DISABLED`.

### 6. Parte B — presença do Anjo

`human_support_agent_presence` (uma linha por Anjo; DDL no [Apêndice B](#apêndice-b--ddl)): `status` declarado, `pause_reason`, `max_concurrent`, `lease_until`, `connection_lost_at`, `connection_restored_at`, `last_assigned_at`, `status_since`, `version`. Toda mudança grava `human_support_presence_events`.

**Motivos de pausa** (`PAUSE_REASONS_V1`): `LUNCH` Lanche · `PERSONAL` Pessoal · `PROCESS_ACTIVITY` Atividade de processo · `MEETING` Reunião.

**Conexão (calculada).** `conectado = lease_until > statement_timestamp()`. A posse é renovada só pela chamada de estado da área do Anjo (`workspace=anjo`, seção 11), que é GET e não renova a sessão (`require-auth.ts:21,52-58`). A renovação é uma atualização sem trava e sem versão: `lease_until = greatest(lease_until, agora + 75 s)`; se `connection_lost_at` não era nulo, zera-o e grava `connection_restored_at = agora`. Não existe batida por POST.

**Avisos ao operador.** A distribuição (seção 8) é quem conta ao operador: ao marcar `connection_lost_at`, grava em cada atendimento em andamento do Anjo a mensagem de sistema "O Anjo está sem conexão. Aguardando…" e sobe a versão do operador; ao achar `connection_restored_at` preenchido, grava "O Anjo voltou", sobe a versão e zera o campo.

**Transições do estado declarado:**

| De | Para | Gatilho | Regra |
| --- | --- | --- | --- |
| `OFFLINE` | `AVAILABLE` | Anjo: "Ficar disponível" | Exige conexão e o papel cobrindo algum escopo ligado (409 `HUMAN_SUPPORT_NOT_CONNECTED` / `HUMAN_SUPPORT_NO_ENABLED_SCOPE`) |
| `AVAILABLE` | `PAUSED` | Anjo escolhe motivo | Não recebe novas atribuições; atendimentos seguem |
| `PAUSED` | `AVAILABLE` | Anjo: "Voltar" | — |
| `AVAILABLE`/`PAUSED` | `OFFLINE` | Anjo: "Ficar indisponível" | Recusado com atendimento em andamento (409 `HUMAN_SUPPORT_ACTIVE_ATTENDANCES`) |
| `AVAILABLE`/`PAUSED` | `OFFLINE` | Sistema: sem conexão há mais de 3 min | Causa `LEASE_EXPIRED` |
| `AVAILABLE`/`PAUSED` | `OFFLINE` | Sistema: papel revogado | Causa `ROLE_REVOKED`; atendimentos Interrompidos na próxima distribuição (até 3 s) |

**Sessão.** Continua expirando com 30 min sem interação. O aviso de 2 min do `SessionIdleGuard` (`frontend/src/components/auth/session-idle-guard.tsx`) faz o papel de "Ainda está aí?". A lista de interações do aviso perde `scroll` (`session-idle-guard.tsx:15`): rolagem feita pelo código (mensagem chegando) não pode renovar a sessão; rolagem feita por uma pessoa já gera `wheel`, `touchstart`, `keydown` ou `pointerdown` (D8).

**Derivados:**

* Em serviço = papel cobre o escopo do pedido ∧ conta e pessoa ativas ∧ `status ∈ {AVAILABLE, PAUSED}` ∧ conectado.
* Pode receber atribuição = em serviço ∧ `AVAILABLE` ∧ atendimentos em andamento < capacidade ∧ não é o operador.

Reduzir a capacidade abaixo do que está em uso não corta nada; só para de atribuir.

### 7. Parte B — pedido e atendimento

**Origem** (derivada pelo servidor):

| Origem | Condição | Cópia da troca |
| --- | --- | --- |
| `BUTTON` | Pedido sem `interactionId` | Só a nota |
| `DISLIKE` | `interactionId` é mensagem da INIA cuja versão de avaliação informada (`ratingId`, da prévia) é `DOWN` com `stillNeedsHelp = true`, da própria pessoa | Pergunta, resposta, motivo, comentário, nota |
| `SIGNAL` | `interactionId` tem sinal não vazio (mensagem da INIA com sinal, ou pergunta com `NO_REPLY`) | Pergunta, resposta quando houver, nota |

`DISLIKE` vale sobre `SIGNAL` quando os dois se aplicam.

**Cópia da troca.** `assistant.buildSupportContext(db, { organizationId, ownerPersonId, interactionId, ratingId })` devolve `null` (vira 404) quando a mensagem não é da pessoa, não é do chat livre ou não existe; senão devolve `{ facts: { dislikeNeedsHelp: boolean, signals: SupportSignal[] }, sharedContext }`. A origem é decidida em `human-support/domain/origin.ts` a partir desses fatos (sem `interactionId` = `BUTTON`; `dislikeNeedsHelp` = `DISLIKE`; sinal não vazio = `SIGNAL`; nenhum = 404). A cópia é montada de linhas que não mudam depois de gravadas:

* Pergunta: se a resposta faz parte de um esclarecimento pelas bases, a pergunta original guardada no estado (`originalQuestion`, `clarification-state.ts:99`); senão, a mensagem do operador imediatamente anterior; com `NO_REPLY`, a própria mensagem.
* Resposta: o texto da mensagem da INIA, sem cartões, materiais, citações estruturadas ou estado de esclarecimento — sempre incluída (D10).
* Motivo e comentário: da versão `ratingId`.

A prévia e a criação chamam a mesma função com os mesmos ids, então o Anjo recebe exatamente o que o operador viu.

**Pedido:**

| De | Para | Gatilho | Ator |
| --- | --- | --- | --- |
| — | Na fila | Operador clica "Pedir ajuda" (prazo da fila calculado nesse instante, seção 9) | operador |
| Na fila | Em atendimento | Distribuição atribui a um Anjo que pode receber | sistema |
| Na fila | Cancelado | Operador cancela (`OPERATOR_CANCELLED`) ou escopo desligado (`SCOPE_DISABLED`) | operador/sistema |
| Na fila | Expirado | Prazo da fila vencido (`QUEUE_EXPIRED`) | sistema |
| Na fila | Abandonado | Nenhuma aba da INIA do operador chamou o servidor em 2 min (`OPERATOR_ABANDONED`) | sistema |
| Em atendimento | Na fila | Atendimento Interrompido; volta para a frente (mantém `queued_at`; novo prazo da fila calculado) | sistema |
| Em atendimento | Encerrado | Atendimento encerrado por operador, Anjo ou falta de mensagens | operador/Anjo/sistema |

Estados finais (Encerrado, Cancelado, Expirado, Abandonado) nunca reabrem; nova necessidade = novo pedido. A causa fica em `human_support_requests.end_cause`.

**Atendimento:** Em andamento → Encerrado. Começa na atribuição, sem aceite (D2). A primeira mensagem do Anjo grava `first_anjo_message_at`; até lá, o operador vê "Aguardando a primeira resposta de Ana" e o Anjo vê há quanto tempo o atendimento espera a resposta dele. O atendimento sem resposta do Anjo continua Em atendimento (D2), sujeito às mesmas regras de encerramento:

| Causa | Quando |
| --- | --- |
| `OPERATOR_CLOSED` | Operador clica "Encerrar atendimento" (também antes da primeira resposta) |
| `ANJO_CLOSED` | Anjo clica "Encerrar atendimento" |
| `OPERATOR_ABSENT` | Anjo clica "Encerrar: operador sem a INIA aberta"; o servidor só aceita com `operator_seen_at` há mais de 5 min (senão 409 `HUMAN_SUPPORT_OPERATOR_PRESENT`) |
| `INACTIVITY` | Sistema: 15 min sem mensagem do operador nem do Anjo, contados da atribuição ou da última mensagem humana |
| `ANJO_LOST` | Sistema: Interrompido — Anjo sem conexão por 3 min além do prazo de 75 s, qualquer que seja o estado declarado, ou papel revogado |

**O que cada lado vê.** Mensagens de sistema são gravadas só com o código (`body` vazio), do catálogo `SYSTEM_MESSAGE_CODES_V1` em `human-support/domain/catalogs.ts`; o servidor monta o texto para quem lê (`MessageView.body`), porque alguns dependem do leitor. Códigos: `QUEUED`, `ANJO_ASSIGNED`, `ANJO_CONNECTION_LOST`, `ANJO_CONNECTION_RESTORED`, `ANJO_LEFT` (interrompido), `ENDED_BY_OPERATOR`, `ENDED_BY_ANJO`, `ENDED_OPERATOR_ABSENT`, `ENDED_INACTIVITY`, `CANCELLED_BY_OPERATOR`, `CANCELLED_SCOPE_DISABLED`, `EXPIRED`, `ABANDONED`.

| Momento | Operador | Anjo |
| --- | --- | --- |
| Pedido na fila | "Procurando um Anjo…" + disponibilidade, espera estimada e "Seu pedido fica na fila até HH:MM" | — |
| Atribuição | "Ana (Anjo) recebeu seu pedido. Aguardando a primeira resposta." | Som e título da aba; atendimento abre com a cópia da troca, a nota e as mensagens enviadas na fila |
| Primeira resposta | a mensagem de Ana | — |
| Anjo sem conexão / voltou | "O Anjo está sem conexão. Aguardando…" / "O Anjo voltou" | — |
| Interrompido | "O Anjo saiu do atendimento. Seu pedido voltou para a fila." | Pendência de classificação |
| Encerrado | "Atendimento encerrado por você / pelo Anjo / por falta de mensagens" + avaliação | Pendência de classificação |
| Cancelado, expirado, abandonado | Texto da causa | — |

Quem tenta agir sobre um pedido que já mudou recebe 409 com texto legível: `HUMAN_SUPPORT_REQUEST_ENDED` ("Este atendimento já foi encerrado").

### 8. Parte B — escritas, travas e distribuição

Prazos sempre comparados com `statement_timestamp()` do banco (não `now()`, que fica no início da transação e atrasa quando a transação esperou uma trava).

**Ordem única de travas** em qualquer transação: trava consultiva da organização (quando houver) → linha do pedido → linha do atendimento → linha da presença → versões por pessoa, sempre **por último** e em ordem de `person_id`. A distribuição junta as pessoas afetadas e sobe as versões uma vez, no fim.

| Escrita | Trava | Depois do commit |
| --- | --- | --- |
| Comandos que mudam estado: criar, cancelar, encerrar, mudar presença, mudar liga/desliga ou capacidade | `pg_advisory_xact_lock(hashtext('human_support:' \|\| organization_id))` + transição condicional (`update … where status = <esperado>`) | `dispatch` |
| Mensagem | `select … for update` na linha do pedido (serializa mensagens entre si e com o encerramento); `seq` = `next_seq` do pedido; `occurred_at = statement_timestamp()`; a primeira mensagem do Anjo grava `first_anjo_message_at` | — |
| Avaliação | linha do atendimento (`for update`); índice único da vigente | — |
| Classificação | chave primária = atendimento (uma só) | — |
| Renovação de conexão (`lease_until`) e de presença do operador (`operator_seen_at`) | nenhuma; atualização condicional com `greatest` | — |

**Distribuição** (`human-support/application/dispatch.ts`). Roda depois do commit de cada comando, em transação própria, com `pg_try_advisory_xact_lock` na mesma chave: se outro processo já está distribuindo, pula. A tarefa periódica `human-support-dispatch` (3 s, `infrastructure/jobs/periodic-jobs.ts`, uma instância por vez no conjunto) é a garantia dos prazos — o mesmo padrão de `knowledge-publications` (`backend/src/main/server.ts:114`). Passos:

1. Presenças com `lease_until` vencido e `connection_lost_at` nulo → `connection_lost_at = lease_until`, evento `CONNECTION_LOST` e aviso ao operador (seção 6). Presenças com `connection_restored_at` preenchido → aviso "O Anjo voltou", evento `CONNECTION_RESTORED`, campo zerado.
2. Presenças com `lease_until` vencido há mais de 3 min e estado ≠ `OFFLINE` → `OFFLINE (LEASE_EXPIRED)`.
3. Atendimentos em andamento cujo Anjo tem `lease_until` vencido há mais de 3 min (qualquer estado declarado), ou não tem mais a permissão cobrindo o escopo do pedido → Interrompidos (`ANJO_LOST`); pedido → Na fila, na frente, com novo prazo da fila.
4. Atendimentos em andamento sem mensagem humana há 15 min → Encerrados (`INACTIVITY`).
5. Pedidos Na fila: escopo desligado → Cancelados; operador sem chamar há 2 min → Abandonados; prazo da fila vencido → Expirados.
6. Anjos com estado ≠ `OFFLINE` sem a permissão em nenhum escopo → `OFFLINE (ROLE_REVOKED)`.
7. Para cada pedido Na fila, em ordem de `queued_at`, num savepoint próprio (falha de um pedido vai para log e métrica e não para os outros): escolher quem pode receber atribuição, ordenando por menos atendimentos em andamento e depois `last_assigned_at` mais antigo (nulos primeiro); criar o atendimento, pedido → Em atendimento, mensagem `ANJO_ASSIGNED`, `last_assigned_at = agora`. Depois do commit, a distribuição grava o registro LGPD da leitura da cópia pelo Anjo (falha não desfaz a atribuição).

Cada transição grava estado anterior, novo, causa e ator em `human_support_request_events` (ator nulo = sistema). Causas (`REQUEST_EVENT_CAUSES_V1`): `CREATED`, `ASSIGNED`, `ANJO_LOST`, `REQUEUED`, mais as causas finais de `end_cause`.

**Garantias no banco:** índices únicos parciais do [Apêndice B](#apêndice-b--ddl) — um pedido aberto por operador; um atendimento em andamento por pedido; chave de idempotência do pedido; chave de idempotência da mensagem; `seq` único por pedido. A capacidade é conferida pela distribuição sob a trava da organização (só ela cria atendimentos).

### 9. Parte B — fila, espera estimada e prazo

**Disponibilidade** mostrada antes de pedir (`POST /requests/preview`) e na fila, pela primeira regra que valer, no escopo do operador:

1. Escopo desligado → "O apoio com Anjo ainda não está disponível para sua equipe." (`DISABLED`) — botão desabilitado.
2. Ninguém em serviço → "Nenhum Anjo em serviço agora." (`NONE_IN_SERVICE`) — botão desabilitado e tentativa registrada (D4).
3. Alguém pode receber atribuição agora → "Há Anjos disponíveis: seu pedido vai direto para um deles." (`AVAILABLE_NOW`)
4. Algum Anjo Disponível, sem vaga → "Todos os Anjos estão em atendimento." + espera estimada (`ALL_BUSY`)
5. Senão (todos em pausa) → "Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila." + espera estimada (`NONE_AVAILABLE`, D3)

Na fila, o texto é recalculado a cada resposta da chamada de estado (no máximo 20 s de atraso); com a janela aberta, o botão é habilitado quando um Anjo fica em serviço. O operador nunca recebe quantos Anjos estão em pausa, nem por quê.

**Tentativa sem Anjo em serviço** (D4). A prévia é `POST` porque registra a intenção: quando a disponibilidade é `NONE_IN_SERVICE`, grava `NO_ANJO_IN_SERVICE` em `human_support_entry_events` com pessoa, Grupo/Subgrupo, origem e `interactionId` (no máximo uma por pessoa a cada 10 min, conferido sob a trava da organização). O `POST /requests` confere de novo e, sem Anjo em serviço, responde 409 `HUMAN_SUPPORT_NO_ANJO_IN_SERVICE` (corrida rara). As tentativas aparecem no painel do apoio (lista "Sem Anjo em serviço" e M9).

**População de referência** (`human-support/domain/queue-history.ts`, funções puras, sem cache): pedidos criados nos últimos 14 dias com o mesmo Subgrupo congelado, já atribuídos ou terminados, **sem** os cancelados por escopo desligado; se houver menos de 10 atribuídos, o mesmo com o Grupo; depois a organização; senão, sem histórico. Espera de um atribuído = do pedido à primeira atribuição.

**Espera estimada:** o menor tempo *t* entre as esperas dos atribuídos em que o número de atribuídos com espera ≤ *t* chega a metade da população (arredondada para cima) → "Espera estimada: cerca de *t* min" (arredondado para cima, mínimo 1). Se os atribuídos nunca chegam à metade, "Espera estimada: mais de X min", com X = maior espera observada na população. Com a nota "Estimativa pelos pedidos dos últimos 14 dias do seu Subgrupo" (ou Grupo, ou organização). Sem histórico: "Ainda não há histórico para estimar". Nunca zero, nunca tempo inventado.

**Prazo da fila** (D12): calculado quando o pedido entra (ou volta) na fila = percentil 90 das esperas dos atribuídos da população, arredondado para cima em minutos, limitado entre 10 e 25 min (acima de 25 a sessão do operador expiraria antes, e o pedido viraria Abandonado); sem histórico, 20 min. Gravado em `queue_expires_at` e mostrado como horário no fuso da organização: "Seu pedido fica na fila até 14:35". Não muda enquanto o pedido espera.

"Cancelar pedido" funciona Na fila.

### 10. Parte B — conversa humana e isolamento da IA

**Armazenamento** (`human_support_messages`, DDL no [Apêndice B](#apêndice-b--ddl)): autoria (`OPERATOR | ANJO | SYSTEM`), pessoa autora, `operator_person_id`, texto, código de sistema, chave de idempotência, `seq` por pedido e `occurred_at` do relógio do banco.

* Ordem e cursor pelo `seq` do pedido (sem lacunas, porque a mensagem trava a linha do pedido).
* O operador pode escrever na fila ("O Anjo verá quando receber o pedido"); o Anjo só escreve no próprio atendimento em andamento.
* Pedido em estado final → 409 `HUMAN_SUPPORT_REQUEST_ENDED`; a mesma chave de idempotência devolve a mensagem existente.
* Nada do apoio altera `assistant_conversations` nem `assistant_interactions`.

**Quem lê as mensagens:** o operador (todas); o Anjo, as do pedido que atendeu, do início do pedido até o fim do **próprio** atendimento, enquanto tiver o papel de Anjo (D5); Coordenador de Anjos e Administrador geral pelo alcance da seção 5.

**Isolamento — servidor** (testes de estrutura):

* Só `backend/src/modules/human-support/**` e `backend/src/modules/data-lifecycle/**` citam as tabelas `human_support_*`.
* `human-support` não importa `assistant/application/run-orchestrated-reply`, `shared/application/model-routing/**`, `realtime/infrastructure/**`, nenhum cliente de modelo, nem `usage-analytics/**`.
* Nenhum arquivo de `assistant` cita `human_support_*` nem importa `human-support`.

**Isolamento — navegador:**

* A sala é `components/human-support/operator/support-room.tsx`, com campo próprio (`support-composer.tsx`) **sem microfone**, que não importa `lib/realtime/**` nem `lib/avatar/**` (teste de estrutura).
* Abrir a sala chama `closeVoiceSessionForSwitch()` do chat: encerra a sessão do Gemini Live (não silencia).
* O roteamento do `send` do chat da INIA (voz ou texto, `operator-inia-chat.tsx:1285-1302`) não muda; a sala nunca passa por ele.
* Aviso fixo na sala: "A INIA não lê esta conversa. Coordenadores de Anjos e o Administrador geral podem ler."

### 11. Parte B — canal de atualização

**Chamada de estado:** `GET /api/v1/human-support/me/state?since=<versão>&wait=<0..20>&workspace=<anjo|none>` (resposta completa no [Apêndice C](#apêndice-c--contratos)).

* Devolve o estado inteiro da pessoa: visão do operador (liga/desliga, disponibilidade, pedido aberto com as últimas 50 mensagens, avaliações pendentes) e, para Anjo com `workspace=anjo`, visão do Anjo (presença, vagas, atendimentos com o último `seq` e a espera pela primeira resposta, pendências). A visão do operador não tem campo de presença ou pausa de Anjo (teste de contrato).
* Com `wait > 0` e versão sem mudança, o servidor segura a resposta até a versão mudar, `wait` segundos passarem ou começar o dreno do processo.
* `Cache-Control: no-store`. Renova `operator_seen_at` (operador com pedido aberto) e, com `workspace=anjo` e a permissão `attend`, `lease_until` (sem `attend`, `workspace=anjo` é ignorado). Não renova a sessão.

**Versão por pessoa:** `human_support_inbox_versions`, incrementada na mesma transação de toda mudança que a pessoa vê (pedido, atribuição, atendimento, mensagem, avaliação, classificação, presença do próprio Anjo, avisos de conexão). Renovações não incrementam. A disponibilidade não incrementa (recalculada a cada resposta).

**Esperas sem prender o banco** (`human-support/application/waiters.ts`): registro em memória das chamadas longas abertas no processo. Enquanto houver alguma, um laço de 1 s faz **uma** consulta por processo nas versões das pessoas esperando e responde as que mudaram. Nenhuma conexão do pool fica presa; nenhum `LISTEN`. A quinta chamada longa da mesma pessoa no mesmo processo faz a mais antiga responder na hora com o estado atual. `Readiness` (`backend/src/main/readiness.ts`) ganha `onDraining(listener)`; no início do dreno o registro responde todas as chamadas abertas com `reconnect: true`, e toda chamada que chega durante o dreno também responde na hora com `reconnect: true` (o health check do ARR leva até 3 s para tirar a instância). O registro é criado em `server.ts` (papel API) e passado a `createApp`.

**Dois canais no navegador** (no máximo duas chamadas longas por navegador):

* **Operador:** `use-human-support-state.ts`, exposto por `HumanSupportStateProvider` (Context) montado uma vez no shell autenticado; o chat, o selo e a sala leem por `useHumanSupportState()`. Uma chamada inicial curta ao carregar; abre chamada longa só com pedido aberto ou avaliação pendente. Uma aba líder por navegador (Web Locks `inia-human-support-operator`) repassa o estado às outras por `BroadcastChannel`; sem Web Locks, cada aba chama sozinha.
* **Anjo:** a área do Anjo tem a própria chamada longa com `workspace=anjo`, protegida pela trava de aba única `inia-anjo-workspace` (outra aba mostra "A área do Anjo está aberta em outra aba").
* Reconexão depois de resposta, erro ou `reconnect`; modo de reserva (chamada curta periódica) quando a longa falha; indicador "Reconectando…". Valores no [Apêndice A](#apêndice-a--parâmetros).
* Nenhum dos dois chama `/auth/activity`.
* Quando o `seq` de um atendimento muda, a tela busca `GET /requests/:id/messages?after=<seq>`.

**Métricas** (seção `humanSupport` em `main/server.ts:63`): chamadas longas abertas; respondidas por mudança, por prazo e por dreno; atraso entre um prazo vencer e a transição; falhas da distribuição por pedido; falhas do registro LGPD (`recordPersonalDataAccess` passa a devolver `boolean`). `RuntimeMetricsOptions` ganha `excludeFromLatency: string[]` (padrões de rota): a rota da chamada de estado continua contada em `count` e erros, mas fica fora de `inFlight`, `totalMs`, `maxMs` e das amostras.

### 12. Parte B — encerramento, classificação e avaliação

**Classificação do Anjo** (`human_support_classifications`, uma por atendimento, definitiva depois de enviada; `CLASSIFICATION_CATALOG_V1`):

* Motivo do encaminhamento (obrigatório):
  * Falta de processo cadastrado (`NO_PROCESS`)
  * Falta de alinhamento ou orientação disponível (`NO_GUIDANCE`)
  * Pergunta mal formulada (`QUESTION_UNCLEAR`)
  * Informação existente em processo que poderia ter sido encontrada (`FOUND_IN_PROCESS`)
  * Informação que poderia ter sido obtida pelo sistema ou por outra IA (`AVAILABLE_ELSEWHERE`)
  * Outro (`OTHER`)
* Título do processo, sistema ou IA (3–200): obrigatório em `FOUND_IN_PROCESS` e `AVAILABLE_ELSEWHERE`; opcional em `QUESTION_UNCLEAR`; não pedido nos demais.
* Link: opcional; só `http(s)`, até 500 caracteres; exibido como texto com aviso de link externo.
* Descrição (3–1000): obrigatória em `OTHER`.
* Resultado (obrigatório, OQ3): Resolvido no atendimento (`RESOLVED`) · Orientado, depende de ação do operador (`GUIDED`) · Encaminhado à liderança ou a outra área (`FORWARDED`) · Não resolvido (`NOT_RESOLVED`).
* Pendente até ser enviada; não impede atribuições; vale também para atendimento Interrompido. Auditoria `HUMAN_SUPPORT_ATTENDANCE_CLASSIFIED`.

**Avaliação do operador** (`human_support_evaluations`; cada mudança grava nova linha e encerra a anterior por `superseded_at`, como decidido): Resolução declarada ("Sua dúvida foi resolvida?" Sim / Em parte / Não) e "Avalie o atendimento de Ana" de 1 a 5 estrelas. Ambos opcionais, independentes, alteráveis até 24 h depois do fim do atendimento (depois, 409 `HUMAN_SUPPORT_EVALUATION_CLOSED`). Aparece na sala ao encerrar e no histórico enquanto a janela está aberta. Atendimento Interrompido não é avaliado.

### 13. Parte B — privacidade e LGPD

**Colunas que apontam para pessoas** (todas simples, nunca compostas; a exportação do titular segue chaves estrangeiras simples para `people`, `subject-data-export.ts`):

| Tabela | Colunas → `people` | Vai para a exportação de |
| --- | --- | --- |
| `assistant_interaction_rating_details` (A) | `person_id` | operador |
| `assistant_reply_signals` (A) | `person_id` | operador |
| `human_support_settings`, `human_support_scope_settings` | `updated_by_person_id` | quem alterou |
| `human_support_setting_events` | `actor_person_id`, `subject_person_id` | quem alterou; Anjo (capacidade) |
| `human_support_requests` | `operator_person_id` | operador |
| `human_support_messages` | `operator_person_id`, `author_person_id` | operador (todas as mensagens do pedido) e autor |
| `human_support_attendances` | `anjo_person_id`, `operator_person_id` | Anjo e operador |
| `human_support_classifications` | `anjo_person_id`, `operator_person_id` | Anjo e operador (D6) |
| `human_support_evaluations` | `operator_person_id` | só operador (o Anjo não leva notas, OQ2) |
| `human_support_agent_presence`, `human_support_presence_events` | `person_id` | Anjo |
| `human_support_request_events` | `actor_person_id` (nulo = sistema) | ator |
| `human_support_entry_events` | `person_id` | operador |
| `human_support_inbox_versions` | `person_id` | a própria pessoa (só um número) |

* Motivo de pausa só nas tabelas de presença, chaveadas pelo Anjo; nenhuma rota do operador as lê.
* **Registro de leitura** (`personal_data_access_log`; a migration amplia o check de `data_kind` com `HUMAN_SUPPORT_CONVERSATION` e `HUMAN_SUPPORT_PRESENCE`), sempre gravado **depois** do commit, uma linha por pessoa vista:
  * Atribuição (o Anjo recebe a cópia): titular = operador, `HUMAN_SUPPORT_CONVERSATION`.
  * Coordenador ou Administrador geral abre um pedido: uma linha para o operador e uma para cada Anjo do pedido, `HUMAN_SUPPORT_CONVERSATION`.
  * Coordenador ou Administrador geral abre a presença de um Anjo ou a aba Anjos: uma linha por Anjo exibido, `HUMAN_SUPPORT_PRESENCE`.
  * A deduplicação de 10 min do helper continua (o registro responde "quem viu", não conta cliques).
* **Retenção** (`data-lifecycle/domain/retention-catalog.ts`): alvos novos `human_support_requests` (por `created_at`, só estados finais; filhos com `on delete cascade` real: mensagens, atendimentos, eventos do pedido; classificações e avaliações descem em cascata pelos atendimentos), `human_support_entry_events`, `human_support_presence_events`. `assistant_reply_signals` entra como filho de `assistant_interactions` (toda outra chave estrangeira protege a linha da retenção, `retention-catalog.ts:7-9`). Os detalhes da avaliação seguem a avaliação (`assistant_interaction_ratings`, que hoje já protege a resposta — sem mudança). Políticas nascem desligadas, como as demais.
* **Logs:** linhas `human_support_*` com id do pedido e códigos, nunca conteúdo. O módulo não grava eventos de uso (`recordServerUsageEvent` ignora a flag de ambiente, `record-server-event.ts:32-33`).
* **Limites por conta** (`rate_limit_hits`): ver [Apêndice A](#apêndice-a--parâmetros).

### 14. Telas

**Operador** (painel do chat):

* Formulário da descurtida (seção 2) e sugestões (seção 3).
* Botão permanente "Falar com um Anjo" no cabeçalho do chat (`operator-inia-chat.tsx:1983-1988`, OQ4), visível com apoio ligado.
* Janela de pedido (Dialog central): prévia da cópia da troca, campo da nota (até 2000 caracteres), disponibilidade, espera estimada e prazo da fila, "Pedir ajuda" (desabilitado sem Anjo em serviço).
* Selo de apoio na vista da INIA com pedido aberto: "Apoio · Na fila até 14:35" / "Apoio · com Ana" / "Apoio · encerrado — avalie". Clicar abre a sala.
* Sala de apoio: cabeçalho "Apoio com Anjo · AP-7K2QX9"; faixa de estado; cartão "O que você compartilhou"; mensagens com três autores (operador à direita; Anjo à esquerda com foto ou iniciais, nome preferido e selo "Anjo"; sistema centralizado); campo "Mensagem para o Anjo"; "Cancelar pedido" ou "Encerrar atendimento"; "Voltar para a INIA"; aviso de quem lê.
* Anjo recebeu o pedido com a aba oculta: título "• Ana recebeu seu pedido — INIA" e um som curto, uma vez.
* "Conversas anteriores" ganha a seção "Apoio com Anjo" (somente leitura).

**Anjo** (`/apoio`, entrada no seletor de área do cabeçalho para quem tem `canAttendHumanSupport`):

* Estado: Disponível / Pausa ▸ motivo / Indisponível; vagas "1 de 2".
* Atendimento novo: som (o áudio é preparado no clique em "Ficar disponível", para o navegador permitir tocar depois), título da aba piscando e a aba do atendimento aberta, com "Sem resposta há 1 min" até a primeira mensagem.
* Atendimentos em abas; conversa com a cópia da troca; "Encerrar atendimento" e "Encerrar: operador sem a INIA aberta" (habilitado após 5 min).
* Pendências de classificação com o formulário; histórico dos próprios atendimentos (D5).

**Administrador geral** (Administração › Plataforma › Apoio com Anjo): abas **Configuração** (chave geral, capacidade padrão) · **Escopos** (árvore Grupo › Subgrupos com estado, efetivo — "Ligado (herdado do Grupo)" — e número de Anjos; alerta "ligado sem Anjo") · **Anjos** (lista a partir das atribuições, com escopos, capacidade editável e situação agora — conectado, estado, atendimentos; filtro por Grupo/Subgrupo mostra quem atende aquele escopo e, para quem não pode receber atribuição agora, o motivo). "Conceder papel" abre o editor de papéis que já existe.

**Painel do apoio — Coordenador de Anjos e Administrador geral** (Administração › Monitoramento › Apoio com Anjo): abas **Funil** (M1–M17, seção 15) · **Pedidos** (lista com filtros; detalhe com cópia, mensagens, atendimentos, primeira resposta, classificação e avaliação vigente) · **Sem Anjo em serviço** (lista das tentativas: quando, quem, Grupo/Subgrupo, origem; D4) · **Anjos** (M18: presença no período, pausas por motivo, atendimentos, tempo até a primeira resposta, números do escopo).

### 15. Métricas

Calculadas na hora a partir das tabelas, período de até 92 dias, datas civis no fuso da organização, mostradas só no painel do apoio (D7). Numerador e denominador em um só arquivo por parte (`assistant/application/reply-funnel.ts` para M1–M6; `human-support/domain/metrics-definitions.ts` para M7–M18), com testes. Toda taxa aparece com numerador e denominador; denominador menor que 5 = taxa oculta com "amostra pequena"; denominador zero = "sem dados", nunca 0%. No topo, as datas de corte: "Motivo da descurtida desde" e "Sinais desde" (data da primeira linha de cada tabela na organização) e os períodos com o apoio desligado no escopo (`human_support_setting_events`).

| # | Medida | Tipo | Numerador / denominador | Recorte | Observações |
| --- | --- | --- | --- | --- | --- |
| M1 | Respostas da INIA | contagem | mensagens da INIA no chat livre no período, menos as etapas de esclarecimento ainda aguardando escolha | estrutura atual da pessoa | Base do funil |
| M2 | Cobertura da avaliação | taxa | M1 com avaliação vigente `UP` ou `DOWN` / M1 | atual | Sem avaliação não é positivo |
| M3 | Avaliações positivas entre as avaliadas | taxa | `UP` / avaliadas | atual | Mede só a percepção de quem avaliou; nunca chamada de "assertividade" |
| M4 | Motivos da descurtida | distribuição | por motivo / `DOWN` vigentes | atual | `DOWN` sem detalhes: "motivo não informado"; antes da data de corte: "motivo não coletado" |
| M5 | Necessidade declarada | taxa | `stillNeedsHelp = true` / `DOWN` com detalhes | atual | Inclui escopos sem apoio |
| M6 | Respostas com sinal | taxa | M1 com sinal não vazio / M1 com linha de sinais | atual | Por código |
| M7 | Sugestões elegíveis | contagem | `SUGGESTION_ELIGIBLE` por origem (`SIGNAL`, `DISLIKE`) | congelado no evento | — |
| M8 | Pedidos e conversão | contagem e taxa | pedidos por origem; conversão por coorte = pedidos cujo `source_interaction_id` tem sugestão elegível no período (pela data da sugestão) / sugestões elegíveis do período | congelado | Botão sem conversão |
| M9 | Tentativas sem Anjo em serviço | contagem | `NO_ANJO_IN_SERVICE` (no máximo uma por pessoa a cada 10 min) | congelado | Não são pedidos; lista na aba "Sem Anjo em serviço" |
| M10 | Desfechos | distribuição | pedidos terminados por estado e causa / pedidos criados no período que terminaram; "teve atendimento" contado à parte | congelado | Abertos à parte |
| M11 | Espera até receber um Anjo | percentis | do pedido à primeira atribuição: estimativa da seção 9 e p90 | congelado | — |
| M12 | Tempo até a primeira resposta do Anjo | percentis e taxa | da atribuição à primeira mensagem do Anjo: p50/p90; atendimentos encerrados sem resposta do Anjo / atendimentos encerrados (por causa) | congelado | D2 |
| M13 | Duração do atendimento | percentis | da atribuição ao fim: p50/p90 | congelado | Interrompidos à parte |
| M14 | Motivo do encaminhamento | distribuição | por motivo / atendimentos classificados; cobertura = classificados / atendimentos encerrados | congelado | Títulos mais citados |
| M15 | Resultado | distribuição | por resultado / classificados | congelado | — |
| M16 | Resolução declarada | distribuição | Sim/Em parte/Não / encerrados com resposta; cobertura = com resposta / encerrados não interrompidos | congelado | Separada das estrelas |
| M17 | Estrelas | média e distribuição | / com nota; cobertura = com nota / encerrados não interrompidos | congelado | Média só com ≥ 5 notas |
| M18 | Por Anjo | horas, contagens e percentis | tempo disponível, em pausa por motivo, sem conexão; atendimentos; tempo até a primeira resposta (p50/p90) e atendimentos sem resposta | alcance do Coordenador sobre o Anjo (D11) | Aba Anjos |

As três avaliações nunca se misturam: feedback do Acompanhamento (`feedback_ratings`, fora deste painel), resposta da INIA (M2–M5) e atendimento do Anjo (M16–M17).

### 16. Rotas e eventos

Corpos, respostas e erros no [Apêndice C](#apêndice-c--contratos).

| Rota | Quem | Fase |
| --- | --- | --- |
| `PUT /api/v1/realtime/conversations/:c/messages/:i/rating` (alterada) | dona | A0 |
| `GET /api/v1/realtime/conversations/:c/messages` (alterada: `ratingId`, `ratingDetails`, `signals`) | dona | A0 |
| Evento SSE `conversation` (já tem `userMessageId`; o cliente passa a lê-lo) | — | A1 |
| `GET /api/v1/human-support/me/state` | qualquer pessoa autenticada | B0 |
| `POST /api/v1/human-support/requests/preview` | operador com apoio ligado | B0 |
| `POST /api/v1/human-support/requests` | operador com apoio ligado | B0 |
| `POST /api/v1/human-support/requests/:id/cancel` | dono | B0 |
| `POST /api/v1/human-support/requests/:id/close` | dono ou Anjo do atendimento em andamento | B0 |
| `GET /api/v1/human-support/requests/:id/messages` | dono; Anjo pela regra da seção 10 | B0 |
| `POST /api/v1/human-support/requests/:id/messages` | dono; Anjo do atendimento em andamento | B0 |
| `PUT /api/v1/human-support/attendances/:id/evaluation` | dono | B0 |
| `GET /api/v1/human-support/me/requests` | operador | B0 |
| `PUT /api/v1/human-support/anjo/presence` | `attend` | B0 |
| `GET /api/v1/human-support/anjo/attendances` | `attend` | B0 |
| `POST /api/v1/human-support/attendances/:id/classification` | Anjo do atendimento | B0 |
| `GET` e `PUT /api/v1/admin/human-support/settings` | `manage` | B0 |
| `GET /api/v1/admin/human-support/scopes`; `PUT …/scopes/:scopeType/:id` | `manage` | B0 |
| `GET /api/v1/admin/human-support/anjos`; `PUT …/anjos/:personId/capacity` | `manage` | B0 |
| `GET /api/v1/admin/human-support-monitoring/metrics` | `coordinate` | B0 |
| `GET /api/v1/admin/human-support-monitoring/requests` e `/:id` | `coordinate`, no escopo do pedido | B0 |
| `GET /api/v1/admin/human-support-monitoring/unavailable-attempts` | `coordinate`, no escopo da tentativa | B0 |
| `GET /api/v1/admin/human-support-monitoring/anjos` e `/:personId/presence` | `coordinate`, no alcance do Anjo | B0 |
| `/auth/me` (alterada: três capacidades) | — | B0 |

Os routers `/api/v1/admin/human-support` e `/api/v1/admin/human-support-monitoring` são montados **antes** de `app.use("/api/v1/admin", can("configuration.manage"), …)` (`app.ts:425`), como o monitoramento de conversas. Conceder os papéis usa as rotas que já existem (`/api/v1/admin/access/accounts/:id/roles`).

### 17. Modelo de dados

DDL completo no [Apêndice B](#apêndice-b--ddl). Nada é apagado fora da retenção; não há objeto de configuração apagável.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Fase |
| --- | --- | --- | --- |
| Chamada longa pelo ARR nunca validada num Windows real (OQ1) | Atualizações atrasadas ou cortadas | Modo de reserva no mesmo contrato; validação com 2 APIs antes de ligar | B1 |
| Anjo recebe o atendimento e não percebe (sem aceite, D2) | Operador espera a primeira resposta | Som e título da aba; "Sem resposta há N min" na área do Anjo; M12 e M18 medem por Anjo; o operador pode encerrar e pedir de novo | B1 |
| Aba da área do Anjo oculta em modo de reserva | Temporizadores reduzidos pelo navegador | A chamada longa não depende de temporizador; modo de reserva degradado por definição, com "Reconectando…" | B1 |
| Polegar passa a abrir formulário | Menos descurtidas, cobertura menor | M2 acompanha a cobertura antes e depois; formulário curto | A1 |
| `operator-inia-chat.tsx` tem trabalho não commitado de outra frente no checkout principal | Conflito de merge | Mudanças mínimas nesse arquivo (selo, troca para a sala, erro com id, botão); o resto em componentes novos | A1, B1 |
| Processamento parado | Prazos não andam e pedidos na fila não são atribuídos | Distribuição também depois de cada comando; tarefa periódica em qualquer instância de processamento (recomendado ≥ 2); métrica de atraso | B0 |
| Abas antigas durante a publicação | Descurtida sem motivo | Servidor aceita `DOWN` sem detalhes em todas as fases; conta como "motivo não informado" | A0 |
| Disputa pela trava da organização | Comandos esperando | Só comandos que mudam estado tomam a trava; mensagens, avaliações e renovações não | B0 |
| Todos os Anjos em serviço em pausa (D3) | Pedido espera até o prazo da fila | Texto "Nenhum Anjo disponível no momento"; prazo mostrado; M10 mostra expirados | B1 |
| Resposta da INIA com dados de outros colaboradores vai ao Anjo (D10) | Anjo vê dados de resultados de terceiros | Decisão do dono do produto; a prévia mostra ao operador o que será compartilhado; leitura registrada no LGPD | B0 |
| Cópia da troca sobrevive à retenção do chat | Dado pessoal guardado mais tempo | Alvo de retenção próprio; alinhar prazos quando as políticas forem definidas (hoje desligadas) | B0 |
| Limite de 6 conexões por origem sem HTTP/2 | Requisições presas | No máximo duas chamadas longas por navegador | B1 |
| Sessão expira no meio de um atendimento | Atendimento interrompido | Aviso de inatividade que já existe; carência de 3 min | B1 |

## Alternatives Considered

### Alternative A: Mensagem do Anjo em `assistant_interactions` com papel novo
* **Pros:** reaproveita histórico, paginação e monitoramento.
* **Cons:** o check de `role` aceita só `user`/`assistant` (`028_*.sql:39`), e o contexto do modelo lê as últimas 24 mensagens de qualquer papel (`assistant-conversations.ts:324-328`), além de outros nove leitores que mandam o histórico à IA ou o usam como métrica ([levantamento.md](levantamento.md), seção 1); um rollback leria valores desconhecidos.
* **Reason for Rejection:** o isolamento da IA viraria um filtro a lembrar em cada leitor, em vez de uma propriedade do armazenamento.

### Alternative B: Sala de apoio como nova `origin` de `assistant_conversations`
* **Pros:** o painel já troca de conversa.
* **Cons:** a conversa entraria no monitoramento e no analytics do chat; o check de `origin` muda.
* **Reason for Rejection:** a sala é só apresentação; a persistência fica no módulo novo.

### Alternative C: Fila em que o Anjo escolhe da lista
* **Pros:** o Anjo decide quando pegar um pedido.
* **Cons:** a espera depende de alguém olhar a lista; não mede a demora do Anjo em atender.
* **Reason for Rejection:** decisão do dono do produto por distribuição automática ([concepts_brief.md](concepts_brief.md)).

### Alternative D: Oferta com 30 s para aceitar
* **Pros:** o Anjo confirma que está presente antes de o operador ver o nome dele.
* **Cons:** mais estados (oferta, recusa, oferta deixada passar, pausa de sistema), mais disputas a tratar, e esconde quanto tempo o Anjo leva para atender.
* **Reason for Rejection:** decisão do dono do produto (D2): atribuição direta, com o tempo até a primeira resposta medido.

### Alternative E: Chamada curta periódica como canal principal
* **Pros:** nenhuma peça nova.
* **Cons:** em aba oculta o navegador espaça temporizadores (e o React Query pausa), e o Anjo perceberia atendimentos novos com atraso; latência de alguns segundos na conversa.
* **Reason for Rejection:** fica como modo de reserva no mesmo contrato.

### Alternative F: Chamada longa acordada por `LISTEN/NOTIFY`
* **Pros:** latência de milissegundos; `listenForWake` já existe e reconecta sozinho (`shared/infrastructure/process-wake/postgres-wake-channel.ts`).
* **Cons:** uma conexão fora do pool por API (a conta de `max_connections` muda); o aviso atual vai sem destinatário e acordaria todas as esperas.
* **Reason for Rejection:** a releitura de 1 s por processo atende sem conexão extra; `NOTIFY` pode entrar depois sem mudar o contrato, se uma medição pedir.

### Alternative G: WebSocket
* **Pros:** bidirecional.
* **Cons:** não há servidor WebSocket no backend; o recurso não é instalado no IIS pelos scripts (`deploy/windows/iis/`); a distribuição entre instâncias continuaria no banco.
* **Reason for Rejection:** custo de infraestrutura sem ganho sobre a chamada longa.

### Alternative H: Detectar "não encontrei" por frase no texto da IA
* **Pros:** pegaria respostas em que o modelo diz que não sabe mesmo com trechos encontrados.
* **Cons:** frágil a qualquer mudança de redação; regra crítica dependeria de texto gerado.
* **Reason for Rejection:** proibido pelo dono do produto ([feature_concept.md](feature_concept.md), "Entrada no apoio").

### Alternative I: Campo de cobertura declarado pelo modelo na resposta
* **Pros:** pegaria respostas que acharam trechos mas não a resposta.
* **Cons:** muda contrato versionado de prompt e pode piorar a resposta.
* **Reason for Rejection:** adiado; exige avaliação de qualidade separada. O botão e a descurtida cobrem o caso.

### Alternative J: Chave estrangeira do pedido para a resposta da INIA
* **Pros:** sem duplicar texto.
* **Cons:** protege a resposta da retenção para sempre (`retention-catalog.ts:7-9`); ler na hora tornaria o apoio mais um leitor do chat.
* **Reason for Rejection:** cópia imutável igual à prévia.

### Alternative K: Tabela "Anjos por escopo" separada do papel
* **Pros:** a tela de configuração não depende do editor de papéis.
* **Cons:** segunda fonte de verdade; papel revogado continuaria recebendo pedidos ou o contrário.
* **Reason for Rejection:** a atribuição do papel já tem escopo, auditoria e revogação.

### Alternative L: Prazo da fila configurado pelo administrador
* **Pros:** previsível.
* **Cons:** um número escolhido sem relação com a espera real; o dono do produto pediu que o sistema o infira.
* **Reason for Rejection:** decisão do dono do produto (D12).

--------------------------------------------------------------------------------

## Non-Functional Requirements

* **Segurança:** organização, pessoa e escopo sempre da sessão; fora do escopo = 404; papéis do apoio só concedidos pelo Administrador geral; CSRF e limites por conta como no resto do app; link da classificação só `http(s)`, renderizado como texto.
* **Desempenho (estimado, a medir na fase B1):** por processo, uma consulta por segundo enquanto houver chamadas longas; uma escrita de conexão a cada resposta da chamada longa do Anjo (≤ 20 s); comandos sob trava por organização na ordem de dezenas por minuto. Funil limitado a 92 dias.
* **Disponibilidade:** ver Riscos (processamento parado).
* **Implantação e reversão:** [Fases](#fases) e [Reversão](#reversão).

--------------------------------------------------------------------------------

### Additional Resources

* `docs/dev/memoria/conversa-voz-e-avatar.md`, `docs/dev/memoria/experiencia-do-colaborador.md`, `docs/dev/memoria/acesso.md`, `docs/dev/memoria/escala-e-operacao.md`, `docs/dev/memoria/seguranca.md`, `docs/dev/memoria/monitoria-de-usabilidade.md`.
* `docs/regras-produto-ui-ux.md`, `docs/dev/refatoracao-progressiva.md`.

### Future Improvements

* `LISTEN/NOTIFY` se a latência ou o custo da releitura pedirem.
* Resumo diário do funil se o período ou o volume crescerem.
* Motivos de pausa e lista de resultado administráveis.
* Notificação do sistema operacional quando um atendimento chega ao Anjo.
* Anjo devolver ou transferir um pedido.
* Usar a classificação do Anjo para priorizar lacunas das bases.

### Apêndice A — parâmetros

| Parâmetro | Valor | Onde muda |
| --- | --- | --- |
| Prazo da fila | p90 do histórico, entre 10 e 25 min; 20 min sem histórico | calculado (D12) |
| Capacidade | padrão 2 | organização e por Anjo, 1–5 |
| Prazo da conexão do Anjo | 75 s | constante |
| Carência antes de interromper | 3 min | constante |
| Operador sem chamar → Abandonado | 2 min | constante |
| Operador sem chamar → Anjo pode encerrar | 5 min | constante |
| Sem mensagem → Encerrado | 15 min | constante |
| Janela de avaliação | 24 h | constante |
| Chamada longa | até 20 s | constante |
| Laço de releitura por processo | 1 s | constante |
| Tarefa de distribuição | 3 s | constante |
| Reconexão | 0,5–2 s aleatório | cliente |
| Modo de reserva | chamada curta a cada 3 s; volta à longa após 1 min; entra após 3 falhas seguidas ou resposta sem bytes por `wait + 5 s` | cliente |
| Chamadas longas por pessoa por processo | 4 (a quinta faz a mais antiga responder na hora) | constante |
| Histórico da fila | 14 dias, mínimo 10 atribuídos | constante |
| Tentativa sem Anjo | no máximo uma por pessoa a cada 10 min (conferido sob a trava da organização) | constante |
| Limites por conta (`RateLimitSettings`) | `humanSupportRequestsPerAccount` 10/h (prévia e criação; conta também os 409); `humanSupportMessagesPerAccount` 60/min; `humanSupportPresencePerAccount` 30/min | `app.ts` |
| Mensagem · nota | até 4000 · até 2000 caracteres | constante |
| Protocolo | `AP-` + 6 símbolos de `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`; colisão = nova tentativa (até 5) | constante |

### Apêndice B — DDL

Migrations só aditivas e idempotentes; número fixado no merge (a 180 está reservada por outra frente).

**`181_chat_rating_details_and_reply_signals.sql` (A0):**

```sql
create table if not exists assistant_interaction_rating_details (
  rating_id uuid primary key references assistant_interaction_ratings(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  reason text not null check (reason in ('WRONG_INFORMATION','DID_NOT_ANSWER','NOT_FOUND','INCOMPLETE','HARD_TO_UNDERSTAND','OTHER')),
  comment text check (comment is null or char_length(comment) between 3 and 1000),
  still_needs_help boolean not null,
  catalog_version text not null,
  check (reason <> 'OTHER' or comment is not null)
);

create table if not exists assistant_reply_signals (
  interaction_id uuid primary key references assistant_interactions(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  signals text[] not null default '{}'
    check (signals <@ array['KNOWLEDGE_NOT_FOUND','KNOWLEDGE_INSUFFICIENT','CONSULTATION_FAILED','SPECIALIST_BLOCKED','NO_REPLY']::text[]),
  signal_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists assistant_reply_signals_org_created on assistant_reply_signals (organization_id, created_at);
```

**`182_human_support.sql` (B0):**

```sql
create table if not exists human_support_settings (
  organization_id uuid primary key references organizations(id),
  enabled boolean not null default false,
  default_capacity smallint not null default 2 check (default_capacity between 1 and 5),
  version integer not null default 0,
  updated_by_person_id uuid references people(id),
  updated_at timestamptz not null default now()
);

create table if not exists human_support_scope_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  scope_type text not null check (scope_type in ('GROUP','SUBGROUP')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  state text not null default 'INHERIT' check (state in ('INHERIT','ON','OFF')),
  updated_by_person_id uuid references people(id),
  updated_at timestamptz not null default now(),
  check ((scope_type = 'GROUP' and team_id is not null and subteam_id is null) or (scope_type = 'SUBGROUP' and subteam_id is not null))
);
create unique index if not exists human_support_scope_settings_group on human_support_scope_settings (organization_id, team_id) where scope_type = 'GROUP';
create unique index if not exists human_support_scope_settings_subgroup on human_support_scope_settings (organization_id, subteam_id) where scope_type = 'SUBGROUP';

create table if not exists human_support_setting_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  target_type text not null check (target_type in ('ORGANIZATION','GROUP','SUBGROUP','ANJO')),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  subject_person_id uuid references people(id),
  field text not null check (field in ('ENABLED','STATE','DEFAULT_CAPACITY','ANJO_CAPACITY')),
  from_value text,
  to_value text,
  actor_person_id uuid not null references people(id),
  occurred_at timestamptz not null default now()
);
create index if not exists human_support_setting_events_org on human_support_setting_events (organization_id, occurred_at);

create table if not exists human_support_agent_presence (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  status text not null default 'OFFLINE' check (status in ('AVAILABLE','PAUSED','OFFLINE')),
  pause_reason text check (pause_reason in ('LUNCH','PERSONAL','PROCESS_ACTIVITY','MEETING')),
  max_concurrent smallint check (max_concurrent between 1 and 5),
  lease_until timestamptz,
  connection_lost_at timestamptz,
  connection_restored_at timestamptz,
  last_assigned_at timestamptz,
  status_since timestamptz not null default now(),
  version integer not null default 0,
  primary key (organization_id, person_id),
  check ((status = 'PAUSED') = (pause_reason is not null))
);
create index if not exists human_support_agent_presence_status on human_support_agent_presence (organization_id, status, lease_until);

create table if not exists human_support_presence_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  from_status text,
  to_status text not null,
  pause_reason text,
  cause text not null check (cause in ('ANJO','LEASE_EXPIRED','ROLE_REVOKED','CONNECTION_LOST','CONNECTION_RESTORED')),
  occurred_at timestamptz not null default now()
);
create index if not exists human_support_presence_events_person on human_support_presence_events (organization_id, person_id, occurred_at);

create table if not exists human_support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  protocol text not null check (protocol ~ '^AP-[2-9A-HJ-NP-Z]{6}$'),
  operator_person_id uuid not null references people(id),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  origin text not null check (origin in ('BUTTON','DISLIKE','SIGNAL')),
  source_conversation_id uuid,
  source_interaction_id uuid,
  source_rating_id uuid,
  shared_context jsonb not null,
  context_version text not null,
  note text check (note is null or char_length(note) <= 2000),
  client_request_id uuid not null,
  status text not null default 'WAITING' check (status in ('WAITING','IN_PROGRESS','CLOSED','CANCELLED','EXPIRED','ABANDONED')),
  end_cause text check (end_cause in ('OPERATOR_CANCELLED','SCOPE_DISABLED','QUEUE_EXPIRED','OPERATOR_ABANDONED','OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY')),
  queued_at timestamptz not null default now(),
  queue_expires_at timestamptz not null,
  queue_deadline_basis text not null check (queue_deadline_basis in ('SUBGROUP','GROUP','ORGANIZATION','DEFAULT')),
  operator_seen_at timestamptz not null default now(),
  next_seq integer not null default 1,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status in ('CLOSED','CANCELLED','EXPIRED','ABANDONED')) = (ended_at is not null and end_cause is not null))
);
create unique index if not exists human_support_requests_protocol on human_support_requests (organization_id, protocol);
create unique index if not exists human_support_requests_open_per_operator on human_support_requests (organization_id, operator_person_id) where status in ('WAITING','IN_PROGRESS');
create unique index if not exists human_support_requests_client on human_support_requests (organization_id, operator_person_id, client_request_id);
create index if not exists human_support_requests_queue on human_support_requests (organization_id, status, queued_at);
create index if not exists human_support_requests_created on human_support_requests (organization_id, created_at);
create index if not exists human_support_requests_operator on human_support_requests (operator_person_id, created_at desc);

create table if not exists human_support_request_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  from_status text,
  to_status text not null,
  cause text not null,
  actor_person_id uuid references people(id),
  occurred_at timestamptz not null default now()
);
create index if not exists human_support_request_events_request on human_support_request_events (request_id, occurred_at);

create table if not exists human_support_attendances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  anjo_person_id uuid not null references people(id),
  operator_person_id uuid not null references people(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ENDED')),
  end_cause text check (end_cause in ('OPERATOR_CLOSED','ANJO_CLOSED','OPERATOR_ABSENT','INACTIVITY','ANJO_LOST')),
  started_at timestamptz not null default now(),
  first_anjo_message_at timestamptz,
  last_human_message_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status = 'ENDED') = (ended_at is not null and end_cause is not null))
);
create unique index if not exists human_support_attendances_active on human_support_attendances (request_id) where status = 'ACTIVE';
create index if not exists human_support_attendances_anjo on human_support_attendances (organization_id, anjo_person_id, status);
create index if not exists human_support_attendances_open on human_support_attendances (organization_id, status, last_human_message_at);

create table if not exists human_support_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  request_id uuid not null references human_support_requests(id) on delete cascade,
  attendance_id uuid references human_support_attendances(id) on delete cascade,
  operator_person_id uuid not null references people(id),
  author_kind text not null check (author_kind in ('OPERATOR','ANJO','SYSTEM')),
  author_person_id uuid references people(id),
  body text not null default '' check (char_length(body) <= 4000),
  system_code text check (system_code is null or system_code in ('QUEUED','ANJO_ASSIGNED','ANJO_CONNECTION_LOST','ANJO_CONNECTION_RESTORED','ANJO_LEFT','ENDED_BY_OPERATOR','ENDED_BY_ANJO','ENDED_OPERATOR_ABSENT','ENDED_INACTIVITY','CANCELLED_BY_OPERATOR','CANCELLED_SCOPE_DISABLED','EXPIRED','ABANDONED')),
  client_message_id uuid,
  seq integer not null,
  occurred_at timestamptz not null default statement_timestamp(),
  check ((author_kind = 'SYSTEM') = (author_person_id is null and system_code is not null)),
  check (author_kind = 'SYSTEM' or char_length(body) >= 1)
);
create unique index if not exists human_support_messages_seq on human_support_messages (request_id, seq);
create unique index if not exists human_support_messages_client on human_support_messages (request_id, client_message_id) where client_message_id is not null;

create table if not exists human_support_classifications (
  attendance_id uuid primary key references human_support_attendances(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  anjo_person_id uuid not null references people(id),
  operator_person_id uuid not null references people(id),
  reason text not null check (reason in ('NO_PROCESS','NO_GUIDANCE','QUESTION_UNCLEAR','FOUND_IN_PROCESS','AVAILABLE_ELSEWHERE','OTHER')),
  reference_title text check (reference_title is null or char_length(reference_title) between 3 and 200),
  reference_url text check (reference_url is null or (char_length(reference_url) <= 500 and reference_url ~* '^https?://')),
  other_description text check (other_description is null or char_length(other_description) between 3 and 1000),
  outcome text not null check (outcome in ('RESOLVED','GUIDED','FORWARDED','NOT_RESOLVED')),
  catalog_version text not null,
  created_at timestamptz not null default now(),
  check (reason not in ('FOUND_IN_PROCESS','AVAILABLE_ELSEWHERE') or reference_title is not null),
  check (reason <> 'OTHER' or other_description is not null)
);

create table if not exists human_support_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  attendance_id uuid not null references human_support_attendances(id) on delete cascade,
  operator_person_id uuid not null references people(id),
  resolved text check (resolved in ('YES','PARTIAL','NO')),
  stars smallint check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  check (resolved is not null or stars is not null)
);
create unique index if not exists human_support_evaluations_current on human_support_evaluations (attendance_id) where superseded_at is null;

create table if not exists human_support_entry_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  team_id uuid references teams(id),
  subteam_id uuid references subteams(id),
  kind text not null check (kind in ('SUGGESTION_ELIGIBLE','NO_ANJO_IN_SERVICE')),
  origin text check (origin in ('BUTTON','DISLIKE','SIGNAL')),
  interaction_id uuid,
  occurred_at timestamptz not null default now()
);
create unique index if not exists human_support_entry_events_suggestion on human_support_entry_events (origin, interaction_id) where kind = 'SUGGESTION_ELIGIBLE';
create index if not exists human_support_entry_events_org on human_support_entry_events (organization_id, kind, occurred_at);
create index if not exists human_support_entry_events_person on human_support_entry_events (organization_id, person_id, kind, occurred_at);

create table if not exists human_support_inbox_versions (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  version bigint not null default 0,
  primary key (organization_id, person_id)
);

-- Registro LGPD: o check de data_kind da 151 é inline (sem nome declarado); acha o nome pelo catálogo.
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
   where conrelid = 'personal_data_access_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%data_kind%';
  if constraint_name is not null then
    execute format('alter table personal_data_access_log drop constraint %I', constraint_name);
  end if;
end $$;
alter table personal_data_access_log add constraint personal_data_access_log_data_kind_check
  check (data_kind in ('CALL_TRANSCRIPT','ASSISTANT_CONVERSATION','EMPLOYEE_PROFILE','HUMAN_SUPPORT_CONVERSATION','HUMAN_SUPPORT_PRESENCE'));
```

### Apêndice C — contratos

Tipos de resposta em `backend/src/modules/human-support/domain/views.ts`; corpos e consultas validados com zod `.strict()` em `backend/src/modules/human-support/presentation/schemas.ts`; espelho no frontend em `frontend/src/schemas/human-support/*.schema.ts` (tipos por `z.infer`). Toda resposta segue o envelope do projeto `{ data: … }`; erro = `{ error: { code, message, details? } }`.

```ts
// Parte A — avaliação
type ChatDislikeReason = "WRONG_INFORMATION" | "DID_NOT_ANSWER" | "NOT_FOUND" | "INCOMPLETE" | "HARD_TO_UNDERSTAND" | "OTHER"
type RatingDetails = { reason: ChatDislikeReason; comment: string | null; stillNeedsHelp: boolean }
type RatingPutBody = { value: "UP" } | { value: "NONE" } | { value: "DOWN"; details?: { reason: ChatDislikeReason; comment?: string; stillNeedsHelp: boolean } }
type RatingPutResponse = { interactionId: string; rating: "up" | "down" | null; ratingId: string | null; details: RatingDetails | null }
// `details` só em mensagem do chat livre; em sessão de feedback ou recado → 422 RATING_DETAILS_NOT_ALLOWED.
type SupportSignal = "KNOWLEDGE_NOT_FOUND" | "KNOWLEDGE_INSUFFICIENT" | "CONSULTATION_FAILED" | "SPECIALIST_BLOCKED" | "NO_REPLY"
// GET …/messages: cada mensagem ganha { ratingId?: string | null; ratingDetails?: RatingDetails | null; signals: SupportSignal[] | null }

// Funil (painel do apoio)
type FunnelQuery = { from: string /* AAAA-MM-DD */; to: string; teamId?: string; subteamId?: string }  // até 92 dias
type MeasureId = "M1" | "M2" | /* … */ "M17"   // M18 não é Measure: vem de GET /monitoring/anjos (AnjoActivity)
type Ratio = { numerator: number | null; denominator: number | null; value: number | null; status: "OK" | "SMALL_SAMPLE" | "NO_DATA" }
type Measure = {
  id: MeasureId
  kind: "COUNT" | "RATE" | "DISTRIBUTION" | "PERCENTILE" | "AVERAGE"
  main: Ratio                                  // contagem: numerator = valor, denominator = null
  coverage?: Ratio                             // M14, M16, M17
  conversion?: Ratio                           // M8 (por coorte)
  noResponse?: Ratio                           // M12: encerrados sem resposta do Anjo / encerrados
  percentiles?: { p50: number | null; p90: number | null; estimate: WaitEstimate | null }   // M11 (estimate, p90), M12 e M13 (p50/p90)
  breakdown?: { key: string; label: string; count: number; value?: number | null }[]
  extra?: { key: string; label: string; count: number }[]   // M10: HAD_ATTENDANCE, OPEN
}
// Chaves de breakdown: M4 = CHAT_DISLIKE_REASONS_V1 + NOT_INFORMED + NOT_COLLECTED; M6 = SUPPORT_SIGNALS_V1;
// M7, M8 = origem; M9 = sem breakdown; M10 = "<status>:<end_cause>"; M12 (noResponse) = end_cause;
// M14 = motivo do encaminhamento (+ títulos mais citados em extra); M15 = resultado; M16 = YES | PARTIAL | NO; M17 = "1".."5".
type FunnelResponse = { period: { from: string; to: string }; cutoffs: { dislikeDetailsSince: string | null; signalsSince: string | null; disabledPeriods: { from: string; to: string | null }[] }; measures: Measure[] }
// replyFunnel(db, organizationId, period, placement) recebe o recorte do Coordenador e o filtro teamId/subteamId.

// Parte B — estado
type Availability = { status: "DISABLED" | "NONE_IN_SERVICE" | "AVAILABLE_NOW" | "ALL_BUSY" | "NONE_AVAILABLE"; estimate: WaitEstimate | null; queueDeadline: string | null /* horário que o pedido teria se fosse criado agora */ }
type WaitEstimate = { kind: "ABOUT" | "MORE_THAN"; minutes: number; basis: "SUBGROUP" | "GROUP" | "ORGANIZATION" } | { kind: "NO_HISTORY" }
type SharedContext = { question: string | null; answer: string | null; dislike: { reason: ChatDislikeReason; reasonLabel: string; comment: string | null } | null; note: string | null }
type MessageView = { id: string; seq: number; authorKind: "OPERATOR" | "ANJO" | "SYSTEM"; authorName: string | null; body: string; systemCode: string | null; occurredAt: string }
type OperatorRequestView = {
  id: string; protocol: string; status: "WAITING" | "IN_PROGRESS" | "CLOSED" | "CANCELLED" | "EXPIRED" | "ABANDONED"
  endCause: string | null; origin: "BUTTON" | "DISLIKE" | "SIGNAL"; createdAt: string; queuedAt: string; queueExpiresAt: string | null
  sharedContext: SharedContext; anjo: { name: string; avatarUrl: string | null; awaitingFirstResponse: boolean } | null
  messages: MessageView[] /* últimas 50 */; hasOlder: boolean; canCancel: boolean; canClose: boolean
}
type PendingEvaluation = { attendanceId: string; requestId: string; protocol: string; anjoName: string; openUntil: string; current: { resolved: "YES" | "PARTIAL" | "NO" | null; stars: number | null } }
type OperatorView = { enabled: boolean; availability: Availability | null /* só com enabled */; openRequest: OperatorRequestView | null; pendingEvaluations: PendingEvaluation[] }
type AnjoView = {
  presence: { status: "AVAILABLE" | "PAUSED" | "OFFLINE"; pauseReason: "LUNCH" | "PERSONAL" | "PROCESS_ACTIVITY" | "MEETING" | null; connected: boolean; since: string }
  capacity: { max: number; used: number }
  attendances: { id: string; requestId: string; protocol: string; operatorName: string; teamName: string | null; subteamName: string | null; startedAt: string; firstAnjoMessageAt: string | null; lastSeq: number; operatorAbsentSince: string | null; sharedContext: SharedContext }[]
  pendingClassifications: { attendanceId: string; protocol: string; operatorName: string; endedAt: string; endCause: string }[]
}
type StateQuery = { since?: string; wait?: number /* 0..20 */; workspace?: "anjo" | "none" }
type StateResponse = { version: string; reconnect?: true; operator: OperatorView | null; anjo: AnjoView | null }

// Parte B — pedido e conversa
type PreviewBody = { interactionId?: string; ratingId?: string }
type PreviewResponse = { origin: "BUTTON" | "DISLIKE" | "SIGNAL"; interactionId: string | null; ratingId: string | null; sharedContext: SharedContext; availability: Availability }
type CreateRequestBody = { clientRequestId: string; interactionId?: string; ratingId?: string; note?: string /* ≤ 2000 */ }
type CreateRequestResponse = { request: OperatorRequestView }
type MessagesQuery = { after?: number; before?: number; limit?: number /* ≤ 50 */ }
type MessagesPage = { messages: MessageView[]; hasMore: boolean }
type SendMessageBody = { clientMessageId: string; body: string /* 1..4000 */ }
type CloseBody = { cause?: "OPERATOR_ABSENT" }
type EvaluationBody = { resolved?: "YES" | "PARTIAL" | "NO"; stars?: 1 | 2 | 3 | 4 | 5 }   // ao menos um
type MyRequestsResponse = { items: { id: string; protocol: string; status: string; origin: string; createdAt: string; endedAt: string | null; anjoName: string | null; evaluation: PendingEvaluation["current"] | null; evaluationOpenUntil: string | null }[]; nextCursor: string | null }

// Parte B — Anjo
type PresenceBody = { status: "AVAILABLE" } | { status: "PAUSED"; pauseReason: "LUNCH" | "PERSONAL" | "PROCESS_ACTIVITY" | "MEETING" } | { status: "OFFLINE" }
type ClassificationBody = { reason: "NO_PROCESS" | "NO_GUIDANCE" | "QUESTION_UNCLEAR" | "FOUND_IN_PROCESS" | "AVAILABLE_ELSEWHERE" | "OTHER"; referenceTitle?: string; referenceUrl?: string; otherDescription?: string; outcome: "RESOLVED" | "GUIDED" | "FORWARDED" | "NOT_RESOLVED" }
type AnjoAttendancesResponse = { items: { attendanceId: string; requestId: string; protocol: string; operatorName: string; startedAt: string; firstAnjoMessageAt: string | null; endedAt: string | null; endCause: string | null; classified: boolean }[]; nextCursor: string | null }

// Parte B — Administrador geral
type SettingsView = { enabled: boolean; defaultCapacity: number; version: number }
type SettingsUpdate = SettingsView   // version otimista: 409 HUMAN_SUPPORT_CONCURRENT_CHANGE se mudou
type ScopeNode = { type: "GROUP" | "SUBGROUP"; id: string; name: string; state: "INHERIT" | "ON" | "OFF"; effective: boolean; effectiveSource: "OWN" | "GROUP" | "DEFAULT_OFF" | "MASTER_OFF"; anjoCount: number; warnings: "ENABLED_WITHOUT_ANJO"[]; children?: ScopeNode[] }
// PUT /scopes/:scopeType/:id  (scopeType = "group" | "subgroup")  body { state: "INHERIT" | "ON" | "OFF" }
type AnjoRow = { personId: string; name: string; scopes: { type: "ORGANIZATION" | "GROUP" | "SUBGROUP"; id: string | null; name: string }[]; maxConcurrent: number | null; effectiveCapacity: number; status: "AVAILABLE" | "PAUSED" | "OFFLINE"; connected: boolean; used: number; canReceiveAssignment: boolean | null; reasonNotEligible: "OFFLINE" | "PAUSED" | "NO_CAPACITY" | "NOT_CONNECTED" | "SCOPE_NOT_COVERED" | null }
// GET /anjos?teamId&subteamId → { items: AnjoRow[] }  (canReceiveAssignment/reasonNotEligible só com filtro)
// PUT /anjos/:personId/capacity  body { maxConcurrent: number | null }

// Parte B — painel do apoio (Coordenador, Administrador geral)
// GET /metrics → FunnelResponse (M1–M17)
type RequestListQuery = FunnelQuery & { status?: string; origin?: string; cursor?: string; limit?: number }
type RequestListItem = { id: string; protocol: string; operatorName: string; teamName: string | null; subteamName: string | null; origin: string; status: string; endCause: string | null; createdAt: string; endedAt: string | null; anjoNames: string[]; firstResponseSeconds: number | null; classificationReason: string | null; outcome: string | null; resolved: string | null; stars: number | null }
type RequestDetail = RequestListItem & { sharedContext: SharedContext; messages: MessageView[]; attendances: { id: string; anjoName: string; startedAt: string; firstAnjoMessageAt: string | null; endedAt: string | null; endCause: string | null }[]; classification: ClassificationBody | null }
type UnavailableAttemptsQuery = FunnelQuery & { cursor?: string; limit?: number }
type UnavailableAttempt = { occurredAt: string; personName: string; teamName: string | null; subteamName: string | null; origin: "BUTTON" | "DISLIKE" | "SIGNAL" | null }
// GET /unavailable-attempts → { items: UnavailableAttempt[]; nextCursor: string | null }
type AnjoActivity = { personId: string; name: string; hoursAvailable: number; hoursPaused: Record<"LUNCH" | "PERSONAL" | "PROCESS_ACTIVITY" | "MEETING", number>; hoursDisconnected: number; attendances: number; firstResponse: { p50Seconds: number | null; p90Seconds: number | null; withoutResponse: number }; averageStars: number | null /* com ≥ 5 notas */ }
type PresenceTimeline = { events: { occurredAt: string; fromStatus: string | null; toStatus: string; pauseReason: string | null; cause: string }[] }
// GET /monitoring/anjos?from&to&teamId&subteamId → { items: AnjoActivity[] };  GET /monitoring/anjos/:personId/presence?from&to → PresenceTimeline
// Listas com nextCursor aceitam ?cursor=<opaco>&limit=<≤ 50>.
```

**Rotas: sucesso e erros** (além de 401/403 de sessão e permissão, 404 fora do alcance e 422 `VALIDATION_ERROR`):

| Rota | Sucesso | Erros próprios |
| --- | --- | --- |
| `PUT …/rating` | 200 `RatingPutResponse` | 422 `RATING_DETAILS_NOT_ALLOWED` |
| `GET /monitoring/metrics` | 200 `FunnelResponse` | 422 `PERIOD_TOO_LONG` (> 92 dias) |
| `GET /me/state` | 200 `StateResponse` | — |
| `POST /requests/preview` | 200 `PreviewResponse` (grava a tentativa quando `NONE_IN_SERVICE`) | 409 `HUMAN_SUPPORT_DISABLED`; 429 limite |
| `POST /requests` | 201 `CreateRequestResponse` (200 com a mesma chave de idempotência) | 409 `HUMAN_SUPPORT_DISABLED`, `HUMAN_SUPPORT_NO_ANJO_IN_SERVICE`, `HUMAN_SUPPORT_REQUEST_ALREADY_OPEN`; 429 limite |
| `POST /requests/:id/cancel` | 200 `{ request: OperatorRequestView }` | 409 `HUMAN_SUPPORT_REQUEST_ENDED` (já terminou ou já em atendimento: usar `close`) |
| `POST /requests/:id/close` | 200 `{ request: OperatorRequestView }` | 409 `HUMAN_SUPPORT_REQUEST_ENDED`, `HUMAN_SUPPORT_OPERATOR_PRESENT` |
| `GET /requests/:id/messages` | 200 `MessagesPage` | — |
| `POST /requests/:id/messages` | 201 `{ message: MessageView }` (200 com a mesma chave) | 409 `HUMAN_SUPPORT_REQUEST_ENDED`; 404 para Anjo fora do próprio atendimento em andamento; 429 limite |
| `PUT /attendances/:id/evaluation` | 200 `{ current: PendingEvaluation["current"] }` | 409 `HUMAN_SUPPORT_EVALUATION_CLOSED` (24 h passadas ou atendimento Interrompido) |
| `GET /me/requests`, `GET /anjo/attendances` | 200 lista | — |
| `PUT /anjo/presence` | 200 `{ anjo: AnjoView }` | 409 `HUMAN_SUPPORT_NOT_CONNECTED` (sem a área aberta), `HUMAN_SUPPORT_NO_ENABLED_SCOPE`, `HUMAN_SUPPORT_ACTIVE_ATTENDANCES`; 429 limite |
| `POST /attendances/:id/classification` | 201 `{ classification: ClassificationBody }` | 409 `HUMAN_SUPPORT_ALREADY_CLASSIFIED`; 422 regras de título/descrição |
| `GET`/`PUT /admin/human-support/settings` | 200 `SettingsView` | 409 `HUMAN_SUPPORT_CONCURRENT_CHANGE` |
| `GET /admin/human-support/scopes` · `PUT …/scopes/:scopeType/:id` | 200 `{ items: ScopeNode[] }` · 200 `{ node: ScopeNode }` | 404 Grupo/Subgrupo inexistente |
| `GET /admin/human-support/anjos` · `PUT …/anjos/:personId/capacity` | 200 `{ items: AnjoRow[] }` · 200 `{ row: AnjoRow }` | 404 pessoa sem o papel |
| `GET /monitoring/requests`, `/:id`, `/unavailable-attempts`, `/anjos`, `/anjos/:personId/presence` | 200 | 422 `PERIOD_TOO_LONG` |

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Fases

| Fase | Entrega | Liga o quê | Pré-condição e responsável |
| --- | --- | --- | --- |
| A0 | Migration 181; detalhes da avaliação; sinais; `replyFunnel` | nada visível (o servidor aceita os campos novos; nada os envia) | — |
| A1 | Formulário da descurtida; sinais no histórico | formulário para todos (dados coletados; números só na B1, D7) | todas as APIs na A0 (quem publica confere) |
| B0 | Migration 182; módulo `human-support`; permissões e papéis; tarefa de distribuição; métricas | nada (tudo desligado) | A0 |
| B1 | Sala de apoio, área do Anjo, telas de administração e painel do apoio; piloto num Subgrupo | chave geral + 1 Subgrupo | A1; roteiro do IIS aprovado (Verification Plan); Administrador geral confirma ≥ 2 Anjos com papel no Subgrupo piloto e treinados pelo negócio |
| B2 | Expansão por Grupo | estados dos escopos | Coordenador de Anjos revisa M7–M18 do piloto após 2 semanas; Administrador geral decide |

Cada fase deixa o código compilando e testado; nenhuma depende de flag de ambiente.

### Reversão

* **Parte B:** desligar a chave geral (fila cancelada com aviso; nenhum pedido novo, 409 `HUMAN_SUPPORT_DISABLED`) → aguardar ou encerrar os atendimentos em andamento (aba Pedidos) → reverter o código. Migrations só aditivas; o código antigo ignora as tabelas novas; papel desconhecido não dá permissão (`access/domain/access-decision.ts:14`).
* **Parte A:** primeiro o frontend (volta o polegar de hoje; o servidor novo continua aceitando `DOWN` sem detalhes), depois o backend — nessa ordem, porque o esquema antigo da avaliação é `.strict()` e recusaria `details`. O backend antigo deixa `assistant_interaction_rating_details` e `assistant_reply_signals` sem leitor.

### Target Files to Create/Modify

Testes ficam ao lado do código, como no resto do repositório.

#### Fase A0 — backend

1. `backend/migrations/181_chat_rating_details_and_reply_signals.sql` (Create) — Apêndice B.
2. `backend/src/modules/assistant/domain/assistant-interaction-rating.ts` (Modify) — esquema com `details`, `CHAT_DISLIKE_REASONS_V1`, regras 1–3 da seção 2.
3. `backend/src/modules/assistant/domain/assistant-interaction-rating.test.ts` (Create) — casos das regras 1–3, "Outro" sem comentário, motivo fora da lista.
4. `backend/src/modules/assistant/application/assistant-interaction-ratings.ts` (Modify) — grava detalhes na mesma transação; `loadConversationRatings` devolve `ratingId` e `details`.
5. `backend/src/modules/assistant/application/assistant-conversations.ts` (Modify) — `ConversationStore.rate` e `ratingsOf` com `ratingId`/`details`; `append` recebe `signals` e grava a linha na mesma transação (chat livre); `markNoReply`; `loadConversationMessages` traz `signals` por `left join assistant_reply_signals` (`null` = sem linha); `ResolvedConversation` ganha `origin`.
6. `backend/src/modules/assistant/testing/memory-conversation-store.ts` (Modify) — mesma interface.
7. `backend/src/modules/assistant/domain/reply-signals.ts` e `reply-signals.test.ts` (Create) — `signalsOf` (entrada: resultados de especialistas com `knowledge`/`toolTrace`/`failed`, chamadas com `outcome`, resultados diretos com cartão/texto, estado do esclarecimento) e um caso por sinal, por "conteúdo" e por lista vazia.
8. `backend/src/modules/assistant/application/run-orchestrated-reply.ts` (Modify) — resultado que falhou ganha `failed: true`.
9. `backend/src/modules/assistant/application/reply-funnel.ts` e `reply-funnel.test.ts` (Create) — M1–M6 com `placement` (seção 4).
10. `backend/src/modules/assistant/application/conversation-monitoring.ts` (Modify) — acompanha a nova forma de `loadConversationRatings`.
11. `backend/src/modules/assistant/application/support-context.ts` e `support-context.test.ts` (Create) — `buildSupportContext` (seção 7), incluindo pergunta do esclarecimento.
12. `backend/src/modules/realtime/presentation/realtime-router.ts` (Modify):
    * rota de avaliação com `details` e resposta nova;
    * sinais em cada ramo da tabela da seção 3;
    * `markNoReply` no caminho do `error`;
    * `signals`, `ratingId` e `ratingDetails` no `GET …/messages`;
    * opção `recordSuggestion?` recebida na criação do router e chamada depois de sinal ou descurtida com necessidade, só no chat livre;
    * notas `replyInteractionId` e `supportSignals` no rastreamento.
13. `backend/src/modules/realtime/presentation/realtime-router-ratings.test.ts` (Modify) — `details`, regras 1–3, resposta, 422 fora do chat livre.
14. `backend/src/modules/realtime/presentation/realtime-router-reply-signals.test.ts` (Create) — um caso por ramo da tabela da seção 3, `NO_REPLY` e `recordSuggestion` chamada só quando deve.
15. `backend/src/modules/data-lifecycle/domain/retention-catalog.ts` (Modify) — `assistant_reply_signals` como filho de `assistant_interactions`.
16. `backend/src/modules/assistant/testing/assistant-interaction-ratings-proof.test.ts` (Modify) — prova contra o banco: detalhes e versões; toda mensagem da INIA do chat livre gravada tem linha de sinais; exportação do titular leva detalhes e sinais; retenção apaga a resposta com os sinais.

#### Fase A1 — frontend

17. `frontend/src/components/operator/operator-inia-chat/dislike-form.tsx` e `dislike-form.test.tsx` (Create) — seção 2; prop `onRequestSupport?(interactionId, ratingId)` (ausente = texto "ainda não está disponível").
18. `frontend/src/components/operator/operator-inia-chat/chat-message-list.tsx` (Modify) — polegar abre o formulário; prop `renderSupportSuggestion?(message)` (ausente na A1).
19. `frontend/src/components/operator/operator-inia-chat/chat-message.ts` (Modify) — `ratingId`, `ratingDetails`, `signals`.
20. `frontend/src/lib/realtime/gemini-text-client.ts` (Modify) — `saveMessageRating` com `details`, erro propagado; `ConversationRef.userMessageId`.
21. `frontend/src/components/operator/operator-inia-chat.tsx` (Modify) — `rate` espera o formulário no `DOWN` do chat livre; balão de erro do `send` guarda `userMessageId` e `signals: ["NO_REPLY"]`.
22. `frontend/src/components/operator/operator-inia-chat.test.tsx` (Modify) — formulário, erro visível, balão de erro com id.

#### Fase B0 — backend

23. `backend/migrations/182_human_support.sql` (Create) — Apêndice B.
24. `backend/src/modules/access/domain/permissions.ts`, `roles.ts`, `access-decision.ts` (Modify) — seção 5.
25. `backend/src/modules/access/application/access-service.test.ts` (Modify) — só o Administrador geral concede os dois papéis; nenhum outro delega; capacidades.
26. `backend/src/modules/access/application/permission-holders.ts` (Modify) e `permission-holders.test.ts` (Create) — `personIdsWithPermissionCovering` e `assignmentScopesOf`; casos: organização, Grupo, Subgrupo, "Minha estrutura" ignorada, pessoa sem Subgrupo, sem Grupo, conta inativa, atribuição revogada.
27. `backend/src/modules/human-support/domain/` (Create), cada um com `.test.ts` ao lado:
    * `catalogs.ts` — `HUMAN_SUPPORT_CATALOG_VERSION`, listas, rótulos, `SYSTEM_MESSAGE_CODES_V1` com os textos para operador e Anjo, `REQUEST_EVENT_CAUSES_V1`;
    * `enablement.ts`;
    * `request-lifecycle.ts` — transições de pedido e atendimento (um caso por transição e por recusa);
    * `presence.ts` — transições e derivados;
    * `origin.ts`;
    * `queue-history.ts` — população, espera estimada (recorte, mínimo, "mais de X", sem histórico, desligados fora) e prazo da fila (p90, limites 10–25, padrão 20);
    * `availability.ts` — precedência da seção 9;
    * `classification.ts`, `evaluation.ts` (24 h);
    * `views.ts` (Apêndice C);
    * `metrics-definitions.ts` (M7–M18).
28. `backend/src/modules/human-support/application/` (Create):
    * `eligibility.ts`, `settings-service.ts`, `request-service.ts` (prévia com registro da tentativa, criação, cancelamento, encerramento), `presence-service.ts`, `message-service.ts`, `classification-service.ts`, `evaluation-service.ts`, `state-service.ts`, `inbox-versions.ts`, `dispatch.ts` (seção 8, incluindo a atribuição), `suggestions.ts`, `metrics-service.ts`, `coordination-service.ts` (pedidos, tentativas sem Anjo, Anjos), `audit.ts`;
    * `waiters.ts` e `waiters.test.ts` — resposta por mudança, por prazo, por dreno, pela quinta chamada.
29. `backend/src/modules/human-support/presentation/` (Create) — `schemas.ts`, `human-support-router.ts`, `human-support-admin-router.ts`, `human-support-monitoring-router.ts`.
30. `backend/src/modules/human-support/testing/` (Create):
    * `human-support-proof.test.ts` — Verification Plan;
    * `human-support-isolation.test.ts` — testes de estrutura do servidor;
    * `human-support-state-contract.test.ts` — visão do operador sem presença.
31. `backend/src/modules/data-lifecycle/domain/retention-catalog.ts` (Modify) — alvos da seção 13.
32. `backend/src/modules/data-lifecycle/application/personal-data-access-log.ts` (Modify) — dois tipos novos; devolve `boolean`.
33. `backend/src/main/readiness.ts` e `readiness.test.ts` (Modify) — `onDraining(listener)`.
34. `backend/src/main/runtime-metrics.ts` e `runtime-metrics.test.ts` (Modify) — `excludeFromLatency`.
35. `backend/src/main/app.ts` (Modify):
    * montar os três routers (admin antes da linha 425), com `requireAuth`, guardas de permissão e os limites novos em `RateLimitSettings`;
    * passar `recordSuggestion` ao `realtime-router`;
    * receber o registro de esperas por opção.
36. `backend/src/main/server.ts` (Modify) — criar o registro de esperas (papel API), ligar a `readiness.onDraining`, seção `humanSupport` nas métricas, tarefa `human-support-dispatch` (3 s) no processamento.

#### Fase B1 — frontend

37. `frontend/src/schemas/human-support/` (Create) — `state.schema.ts`, `request.schema.ts`, `message.schema.ts`, `admin.schema.ts`, `monitoring.schema.ts`.
38. `frontend/src/services/human-support/human-support-service.ts` (Create).
39. `frontend/src/queries/human-support/` (Create):
    * `use-human-support-state.ts` e `.test.ts` — aba líder, reserva, reconexão; exposto por `HumanSupportStateProvider` (Context) montado uma vez no shell — o chat, o selo e a sala leem por `useHumanSupportState()` e nunca montam outra chamada;
    * `use-anjo-workspace-state.ts` e `.test.ts` — trava de aba única, `workspace=anjo`, alerta de atendimento novo;
    * `use-human-support-admin.ts`, `use-human-support-monitoring.ts`.
40. `frontend/src/components/human-support/operator/` (Create):
    * `support-room.tsx` e `.test.tsx`, `support-composer.tsx`, `support-status-pill.tsx`, `request-dialog.tsx` (botão desabilitado sem Anjo em serviço; prazo da fila), `support-suggestion.tsx`, `support-evaluation.tsx`, `support-history-section.tsx`;
    * `support-button.tsx` — botão permanente.
41. `frontend/src/components/human-support/anjo/` (Create) — `anjo-workspace.tsx` e `.test.tsx`, `presence-control.tsx`, `attendance-pane.tsx` ("Sem resposta há N min"), `classification-form.tsx`, `attendance-history.tsx`.
42. `frontend/src/components/human-support/admin/human-support-admin-page.tsx` e `.test.tsx` (Create).
43. `frontend/src/components/human-support/monitoring/human-support-monitoring-page.tsx`, `.test.tsx`, `request-detail.tsx`, `unavailable-attempts-tab.tsx` e `anjos-activity-tab.tsx` (Create); `human-support-monitoring-route.ts` (Create) — `HUMAN_SUPPORT_MONITORING_PATH`.
44. `frontend/src/components/human-support/isolation.test.ts` (Create) — `components/human-support/**` não importa `lib/realtime/**` nem `lib/avatar/**`.
45. `frontend/src/components/operator/operator-inia-chat.tsx` (Modify) — selo; troca para a sala chamando `closeVoiceSessionForSwitch()`; botão permanente no cabeçalho (`:1983-1988`); passa `renderSupportSuggestion` e `onRequestSupport`.
46. `frontend/src/components/operator/operator-inia-chat.test.tsx` (Modify) — abrir a sala encerra a voz; o envio da sala nunca chama o transporte de voz.
47. `frontend/src/components/operator/inia-conversation-history-sheet.tsx` (Modify) — seção "Apoio com Anjo".
48. `frontend/src/components/auth/session-idle-guard.tsx` e `session-idle-guard.test.tsx` (Modify) — sem `scroll`; rolagem feita pelo código não renova.
49. `frontend/src/schemas/auth/auth.schema.ts` (Modify) — três capacidades.
50. `frontend/src/components/admin/admin-sidebar.tsx` (Modify) — "Plataforma › Apoio com Anjo" (`canManageHumanSupport`) e "Monitoramento › Apoio com Anjo" (`canCoordinateHumanSupport`).
51. `frontend/src/app/(app)/admin/layout.tsx` e `frontend/src/app/(app)/admin/page.tsx` (Modify) — área isolada e redirecionamento do Coordenador.
52. `frontend/src/components/layout/authenticated-app-shell.tsx` (Modify) — entrada em Administração com `canCoordinateHumanSupport`; `canAttendHumanSupport` no estado do shell; montar `HumanSupportStateProvider`.
53. `frontend/src/components/layout/top-bar/app-top-bar.tsx` e `area-switcher.tsx` (Modify) — "Área do Anjo".
54. `frontend/src/proxy.ts` (Modify) — `/apoio` em `AUTHENTICATED_PREFIXES`.
55. `frontend/src/app/(app)/apoio/page.tsx`, `frontend/src/app/(app)/admin/human-support/page.tsx`, `frontend/src/app/(app)/admin/human-support-monitoring/page.tsx` (Create) — páginas finas.

#### Documentação (fase em que cada parte entra)

56. `docs/dev/memoria/apoio-com-anjo.md` (Create, A0, atualizado em B0) e `CLAUDE.md` (Modify, A0) — linha no índice das áreas.
57. `frontend/src/app/wiki/apoio-com-anjo/page.tsx` (Create, B1) e `frontend/src/components/wiki/wiki-nav.ts` (Modify, B1).

### Verification Plan

* **Build:** `npm run typecheck`, `npm run lint` (backend e frontend); `npm run typecheck:scripts`.
* **Banco de teste:** `cd backend && npm run db:migrate:test`; cada prova roda sozinha com `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run <prova>`. Se uma prova parar sem terminar, conferir esperas com `select pid, mode, granted, query from pg_locks join pg_stat_activity using (pid) where not granted;`.
* **Casos unitários:** listados nos itens 3, 7, 9, 11, 13, 14, 25, 26, 27, 28, 33, 34.
* **Provas contra o banco** (`human-support-proof`; "em paralelo" = duas transações ao mesmo tempo):
  * 10 criações em paralelo com a mesma chave de idempotência → 1 pedido; com chaves diferentes → 1 pedido e 409 `HUMAN_SUPPORT_REQUEST_ALREADY_OPEN` nas demais;
  * duas distribuições em paralelo nunca atribuem o mesmo pedido a dois Anjos nem passam da capacidade de um Anjo; 20 pedidos e 3 Anjos com capacidade 2 → 6 atendimentos e 14 na fila, em ordem de chegada;
  * atribuição vai ao Anjo com menos atendimentos e, no empate, ao que recebeu há mais tempo; Anjo em pausa ou sem conexão não recebe;
  * cancelar e a distribuição em paralelo: ou cancela, ou atribui, nunca os dois;
  * mensagem depois do encerramento → 409; mesma chave → mesma mensagem; 20 mensagens em paralelo de operador e Anjo → `seq` 1..20 sem lacuna; mensagem e encerramento em paralelo; primeira mensagem do Anjo grava `first_anjo_message_at` uma vez;
  * mensagem e distribuição em paralelo, repetido 50 vezes, sem deadlock;
  * conexão vencida → aviso ao operador; volta dentro da carência → "O Anjo voltou"; 3 min depois → Interrompido e pedido na frente da fila com novo prazo; Anjo `OFFLINE` com atendimento e aba fechada também é interrompido; papel revogado → interrompido na próxima distribuição;
  * operador sem chamar 2 min na fila → Abandonado; prazo da fila vencido → Expirado; 15 min sem mensagem → Encerrado, inclusive sem resposta do Anjo;
  * prazo da fila: com histórico, p90 limitado a 10–25 min; sem histórico, 20 min; gravado e devolvido como horário;
  * desligar o escopo com fila e atendimento → fila cancelada, atendimento segue;
  * sem Anjo em serviço → a prévia registra a tentativa (uma a cada 10 min por pessoa) e a criação responde 409;
  * cópia criada igual à prévia (mesmos ids), sempre com a resposta;
  * escopos: Anjo do Grupo A não recebe pedido do Grupo B; Coordenador do Grupo A recebe 404 no pedido e na tentativa do Grupo B e não vê a presença de Anjo de organização;
  * exportação do operador — contém: pedidos, mensagens, atendimentos, classificações, avaliações, tentativas; não contém: presença, pausas;
  * exportação do Anjo — contém: atendimentos, presença, classificações, mensagens dele; não contém: avaliações;
  * retenção de pedidos só em estado final, levando os filhos;
  * registro LGPD gravado depois do commit (inclusive na atribuição); falha dele não desfaz a atribuição; uma linha por pessoa vista;
  * limites por conta; versão otimista das configurações.
* **Contrato:** o JSON do `GET /me/state` de um operador não tem chave de presença ou pausa, nem com Anjos em pausa.
* **Estrutura:** itens 30 e 44.
* **Sessão:** área do Anjo aberta 30 min sem interação, recebendo mensagens → sessão expirada e Anjo sem conexão (relógio falso; item 48 no frontend e prova no backend).
* **Dreno:** chamada longa aberta + início do dreno → resposta com `reconnect: true` em ≤ 1 s; chamada nova durante o dreno → resposta em ≤ 1 s; o processo termina antes de `INIA_SHUTDOWN_TIMEOUT_MS` (25 s) sem `shutdown_timeout` (itens 28 e 33).
* **IIS (antes da B1):** num Windows Server com 2 APIs atrás do ARR, aprovado quando:
  1. uma mudança feita durante uma chamada longa chega ao navegador em ≤ 1,5 s;
  2. reiniciar uma API no meio de uma chamada faz o cliente reconectar em ≤ 5 s, mostrando só "Reconectando…";
  3. com 50 chamadas longas abertas, `GET /auth/me` mantém p95 ≤ 500 ms.

## Notas da implementação da Parte A

Ajustes de detalhe feitos ao implementar A0/A1 (09/11/2026). Nenhum muda experiência, regra de negócio ou significado de métrica; todos estão cobertos por teste.

* **Conteúdo de resultado direto** (seção 3): conta só o cartão de dados. Um resultado direto só com texto é o pedido que a ferramenta não resolveu (ex.: indicador ambíguo), e contá-lo esconderia o `KNOWLEDGE_NOT_FOUND`.
* **Chamada impedida** não conta como especialista consultado: impedida + nenhuma consulta com conteúdo = só `SPECIALIST_BLOCKED`; impedida + consultada sem conteúdo = os dois sinais.
* **DATA_ONLY e liderança** seguem a tabela da seção 3 (lista vazia; liderança só com o `KNOWLEDGE_INSUFFICIENT` da consulta de processo), também pela voz (`answerVoiceAsk`). Resposta barrada pela conferência (PEN-017) por violação de regra grava lista vazia, no chat e na voz; trocada porque a própria conferência falhou grava `CONSULTATION_FAILED` (decisão do responsável em 10/11/2026, depois da conferência das telas — `signalsAfterResponseCheck`).
* **`ResolvedConversation` não ganhou `origin`**: o `/messages` usa a origem da conversa já lida no contexto do turno, e a sugestão lê a conversa só quando há sinal e a função está injetada. A rota de avaliação usa a origem devolvida por `rate`. Registro sem origem = `USER` (contrato de `ConversationRecord`).
* **Evento `persisted`** leva `signals` no chat livre, para a sugestão aparecer sem recarregar o histórico. A mensagem na tela ganha `data-support-signals`.
* **Funil:** M4 usa as descurtidas vigentes como base (sem dados com zero; parcelas ocultas abaixo de 5). `NO_REPLY` aparece no detalhamento de M6 como contagem de perguntas, sem taxa, porque fica na pergunta e não em M1. `replyFunnel` devolve `period`, `cutoffs` (sem os períodos desligados, que a Parte B acrescenta) e as medidas M1–M6.
* **Cópia da troca:** a resposta sai sem os marcadores de fonte (`[1]`, `[2]`…) que a tela tira, como o operador a viu. O motivo entra só quando a versão informada é a descurtida da própria pessoa com "Sim".
* **Monitoramento da gestão** (conversas com a INIA) continua recebendo só o valor da avaliação, sem o motivo nem os sinais.

## Notas da implementação da Parte B

Ajustes de detalhe feitos ao implementar B0/B1 (09/11/2026). Nenhum muda experiência, regra de negócio ou significado de métrica.

* **Erro de entrada** responde 400 `VALIDATION_ERROR` (a convenção do `errorHandler` do projeto), não 422.
* **Encerrar com o pedido de volta à fila** (o atendimento foi interrompido enquanto o operador clicava): para o operador, vira cancelar. Para o Anjo que já saiu do atendimento, 409 `HUMAN_SUPPORT_REQUEST_ENDED`.
* **`POST /requests/:id/close` do Anjo** devolve `{ anjo: AnjoView }`; o do operador, `{ request }`.
* **Pausa a partir de Indisponível** é recusada com 409 `HUMAN_SUPPORT_PRESENCE_INVALID` (a tabela da seção 6 só prevê pausa a partir de Disponível); trocar o motivo de uma pausa é permitido.
* **`operatorAbsentSince`** vem preenchido quando o operador não chama o servidor há mais de 60 s; o botão "operador sem a INIA aberta" habilita aos 5 min e o servidor confere de novo.
* **Lista de quem tem o papel**: `access/application/permission-holders.ts` ganhou também `personIdsWithPermission` (todas as pessoas com a permissão), usado na aba Anjos, na árvore de escopos e no M18.
* **Conversa de origem do pedido** vem de `buildSupportContext` (`conversationId`), para o módulo não ler tabelas do `assistant`.
* **Políticas de retenção** dos três alvos novos entram desligadas pela própria migration 182.
* **Contrato do estado do operador** (sem presença nem pausa) é conferido na prova `human-support-proof` com Anjos em pausa, em vez de um arquivo de teste separado.
* **Consultas do frontend** do painel e da configuração ficam num arquivo só (`queries/human-support/use-human-support-admin.ts`).

## Decisão posterior: sem botão fixo (10/11/2026)

Ao usar o apoio no ambiente de dev, o responsável decidiu tirar o botão permanente do cabeçalho do chat (G3, OQ4 e seção 14):
o apoio só é oferecido **depois que a pessoa tentou com a INIA** — pela sugestão abaixo de uma resposta com sinal (não encontrou,
bases insuficientes, consulta não concluída, especialista indisponível, sem resposta) ou pela descurtida com "Sim" em "ainda precisa
de ajuda?". Com um pedido aberto ou uma avaliação pendente, o selo "Apoio · …" acima da conversa continua levando à sala. A API
segue aceitando pedido sem mensagem de origem (`BUTTON`): os pedidos antigos com essa origem continuam contados no M8, mas a tela
não oferece mais esse caminho.

## Decisão posterior: fim do atendimento encerra a conversa com a INIA (10/11/2026)

Quando termina um atendimento que estava em andamento, a conversa com a INIA de onde o pedido saiu é encerrada (motivo
`HUMAN_SUPPORT`, migration 183, "Encerrada após o apoio do Anjo" no histórico): o assunto foi tratado com uma pessoa e a próxima
pergunta abre conversa nova. Pedido que sai da fila sem atendimento não mexe na conversa. O módulo do apoio chama
`closeConversationAfterHumanSupport` do `assistant` (exportada em `support-context.ts`, já na lista do que o apoio pode usar); o
`assistant` continua sem conhecer o apoio.

## Critérios de aceite

* **CA1.** O formulário da descurtida no chat livre exige motivo e a resposta a "ainda precisa de ajuda?" e envia tudo numa chamada; "Outro" exige comentário; falha aparece na tela; fechar sem enviar não grava. O servidor continua aceitando `DOWN` sem detalhes.
* **CA2.** Toda mensagem da INIA do chat livre é gravada com a lista de sinais calculada por código, sem ler o texto da resposta; `NO_REPLY` fica na pergunta.
* **CA3.** Sugestão não cria pedido; o pedido é criado só no "Pedir ajuda", com a cópia da troca (incluindo a resposta da INIA) igual à prévia.
* **CA4.** Sem Anjo em serviço, "Pedir ajuda" fica desabilitado, nenhum pedido é criado e a tentativa é registrada (no máximo uma por pessoa a cada 10 min) e aparece no painel do apoio.
* **CA5.** Um pedido aberto por operador; cliques repetidos não duplicam.
* **CA6.** Com um Anjo disponível e com vaga, o pedido é atribuído na hora, sem aceite; sem vaga, entra na fila e é atribuído assim que alguém pode receber, em ordem de chegada.
* **CA7.** Um pedido nunca fica com dois Anjos ao mesmo tempo; a capacidade nunca é ultrapassada.
* **CA8.** O prazo da fila é calculado pelo histórico (10–25 min; 20 sem histórico) e mostrado como horário; vencido, o pedido expira com aviso; operador sem a INIA aberta por 2 min → Abandonado; o operador pode cancelar enquanto o pedido está Na fila.
* **CA9.** A espera estimada nunca mostra zero nem tempo sem histórico e diz que é estimativa.
* **CA10.** O operador vê, em texto, cada momento: pediu ajuda, na fila e até quando, quem recebeu o pedido, aguardando a primeira resposta, Anjo sem conexão, Anjo voltou, encerrado.
* **CA11.** Mensagem depois do encerramento é recusada; atendimento encerrado não reabre; mensagens chegam na ordem do `seq`, sem lacuna.
* **CA12.** Anjo sem conexão por 3 min além do prazo de 75 s → Interrompido e pedido na frente da fila; papel revogado → Interrompido na próxima distribuição (até 3 s).
* **CA13.** Desligar o escopo cancela a fila com aviso e mantém os atendimentos em andamento.
* **CA14.** O operador nunca recebe motivo de pausa, nem em resposta de API.
* **CA15.** Nenhuma mensagem do apoio chega a um modelo: testes de estrutura no servidor e no navegador; abrir a sala encerra a voz.
* **CA16.** Anjo só recebe pedidos dos escopos do papel; Coordenador de Anjos só vê o que o alcance da seção 5 permite; fora = 404.
* **CA17.** A área do Anjo aberta, mesmo recebendo mensagens, não impede a sessão de expirar em 30 min.
* **CA18.** Classificação com motivo do encaminhamento e resultado; título obrigatório em "informação existente em processo" e "obtida pelo sistema ou por outra IA".
* **CA19.** Estrelas e Resolução declarada opcionais, separadas, alteráveis por 24 h com histórico.
* **CA20.** Funil M1–M17 e M18 por Anjo com numerador, denominador, datas de corte e "sem dados", só no painel do apoio para Coordenador de Anjos e Administrador geral; nenhuma taxa chamada de "assertividade".
* **CA21.** O tempo até a primeira resposta do Anjo e os atendimentos sem resposta são medidos por período, escopo e Anjo.
* **CA22.** Nenhum evento da Monitoria de usabilidade é gravado pela funcionalidade.
* **CA23.** Leitura de conversa de apoio por Coordenador de Anjos ou Administrador geral, leitura de presença de Anjo e o recebimento da cópia da troca pelo Anjo ficam no registro LGPD, uma linha por pessoa vista, sem que uma falha desse registro desfaça a atribuição.

--------------------------------------------------------------------------------

*Drafted with EGM*
