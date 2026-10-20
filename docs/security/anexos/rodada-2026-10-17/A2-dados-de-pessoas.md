> Anexo da segunda rodada da auditoria de segurança (17/10/2026). Relatório de trabalho de uma das quatro frentes, escrito sobre o código ANTES das correções (HEAD 27726180); as correções e o estado final estão em ../../relatorio-de-achados.md e ../../pendencias-e-riscos.md. Caminhos citados fora do repositório (scratchpad) eram arquivos temporários de prova e não fazem parte da entrega.

# A2 — Autorização por objeto: dados de pessoas, casos e feedbacks (auditoria 17/10/2026)

Auditor: A2 (somente leitura). Branch `admin-list-standardization` @ 27726180. Prefixo dos achados: `SCOPE`.
Base: `backend/src/main/app.ts` (cadeia de montagem), `require-auth.ts`, `require-permission.ts`, `getManageableScopes`,
`loadViewerScope`/`resolveSubject`, `access-decision.ts` (`canOnCollaborator`, `scopeReachesCollaborator`).

Premissas de leitura:
- `requireAuth` relê sessão/conta/nível no banco a cada request; `request.user.organizationId/personId/sub` são confiáveis.
- `requirePermission` só garante "a permissão em ALGUM escopo"; o objeto é checado no módulo.
- Instalação mono-organização: diferenças "outra organização" são registradas como latentes quando só a organização falta.

## Notas de trabalho por módulo (o que foi lido)

### interventions (`/api/v1/interventions`, `/api/v1/admin/intervention-policies`) — NOVO
- Montagem: `app.ts:299` e `:301` (linhas no app.ts atual, que outra sessão alterou durante a auditoria), só `requireAuth` (+ `costly`). A permissão é decidida dentro.
- `intervention-router.ts`: TODA rota com `:interventionId` passa por `getInterventionDetail` ou `runCommand`
  (`intervention-service.ts`), que carregam a linha por `id + organization_id` (sessão), calculam `relationFor`
  (responsável/aprovador/abriu-aceitou/cadeia `isInStructure`/permissões `interventions.*` com `canOnCollaborator` sobre o
  Grupo/Subgrupo ATUAL do colaborador) e respondem 404 fora de `canViewIntervention`; escrita passa por `authorizeCommand`
  (o próprio colaborador nunca; aprovar ≠ quem abriu/aceitou; continuidade só com `interventions.sensitive_decide` VIVO no
  escopo). `cases/:caseId` e `people/:personId` conferem `canSeeInterventionsOf` do dono do caso/pessoa (404). `reports/:id`
  confere `canSeeInterventionsOf(report.structured.subject.personId)`. Abertura manual: `canOpenFor` (cadeia ou
  `interventions.execute` no escopo), caso informado precisa ser do mesmo colaborador. Evidência manual: só referência
  verificável do PRÓPRIO colaborador (feedback/interação/evidência/diagnóstico filtrados por `organization_id` + pessoa).
  Dono de tarefa: o colaborador ou alguém da cadeia dele. Encaminhar: só para alguém acima na cadeia. Pendências: só do viewer.
- `intervention-admin-router.ts`: guard do router exige uma permissão de política ou `workflows.manage`; tipos/competências
  escrevem só com escopo de organização; políticas com `coversPolicy`/`seesPolicy`; simular/auditar/reavaliar com pessoa real
  exige `canSimulateWith` (Workflows no escopo do colaborador ou o colaborador no `loadViewerScope('indicators.view')`), 404
  fora; simulação em banco somente leitura; nomes na lista de avaliações só de quem o viewer enxerga.
- Resultado: sem IDOR nas rotas do líder; achados SCOPE-02 (simulação/avaliações e caso revelam histórico de intervenções),
  SCOPE-03 (relação congelada) e SCOPE-07 (títulos de documentos).

### reports (`/api/v1/reports`) — NOVO (795f3328)
- Montagem `app.ts:337`, só `requireAuth`; organização/conta/pessoa sempre da sessão (`actorOf`).
- Report: `requireOwned` filtra `organization_id` + `owner_account_id = sessão` (outro dono = 404) em detalhe, edição, status,
  execução manual e exclusão. Lista: só os do dono. Proposta do chat: `proposals.get(org, accountId, id)`.
- `validateConfig`: SELF exige contexto de liderança (`loadLeadershipSession`); DISTRIBUTION exige `reports.distribute`
  (`visibilityOf` — MY_STRUCTURE não conta) e confere Grupos/Subgrupos/pessoas contra o escopo da atribuição; estrutura FIXA
  precisa estar no escopo de liderança ATUAL de quem cria (`resolveFixed` → `resolveSubject`).
- Worker (`report-executor.ts`): a cada execução relê o report, a conta do dono (ativa), o papel Report do dono (revogado =
  BLOCKED), a estrutura fixa no escopo do dono, os destinatários ATUAIS (`resolveRecipients` filtrado pelo escopo de distribuição
  atual) e o contexto de CADA destinatário (`contextFor` → `loadViewerScope`); a ferramenta roda no escopo do destinatário e a
  entrega é compartilhada só por quem tem a MESMA chave (sujeito + membros). Escopo recalculado no momento da entrega: ok.
- Entregas: lista/detalhe/lida/retentativa só pelo vínculo `report_delivery_recipients.recipient_person_id = sessão` (+
  organização). O dono de um report distribuído não vê o conteúdo entregue a outros (só o resumo da execução, com nomes dos
  destinatários negados — gente do escopo de distribuição dele).
- Resultado: sem IDOR. Observações: SCOPE-05 (entrega antiga continua legível após perda de escopo — informativa) e custo de IA
  sem teto na retentativa da análise (fora do tema; anotado em SCOPE-04).

### leadership-analytics (`/api/v1/leadership` e ferramentas do chat) — NOVO
- Montagem `app.ts:335`, só `requireAuth`; sessão = `loadLeadershipSession` → `loadViewerScope(user, 'indicators.view')`
  (subárvore `reports_to` ∪ escopo de acesso); sem estrutura e sem `indicators.view` = 403.
- `subjectKind/subjectId` da query (e `estrutura` por nome no chat) passam por `resolveStructureReference` →
  `resolveSubject(scope, …)`; nome fora do escopo = "não encontrei" (não revela). Membros = só operadores do conjunto visível.
  `/tools/:name` só aceita as 7 ferramentas somente leitura; corpo não pode trazer `subject_kind/subject_id`.
- Builders carregam dados por `memberIds` da estrutura resolvida; cache oficial (`cachedOfficial`) chaveado por viewer, conta,
  nível, escopo de acesso, versões STRUCTURE/OFFICIAL e sujeito — sem vazamento entre usuários.
- Cartões gravados em conversa são revalidados contra o escopo atual ao reabrir (`visibleCards`).
- Resultado: ok.

### performance-analytics (`/api/v1/analytics`)
- Montagem `app.ts:333`, `requireAuth`. Todas as rotas: `loadViewerScope(user, 'indicators.view')` + builder que chama
  `resolveSubject` antes de qualquer leitura (`build-employee-dashboard`, `build-structure-dashboard` (+breakdown),
  `build-indicator-members`, `build-team-overview` (+members), `build-follow-up-feed`, `build-analytics-context`). EMPLOYEE só
  o próprio viewer ou operador ativo do conjunto visível; âncora de estrutura precisa estar no conjunto; Grupo/Subgrupo = só o
  recorte visível (vazio = 403). Fora = 403 `STRUCTURE_ACCESS_DENIED` (não 404 — mas não distingue inexistente de fora).
- 9305707f (Administrador geral sem estrutura): só o frontend passou a consultar com sujeito explícito; o backend continua
  exigindo `indicators.view` cobrindo o colaborador. 403c185a: sem sujeito, a lista de COMPETÊNCIAS do seletor vem de
  `visibleOperators(scope)` (conjunto visível do próprio viewer) — expõe só meses com dado, nada por pessoa. Não abriram acesso.
- Grafo de pessoas em cache invalidado pela versão STRUCTURE (triggers da migration 128 em people/teams/subteams); o escopo de
  ACESSO é relido a cada request (`loadAccessVisibility`). Cache oficial chaveado por viewer + escopo. Resultado: ok.

### org-structure (pessoa `/api/v1/people/:personId/organization-structure`; admin `/api/v1/admin/org-structure`)
- Pessoa: qualquer pessoa ATIVA da organização é focável (decisão de produto 2026-09-17, documentada no código e em R-17);
  devolve nome, cargo, Grupo/Subgrupo, e-mail corporativo e foto de focal, cadeia acima e subordinados diretos. Ficha
  (`canOpenEmployeeProfile`) e métricas gerenciais (`canViewManagementMetrics`: qualquer nível hierárquico vê de QUALQUER líder;
  fora da cadeia só com `structure.metrics.view` no escopo do líder) seguem a decisão documentada — ver SCOPE-06 (informativa).
- Admin: `can('configuration.manage')`; lista de Grupos/Subgrupos (catálogo); criar Subgrupo exige o Grupo no escopo; assuntos
  só com escopo de organização. Sem dado de pessoa. Resultado: ok.

### people (`/api/v1/team-calendar`, `/api/v1/admin/operational-calendar`)
- Calendário da equipe: `loadViewerScope(user, 'calendar.manage')`; âncora = viewer ou nó ativo visível; linhas =
  `directOperatorsOf(anchor)` dentro do conjunto. Provisionar/classificar/histórico: `assertCanManage` (operador abaixo do
  viewer na própria subárvore OU pessoa ativa coberta pelo escopo de `calendar.manage`). Auditoria e cancelamento de exceção
  por id: dono resolvido por `id + organization_id`, mesma checagem, 404 fora (SEC-31 mantido).
- Calendário operacional: catálogo da organização (`configuration.manage` + `writesRequireOrganization`), sem dado de pessoa.
- Resultado: ok.

### reporting (`/api/v1/operator`, `/api/v1/supervisor`)
- Operador: sempre `request.user.personId` (só PUBLICADOS). Supervisor `/operators/:id`: `canOpenEmployeeProfile(scope, id)`
  antes de qualquer leitura (403 fora). Resultado: ok.

### supervision-cases, feedbacks (publicar)
- `loadCaseVisibility` (conjunto visível de `indicators.view` ∪ escopo de `agents.manage`), lista filtrada no SQL, detalhe por
  `ownership(org, id)` + `caseVisibleTo`, 404 fora. Publicar: mesmo `caseVisibleTo` e nunca o próprio colaborador. Inalterado
  desde SEC-01/SEC-16. Resultado: ok.

### pending-actions, notifications
- Viewer sempre da sessão; revisão humana e reconciliação carregadas por `recipient_id/recipient_person_id = viewer` + org;
  decidir reaproveita `submitHumanReviewDecision` só depois desse filtro. Sino: `recipient_id = viewer` em lista, contagem,
  lida e lida-todas. Resultado: ok (ver SCOPE-03: destinatário congelado).

### diagnostics (`/api/v1/diagnostics`)
- `authorize`: `loadViewerScope(indicators.view)` + `canViewDiagnostics` (lidera alguém ativo ou tem `indicators.view`). Toda
  consulta da memória do motor (resumo, filtros, processos, pessoas, concentração, materiais, indicadores, avaliações, detalhes,
  CSV) recebe `personIds = scope.nodes` e filtra `person_id = any(...)` + organização; detalhe por id fora = 404.
  `/performance`: escalonamentos só dos operadores visíveis. `/` (`diagnostic_insights`): agregados da organização sem pessoa
  (decisão declarada). Período ≤ 366 dias. Resultado: ok.

### feedback-application, read-confirmations, feedback-rating, conversational-delivery (`inia-deliveries`)
- Escopo sempre `{organizationId, personId}` da sessão; toda leitura/escrita filtra `operator_id`/`collaborator_id`/
  `recipient_person_id`/`recipient_id`/`owner_person_id = sessão` (aplicação, convite, eventos, pausa, áudio, ciência com senha,
  avaliação "foi útil?", recado do avatar, conversa de Workflow vista). Fonte de outra pessoa = 404. Caches `inFlight` de áudio
  chaveados pelo id já autorizado. Resultado: ok.

### interaction-feedback (`/api/v1/feedback-quality-reviews`, `/api/v1/feedback-deliveries`) — só com o pipeline ligado
- Entregas: `/mine` da sessão. QA: `loadInScope(viewer, reviewId, permissão)` filtra pelas atribuições `feedback_quality_review.*`
  (MY_STRUCTURE pela subárvore) e exclui o próprio colaborador (`collaborator_id <> viewer`). Resultado: ok.

### realtime (`/api/v1/realtime`: conversas, histórico, tool-call, voz)
- `scopeOf` = organização + `ownerPersonId` da sessão. Escrita: `resolveConversationForWrite` só aceita conversa do próprio dono
  (404); leitura de mensagens: `requireOwned`; cartões de dados revalidados contra o escopo ATUAL (`visibleLeadershipCards`);
  ofertas de report só do próprio `accountId`. Tool-call: "meus resultados" sempre a pessoa da sessão; ferramentas da liderança
  no `loadLeadershipSession` da sessão; especialista com `operatorId` da sessão; sessão de feedback por
  `resolveApplicationConversation` (aplicação do próprio destinatário). Resultado: ok (ver SCOPE-05 sobre texto antigo).

### assistant/conversation-monitoring (`/api/v1/admin/assistant-conversations`)
- `can('assistant_conversations.view')` + filtro SQL único (`SCOPE_CTE`/`OWNER_VISIBLE`) pelo Grupo/Subgrupo ATUAL do DONO da
  conversa ou subárvore (MY_STRUCTURE). Lista, contagem, opções, detalhe e mensagens com o mesmo filtro; 404 fora.
- ACHADO: as mensagens devolvem os cartões de dados da liderança e o texto das respostas sem nenhuma revalidação contra o escopo
  do LEITOR — ver SCOPE-01.

### usage-analytics (`/api/v1/admin/usability`, `/api/v1/usage`) — flags desligadas no POC
- Sem mudança desde a auditoria (SEC-21: listas identificadas só quando `usability.users.view` cobre o recorte de
  `usability.view`; detalhe com o escopo certo). Revisão resumida; resultado: ok.

### workflows/workflow-results-router.ts (`/api/v1/admin/workflows/:id/results…`)
- Atrás de `can('workflows.manage')`; Workflow por `id + organization_id` e `canManageScope` (404 fora); pessoas filtradas no
  SQL por `team_id/subteam_id` do escopo (`workflow-results-reader.ts`). Resultado: ok.

### ai-management — ranking "Quem mais usa" (5cb9c104)
- `can('AI_USAGE_RANKING_READ')` (= `ai.usage_ranking.view`, Administrador geral e Administrador); serviço recorta pessoas por
  `scopedPeopleSql` (organização/Grupo/Subgrupo/Minha estrutura, atribuições ativas, lidas no request); filtros só estreitam;
  "Sem vínculo" só para escopo de organização sem recorte. Linha de um líder soma só as pessoas do escopo (o NOME do líder aparece
  mesmo se ele próprio estiver fora do escopo — o organograma já é aberto à organização). Dashboard `/usage` é agregado por
  caso de uso/modelo, sem pessoa. Resultado: ok.

---

## Achados

Resumo: 0 Crítica · 0 Alta · 2 Média · 2 Baixa · 3 Informativa.

### SCOPE-01 — Monitoramento de conversas entrega dados da liderança (cartões e texto) fora do escopo de quem lê
- Gravidade: Média
- Classificação: CONFIRMADA
- Local:
  - `backend/src/modules/assistant/application/conversation-monitoring.ts:30-35` (`OWNER_VISIBLE`: o alcance depende só do
    Grupo/Subgrupo ATUAL do DONO da conversa, ou da subárvore com MY_STRUCTURE) e `:162-167` (`loadMonitoredMessages` devolve
    cada mensagem como está);
  - `backend/src/modules/assistant/application/assistant-conversations.ts:214-227` (`toMessage` → `analytics: analyticsCardsOf(tool_calls)`);
  - gravação dos cartões: `backend/src/modules/realtime/presentation/realtime-router.ts:132, 500, 534` (`toolCalls[].analytics`);
  - contraste: o DONO, ao reabrir, tem os cartões revalidados (`realtime-router.ts:617-641` → `visibleLeadershipCards`;
    `leadership-context.ts:219-235`), o leitor do monitoramento não.
- Evidência: desde f9e134c1/bb1ae01e (10-15/16) quem lidera conversa com a INIA sobre a estrutura: as respostas trazem tabelas
  em markdown com nomes, PRV, quartil, atingimento por pessoa, situação funcional (férias, afastamento — os sensíveis sem nome),
  diagnóstico por motivo/submotivo, e os cartões (`QUERY_TABLE`, `PEOPLE`, `STRUCTURE_OVERVIEW`…) ficam em
  `assistant_interactions.tool_calls`. `GET /api/v1/admin/assistant-conversations/:id/messages` autoriza a CONVERSA pelo cadastro
  do dono (`owner.team_id/subteam_id` ∈ escopo de `assistant_conversations.view`) e devolve `content` + `analytics` sem comparar
  o conteúdo com o escopo do leitor. A estrutura de um Coordenador/Gerente/Gerente Sênior não cabe, em geral, no Grupo/Subgrupo
  do cadastro dele. A tela (`frontend/src/components/admin/assistant-conversations/conversation-thread.tsx`) mostra os cartões
  ("recolhidos e só de leitura", `docs/dev/memoria/liderancas.md:35`). O papel `LEITOR_DE_CONVERSAS_INIA` só tem
  `assistant_conversations.view` (sem `indicators.view`) e é delegável por Administrador de acessos de Grupo/Subgrupo.
- Cenário de exploração: conta com `LEITOR_DE_CONVERSAS_INIA` no Grupo A (ou Subgrupo A1). Uma Gerente cujo cadastro está no
  Grupo A lidera equipes nos Grupos A e B e pergunta "quem são os piores em TMA?" / "quantas pessoas estão de férias?". O leitor
  abre a conversa e lê nomes, resultados e situação funcional de operadores do Grupo B — fora do escopo dele e sem a permissão
  de Indicadores. Mesmo efeito para conversas de origem WORKFLOW endereçadas a líderes. (Com escopo de ORGANIZAÇÃO não há
  "fora do escopo", mas continua sendo dado de Indicadores para quem não tem `indicators.view` — decisão de produto a confirmar.)
- Correção sugerida: em `conversation-monitoring.ts`, (1) conversa de quem LIDERA alguém só entra no `OWNER_VISIBLE` quando o
  escopo do leitor cobre a estrutura inteira do dono: ORGANIZAÇÃO, ou MY_STRUCTURE com o dono na subárvore do leitor (a
  estrutura do dono fica contida), ou GROUP/SUBGROUP que contenha todos os subordinados ativos do dono (CTE de subordinados do
  dono com `not exists` fora do escopo); (2) em `loadMonitoredMessages`, revalidar os cartões contra um `ViewerScope` montado
  com o alcance do leitor (reaproveitar `visibleCards` com `loadViewerScope(..., permissão do monitoramento)` — exige incluir
  `assistant_conversations.view` em `ScopePermission`) e, sem cobertura, ocultar também o `content` das respostas de ferramenta
  da liderança. Decidir com o produto se `assistant_conversations.view` deve exigir `indicators.view` para ver conversas de
  liderança.
- Teste de regressão sugerido: leitor com escopo GROUP A + líder com cadastro em A e subordinados em B → a conversa não aparece
  (ou aparece sem cartões/texto de dados); leitor ORGANIZAÇÃO e leitor MY_STRUCTURE acima do líder continuam vendo; conversa de
  operador do Grupo A continua visível ao leitor de A (com o cartão "meus resultados" do próprio dono).

### SCOPE-02 — Simulação/avaliações de política e o caso de supervisão revelam intervenções de quem não pode vê-las
- Gravidade: Média
- Classificação: CONFIRMADA
- Local:
  - `backend/src/modules/interventions/presentation/intervention-admin-router.ts:72-81` (`canSimulateWith`: basta
    `workflows.manage` no colaborador OU o colaborador no `loadViewerScope('indicators.view')`), `:242-288` (`POST
    /policies/:policyId/simulate` devolve `serializeEvaluation(evaluation)` com `rules` e o `report` com `priorInterventions`),
    `:295-334` (`/policies/:id/evaluations`, `/evaluations/:id` = `select *`, `/evaluations/:id/reevaluate`);
  - `backend/src/modules/interventions/application/condition-resolvers.ts:123-162` (condições `PRIOR_INTERVENTIONS` e
    `TIME_SINCE_INTERVENTION` põem em `facts` id, tipo, status, datas e resultado operacional de cada intervenção);
  - `backend/src/modules/interventions/application/evaluate-policy.ts:175-193` (`priorInterventions`: tipo, status, abertura,
    conclusão, resultados — 180 dias);
  - caso: `intervention-service.ts:733-737` (caso manual com título `Acompanhamento: <tipo>` e `summary` = justificativa
    digitada pelo líder) e `apply-evaluation.ts:94-98` + `domain/intelligence-report.ts:227-233` (resumo "Ações: <tipo>
    (<status>)"), lidos por `GET /api/v1/supervision-cases[/:id]` com a visibilidade de casos (`indicators.view`/`agents.manage`).
- Evidência: o módulo de intervenções separa de propósito "ver colaborador" de "ver intervenções": `relationFor`/
  `canViewIntervention` exigem cadeia de gestão ou `interventions.*` no escopo (404 fora; a memória registra "Quem vê o caso por
  outra permissão mas não as intervenções recebe 'Intervenções não disponíveis para o seu acesso'"), e o papel ADMINISTRADOR tem
  `intervention_policies.*` + `workflows.manage` + `indicators.view`, mas NÃO `interventions.view` (`access/domain/roles.ts:31`).
  A simulação usa outra régua (só "enxergar" a pessoa) e devolve o histórico de intervenções nos fatos e no relatório. Com
  `intervention_policies.edit`, o próprio usuário monta um RASCUNHO com a condição `PRIOR_INTERVENTIONS` (tipo "avaliação de
  continuidade", qualquer status, janela longa) e simula `version: "DRAFT"` — `rules` volta sempre, com `facts.interventions`.
- Cenário de exploração: Administrador com escopo do Grupo A (sem `interventions.view`) simula, para cada operador do Grupo A,
  um rascunho que só consulta intervenções anteriores e obtém quem teve "Solicitar avaliação de continuidade", em que status e
  quando — informação de RH sensível que o módulo lhe nega (`GET /api/v1/interventions/:id` = 404). O mesmo vale para
  `workflows.manage` sozinho (simula a versão em vigor) e para a leitura do caso (tipo e justificativa no título/resumo).
  Na reavaliação (`intervention_policies.audit`), o resultado novo ainda é gravado como evento nas intervenções relacionadas —
  escrita sobre intervenções que quem pede não pode abrir.
- Correção sugerida: na simulação, avaliações e reavaliação, quando o viewer não tem `canSeeInterventionsOf(access, personId)`
  (`intervention-access.ts:47`), remover do retorno `priorInterventions`, as `references`/`facts` de condições
  `PRIOR_INTERVENTIONS`/`TIME_SINCE_INTERVENTION` (manter só MET/NOT_MET) e as decisões `EXISTING` com id; em `/evaluations/:id`,
  devolver a projeção redigida em vez de `select *`. No caso, gerar título/resumo neutros ("Acompanhamento de <indicador>") e
  deixar tipo e justificativa só na intervenção.
- Teste de regressão sugerido: Administrador de Grupo (sem `interventions.view`) simula rascunho com `PRIOR_INTERVENTIONS` para
  colaborador com avaliação de continuidade → resposta sem ids/tipos/status das intervenções; Administrador geral (com
  `interventions.view`) e o líder da cadeia continuam vendo; caso aberto por intervenção manual não traz o tipo nem a
  justificativa para quem só vê o caso.

### SCOPE-03 — Relação congelada: responsável, aprovador e destinatário guardados no registro continuam valendo depois da perda do papel ou da relação
- Gravidade: Baixa
- Classificação: CONFIRMADA (caminho lido; impacto depende de mudança de estrutura/papel)
- Local:
  - `backend/src/modules/interventions/application/intervention-access.ts:25-27` (`isResponsible`, `isApprover` a partir de
    `responsible_id`, `approver_id`, `approval_recipient_ids` gravados);
  - `backend/src/modules/interventions/domain/intervention-state.ts:99-127` (`canViewIntervention` aceita `isResponsible`/
    `isApprover`; `authorizeCommand`: executor = `isResponsible || can.execute`; APPROVE/RETURN = `isApprover || can.approve`);
  - `intervention-service.ts:369-377` (pendência por `approval_recipient_ids`); únicos que mudam o responsável: `forward`
    (`intervention-service.ts:540`, `forwardIntervention`) — nenhuma reatribuição quando a estrutura muda;
  - revisão humana de Workflow: `pending-actions-repository.ts:165-174` + `build-pending-actions.ts:236-257` (só
    `recipient_id = viewer`, sem conferir a relação atual com o colaborador).
- Evidência: o colaborador muda de líder (ou de Grupo) ou o avaliador de continuidade tem o papel revogado; a linha da
  intervenção continua com o id antigo. O ex-líder segue como responsável: vê o detalhe (evidências, relatório, plano, eventos),
  executa (aceitar, concluir, encaminhar, editar plano, juntar evidência, pedir rascunho à IA). O ex-avaliador (papel revogado)
  continua vendo a solicitação de avaliação de continuidade na lista de pendências e no detalhe (não decide: `DECIDE_CONTINUITY`
  exige `interventions.sensitive_decide` vivo — correto). Aprovador designado de tipo não sensível aprova sem relação atual.
- Cenário de exploração: Supervisor S1 abre plano de ação para o operador O; O é transferido para a equipe de S2. S1 continua
  lendo o caso/relatório de O e pode concluir ou encaminhar a intervenção. Avaliador de continuidade desligado do papel segue
  lendo os pedidos que já estavam endereçados a ele.
- Correção sugerida: em `relationFor`, só considerar `isResponsible`/`isApprover` quando a relação ainda existe
  (`leadsSubject` ou alguma `interventions.*` no escopo do colaborador) e, para `approval_recipient_ids` de tipo sensível, exigir
  `can.sensitiveDecide` também para ver; job/trigger que, ao mudar `reports_to_id`/Grupo do colaborador, recalcula o responsável
  das intervenções ativas pela mesma `resolveResponsibleId` (com evento). Na revisão humana, conferir que o revisor ainda alcança
  o colaborador (cadeia ou `workflows.manage` no escopo) antes de mostrar/decidir.
- Teste de regressão sugerido: mudar o `reports_to_id` do colaborador → o ex-responsável recebe 404 no detalhe e nos comandos, o
  novo líder vê; revogar `AVALIADOR_DE_CONTINUIDADE` → a pendência some e o detalhe dá 404; responsável que continua na cadeia
  segue funcionando.

### SCOPE-04 — "Tentar de novo" da análise de IA da entrega de report sem teto por conta
- Gravidade: Baixa
- Classificação: PREVENTIVA
- Local: `backend/src/modules/reports/presentation/reports-router.ts:55`; `backend/src/modules/reports/application/report-service.ts:235-242`;
  montagem `backend/src/main/app.ts:337` (`/api/v1/reports` só com `requireAuth`, sem `aiPerAccount`/`costly`).
- Evidência: qualquer destinatário de uma entrega com `analysisStatus = FAILED` chama `analyzeDelivery` (IA) a cada POST; se a
  análise volta a falhar, o estado fica FAILED e a chamada pode ser repetida em laço. A autorização do objeto está correta (só
  destinatário); falta o limite de custo que as outras ações com IA têm.
- Cenário de exploração: destinatário (ou script com a sessão dele) repete o POST enquanto o provedor falha/está lento,
  ocupando vagas do limitador de IA da conexão e gerando custo.
- Correção sugerida: montar o teto por conta em `app.ts` (`app.use("/api/v1/reports", requireAuth, onlyMethods(["POST"],
  …aiPerAccount para /analysis/retry))`) ou travar no serviço (uma retentativa por entrega a cada N minutos, com `analysis_attempts`).
- Teste de regressão sugerido: N+1 retentativas em 1 minuto → 429; a primeira retentativa continua aceita.

### SCOPE-05 — Conteúdo já entregue continua legível depois que o escopo acaba (entregas de report e texto de conversa)
- Gravidade: Informativa
- Classificação: PREVENTIVA
- Local: `backend/src/modules/reports/application/report-deliveries-reader.ts:9-39` (vínculo de destinatário, sem escopo atual);
  `backend/src/modules/realtime/presentation/realtime-router.ts:617-641` (o cartão é revalidado, o `content` não);
  feed do líder `analytics-read-repository.ts:472-475` (entregas no Acompanhamento).
- Evidência: decisão aparente de "fotografia entregue" (como e-mail). O destinatário que perde o escopo (mudou de Grupo, perdeu
  `indicators.view`) continua lendo as entregas antigas (dataset com nomes e resultados) e o texto das respostas antigas da INIA.
  O worker NÃO usa escopo congelado para entregas novas (recalcula a cada execução — ok).
- Cenário de exploração: líder transferido continua abrindo o histórico de reports da estrutura antiga.
- Correção sugerida: decidir com o produto; se não for desejado, filtrar `listReceivedDeliveries/loadDeliveryDetail` pela
  revalidação de `scope_key` (estrutura da entrega ainda em `resolveFixed`/`ownStructure` da pessoa) e ocultar o texto das
  respostas de ferramentas de liderança quando o cartão correspondente deixa de ser visível.
- Teste de regressão sugerido: (se adotado) destinatário fora da estrutura → entrega antiga 404; dentro → 200.

### SCOPE-06 — Organograma aberto e métricas gerenciais de qualquer líder (decisão documentada) + leituras sem filtro de organização
- Gravidade: Informativa
- Classificação: PREVENTIVA (decisão de produto 2026-09-17 / R-17; ponto latente para 2ª organização)
- Local: `backend/src/modules/org-structure/application/person-organization-structure.ts:269-328`
  (`buildPersonOrganizationStructure`: qualquer pessoa ATIVA da organização é focável; e-mail corporativo, cargo, Grupo/Subgrupo,
  capital, foto da focal, da cadeia e dos subordinados diretos); `performance-analytics/application/viewer-scope.ts:147-150`
  (`canViewManagementMetrics`: todo nível hierárquico vê as métricas — população, situação funcional atual, span — de QUALQUER
  líder); `org-structure/presentation/person-organization-structure-router.ts:15-19` (`loadCorporateEmails` sem
  `organization_id`).
- Evidência: um Operador navega toda a organização e lê e-mail e cargo de todos; um Supervisor lê a situação funcional agregada
  (ex.: quantos afastados/de férias) da estrutura de qualquer Gerente de outra área. Está escrito como decisão no código e em R-17
  ("revisar a decisão sobre as métricas de qualquer líder para todo nível de liderança") — não é falha de implementação.
  `loadCorporateEmails`/`loadAncestors` recebem ids já filtrados pela organização, mas não filtram eles mesmos.
- Cenário de exploração: coleta de diretório (nome + e-mail corporativo + cargo) por qualquer conta; para engenharia social.
- Correção sugerida: reavaliar R-17 com o produto (ex.: métricas gerenciais só da própria cadeia ou com `structure.metrics.view`;
  e-mail só para quem tem relação); acrescentar `and organization_id = $2` em `loadCorporateEmails` e na CTE de
  `postgresHierarchyReader.loadAncestors` (defesa em profundidade para R-01).
- Teste de regressão sugerido: (se a decisão mudar) Supervisor de outra área recebe `managementMetrics: null` para o Gerente de
  outra cadeia; e-mails de pessoa de outra organização nunca entram no payload.

### SCOPE-07 — Editor de políticas lista títulos de documentos de todos os Grupos; plano de treinamento aceita documento de outro Grupo
- Gravidade: Informativa
- Classificação: CONFIRMADA (sem dado de pessoa; fora do tema central)
- Local: `backend/src/modules/interventions/application/config-service.ts:185-203` (`loadEditorCatalog`: `knowledge_documents` da
  organização inteira, sem o escopo de Grupo da base — SEC-03); `intervention-service.ts` `updateInterventionPlan`
  (`plan.contents` só exige documento publicado da organização).
- Evidência: Administrador/Gestor de políticas de um Subgrupo (ou só `workflows.manage`) vê o título de todas as bases de
  conhecimento; o executor de uma intervenção pode anexar ao plano qualquer documento publicado por id. O conteúdo continua
  protegido pelo leitor de materiais (`knowledge-materials`), só o título vaza.
- Correção sugerida: filtrar os documentos do catálogo e do plano pelo alcance da base (`canManageScope` do editor; para o plano,
  base global ou do Grupo do colaborador), como já faz `resolveAccessibleKnowledgeMaterials`.
- Teste de regressão sugerido: editor de Subgrupo A não recebe documento exclusivo do Grupo B; plano com documento do Grupo B
  para colaborador do Grupo A → 422.

---

## Cobertura

Legenda de autenticação: RA = `requireAuth` (sessão no banco); `can(p)` = `requirePermission(p)` (permissão em algum escopo);
`can(p, org)` = escopo de organização. "403 uniforme" = fora do escopo e inexistente recebem a mesma resposta (não revela
existência, embora não seja 404).

| Módulo / arquivo de rota | Rotas (método + caminho) | Autenticação | Autorização do OBJETO | Resultado |
|---|---|---|---|---|
| interventions `intervention-router.ts` (`/api/v1/interventions`) | GET /pending, GET /competencies, GET /cases/:caseId, GET /people/:personId, POST /, GET /reports/:reportId, POST /reports/:reportId/narrative, GET /:id, GET /:id/forward-targets, POST /:id/{accept,approve,return,decide,complete,cancel,forward}, PUT /:id/plan, POST /:id/competency, POST /:id/items, PATCH /:id/items/:itemId, POST /:id/evidence, POST /:id/ai-draft, POST /:id/ai-draft/apply | RA (+`costly` em narrative/ai-draft) | linha por id+org; `relationFor` (responsável/aprovador/cadeia/`interventions.*` com `canOnCollaborator`); 404 fora; comandos por `authorizeCommand` + trava otimista; refs de evidência/dono/encaminhamento conferidos contra o colaborador | ok; SCOPE-03 (relação congelada) |
| interventions `intervention-admin-router.ts` (`/api/v1/admin/intervention-policies`) | GET /capabilities, GET /editor-catalog, GET /editor-catalog/patterns, GET/POST /types, GET /types/:id, PUT/DELETE /types/:id/draft, POST /types/:id/{validate,publish,active}, GET/POST /competencies, PUT /competencies/:id, POST /competencies/:id/active, GET/POST /policies, GET /published-summary, GET/PATCH /policies/:id, PUT/DELETE /policies/:id/draft, POST /policies/:id/{validate,publish,active,simulate}, GET /simulation-people, GET /audit, GET /policies/:id/evaluations, GET /evaluations/:id, POST /evaluations/:id/reevaluate | RA + guard do router (permissão de política ou `workflows.manage`) | catálogo: escrita com escopo de organização; política: `seesPolicy`/`coversPolicy`; pessoa: `canSimulateWith` (404) | SCOPE-02 (histórico de intervenções na simulação/avaliações), SCOPE-07 (títulos de documentos) |
| reports `reports-router.ts` (`/api/v1/reports`) | GET /, GET /access, GET /options, GET /audience/people, POST /preview, GET /proposals/:id, GET /received, GET /deliveries/:id, POST /deliveries/:id/read, POST /deliveries/:id/analysis/retry, POST /, GET/PUT/DELETE /:reportId, POST /:reportId/{status,run} | RA | dono = conta da sessão (404); público e estrutura fixa validados contra o escopo ATUAL; entregas só pelo vínculo de destinatário; worker recalcula dono/papel/destinatários/escopo a cada execução | ok; SCOPE-04 (custo), SCOPE-05 (informativa) |
| reports worker (`report-executor.ts`, `report-scheduler.ts`) | execução agendada/manual | — (processo) | conta do dono ativa, `reports.distribute` vivo, estrutura fixa no escopo do dono, `contextFor` de cada destinatário; entrega compartilhada só por chave sujeito+membros | ok |
| leadership-analytics `leadership-router.ts` (`/api/v1/leadership`) | GET /home, GET /overview, GET /indicator-analysis, GET /people, POST /query, POST /tools/:name, GET /priorities | RA | `loadLeadershipSession` → `loadViewerScope(indicators.view)`; sujeito da query por `resolveStructureReference`→`resolveSubject` (403 uniforme); corpo sem `subject_*` | ok |
| leadership — ferramentas do chat/voz (`leadership-toolset.ts`, `process-consultation.ts`, `self-context.ts`) | via `/realtime/messages` e `/realtime/tool-call` | RA | escopo da sessão; nome de estrutura só entre candidatos visíveis; "meus resultados" = `scope.viewer` | ok |
| performance-analytics `analytics-router.ts` (`/api/v1/analytics`) | GET /context, /indicators, /indicators/breakdown, /indicators/:code/members, /team, /team/members, /follow-ups | RA | `loadViewerScope` + `resolveSubject` em todo builder (403 uniforme); caches chaveados por viewer/escopo | ok (403c185a/9305707f não ampliam acesso) |
| org-structure `person-organization-structure-router.ts` (`/api/v1/people`) | GET /:personId/organization-structure | RA | focal: qualquer pessoa ativa da organização (decisão); ficha/métricas por `canOpenEmployeeProfile`/`canViewManagementMetrics` | SCOPE-06 (informativa) |
| org-structure `org-structure-router.ts` (`/api/v1/admin/org-structure`) | GET /teams, GET /teams/manageable, POST /teams/:teamId/subteams, GET/POST /subjects | `can(configuration.manage)` | Grupo da organização e no escopo; assuntos com escopo de organização | ok |
| people `team-calendar-router.ts` (`/api/v1/team-calendar`) | GET /, POST /exceptions, DELETE /exceptions/:id, POST /classifications, GET /classifications/:personId/:date, GET /exceptions/:id/audit | RA | `loadViewerScope(calendar.manage)`; âncora visível; `assertCanManage`; exceção por id+org, 404 fora | ok |
| people `operational-calendar-router.ts` (`/api/v1/admin/operational-calendar`) | GET /capitals, GET/PATCH /settings, GET /catalog/coverage, GET /catalog, GET/POST /holidays, PATCH/DELETE /holidays/:id | `can(configuration.manage)` + `writesRequireOrganization` | catálogo da organização (sem pessoa) | ok |
| reporting `operator-router.ts` (`/api/v1/operator`) | GET /overview, GET /feedbacks | RA | sempre a pessoa da sessão; só PUBLICADOS | ok |
| reporting `supervisor-router.ts` (`/api/v1/supervisor`) | GET /operators/:id | RA | `canOpenEmployeeProfile(loadViewerScope)` antes de ler | ok |
| supervision-cases `case-router.ts` | GET /, GET /:id | RA | `loadCaseVisibility` (SQL na lista; `ownership`+`caseVisibleTo` no detalhe; 404) | ok (título/resumo de casos de intervenção: ver SCOPE-02) |
| feedbacks `feedback-router.ts` | POST /:id/publish | RA | `caseVisibleTo` + nunca o próprio colaborador; 404 | ok |
| pending-actions `pending-actions-router.ts` | GET /, GET /human-reviews/:enrollmentId/:nodeId, POST …/decision, GET /workday-reconciliations/:id, POST …/resolve | RA | `recipient_id`/`recipient_person_id` = sessão + org (404) | ok; SCOPE-03 (destinatário congelado) |
| notifications `notifications-router.ts` | GET /, POST /read-all, POST /:id/read | RA | `recipient_id` = sessão + org | ok |
| diagnostics `diagnostics-router.ts` | GET /, /performance, /memory/{summary,filter-options,processes,people,concentration,materials,indicators,indicators/:id,assessments,assessments/:id,export.csv} | RA | `authorize` (`loadViewerScope` + `canViewDiagnostics`); `person_id = any(visíveis)` + org; detalhe 404 | ok |
| feedback-application `feedback-applications-router.ts` | GET /, GET /invite, POST /invite/events, POST /, GET /:id, POST /:id/{opened,presentation-events,pause}, GET /:id/audio | RA (+teto de IA) | `recipient_person_id`/`operator_id`/`collaborator_id` = sessão (404) | ok |
| feedback-application `feedback-read-confirmations-router.ts` | POST /events, POST / | RA (+teto de falhas) | fonte do próprio destinatário (404); credencial da própria conta | ok |
| feedback-rating `feedback-ratings-router.ts` | GET /, POST / | RA | feedback/entrega do próprio destinatário (404) | ok |
| conversational-delivery `inia-deliveries-router.ts` | GET /inbox, POST /avatar/:id/events, GET /avatar/:id/audio, POST /conversations/:id/seen | RA (+teto no áudio) | `recipient_id`/`owner_person_id` = sessão | ok |
| interaction-feedback `feedback-review-router.ts` (flag) | GET /access, GET /, GET /:reviewId, POST /:reviewId/edit-check, POST /:reviewId/decision | RA | `loadInScope` pelas atribuições `feedback_quality_review.*`, exclui o próprio colaborador | ok |
| interaction-feedback `feedback-delivery-router.ts` (flag) | GET /mine | RA | sessão | ok |
| realtime `realtime-router.ts` | POST /sessions, POST /tool-call, GET /conversations/current, GET /conversations, POST /conversations/new, GET /conversations/:id/messages, POST /voice-turn, POST /messages | RA (+tetos de IA/voz) | conversa do próprio dono (`findOwned`, 404); aplicação de feedback do próprio destinatário; cartões revalidados; ofertas do próprio `accountId` | ok; SCOPE-05 (texto antigo) |
| assistant `conversation-monitoring-router.ts` (`/api/v1/admin/assistant-conversations`) | GET /, GET /:id, GET /:id/messages | `can(assistant_conversations.view)` | filtro SQL pelo Grupo/Subgrupo/subárvore do DONO; 404 fora | **SCOPE-01** |
| usage-analytics `usability-router.ts` (flag OFF) | GET /context, /overview, /users, /users/options, /users/:personId, /users/:personId/timeline, /screens, /feedbacks, /conversations, /workflows, /journeys, /data-quality, /export.csv, PUT /settings, POST /classifications, DELETE /classifications/:personId, POST /reprocess | `can(usability.view)` | permissões granulares + escopo (SEC-21) | revisão resumida — sem mudança desde a auditoria; ok |
| usage-analytics `usage-events-router.ts` (flag OFF) | POST /events/batch | RA | eventos da própria sessão | revisão resumida; ok |
| workflows `workflow-results-router.ts` | GET /:id/results/summary, GET /:id/results, GET /:id/results/:rootEnrollmentId | `can(workflows.manage)` | Workflow por id+org e `canManageScope` (404); pessoas filtradas por escopo no SQL | ok |
| ai-management `ai-management-router.ts` (ranking) | GET /usage/ranking/context, GET /usage/ranking (+ GET /usage, /health agregados) | RA + `can(AI_USAGE_RANKING_READ / AI_USAGE_READ)` | `scopedPeopleSql` da permissão `ai.usage_ranking.view`; filtros só estreitam | ok |
| profile-preferences (`/api/v1/me/profile`, `/api/v1/profile-images`) — extra | GET/PUT /me/profile, GET /profile-images/:id | RA | própria pessoa; imagem por id dentro da organização (coerente com o organograma aberto) | ok (verificação rápida) |

Não revisados nesta área (cobertos por outros auditores ou fora do tema "dados de pessoas"): `/admin/users`, `/admin/access`,
`/admin/employee-performance` (SEC-18), Central de Dados, QA Lab, Agents/Orquestradores/Base de conhecimento/knowledge-materials,
editor de Workflow (exceto Resultados), governança, cenas da INIA.
