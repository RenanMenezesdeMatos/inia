# Goldfish Review Report — Estágio 9 (Implementation Readiness)

**Target:** `docs/designs/apoio-com-anjo/design_draft.md` v2 — DetailedRange 731-872 (e afirmações de código das linhas 1-730).

| Reviewer | Status |
| --- | --- |
| `implementation_readiness` | completed |
| `codebase_details` | completed |
| `style` | completed |

Ids: IR = implementation readiness, CD = codebase details, S9 = style.

## Blockers

### IR-B1 / CD-10 · DDL não definido o suficiente
Faltam `id`/`organization_id` em várias tabelas, FKs com `on delete` (a retenção trata FK fora de `children` como proteção, `run-data-retention.ts:19-41`; `children` exige CASCADE real), tipos e checks de `status`/`end_cause`/`cause`, `seq`, formato do protocolo, predicados dos índices parciais, deduplicação da tentativa sem Anjo e o nome do check de `personal_data_access_log` (inline, sem nome, `151:16`).

### IR-B2 · Contratos de API não definidos
Campos de `OperatorView`/`AnjoView`, respostas de preview, `/me/requests`, `/anjo/attendances`, admin, métricas, a resposta nova do PUT da avaliação e do `GET /funnel`; arquivos de esquema não nomeados.

### CD-1 / IR-M1 · A0 com 422 perde descurtidas em silêncio
O frontend em produção manda `{ value }` sem detalhes e engole o erro (`operator-inia-chat.tsx:1634-1640`). Entre A0 e A1, toda descurtida do chat livre se perde; a reversão da Parte A tem o mesmo defeito.

## Major

* **CD-2 / IR-M2 · Arquivos do backend faltando:** `assistant-conversations.ts` (`ConversationStore.rate`/`ratingsOf`, 437-440), `assistant/testing/memory-conversation-store.ts:131-140`, `conversation-monitoring.ts:245` (consome `loadConversationRatings`; `SCOPE_CTE`/`OWNER_VISIBLE` não exportados), `subject-data-export.ts` (detalhes e sinais não são exportados: só um nível abaixo de `OWNED_PARENTS`).
* **CD-3 / IR-M4 · "Três caminhos" não correspondem ao código:** `/messages` grava em FEEDBACK, REPORT_PROPOSAL, LEADERSHIP, DATA_ONLY, PERSONA_STREAM, CLARIFICATION e ORCHESTRATED; `/tool-call` em SELF_TOOL, `answerVoiceAsk`, liderança, bloqueado, especialista; `ResolvedConversation` não tem `origin`; o item 6 é em parte redundante (`results[].knowledge`, `calls[].outcome`, `TOOL_FAILED_TEXT`). Falta transação dos sinais com o `append`.
* **CD-4 · `KNOWLEDGE_NOT_FOUND` mal definido:** `NONE` = nenhuma base autorizada; o Orquestrador normalmente não tem base (`resolve-orchestrator.ts:45-47`) — a regra marcaria um "obrigado"; `FULL` não classificado; "conteúdo" de `directResults` indefinido.
* **CD-5 · `NO_REPLY` no frontend:** o `catch` do `send` (`operator-inia-chat.tsx:1506-1530`) cria balão sem `interactionId`; `ConversationRef` (`gemini-text-client.ts:43`) não lê o `userMessageId` que o servidor já manda (`realtime-router.ts:1269`); onde a sugestão aparece ao recarregar.
* **CD-6 / IR-M5 · Métricas:** `runtime-metrics.ts` não tem "amostra geral" nem opção de exclusão; registro de esperas sem ponto de criação; chaves de limite em `RateLimitSettings` (`app.ts:123`) não nomeadas.
* **CD-7 / IR-M5 · Ordem de montagem:** `app.use("/api/v1/admin", can("configuration.manage"), …)` (`app.ts:425`) captura routers montados depois → Coordenador com 403; `GET /funnel` antes de `/:conversationId`; forma do filtro de pessoas de `replyFunnel`.
* **CD-8 / IR-M3 · Arquivos do frontend faltando:** `authenticated-app-shell.tsx:55` (entrada em Administração), `top-bar/app-top-bar.tsx:31,38`, `proxy.ts:10` (`AUTHENTICATED_PREFIXES` sem `/apoio`), `app/(app)/admin/page.tsx:10-11` (redirecionamento), constante de rota `*-route.ts`; botão permanente no cabeçalho do chat; ligação do formulário ao `request-dialog`; mecanismo do "componente opcional".
* **CD-9 / IR-M3 · Caminhos errados:** não existe `schemas/admin/assistant-conversations*.ts` (o contrato está em `services/admin/assistant-conversations-service.ts` e `queries/admin/use-assistant-conversation-queries.ts`); `wiki-nav.ts` fica em `components/wiki/`; testes sem caminho; itens 28/53 sem arquivo.
* **IR-M6 · Plano de testes:** caminhos ao lado do código; testes existentes são Modify; casos faltando (`personIdsWithPermissionCovering`, delegação, 422, sinais por ramo, esperas, expiração de 20 min, tentativa a cada 10 min, cópia = prévia, retenção, limites, versão otimista).
* **S9-1..5:** "chave" (idempotência) × "chave geral"; "desligar" (escopo) × parada do processo; pré-condições de B1/B2 sem dono e critério; testes de dreno/IIS sem limite mensurável; mecanismo do componente opcional.

## Nits

* CD-11: notas do rastreamento só aceitam escalares (códigos como texto separado por vírgula).
* CD-12: ordem entre "422 sem details" e "`DOWN` sem detalhes não grava".
* CD-13: nome do check da 151; `recordPersonalDataAccess` devolve `void` (métrica de falhas impossível sem mudar a assinatura); citação "depois do commit" em `conversation-monitoring-router.ts:64` não se aplica.
* IR: nome/descrição/`allowedScopes` dos papéis e textos das permissões; `canManageHumanSupport` por organização; `infrastructure/` sem arquivo; CA12 "na hora" = até 3 s; o que a quinta chamada longa responde.
* S9-6..15: termos fora do glossário; verbos vagos nos critérios; "esta especificação aprovada"; `pg_locks` sem consulta; "prova" × "caso"; notação "×"; listas de exportação ambíguas; item 9 com cinco mudanças; curinga em caminho; títulos em dois idiomas.
