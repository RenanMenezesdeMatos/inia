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
