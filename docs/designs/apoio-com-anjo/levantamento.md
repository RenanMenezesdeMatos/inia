# Apoio com Anjo — levantamento do estado atual

* **Autor:** Renan Menezes (redação: Claude, papel Elefante do EGM)
* **Data:** 2026-11-09
* **Base do código:** `b2fca0dd` (trunk). O checkout principal tem trabalho não commitado de outra frente (Treino com a INIA, "Meu turno", leitores da conversa) que mexe em `operator-inia-chat.tsx` e no domínio de conversas; nada daqui depende dele.

Este documento separa o que **já existe** (com arquivo e linha), o que **precisa ser criado** e as **decisões de negócio** que ainda são suas. Os "indícios" do levantamento anterior foram conferidos um a um na seção 7.

---

## 1. Chat com a INIA — como as mensagens são guardadas

* Cada linha de `assistant_interactions` é **uma mensagem** (`backend/migrations/028_*.sql:34-46`, ampliada em `094_assistant_conversations.sql:45-75`).
* Autoria é só a coluna `role`, com check `user | assistant` (`028:39`). Não há coluna de autor humano; `operator_id` é sempre o **dono** da conversa (`assistant/application/assistant-conversations.ts:171`).
* Ordem de leitura: `occurred_at` + `seq` (cursor opaco); idempotência por `client_message_id` único por conversa (`094:74-75`).
* Conversa: `assistant_conversations` com `origin USER | WORKFLOW | FEEDBACK`, `status ACTIVE | CLOSED`, no máximo uma ativa por dono em `origin = USER` (`098:58-60`). Lock consultivo por dono (`assistant-conversations.ts:76-86`). Escrever exige ser o dono (404 para outros).
* **Não existe terceiro participante.** O único terceiro é o monitoramento (`assistant_conversations.view`), só leitura e com registro LGPD.

### Quem lê as mensagens e manda para um modelo

`loadConversationContextTurns` (`assistant-conversations.ts:324-328`) pega as **últimas 24 mensagens de qualquer `role`** e mapeia `assistant → model` e o resto `→ user`. Ninguém filtra por origem. Leitores que levam o histórico à IA ou o usam como métrica:

| Leitor | Onde |
| --- | --- |
| Chat `/realtime/messages` (contexto do turno) | `realtime/presentation/realtime-router.ts:1386` |
| `runOrchestratedReply` (último `user` vira "a pergunta") | `assistant/application/run-orchestrated-reply.ts:317-350` |
| Resposta sem Orquestrador / liderança | `realtime-router.ts:498, 1490, 1587` |
| Esclarecimento pelas bases (`recentTurns`) | `realtime-router.ts:797, 1460`; `knowledge-clarification-service.ts:262` |
| Conferência da resposta (`priorAnswerSources`) | `governance/domain/response-compliance.ts:87-89` |
| Recapitulação da voz | `realtime/domain/voice-session.ts:24-31` |
| Dúvidas após feedback ("trechos finais da conversa") | `feedback-application-service.ts:539-544` |
| Monitoramento, lista, analytics de uso, oferta de report | `conversation-monitoring.ts:226-267`; `usage-analytics-reader.ts:5-34`; `reports/application/report-proposals.ts:135-152` |
| Exportação LGPD e retenção | `data-lifecycle/application/subject-data-export.ts`; `data-lifecycle/domain/retention-catalog.ts:49` |

**Consequência:** gravar a mensagem do Anjo em `assistant_interactions` — como `user` ou como `assistant` — a colocaria no contexto da IA e distorceria pelo menos dez leitores. Uma tabela própria deixa a mensagem humana fora de todos eles **por construção**.

### Voz

Com o avatar ligado, a pergunta **digitada** vai pela sessão de voz do Gemini Live (`sendTypedByVoice`, ver `docs/dev/memoria/experiencia-do-colaborador.md`). Durante o apoio humano, o texto para o Anjo não pode seguir por esse caminho.

## 2. Avaliação das respostas do chat

* `assistant_interaction_ratings` (`158_*.sql:10-25`): `UP | DOWN | NONE`, histórico por `superseded_at`, **sem motivo nem comentário**; o schema da rota é `.strict()` (`assistant/domain/assistant-interaction-rating.ts:7-11`).
* Rota `PUT /api/v1/realtime/conversations/:conversationId/messages/:interactionId/rating`, só a dona e só respostas da INIA (`assistant-interaction-ratings.ts:21-53`).
* Tela: polegares em `frontend/src/components/operator/operator-inia-chat/chat-message-list.tsx:119`; gravação otimista, sem aviso nem marcação visível (`frontend/src/components/operator/operator-inia-chat.tsx:1634-1641`).

## 3. "Não encontrei" — sinais estruturados que existem

| Sinal | Gravado hoje? |
| --- | --- |
| Esclarecimento pelas bases terminou `INSUFFICIENT` ou `NOT_CONVERGED` | **Sim**, em `tool_calls[knowledge_clarification].state` (`clarification-state.ts:93-112`) |
| Busca nas bases sem resultado (`KnowledgeTrace.mode` `NONE`/`NO_MATCH`) | Não: fica em memória em `results[].knowledge` (`retrieve-knowledge.ts:357, 417`; `run-orchestrated-reply.ts:398`) |
| Esclarecimento passou adiante por `NO_KNOWLEDGE`/`KNOWLEDGE_UNAVAILABLE` | Não: só log |
| Ferramenta de consulta falhou (vira "Consulta não concluída…") | Não: só texto + log `orchestrator_tool_failed` (`run-orchestrated-reply.ts:409-418`) |
| Especialista bloqueado (inativo/sem autorização) | Sim: `assistant_interaction_agents.outcome` |
| Erro no SSE (pergunta sem resposta) | Não: só a ausência da resposta |

Achado paralelo: o valor `FAILED` de `assistant_interaction_agents.outcome` nunca é escrito; ferramenta que falhou fica como `EXECUTED` (`assistant-conversations.ts:204-208`). Vale corrigir junto, porque o sinal "consulta falhou" depende disso.

**Conclusão:** existe sinal estruturado confiável para parte dos casos, mas os mais comuns (nenhum trecho encontrado, consulta que falhou) não são gravados. Detectar "não encontrei" por frase no texto da IA está fora de questão; a proposta é gravar esses sinais no momento da resposta.

## 4. Acesso, escopos e configuração

* Papéis só em código (`access/domain/roles.ts:12-148`), permissões em `permissions.ts`, decisão única em `access-decision.ts`. Papel novo não precisa de migration (`role_code` é texto validado por regex, `081_access_model.sql:17`); entra no `delegates` dos papéis de administração.
* Escopos `ORGANIZATION | GROUP | SUBGROUP | MY_STRUCTURE` (`access-scope.ts`); Grupo = `teams`, Subgrupo = `subteams` (filho obrigatório), pessoa em `people.team_id/subteam_id`.
* "Quem alcança esta pessoa" já existe: `contestationReviewersOf` (`feedback-rating/application/contestation-review-service.ts:209-229`) — é o mesmo cálculo de "quais Anjos atendem este operador".
* Precedência **Subgrupo > Grupo > Todos** só existe no Orquestrador (`assistant/application/resolve-orchestrator.ts:321-342`).
* Liga/desliga por organização no banco existe (`usage_settings` + `usage_collection_toggles`, migration 116); **por Grupo/Subgrupo não existe**.
* Auditoria: `audit_logs` sem helper compartilhado (cada módulo insere).
* Sino: `alerts` com `dedupe_key`, consultado a cada 60 s.

## 5. Tempo real e várias APIs atrás do IIS

* O único fluxo do servidor para o navegador é o **SSE de um turno** do chat (`realtime-router.ts:1173-1223`, `: ping` a cada 15 s). Não há canal de assinatura, não há WebSocket no backend, e o recurso WebSocket do IIS não é instalado nem configurado pelos scripts (`deploy/windows/iis/`).
* ARR sem afinidade, `LeastRequests`, `responseBufferLimit 0`, timeout de 5 min (`configurar-iis.ps1:87-119`) — **nunca executado num Windows real**.
* Estado compartilhado vai para o PostgreSQL (tabela ou `NOTIFY`, nunca Redis sem justificar — `docs/dev/memoria/escala-e-operacao.md`). `LISTEN/NOTIFY` hoje só acorda o worker (`shared/infrastructure/process-wake/postgres-wake-channel.ts`).
* Reivindicação com posse e `skip locked` existe nos Workflows (`workflows/application/engine.ts:78-240`); vagas com prazo renovado existem para IA (`postgres-provider-call-gate.ts`).
* **Presença não existe.** A sessão expira com 30 min sem escrita; leitura automática não pode renovar a sessão (`docs/dev/memoria/seguranca.md`, "Sessão — 3ª rodada").

## 6. Privacidade e métricas

* Registro LGPD de leitura de dado de outra pessoa: `personal_data_access_log` (`151_*.sql`), gravado pelo monitoramento de conversas (`conversation-monitoring-router.ts:63-64`).
* Monitoria de usabilidade **desligada**. Risco concreto: `recordServerUsageEvent` só respeita `usage_settings.collection_enabled` (padrão `true`), não a flag de ambiente (`usage-analytics/application/record-server-event.ts:32-33`). Um módulo novo que chame essa função grava eventos com a monitoria "desligada". As métricas do Anjo devem sair das tabelas do próprio módulo.
* Percentis por processo (`/internal/metrics`) não servem para estimar espera; o histórico tem de estar em SQL (`percentile_cont` já é usado em `ai-usage-service.ts:42-43`).

## 7. Indícios do levantamento anterior — conferidos

| Indício | Situação |
| --- | --- |
| Acompanhamento já tem contestação com motivo, revisão, aviso e auditoria | **Confirmado.** Motivo obrigatório (`feedback-rating/domain/feedback-rating.ts:13-40`), revisão `feedback_rating_reviews` (`150_*.sql`), rotas `/api/v1/admin/feedback-contestations`, auditoria `FEEDBACK_CONTESTATION_REVIEWED`, avisos `…_RECEIVED`/`…_ANSWERED`. |
| Chat grava polegar sem motivo | **Confirmado** (seção 2). |
| Mensagens não contemplam terceiro humano | **Confirmado** (seção 1). |
| Não há disponibilidade de atendentes nem atualização do chat para conversa humana | **Confirmado.** O chat do operador não faz polling nem recebe push; só o SSE da própria aba. |
| Existem registros de leitura, mas falta explicação visível sobre acesso às conversas | **Confirmado em parte.** O registro existe (151), mas nenhuma tela o lê e cobre só a leitura das mensagens. A explicação "quem lê suas conversas" existe apenas como trabalho **não commitado** da frente de treino (`conversation-readers.ts` no checkout principal), marcada como "não usar". No código commitado o operador só vê "Suas conversas ficam guardadas aqui". |
| Monitoria de usabilidade desligada e com regras próprias | **Confirmado**, com o risco da seção 6. |

## 8. O que precisa ser criado

1. Módulo de domínio próprio (`backend/src/modules/human-support/`) com pedido, atendimento, mensagens humanas, classificação e avaliação em estrelas — em tabelas próprias, nunca em `assistant_interactions`.
2. Motivo no "não foi útil" do chat e a pergunta "ainda precisa de ajuda?".
3. Sinais estruturados de "não encontrei" gravados com a resposta da INIA, e a oferta de apoio registrada (quando foi oferecida e por quê).
4. Papel **Anjo** e permissões novas; liga/desliga geral e por Grupo/Subgrupo com precedência.
5. Disponibilidade declarada, conexão (posse com prazo), pausa com motivo e capacidade por Anjo.
6. Fila com reivindicação atômica (dois Anjos nunca pegam o mesmo pedido) e idempotência no pedido.
7. Canal de atualização compatível com o IIS sem afinidade.
8. Área de trabalho do Anjo; estado de apoio na interface do chat do operador.
9. Funil de métricas a partir das tabelas do módulo, com denominadores e regras de dado ausente.
10. Registro LGPD e auditoria para quem lê conversas de apoio.

## 9. Decisões de negócio pendentes (para o brainstorm)

Lote 1 (entrada e fila): quais descurtidas oferecem o Anjo · botão "Chamar apoio" · contexto da INIA compartilhado com o Anjo · como o Anjo pega pedidos e quantos atende ao mesmo tempo.

Lote 2 (ciclo de vida): sem Anjo em serviço · desativação com pedido na fila ou atendimento ativo · título obrigatório na classificação · momento e alteração das estrelas e resolução declarada.

Lote 3 (acesso e métricas): quem vê relatórios, conversas de apoio e motivos de pausa · métricas por Anjo · rótulo da estimativa de espera · Anjo disponível sem interação por 30 min.
