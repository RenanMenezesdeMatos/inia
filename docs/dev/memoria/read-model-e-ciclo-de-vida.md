# Memória — Read model do analytics da liderança e ciclo de vida dos dados

> Área criada em 13/10/2026 (auditoria de escala para 600 usuários simultâneos e 4.000 cadastrados).
>
> Desenho aprovado: [escala-read-model-e-ciclo-de-vida.md](../escala-read-model-e-ciclo-de-vida.md).
>
> Ver também: [indicadores-e-estrutura.md](indicadores-e-estrutura.md) (as telas que leem daqui) e [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) (calendário operacional e elegibilidade).

## Regra que não muda

**O read model decide o CUSTO, nunca o NÚMERO.** Ele guarda só componentes brutos que se somam de forma exata em `numeric`:

- Σ numerador e Σ denominador;
- Σ valor e contagem (Σ ÷ contagem é a mesma divisão do `avg()` do PostgreSQL);
- mínimo e máximo;
- último valor com `period_end` e `id`.

A leitura aplica as MESMAS funções finais de sempre: `finishWindow`, `finishWindowBySubject`, `combineWindowComponents` e `isSufficient`.

Nunca:

- guardar um número final;
- guardar média de médias;
- usar `float` no banco;
- criar uma segunda regra de elegibilidade.

O caminho original continua no código como REFERÊNCIA das provas:

- `PgAnalyticsReadRepository({ peopleSource: "sql", operationalSource: "raw", officialCache: false })`;
- `countInteractionsByPersonDayRaw`;
- `loadMonthSpendRaw`.

Atingimento oficial, PRV, quartil e peso nunca são recalculados: a camada oficial só ganhou cache.

## Peças (migrations e onde vivem)

### 128 — `analytics_versions`

- Uma linha por organização para cada domínio: STRUCTURE e OFFICIAL.
- A versão sobe por **trigger por statement** e vem de uma **sequência**, então uma transação desfeita nunca reaproveita o número.
- STRUCTURE é subida por:
  - `people`, só quando mudam as colunas do `PersonNode`;
  - `teams` e `subteams`.
- OFFICIAL é subida por:
  - `employee_indicator_performance`;
  - `employee_prv_performance`;
  - `indicator_definitions`.
- Leitura: `performance-analytics/infrastructure/analytics-versions.ts`.

### 141 — a versão sobe NO COMMIT

Corrige um defeito da 128 (13/10/2026). O trigger fazia o upsert da linha (organização, domínio) na hora da escrita, e o lock dessa linha ficava com a transação até o fim. Uma transação longa (importação da Central de Dados, seed, script) segurava todos os outros gravadores daquele domínio na organização até terminar. A prova do gatilho Manual (`manual-run-proof`) travou assim: a transação aberta de um caso segurava o `insert into people` do caso seguinte.

Como ficou:

- o trigger por statement só anota a pendência em `analytics_version_pending`. A chave leva o id da própria transação (`pg_current_xact_id()`), então duas transações nunca disputam a mesma linha;
- um constraint trigger ADIADO aplica as pendências no commit, uma versão por (organização, domínio) por transação, em ordem fixa. O lock da linha dura só o commit, e transações que sobem STRUCTURE e OFFICIAL em ordem cruzada não travam;
- continua na mesma transação da escrita: a versão nova aparece junto com os dados. Rollback ou savepoint desfeito não sobe nada;
- a própria transação enxerga a sua pendência. Para ela, `loadAnalyticsVersions` devolve `uncommitted:<uuid>` (único a cada leitura), e os dois caches carregam sem guardar (`isUncommittedVersion`). Quem grava e lê o analytics na mesma transação nunca recebe um cache anterior à própria escrita, e o que ela carrega nunca fica sob a versão dos outros;
- `set constraints all immediate` volta ao comportamento da 128 dentro daquela transação (aplica no statement);
- nunca ler `analytics_versions` direto para saber se uma escrita da própria transação "subiu a versão": a tabela só muda no commit. Use `loadAnalyticsVersion`.

### Grafo de pessoas — `infrastructure/organization-people-graph.ts`

- Uma consulta por versão STRUCTURE, ordenada por nome e id.
- O `PgAnalyticsReadRepository` serve a partir do grafo, em memória:
  - `loadPerson`;
  - `loadDescendants` (com proteção contra ciclo, como a CTE com `union`);
  - `loadPeopleInVisibility`;
  - `loadDirectReports`;
  - `countActiveDirectReports`.
- O escopo, o organograma e a Equipe deixaram de refazer a árvore recursiva a cada request.
- As atribuições de acesso da conta continuam lidas a cada request.
- Desempate por id também no SQL original.
- Pessoa de outra organização com `reports_to_id` corrompido nem entra no grafo, o que é mais estrito que a CTE antiga.

### 129 — `person_daily_activity`

- Interações por operador × data local, no fuso de `analytics_org_timezone`, que é o mesmo de `resolveOrganizationTimezone`.
- Mantida por trigger em `interactions` (insert, update, delete e truncate) **na mesma transação** da escrita. Linhas que chegam a zero saem.
- Mudar o fuso da operação remonta a organização (`person_daily_activity_state`).
- `loadWorkActivityEvidence` lê a tabela (`countInteractionsByPersonDay`). Se o fuso for outro, cai na contagem bruta.
- Vale para todos os consumidores: Calendário, Condition, Ranking e analytics.

### 136 — read model operacional

**Tabelas:**

- `analytics_member_window`: pessoa × comparação (as 5 da tela) × fase (CURRENT/PREVIOUS). Guarda `first_date`/`last_date`, dias elegíveis, dias de falta injustificada e `valid_until`.
- `analytics_member_window_indicator`: as colunas de `aggregateColumns` + `latest_period_end`/`latest_id`.
- `analytics_rollup_state`: dia local, fuso e geração.
- `analytics_operational_dirty`: log só de inserção. Marca sem pessoa = organização inteira.

**Construção:** `indicators/application/operational-window-components.ts` (`resolveWindowComponentsBySubject`).

- Elegibilidade resolvida uma vez na união das janelas e recortada por janela com `summarizeWorkdays`. A elegibilidade de um dia não depende da janela nem de `now`.
- Medições pelo mesmo predicado, exigindo a data local dentro da janela.

**Triggers que marcam a pessoa:**

- medições de pessoa;
- `employee_status_periods`;
- `employee_schedule_days`;
- `employee_work_shifts`;
- `employee_schedule_exceptions`;
- `workday_classifications`;
- `people` (admissão e capital operacional);
- a primeira e a última interação do dia (insert e delete em `person_daily_activity`).

**Triggers que marcam a organização inteira:**

- `organization_holidays`;
- `holiday_catalog`;
- política de feriado em `organizations`;
- `operations` (fuso);
- `indicator_definitions`;
- truncate.

**Tarefa `analytics-rollup`** (`application/analytics-rollup.ts`, worker, 15 s, `runOnStart`):

- **Reconstrução completa** na virada do dia local, quando o fuso muda ou quando há marca da organização. Roda em lotes de 250 operadores ativos e, no fim, apaga as marcas lidas no início.
- **Incremental** no resto do tempo: apaga exatamente as marcas lidas.
- Comando manual: `npm run analytics:rollup` (reconstrução completa). No dev, 2.271 operadores levam ~25 s.

**Leitura** (`infrastructure/operational-read-model.ts`, `readStructureWindows`):

- Snapshot REPEATABLE READ somente leitura quando recebe o pool.
- Um membro é calculado na hora pelo caminho original, no mesmo snapshot, quando:
  - tem marca pendente;
  - não tem linha;
  - as datas da janela não batem;
  - `valid_until` já passou (medição que começa depois do cálculo).
- Volta `null`, e a estrutura inteira passa pelo caminho original, quando há marca da organização ou mais da metade dos membros pendentes.
- `buildStructureOperationalSummary(db, input, { source: "read-model" | "raw" })` usa `StructureWindows` para as duas fontes.

**Último valor (LATEST):** desempate por `id desc` no SQL do resolvedor. Antes era arbitrário entre pessoas empatadas no último dia.

### Caches — `infrastructure/analytics-cache.ts`

O LRU tem limite por entradas e por peso.

**Resumo operacional:** chave com geração do read model, última marca, dia, comparação e impressão digital dos membros. Validade de 60 s. Só entra o que veio inteiro do read model, e só até a primeira medição futura.

**Camada oficial** (`application/official-analytics-cache.ts`):

- Guarda os derivados por estrutura × competência:
  - desempenho por membro;
  - indicadores de atenção;
  - unidades;
  - consolidados;
  - linhas de um indicador;
  - "Agrupar por".
- A chave leva:
  - as versões STRUCTURE e OFFICIAL;
  - viewer, conta, cargo e escopo de acesso;
  - sujeito e competência.
- Validade de 10 min; orçamento de 60 mil membros.
- Acompanhamentos e pendências são lidos a cada request.
- Os builders copiam antes de ordenar.

### 137 — índices de FK

Índices nas FKs que apontam para `interactions` e `indicator_measurements` e faziam varredura completa por linha apagada. É pré-requisito de qualquer expurgo.

### 138 — `ai_usage_daily`

- Mantido por trigger no insert e no update de `ai_usage_events`. DELETE do bruto não mexe: é o agregado permanente.
- `loadMonthSpend` soma os dias anteriores do resumo com o dia de hoje do bruto, o que vale para qualquer instante.
- A mediana de latência de 7 dias continua no bruto, porque não é somável.
- Os "15 s" eram a validade do cache em memória do runtime de IA, não polling.

### 139 e 142 — `outbox_events` descontinuada e apagada

- 139 (expandir): os 6 gravadores saíram do código; nunca houve leitor. A tabela ficou no banco porque servidores com o código anterior ainda gravavam.
- 142 (contrair; nasceu como 141 e foi renumerada no merge porque a 141 é a da versão no commit): `drop table outbox_events`, sem cascade, com as linhas históricas. A limpeza `derived:outbox_events` do reset da massa demo saiu junto.
- **Ordem obrigatória:** a 142 só roda quando nenhum servidor e nenhum teste em execução vier de código anterior à 139. Um servidor antigo falha ao publicar feedback e ao receber interação; provas antigas (`data-hub-proof` e as limpezas `delete from outbox_events` das provas de feedback) falham no `inia_test`.
- O outbox volta só com o primeiro consumidor real, já com `processed_at`, tentativas e expurgo.

### 140 — retenção (`modules/data-lifecycle`)

- `data_retention_policies`: **todas desligadas e sem prazo**. Ligar exige prazo, `decided_at` e `decided_by`.
- `data_retention_runs` guarda cada rodada.
- Catálogo em `domain/retention-catalog.ts`:
  - coluna de tempo;
  - regra de elegibilidade (alerta só `RESOLVED`);
  - filhos que saem junto;
  - proteções extras (`evidences.source_id`, `feedbacks.context_snapshot.interactionId`);
  - `protectedVia` (transcrição herda a proteção da interação);
  - `blockedReason`.
- A proteção por FK é lida do `pg_constraint` na hora: uma tabela nova que referenciar protege sozinha.
- Tarefa `data-retention`: de hora em hora, lotes de 5.000, 60 s por rodada.
- Bloqueadas mesmo se ligadas:
  - `indicator_measurements`: a FK `workflow_enrollments.indicator_measurement_id` é CASCADE;
  - `workflow_enrollments`: falta decidir o que acontece com saídas publicadas.

## Provas

### No banco de dev

Comando: `npx tsx scripts/dev/analytics-read-model-equality.ts [--only scope|activity|operational|official|ai]`. Só lê. Resultados em 13/10/2026:

- **Escopo:** 7.194 (2.398 pessoas × 3 permissões), todos idênticos.
- **Atividade diária:** 0 diferenças.
- **Resumo operacional:** 780 comparações (156 estruturas × 5 comparações), 0 diferenças.
  - O read model foi usado nas 780; nenhum membro calculado na hora.
  - Tempo total: original 535,5 s × read model 16,9 s.
  - Diretor no trimestre: 22,9 s → 113 ms.
- **Camada oficial:** 1.493 visões com cache = sem cache.
- **Gasto de IA:** 673 instantes, 0 diferenças.

### No banco de teste

Transação revertida.

**`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run analytics-read-model-proof`** (11 testes), com cenários de borda:

- férias;
- 6x1 com produção na folga;
- falta injustificada com `ZERO_CONTRIBUTION`;
- LATEST empatado;
- linhas HOURLY e CUSTOM;
- medição futura de hoje;
- pessoa sem medição.

Também cobre:

- membro pendente e `valid_until`;
- marca da organização;
- rebuild idempotente;
- triggers;
- troca de gestor;
- correção do fechamento oficial invalidando o cache;
- gasto de IA;
- organização inteira (7 dias e mês).

**`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run data-retention-proof`** (6 testes).

**`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run analytics-versions-proof`** (3 testes, 141). É a única prova desta área que grava de verdade: várias conexões, organização própria `7c000000-…-000000000001`, apagada no fim. Cobre:

- transação longa aberta não segura outro gravador;
- versão só muda no commit, uma por transação;
- rollback e savepoint desfeito não sobem nada;
- ordem cruzada STRUCTURE × OFFICIAL sem espera;
- o grafo em cache para quem gravou × para os outros.

Cada espera tem `lock_timeout` de 2 s, para falhar com erro de lock em vez de estourar o tempo. Controle negativo (13/10/2026): numa cópia só do esquema com a função da 128 de volta, os 3 casos falham (2 por lock, 1 porque o grafo dos outros foi trocado).

**Conferido no navegador** (13/10/2026, diretor da massa demo, 2.264 operadores, interface e API do worktree em `127.0.0.1` para não trocar o login de outras sessões):

- **Indicadores, 5 comparações pela API da tela:** de 35 a 252 ms.
  - Os números (valor atual e anterior, membros com dado e com dado suficiente, variação, elegíveis) são IGUAIS aos do caminho original no mesmo instante.
  - O caminho original levou de 1 a 52 s, com o banco de dev disputado.
- **Estrutura:**
  - `/team` em 42 ms;
  - páginas, ordenação e busca de `/team/members` em 12–22 ms (reaproveitam o cálculo);
  - membros de um indicador: 101 ms na primeira página, 11 ms nas seguintes.
- **Telas sem erro:** descida diretor → gerente sênior e Organograma, sem erro no console nem no servidor.
- **Provas em série:** rodar várias provas de banco EM PARALELO no mesmo banco de teste faz uma interferir na outra (transações longas, reconstrução da organização inteira). Rode em série, com `--no-file-parallelism`.

## Cuidados

- **Dev compartilhado:** os servidores de outros checkouts rodam código antigo e NÃO têm a tarefa `analytics-rollup`. Sem worker deste código, rode `npm run analytics:rollup`. Marcas pendentes não erram o número: só deixam aqueles membros mais lentos.
- **Triggers por statement disparam para qualquer gravador**, inclusive seed e scripts. Atualização em massa de `indicator_definitions` marca a organização inteira, e a próxima rodada é uma reconstrução completa.
- **Correção de estratégia ou unidade de um indicador** ([indicadores-e-estrutura.md](indicadores-e-estrutura.md)) não precisa de nenhum passo extra: o UPDATE marca a organização, a leitura cai no caminho original até a próxima rodada, e o cache do resumo muda de chave. Prova: `indicator-correction-proof`.
- **Cache da camada oficial e do grafo é por processo:** com várias instâncias, cada uma tem o seu. A chave tem a versão lida do banco, então nunca serve dado velho.
- **Não implementado de propósito:**
  - Rollup equipe×dia. O grão pessoa × janela respondeu em ~100 ms para 2,3 mil membros; medir antes de criar.
  - O componente "dias com dado" da estrutura inteira (distinct entre pessoas). A tela não mostra.
  - O painel do colaborador (uma pessoa). Continua no caminho original, que já é barato.

## Decisões em aberto (produto / LGPD)

Nenhum prazo foi decidido. A lista completa está no desenho, seção 4. Resumo:

- transcrições;
- interações;
- medições diárias;
- lineage;
- execuções de Workflow;
- `agent_runs`;
- uso de IA bruto;
- alertas resolvidos;
- `audit_logs`;
- conversas com a INIA;
- áudio PCM;
- evidência que segue o prazo do feedback.

**Antes de ligar medições:** mudar `workflow_enrollments.indicator_measurement_id` de CASCADE para SET NULL.
