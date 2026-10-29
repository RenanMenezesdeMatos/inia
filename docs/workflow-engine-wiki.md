# Wiki do Workflow Engine

Documentação de referência do motor de Workflows da INIA — como ele é modelado, como executa e como cada tipo de nó se comporta. Escrita em português do Brasil.

## 1. Visão geral

Um Workflow é um **grafo dirigido** (`nodes` + `edges`), com exatamente um nó `trigger` e um ou mais nós `end`. Cada Workflow tem:

- **`draft_graph`**: o grafo em edição (`PUT /admin/workflows/:id/draft`), nunca executado.
- **`workflow_versions`**: cada `Publicar` congela o `draft_graph` numa nova versão (`workflow_versions.graph`) e aponta `workflows.active_version_id` pra ela. **Uma execução (`workflow_enrollment`) fica presa à versão em que ela começou** — editar e republicar o Workflow depois não afeta execuções já em andamento (elas terminam na versão antiga; só novas execuções usam a versão nova).
- **Configuração em rascunho × publicada** (migration 144): Gatilho, Abrangência e Modo de avaliação (Estrutura Consolidada / Filtro Populacional) também são rascunho — o editor grava `draft_trigger_config`, `draft_scope_type`… e o runtime (agendador, ingestão por Flag/Indicador, Executar agora, motor) só lê a configuração publicada (`trigger_config`, `scope_type`…). Editar um Workflow ativo nunca cria matrícula; `Publicar` copia rascunho → publicada junto com o grafo, na mesma transação, e registra a configuração na própria versão. Antes de pôr uma Agenda no ar (publicar um Workflow ativo ou ativar um publicado), a prévia de impacto (`GET /admin/workflows/:id/publish-impact`) mostra a população, o catch-up de hoje (horários de hoje já vencidos disparam na 1ª rodada do agendador) e o primeiro disparo; catch-up imediato ou mais de 50 pessoas com configuração nova exigem confirmação explícita (o pedido leva o `fingerprint` do impacto, senão 409).
- **População elegível (modo Individual)**: `Abrangência (ALL_TEAMS / TEAM / SUBTEAM) ∩ Filtro Populacional`. Todos os Triggers individuais — Agenda, Flag de canal, Indicador e Manual — e o QA Lab usam a MESMA regra (`workflow-eligibility.ts`): o Trigger muda como a execução começa, nunca quem pertence à população do Workflow.

### 1.1 Execução concorrente

O motor roda como um **worker contínuo** (`workflow-worker.ts`, iniciado em `server.ts`) sobre a própria tabela `workflow_enrollments` — ela é a fila:

- **Várias execuções ao mesmo tempo:** até `WORKFLOW_WORKER_CONCURRENCY` (padrão 8) matrículas por processo. Uma execução longa (ex.: investigação de indicador de ~12 min) ocupa uma vaga e nunca segura as outras.
- **Justiça entre workflows:** um workflow ocupa no máximo metade das vagas e o claim faz rodízio (a 1ª matrícula vencida de cada workflow antes da 2ª de qualquer um) — um fan-out de milhares de colaboradores não trava os outros workflows.
- **Sem espera entre nós:** quando um nó termina, a vaga é reaproveitada na hora; o próximo nó do fluxo roda em seguida. Sem trabalho, o worker varre a fila a cada 2 s.
- **Posse da matrícula:** quem reivindica uma matrícula (`skip locked`) a mantém com um heartbeat enquanto o nó roda (lease de 120 s renovada a cada 40 s, por compare-and-swap). Um nó nunca roda duas vezes em paralelo; se o processo morrer, a posse vence e outro worker retoma a matrícula.
- **Várias instâncias** do servidor podem rodar o worker no mesmo banco: cada matrícula vencida vai para exatamente um worker.
- **Proteções:** a publicação recusa um caminho que volta a um nó que chama a IA ("Chamar agente", "Gerar feedback", Orquestrador) sem passar por uma Espera (`WORKFLOW_PAID_CYCLE_WITHOUT_WAIT`; a Revisão humana reaproveita a decisão gravada e não segura a volta); o mesmo nó que chama a IA roda no máximo `WORKFLOW_MAX_PAID_NODE_RUNS` vezes (padrão 5) por execução — contado no banco, e no limite a execução é encerrada com `WORKFLOW_PAID_NODE_RUN_LIMIT` sem nova chamada (achado C06 da 4ª auditoria); ciclo entre nós sem Espera não vira laço quente (> 30 nós da mesma matrícula em 60 s → 60 s de pausa); falha técnica de uma matrícula não derruba as outras; ao desligar, o worker espera até 10 s pelas execuções em andamento e o resto é retomado quando a posse vencer.

### Tipos de nó

| Nó | Papel |
|---|---|
| `trigger` | Início do fluxo — QUANDO o Workflow começa a rodar (nunca QUAIS dados analisar) |
| `wait` | Pausa por uma duração fixa |
| `condition` | Ramifica o fluxo (`Sim`/`Não`, e opcionalmente `Sem dados`) a partir de um valor — trigger bruto, resultado de um nó anterior, Variável do Workflow, histórico de indicador ou performance |
| `action` | `CALL_AGENT` (chama um Agente de IA), `SET_VARIABLE` (define uma Variável do Workflow, fixa ou dinâmica), `ESCALATE` (encaminha/eleva responsabilidade — Destino + Conteúdo + Superfície) |
| `orchestrator` | Chama um Orquestrador (múltiplos Agentes coordenados), produz `structuredResult` tipado |
| `human_review` | **Único nó que pausa o Workflow** esperando uma decisão humana (Aprovar/Reprovar/Escalar) |
| `output` | Entrega conteúdo pra uma ou mais Superfícies (Acompanhamento, Avatar, Chat, Pendências, Notificação) |
| `end` | Encerra o fluxo |

### Resolução hierárquica (Human Review e Escalonar)

Ambos usam o mesmo `HierarchicalTarget`: cargo relativo ao operador da ocorrência, cargo relativo a quem decidiu uma Revisão Humana anterior no mesmo fluxo, ou uma pessoa específica. A navegação sobe `people.reports_to_id` a partir do ponto de partida escolhido.

### Escalonar × Output × Revisão Humana

| | Output | Revisão Humana | Escalonar |
|---|---|---|---|
| Intenção | "Entregue este conteúdo" | "Pause e aguarde uma decisão humana" | "Encaminhe/eleve esta ocorrência e entregue o conteúdo" |
| Pausa o Workflow? | Não | Sim — único nó que faz isso | Não, nunca |
| Depois de executar | Segue pela edge "always" | Aguarda decisão | Continua ou encerra o branch, conforme configurado |

## 2. Trigger "Por agenda"

O Trigger "Por agenda" tem duas famílias, escolhidas pelo campo `mode`:

- **`CALENDAR`** (ou `mode` ausente = comportamento legado): recorrência de calendário — Diariamente/Semanalmente/Mensalmente/A cada X dias, o mesmo horário pra todo mundo do escopo. Seção 2.1.
- **`RELATIVE_TO_SHIFT`**: agendamento relativo ao expediente PREVISTO de cada colaborador — o mesmo Workflow dispara em horários DIFERENTES por pessoa, calculados a partir da jornada de cada um. Seção 2.2.

Em ambas as famílias, o Trigger só responde **"QUANDO executar?"** — nunca decide **"O QUE avaliar"**; isso é sempre papel da Condition.

### 2.1 Agenda de calendário

### Princípio fundamental: Agenda ≠ Histórico

**O Trigger responde "QUANDO executar?". A Condition (e sua query histórica/de performance) responde "O QUE avaliar, sobre qual período?".** A Agenda nunca carrega período de análise (últimos 30 dias, últimos 3 fechamentos, etc.) — isso pertence exclusivamente à Condition.

Exemplo correto:

```
Trigger: Todo dia às 09:00
  -> Condition: Média da Nota URA nos últimos 30 dias < 3,3
```

```
Trigger: Todo mês, dia 5, às 09:00
  -> Condition: Atingimento do PRV consolidado < 80%
```

O Trigger não sabe (nem precisa saber) o que é PRV ou o que significa "últimos 3 fechamentos" — ele só dispara na data/hora certa; a Condition decide o resto.

### Frequências suportadas

Configuradas em `trigger.frequency` (schema `ScheduleFrequency`, discriminado por `type`):

- **Diariamente** (`DAILY`) — todo dia, nos horários configurados.
- **Semanalmente** (`WEEKLY`) — nos dias da semana marcados (`weekdays: ["MON","WED","FRI"]`, por exemplo), nos horários configurados. Múltiplos dias são somados (não é preciso um Workflow por dia).
- **Mensalmente** (`MONTHLY`) — por `mode`:
  - `DAY_OF_MONTH` + `day` (1–31): um dia fixo do mês.
  - `LAST_DAY`: sempre o último dia do mês, seja ele 28, 29, 30 ou 31.
- **A cada X dias** (`EVERY_N_DAYS`) — usa o campo `intervalDays` já existente desde a implementação original, contado a partir de uma `anchorDate` estável (ver abaixo).

### Múltiplos horários

`times: string[]` (1 a 12 horários, formato `HH:mm`) é comum a todas as frequências — qualquer uma delas pode disparar em mais de um horário no mesmo dia (ex.: `09:00` e `15:00`). O formulário impede horários duplicados (mensagem amigável, nunca erro técnico de schema).

### `anchorDate` — a âncora do "a cada X dias"

`anchorDate` é carimbada automaticamente com a data de hoje **na primeira vez** que o Trigger vira `schedule` (criação, ou primeira edição que define um Trigger por agenda) e **nunca muda depois**, mesmo que horários/intervalo sejam editados — evita reiniciar o ciclo de contagem a cada edição. A contagem em si (`diasDesdeAAncora % intervalDays === 0`) só é consultada quando a frequência é `EVERY_N_DAYS` (explícita ou legada).

### Dia inexistente no mês

Um `day` (Mensal, `DAY_OF_MONTH`) que não existe no mês corrente — por exemplo, `31` em abril, que só tem 30 dias — **nunca dispara naquele mês**. A ocorrência é simplesmente pulada; o motor nunca cai silenciosamente pro dia 30, nem escorrega pro mês seguinte. Quem precisa de "sempre o último dia, independente de quantos dias o mês tem" usa `mode: LAST_DAY`, que é calculado corretamente para meses de 28, 29, 30 ou 31 dias.

### Timezone

O checador (`schedule-check.ts`) resolve a timezone da organização a partir de `operations.timezone` (coluna que já existia desde o schema inicial, com o valor `America/Fortaleza` já populado, mas que nenhum código lia até esta evolução) — nunca UTC hardcoded, nunca uma configuração nova. Se por algum motivo não houver nenhuma `operation` cadastrada, cai no mesmo default que a própria coluna do banco usa. Todo cálculo de "que dia é hoje" / "que horas são agora" / "converter uma data+hora local pro instante UTC certo" é feito com `Intl.DateTimeFormat` nativo do Node (sem biblioteca externa — o projeto não tinha nenhuma lib de data antes desta evolução, e ela sozinha não justificaria adicionar uma).

### Preview de próximas execuções

O formulário mostra as próximas ~5 execuções calculadas, chamando `POST /admin/workflows/schedule-preview`, que roda a **mesma função** (`nextOccurrences`/`isDateDue`, em `schedule-recurrence.ts`) que o checador real usa pra decidir se hoje é um dia de disparo — nunca uma segunda implementação divergente calculando datas em JavaScript no navegador.

### Retrocompatibilidade com agendas legadas

Workflows criados antes desta evolução têm `trigger_config` sem o campo `frequency` — isso é lido como **comportamento legado**, não um erro: `intervalDays > 1` sempre significou "a cada N dias" (agora mapeado pra `EVERY_N_DAYS`), e `intervalDays === 1` sempre significou "todo dia" (`DAILY`). Nenhuma migração de dados foi necessária — o schema apenas ganhou um campo opcional a mais, lido de forma explícita em cada lugar que importa (nunca um `.default()` do Zod, que quebraria a distinção entre "ausente" e "valor explícito").

### Idempotência

Cada matrícula (`workflow_enrollment`) nascida da Agenda tem uma combinação única de `(workflow_id, operador, scheduled_for)`, garantida por um índice único no banco (`workflow_enrollments_schedule_slot_uk`). Rodar o checador mais de uma vez antes do próximo horário nunca duplica uma matrícula — o `insert ... on conflict do nothing` simplesmente não insere de novo.

### Comportamento após indisponibilidade (restart, deploy, queda do serviço)

O checador roda a cada 60 segundos (em `server.ts`, sem sobrepor uma rodada à seguinte; ao terminar, acorda o worker do motor) e, a cada rodada, pergunta "que horários de HOJE já venceram e ainda não foram matriculados?" — nunca "o que eu perdi desde a última vez que rodei".

- **Se o serviço cair e voltar dentro do MESMO dia**: todos os horários já vencidos daquele dia são recuperados de uma vez na primeira rodada depois que o serviço volta (catch-up). Nenhuma execução do dia é perdida.
- **Se o serviço ficar fora do ar atravessando a virada do dia** (por exemplo, caiu às 23h de terça e só voltou às 8h de quinta, pulando o dia inteiro de quarta): a ocorrência de quarta-feira **é perdida permanentemente** — o checador nunca olha pra trás de "hoje".
- Em nenhum dos dois casos há duplicação (garantida pelo índice único acima) nem disparo de uma data muito antiga fora de hora.

Essa política já existia implicitamente na implementação original (era só nunca documentada) e foi deliberadamente preservada, não alterada, por esta evolução.

### Publicar, editar e desativar

- **Editar/republicar a Agenda** tem efeito imediato — o checador sempre lê `trigger_config` direto da linha vigente do Workflow (nunca uma cópia congelada), então não existe risco de "duas agendas ativas ao mesmo tempo": ao salvar um novo horário, o horário antigo simplesmente deixa de existir.
- **Desativar** (`active = false`) ou **despublicar** um Workflow tira ele da lista de elegíveis do checador imediatamente — a query já filtra `w.active and w.active_version_id is not null`. Desativar também PARA as execuções em andamento: o motor não reivindica matrícula de Workflow desativado; elas ficam no nó em que estavam e seguem quando ele for reativado (C06).
- **Excluir** um Workflow remove em cascata todas as suas matrículas (FK `on delete cascade`).
- **Testar antes de publicar:** Workflows podem ser testados em rascunho no QA Lab (`/admin/simulate`, exclusivo do administrador global) antes da publicação — o QA Lab executa o rascunho atual (ou, explicitamente, a versão publicada) com a mesma engine, congelando um snapshot da configuração testada em cada execução. Execuções QA não ativam o checador de agenda, não criam matrícula em `workflow_enrollments` nem geram efeitos operacionais (alertas, feedbacks, outputs, `agent_runs`): publicar continua sendo a única forma de colocar um Workflow em operação.

### Validações (mensagens sempre amigáveis, nunca erro técnico de schema)

| Cenário | Mensagem |
|---|---|
| Nenhum horário adicionado | "Adicione pelo menos um horário." *(bloqueado no próprio formulário)* |
| Semanal sem nenhum dia marcado | "Escolha pelo menos um dia da semana." *(bloqueado no próprio formulário)* |
| Mensal (Dia do mês) sem o dia escolhido | "Escolha o dia do mês." |
| Horários repetidos | "Horários repetidos não são permitidos." |

Em runtime, um Target de Escalonar/Revisão Humana que não resolve pra ninguém (ex.: cargo que não existe na hierarquia daquele operador) nunca falha silenciosamente nem entrega pro destinatário errado — o nó registra uma falha controlada (`node_failed`, com mensagem clara), o motor tenta de novo com backoff (até 5 tentativas) e, se continuar falhando, marca a execução como `dead`.

### 2.2 Agenda relativa ao expediente do colaborador

Permite Workflows como "15 minutos depois que o colaborador entrou", "na metade do expediente dele", "30 minutos antes de ele sair" — cada colaborador tem entrada e carga horária diferentes, então o MESMO Workflow dispara em horários INDIVIDUAIS diferentes por pessoa. `trigger.relative` (`{ anchor: "START" | "PERCENTAGE" | "END", offsetMinutes?, percentage? }`) descreve o momento de forma genérica — nunca um enum rígido por preset (`AFTER_15_MINUTES`, `HALF_SHIFT` etc.):

- **`START` + `offsetMinutes`**: X minutos após o início do expediente.
- **`PERCENTAGE` + `percentage`** (0 a 100, ambos inclusive): percentual da jornada prevista — 0% é o início, 100% é o fim. A UI oferece presets (Início/25%/Meio/75%/Final) que só preenchem esses dois campos, sem criar uma regra própria por preset.
- **`END` + `offsetMinutes`**: X minutos antes do fim do expediente.

#### Expediente PREVISTO × login real

**Muito importante**: hoje não existe telemetria real de login/logoff do colaborador. Todo cálculo usa exclusivamente `horário de entrada previsto + carga horária prevista`. Por isso o sistema nunca chama isso de "tempo logado" — o termo correto, usado em todo o código e na UI, é **"jornada prevista"** ou **"expediente previsto"**. Um colaborador que efetivamente ficou conectado por menos tempo (ou nem entrou) ainda assim tem seu expediente previsto calculado normalmente — o Trigger não sabe (e não afirma saber) se ele realmente estava online. Uma origem futura baseada em login real poderia ser adicionada sem quebrar esse conceito (um novo `anchor` ou uma nova origem de jornada, mantendo a mesma interface).

#### Jornada do colaborador — modelo de dados

Nova tabela `employee_work_shifts` (não colunas soltas em `people`): `person_id`, `start_time`, `work_minutes` (carga horária em MINUTOS, nunca string livre), `effective_from`/`effective_to` (vigência — permite a jornada mudar ao longo do tempo mantendo histórico, sem precisar de redesenho). Pra uma data, a jornada vigente é a linha com `effective_from <= data and (effective_to is null or effective_to >= data)`.

- **Sem coluna de dias de trabalho** nesta versão — a aplicação assume **Segunda a Sexta** como dias úteis (`isAssumedWorkday`, `shift-schedule.ts`), limitação só pra massa de desenvolvimento/teste. Uma integração futura com escala/calendário real substituiria só essa função, sem tocar no resto da calculadora.
- **Jornada que atravessa a meia-noite** (ex.: entrada 22:00, 8h de carga) é calculada corretamente — o fim é sempre `início + duração` usando `Date`, nunca comparando só relógios, então resolve pro dia seguinte sem ambiguidade.
- **Colaborador sem jornada cadastrada nunca é matriculado** — nunca inventa um horário padrão. O preview mostra quantos colaboradores do escopo têm jornada válida e quantos não têm.
- **Configuração incompatível com a duração da jornada** (ex.: "5h após o início" numa jornada de 4h) nunca dispara fora do expediente — a ocorrência é pulada pra aquele colaborador especificamente, mesmo princípio já usado pro dia-do-mês inexistente na Agenda de calendário.
- **Mudar a jornada de alguém** (`PUT /admin/users/:id/shift`) nunca faz UPDATE destrutivo — fecha a linha vigente (preserva histórico) e insere uma nova a partir de hoje. Como o checador sempre lê a jornada vigente de HOJE, fresca, a cada tick (nunca uma cópia congelada), a próxima ocorrência já usa a jornada nova automaticamente — não existe "job órfão" pra invalidar.

#### Como o checador escala (sem cron por colaborador)

O mesmo checador de 60s que já resolve a Agenda de calendário (`schedule-check.ts`) ganhou só mais um branch: em vez de comparar um horário FIXO contra o relógio, ele resolve os colaboradores elegíveis do escopo (mesma query de sempre), busca a jornada vigente de cada um em UMA query em lote, calcula o instante individual de cada um e matricula quem já venceu. Mesma idempotência (índice único `workflow_id + colaborador + scheduled_for`), mesmo catch-up dentro do mesmo dia, nenhuma infraestrutura nova de scheduler — a complexidade por tick continua sendo O(Workflows por agenda × colaboradores do escopo), a mesma ordem de grandeza que a Agenda de calendário já tinha.

#### Contexto de execução

Quando a matrícula tem um colaborador com jornada cadastrada, o nó Trigger grava em `nodeOutputs.trigger` (mesmo mecanismo de "Valor do gatilho" de sempre — nenhum resolvedor novo): `employeeId`, `scheduledShiftStart`, `scheduledShiftEnd`, `scheduledWorkMinutes`, `triggeredAt`, `elapsedScheduledPercent`. Qualquer node seguinte pode referenciar, por exemplo, `nodeOutputs.trigger.elapsedScheduledPercent` do mesmo jeito que já referenciaria qualquer outro resultado — via `resolveSource`, sem UI dedicada de seleção de campo nesta versão (limitação atual — ver seção 3).

#### Preview

Como os horários variam por pessoa, o preview não mostra uma lista de datas — mostra até 5 exemplos por colaborador (`João Silva — 08:15`, `Maria Santos — 09:15`, ...) mais o total de colaboradores elegíveis no escopo e quantos não têm jornada configurada. Calculado pela MESMA função (`resolveRelativeInstant`) que o checador real usa.

## 2.3 Trigger "Manual" (Executar agora)

O Workflow só começa quando alguém com `workflows.manage` no escopo dele clica em **Executar agora** (editor do Workflow) e escolhe UM colaborador. Não tem horário, flag nem evento de chegada de indicador; salvar, publicar, reiniciar o serviço ou ingerir dados nunca disparam um Manual (a ingestão por Flag/Indicador e o checador de Agenda filtram pelo próprio `kind`).

### Contrato (`trigger-config-schema.ts`)

`{ kind: "manual", context: "COLLABORATOR" | "INTERACTION" | "INDICATOR_MEASUREMENT", indicatorCode? }` — `context` declara QUAL dado real cada disparo traz; `indicatorCode` só existe (e é obrigatório) com medição. A **origem de dados** (`triggerDataOriginOf`) é a pergunta que a validação de publicação, o domínio do feedback e o editor fazem: interação ≈ `channel_flag`, medição ≈ `indicator`, colaborador ≈ `schedule` individual. Por isso as regras continuam as mesmas: Avaliação/Conformidade de processo e feedback de monitoria exigem interação; feedback/diagnóstico de indicador exige medição; Manual por colaborador exige `scheduledDataSource` no "Chamar agente"; Condition sobre o "valor do gatilho" só com medição (valor = valor da medição; com interação não há valor de flag). Manual nunca é Consolidado nem aceita Filtro Populacional.

### Disparo (`manual-run.ts`, migration 100)

- `workflow_manual_runs`: quem (`requested_by`), quando, Workflow, **versão publicada** (`version_id`), colaborador, interação/medição e `idempotency_key` (unique por Workflow × quem × chave). A matrícula aponta de volta (`workflow_enrollments.manual_run_id`, unique): a origem manual continua identificável mesmo com interação/medição associada. `workflow_enrollments_source_check` não mudou — a matrícula tem exatamente uma origem de dados (`interaction_id` | `indicator_measurement_id` | `scheduled_subject_id`, este com `scheduled_for` nulo).
- Validação no backend: workflow Manual, publicado, ativo e Individual; colaborador no escopo de `workflows.manage` de quem dispara (fora = 404) E elegível pelo Workflow (operador ativo, Abrangência ∩ Filtro Populacional — mesma função da ingestão); interação da organização, DO colaborador e com transcrição; medição PERSON do colaborador e do indicador do gatilho. Nada é fabricado.
- Idempotência: a tela gera uma chave por abertura do diálogo. Reenvio com a mesma chave devolve o mesmo disparo (inclusive em corrida — `on conflict do nothing` + releitura); a mesma chave com outro colaborador/contexto = 409 `WORKFLOW_MANUAL_RUN_IDEMPOTENCY_CONFLICT`. Nova execução intencional = chave nova.
- Rastro: evento `manual_run_requested` na matrícula e `audit_logs` `WORKFLOW_MANUAL_RUN_REQUESTED`. Estratégia de diagnóstico do indicador fica presa na execução (mesma regra do gatilho por Indicador).
- Execução: a matrícula nasce parada no nó Gatilho e segue pelo motor normal (o worker contínuo — ver §1.1). O disparo novo acorda o worker na hora (`signalWorkflowWork`); os nós seguem um após o outro sem esperar varredura; ao esperar (Revisão humana, QA de feedback, Espera) a matrícula volta quando vencer.

### API (`/api/v1/admin/workflows/:id/…`)

`GET manual-run` (contexto, indicador, impedimentos, últimos disparos) · `GET manual-run/collaborators?search=` · `GET manual-run/interactions?collaboratorId=&search=` · `GET manual-run/measurements?collaboratorId=` · `POST manual-runs` `{ collaboratorId, interactionId?, indicatorMeasurementId?, idempotencyKey }` (201 novo / 200 reenvio) · `GET manual-runs/:runId` (estágio `QUEUED | PROCESSING | RETRYING | WAITING | COMPLETED | FAILED`, motivo da espera, erro, eventos e entregas persistidas — `workflow_outputs` e `workflow_output_emissions`). "Solicitado" nunca é "entregue": no Avatar, `PENDING` = convite disponível; `DELIVERED` só depois da fala terminar. Execuções e Resultados mostram a origem ("Manual · colaborador · por quem"; `TriggerKind` `MANUAL`).

### QA Lab

Workflows Manual também são simuláveis (rascunho ou publicada, zero efeito): interação sem flag (lista de interações do colaborador com transcrição), medição do indicador do gatilho ou só o colaborador — a mesma linha de matrícula que o "Executar agora" grava, em memória.

### Provas

`workflows/application/manual-trigger.test.ts` (contrato, publicação pela origem, impedimentos, estágios) e `INIA_DB_PROOF=1 npx vitest run manual-run-proof` (API real + motor: criação, bloqueios, permissões, elegibilidade, contexto, idempotência — inclusive concorrência real —, execução até o fim, origem em Execuções/Resultados, ingestão sem disparo). Frontend: `manual-run-dialog.test.tsx`, `trigger-fields.test.ts`, `workflow-validation.test.ts`.

## 3. Medição operacional × Fechamento oficial (camadas de indicadores)

A INIA tem duas camadas de indicadores que nunca se misturam:

| | Camada 1 — MEDIÇÃO OPERACIONAL | Camada 2 — FECHAMENTO OFICIAL |
| --- | --- | --- |
| Tabela | `indicator_measurements` (granularidade DAILY; MONTHLY/CUSTOM legado; HOURLY/INTERACTION preparadas) | `employee_indicator_performance`, `employee_prv_performance` |
| Origem | medições diárias por colaborador (numerador, denominador, amostra + valor apresentável) | competência mensal recebida pronta da empresa |
| A INIA | agrega (média ponderada, taxa, soma, último valor, min, max, contagem), compara janelas, ranqueia, calcula **quartil operacional** | só lê: valor oficial, `achievement_percent`, `quartile` oficial, `weight_percent`, PRV |
| Serve para | hoje, ontem, últimos N dias, semana/mês corrente ou anterior, tendência, ranking operacional | valor oficial da competência, atingimento, quartil oficial, PRV, peso |

Regra de ouro: a INIA **nunca** fabrica atingimento oficial, PRV, quartil oficial ou peso. Não existe "PRV diário" nem "peso diário".

### Semântica temporal da medição
`period_start`/`period_end` são o intervalo de negócio (nunca `created_at`). Uma medição pertence a uma janela quando o intervalo dela **sobrepõe** a janela (`period_start < fim` e `period_end > início`). Componentes (migration 052): `numerator`, `denominator`, `sample_count`; `granularity`.

### Agregação por semântica (`indicator_definitions.operational_aggregation`)
- `WEIGHTED_AVERAGE` — Σ numerador ÷ Σ denominador (TMA, TMT, TEMPO_DIAGNOSTICO, MONITORIA_QUALIDADE, QUALIDADE_ANALISE, NOTA_URA, NPS).
- `RATE` — Σ ocorrências ÷ Σ elegíveis × 100 (FCR, REINCIDENCIA_7D, TAXA_TRANSFERENCIA, TAXA_RETRABALHO, TAXA_RETENCAO, RECONTATO_CANCELAMENTO, SLA_24H, ADERENCIA, TEMPO_DISPONIVEL).
- `LATEST` — snapshot mais recente (BACKLOG). `SUM`/`AVERAGE` — soma/média simples (só quando o período já é uma média sem volume).
- Agregações permitidas por semântica: `indicators/domain/operational-aggregation.ts`; o editor só oferece essas e o publish rejeita o resto. Linhas legadas sem componentes pesam 1 (média simples) — nunca inventam volume.
- Um único resolvedor (`indicators/application/operational-measurement-resolver.ts`) atende Condition, Ranking VALUE/CHANGE (em lote, sem N+1), quartil operacional, QA Lab e contexto do assistente. Devolve valor + evidência: janela, método, `sampleCount`, `daysWithData`, `expectedDays`, `coverage`, numerador/denominador.

### Janelas temporais (`workflows/application/time-window.ts`, calendário local = timezone IANA da organização)
- Timezone: `operations.timezone` (IANA — `America/Fortaleza`, `America/Sao_Paulo`…), resolvido uma vez por avaliação (`organization-timezone.ts` → `EvaluationOptions.timeZone`) e propagado pelo contexto — nunca offset fixo −03, nunca lógica manual de horário de verão (a base de fusos do runtime decide), nunca string repetida em cada consulta. Fallback explícito e documentado: `DEFAULT_ORGANIZATION_TIMEZONE = "America/Fortaleza"` — nunca UTC silencioso. Testes cobrem 23:30 local × UTC, virada de dia/semana/mês em Fortaleza, São Paulo, UTC.
- **Últimos N dias**: os N dias de calendário terminando hoje (hoje parcial incluído): `[início do dia local de hoje − (N−1) dias, agora)`. Dias corridos. Janela anterior: os N dias imediatamente anteriores.
- **Hoje/Ontem**, **Semana/Mês corrente ou anterior**: períodos civis (corrente = parcial até agora).
- **Últimos N meses fechados**: N meses civis completos; o agregado é da união (Σ ÷ Σ), nunca média das médias mensais; mês esperado sem medição = SEM DADOS.
- Fontes oficiais (Atingimento/PRV) não aceitam Hoje/Ontem/semana nem janelas < 28 dias — só fechamentos ou períodos mensais.
- Variação percentual: `(atual − anterior) ÷ anterior × 100` (`percentageChange`, única fórmula); anterior zero = SEM DADOS. LOWER inverte o sinal na variação de performance.
- SEM DADOS: janela sem medição, denominador zero, sem janela anterior. Cobertura só vira regra quando configurada (`minimumCoverage`, abaixo) — nunca silenciosa (o mínimo de medições continua sendo `minimumSampleSize` explícito).

### Mês fechado × mês corrente — regra explícita
Fechamento oficial só existe para **mês civil completo**: em 16/09/2026 o último fechamento é agosto e "últimos 6 fechamentos" = março..agosto (`closedCalendarMonths`/`lastClosedPeriod`, derivados do relógio no fuso da organização). O mês corrente existe **só na camada operacional** (medições diárias até hoje). Nenhuma tela, texto, feedback ou modelo chama o mês corrente de "fechamento" — é "acompanhamento" / "últimos N dias". A massa demo deriva as 6 competências fechadas da data de referência (`closedReferencePeriods`), nunca de uma lista fixa; o seed legado 001 também nunca insere competência ≥ mês corrente.

### Guard central do fechamento oficial (`indicators/domain/official-closure-policy.ts`)
`referencePeriod <= lastClosedReferencePeriod(now, tz)` é a ÚNICA regra, temporal, independente da origem da linha (DEMO_SEED, MANUAL_SEED, API…). Aplicada em: resolvedores de performance (Condition/Ranking oficiais, recorrência de quartil, últimos N fechamentos, histórico por janela — clamp do último mês), API de performance oficial, Agents com performance por agenda, contexto simulado do QA Lab, Analytics (seletor de competência, período padrão, período pedido). Uma linha de 09/2026 existe em 16/09 e é ignorada; passa a valer em 01/10 (`official-closure-policy.test.ts`).

### Situação funcional e elegibilidade (`people/domain/employment-status.ts`, migration 058)
`people.current_employment_status` (ATUAL) + `employee_status_periods` (histórico: ACTIVE/VACATION/LEAVE/INACTIVE normalizados, `raw_status`, `effective_from/to`, `effective_from_inferred`, `observed_at`, `source_updated_at`, `source`; exclusion constraint). Separado de `people.active` (conta). Serviço canônico `applyEmployeeStatusSnapshot` (idempotente; sem data efetiva = data local da observação, nunca retroage; datas explícitas corrigem limites; mudança fecha o período anterior na véspera). Política única `isOperationallyEligibleStatus` (só ACTIVE) — a lista de não elegíveis entra como parâmetro no SQL do resolvedor de medições (`ELIGIBILITY_CLAUSE`): medição em dia não elegível fica no banco e sai de todo cálculo. Situação NUNCA recalcula fechamento oficial.

### Cobertura mínima (`minimumCoverage`, fração 0.01–1)
- Cobertura = dias com medição ÷ **dias elegíveis** na janela: dia útil (seg–sex no calendário local) ∧ >= `people.hired_at` ∧ situação funcional elegível no dia (`resolveEligibleDaysBySubject` devolve dias úteis, elegíveis, excluídos por admissão/status e datas). Admitido no meio da janela: 3 de 3 = 100%; férias qua–sex com medição seg/ter: 2 de 2 = 100% (não 2/5); férias a janela inteira: 0 elegíveis = SEM DADOS `NO_ELIGIBLE_DAYS` (nunca 0, nunca Q4; sai de ranking e quartil).
- Padrão do indicador × regra do Workflow: `IndicatorDefinition.minimumCoverage` é o padrão (Analytics/Profile usam ele; o editor pré-preenche); o Workflow/versão guarda o próprio valor (catálogo 60%, Workflow 80% → runtime 80%). Sem cobertura no catálogo, a tela usa só `minimumSampleSize`; sem nenhum, nada é inventado (o antigo 40% fixo da tela não existe mais).
- Disponível em Condition (Valor do indicador e Quartil operacional) e Ranking sobre medições; fontes oficiais e COUNT rejeitam o campo no publish. Abaixo do mínimo = SEM DADOS (`BELOW_MINIMUM_COVERAGE`) — nunca 0, nunca Q4; no Ranking/quartil o colaborador sai da população ranqueada (contado como SEM DADOS).
- Trace do QA: dias elegíveis, dias com dados, cobertura, mínimo, resultado. Testes: 7/7, 5/7 (60%), 3/7, 1/7, 0/7 e ausência justificada por admissão (`coverage.test.ts`).

### Quartil operacional (`indicators/domain/operational-quartile.ts`) — ≠ quartil oficial
População = Abrangência ∩ Filtro populacional (ou a coleção anterior); ordena pela direção oficial (HIGHER: maiores = Q1; LOWER: menores = Q1; TARGET bloqueado); quartil = ceil(4 × posição ÷ n); empates na mesma posição e no mesmo quartil (1, 2, 2, 4), id só como ordenação estável; menos de 4 com dados = ninguém classificado (`INSUFFICIENT_POPULATION`); SEM DADOS fica fora (nunca Q4 por omissão). Na UI: "Q4 operacional — últimos 7 dias", sempre com janela, população, fonte e método.
"Q4 oficial de agosto" (fechamento corporativo) ≠ "Q4 operacional dos últimos 7 dias" (cálculo da INIA). "Q4 recorrente" continua sendo Q4 **oficial** em fechamentos consecutivos.

**Condition `source: OPERATIONAL_QUARTILE`** (`workflows/application/operational-quartile-resolver.ts`, compartilhado com o Ranking): população = Abrangência ∩ Filtro populacional ou a coleção anterior (`ConditionSubject.populationIds`, resolvida em `node-handlers.resolveConditionPopulation` e na prévia do QA), UMA resolução em lote por população com cache por execução (`EvaluationOptions.quartileCache`) — nunca N+1. Comparador só EQUALS/NOT_EQUALS + `thresholdText` Q1..Q4; janela operacional (nunca CLOSURES), agregação de valor (nunca COUNT), sem `compareTo`; direção HIGHER/LOWER (TARGET bloqueado no publish); individual-only (`WORKFLOW_OPERATIONAL_QUARTILE_INVALID_MODE` fora de contexto EMPLOYEE — em Consolidado use como critério de Selecionar colaboradores). SEM DADOS: população < 4 com dados, colaborador sem medição, abaixo da cobertura mínima, indicador TARGET. Trace: população avaliada/com dados/sem dados, posição, quartil, janela, método, direção. Exemplo combinado: "Quartil do indicador (oficial) = Q4" E "Quartil operacional TMA 7 dias = Q4" → TRUE (Mariana Alves na massa demo).

### Acompanhamento operacional na área de Indicadores (`performance-analytics/application/operational-trend.ts`)
Detalhe do indicador do colaborador: "Fechamento oficial" (fonte) × "Acompanhamento operacional" (últimos 7 dias, 7 anteriores, variação de performance com sinal pela direção, "Q4 operacional · 95º de 108 · Pares: Subgrupo Voz (106 de 108 elegíveis)", cobertura em dias elegíveis + "Mínimo do indicador: 60%"); chip "Operacional 7d" no card; resumo pooled na estrutura com "N de M colaboradores elegíveis"; badge "Situação: Férias" no perfil. O resolvedor devolve populationType/Label/Count, elegíveis, rank, quartil, janela, cobertura — o frontend nunca recalcula. Mesmo resolvedor, zero LLM. Sem medição diária = sem card; "Sem dados operacionais suficientes" segue o mínimo do indicador no catálogo. Storage: auditoria em 16/09/2026 — sem mudança de índice (todas as consultas usam `idx_measurements_person_indicator_window`); upsert do seed passou a `WHERE ... IS DISTINCT FROM` (reseed idempotente = zero escrita). HOURLY (não implementado) custaria ≈ 2.000 operadores × 128 dias × ~9 slots × ~5 indicadores diários ≈ 11–12 M linhas (≈ 10× o volume DAILY).

### Workflows oficiais
07 (TMA 7 dias × meta), 09 (TMA + Qualidade 30 dias), 10 (Aderência mês corrente), 05/14/17 (Qualidade mês anterior) usam medição operacional com **média ponderada**. 13 ("Monitoramento operacional do dia" — renomeado de "Monitoramento no turno" pra não prometer intraturno) usa "Hoje" — o dia local parcial, útil mas **não** meio do turno (exige HOURLY, futuro). 03/04/06/11/12/15/16/19/20 continuam em fechamentos oficiais.

## 4. Evolução futura (fora do escopo atual, documentado por transparência)

Itens explicitamente deixados de fora desta evolução, mas que a arquitetura já comporta sem redesenho:

- Primeiro/último dia útil, feriados, calendário empresarial.
- "Segunda terça-feira do mês" e recorrências compostas semelhantes.
- Cron customizado exposto ao usuário (o Builder sempre gera a recorrência a partir de campos amigáveis — nunca expõe `0 9 * * *` pro admin).
- `WEEKLY` com "a cada N semanas" (hoje só soma dias da semana; o mesmo par âncora+contagem já usado por `EVERY_N_DAYS` resolveria isso sem redesenho, se algum dia for pedido).
- Um Trigger reativo `PerformanceUpdated` (dispara assim que um fechamento de performance chega, em vez de esperar o próximo horário agendado) — só faz sentido criar se surgir uma necessidade real de reagir imediatamente à chegada de um fechamento; hoje, Agenda + Trigger por Indicador + Trigger por Flag + Conditions históricas/de performance já cobrem os cenários operacionais reais de Call Center.
- Timezone customizada por usuário (hoje é uma única timezone por organização, via `operations.timezone`).
- **Login/logoff real** (sessão, tempo efetivamente conectado) — não implementado de propósito nesta evolução. O conceito de "jornada prevista" já existe de forma isolada e não seria quebrado por essa adição futura.
- **Escala real de dias de trabalho** por colaborador (hoje assume Segunda a Sexta pra todo mundo, hardcoded em `isAssumedWorkday`) — férias, afastamentos, feriados, folgas, escala 6x1, múltiplos turnos no mesmo dia.
- **Jornada variando por dia da semana** — hoje `employee_work_shifts` tem uma linha por vigência (não por dia da semana); dá pra evoluir sem redesenho (adicionar um `weekday` opcional à tabela), mas não foi implementado agora.
- **UI de seleção de campo** pra `nodeOutputs.trigger.*` do contexto de expediente (hoje só resolvível via `sourcePath` cru, sem um picker visual dedicado como o que já existe pra `structuredResult` de Orquestrador).
- **Intervalo intrajornada, banco de horas, ponto eletrônico, jornada fracionada** — fora de escopo, sem necessidade real identificada ainda.
