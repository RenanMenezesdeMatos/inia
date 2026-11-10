# Goldfish Annotated Review Report

## Situação final

* Estágios 5, 6, 7, 8 e 9 executados com revisores Goldfish novos (despacho direto, subagentes só leitura lendo as personas oficiais de `google/elephant-goldfish-model`; o plugin não está instalado, então a exclusão do `CLAUDE.md` não foi garantida).
* Uma re-auditoria no estágio 7 (Design Critic sobre a v2) e uma no estágio 9 (Implementation Readiness sobre a v3) — o limite do EGM é uma por estágio.
* A re-auditoria do estágio 9 confirmou fechados os bloqueadores anteriores (DDL, contratos, descurtida na A0) e levantou 1 Blocker e 4 Major novos, corrigidos na v3.1 **sem nova rodada Goldfish** (limite atingido). Não há achado Blocker ou Major aberto conhecido; os itens D1–D12 e OQ1–OQ4 dependem do dono do produto.

## Depois da revisão — decisões do dono do produto (v3.1 → v4)

Aplicadas pelo Elefante, sem nova rodada Goldfish: D1–D12 (seção "Decisões do dono do produto" da especificação). A mudança de maior efeito é D2 — atribuição direta no lugar da oferta com 30 s —, que **remove** a tabela de ofertas, aceitar/recusar, a pausa de sistema por oferta perdida e as disputas de aceite (achados IC-1/Z8-2, DC-5, IC-5 deixam de existir no desenho) e acrescenta o tempo até a primeira resposta do Anjo (M12, M18). D7 tira os números da INIA de "Conversas com a INIA"; D10 passa a sempre compartilhar a resposta (revoga a resolução de RA-4); D12 troca o prazo configurável pelo calculado.

## Rodada 3 — re-auditoria do estágio 9 (sobre a v3) → v3.1

| Achado | Sev. | Categoria | Resolução aplicada na v3.1 |
| --- | --- | --- | --- |
| R9-1 Fronteira do módulo: nome, foto, lugar da pessoa e escopos dos Anjos sem fonte | Blocker | PROPOSE FIX | Tabela do que `human-support` usa de fora: `assignmentScopesOf` (nova, `access`), `loadPersonPresentations` (`profile-preferences`), leitura só das tabelas estruturais `people`/`teams`/`subteams` |
| R9-2 Respostas, status e erros de vários comandos | Major | PROPOSE FIX | Tabela "Rotas: sucesso e erros" no Apêndice C, com códigos novos (`HUMAN_SUPPORT_NOT_CONNECTED`, `HUMAN_SUPPORT_NO_ENABLED_SCOPE`, `HUMAN_SUPPORT_ALREADY_CLASSIFIED`, `PERIOD_TOO_LONG`) e parâmetros de cursor |
| R9-3 `Measure` não comporta medidas compostas | Major | PROPOSE FIX | `Measure` com `main`, `coverage`, `conversion`, `percentiles`, `extra`; chaves de `breakdown` por medida; M17 fora de `Measure`; recorte nas duas entradas do funil |
| R9-4 Sem catálogo de mensagens de sistema | Major | PROPOSE FIX | `SYSTEM_MESSAGE_CODES_V1` (só o código é gravado; o servidor monta o texto para quem lê), check no DDL, `REQUEST_EVENT_CAUSES_V1` |
| R9-5 Assinatura de `buildSupportContext` | Major | PROPOSE FIX | Recebe `organizationId`; devolve `null` (404) ou fatos + cópia; origem decidida em `origin.ts` |
| R9 Nits | Nit | PROPOSE FIX | Ordem da reversão da Parte A; `signals` no `loadConversationMessages`; `interactionId` mantido na resposta; `HumanSupportStateProvider`; recusa não reinicia o prazo da fila; `details` só no chat livre (422); `recordSuggestion` só para chat livre e sem derrubar a rota |

## Rodada 2 — estágio 9 e re-auditoria do estágio 7 (sobre a v2) → v3

**Relatórios de origem:** [implementation_readiness_report.md](implementation_readiness_report.md) · re-auditoria do Design Critic (achados abaixo, ids RA).

| Achado | Sev. | Categoria | Resolução aplicada na v3 |
| --- | --- | --- | --- |
| IR-B1 / CD-10 DDL insuficiente | Blocker | PROPOSE FIX | Apêndice B com o DDL completo das duas migrations (colunas, tipos, checks, FKs com `on delete`, índices nomeados, protocolo, troca do check da 151 pelo catálogo) |
| IR-B2 Contratos de API | Blocker | PROPOSE FIX | Apêndice C com todos os corpos, consultas e respostas; arquivos de esquema nomeados |
| CD-1 / IR-M1 / RA A0 com 422 perde descurtidas | Blocker | PROPOSE FIX | O servidor nunca recusa `DOWN` sem detalhes (todas as fases); regras 1–3 com ordem fixa |
| CD-2 / IR-M2 Arquivos do backend faltando | Major | PROPOSE FIX | Itens 5, 6, 10 e exportação via `person_id` nas tabelas da Parte A |
| CD-3 / IR-M4 / RA Sinais por ramo e transação | Major | PROPOSE FIX | Tabela ramo → sinais; linha gravada por `append` na mesma transação; `markNoReply`; `failed: true`; voz por chamada |
| CD-4 `KNOWLEDGE_NOT_FOUND` mal definido | Major | PROPOSE FIX | "Conteúdo" definido; rastro do Orquestrador nunca conta; `FULL` = conteúdo |
| CD-5 `NO_REPLY` no frontend | Major | PROPOSE FIX | `ConversationRef.userMessageId`; balão de erro com id e sinal; sugestão abaixo da pergunta |
| CD-6 / CD-7 / IR-M5 Ligação no servidor | Major | PROPOSE FIX | `excludeFromLatency`; registro criado em `server.ts`; chaves de `RateLimitSettings`; routers admin antes da linha 425; `/funnel` antes de `/:conversationId`; duas entradas do funil |
| CD-8 / CD-9 / IR-M3 Arquivos do frontend e caminhos | Major | PROPOSE FIX | `proxy.ts`, `app-top-bar.tsx`, `authenticated-app-shell.tsx`, `admin/page.tsx`, rota `*-route.ts`, botão do cabeçalho, props `renderSupportSuggestion`/`onRequestSupport`, caminhos corretos de serviço, query e wiki |
| IR-M6 Plano de testes | Major | PROPOSE FIX | Testes ao lado do código com caminho, Create/Modify certos e casos que faltavam |
| S9-1..5 Termos e critérios | Major | PROPOSE FIX | "chave de idempotência", "dreno", pré-condições com responsável, limites mensuráveis no dreno e no IIS |
| RA-1 Aviso "sem conexão" sem caminho até o operador | Major | PROPOSE FIX | A distribuição grava "sem conexão" e "voltou" como mensagens de sistema e sobe a versão do operador |
| RA-2 Disponibilidade incompleta e congelada | Major | PROPOSE FIX | Regra de precedência com cinco casos; recalculada a cada resposta (≤ 20 s) |
| RA-3 Mensagens: cursor, relógio e deadlock | Major | PROPOSE FIX | `for update` no pedido; `seq` por pedido; relógio do banco; ordem única de travas com versões por último; avaliação e classificação na tabela de escritas |
| RA-4 Cópia com dados de outras pessoas | Major | PROPOSE FIX | Resposta omitida quando usou ferramenta de dados ou liderança **→ confirmar (D10)** |
| RA-5 Registro LGPD incompleto | Major | PROPOSE FIX | Uma linha por pessoa vista; tipo `HUMAN_SUPPORT_PRESENCE`; alcance sobre o Anjo em uma direção **→ confirmar (D11)** |
| RA-6 Estimativa otimista | Major | PROPOSE FIX | Menor *t* em que os aceitos chegam a metade da população; senão "mais de X"; desligados fora |
| RA-7 M7/M8 "mostrada" e conversão | Major | PROPOSE FIX | Evento `SUGGESTION_ELIGIBLE`; conversão por coorte |
| RA Nits (FKs, `OPERATOR_ABSENT`, prazo × sessão, M9, pergunta do esclarecimento) | Nit | PROPOSE FIX | Tabela de FKs completa; checagem no servidor; prazo 5–25 min **→ confirmar (D12)**; M9 sem índice único; pergunta original do esclarecimento |
| CD-11..13, IR e S9 Nits | Nit | PROPOSE FIX | Aplicados |

## Rodada 1 — estágios 5 a 8 (sobre a v1) → v2

**Status:** resolved (correções aplicadas em `design_draft.md` v2)
**Target:** `docs/designs/apoio-com-anjo/design_draft.md` (v1, 766 linhas)
**Relatórios de origem:** [zoom_out_report.md](zoom_out_report.md) · [comprehension_report.md](comprehension_report.md) · [critic_report.md](critic_report.md) · [intermediate_zoom_out_report.md](intermediate_zoom_out_report.md)

Regra de resolução combinada com o dono do produto: o Elefante resolve detalhes técnicos; o que muda experiência, regra de negócio ou significado de métrica vai para a aprovação (marcado **→ confirmar**).

| Achado | Sev. | Categoria | Resolução aplicada na v2 |
| --- | --- | --- | --- |
| ST-1 Riscos e mitigações | Blocker | PROPOSE FIX | Seção "Riscos e mitigações" com os riscos do brief e os novos |
| ZO-1 Medição presa ao Anjo | Major | PROPOSE FIX | Entrega em duas partes: A (resolutividade do chat) independe de B (Apoio com Anjo) **→ confirmar** |
| ZO-2 / DC-2 M1–M6 no módulo errado | Major | PROPOSE FIX | Porta de leitura `assistant/application/reply-funnel.ts`; `human-support` só compõe |
| ZO-3 / DC-13 `DOWN` sem motivo | Major | PROPOSE FIX | O polegar só abre o formulário; `DOWN` + detalhes numa chamada; `DOWN` sem detalhes sobre `DOWN` vigente não grava |
| ZO-4 / DC-4 Administrador geral com `attend` | Major | PROPOSE FIX | Administrador geral só com `coordinate` e `manage`; elegibilidade pela permissão `attend` (papel `ANJO`) |
| ZO-5 Elegibilidade copiada | Major | PROPOSE FIX | `personIdsWithPermissionCovering` em `access/application/permission-holders.ts` |
| ZO-6 Sugestão por três caminhos | Major | PROPOSE FIX | Mensagens trazem só `signals`; a tela compõe com o estado; servidor só registra o evento; sai o evento SSE e `suggestionFor` |
| IC-1 / Z8-2 / DC-9 / CP-1 Status mistura declaração e conexão | Major | PROPOSE FIX | `status` só declarado; "conectado" calculado; interrupção decidida pelo atendimento (`lease_until <= agora − 3 min`); `AWAY` sai: oferta deixada passar vira pausa de sistema "Sem resposta a uma oferta" **→ confirmar** |
| DC-14 `AWAY` em serviço por até 30 min | Major | CONTEST (parcial) | A regra "em pausa conta como em serviço" é decisão registrada (`concepts_brief.md`, "Decididas pelo dono do produto"; `feature_concept.md`, "Disponibilidade, fila e espera"). Mantida; entra em Riscos **→ confirmar** |
| IC-2 / Z8-4 / DC-10 Área do Anjo no canal compartilhado | Major | PROPOSE FIX | A área tem a própria chamada longa (`workspace=anjo`) sob a trava de aba única; canal compartilhado só do operador. Redimensionar prazos para o modo de reserva: DECLINE (risco; OQ1 impede ligar antes da validação) |
| IC-3 / Z8-1 / DC-12 Distribuição em todo comando e trava | Major | PROPOSE FIX | Trava por organização só em comandos que mudam estado; mensagens com trava de linha do pedido; renovações sem trava; `dispatch` depois do commit com `pg_try_advisory_xact_lock` + tarefa de 3 s |
| IC-4 Renovação como comando | Nit | PROPOSE FIX | Renovação condicional com `greatest`, sem trava e sem versão |
| IC-5 / Z8-3 Prévia com 409 | Nit | PROPOSE FIX | Prévia devolve `ratingId`; cópia montada de linhas imutáveis; sai `previewHash` |
| CP-2 / SY-4 / ST-6 / DC-17 Origens | Major | PROPOSE FIX | Origens `BUTTON`, `DISLIKE`, `SIGNAL` derivadas no servidor; tabela de origens; cópia para `NO_REPLY` e botão |
| CP-3 / ST-8 Tentativa sem Anjo | Major | PROPOSE FIX | `POST /requests` grava a tentativa e devolve 409; botão de pedir fica habilitado com o aviso **→ confirmar** |
| CP-4 Termos da INIA | Major | PROPOSE FIX | Glossário ganha bases, especialista, esclarecimento; sinais redefinidos sem "ferramenta de dados" |
| CP-5 / DC-7 Elegibilidade e alcance | Major | PROPOSE FIX | "Cobrir" definido; pessoa sem Subgrupo tratada; Coordenador por `scopeCovers` entre escopos |
| CP-6 / ST-9 Área do Coordenador e telas | Major | PROPOSE FIX | Seção "Telas" por papel; área isolada no padrão de `admin/layout.tsx:23-26` |
| DC-3 LGPD dentro da transação | Major | PROPOSE FIX | Registro depois do commit, na rota |
| DC-5 Papel revogado aceita oferta | Major | PROPOSE FIX | Elegibilidade reconferida no aceite; varredura retira ofertas e interrompe |
| DC-6 Leitura sem prazo pelo Anjo anterior | Major | PROPOSE FIX | Anjo lê só as mensagens do pedido até o fim do próprio atendimento, enquanto tiver o papel no escopo **→ confirmar** |
| DC-8 Reconexão durante o desligamento | Major | PROPOSE FIX | Com `draining`, toda chamada (nova ou aberta) responde `reconnect` na hora; `Readiness` ganha aviso de início do dreno |
| DC-11 Rolagem automática renova a sessão | Major | PROPOSE FIX | Tirar `scroll` de `INTERACTION_EVENTS` (`session-idle-guard.tsx:15`) — vale para todo o app |
| DC-15 FKs para pessoas | Major | PROPOSE FIX | Tabela explícita por coluna; sem FK composta; classificação também ligada ao operador (entra na exportação dele) **→ confirmar** |
| DC-16 Voz e "não calculado" | Major | PROPOSE FIX | Linha com lista vazia quando calculado; M6 sobre respostas calculadas |
| SY-3, SY-5, SY-6, SY-7, SY-8, SY-9, SY-10 | Major | PROPOSE FIX | Termos únicos ("Na fila", "chamada de estado", "deixada passar"); texto único ao Anjo; início dos 3 min; quem chama cada função; afirmações calibradas |
| ST-2 `\|` em tabelas | Major | PROPOSE FIX | Escapado |
| ST-3 Referência "(seção 13)" | Major | PROPOSE FIX | Corrigida |
| ST-4 Alternativas incompletas | Major | PROPOSE FIX | Prós/contras em todas; decisões com link para o brief |
| ST-7 Modelo diverge do corpo | Major | PROPOSE FIX | Modelo com colunas completas |
| ST-10 Open Questions soltas | Major | PROPOSE FIX | OQs citadas no corpo; lista "Decisões a confirmar" |
| ZO-7 Estimativa complexa | Nit | PROPOSE FIX | Mediana simples com desistências como "pelo menos X"; sem cache; um número |
| ZO-8 Correção do `FAILED` | Nit | PROPOSE FIX | Fora desta especificação (proposta de PR próprio) |
| ZO-9 Sobreposições | Nit | PROPOSE FIX (parcial) / CONTEST | Capacidade vira coluna da presença; "Elegibilidade" vira filtro da aba Anjos. Histórico da avaliação: CONTEST — decidido pelo dono do produto ("alteráveis por 24 h com histórico", `feature_concept.md`, "Encerramento, classificação e avaliação") |
| ZO-10 Detalhe demais e nomes | Nit | PROPOSE FIX | Apêndice de parâmetros; `loadConversationRatings`; justificativa da Alternativa E corrigida |
| Z8-5 `features.chatDislikeDetails` | Nit | PROPOSE FIX | Flag removida; pré-condição de fase |
| CP-7 a CP-12, ST-11 a ST-17, SY Nits, DC Nits | Nit | PROPOSE FIX | Aplicados quando cabiam sem aumentar o documento; `statement_timestamp()` nos prazos; versões não incrementadas por renovação |
