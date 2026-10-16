# Central de Dados — arquitetura e operação

> **Estado (2026-09-16): implementada.** Módulo `backend/src/modules/data-hub` (migrations 056 e 059),
> área admin `frontend/src/components/admin/data-hub` (rota `/admin/data-hub`), Wiki em
> `/wiki/central-de-dados`. Esta nota é a referência de desenvolvedor; a Wiki é a referência de produto.
> As seções "Fluxo conceitual" e "Colaboradores: situação funcional" abaixo descrevem contratos que
> a implementação já cumpre (`INDICATOR_MEASUREMENTS`, `EMPLOYEES.currentStatus`, `EMPLOYEE_ABSENCES`).

## Mapa do módulo (`backend/src/modules/data-hub`)

| Camada | Arquivos | Responsabilidade |
| --- | --- | --- |
| `domain/data-contract.ts`, `domain/contracts/*`, `domain/contract-registry.ts` | contratos canônicos (`EMPLOYEES@1`, `INDICATOR_MEASUREMENTS@1`…), chave natural, dependências, política (`PARTIAL_ALLOWED`/`ATOMIC`), exemplos | "qual formato a INIA entende" |
| `domain/mapping.ts` | dot path, transformações declarativas (TRIM/UPPERCASE/LOWERCASE/PARSE_DATE/PARSE_DECIMAL/BOOLEAN_MAP/DEFAULT/CONSTANT/CODE_MAP), coerção por tipo, `validateMapping`, `suggestMapping` (por nome, sem IA) | "como o formato do cliente vira o da INIA" |
| `domain/csv-parser.ts`, `infrastructure/xlsx-parser.ts` | CSV próprio (encoding, separador autodetect, aspas) e `.xlsx` via exceljs (só células; macros nunca executadas) | leitura |
| `domain/schema-fingerprint.ts` | fingerprint das colunas de origem; coluna obrigatória ausente ⇒ `DATA_SCHEMA_CHANGED` + feed `DEGRADED` | mudança de esquema |
| `domain/freshness.ts` | `SourceStatus` × `ConnectionHealth` × `FreshnessState` (nunca misturados), cadência e `nextSyncAt` no fuso da organização | saúde × atualidade |
| `domain/error-codes.ts` | códigos estáveis de carga (`DATA_SOURCE_AUTH_FAILED`…) e de registro (`DATA_EMPLOYEE_NOT_FOUND`…); transitórios têm retry | erros |
| `application/ports.ts` | `SecretStore`, `RawObjectStore`, `HttpClient`, `SftpClient`, `Clock` | ports |
| `infrastructure/aes-secret-store.ts` | AES-256-GCM com chave **fora do banco** (`DATA_HUB_SECRET_KEY`, obrigatória em produção; fallback fixo só em dev/test) | segredos |
| `infrastructure/pg-raw-object-store.ts` | objetos brutos em Postgres (bytea) com `expires_at` (`DATA_HUB_RAW_RETENTION_DAYS`, padrão 30); trocar por S3 = trocar a classe | raw/staging |
| `infrastructure/fetch-http-client.ts`, `infrastructure/ssh2-sftp-client.ts` | adaptadores reais (fetch nativo; ssh2 com verificação de host key por fingerprint) | conectores |
| `application/connectors/*` | file (upload/SFTP), API Pull (auth, paginação, watermark), SFTP (pattern, dedup por checksum) | "como buscar/receber" |
| `domain/database/*`, `infrastructure/external-databases/*`, `application/connectors/database-connector.ts`, `application/database-run.ts` | bancos externos (SQL Server, PostgreSQL, MariaDB, MySQL): descoberta, amostra, leitura keyset página a página com checkpoint por página, continuação e recuperação — ver `central-de-dados-bancos-externos.md` | "como ler um banco do cliente" |
| `application/reference-resolver.ts` | lookups em lote (matrícula, indicador, grupo, subgrupo, interação, flag, operação) — zero N+1 | referências |
| `application/writers/*` | um writer por contrato: `prepare` (referências + regras de catálogo) e `apply` (upsert multi-linha via `unnest`, lineage, efeitos canônicos) | "como entra no domínio" |
| `application/run-pipeline.ts` | CONNECTING → FETCHING → PARSING → MAPPING → VALIDATING → APPLYING → COMPLETED/PARTIAL/FAILED; métricas, quarentena, checkpoint, retry com backoff | carga |
| `application/run-service.ts` | fila (`data_ingestion_runs`), claim por `for update skip locked` + lease, `runDataHubTick` (server.ts, 15 s), `kickWorker` após enfileirar | worker |
| `application/push-ingestion.ts`, `presentation/data-ingestion-router.ts` | `POST /api/v1/data-ingestion/:sourcePublicId/:feedKey` — token (hash), `Idempotency-Key`, rate limit por token, 202 + runId | API Push |
| `presentation/data-hub-router.ts` | `/api/v1/admin/data-hub` (fontes, feeds, uploads, amostra/preview sem efeito, runs, quarentena + CSV, reprocesso, lineage, overview, quality, contratos) | admin |
| `testing/fakes.ts`, `testing/data-hub-proof.test.ts` | MockHttpClient, FakeSftpClient, CapturingLogger; prova contra o banco de teste (`INIA_DB_PROOF=1 npx vitest run data-hub-proof`) | testes |

Efeitos canônicos que os writers reutilizam (nunca um caminho paralelo): `enrollIndicatorWorkflows` (medição nova/alterada),
`enrollFlagWorkflows` (flag nova/alterada), `applyEmployeeStatusSnapshot` (situação funcional e ausências). Preview/amostra/teste de conexão nunca escrevem.

Atomicidade: contratos `PARTIAL_ALLOWED` aplicam em lotes de 1.000 (`APPLY_BATCH`), cada lote na própria transação;
`ATOMIC` (ORGANIZATIONAL_STRUCTURE) ou feed com `fail_on_any_rejection` exigem zero rejeição e uma transação única.
Checkpoint (API Pull) só avança após aplicação bem-sucedida; arquivo SFTP só vira "processado" após COMPLETED/PARTIAL.

Volume medido (banco de teste, `data-hub-proof`): 100 mil medições por CSV — parse ~0,1 s, validação ~2,9 s, aplicação ~3,3–4,2 s,
total ~6,5–7,2 s, heap Δ ~90–175 MB; segunda carga idêntica: 100 mil inalteradas, nada duplicado.

Identidade externa de Grupo/Subgrupo: `teams.external_code` / `subteams.external_code` (migration 056, backfill determinístico
`inia_external_code(name)`; subgrupo = `GRUPO/SUBGRUPO`). Colaborador = `people.matricula`.

Demo: `seeds/demo/002_data_hub.sql` cria duas fontes sem credencial real ("Importação manual (demo)" ativa com feeds de
Colaboradores, Medições, Interações e Fechamento oficial mensal — este já no `@2`, com numerador/denominador; "API Operacional
(demo)" pausada com host `.invalid`); feeds de medição e fechamento usam `source_namespace = 'DEMO_SEED'`.
O reset da massa demo apaga as duas fontes (cascata).

## Fechamento oficial com numerador e denominador (`OFFICIAL_INDICATOR_PERFORMANCE@2`, 2026-10-16, migration 147)

O fechamento mensal por colaborador × indicador (`employee_indicator_performance`) aceita, a partir do `@2`, os
componentes do valor oficial — `numerator` e `denominator`, opcionais — para a INIA somar uma estrutura em valor
(TMA da coordenação = Σ segundos ÷ Σ atendimentos) e dizer quanto cada unidade pesa nele. Nada do oficial é
recalculado: atingimento, PRV, quartil e peso continuam os da fonte.

| Regra | Onde |
| --- | --- |
| Os dois juntos; denominador > 0 (numerador pode ser negativo) | `validateRecord` do contrato `@2` + check `employee_indicator_performance_components_check` |
| Só estratégias que definem o valor por componentes: Taxa (`num ÷ den × 100`) e Média ponderada (`num ÷ den`); o fator é da ESTRATÉGIA, nunca da unidade | `componentValueScale` em `indicators/domain/indicator-definition.ts` |
| Coerência com o valor informado, tolerância = maior entre 0,1, 1% e meia unidade da casa decimal informada | `checkComponentCoherence` (mesmo arquivo) |
| Incoerência ou componentes em Média simples/Soma/Último valor → registro inteiro na quarentena (`DATA_CONTRACT_VIOLATION`, campo `value` ou `numerator`), nunca corrigido | `officialIndicatorPerformanceWriter.prepare` |
| Sem componentes é válido (inclusive Taxa/Média ponderada); ausente mantém os já recebidos para o MESMO valor, valor novo sem componentes apaga os antigos | `apply` (upsert) |
| `@1` continua aceito (feed antigo) e não conhece os componentes | `PREVIOUS_DATA_CONTRACT_VERSIONS` |

Leitura: `IndicatorPerformanceRow.numerator/denominator` no analytics (`null` = a fonte não informou — nunca
desempenho ruim). Para agregar uma estrutura: valor = Σ numerador ÷ Σ denominador × `componentValueScale(estratégia)`,
só com as linhas que têm componentes; contribuição de uma unidade = participação dela no numerador e no denominador.

## O que já existe e será reutilizado

- `indicator_definitions` descreve o comportamento do indicador (unidade, direção, estratégia,
  granularidade suportada, amostra/cobertura padrão, capacidades). API admin:
  `GET /api/v1/admin/indicator-rules/catalog` devolve as estratégias com `requiredComponents`.
- `indicator_measurements` é o contrato genérico de medição (ver ADR-007). O seed demo
  (`backend/src/infrastructure/database/demo-mass/`) já grava nele sem passar por `/ingestion`.
- `operational-measurement-resolver.ts` lê qualquer indicador pelo catálogo — a Central não precisa
  ensinar nada ao motor.

## Fluxo conceitual

1. **Fonte** (CSV, Excel, API, SFTP, conector) produz linhas brutas.
2. **Mapping** associa colunas da fonte ao contrato genérico: sujeito (matrícula/e-mail → `people.id`),
   `indicatorCode`, `periodStart`/`periodEnd` (ou data + granularidade), `value`, `numerator`,
   `denominator`, `sampleCount`, `source`.
3. **Validação pelo IndicatorDefinition** (por linha):
   - código existe e está ativo; granularidade suportada (`daily_supported` ⇒ `DAILY`);
   - componentes exigidos pela estratégia presentes e coerentes (RATE: `value = numerator ÷ denominator × 100`,
     `denominator > 0`; LATEST/SUM/AVERAGE: `value`);
   - unidade/escala (percentual entre 0 e 100 quando fizer sentido; segundos ≥ 0).
4. **Persistência** idempotente em `indicator_measurements` (upsert pela chave já existente
   `organization × indicador × sujeito × período × origem`).
5. **Relatório de ingestão** por lote: aceitas, rejeitadas (com o motivo por linha), duplicadas.

## Colaboradores: situação funcional (EMPLOYEES) e ausências (EMPLOYEE_ABSENCES)

Camada canônica já existente (migration 058): `people.current_employment_status` (situação ATUAL,
denormalizada) + `employee_status_periods` (histórico por período: `status` normalizado
`ACTIVE | VACATION | LEAVE | INACTIVE`, `raw_status` da fonte, `effective_from`, `effective_to`,
`effective_from_inferred`, `observed_at`, `source_updated_at`, `source`, `source_reference`).
Escrita **só** pelo serviço `people/application/employment-status-service.ts`
(`applyEmployeeStatusSnapshot`) — a Central nunca escreve nessas tabelas diretamente e nunca cria
um segundo cálculo de elegibilidade (o único é `resolveEligibleDaysBySubject`).

**DataContract EMPLOYEES (evolução do contrato de cadastro)** deve prever, além de `active`
(conta/cadastro — conceito diferente de situação funcional):

| Campo | Obrigatório | Semântica |
| --- | --- | --- |
| `externalEmployeeId` | sim | identidade (matrícula), nunca o nome |
| `currentStatus` | não | status BRUTO da fonte (FERIAS, FR, AFAST, LICENCA_MEDICA, ATIVO…) — normalizado por `normalizeEmploymentStatus`; desconhecido ⇒ linha em quarentena, nunca "ACTIVE por palpite" |
| `statusEffectiveFrom` | não | quando a situação passou a valer, **se a fonte informar** |
| `sourceUpdatedAt` | não | quando a fonte diz que o registro mudou (freshness), se confiável |

Política de datas (aplicada pelo serviço, não pelo mapping): `statusEffectiveFrom` informado ⇒
usado tal qual; ausente ⇒ `effective_from` = data LOCAL (fuso da organização) da observação da
carga (`observed_at`), marcado `effective_from_inferred = true` ("situação conhecida a partir desta
carga"). **Nunca inferir** "provavelmente entrou de férias na sexta": a sexta anterior a um snapshot
de segunda continua elegível. `observed_at` (quando a INIA recebeu) é sempre distinto de
`source_updated_at` (quando a fonte diz que mudou) e de `effective_from` (quando passou a valer).

**Dataset EMPLOYEE_ABSENCES** (fontes que entregam períodos explícitos):
`externalEmployeeId`, `type` (bruto → normalizado VACATION/LEAVE), `startDate`, `endDate`
(opcional), `sourceUpdatedAt`. Cada linha vira UM `applyEmployeeStatusSnapshot` com
`effectiveFrom`/`effectiveTo` explícitos — mesma camada canônica, mesmo resolvedor de elegibilidade.
Versão 2 (2026-10-15): `active` ("Vigente?", opcional, padrão sim). `false` vira
`cancelEmployeeStatusPeriod` para a identidade matrícula + tipo + início: o período sai (só se a
`source` dele for o namespace do feed; outra origem = aviso `DATA_EMPLOYMENT_STATUS_CONFLICT`), os
vizinhos seguem `planStatusPeriodCancellation` (metades do período dividido voltam a ser uma; o
anterior sem fim informado pela fonte volta a valer até a próxima situação; nada é inventado) e a
remoção fica em `audit_logs` (`DATA_HUB_EMPLOYEE_ABSENCE_CANCELLED`) + `records_deactivated`.
Identidade inexistente = inalterado. Feeds `@1` continuam no contrato `@1` até salvarem o mapeamento.

**Prioridade/conflito** (hardening 2026-09-16, migration 061): cada período carrega a evidência
que o sustenta — `effective_to_explicit` (fim informado pela fonte) e `authoritative` (feed
autoritativo). `evidenceRank`: 2 = período explícito com início E fim da fonte; 1 = o resto.
Quando um snapshot/período novo discorda de um período existente que o sobrepõe, o serviço
compara (`compareEvidence`): rank maior vence → empate: autoritativo vence → empate: evidência
mais nova (`source_updated_at ?? observed_at`) vence. Perdeu o incoming ⇒ `action: "CONFLICT"`
(nada gravado); perdeu o existente com evidência explícita ⇒ aplica e devolve `conflict` no
outcome. O writer da Central transforma isso em aviso de quarentena
`DATA_EMPLOYMENT_STATUS_CONFLICT` (conta em `error_count`, nunca em `records_rejected`) com
lineage `employee_status_periods` (INSERTED/UPDATED) — conflito nunca é silencioso, nunca troca
período explícito sem rastro. A base pode chegar 2×/semana: o snapshot repetido não duplica
período (só renova `observed_at`).

**Base do status e projeção no tempo**: `resolveStatusBasis(periods, date)` responde
`EXPLICIT_PERIOD | OPEN_PERIOD | PRESUMED_AFTER_PERIOD | PRESUMED_NO_HISTORY` + `confirmed`.
Não existe enum UNKNOWN: depois do fim de um período explícito sem carga nova o status é ACTIVE
**presumido** (`confirmed=false`), nunca apresentado como certeza. `runEmploymentStatusProjection`
(server.ts, boot + ticker de 60 s, memo por organização × data local no fuso da organização,
zero LLM) sincroniza `people.current_employment_status` em UM UPDATE por organização —
férias com fim explícito voltam a ATIVO sozinhas. `resolveEmployeeStatusAt/resolveEmployeeStatusesAt`
(uma query para N pessoas) são os únicos leitores "status em uma data".

**Freshness da situação funcional** (`people/application/employment-status-freshness.ts`):
derivada só de `data_feeds` (contratos EMPLOYEES/EMPLOYEE_ABSENCES, não-DRAFT; se houver feeds
autoritativos, só eles decidem) com `computeFreshness`/`expectedIntervalMinutes` da própria
Central — FRESH | STALE | UNKNOWN (não configurado: legado/manual, nada é degradado).
Não é saúde de conexão nem um terceiro painel. `resolveEligibleDaysBySubject` devolve
`statusConfidence { freshness, unconfirmedDays, unconfirmedDates, lastSuccessLocalDate }`: um dia é
"presumido, não confirmado" só quando STALE, data > última carga local e sem período explícito
cobrindo. Condition/Ranking: medição real nunca é invalidada; sem medição (ou cobertura abaixo do
mínimo) com dias presumidos ⇒ `EMPLOYMENT_STATUS_STALE` ("não sei com segurança"), distinto de
`NO_VALUE` ("não produziu") e `NO_ELIGIBLE_DAYS` ("não deveria produzir"); no Ranking o sujeito sai
de `staleStatusIds` em vez de virar 0. Superfícies: perfil (aviso discreto "Fonte atrasada —
situação funcional atualizada pela última vez em…", nunca quando há período explícito cobrindo a
data), acompanhamento operacional (`unconfirmedDays`), QA Lab (linha ⚠ no trace só quando
relevante), Central (card "Situação funcional" + relação Colaboradores ⇄ Ausências no mapa).
Prova: `INIA_DB_PROOF=1 npx vitest run employment-status-hardening` (org própria `…f0f0`).

**Situações funcionais REAIS (migration 062)**: `EM_PRODUCAO | TRANSFERIDO | FERIAS | INSS | PILOTO |
MATERNIDADE | PATERNIDADE | APOSENTADO | ATIVIDADE_OFF` (rótulos em pt-BR em
`EMPLOYMENT_STATUS_LABELS`). Regra POSITIVA única: `isOperationallyEligibleStatus(status) === (status
=== "EM_PRODUCAO")` — nunca lista negativa espalhada. Legado (058) `ACTIVE/VACATION/LEAVE/INACTIVE`:
o check constraint continua aceitando (dual-read: `toCanonicalEmploymentStatus` em todo leitor; o
serviço canoniza na entrada); backfill determinístico ACTIVE→EM_PRODUCAO, VACATION→FERIAS,
LEAVE/INACTIVE→ATIVIDADE_OFF (nunca INSS/APOSENTADO por palpite), código original em `legacy_status`
e em `raw_status` quando a fonte não tinha texto. `normalizeEmploymentStatus` só aceita mapeamentos
explícitos (código, rótulo com/sem acento, ACTIVE/VACATION) — "ATIVO", "AFASTADO", "PROD" NÃO viram
nada sem "Mapear códigos" no feed; desconhecido = `DATA_EMPLOYMENT_STATUS_UNKNOWN` (rejeição). O
preview mostra origem → normalizado (`displayNormalizers` do contrato). EMPLOYEE_ABSENCES aceita só
situações temporais (FERIAS/INSS/MATERNIDADE/PATERNIDADE/ATIVIDADE_OFF); TRANSFERIDO/PILOTO/APOSENTADO
entram por EMPLOYEES.

**Escala real (migration 063)**: regime 5x2/6x1 = `employee_work_shifts.schedule_type` (com vigência =
histórico do regime; contrato WORK_SCHEDULES ganhou `scheduleType`); calendário programado =
`employee_schedule_days` (pessoa × data, `scheduled_to_work`, turno, `schedule_type`, source,
lineage) alimentado pelo contrato **WORK_SCHEDULE_DAYS** ("Escalas de trabalho", snapshot de horizonte;
ausência de linha NÃO é folga). Domínio único `people/domain/work-schedule.ts` (`resolveScheduledDay`:
calendário explícito > regime 6x1 sem folga = `UNKNOWN_SCHEDULE` > fallback `LEGACY_WEEKDAY_FALLBACK`
seg–sex com feriado como folga). Feriados: `organization_holidays` (Administração › Calendário
operacional, `/api/v1/admin/operational-calendar/holidays`) — só atuam no fallback; escala explícita
vence feriado. Freshness da escala: `resolveWorkScheduleFreshness` (feeds WORK_SCHEDULE_DAYS).

**Regra final do resolvedor** (`resolveEligibleDaysBySubject`, único): dia elegível = admitido ∧
EM_PRODUCAO ∧ escala diz que trabalha ∧ sem exclusão de calendário. Resultado rico: `calendarDays`,
`scheduledWorkDays` (= `businessDays`, compat), `eligibleDays`, `excludedBeforeHire`,
`excludedByStatus` (rótulo real), `excludedByScheduledDayOff`, `excludedByHoliday`,
`excludedByUnknownSchedule`, `statusConfidence`, `scheduleConfidence { freshness, basis, scheduleType,
unconfirmedScheduleDays, unknownScheduleDays }`. Motivos novos em Condition/Ranking:
`WORK_SCHEDULE_STALE` e `WORK_SCHEDULE_UNKNOWN` (causa diferente de `EMPLOYMENT_STATUS_STALE`).
Medição em dia não elegível continua no banco e fora do cálculo; correção de escala nunca apaga medição.

**Severidades (migration 064)**: `data_ingestion_runs.warning_count` — avisos de registros aplicados
(`WARNING_RECORD_ERROR_CODES`, ex.: `DATA_EMPLOYMENT_STATUS_CONFLICT`) contam em `warningCount`, nunca em
`errorCount` nem `recordsRejected`; Qualidade separa `topErrors`/`topWarnings` e marca `severity` na
quarentena; histórico anterior fica 0.

**Lineage visível**: `frontend/src/components/admin/data-hub/lineage-sheet.tsx` ("Origem do dado":
fonte → feed → carga → registro) em Admin › Usuários (período de situação, dia de escala) e, para
ADMIN, no perfil do colaborador. Sem linhagem (manual/demo/pré-Central) diz isso em texto.

**Uma fonte, muitos feeds**: `/admin/data-hub/sources/new?sourceId=<id>[&contractKey=…]` abre o
wizard em "Adicionar feed" reutilizando conexão/autenticação/segredos (botão "+ Adicionar feed" na
aba Feeds da fonte). API Pull: cada feed tem endpoint/extract/paginação/checkpoint próprios; SFTP:
padrão de arquivo próprio.

## Interações: motivo e submotivo (INTERACTIONS@2, 2026-10-16, migration 145)

| Campo | Coluna | Obrigatório | Semântica |
| --- | --- | --- | --- |
| `reason` ("Motivo") | `interactions.reason` | sim | categoria genérica do contato, como a fonte cadastra (ex.: Fatura, Cancelamento, Suporte técnico) |
| `subReason` ("Submotivo") | `interactions.sub_reason` | não | recorte específico dentro do motivo (ex.: Segunda via, Dúvidas sobre faturamento), até 200 caracteres |

- Os dois chegam como a fonte cadastrou. A INIA nunca deriva o motivo do submotivo (nem o contrário) e nunca classifica por IA.
- Submotivo vazio vira nulo e **mantém** o submotivo já recebido para a interação (`coalesce`, mesma regra dos opcionais de Colaboradores). Uma carga não apaga submotivo; ausência nunca vira "sem submotivo".
- Submotivo com mais de 200 caracteres vai para a quarentena (`DATA_TYPE_INVALID`, campo `subReason`). A interação não é aplicada sem o submotivo.
- `INTERACTIONS@1` continua no registro (`PREVIOUS_DATA_CONTRACT_VERSIONS`). Feed criado nele segue sem submotivo até o mapeamento ser salvo de novo, e também não apaga o submotivo que outro feed `@2` gravou.
- A ingestão legada `POST /ingestion/interactions` aceita `subReason` opcional, com a mesma regra.
- Índice `idx_interactions_reason_sub_reason_started (organization_id, reason, sub_reason, started_at desc)` para "motivo → submotivo no período". O índice por `(organization_id, reason, started_at desc)` continua.
- O assunto canônico (`interaction_subject_aliases`) continua casando com o **motivo** bruto. Segmentos por assunto do motor de feedback e do diagnóstico de indicador não leem o submotivo (decisão à parte).

## Calendário operacional: medição × elegibilidade, exceções, capital operacional e feriados (2026-09-16, migrations 065–067)

### Medição só em data elegível (uma regra, um predicado)
`resolveEligibleDaysBySubject` (indicators/application/operational-measurement-resolver.ts) continua sendo o ÚNICO resolvedor de dias elegíveis — e agora as datas elegíveis que ele devolve **entram na consulta de medições**: `eligibleDayRanges` comprime `eligibleDates` em intervalos contíguos por pessoa e `eligibleMeasurementSql` gera o `with eligible_days(person_id, from_date, to_date) as (unnest(...))` + `left join` + predicado. Nunca uma segunda interpretação em SQL; nunca N consultas por pessoa × dia (uma consulta de medições por janela, mais as consultas em lote do resolvedor). Todas as colunas de agregação usam `filter (where m.eligible)`: WEIGHTED_AVERAGE (numerador E denominador), RATE, AVERAGE (valor E amostra), SUM, LATEST (último valor **em data elegível**, não a última linha física) e a reincidência (COUNT em condition-evaluator). `ignored_count` conta o que ficou de fora — `OperationalWindowResult.ignoredMeasurements` chega ao QA Lab ("Medições ignoradas por inelegibilidade: 2") e ao perfil ("2 medições em dias não elegíveis ignoradas"). Cobertura e valor olham o mesmo universo: `daysWithData` só conta dias com medição elegível.

- Dia local = `period_start at time zone <fuso da organização>` (nunca UTC ingênuo).
- DAILY / HOURLY / INTERACTION recebem a regra diária completa. MONTHLY / CUSTOM mantêm o comportamento anterior (fora só se a situação funcional no dia inicial não era produtiva): uma linha mensal não representa observações de um dia — documentado, não escondido.
- `indicator_measurements` nunca é apagada por elegibilidade. Correção de escala (quarta trabalha → folga) muda o cálculo; reverter traz a medição de volta (prova em eligibility.test.ts e no proof do banco).
- Consequência: quem está no fallback seg–sex (sem escala explícita) tem medição de sábado/domingo fora do cálculo até a escala real chegar — a prova arquitetural de indicador dinâmico passou a dar escala explícita de 7 dias aos operadores de teste por isso.
- Contexto de Agent (`action-executors.ts` CALL_AGENT por período/resumo) e do assistente (`build-operator-context.ts`) usam o mesmo predicado via `eligibleMeasurementFilter`.

### Exceções individuais de calendário (`employee_schedule_exceptions`, contrato `WORK_SCHEDULE_EXCEPTIONS`)
Day off, banco de horas e folga extraordinária são **exceções** (people/domain/schedule-exception.ts): a escala original continua dizendo "trabalha" e a exceção vence naquele dia. A folga normal do 6x1 NÃO é exceção (é `employee_schedule_days.scheduled_to_work = false`). O motor decide por `effect` (V1: só NON_WORKING) — nunca `if code === DAY_OFF`; `raw_reason` preserva o texto da fonte. Chave natural pessoa × data × código; `active = false` cancela sem apagar (correção rastreável); lineage `employee_schedule_exceptions` até o Run; visível em "Origem da exceção" no Admin e no perfil. Precedência por dia (única, em `resolveScheduledDay` + resolvedor): admissão → situação ≠ EM_PRODUCAO → exceção NON_WORKING → escala explícita (folga/trabalha) → 6x1 sem calendário = desconhecido → fallback seg–sex (feriado só com política EXCLUDE). Uma causa por dia: FÉRIAS + day off = 1 dia em FÉRIAS; totais fecham.

### Capital operacional (`brazilian_capitals`, `people.operational_capital_code`)
Reference data das 27 capitais (26 estaduais + Brasília/DF) na migration 065 e espelho em people/domain/brazilian-capitals.ts (teste: exatamente 27, códigos e IBGE únicos, UF derivada). É a **jurisdição de feriados** da pessoa — não é endereço, residência, lotação nem teletrabalho (nada disso existe). EMPLOYEES aceita `operationalCapitalCode` (código ou nome oficial; "FOR"/"CE-FOR" só por CODE_MAP; fora do catálogo = `DATA_INVALID_ENUM`); Admin › Usuários tem o seletor; a Central mostra "Capital operacional preenchida: X de Y".

### Catálogo-base de feriados (`holiday_catalog`) e política
`npm run db:seed:reference` carrega o catálogo 2026–2028 a partir de infrastructure/database/reference-data/holiday-catalog-data.ts (regras fixas, móveis por Páscoa e datas explícitas para extraordinários, ex.: tricentenário de Fortaleza só em 2026), cada uma com `sourceName`/`sourceReference`/`legalReference` e nível de verificação (OFFICIAL | LEGAL_DATABASE | SECONDARY). Idempotente (chave natural por índice com `coalesce`). Ponto facultativo NÃO entra (Carnaval/Corpus Christi só onde há lei — RJ, DF, Manaus, BH, capitais listadas). O que não foi verificado está em `HOLIDAY_CATALOG_GAPS` (Belém, Campo Grande, transferência do Acre, etc.), nunca no banco. Aplicabilidade em people/domain/holiday-applicability.ts: NATIONAL para todos; STATE pela UF derivada; MUNICIPAL_CAPITAL só na capital; `organization_holidays` (Administração › Calendário operacional › Datas da organização) é overlay. Sem capital → `holidayConfidence = CAPITAL_UNKNOWN` (só nacionais/organização). Política `organizations.holiday_fallback_policy` (IGNORE default | EXCLUDE_APPLICABLE_HOLIDAYS) só age no fallback seg–sex; a migration 066 põe EXCLUDE em organizações que já tinham data própria ativa (o overlay da 063 excluía) para não mudar elegibilidade em silêncio. Escala explícita SEMPRE vence feriado.

### Horizonte da escala ≠ freshness ≠ conexão
`resolveWorkScheduleHorizon` (people/application/work-schedule-service.ts) deriva de `employee_schedule_days`: `coverageFrom/Until`, `daysRemaining`, `endingSoon` pelo limite `organizations.schedule_horizon_warning_days` (default 7). Central (card "Escalas de trabalho": "Calendário disponível: de → até · ⚠ Calendário termina em N dias"), Qualidade ("Horizonte da escala", "6x1 com calendário válido X de Y") e perfil/Admin ("calendário conhecido até"). Rotas: `GET/PATCH /admin/operational-calendar/settings`, `GET /admin/operational-calendar/catalog?year&capital&state&scope`, `GET /admin/operational-calendar/capitals`.

## Calendário operacional V1 fechado: PLANEJADO × OBSERVADO, provisionamento pelo Supervisor, reconciliação, bootstrap (2026-09-16, migration 068)

### Bootstrap oficial de ambiente

`npm run db:bootstrap` (dev) / `db:bootstrap:test` (`inia_test`) = migrations até HEAD → reference data (`holiday_catalog` com proveniência e `verification`; as 27 capitais vêm da migration 065) → dados demo (pulado automaticamente em `NODE_ENV=production`; `INIA_BOOTSTRAP_DEMO=skip` pula em dev/test). Função única `bootstrapEnvironment` (`infrastructure/database/bootstrap-environment.ts`), reaproveitada por `db:bootstrap:check` (= `db:seed:demo:check`) e pelo teste `seed-demo-from-scratch.test.ts` (`DEMO_SEED_CHECK=1`): banco descartável → bootstrap 2× → exatamente 27 capitais, >300 feriados todos com `verification`, massa demo, zero migration/feriado novo na 2ª rodada. `db:seed:reference` continua existindo para produção (idempotente).

### Evidência de produção (`WorkActivityEvidence`) — `people/domain/work-activity-evidence.ts`

Fontes, nesta ordem de preferência e sem LLM: (1) `interactions.operator_id` com `started_at` no dia local da organização; (2) medição DAILY/HOURLY/INTERACTION de um indicador com `indicator_definitions.proves_work_activity = true` (default false; configuração pela tela Indicadores, exige `daily_supported`; `value not null`, `denominator`/`sample_count` > 0 quando informados). Nunca por código/nome de indicador. Anticircularidade: o indicador em cálculo só torna um dia elegível se a sua própria definição estiver marcada. `loadWorkActivityEvidenceSources(db, org)` diz se a organização tem alguma fonte; sem fonte, "sem evidência" não significa nada (ninguém é cobrado). Demo: os indicadores de eficiência dos Grupos (TMA/TMT/tempo de diagnóstico) são marcados pelo seed (`ensureWorkActivityEvidenceIndicators`) — configuração, não regra.

### Dia resolvido — `people/domain/workday-resolution.ts` (`resolveWorkday`, função pura)

`BEFORE_HIRE` → `NON_ELIGIBLE_EMPLOYMENT_STATUS` (situação soberana; produção aqui = `conflict PRODUCTION_WITH_NON_ELIGIBLE_STATUS`, a situação NUNCA muda) → `WORKED_OBSERVED` (EM_PRODUCAO + evidência: elegível; `overridesPlan` quando o plano dizia folga/day off/banco/feriado/desconhecido — o plano fica registrado em `EligibilityResult.observed.workedDespitePlan`) → `PLANNED_WORK` / `MISSING_EXPECTED_PRODUCTION` (programado sem evidência; MISSING só com fontes configuradas e turno encerrado: `shift_end` da escala ou, sem turno, o fim da data operacional no fuso da org — `workdayClosed`) → `PLANNED_NON_WORKING` / `INDETERMINATE` (6x1 sem calendário). `resolveWorkdaysBySubject` (resolver único) devolve os dias; `resolveEligibleDaysBySubject` = `summarizeWorkdays` (contagens + `observed`). O predicado SQL de medições não mudou: `eligibleDates` já inclui os dias observados — uma medição ignorada por day off volta a contar quando a evidência prova o trabalho; raw nunca é apagada.

### Exceções — origem, provisionamento e conflito (migration 068 sobre `employee_schedule_exceptions`)

Códigos: `BANCO_HORAS | DAY_OFF | FOLGA_EXTRAORDINARIA | ATESTADO | AJUSTE_ESCALA` (ATESTADO = só motivo operacional, nunca CID/diagnóstico; AJUSTE_ESCALA só nasce de "Corrigir escala"). Colunas: `origin` (`CENTRAL_DATA | SUPERVISOR_MANUAL | SYSTEM_RECONCILIATION` — a última é reservada: a INIA nunca cria exceção sozinha), `created_by_person_id`, `provision_group_id` (período), `cancelled_at/by`, `manual_override`. Serviço `people/application/schedule-exception-service.ts` (`provisionScheduleExceptions` dia ou período ≤ 31 dias, `cancelScheduleException`, auditoria em `audit_logs` entity `employee_schedule_exception` com before/after). API `/api/v1/team-calendar` (GET calendário; POST/DELETE exceptions; GET audit) autorizada pelo escopo real (`viewer-scope.ts`: operadores ativos da subárvore; Admin = organização). Conflito Central × Supervisor no writer `workScheduleExceptionsWriter`: linha com `origin <> CENTRAL_DATA` ou `manual_override` e `active` divergente → não sobrescreve, aviso `DATA_SCHEDULE_EXCEPTION_CONFLICT` (quarentena, registro aplicado); `active` igual → a linha volta à Central. Supervisor cancelando linha da Central → `manual_override = true`.

### Reconciliação — `people/application/workday-reconciliation-service.ts` (job a cada 5 min no `server.ts`, idempotente)

Tabela `workday_reconciliations` (única por pessoa × dia × kind): `MISSING_EXPECTED_PRODUCTION` (status OPEN → pendência do Supervisor = `reports_to_id`, alerta `WORKDAY_MISSING_PRODUCTION` com `dedupe_key workday_reconciliation:<kind>:<person>:<dia>`), `PRODUCTION_ON_NON_WORKING_DAY` (NOTED, INFO; só quando o plano era explícito — folga explícita, exceção, feriado; fim de semana do fallback e 6x1 desconhecido não geram aviso), `PRODUCTION_WITH_NON_ELIGIBLE_STATUS` (NOTED, inconsistência). Auto-resolução: `PRODUCTION_RECEIVED_AFTER_ALERT` (carga atrasada) e `PLAN_UPDATED_AFTER_ALERT` (exceção/escala/situação passou a dizer "não produz"). Resolução pelo Supervisor via Pendências (`POST /pending-actions/workday-reconciliations/:id/resolve`): `NOT_WORKED` + código (cria exceção), `WORKED_DATA_MISSING` (nada inventado; NO_VALUE segue as regras), `SCHEDULE_CORRECTED` (AJUSTE_ESCALA). Lookback 7 dias. Alerta de horizonte: `schedule-horizon-alert-service.ts` (`WORK_SCHEDULE_HORIZON` para pessoas `role = 'ADMIN'`, dedupe por org × destinatário × `coverageUntil`, anteriores resolvidos quando o horizonte avança). O reset da massa demo remove reconciliações/alertas/auditoria do calendário como derivados (`reset-demo-mass.ts`).

### Provas

`workday-resolution.test.ts` (22), `eligibility.test.ts` (PLANEJADO × OBSERVADO, anticircularidade, totais), `indicators/testing/stale-unknown-consumers.test.ts` (Condition valor e quartil, Ranking, quartil, Analytics perfil e estrutura — NO_ELIGIBLE_DAYS × EMPLOYMENT_STATUS_STALE × WORK_SCHEDULE_STALE × WORK_SCHEDULE_UNKNOWN × NO_VALUE × real; QA usa a mesma função, paridade em `condition-preview-parity.test.ts`), `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workday-reconciliation-proof` (9: pré/pós-turno, day off/folga/INSS + produção, carga atrasada, provisionar/cancelar, resolução, calendário, conflito Central × Supervisor, horizonte, raw intacta), `DEMO_SEED_CHECK=1` (bootstrap do zero 2×). Frontend: `workday-reconciliation.test.tsx`, `team-calendar-view.test.tsx`, `operational-calendar-page.test.tsx` (cobertura/lacunas).

## Último hardening estrutural — disponibilidade dos dados × classificação (2026-09-17, migration 069)

**Fim do turno ≠ dado fechado.** Grande parte dos indicadores chega em D-1, alguns em D-2, a base de RH também atrasa. A INIA distingue PLANEJADO (escala/exceção/situação), OBSERVADO (evidência), DISPONIBILIDADE (quando cada fonte já deveria conter o dia) e CLASSIFICAÇÃO (como um dia sem produção foi explicado por um humano).

### Política de disponibilidade — `data-hub/domain/data-availability.ts`
- `data_feeds.availability_policy jsonb` = `{ lagDays, availableByLocalTime }` (fuso da organização; `expectedAvailableAt(workDate, policy, tz)` = localToInstant(D + lagDays, HH:MM)). Editada no wizard e no detalhe do feed (`AvailabilityPolicyField`, só para INTERACTIONS / INDICATOR_MEASUREMENTS / EMPLOYEES / EMPLOYEE_ABSENCES). `indicator_definitions.availability_policy` = override opcional (só quando o mesmo feed mistura SLAs).
- `resolveSourceAvailability`: sem política → `UNKNOWN`; antes do prazo → `WAITING`; depois do prazo com carga bem-sucedida após ele OU `last_data_at` cobrindo D → `READY`; senão `DELAYED`. Freshness (cadência) continua um conceito separado.
- `people/domain/workday-data-availability.ts` combina por dia e por grupo: WORK_ACTIVITY (uma entrada por fonte de evidência habilitada — interações e cada indicador `proves_work_activity`; o ÚLTIMO prazo decide) e EMPLOYMENT (feeds EMPLOYEES/EMPLOYEE_ABSENCES; sem feed = cadastro manual = nada a esperar). Resultado do dia: `READY | WAITING_FOR_SOURCES | DATA_SOURCE_DELAY | AVAILABILITY_UNKNOWN` (`decidedBy` diz se foi produção ou RH). Contexto carregado UMA vez por chamada (`people/application/data-availability-service.ts`), memoizado por data — nunca por pessoa.
- Sem política a INIA **não assume D+1**: o dia fica `PLANNED_WORK` com `availability = AVAILABILITY_UNKNOWN` e nenhuma ausência é concluída. Demo: políticas explícitas em `seeds/demo/002_data_hub.sql` (medições D-1 11:00, interações D-1 09:00, colaboradores D-2 08:00); `touchDemoAvailabilityFeeds` registra `last_success_at/last_data_at` nos feeds demo porque a massa grava direto nas tabelas.

### Dia resolvido — novos estados (`workday-resolution.ts`)
Precedência explícita: situação funcional não produtiva → trabalho real observado → classificação humana → exceção/plano → escala explícita → fallback → desconhecido. Programado + turno encerrado + sem evidência: `MISSING_EXPECTED_PRODUCTION` só com `availability = READY`; `WAITING_FOR_SOURCES` / `DATA_SOURCE_DELAY` (elegíveis, nunca cobrados) nos demais casos. Classificação: `CLASSIFIED_UNJUSTIFIED_ABSENCE` (elegível), `CLASSIFIED_JUSTIFIED_ABSENCE` (fora), `CLASSIFIED_WORKED_DATA_MISSING` (elegível). Produção real vence a classificação (`classificationContradictedBy = WORK_EVIDENCE`); situação autoritativa vence tudo (`AUTHORITATIVE_STATUS`).

### Classificação — `workday_classifications` + `people/application/workday-classification-service.ts`
- Uma linha por REVISÃO: vigente = `superseded_at is null` (índice único parcial pessoa × dia); revisar cria linha nova com `supersedes_id` e marca a anterior (`superseded_by_person_id`, `superseded_reason = REVISED | CONTRADICTED_BY_WORK_EVIDENCE | SUPERSEDED_BY_AUTHORITATIVE_STATUS`). Auditoria em `audit_logs` (`workday_classification`). Sem coluna para CID/diagnóstico/documento — teste garante.
- NÃO é exceção de calendário: falta injustificada mantém a escala em "deveria trabalhar". `resolveReconciliation` grava classificação (UNJUSTIFIED_ABSENCE / JUSTIFIED_ABSENCE + reasonCode / WORKED_DATA_MISSING) ou AJUSTE_ESCALA (SCHEDULE_CORRECTED); a reconciliação do dia recebe `classification_id` e reflete a classificação vigente. Calendário da equipe: `POST /team-calendar/classifications` (classificar/rever) e `GET /classifications/:personId/:date` (histórico), escopo real (403 fora).
- Job (`reconcileOrganizationWorkdays`): abre pendência só com fontes fechadas; `syncDataAvailabilityAlerts` cria alerta administrativo `DATA_SOURCE_AVAILABILITY_DELAYED` por fonte × dia (resolvido quando a carga chega); `reviewClassification` supera classificações contrariadas por produção/RH (alerta `WORKDAY_CLASSIFICATION_SUPERSEDED` ao Supervisor); janela de revisão `CLASSIFICATION_REVIEW_DAYS = 30` só para pessoas com classificação vigente (segunda resolução em lote).

### Política por indicador — `indicator_definitions.unjustified_absence_policy`
`NO_SAMPLE` (default) | `ZERO_CONTRIBUTION` (só SUM/AVERAGE com unidade COUNT/CASES/CASES_PER_DAY — `zeroContributionSupported`, 422 nas demais). No resolvedor os pares pessoa × dia de falta injustificada entram na consulta (`absence_days` CTE → `absence_days_with_data`); `applyZeroContribution` acrescenta N períodos lógicos de valor 0 (soma inalterada, média diluída, `daysWithData` +N) — nunca uma linha em `indicator_measurements`. Colaborador sem medição mas com falta injustificada e ZERO_CONTRIBUTION entra na população ranqueada com 0 (resultado conhecido). Chamadores passam a definição inteira ao resolvedor (`WindowDefinitionParam`); passar só a estratégia = política NO_SAMPLE.

### Central (Qualidade) — `CalendarQuality.dataAvailability` / `classifications`
Por fonte relevante: política, última carga, dia de referência e estado (freshness ≠ SLA); últimos 7 dias: dias aguardando dados × fonte atrasada; classificações 30 dias (faltas, revisões, contrariadas por evidência, superadas por RH, auto-resolvidas por dado tardio).

### Provas
`data-availability.test.ts`, `workday-data-availability.test.ts`, `workday-resolution.test.ts` (29), `unjustified-absence.test.ts`, `eligibility.test.ts` (D-1/D-2, fonte atrasada, RH, classificação), `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workday-reconciliation-proof` (12: SLA D-1/D-2 com `now` fixo, classificação/revisão/histórico, ZERO_CONTRIBUTION × NO_SAMPLE sem medição sintética, dado tardio, RH tardio, fonte atrasada → alerta e não pendência, permissão 403).

### Fechamento — Clock, reavaliação de pendências (upgrade) e indicador demo (migration 070)
- **Clock** (`shared/domain/clock.ts`): `Clock { now() }`, `systemClock`, `fixedClock(instant)`. Antes: `Clock` só existia como port da Central (`ports.ts`), com `now: Date = new Date()` nos jobs e `now()` do banco nos timestamps de decisão — a Central contava "hoje" por `date_trunc('day', now())` do banco (o cartão warningsToday quebrava com relógio fixo). Agora: `runWorkdayReconciliation(db, clock)`, `runScheduleHorizonAlerts(db, clock)`, `reconcileOrganizationWorkdays(db, org, tz, now)`, `syncDataAvailabilityAlerts(..., now)`, `syncScheduleHorizonAlerts(..., today, now)`, `classifyWorkday`/`supersedeClassificationBySystem`/`resolveReconciliation` com `now` opcional (default systemClock); `enqueueRun` grava `queued_at/created_at` pelo Clock; `buildOverview` conta o dia local do Clock no fuso da org. Testes de fronteira (10:59/11:00/11:01, D+2, virada de dia, Fortaleza/São Paulo/Manaus) em `data-availability.test.ts`, todos com `fixedClock`.
- **Reavaliação de pendências legadas**: `legacyReviewOf(day)` no job — pendência OPEN cujo estado atual não é MISSING (nem PLANNED_WORK com disponibilidade desconhecida) é encerrada com resolução + `snapshot.reviewedByCurrentRule {state, availability, resolution, reason, at}`; alerta do sino resolvido; nada apagado. Upgrade real: `db:migrate` (069/070) → subir o servidor (rodada no boot) ou `npm run calendar:reconcile` (rodada explícita, relatório com `reviewedLegacy`) → segunda rodada = 0 mudanças.
- **Indicador demo**: `DEMO_VOLUME_INDICATOR` em `demo-mass/indicator-catalog.ts`; `ensureDemoVolumeIndicator` (persist) antes de carregar o catálogo; `daily-measurement-generator` grava Atendimentos = contatos do dia; fixtures de classificação em `demo-work-schedules.ts` (`demoWeekdayDate` garante dia útil); reset remove a definição só sem referências externas.

## Decisões a tomar quando a Central for construída

- Se a ingestão em massa matricula Workflows por indicador (`enrollIndicatorWorkflows`) ou só grava
  — hoje o seed grava sem matricular de propósito (20 mil chamadas ⇒ 20 mil matrículas).
- Fila (lote assíncrono) × síncrono para arquivos pequenos.
- Sujeitos além de `PERSON` (estrutura/fila) — o contrato já tem `subject_type`.

## O que NÃO fazer

- Tabela, endpoint ou validador por indicador.
- Enum de códigos de indicador em qualquer camada.
- Reinterpretar histórico ao mudar a semântica de um indicador (o catálogo bloqueia a mudança;
  crie um indicador novo).
