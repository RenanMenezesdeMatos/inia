# Indicadores de sucesso da INIA — inventário de fontes, fórmulas e lacunas

Tela: **Administração › Monitoramento › Indicadores de sucesso da INIA** (`/admin/inia-success`). API: `/api/v1/admin/inia-success`
(`backend/src/modules/inia-success`). Frontend: `frontend/src/components/inia-success`. Somente leitura; tudo agregado no banco.

Objetivo: em um lugar só, quanto tempo a INIA leva para responder, como as respostas e os feedbacks são avaliados, onde ela falha e
por quais assuntos as pessoas a procuram — sempre com média ou taxa **e a base**. Nenhum índice geral, nenhuma meta ou faixa de
"bom/ruim" (não existe referência definida pelo negócio).

## Regras que valem para todos os indicadores

- **Taxa** = numerador ÷ denominador, devolvidos sempre os dois. Denominador 0 = "Sem base para cálculo" (nunca 0%). Denominador
  menor que 5 = "Amostra pequena" (a porcentagem não é mostrada; a contagem é). Mesma regra e mesma função do funil das respostas e do
  painel do apoio (`funnelRatio`, `FUNNEL_MIN_SAMPLE` em `assistant/application/reply-funnel.ts`).
- **Média** = soma das observações válidas ÷ quantidade de observações (nunca média de médias de dias ou grupos). Menos de 5
  observações = amostra pequena. Ausente nunca vale zero: fica fora do numerador e do denominador e aparece na cobertura.
- **Coorte**: numerador e denominador sempre do mesmo conjunto de itens, com a data de referência declarada em cada indicador.
- **Filtros iguais em todos os blocos**: período (datas civis no fuso da organização, 1 a 92 dias — limite do funil e do painel do
  apoio), Grupo e Subgrupo. Grupo/Subgrupo = os ATUAIS da pessoa (quem está num Subgrupo pertence ao Grupo dele); no Apoio com Anjo,
  os GRAVADOS no pedido (escopo congelado do módulo). Canal (texto × voz) aparece como detalhamento, não como filtro: o funil oficial
  não separa canal.
- **Evolução**: por dia até 31 dias; por semana (segunda a domingo) acima disso, com as semanas das pontas marcadas como parciais.
- **Alcance**: nenhuma permissão nova. Cada bloco usa a permissão da tela de onde os dados vêm, com o mesmo alcance; a entrada do menu
  aparece para quem tem ao menos uma (`canViewIniaSuccess`). Bloco sem permissão = 403 na API e "Fora do seu acesso" na tela.

| Bloco | Permissão (e alcance) | Tela de origem |
|---|---|---|
| Tempo de resposta, motivos de procura | `assistant_conversations.view` (organização, Grupo, Subgrupo ou Minha estrutura, pelo dono da conversa) | Conversas com a INIA |
| Avaliação das respostas no chat, sinais da consulta, Apoio com Anjo | `human_support.coordinate` (decisão D7 do Apoio com Anjo: números de avaliação da INIA só para Coordenador de Anjos e Administrador geral) | Apoio com Anjo (painel) |
| Feedbacks e contestações | `feedback_contestations.review` (alcance do revisor, menos os próprios feedbacks) | Contestações de feedback |
| Conformidade das respostas | `configuration.manage` com escopo de ORGANIZAÇÃO | Governança › Conferência das respostas |

## Inventário das fontes

### 1. Conversas com a INIA — `assistant_conversations`, `assistant_interactions`

- Mensagens persistidas por conversa (`origin`: `USER` chat livre, `FEEDBACK` sessão de feedback, `WORKFLOW` recado, `TRAINING` treino
  — este último só existe no banco de dev, vindo de trabalho não integrado). Campos usados: `role`, `channel` (`chat`/`voice`),
  `occurred_at`, `client_message_id`, `tool_calls`.
- **Tempo de resposta (texto)** — `inia-success/application/response-time-reader.ts`.
  - O que mede: do instante em que o servidor RECEBE a pergunta (gravada antes de gerar a resposta, `realtime-router.ts` rota
    `/messages`) ao instante em que GRAVA a resposta completa (depois do streaming e da conferência). É "tempo até a resposta
    completa, medido no servidor". Não é o tempo até o primeiro trecho na tela (não fica gravado) nem inclui a rede.
  - Vínculo comprovado: a resposta do turno é gravada com `client_message_id = <chave da pergunta> || ':reply'` na mesma conversa.
    Nunca por vizinhança de mensagens.
  - Fórmula: Σ(resposta.occurred_at − pergunta.occurred_at) ÷ nº de pares. Mediana e "90% em até" por posição (`percentile_disc`).
  - Base (cobertura): perguntas por texto no chat livre, por data da PERGUNTA. Fora da média e contados: sem resposta (sinal
    `NO_REPLY`), sem resposta gravada (turno cancelado), registros antigos sem chave, pares com horário inconsistente.
  - Texto digitado com a voz ligada (chave `<turno>:user`, gravado pelo turno da voz) é respondido pelo fluxo da voz: fora da base do
    texto, contado à parte. **Voz: sem medida confiável** — pergunta e resposta são gravadas quando o turno termina, o horário da fala
    vem do navegador e a resposta inclui a própria fala.
  - Dev (12/10–10/11/2026): 111 de 123 perguntas medidas, média 22 s. No histórico do banco de dev, 173 das 216 perguntas "de texto"
    sem par eram texto digitado com a voz ligada — por isso esse grupo saiu da base.
- **Motivos de procura** — `routes-reader.ts`. Rota que a INIA acionou para responder: especialista executado
  (`assistant_interaction_agents`, papel `SPECIALIST`, `outcome = EXECUTED`; nome e domínio de negócio do Agent por `agents_all` /
  `business_domains_all`) e ferramenta direta (`tool_calls[].toolName`, sem `response_check`, `knowledge_clarification_answer` e
  `agent_<hex>`). Unidade: resposta da INIA no chat livre (texto e voz), por data da resposta, menos a etapa de esclarecimento
  aguardando escolha (regra do M1). Várias rotas por resposta → participações podem somar mais de 100%. "Sem especialista nem
  ferramenta" = o Orquestrador respondeu sozinho. É o assunto como a INIA o entendeu — não motivo da chamada do cliente nem motivo de
  avaliação negativa. Os títulos das conversas (texto livre gerado) não são usados: não são categoria.

### 2. Avaliação das respostas no chat e sinais da resposta — leitor oficial `replyFunnel` (M1–M6)

- `assistant_interaction_ratings` (migration 158): histórico de curtir/descurtir; vigente = sem `superseded_at`; `NONE` = retirada.
  `assistant_interaction_rating_details` (181): motivo da descurtida (`WRONG_INFORMATION`, `DID_NOT_ANSWER`, `NOT_FOUND`, `INCOMPLETE`,
  `HARD_TO_UNDERSTAND`, `OTHER`), "ainda precisa de ajuda?". `assistant_reply_signals` (181): sinais calculados por código no turno
  (`KNOWLEDGE_NOT_FOUND`, `KNOWLEDGE_INSUFFICIENT`, `CONSULTATION_FAILED`, `SPECIALIST_BLOCKED`; `NO_REPLY` fica na pergunta).
- Totais: `replyFunnel` (chat livre, data da resposta, avaliação vigente). Evolução e divisão por canal: `replies-reader.ts`, com as
  mesmas regras (a prova confere que a soma dos dias = o funil).
- **Respostas úteis no chat** = "útil" vigente ÷ ("útil" + "não foi útil") vigentes. É percepção de quem avaliou — não validação
  humana, não prova de correção.
- **Respostas avaliadas** = avaliação vigente ÷ respostas.
- **Respostas com falha na consulta** = respostas com ao menos um sinal ÷ respostas com registro de sinais (registro começa na data
  mostrada na cobertura; anteriores ficam fora). Vários sinais por resposta → parcelas podem passar de 100%.
- **Motivo da avaliação negativa**: um por descurtida; "motivo não coletado" = descurtida anterior ao formulário de motivo.

### 3. Apoio com Anjo — leitor oficial `supportFunnel` (M7–M17)

- **O Anjo é uma pessoa** (papel `ANJO`, apoio humano), não uma IA. Implementação: `backend/src/modules/human-support`, migrations
  182–185 (branch `claude/apoio-humano-operador-832409`). Não confundir com a conferência automática das respostas (governança).
- `human_support_classifications`: uma por atendimento, feita pelo Anjo ao encerrar. `reason` (`CLASSIFICATION_CATALOG_V2`): falta de
  processo, falta de orientação, pergunta mal formulada, informação existente em processo que poderia ter sido encontrada,
  informação obtível por sistema ou outra IA, sem acesso à ferramenta, ferramenta indisponível, outro. `outcome`: resolvido,
  orientado, encaminhado, não resolvido. `human_support_evaluations`: "sua dúvida foi resolvida?" (sim/em parte/não) e estrelas 1–5.
- Na tela: motivo do pedido de apoio (M14, com cobertura = classificados ÷ encerrados), resultado declarado (M15), dúvida resolvida
  segundo o operador (M16), média de estrelas (M17, só com 5 notas ou mais), pedidos por origem (M8) e atendimentos classificados por
  dia (data de início do atendimento). Períodos com o apoio desligado aparecem na cobertura.

### 4. Feedbacks — `feedbacks`, `interaction_feedback_deliveries`, `feedback_ratings`, `feedback_rating_reviews`

- Coorte: feedbacks DISPONIBILIZADOS no período (`published_at` / `delivered_at`), pelas leituras oficiais da Monitoria de usabilidade
  (`publishedFeedbackSourcesSql` sem os ocultados do Acompanhamento; `deliveredInteractionFeedbackSourcesSql`), a pessoas do alcance de
  `feedback_contestations.review`, menos os do próprio leitor — mesma coorte da fila e do resumo de contestações.
- **Ciência** = `acknowledged_at` (confirmação com login e senha do próprio colaborador) ÷ disponibilizados. Ciência = leu; não é
  concordância nem utilidade.
- **Feedbacks avaliados** = avaliação vigente (útil/não foi útil) ÷ disponibilizados. **Utilidade positiva** = útil ÷ avaliados.
  **Avaliação negativa** = não foi útil ÷ avaliados (não é erro comprovado). Retiradas e trocas aparecem à parte; conta a vigente.
- **Contestação** = feedbacks contestados ÷ disponibilizados. Contestado = "não foi útil" vigente OU já respondido pela revisão (regra
  da fila); retirado antes da resposta não conta; um por feedback (a contestação mais recente).
- **Revisão** (`feedback_rating_reviews.decision`): `ACCEPTED` = "Contestação procedente" (a contestação tinha razão — não é aprovação
  do feedback); `PARTIALLY_ACCEPTED` = "Procedente em parte"; `REJECTED` = "Feedback mantido". **Procedência** = procedentes ÷
  revisadas (as três decisões); procedentes em parte mostradas separadas, sem peso; pendentes fora do denominador e contadas à parte.
  O resultado das revisadas não se estende às pendentes nem a todos os feedbacks.
- Motivos das contestações: um por contestação (somam 100%). Por tipo: indicador × monitoria.

### 5. Conformidade das respostas — `response_compliance_checks` (PEN-017)

- Conferência automática (IA) das respostas contra assuntos proibidos da Governança e limites de atuação do Agent. `outcome`:
  `ALLOWED`, `VIOLATION`, `CHECK_FAILED`; `action`: `DELIVERED`, `BLOCKED`, `RECORDED`.
- **Conformidade** = sem violação ÷ conferências conclusivas (sem violação + violação); inconclusiva (a conferência falhou) à parte.
  Mede conformidade com regras, **não correção**: resposta sem violação não é necessariamente correta.
- Unidade: conferência gravada, só nas superfícies em que a INIA fala com a pessoa (`CHAT`, `VOICE_TOOL`, `VOICE_SPOKEN`); treino fora.
  Modo em vigor (`INIA_RESPONSE_CHECK`: ENFORCE/AUDIT/OFF) aparece junto.

## Métricas disponíveis × lacunas

| Pedido | Situação | Por quê / o que existe |
|---|---|---|
| Tempo médio de resposta, geral e evolução | **Disponível (texto)** | Par comprovado pela chave; voz sem medida confiável |
| Tempo até o primeiro trecho (primeira resposta) | **Lacuna** | `chat_turn_timing` só vai para o log e as métricas do processo (`/internal/metrics`), não para o banco |
| Assertividade segundo o Anjo (correta ÷ conclusivas) | **Lacuna** | O Anjo não classifica a resposta da INIA; classifica o motivo do pedido e o resultado do atendimento |
| Erro identificado pelo Anjo (incorreta ÷ conclusivas) | **Lacuna** | Idem. Nada é estimado a partir de outras classificações |
| Conformidade com regras | **Disponível** | Conferência automática (não é correção) |
| Contestação pelo colaborador | **Disponível** | Regra da fila de contestações |
| Rejeição entre avaliações | **Disponível** | Avaliação negativa dos feedbacks; e descurtidas no chat |
| Procedência entre revisadas, parciais e pendentes | **Disponível** | Revisão humana das contestações |
| Taxa de avaliação, utilidade positiva, negativa, motivos | **Disponível** | Feedbacks e respostas do chat, separados por origem |
| Concordância explícita com o feedback | **Coleta indisponível** | Sem registro próprio hoje (a unificação ciência + concordância está em andamento em outra frente) |
| Erro confirmado nas respostas do chat | **Lacuna** | Descurtida do chat não tem revisão humana (só os feedbacks têm) |
| Motivos de procura | **Disponível (pela rota)** | Especialista/ferramenta acionados; sem classificação humana de intenção |
| Problemas de qualidade recorrentes | **Disponível** | Sinais da consulta, motivos de descurtida, motivos do Anjo, violações |
| Notas por dimensão | **Só estrelas do atendimento do Anjo (1–5)** | Única escala definida e comparável; nenhuma nota por dimensão da resposta da INIA |

### Instrumentação mínima proposta (não implementada: depende de decisão de produto)

1. **Avaliação da resposta pelo Anjo**: no formulário de classificação, um campo opcional "A resposta da INIA que originou o pedido
   estava: correta · parcialmente correta · incorreta · não dá para dizer · não houve resposta", com catálogo versionado, gravado na
   classificação e ligado a `human_support_requests.source_interaction_id`. Habilita "Assertividade segundo o Anjo" e "Erro
   identificado pelo Anjo" com cobertura (pedidos com resposta de origem). Ainda seria avaliação humana amostral (só respostas que
   viraram pedido), nunca do universo todo.
2. **Tempos do turno no banco**: gravar recebido / primeiro trecho / concluído por resposta (o rastreio `chat-turn-trace.ts` já
   calcula), habilitando "tempo até a primeira resposta" e um tempo de voz com marca de início e fim da geração.
3. **Concordância explícita**: quando a unificação ciência + concordância for integrada, acrescentar ao bloco de feedbacks com a mesma
   coorte (concordância ≠ ciência ≠ utilidade).
4. **Revisão das descurtidas do chat**: só se o negócio quiser "erro confirmado" das respostas do chat (hoje não há revisão).

## Diferenças conhecidas com outras telas

- O card de tempo de resposta em desenvolvimento para "Conversas com a INIA" (outra frente, ainda não integrada) mede pela mensagem do
  colaborador imediatamente anterior (`lag`) e filtra pela data da resposta; esta tela mede pela chave pergunta → resposta e pela data
  da pergunta, e separa o texto digitado com a voz ligada. Os números podem diferir; o critério desta tela é o comprovado.
- Conversas e funil contam por pessoa no Grupo/Subgrupo atual; o Apoio com Anjo conta pelo escopo gravado no pedido.
- As telas de origem ainda não leem o período pela URL: os links "registros que sustentam os números" abrem com o filtro padrão delas.

## Validação

- Domínio: `backend/src/modules/inia-success/domain/success-metrics.test.ts` (taxa sem base, amostra pequena, média ponderada × média de
  médias, semanas parciais, soma por intervalo, participações acima de 100%).
- Prova contra o banco de teste: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run inia-success-proof` (duas organizações próprias, apagadas
  no fim): pareamento pela chave, sem resposta/sem chave/sem par/texto com voz fora da média, avaliação trocada e retirada, soma dos dias
  = funil, rotas múltiplas e esclarecimento aguardando escolha, contestação revisada que depois virou "útil", pendentes, o próprio leitor
  fora, escopo congelado do Anjo, conformidade só nas superfícies de conversa, treino fora, outra organização fora, 403 por bloco, 422
  acima de 92 dias.
- Tela: `frontend/src/components/inia-success/inia-success-page.test.tsx` (fora do acesso, "Sem base para cálculo", amostra pequena,
  erro por bloco com tentar de novo, dica do indicador).
