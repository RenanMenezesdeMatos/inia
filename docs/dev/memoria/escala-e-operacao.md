# Memória — escala horizontal e operação (N APIs, N interfaces, M workers)

Origem: frente "multi-instância" da auditoria de escalabilidade de 13/10/2026 (600 usuários simultâneos, 4.000 cadastrados).
Consultas/índices e o read model do analytics da liderança são de outras frentes — não estão aqui.

> Ver também: [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) (instalação e Windows/IIS),
> [seguranca.md](seguranca.md), [ia-provedores-e-custos.md](ia-provedores-e-custos.md),
> [instalacao/dois-servidores-windows.md](../../instalacao/dois-servidores-windows.md) (seção 8), o IT-INIA-003 v1.1 (seção 10) e o
> IT-INIA-006 v1.1 (Etapa 1 e seção 13: campo "Chamadas simultâneas" da conexão; a Figura 5 ainda é a tela antiga, sem o campo).

## Regra

**Nada que precise valer para o conjunto pode ficar só na memória de um processo.** Com a web farm do IIS, qualquer request
cai em qualquer API e o processamento roda em M workers. O que é do conjunto fica no PostgreSQL; o que é por processo (fila e
prioridade do limitador de IA, cache de 15 s do runtime de IA, conexões do pool) é **cota por instância**, documentada como tal.
Estado novo compartilhado = tabela (UNLOGGED quando perder é inofensivo) ou `NOTIFY`, nunca Redis sem justificar.

## O que já é compartilhado (e onde)

| Estado | Onde | Observação |
| --- | --- | --- |
| Limites de requisição do `app.ts` (login, 1ª senha, API Push por IP, IA/voz/ações caras por conta, ciência) | `rate_limit_hits` (migration 126, UNLOGGED) — `shared/infrastructure/rate-limit/postgres-rate-limit-store.ts` | Janela fixa pelo relógio do BANCO + anterior ponderada; incremento condicional numa instrução (corrida na última vaga nunca passa duas); balde = regra + sha256 da chave (sem IP/e-mail em claro); loja fora = passa + aviso. Purga na tarefa periódica `rate-limit-purge` |
| Vagas e pausa POR CONEXÃO DE IA (decisão do usuário em 13/10: o limite é do ACESSO — ex.: o SDK da Vivo informará "vagas por acesso" —, configurável na conexão; nada específico de provedor) | `ai_connections.max_concurrent_calls` + `ai_call_slot_leases` (135, UNLOGGED, prazo renovado) + `ai_provider_cooldowns` (127, uma linha por chave) — porta `shared/application/model-routing/provider-call-gate.ts`, implementação `shared/infrastructure/model-routing/postgres-provider-call-gate.ts`, ligada no runtime da policy por candidato (`attemptAll`) e nas rotas do ambiente (`legacy:<provedor>`, só pausa) | Chave `connection:<id>`. ¼ do teto (≥ 1) reservado à interativa; interativa espera ≤ 20 s (`AI_CAPACITY_BUSY`), lote espera (cancelável). 429/503 grava a pausa (Retry-After ou 5 s/2 s, ≤ 60 s) ANTES de o erro voltar; lote espera a pausa ou, numa FALLBACK_CHAIN com RATE_LIMIT, pula a conexão (`FALLBACK_RATE_LIMIT`). Interativa nunca pausada. **O CHAT TEM PRIORIDADE** (decisão do usuário, 21/10, depois de dois Workflows de análise derrubarem o chat com 429): o 429 de uma chamada INTERATIVA pausa os lotes por pelo menos 15 s (`INTERACTIVE_RATE_LIMIT_PAUSE_MS`; Retry-After maior vale) em todas as instâncias e no processo (`interactiveBatchPauseMs`), e a interativa insiste até 4 vezes (0,75 → 1,5 → 3 → 6 s, Retry-After como mínimo, ≤ 15 s somados; 503 = uma só nova tentativa). Só na saturação — o lote nunca é parado preventivamente a cada pergunta. Cada processo lê as pausas a cada 2 s. Banco fora = sai sem vaga (aviso). O limitador de cada processo (`ai-call-limiter.ts`) voltou a ser só local (fila/prioridade/vagas/pausa do processo) + cancelamento. O planejador já tirava da frente da cadeia por 1 min o modelo com 429 recente em `ai_usage_events` (`RATE_LIMIT_DEPRIORITIZE_MS`) — continua valendo |
| Tarefas periódicas | trava consultiva numa conexão própria por processo + `periodic_job_runs` (122) | Uma rodada por intervalo no conjunto; ver "Travas das tarefas periódicas" abaixo |
| Fila de Workflows e da Central de Dados | posse com lease + `skip locked` | A API (papel `api`) só enfileira a carga da Central e avisa por `NOTIFY inia_data_hub_wake`; o worker escuta numa conexão própria (`shared/infrastructure/process-wake`) e processa; o tick de 15 s é a garantia |

O limite por token do API Push (60/min) também conta nessa loja (`consumePushQuota`, regra `push-token`, via
`DataHubContext.pushRateLimits`, que o `createApp` liga à loja dele). Ainda por processo (aceito, R-02 em
`docs/security/pendencias-e-riscos.md`): só o da ingestão de usabilidade (desligada no POC).

## Login atrás de Citrix/VDI/NAT

`login-ip-email` (`LOGIN_RATE_LIMIT_PER_IP_EMAIL`, 20/5 min, todas as tentativas, chave IP + e-mail normalizado) +
`login-ip-failures` (`LOGIN_RATE_LIMIT_PER_IP`, 200/5 min, **só recusas** — até 13/10 contava tudo com 30). A trava de negócio
por e-mail (5 falhas/15 min) não mudou. `normalizeClientIp` tira a PORTA do IP: o ARR manda `X-Forwarded-For: ip:porta` por
padrão e o Express devolve isso em `req.ip` (cada conexão virava um "IP"); o `configurar-iis.ps1` também desliga
`includePortInXForwardedFor`.

## HTTP, desligamento e streaming

- `main/process-lifecycle.ts`: keep-alive 65 s / headersTimeout 66 s; desligamento = sai da prontidão → espera
  `INIA_SHUTDOWN_DRAIN_MS` (5 s em produção, 0 fora — o `tsx watch` reinicia na hora) → `server.close` + fecha ociosas → para o
  processamento → fecha banco; prazo `INIA_SHUTDOWN_TIMEOUT_MS` (25 s, abaixo do `<stoptimeout>` 30 s do WinSW) → corta e sai 1.
  `unhandledRejection` = log e segue; `uncaughtException` = log + desligamento com código 1. SIGINT/SIGTERM/SIGBREAK.
- `/ready` (`main/readiness.ts`): 503 desligando ou banco sem responder `select 1` em 3 s (cache 1 s, uma consulta por vez). O
  corpo "não pronto" NUNCA contém a palavra `ready` (o health check do ARR procura essa palavra). `/health` continua sempre ok.
- SSE do chat: `: ping` a cada 15 s; cancelamento pelo `close` da RESPOSTA (o do request dispara ao terminar de ler o corpo JSON
  no Node atual — `request.on('close')` cancelaria toda conversa na hora) → `runWithAiCancellation` (ALS em `ai-runtime.ts`) →
  limitador tira da fila/backoff, adapters e clientes legados (chat, Orquestrador, agentes) abortam o fetch, a vaga volta.
  `AiCallCancelledError` (499) nunca dispara fallback nem nova tentativa. Resposta interrompida não é gravada (a pergunta já foi).
- Streaming: `AbortSignal.timeout(n)` no `fetch` vale para a resposta INTEIRA (cortava respostas longas aos 15 s). Use
  `shared/infrastructure/http/stream-deadline.ts`: prazo até começar + silêncio máximo entre pedaços (+ cancelamento).
- Token da voz com prazo de 10 s (504 `REALTIME_SESSION_TIMEOUT`).

## Observabilidade

`main/runtime-metrics.ts` (o atraso do event loop desconta o intervalo de amostragem de 20 ms: parado ≈ 0) → `GET /internal/metrics` na API (só conexão de 127.0.0.0/8, sem cabeçalho de proxy, e com
`INIA_METRICS_TOKEN` se definido; senão 404) e o mesmo snapshot no `/health` do worker: event loop (janela de 60 s), pool
(`waiting` > 0 = pool pequeno), HTTP por PADRÃO de rota (gravado no `req.route = …` do Express — depois de um erro o `baseUrl`
já foi restaurado), p50/p95/p99 de uma amostra de 256 por rota, memória, falhas fora de request, limitador de IA (com a origem
da pausa) e logs descartados. Logs: `shared/infrastructure/logging/logger.ts` — pino com destino ASSÍNCRONO (sonic-boom, teto
16 MB, blocos de 4 KB descarregados a cada 1 s) para pino e `console.*` (ponte no server.ts): no Windows o WinSW lê a saída
por pipe e escrita em pipe ali é síncrona. Na saída do processo, `await flushLogs()` antes do `process.exit` — com `minLength`
0 o `flush(cb)` do sonic-boom respondia na hora e o `flushSync` do pino na saída gravava a fila antes da escrita em andamento
(linhas fora de ordem em 3 de 24 processos sob carga; o `logger.test.ts` falhava na suíte inteira).

## Deploy (Windows/IIS) — NUNCA executado num Windows

- ARR identifica o servidor da farm pelo ENDEREÇO, sem a porta (confirmado em 13/10: "Web Farm Framework determines uniqueness by
  server name without the port"): instância i escuta em `127.0.0.i` na MESMA porta (API 3333, interface 3000); processamento j
  com `/health` em 127.0.0.1:3334 + j − 1. Sem editar o arquivo hosts.
- `configurar-iis.ps1 -InstanciasApi N -InstanciasInterface N`: farms `INIA-API`/`INIA-Interface`, LeastRequests, health check
  3 s (`/ready` → "ready"; `/healthz` da interface → "inia-interface"), `minServers` 1, `protocol.timeout` 5 min,
  `responseBufferLimit` 0, sem porta no XFF. `web.config` aponta para as farms e devolve 404 em `/internal`.
- `instalar-servicos.ps1`: `-InstanciasApi/-InstanciasInterface/-InstanciasProcessamento`, `-CotaIaApi/-CotaIaProcessamento`
  (processamento com 1 vaga interativa), `-PoolApi/-PoolProcessamento`; INIA-API-2… (a 1ª mantém o nome antigo); remove
  instâncias a mais de uma instalação anterior.
- Sem PowerShell nem Windows nesta máquina (13/10/2026): os scripts só foram revisados por leitura. Antes do POC, rodar num
  Windows Server e conferir "Healthy" em Server Farms › Monitoring.

## Estáticos do front

- `public/` sai com `max-age=0` pelo Next. `publicAsset()` (`lib/assets/public-asset.ts`) monta `?v=<sha256[:12]>` calculado no
  build (`public-asset-versions.ts`, `NEXT_PUBLIC_INIA_ASSET_VERSIONS`); `next.config.ts` dá `immutable` 1 ano só com `?v` e
  cache curto sem ele. Arquivo novo em `public/` (imagem da raiz ou `models/*.glb`) entra sozinho; referência nova usa
  `publicAsset()`.
- Avatar da INIA em 32–64 px: `inia-avatar.webp` (192 px, ~10 KB) — o `INIA.png` (1,4 MB) fica só onde aparece grande.
- Avatar 3D: monta depois do `load` + `requestIdleCallback` (`lib/browser/use-browser-idle.ts`, Safari = 200 ms após o `load`)
  ou na hora com sessão de feedback/conversa ativa; a flag nunca volta a falso (o Canvas nunca é desmontado por ela).
  Testes do chat stubam `requestIdleCallback` imediato.
- Cenário: cada página sorteia 0–60 s a mais na releitura da troca (`MAX_SCENE_CHANGE_JITTER_MS`); testes passam jitter 0.

## Conferido no navegador (13/10/2026, API `--role=api` em 127.0.0.1:3343 + `next dev --webpack` em 127.0.0.1:3010)

Hosts `127.0.0.1` de propósito: cookie separado do `localhost` (outras sessões e o app do usuário usam localhost).
Login (429/400/200 corretos), `/operator`, avatar pequeno `?v=`, chunk do 3D pedido DEPOIS do `load` (2,3 s × 2,1 s) e o GLB
versionado carregando; pergunta digitada com voz ligada vai pela sessão de voz (token 200); no modo mudo, SSE do chat:
`conversation` → `: ping` aos 15 s e 30 s → resposta do Orquestrador aos 32,5 s → `persisted` → `support_materials` + `done`.
Recarregar a página no meio de uma resposta: vaga interativa 1 → 0 em ~2 s e log `assistant_reply_cancelled` (JSON do pino).
Depois do redesenho por conexão: Administração › IA › Conexões › configurar mostra "Chamadas simultâneas" (vazio = "Sem
limite"); a API devolve `maxConcurrentCalls` (null nas 3 conexões do dev); `/internal/metrics` traz `aiConnections`
(vagas seguradas, esperando e pausas por chave).
Painel do navegador OCULTO = sem `requestAnimationFrame`: o Canvas fica em "Carregando avatar…" até um screenshot/painel visível
— é o ambiente, não o código. Turbopack não sobe num worktree com `node_modules` por symlink: use `--webpack`.

## Caminho quente da API — fase 2 (14/10/2026)

Pendências da auditoria de 13/10 que sobraram depois das três frentes. Medido num Mac M5, banco de dev.

- **Base de conhecimento em cache por versão** (`knowledge/application/retrieve-knowledge.ts`). Cada busca (chat, voz,
  ferramentas de investigação, prompt do especialista e do Orquestrador) confere no banco só QUAIS versões publicadas estão
  vinculadas ao Agent (sem o texto) e reaproveita trechos, papéis das seções e o índice BM25 já montados para exatamente essas
  versões (`buildKnowledgeIndex` em `lexical-retrieval.ts`; `rankChunks` aceita o índice e devolve o mesmo ranking). O texto só
  vem do banco quando algo mudou. Versão publicada nunca tem o texto alterado, então a chave é `knowledge_versions.id`.
  Agent de 12 bases (237 mil caracteres): 7,7 ms → 0,6 ms por busca. Cache por processo (64 Agents), sempre fresco com N
  processos. Testes: `knowledge/testing/fake-knowledge-db.ts` responde às duas consultas.
- **Senha fora da thread das telas** (`auth/infrastructure/password-hasher.ts`). O mesmo bcryptjs (JS puro, sem compilador no
  Windows), mesmo formato de hash, num pool de até 4 worker threads (`eval`, carrega o bcryptjs pelo caminho resolvido). Pool
  indisponível = bcryptjs assíncrono na thread principal, como antes. 60 verificações: 3,1 s → 0,8 s. O bcryptjs assíncrono já
  cedia a vez no event loop: o ganho é vazão (~19 → ~75 logins/s por processo) e CPU livre para as telas.
- **Matrícula por Flag na Central de Dados** (`interaction-writers.ts`): uma consulta por lote diz quais flags têm Workflow
  publicado (mesmo padrão das medições); antes cada flag gravada consultava os candidatos, mesmo sem Workflow nenhum.
- **Visão geral da Central de Dados** (`overview-service.ts`): os 14 `count(*)` das tabelas de destino ficam em cache e são
  refeitos quando uma carga termina (chave = último `finished_at`) ou a cada 10 min; a tela consulta a cada 4–30 s.
- **Resolvidos na fase 3** (abaixo): aba Resultados do Workflow, monitoramento de conversas, compressão das respostas JSON da
  API e o teste de carga com 600 usuários. Continua em aberto só a projeção da monitoria de usabilidade (coleta desligada no POC).

## Fase 3 (14/10/2026): telas da administração, compressão e teste de carga com 600

- **Compressão** das respostas da API (`shared/presentation/compression.ts`, pacote `compression` 1.8.2): brotli 4 ou gzip,
  acima de 1 KB, só tipos compressíveis; **nunca** `text/event-stream` (o chat). O IIS continua sem compressão dinâmica.
- **Aba Resultados do Workflow** e **monitoramento de conversas**: ver `docs/dev/escalabilidade-consultas.md` §8 e §9. Regra:
  em consulta de relatório, escolha os itens (filtro/ordem/página) ANTES dos agregados pesados, nunca subconsulta correlacionada
  sobre CTE (ela relê a CTE inteira por linha) e busca por chave com `LATERAL … limit 1` quando o planejador insistir em hash
  join sobre a tabela inteira.
- **Teste de carga versionado**: `tools/loadtest/` (README). IA falsa que troca só a resposta do provedor (gateway, limitador,
  uso e custo de verdade; latência real do dev; chave de IA falsa na pilha), usuários virtuais com o comportamento registrado
  num navegador, linha do tempo de 30 s com a carga da máquina.

**Resultado — 600 simultâneos (570 operadores, 30 supervisores, 1 administradora), UMA API, Mac M5 10 núcleos/16 GB, IA falsa:**

| | Valor |
| --- | --- |
| Logins (subida de 3 min, virada de turno) | 601/601, p50 68 ms, p95 128 ms; API até 124% de CPU (as threads de senha), event loop p99 ≤ 5 ms |
| Requisições curtas no patamar, máquina quieta | p50 4–5 ms, **p95 8 ms**, p99 ~17 ms (≈ 40 req/s de polling) |
| Chat (IA falsa com a latência real) | 652 mensagens, 0 falha, p50 4,2 s |
| Erros | 0 em ~49 mil requisições |
| API no patamar | CPU média 4,4%, pico 20%; RSS ≤ 360 MB; pool chegou a 20 (1 espera momentânea) |
| Interface (`next start`) | pico 177% na subida (13,6 mil arquivos estáticos + modelo 3D de 4,4 MB por navegador), ~1% no patamar |
| PostgreSQL | ~11% de CPU no patamar, pico 30%; 1,3 GB |
| Worker | 200 monitorias de uma vez + 8/min: 0 falha, 4 por vez (um Workflow ocupa no máximo metade das 8 vagas) |

Leitura: **uma API dá conta dos 600 com folga** nesta máquina; a segunda instância (web farm) é para disponibilidade, não
capacidade. Durante o teste, outra sessão renderizou vídeo (ffmpeg, carga da máquina até 31) e o p95 subiu para 190–650 ms
só nessas janelas — a linha do tempo separa isso. Limites desta medição: uma máquina só (gerador + servidor + banco), sem
IIS/Windows; o conteúdo falso do motor faz a monitoria abster-se depois da 1ª chamada, então a **vazão do worker** não foi
medida — pela conta, monitoria real (4 chamadas, ~1–2 min) com 4 por vez dá ~1.000–2.000 por dia de 8 h por worker; para mais,
`WORKFLOW_WORKER_CONCURRENCY` e/ou mais workers, dentro das vagas da conexão de IA.

## Travas das tarefas periódicas numa conexão própria (18/10/2026)

Origem: auditoria de eficiência de 17/10. Antes, cada rodada pegava uma conexão do POOL para a trava consultiva e a segurava
até o fim: com ~9 tarefas do `server.ts` + varredor de entrega + monitoria de usabilidade, até ~11 das 20 conexões do
processamento ficavam presas, disputando com as matrículas e heartbeats do motor de Workflow (e, no papel `all`, com a API).

**Agora** (`infrastructure/jobs/job-lock-session.ts`): UMA sessão do PostgreSQL por processo, fora do pool, detém as travas de
todas as tarefas (`pg_try_advisory_lock` de chaves diferentes na mesma sessão); o trabalho das tarefas usa o pool só pelo tempo
de cada consulta. `periodic_job_runs` continua igual (gravado na mesma sessão, sob a trava). Ligada em `startProcessing`
(papéis `worker` e `all`; a API pura não abre), fechada DEPOIS de `jobs.stop()` no desligamento, estado no `/health` do worker
(`jobLocks`: `connected`, `generation`, `held`, `losses`, `leasesLost`, `lastError`).

- **Sem conexão = rodada pulada** (`UNAVAILABLE` → `SKIPPED_UNAVAILABLE`, contador `skippedUnavailable`), nunca roda sem trava.
  Conexão em abertura (subida ou reconexão): a rodada espera por ela (prazo de conexão 10 s) — a rodada inicial não se perde.
  Reconexão com espera crescente 1 s → 30 s (padrão de `process-wake/postgres-wake-channel.ts`).
- **Conexão perdida no meio** (banco reiniciado, rede, `pg_terminate_backend`, sem resposta): o banco solta TODAS as travas da
  sessão. Cada abertura bem-sucedida é uma GERAÇÃO; as rodadas da geração perdida recebem `signal` abortado
  (`JobLockLostError`, em `JobLease`), o resultado sai com `lockLost` (contador `lockLost` por tarefa) e nada é destravado na
  sessão nova. Falha ao destravar fecha a sessão (a trava cai com ela; as outras rodadas são avisadas).
- **Reentrância**: o PostgreSQL deixa a MESMA sessão pegar a mesma chave de novo (contador — conferido na prova). A sessão
  devolve `BUSY` para tarefa com rodada ainda em andamento no processo; o `inFlight` do agendador e o `running` da monitoria de
  usabilidade continuam por cima. O varredor de entrega (que não tinha guarda própria) passa a contar com essa.
- **Sessão viva**: `select 1` a cada 10 s; prazo de 12 s por consulta (o banco cancela em 10 s por `statement_timeout`; sem
  resposta nenhuma em 12 s = conexão perdida; a conferência final roda depois da fase de E/S, para um event loop parado por CPU
  não derrubar a sessão à toa); `idle_session_timeout = 0`, `tcp_keepalives_idle = 30`, `tcp_keepalives_interval = 10` na
  sessão (o banco solta as travas de uma máquina que sumiu em ~2 min, não nas 2 h do sistema operacional) e keepalive TCP do
  Node; parâmetro desconhecido do servidor é ignorado. Uma consulta por vez no cliente (a fila interna do `pg` para consultas
  simultâneas está obsoleta e sai no pg@9). `application_name` = o do processo + `:locks` (`inia-worker:locks`, `inia-all:locks`).
- **Erro de SQL com a sessão de pé** (SQLSTATE fora de 08/57P — ex.: `periodic_job_runs` ausente) = falha da rodada, como
  antes; qualquer outro erro = conexão perdida.
- **Custo**: +1 conexão por processo com tarefas periódicas no `max_connections` (o worker já tinha +1 da escuta da Central);
  fórmula atualizada em `docs/instalacao/dois-servidores-windows.md` (seção "PostgreSQL para várias instâncias").

**Por que não posse por linha em `periodic_job_runs` com heartbeat** (a alternativa avaliada): as duas têm a mesma janela de
posse perdida com a tarefa ainda rodando, mas a linha precisa de prazo de posse (processo morto = os outros esperam o prazo; a
trava cai na hora com a sessão), de escrita a cada heartbeat por tarefa e de relógio para decidir vencimento; a sessão própria
mantém a semântica, a prova e a chave de antes. Risco aceito: uma queda da conexão derruba as travas de todas as tarefas do
processo de uma vez (na prática a queda costuma ser do banco/rede e atinge o pool também).

**Idempotência tarefa a tarefa** (com a trava perdida, o outro processo só começa a mesma tarefa depois de 0,9 × o intervalo
desde a partida daqui — `periodic_job_runs`; só rodada longa se sobrepõe):

| Tarefa | Duas rodadas juntas | O que faz com o sinal |
| --- | --- | --- |
| `workflow-schedule` | Segura (`is distinct from`; matrícula com `on conflict do nothing` no único workflow × sujeito × horário) | Não começa a 2ª etapa (agenda) |
| `data-hub` | Fila segura (`skip locked` + posse; já roda fora da trava pelo `kickWorker`); risco só em DUAS recuperações juntas (abaixo) | Nada: a recuperação é a 1ª etapa, ainda sob a trava |
| `report-schedule`, `report-runs` | Seguras (CAS em `next_run_at` + `on conflict`; posse com `skip locked`) | Nada |
| `report-analysis-retry` | Risco: sem posse por entrega, os dois chamariam a IA (paga) para as mesmas entregas | Para antes da próxima chamada de IA |
| `analytics-rollup` | Risco: DELETE + INSERT por lote nas mesmas pessoas → 23505 ou deadlock (dado final certo) | Para entre lotes; reconstrução interrompida não marca o dia (a próxima recomeça) |
| `data-retention`, `rate-limit-purge`, `usage-analytics-retention` | Seguras (deletes idempotentes; só o registro da rodada duplica) | Nada |
| `calendar` | Segura (`on conflict (dedupe_key)` e reconciliação única); borda: horizonte mudando entre as leituras | Não começa a 2ª etapa (alerta de horizonte) |
| `feedback-delivery-sweeper` | Segura (um comando com `on conflict do nothing`) | Nada |
| `usage-analytics-activity` | Risco baixo: a mesma pessoa projetada pelos dois → 23505 e volta à fila | Não reivindica o próximo lote (o já tirado da fila vai até o fim) |
| `usage-analytics-eligibility` | Segura (borda na 1ª rodada da organização: a rodada falha e repete) | Nada |

Pendências fora deste escopo (já existiam, só aparecem com duas rodadas juntas): `recoverInterruptedRuns` da Central devolve a
carga à fila sem conferir de novo `claimed_until < now()` no UPDATE (`run-service.ts`) — duas recuperações juntas podem rodar a
mesma carga em dois processos; `retryPendingAnalyses` não reivindica a entrega e pode pegar uma que `report-runs` ainda analisa
(entrega nasce com `analysis_updated_at` nulo).

## Provas

- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run multi-instance-proof` — DOIS processos de API reais (fork + HTTP + IPC):
  login alternado dá 429 na 5ª (teto 4; em memória seria a 9ª); conexão cheia na API A faz a B esperar até A soltar uma vaga;
  lote com a parte dele ocupada (3 de 4) espera e o chat sai na hora; 429 da conexão X na API A pausa os lotes da B em X,
  e a conexão Y e o chat seguem.
- `ai-call-limiter-proof` (runtime REAL + provider falso com cota 6): com "Chamadas simultâneas" = 6 gravado pela API de
  administração, 0 × 429 com o processo acima da cota (lote 3,7 s × 8,8 s sem o portão); conexão pausada → o lote vai para o
  próximo modelo da cadeia sem chamar a pausada.
- `postgres-provider-call-gate-proof`, `postgres-rate-limit-store-proof`, `postgres-wake-channel-proof`, `data-hub-proof`.
- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run periodic-jobs-lock-proof --no-file-parallelism` — duas instâncias (duas sessões
  de travas) disputando a mesma tarefa: só uma roda, a outra pula sem esperar; 3 travas de uma instância numa conexão só
  (`pg_locks` + `pg_stat_activity`); reentrância real do PostgreSQL na mesma sessão × `BUSY`; `pg_terminate_backend` no meio
  da rodada → sinal abortado, a outra instância assume, reconexão numa sessão nova; banco inalcançável = `UNAVAILABLE`;
  parâmetros da sessão (`:locks`, `idle_session_timeout` 0, keepalive 30/10, `statement_timeout` 10 s); agenda de 150 ms por
  2 s sem sobreposição e com 1 conexão de travas por instância. Testes de unidade: `job-lock-session.test.ts` e
  `periodic-jobs.test.ts` (banco falso em `infrastructure/jobs/testing/fake-job-lock-server.ts`).
- Worktree sem `node_modules` próprio: o Turbopack recusa `node_modules` por symlink para fora da raiz (`next build`/`next dev`
  com `--webpack` funcionam).

## Prioridade do chat durante disparos em massa — desaceleração controlada do lote (21/10/2026)

O recurso que satura é a COTA DO PROVEDOR (tokens e chamadas por minuto). Escopo confirmado em 21/10 na documentação oficial:
Gemini = **por projeto, não por chave** ("Rate limits are applied per project, not per API key"; RPM, TPM de entrada, RPD); OpenAI =
por organização e projeto. Duas chaves no mesmo projeto NÃO isolam chat e lote — isolamento de cota só com projetos/acessos
diferentes (confirmar com a Vivo o que "vagas por acesso" do SDK cobre).

- **Vazão adaptativa do lote por conexão** (`shared/application/model-routing/adaptive-batch-window.ts`, ligada no portão do
  PostgreSQL; o gateway marca os tokens de ENTRADA estimados de cada chamada com `runWithEstimatedTokens`): o lote de cada processo
  tem um teto de tokens/min na conexão, numa janela de 60 s como a do provedor. PARTIDA LENTA (120 mil/min, +30 mil a cada 10 s;
  passando de 3 milhões o teto some; parado 1 min, recomeça devagar). 429/503 da conexão — visto no processo ou PUBLICADO por outra
  instância (pausa nova/estendida lida a cada 2 s; `source` diz se foi INTERACTIVE) — corta o teto para METADE do que o lote usou no
  último minuto (mínimo 20 mil); 429 do CHAT corta para UM QUARTO e segura a subida por 60 s. Uma chamada sozinha sempre passa
  (nada trava). A interativa nunca passa por aqui. Vale também para a rota do ambiente (`legacy:<provedor>`, sem "Chamadas
  simultâneas"). `/internal/metrics` → `aiConnections.batchWindows` (`tokensPerMinute`, `usedLastMinute`, `waiting`); log
  `ai_batch_window_decreased`/`_restored`. Por que tokens e não chamadas simultâneas (medido): metade das simultâneas e depois a
  partida lenta em simultâneas ainda deixavam 43–51 respostas 429 no chat — 4 chamadas curtas de roteamento já passam da cota de
  tokens numa rajada, e o que o lote gastou conta por 60 s.
- **Retentativa de nó progressiva e com variação** (`node-retry-policy.ts`): 5 → 10 → 20 min (teto), ±20%; até 21/10 eram 5 min fixos
  para todos — num disparo em massa que esbarrou no limite, centenas de nós voltavam no mesmo minuto. Limite de tentativas igual (5).
- Disparos duplicados: a matrícula por Flag só acontece quando a flag é NOVA ou MUDOU de valor (ingestão e Central de Dados); manual
  com chave idempotente; agenda e fan-out com índices únicos — nada mudou aqui.
- Papel `all` (dev): chat e worker no mesmo processo, pool e event loop — produção usa `api` × `worker` (instalador).

Medido em 21/10 (`tools/loadtest/chat-priority*.mjs`, IA falsa com latências reais do dev e a cota do provedor COMPARTILHADA entre
API e worker — 600 mil tokens/min, 400 chamadas/min; 10 operadores perguntando a cada ~40 s; 7 min por rodada, 30 s de aquecimento;
1º texto p50/p95 · falhas): sem disparos antes 50,8/63,3 s · 0 → depois 31,5/47,1 s · 0; volume esperado (3 monitorias/min) antes
46,1/67,2 s · 0 → depois 32,2/56,2 s · 0 (lote igual: 21/21 concluídas); sobrecarga com worker de 8 (60 + 8/min) antes 45,1/78,3 s → depois
31,4/49,9 s, 0 falhas; SOBRECARGA FORTE com worker de 32 (120 + 10/min; o antes tentava 646 mil tokens/min) antes 51,1/82,3 s, 6 de 44
respostas falharam, 115 respostas 429 no chat, 68 no lote e 23 nós de Workflow falhos → depois 30,9/46,8 s, 0 falhas, 3 + 3 respostas
429, 0 nós falhos, consumo 481 mil/min; o lote desacelerou (80 chamadas ok × 133 antes; espera na fila p95 65 s). Limites: uma
máquina, IA falsa (a latência do modelo real varia mais), amostras de 40–58 respostas por rodada (p95 ≈ 3ª pior), vazão do lote
medida em chamadas de IA (7 min não fecham uma monitoria completa na sobrecarga).
