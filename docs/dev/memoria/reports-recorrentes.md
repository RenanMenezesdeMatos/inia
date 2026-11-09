# Memória — Reports recorrentes

> Área criada em 16/10/2026. Desenho e decisões: [../reports-recorrentes.md](../reports-recorrentes.md). Wiki: `/wiki/estrutura/reports`.
>
> Ver também: [liderancas.md](liderancas.md) (as ferramentas que os reports reaproveitam), [central-de-dados-e-instalacao.md](central-de-dados-e-instalacao.md) (feeds e frescor), [acesso.md](acesso.md) (papéis), [escala-e-operacao.md](escala-e-operacao.md) (worker).

## Regra que não muda

**O report guarda uma DEFINIÇÃO reproduzível, nunca texto de chat**: ferramenta da liderança (`INDICATOR_QUERY` → `leadership_indicator_query`, `WORKFORCE` → `leadership_workforce`, `INDICATOR_DIAGNOSIS` → `leadership_indicator_diagnosis`) + parâmetros válidos (indicadores por CÓDIGO) + estrutura (`RECIPIENT` = "de quem recebe", resolvida a cada execução; `FIXED` = sujeito validado contra o escopo de cada destinatário) + período (`LAST_CLOSED` | `LAST_N_CLOSED` | `FIXED_MONTH` | `CURRENT` | `TODAY`). A execução converte (`toToolCall`) e chama `executeLeadershipTool` — mesmo cálculo e escopo do chat. Números, gráfico e comparação são da aplicação; a IA só interpreta.

## Peças

- **Migration 148** (`148_recurring_reports.sql`): `reports` (config versionada `config_version`, `next_run_at`, exclusão lógica), `report_versions`, `report_runs` (único `report_id × scheduled_for`; status QUEUED/RUNNING/COMPLETED/NOT_FORWARDED/PARTIAL/BLOCKED/SKIPPED/FAILED; lease `claimed_until`, `attempts`), `report_deliveries` (único `run_id × scope_key`; `kind` DELIVERY | NOT_FORWARDED com `reason` STALE_SOURCES/NO_CHANGE/INSUFFICIENT_COVERAGE; `dataset` = cartão `QUERY_TABLE`, `visualization`, `comparison`, `sources`, `fingerprint`; análise PENDING/READY/FAILED/DISABLED; `occurrences`/`last_checked_at` do aviso repetido), `report_delivery_recipients` (único `run_id × recipient_person_id` — seleções combinadas não duplicam), `report_proposals` (ofertas do chat).
- **Domínio** `backend/src/modules/reports/domain/`: `report-definition.ts` (schemas zod, `toToolCall`, `requiredSources`, `definitionSignature`, `describePeriod`), `report-schedule.ts` (puro, reaproveita `workflows/application/schedule-recurrence.ts`; `nextRunAfter`, `latestDueAtOrBefore`, `onMissingDay` SKIP/LAST_DAY), `visualization.ts` (`parseCell` lê os formatos da aplicação — "—" é ausência, nunca zero; `compatibleVisualizations` pelo formato, `staticCompatibility` pela definição; `buildVisualizationData`), `comparison.ts` (semântica por coluna: % fora/Q4/dispersão menor é melhor; atingimento/PRV maior é melhor; valor pela direção do catálogo; TARGET = neutro), `delivery-decision.ts` (regra de atualização + impressão digital do cartão).
- **Aplicação** `backend/src/modules/reports/application/`: `report-store.ts` (porta + Pg), `report-runtime.ts` (contexto por CONTA: `loadLeadershipSession` com payload montado da conta ativa; `contextFor` = uma conta (prévia, chat), `contextsFor` = os destinatários de uma execução em lote — ver "Execução em lote"; estruturas, cobertura, estado das fontes; público de distribuição; `visibilityOf(access, "reports.distribute")`), `report-run-reads.ts` (leitor do analytics de UMA execução), `report-executor.ts`, `report-scheduler.ts` (agenda atômica por CAS + chave única; fila com `skip locked`; 3 tentativas), `report-analysis.ts` (caso de uso `REPORT_ANALYSIS`/`REPORT_ANALYST`, `runWithAiOrganization`; recuperação sem duplicar), `report-proposals.ts` (rascunho a partir da chamada executada, sem insistência, `classifyReply`), `report-service.ts` (permissões), `report-deliveries-reader.ts` (recebidos, detalhe, histórico do destinatário).
- **API** `/api/v1/reports` (`presentation/reports-router.ts`): lista, acesso, opções, busca de pessoas do público, prévia, proposta, recebidos, entrega (+ lida, + nova tentativa da análise), CRUD, status, executar agora.
- **Worker** (`src/main/server.ts`, papel `worker`/`all`): jobs exclusivos `report-schedule` (60 s), `report-runs` (15 s), `report-analysis-retry` (5 min). Em produção rodam nos serviços `INIA-Processamento*` (WinSW) — nada novo a instalar.
- **Acesso**: permissão `reports.distribute` e papel `REPORT` ("Report", escopos ORGANIZATION/GROUP/SUBGROUP, delegável pelos administradores e pelo administrador de acessos); capacidades `canDistributeReports` e, no `/auth/me`, `canUseReports` (= regra da área Diagnóstico OU distribuir).
- **Chat** (`realtime-router.ts`): depois da resposta de quem lidera, `reportOfferFor` cria a proposta (texto + SSE `report_offer`; `reportOffer` nas mensagens ao reabrir); a mensagem seguinte passa por `answerPendingProposal` ("sim" → SSE `navigate` para `/reports/novo?proposta=…`; "não" → dispensa; outra coisa → expira). Voz: `leadership_ask` aplica o mesmo e devolve `navigate`/`reportOffer` na resposta da ferramenta; regra em `LEADERSHIP_VOICE_RULES`.
- **Acompanhamento**: 3º ramo de `loadFollowUpFeed` (`kind` REPORT, categorias REPORT/REPORT_NOT_FORWARDED, payload `report`) só no feed da própria estrutura.
- **Frontend**: `schemas/reports/reports.schema.ts`, `services/reports/`, `queries/reports/`, `components/reports/*` (lista, formulário em partes `report-form/*`, detalhe, entrega, `report-visualization.tsx` com o `chart` do shadcn/recharts, `report-delivery-view.tsx`), rotas `app/(app)/reports/*`, atalho "Reports" no seletor de área, item no `FollowUpEntry` (famílias REPORT/REPORT_NOT_FORWARDED), botão "Criar report desta consulta" no chat. O schema do feed recebe `report` sem tipo e o item valida com o schema de reports (evita ciclo analytics → reports → liderança → analytics).

## Decisões

- **Regra de atualização** (ver o desenho): cobertura < 70% → não encaminhado; fonte vencida (situação funcional) → não encaminhado; mesmo período e nenhuma marca d'água mudou → não encaminhado (STALE_SOURCES); marca mudou e dados idênticos → não encaminhado (NO_CHANGE); senão entrega. Marcas: versão OFFICIAL de `analytics_versions`, maior `period_end` das medições dos membros, maior `started_at` das interações, frescor da situação funcional. Aviso repetido (mesmo motivo e período) soma ocorrências no mesmo item.
- **Comparação**: competência única → anterior (nova consulta com `competencia`); últimas N → N anteriores; mês a mês → primeira × última; força de trabalho → entrega anterior da mesma chave (sinaliza configuração alterada); período em curso, recorrência e diagnóstico → sem comparação equivalente (motivo dito). As duas pontas usam a estrutura ATUAL (limitação da hierarquia sem histórico, como nas ferramentas).
- **Distribuição**: destinatários agrupados pela chave de escopo (sujeito + membros); uma consulta por chave; quem cria não recebe nem vê o conteúdo de outros; destinatário sem estrutura (RECIPIENT) ou sem acesso (FIXED) fica registrado como não atendido.
- **Proposta do chat**: competência padrão recente (até 3 meses) vira `LAST_CLOSED`; mês antigo explícito fica `FIXED_MONTH`; indicador pelo código do catálogo (exato, nome contido sem ambiguidade, ou o código já resolvido no cartão quando é um só).
- **Exclusão**: lógica; agenda cancelada; entregas ficam no histórico de quem recebeu (sem política de retenção específica — segue a do projeto, desligada).

## Execução em lote (18/10/2026)

Achado 14 da auditoria de eficiência de 17/10 (N+1 por destinatário). As entregas não mudaram: mesmos destinatários, mesmas versões por escopo, mesma regra de atualização (`delivery-decision.ts`) e mesma impressão digital do cartão.

- **Destinatários em lote** (`runtime.contextsFor(organizationId, contas)` → `lookup(conta)`): contas (uma consulta), atribuições de papel (`loadAccessContexts` em `access/infrastructure/postgres-access-repository.ts`, duas consultas, mesma regra de conta ativa de pessoa ativa), grafo de pessoas fixado no lote (`PinnedPeopleGraphCache` em `organization-people-graph.ts`: uma conferência de versão, não uma por pessoa) e fechamento/fuso (opção `closure` de `loadLeadershipSession`) são lidos UMA vez. A sessão de cada destinatário sai do MESMO `loadLeadershipSession` sobre `ReportRunReads`, sem consulta por pessoa. O agrupamento continua pela chave de escopo (sujeito + membros): a ferramenta roda uma vez por chave, com a sessão do primeiro destinatário dela, como antes. O responsável (estrutura fixa) entra no mesmo lote e é montado uma vez, mesmo quando também recebe.
- **Cobertura** (`ReportRunReads.coverageReads()`): reaproveita a ÚLTIMA leitura da ferramenta (catálogo, fechamento dos indicadores, PRV) quando ela cobre o pedido (mesma organização, todas as pessoas e competências), filtrando as mesmas linhas que a consulta devolveria. As consultas da própria ferramenta não mudaram. Leitura que falhou nunca é reaproveitada. A direção do indicador na comparação usa o mesmo catálogo lido.
- **Estado das fontes**: o que não depende da estrutura (feeds de TODAS as fontes numa consulta com `contract_key = any`, versão e `changed_at` do fechamento oficial, frescor da situação funcional) é lido uma vez por execução. As marcas por estrutura continuam por grupo, inclusive a `max(period_end)` das medições, que segue igual porque a troca depende de decisão pendente (ver a auditoria).
- **`contextFor` não mudou de comportamento** (prévia e chat), exceto os feeds numa consulta. É o caminho conta a conta que a prova usa como referência.
- **Um retrato por execução**: grafo, fechamento e estado das fontes da organização são lidos no início. Uma carga que chegue no meio da execução entra na próxima, e as chaves únicas continuam impedindo duplicar.
- **Prova** `reports/testing/report-run-batch-proof.test.ts` (`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run report-run-batch-proof`, banco de teste). Cria uma organização própria (`slug` `prova-report-lote-*`), com gerente, duas coordenações, quatro supervisões (uma com conta inativa e outra com cobertura de 25%), operador com conta e administradora com acesso só pelo Grupo, e apaga tudo no fim. Os dados ficam commitados porque, numa transação aberta, a versão OFICIAL muda a cada leitura. Cada cenário roda duas vezes (entrega e aviso) nos dois caminhos e prova: entregas, destinatários e resultado idênticos; menos consultas; numa estrutura fixa, o número de consultas não depende de quantos destinatários a veem; cobertura sem consulta e com o mesmo número; uma consulta de feeds por execução. Testes sem banco: `report-run-reads.test.ts` e o caso de lote em `report-executor.test.ts`.
- **Medição** no `inia_test` (massa demo, 2.415 pessoas), sem análise da IA e com o relógio fixo. Um script fora do repositório roda o executor real com o store em memória e um contador de consultas, no HEAD anterior e depois da mudança. Antes × depois na 1ª execução (entrega) e na 2ª (aviso):

  | Cenário | Consultas (entrega) | Consultas (aviso) |
  |---|---|---|
  | Estrutura de quem recebe, 37 pessoas (30 supervisores, 5 operadores, 2 líderes) | 711 → 310 | 576 → 202 |
  | Estrutura fixa vista por 16 pessoas (6 recebem, 10 sem acesso) | 122 → 20 | 117 → 16 |
  | Report para si, estrutura fixa, 3 competências | 28 → 19 | 24 → 15 |
  | Diagnóstico, 10 supervisores | 188 → 76 | 188 → 76 |
  | Quartis do PRV, 9 coordenadores | 236 → 109 | 200 → 73 |
  | Força de trabalho, 10 supervisores | 122 → 49 | 122 → 49 |
  | Estrutura de quem recebe, 99 supervisores e coordenadores | 2.105 → 940 | 1.685 → 604 |

  A impressão digital das entregas (sha-256 do JSON normalizado, sem ids e datas) foi igual antes e depois nos 7 cenários, em todas as rodadas.
  - O que sobra é custo da própria ferramenta, por grupo: o catálogo é lido 2× a cada chamada, a consulta de referência da comparação refaz a ferramenta inteira, e há o `loadPeriodCoverage`.
  - O lote custa ~10 consultas fixas por execução. Saíram ~6 idas por destinatário (conta, acesso, fuso, versões do grafo) e 3–6 por grupo (feeds, versão oficial, cobertura).
  - Tempo é a mediana de 3 rodadas alternadas antes/depois, na repetição quente:

  | Cenário | Banco local (~0,1–0,3 ms por ida) | Latência simulada de 1 ms por consulta |
  |---|---|---|
  | 99 destinatários, entrega | 687 → 763 ms (dentro do ruído) | 3,85 s → 2,06 s |
  | 99 destinatários, aviso | 561 → 535 ms | 3,00 s → 1,55 s |
  | 37 pessoas, entrega | 218 → 251 ms | 1,39 s → 0,62 s |
  | Estrutura fixa vista por 16, entrega | 23 → 13 ms | 177 → 36 ms |

  No banco local o ganho some no ruído, porque as consultas removidas eram as baratas. A latência simulada corresponde a worker e banco em máquinas diferentes.
  - Cuidado ao medir no `inia_test`: outras sessões gravam nele e a versão OFICIAL da organização demo muda (2792 → 3127 durante a medição). Compare só rodadas do mesmo momento, alternando antes/depois.

## QA ao vivo (16/10/2026, banco dev)

- supervisor01: "Quem são os TOP 3 em Reincidência do meu time?" → oferta (SSE `report_offer`, linha no texto); "sim" → `navigate` para a proposta; rascunho preservou indicador por código, ordenação, agrupamento, "minha equipe" e "última competência". Report salvo e ativo (diário 08:00 America/Fortaleza). Executar agora → entrega (equipe da Daniela, Set/26, barras, comparação Set × Ago com 2 melhoras/2 pioras pela semântica da Reincidência, análise da IA pronta). Segunda execução → **não encaminhado** STALE_SOURCES (fechamento oficial sem mudança), entrega válida preservada. Feed do Acompanhamento com os dois itens distintos.
- coordenador01 com o papel REPORT **temporário** no Grupo "B2C · Atendimento Geral" (atribuição inserida e revogada ao final): Grupo de fora → 403 AUDIENCE_OUT_OF_SCOPE; report para o nível Supervisor (estrutura de quem recebe) → 10 supervisores do Grupo, cada um com a PRÓPRIA equipe (competência por cobertura de cada equipe), coordenador não recebeu, ~22 s com 10 análises; papel revogado → próxima execução BLOCKED (DISTRIBUTION_REVOKED).
- Telas conferidas no navegador headless: lista, formulário a partir da proposta, entrega, Acompanhamento/painel da INIA ("Report criado a partir desta consulta").
- Artefatos no banco dev: report ATIVO de supervisor01 ("TOP 3 em Reincidência da equipe") e report INATIVO distribuído de coordenador01 ("Q4 em TMA da equipe (supervisores)") com 10 entregas; atribuição REPORT de coordenador01 revogada.

## Posse da análise da IA por entrega (19/10/2026)

Antes, `retryPendingAnalyses` selecionava entregas PENDING/FAILED sem reivindicar e chamava a IA (paga) para cada uma: dois processos juntos, ou a recuperação junto com a análise que `report-runs` faz logo depois de gravar (a entrega nasce PENDING com `analysis_updated_at` nulo), chamavam a IA em dobro, gastavam `analysis_attempts` em dobro e a última gravação vencia (um FAILED podia cobrir um READY). Agora só quem reivindica chama a IA. Sem migration: as colunas da 148 bastam.

- **Reivindicar** (`ReportStore.claimAnalysis` / `claimNextAnalysis`, `report-store.ts`) = UPDATE condicional que marca PENDING, soma a tentativa e grava `analysis_updated_at = now()` ANTES da chamada. `analysis_updated_at` é o prazo da posse (10 min, `ANALYSIS_CLAIM_SECONDS`) e continua sendo a espera entre tentativas. `analysis_attempts` passou a contar chamadas INICIADAS (antes, só as terminadas) e o número da tentativa é a ficha da posse.
  - AUTOMATIC (análise logo depois da execução e recuperação): PENDING/FAILED, tentativas < 3, livre (nunca reivindicada ou mexida há mais que o prazo).
  - MANUAL ("Tentar de novo"): só FAILED, sem limite nem espera. Durante qualquer análise a entrega fica PENDING ("em preparação"), então FAILED = ninguém analisando. Dois cliques, ou dois destinatários da mesma entrega, fazem uma chamada; o outro recebe PENDING.
  - A recuperação reivindica UMA por vez com `for update skip locked` (o prazo conta da chamada, não do começo da rodada) e para antes da próxima com o `signal` abortado (opções `{ limit?, signal? }`, mesma assinatura do worktree `stoic-feistel-a0bd7b`).
- **Gravar** (`finishAnalysis`) só vale se a tentativa ainda é a vigente (`analysis_attempts` igual e PENDING). Uma chamada que passou do prazo e foi reassumida por outro processo tem o resultado descartado (log `report_analysis_superseded`).
- **"Em análise" abandonada** (processo caiu depois de reivindicar) que a recuperação não pega mais (3 tentativas, ou fora dos 7 dias) vira FAILED no começo da rodada (`closeAbandonedAnalyses`), sem chamar a IA, e o "Tentar de novo" volta a aparecer. Sem isso ficaria "em preparação" para sempre.
- **Testes**: unidade em `reports/application/report-analysis.test.ts` (o armazenamento em memória reproduz a mesma posse, com relógio injetável). Cobre duas recuperações juntas, recuperação × análise inicial nas duas ordens, posse vencida, cliques simultâneos, abandonada e sinal. Com a posse desligada no fake, 4 dos 7 falham.
- **Prova** `reports/testing/report-analysis-claim-proof.test.ts` (`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run report-analysis-claim-proof`): dois pools (dois processos) no banco de teste, com organização própria `prova-report-analise-*` apagada no fim. A recuperação é global, como no worker, então a prova recusa rodar se houver análise a recuperar de outra organização. A migration 148 foi aplicada ao `inia_test` em 19/10/2026 para esta prova (antes ele parava na 147).
- **Limite**: uma chamada de IA que passe de 10 min (fila do limitador + prazo da conexão, até 300 s, + candidatos de reserva) pode ser reassumida e gerar uma segunda chamada. A gravação atrasada nunca cobre a vigente.

## Limitações

- Público de distribuição recortado pelo Grupo/Subgrupo do CADASTRO das pessoas (`team_id`/`subteam_id`), como o resto do acesso por escopo.
- Operadores como destinatários: só recebem se tiverem escopo de liderança (as ferramentas são da liderança); senão ficam como "não lidera uma estrutura".
- A prévia usa a visão de quem configura; um distribuidor sem estrutura própria não tem prévia de "estrutura de quem recebe".
- Sem aviso no sino para entrega nova (a entrega fica no Acompanhamento e em Reports → Recebidos).
- Lease de 15 min sem renovação: execução muito longa (milhares de destinatários) pode ser retomada por outro worker; as chaves únicas impedem duplicar.
