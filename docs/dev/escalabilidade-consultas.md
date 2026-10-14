# Consultas do caminho quente — 600 usuários simultâneos, 4.000 cadastrados

Este relatório registra a correção das consultas que crescem com o histórico de cada pessoa e que rodam a cada abertura de tela ou a cada minuto. A correção é de 13/10/2026 e vem da auditoria de escalabilidade do mesmo dia.

Cada item traz o `EXPLAIN (ANALYZE, BUFFERS)` de antes e de depois no banco de dev `inia`. Os planos estão recortados nas linhas que importam: varredura, buffers, ordenação e tempo. Um buffer tem 8 KB. "hit" é leitura do cache do PostgreSQL e "read" é leitura do disco ou do cache do sistema.

O banco de dev tem a massa demo:

- 1,6 milhão de medições;
- 2.398 pessoas;
- 342 feedbacks;
- 1.161 alertas.

Onde o volume do dev é pequeno demais para mostrar o problema, há também uma **simulação de escala**. Ela roda no `inia_test`, dentro de uma transação desfeita no fim (`begin … rollback`), e não deixa nenhuma linha no banco.

A memória da área está em [memoria/banco-e-consultas.md](memoria/banco-e-consultas.md).

## 1. `/operator/overview` — Acompanhamento do colaborador

Arquivos:

- `backend/src/modules/reporting/application/fetch-operator-overview.ts`
- `backend/src/modules/reporting/presentation/operator-router.ts`
- `backend/src/modules/reporting/presentation/supervisor-router.ts`

### Indicadores: último período de cada indicador

**Antes.** A consulta trazia todas as medições da pessoa, sem período e sem LIMIT. O join com metas duplicava linhas, e o front aproveitava só a primeira de cada indicador. Nenhum índice começa por `subject_id`, então o banco varria a tabela inteira de medições. Operador de exemplo: `c52b10d7-…`, com 1.230 medições.

```
Nested Loop Left Join (actual time=36.019..37.268 rows=1920 loops=1)
  Buffers: shared hit=1597 read=89222                      ← 90.819 buffers ≈ 710 MB por carregamento
  ->  Parallel Seq Scan on indicator_measurements m (actual rows=410 loops=3)
        Filter: (subject_id = 'c52b10d7-…')
        Rows Removed by Filter: 536159
Execution Time: 37.356 ms        (com a tabela no cache do sistema; a frio, segundos)
```

**Depois.** A consulta faz uma busca `LIMIT 1` por indicador do catálogo da organização. Essa busca usa o índice único que já existia, `(organization_id, indicator_definition_id, subject_type, subject_id, period_start, period_end, source)`. Por isso não foi preciso índice novo em `indicator_measurements`, a tabela de 1,5 GB que mais recebe escrita. A meta passa a ser a da equipe vigente no fim do período medido, com a mesma regra da ingestão. Antes vinha uma meta qualquer entre as metas sobrepostas da equipe.

```
Sort (actual time=0.531..0.534 rows=12 loops=1)
  Buffers: shared hit=167                                  ← 167 buffers ≈ 1,3 MB
  ->  Limit (actual rows=0 loops=25)
        ->  Index Scan Backward using indicator_measurements_organization_id_indicator_definition_key on indicator_measurements m
              Index Cond: (organization_id = i.organization_id AND indicator_definition_id = i.id AND subject_type = 'PERSON' AND subject_id = '…')
Execution Time: 0.643 ms
```

Para conferir, comparamos o valor e o período antigos (primeira linha por indicador em `period_end desc`) com os novos. Os três operadores conferidos, com 12, 6 e 11 indicadores, não tiveram nenhuma diferença.

### Feedbacks: paginação por cursor (keyset)

**Antes.** A consulta trazia todos os feedbacks da pessoa, já ordenados. Depois, rodava quatro buscas de enriquecimento sobre cada um: materiais de apoio, view, título legado e motivo. O front mostrava 4 por vez.

**Depois.** O SSR traz a primeira página (12 feedbacks) e `nextCursor`. As páginas seguintes vêm de `GET /operator/feedbacks?cursor=`. O cursor é `(coalesce(published_at, created_at), id)`, com o instante em microssegundos. Um cursor inválido devolve 400. O índice parcial novo é `idx_feedbacks_operator_feed (operator_id, coalesce(published_at, created_at) desc, id desc) where status = 'PUBLISHED'`, da migration 130.

No dev (operador `5d4cb9a6-…`, com 40 feedbacks visíveis):

```
ANTES   Sort (rows=40) ← Bitmap Index Scan on idx_feedbacks_operator             Execution Time: 0.827 ms
DEPOIS  Limit (rows=13) ← Index Scan using idx_feedbacks_operator_feed            Buffers: shared hit=93   Execution Time: 4.212 ms
        página 2: Index Cond: (operator_id = … AND ROW(coalesce(published_at, created_at), id) < ROW('2026-09-14 11:37:12.047205-03', '…'))
```

Simulação de escala: 2.000 feedbacks publicados de uma pessoa, `inia_test`, com rollback.

```
ANTES   Sort  Sort Method: external merge  Disk: 4096kB  (rows=2000)
        ->  Seq Scan on feedbacks f (rows=2000)           Buffers: shared hit=405, temp read=512 written=513   Execution Time: 4.342 ms
        + 4 enriquecimentos e o JSON de 2.000 feedbacks a cada abertura de /operator
DEPOIS  Limit (rows=13) ->  Index Scan using idx_feedbacks_operator_feed  Buffers: shared hit=10   Execution Time: 0.030 ms
        página 100 pelo cursor: Index Scan using idx_feedbacks_operator_feed  Buffers: shared hit=9   Execution Time: 0.021 ms
```

### Ficha do supervisor (`/supervisor/operators/:id`)

A ficha carregava indicadores e feedbacks que a tela nunca lia. A aba Indicadores vem do analytics e a aba Acompanhamentos, do feed da estrutura (`/analytics/follow-ups`). As duas leituras saíram da rota, e o campo `feedbacks` saiu do tipo do front.

A rota **`GET /supervisor/overview` foi removida**, a pedido coordenado com a frente de read model e com aprovação do usuário. Nenhuma tela a chamava, e ela fazia cinco consultas sobre a operação inteira sem limite, entre elas a média de todas as medições da organização. Também abria dados por pessoa da organização inteira pelo nível do JWT (achado F-2). Os anexos de segurança foram atualizados (`rotas-dados-de-pessoas.md`, R-17).

### Front

- O payload cru agora tem schema zod (`schemas/operator/operator-overview.schema.ts`). Os tipos vêm de `z.infer`.
- O mapeamento saiu do arquivo só-servidor para `services/operator/operator-feed.ts`.
- `queries/operator/use-operator-feedback-history.ts` usa `useInfiniteQuery` a partir da página do SSR.
- O feed revela 4 por vez, como antes. Quando chega ao fim do que já carregou, pede a página seguinte.
- Enquanto houver página por vir, nenhuma entrega de atendimento mais antiga que o último feedback carregado aparece (`boundFollowUpTimeline`). Assim a ordem da timeline fica certa.
- "Ler feedback" de um item que ainda não chegou busca as páginas até encontrá-lo.

Provas:

- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operator-overview-proof`: último período, meta vigente, páginas somando a lista sem buraco nem repetição com 3 itens no mesmo microssegundo, oculto/rascunho/outra pessoa fora.
- `follow-up-cursor.test.ts`
- `follow-up-timeline.test.tsx` (fronteira, carregar mais pelo servidor, "Ler feedback" na página 3).

## 2. Índices de hierarquia em `people`

Migration 134. Ela nasceu como 131 e foi renumerada porque o checkout principal criou `131_interventions.sql` em paralelo; o registro em `schema_migrations` foi renomeado no `inia` e no `inia_test`.

- `idx_people_org_reports_to (organization_id, reports_to_id) where reports_to_id is not null`;
- `idx_people_org_team (organization_id, team_id) where team_id is not null`.

Quinze CTEs recursivas percorrem `reports_to_id`. Entre elas:

- escopo de acesso: `scope-people-reader.ts`, `postgres-access-repository.ts`, `postgres-account-access-repository.ts`;
- `viewer-scope`/`loadDescendants`;
- destinatário de Workflow e materiais de apoio;
- métricas gerenciais.

O passo inicial dessas CTEs sempre filtra a organização, e antes cada um varria `people` inteira.

```
                          ANTES                                         DEPOIS
supervisor (39 pessoas)   Seq Scan on people (âncora) + Hash Join       Index Scan using idx_people_org_reports_to (âncora) + Hash Join
                          Buffers: shared hit=424  1.328 ms             Buffers: shared hit=224  0.353 ms
isInStructure             Buffers: shared hit=424  1.019 ms             Buffers: shared hit=224  0.279 ms
diretor (2.385 pessoas)   Buffers: shared hit=1272 5.731 ms             Buffers: shared hit=1066 2.169 ms
membros de uma equipe     Seq Scan on people  hit=215  0.286 ms         Bitmap Index Scan on idx_people_org_team  hit=41  0.039 ms
```

O passo recursivo (`p.reports_to_id = s.id`) continua como **Hash Join sobre `people`**, por decisão do planejador. Testamos três variantes, cada uma numa transação desfeita no fim:

- o par pedido;
- `(reports_to_id)` sozinho, mais a equipe;
- os três índices juntos.

Em nenhuma delas o planejador trocou o Hash Join por buscas no índice. No tamanho alvo, com cerca de 4.000 pessoas (cerca de 360 blocos), uma passada por nível sai mais barata que milhares de buscas no índice. Por isso não foi preciso reescrever as CTEs nem criar índice só em `reports_to_id`.

Se a base passar de dezenas de milhares de pessoas, o próximo passo será:

- incluir `p.organization_id = $org` no passo recursivo das CTEs;
- medir de novo.

Provas re-executadas: `access-proof`, `account-access-lifecycle-proof`, `structure-scope-proof` e os testes de `org-structure` (`INIA_DB_PROOF=1`), 66 de 66.

## 3. Sino (todo usuário, a cada 60 s)

Arquivos:

- `notifications/application/notifications-repository.ts` e `build-notification-summary.ts`;
- `pending-actions/application/pending-actions-repository.ts` e `build-pending-actions.ts`;
- `conversational-delivery/application/recado-follow-up-invite.ts`.

O que mudou:

- **Recado de Chat.** O join era `a.dedupe_key = 'workflow_chat:' || wo.id::text`, que varria todas as entregas. Agora é `wo.id = <uuid extraído da chave>`, a mesma expressão do recado de voz (`alertOutputIdSql`), e usa a PK de `workflow_outputs`.
- **Situação das revisões no sino.** Antes, a cada minuto, o sino carregava as 200 revisões mais recentes com o `node_outputs` inteiro. Agora pede só os avisos de revisão que está mostrando (no máximo 20) e, da execução, só `node_outputs -> <nó de revisão>`, que é a decisão gravada. A lista de Pendências também deixou de carregar o Execution Context, que só vem no detalhe (`ReviewAlertDetailRow`).
- **Contagens de pendentes** (`countPending`, `countPendingByOperator`). Passam a filtrar o aviso vivo (`OPEN/SEEN/ACKNOWLEDGED`). A decisão resolve o aviso depois de gravada no nó, e nada o expira; por isso um aviso resolvido nunca é pendência. `reviewStatus` usa a mesma regra, e lista, detalhe, sino e contadores continuam com uma definição só. A execução e o nó saem da chave por `substr`, com o formato validado uma vez por regex. Antes eram três regex por aviso.
- **Migration 132.**
  - `idx_alerts_recipient_recent (recipient_id, created_at desc)`;
  - parcial de não lidas `idx_alerts_recipient_unread`, com o mesmo predicado de `UNREAD_CONDITION`;
  - parcial de revisões vivas `idx_alerts_recipient_live_review`;
  - **drop de `idx_alerts_open_dedupe`** (001:221). O índice único global `uq_alerts_dedupe_key` (030:5) já garante a unicidade e é o árbitro de todos os `on conflict (dedupe_key)`. Nenhuma escrita usa o parcial como árbitro, e `pg_stat_user_indexes` mostrava `idx_scan = 0` para ele, contra 691 mil do global.

No dev (destinatário `0ec4cf1b-…`, 212 avisos):

```
                      ANTES                                                DEPOIS
lista do sino         Bitmap Index Scan on idx_alerts_recipient (212)      Index Scan using idx_alerts_recipient_recent (20)
                      + top-N sort  Buffers: shared hit=82  1.064 ms       Buffers: shared hit=19  0.147 ms
badge (não lidas)     idx_alerts_recipient → 201 linhas, hit=28            Bitmap Index Scan on idx_alerts_recipient_unread → 10, hit=3   0.026 ms
revisões (lista)      node_outputs inteiro, 2.605 ms                       só o nó de revisão, 0.558 ms
pendentes             idx_alerts_recipient → 212, hit=68  1.228 ms         idx_alerts_recipient_live_review → 14, hit=48  0.155 ms
```

Simulação de escala no `inia_test`, com rollback:

- um gestor com 5.000 avisos (de 55 mil na tabela);
- 20.000 recados de Chat;
- 200 revisões esperando, com `node_outputs` de cerca de 40 KB.

```
                      ANTES                                                       DEPOIS
lista do sino         Seq Scan on workflow_outputs (20000) + top-N de 5000        Index Scan using idx_alerts_recipient_recent (20) + PK da entrega
                      Buffers: shared hit=525  3.928 ms                           Buffers: shared hit=11  0.102 ms
badge                 idx_alerts_recipient → 5000, hit=161  0.353 ms              idx_alerts_recipient_unread → 400, hit=17  0.071 ms
revisões do sino      200 execuções  Serialization: output=7841kB  20.891 ms      só os 20 listados  Serialization: output=1kB  0.289 ms
lista de Pendências   (mesma consulta acima)                                      200 linhas  Serialization: output=24kB  14.310 ms*
pendentes             5000 avisos lidos, 3 regex/linha  hit=761  12.808 ms        idx_alerts_recipient_live_review → 200, substr  hit=606  1.492 ms
pendentes (operador)  —                                                           hit=3  0.010 ms
```

\* A lista de Pendências ainda descomprime o `node_outputs` de cada execução para extrair `-> <nó>`. A saída caiu de 7,8 MB para 24 kB, mas o custo de leitura continua. Ela só abre sob demanda, e o sino, que roda a cada minuto, não passa mais por ela.

Provas:

- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run bell-queries-proof` (recado de Chat ligado à conversa, não lidas, pendente × aviso resolvido com a execução parada no nó, lista sem Execution Context, detalhe com ele, sino montado sobre as consultas reais);
- `conversational-delivery-proof`;
- `notifications-router.test.ts` (o sino pede só os avisos de revisão listados).

## 4. Feed do Acompanhamento do gestor (`/analytics/follow-ups`)

Arquivos:

- `backend/src/modules/performance-analytics/application/analytics-read-repository.ts` (`loadFollowUpFeed`)
- `backend/src/modules/performance-analytics/presentation/analytics-router.ts`
- `frontend/src/queries/analytics/use-analytics-queries.ts` (`useFollowUpFeedQuery`)

**Antes.** A consulta montava título, cartão e o JSON do feedback (`context_snapshot`) de **todos** os feedbacks publicados dos liderados. Depois fazia `count(*) over()`, ordenava e só então aplicava LIMIT/OFFSET. Não havia desempate, então itens no mesmo instante podiam se repetir ou sumir entre páginas.

**Depois, primeira rodada (conteúdo depois do LIMIT).**

- A página é escolhida só por (tipo, id, instante), com desempate por id. O conteúdo é montado depois do LIMIT, só para os itens da página.
- O feedback usa o índice parcial da migration 130, `idx_feedbacks_operator_feed`.
- O contrato não mudou nessa rodada: `page`, `pageSize`, `total` e o formato dos itens.

No dev (diretor `de00c01c-…`, 2.385 liderados, 246 feedbacks, página 1 de 8):

```
ANTES   WindowAgg (rows=246) sobre linhas com o JSON  →  top-N   Buffers: shared hit=2828   Execution Time: 16.872 ms
DEPOIS  WindowAgg (rows=246) sobre (id, tipo, instante) → top-N → conteúdo só da página   Buffers: shared hit=387   Execution Time: 3.348 ms
```

Simulação de escala: 2.000 liderados, 30.000 feedbacks publicados de cerca de 3 KB, `inia_test`, com rollback.

```
                 ANTES                                                              DEPOIS
página 1         WindowAgg rows=30000  temp read=44764 written=22575  299.672 ms     WindowAgg rows=30000 (estreitas), sem temp  9.326 ms
página 50        WindowAgg rows=30000  temp read=44764 written=22575  294.231 ms     8.914 ms
```

Cada página do diretor derramava cerca de 350 MB em disco temporário. Isso acabou. Sobrou o `count(*) over()` sobre linhas estreitas, que existia porque a paginação por número usava `total`.

**Depois, segunda rodada (keyset, 13/10/2026).** O commit `053c84bf` (`admin-list-standardization`) passou o feed para rolagem infinita (`useInfiniteQuery`), que só usava `total` para saber se havia próxima página. Depois do merge, a paginação virou cursor sem mudar a tela:

- O cursor é `(instante, id)`, o mesmo de `/operator/feedbacks` (`feedbacks/domain/follow-up-cursor.ts`). Ele filtra os feedbacks e os avisos antes da ordenação.
- `limit + 1` substitui o `count(*) over()` e o OFFSET. O item extra só diz se há página seguinte; o conteúdo é montado só para os itens exibidos.
- Contrato: `cursor` e `limit` (1–100) na entrada; `{ items, nextCursor }` na saída, sem `total`, `page` e `pageSize`. Cursor inválido devolve 400 (`INVALID_CURSOR`). O front lê o schema zod `followUpFeedSchema`.
- Um feedback publicado enquanto o líder rola o feed não repete nem pula nenhum item. Com OFFSET, o último item de uma página voltava no topo da seguinte.

Como foi medido:

- antes e depois sobre os mesmos dados, na mesma transação, chamando o repositório real (o EXPLAIN intercepta a consulta da página);
- o "antes" é o arquivo do commit do merge;
- página de 8 itens, como na tela;
- mediana de 7 execuções, porque a máquina é compartilhada e o tempo oscila.

Simulação de escala: 2.000 liderados, 30.000 feedbacks publicados de cerca de 3 KB e 500 avisos para o diretor, `inia_test`, com rollback.

```
ANTES   página 1    Limit ← top-N heapsort 25kB ← WindowAgg (rows=30500) ← Append ← Seq Scan on feedbacks (rows=30000)
                    Buffers: shared hit=1997   Execution Time: 8.300 ms
        página 50   Limit ← top-N heapsort 72kB ← WindowAgg (rows=30500) ← Append ← Seq Scan on feedbacks (rows=30000)
                    Buffers: shared hit=1973   Execution Time: 8.472 ms
DEPOIS  página 1    CTE probe: Limit (rows=9) ← top-N heapsort 25kB ← Append ← Seq Scan on feedbacks (rows=30000)
                    conteúdo: Limit (rows=8) ← CTE Scan on probe
                    Buffers: shared hit=1985   Execution Time: 5.297 ms
        página 50   CTE probe: Limit (rows=9) ← top-N heapsort 25kB ← Append ← Seq Scan on feedbacks (rows=29846)
                      Filter: … ROW(COALESCE(published_at, created_at), id) < ROW(cursor)   Rows Removed by Filter: 159
                    Buffers: shared hit=1746   Execution Time: 5.389 ms
```

No dev (diretor `de00c01c-…`, 2.264 operadores na estrutura, 246 itens, 31 páginas):

```
ANTES   página 1    WindowAgg (rows=246) → top-N   Buffers: shared hit=351   Execution Time: 2.946 ms
        página 31   WindowAgg (rows=246) → top-N   Buffers: shared hit=142   Execution Time: 0.335 ms
DEPOIS  página 1    top-N (rows=9), sem WindowAgg   Buffers: shared hit=351   Execution Time: 2.130 ms
        página 31   Seq Scan on feedbacks (rows=6, Rows Removed by Filter: 336)   Buffers: shared hit=142   Execution Time: 0.174 ms
```

O tempo caiu cerca de 36% na simulação e não cresce com a profundidade da página. A memória do top-N ficou fixa (25 kB). Buffers praticamente iguais: cada página ainda lê os feedbacks publicados da estrutura inteira, porque `operator_id = any(…)` com 2.000 pessoas não percorre o índice na ordem do feed. Um índice `(organization_id, coalesce(published_at, created_at) desc, id desc) where status = 'PUBLISHED'` foi testado na simulação: o planejador não o usou na página 1 e, na página 50, ficou mais lento (6,2 ms). Para uma equipe de 20 pessoas (800 itens), o feed já sai pelo índice da migration 130, em 0,2 ms.

Prova: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run follow-up-feed-proof`. Ela cobre:

- páginas pelo cursor somando a lista, com 3 itens no mesmo microssegundo e o cursor caindo no meio desse empate e entre feedback e aviso;
- páginas de 1, 2, 4 e 6 itens: sempre a mesma lista, e a última página sem cursor;
- feedback publicado depois da primeira página, sem repetir nem pular nada;
- feedback e aviso com os campos da própria origem;
- "aguardando ciência";
- oculto fora;
- cursor no último item: página vazia.

`analytics-router.test.ts` cobre a rota: páginas pelo cursor, "aguardando ciência" e cursor adulterado (400). As provas `follow-up-visibility-proof` e `conversational-delivery-proof` continuam passando.

## 5. Agenda (`workflows/application/schedule-check.ts`)

**Antes.** Um `INSERT … ON CONFLICT DO NOTHING` por operador × workflow × horário, a cada minuto e até o fim do dia. Em quase todos os minutos todas as linhas já existiam, então eram 2.000 idas e voltas para inserir zero matrículas.

**Depois.** `enrollScheduledSlots` faz um único insert por disparo, `select … from unnest($5::uuid[], $6::timestamptz[])`:

- no modo Individual, um insert por horário devido;
- no modo Relativo ao expediente, um insert por workflow, com o instante de cada pessoa;
- no modo Consolidado, um insert por workflow.

A idempotência continua sendo o mesmo índice único, `workflow_enrollments_schedule_slot_uk`, árbitro do `on conflict`.

Medição: 2.000 operadores, `inia_test`, com rollback. O "antes" foi cronometrado no psql por socket local, que é o melhor caso possível para idas e voltas.

```
                         ANTES (2000 comandos)          DEPOIS (1 comando)
1ª rodada (nascem)       105 ms total                   Insert … Tuples Inserted: 2000        Execution Time: 22.456 ms
rodadas seguintes        68 ms total, a cada minuto     Insert … Conflicting Tuples: 2000     Buffers: shared hit=6000   Execution Time: 2.081 ms
```

Prova: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run schedule-check-proof`. Ela roda os três modos e confere:

- uma rodada às 13:00 cria 10 matrículas;
- a segunda rodada no mesmo minuto cria 0;
- às 18:05 só o horário novo nasce;
- C, sem jornada, nunca recebe horário;
- inativo e supervisora ficam fora.

A **mesma prova também passa com o código antigo**: o arquivo foi trocado temporariamente e depois restaurado. O comportamento é idêntico.

## 6. `audit_logs`

Migration 133:

- `idx_audit_logs_entity (organization_id, entity_type, entity_id, created_at)`;
- `idx_audit_logs_actor (actor_id, created_at) where actor_id is not null`.

**Desvio do pedido.** O índice do ator começa por `actor_id`, e não por `(organization_id, actor_id, created_at)`. A mesma busca também é a checagem da FK `audit_logs_actor_id_fkey`, que roda a cada pessoa apagada (reset da massa demo, limpeza das provas). Com a organização na frente, essa checagem continuava varrendo a tabela. A pessoa pertence a uma organização só, então a organização fica como filtro.

No dev (763 linhas, só a PK antes):

```
trilha de uma entidade   ANTES Seq Scan on audit_logs  hit=38   0.388 ms     DEPOIS Index Scan using idx_audit_logs_entity  hit=9   0.028 ms
ações de um ator         ANTES Seq Scan on audit_logs  hit=32   0.178 ms     DEPOIS Index Scan using idx_audit_logs_actor   read=2  0.013 ms
```

Simulação de escala: 500 mil linhas (95 MB), 2.000 atores, `inia_test`, com rollback. As variantes foram comparadas na mesma transação:

```
                                              ANTES (só PK)                        DEPOIS A (org, ator, instante)        DEPOIS B (ator, instante) — escolhida
trilha de exceção (schedule-exception)        Parallel Seq Scan  hit+read=13018      Index Scan idx entidade  0.026 ms       0.016 ms
trilha de checkpoint (checkpoint-registry)    Parallel Seq Scan  hit+read=13024      Bitmap idx entidade      0.108 ms       0.029 ms
QA: ator em volta de 200 decisões             200 × Seq Scan  2.6 M buffers  4.367 s  Index Only Scan  0.206 ms              Index Scan  0.177 ms
FK ao apagar uma pessoa (audit_logs)          Trigger audit_logs_actor_id_fkey 50.701 ms   24.686 ms (ainda varre)          0.081 ms
```

## 7. Pool (`infrastructure/database/pool.ts`)

**Antes.** O pool só tinha `max`:

- nenhum comando tinha limite de duração;
- uma transação esquecida segurava bloqueios para sempre;
- com o pool esgotado, a espera por conexão era infinita;
- nada identificava o processo no `pg_stat_activity`.

**Depois.** As regras ficam em `session-limits.ts`. Os limites vão como parâmetros de abertura de cada conexão:

| Processo | `statement_timeout` | `idle_in_transaction_session_timeout` | espera por conexão | `application_name` |
|---|---|---|---|---|
| servidor `api` | 30 s (`DATABASE_STATEMENT_TIMEOUT_MS`) | 60 s | 10 s | `inia-api` |
| servidor `worker` / `all` | 300 s (`DATABASE_WORKER_STATEMENT_TIMEOUT_MS`) | 60 s | 10 s | `inia-worker` / `inia-all` |
| migrations, seeds, scripts, testes | sem limite | sem limite | sem limite | `inia-script:<arquivo>` |

Todos os valores são configuráveis no `env.ts`, com 0 significando sem limite, e estão documentados no `.env.example`.

**Como o pool sabe quem é.** O pool nasce no import. Por isso o primeiro import de `server.ts` é `main/server-database-session.ts`, que grava `INIA_DATABASE_SESSION=server` antes de o pool ser criado. O papel sai do mesmo `resolveProcessRole` (`--role=` ou `INIA_PROCESS_ROLE`). Um teste garante que esse import continua em primeiro lugar.

Qualquer outro processo fica sem limite e mantém o comportamento de antes:

- `db:migrate`, `db:seed:*`, `db:bootstrap` e `db:seed:demo:reset` (o reset apaga cerca de 1,1 milhão de medições numa transação);
- scripts congelados de `backend/scripts`, que não foram editados;
- vitest.

**Overrides dentro da transação.**

- **Central de Dados.** `useBatchStatementTimeout(client)` vale em cada transação de aplicação, atômica ou em lotes, de `run-pipeline.ts` e `database-run.ts`. A carga roda no limite do worker (300 s) mesmo quando o `kickWorker` de um upload a executa no processo da API.
- **Migrations.** `run-migrations.ts` zera os dois limites dentro da transação de cada arquivo, seja quem for que a chame.

O levantamento de 48 arquivos com transação explícita mostrou que nenhuma segura uma chamada de IA, HTTP ou banco externo aberta. Os intervalos entre comandos são de milissegundos (bcrypt, cerca de 0,1 s, em dois pontos). Por isso 60 s de transação ociosa não quebram nada em operação normal.

**Tratador de erro no cliente.** Uma conexão emprestada que o banco encerra, por transação ociosa além do limite ou por sessão derrubada pelo administrador, emite `'error'` no próprio cliente. O pool só escuta as conexões ociosas. Sem tratador, o Node morre. Reproduzimos o caso com `pg` puro e transação ociosa de 300 ms:

```
sem tratador:  node:events:487  throw er; // Unhandled 'error' event
               error: terminating connection due to idle-in-transaction timeout          (processo encerrado)
com tratador:  client error tratado: terminating connection due to idle-in-transaction timeout
               processo ainda vivo depois do timeout
               comando seguinte falhou: Client has encountered a connection error and is not queryable
```

O pool agora registra esse tratador em toda conexão (`pool.on("connect")`).

Provas:

- `session-limits.test.ts` cobre os limites por papel, o processo sem marca sem limite e o primeiro import do `server.ts`.
- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run pool-session-proof` usa o pool real como servidor `api` com limites curtos e confere:
  - os parâmetros chegam ao banco (`500ms`, `400ms`, `inia-api`);
  - `pg_sleep(1)` é cancelado com 57014 e a conexão segue usável;
  - a transação esquecida é encerrada, o processo segue e o pool repõe a conexão;
  - `useBatchStatementTimeout` vale só dentro da transação (`4s`, e `500ms` depois do commit);
  - com o pool esgotado, a espera falha em menos de 2 s.
- Script fora do servidor: `statement_timeout = 0`, `idle = 0`, `inia-script:script-session`.
- Servidor do worktree no ar (`--role=api`): as conexões aparecem como `inia-api` no `pg_stat_activity`.

## 8. Aba Resultados do Workflow (`workflows/application/workflow-results-reader.ts`) — 14/10/2026

Tela da administração: resumo, lista paginada de disparos e detalhe de um disparo.

**Antes.** Cada consulta montava TODOS os agregados (uso de IA, feedbacks, artefatos, emissões) de TODOS os disparos do período,
e só depois paginava. O `node_outputs` (o JSON de cada execução, ~8,5 KB numa monitoria) atravessava todas as CTEs. Pior: a
contagem de pessoas, a visibilidade do disparo e o filtro de colaborador eram subconsultas correlacionadas sobre CTEs — sem
índice, cada disparo relia a CTE inteira (trabalho quadrático).

**Depois.**

- `keys` = o barato de cada disparo (status, gatilho, pessoas visíveis), por agregação com `group by`.
- `selection` escolhe os disparos (filtro, ordem, página) ANTES dos agregados pesados, que rodam só para os escolhidos.
- O filtro de colaborador é uma coluna de `keys` (`collaborator_roots`, hash join). Com `IN`/`EXISTS`, o planejador ainda
  escolhia um nested loop que relia o conjunto para cada disparo (28 mil × 15 mil linhas).
- `node_outputs` só no ramo do feedback do Output legado, só dos disparos escolhidos.
- A pessoa do disparo é buscada pela chave com `LATERAL … limit 1`: sem o `limit`, o PostgreSQL achatava a subconsulta num join
  e trocava o índice por varrer as 1,6 milhão de medições com hash join.

**Medição.** Simulação numa transação desfeita: os 39 disparos reais da monitoria × 800 = 31.239 disparos em 30 dias, com uso
de IA e emissões copiados.

```
                         ANTES                         DEPOIS
resumo                   > 1 min                       2,1 s
página 1 (20)            > 1 min                       119 ms
página 200               > 1 min                       111 ms
filtro status+colab.     > 5 min (cancelado)           119 ms
detalhe de um disparo    —                             5 ms
dev (2.270 disparos)     página 510 ms, resumo 788 ms  página 18 ms, resumo 54 ms
```

Na API, o limite de comando de 30 s derrubaria a tela antiga com erro. **Mesmo resultado** em 1.353 comparações no dev: 24
Workflows × 2 alcances × 6 combinações de filtro (resumo, páginas, página além do fim e detalhe).

Cuidado registrado: `ANALYZE` dentro de uma transação desfeita atualiza `pg_class.reltuples` fora dela. Depois de simular,
rode `ANALYZE` nas tabelas tocadas para devolver ao planejador as estimativas reais.

## 9. Monitoramento de conversas (`assistant/application/conversation-monitoring.ts`) — 14/10/2026

A tela atualiza a cada 20 s.

- Fuso da organização calculado uma vez por consulta (era uma subconsulta por conversa).
- Filtro de datas compara a coluna como está: início do dia `from` e início do dia seguinte a `to`, no fuso da organização. Mesma
  regra; o índice `(organization_id, last_activity_at desc, id desc)` serve.
- Opções de filtro (pessoas, Grupos, Subgrupos) a partir das pessoas no alcance com ao menos uma conversa (índice de dono), em
  vez de `distinct` sobre todas as conversas a cada atualização. Uma consulta a menos.

Simulação com 110 mil conversas entre as pessoas da organização (transação desfeita):

```
                ANTES     DEPOIS
página 1        188 ms    25 ms
página 100       81 ms    47 ms
última semana   272 ms    26 ms
busca "maria"   194 ms   150 ms   (ilike em nome/título: varredura, aceitável)
```

Mesmo resultado em todas as combinações conferidas no dev (16 leitor × filtro, incluindo datas).

## 10. Compressão das respostas da API — 14/10/2026

`shared/presentation/compression.ts` (middleware oficial `compression` 1.8.2): brotli qualidade 4 ou gzip, acima de 1 KB, só tipos
compressíveis. Nunca o SSE do chat (`text/event-stream`), que precisa sair pedaço a pedaço. O IIS continua sem compressão
dinâmica. No navegador (WebKit, 14/10) os JSON acima de 1 KB passaram a chegar com `content-encoding: gzip`.

## Verificação no navegador (13/10/2026)

Front e API do worktree em `127.0.0.1`, com a API em `--role=api`, e contas demo.

- **`/operator` (`operador0002`, 21 feedbacks).**
  - O SSR traz 12 feedbacks.
  - Rolando o feed, a tela pede `GET /operator/feedbacks?cursor=…` uma vez e recebe 9.
  - Ficam 21 itens distintos, em ordem, terminando em "Fim dos feedbacks deste período".
  - Cursor inválido devolve 400, e `cursorAt` não vaza no payload.
  - O overview traz 6 indicadores, um por indicador.
- **Acompanhamento da supervisora (`supervisor01`).**
  - "Página 1 de 32 · 254 itens"; a página 2 traz outros 8, sem sobreposição.
  - Os itens mantêm título, subtítulo, cartão, colaboradora e situação da ciência.
- **Ficha da colaboradora.**
  - `/supervisor/operators/:id` devolve só `profile`, `plans`, `monitorings` e `escalation`.
  - A aba Acompanhamentos mostra "Página 1 de 3 · 21 itens".
