# Submotivo no assunto das comparações — decisão e implementação (16/10/2026)

## Decisão do usuário (16/10/2026)

| Pergunta | Resposta |
| --- | --- |
| Assunto específico (b) ou motivo genérico (a)? | Os dois; o preferencial é o **submotivo** |
| Sem alias, o segmento cai no motivo ou no submotivo? | **Submotivo** (b2) |
| Fechamento do PRV de TMA (congelado) | **Segue o submotivo** (versão nova) |
| Alias pelo par motivo + submotivo | **Agora** (migration 146); subir também na homologação |
| Título do feedback sem canônico | **Submotivo** |
| "Os dois" nas comparações | Submotivo é o recorte principal; o motivo vira uma dimensão a mais, nas Tools e no diagnóstico |
| Migrations | Aplicar: 146 em `inia` e `inia_test`; 145 e 146 no `inia_holdout_v2` |

## O que foi implementado (`SUBJECT_RESOLUTION_V2`)

**Regra única** em `backend/src/modules/interactions/domain/interaction-subject.ts`. Todos os leitores da seção 1 seguem essa regra.

- **Assunto** (nível preferencial, dimensão `SUBJECT`): o submotivo quando a fonte o informou; sem submotivo, o motivo.
  - Canônico: alias do par (motivo + submotivo) > alias do texto do submotivo. Sem submotivo, alias do texto do motivo.
  - Submotivo sem alias fica no bruto dele. Ele nunca sobe para o canônico do motivo.
  - Funções: `rawSubjectSql`, `canonicalSubjectSql`, `subjectKeySql`.
- **Motivo** (dimensão `REASON`): sempre `interactions.reason`, com canônico pelo alias do texto. Funções: `canonicalReasonSql`,
  `reasonKeySql`; os níveis se escolhem por `levelKeySql`, `levelCanonicalSql` e `subjectFilterSql(…, level)`.
- **Migration 146** (`146_interaction_subject_alias_by_reason.sql`):
  - nova coluna `interaction_subject_aliases.raw_reason`, que restringe o alias a um motivo;
  - o índice único passa a ser `(organização, motivo ou vazio, bruto)`;
  - o serviço `upsertInteractionSubjectCatalog` aceita `rawReason`; par ambíguo é recusado como "motivo › bruto";
  - `resolveCanonicalSubject` só resolve um texto solto pelo alias do texto, porque um alias de par só vale dentro do motivo dele.
- **Leitores:**
  - segmentos, recortes e memória do motor (`postgres-indicator-data.ts`); a assinatura da evidência inclui o submotivo, e quem
    não tem submotivo mantém a assinatura de antes;
  - plano do diagnóstico direto: tenta o submotivo e, com `REASON` ligado na estratégia, depois o motivo. Cada segmento do assunto
    traz `reasons` como contexto;
  - práticas dos colegas, no mesmo nível do plano;
  - fechamento do PRV, só no nível do assunto;
  - "Assunto registrado" da análise de chamada e `call_assessments.subject_raw` (o submotivo, quando há);
  - processo primário da base de conhecimento;
  - rótulo e título do feedback;
  - Tools de investigação: `subject` preferencial, `reason`/`canonicalReason` quando há submotivo, filtro `reason`, dimensão
    `REASON`, buckets com `reasons`;
  - transcrições analisadas pelas Tools.
- **Estratégia do indicador:** a dimensão `REASON` ("Motivo do atendimento") aparece no editor ao lado de "Assunto do atendimento
  (submotivo)". Com as duas marcadas, o submotivo vem primeiro e o motivo só entra quando nenhum submotivo tem atendimentos
  suficientes. O motor de feedback localiza sempre pelo assunto (o preferencial); o motivo entra nele como dimensão das ferramentas e
  como recorte `REASON`.
- **Versões novas:**

  | Constante | Nova versão |
  | --- | --- |
  | (nova) | `SUBJECT_RESOLUTION_V2` |
  | `INDICATOR_INVESTIGATION_LOGIC_VERSION` | V17 |
  | `INVESTIGATION_SLICES_VERSION` | V2 |
  | `ENGINE_INVESTIGATION_TOOLS_VERSION` | V5 |
  | `DIRECT_DIAGNOSIS_LOGIC_VERSION` | `INDICATOR_DIAGNOSIS_V2_1` |
  | `PRV_DIAGNOSIS_LOGIC_VERSION` | `PRV_DIAGNOSIS_V1_0_3` |
  | `FEEDBACK_HEADING_VERSION` | V2 |

  `CALL_ANALYSIS_*` não mudou, porque a memória filtra por ela. A lógica de avaliação das chamadas do PRV ficou separada
  (`PRV_ASSESSMENT_LOGIC_VERSION = PRV_DIAGNOSIS_V1_0_2`), então pendência gravada antes continua reaproveitável e nenhuma chamada
  é paga de novo por isso.
- **Não mudou:**
  - nenhum texto de instrução de prompt;
  - nenhum `*-freeze.json` nem script congelado;
  - o catálogo demo (`DEMO_SUBJECTS_V1`) e o fingerprint `DIAGNOSTIC_DATASET_V1_1`, porque o Subgrupo não tem submotivo.
- **Termo "motivo investigado":** os prompts congelados do redator de indicador (V3/V4) chamam o segmento de "motivo investigado".
  O texto continua assim, mas o segmento agora é o assunto (submotivo).
- **Provas:**
  - `INIA_DB_PROOF=1 npx vitest run subject-resolution-proof`: par, texto, submotivo sem alias, par ambíguo, resolução solta e
    filtros nos dois níveis, numa transação desfeita;
  - `investigation-tools-proof` (dimensão `REASON`);
  - testes de `interaction-subject`, `investigation-slices`, `indicator-diagnosis` e `diagnostic-strategy`.
- **Migrations aplicadas em 16/10:**
  - `inia` e `inia_test`: 146 (a 145 já estava aplicada);
  - `inia_holdout_v2`: só a 145 e a 146. Esse banco parou na 075, com 70 migrations pendentes, e o fingerprint dele (colunas
    explícitas) ficou igual: os hashes de interações e do catálogo de assuntos foram conferidos antes e depois;
  - homologação: subir a 145 e a 146 na próxima atualização (`npm run db:migrate` do procedimento normal).
- **Atenção até o merge:** a 146 trocou o índice único dos aliases. Código sem esta mudança (outro checkout rodando
  `db:seed:demo` no mesmo banco) falha no passo do catálogo de assuntos: o `on conflict` antigo não encontra mais o índice.

---

## Análise que levou à decisão (opções, antes da implementação)

**Premissa da análise:** o trabalho do submotivo (migration 145, `INTERACTIONS@2`, ajuste da massa demo) existia no banco de dev
(`inia`) e no de teste (`inia_test`) e foi trazido para esta branch no commit `8f706bb9`. Os números abaixo vêm de consultas somente
leitura no `inia` em 16/10, antes da implementação, na organização demo `…0001` (23.352 interações).

## 1. Onde o "assunto" lia só o motivo (antes da V2)

Tudo passa por **uma** função: `canonicalSubjectSql` (`interactions/domain/interaction-subject.ts`). Ela casa o alias de
`interaction_subject_aliases` com `interactions.reason`. O segmento é `coalesce(canônico, reason)`. Leitores:

| Leitor | O que faz com o assunto | Onde |
| --- | --- | --- |
| Segmentos do motor de feedback | localização por assunto, recortes, amostra e memória das análises (segmento calculado **ao vivo** pela interação, não pelo que foi gravado na análise) | `feedback-engine/infrastructure/postgres-indicator-data.ts` `segmentKeySql`, `postgres-feedback-memory-store.ts` |
| Diagnóstico direto de indicador | segmentos do plano e práticas dos colegas por assunto | `indicator-diagnosis/application/load-diagnosis-plan.ts`, `load-peer-practice-data.ts` |
| Fechamento do PRV (TMA, **congelado**) | cópia própria de `segmentKeySql` | `indicator-diagnosis/application/load-prv-closing-data.ts` |
| Análise de chamada | `Assunto registrado: …` no turno do prompt; escolha do documento principal pelos termos do título (`selectPrimaryProcessDocument`). O texto do turno entra no hash da `proposalKey`/`analysisKey` | `feedback-engine/application/analyze-call.ts`, `infrastructure/postgres-engine-loaders.ts` |
| Base de conhecimento (processo primário) | `coalesce(nome canônico, reason)` | `knowledge/application/retrieve-knowledge.ts` `loadInteractionSubject` |
| Título do feedback | canônico > bruto (`reason`) > nome do código > neutro (`FEEDBACK_HEADING_V1`) | `feedbacks/domain/feedback-heading.ts`, `feedback-engine/application/generate-feedback.ts`, `interaction-feedback/application/prepare-interaction-for-feedback.ts`, `reliable-feedback/.../postgres-feedback-context-loaders.ts` |
| Tools de investigação | filtro `subject` (canônico ou bruto exato = `reason`), buckets `SUBJECT`, comparáveis de colegas. `subReason` já aparece na saída, mas sem filtro | `investigation/application/tools/interaction-tools.ts`, `investigation/domain/tool-catalog.ts` |

O catálogo de assuntos canônicos **não tem tela nem API**: só o seed demo grava nele (`demo-mass/subject-catalog.ts`,
`DEMO_SUBJECTS_V1`). Numa instalação real o catálogo está vazio, o canônico é sempre nulo e o segmento é o texto bruto.

## 2. O que o ajuste da massa de 16/10 tinha mudado antes da V2 (a opção "a" de fato)

A massa gerada passou de "frase específica no motivo" para "motivo genérico + submotivo". Como o assunto continuou lendo
`reason`, o recorte já mudou sem nenhuma decisão de produto:

| Massa demo | Antes de 16/10 | Depois do ajuste, antes da V2 |
| --- | --- | --- |
| Segmentos distintos na organização | 1.074 | 213 |
| Interações com canônico | 44,5 % | 41,2 % |
| Interações que trocaram de segmento | — | **17.187 de 23.352 (74 %)** |

- O canônico agora vem do motivo. "Fatura" vira `fatura` (antes, "Segunda via de fatura" era `segunda_via`). "Cancelamento" vira
  `cancelamento` e "Plano" vira `plano`. Cobrança, Suporte técnico, Informação, Reclamação e Cadastro não têm alias e viram
  segmento bruto genérico. Exemplos: "Suporte técnico" junta 5.624 chamadas e 216 submotivos; "Cobrança" junta 2.958, das quais
  1.378 eram `contestacao`.
- **Memória do motor:** das 145 análises de chamada guardadas no dev (02 a 06/10), 27 foram feitas com o assunto `contestacao`.
  São de 26 pessoas dos Subgrupos Chat, Voz e WhatsApp e de pessoas sem Subgrupo. Essas 27 hoje caem no segmento "Cobrança".
  A comparação por assunto (memória, práticas de colegas, histórico do caminho) deixou de contá-las como contestação, embora
  `call_assessments.subject_*` continue dizendo `contestacao`.
- Uma chamada dessas analisada de novo terá outro `Assunto registrado` e, portanto, outra chave de análise. A análise é paga de
  novo, e o documento principal pode mudar (título que casa com "Cobrança" × com "Contestação").
- **Ficaram como estavam:** o Subgrupo "Diagnóstico IA", as transcrições canônicas, o lote `inia_demo_90_v1` e o cenário da Larissa
  (`scripts/dev/larissa-scenario`: `reason` "Contestação de cobrança", sem submotivo). O fingerprint `DIAGNOSTIC_DATASET_V1_1` não
  mudou.

## 3. As opções

| | (a) Só o motivo | (b) Alias casa o submotivo primeiro, depois o motivo | (c) Segmento = motivo › submotivo |
| --- | --- | --- | --- |
| Regra | como hoje | canônico = alias do `sub_reason`, senão alias do `reason`. Sem alias, o bruto é o motivo (**b1**) ou o submotivo, quando há (**b2**) | chave = `coalesce(canônico do motivo, motivo) ‖ ' › ' ‖ submotivo`; submotivo nulo = só o motivo |
| Segmentos distintos (demo) | 213 | b1: 213 · b2: 781 | 1.206 |
| Interações com canônico (demo) | 41,2 % | 57,1 % | — (o par não tem canônico sem mudar o catálogo) |
| Diferença para antes de 16/10 | 17.187 linhas | b1: 12.392 · b2: **2.941** | — |
| As 27 análises guardadas | continuam fora de `contestacao` | voltam a `contestacao` (0 divergentes, b1 e b2) | ficam em "Cobrança › …" |
| Pessoa×mês com segmento elegível (≥ 3 chamadas transcritas, massa gerada)¹ | 3,6 % | b1: 2,7 % · b2: 1,1 % | 0,2 % |
| Instalação real (catálogo vazio) | segmento = motivo | b1 = (a); b2 = submotivo | segmento = par |

¹ A massa gerada tem em média 1,8 chamadas por pessoa por mês, então só a direção desse número importa: quanto mais fino o
segmento, menos recortes atingem o mínimo de 3 chamadas (`DIAGNOSIS_MIN_SEGMENT_INTERACTIONS`) e a população mínima de 4 colegas.

### (a) Manter só o motivo

- **Código e contratos:** nada muda. Prompts, `*_VERSION`, `*-freeze.json` e o fingerprint ficam como estão.
- **Massa demo:** nada muda. Aceitar (a) é aceitar o estado da seção 2, inclusive as 27 análises fora do segmento em que foram feitas.
- **Produto:** o assunto fica genérico. O diagnóstico de TMA por assunto passa a dizer "Fatura", não "Segunda via". A comparação
  com colegas compara "Cobrança" com "Cobrança". O título do feedback vira "Fatura" ou "Cobrança".
- Se o objetivo for só a demo voltar ao comportamento anterior, o backfill tem desfazer documentado
  (`reason = sub_reason, sub_reason = null`). Mas isso tira o motivo e o submotivo da demo da liderança.

### (b) Alias casando primeiro o submotivo, depois o motivo

- **Código:** muda uma função, `canonicalSubjectSql`, que passa a ser `coalesce(alias(sub_reason), alias(reason))`. Os leitores
  (9 arquivos de `src/`) seguem sozinhos: segmentos, análise, base de conhecimento, título e Tools. `resolveCanonicalSubject` não muda.
  - Em **b1**, `subjectFilterSql` (bruto exato = `reason`) e `segmentKeySql` continuam com o texto atual.
  - Em **b2**, o bruto passa a ser `coalesce(sub_reason, reason)` no segmento, no filtro e no `subject` das Tools.
- **Sem hierarquia:** cada interação tem um código só, e o mais específico ganha. Pedir o assunto `fatura` não traz as chamadas cujo
  submotivo é `segunda_via`. Era assim antes de 16/10.
- **Prompts:** nenhum texto de instrução muda. Muda o dado `Assunto registrado` das chamadas com alias no submotivo (de "Fatura"
  para "Segunda via"), e a chave de análise dessas chamadas muda sozinha. `CALL_ANALYSIS_*` **não** deve subir de versão: a memória
  filtra por `CALL_ANALYSIS_LOGIC_VERSION`, e subir a versão descartaria todas as análises guardadas.
- **Versões que devem subir**, pela regra do projeto de que o mesmo dado com resultado diferente pede versão nova e chave nova:
  - `INDICATOR_INVESTIGATION_LOGIC_VERSION` V16 → V17 (a localização por assunto muda);
  - `DIRECT_DIAGNOSIS_LOGIC_VERSION` `INDICATOR_DIAGNOSIS_V2_0` → `V2_1`;
  - fechamento do PRV: `PRV_DIAGNOSIS_V1_0_2` está congelado (TMA entregue). Ou fica na regra do motivo, com uma função separada
    só para ele, ou sobe de versão com decisão explícita.
  - `ENGINE_INVESTIGATION_TOOLS_V4` e `FEEDBACK_HEADING_V1` ficam em b1, porque as descrições e a ordem das fontes continuam
    verdadeiras. Em b2, a descrição "bruto exato (subject)" das Tools e a fonte RECORDED do título mudam: V5 e V2.
- **`*-freeze.json` e scripts congelados:** nenhum é editado. Os manifestos das rodadas Larissa V11–V14D guardam hashes de `src/`,
  que já divergiram (34 de 55 arquivos do motor e do diagnóstico no `round-v14d`), então são registro histórico e não trava. A reprodução híbrida
  V14B–D depende de pedido idêntico byte a byte, e o cenário da Larissa não tem submotivo, então não é afetado.
- **Fingerprint e massa demo:** nada muda. O Subgrupo não tem submotivo, e os aliases da demo já são as frases que hoje estão no
  `sub_reason`. **Não** acrescentar alias para "Cobrança", "Informação" e os outros motivos sem alias: o fingerprint faz hash de
  todos os aliases da organização, e o resultado seria `DIAGNOSTIC_DATASET_V1_2`, "Dataset diferente".
- **Holdout:** o `inia_holdout_v2` não tem a coluna `sub_reason`, porque a migration 145 não foi aplicada lá. Com (b), todo leitor
  do canônico passa a exigi-la. Hoje já exigem as Tools (`interaction-tools.ts` lê `i.sub_reason`) e os outros leitores que o
  trabalho do submotivo alterou. Aplicar a 145 lá não muda o
  fingerprint do holdout, que lista as colunas. O H1 nunca é reexecutado e o H2 continua selado.
- **Risco:** o alias é por texto, sem olhar o campo. Um submotivo genérico ("Outros", "Dúvida") usado em vários motivos, com alias,
  juntaria motivos diferentes. Na demo, 0 dos 998 submotivos aparece em mais de um motivo. Em bases reais isso é provável, mas não
  foi verificado. A saída seria um alias pelo par (motivo, submotivo): coluna nova em `interaction_subject_aliases` e índice único
  novo (migration 146).

### (c) Segmento = motivo › submotivo

- **Código:** a chave muda de formato em todos os leitores da tabela da seção 1. Para o par ter canônico, o alias precisa ser pelo
  par (migration). Sem isso, "Informação › Informação sobre plano" e "Plano › Alteração de plano" deixam de ser comparáveis.
- **Contratos:**
  - `INVESTIGATION_SLICES_V1` → V2, porque o recorte "No assunto X" passa a ter "›";
  - as Tools precisam de filtro pelo par (parâmetro novo ou texto composto): `ENGINE_INVESTIGATION_TOOLS_V5`;
  - o texto do prompt do planejador do motor não precisa mudar, porque os assuntos chegam a ele como valores enumerados
    (`SUBJECT_SLICES`). Mas os valores que ele vê mudam de formato, e as Tools dos Agents recebem o assunto em texto livre;
  - `INDICATOR_INVESTIGATION_V17`, `INDICATOR_DIAGNOSIS_V2_1` e a mesma decisão do PRV congelado;
  - `FEEDBACK_HEADING_V2`;
  - os rótulos com "›" entram no texto do redator e nos validadores de rótulo de segmento.
  - Pede rodada paga de validação: o pedido muda para toda chamada com submotivo.
- **Massa demo:** nenhuma linha muda. Se o catálogo ganhar alias por par, `DEMO_SUBJECTS_V2` gera fingerprint novo, ou seja,
  `DIAGNOSTIC_DATASET_V1_2`.
- **Produto:** é o recorte mais fiel à fonte, mas é o mais fragmentado (1.206 segmentos; 0,2 % de pessoa×mês com segmento
  elegível). Ele se parece mais com uma visão de exploração, que já existe para a liderança (agrupa `reason, sub_reason` direto),
  do que com uma chave de comparação estatística.

## 4. Recomendação da análise (a decisão foi b2 com par; ver o topo)

**(b1):** o canônico casa primeiro o submotivo, depois o motivo; sem alias, o segmento fica no motivo.

- O catálogo canônico existe para tornar comparável o que a fonte escreveu de jeitos diferentes. Os aliases foram montados
  exatamente sobre as frases que hoje estão no submotivo. (b1) devolve esse papel ao catálogo, com 57,1 % de cobertura canônica
  contra 41,2 % hoje, e recoloca as 27 análises no segmento em que foram feitas.
- Sem curadoria (instalações reais, catálogo vazio), o recorte fica no motivo, que tem volume para atingir os mínimos. Ele não se
  pulveriza em centenas de submotivos.
- Nenhum texto de prompt, freeze ou script congelado muda, e o fingerprint fica igual. O custo é uma função, duas versões de lógica
  (investigação e diagnóstico direto), testes e a prova no banco de teste. Não precisa de rodada paga para validar.
- O que (b1) não resolve: o título e o `Assunto registrado` de uma chamada sem alias continuam mostrando o motivo genérico. Mostrar
  "Fatura › Segunda via" no título é uma mudança à parte (`FEEDBACK_HEADING_V2`, só de apresentação), e mandar motivo e submotivo
  separados ao prompt da análise seria versão nova de prompt e rodada paga. As duas ficam como pergunta.

(c) não é recomendada como chave de comparação. Ela serve como visão de exploração, que a liderança já tem.

## 5. Perguntas para decisão (respondidas acima)

1. **Qual nível de assunto é o certo para comparar desempenho:** o mais específico que o catálogo reconhece, com (b), ou só o motivo
   genérico, com (a)?
2. **Sem alias no catálogo, o segmento cai no motivo (b1, recomendado) ou no submotivo (b2)?** b2 é mais fiel, porém muito mais
   fragmentado, e muda descrição de Tool e título (V5/V2).
3. **O fechamento do PRV de TMA (congelado, `PRV_DIAGNOSIS_V1_0_2`) segue a regra nova ou fica no motivo?** Ficar no motivo significa
   que o fechamento e o diagnóstico direto passam a segmentar de jeitos diferentes.
4. **O alias pelo par (motivo, submotivo), com migration 146, entra agora ou só quando uma base real mostrar submotivos genéricos
   repetidos entre motivos?**
5. **O título do feedback deve mostrar "Motivo › Submotivo" quando não houver canônico** (`FEEDBACK_HEADING_V2`, só de
   apresentação)?
6. **Aplicar a migration 145 no `inia_holdout_v2`?** Só é necessário se algum caminho do holdout voltar a rodar com o código atual;
   não altera o fingerprint dele.
