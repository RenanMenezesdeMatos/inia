# Banco interno — consultas do caminho quente, índices e pool

Origem: correção das consultas do caminho quente apontadas pela auditoria de escalabilidade de 13/10/2026 (meta: 600 usuários
simultâneos, 4.000 cadastrados). O relatório completo, com o `EXPLAIN (ANALYZE, BUFFERS)` de antes e depois de cada item e as
simulações de escala, está em [../escalabilidade-consultas.md](../escalabilidade-consultas.md). Aqui ficam as regras e decisões que
qualquer sessão precisa respeitar ao mexer em consultas, índices ou no pool.

Documentos relacionados: [workflows.md](workflows.md) (worker e agenda), [experiencia-do-colaborador.md](experiencia-do-colaborador.md)
(Acompanhamento), [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) (cargas).

### Consultas do caminho quente, índices e limites do pool (2026-10-13, migrations 130 e 132–134)

**Regras**

- **Leitura do caminho quente nunca cresce com o histórico da pessoa.**
  - Telas abertas a cada acesso (`/operator`, sino, Acompanhamento) leem com LIMIT pelo índice.
  - Valor atual de indicador = `limit 1` por indicador do catálogo, pelo índice único de `indicator_measurements` (org, indicador, tipo, pessoa, início, fim). Nunca todas as medições da pessoa.
  - Feed = página por cursor (keyset) `(coalesce(published_at, created_at), id)`, com o instante em microssegundos (`feedbacks/domain/follow-up-cursor.ts`), e `limit + 1` para saber se há próxima página. Vale para o feed do colaborador e para o da estrutura. Cursor inválido devolve 400. Nunca `count(*) over()` nem OFFSET em feed.
- **Conteúdo pesado depois do LIMIT.** O JSON de `context_snapshot`, a view e os enriquecimentos (materiais, título legado, motivo) só rodam para os itens da página.
- **Aviso × entrega pelo id, nunca por concatenação.** Use `alertOutputIdSql(alert, prefixo)` (`recado-follow-up-invite.ts`) para `workflow_chat:` e `workflow_avatar:`.
- **Pendente = execução esperando no nó de revisão COM aviso vivo** (`OPEN/SEEN/ACKNOWLEDGED`). Vale igual nas contagens SQL e em `reviewStatus`.
  - A lista e o sino nunca carregam o `node_outputs` inteiro, só `node_outputs -> <nó>`.
  - O Execution Context só vem no detalhe (`ReviewAlertDetailRow`).
  - O sino resolve a situação só dos avisos de revisão que está mostrando.
- **Escrita em lote é set-based.** Matrículas de agenda nascem num insert por disparo (`unnest`), e a idempotência é do índice único `workflow_enrollments_schedule_slot_uk`. Não volte a um insert por operador.
- **Pool com limites por papel** (`infrastructure/database/session-limits.ts`).
  - Valores:
    - servidor `api`: comando 30 s;
    - `worker`/`all`: comando 300 s;
    - transação ociosa: 60 s;
    - espera por conexão: 10 s;
    - `application_name`: `inia-<papel>`.
  - Marca do servidor: o primeiro import de `main/server.ts` é `./server-database-session.js`, que grava `INIA_DATABASE_SESSION=server` antes de o pool nascer. Um teste garante a ordem; nunca mova esse import.
  - Migrations, seeds, scripts (inclusive os congelados) e testes ficam sem limite.
  - Trabalho de lote que pode rodar na API chama `useBatchStatementTimeout(client)` logo depois do `begin`. Hoje são as transações de aplicação da Central de Dados.
  - `run-migrations.ts` zera os limites dentro da transação de cada arquivo.
  - **Nunca segure transação aberta durante chamada de IA, HTTP ou banco externo.** Com transação ociosa de 60 s, o banco encerra a sessão. O levantamento de 13/10 não achou nenhum caso.
  - O pool registra tratador de `'error'` em todo cliente (`pool.on("connect")`). Sem ele, uma conexão emprestada encerrada pelo banco derruba o processo (reproduzido).

**Índices novos**

- 130: `idx_feedbacks_operator_feed (operator_id, coalesce(published_at, created_at) desc, id desc) where status = 'PUBLISHED'`.
- 134: `people (organization_id, reports_to_id)` e `(organization_id, team_id)`, parciais nos não nulos.
  - Nasceu 131 e foi renumerada porque o checkout principal criou `131_interventions.sql` em paralelo. O registro em `schema_migrations` foi renomeado no `inia` e no `inia_test`.
  - O passo recursivo das CTEs de hierarquia continua Hash Join sobre `people`, por escolha do planejador; três variantes foram medidas.
  - Acima de dezenas de milhares de pessoas, ponha `p.organization_id = $org` no passo recursivo e meça de novo.
- 132: `alerts (recipient_id, created_at desc)`, parcial de não lidas e parcial de revisões vivas.
  - **`idx_alerts_open_dedupe` foi removido**: era redundante com `uq_alerts_dedupe_key`, nunca foi árbitro de `on conflict` e tinha `idx_scan = 0`.
- 203 (auditoria de 16/11/2026, rodada 4; nenhuma das tabelas é visão sobre `_all`):
  - `human_support_attendances (request_id, started_at, id)` — atendimentos de um pedido (só havia o parcial dos ativos);
  - `human_support_attendances (organization_id, ended_at) where end_cause = 'ANJO_SILENT'` — ramo do "Anjo sem responder ninguém",
    que virou `union all` em vez de `OR`;
  - `supervision_cases (operator_id) where operating_universe is null` — carimbo do legado no trigger `track_person_operating_universe` (197);
  - removido `human_support_requests_org_created` (191), idêntico a `human_support_requests_created` (182);
  - leitura de mensagens por atendimento sempre com `m.request_id` (usa o único `(request_id, seq)`); última causa de conexão do Anjo
    ordenada por `(occurred_at, id)`, a ordem do índice da pessoa.
- 133: `audit_logs (organization_id, entity_type, entity_id, created_at)` e `audit_logs (actor_id, created_at) where actor_id is not null`.
  - O ator vem na frente, desviando do pedido `(organization_id, actor_id, …)`, porque a mesma busca é a da FK `audit_logs_actor_id_fkey` ao apagar uma pessoa: 50 ms → 0,08 ms com 500 mil linhas.
  - Quem fizer retenção ou particionamento de `audit_logs` deve contar com esses dois índices.

**Contratos que mudaram**

- `/operator/overview` devolve a primeira página (12 itens) mais `feedbacksNextCursor`. O resto vem de `GET /operator/feedbacks?cursor=&limit=`.
- No front, o payload tem schema zod (`schemas/operator/operator-overview.schema.ts`). O mapeamento fica em `services/operator/operator-feed.ts`, e a paginação, em `queries/operator/use-operator-feedback-history.ts`.
- O feed não revela uma entrega mais antiga que o último feedback carregado enquanto houver página por vir (`boundFollowUpTimeline`).
- `/supervisor/operators/:id` não devolve mais `indicators` nem `feedbacks`, que a ficha nunca lia.
- `GET /supervisor/overview` foi removida. Sem uso, sem limite, e abria dados de pessoas pelo nível do JWT (F-2). Não volte com uma visão da operação inteira por request: ela pertence ao read model de analytics.
- `/analytics/follow-ups` pagina por cursor, como `/operator/feedbacks`: recebe `cursor` e `limit` (1–100, padrão 20) e devolve `{ items, nextCursor }`, sem `total`, `page` e `pageSize`. O cursor (instante, id) filtra os feedbacks e os avisos antes da ordenação. No front, o schema é `followUpFeedSchema` (`schemas/analytics/analytics.schema.ts`) e a rolagem, `useFollowUpFeedQuery`.

**Provas** (`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run <nome> --no-file-parallelism`, banco de teste):

- `operator-overview-proof`
- `follow-up-feed-proof`
- `bell-queries-proof`
- `schedule-check-proof` (passa com o código antigo e com o novo)
- `pool-session-proof`
- `follow-up-visibility-proof`

**Pendências e limites conhecidos**

- **Feed da estrutura de quem lidera muita gente.** O keyset tirou o `count(*)` e o OFFSET, mas cada página ainda lê todos os feedbacks publicados da estrutura e escolhe os mais recentes (top-N, memória fixa). São cerca de 5 ms para 30 mil feedbacks de 2.000 liderados. Um índice na ordem do feed por organização foi testado e não mudou o plano. Medições no item 4 de [../escalabilidade-consultas.md](../escalabilidade-consultas.md).
- **Lista de Pendências.** Ainda descomprime o `node_outputs` de cada execução para extrair a decisão do nó. A saída caiu de 7,8 MB para 24 kB, mas a leitura continua. Guardar a decisão numa coluna resolve.
- **`manual-run-proof`.** "Duplo clique simultâneo" estoura os 20 s também no commit-base 0006a474. Não tem relação com esta frente.

### Auditoria de eficiência de 17/10/2026 (branch `claude/auditoria-eficiencia`)

Relatório completo (achados, medições antes × depois, o que ficou de fora): [../auditoria-eficiencia-2026-10-17.md](../auditoria-eficiencia-2026-10-17.md).

**Regras novas**

- **Desempenho oficial sempre pela organização.** `employee_indicator_performance` e `employee_prv_performance` só têm índice
  começando por `organization_id`. Os leitores de `indicators/application/resolve-employee-performance.ts` derivam a organização
  das próprias pessoas (`ORGANIZATION_OF_PERSON` / `ORGANIZATIONS_OF_PEOPLE`) e resolvem o código do indicador DENTRO dela.
  Sem isso: varredura da tabela inteira (34 ms → 0,45 ms por leitura no dev) e, com o mesmo código em duas organizações,
  "more than one row returned by a subquery". Prova: `employee-performance-organization-proof`.
- **`indicator_measurements` sem `indicator_definition_id` não usa índice de pessoa.** O PostgreSQL 17 não tem skip scan: filtro
  só por `subject_id`/`period_start` lê o índice inteiro. Ponha `indicator_definition_id = any(array(select id from
  indicator_definitions where organization_id = $org))` quando a consulta vale para qualquer indicador (read model,
  `valid_until`: 90 mil → 4 mil buffers por lote de 250 pessoas). Não vale para `max(period_end)` da organização inteira:
  aí a varredura paralela ganha do índice (medido) — ver a marca d'água dos reports nas pendências.
- **Meta vigente por estrutura, não por pessoa.** `resolveGoalValue` (condition-evaluator) resolve a meta uma vez por
  Subgrupo/Grupo distinto do conjunto e distribui às pessoas (estrutura de 2.398: 56 ms → 1,8 ms).
- **Catálogo diário numa consulta só.** `loadIndicatorOperationalDefinition` busca por código SEM organização (pega a mais
  antiga): quem já lê `indicator_definitions` da organização mapeia as próprias linhas com `toOperationalDefinition`
  (`OPERATIONAL_DEFINITION_COLUMNS`). O quartil operacional aceita a `definition` pronta.
- **Leitura por item que pega conexão do pool tem teto.** `shared/application/concurrency/map-with-concurrency.ts` é o
  `Promise.all` com no máximo N em andamento (mesma ordem, primeira falha rejeita). Use-o em vez de `Promise.all` sobre
  colaboradores/unidades: com o pool de 20 e `connectionTimeoutMillis` de 10 s, milhares de consultas de uma vez fazem quem
  espera falhar — inclusive o heartbeat de outras matrículas.
- **Competência da liderança pelo cache oficial.** `resolveAnalysisPeriod` e `periodCoveredFor` (leadership-analytics/references.ts)
  passam por `cachedOfficial` com `membersFingerprint`: rodavam no contexto de toda mensagem e em cada ferramenta.
- **Nunca espalhe uma coleção do tamanho dos dados em argumentos.** `Math.max(...linhas)` e `push(...linhas)` estouram a pilha do
  V8 a partir de ~120–130 mil elementos (planilha válida virava 500/FAILED). Use laço (`tableFromMatrix`, `appendRecords`).
- **Amostra não lê o arquivo inteiro em células.** `scanCsv` monta só o que a amostra mostra e conta o resto com a mesma
  gramática; `totalRows` continua sendo o total do arquivo.
- **Posse do Run da Central de Dados é renovada pelo progresso** (etapa e lote aplicado, `RUN_LEASE_SECONDS`), e cada Run
  reivindicado em grupo confere o próprio token (compare-and-swap) antes de executar — o mesmo padrão do motor de Workflows.
- **Matrícula por Indicador/Flag na carga em lote** usa `createEnrollmentLookups` (uma instância por lote): leituras que não
  dependem da linha são lembradas; decisão e insert continuam por linha.
- **Metadado de objeto bruto sem o conteúdo:** `RawObjectStore.getMeta` para quem só confere existência/checksum.

**Provas desta frente:** `employee-performance-organization-proof` (nova), `analytics-read-model-proof`, `dynamic-indicator-proof`,
`data-hub-proof` e as de Workflow/estratégia listadas no relatório.

### Ordem das migrations (21/11/2026, run-8 ARQ-11)

A numeração pulou de 227 para 243 e 245: os números 228–242 e 244 não foram usados por nenhuma branch nem worktree (conferido em 21/11) e
ficam vagos — 243 e 245 já estão aplicadas no dev, no teste e publicadas, e renumerar faria os bancos as aplicarem de novo com outro nome.
Para a lacuna não virar ordem diferente entre instalação nova e banco atualizado, `runMigrations` recusa antes de aplicar qualquer coisa a
pendente com número menor que a mais nova já aplicada (`outOfOrderMigrations`, `MigrationOrderError`; teste `run-migrations.test.ts`).
Migration nova entra sempre depois da última aplicada (hoje, 246 em diante). O `inia_holdout_v2`, congelado, tem pendências fora de ordem
desde a homologação e nunca é migrado.

### Auditoria de arquitetura de dados — run-9 (22/11/2026, migration 248)

Pergunta: as estruturas de dados são as mais eficientes? Resposta medida no banco de dev (catálogo, estatísticas e EXPLAIN sem
ANALYZE; sem `pg_stat_statements`) e projetada para o volume de produção desta memória e de escala-e-operacao: **na maior parte, sim**.
Checklist de referência: boas práticas genéricas de PostgreSQL (lidas de uma skill pública), sempre conferidas contra o uso real.

Corrigido nesta rodada:
- Entrega única da monitoria (`deliveredMonitoringOfSql`) varria `feedbacks`, `feedback_engine_messages` e `evidences` inteiras por chamada
  e a monitoria aleatória a chamava em série; reescrita para excluir as já monitoradas no próprio SQL do sorteio.
- Ciência pela rede chamava o AD dentro de transação aberta (e pedia uma 2ª conexão do pool): AD agora fora de transação.
- 248: `feedbacks (case_id)`; `people (upper(btrim(matricula)))` NÃO único de propósito (achar a matrícula repetida); parcial de
  execuções vivas por Workflow; 5 índices que repetiam o começo de um único removidos (o maior: `idx_interaction_flags_interaction`);
  `autovacuum_*` mais frequente em `indicator_measurements_all` (em `_all`, a visão não aceita), `interactions`, `transcripts`,
  `interaction_flags` e `ai_usage_events` (estatística de "últimos N dias" ficava ~37 dias atrasada).
- Agrupamento em memória por indicador em `structure-overview.ts` (`Map` em vez de `filter` por definição).

Fica para quando o volume crescer (cada um com o gatilho; não fazer antes):
- UUIDv7 como default do `id` em `interactions`, `transcripts`, `interaction_flags` e `indicator_measurements_all` — índices dessas
  tabelas > ~50% da RAM do servidor de dados ou `apply` da carga subindo mês a mês. Só o default muda (PG17 não tem `uuidv7()`).
- FKs sem índice criadas depois da 137 (best_practice_*, `workflow_enrollment_events.agent_run_id`, `workday_reconciliations.alert_id`,
  `assistant_interaction_ratings`…) e as proteções da retenção apontando para a visão — ANTES de ligar a primeira política de retenção.
- `ai_usage_events` com 12 índices — junto com a partição mensal (> 10 M linhas).
- Read model em tabelas UNLOGGED (~1 GB/dia de WAL de dado derivado) — se o WAL incomodar; exige detectar "vazio ⇒ reconstruir".
- `fillfactor = 90` em `indicator_measurements_all` — se `n_tup_upd / n_tup_ins` > 20%.
- Sorteio sem descomprimir transcrição (ingestão garantir que vazia não é gravada) — janela mensal em escala.
- Keyset nas listas de rejeições da carga (Run > 50 mil rejeições); índices de `goals` por equipe (> 50 mil), lista de casos
  (> 100 mil), sucesso em `auth_login_attempts` (força bruta).
- Partição: não agora. Ordem quando a retenção for decidida: `ai_usage_events`, `transcripts`, `indicator_measurements_all`;
  `interactions` continua com DELETE em lotes (13 FKs apontam para ela).
- `pg_stat_statements` na tabela de parâmetros da instalação (instalação nova sem custo; na VM só com janela combinada).

Está bom como está (e por quê): uuid nas tabelas de negócio e configuração (pequenas); `organization_id` na frente dos índices;
FKs para pais que nunca são apagados; visões sobre `_all` (o planejador usa os índices sem parcial em `deleted_at`); cargas em lote
set-based com `on conflict ... where mudou`; triggers por statement; jsonb em `node_outputs`; text + check; posse renovada a cada 40 s;
`auth_login_attempts` com `matricula:<X>`; os 5 índices de medições.
