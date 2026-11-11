# Memória — Apoio com Anjo e avaliação das respostas do chat

> Especificação aprovada (v4, processo Elephant-Goldfish): [design_draft.md](../../designs/apoio-com-anjo/design_draft.md); revisão
> independente em [review/](../../designs/apoio-com-anjo/review/). Ver também [conversa-voz-e-avatar.md](conversa-voz-e-avatar.md)
> (conversas persistidas e o curtir/descurtir da migration 158) e [acesso.md](acesso.md) (papéis e escopos que a Parte B usa).

### Parte A — motivo da descurtida, sinais da resposta e funil (2026-11-09, migration 181)

Implementado no worktree `apoio-humano-operador-832409`, sem commit. A Parte B (pedido, Anjo, sala de apoio, painel) ainda não existe:
nada visível muda além do formulário da descurtida.

- **Motivo da descurtida (só no chat livre, `origin = USER`).** O polegar para baixo só ABRE o formulário (Popover,
  `operator-inia-chat/dislike-form.tsx`): motivo da lista própria `CHAT_DISLIKE_REASONS_V1` (nunca a do "Este conteúdo foi útil?" do
  Acompanhamento), comentário opcional (obrigatório em "Outro"; 3–1000 depois do trim) e "Você ainda precisa de ajuda com isso?". Enviar
  grava tudo numa chamada e ESPERA a confirmação; a falha aparece no formulário; fechar não grava. Reabrir mostra o motivo gravado e
  "Retirar avaliação". Depois de "Sim": "Falar com um Anjo" só quando a tela recebe `onRequestSupport` (Parte B); sem ele, "O apoio com
  Anjo ainda não está disponível para sua equipe." Sessão de feedback e recado de Workflow continuam com o polegar de sempre.
- **Gravação.** `assistant_interaction_rating_details` (uma linha por versão `DOWN` com motivo, `catalog_version`, `person_id` → entra
  na exportação do titular). Regras em `shouldWriteRating`: DOWN sem motivo sobre a vigente com motivo NÃO grava (chamada atrasada nunca
  apaga o motivo); DOWN sem motivo nos outros casos grava como antes (o servidor nunca recusa: abas antigas); motivo diferente = versão
  nova. Motivo fora do chat livre = 422 `RATING_DETAILS_NOT_ALLOWED`. A rota devolve `{ interactionId, rating, ratingId, details }`; o
  histórico (`GET …/messages`) traz `ratingId` e `ratingDetails` só para a dona. O monitoramento da gestão continua vendo só o valor.
- **Sinais da resposta (`SUPPORT_SIGNALS_V1`).** Calculados por CÓDIGO sobre os resultados estruturados do turno, nunca sobre o texto
  (`assistant/domain/reply-signals.ts` + adaptador `assistant/application/reply-signals.ts`): `KNOWLEDGE_NOT_FOUND` (especialista
  consultado, nenhum resultado com conteúdo — trecho `RETRIEVAL`/`FULL`, investigação `COMPLETED`/`CACHED` ou cartão de ferramenta
  direta — e nenhum falhou), `KNOWLEDGE_INSUFFICIENT` (esclarecimento terminou `INSUFFICIENT`/`NOT_CONVERGED`), `CONSULTATION_FAILED`
  (`failed` em `runOrchestratedReply`), `SPECIALIST_BLOCKED` (`blocked`, ou o especialista da voz indisponível na hora), `NO_REPLY` (na
  PERGUNTA, quando o turno de texto termina em erro, não cancelado, sem resposta gravada). Resultado direto só com texto (sem cartão)
  NÃO é conteúdo. Ramos que gravam lista vazia: DATA_ONLY, PERSONA_STREAM, oferta de report, resposta barrada por VIOLAÇÃO de regra
  na conferência, `/voice-turn`, SELF_TOOL e ferramenta da liderança pela voz. Liderança: só o `KNOWLEDGE_INSUFFICIENT` da consulta de
  processo. Resposta trocada porque a PRÓPRIA conferência falhou ("Não consegui concluir esta resposta agora") grava
  `CONSULTATION_FAILED`, no chat e na voz (`signalsAfterResponseCheck`, decisão do responsável em 2026-11-10).
- **Onde ficam.** `assistant_reply_signals`, gravada pela MESMA instrução do `append` (CTE que confere `origin = 'USER'`): toda mensagem
  da INIA do chat livre depois do corte tem linha (vazia quando não houve sinal); sem linha = anterior ao corte; fora do chat livre nunca.
  `markNoReply` grava `NO_REPLY` uma vez, só na pergunta da própria dona. Filho de `assistant_interactions` na retenção (sai junto).
  O evento SSE `persisted` leva `signals` (só no chat livre) e o histórico devolve `signals` (`null` = não calculado); a tela marca a
  mensagem com `data-support-signals`. O balão de erro do envio guarda o id da pergunta (`ConversationRef.userMessageId`) e `NO_REPLY`.
- **Sugestão elegível.** `createRealtimeRouter({ recordSuggestion })` (injetada pela Parte B; ausente = nada) é chamada depois de gravar
  mensagem com sinal ou descurtida nova com "Sim", só no chat livre; falha vai para o log e nunca muda a rota. Origem ausente no registro
  da conversa = USER (`ConversationRecord.origin` é opcional por contrato). Rastreamento do turno: notas `replyInteractionId` e
  `supportSignals` (só códigos).
- **Funil M1–M6** (`assistant/application/reply-funnel.ts`): calculado na hora, até 92 dias em datas civis no fuso da organização
  (`analytics_org_timezone`), recorte sobre o Grupo/Subgrupo ATUAL da dona da conversa (Grupo cobre os Subgrupos). M1 exclui a etapa de
  esclarecimento aguardando escolha; avaliação = a vigente; "motivo não coletado" = descurtida sem motivo anterior à primeira linha de
  motivo da organização; M6 só sobre respostas com linha de sinais, com `NO_REPLY` no detalhamento como contagem de perguntas (sem
  taxa); denominador < 5 = taxa oculta, 0 = sem dados. M3 nunca é "assertividade". Sem tela: só o painel da Parte B chamará (D7).
- **Cópia da troca** (`assistant/application/support-context.ts › buildSupportContext`): pergunta original do esclarecimento, ou a
  pergunta do operador imediatamente anterior, ou a própria pergunta com `NO_REPLY`; resposta sempre (D10), sem os marcadores de fonte
  que a tela tira; motivo só da versão informada quando ela é a descurtida da própria pessoa com "Sim". `null` fora da dona ou do chat
  livre. A origem do pedido (`BUTTON | DISLIKE | SIGNAL`) é decidida na Parte B a partir de `facts`.
- **Provas.** Unidade: `assistant-interaction-rating.test.ts`, `reply-signals.test.ts`, `reply-funnel.test.ts`, `support-context.test.ts`,
  `realtime-router-ratings.test.ts`, `realtime-router-reply-signals.test.ts`, `dislike-form.test.tsx` e o chat
  (`operator-inia-chat.test.tsx`). Banco de teste: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run assistant-interaction-ratings-proof`
  (versões e catálogo, linha de sinais, `NO_REPLY`, 422 no recado, cópia da troca, funil num Grupo criado na transação, exportação do
  titular e retenção; tudo desfeito no fim). Migration 181 aplicada no banco de teste em 09/11 e no banco de dev em 10/11.
- **Não fazer.** Nunca deduzir sinal procurando frase no texto da IA; nunca tratar ausência de descurtida ou de pedido como resolução;
  nunca mostrar a terceiros o comentário da descurtida fora do apoio; não reativar a Monitoria de usabilidade por causa deste fluxo (o
  formulário não registra eventos de uso).

### Parte B — pedido, Anjo, sala, configuração e painel (2026-11-09, migration 182)

Implementado no mesmo worktree, sem commit. Tudo nasce DESLIGADO (sem linha em `human_support_settings` = desligado). Antes do
piloto (B1 ligada num Subgrupo) falta o roteiro do IIS da especificação (chamada longa por 2 APIs atrás do ARR — OQ1) e a migration
182 na homologação; nos bancos de teste e de dev (10/11, para rodar o worktree na 3000) ela está aplicada.

- **Módulo `backend/src/modules/human-support/`** (sem `infrastructure/`). Domínio puro e testado: `catalogs.ts` (códigos, rótulos,
  texto das mensagens de sistema por leitor — operador, Anjo ou quem acompanha —, parâmetros do Apêndice A, protocolo `AP-XXXXXX`),
  `enablement.ts` (Subgrupo › Grupo › desligado), `presence.ts`, `origin.ts` (`BUTTON | DISLIKE | SIGNAL`), `queue-history.ts`
  (população de 14 dias com mínimo de 10 atribuídos por nível, espera "cerca de"/"mais de", prazo p90 entre 10 e 25 min, 20 sem
  histórico), `availability.ts`, `request-lifecycle.ts`, `classification.ts`, `evaluation.ts` (24 h; interrompido não avalia),
  `metrics-definitions.ts` (M7–M17 e as horas de presença do M18), `views.ts` (Apêndice C).
- **Travas e distribuição** (`application/locks.ts`, `dispatch.ts`): comandos de estado sob `pg_advisory_xact_lock` da organização;
  mensagem trava a linha do pedido (`seq` sem lacuna); versão por pessoa sempre por último e em ordem de `person_id`. A distribuição
  roda depois de cada comando e pela tarefa `human-support-dispatch` (3 s, `server.ts`), com `pg_try_advisory_xact_lock` (se outro
  processo distribui, pula), nos 7 passos da seção 8, um savepoint por atribuição e o registro LGPD depois do commit. Atribuição
  direta, sem aceite (D2): menos atendimentos, depois quem recebeu há mais tempo.
- **Canal de atualização**: `GET /api/v1/human-support/me/state?since&wait&workspace` (GET, não renova a sessão; renova
  `operator_seen_at` e, com `workspace=anjo`, o `lease_until` de 75 s). `application/waiters.ts`: registro em memória por processo,
  uma consulta por segundo para todas as esperas, a 5ª chamada da mesma pessoa solta a mais antiga, dreno (`Readiness.onDraining`)
  responde todas com `reconnect: true`. `RuntimeMetrics.excludeFromLatency` tira a chamada longa da latência; seção `humanSupport`
  em `/internal/metrics`.
- **Isolamento da IA** (teste de estrutura `testing/human-support-isolation.test.ts` e `frontend/src/components/human-support/
  isolation.test.ts`): só `human-support/**` e `data-lifecycle/**` citam `human_support_*`; o módulo não importa orquestração,
  roteamento ou cliente de modelo, voz nem `usage-analytics`; o `assistant` não conhece o apoio (a sugestão é injetada no
  `realtime-router` pelo `createApp`); o módulo não lê tabelas do `assistant` (a conversa de origem vem de `buildSupportContext`).
  No navegador, a sala não importa `lib/realtime` nem `lib/avatar`, não tem microfone e abrir a sala ENCERRA a voz.
- **Acesso** (`access/`): permissões `human_support.attend | coordinate | manage`; papéis `ANJO` e `COORDENADOR_DE_ANJOS` (só o
  Administrador geral concede; ele acompanha e configura, mas não atende); capacidades `canAttendHumanSupport`,
  `canCoordinateHumanSupport`, `canManageHumanSupport` (fora de `canAccessAdministration`). `permission-holders.ts` ganhou
  `personIdsWithPermissionCovering`, `assignmentScopesOf` e `personIdsWithPermission`. Alcance do Coordenador: escopo congelado do
  pedido/tentativa; Anjo pelo D11 (`scopeCovers` sobre os escopos do papel de Anjo).
- **Rotas**: operador/Anjo em `/api/v1/human-support` (limites por conta: pedidos 10/h, mensagens 60/min, presença 30/min);
  configuração em `/api/v1/admin/human-support` (`manage`, organização); painel em `/api/v1/admin/human-support-monitoring`
  (`coordinate`), montados antes do `/api/v1/admin` genérico. Erro de entrada = 400 `VALIDATION_ERROR` (convenção do projeto).
- **Telas**: estado do operador por `HumanSupportStateProvider` no shell (aba líder por Web Locks + `BroadcastChannel`; chamada longa só
  com pedido aberto ou avaliação pendente; reserva de 3 s depois de 3 falhas); no chat, selo, sala no
  lugar da conversa, sugestão abaixo das mensagens com sinal e a seção "Apoio com Anjo" em Conversas anteriores; `/apoio` (área do
  Anjo, aba única); Administração › Plataforma › Apoio com Anjo e › Monitoramento › Apoio com Anjo (área isolada para o Coordenador);
  Wiki `/wiki/apoio-com-anjo`. O aviso de inatividade não conta mais `scroll` (D8).
- **Retenção e LGPD**: alvos `human_support_requests` (só estados finais, com conversa, atendimentos e eventos), `human_support_entry_events`
  e `human_support_presence_events`, políticas desligadas inseridas pela 182. `personal_data_access_log` ganhou
  `HUMAN_SUPPORT_CONVERSATION` e `HUMAN_SUPPORT_PRESENCE`; `recordPersonalDataAccess` devolve `boolean`.
- **Provas**: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run human-support-proof` — cria uma organização própria, CONFIRMA os dados (a
  concorrência precisa de duas transações) e apaga só ela no fim; cobre idempotência e um pedido aberto com 10 chamadas paralelas,
  capacidade com 20 pedidos × 3 Anjos e distribuições paralelas, cancelar × distribuir, 20 mensagens paralelas com `seq` contíguo e
  distribuição junto (sem impasse), conexão perdida/de volta/interrompido, abandonado/expirado/inatividade, contrato do operador sem
  pausa, desligar com fila e atendimento, escopos e registro LGPD, classificação, avaliação, funil M1–M17, exportação e retenção.
- **Decisões de tela da B1** (não fechadas pela especificação): desligar a chave geral também pede confirmação (fila cancelada,
  atendimentos seguem); capacidade do Anjo por seletor "Padrão da organização (N)" + 1–5; o filtro Grupo/Subgrupo do painel só
  aparece para o Administrador geral (o Coordenador não tem rota para listar a estrutura — um teste garante que a tela não chama a
  rota de escopos para ele); M17 mostra "Média 4,17 · 6 notas"; porcentagens no formato brasileiro (`percentText`); o detalhe do
  pedido abre ao lado da lista (sem Sheet nem Dialog); o layout da Administração compara rota exata ou sub-rota (antes um prefixo
  liberaria `/admin/human-support-monitoring` a partir de `/admin/human-support`). Na área do Anjo, mensagens do Anjo a partir do
  início do atendimento atual aparecem como "Você"; o som é preparado em "Ficar disponível", "Voltar" e no primeiro clique da página.
- **Conferido no navegador (2026-11-10)**, numa pilha isolada (API 127.0.0.1:3534 com a IA falsa de `tools/loadtest/fake-ai.mjs`,
  interface 127.0.0.1:3610, banco `inia_hsbench` clonado de `inia_chatbench`; o :3000 não foi tocado), com Anjo e operadora em
  contas separadas (um lado no navegador, o outro pela API): configuração (chave geral, escopo herdado, aba Anjos), botão e janela
  do pedido (com Anjo, sem Anjo em serviço e Anjo entrando com a janela aberta), atribuição direta, sala com mensagens nos dois
  sentidos pela chamada longa (< 3 s), selo "Apoio · com …", descurtida com motivo, encerramento pelo Anjo ao vivo, avaliação,
  seção do histórico, área do Anjo (pausa, novo atendimento com "Sem resposta há…", ausência do operador, classificação), painel
  do Administrador geral (funil M1–M17, pedidos com detalhe, Anjos com presença) e área isolada do Coordenador (só o painel,
  filtrado ao escopo; `/admin` e `/admin/human-support` levam ao painel). Corrigido no caminho:
  - a sala do operador rolava a PÁGINA a cada mensagem (`scrollIntoView`) e tirava o campo de texto da tela — agora só a área
    das mensagens rola (`support-room.tsx`);
  - a trava de aba única da área do Anjo prendia a PRÓPRIA aba em "aberta em outra aba": a trava chegava depois de a montagem
    sair (o React monta duas vezes em desenvolvimento; sair e voltar rápido faz o mesmo) e nunca era devolvida, e o `ifAvailable`
    da montagem seguinte via a trava ocupada. Agora a trava recebida depois da desmontagem é devolvida na hora e a área espera até
    1,5 s na fila antes de concluir que há outra aba (`use-anjo-workspace-state.ts`); a líder do estado do operador ganhou a mesma
    devolução (`use-human-support-state.tsx`). Prova: `queries/human-support/web-locks.test.tsx` (falha sem a correção);
  - a descurtida com "Sim" oferecia "Falar com um Anjo" com pedido já aberto — agora diz "Você já tem um pedido de apoio" e
    "Ver pedido" abre a sala (um pedido por vez);
  - "Encerrar atendimento" do Anjo usava a variante `secondary` (verde-limão neste tema) e passou a `outline`; o menu de pausa
    ficou largo o bastante para "Atividade de processo" numa linha.
- **Decidido em 2026-11-10 (a partir da conferência das telas)**: a resposta trocada porque a própria conferência falhou
  (`CHECK_FAILED`, "Não consegui concluir esta resposta agora") passou a gravar `CONSULTATION_FAILED` — para a pessoa, a consulta
  não terminou —, e a tela sugere falar com um Anjo; antes ficava sem sinal e só a descurtida levava ao apoio. Barrada por violação
  de regra continua sem sinal. Regra única em `assistant/domain/reply-signals.ts` (`signalsAfterResponseCheck`), usada pelo chat
  (`persistReply`) e pela voz (`guardVoiceText` → `blockedVoiceAnswer`, que agora também registra a sugestão elegível); provas em
  `realtime-router-response-check.test.ts`. Na voz, como os demais sinais da voz, a sugestão aparece ao reabrir a conversa.
- **Sem botão fixo (decisão do responsável em 2026-11-10, depois de usar no dev)**: o botão "Falar com um Anjo" do cabeçalho do
  chat saiu. O apoio só é oferecido depois de a pessoa tentar com a INIA: a sugestão abaixo de uma resposta com sinal e a
  descurtida com "Sim". O selo do pedido aberto/avaliação pendente continua sendo o caminho de volta à sala. A API ainda aceita
  pedido sem mensagem de origem (`BUTTON`; os antigos seguem no M8), mas a tela não oferece mais. Teste: "apoio ligado: nenhum
  botão fixo…" em `operator-inia-chat.test.tsx`; nota no design ("Decisão posterior: sem botão fixo").
- **Visual do módulo (2026-11-10, pedido do responsável: "muito branco, sem separação, Falar com o Anjo parece link")**: referência
  observada na Área do Cliente da Vivo logada (só leitura: central de faturas e início) — cartões brancos com borda clara e raio
  de 16 px, rótulo de seção curto em caixa alta cinza, selo de estado tingido com ícone, lista com ícone em círculo tingido e
  divisória, fundo cinza ao passar o mouse, botões em pílula, valor de destaque na cor primária. Adaptado aos tokens da INIA
  (primária roxa no claro, rosa no escuro) num módulo só de apresentação, hoje no kit: `components/ui/surface.tsx`
  (`SURFACE_CARD`, `toneSurface`, `toneChip`, `StatusChip`, `IconBadge`, `SectionLabel`, `PageHeader`; ver `visual-do-app.md`).
  O selo "Apoio · encerrado — avalie" só aparece com avaliação ainda sem resposta (`awaitingEvaluation`); aberto depois de
  recarregar a página, ele leva à avaliação (antes levava à sala vazia). O que
  mudou: a sugestão no chat virou aviso com o botão principal "Falar com um Anjo" (`aria-haspopup="dialog"`, abre a janela; nada
  é criado no clique); janela do pedido com cabeçalho, seção do que vai para o Anjo e disponibilidade tingida pelo estado; sala
  com cabeçalho de uma linha (voltar, protocolo, encerrar), estado tingido, contexto recolhível, fundo da conversa e mensagens do
  sistema em selo; avaliação em cartão; selo do pedido com tom por estado; Área do Anjo com cabeçalho, cartão de presença
  ("Seu estado" + "Atendimentos agora"), seções rotuladas, atendimento em cartão, classificação em grupos com opções em bloco
  (borda e fundo primários quando marcadas), histórico em lista; configuração em linhas com ícone e rodapé de ações; tabelas com
  cabeçalho tingido e Grupos destacados dos Subgrupos; painel com filtros em cartão e medidas com valor na cor primária. Com a
  sala aberta, o avatar da INIA sai de cena em todos os tamanhos (decisão do responsável em 10/11; antes encolhia no desktop), só
  por CSS — o Canvas segue montado e a voz já foi encerrada ao abrir a sala; a conversa passou de 64 px para 336 px no celular.
  Nenhuma regra, rota, texto de negócio ou contrato mudou. Capturas antes/depois feitas na pilha isolada (`inia_hsbench`, IA
  falsa), tema claro, desktop e celular; o escuro foi conferido na configuração.
- **Fim do atendimento encerra a conversa com a INIA (decisão do responsável em 2026-11-10)**: quando termina um atendimento que
  estava em andamento (encerrado pelo operador, pelo Anjo, por ausência ou por inatividade), `endRequest` encerra a conversa de
  origem do pedido (`source_conversation_id`) com o motivo novo `HUMAN_SUPPORT` (migration 183; "Encerrada após o apoio do Anjo" no
  histórico), pela função do `assistant` `closeConversationAfterHumanSupport` (mesma trava por dono das escritas da conversa; só a
  conversa ativa, de origem USER, do próprio dono). Pedido que sai da fila sem atendimento (cancelado, expirado, abandonado, apoio
  desligado) e o interrompido que volta à fila não mexem nela. No chat, quem está na conversa atual recarrega ao fim do
  atendimento (lendo histórico, recado de Workflow ou feedback, a vista fica). Prova: cenário "fim do atendimento encerra a
  conversa…" em `human-support-proof` (apaga os próprios pedidos para não mudar o prazo da fila calculado pelo histórico). 183
  aplicada nos bancos de dev, teste e `inia_hsbench`.
- **Digitando, entregue e lido; cronômetro do estado; contexto recolhível (pedido do responsável em 2026-11-10, migration 184)**:
  `human_support_conversation_marks` (uma linha por pedido, filha em cascata, entra na retenção junto com o pedido): cursores sobre o
  `seq` — até onde cada lado RECEBEU (entregue) e VIU (lida) — e o prazo do "digitando" de cada lado. Regra única de avanço em
  `domain/conversation-marks.ts` (`receiptsAfterAck`: só para a frente, nunca além da última mensagem, lida implica entregue); são do
  PEDIDO, não do atendimento (o que o primeiro Anjo leu continua lido se outro assume). Rotas `POST /requests/:id/typing {typing}` (204)
  e `POST /requests/:id/receipts {deliveredSeq?, readSeq?}`, só para o operador dono e o Anjo do atendimento em andamento (os demais:
  404), com o limite `humanSupportMarksPerAccount` (120/min). Cada marca trava só a própria linha e, por último, a versão da OUTRA ponta
  (a chamada longa dela acorda); `sendMessage` tira o "digitando" de quem enviou na mesma transação. O "digitando" vale 8 s
  (`typingTtlSeconds`), só com atendimento em andamento; a tela avisa ao começar, renova a cada 4 s e manda "parei" com 5 s sem tecla,
  campo vazio ou ao sair (`queries/human-support/use-typing-signal.ts`); nunca manda o texto. Entregue: o provedor do operador (aba
  líder) ao receber o estado, e a área do Anjo ao ler as mensagens (mesmo com a aba do atendimento escondida). Lida: sala/aba do
  atendimento NA TELA + aba visível + janela em foco (`hooks/use-page-seen.ts`, `useReadAcknowledgement`); confirmação só sai quando
  o cursor avança (`receipt-acks.ts`). As visões ganharam `peerReceipts` e `peerTypingMs` (operador e cada atendimento do Anjo) e a do
  Anjo, `serverTime` (o cronômetro e o "há N min" contam pelo relógio do servidor). Telas: mensagens com os componentes de chat do kit
  (`Message`/`Bubble`), tiques em `human-support/conversation/message-receipt.tsx` (um cinza = enviada, dois cinza = entregue, dois azuis
  = lida, com texto para leitor de tela), "Fulano está digitando…" com `components/ui/typing-dots.tsx` (sem animação com movimento
  reduzido); cronômetro ao vivo do estado do Anjo (`presence-timer`, só ele redesenha a cada segundo; trocar o motivo da pausa recomeça);
  o cartão "O que o operador compartilhou" recolhe para uma linha com a pergunta e a lista de mensagens cresce. Prova no banco: cenário
  "digitando, entregue e lido (184)…" em `human-support-proof` (13 cenários). 184 aplicada nos bancos de dev, teste e `inia_hsbench`.
- **Sheet para o pedido (avaliado em 2026-11-10, não adotado)**: a janela do pedido tem um campo opcional e a cópia do que vai para o
  Anjo — é uma confirmação curta, e o responsável já recusou Sheet em fluxos curtos. Continua o Dialog centralizado.
- **IT-INIA-016 (2026-11-10)**: `docs/manuais/IT-INIA-016-Apoio-com-Anjo.{pdf,docx}` (35 p., 34 figuras), fonte em
  `docs/manuais/it-inia-016` (LEIA-ME com os comandos). Prints feitos por Playwright em quatro sessões separadas na pilha isolada
  (`inia_hsbench`, IA simulada — por isso a INIA responde "Não consegui concluir…", um dos casos que sugerem o Anjo); os números dos
  prints vêm da posição real dos elementos (`caixas.json`), nunca de marcação à mão. Achado no caminho: o limite de 10 pedidos por hora
  vale para a prévia também — rodadas repetidas da captura esgotam o da operadora de teste. No celular, o chat é montado de novo ao
  mudar de largura e a sala fecha (o selo reabre); o print de celular usa uma sessão própria.
- **Painel em linguagem de operação e situação dos Anjos agora (pedido do responsável em 2026-11-10)**: o bloco técnico de datas de
  corte saiu; o que ele dizia virou observação curta só no indicador afetado (descurtidas sem motivo, início do registro dos sinais,
  apoio desligado no período). A aba "Funil" virou "Indicadores": resumo do período (pedidos, espera de 90% dos pedidos, primeira
  resposta mediana, dúvida resolvida) e três seções (Respostas da INIA · Pedidos e atendimentos · Avaliação do atendimento do Anjo —
  as avaliações da resposta e do atendimento nunca se misturam). Sem códigos M nem "p50/p90" na tela (ficam em `data-testid`);
  nomes do evento medido ("Tempo mediano de primeira resposta", "Primeira resposta de 90% dos atendimentos"), ícone por tipo
  (quantidade/porcentagem/tempo), durações "2 min 35 s" (`durationText`; zero medido = "menos de 1 s"), "Sem dados no período" (nunca
  0%) e "Poucos dados" com a consequência explicada. Nenhuma regra de cálculo ou amostra mínima mudou. Aba Anjos: "Situação agora"
  (`GET /admin/human-support-monitoring/anjos/now`, mesmo alcance e registro LGPD do painel — o registro já evita repetir por 10 min —,
  atualiza a cada 15 s, não depende do período) separa CADASTRO (pessoa e conta ativas e acesso liberado; antes o inativo sumia, porque
  os ajudantes de papel só devolvem ativos — leitura nova `permissionHoldersWithSituation` no `access`, só para painel) do STATUS
  OPERACIONAL (Disponível · Em atendimento = disponível com atendimento aberto · Em pausa com motivo · Indisponível sem contador; "Sem
  conexão" à parte). "Há quanto tempo" = transição real (`domain/anjo-now.ts`: pausa = `status_since`; em atendimento = início da
  sequência sem intervalo livre, nunca antes de ficar disponível; disponível = fim do último atendimento depois de ficar disponível),
  contado pelo relógio do servidor (`serverTime`). Resumo clicável por status e filtros por status, cadastro e grupo atendido. Prova:
  cenário "situação dos Anjos agora…" em `human-support-proof` (14 cenários). Conferido na 3000 (dev) em 10/11 com dados reais.
- **Área do Anjo reorganizada (pedido do responsável em 2026-11-10, migration 185)**: estado sempre no topo e, abaixo, duas abas —
  "Atendimento" (atendimentos em andamento + classificações pendentes) e "Seus atendimentos" (histórico). As duas ficam montadas
  (`forceMount`, a inativa só escondida): trocar de aba não perde mensagem, rascunho nem contador; a aba fica na URL (`?tab=historico`,
  por `history.replaceState`). Fora da aba "Atendimento" ela conta os atendimentos abertos e fica em destaque com mensagem nova do
  operador ainda não vista ou atendimento sem resposta (texto para leitor de tela); "lida" só conta com a aba "Atendimento" E a do
  atendimento na tela (`active`). Mensagem nova = do operador, depois da base da primeira leitura da área (recarregar não marca nada
  como novo), até o atendimento voltar à tela (`useUnreadCount` em `attendance-pane.tsx`). Estado: cartão "Seu estado" (ícone tingido
  + nome; pausa com o ícone e o nome do motivo; Indisponível com o ícone de parada, tom vermelho) separado do grupo "Mudar estado";
  cronômetro (de `presence.since`, a troca real gravada no servidor) só em Disponível e Em pausa — Indisponível não tem cronômetro nem
  "desde". "Ficar indisponível" = `variant="destructive"` + `CircleStop`, sem confirmação a mais. Pausas: `DropdownMenuRadioGroup` do
  kit (portal, `side="bottom"`, animação do kit que respeita a redução de movimento), ícone por motivo real em
  `anjo/presence-icons.ts` (Lanche = xícara, Pessoal = pessoa, Atividade de processo = prancheta, Reunião = grupo), a atual marcada
  e escolher a mesma não grava. Atendimento: em ≥1024 px o contexto fica à esquerda (coluna de 17–26 rem, absoluto dentro da coluna
  para não esticar a linha, rola por dentro) e o chat à direita; recolhido vira uma linha com a pergunta e "Mostrar" e o chat ocupa a
  largura toda; abaixo de 1024 px uma coluna e o contexto começa recolhido. "Tempo de atendimento" no cabeçalho, desde o
  `startedAt` do ATENDIMENTO (não do pedido nem da fila), pelo relógio do servidor (`useElapsed` em `use-clock.ts`); início inválido =
  "Início não informado". Congelado ao encerrar: a pendência de classificação ganhou `startedAt` ("Durou …") e o histórico mostra
  "durou …" (fim − início). Encerrar leva o foco à classificação pendente.
  **Motivos novos de encaminhamento** (`CLASSIFICATION_CATALOG_V2`; 185 só amplia o `check` do motivo): `NO_TOOL_ACCESS` ("Sem acesso
  à ferramenta ou ao sistema") e `TOOL_UNAVAILABLE` ("Ferramenta ou sistema indisponível"), separados; nenhum equivalente existia (os
  seis da V1 são falta de informação). Ferramenta/sistema afetado vai no `reference_title` e os detalhes no `other_description`, os dois
  opcionais (o pedido dizia "permita"); a descrição passou a ser descartada nos motivos que não a pedem (como o título). Motivo e
  resultado continuam duas escolhas obrigatórias e independentes — nada vira "resolvido" sozinho. Registros V1 continuam lidos com o
  mesmo rótulo (a linha guarda a versão; o detalhe do painel mantém "Onde estava a informação"/"Descrição" na V1 e usa "Ferramenta
  ou sistema afetado"/"Detalhes" nos impedimentos). O histórico do Anjo ganhou `classification` (motivo, resultado, ferramenta); o
  M14 já percorre o catálogo (motivos novos entram sozinhos; a ferramenta conta no "mais citados"). Nenhum filtro da tela usava o motivo
  (os da lista de pedidos são estado e origem), então nenhum filtro novo. Prova: cenário "impedimentos operacionais (185)…" em
  `human-support-proof` (15 cenários): grava V2, motivo antigo V1 legível, detalhe, histórico, lista e M14. 185 aplicada nos bancos de
  dev (`inia`), teste e `inia_hsanjo`. Conferido no navegador numa pilha própria (API 127.0.0.1:3544 com IA simulada, interface
  127.0.0.1:3620 numa cópia da pasta `frontend`, banco `inia_hsanjo` clonado de `inia_hsbench`, senha descartável só nele, operador pela
  API): disponível, indisponível, as quatro pausas (teclado, Escape, foco de volta), recarregar sem zerar cronômetro, dois atendimentos
  com tempos próprios, contexto recolhido, troca de abas com rascunho e mensagens novas, encerramento e classificação com os dois
  motivos novos, histórico, detalhe do painel e celular (390 px, sem rolagem horizontal). O IT-INIA-016 mostra a tela antiga (prints
  a refazer).
- **Motivos dos cards do maior para o menor (pedido do responsável em 2026-11-10)**: no painel (aba Indicadores), toda lista de
  um card — detalhamento e "à parte" (`Breakdown` em `monitoring/funnel-tab.tsx`, `byCountDesc`) — aparece por quantidade decrescente;
  empate (inclusive os zeros) mantém a ordem do catálogo. Só apresentação: o servidor segue mandando na ordem do catálogo (M10 já vinha
  ordenado). O resumo por status da "Situação agora" (aba Anjos) continua na ordem fixa dos status, por ser um filtro clicável.
- **Painel no formato de "Conversas com a INIA" (pedido do responsável em 2026-11-10)**: no menu Monitoramento o painel fica logo
  abaixo de Conversas com a INIA. A tela abre em Pedidos (antes, Indicadores): título simples com o total ("6 pedidos no período" /
  "com esses filtros"), a barra de filtros das listas (busca por operador ou protocolo — `search` em `listRequests`, protocolo ou nome
  cadastral/preferido, `%`/`_` escapados, nunca o conteúdo —, estado, origem, Grupo e Subgrupo em dois seletores para quem configura,
  período com "Aplicar") e a caixa de entrada: lista por dia à esquerda (`useSupportRequestsInfiniteQuery`, "Carregar mais"
  com "N de total"; atualiza a cada 20 s só com uma página) e a leitura à direita como a conversa das Conversas (cabeçalho com origem,
  estado, operador, abertura e mensagens; corpo com o compartilhado, Message/Bubble com separador de dia, operador à direita com a foto
  e Anjo à esquerda; atendimentos, classificação e avaliação no fim; rodapé "Somente leitura"; na fila ou em atendimento atualiza a
  cada 10 s). A lista recebe do servidor `operatorAvatarUrl`, `messageCount` (só mensagens humanas) e `total` (só na primeira página);
  nada do conteúdo vai para a lista — continua só no detalhe, que grava o registro LGPD. Os rótulos de dia/hora (`dayKey`,
  `dateSeparatorLabel`, `messageTime`, `lastActivityLabel`) foram para `lib/format/date.ts` (o `conversation-format` reexporta), porque
  `components/human-support/**` não importa `lib/realtime` (teste de isolamento). Prova: cenário de classificação em
  `human-support-proof` confere total, contagem, busca por protocolo/nome e `%` literal (15 cenários). Conferido na 3000 (1440 px e
  375 px; no celular a barra de abas rola de lado).
- **Mensagem nova fora da vista (pedido do responsável em 2026-11-10, sem migration)**: os dois lados avisam mensagem da outra ponta
  que a pessoa não está vendo. Som e título piscando vêm de `lib/attention/attention-alert.ts` (`createChime`, `blinkTabTitle` — um por
  aba, para no `focus` ou com a página vista —, `newMessageTitle`, `primeChimeOnFirstGesture`); `anjo/attendance-alert.ts` reexporta.
  ANJO: o contador de não lidas por atendimento (`useUnreadCount`, já existia) subiu → som; com a página fora da vista, também o título
  "• Nova mensagem de <operador> — INIA". OPERADOR: o provedor (`use-human-support-state.tsx`) compara cada estado com o anterior (o
  primeiro é só referência); mensagem nova do Anjo acima do "lida" (`readSeq` NOVO na visão do pedido do operador = `operator_read_seq`
  das marcas 184, ou o que a sala desta aba acabou de mostrar) → com a sala na tela e a página vista, nada; com a página vista e a sala
  fechada, som + toast (sonner, `ANJO_MESSAGE_TOAST_ID`) com "Abrir conversa"; fora da vista, título piscando em toda aba não vista e o
  som só na aba líder, e nada se OUTRA aba do aplicativo estiver sendo vista (presença entre abas no mesmo `BroadcastChannel`:
  `presence`/`bye`/`read`). "Abrir conversa" abre a sala no chat da página (`roomOpenRequest`; o painel recolhido se abre; no celular
  rola até o chat) ou, sem chat na página, vai para `<perfil>?tab=followup&iniaSupport=room` pelo roteador do shell. Selo "Apoio · com
  Ana · 2 mensagens novas" + ponto; ponto no painel recolhido. A sala recebe `hidden` (painel recolhido não conta como lida nem silencia).
  Testes: `support-attention.test.tsx` (6), Anjo e chat; prova `human-support-proof` confere o `readSeq`. Conferido com duas pessoas na
  pilha isolada (Playwright, `inia_hsbench`, IA falsa; foco simulado com `hasFocus`/`blur`): toast + selo + som com a sala fechada,
  "Abrir conversa" abre a sala, título com o nome e som fora da vista dos dois lados, nada com o Anjo olhando. Sem notificação do sistema
  operacional (pediria permissão do navegador): fica como possível próximo passo.
- **Pausa e indisponibilidade programadas (pedido do responsável em 2026-11-11, migration 188)**: sem atendimento em andamento, pausa
  e Indisponível valem na hora (como antes). COM atendimento, "Pausa" (estando Disponível) e "Ficar indisponível" (Disponível ou Em
  pausa) viram PROGRAMAÇÃO — antes a pausa entrava na hora e Indisponível era recusado com 409 `HUMAN_SUPPORT_ACTIVE_ATTENDANCES`
  (código que deixou de existir). Em pausa, trocar o motivo e "Voltar" continuam na hora.
  - **Onde fica**: `human_support_agent_presence.scheduled_status | scheduled_pause_reason | scheduled_at` (check que amarra as três).
    Regra pura em `domain/presence.ts › presenceChange` (`NONE | APPLY | SCHEDULE | CANCEL_SCHEDULE`): pedir o que já está programado
    não muda nada; pedir o ESTADO ATUAL desfaz a programação; qualquer mudança aplicada na hora apaga a programação. Cancelar também
    por `DELETE /api/v1/human-support/anjo/presence/scheduled` (mesmo limite da presença). Programar/cancelar não gera evento de
    presença (as horas em pausa do painel contam da transição efetiva).
  - **Bloqueio de novas atribuições**: `canReceiveAssignment` exige `!scheduledChange` (motivo `SCHEDULED_CHANGE` na lista de Anjos da
    configuração) e o passo 7 da distribuição ignora quem tem programação — mesmo com vaga sobrando. Na disponibilidade do operador o
    Anjo programado não conta como "disponível em serviço".
  - **Aplicação**: dentro de `transitions.ts › endAttendance` (todos os caminhos passam por ali: Anjo encerra, operador encerra,
    inatividade, interrupção), na MESMA transação e sob a trava da organização: se não sobra atendimento `ACTIVE`, `status` vira o
    programado, `status_since` = o `ended_at` exato do atendimento (copiado no banco — o `Date` do JS cortaria os microssegundos),
    evento `ANJO_SCHEDULED` no mesmo instante (`PRESENCE_STATUS_CAUSES` em `catalogs.ts` = causas que mudam o estado; o painel
    `presenceStateAt` usa essa lista). Não há instante entre o fim do último atendimento e o novo estado em que a fila consiga
    atribuir (duas garantias: mesma transação + filtro na distribuição).
  - **Queda e sessão** (prazos confirmados em `catalogs.ts`: conexão `leaseSeconds` 75 s renovada só pela chamada de estado com
    `workspace=anjo`; carência `graceMs` 3 min; inatividade 15 min; operador sem chamar 2 min → Abandonado na fila; sessão
    `SESSION_IDLE_TIMEOUT_MINUTES` 30 min sem interação, e a chamada de estado NÃO renova a sessão). Dentro da carência: o vínculo,
    o protocolo, as mensagens e a programação ficam; o operador vê "conexão perdida"/"O Anjo voltou". Além da carência (lease vencido
    há > 3 min): passo 2 deixa Indisponível (`LEASE_EXPIRED`) e APAGA a programação; passo 3 interrompe os atendimentos (`ANJO_LOST`)
    e o pedido volta à FRENTE da fila (mantém `queued_at`, protocolo e mensagens; prazo novo); ao voltar o Anjo está Indisponível e
    só recebe depois de "Ficar disponível" (a programação nunca o devolve à fila). Sessão expirada = mesma coisa (a área para de
    renovar a conexão); o shell leva ao login com `voltar=/apoio`, e a área do Anjo, se receber 401 antes, mostra "Sua sessão
    terminou" com "Entrar novamente" em vez de "Tentando de novo…" para sempre (`state-poller.ts › onSessionEnded`).
  - **Tela** (`anjo/presence-control.tsx`): com atendimento, "Programar pausa"/"Alterar pausa programada" e "Programar indisponível";
    faixa "Programado: Em pausa · Lanche — Entra quando terminar o último dos N atendimentos… Você não recebe novos atendimentos" com
    "Cancelar programação"; estado e cronômetro continuam os atuais até a troca. O operador nunca recebe a programação nem o motivo
    (prova confere o JSON do estado do operador).
  - **Provas**: `presence.test.ts` (regras), `anjo-workspace.test.tsx` (programar, alterar, cancelar, dois atendimentos, 401),
    `state-poller.test.ts` (401 para o laço, 500 continua) e o cenário "pausa e indisponibilidade programadas (188)…" em
    `human-support-proof` (16 cenários): imediato sem atendimento, dois simultâneos, programar/alterar/cancelar, bloqueio com vaga e 5
    distribuições em paralelo, recarregar, queda dentro da carência, operador encerra um, inatividade encerra o último com 4
    distribuições em paralelo (estado = `ended_at` exato, nenhuma atribuição no meio), privacidade, "Voltar", Indisponível programado
    ao o Anjo encerrar e queda além da carência. Mutação conferida: sem o filtro na distribuição a prova falha. Em 39 execuções houve
    UMA falha não reproduzida (logo depois da mutação; a saída não foi guardada).
  - **Aviso "Não foi possível abrir a área do Anjo. Tentando de novo…" (11/11)**: causa CONFIRMADA em `error_occurrences` do dev — 418
    respostas 500 em `GET /me/state` entre 14:54:07 e 14:59:36, `42703 column p.scheduled_status does not exist` em
    `eligibility.ts › anjosCovering`: um código anterior com a programação rodou na API de dev (`tsx watch` recarrega ao salvar) ANTES
    da coluna existir; foi revertido às 14:59:36 e as falhas pararam. Não era autenticação nem conexão. Lição: migration ANTES do código
    — aqui a 188 foi aplicada nos bancos de dev e teste antes de salvar o código que a usa.
  - **Ordem na VM** (a 188 só acrescenta: colunas anuláveis e a causa nova no check; o código anterior funciona com ela aplicada):
    1. backup do banco; 2. `npm --prefix backend run db:migrate` com o código NOVO já copiado mas a API ainda no ar com o antigo (ou
    parada — os dois servem); 3. conferir `select max(name) from schema_migrations` = `188_human_support_scheduled_presence.sql`;
    4. publicar/reiniciar a API e o worker e depois a interface; 5. abrir `/apoio` e conferir `GET /api/v1/human-support/me/state?
    workspace=anjo` = 200 com `presence.scheduled`. NUNCA publicar o código antes da migration (repete o 42703 acima). A
    homologação ainda precisa da 182–187 se não estiverem lá.
  - **Validação da migration**: `inia_hs188` (clone do `inia_test` na 187) e `inia_hs188ui` (clone do `inia_hsanjo` na 185) migrados
    pelo runner; reaplicar o SQL não quebra; causa inválida segue recusada. No `inia_hs188ui`, API isolada (127.0.0.1:3545, papel
    `api`, sem IA) e interface numa cópia da `frontend` (127.0.0.1:3621): a Área do Anjo abriu, dois atendimentos, pausa programada,
    recarregar mantém, operadora encerra um, Anjo encerra o último → "Em pausa · Lanche" com cronômetro do fim do atendimento;
    `SESSION_IDLE` forçado → login com `voltar=/apoio`. Senha descartável só nesse clone (Anjo `supervisor02.demo`, operadoras
    `camila.pereira` e `ana.lima`). A 188 está aplicada em `inia` (dev) e `inia_test`. Não conferido no navegador: queda além da
    carência e inatividade (só na prova no banco), celular e tema claro.
- **Não conferido no navegador**: aba oculta (som e título ao chegar atendimento), "Reconectando…" com a API fora do ar e várias APIs
  atrás do IIS (o script de chamada longa no IIS segue pendente antes do piloto).
