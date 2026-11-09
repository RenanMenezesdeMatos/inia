# Auditoria de eficiência — 17/10/2026

Branch `claude/auditoria-eficiencia` (worktree `.claude/worktrees/auditoria-eficiencia`), a partir de `27726180`. As regras que
qualquer sessão precisa respeitar ficaram em [memoria/banco-e-consultas.md](memoria/banco-e-consultas.md); aqui estão os achados,
as medições e o que ficou de fora.

## Escopo e método

- **Coberto:** backend (leadership-analytics, reports, interventions, performance-analytics, assistant, indicators, workflows,
  data-hub, ingestion, feedback-engine, interaction-feedback, feedbacks, notifications, pending-actions, realtime, jobs, main,
  shared) e frontend (`frontend/src`: dados, renderização, bundle, recursos do navegador). Três leituras independentes do código,
  só leitura, seguidas de conferência de cada achado antes de mexer.
- **Fora do que já foi tratado** em 13–14/10 ([escalabilidade-consultas.md](escalabilidade-consultas.md)): Acompanhamento do
  colaborador, sino, feed keyset, agenda, `audit_logs`, pool, Resultados do Workflow, monitoramento de conversas, compressão.
- **Medição:** banco de dev `inia` (1,6 milhão de medições, 2.398 pessoas, uma organização) em sessão somente leitura.
  - SQL: `EXPLAIN (ANALYZE, BUFFERS)` antes × depois, mediana de 3 a 15 repetições, conferindo resultado idêntico.
  - Funções: a versão do HEAD e a nova rodando lado a lado contra o mesmo banco, com o resultado comparado em JSON.
  - Bundle: `next build --webpack` antes e depois, somando os arquivos iniciais de cada rota (gzip nível 9).
  - **Limite:** a máquina estava com carga média entre 45 e 100 (outras sessões e builds). Os tempos de parede variam;
    buffers e número de consultas são a métrica estável. Cache quente salvo indicação.
- **Sem `pg_stat_statements`:** o dev não tem a extensão (exige `shared_preload_libraries` e reinício do PostgreSQL
  compartilhado). As origens dos contadores de `pg_stat_user_tables` foram achadas lendo o código e os planos.

## Achados por prioridade

Confirmado = lido no código e, quando há número, medido. Hipótese = precisa de medição com volume que o dev não tem.

### Alta

| # | Onde | O quê | Situação |
|---|---|---|---|
| 1 | `indicators/application/resolve-employee-performance.ts` | 6 leitores de desempenho oficial sem `organization_id`: varrem a tabela inteira a cada Condition de atingimento/PRV/recorrência de quartil e a cada condição de política; o subselect `code = $n` falha com o mesmo código em duas organizações | **Corrigido** |
| 2 | `performance-analytics/infrastructure/operational-read-model.ts` | `valid_until` do read model (tarefa de 15 s do worker) lia o índice inteiro de medições por lote de 250 pessoas | **Corrigido** |
| 3 | `data-hub/infrastructure/xlsx-parser.ts`, `data-hub/application/database-run.ts` | `Math.max(...linhas)` / `push(...linhas)` estouram a pilha do V8 acima de ~120 mil linhas: planilha válida → 500 na prévia e carga FAILED | ver seção da Central de Dados |
| 4 | `workflows/application/select-employees-executor.ts` | `Promise.all` sem teto sobre milhares de candidatos (3–5 consultas cada) num pool de 20 conexões | ver seção da Central de Dados |
| 5 | `frontend/.../authenticated-app-shell.tsx` | a raiz do shell mudava de tipo quando `/auth/me` chegava: a página inteira remontava em toda carga completa (efeitos 2×, conversa do chat lida duas vezes) | **Corrigido** |
| 6 | `frontend/.../profile-workspace.tsx`, `employee-profile-page.tsx` | abas fora da entrada (recharts, @xyflow/react) no JavaScript inicial de `/operator` e `/supervisor` | **Corrigido** |
| 7 | `reports/application/report-runtime.ts:120` | marca d'água `max(period_end)` das medições lê todo o histórico dos membros (a frio: 3,7 s para 300 pessoas, 40 s para a organização) | **Não corrigido** — ver pendências |

### Média

| # | Onde | O quê | Situação |
|---|---|---|---|
| 8 | `workflows/application/condition-evaluator.ts` (`resolveGoalValue`) | duas subconsultas correlacionadas por pessoa (2 × N buscas) — origem provável de boa parte dos 24 milhões de seq scans em `indicator_definitions` | **Corrigido** |
| 9 | `performance-analytics/application/operational-trend.ts` | catálogo diário relido indicador a indicador (1 + N) e de novo no quartil, por código e sem organização | **Corrigido** |
| 10 | `leadership-analytics/application/references.ts` | competência e cobertura relidas do histórico oficial inteiro no contexto de toda mensagem e em cada ferramenta | **Corrigido** |
| 11 | `leadership-analytics/application/operational-query.ts` | até 15 resumos de unidade ao mesmo tempo, cada um podendo segurar uma conexão com transação | **Corrigido** |
| 12 | `frontend/.../followup-workspace-shell.tsx` | feed do Acompanhamento montado duas vezes (desktop + mobile escondido) e AudioContext nunca fechado ao sair | **Corrigido** |
| 13 | `frontend/.../case-interventions.tsx`, `assistant-conversations-page.tsx` | `router.replace` só para mudar a seleção refazia a renderização do servidor (o caso era buscado de novo no backend a cada clique) | **Corrigido** |
| 14 | `reports/application/report-executor.ts:130-147` | N+1 por destinatário (até 2.000): conta + sessão de liderança + escopo, em série; comparação roda a ferramenta inteira de novo | Recomendação |
| 15 | `interventions/presentation/intervention-admin-router.ts:239/305` | autorização por pessoa (CTE recursiva + escopo completo) nas telas de política | Recomendação (arquivo em edição por outra sessão) |
| 16 | `assistant/application/run-specialist-tool.ts`, `build-operator-context.ts` | contexto do operador refeito por especialista e 2 consultas por indicador | Recomendação (ganho de dezenas de ms perto de 4–8 s de IA) |

### Central de Dados e worker

| # | Onde | O quê | Situação |
|---|---|---|---|
| 17 | `data-hub/domain/csv-parser.ts` | amostra de 20 linhas dividia o arquivo inteiro em células (500 mil linhas: ~200 ms síncronos e ~200 MB de heap na API) | **Corrigido** |
| 18 | `data-hub/application/run-service.ts`, `run-pipeline.ts` | posse de 15 min só renovada no banco externo: arquivo/API/SFTP longo voltava à fila ainda rodando e rodava de novo em paralelo; Runs reivindicados juntos podiam perder a posse e mesmo assim rodar | **Corrigido** |
| 19 | `workflows/application/indicator-enrollment.ts`, `flag-enrollment.ts` + writers | matrícula por Indicador/Flag com ≥5 consultas por linha dentro da transação do lote | **Corrigido** (memo por lote) |
| 20 | `data-hub/infrastructure/pg-raw-object-store.ts`, `data-hub-router.ts` | conteúdo bruto (até 50 MB) lido só para checar metadados, e copiado de novo a cada leitura/gravação | **Corrigido** |
| 21 | `run-pipeline.ts`, `ingestion-router.ts`, `deliver-feedback.ts` | rollback sem `catch` escondia o erro real do lote; falha de entrega engolida sem log | **Corrigido** |
| 22 | `infrastructure/jobs/periodic-jobs.ts:42` | cada tarefa periódica segura uma conexão do pool durante a rodada inteira (até ~11 de 20) | Recomendação (ver pendências) |

- **Pilha do V8 (achado 3):** largura da planilha por laço (`tableFromMatrix`), `appendRecords` no banco externo e o mesmo caso em
  `performance-writers.ts` (`ready.push(...unique)` com a carga inteira). Um `.xlsx` de 150 mil linhas falhava com RangeError
  depois de ~1,1 s; agora carrega, e o resultado de 100 mil linhas tem o mesmo hash de antes. Testes com 200–250 mil linhas.
  O XLSX continua carregando o workbook inteiro (o exceljs gasta 690 dos 742 ms em 100 mil linhas; o leitor em streaming muda a
  semântica dos valores — sem garantia de resultado idêntico, não foi trocado).
- **Amostra do CSV (achado 17):** duas fases com a mesma gramática — monta as linhas puladas, o cabeçalho e as `limit` do corpo;
  o resto só é contado (`totalRows`, colunas, separador e texto idênticos). 500 mil linhas / 18 MB, pares A/B alternados contra o
  HEAD: amostra **158–213 ms → 57–74 ms**, heap logo após a chamada de 206 MB para ~0; leitura completa 549 → 544 ms (igual).
  Fuzz determinístico (>1.000 combinações) compara a amostra com o corte da leitura completa.
- **Seleção de colaboradores (achado 4):** `mapWithConcurrency` com 8 avaliações por vez nas três etapas (critério, valor e
  variação do Ranking). Teste: 300 candidatos → pico de 8 em andamento (antes 300), mesma coleção e mesma ordem.
- **Posse dos Runs (achado 18):** a renovação foi embutida nas gravações de progresso que já existiam (etapa e lote aplicado),
  pelo pool e fora da transação — nenhuma consulta a mais. Antes de executar cada Run reivindicado, compare-and-swap no token da
  posse: se outro worker a tomou (ou o Run foi cancelado), pula sem apagar a posse alheia. Teste `run-lease.test.ts`.
- **Matrícula por Indicador/Flag (achado 19):** `workflows/application/enrollment-lookups.ts` lembra, durante o lote, candidatos,
  operador, estratégia, nó de gatilho e membros da estrutura. Decisão e insert continuam linha a linha; sem instância (ingestão em
  tempo real) é uma por evento, exatamente as consultas de antes. Nada lembrado é escrito pelo lote; a única diferença é o
  instante da leitura (uma publicação concorrente no meio do lote vale para o lote inteiro ou para nenhuma linha). Teste de
  paridade: 336 matrículas idênticas e na mesma ordem, leituras 975 → 40.

## O que foi implementado e medido

### Leitores de desempenho oficial (achado 1)

A organização vem do cadastro das pessoas consultadas (subconsulta calculada uma vez), então nenhuma assinatura mudou — o que
evitou mexer em `interventions/*`, que outra sessão está alterando. Resultado idêntico nos 9 casos comparados:

| Leitura | Antes | Depois |
|---|---|---|
| `findLatestIndicatorPerformance` (1 pessoa) | 10,4 ms | 0,48 ms |
| `findRecentIndicatorPerformance` (1 pessoa, 3) | 10,2 ms | 1,15 ms |
| `findLatestPrvPerformance` / `findRecentPrvPerformance` | 2,2 ms | 0,40–0,47 ms |
| `aggregateAchievementHistory` EIP (347 pessoas, 6 meses) | 17,0 ms | 2,4 ms |
| `aggregateAchievementClosures` EIP (347 pessoas, 3) | 16,0 ms | 2,4 ms |
| `aggregateAchievementClosures` PRV (347 pessoas, 3) | 5,1 ms | 3,9 ms |

No plano: 2.989 → 14 buffers na leitura de uma pessoa. O custo antigo crescia com o histórico (+~12 mil linhas por mês).
A prova `employee-performance-organization-proof` (banco de teste, transação desfeita) falha no código antigo com
"more than one row returned by a subquery" e passa no novo.

### Read model — `valid_until` (achado 2)

Lote de 250 pessoas, mesmo resultado: **90.840 → 4.218 buffers** (≈ 710 MB → 33 MB de leitura lógica), 39 ms → 2 ms com cache
quente; a frio a leitura antiga levava ~1,75 s por lote. Prova `analytics-read-model-proof` (11 testes, original × read model
idênticos) passa.

### Meta vigente na Condition (achado 8)

| Conjunto | Antes | Depois |
|---|---|---|
| 1 pessoa | 0,09 ms / 24 buffers | 0,10 ms / 24 buffers |
| equipe de 347 | 13,1 ms / 6.115 buffers | 0,61 ms / 449 buffers |
| organização (2.398) | 56,3 ms / 41.552 buffers | 1,84 ms / 673 buffers |

Mesmas linhas e na mesma ordem (a primeira linha rotula a origem da meta).

### Tendência operacional do colaborador (achado 9)

Aba Indicadores e `my_results`: **147 → 111 consultas** por abertura, resultado idêntico (4 cards), 88 → 81 ms com a máquina
carregada. O tempo restante está nas janelas e no quartil por indicador (em série, de propósito: paralelizar trocaria latência
de uma pessoa por mais conexões simultâneas por requisição).

### Liderança (achados 10 e 11)

- A cobertura das competências custa ~150–170 ms por chamada no dev (equipe ou organização) e rodava ao menos duas vezes por
  mensagem; agora uma vez por estrutura enquanto as versões OFFICIAL/STRUCTURE não mudam. Teste: `references.test.ts`
  (mesmas versões = uma leitura; versão nova relê; escrita pendente na transação nunca guarda).
- A consulta flexível operacional lê no máximo 3 resumos de unidade ao mesmo tempo (`indicator-query.test.ts` prova o teto).

### Frontend (achados 5, 6, 12 e 13)

- **Shell estável:** provider, `div` e `main` sempre presentes; só o cabeçalho entra quando a sessão chega. Teste com contador
  de montagens (antes: 2; depois: 1). `initialData` do `/auth/me` não foi feito: o layout `(app)` não lê o usuário no servidor e
  passar a ler acrescentaria uma chamada bloqueante.
- **Feed uma vez só:** com o layout conhecido só a cópia visível existe; no servidor e na hidratação as duas continuam e a que
  fica não remonta (teste com `renderToString` + `hydrateRoot`). Cruzar 768 px ao redimensionar remonta o feed, como o chat já
  fazia.
- **AudioContext fechado ao desmontar** o Acompanhamento (`prime()` recria um contexto fechado; StrictMode seguro).
- **Seleção na URL sem ida ao servidor:** `history.replaceState` (integrado ao `useSearchParams` no Next 16) no caso e nas
  conversas — nenhuma das duas páginas lê o parâmetro no servidor.
- **Abas sob demanda** (`profile/profile-tab-views.tsx`, `next/dynamic` com SSR e os mesmos esqueletos): Indicadores, Equipe,
  Calendário e Estrutura no perfil; Estrutura na ficha (lá Indicadores é a aba de entrada). O Acompanhamento e o `<Canvas>` do
  avatar não foram tocados.

JavaScript inicial por rota (`next build --webpack`, `rootMainFiles` + chunks de entrada do manifesto, sem polyfills, gzip 9):

| Rota | Antes (bruto / gzip) | Depois (bruto / gzip) |
|---|---|---|
| `/operator` e `/supervisor` | 2.598 / 787 KB | 2.194 / 672 KB (−115 KB gzip, −15%) |
| `/supervisor/operators/[id]` | 2.632 / 799 KB | 2.350 / 717 KB |
| `/supervisor/cases/[id]` | 2.773 / 836 KB | 2.389 / 727 KB |
| `/admin/conversations` | 1.244 / 376 KB | 1.248 / 378 KB (reagrupamento de chunks) |

O recharts continua em `/operator` e `/supervisor`: `follow-up/follow-up-entry.tsx` importa `ReportDeliveryView`, que aparece no
feed da aba de entrada. Carregá-lo sob demanda mostraria um esqueleto em conteúdo visível — decisão de produto (−102 KB gzip).

## O que não mudou, e por quê

- **Marca d'água das medições nos reports** (`report-runtime.ts:120`). Ela é gravada em cada entrega e comparada na próxima, então
  precisa continuar com o mesmo valor. A reescrita exata pelo índice `(indicator_definition_id, subject_id, period_start,
  period_end)` foi medida: 2–3× melhor para equipes, **pior** para a organização inteira (75 → 176 ms, cache quente), porque aí a
  varredura paralela vence. Não há forma exata e barata sem índice novo: o contrato aceita medições `MONTHLY`/`CUSTOM` (até 30
  dias no dev), então o maior `period_end` não sai do último `period_start`. Decisão necessária: (a) índice
  `(organization_id, subject_id, period_end)` em `indicator_measurements`, a tabela mais escrita (1,5 GB), ou (b) a Central de
  Dados gravar a marca na carga (ex.: domínio `MEASUREMENT` em `analytics_versions`) — muda o formato da marca e a primeira
  execução depois da troca daria "fonte mudou, dados iguais" (sem entrega).
- **Contagem exata de medições ao abrir o editor de indicador** (`indicator-dependencies.ts:22`, ~321 ms). O número aparece
  para o administrador ("1.200 medições"); com `organization_id` o plano só troca a varredura paralela pelo índice (558 ms a
  frio). Trocar por "mais de 10 mil" muda o que a tela mostra — decisão de produto.
- **Chat re-renderiza todas as mensagens a cada tecla e a cada pedaço do streaming** (`operator-inia-chat.tsx`, sem React
  Compiler). A correção mínima é `memo` no `RichContent` (props só de texto), mas `rich-content.tsx` está sendo alterado pela
  sessão de segurança. Fazer depois do merge dela e medir com o Profiler.
- **`motion` só para o sublinhado das abas** (`ui/tabs.tsx`, ~40 KB gzip em ~25 rotas). Trocar por transição CSS muda a
  animação do kit — vale como decisão visual.
- **Recharts no feed da aba de entrada** (`follow-up-entry.tsx` → `ReportDeliveryView`, ~102 KB gzip): sob demanda, mostraria
  esqueleto em conteúdo visível.
- **Report: N+1 por destinatário** (achado 14): até 2.000 sessões de liderança em série por execução. É no worker e periódico;
  agrupar destinatários por (papel, estrutura) antes de abrir sessão é a correção, com prova de que as entregas ficam iguais.
- **Telas de política de acompanhamento** (achado 15) e **memo do especialista por mensagem** (achado 16): os arquivos que
  precisam mudar (`interventions/*`, `run-orchestrated-reply.ts`) estão em edição por outra sessão.
- **Travas das tarefas periódicas** (achado 22). A correção mais segura é um `pg.Client` dedicado por processo só para as travas
  consultivas (padrão de `postgres-wake-channel.ts`, com reconexão e backoff; desconectado, a rodada é pulada). Riscos: se essa
  conexão cai, o banco solta todas as travas com as tarefas ainda rodando (precisa de geração + `AbortSignal` e de conferir a
  idempotência tarefa a tarefa); reentrância na mesma sessão (hoje a guarda é o `inFlight`); `idle_session_timeout`/keepalive;
  +1 conexão por processo. Alternativa: posse por linha em `periodic_job_runs`, com heartbeat. Mexe no comportamento de todas as
  tarefas do worker — merece uma frente própria com prova de concorrência.
- **Hipóteses que pedem volume que o dev não tem:**
  - claim do worker (`engine.ts:83-99`) com `row_number()` sobre todo o backlog vencido a cada vaga (~30 ms com 20 mil
    linhas sintéticas);
  - fan-in (`consolidate-results-executor.ts`) copiando o `node_outputs` inteiro de cada filho para o pai (~100 KB por filho
    no dev; 2.000 filhos ≈ 200 MB de jsonb).
  Medir com uma massa de fan-out antes de mexer.
- **`pg_stat_statements`:** recomendado no PostgreSQL da instalação (e no dev, num momento combinado, porque exige reinício).
  Sem ele, os 40 mil seq scans em `indicator_measurements` só foram atribuídos em parte.

## Validação

| Verificação | Linha de base (HEAD `27726180`) | Depois |
|---|---|---|
| Backend `tsc --noEmit` | sem erros | sem erros |
| Backend `eslint .` | sem erros | sem erros |
| Backend `typecheck:scripts` | — | sem erros |
| Backend `vitest run` | 413 arquivos / 4.712 testes, 0 falhas | 421 arquivos / 4.741 testes, 0 falhas |
| Backend `build` | — | ok |
| Frontend `tsc --noEmit` | sem erros | sem erros |
| Frontend `eslint` | 0 erros, 1 aviso (`operator-inia-chat.tsx:1516`) | o mesmo |
| Frontend `vitest run` | 159 arquivos / 1.891 testes | 161 arquivos / 1.897 testes |
| Frontend `next build --webpack` | ok | ok |

- As duas rodadas do frontend (antes e depois) terminam com o erro de ambiente `[vitest-worker]: Timeout calling "onTaskUpdate"`,
  sem teste falhando — a máquina estava com carga média de 45 a 100.
- Provas no `inia_test`, uma de cada vez: `employee-performance-organization-proof` (nova; falha no HEAD com "more than one row
  returned by a subquery"), `analytics-read-model-proof` (11), `dynamic-indicator-proof` (11), `data-hub-proof`,
  `workflow-draft-configuration-proof`, `manual-run-proof`, `person-identity-proof`, `employment-status-hardening`,
  `diagnostic-strategy`, `strategy-at-birth`, `feedback-delivery`, `workflow-interaction-feedback`. A `data-hub-proof` falhou em 3
  execuções sob carga extrema (até ~250) em casos diferentes a cada vez e passou limpa nas seguintes. `external-database-proof` não
  rodou: precisa dos contêineres dos bancos externos.
- Dois testes de unidade (`qa-lab/condition-preview-parity`, `run-workflow-simulation`) têm banco falso que roteia por texto de
  SQL: o roteamento foi atualizado para as consultas novas, com a mesma semântica emulada e as mesmas asserções.
- **Não verificado no navegador.** As mudanças de frontend foram provadas por testes de componente (montagens, hidratação,
  AudioContext, URL) e pelo build; vale abrir `/operator` e `/supervisor` depois do merge.
