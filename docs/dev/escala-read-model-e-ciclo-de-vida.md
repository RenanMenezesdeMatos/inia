# Escala — read model do analytics da liderança e ciclo de vida dos dados

> Desenho aprovado em 13/10/2026 e implementado no mesmo dia — estado, provas e cuidados em [memoria/read-model-e-ciclo-de-vida.md](memoria/read-model-e-ciclo-de-vida.md).
>
> Diferenças em relação ao texto abaixo, decididas na implementação:
> - `outbox_events`: os gravadores saíram na 139, mas a tabela ficou até a 142, que a apaga e só roda quando nenhum servidor com o código anterior estiver no ar.
> - `/supervisor/overview` foi removida pela sessão de consultas do caminho quente (mesmo arquivo).
> - O gasto do mês de IA soma os dias anteriores do resumo diário com o dia de hoje do bruto: o resultado é o da soma original para qualquer instante.
> - Migrations: 128, 129, 136–142.
> Origem: auditoria de escalabilidade para 600 usuários simultâneos e 4.000 cadastrados.
> Fora deste desenho, por estarem com outras sessões: consultas e índices pontuais (ex.: `/operator/overview`, `people.reports_to_id`) e operação com várias instâncias (limitador de IA global, contadores compartilhados, métricas).

## 1. Premissas e medições

**Volume previsto**

- 4.000 pessoas, ~3.800 operadores.
- ~60 chamadas por operador por dia, ou ~230 mil interações por dia.
- ~17 indicadores diários, ou ~65 mil medições por dia (~24 milhões por ano).

**Medido no banco de dev** (massa demo: 2.398 pessoas, 1,6 milhão de medições). Diretor João Lacerda: 2.385 pessoas abaixo dele, 2.264 operadores ativos.

| Tela / caminho | Tempo | Consultas |
|---|---|---|
| Indicadores da estrutura, comparação 7 dias | 2,9 s | 115 |
| Indicadores da estrutura, trimestre | 11,6 s | 115 |
| — elegibilidade (dias de trabalho), janela de 92 dias | 5,4 s | — |
| — medições, por indicador e janela (3 consultas × 18 indicadores, em sequência) | 20–630 ms | — |
| Equipe (`/team`), `/team/members`, `/indicators/:code/members` (camada oficial) | ~100 ms cada | 7–9 |
| Escopo do viewer | 34 ms | 4 + árvore em memória |

**Projeção para 4.000 pessoas com 17 indicadores diários**

- Indicadores da estrutura: ~5 s (7 dias) e ~20 s (trimestre) por clique.
- Camada oficial: ~476 mil linhas por clique (4.000 × 17 × 7 competências), ~0,7 s.

**Conclusão:** o gargalo é a camada operacional diária (elegibilidade + medições). A camada oficial é secundária, e o problema dela é repetir a carga inteira a cada paginação ou ordenação.

**Meta:** Indicadores da estrutura com 4.000 pessoas em menos de 300 ms com o read model em dia. Os números têm que ser idênticos aos de hoje.

## 2. Parte A — read model do analytics da liderança

### Princípio: idêntico por construção

O read model **não reimplementa regra**. Ele guarda os **componentes brutos** que o resolvedor único já calcula e aplica, na leitura, as mesmas funções de hoje:

- os componentes são os mesmos SQL de `aggregateColumns` e `eligibleMeasurementSql`;
- na leitura entram `finish`, `combineWindowComponents` e `isSufficient`.

Somar componentes é exato. Exemplos:

- Σ numerador e Σ denominador;
- `avg` = Σ valor ÷ contagem, que no PostgreSQL é a mesma divisão `numeric` do `avg()`;
- mínimo dos mínimos e máximo dos máximos.

Nada de média de médias, nada de `float` no banco. A elegibilidade continua vindo de `resolveWorkdaysBySubject`.

### Por que não "pessoa×dia×indicador" nem "equipe×dia×indicador" puros

- **Pessoa×dia×indicador:** com medição DIÁRIA, é 1:1 com `indicator_measurements`. Não reduz volume: a janela trimestral de um diretor continuaria lendo ~6 milhões de linhas.
- **Equipe×dia×indicador:**
  - Não responde "membros com dado" nem "membros com dado suficiente". Esses números dependem da janela inteira de cada pessoa e não se somam por dia.
  - Ficaria velho a cada mudança de `reports_to_id`.

O grão que resolve as telas é **pessoa × indicador × janela da comparação**. As janelas são as 10 que a tela oferece: atual e anterior de 7 dias, semana, mês, bimestre e trimestre. Elas são fixas para uma data local, e qualquer estrutura vira uma soma sobre os membros.

### A1. Escopo do viewer sem refazer a árvore

- Grafo de pessoas da organização em cache no processo: uma consulta ordenada por nome, com a mesma projeção de `PersonNode`.
- A chave do cache é a **versão de estrutura** da organização.
- `loadViewerScope` passa a derivar desse grafo, em memória:
  - a subárvore, com proteção contra ciclo;
  - as pessoas cobertas pela visibilidade de acesso.
- As atribuições de acesso da conta continuam lidas a cada request: são 1–2 consultas pequenas, e assim a autorização nunca fica velha.
- Desempate por `id` nas ordenações por nome, no caminho antigo e no novo. Sem isso, a ordem entre homônimos depende do plano da consulta.
- **Prova:** para TODAS as pessoas do dev, o escopo derivado é igual ao `loadViewerScope` atual (nós, filhos e ordem).

### A2. Versões por organização (invalidação exata dos caches)

- Tabela `analytics_versions (organization_id, domain, version)`, com dois domínios:
  - **STRUCTURE:** `people`, `teams`, `subteams`;
  - **OFFICIAL:** `employee_indicator_performance`, `employee_prv_performance`, `indicator_definitions`.
- A versão sobe por **trigger por statement** no próprio banco. É a única forma de cobrir todos os gravadores (Central de Dados, telas admin, seed, scripts), na mesma transação da escrita.
- Desde a migration 141, a versão sobe **no commit**: o statement só anota a pendência e um constraint trigger adiado aplica. Assim uma transação longa não segura os outros gravadores da organização (ver a memória da área).
- O request lê as versões numa consulta de uma linha.
- Cache por processo com versão na chave nunca serve dado velho, mesmo com várias instâncias.

### A3. Atividade diária por pessoa (evidência sem contar interações brutas)

- Tabela `person_daily_activity (person_id, local_date, organization_id, interaction_count)`, no fuso da organização.
- Mantida por trigger em `interactions` (insert, update e delete), na mesma transação, ordenada para não gerar deadlock.
- `loadWorkActivityEvidence` lê essa tabela. Hoje ela conta cerca de 60 linhas por pessoa por dia; o trimestre de um diretor seria ~24 milhões de interações.
- Se o fuso pedido for diferente do fuso com que a tabela foi montada, cai na consulta bruta atual.
- Vale para todos os consumidores (Calendário, Condition, Ranking, analytics). Contagem é exata, então nenhum número muda.
- **Prova:** contagem por pessoa × dia igual à consulta bruta, em dev e no banco de teste.

### A4. Janelas operacionais pré-agregadas por pessoa

**Tabelas**

1. `analytics_member_window`, por pessoa × comparação × fase:
   - `as_of_date`;
   - dias elegíveis;
   - dias de falta injustificada;
   - `valid_until`, preenchido só se existir medição com início ainda no futuro de hoje.
2. `analytics_member_window_indicator`, por pessoa × comparação × fase × indicador. Guarda os componentes brutos de `aggregateColumns`:
   - contagem, soma, mínimo e máximo;
   - último valor com `period_end` e `id`;
   - soma ponderada e peso;
   - Σ numerador e Σ denominador;
   - linhas com componentes e amostra;
   - dias com dado, medições ignoradas e dias de falta com dado.

**Construção**

- Uma função do resolvedor devolve os componentes brutos de N pessoas × todos os indicadores × as 10 janelas, numa consulta por lote.
- A elegibilidade é resolvida uma vez na união das janelas e recortada por janela. A elegibilidade de um dia não depende da janela nem de `now`.
- A consulta exige que a data local esteja dentro das datas da janela, como o predicado atual. Isso cobre também linhas fora do alinhamento diário (HOURLY, INTERACTION, CUSTOM).

**Atualização incremental e idempotente**

- Triggers gravam em `analytics_operational_dirty` (log só de inserção, quem escreve nunca espera) quando mudam:
  - medições de pessoa;
  - situação funcional;
  - escala;
  - regime;
  - exceções;
  - classificações;
  - admissão ou capital da pessoa;
  - a primeira e a última interação do dia (A3).
- Mudanças de feriados, política de feriado, fuso ou catálogo de indicadores marcam a organização inteira.
- A tarefa periódica `analytics-rollup` roda a cada 15 s com trava exclusiva:
  1. recalcula as pessoas marcadas, a partir da fonte;
  2. apaga exatamente as marcas que leu;
  3. depois da meia-noite local, refaz tudo para o novo `as_of_date`.
- O rebuild diário também corrige qualquer marca perdida.

**Leitura** (resumo operacional da estrutura)

- Numa transação somente leitura REPEATABLE READ, que dá um único snapshot:
  - pessoas sem marca pendente e com `as_of_date` de hoje são lidas do read model;
  - as demais, marcadas, novas ou recém-chegadas antes do rebuild, passam pelo caminho bruto atual só para elas.
- O total é a soma das duas partes. O resultado é sempre o do caminho antigo naquele snapshot; o read model só decide quanto custa.
- Somam-se, por estrutura:
  - o valor agregado de todos os membros;
  - "membros com dado";
  - "dado suficiente";
  - "membros elegíveis".
- Esses números saem das linhas por membro, com `finish` aplicado na leitura. O efeito de falta injustificada e a política por indicador continuam no mesmo lugar.

**Volume:** ~680 mil linhas para 4.000 pessoas. A leitura de um diretor é ~136 mil linhas estreitas por índice, contra milhões hoje.

**Determinismo do LATEST:** hoje o "último valor" consolidado de uma estrutura escolhe arbitrariamente entre pessoas com o mesmo `period_end`. Proposta: desempate por `id` no SQL atual, sem mudar nenhum resultado que não esteja empatado. Sem isso, não existe "idêntico" para LATEST.

### A5. Cache curto

- **Resumo operacional:** cache por organização + impressão digital dos membros + comparação + `as_of_date` + geração do read model + última marca pendente. Validade de 60 s.
- **Camada oficial, sem rollup.** O custo é aceitável e a soma em `float` do JavaScript não se reproduz exatamente em SQL. Cache dos derivados por organização + sujeito + competência + versões STRUCTURE e OFFICIAL:
  - desempenho por membro;
  - consolidados;
  - linhas por indicador.

  Paginar, ordenar ou buscar em `/team/members` e `/indicators/:code/members` passa a reaproveitar o cálculo. Contagens de acompanhamento e pendências continuam frescas a cada request.
- LRU com limite de memória.

### A6. `/api/v1/supervisor/overview`

O frontend não chama essa rota. A auditoria de segurança já a marcou como "Unbounded" (F-2). Ela calcula a média de todas as medições da organização, com 3 subconsultas por operador.

**Proposta:** remover a rota. `/supervisor/operators/:id` continua.

### Prova de igualdade

1. **Script no dev:** para TODOS os líderes (diretor, gerentes seniores, gerentes, coordenadores, supervisores) e para Grupos e Subgrupos, × as 5 comparações, com `now` fixo:
   - igualdade profunda do JSON das telas no caminho antigo × caminho novo;
   - medição de tempo e número de consultas.
2. **`INIA_DB_PROOF=1 … analytics-read-model-proof`**, no banco de teste. Cenários:
   - férias;
   - escala 6x1;
   - day off com produção;
   - falta injustificada com `ZERO_CONTRIBUTION` e com `NO_SAMPLE`;
   - LATEST;
   - linha fora do alinhamento diário;
   - pessoa marcada (fallback);
   - rebuild idempotente (rodar duas vezes não muda nada);
   - trigger de interação;
   - troca de gestor (escopo novo sem servir cache velho).

## 3. Parte B — ciclo de vida dos dados

Nenhuma tabela está particionada hoje, nem as `usage_*`: elas usam DELETE em lotes. Os volumes abaixo são para 4.000 pessoas, estimados pelo tamanho por linha da massa demo.

| Tabela | Volume estimado | Proposta | Bloqueios / pré-requisitos |
|---|---|---|---|
| `transcripts` | ~1 GB/dia (~4,4 kB por linha) — o maior volume | Retenção do texto por prazo; a interação fica | Dado pessoal do cliente final. **Prazo = decisão LGPD** |
| `interactions` | ~230 mil/dia, ~80 GB/ano | Retenção por prazo com DELETE em lotes (sem partição) | 13 FKs apontam para ela; 4 com NO ACTION bloqueiam apagar o que tem feedback/evidência; 8 FKs sem índice |
| `interaction_flags` | ~120 MB/dia | Some junto com a interação (CASCADE) | — |
| `indicator_measurements` | ~24 milhões/ano, ~24 GB | Retenção do diário por prazo, mínimo = maior janela de comparação + diagnóstico | `workflow_enrollments.indicator_measurement_id` é **ON DELETE CASCADE**: apagar medição apagaria histórico de execução. Mudar para SET NULL antes de qualquer expurgo |
| `data_lineage` | 1 linha por registro carregado | Retenção por prazo | Prazo de auditoria da carga = decisão |
| `workflow_enrollments` / `workflow_enrollment_events` | Proporcional aos gatilhos | Expurgo de execuções encerradas por prazo | Saídas publicadas (feedback) não podem perder a origem. Decisão |
| `ai_usage_events` (11 índices) | 1 linha por chamada de IA | **Rollup diário `ai_usage_daily` agora**; partição mensal + retenção do bruto depois da decisão | Nenhuma FK aponta para ela: é a melhor candidata a partição |
| `agent_runs` | Entrada e saída completas do LLM | Retenção por prazo | Pode conter dado pessoal. Decisão |
| `alerts` | — | Apagar lidos ou resolvidos depois de N meses; abertos nunca | Decisão de prazo |
| `audit_logs` | Pequeno | Retenção longa; **índice (organization_id, created_at) agora** | Prazo de auditoria = decisão |
| `assistant_interactions` (mensagens das conversas) | — | Retenção por prazo | Conflita com a regra "persistir toda interação para aprendizado". Decisão |
| Áudio PCM em bytea (`workflow_output_speech_audio`, `feedback_application_speech_audio`) | ~0,9 MB por recado | Expurgo do áudio N dias depois de entregue (o texto fica; regerar custa TTS) | Hoje só some em cascata. Decisão de prazo; armazenamento externo fica para depois |
| `data_raw_objects` | — | Já tem 30 dias | — |
| `usage_*` | — | Já tem retenção (desligada junto com a coleta) | — |

### O que entra já, sem depender de decisão

1. **Índices nas FKs para `interactions` e para `indicator_measurements`** que hoje fazem varredura completa a cada linha apagada:
   - `workflow_enrollments.interaction_id`;
   - `monitoring_triggers`;
   - `monitoring_evaluations`;
   - `operator_diagnostics`;
   - `interaction_feedback_generations`;
   - `reliable_feedback_artifacts` (as duas FKs);
   - `workflow_manual_runs` (as duas);
   - `call_assessments` e `call_criterion_assessments` (índice completo; o parcial `is_current` não serve à FK).
2. **`ai_usage_daily`**, mantida por trigger no insert (a tabela de eventos só recebe insert):
   - O gasto do mês em `ai-runtime-store.ts:176` passa a somar os dias, em vez de varrer o mês inteiro. Isso hoje roda quase a cada chamada quando existe orçamento com bloqueio.
   - A mediana de latência de 7 dias (`:79`) não é somável e fica no bruto, coberta pelo índice que já existe.
   - Correção da premissa: os "15 s" são a validade do cache em memória, não um polling.
3. **Mecanismo de retenção genérico**:
   - política por tabela (prazo, coluna de tempo, lotes de 5.000, preservação do que é referenciado);
   - tarefa periódica com trava, no mesmo padrão de `usage-retention.ts`;
   - **todas as políticas desligadas** até a decisão de prazo.

### `outbox_events` — recomendação: parar de escrever

**Situação hoje**

- 6 gravadores.
- Nenhum leitor.
- Nenhum `processed_at` preenchido.
- O conteúdo duplica estado que já existe em `interactions` e `feedbacks`.

**A arquitetura evolutiva** (`docs/arquitetura-evolutiva-inia.md:193`) pede outbox no banco + worker com filas lógicas, e infraestrutura nova só quando justificada. Hoje não há consumidor que a justifique. A fila que roda de fato é `workflow_enrollments` (SKIP LOCKED + lease).

**Proposta**

- Remover os 6 gravadores e a tabela.
- Registrar na arquitetura que o outbox volta junto com o primeiro consumidor real, já com `processed_at`, tentativas e expurgo.

**Alternativa:** manter os gravadores + um "consumidor" que só marca como processado + expurgo de 7 dias. Custa escrita sem uso.

### Partição mensal: onde faz sentido

- **Agora:** em lugar nenhum.
- **Depois das decisões:**
  - `ai_usage_events` (sem FKs apontando, alto número de índices, retenção natural por mês);
  - `audit_logs`, se o prazo for longo e o volume crescer.
- **`interactions`, `indicator_measurements` e `transcripts` não:**
  - particionar exige a coluna de tempo na chave primária e em cada FK que aponta para elas (13 para `interactions`);
  - o expurgo em lotes com índice nas FKs resolve o volume previsto.

## 4. Decisões em aberto (produto / LGPD)

Não invento prazos. Para cada item, é preciso um prazo ou "manter indefinidamente":

1. Transcrições (texto da chamada, com dado do cliente final).
2. Interações (metadados da chamada).
3. Medições diárias brutas. Sugestão técnica de mínimo: 13 meses, para comparar com o mesmo mês do ano anterior.
4. Lineage da Central de Dados.
5. Execuções de Workflow encerradas e seus eventos.
6. Execuções de Agent (`agent_runs`), com prompt e resposta completos.
7. Eventos de uso de IA brutos (o rollup diário fica).
8. Alertas lidos ou resolvidos.
9. `audit_logs`.
10. Conversas com a INIA. Hoje a regra é persistir tudo para aprendizado.
11. Áudio de recado e de aplicação de feedback depois de entregue.
12. Interação ou medição que é evidência de feedback publicado: segue o prazo do feedback (recomendação) ou o próprio?
13. `outbox_events`: parar de escrever (recomendação) ou manter com expurgo?

## 5. Etapas de implementação

1. **Base:**
   - versões por organização;
   - escopo derivado do grafo em cache;
   - desempate por `id`;
   - remoção de `/supervisor/overview`;
   - prova de igualdade do escopo para todas as pessoas.
2. **`person_daily_activity`** + backfill + leitura da evidência. Prova de contagem.
3. **Read model operacional:**
   - tabelas, triggers de marca e tarefa `analytics-rollup`;
   - leitura híbrida e desempate do LATEST;
   - prova antigo × novo em dev + `INIA_DB_PROOF`.
4. **Caches:** resumo operacional e derivados da camada oficial.
5. **Parte B sem decisão:**
   - índices de FK;
   - `ai_usage_daily`;
   - mecanismo de retenção desligado;
   - outbox conforme a decisão.
6. **Fechamento:**
   - migrations em `inia` e `inia_test`, conferindo o maior número antes de criar;
   - telas conferidas no navegador com o diretor;
   - typecheck, lint e testes;
   - memória da área atualizada.
