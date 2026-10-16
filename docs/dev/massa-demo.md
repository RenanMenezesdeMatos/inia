# Massa de dados demonstrativa (DEV / TEST / DEMO LOCAL)

> Documento de desenvolvimento. **Não** publicar na Wiki da aplicação: contém credenciais demo.
> Nada aqui existe em produção — o runner recusa `NODE_ENV=production` antes de abrir conexão.

## O que é

Uma massa determinística que simula o que a empresa entregará no futuro: estrutura organizacional
grande (2.109 pessoas, todas com login), grupos/subgrupos B2C e B2B, metas, seis competências
mensais de fechamento oficial (indicadores, pesos, quartis, PRV), medições brutas, 20 mil
interações de voz com transcrição e flags — tudo pelas **tabelas reais** da aplicação, nunca por
um schema paralelo. Código em `backend/src/infrastructure/database/demo-mass/`.

## Comandos

| Ação | Comando (em `backend/`) |
| --- | --- |
| Carregar (SQL de `seeds/demo` + massa) | `npm run db:seed:demo` |
| Carregar no banco de teste | `npm run db:seed:demo:test` |
| Remover SOMENTE a massa gerada | `npm run db:seed:demo:reset` |
| Remover no banco de teste | `npm run db:seed:demo:reset:test` |
| Provar o seed DO ZERO (banco descartável: migra + seed 2× + checa + drop) | `npm run db:seed:demo:check` (ou `DEMO_SEED_CHECK=1 npm test -- seed-demo-from-scratch`) |

- Idempotente: recarregar não duplica nada (upsert por id determinístico / unique key oficial); as
  medições diárias só são reescritas quando mudaram (`ON CONFLICT … WHERE … IS DISTINCT FROM`) —
  reseed sem mudança = zero escrita, zero bloat.
- `db:seed:demo:test` roda do zero num banco recém-migrado: o seed legado `seeds/demo/001` só
  insere pessoas que existem (`join people`) e nunca competência ≥ mês corrente; a flag `tdna`
  (referenciada pela migration 019, nunca criada por ela) é garantida pelo próprio seed. O runner
  (`run-demo-seed.ts`) reporta linhas por arquivo e propaga qualquer erro — nunca catch-e-ignora.
  Produção continua recusada (`NODE_ENV=production`).
- Reset apaga por lista explícita de ids (nunca `TRUNCATE`, nunca `like 'de00%'`). Se algo fora
  da massa referencia pessoas/interações demo (caso, feedback, alerta, matrícula de workflow…),
  o reset **aborta** e lista os bloqueios — nada é apagado. Exceção consciente: o que a própria
  Pendência demo gerou ao ser decidida de verdade é reconhecido por **lineage** e removido (abaixo).
- Seed pseudoaleatório: `DEMO_RANDOM_SEED = 20260915` (`demo-constants.ts`). Mudar = massa nova.
- Ids demo começam com `de00` só pra leitura em SQL (`where id::text like 'de00%'` como consulta,
  jamais como critério de exclusão). Proveniência: `source = 'DEMO_SEED'` onde a coluna existe;
  `matricula` `DEMO-…`; `external_id` `DEMO-…`.

## Credenciais (senha única: o valor de `INIA_DEMO_PASSWORD` no `backend/.env`)

A senha nunca fica no código nem na documentação: `npm run env:init` gera uma aleatória e o seed recusa rodar sem ela.

| Papel | Nome | E-mail | Grupo | Subgrupo | Gestor direto |
| --- | --- | --- | --- | --- | --- |
| Diretor | João Lacerda | `diretor.demo@inia.local` | — | — | — |
| Gerente Sênior (B2C) | Thaís Borges Pereira | `gerentesenior01.demo@inia.local` | — | — | João Lacerda |
| Gerente **com** Coordenador | André Marques Vasconcelos | `gerente01.demo@inia.local` | B2C · Atendimento Geral | — | Thaís Borges Pereira |
| Gerente **sem** Coordenador | Priscila Sampaio Paiva | `gerente02.demo@inia.local` | B2C · Atendimento Geral | — | Thaís Borges Pereira |
| Coordenador | Marcelo Souza Cavalcanti | `coordenador01.demo@inia.local` | B2C · Atendimento Geral | — | André Marques Vasconcelos |
| Supervisor (equipe canônica) | Daniela Duarte Rocha | `supervisor01.demo@inia.local` | B2C · Atendimento Geral | Diagnóstico IA — Operadores com gravações | Marcelo Souza Cavalcanti |
| Supervisor (sem coordenador) | Rosana Andrade | `supervisor06.demo@inia.local` | B2C · Atendimento Geral | Voz | Priscila Sampaio Paiva |

Padrão geral: `diretor`, `gerentesenior01..04`, `gerente01..16`, `coordenador01..08`,
`supervisor01..80`, `operador0001..2000` + `.demo@inia.local`. Gerentes ímpares têm Coordenador;
pares têm 5 Supervisores diretos. Gerentes 1–8 = B2C, 9–16 = B2B. A cadeia legada adotada (ver
"Estrutura") mantém os e-mails de sempre (`ana.lima@inia.com`, `roberto.alves@inia.com`…; conta que nunca entrou
passa a usar a senha demo — as migrations criam essas contas com senha aleatória) e
completa o desenho com `supervisor81..90`, `operador2001..2250` e `coordenador09` (Patrícia).

### Operadores canônicos (equipe da Supervisora 01, Coordenador 01, Gerente 01)

| E-mail | Nome (UI) | Cenário de teste |
| --- | --- | --- |
| `operador0001.demo@inia.local` | Larissa Monteiro | Alta performance — **Q1 recorrente** (6/6) |
| `operador0002.demo@inia.local` | Mariana Alves | Crítica — **Q4 recorrente** (6/6, PRV ≈ 83%) |
| `operador0003.demo@inia.local` | Beatriz Nogueira | **Em evolução** — PRV 83% (1ª competência fechada) → 110% (última) |
| `operador0004.demo@inia.local` | Rafael Cardoso | **Em queda** — PRV 110% (1ª competência fechada) → 87% (última) |
| `operador0005.demo@inia.local` | Camila Fonseca | Qualidade boa, **TMA alto** |
| `operador0006.demo@inia.local` | Diego Tavares | Média, **sem Nota URA** em jul/ago 2026 (SEM DADOS) |
| `operador0007.demo@inia.local` | Thiago Moreira | Volátil (alterna meses muito bons e ruins) |
| `operador0008.demo@inia.local` | Juliana Sampaio | TMA ótimo, Qualidade ruim |
| `operador0009.demo@inia.local` | Henrique Barros | PRV parcial (metade acima, metade abaixo) |
| `operador0010.demo@inia.local` | Renata Queiroz | Dados incompletos (competências sem certo indicador) |

Donos das transcrições canônicas fora de Atendimento Geral: `operador0251` Aline Castro e
`operador0252` Marcos Vieira (B2C · Faturamento), `operador0501` Gabriela Duarte e `operador0502`
Leandro Farias (B2C · Retenção), `operador0626` Vitor Macedo e `operador0627` Patrícia Leite
(B2C · Suporte Técnico).

## Subgrupo de diagnóstico — população principal de investigação (2026-09-18)

O Subgrupo **"Diagnóstico IA — Operadores com gravações"** (Grupo `B2C · Atendimento Geral`,
Supervisora 01 Daniela Duarte Rocha → Coordenador 01 → Gerente 01 → Sênior 01 → Diretor) é a população
demo para investigação profunda: `segment_indicator`, `compare_population`, `find_interactions`,
`find_comparable_interactions`, `analyze_interactions`, `analyze_peer_patterns`, diagnóstico de
indicadores/comportamental e benchmarks de Agents/Orquestradores. Ele reúne **36 operadores** no banco de
desenvolvimento (27 num banco recém-migrado — só Ana Lima e Juliana Prado existem como legadas ali):

| Quem | Como entrou | Interações (dev) |
| --- | --- | --- |
| 25 operadores canônicos (`operador0001..0025`) | equipe da Supervisora 01, desde a massa grande | 10 geradas cada; Mariana Alves, Rafael Cardoso e Camila Fonseca têm **+30 do lote** (40 cada) |
| 11 operadores legados com gravações: Luana Brenda, Denisy Feitoza, Icaro Elias, Samuel Avelino, Ana Lima, Camila Pereira (`DEMO-LEG-2126`), Karoline Wokysbly, Pamella Albuquerque, Gustavo Santos, Juliana Prado, Luzia Ingrid da Silva Nobre | reposicionados por `legacy-adoption.ts` (`DIAGNOSTIC_LEGACY_OPERATORS`): mesma pessoa/id/login/matrícula, Grupo/Subgrupo/supervisora novos | 20–30 cada: 10 geradas + 10 transcrições legadas (`ANA-LIMA-nn`, `LUANA-BRENDA-nn`…) + sobras de QA (uuid) |

Critério de inclusão (auditoria de 2026-09-18, antes da decisão): 2.238 operadores tinham exatamente 10
interações (as geradas), 1 tinha 11 (sobra de QA) e **só esses 11 legados** tinham corpus próprio de
transcrições (≥ 20). Ninguém entra "só pra encher"; a lista é explícita no código, não um limiar.

Como a reposição é representada (o modelo tem `team_id`/`subteam_id`/`reports_to_id` na pessoa — não há N:N,
e não existe "coorte de análise" paralela: Grupo é Grupo, Subgrupo é Subgrupo, e as Tools leem a estrutura
real): `people.team_id` = Atendimento Geral, `subteam_id` = Subgrupo de diagnóstico, `reports_to_id` =
Supervisora 01; `job_title` só é trocado quando era exatamente o que a própria massa tinha escrito para o
Grupo antigo; cargo digitado (Ana Lima, Juliana Prado) fica.

**ESTRUTURA ATUAL ≠ SNAPSHOT OFICIAL HISTÓRICO (hardening 2026-09-18).** A transferência dos 11 legados tem
DATA: `DIAGNOSTIC_RELOCATION_EFFECTIVE_PERIOD = "2026-09"` (`structure-generator.ts`). Tudo que é anterior
continua sendo produzido para a vaga de origem — a função pura `placementAt(person, competência|dia)` é o que
o gerador de fechamentos oficiais (catálogo, metas, viés, `subteam_id` da linha e **coorte do quartil** =
Grupo vigente na competência), o de diárias (por dia) e o de chamadas geradas (cenário por dia) consultam;
`person.teamKey` só vale para o presente. Por isso Ana Lima tem fechamentos 03–08/2026 de Retenção B2B e
diárias de Atendimento Geral só a partir de 01/09 (e só nos indicadores com âncora oficial — nada é
inventado). A persistência dos fechamentos (`persistPerformance`) é **INSERT-ONLY**: (pessoa, indicador,
competência)/(pessoa, competência) que já existe nunca é reescrita — nem por nova carga, nem por mudança de
gerador, nem por mudança de estrutura; criar competência nova ≠ mutar competência antiga. Provas:
`legacy-adoption.test.ts` (massa com e sem reposição = mesmos ids/valores/quartis; diárias e chamadas
pré-setembro idênticas) e `diagnostic-calls-proof.test.ts` ("TRANSFERÊNCIA": muda Grupo/Subgrupo/supervisor
de quem tem fechamento de agosto, reexecuta sync estrutural + fechamentos → snapshot inteiro idêntico).

Histórico do erro corrigido: o commit 6768fbf acoplou a reposição ao reprocessamento oficial (coorte = Grupo
atual, catálogo = Grupo atual, `on conflict … do update` nas linhas DEMO_SEED e um "prune" por ids do
Grupo antigo) — 404 quartis de indicador e 87 de PRV mudaram em 5 Grupos, 145 fechamentos e 43 PRV dos 11
legados foram regerados e 99 fechamentos apagados. Reparo único e auditado com
`scripts/demo-mass/restore-official-snapshot.ts --apply` (só linhas com id determinístico do gerador e
`source = DEMO_SEED`; dry-run por padrão; 2ª rodada = 0 divergências) + o seed insert-only recriou os 99
apagados; o resultado foi conferido byte a byte contra o snapshot capturado antes de 6768fbf.

### Lote externo de 90 chamadas (lote `inia_demo_90_v1`, corpus `inia_demo_90_v3`)

- **Lote ≠ corpus.** O lote (`DIAGNOSTIC_CALLS_LOT = inia_demo_90_v1`) é a identidade lógica das 90
  chamadas (ids determinísticos, `external_id` `DEMO-inia_demo_90_v1:<id>`, gabarito de QA) e nunca
  muda. O corpus é a revisão do arquivo: v1 = entrega original (mantido no repositório para auditoria);
  **v3 = hotfix de coerência temporal (2026-09-18)** — `backend/seeds/demo/diagnostic-calls/
  inia_demo_90_v3.jsonl` (SHA-256 `57a380da…f532`, conferido na carga — byte diferente = carga
  recusada), gerado de forma reproduzível por `scripts/demo-mass/revise-diagnostic-corpus.ts` a partir
  do v1 + layout V2. Contrato em `SOURCE_README.md`. Carregado por `npm run db:seed:demo`
  (`demo-mass/diagnostic-calls.ts`), por lista explícita de arquivo — nunca varredura de pasta.
- **Revisão v1 → v3 (auditoria em `inia_demo_90_v3.revisions.json`):** a fonte cita datas absolutas
  na fala com duas convenções fixas — "retorno previsto para DD/MM/AAAA" = chamada + 2 dias (25/25) e
  "contato anterior registrado em DD/MM" = data da chamada anterior vinculada (8/8). Com o layout V2, 30
  dessas 33 ocorrências (26 chamadas: 11 de junho, 8 de julho, 7 de agosto) viraram TEMPORAL_ARTIFACT
  (prazo no passado; contato anterior numa data em que a interação vinculada não existe). Correção
  mínima e mecânica pela MESMA convenção: só o token de data muda (transcrição + segmento espelho); 64
  linhas ficam byte a byte iguais (exceto `dataset_id`); papéis, tempos, assunto, flags, duração,
  conversa casual e referências de protocolo (`DEMO-202606-…` = identificador, não data — AMBIGUOUS,
  preservado) intactos; expressões relativas ("ontem", "fim do mês", "na segunda" = segunda linha) são
  válidas e ficam. Nenhuma informação do gabarito participa da decisão. Provas:
  `diagnostic-calls.test.ts` (0 artefatos; v1 ainda parseável; revisions.json = diff real) e
  `diagnostic-calls-proof.test.ts` (0 referências inconsistentes nas 90 transcrições persistidas).
- 30 chamadas de **Mariana Alves** (`OP-DEMO-M` → `operator:0002`), 30 de **Rafael Cardoso**
  (`OP-DEMO-R` → `operator:0004`), 30 de **Camila Fonseca** (`OP-DEMO-C` → `operator:0005`) — a pessoa
  canônica é resolvida por chave da estrutura e o NOME é conferido (nunca se cria outra Mariana).
  Duração 221–508 s, canal `voz` → `VOICE`.
- **Layout temporal V2** (`diagnostic-calls-schedule.ts`, `V2_JUN_JUL_AGO_2026`): a fonte declara junho
  inteiro (uma chamada por operador por dia, fins de semana inclusive); a massa posiciona cada chamada pelo
  sufixo do id — 001–010 → junho, 011–020 → julho, 021–030 → agosto/2026 (os três blocos P1/P2/P3 do lote
  viram os três meses, sem concentrar nem facilitar padrão) — em dia ÚTIL espalhado no mês, dentro da
  jornada da pessoa (`employee_work_shifts`: Mariana 09:00+8h, Rafael 08:00+6h, Camila 14:00+6h), sem
  sobrepor nenhuma outra chamada da pessoa (geradas ou do lote); toda rechamada continua depois da original.
  Ids, `external_id`, conteúdo, assunto, flags e duração NÃO mudam (V1 → V2 = update de `started_at`/
  `ended_at` das mesmas 90 linhas; nunca 180); a data declarada pela fonte fica em `sourceStartedAt` e o
  mapa completo V1 → V2 está em `scripts/poc-tools/ground-truth/inia_demo_90_v1/temporal_layout_v2.json`.
  Prova com o resolvedor real do calendário: 90 em dia programado / 0 fora da escala / 0 fora da jornada /
  0 sobreposições. Limitação assumida: 15 chamadas de jul/ago citam datas de junho na fala ("retorno
  previsto para 16/06/2026") — o texto é intocável por regra.
- **Versão/fingerprint** (`diagnostic-dataset.ts`): **`DIAGNOSTIC_DATASET_V1_1` = HOMOLOGATED**
  (2026-09-18; anterior `DIAGNOSTIC_DATASET_V1` = lote em layout V2 com corpus v1): corpus
  `inia_demo_90_v3` + layout V2 + catálogo `DEMO_SUBJECTS_V1` + projeção de privacidade de pares
  `PEER_PRIVACY_V1`. Fingerprint do dev: `ab530ce1…` (V1) → `da0bcee4…5cfa` (V1_1) — a correção de
  texto MUDA o fingerprint (hashes de transcrição); a projeção de privacidade sozinha não (dado
  persistido não muda). `computeDiagnosticDatasetFingerprint`
  (script `scripts/demo-mass/diagnostic-dataset-fingerprint.ts`) = SHA-256 de membership do Subgrupo,
  interações (ids/instantes/assunto bruto), hashes das transcrições (nunca o texto), catálogo de assuntos e
  período — metadado de QA/benchmark, NUNCA população. Benchmark só compara antes × depois com o mesmo
  fingerprint ("Dataset diferente" caso contrário). Referência do banco de desenvolvimento em
  `…/DIAGNOSTIC_DATASET_V1_1.fingerprint.dev.json` (V1 mantido ao lado; num banco recém-migrado o
  fingerprint é outro: 27 membros). Qualquer alteração relevante da massa = versão nova, nunca edição
  silenciosa. **QA Lab:** todo run persiste o fingerprint genérico (V1.3.1, contagens) e, quando o
  colaborador do run pertence ao Subgrupo de diagnóstico, também `components.dataset = { version,
  fingerprint }` (entra no hash); a aba "Tokens e eficiência" mostra "Dataset DIAGNOSTIC_DATASET_V1_1 ·
  fingerprint da0bcee4…5cfa" (hash inteiro no title), "não aplicável" fora da massa e "Não informado"
  em run antigo; antes × depois só calcula percentuais com fingerprint igual — diferente = "Dataset
  diferente — comparação de eficiência não diretamente válida" com as versões (`V1 → V1_1`), valores
  lado a lado; referência sem fingerprint = UNKNOWN. O runner POC (`run-poc-feedbacks.ts`) grava o
  mesmo objeto em `context_snapshot.pocBenchmark.datasetFingerprint`.
- `interactions.reason` = `assunto` **literal da fonte** (`assunto_origem = cadastro_da_interacao`):
  `internet_movel` 8, `segunda_via` 8, `contestacao` 7, `alteracao_cadastral`/`cancelamento`/`esim`/
  `fatura`/`pagamento`/`plano`/`portabilidade` 6, `roaming`/`troca_chip` 5, `troca_titularidade` 4,
  `bloqueio`/`cobertura`/`desbloqueio` 3, `servico_adicional` 2. Nenhuma IA classifica, resume ou
  "melhora" nada no seed.
- **rawSubject × canonicalSubject** (migration 075; `modules/interactions/domain/interaction-subject.ts`):
  o bruto (`reason`) é a verdade da origem e nunca é reescrito; o canônico é resolvido no join por um alias
  EXPLÍCITO do catálogo da organização (`interaction_subject_definitions` + `interaction_subject_aliases`,
  texto exato ignorando caixa/espaços). O seed grava o catálogo demo (`demo-mass/subject-catalog.ts`,
  `DEMO_SUBJECTS_V1`): 17 códigos = os assuntos do lote (cada código é alias de si mesmo) + 91 aliases da
  massa legada/gerada só com cabeça semântica inequívoca ("Segunda via de fatura", "Contestação de cobrança
  duplicada", "Alteração de gestor empresarial", variantes "(rechamada)"). Ambíguo ou sem canônico fica
  SEM alias (canônico nulo): frases compostas "X e Y", "Cobrança após pedido de cancelamento…", "Linha sem
  sinal", "Dúvida sobre franquia de dados", "Negociação de débito", banda larga/reparo/Wi-Fi, aplicativo,
  visita técnica. Montado só de assuntos-fonte, nunca do gabarito. Tools: `find_comparable_interactions`
  compara pelo canônico quando o pedido resolve (código ou alias) e pelo bruto exato quando não
  (`subjectMatching.mode = CANONICAL | RAW_EXACT`; `NO_COMPARABLE` continua válido); `segment_indicator`
  por SUBJECT agrega pelo canônico com `rawSubjects` por bucket; `find_interactions`/contexto expõem
  `subject` (bruto) e `canonicalSubject`. Assunto é dimensão, nunca causa. Efeito real no Subgrupo:
  Mariana/segunda_via 24 pares de 14 operadores (antes 5 de 2), Rafael/internet_movel 12/9, Camila/
  contestacao 24/13, Luana "Segunda via de fatura" 39/22, Denisy "Contestação de cobrança duplicada" 38/19,
  Pamella "Alteração de gestor empresarial" 33/20; Icaro "Chip sem registro na rede" = RAW_EXACT 10/10.
- `transcripts.content` = `transcricao` integral, byte a byte (`[mm:ss–mm:ss] OPERADOR|CLIENTE|SUPORTE|
  EVENTO: …`; eventos de silêncio/espera e conversa casual — clima, viagem, Japão, origem do nome —
  preservados de propósito); `confidence` NULL (não houve ASR: o lote foi escrito).
- Flags = só as estruturadas da fonte: `rechamada` (8 true), `transferencia` (7), `contestacao` (11),
  `cancelamento` (10) com **false explícito** nas demais (a fonte cadastra o valor; as Tools só contam
  `true`), `detrator` (17 true / 63 false; ausente nas 10 sem nota), `nota_ura` 0–10 (80 respondidas),
  `tempo_silencio` = `tempo_silencio_s` (90, 8–112 s). Nada é inferido da transcrição.
- Não persistidos (o schema não tem campo; ficam no arquivo): `assuntos_secundarios`, `caso_id_externo`/
  `interacao_anterior_id_externo` (o vínculo de rechamada vira só a flag), `tempo_espera_s`,
  `tempo_pos_atendimento_s`, `status_desfecho`, `protocolo_registro`, `cliente_*`, `segmentos`.
- Idempotente: id = `demoId("interaction:inia_demo_90_v1:<id externo>")`, `external_id` =
  `DEMO-inia_demo_90_v1:<id externo>`; segunda carga = 0 inserções/90 atualizações; `external_id` já
  ocupada por OUTRA interação = `DiagnosticCallsConflictError` antes de qualquer escrita. O reset apaga as
  90 por id. Nunca passa por `/ingestion` (gatilhos/matrículas).

### Privacidade dos pares — projeção antes do Model Context (`PEER_PRIVACY_V1`, 2026-09-18)

`investigation/domain/peer-privacy-projection.ts` (puro, determinístico, sem LLM). Três contextos:
**AUDIT** = `transcripts.content` original, nunca alterado, rastreável por handle `P-n` + `sourceHash`
(SHA-256 do bruto); **MODEL** = só a projeção — nome completo/variantes fortes do par e primeiro nome
(palavra inteira, sem caixa/acento; nome que é palavra comum só em apresentação/vocativo), nome
completo de outros operadores conhecidos (primeiro nome só em "meu nome é/aqui é/… falando/obrigado,")
→ `[OPERADOR]`; PII evidente por padrão fixo → `[TELEFONE]`, `[EMAIL]`, `[CPF]`, `[PROTOCOLO]`
(`DEMO-AAAAMM-X999`, `AAAAMM+6 dígitos`, "protocolo N"); o ALVO da investigação nunca é redigido nem
confundido com o par (nome completo protegido — "Mariana Costa" par × "Mariana Alves" alvo); **VERIFICAÇÃO**
= a citação do modelo é conferida contra a PROJEÇÃO (`verifyProjectedQuote`), e recusada se
reintroduzir a identidade do par (`REIDENTIFICATION`). Aplicado em `analyze_peer_patterns`
(transcrições de pares viram `P1..Pn`; `find_comparable_interactions` devolve `peerInteractionId` → handle
`P-n`); a interação do próprio colaborador (`analyze_interactions`) continua verificando contra o
bruto. Resultado da Tool traz só `privacy` (versão, contagens de redação por tipo, `reidentificationRejected`,
handle → sourceHash). Não redigido: nome de cliente (não há identidade estruturada — nunca por
adivinhação). Provas: `peer-privacy-projection.test.ts` e a prova de REIDENTIFICAÇÃO em
`diagnostic-calls-proof.test.ts` (contexto model-facing real: 0 identidades de pares, 0 UUID, 0 matrícula).

### Ground truth do lote — QA apenas, NUNCA dado da IA

O gabarito (padrões plantados por persona, 18 casos-controle, métricas esperadas, evidências por
segmento) vive em `backend/scripts/poc-tools/ground-truth/inia_demo_90_v1/` (`GROUND_TRUTH.md`,
`ground_truth_chamadas.jsonl`, `metricas_esperadas.json`, `validacao.json`, `manifest_sha256.json`).
Serve a scripts de benchmark futuros (persona → padrões esperados, controles, o que NÃO concluir) e a
nada mais: nenhum arquivo de `backend/src` o importa, nada dele entra em interações, transcrições,
flags, bases de conhecimento, agentes, orquestradores, workflows, feedbacks ou metadados de pessoas.
Provas: `ground-truth-isolation.test.ts` (código-fonte + arquivo importado) e
`diagnostic-calls-proof.test.ts` (banco). Ao avaliar a INIA sobre este lote, não nomear os padrões no
prompt — a resposta correta pode ser "não há evidência suficiente para apontar um padrão recorrente".

### Como reexecutar e validar

```bash
cd backend
npm run db:seed:demo                     # carga (idempotente) — lote V2, catálogo de assuntos, reposição
npx vitest run src/infrastructure/database/demo-mass src/modules/interactions   # contrato, layout V2, catálogo, isolamento, snapshot
npm run db:seed:demo:test && INIA_DB_PROOF=1 npx vitest run diagnostic-calls-proof   # prova no banco (10 provas)
npx tsx scripts/demo-mass/diagnostic-dataset-fingerprint.ts   # versão + fingerprint do dataset
npx tsx scripts/demo-mass/restore-official-snapshot.ts        # dry-run: divergências entre banco e snapshot do gerador (esperado 0)
```

## Acompanhamento, Ciência e Pendências canônicos (sem executar Workflow)

Criados pelo seed pelos **contratos reais** (`demo-follow-ups.ts`: `supervision_cases` + `evidences` +
`feedbacks` publicados; `workflows`/`workflow_versions`/`workflow_enrollments` + `alerts` para a
pendência), com ids determinísticos `followup:*`. Nenhuma chamada a LLM — textos estáticos coerentes
com as personas. Idempotente: reseed restaura o estado canônico (inclusive a ciência pendente da
Mariana e a pendência em `waiting`).

**Decisão real na Pendência demo (aprovar/reprovar/escalar):** o runtime gera artefatos com id de
runtime (aprovar → caso + evidência + feedback publicado ao Thiago + linha do tempo; escalar →
alerta ao Gerente; qualquer decisão → eventos/outputs da matrícula). Eles NÃO são hardcoded: seed e
reset os descobrem por **lineage real** (`findDemoDerivedArtifacts` em `demo-follow-ups.ts`) — do
Workflow demo (id determinístico) às matrículas (FK), dos eventos/`node_outputs` ao `caseId`/
`feedbackId`, dos casos derivados aos filhos por FK, e dos alertas pela chave estruturada do motor
(`workflow_output|workflow_escalation|workflow_human_review:<enrollmentId>:…`). Nunca por título ou
`like '%demo%'`. O **reset** remove esses derivados antes da fixture (filhos → pais); o **seed**
também os remove antes de reescrever a fixture, então `db:seed:demo` sozinho já restaura o estado
canônico (pendência de volta em `waiting`, sem feedback "aprovado" órfão). Um caso/feedback aberto
para uma pessoa demo por OUTRO caminho não está na cadeia → continua bloqueando.

Configuração com Abrangência num Grupo demo também bloqueia (hoje: os Workflows-modelo 17 e
18a/b/c apontam para `B2C · Retenção/Faturamento/Suporte Técnico`) — é referência externa legítima:
o reset lista `workflows.team_id` e para; mova essas instâncias para "Todos os grupos" antes e volte
depois do seed (os ids dos Grupos são determinísticos). Para provar o ciclo completo sem tocar
nelas, use o banco de teste (`db:seed:demo:test` / `db:seed:demo:reset:test`): lá não há instâncias
ancoradas em Grupo demo.

| Login | O que demonstra |
| --- | --- |
| `operador0001` Larissa | Acompanhamento → reconhecimento (PRV 118%, Q1 6/6) com **ciência confirmada em 15/09** |
| `operador0002` Mariana | Acompanhamento → feedback de performance (Q4 recorrente) com botão **Confirmar ciência** (pendente) |
| `operador0003` Beatriz | Acompanhamento → reconhecimento de evolução (83% → 110%), ciência confirmada, com **Material de apoio recomendado** ("Checklist de Encerramento de Chamada", base da migration 009 — `feedback_support_materials`; "Acessar material" abre `/materiais/:id`) |
| `operador0004` Rafael | Acompanhamento → análise LONGA em Markdown (título, tabela, lista, destaque, link) → "Ver feedback completo" / no gestor "Ver análise completa" |
| `operador0006` Diego | Acompanhamento → "Nota da URA — análise não concluída" (lacuna de dado, sem avaliação negativa) |
| `supervisor01` Daniela | Equipe → **Mariana aguardando ciência**; Acompanhamento → os 5 feedbacks com estado de ciência; Pendências → **Revisão pendente: Thiago Moreira** (aprovar publica o feedback ao Thiago; reprovar encerra; escalar entrega ao Gerente André) |

A pendência vem do Workflow `Demo · Revisão humana pendente (massa demo)` — inativo (o agendador
nunca o considera), com versão publicada e uma matrícula em `waiting` no node `review` cujo
`nodeOutputs.agent` já traz o resultado do Especialista de Performance (números reais do Thiago).
A decisão retoma pelo runtime real (`submit-human-review-decision.ts` → tick do motor).

## Estrutura

- 1 Diretor → 4 Gerentes Sêniores → 16 Gerentes → 8 Coordenadores → 80 Supervisores → 2.000 Operadores.
- Operações: `Atendimento B2B` (já existia) e `Atendimento B2C` (nova, demo).
- Grupos (`teams`): B2C · Atendimento Geral (2 gerentes), Faturamento (2), Retenção, Suporte
  Técnico (2), Digital; B2B · Atendimento PME (2), Grandes Contas, Faturamento Empresarial (2),
  Suporte Empresarial (2), Retenção B2B.
- Subgrupos (`subteams`, 20): Voz/Chat/WhatsApp/Premium/Massivo/PME/Corporate conforme o Grupo
  (19) + **"Diagnóstico IA — Operadores com gravações"** em `B2C · Atendimento Geral` (ver abaixo).
  `B2B · Retenção B2B` **não tem** subgrupo; em todo Grupo com subgrupo há operadores com
  `subteam_id` nulo (≈13% no total) → bucket "Sem subgrupo".
- **Subgrupo demo de diagnóstico (Tools de investigação, 2026-09-17)**: a equipe canônica do
  Supervisor 01 (operadores 0001–0025, personas conhecidas, todos com 10 interações + transcrição)
  fica concentrada no Subgrupo "Diagnóstico IA — Operadores com gravações" do mesmo Grupo
  (`DIAGNOSTIC_SUBGROUP` em `structure-generator.ts`; o Supervisor 01 também). Massa de teste para
  comparação entre operadores, com o Subgrupo (n=24 pares) e com o Grupo (n=254), mesmo assunto,
  flags e indicadores operacionais. Nada muda na regra estrutural: Grupo, gestor, cargo e situação
  funcional preservados; o quartil oficial é coorte por Grupo, então o fechamento não muda. O
  Subgrupo fica FORA de `spec.subgroups` para não alterar o sorteio dos demais (determinismo).
  Idempotente: `db:seed:demo` recria/reposiciona; não depende de UPDATE manual. Não existe coluna
  de áudio/gravação no modelo — "gravação" = transcrição (22.670 de 22.671 interações).
  Artefatos POC criados MANUALMENTE no dev (não vêm do seed, não apagar): Agents `[POC TOOLS]
  Diagnóstico de Performance` / `Diagnóstico de Interações` / `Processo e Conhecimento` /
  `Coordenação · Diagnóstico Operacional`, Orquestrador `[POC TOOLS] Orquestrador Diagnóstico
  Operacional` (TEAM B2C · Atendimento Geral, BOTH, OPEN — atende o chat desse Grupo), Workflows
  DRAFT `[POC TOOLS] Feedback de Indicador` (agenda, TMA mês anterior) e `[POC TOOLS] Feedback de
  Monitoria` (flag rechamada); 6 Feedbacks publicados etiquetados em `context_snapshot.pocTools`
  (`POC_TOOLS_INDICATOR_A/B/C` = Mariana Alves, Rafael Cardoso, Camila Fonseca; `POC_TOOLS_CALL_A/B/C`
  = DEMO-QA-INTERACTION-008/010 e DEMO-INT-0005-04, flag rechamada), gerados por
  `backend/scripts/poc-tools/run-poc-feedbacks.ts` (rascunho executado pelo motor real com a Revisão
  humana auto-aprovada). Benchmark A/B da V1.1 de eficiência (mesmos 6 casos, runtime novo):
  `POC_TAG_PREFIX=POC_EFFICIENCY_V1 npx tsx scripts/poc-tools/run-poc-feedbacks.ts <indicator|monitoring> [A|B|C]`
  → 6 Feedbacks `POC_EFFICIENCY_V1_INDICATOR_A/B/C` e `POC_EFFICIENCY_V1_CALL_A/B/C` (os anteriores
  continuam — comparação histórica; `context_snapshot.investigation` traz tokens/requests/rodadas/gating).
  V1.2 (hardening): `POC_TAG_PREFIX=POC_V12` (roteamento CURRENT) e `INIA_MODEL_ROUTING=EFFICIENCY POC_TAG_PREFIX=POC_V12_ROUTING`
  (roteamento EFFICIENCY) → 12 Feedbacks `POC_V12_*`/`POC_V12_ROUTING_*` com `investigation.requestLog` (modelo/tier por request),
  `handles`, `synthesis.evidenceRepresentativeness` e claims com escopo.
  V1.3 (eficiência/fail-closed): o runner captura a telemetria por request (contexto por categoria, componentes de prompt,
  rota, cache, custo) em `context_snapshot.pocBenchmark` e os braços do A/B são etiquetados por flags de env —
  `POC_V13_CTRL` (CURRENT/FULL = reexecução da V1.2), `POC_V13_SCHEMA` (schemas COMPACT), `POC_V13_PROMPT` (prompt COMPACT)
  e `POC_V13` (COMPACT/COMPACT + `INIA_PROMPT_CACHE=EXPLICIT`), sempre com `INIA_MODEL_ROUTING=CURRENT`.
  Exportar e comparar: `npx tsx scripts/poc-tools/export-poc-benchmark.ts POC_V13 saida.json` e
  `npx tsx scripts/poc-tools/compare-poc-benchmarks.ts baseline.json candidato.json` (tabela por caso: tokens, estático/schemas,
  cache, gating, claims, representatividade, fatos essenciais preservados/perdidos, diferenças de Tools). Nunca apaga POCs anteriores.
  V1.3.1: cada execução do runner grava `pocBenchmark.datasetFingerprint` (hash de contagens da massa); o comparador só calcula
  percentuais quando os hashes coincidem ("massa: COMPATIBLE"); massa diferente = lado a lado com aviso. Após a massa demo ser
  congelada, rodar o benchmark completo V1.3 × V1.3.1 com fingerprint idêntico.
- Desenho por Supervisor (índice 1..5 dentro do Gerente): 1, 2 e 5 = um subgrupo; 3 = dois
  subgrupos; 4 = um subgrupo com ~20% da equipe sem subgrupo. `supervisor40` (B2C · Digital) tem
  5 operadores em `B2C · Atendimento Geral / WhatsApp` — equipe com dois Grupos.
- Extras: 90 operadores admitidos dentro da janela (maio–julho/2026, sem histórico anterior);
  8 afastados a partir do dia 15 da última competência fechada (sem fechamento nem chamadas desde então). Jornadas em `employee_work_shifts`.

### Cadeia legada adotada (`legacy-adoption.ts`)

As pessoas de demonstração que as migrations já criavam (Ana Lima, Mariana Costa, Roberto Alves,
Bruno Teixeira, Thiago Barreto, Vanessa Lopes, Patrícia Coordenadora, Juliana Prado — e, no banco
de desenvolvimento, as cadastradas pela UI: Roberta Gaspar, Luzia, Icaro, Karoline, Luana, Camila,
Gustavo, Pamella, Denisy, Samuel) **entram na árvore demo sem serem recriadas**:

- Diretor Paulo Ricardo e Gerente Sênior Fernanda Dias são removidos (a árvore tem um Diretor: o
  da massa; os alertas do Sino endereçados a eles saem junto). Se algum dado de domínio real ainda
  apontar para um deles, a pessoa é desativada em vez de apagada (o log diz qual referência).
- Roberto Alves → Gerente 17 sob a Gerente Sênior 03 (B2B), Grupo `B2B · Retenção B2B`, com
  Patrícia Coordenadora entre ele e os 5 Supervisores (desenho "Gerente ímpar"); Roberta Gaspar →
  Gerente 18 sob a Sênior 04, Grupo `B2B · Faturamento Empresarial`.
- Supervisores legados ficam sob seus gestores de hoje, no Grupo demo equivalente ao antigo
  (`LEGACY_TEAM_BY_GROUP`): Mariana Costa → Retenção B2B; Vanessa Lopes → Atendimento PME; Bruno
  Teixeira → Faturamento Empresarial; Thiago Barreto → Suporte Empresarial. Os 11 **operadores**
  legados (todos com corpus próprio de transcrições) ocupam a VAGA do seu supervisor legado
  (ordinal/persona/matrícula), mas desde 2026-09-18 são POSICIONADOS no Subgrupo de diagnóstico —
  Grupo `B2C · Atendimento Geral`, sob a Supervisora 01 (`DIAGNOSTIC_LEGACY_OPERATORS`,
  `adopted.relocatedFrom`; ver "Subgrupo de diagnóstico" abaixo). Os supervisores legados ficam com
  25 − n operadores; nenhuma pessoa nova é gerada para a vaga.
- A massa **completa o desenho**: supervisores gerados até cada Gerente ter 5 (ordinais 81–90) e
  operadores gerados até cada Supervisor ter 25 (ordinais 2001–2250) — logins `.demo`, personas, 6
  competências, diárias e 10 chamadas como qualquer outro. As vagas são fixas por ordinal: a vaga de um
  legado ausente (ex.: banco recém-migrado, onde só parte da cadeia existe) recebe uma pessoa gerada com o
  mesmo ordinal/nome; Gerente/Supervisor legado ausente é substituído por um gerado e quem está abaixo
  continua adotado.
- Os adotados recebem a mesma massa dos gerados **só onde não há dado**: fechamento oficial em
  competência que já existia (ex.: 07–08/2026 do `seeds/demo/001`, ou `MANUAL_SEED`) nunca é
  sobrescrito; medição diária DEMO_SEED não é gerada num dia × indicador em que já há medição de outra
  fonte (chamada real, QA, seed antigo). Chamadas reais transcritas, casos, feedbacks, jornadas da
  migration 042, e-mail/senha existentes ficam intactos; `hired_at`/`matricula`/`job_title` só são
  preenchidos quando nulos (`DEMO-LEG-nnnn`). Quem não tinha login (Patrícia) ganha um `.demo`.
- Ids legados não são determinísticos (as migrations inserem por nome): a resolução é por
  (organização, nome, papel) na carga; homônimo gerado pela própria massa (há uma "Camila Pereira"
  entre os 2.000) nunca é confundido com o legado, e dois legados de mesmo nome/papel = ambíguo (não
  adotado, listado no log).
- Os 9 operadores "TESTE …" (fixtures de Workflow) ficam de fora: continuam reportando a Bruno/Vanessa
  nos Subgrupos TESTE, sem Grupo demo nem dado gerado, e não contam nos 25.
- `db:seed:demo:reset` apaga só o gerado para os adotados (por id determinístico), devolve cada um ao
  Grupo legado e desfaz só os vínculos com pessoas demo (Roberto/Roberta voltam a não ter chefe;
  Paulo/Fernanda **não** voltam). Os Grupos antigos (RETENÇÃO/FIDELIZAÇÃO, FATURAS, SUPORTE TÉCNICO,
  ATENDIMENTO GERAL) permanecem no banco, vazios, com suas metas.

## Indicadores, metas, performance

- Só códigos já existentes em `indicator_definitions` (direção lida do banco): MONITORIA_QUALIDADE,
  TMA, TMT, NOTA_URA, REINCIDENCIA_7D, ADERENCIA (usado como proxy de "ABS"), TAXA_RETRABALHO,
  TAXA_RETENCAO, RECONTATO_CANCELAMENTO, FCR, TAXA_TRANSFERENCIA, TEMPO_DIAGNOSTICO,
  TEMPO_DISPONIVEL, NPS, SLA_24H, QUALIDADE_ANALISE, BACKLOG. Conjunto por Grupo em
  `indicator-catalog.ts`.
- Metas por Grupo (`goals`, TEAM) desde 2026-04-01; mudanças com histórico: TMA 420→400
  (Atendimento Geral, jul), TMA 540→520 (Suporte Técnico, jul), SLA_24H 90→92 (Faturamento
  Empresarial, ago). Metas por Subgrupo: Atendimento Geral/Chat TMA 300; Digital/WhatsApp NOTA_URA 4,5.
- Pesos (`weight_percent`) somam 100 por Grupo; B2C · Retenção muda pesos a partir de julho.
- Competências: as **6 últimas competências civis COMPLETAS** antes da data de referência
  (`closedReferencePeriods` em `demo-constants.ts`; em 16/09/2026 = 2026-03 … 2026-08). O mês
  corrente **nunca** tem fechamento oficial — só medição diária (camada 1). Atingimento: HIGHER = valor/meta; LOWER = meta/valor (mesma
  semântica do seed SQL 001). PRV = média ponderada dos componentes com teto de 120% por componente.
  Quartil (indicador e PRV) = ranking dentro do Grupo × competência (Q1 = melhor 25%).
- Numerador e denominador do fechamento (contrato `OFFICIAL_INDICATOR_PERFORMANCE@2`, migration 147):
  só para Taxa e Média ponderada, derivados DO VALOR oficial já decidido (`closure-components.ts`) —
  tempo médio: denominador = atendimentos do mês, numerador = segundos (valor × atendimentos); taxa:
  ocorrências inteiras ÷ base do mês; notas: soma das notas ÷ respostas. Volume mensal plausível por
  indicador, semente = id da linha (o gerador da pessoa não é consumido; valor, atingimento e quartil
  idênticos aos de antes). Média simples (PRODUTIVIDADE) e Último valor (BACKLOG) ficam nulos. O seed
  preenche também os fechamentos já gravados e os do SQL 001 (`fillDemoClosureComponents`, só
  `DEMO_SEED`); banco já populado: `npx tsx scripts/demo-mass/backfill-official-closure-components.ts --apply`
  (rodado em 16/10/2026 no `inia` — 68.089 linhas — e no `inia_test` — 79.399 —, 0 incoerentes).
- Personas por equipe de 25 (deck embaralhado): 4 alta, 7 média, 2 crítica, 3 evolução, 2 queda,
  1 eficiente/baixa qualidade, 1 qualidade boa/TMA ruim, 2 PRV parcial, 1 dados incompletos, 2 volátil.
- `indicator_measurements` (subject PERSON, janela mensal fechada, `source = DEMO_SEED`) espelha
  os fechamentos — é o que "Valor do indicador" em Conditions/Ranking lê.

## Situação funcional (férias/afastamento) — fixtures auxiliares

`demo-employment-status.ts` registra, pelo serviço canônico (`applyEmployeeStatusSnapshot`, source
`DEMO_SEED`, datas explícitas, idempotente), períodos relativos à data de referência: operador0011
(férias cobrindo a janela inteira dos últimos 7 dias → SEM DADOS/`NO_ELIGIBLE_DAYS`), operador0012
(férias parciais desde ref−2), operador0013 (férias ref−20..ref−4, ativo desde ref−3), operador0014
(afastado desde ref−30, em aberto) e os 8 afastados da massa (`absentLastPeriod`) como LEAVE desde
o dia 15 da última competência fechada. As personas canônicas não são tocadas. As medições diárias
desses operadores continuam sendo geradas — é o que prova que uma medição recebida em férias fica
no banco sem entrar no cálculo. O seed também define a cobertura mínima PADRÃO do catálogo onde
ainda não configurada (0.6; 0.4 para MONITORIA_QUALIDADE/NPS/QUALIDADE_ANALISE, amostrados). O
reset apaga os períodos junto com as pessoas.

## Medições operacionais diárias (camada 1)

- `npm run db:seed:demo` também gera **180 dias corridos** de medições diárias (`indicator_measurements`, `granularity = 'DAILY'`, `source = 'DEMO_SEED'`) até a **data de referência** = `DEMO_REFERENCE_DATE` (AAAA-MM-DD) ou "hoje" local (-03). Só dias úteis (a operação demo não trabalha sáb/dom).
- Determinístico **por data**: o valor de (operador, indicador, dia) depende só da chave — rodar amanhã acrescenta um dia e mantém os outros idênticos. Idempotente (upsert pela unique key oficial). O reset apaga as diárias junto com o resto da massa.
- Cada dia é **ancorado no fechamento oficial** do mês (o nível diário médio reproduz o atingimento oficial; desvio típico ≤ 3–4%), com a textura da persona: alta performance com dias ruins ocasionais; evolução/queda com tendência suave (interpolação entre meses, continuada no mês corrente — que é acompanhamento, não fechamento); volátil com regimes semanais; crítico persistente. Nunca recalcula/altera o oficial.
- Componentes por semântica: TMA/TMT/tempo de diagnóstico = Σ segundos ÷ contatos/casos (20–80 contatos/dia conforme jornada e persona); taxas = ocorrências ÷ elegíveis; Qualidade = nota × 1–2 avaliações (≈45% dos dias têm avaliação); Nota URA/NPS só em dias com respostas; Backlog = snapshot inteiro sem componentes. Dia sem amostra = **sem linha** (SEM DADOS), nunca zero.
- Lacunas reais: admitidos na janela só depois da admissão; afastados param no dia 15 da última competência fechada (`absenceStartFor`); persona "dados incompletos" tem 2 semanas de férias sem nenhuma medição e não tem diário nos meses em que o indicador não fechou oficialmente; Diego Tavares não tem Nota URA em jul/ago (nem diária, nem oficial).
- Volume real (referência 16/09/2026): 1.137.844 linhas (estimativa prévia 1,36 mi antes das lacunas), ~42 s de carga, `indicator_measurements` ≈ 200 MB + 500 MB de índices.
- Casos canônicos (equipe da Supervisora 01, TMA últimos 7 dias): Mariana Alves = Q4 operacional, Larissa Monteiro = Q1 operacional, Rafael Cardoso = Q4 e piorando mês a mês, Beatriz Nogueira melhorando mês a mês, Diego Tavares = SEM DADOS de Nota URA em agosto.

## Interações

- 10 por operador, em 10 dias úteis distintos dentro da janela (2026-04-01 … 2026-09-14), dentro
  da jornada do operador; canal `VOICE` (único implementado). `external_id` `DEMO-INT-<op>-<n>`.
- Transcrição: uma fala por linha, `Operador:` / `Cliente:`; ~2% em texto corrido sem rótulos
  (fallback textual do QA). Curta 15–40 falas, média 41–100, longa 101–170 (≈ 45/40/15).
- Composição por cenário (15 temas por domínio do Grupo), tom do cliente, desfecho, falhas
  operacionais auditáveis, trechos inconclusivos (`[trecho inaudível]`), rechamada, segundo
  assunto em chamadas longas. Probabilidade de falha coerente com a persona do operador.
- Flags (≈57% das chamadas têm ≥1; o restante nenhuma): reutiliza `nota_ura`, `rechamada`,
  `tempo_silencio`, `tdna` (não usada) e cria `cancelamento`, `contestacao`, `transferencia`,
  `detrator` (BOOLEAN, VOICE). Cada flag só aparece quando o tema aparece literalmente na conversa.
- Além das geradas: o lote externo de 90 chamadas de diagnóstico (seção acima) e as transcrições
  legadas das migrations/scripts antigos (`<NOME>-nn`), ambos preservados em recarga.
- **Motivo × submotivo** (2026-10-16, migration 145): `reason` = motivo genérico do cenário principal
  (`ScenarioSpec.motive`: Fatura, Cobrança, Suporte técnico, Cancelamento, Plano, Informação, Reclamação,
  Cadastro); `sub_reason` = a frase específica, a mesma de antes ("Segunda via de fatura",
  "X e y" em chamadas com segundo assunto, "(rechamada)"). Ficam como antes (frase no motivo, sem
  submotivo) os operadores que estão hoje no Subgrupo "Diagnóstico IA", as transcrições canônicas e o lote
  de 90 chamadas. Assim o fingerprint do dataset homologado e os aliases de assunto canônico não mudam.
  Para ajustar um banco que já tinha a massa, use
  `npx tsx scripts/demo-mass/backfill-interaction-sub-reasons.ts [--apply]` (dry-run por padrão,
  idempotente; desfazer = `reason = sub_reason, sub_reason = null`).

### Transcrições canônicas (QA)

| external_id | Operador | Tema | Tamanho | Flags | O que a transcrição sustenta |
| --- | --- | --- | --- | --- | --- |
| DEMO-QA-INTERACTION-001 | Aline Castro | Faturamento | curta | — | Correta ponta a ponta |
| DEMO-QA-INTERACTION-002 | Marcos Vieira | Faturamento/Contestação | longa | contestacao, tempo_silencio, nota_ura 2 | Informação divergente (estorno "em 24h na conta"), orientação errada de pagamento, prazo não explicado |
| DEMO-QA-INTERACTION-003 | Diego Tavares | Rechamada (visita perdida) | média | rechamada, tempo_silencio | Processo incompleto: sem reclamação formal, sem compensação, sem protocolo no encerramento |
| DEMO-QA-INTERACTION-004 | Gabriela Duarte | Retenção | longa | cancelamento, nota_ura 5, tempo_silencio | Correta: cobertura, oferta, alternativa de suspensão, prazos, protocolo |
| DEMO-QA-INTERACTION-005 | Leandro Farias | Retenção | média | cancelamento, nota_ura 2 | Falha aparente: sem oferta, fidelidade vaga, transferência sem contexto |
| DEMO-QA-INTERACTION-006 | Vitor Macedo | Suporte Técnico | longa | tempo_silencio | Troubleshooting completo e conforme |
| DEMO-QA-INTERACTION-007 | Patrícia Leite | Suporte Técnico | média | tempo_silencio, nota_ura 3 | Etapa **não confirmável** (resultado do reinício inaudível) → "não foi possível confirmar" |
| DEMO-QA-INTERACTION-008 | Mariana Alves | Detrator | longa | detrator, rechamada, contestacao, nota_ura 1 | Cliente insatisfeito, ameaça Anatel/Procon; retorno sem prazo/responsável |
| DEMO-QA-INTERACTION-009 | Larissa Monteiro | Qualidade | curta | — | Excelente (resolve causa raiz) |
| DEMO-QA-INTERACTION-010 | Rafael Cardoso | Multidomínio | longa | contestacao, cancelamento, rechamada, tempo_silencio, nota_ura 4 | Correta, com UMA falha: retorno prometido sem prazo/canal |

### Flags propositalmente imperfeitas (fixture, não ground truth)

`DEMO-QA-FLAG-FP-001` (Thiago Moreira) e `DEMO-QA-FLAG-FP-002` (Beatriz Nogueira): `rechamada`
marcada sem menção a contato anterior. `DEMO-QA-FLAG-FN-001` (Thiago Moreira) e
`DEMO-QA-FLAG-FN-002` (Henrique Barros): rechamada evidente na conversa, sem a flag.

## Limitações conscientes

- Lote de diagnóstico: comparáveis por assunto entre massas dependem do catálogo de aliases (o que não
  tem alias compara só pelo bruto exato). Luana/Denisy/Icaro/Samuel carregam sobras de QA antigas
  (interações com `external_id` uuid, assuntos "TESTE …"/"(retest)") — preservadas, não são massa de
  diagnóstico. Os 11 legados só têm diária de setembro nos indicadores com âncora oficial
  (TMA/Qualidade/Nota URA), nunca inventada. Protocolos falados `DEMO-202606-…` continuam com "202606"
  em chamadas de jul/ago (identificador, não data). A transcrição legada `CAMILA-PEREIRA-3` apresenta a
  operadora como "Rafael" (texto antigo reaproveitado): não é vazamento de par (é o nome do alvo quando
  o alvo é Rafael), mas é uma inconsistência do corpus legado, fora deste escopo. Nome de CLIENTE não é
  redigido na projeção de pares (sem identidade estruturada).

- Medições brutas são fechamentos mensais: Conditions com janela "hoje"/"últimos N dias" só
  enxergam um mês quando o `period_end` dele cai na janela (ex.: 30 dias em 15/09 inclui agosto).
- Subgrupos "Chat"/"WhatsApp" são rótulos organizacionais; as interações continuam `VOICE`.
- Nenhum feedback, caso, workflow, agente ou base de conhecimento é criado pela massa.
- O seed insere direto nas tabelas (mesmo contrato da ingestão), sem passar por
  `POST /ingestion/interactions` — de propósito, para não matricular 20 mil interações em
  workflows nem disparar agentes.
- A senha é uma só e o hash bcrypt é calculado uma vez por carga e reaproveitado (mesmo
  `hashPassword` do cadastro). Recarregar não altera senha já existente; use reset + seed.
- Adotados da cadeia legada têm histórico oficial "misto": 07–08/2026 vêm do `seeds/demo/001`
  (indicadores antigos como ADERENCIA/TDNA) e 03–06/2026 da massa (indicadores do Grupo demo) — é o
  preço de preservar o que já existia; a camada operacional (diárias) é uniforme.
