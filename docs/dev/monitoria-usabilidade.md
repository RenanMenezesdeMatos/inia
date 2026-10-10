# Monitoria de usabilidade

Área **Administração › Monitoramento › Monitoria de usabilidade** (`/admin/usability`): como as pessoas usam a INIA — quem
acessa, o que veem, onde clicam, como consomem feedbacks, como usam a INIA por texto e voz, o que os Workflows produzem e onde
as jornadas travam. Não é replay de sessão, não grava tela, áudio, microfone nem conteúdo digitado, e não usa SaaS externo.

> **Estado (06/10/2026): DESLIGADA** — dispensável para a POC. As duas flags estão `OFF` no `.env` de desenvolvimento; código,
> migration 116 e os dados já coletados continuam no lugar. Para religar, siga "Ativação" abaixo.

O catálogo completo (dicionário de métricas, eventos, telas, elementos, ações, funis e sinais) é **gerado do código** em
[monitoria-usabilidade-catalogo.md](monitoria-usabilidade-catalogo.md) — nunca edite à mão (ver “Manter o catálogo”).

## Ativação

| Peça | Como liga | Padrão |
| --- | --- | --- |
| Coleta (ingestão do navegador `POST /api/v1/usage/events/batch`, fatos de servidor, worker de projeção e retenção) | `INIA_USAGE_COLLECTION=ON` no `.env` do backend | `OFF` — nada é coletado, a rota não existe (404) e o navegador para de enviar |
| Painel (`/api/v1/admin/usability/*` e a tela) | `INIA_USABILITY_PANEL=ON` | `OFF` — a rota não é montada e a tela diz “desligada neste ambiente” |
| Carimbo de ambiente dos eventos | `INIA_ENVIRONMENT` (opcional) | `NODE_ENV` |
| Coleta por organização | Qualidade da medição › Gerenciar (`usage_settings.collection_enabled`, com motivo e auditoria) | ligada |
| Estrutura | migration `116_usage_analytics.sql` | — |

As duas flags são independentes (coletar antes de abrir o painel, ou abrir o painel sobre dados já coletados). O frontend lê
`features.usageCollection` / `features.usabilityPanel` do `/auth/me` — nenhuma flag própria no frontend.

**Acesso** (permissões novas; nenhum cargo recebe por padrão):

| Permissão | O que libera |
| --- | --- |
| `usability.view` | a área, só com números agregados do escopo |
| `usability.users.view` | nomes, lista de pessoas, detalhe individual (auditado em `audit_logs USABILITY_PERSON_VIEWED`) |
| `usability.export` | CSV |
| `usability.comments.view` | comentários das avaliações negativas |
| `usability.manage` | coleta por organização, retenção, fuso, classificação de população, reprocessamento (só na organização inteira) |

Papéis: **Administrador geral** tem todas; **Analista de usabilidade** (`view` + `users.view` + `export`, qualquer escopo);
**Leitor de usabilidade (agregados)** (`view`, qualquer escopo). Os dois papéis novos são delegáveis por Administrador geral,
Administrador e Administrador de acessos, pela aba Papéis de Usuários e acessos. A capability fica FORA de
`canAccessAdministration` (como as Conversas): quem só tem a monitoria vê só ela na Administração.

## As abas

Filtros na URL (`?tab=…&period=…`), nunca nome/e-mail. Cada aba declara os filtros que suporta (`/context` → `tabs`); filtro
que a aba não suporta aparece riscado com o motivo e **não** é enviado; parâmetro desconhecido é listado e ignorado. Todo
número tem o “?” com a definição do dicionário versionado, a base (“2 de 6”), a cobertura (“sem dados antes de…”) e, quando
compara, a variação (taxa em p.p., volume em %; base anterior zero = “sem base para variação percentual”).

1. **Visão geral** — pessoas ativas (únicas no intervalo, nunca soma de DAU), elegíveis, adoção, elegíveis inativos,
   engajados, sessões, logins, tempo ativo (média/mediana/p95), série diária, população fora da base (sem conta, conta
   desabilitada, afastados, desligados), sinais de dificuldade.
2. **Pessoas e acessos** — segmentos com predicado único (ativos, elegíveis, inativos, nunca acessou desde que foi habilitado,
   sem registro desde a coleta, primeiro acesso, sem conta, conta desabilitada, afastado, desligado), lista paginada (só com
   `users.view`), retenção semanal por coorte; detalhe individual em `/admin/usability/people/:personId` (marcos, calendário,
   horas × dia da semana, telas, ações, sessões, elegibilidade, linha do tempo sem conteúdo).
3. **Telas e cliques** — visualizações canônicas por tela, pessoas, tempo, rolagem; elementos com exposição × acionamento;
   filtros e buscas; instrumentação de cada tela (INSTRUMENTED / PARTIAL).
4. **Feedbacks e ciência** — coorte (disponível → exposto → aberto → avaliado → aplicação → ciência), com janela de conversão,
   coorte madura × provisória; volume no período (independe da data de publicação); avaliações e motivos; tentativas de
   confirmação de ciência (falhas, recuperação, idempotentes); materiais de apoio.
5. **INIA voz e texto** — pessoas por canal, mensagens humanas × da INIA, turnos de voz, conversas por origem, proativas, voz
   (intenções, conexões, reconexões, com/sem fala, tempos de microfone e reprodução), latência até a primeira resposta, taxa
   de resposta, painel do chat.
6. **Workflows** — ranking por **execução raiz** (fan-out e retentativas não multiplicam), pessoas alcançadas, filhas,
   concluídas/falhas/aguardando/em andamento, duração mediana/p95 só de concluídas, resultados entregues e abertos, custo de IA
   por raiz, solicitantes de execução manual, revisões humanas, publicados sem execução.
7. **Jornadas e dificuldades** — 7 funis que correlacionam a MESMA entidade em cada etapa (conversão por etapa e total,
   mediana/p95, janela aberta = pendente) e 11 sinais heurísticos (rajada de cliques, ação sem resultado, voltar logo…),
   sempre rotulados como heurística.
8. **Qualidade da medição** — lotes recebidos/aceitos/duplicados/recusados por motivo, relógio do cliente, eventos tardios,
   cobertura por família e tela, atraso da projeção, fila, retenção; e “Gerenciar” (só `usability.manage`).

CSV: `GET /api/v1/admin/usability/export.csv?tab=…&table=…` — BOM, `;`, vírgula decimal, fórmulas neutralizadas; mesmo
recorte e mesmos números da API e da tela (provado). Cada exportação gera um fato `usability.export`.

## Como funciona

**Navegador** (`frontend/src/lib/usage`): `UsageAnalyticsProvider` (no layout autenticado) cria UM rastreador por conta
(contagem de referências: Strict Mode não duplica). O coletor (`usage-collector.ts`) mantém uma fila por conta no
`localStorage` (sessão analítica de 30 min de inatividade compartilhada entre abas; outra conta nunca reaproveita), envia lotes
de até 50 eventos ou a cada 5 s, reenvia com os MESMOS ids (o servidor deduplica), envia o resto no `pagehide`, para de vez com
404 (coleta desligada) e descarta tudo no logout. O rastreador (`usage-tracker.ts`) resolve a rota para a tela do catálogo
(`usage-catalog.generated.json`; id da URL vira entidade, nunca parte da chave), conta tempo ativo por heartbeat de 15 s com
inatividade em 60 s, e lê a instrumentação declarativa:

| Atributo | Efeito |
| --- | --- |
| `data-usage-screen="chave"` | painel/modal/aba como tela própria (`screen.viewed` / `screen.left`) |
| `data-usage-element="chave"` | clique/toque/teclado vira `element.activated` (abas do Radix são reconhecidas pelo id) |
| `data-usage-expose="chave"` | exposição real: ≥ 50 % visível por 1 s, uma vez por visualização |
| `data-usage-scroll="chave"` | marcos de rolagem 25/50/75/100 (nunca é “leitura”) |
| `data-usage-entity-type` + `data-usage-entity-id` | entidade do fato (validada no servidor pelo TIPO e pela organização) |
| `data-usage-correlation` | correlação com uma ação |
| `data-usage-ignore` | nada dentro é medido |

Ações com resultado: `startUsageAction(chave)` → `succeed()` / `fail(código)` / `cancel()`; eventos livres do catálogo:
`trackUsage(nome, propriedades)`. Voz: `voice-usage.ts` (gravador desacoplado do transporte do Gemini Live: intenção,
permissão, conexão, intervalos de microfone e reprodução — nunca áudio). Falha da coleta nunca afeta o produto.

**Servidor** (`backend/src/modules/usage-analytics`):
- *Ingestão* (`ingest-client-events.ts`): esquema FECHADO por evento (propriedade desconhecida = evento recusado com motivo),
  organização/ator/estrutura/classificação vêm da sessão e do banco (nunca do navegador), entidade autorizada
  (`entity-authorization.ts`: existe, é da organização e é visível para o ator), relógio do cliente corrigido acima da
  tolerância, evento tardio marcado, `on conflict` por `event_id`. Lote de outra conta = 409.
- *Fatos de servidor* (`server-fact-taps.ts` + `record-server-event.ts`): login/logout, sessão de voz emitida, ciclo da
  aplicação de feedback, leitura de notificação, exportação — observados na resposta 2xx das rotas existentes, com chave de
  idempotência; nunca alteram a resposta.
- *Projeções* (worker no `server.ts`, só com a coleta ligada): atividade a cada 10 s (fila `usage_projection_dirty` por
  pessoa × dia → `usage_sessions`, `usage_person_days`, `usage_screen_person_days`, marcos), elegibilidade a cada 60 s
  (`usage_eligibility_periods`), retenção a cada 6 h. Idempotentes; evento tardio reprocessa o dia do FATO.
- *Leitura*: um `usage-analytics-reader.ts` por módulo dono do dado (feedbacks, ciência/avaliação, aplicação, conversas,
  entregas do Workflow, workflows, notificações, conhecimento, pessoas, casos, IA) — a monitoria não lê tabela de outro módulo
  por conta própria. Consultas por aba em `application/query/`, escopo resolvido a cada request pelas atribuições (fora do
  escopo = 404), `metricValue` com status (VALUE / NO_DATA / PARTIAL / NOT_MEASURED), cobertura e variação.

Tabelas (116): `usage_events`, `usage_ingest_batches`, `usage_coverage`, `usage_sessions`, `usage_person_days`,
`usage_screen_person_days`, `usage_projection_dirty`, `usage_projection_runs`, `usage_eligibility_periods`,
`usage_eligibility_tracking`, `usage_person_milestones`, `usage_population_classifications`, `usage_settings`,
`usage_collection_toggles`, `usage_auth_failure_counts`.

## Regras que o código aplica

- Pessoas únicas no intervalo = distintas do intervalo (nunca soma de distintos diários); p95 calculado sobre o conjunto
  (nunca média de p95).
- Antes do início da medição = “sem dados”, nunca zero; período parcialmente coberto é rotulado.
- Classificação de população (REAL / TEST / DEMO / AUTOMATION) é explícita, gravada no evento; demonstração e testes ficam fora
  por padrão (filtros “incluir”). Administração e QA Lab ficam fora do uso de produto por padrão.
- Estrutura “no momento do fato” (snapshot na ingestão) ou “atual” — o filtro diz qual.
- Execuções de Workflow abertas não entram no p95 de duração nem viram sucesso.
- Coorte de feedback com janela incompleta é provisória; ação em feedback antigo entra no volume, não na coorte.
- Comentários de avaliação só com `usability.comments.view`; agregados nunca carregam ids nem nomes.

## Massa de teste (prova)

`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run usability-proof` (banco de teste) cria uma organização própria (fuso
America/Fortaleza; D1 = 05/10/2026, D2 = 06/10/2026; “agora” = 07/10 12:00 local), roda a ingestão REAL e as projeções e
apaga tudo pela organização no fim. Pessoas: Ana (operadora, desktop com 2 abas + celular), Bruno (elegível sem atividade,
Grupo B), Carla (sem conta), Diego (conta desabilitada, férias), Fábio (demonstração), Gabi (conta criada depois do início da
coleta, nunca acessou), Hugo (desligado), Vera (Administradora geral), Lia (leitora de agregados), Alan (analista no Grupo B);
Xavier, em outra organização, prova isolamento. Resultados conferidos (período D1–D2, visão da Vera):

| O que | Esperado |
| --- | --- |
| Pessoas ativas / elegíveis / adoção | 2 / 6 / 33,3 % (“2 de 6”); com demonstração = 3 ativas |
| DAU por dia | 05/10 = 2, 06/10 = 1 (soma 3 ≠ 2 únicas) |
| Sessões de Ana | 3 telas + 10 cliques + reload + 2 abas = 1 acesso; 46 min parado = nova; celular = outra |
| Tempo ativo de Ana | 100 s em 05/10 e 20 s em 06/10 (abas simultâneas contam uma vez; meia-noite divide) |
| Segmentos | ativos 2, elegíveis 6, inativos 4, nunca acessou 1 (Gabi), sem registro desde a coleta 3, sem conta 1, conta desabilitada 1, afastado 1, desligado 1 |
| Feedbacks (coorte de 7 dias) | disponíveis 4, expostos 3, abertos 2, com ciência 1, aplicação iniciada 1, não expostos 1; avaliação vigente UP→DOWN→NONE = retirada; confirmação com 1 falha recuperada + 1 repetida idempotente |
| INIA | 1 pessoa (texto e voz); 1 mensagem de texto + 2 turnos de voz humanos; 3 conversas (2 com participação humana); voz: 2 intenções, 2 conexões, 1 com fala, 1 reconexão, 770 s conectados, 30 s de microfone, 15 s de reprodução |
| Workflows | 3 raízes; W1 = 2 raízes com 10 filhas e retentativas, 2 pessoas alcançadas, 1 concluída + 1 falha (50 %), duração mediana 299 s, custo US$ 0,010000 por raiz, solicitante Vera; W2 aguardando revisão humana; W3 publicado sem execução |
| Funis | Entrada→avaliação 4·3·1·1; Ciência 4·3·2·1; Chat 2·1·1; Voz 2·2·2·1·1; Manual 1·1·1·1·1; Notificação 1·1·1·1; Convite 1·1·1·1·0 |
| Escopo | Alan vê só Alan e Bruno; detalhe de Ana para Alan = 404; Lia não recebe nomes/ids, detalhe = 403, sem exportação |
| CSV | mesmo total da API; linha “Adoção no período;…;VALUE;33,3;2;6;” |

As fixtures da tela (`frontend/src/components/admin/usability/testing/usability-fixtures.json`) são as respostas REAIS da API
sobre esta massa: `NODE_ENV=test npx tsx scripts/usage-analytics/dump-fixture-responses.ts <pasta> --frontend` (backend) — o teste
`usability-page.test.tsx` confere que cada resposta passa no schema da tela e renderiza todas as abas sobre ela.

## Desempenho

`NODE_ENV=test npx tsx scripts/usage-analytics/perf-check.ts [pessoas=2000] [dias=37] [repetições=7]` (backend) cria no banco
de TESTE uma organização própria com massa sintética no formato da ingestão (sessões diárias de 20 eventos em ~60 % dos dias,
25 % no celular, feedbacks com exposição/abertura/avaliação/ciência, conversas com voz e texto, 3 Workflows diários com fan-out
de 300 pessoas), roda a projeção REAL, mede cada consulta (contexto + consulta, 1 aquecimento + 7 repetições) e apaga tudo pela
organização. `PERF_KEEP=1` mantém a massa, `PERF_REUSE=1` mede sobre ela sem recriar, `PERF_SLOW_MS=n` lista SQL lento.

Medição de 06/10/2026 — Apple M5, 10 núcleos, 16 GB, PostgreSQL 17.11 local; **2.010 pessoas · 856.656 eventos · 46.339
sessões · 43.870 pessoa-dia · 5.217 feedbacks · 34.431 mensagens · 33.424 execuções de Workflow**:

| Consulta (Administrador geral, últimos 30 dias salvo indicação) | p50 (ms) | p95 (ms) |
| --- | ---: | ---: |
| Contexto (filtros/dicionário) | 160 | 175 |
| Visão geral | 921 | 954 |
| Visão geral · leitor de agregados | 851 | 904 |
| Pessoas e acessos (lista) | 327 | 341 |
| Pessoas e acessos · escopo de Grupo | 128 | 141 |
| Telas e cliques | 591 | 626 |
| Feedbacks e ciência | 279 | 370 |
| INIA voz e texto | 178 | 263 |
| Workflows | 111 | 120 |
| Jornadas e dificuldades | 744 | 936 |
| Qualidade da medição | 86 | 103 |
| Detalhe individual / linha do tempo | 6 / 3 | 10 / 4 |
| Visão geral · 37 dias (massa inteira) | 1.272 | 1.309 |
| Pessoas · 37 dias / retenção · 37 dias | 363 / 89 | 385 / 94 |

**Pior p95: 1.309 ms — meta de 2 s atendida** neste hardware. Projeção de atividade: ~450 pessoa-dia/s (um dia com
~1.200 pessoas ativas ≈ 3 s; a meta de 60 s entre evento e painel folga). Antes dos ajustes desta medição a Visão geral levava
2,3 s e Telas e cliques 2,8 s: o alcance de pessoas virou UNIÃO de ramos (o `OR` com a subárvore recursiva fazia o planejador
comparar cada pessoa com a lista inteira — 185 ms → 11 ms em toda consulta), o tempo ativo por tela passou a vir da projeção
pessoa × dia × tela (recalcular 500 mil heartbeats custava ~700 ms; com recorte por dispositivo/versão/ambiente continua vindo
dos brutos) e recorrência por funcionalidade e exposição × acionamento viraram agregações de uma passada. Logo depois de uma
carga em massa, rode `analyze`: sem estatística o planejador escolhe laços aninhados (segundos por consulta). Este Postgres
não tem JIT.

## Procedimentos

**Ativar num ambiente**: aplicar a migration 116 → `INIA_USAGE_COLLECTION=ON` → reiniciar o backend (o worker sobe junto) →
conferir em Qualidade da medição que os lotes chegam → `INIA_USABILITY_PANEL=ON` → conceder os papéis pela aba Papéis. A
medição começa no primeiro evento: nada antes disso é inventado (as telas mostram “sem dados antes de…”).

**Reprocessar** (projeção mudou ou dado tardio): Qualidade da medição › Gerenciar › Reprocessar (`POST /reprocess`
`{from, to, reason}`, até 400 dias, auditado) — marca os dias × pessoas com eventos no intervalo e o worker refaz sessões e
fatos a partir dos eventos brutos (só dentro da retenção dos brutos).

**Retenção**: eventos brutos por `raw_retention_days` (padrão 90); sessões e fatos pessoa × dia (× tela) por
`fact_retention_months` (padrão 13). Configurável por organização em Gerenciar; a rodada (a cada 6 h) apaga em lotes e registra
em `usage_projection_runs`. Nunca apaga dados de negócio (feedbacks, conversas, execuções), marcos de primeiro/último acesso nem
classificações.

**Desligar / rollback**: `INIA_USAGE_COLLECTION=OFF` para a coleta e o worker (o navegador recebe 404 e para de enviar);
`INIA_USABILITY_PANEL=OFF` remove a área. Os dados ficam. Remover de vez: apagar as tabelas da 116 (nenhuma outra tabela as
referencia) e as permissões/papéis do código. A coleta por organização também pode ser desligada sem deploy em Gerenciar.

**Manter o catálogo**: tela, elemento, evento, métrica ou funil novo → editar `backend/src/modules/usage-analytics/domain` e
rodar `npx tsx scripts/usage-analytics/export-catalog.ts` (cópia do frontend) e `npx tsx scripts/usage-analytics/export-docs.ts`
(este catálogo); os testes `client-catalog.test.ts` e `usage-docs.test.ts` falham se algum estiver desatualizado. Instrumentar
uma tela = declarar no catálogo + atributos `data-usage-*` (ou `startUsageAction`) no componente.

## Limitações

- Telas: 15 instrumentadas por completo (Acompanhamento, chat, histórico de conversas, feedback aberto/sessão/ciência/motivo,
  notificações, material de apoio, execução manual, a própria monitoria); as demais 66 medem só visualização, abas e links
  (`PARTIAL`, listadas no catálogo).
- “Aberto” = detalhe expandido ou sessão com a INIA; leitura do texto curto no card só aparece como rolagem (nunca “lido”).
- Exposição de elemento, rolagem e tempo ativo só existem desde o início da coleta e dependem do navegador estar em primeiro
  plano; navegador que bloqueia `localStorage`/`sendBeacon` perde o fim da sessão.
- Voz: fatos do navegador (intenção, permissão, conexão, microfone, reprodução) + sessão emitida pelo servidor; nada sobre o
  conteúdo da fala.
- Sinais de dificuldade são heurísticas com parâmetros versionados — indicam onde olhar, não provam frustração.
- Comparação com o período anterior só é exata quando os dois períodos estão cobertos pela medição.
- Custo de IA por Workflow só existe para chamadas correlacionadas (migration 084 em diante).
