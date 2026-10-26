# Motor de feedback — FEEDBACK_ENGINE_V1

Data: 30/09/2026 (correção do diagnóstico, ferramentas e composição no fim do dia — sem migration) · migration `102_feedback_engine_memory.sql` · módulo `backend/src/modules/feedback-engine`.

## O problema que o motor resolve

O feedback antigo era **seguro, mas pouco útil**: validava que a citação existia e que o texto não inventava, mas não garantia
que a INIA tinha escolhido o procedimento certo para o cenário, percebido o pré-requisito pulado ou dado uma orientação que
ajudasse naquele momento da chamada. Em indicadores, repetia o número ("seu TMA foi 420, a meta é 400; atenda mais rápido").
Além disso, dependia de uma fila de QA humano (HOLD_FOR_QA) e de aprovação de checkpoints para funcionar.

O motor faz o caminho inverso: primeiro **diagnostica** (cenário → procedimento completo → caminho correto × caminho seguido →
desvios e acertos com evidência por turno), grava esse diagnóstico como **memória operacional**, e só então **comunica** —
reconhecimento quando está certo, ajuste com orientação específica quando não está, abstenção com motivo quando não há nada
material ou a evidência não sustenta.

## Fluxo no Workflow (nenhuma configuração nova)

```
Gatilho → Chamar agente / Orquestrador → Gerar feedback → [Revisão humana, se o grafo tiver] → Output → Fim
```

| Nó | O que faz agora |
|---|---|
| Chamar agente (Avaliação de processo, gatilho por Flag) | `analyzeCall`: análise da chamada pelo motor, com as bases do especialista; saída `FEEDBACK_ENGINE_CALL_ANALYSIS` (referência à análise gravada). |
| Chamar agente (Diagnóstico do indicador / fechamento PRV / fechamento oficial) | `investigateIndicator`: investigação do indicador; saída `FEEDBACK_ENGINE_INDICATOR_ANALYSIS`. |
| Orquestrador com especialista em Avaliação de processo | o especialista usa a mesma `analyzeCall` (hook `analyzeCall` em `run-specialist-tool`). |
| Chamar agente (outros formatos) | inalterado (`runAgent`). |
| Gerar feedback | `generateFeedback`: reaproveita a análise da origem ou analisa agora (origem antiga), monta o brief, compõe e verifica. `PUBLISHABLE` → segue para o Output com `FEEDBACK_ENGINE_MESSAGE`; `ABSTAINED` → a execução termina com o motivo (sem Output). **Nunca espera QA.** |
| Output FOLLOW_UP → O próprio operador | publica no Acompanhamento (caso + evidência + feedback + materiais + timeline, numa transação; emissão idempotente com `engine_message_id`). |
| Output CHAT/AVATAR | mesma projeção (`FEEDBACK_VIEW`) das entregas conversacionais. |

Os grafos, gatilhos, agendas, públicos, decisões do motor de Workflow e configurações de Output **não mudaram**. A validação de
publicação deixou de exigir o módulo de feedback confiável ligado (a flag só controla as telas de QA legadas).

## Análise de chamada (`analyze-call.ts`, `domain/call-analysis*.ts`)

1. **Contexto completo do procedimento** (`procedure.ts`): todas as seções dos documentos autorizados, com handles `D-n/S-n/L-n`,
   listas e enumerações em linha viram itens. V7: TODA linha recebe handle — o papel da seção pelo título (objetivo, conceitos,
   exemplos…) vira só PISTA no texto ("o título sugere… — confirme pela leitura"); quem decide se uma linha é exigência é a leitura.
   Documentos escolhidos por âncora do assunto + relevância, com orçamento de 90 mil caracteres (omitidos ficam registrados).
   Argumentários vigentes no escopo do colaborador entram como fonte estruturada `G-n` (ver "Argumentários").
2. **Análise** (uma chamada; gemini-3.8-flash, rota fixa, Use Case `FEEDBACK_ANALYSIS`) devolve cenário, caminho correto ×
   seguido, disposição por critério (MET, NOT_MET, PARTIAL, NOT_OBSERVABLE, NOT_APPLICABLE, NOT_A_REQUIREMENT), evidência por
   turno/falante, orientação (momento, condição, ação) e materialidade; itens irrelevantes podem ser dispostos em grupo. Tudo
   isso é **PROPOSTA**.
3. **Integridade por código** (sem LLM): citação literal no turno e no falante; conduta só com fala do operador; "vou enviar" é
   intenção (nunca execução); omissão só com transcrição completa e oportunidade real; "não se aplica" exige a condição; regra em
   conflito entre fontes nunca vira acusação. Integridade prova que a citação EXISTE — nunca que a leitura está certa.
4. **Revisão independente da interpretação** (`CALL_ANALYSIS_LOGIC_V4`, `domain/call-review.ts`, uma chamada por chamada
   analisada, etapa `CALL_REVIEW`): recebe a transcrição INTEIRA e só as propostas que contam (acertos, desvios, parciais e o
   caminho), cada uma com a regra completa — a frase que abre a lista, os outros itens da MESMA lista com o status proposto, se a
   regra é condicional — e um foco calculado por código (`OMISSION`, `CONDITIONAL_RULE`, `LIST_ITEM_WITH_MET_SIBLING`,
   `SAME_EVIDENCE_AS_SIBLING`, `DECLARED_ACTION`, `COMPLIANCE_BY_ABSENCE`). Os turnos do operador que tratam do mesmo conteúdo
   vão como "olhe aqui" (`lookAt`), nunca como decisão. A revisora devolve, por proposta, CONFIRMED | REFUTED | UNCERTAIN, os
   problemas (ação encontrada na chamada, condição não evidenciada, alternativa cumprida, sem oportunidade real, ação só
   declarada/interna, outra leitura da regra, transcrição insuficiente…) e a leitura da lista (ALTERNATIVES, CUMULATIVE,
   SEQUENCE, NOT_A_LIST, UNCLEAR). A mesma chamada também responde as linhas obrigatórias que a análise deixou sem disposição
   (substitui o antigo "reparo de cobertura"); linha respondida só pela revisão nunca é confirmada (`SINGLE_PASS_REPAIR`).
   O pedido de cobertura é PROPORCIONAL (`COVERAGE_REQUEST_V1`, `linesToAssessOf`): até 40 linhas por chamada, primeiro as das
   seções de encerramento, depois as das seções em que a análise decidiu alguma etapa, depois o resto na ordem do documento; com
   linhas pedidas o schema exige a resposta delas. Pedido ≠ resposta: linha ou descarte pedido e não respondido fica registrado
   (`checks.review.coverage {requested, answered, unanswered, withheld}`, `exclusions {sent, answered, …}` e nota de auditoria) —
   nunca contado como "revisado".
   **Descartes em jogo (`CALL_REVIEW_V2`, `CALL_ANALYSIS_LOGIC_V5`).** A mesma chamada recebe os itens que a análise descartou
   (não se aplica, não observável, não é exigência) nas seções EM JOGO (caminho, encerramento, seções com etapa decidida; até 80,
   primeiro os de justificativa de GRUPO que atravessa seções) e o cenário que a análise descreveu (necessidade, condições com os
   turnos, caminho). A revisora só CONTESTA quando o descarte contradiz o cenário, distinguindo executar ação interna (a conversa
   pode não mostrar — nunca "não cumprida" por silêncio), declarar, comunicar ao cliente (observável) e o que não dá para concluir.
   O código decide (`decideExclusionChallenge`): contestação sem fala verificada → ignorada; "não dá para concluir"/ação interna →
   REABERTO como incerto (vai ao redator como ponto em aberto, nunca acusação); cumprido/não cumprido → exige integridade (fala do
   operador ou omissão estruturalmente válida) E convergência com o que a ANÁLISE já tinha estabelecido (a fala da condição é de um
   turno que ela registrou como condição do cenário; ou a lista foi decidida por ela e é lida como cumulativa) → reversão
   confirmada; senão hipótese (fora das contagens e da mensagem). A análise passou a declarar `itemNature` (ação interna,
   comunicar, perguntar, proibição) e `scenarioRole` (central, apoio, rotina — leitura que só ORDENA o que vai ao redator); ação
   interna proposta como omissão é rebaixada a não observável pelo código. Notas técnicas da revisão (contagens, revisão
   indisponível…) ficam em `auditNotes`, fora das limitações que o colaborador lê.
   **Aberturas de lista (`CALL_REVIEW_V3`, `LIST_OPENING_V1`, `CALL_ANALYSIS_LOGIC_V6`, prompt da análise V4).** A frase que ABRE
   uma lista ("Antes de encerrar, informar:", "Quando o cliente já tiver pago…, avaliar:") não é critério sozinho; a análise deve
   dispor cada item. Quando ela dá a conclusão à abertura mesmo assim (`listOpeningsOf`): a proposta vai à revisão com os ITENS da
   lista (os não avaliados aparecem como tal, foco `LIST_OPENING`) e só é confirmada com a lista lida como lista
   (`LIST_OPENING_NOT_READ_AS_LIST`); "parcial" numa lista de alternativas nunca é confirmado (`LIST_OPENING_ALTERNATIVES`); os
   itens englobados viram alvos próprios da mesma revisão (`AGGREGATED`, com a conclusão dada à abertura), pelas mesmas regras de
   contestação; lista dada como cumprida com um item confirmado como não cumprido perde a conclusão agregada
   (`AGGREGATE_CONTRADICTED_BY_ITEM`). Origem: a rodada real da C07 de 01/10 à tarde (ver "Validação com análise inicial nova").
5. **Decisão por código** (`decideConfirmation`): confirmação só quando a revisão confirma SEM problema bloqueante e sem
   contraprova; refutação com fala do operador que cumpre a etapa → REFUTED; lista de ALTERNATIVAS com irmão cumprido → REFUTED
   (`ALTERNATIVE_SATISFIED`); desvio em regra condicional exige evidência VERIFICADA da condição; desvio num item de lista com
   irmão cumprido (ou com a mesma fala do irmão) só fica de pé com leitura CUMULATIVE/SEQUENCE — a regra V3
   `SAME_EVIDENCE_PROVES_SIBLING` deixou de esconder a falha legítima de uma lista cumulativa e virou foco da revisão. Não
   confirmado = "não foi possível observar" com o motivo (`downgrades` = `UNCONFIRMED:…`/`REFUTED:…`); a proposta continua na
   auditoria (`declaredStatus`, `proposedStatus`, `confirmation`, `review`). Revisão indisponível = NADA confirmado — nunca
   "aceita por padrão" — e também nada GRAVADO como resultado (ver "Recuperação da revisão").
6. **Desfecho** (só com a revisão concluída ou desnecessária): USABLE | PARTIAL | INSUFFICIENT_EVIDENCE (sem transcrição, sem
   procedimento aplicável — insuficiência REAL —, nenhuma conclusão confirmada depois da revisão — `NO_CONFIRMED_FINDING`,
   inconclusiva). Conclusão não confirmada não alimenta contagem, reconhecimento nem orientação.

### Aplicabilidade × evidência × cumprimento (`SEMANTIC_AUDITABILITY_V1`, `CALL_ANALYSIS_LOGIC_V7`, prompt V5, revisão V4)

Princípio: **a fonte define a obrigação; a evidência disponível define o que pode ser comprovado.** Para cada exigência a análise
responde QUATRO perguntas separadas, pela leitura da regra completa e da conversa inteira — nunca pelo verbo, por palavra-chave ou
pelo nome de um sistema (a mesma regra escrita de outro jeito, ou citando outro sistema, tem de dar a mesma conclusão):

1. que ação o processo exige neste cenário (`requiredAction`);
2. a regra vale para esta conversa (`applicability` APPLIES | DOES_NOT_APPLY | UNCERTAIN, com `condition` e as falas em
   `applicabilityEvidence`);
3. que evidência permitiria verificar e se ela está disponível (`observability` IN_CONVERSATION | OUTSIDE_CONVERSATION,
   `evidenceNeeded`; disponível hoje = só a transcrição — registros operacionais de sistemas NÃO estão integrados, registrado em
   `evidenceAvailability`);
4. o que a evidência sustenta (status).

O CÓDIGO não interpreta nada disso (`assessUnit` em `call-analysis.ts`): aplica as consequências lógicas da leitura e as
checagens objetivas de integridade. Aplicabilidade incerta nunca vira "não cumpriu" nem "não se aplica" (= não observável);
"não se aplica" exige a leitura de inaplicabilidade e o motivo; regra que não se aplica não gera acerto nem desvio; cumprimento
FORA da conversa (sistema/registro de qualquer nome) nunca vira cumprido nem descumprido pela transcrição — a fala só registra a
DECLARAÇÃO ("já consultei", `executionClaim: DECLARED`) ou a INTENÇÃO ("vou consultar", `INTENDED`); na conversa continuam as
checagens de sempre (fala do operador, intenção ≠ execução, omissão com transcrição completa e oportunidade). Leitura ausente
(respostas anteriores ao V5) deriva só do que o próprio modelo disse (status, natureza) — nunca do texto da regra.

**Regra composta.** Uma linha que pede mais de uma ação ("consulte o sistema, verifique o bloqueio e informe a situação ao cliente")
é avaliada por PARTE (`obligations`): cada parte é um trecho LITERAL da linha (conferido pelo código; parte inventada é recusada),
com a evidência da sua natureza, e vira um critério próprio (`L12.1`, `L12.2`…) com identidade própria na memória
(`obligationCriterionKeyOf`: mesma família KC/AG da linha + texto da parte). A consulta não observável não torna a regra
descumprida; a comunicação feita não a torna inteira cumprida. O brief leva a parte como título e a regra literal inteira como fonte.

**Heurísticas revistas.** A condição de uma regra deixou de ser detectada por palavras ("quando/se/caso/exceto" — `ruleIsConditional`
removido): vale a condição LIDA pela análise (`condition`) ou pelo cadastro do argumentário (situação), e a revisora lê a regra de
qualquer jeito (`CONDITION_NOT_ESTABLISHED`). O título da seção virou pista (toda linha tem handle). A oportunidade de uma omissão
de encerramento deixou de ser preenchida pelo código com o último turno: vem da leitura (sem ela, `OMISSION_WITHOUT_OPPORTUNITY`).
Continuam: integridade de citação (turno, falante, literal), completude da transcrição, abertura de lista com os itens à vista
(estrutura do documento), pedido de cobertura por seções de encerramento (só PEDE disposição, nunca conclui) e o "olhe aqui"
(`lookAt`) da revisão (só atenção).

**No redator.** Execução fora da conversa nunca chega ao redator: vira LIMITE DE COBERTURA (`brief.coverageLimits`, auditoria) —
sem "se você ainda não corrigiu, lembre-se…" — e, quando é central no caso, uma nota neutra ao colaborador ("O que é feito em
sistemas, fora da conversa, não aparece na gravação e não foi avaliado neste retorno."). Ponto em aberto (O-n) só de etapa DA
CONVERSA ligada ao caso por fala verificada, apresentado como "não é falha nem acerto"; composição V7 / verificação V6 tratam
lembrete que insinua falha não comprovada e ação de sistema apresentada como feita/não feita como OVERREACH. Na liderança, "fora da
conversa" é uma fatia das inconclusivas (`Stats.outsideConversation`), fora do denominador.

Custo proporcional: **duas** chamadas por chamada analisada (análise + revisão; o reparo de cobertura antigo foi absorvido pela
revisão), não uma por critério. A resposta crua da análise e da revisão fica na proveniência (`modelResponses`, até 60 mil
caracteres cada) — permite replay e retomada sem nova chamada.

### Recuperação da revisão (`CALL_ANALYSIS_CHECKPOINT_V1`, `domain/analysis-recovery.ts`)

Defeito corrigido: análise ok → revisão com timeout (inclusive a nova tentativa) → a execução era CONCLUÍDA como
`INSUFFICIENT_EVIDENCE/REVIEW_UNAVAILABLE` e a execução seguinte, com o provedor recuperado, REUTILIZAVA esse inconclusivo.

Quatro estados que não se confundem: insuficiência REAL (concluída, reutilizável, sem retentativa); inconclusiva APÓS revisão
(concluída — é uma resposta); revisão PENDENTE por falha técnica; INTERROMPIDA pelo orçamento. Nos dois últimos a execução fica
**suspensa** (`feedback_analysis_runs.status = FAILED` + `result.checkpoint` com a chave da proposta, o motivo `TECHNICAL | BUDGET
| CONTRACT` e as tentativas; a proveniência guarda a resposta da análise) e **nada vai para a memória** — nem acerto, nem desvio,
nem "inconclusiva": a investigação e a liderança não veem a chamada até a revisão acontecer (`pendingReviewInteractions` a
identifica).

Compatibilidade POR ETAPA (sem migration): chave da **proposta** = versão do contrato da análise + extração dos critérios + o que
o analisador VIU (transcrição, bases com versão/hash, configuração do especialista, contexto da chamada — sem o motivo de seleção,
que não é evidência); chave da **execução** = proposta + lógica de verificação + contrato da revisão. Retomada (`analyzeCall`):
a resposta de análise já paga com a mesma chave de proposta é reaproveitada (a análise NÃO é paga de novo); a revisão já paga com
o MESMO pedido também; mudou só a lógica/contrato da revisão → só a revisão é refeita; mudou transcrição, base, especialista ou
contexto → a proposta antiga não vale e tudo é refeito. Execuções gravadas ANTES desta correção como concluídas com
`REVIEW_UNAVAILABLE` são tratadas como pendentes: as propostas delas são reaproveitadas (chave antiga reconhecida), a mensagem
abstida por esse motivo não prende a matrícula, e elas ficam fora das agregações da liderança (`reviewSettledSql`) até serem
substituídas.

Erros e política: revisão TÉCNICA pendente → `FEEDBACK_CALL_REVIEW_PENDING` (transitório: o motor do Workflow tenta de novo com
intervalo e limite, `node-retry-policy.ts`, 5 tentativas a cada 5 min; cada execução tenta a revisão uma vez, mais a nova
tentativa transitória do medidor — sem laço); ORÇAMENTO → o erro de orçamento (outra execução, com orçamento, retoma);
resposta fora do CONTRATO → `FEEDBACK_CALL_REVIEW_INVALID` (encerra a execução sem nova tentativa automática; uma execução futura
pode retomar). Concorrência: a retomada usa a MESMA posse atômica (`claimAnalysis`) — duas retomadas nunca pagam a mesma revisão;
mensagem e entrega continuam idempotentes pela chave da mensagem. Investigação que pediu uma análise que ficou pendente por falha
técnica não fecha com essa lacuna (`FEEDBACK_INVESTIGATION_ANALYSIS_PENDING`, transitório): na nova tentativa, as análises
prontas vêm da memória e a pendente retoma só a revisão.

## Critérios da base — identidade automática, sem aprovação

Cada linha executável publicada vira um critério com chave `KC-<hash>` estável enquanto a regra não muda. **A frase que abre a
lista faz parte da regra** (`KNOWLEDGE_CRITERIA_V3`): "- Estorno;" sob "Quando o cliente já tiver pago, avaliar:" é outra regra
que "- Estorno;" sob "Antes de encerrar, informar:" — a abertura entra na chave da linha e no texto EFETIVO da regra
(`effectiveRuleText`: abertura numa linha, item na seguinte), e mudar só a abertura muda a identidade (`LIST_CONTEXT`). Limites
máximo × mínimo × exato são distintos ("em até 5 dias" ≠ "no mínimo 5 dias", `BOUND`); nenhuma palavra é truncada (flexão só
por sufixo com radical de 4+ letras); contrações viram preposição e só artigos são descartados ("antes do envio" mantém o papel).
Ao publicar nova versão, a reconciliação (`criteria-identity.ts`, desde 05/10/2026) só olha a CHAVE da linha (formatação
normalizada): **linha igual** herda a identidade; **qualquer outro texto** é identidade própria. A V3 decidia "equivalente /
modificada" por listas de palavras (negação, "deve/pode", "se/quando", canais, prazos, terminações de verbo) — não era leitura de
sentido, errava com sinônimo ("informar" × "comunicar") e duplicava o Diagnóstico com uma correção de digitação ou uma seção
renumerada; saiu (com o script `criteria-identity-audit.ts`). Se duas redações pedem a mesma conduta, quem diz é a **prática**
(próxima seção). Identidades antigas (EQUIVALENT_PREVIOUS / MODIFIED / SOURCE_SPECIFIC) ficam no histórico. Quando a MESMA versão
da base é extraída de novo por uma lógica nova, o resumo registra a correspondência por posição (`summary.extractionRevision`:
`SAME_TEXT` ou `TEXT_CHANGED`), sem herdar a identidade. **Ninguém aprova critério.** O "Registro de
checkpoints" antigo continua acessível como histórico e não influencia nenhum feedback.

## Práticas da operação (`PRACTICE_IDENTITY_V1`, migration 109) — a unidade do Diagnóstico e da reincidência

Uma **prática** é UMA conduta esperada do operador numa situação ("Informar o prazo da análise da contestação"). A mesma conduta
aparece em várias regras — outra seção, outro documento, checklist ("Forneci prazo?"), argumentário, versão nova do texto. Cada
uma continua sendo uma regra avaliada (`call_criterion_assessments` não muda); a prática as junta para:

- o **Diagnóstico** mostrar um ponto por conduta, com as fontes ("Pontos do processo"), em vez da mesma coisa escrita de vários jeitos;
- o **feedback** contar reincidência, firmeza e orientação anterior pela conduta (rodada V14: "35. Prazo da análise" em duas
  linhas da mesma seção dava 2 de 2 + 2 de 2 e o padrão de 4 de 4 nunca apareceu);
- o **histórico** atravessar edições da base (digitação, sinônimo, seção renumerada não criam outro ponto).

**Quem decide é a leitura do modelo** (etapa `PRACTICE_IDENTITY`, Use Case FEEDBACK_ANALYSIS, gemini-3.8-flash): recebe as práticas
já conhecidas (P-n, título + até duas regras de exemplo) e as regras a organizar (R-n: fonte, seção, abertura da lista, itens que a
regra abre) e escolhe, numa **lista fechada** (enum dinâmico no esquema), prática existente, prática nova (N-n, com título) ou NONE
(a regra não pede conduta). O código só confere a forma — cada regra uma vez, código existente, nova com título — e registra; nunca
junta nem separa por palavra; na dúvida o modelo separa. O que não passa fica sem prática e volta na próxima vez. Ninguém aprova.

- **Quando**: na análise de chamada, depois da revisão, só para as **linhas-âncora das regras avaliadas** que ainda não têm decisão
  (uma vez por linha; texto igual em outra versão mantém a chave e a decisão). Organizar o documento inteiro custaria centenas de
  linhas nunca cobradas (dev: 7.888 linhas × 78 âncoras avaliadas). Produção liga (`createEngineDeps`, `organizePractices`);
  sem orçamento, falha do provedor ou resposta fora do contrato, a análise segue e as linhas ficam com a própria identidade.
- **Memória**: `knowledge_practices` (KP-…, título = rótulo, nunca evidência) e `knowledge_practice_members` (linha → prática;
  `practice_key` null = NO_CONDUCT). A leitura da memória (`currentMemory`) e o Diagnóstico resolvem a prática pela linha-âncora
  (`split_part(lineKey,'#',1)`); sem decisão, a chave da linha (como antes). Retorno entregue antes da organização (chave `KC-<linha>`)
  conta para a prática da linha (orientação anterior / INSIST).
- **Feedback**: monitoria junta num ponto as regras da MESMA prática julgadas na chamada (composição V13); indicador agrega padrões,
  referência dos colegas e confirmação de padrão pela prática (investigação V13) e entrega ao redator o título da prática + as regras
  literais (`memberRules`); "regra em vigor" vale quando alguma linha atual do documento pertence à prática.
- **Diagnóstico**: aba "Pontos do processo" agrupada por TEMA (abaixo); cada ponto = uma prática (nome curto, conduta completa, fontes
  documento · seção / argumentário, quantas regras reúne), ordem "Onde mais se erra" × "Onde mais se acerta", drill por prática;
  "Pessoas e equipes" lista os principais desvios por prática; "Materiais" mostra os pontos e as SEÇÕES mais indicadas por documento.
  Ponto ainda não organizado aparece pela ação exigida que a análise leu (`verification.requiredAction`) ou pela 1ª linha da regra —
  nunca pelo texto inteiro de várias linhas.
- **Obrigação que começa pela abertura de uma lista** ("É proibido:", "Antes de transferir:"): a abertura não pede conduta (NONE); a
  memória guarda as linhas da obrigação (`verification.sourceLineKeys`) e a prática dela é a da PRIMEIRA linha que pede conduta
  (`practiceOfRowSql`).
- **Obrigação COMPOSTA** (prompt `PRACTICE_IDENTITY_PROMPT_V2`): obrigação de várias linhas (chave com '#') em que nenhuma linha pede
  conduta sozinha — típico das análises antigas, que juntavam abertura, itens de checklist e frases a evitar numa obrigação só e não
  guardavam as linhas de origem. Ela vai ao modelo inteira (`severalLines: true`) e é organizada pela chave da obrigação: prática
  existente só quando a obrigação inteira pede aquela conduta; senão uma prática nova que nomeia o conjunto. É a ÚLTIMA candidata em
  `practiceOfRowSql` (`MemoryCriterionRow.obligationLineKey`). Sem isso a leitura ficava sem ponto e o Diagnóstico mostrava o texto
  cru das linhas ("Antes de encerrar, o operador deve resumir… - “Mais alguma coisa?”, em tom apressado. (1) confirme…").
- **Lotes**: 40 regras por pedido; saída da etapa até 32.768 tokens (o raciocínio contra o catálogo gasta a maior parte). Falha
  registra o motivo (`failure`: erro, término, tokens, tamanho) — nunca o texto.
- **Carga do que já foi avaliado**: `npx tsx scripts/feedback-engine/sync-practices.ts --organization <uuid>` (dry-run; `--execute
  --max-requests N [--raw-out arquivo-fora-do-repo]` consome IA). Dev (05/10, autorizado): 78 linhas → 54 práticas (13 sem conduta),
  92% das leituras com prática; pedidos: 1º com 120 regras cortado (JSON inválido), 2º lote de 40 ok, 3º cortado por raciocínio
  (MAX_TOKENS com 1.369 de saída) → teto 32 mil → ok. Diagnóstico do dev: 24 pontos com título de conduta (antes 26 blocos de texto).
- Provas: `practice-identity.test.ts` (contrato, nenhum agrupamento por texto, uma vez por linha, falha não derruba, sobreposição,
  padrão 4 de 4, orientação antiga), `practice-themes.test.ts` (temas, obrigação composta), prova de banco caso N (duas regras de
  documentos diferentes = um ponto, drill, memória, orientação KC-, obrigação composta, tema), `diagnostics-page.test.tsx`.

### Temas dos pontos (`PRACTICE_THEMES_V1`, migration 110) — como a liderança lê

Uma operação tem dezenas de práticas; numa lista única o Diagnóstico vira um mural de frases longas. O **tema** é o momento ou o
assunto do atendimento em que um grupo de práticas acontece ("Encerramento do atendimento", "Abertura e validação cadastral") e cada
prática ganha um **nome curto** para a lista ("Recapitulação obrigatória antes do término"); o título da conduta vira a descrição.

- **Quem decide é a leitura do modelo** (etapa `PRACTICE_THEMES`, Use Case FEEDBACK_ANALYSIS, gemini-3.8-flash): recebe os temas
  conhecidos (T-n, com até 8 pontos já agrupados) e as práticas a agrupar (P-n: conduta + até duas regras) e escolhe numa lista
  fechada tema existente ou novo (N-n, com nome); escreve o nome curto (até 60 caracteres). Nenhum tema fixo no código nem no prompt —
  os temas são dados da organização. O código só confere a forma; nome curto vazio ou longo demais NÃO é cortado: a prática fica sem
  tema e volta. Uma vez por prática; ninguém aprova. Tema é agrupamento de LEITURA: reincidência, firmeza e padrões continuam pela
  prática.
- **Quando**: a mesma análise de chamada, depois de organizar as linhas e as obrigações compostas, agrupa as práticas DELA que ainda
  não têm tema (`organizePracticesOfAnalysis`; normalmente nenhum pedido). Lotes de 60; saída até 32.768 tokens.
- **Memória**: `knowledge_practice_themes` (KT-…) + `knowledge_practices.short_title/theme_key/themed_at` (os três juntos).
- **Tela — visões que se COMBINAM** (clicar soma ou tira; sempre fica uma): erra + acerta = uma lista só com todos os pontos e
  desvios × acertos lado a lado (`order` ALL — todo ponto avaliado tem um ou outro); Gráficos somado a uma visão mostra só aqueles
  pontos, acima da lista; sozinho, todos. Materiais: "Por documento" + "Gráficos" juntos mostram os dois.
- **As visões** (`order` = DEVIATIONS | MET | ALL): "Onde mais se erra" lista SÓ os
  pontos com desvio (temas e pontos pelos desvios; resumo e colunas de desvio); "Onde mais se acerta" SÓ os pontos com acerto (pelos
  acertos, taxa de acerto, pessoas que acertaram; "Ver chamadas" já abre nos acertos); "Gráficos" pede TODOS. Tema sem ponto na visão
  sai; as contagens do tema são do tema inteiro ("2 de 5 pontos com desvio"). Pontos sem tema ficam em "Ainda sem tema", por último.
  A API `/memory/processes` devolve `{ order, totalPoints, listedPoints, themes[{ …stats, peopleWithMet, items[] }] }` (sem
  paginação); o CSV segue a visão e tem as colunas Tema e Conduta.
- **Gráficos** (shadcn/Recharts, `components/diagnostics/outcome-charts.tsx`): acertos × desvios por tema e por ponto (barras
  horizontais empilhadas a partir da mesma base, desvios primeiro; altura cresce com as linhas; clicar abre as chamadas) e "Onde agir
  primeiro" (avaliações × taxa de desvio, linha com a taxa do recorte; pontos com os mesmos números viram um marcador só e a dica lista
  todos). Cores por trabalho, validadas com o script do guia de dataviz nos dois temas: desvio = vermelho de alerta `#d03b3b`, acerto =
  roxo da marca `#b266d9` (CVD ΔE 22); quantidade neutra (pontos, indicações) = azul. Vermelho × verde reprovou (ΔE 4,1 em
  deuteranopia). Cada gráfico tem a legenda acessível com todos os valores (figcaption) e as listas são a tabela dele.
- **"Ver chamadas" = revisão do recorte** (`components/diagnostics/calls-review.tsx`, diálogo largo de duas colunas; tela cheia no
  celular): cabeçalho com o que é o recorte (ponto + tema + conduta, documento, pessoa, equipe ou assunto) e os números (desvios com
  taxa, acertos, avaliações, chamadas, pessoas, barra desvio × acerto); à esquerda "Quem mais erra" (no recorte de uma pessoa, "Onde
  mais erra" por ponto) — clicar filtra —, as situações com contagem (Desvios · Acertos · Sem conclusão · Todas) e a lista (pessoa,
  data, assunto, o que aconteceu, a fala literal); à direita a chamada escolhida com o ponto em destaque ("Neste ponto": o que
  aconteceu → fala → orientação → regra e documento), o cenário, os outros pontos e a transcrição — sem empilhar painéis.
  `/memory/assessments` passou a trazer `evidence` (até 2 falas) e `section`. O antigo painel lateral saiu.
- **Materiais** (mesmo desenho): um documento (o processo) por linha — avaliações que sustentou em quantas chamadas, desvios, acertos,
  indicações no feedback — que abre nos ITENS que mais aparecem: as seções, das mais avaliadas para as menos (oito e "mostrar todas"),
  cada uma com os pontos avaliados nela. Visão "Gráficos": avaliações por documento, indicações no feedback (estado vazio honesto quando
  não há — o dev não tem nenhuma) e as 12 seções mais avaliadas. `/memory/materials` ganhou as contagens do documento e
  `sections[{ section, assessed, met, deviations, recommended, points[] }]`; o CSV virou uma linha por seção.
- **Carga do dev (05/10, autorizada)**: `sync-practices.ts` em três passos — linhas (procuradas em TODAS as versões dos documentos:
  4 âncoras antigas estavam noutro documento que não o da avaliação), obrigações compostas (27 → 20 em práticas existentes, 7 novas),
  temas (63 práticas → 9 temas). 4 pedidos, todos válidos; o script não registra uso (sem runtime de IA) — estimado < US$ 0,15 pela
  tabela de preços. Diagnóstico do dev (jun–out): 8 temas · 22 pontos; nenhum ponto sem tema; a obrigação longa do encerramento entrou
  em "Recapitulação obrigatória antes do término".

## Argumentários (migration 105, `modules/argument-scripts`) — evolução das "Regras de chamada"

Cadastro em Administração › Argumentários (`/admin/argument-scripts`; `/admin/call-rules` redireciona). Um argumentário tem nome,
**área responsável** (domínio de negócio — dono do conteúdo, não filtro), **escopo de aplicação** (todos os grupos | um Grupo e
seus Subgrupos | um Subgrupo), status (ativo/encerrado), **versões** (rascunho → publicada → substituída) e **vigência**
`[início, fim)`. Campos e o que significam para o motor (`ARGUMENT_SCRIPT_CONTENT_V1`):

| Campo | Significado | No motor |
|---|---|---|
| Condição ou gatilho | situação a reconhecer na conversa inteira (dívida atual ≠ já paga ≠ contestação ≠ menção antiga; correção posterior conta) | `argumentScripts[].applicability` lida pelo modelo; "se aplica" só com fala verificada (senão incerto) |
| Quando não se aplica | exceção explícita | parte da leitura da situação |
| Orientação ao operador | o que DEVE (MUST) ou PODE (MAY) ser feito | linhas avaliáveis; "pode" não feito nunca é desvio (sai da cobertura) |
| Pontos obrigatórios na fala | conteúdo a comunicar; grupos "todos" (cumulativo) ou "alternativas — basta uma"; item com condição própria | "todos" = um critério por item, leitura de lista DECLARADA; alternativas = UM critério ("pelo menos uma destas…"); paráfrase cumpre |
| Condutas ou promessas a evitar | conduta observável a evitar | critério; explicação condicional ≠ promessa |
| Argumentário sugerido | EXEMPLO de abordagem | só contexto do analista; nunca critério, nunca comparado, nunca vai à revisão nem ao redator |
| Referência para a monitoria | ajuda a reconhecer a evidência | só contexto; não é regra a mais |
| Procedimento/fonte de origem | documento da base e referência livre | rastreabilidade (e material, quando é documento da base) |

Regras aplicadas por código: (1) **permissão** = `configuration.manage` com o escopo das atribuições — administrar exige que o escopo
do usuário cubra o do argumentário, "todos os grupos" só para quem administra a organização inteira (o backend recusa, não só a
tela); argumentário de cima que vale para o escopo do usuário aparece somente leitura; (2) **versão publicada é imutável** (gatilho
no banco); escopo só muda antes da primeira publicação; (3) **vigência nunca retroativa** (início ≥ publicação, tolerância de 5 min)
e a anterior termina quando a nova começa; **encerrar** = deixa de valer agora (chamadas anteriores continuam com a versão da época);
**reativar** = nova versão a partir de agora; nada publicado é apagado (só rascunho nunca publicado); auditoria `ARGUMENT_SCRIPT_*`
em `audit_logs`; (4) o motor usa só a versão **vigente na data da chamada** no **escopo do colaborador** (`loadArgumentScriptsInForce`)
— regra publicada depois nunca é obrigação histórica; a mesma versão vale para análise, revisão e composição e entra na chave da
análise; (5) argumentário **complementa** o procedimento (não muda prazo, alçada, elegibilidade): contradição vira `sourceConflicts`
(nunca acusa); (6) **duplicidade**: item com o mesmo texto de uma linha de documento apresentado não ganha handle (avaliado uma vez,
`context.duplicates` com as duas origens); a mesma exigência com outras palavras é apontada pela leitura (`duplicates`) e avaliada só
na linha do procedimento; (7) identidade na memória `AG-<hash>` de argumentário + item + campo + modo + modalidade + condição +
texto (sentido mudou = critério novo, o anterior registrado como `MODIFIED`); (8) orçamento de 30 mil caracteres no prompt
(o que não couber fica em `omittedArgumentScripts`).

**Cadastro antigo.** `call_expectations` não foi apagada nem alterada. Cada linha virou um argumentário `LEGACY_UNSTRUCTURED` com o
mesmo escopo, assunto e estado (inativo = encerrado com fim de vigência), o texto preservado em `legacyExpectation` e uma orientação
SEM classificação de obrigatoriedade. **Nenhuma linha pôde ser convertida automaticamente em gatilho/pontos obrigatórios sem mudar
o significado** (é uma frase livre, sem situação nem classificação): o motor NÃO cria critério a partir dela até o administrador
estruturar os campos (no dev: 1 linha — "Informar o número do protocolo do atendimento antes de encerrar a chamada.", todos os
grupos, ativa). A rota antiga `/admin/call-expectations` só lê (escrita = 410); o prompt legado dos Agents (`buildSystemPrompt`,
fora do motor) lê os argumentários vigentes (texto antigo igual ao de antes; estruturado = resumo dos campos).

**Memória.** `call_criterion_assessments` ganhou `source_kind` (KNOWLEDGE_DOCUMENT | ARGUMENT_SCRIPT), `argument_script_id/version`,
`applicability`, `observability`, `execution_claim`, `parent_criterion_key`, `obligation` (parte avaliada + regra inteira) e `scope`
(escopo do argumentário + Grupo/Subgrupo do colaborador considerados); `document_id` ficou opcional só para critério de argumentário
(restrição no banco). `call_assessments.argument_scripts` guarda a aplicabilidade de cada argumentário considerado. A liderança
mostra o argumentário no lugar do documento.

## Memória operacional (migration 102)

| Tabela | Conteúdo |
|---|---|
| `feedback_analysis_runs` | cada análise/investigação (chave de compatibilidade, gatilho, proveniência, métricas, lease). Mesma chave concluída = reutilizada. |
| `call_assessments` | leitura de uma chamada: cenário, procedimento/versão e perspectiva (regra vigente na data × regra atual), caminho, cobertura, desfecho, limitações. `is_current` + `superseded_by`. |
| `call_criterion_assessments` | chamada × critério: status, tipo de evidência, trechos (turno/falante), justificativa, orientação, materialidade, verificação. Uma linha vigente por chamada × critério. |
| `indicator_investigations` | oficial, localização, evidência, grupo de referência, perguntas, conclusão, limitações. |
| `feedback_engine_messages` | a mensagem (ou abstenção com motivo), brief, composição, supressões, entrega. |
| `feedback_material_recommendations` | material recomendado ≠ base que fundamentou ≠ entregue. |

Leitura: toda agregação da investigação (chamadas já analisadas, padrões por critério, caminho, estado da evidência) sai de UMA
leitura primitiva da porta de memória (`currentMemory`) e de funções puras (`domain/memory-queries.ts`). Postgres, RAM e a
**memória sobreposta** (`overlay-feedback-memory-store.ts`: lê o banco somente leitura, grava na RAM; a leitura da RAM substitui a
do banco para a mesma chamada; análise concluída no banco com a mesma chave é reutilizada) enxergam o mesmo. QA Lab, "Testar
diagnóstico" e o ensaio focal usam a sobreposição — antes, a investigação lia a memória direto do banco e não via as análises que
a própria simulação tinha acabado de gravar na RAM.

**Status efetivo** (`effectiveCriterionStatusSql`, sem migration): acerto/desvio/parcial só conta com
`verification.confirmation = CONFIRMED`; qualquer outra linha — hipótese não confirmada ou leitura gravada antes da V4, que não
tem confirmação — vale como inconclusiva em histórico do critério, investigação, padrões e em TODAS as agregações da liderança
(o detalhe da avaliação continua mostrando o que foi dito e por que não conta). A leitura pela regra ATUAL de uma chamada antiga
(`rule_perspective = CURRENT_RULE_REEVALUATION`) chega à investigação e ao redator marcada (`reevaluation`/`ruleBasis`): é
reavaliação, não culpa histórica.

Regras: a memória é gravada **antes** e independentemente da mensagem (falha do redator ou ausência de Output não perde a
análise); reanálise substitui a leitura anterior em dois passos (sem contagem dupla); uma leitura iniciada antes que termina
depois **não** vira a vigente (`as_of`); concorrência pela mesma análise = uma chamada de modelo (claim com lease + lock);
o texto do feedback nunca é fonte de evidência.

## Indicadores (`investigate-indicator.ts`, `domain/indicator-investigation.ts`)

O número oficial é fato (nunca recalculado). A investigação responde, com denominadores: **onde** mudou (assunto × período
anterior, mix × dentro do assunto, dias fora do padrão quando há medição diária, piora escondida por um geral melhor); **o que
as chamadas do recorte mostram** (até 8 análises reaproveitando a memória; padrão só com ≥ 3 avaliadas e denominador); **o que a
procedura pede** (mesmos critérios); **o que o grupo de referência comparável faz** (quartil superior, mesmo assunto e período
quando possível, senão só o geral — e isso é dito; mínimo de 4 pessoas / 3 contribuintes / 5 chamadas, só agregado). Conclusões:
padrão sustentado, prática a preservar, resultado a reconhecer, **mudança localizada sem causa sustentada**, efeito de mix, dados
insuficientes — "não há evidência para atribuir causa" é resposta válida.

**Validade, reuso e revisão (`INDICATOR_INVESTIGATION_V2`).** A chave da investigação representa as FONTES, não só o número
oficial: fato oficial (fonte, valor, meta, anterior), estratégia, especialista, versões da lógica (investigação, análise de
chamada, critérios), versões/hash da base do especialista, a assinatura das chamadas da pessoa nas duas janelas (inclui a
transcrição vigente — corrigida = nova assinatura), o estado da memória (avaliações vigentes) e, com comparação ligada, o estado
dos pares. Mesmas fontes = **reuso** — inclusive da chave registrada DEPOIS das análises que a própria investigação fez
(`provenance.reuseKeys`), para que a reexecução seguinte não refaça nada. Chamada nova, transcrição corrigida, avaliação relevante,
base ou lógica nova = **nova revisão**; a anterior fica no histórico, a mais nova é a vigente e uma execução antiga que termina
depois não a substitui (`as_of`, também na RAM). Abrir uma tela nunca investiga. A mensagem da revisão não repete o que já foi
entregue (achados suprimidos; sem ajuste novo, abstém `ALREADY_DELIVERED`).

**Sem localizar onde mudou** (volume insuficiente para comparar os períodos), a investigação descreve só o que a memória JÁ tem das
chamadas do período (`focusReason: UNLOCATED`, nenhuma análise nova para isso): prática consistente pode ser reconhecida (nunca
como causa do resultado) e desvio recorrente vira observação com denominador, nunca "padrão que explica o indicador". Assim uma
investigação inicialmente inconclusiva evolui quando a memória ganha leituras. Desde a investigação V14 (`PERIOD_SAMPLE_V1`), quando
a falta de localização é POR VOLUME e a estratégia autoriza analisar chamadas, o motor analisa também uma amostra determinística das
chamadas do período (ver "Amostra do período quando o volume não localiza") — continua sendo observação do período, nunca causa.
**Regra que mudou na base** depois das chamadas
(a linha avaliada não existe mais na versão publicada atual) não orienta: a avaliação histórica fica na memória e vira limitação.
Expansão para chamadas de colegas pode ser desligada (`peerCallAnalyses: false`) — então só entram agregados já existentes.

### Ferramentas de investigação (`INDICATOR_INVESTIGATION_V5`, `ENGINE_INVESTIGATION_TOOLS_V2`, `INVESTIGATION_CLOSURE_V2`)

O motor reaproveita as Tools de investigação do produto (`investigation/domain/tool-catalog.ts`, executadas pelo MESMO
`executeTool`: validação de argumentos, acesso, qualidade e proveniência de cada uma — `infrastructure/catalog-tool-runner.ts`)
e acrescenta três próprias:

| Ferramenta | Situação no motor |
|---|---|
| `get_indicator_snapshot`, `compare_periods`, `inspect_indicator_composition`, `validate_data_quality`, `detect_anomalies`, `get_employee_history`, `get_available_dimensions`, `segment_indicator`, `compare_population`, `inspect_work_context`, `find_interactions`, `get_interaction_context`, `get_interaction_flags`, `find_comparable_interactions`, `query_knowledge` | **reutilizadas** sem mudança (sujeito, indicador e janelas vêm do sistema; o planejador só escolhe dimensão, janela CURRENT/PREVIOUS e termos). |
| `read_call_memory` (nova) | lê as avaliações já gravadas das chamadas do recorte (status efetivo; zero IA). |
| `analyze_calls` (nova) | analisa chamadas do recorte pela MESMA `analyzeCall` da monitoria (mesma revisão, mesma memória; análise existente é reaproveitada, não duplica contagem nem custo). **Substitui** `analyze_interactions`. |
| `reference_practices` (nova) | práticas do grupo de referência comparável, só agregados da memória. **Substitui** `analyze_peer_patterns`. |
| `recommend_support_materials`, `synthesize_evidence` | **fora**: material sai da linhagem determinística das regras dos ajustes; o motor organiza a evidência no próprio registro. |

**Capacidades — regra final** (sem ampliação silenciosa):
- ferramentas de investigação = as "Ferramentas de investigação" do Agent (`agents.investigation_capabilities`) ∩ restrição do
  Workflow (`allowedCapabilities`: ausente = sem restrição; `[]` = nenhuma; lista = interseção — nunca concede);
- **lista vazia = nenhuma ferramenta**. É o contrato da coluna desde a migration 074 ("Vazio = sem ferramentas"); como a coluna
  nasceu `not null default '{}'`, não existe dado confiável que separe "nunca configurado" de "desligado de propósito" — então
  NADA é deduzido de uma lista vazia (a compatibilidade antiga que dava 5 capacidades por `LEGACY_DEFAULT_NO_STRATEGY`, e a base
  da estratégia como capacidade, saíram). Perfil sem o campo (carregador antigo) = lista vazia;
- a estratégia só RESTRINGE (seções desligadas, `allowedSteps` no modo `AGENT_SELECTED`, dimensões, pares, domínio);
- o **plano do CONTRATO** do diagnóstico não é ferramenta: o que a estratégia PUBLICADA autoriza (localizar por assunto — fato do
  código —, analisar a amostra dos assuntos localizados pela MESMA análise da monitoria, comparar práticas com o grupo). Roda sem
  planejador quando não há ferramenta disponível (Agent sem capacidades) ou no modo FIXO, respeitando também as restrições do
  Workflow (`contractStepsOf`). Sem estratégia publicada, o contrato não analisa chamadas (custa IA e ninguém autorizou): só fatos
  do código e o que a memória já tem;
- a análise da MONITORIA (flag → avaliação de processo) segue autorizada pelo contrato dela — não depende de capacidade.
**Configuração ≠ integração implementada (Larissa, lida em 01/10, somente leitura):** o "Especialista de Faturamento" tem
`investigation_capabilities = {}` → NENHUMA ferramenta e nenhum planejador para indicador; a estratégia publicada do TMA (v3)
liga segmentação por ASSUNTO, avaliação de até 10 chamadas (mínimo 3) e de processos, desliga pares e não declara modo de
investigação; os 3 Workflows de fechamento que usam o Agent não restringem capacidades. Resultado: só o plano do CONTRATO
(localizar por assunto + amostra). Configuração MÍNIMA para o planejador investigar um indicador com chamadas (documentada, não
aplicada — nenhum Agent compartilhado foi alterado): `INDICATOR_ANALYSIS` (fatos do indicador; `detect_anomalies` abre recortes de
dia) + `INTERACTION_ANALYSIS` (achar chamadas, sinais, memória, `analyze_calls`). `SEGMENTATION` é opcional (a localização por
assunto do contrato continua; com ela o planejador segmenta, limitado às dimensões da estratégia — hoje só ASSUNTO);
`OPERATIONAL_COMPARISON` não adianta enquanto a estratégia desligar pares (a estratégia nunca concede, a capacidade sozinha não
basta). Prova em cópia isolada: `application/tools-configuration.test.ts`. Ligar exige decidir no Agent (afeta todos os Workflows
que o usam) ou num Agent próprio para indicadores.

A permissão é checada na apresentação ao planejador E na execução: pedido fora da lista é recusado antes de consultar dado ou
consumir IA. `prohibitedClaims` vai ao redator e ao verificador; `noDiagnosisBehavior` diferente de "só o fato" faz o motor se
abster quando nada sustenta o diagnóstico. Ferramenta indisponível aparece com o motivo, nunca some.

**Recortes que as descobertas abrem** (`domain/investigation-slices.ts`, `INVESTIGATION_SLICES_V1`). Defeito corrigido: TMA piorou,
a comparação por assunto não achou concentração, `detect_anomalies` achou um pico em 14/08 e `compare_population` mostrou lacuna
individual — e o motor parava com `NO_OPEN_QUESTION`, com a pergunta das chamadas marcada como respondida sem nenhuma chamada do dia
examinada (o foco só existia por assunto). Agora um RECORTE (R-n) é um conjunto de filtros sobre as chamadas da própria pessoa no
período — assunto, dia, dia da semana, faixa horária, canal, sinal e combinações — e nasce da localização do código (assuntos que
mudaram; dias fora do padrão da PRÓPRIA medição diária — mesmo com o mês dentro da meta, desde a V5) **e dos resultados das
ferramentas**: dia anômalo/atípico
no sentido pior (`detect_anomalies`); parte com o indicador materialmente pior que o período (`segment_indicator` por dia/dia da
semana) ou com duração ≥ 20% acima do conjunto e volume mínimo (`segment_indicator` por assunto/canal/hora/sinal, indicador em
segundos); filtros pedidos na consulta viram combinação. Ao nascer, o recorte seleciona as chamadas compatíveis (mesmos filtros,
mesma janela, com transcrição) e o estado lê a MEMÓRIA delas antes de qualquer análise nova; população, filtros, período,
denominador e a consulta de origem (F-n) ficam com ele até a evidência persistida, o brief e o verificador.

**Perguntas com estado** (internos, nunca rótulos na conversa): `ANSWERED` (o resultado esclareceu — não basta a ferramenta ter
rodado), `PARTIAL`, `OPEN`, `NO_DATA`, `NO_TOOL`, `BUDGET`, `NOT_MATERIAL`. Achar um dia responde ONDE; "o que aconteceu nas
chamadas desse dia" é outra pergunta (`CALLS:R-n`) — aberta para TODO recorte que piorou, com o mês bom ou ruim (V5): `NO_DATA`
sem chamadas no recorte, `NO_TOOL` sem permissão de analisar chamadas (ou, no plano do contrato, recorte que não é assunto
localizado), `BUDGET` sem análises/IA restantes, `ANSWERED` quando a memória (ou as análises novas) já têm conclusões confirmadas em
`min(mínimo, universo)` chamadas do recorte, `DECLINED` quando o planejador decidiu não aprofundar (V2: inclusive quando ele diz
que resolveu com evidência que só dá contexto — ver abaixo). Comparação que rodou
sem conclusão deixa o CONTEXTO parcial; segmentação sem concentração deixa o ONDE parcial (não respondido). O planejador recebe o
estado atualizado (recortes, chamadas de cada um com o estado da análise — confirmada, inconclusiva, revisão pendente, não
analisada —, perguntas abertas e já resolvidas com o motivo) e decide se vale aprofundar; nada obriga uma descoberta a virar
análise de chamadas. `questionHistory` registra o estado das perguntas depois de cada rodada (como cada descoberta mudou a
investigação).

**O que encerra uma pergunta de recorte (`INVESTIGATION_CLOSURE_V1`, V5).** Defeitos reproduzidos e corrigidos: (A) TMA 380 → 450
(meta 400), `detect_anomalies` acha 820 s em 14/08, a comparação do MÊS mostra a pessoa melhor que o grupo (450 × 500) e há 3
chamadas do dia — a pergunta do dia virava `NOT_MATERIAL` ("grupo igual ou melhor") e a investigação parava com
`NO_OPEN_QUESTION` sem nenhuma chamada examinada; (B) TMA 357, dentro da meta e melhor que o anterior, com a própria medição
diária mostrando 820 s em 14/08 — o dia nem virava recorte ("o oficial não piorou") e a conclusão era só reconhecimento. Princípio:
o resultado do mês, a comparação do mês com o grupo e a qualidade do dado do período são CONTEXTO da pergunta (vão ao planejador em
`openQuestions[].context`, a favor ou contra aprofundar) — não provam que um problema localizado deixou de existir; uma
dificuldade que o grupo também teve pode valer ser entendida (processo, demanda, operação) sem ser atribuída à pessoa. "Não há
evidência para responsabilizar a pessoa no mês" (`NO_INDIVIDUAL_GAP`, limitação própria) ≠ "não há mais nada relevante para
investigar" (perguntas resolvidas). O planejador (prompt `ENGINE_INVESTIGATION_PLANNER_PROMPT_V3`) decide aprofundar ou parar
pesando materialidade do recorte, volume e qualidade, comparabilidade, evidências a favor e contra, memória e custo — nenhum
roteiro obrigatório. Parar com pergunta de recorte aberta exige decidir cada uma em `stop`: `declined` (1 frase de porquê) fica
`DECLINED` com a justificativa no registro (nunca na mensagem); parar sem decidir = `DECLINED` + violação `STOP_WITHOUT_DECISION`;
`resolved` (cita F-n) é julgado pelo que a evidência DEMONSTRA (`INVESTIGATION_CLOSURE_V2`, `resolutionOf`): pertencer ao recorte
é necessário, não suficiente. Defeito reproduzido: recorte de 14/08 com 3 chamadas, o planejador consulta as flags de UMA, "sem
flags", declara a pergunta das chamadas resolvida e o motor fechava `ANSWERED` com zero análises (`CHANGE_LOCATED_NO_CAUSE`).
Agora: só RESPONDE a pergunta das chamadas a evidência de procedimento (análise ou memória com conclusões confirmadas na cobertura
que a pergunta pede — sem amostra fixa, sem exigir todas as chamadas); sinais estruturados/contexto de TODAS as chamadas do
recorte com sinal afirmativo só justificam não aprofundar (`DECLINED` justificado, "não aprofundada", nunca "respondida");
cobertura parcial, ausência de sinal ("sem flags" não é ausência de falha) e evidência do período são insuficientes (`DECLINED`
sem justificativa + violação `RESOLVED_INSUFFICIENT`); evidência do período inteiro continua recusada (`RESOLVED_OUT_OF_SCOPE`). Tudo em `tools.dispositions`. Conclusão: recorte
que piorou EXAMINADO (chamadas confirmadas ou resposta do mesmo recorte) sem desvio recorrente = `CHANGE_LOCATED_NO_CAUSE`; NÃO
examinado (decisão, ferramenta, orçamento, parada) = `CHANGE_LOCATED_NOT_EXAMINED` + limitação do sistema "As chamadas do recorte
X não foram examinadas nesta investigação (motivo)"; sem dado = `INSUFFICIENT_DATA`. A comparação do mês com o grupo NÃO conta
mais como exame do recorte. `CHANGE_LOCATED_NOT_EXAMINED` sem reconhecimento possível = abstenção
`NO_ACTIONABLE_DIAGNOSIS:CHANGE_LOCATED_NOT_EXAMINED` (o retorno factual continua só para recorte examinado ou efeito de mix); com
o mês bom, o reconhecimento do resultado oficial continua oferecido ao redator mesmo quando um recorte pede ajuste (oferecer não
obriga). Plano do CONTRATO (Agent sem ferramentas, ex.: o "Especialista de Faturamento" da Larissa): o dia fora do padrão vira
recorte e fica `NO_TOOL` ("o plano do contrato da estratégia só analisa os assuntos localizados e nenhuma ferramenta de
investigação está configurada para aprofundar este recorte").

**Como a investigação escolhe** (`investigation-toolbox.ts`): perguntas abertas DETERMINÍSTICAS a partir do estado (onde mudou?
o que as chamadas do recorte mostram? o grupo comparável explica? o dado é confiável? que conduta sustenta o resultado bom?),
cada uma material ou não. Sem pergunta material = nenhuma chamada de IA. Com pergunta material, o planejador (etapa
`INVESTIGATION_PLANNING`, até 3 rodadas × 4 consultas, teto de 10 consultas) escolhe as ferramentas para as perguntas abertas, ou
para (`STOP` com motivo). Consulta repetida, desconhecida ou indisponível é recusada e registrada. Modo `FIXED` da estratégia (ou
nenhuma ferramenta) = o plano do contrato pelo MESMO executor, sem planejador. Parada registrada: `NO_OPEN_QUESTION`,
`NO_AVAILABLE_TOOL_FOR_OPEN_QUESTIONS`, `NO_DATA_FOR_OPEN_QUESTIONS`, `BUDGET`, `TOOL_BUDGET`, `MODEL_BUDGET`,
`PLANNER_UNAVAILABLE`, `MAX_PLANNING_ROUNDS`, `FIXED_PLAN_DONE`, `CONTRACT_PLAN_DONE`… Investigação que termina com o orçamento de
modelo esgotado e perguntas em aberto fica `completeness = INTERRUPTED_BY_BUDGET`: registrada (serve à mensagem daquela execução,
que se abstém como `INVESTIGATION_INTERRUPTED_BY_BUDGET` quando nada se sustenta), mas NÃO reutilizada — a chave é liberada e a
próxima execução autorizada investiga de novo, reaproveitando o que já foi pago. Resultado de ferramenta e texto de transcrição chegam ao planejador como DADOS (`F-n` do registro), nunca instrução.

**Do resultado ao diagnóstico e à mensagem**: o registro (`ToolLedgerEntry`: ferramenta, pergunta, argumentos, qualidade,
proveniência, resumo) vira sinais por código (`diagnosticSignalsOf`): grupo comparável igual/melhor → `NO_INDIVIDUAL_GAP` (a
variação não é tratada como deficiência individual); dado insuficiente → `INSUFFICIENT_DATA`; ferramenta sem dado ou com falha →
limitação ("nada foi concluído a partir dela"), nunca conclusão afirmativa. Os fatos comunicáveis (série, comparação,
composição, qualidade) entram no brief do indicador como contexto. Cada recorte investigado vira uma evidência PERSISTIDA
(`sliceRef`, filtros, escopo, origem, universo, analisadas, revisões pendentes, padrões por critério) e entra na conclusão
(recorte localizado + examinado = sem causa; não examinado = `CHANGE_LOCATED_NOT_EXAMINED`; a comparação do mês com o grupo
NÃO conta como exame do recorte); no brief, o achado sai com o
escopo do recorte ("Nas chamadas do recorte dia 14/08, em 3 de 3…") e o que a ferramenta observou vai ao contexto do redator e
aos fatos do verificador — nunca como parágrafo automático. A regra vigente é encontrada pela IDENTIDADE do critério
(não pela posição da linha). Medição operacional ≠ fechamento oficial: o oficial nunca é recalculado e proxies são ditas como
proxies.

## Composição (`compose-feedback.ts`, `domain/composition*.ts`)

**Contrato de confiança (desde `FEEDBACK_COMPOSITION_V2`).** O brief separa FATO de LEITURA DO MODELO:

- **Fato** (pode sustentar qualquer frase): fala literal conferida por turno/falante, texto literal da regra da base (com a
  abertura da lista e os itens irmãos), status CONFIRMADO do critério, números/históricos do sistema, resultado oficial, fatos
  das ferramentas de investigação, motivo de seleção, procedimento aplicado.
- **Leitura** (nunca vira fato por ter vindo da análise): justificativa (`reading`), orientação (`guidance`), "por que importa"
  (`whyItMatters`) e situação do cliente. Uma regra válida referenciada **não** prova que toda orientação associada a ela está
  sustentada.

Fluxo: brief (desenvolvimentos A-n, fortes S-n — só achados CONFIRMADOS; o caminho inadequado absorve as etapas do próprio
caminho e etapas não cumpridas da mesma seção viram um ponto, rastreáveis em `memberFindingKeys`) → redator (recebe fatos e, à
parte, a leitura marcada como hipótese) → verificador que recebe **só fatos** e confere, na MESMA chamada, as frases do texto e as
leituras da análise (orientação `G-A*`, "por que importa" `W-S*`) — sustentado, generalização, acréscimo, contradição (inclui regra
invertida: negação, ordem ou condição retiradas), exagero, especificidade, repetição e afirmação proibida pela estratégia → no
máximo 1 reescrita guiada pelos motivos (só com fatos) → verificação de novo. Reescrita do verificador **nunca** é aceita sem nova
verificação.

**Composição livre (`FEEDBACK_COMPOSITION_V3`, prompts V5/V4).** O redator decide organização, tom e extensão pelo caso (não
há estrutura fixa, abertura obrigatória nem narração do atendimento); recebe o que os fatos contêm, a base de cada regra (vigente
na data × reavaliação pela regra atual — reavaliação não é culpa) e as afirmações proibidas. **Nenhuma frase do sistema entra na
conversa**: o complemento antigo ("Ponto principal", "Destaque", "a etapa não aparece", "O procedimento orienta" + parágrafo
literal da regra) foi removido. A mensagem é só texto do redator aprovado na verificação; o card é o do redator (ou a primeira
frase aprovada do ponto principal). A prova (fala/ausência confirmada, regra literal, fonte) fica nos detalhes (`FEEDBACK_VIEW_V1`),
que mostram só os pontos efetivamente comunicados.

Quando a verificação retira frases, o que sobra é conferido como CONJUNTO: referência solta a uma frase retirada → abstenção
(`INCOHERENT_AFTER_REMOVAL`); retirada que pode ter quebrado o sentido → uma conferência de coerência (etapa `VERIFICATION`, tag
`coherence`). Abstenções com motivo (nenhuma publica texto de auditoria para "não ficar sem feedback"): `NO_SAFE_MESSAGE:` +
`WRITER_OUTPUT_INVALID` | `VERIFIER_UNAVAILABLE` | `NO_USEFUL_MESSAGE` (o ponto principal não ficou coberto por frase aprovada) |
`REJECTED_CONTENT_REAPPEARED` | `INCOHERENT_AFTER_REMOVAL` | `COHERENCE_UNVERIFIED` | `MODEL_BUDGET_EXHAUSTED`. Erro transitório
do provedor não vira abstenção: falha técnica (o Workflow tenta de novo pela política de sempre). Só os pontos comunicados contam
como entregues (`communicatedRefs`, supressão de repetição, materiais); o que não foi dito fica em `notCommunicated` e volta a
ser elegível. Chamadas por mensagem: até 2 de redator, 2 de verificador e 1 de coerência.

**O que o brief oferece e o que a mensagem precisa transmitir (`STRENGTH_SELECTION_V3`, `FEEDBACK_COMPOSITION_V4`, prompts de
composição V6 / verificação V5).** A V2 dava prioridade fixa à regra CONDICIONAL cuja condição apareceu — também não mede o que
importou e foi substituída. Agora a ordem do que vai ao redator vem do PAPEL NO CASO lido pela análise (`scenarioRole`: central =
ligado à necessidade do cliente ou à decisão do caso; apoio; rotina), depois materialidade e conduta observada — nem a quantidade
de itens da seção nem a condicionalidade decidem; reconhecimentos com falas diferentes; com ajuste, até 3 reconhecimentos. O que a
conversa não permite concluir mas importa no caso (central, não observável — ação interna, item reaberto ou incerto) vai como
PONTO EM ABERTO `O-n` (até 2): o redator pode orientar sobre ele (GUIDANCE com O-n), nunca afirmá-lo como feito ou não feito
(ADJUSTMENT com O-n é recusado por código). Ponto feito só em parte pode ter a parte feita reconhecida. Notas ao leitor
(`readerNotes`): procedimento publicado depois da chamada ("Este retorno usa a versão atual do procedimento, publicada depois desta
chamada: vale como orientação para as próximas chamadas."), transcrição incompleta, limites do indicador — nos detalhes como "Para
entender este retorno", nunca contagem de conclusões recusadas nem linguagem da revisão (isso fica na auditoria).
O verificador agora também lê a MENSAGEM inteira: transmite o ponto principal? vai além de narrar etapas? (`message`); diz se uma
frase que repete a ideia traz detalhe concreto sustentado (`addsInformation` → fica) e, na reescrita, que informação útil aprovada
antes se perdeu (`lostInformation`). Utilidade por código: mensagem que não transmite o ponto principal ou só narra →
`missingValue` → reparo com o motivo; persistindo → `NO_USEFUL_MESSAGE`. A reescrita só substitui a versão anterior se não ficou
pior em ponto principal, lacunas, informação perdida e recusas (`better`); a instrução de reparo pede para manter o detalhe concreto
e as condições das frases aprovadas e juntar repetição em vez de apagar. Nada disso é frase pronta: os testes provam regras de
decisão, nunca uma redação preferida (`composition-value.test.ts`, `strength-selection.test.ts`).

## Título do feedback (`FEEDBACK_HEADING_V1`, `feedbacks/domain/feedback-heading.ts`)

Título principal = ASSUNTO do atendimento; a data vai à parte ("Atendimento de 29/09/2026"). Fontes, nesta ordem: nome do assunto
canônico resolvido quando o feedback é gerado (gravado no artefato — a leitura posterior não reclassifica) › assunto BRUTO gravado
com a interação (`interactions.reason`), quando legível › nome do assunto com exatamente aquele código (bruto que é código) ›
título neutro "Feedback de atendimento" (`subjectSource: "NONE"`). Nunca nome da base, do agente, do Workflow ou de um erro; nada
de especificidade inventada; nenhuma chamada de IA. Origem do defeito: `interactionLabelOf` (rótulo do feedback confiável e do
feedback direto) só punha o assunto quando o bruto tinha ALIAS no catálogo canônico — as chamadas da demonstração ("Contas em
atraso", "Internet fixa sem funcionamento"…) não têm, o rótulo virava só a data e `headingOf` usava a data inteira como TÍTULO; o
motor novo usava o bruto direto (código cru virava título). Corrigido nos dois caminhos e nas superfícies: Acompanhamento do
colaborador (já lia `view.heading`), feed e detalhe da ESTRUTURA (liam `impacted_indicator` → agora título e subtítulo do
cabeçalho), recado de Chat/Avatar (título neutro ou só data não vira "tópico"). Indicador: título = indicador, período como
subtítulo (inalterado). Publicados: `scripts/feedback-engine/reproject-feedback-headings.ts --organization <id> [--apply]` (padrão
= ensaio) corrige SÓ o cabeçalho do view model publicado sem assunto, pela interação VINCULADA (assunto bruto gravado + data dela;
nunca alias criado depois), guarda o anterior em `presentationRevisions` + `audit_logs FEEDBACK_HEADING_REPROJECTED`, idempotente;
não regenera análise, não reescreve mensagem/card, não mexe em destinatário, ciência ou notificação. Dev 01/10: 69 corrigidos
(todos com assunto gravado legível), segunda rodada 0.

**Feedbacks antigos SEM view model — título na LEITURA** (`legacyFeedbackHeadingOf`, `feedbacks/infrastructure/
legacy-feedback-headings.ts`). Os de monitoria publicados por pipelines anteriores tinham como título o campo "indicador impactado"
— na prática o nome da base ("Checklist de Encerramento de Chamada"), do agente ou de um critério. Nada é regravado: o
Acompanhamento do colaborador (`/operator/overview` e a ficha do supervisor) e o feed/detalhe da estrutura montam o cabeçalho na
leitura, com quantidade fixa de consultas. Vínculo confiável com a interação, nesta ordem: `context_snapshot.interactionId` do
feedback; senão a ÚNICA interação citada como evidência do caso (duas ou mais = sem vínculo); sempre do mesmo colaborador. Com
vínculo: assunto bruto gravado com a interação (ou o nome do assunto com exatamente aquele código) e a data dela como subtítulo;
sem assunto legível, título neutro com a data. Sem vínculo: "Feedback de atendimento", sem subtítulo — nunca o nome da base, do
agente ou do indicador impactado. Feedback de indicador sem view model não muda (o indicador é o assunto dele). Relatório somente
leitura: `scripts/feedback-engine/legacy-heading-report.ts --organization <id>`. Dev 01/10: 179 sem view model → 165 com vínculo
confiável, **156 com assunto** (todos do assunto gravado), 9 vinculados sem assunto legível (neutro + data), 14 sem vínculo
(neutros — os "TESTE - Orquestrador Indicadores"); os 179 deixaram de exibir o título antigo. Alguns assuntos gravados são rótulos
de teste da própria massa (ex.: "TESTE E - variavel numerica") — é o que o dado diz.

## Autonomia

Não há fila de QA nem aprovação de checkpoint no caminho novo. Diante de incerteza o motor busca mais evidência (revisão
independente, ferramentas para as perguntas abertas, chamadas do recorte), **restringe** a conclusão (não confirmada = não
observável, não avaliado, parcial, caminho não determinado, mudança sem causa, dados insuficientes) ou **se abstém** com motivo
registrado. Nós explícitos de Revisão humana do grafo continuam funcionando.

## Orçamento e consumo (`ENGINE_BUDGET_V1`, `application/engine-meter.ts`)

Um medidor por execução, compartilhado por TODAS as chamadas de modelo do motor — análise, revisão, planejamento, redação,
verificação, coerência, retentativas e as análises disparadas por ferramenta (`analyze_calls`) — injetado em `createEngineDeps`.
Tetos padrão (todos são tetos, nunca metas): 40 chamadas de modelo, 1,5 mi tokens de entrada, 500 mil de saída, 15 min, custo
opcional (`maxCostUsd`), 1 retentativa por erro TRANSITÓRIO do provedor (contada como chamada; o gateway roda com retentativa 0
para não haver retentativa invisível). Antes de cada chamada há uma RESERVA (entrada ≈ caracteres/3, saída = teto da etapa:
análise 24.576, revisão 12.288, planejamento 4.096, redação/verificação 8.192); não cabe → `FEEDBACK_ENGINE_BUDGET_EXHAUSTED` sem
chamar. Uso não informado pelo provedor conta como a reserva. O resumo (`metrics.budget`: chamadas, falhas, recusas,
retentativas, tokens, custo, por etapa, motivo do esgotamento) fica na memória junto da mensagem. Consultas de fato do catálogo
não chamam modelo. "Testar diagnóstico" em "Parar antes da IA" usa orçamento 0.

## Compatibilidade e o que foi aposentado

| Peça | Situação |
|---|---|
| `reliable-feedback` (artefato, política PILOT/AUTONOMOUS, HOLD_FOR_QA, redatores V4–V8) | fora do caminho do Workflow; código mantido para ler artefatos antigos e para o QA das retenções antigas. |
| Feedbacks já publicados | intocados; o Acompanhamento lê `feedbackEngine.feedbackView` ou, se não houver, `reliableFeedback.feedbackView`. |
| QA de feedback (tela) | continua para os itens antigos; itens de retenções encerradas/reprocessadas saem da fila; decisão sobre artefato substituído é recusada. |
| Registro de checkpoints | histórico; aviso na tela; o menu virou "Checkpoints (histórico)". |
| `Testar diagnóstico` da estratégia do indicador | agora roda o motor (investigação + mensagem), banco só-leitura e memória em RAM. |
| Aba Resultados do Workflow | mostra a mensagem do motor (kind `ENGINE`, pronto/sem feedback + motivo). |
| Provas antigas (`reliable-feedback-workflow-proof`, `prv-closing-diagnosis-proof`, `direct-indicator-diagnosis-proof`) | marcadas como aposentadas (`describe.skip`); a prova do caminho atual é `feedback-engine-workflow-proof`. |

### Retenções antigas (HOLD_FOR_QA)

`npx tsx scripts/feedback-engine/legacy-holds.ts` lista (dry-run, nada muda). `--apply --mode REPROCESS --reason "…"` substitui
o artefato e reativa a matrícula no nó "Gerar feedback" (o motor roda de novo — consome IA); `--mode CLOSE` substitui e encerra a
matrícula sem entrega. Nunca aprova; nada é apagado; auditoria em `audit_logs`. No banco dev (30/09): 11 retenções, todas de
smokes da Larissa (9 em "Monitoria · Contestação de conta", 1 em "Baixo TDNA · Argumentário", 1 em "Rechamada · Argumentário") —
**não aplicado**; decisão do dono do ambiente.

### Fluxos que ainda esperam decisão humana explícita do grafo

"Demo · Revisão humana pendente (massa demo)" (inativo, 1 matrícula esperando no nó de Revisão humana). Não alterado.

## Diagnóstico da liderança

Tela **Diagnóstico** (`/diagnostics`, mesma regra de acesso: lidera alguém OU `indicators.view`): filtros (período, Grupo,
Subgrupo, pessoa, assunto, procedimento), resumo com denominador e método, abas **Processos**, **Pessoas e equipes**,
**Concentração** (dia, dia da semana, assunto, hora), **Materiais** e **Indicadores**; cada número abre as avaliações que o
compõem e cada avaliação abre a regra, os trechos da conversa e a transcrição. Exportação CSV por aba com período, filtros,
método e denominador no cabeçalho. Nenhuma tela chama IA.

API: `/api/v1/diagnostics/memory/{summary,filter-options,processes,people,concentration,materials,indicators,indicators/:id,
assessments,assessments/:id,export.csv}` — organização da sessão, só pessoas do escopo do leitor (subárvore ∪ escopo de
`indicators.view`); detalhe fora do escopo/organização = 404; `status` aceita `DEVIATION` e `INCONCLUSIVE`.

## Operação

- Migration 102 aplicada em `inia` e `inia_test` (aditiva; só `workflow_output_emissions.engine_message_id` e
  `reliable_feedback_artifacts.superseded_*` alteram tabelas existentes).
- Ensaios sem gravar: `scripts/feedback-engine/dry-run-call.ts`, `dry-run-indicator.ts`.
- Bateria de avaliação: `scripts/feedback-engine/evaluation/` (`cases.ts` entradas, `ground-truth.json` gabarito lido só pelo
  avaliador, `run-battery.ts`, `score-battery.ts`, `results/`).

## Provas

- Domínio: `feedback-engine-domain.test.ts`, `generate-feedback.test.ts`, `workflows/.../reliable-feedback-flow.test.ts`,
  `workflow-results.test.ts`, `diagnostics-router.test.ts`.
- Banco de teste: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-engine-workflow-proof` (Workflow real → memória →
  Acompanhamento, retry, reuso/supressão, falha do redator, sem Output, concorrência, mudança de regra e leitura tardia,
  retenções antigas, consultas da liderança, indicador por agenda).
- Frontend: `diagnostics-page.test.tsx`, `indicator-diagnostic-strategy.test.tsx`, `workflow-results-tab.test.tsx`.
- Contrato de confiança: `composition-trust.test.ts` (orientação inventada na análise; recusada pelo verificador; falha do
  redator/verificador; complemento; card e detalhes; reescrita que remove negação/condição; trava final; lista "avaliar" e mesma
  fala × item irmão). Identidade: `feedback-engine-domain.test.ts` (ordem invertida, condição, exceção, modalidade, negação,
  responsável, canal, prazo, objeto × mudanças editoriais). Investigação: `investigate-indicator.test.ts` (poucos dados → evidência
  nova com o mesmo oficial → revisão → reuso; execução antiga tardia; memória sobreposta; pares desligados; trava de colaborador;
  regra alterada); `period-sample.test.ts` (`PERIOD_SAMPLE_V1`: amostra do período quando o volume não localiza, autorização,
  orçamento). Postgres: prova I estendida (reuso pela chave de evidência e revisão por chamada nova).
- Avaliação: `evaluation/scoring.test.ts` (mensagens ruins que acertam status/tom) e `evaluation/paid-budget.test.ts` (retry
  contado, uso desconhecido = reserva, bloqueio antes de enviar).
- Correção de 30/09 (fim do dia) — todos com modelo SIMULADO e `testing/no-external-ai.ts` importado (qualquer `fetch` para
  provedor de IA falha o teste, inclusive indireto, retry e ferramenta semântica):
  - `diagnosis-confirmation.test.ts`: o defeito "A segunda via é da fatura ou do parcelamento?" reproduzido (omissão proposta
    passa pela integridade e é refutada pela fala do operador; a falsa acusação não chega à memória analítica nem ao brief);
    citação verdadeira com interpretação errada; CONFIRMED com motivo impeditivo; intenção × declarada × observável; ação
    interna sem fala; obrigação condicional sem a condição; alternativa tratada como obrigação (Estorno); lista cumulativa (a
    falha legítima não é escondida); leitura tolerante da revisão; reavaliação pela regra atual; identidade V3 (máximo ×
    mínimo, ordem, negação, obrigação × permissão, preposição, abertura da lista).
  - `engine-investigation-tools.test.ts`: dois cenários com investigações diferentes; resolvido pela memória com zero chamadas;
    ferramenta sem dado/falha/recusada = limitação; capacidades Agent × Workflow × estratégia × pessoa; modo FIXO; teto de 3
    chamadas sem chamada indireta depois do limite; retentativa transitória contada e uso desconhecido = reserva; análise
    compartilhada monitoria ↔ indicador; produção × sobreposição.
  - `composition-freedom.test.ts`: defeito de ponta a ponta (revisão refuta → sem acusação; revisão indisponível → análise
    suspensa, mensagem não decidida; redator indisponível → nenhuma frase pronta); referência solta e conjunto incoerente →
    abstenção; afirmação proibida pela estratégia.
  - `feedback-engine-domain.test.ts`: revisão da extração V2→V3 com proveniência (`extractionRevisionOf`).
  - Postgres: `feedback-engine-workflow-proof` (Flag e Indicador com a revisão e o status efetivo).
- Correção de 01/10 — descobertas, recuperação e capacidades (modelo SIMULADO, zero IA):
  - `investigation-discovery.test.ts`: DEFEITO REPRODUZIDO (assuntos estáveis → pico de 14/08 por `detect_anomalies` → lacuna
    individual → o estado abre `CALLS:R1`, o planejador recebe o recorte, as chamadas DO DIA são analisadas, o achado chega à
    evidência persistida, ao brief e à mensagem); descoberta já explicada pela memória (nenhuma análise nova); descoberta sem dados
    (limitada, sem causa); ferramenta que rodou sem esclarecer não encerra a pergunta (pico ausente, comparação sem conclusão,
    análises sem confirmação); sem permissão (`NO_TOOL`) e sem limite (`BUDGET`) com o motivo.
  - `analysis-recovery.test.ts`: DEFEITO REPRODUZIDO (timeout na revisão e na nova tentativa → suspensa, nada na memória →
    recuperado → só a revisão); a mensagem não fica presa (nova tentativa do nó publica); execução pré-correção com
    `REVIEW_UNAVAILABLE` reaproveita as propostas; insuficiência real e inconclusiva após revisão não repetem; falha repetida = uma
    tentativa por execução; contrato inválido não entra em nova tentativa automática; transcrição corrigida invalida a proposta;
    motivo de seleção não; revisão já paga com o mesmo pedido é reaproveitada; retomadas concorrentes pagam uma vez; investigação
    dependente não fecha com a lacuna e reconhece a revisão concluída depois.
  - `investigation-capabilities.test.ts`: DEFEITO REPRODUZIDO (`[]` sem estratégia não recebe 5 capacidades); perfil legado sem o
    campo = vazio; restrição vazia e parcial do Workflow; pedido fora da permissão recusado antes de consultar dado ou IA; nenhuma
    concessão indireta por estratégia ou por ferramenta semântica.
  - Postgres: `feedback-engine-workflow-proof` J (revisão com timeout dentro do Workflow → nó em nova tentativa transitória →
    só a revisão é refeita, uma mensagem; leitura legada fora da liderança; duas retomadas concorrentes = uma revisão) e I
    (capacidades do Agent, recorte por SQL real, investigação interrompida não reutilizada).
- Correção de 01/10 (tarde) — encerramento de recorte, título e reconhecimento (modelo SIMULADO, zero IA):
  - `investigation-closure.test.ts`: DEFEITOS REPRODUZIDOS A e B; o planejador pode aprofundar (3 chamadas do dia analisadas) ou
    parar com justificativa (`DECLINED`, conclusão não examinada, limitação do sistema sem o texto do modelo); parar sem decidir;
    evidência do MESMO recorte encerra sem análise e a do período é recusada; memória suficiente; dado do período incerto como
    contexto contrário; sem ferramenta e sem orçamento; contrato sem ferramentas (configuração da Larissa); abstenção
    `CHANGE_LOCATED_NOT_EXAMINED`.
  - `feedback-heading.test.ts` (assunto canônico × gravado × código × neutro; legado com e sem assunto; idempotência),
    `generate-feedback.test.ts` (título do motor), `conversational-delivery.test.ts` (tópico neutro), frontend
    `follow-up-entry.test.tsx` (antes `follow-up-detail-sheet.test.tsx`).
  - `strength-selection.test.ts` (análise REAL revisada da C07, sem custo; V3: papel no caso, sem bônus de regra condicional,
    situações diferentes da C07).
  - Postgres: `feedback-engine-workflow-proof`, `follow-up-visibility-proof`, `diagnostic-strategy-proof`.
- Correção de 01/10 (noite) — descartes, encerramento por evidência, valor da mensagem, títulos legados, configuração e aberturas
  de lista (modelo SIMULADO, zero IA):
  - `exclusion-review.test.ts` (caso sintético `testing/cancellation-case.ts`): descarte errado ligado ao centro → ajuste
    confirmado; descarte legítimo permanece; justificativa genérica de grupo; ação interna reaberta, nunca "não cumprida";
    contestação sem convergência = hipótese; notas técnicas na auditoria, fora das limitações.
  - `investigation-closure.test.ts`: DEFEITO REPRODUZIDO (flags de UMA das 3 chamadas do recorte não respondem a pergunta);
    contexto de todas as chamadas só justifica não aprofundar; evidência suficiente fecha sem nova análise; memória, permissões,
    orçamento.
  - `composition-value.test.ts`: repetição × detalhe concreto; reparo que pede para manter o detalhe e as condições; reescrita que
    perde informação não substitui a versão anterior; mensagem que só narra → abstenção; ponto em aberto só como orientação;
    detalhes sem linguagem da revisão.
  - `feedback-heading.test.ts` (vínculo e título na leitura dos feedbacks sem view model), frontend `follow-up-timeline.test.tsx`.
  - `tools-configuration.test.ts`: cópia isolada da configuração real da Larissa (sem ferramentas) × configuração mínima.
  - `list-opening-review.test.ts`: FALHA REAL REPRODUZIDA (abertura "…avaliar:" parcial confirmada lendo NOT_A_LIST); alternativas
    sem "parcial"; item englobado contestado → ajuste e conclusão agregada derrubada; item dependente de ação interna → ponto em
    aberto; pedido × resposta registrado; teto e prioridade do pedido de cobertura.
- Contrato orientado ao caso (02/10, noite; modelo SIMULADO, zero IA — as chamadas pagas estão na seção da rodada V10):
  - `obligation-contract.test.ts`: parser e handles de fonte; consequências por código das leituras do modelo (declaração não prova
    conduta, alternativa feita, combinação indefinida, parte não verificável, itens contra o achado); identidade estável pela ordem
    do documento; lacunas de argumentário e `N-n`.
  - `obligation-pipeline.test.ts`: análise → revisão → confirmação focal de ponta a ponta; reaproveitamento da resposta paga.
  - `review-discovery-confirmation.test.ts`: achado só da revisora confirmado, refutado, sem orçamento (inconclusivo com motivo) e
    MET só da revisora não priorizado.
  - `planner-arguments.test.ts`: contrato de argumentos no prompt e no schema; argumento ausente com uma opção × várias (recusa
    estruturada); rodada só de recusas continua; recusada ≠ respondida.
  - Replays sem custo: `replay-obligations-v10.ts` (respostas pagas da comparação pelo código novo), `evaluate-round-v10.ts --replay`.

## Avaliação com modelo real (30/09/2026)

Bateria em `backend/scripts/feedback-engine/evaluation/` — 9 chamadas sintéticas sobre bases REAIS publicadas (Segunda Via de
Conta e Negociação de Débito), gemini-3.8-flash pelo gateway, memória em RAM, gabarito lido só pelo avaliador. Cenários: sinal
negativo com processo correto; caminho errado com citações verdadeiras; exceção (Anatel) aplicada corretamente × a MESMA ação sem
a condição; pré-requisito de exceção omitido + promessa ("vou mandar"); transcrição interrompida; protocolo dito pelo cliente
(troca de falante); promessa de desconto fora do sistema; negociação assistida completa.

**Correção do relatório (noite de 30/09).** O relatório original somava "mensagem correta 9/9" a partir de status e tom e
"acusações indevidas 0" a partir de termos listados — isso não mede diagnóstico nem utilidade. Os 9 casos também foram rodados 6
vezes enquanto o motor era corrigido: **todos viraram regressão** (`ground-truth.json › usedForCalibration`), nenhum é prova
independente. O avaliador agora é POR DIMENSÃO (`evaluation/scoring.ts`, testado com mensagens deliberadamente ruins que acertam
status e tom): procedimento/cenário, desvios esperados encontrados, desvios materiais não encontrados, acusações sem suporte,
reconhecimentos indevidos, orientação aplicável e sustentada (sempre **inspeção humana**), consequências/certezas acrescentadas e
redundância (sinais **auxiliares** léxicos — apontam o que ler, não provam), decisão de publicar/abster e tom (estruturais).
Nenhum total agregado de qualidade. Reprocessada sem nova chamada paga (`results/2026-09-30T20-59-55-485Z.dimensions.md`), a
rodada final fica: procedimento/cenário 9/9 e decisão 9/9 (estruturais), desvios esperados 5/5 casos com desvio, 4 casos com
desvio fora do gabarito para leitura, e **6 de 9 mensagens com marca de consequência/certeza acrescentada** ("garante que o cliente
saiba", "impede negociações indevidas") — exatamente o defeito que o contrato de confiança corrige. "154 de 157 decisões
sustentadas" significa que o modelo citou evidência que o código conseguiu conferir (formato/literal/falante), não que as 154
decisões estejam certas no mundo real.

Defeitos encontrados pela bateria e corrigidos (todos com teste): checklist de encerramento sem seções não era cobrado; resposta
em bloco ```json descartava o reparo em silêncio; identificadores escritos como `[D1]`/`T07` não resolviam; resposta degenerada
(repetição até 65 mil tokens, 160–190 s) — agora com teto de saída por etapa; o modelo omitia `evidence` para "ser breve" — agora
obrigatório no contrato; exigência de encerramento sem turno indicado — a oportunidade é o fechamento da chamada.

## Validação focal — Larissa Monteiro (30/09/2026, noite)

Uma pessoa, dados reais, custo limitado — resultado FOCAL, não taxa de qualidade da operação. Artefatos em
`backend/scripts/feedback-engine/evaluation/larissa/` (`selection.json` congelado antes de gastar; `ground-truth.json` registrado
antes da rodada, lido só por `score-larissa.ts`; `results/`). Identidade: organização INIA Demonstração, nome exato + matrícula
`DEMO-OP-0001` (1 registro; "Larissa Monteiro Brito" é outra pessoa), B2C · Atendimento Geral / Subgrupo "Diagnóstico IA".
Casos (TMA de agosto/2026, assunto Contestação de cobrança, "Especialista de Faturamento", bases v1 publicadas em 10/09 — as
chamadas de agosto foram lidas pela regra ATUAL, perspectiva explícita): C07 (cobrança após cancelamento não concluído — desvio
esperado §21 "Corrigir o status"), C04 (chamada longa de 1180 s com explicação da conta e faturas anteriores — limite para o
TMA), C00 (bem conduzida; só memória). Indicador: TMA 08/2026 = 357 s, meta 400, julho 382; julho tem 1 chamada registrada, então
não dá para localizar por assunto.

Travas: orçamento na fronteira HTTP (`evaluation/paid-budget.ts`: cada POST ao provedor, inclusive retry, com reserva do pior caso
antes de enviar; uso desconhecido = reserva), retry de transporte desligado, só a Larissa pode ser analisada (`allowCollaborator`),
sem expansão de pares, uma rodada sequencial; retomada (`--resume`) recarrega as análises e só refaz a etapa afetada.

Rodada paga única: **12/12 requisições, US$ 0,50 estimados** (entrada 211 mil tokens, saída+raciocínio 91 mil, nenhum uso
desconhecido, nenhuma chamada de colega). Análises: 2 requisições cada (análise + reparo de cobertura) ≈ US$ 0,14–0,16;
composição: 2 cada (redator + verificador, sem reescrita) ≈ US$ 0,01–0,03. Retomada sem custo: 0 requisições (6 bloqueadas pela
trava, mensagens só com fatos).

O que a rodada mostrou (inspeção humana contra o procedimento):

- Funcionou: o desvio material da C07 ("Corrigir o status", com "preservar a data da manifestação") foi achado e orientado; o
  verificador recusou 5 leituras do modelo ("garante… proteção de dados", "impede cobranças futuras", R$ 89,90 do plano fora dos
  fatos do ponto, uma orientação com consequência inventada) e nenhuma delas apareceu — uma dessas recusas também rejeitou a
  condição legítima "falha interna" do §21, que o verificador não via por falta da frase que abre a lista (corrigido, ver abaixo); nenhuma frase do sistema foi necessária; o indicador manteve o
  oficial intacto, não pediu "rapidez", não atribuiu causa, reconheceu práticas observadas nas 3 chamadas e declarou a limitação
  de localização; zero análise de colega.
- Errado na rodada (corrigido depois, sem nova chamada paga): (1) a C07 acusou "Estorno" e orientou "a tratativa é realizar o
  estorno" — o §34 manda AVALIAR alternativas e ela escolheu corretamente "crédito na próxima fatura"; a análise usou a MESMA fala
  para dar "Crédito" como cumprido e "Estorno" como não cumprido, e o verificador aprovou porque recebeu "- Estorno;" sem a frase
  que abre a lista. Correções: regra `SAME_EVIDENCE_PROVES_SIBLING` na verificação (`CALL_ANALYSIS_LOGIC_V3`; na V4 ela deixou de retirar a acusação sozinha e virou foco da revisão, porque escondia falhas legítimas de listas cumulativas) e regra sempre com
  a abertura da lista + os outros itens avaliados (prompts V4/V3). Replay determinístico nas 3 análises reais: só "Estorno" muda.
  (2) a investigação declarou 4 itens do checklist como "mudou na base" (comparava com a linha crua que enumera "(1)…(2)…") —
  corrigido para comparar com as linhas extraídas pelo motor; na retomada, as limitações falsas sumiram. (3) o reconhecimento da
  C04 escolheu validação e cancelamento (genéricos) e não a explicação da conta; agora os acertos são agrupados por seção e
  priorizados por conduta observada — na retomada, "Leitura da conta" passa a ser reconhecida.
- Divergência com o gabarito que ficou para leitura: na C04 e na C00 o motor apontou "Serviços digitais" (§15 item 4 bloqueio
  preventivo "se disponível e autorizado"; item 6 orientar conta ajustada) e a recapitulação sem "valor a pagar"; o gabarito
  pré-registrado esperava caminho correto. Lendo o §15 e o §46, os pontos de conta ajustada/valor a pagar têm base literal; o do
  bloqueio é condicional (a mensagem manteve a condição). Não alterei o gabarito depois da rodada.
- **Não validado com modelo real** (orçamento esgotado): o texto final da C07/C04 com as correções (1)–(3) — a retomada gerou só a
  versão de fatos do sistema; o comportamento do verificador com o contexto de lista foi provado só com regressões locais.

### Replay sem custo pela lógica V4 (30/09/2026, fim do dia)

`backend/scripts/feedback-engine/evaluation/larissa/replay-v4.ts` → `results/replay-v4-2026-10-01T00-27-28-935Z.{json,md}`.
**Replay, não validação**: zero chamada enviada (o modelo do replay recusa todo pedido antes de sair; medidor com orçamento 0),
banco somente leitura, memória em RAM, gabarito não lido. Identidade congelada conferida (pessoa, matrícula, sha256 das
transcrições, versão/hash das bases); handles das linhas idênticos aos da rodada paga. O contrato da análise (prompt V2) não
mudou; a análise gravada na rodada paga (já com o reparo de cobertura antigo incorporado) volta como proposta.

- As propostas das 3 chamadas são reproduzidas exatamente pela integridade V4 (C07 29/4/1, C04 54/4/1, C00 61/5/1 —
  cumpridas/não cumpridas/parciais). Sem a revisão, **nenhuma** é confirmada: as três saem `INSUFFICIENT_EVIDENCE`
  (`REVIEW_UNAVAILABLE`) e nenhuma mensagem seria escrita — na V3 as mesmas propostas viraram fato.
- O que iria à revisora: C07 34 propostas (C04 59, C00 67). A acusação "Estorno" da C07 chega com `CONDITIONAL_RULE`,
  `LIST_ITEM_WITH_MET_SIBLING` e `SAME_EVIDENCE_AS_SIBLING` (a mesma fala sustenta "Crédito em conta futura"); "Corrigir o
  status" chega como omissão em regra condicional ("Se o cancelamento não tiver sido concluído por falha interna:"); "Conta
  analisada", "Lançamento contestado", "Valor a pagar", "Ativar bloqueio preventivo" e "Orientar sobre conta ajustada" chegam
  como omissões em listas com irmãos cumpridos. Pedido da revisão: ~17 mil (C07) a ~34 mil (C04/C00) tokens de entrada.
- TMA de agosto: 357 × meta 400, melhorou; localização indeterminada (1 × 13 chamadas); nenhuma pergunta material →
  **nenhuma** chamada de planejamento; conclusão de reconhecimento com a limitação de volume. Re-execução de 01/10
  (`replay-v4-2026-10-01T13-00-50-415Z.json`) com a regra final das capacidades: o "Especialista de Faturamento" não tem
  "Ferramentas de investigação" marcadas → nenhuma ferramenta, plano do contrato da estratégia publicada, mesmo resultado.
- Não prova: o que a revisora, o planejador e o redator fariam com modelo real.

### Validação mínima da C07 — executada (01/10/2026, manhã; propostas de 30/09 reaproveitadas)

Roteiro: `backend/scripts/feedback-engine/evaluation/larissa/validate-c07.ts --execute` (uma única rodada paga, autorizada).
Artefato: `results/validate-c07-paid-2026-10-01T13-48-48-413Z.json` (pedidos, respostas cruas de cada etapa, uso por requisição,
revisão por critério, brief, view e auditoria da composição). Identidade e fontes congeladas conferidas; banco somente leitura;
memória e mensagem em RAM; nada publicado, entregue ou notificado; só a Larissa; sem pares; gabarito fora do contexto do motor.

- **Propostas**: RECONSTRUÍDAS do artefato pago de 30/09 (analisador da época) e reaproveitadas pelo mecanismo de retomada da
  revisão — não são uma nova primeira análise da versão atual. Nenhuma análise repetida.
- **Consumo**: 5 requisições (revisão 1, redator 2, verificador 2 — a 1ª versão teve uma frase recusada por repetição, então houve
  1 reescrita), 0 bloqueadas, 0 novas tentativas; 27.220 tokens de entrada, 14.099 de saída + raciocínio (4.030 visíveis); US$
  0,0733 pela tarifa configurada da avaliação (US$ 0,75 / 3,75 por milhão). Tetos: 6 requisições, US$ 0,25, reserva antes de cada
  envio.
- **Revisão** (34 propostas): 32 confirmadas, 1 incerta ("Corrigir o status" — `INTERNAL_ACTION_NOT_OBSERVABLE`: correção de
  status é ação de sistema que a conversa não mostra), 1 refutada ("Estorno" — `ALTERNATIVE_NOT_REQUIRED`: a lista "avaliar:" é
  de alternativas e o crédito em conta futura foi oferecido em T12). Crítica ao caminho refutada (apoiava-se no estorno e na ação
  interna) → caminho não determinado. A acusação errada de 30/09 não voltou.
- **Mensagem** (texto real): título "Contestação de cobrança" (canônico), subtítulo "Atendimento de 21/08/2026"; card "Excelente
  condução na validação cadastral e no levantamento da contestação. Pelas regras atuais, lembre-se de citar a conta e o lançamento
  contestado no resumo final."; corpo "Você realizou a validação de segurança com o nome e a data de nascimento da titular antes
  de consultar os dados da linha. Além disso, identificou com clareza o problema ao perguntar qual valor não era reconhecido, em
  qual fatura constava e se a conta já havia sido paga. / Pela regra atual, para os próximos atendimentos, lembre-se de incluir a
  conta analisada e o lançamento contestado ao fazer a recapitulação antes de encerrar a chamada."
- **Avaliação (leitura contra transcrição e procedimento)**: correto e rastreável — procedimento e ramo certos (cobrança após
  cancelamento, conta já paga), nenhuma acusação de algo feito ou não obrigatório, ajuste literal da seção 46 com oportunidade real
  (recapitulação em T14 sem a fatura de agosto e sem o lançamento), cada frase ligada a regra literal e fala verificada. Fraco em
  utilidade: o reconhecimento NARRA etapas de toda chamada (validação, escuta) e não diz o que fez diferença no caso (conta já paga
  → crédito na próxima fatura; cancelamento pendente identificado e cobrança contestada com prazo e SMS) — causa: seleção de pontos
  fortes pela quantidade de etapas (corrigida em `STRENGTH_SELECTION_V2` e depois substituída pela V3, por papel no caso); o ajuste é real
  mas de materialidade baixa (a cliente acabara de dizer fatura e lançamento); a versão anterior da redação trazia o exemplo do caso
  ("fatura de agosto… mensalidade após o cancelamento") e a reescrita por repetição o perdeu; "Pela regra atual" e "Excelente" são
  ruído (o procedimento foi publicado depois da chamada — dado de demonstração); os detalhes mostram "Limites desta análise" com
  linguagem interna ("não foram confirmadas pela revisão") e um "Como aplicar" montado com redundância. Ponto não comunicado: a
  cliente disse "Eu cancelei e continuo pagando" e saiu sem ouvir o que acontece com o cancelamento pendente desde 02/07; a ação de
  regularizar é interna e a revisão ficou corretamente incerta; a análise reaproveitada julgou "Serviço cancelado, quando aplicável"
  não aplicável, e a revisão não reexaminava disposições "não aplicável" (corrigido depois em `CALL_REVIEW_V2`).
- **Não valida**: o planejador de indicadores com modelo real, a análise inicial da versão atual, outras chamadas, nem o efeito da
  nova seleção de reconhecimento no texto.
- Replay sem custo da mesma rodada (revisão congelada do artefato, para na composição):
  `scripts/feedback-engine/evaluation/larissa/replay-c07-paid.ts [--write-fixture]` → fixture
  `src/modules/feedback-engine/testing/c07-reviewed-analysis.json` (teste `strength-selection.test.ts`).

### Validação com análise inicial nova (C07, 01/10/2026, tarde) — reprovada na prioridade; corrigida localmente, não revalidada

Roteiro: `backend/scripts/feedback-engine/evaluation/larissa/validate-c07-fresh.ts --execute` (rodada paga única; padrão = ensaio
sem envio). Artefato: `results/validate-c07-fresh-paid-2026-10-01T18-46-57-958Z.json` (pedidos, respostas cruas por etapa, uso e
custo por requisição, versões, diagnóstico, brief, view e auditoria da composição). Versões executadas: análise
`CALL_ANALYSIS_LOGIC_V5` + prompt V3, revisão `CALL_REVIEW_V2`, composição V4 com prompts V6/V5. Identidade (Larissa Monteiro,
DEMO-OP-0001), transcrição (sha256 `7eee443a…`) e bases (versão + hash) conferidas antes; banco somente leitura; a memória do
motor no dev estava vazia (sobreposição em RAM; nada apagado nem invalidado); nada publicado, entregue ou notificado; gabarito fora
do contexto do motor; as propostas de 30/09 NÃO foram usadas.

- **Consumo**: 4 requisições (análise, revisão, redação, verificação), 0 bloqueadas, 0 novas tentativas; 52.069 tokens de entrada,
  16.807 de saída + raciocínio; US$ 0,1021 pela tarifa da avaliação (0,75 / 3,75 por milhão): análise 0,0388, revisão 0,0358,
  redação 0,0113, verificação 0,0162. Tetos 6 requisições / US$ 0,25, reserva de pior caso antes de cada envio.
- **Diagnóstico**: necessidade "contestar a mensalidade de R$ 59,90 faturada após o pedido de cancelamento"; condições verificadas:
  cancelamento pendente (T2, T7) e fatura paga (T10); caminho parcialmente correto (confirmado). Confirmadas: validação do titular
  (T3), contestar cobranças posteriores (T11, ação declarada), informar prazo (T12), abrir análise por cobrança após cancelamento
  (T11), prazo de cinco dias úteis (T12) — e três conclusões dadas a ABERTURAS de lista: "Quando o cliente já tiver pago a cobrança
  contestada, avaliar:" PARCIAL ("fixou o crédito sem avaliar estorno/transferência"), "Antes de encerrar, informar:" CUMPRIDA (T14)
  e "Perguntar:" CUMPRIDA (T16). Não observáveis: "Corrigir o status" (a análise propôs omissão; ação interna → rebaixada pelo
  código) e "Preservar a data da manifestação". 144 itens do caminho sem disposição (desfecho PARTIAL). Revisão: 8/8 confirmadas,
  caminho confirmado; os 2 descartes e as 144 linhas pedidas ficaram SEM resposta e o código aceitou o silêncio.
- **Mensagem exata**: título "Contestação de cobrança", subtítulo "Atendimento de 21/08/2026"; card "Bom registro da contestação e
  do prazo de retorno. Daqui para frente, quando a fatura já estiver paga, avalie opções como estorno ou transferência bancária em
  vez de fixar crédito."; corpo:
  > Você identificou que o pedido de cancelamento de 2 de julho estava pendente, registrou a contestação dos R$ 59,90 e informou com
  > clareza o prazo de cinco dias úteis com retorno por SMS.
  >
  > Em relação ao pagamento já realizado, você informou que o valor retornaria como crédito na próxima fatura caso a contestação
  > fosse aprovada. Nas próximas chamadas em que o cliente já tiver pago a cobrança contestada, vale avaliar opções como estorno ou
  > transferência bancária, em vez de fixar apenas o crédito na fatura seguinte.
  >
  > Além disso, se você ainda não tiver corrigido o status do cancelamento no sistema, lembre-se de conferir essa atualização para
  > regularizar o pedido pendente.

  Detalhes: "Para entender este retorno" (procedimento publicado depois da chamada) e o ponto em aberto "Corrigir o status" com a
  regra literal. Verificação: 5/5 frases sustentadas, mensagem com valor, nada perdido (1 redação, 1 verificação).
- **Comparação com a rodada da manhã**: saiu o superlativo ("Excelente condução") e a narração de validação/escuta; entrou o
  reconhecimento do que importou no caso; o centro do caso aparece pela primeira vez, como ponto em aberto condicional, sem acusar
  ação interna; "Limites desta análise" com linguagem da revisão sumiu. Mas o PONTO PRINCIPAL virou um erro.
- **Avaliação** (leitura contra transcrição e procedimento): *correção* — reprovado: a seção 34 lista opções a avaliar (crédito em
  conta futura, estorno, compensação, transferência quando prevista…); crédito na próxima fatura é uma delas, oferecido condicionado
  à aprovação, sem prometer devolução imediata; tratar a escolha como ajuste é o erro de alternativas de 30/09 entrando por outra
  porta. *Prioridade* — o ajuste errado virou o card; o centro (a cliente disse "Eu cancelei e continuo pagando" e saiu sem ouvir o
  que acontece com o cancelamento) só aparece pela ação interna, não como algo a comunicar. *Utilidade* — 1º parágrafo reconhece
  decisões concretas; 3º orienta sobre o centro sem acusar; 2º pode levar a Larissa a mudar uma conduta correta. *Naturalidade* —
  boa. *Rastreabilidade* — cada frase ligada a fala e regra; o erro estava no diagnóstico confirmado (o verificador conferiu contra
  um fato confirmado).
- **Pergunta-guia** ("Esse retorno ajuda a Larissa a entender uma decisão acertada ou agir melhor numa situação concreta?"): em
  parte — "Você identificou que o pedido de cancelamento de 2 de julho estava pendente, registrou a contestação dos R$ 59,90 e
  informou com clareza o prazo…" e "se você ainda não tiver corrigido o status do cancelamento no sistema, lembre-se de conferir…"
  ajudam; "vale avaliar opções como estorno ou transferência bancária, em vez de fixar apenas o crédito" orienta mal. **Não
  aprovável.** Havia evidência suficiente de um ponto material (cancelamento pendente, cliente continua pagando, nada dito sobre o
  cancelamento) que o motor não comunicou como tal — falha registrada.
- **Causa** (código): conclusões dadas às frases que ABREM listas iam à revisão sem os itens (o contexto de lista só existia para
  itens: `sameList` vazio); a revisora leu `NOT_A_LIST` e confirmou; a proteção de alternativas nunca disparou; os itens da
  recapitulação (inclusive "Serviço cancelado, quando aplicável") ficaram sem leitura própria; o silêncio da revisão sobre linhas e
  descartes pedidos foi contado como revisão.
- **Correção local** (zero IA): `CALL_REVIEW_V3` / `LIST_OPENING_V1` / `CALL_ANALYSIS_LOGIC_V6` / prompt da análise V4 /
  `COVERAGE_REQUEST_V1` (ver "Análise de chamada"); testes `domain/list-opening-review.test.ts`.
- **Replay sem custo das MESMAS respostas pelo código corrigido** (`scripts/feedback-engine/evaluation/larissa/replay-c07-fresh.ts`,
  fetch bloqueado, para na composição): as três conclusões de abertura deixam de ser confirmadas (`LIST_OPENING_NOT_READ_AS_LIST`);
  brief = 0 ajustes; reconhecimentos "Cobrança após cancelamento" (central), validação do titular (rotina) e abertura de análise por
  cobrança após cancelamento (central); ponto em aberto "Corrigir o status"; nota da versão do procedimento. O pedido de revisão do
  código atual levaria as 3 aberturas com os itens, 21 itens englobados como alvos próprios (inclusive "Serviço cancelado, quando
  aplicável"), 2 outros descartes e 40 linhas priorizadas (83 retidas pelo teto, registradas).
- **Não validado** (sem nova rodada, conforme o limite): o que uma revisora real responde ao pedido novo (se contesta "Serviço
  cancelado, quando aplicável", se lê a lista de alternativas como tal), a mensagem composta a partir do diagnóstico corrigido,
  outras chamadas da Larissa, indicadores e a operação.

### Aplicabilidade × evidência e argumentários (01/10/2026, noite) — zero chamada paga

Implementação inteira com modelo SIMULADO (`testing/no-external-ai.ts`). Os testes provam o que o CÓDIGO faz com a leitura
semântica — nunca que o modelo real a faz certo:

- `semantic-auditability.test.ts` (13): consulta interna não verbalizada (sem acusação, limite de cobertura); declaração ("Já
  consultei aqui no sistema" → `DECLARED`, nunca elogio); intenção ("Vou verificar…" → `INTENDED`); informação obrigatória ausente
  com aplicabilidade e oportunidade → desvio confirmado; a mesma informação por paráfrase cumpre; aplicabilidade incerta;
  transcrição incompleta; o mesmo verbo ("valide…") em conversa × em sistema; sistemas desconhecidos (PLATON, ZEUS-7, KRONOS-X,
  FINANCEIRO-ORION) e redação inteira trocada com a mesma leitura → a mesma conclusão; regra composta (parte interna × parte
  comunicada, parte faltante, parte não literal recusada); denominadores (não observável e não aplicável fora).
- `argument-scripts-engine.test.ts` (12): estrutura preservada no contexto (condição e exemplo sem handle, deve × pode, grupo de
  alternativas como uma exigência); duplicidade exata e apontada pela leitura; conversão antiga nunca vira critério; dívida atual ×
  já paga × corrigida durante a conversa × "se aplica" sem fala verificada; ponto ausente confirmado só com a fala da situação;
  "pode" não feito e alternativa escolhida; conflito registrado sem acusação; exemplo sugerido nunca na revisão nem no redator;
  argumentário nunca vira material da base; identidade entre versões.
- `argument-scripts/domain/argument-script.test.ts` (9): chaves estáveis, critérios por campo, prontidão para publicar, escopo geral
  × específico, vigência; administração por área (grupo não cria "todos", nem outro grupo; somente leitura do que vem de cima;
  publicação nunca retroativa).
- Postgres: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run argument-scripts-proof` (conversão do cadastro antigo; API real com
  sessão e papéis; versão imutável; vigência futura; motor lê a versão da data da chamada no escopo do colaborador; encerrar/
  reativar; rota antiga só leitura; memória com critério de argumentário e regra composta).
- Testes antigos ajustados porque a REGRA mudou (não para passar): condição deixou de vir de palavras (`diagnosis-confirmation`),
  título de seção virou pista (`feedback-engine-domain`), oportunidade de encerramento vem da leitura (`feedback-engine-domain`),
  ação de sistema deixou de ser ponto em aberto / registro só declarado deixou de ser acerto (`exclusion-review`,
  `composition-value`, `list-opening-review`).

**Replay sem custo** (`evaluation/larissa/replay-c07-v7.ts`, artefato `results/replay-c07-v7-*.json`): as respostas PAGAS da rodada
de 01/10 à tarde (contrato anterior) passam pela lógica V7, com a numeração antiga de handles traduzida para a nova. Resultado: as
conclusões dadas às aberturas de lista continuam não confirmadas (0 ajustes; "avalie estorno em vez de crédito" não volta);
"Corrigir o status" e "Preservar a data da manifestação" saem do redator (limites de cobertura, sem lembrete "se você ainda não…");
"Contestar cobranças posteriores" (registro só DECLARADO) deixa de ser elogiado como execução; reconhecimentos que ficam: análise
de faturamento em até cinco dias úteis, informar prazo, validação do titular. Replay não valida o que o modelo responderia ao
contrato V5 nem a redação.

### Correções pontuais + rodada real V8 (02/10/2026) — REPROVADA nos cenários avaliados

**Correções antes da rodada (zero IA, testes simulados):**
- **Defeito A** — a revisão reintroduzia conclusões sobre execução interna: contestar o descarte de uma ação interna como
  CUMPRIDA/PARCIAL passava (só "não cumprida" era barrada) e chegava CONFIRMADA, "fora da conversa" e "conduta observada".
  Agora (`CALL_REVIEW_V5`, `CALL_ANALYSIS_LOGIC_V8`, `EVIDENCE_POLICY_UNIFIED_V1`):
  - `reviewedObservabilityOf`: a revisora pode corrigir a leitura semântica (é algo a comunicar), nunca manter "ação interna" e
    tratá-la como comprovada;
  - execução fora da conversa = reaberta, com a fala como declaração/intenção (`executionClaim`);
  - passada final sobre TODA conclusão, de qualquer origem;
  - o brief recusa acerto/desvio fora da conversa.

  Provas: `exclusion-review.test.ts` e `application/evidence-policy-end-to-end.test.ts` (até o pedido ao redator e a memória). Os
  testes falham sem a correção.
- **Defeito B** — duplicidade por texto igual descartava a exigência do argumentário antes da análise. Agora
  (`DUPLICATE_BY_MEANING_V1`, prompt V6):
  - todo item de argumentário tem handle;
  - texto igual vira só anotação (`context.sameText`, "mesmo texto de [L-n] … compare a condição, a finalidade, o escopo e a
    modalidade");
  - duplicidade só pela leitura que declara condição, finalidade, escopo e modalidade iguais, com o porquê e com a linha da base
    avaliada (`duplicateCheckOf`);
  - aceita = avaliada uma vez, com as duas origens (`alsoRequiredBy`); recusada = as duas avaliadas.

  Provas: `argument-scripts-engine.test.ts` (prazo de 24 h na segunda via × desbloqueio, duplicidade verdadeira com outras
  palavras e com a mesma frase, recusas).
- **Argumentário em reavaliação**: `ArgumentScriptSource.perspective = CURRENT_RULE_REEVALUATION` — o prompt diz que não estava
  vigente na data da chamada e o desvio vira `ruleBasis` de reavaliação (orientação, nunca culpa). O script preparado
  `validate-c07-v7.ts` (que simulava vigência) foi aposentado.

**Rodada** (`evaluation/larissa/evaluate-round-v8.ts`; gabarito registrado ANTES em `round-v8-ground-truth.md`, nunca enviado ao
motor):
- Escopo: só a Larissa — C07, DEMO-INT-0001-08 (segunda via com app falhando e conta antiga paga com atraso) e TMA de agosto.
- Orçamento: um só, global, 12 requisições / US$ 0,60.
- Fontes: os 6 argumentários do anexo em memória como REAVALIAÇÃO.
- Isolamento: banco somente leitura, memória em RAM, nada publicado.
- Consumo: **11 requisições, US$ 0,2486** (117,5 mil tokens de entrada, 42,8 mil de saída + raciocínio).
- Artefato: `results/round-v8-paid-2026-10-02T12-32-06-597Z.json`.

| Cenário | Resultado | Pontos |
|---|---|---|
| A — C07 | **sem mensagem** (abstenção) | Acertos: argumentários todos "não se aplica"; "Corrigir o status" como limite de cobertura (declaração); nada de "estorno em vez de crédito". Problemas: o modelo deu "Existir cobrança após cancelamento não concluído" (abrir análise) como CUMPRIDA e confirmada pela fala "Registrei a contestação…" (declaração lida como conduta — **semântico, só registrado**), o brief ofereceu isso como reconhecimento e a memória o conta como acerto. O verificador barrou a frase (OVERREACH), a correção não pôde ser verificada (teto de 5 da fase) e o motor se absteve. |
| B — segunda via | **mensagem só de elogios — reprovada** | Acertos: "Segunda via" se aplica pela situação; "Contas em atraso" não (conta antiga quitada); a pergunta do Wi-Fi não aciona "Problema técnico". Problemas: a revisão CONFIRMOU dois desvios (reenvio para e-mail informado na hora sem validação; protocolo não informado), mas a decisão os derrubou — **defeito de código** (abaixo). Os itens do argumentário ficaram sem avaliação (teto de cobertura) e houve elogio ao SMS para um número não validado. |
| C — TMA ago | **mensagem publicável, parcialmente correta** | Números oficiais exatos (357 s, meta 400, julho 382), reconhecimento sem causa; investigação = reconhecimento por contrato (agente sem capacidades; julho com 1 chamada gravada). Problema: "nas chamadas analisadas… sem desvios recorrentes" generaliza 2 de 14 chamadas (uma delas a B, afetada pelo defeito). |

**Defeitos achados na rodada:**
1. **Código, corrigido depois — ainda NÃO revalidado com modelo** (`REVIEW_FOCUS_AS_SENT_V1`, revisão V6, lógica V9): a decisão
   recalculava o foco da revisão com as linhas que a PRÓPRIA revisão avaliou na mesma resposta. Isso criava "item com irmão
   cumprido" que a revisora nunca viu e derrubava confirmações explícitas. Agora a decisão usa o foco enviado; a mesma fala
   provando um irmão continua barrando. Replay sem custo das mesmas respostas (`replay-round-v8.ts`): B passa a ter os dois
   desvios confirmados no brief; o texto não foi regenerado.
2. **Código, corrigido depois — não revalidado** (`ARGUMENT_COVERAGE_PRIORITY_V1`): itens de argumentário que se aplica vêm
   primeiro no pedido de cobertura.
3. **Semântico (modelo), não corrigido**: item-condição de "Abrir análise quando:" lido como conduta na conversa e cumprido por
   declaração. Corrigir por palavras é proibido; precisa de avaliação/contrato com modelo.

**Parecer:** a versão NÃO passou nos cenários avaliados e ainda não há base para piloto controlado. Antes, é preciso: uma nova
rodada paga que revalide 1 e 2 (B deve sair com os dois desvios e sem elogio sem base); tratar 3; e orçamento por mensagem que
comporte a correção da redação (A se absteve pela divisão declarada). Não demonstrado: diagnóstico profundo de indicador (sem
ferramentas na configuração persistida; pares desligados); paráfrase e "deve × pode × alternativa" dos argumentários em conversa
real.

### Correções pós-V8 + rodada real V9 (02/10/2026)

**Correções (zero IA nas regressões; modelo e revisora simulados):**
- **Obrigação completa** (`OBLIGATION_READING_V1`; prompt da análise V7, lógica V10, revisão V7 / prompt V5). Sem regex, lista de
  verbos ou exceção para frases:
  - a análise diz como a linha se liga à frase que abre a lista (`lineRole`: ação × condição da ação × conteúdo × opção);
    `requiredAction` é a ação da abertura quando o item é condição;
  - leituras do próprio modelo que se contradizem (ação interna × "na conversa") ficam com a mais restrita;
  - fala oferecida como prova de execução fora da conversa = declaração (`executionClaim`), qualquer que seja o rótulo;
  - na conversa, `DECLARED_ACTION` nunca é acerto (`DECLARATION_IS_NOT_CONDUCT`); a fala que só mostra a condição também não
    (`CONDITION_IS_NOT_CONDUCT`);
  - a revisora diz o que a evidência mostra (`evidenceReading`) e se a conclusão depende de algo fora da fala
    (`outsideDependency`); o código decide (`obligationReadingOf`): acerto só com a ação na conversa; desvio só com ausência ou
    conduta contrária; dependência de execução fora da fala nunca confirma e devolve a leitura para "fora da conversa";
  - resposta da revisão sem essas leituras (contrato V7) = nada confirmado (`REVIEW_INCOMPLETE`); respostas antigas = `LEGACY`
    (replays).
- **Caminho** (`PATH_COMPLETENESS_V1`): "caminho correto" só com todas as etapas do caminho que se aplicam verificáveis e
  confirmadas; senão não determinado (`scenario.pathCompleteness`). A conduta observável continua reconhecível etapa por etapa.
- **Decisão sobre o pedido enviado** (`REVIEW_FOCUS_AS_SENT_V2`): `ReviewInput.sentClaims` guarda as propostas como foram à
  revisora; a coerência da própria resposta (irmão avaliado pela revisora com a mesma fala) virou `REVIEW_SELF_INCONSISTENT`, não
  foco novo.
- **Argumentário aplicável**: o contrato exige disposição de cada item; o que ficar sem resposta continua "não avaliado" (análise
  parcial), e o que só a revisão avaliou nunca é confirmado.
- **Ausência de padrão ≠ ausência de falha** (`ABSENCE_OF_PATTERN_V1`, investigação V6, composição V6, prompts V8/V7): o brief do
  indicador não diz mais "nenhum desvio apareceu de forma recorrente"; vira limite com universo, amostra e qualidade
  (`absenceOfPatternStatement`, `SegmentEvidence.quality`), ou fato restrito à amostra quando ela é suficiente e completa.
- **Resultado bom não fecha a pergunta do recorte** (`INVESTIGATION_CLOSURE_V3`): sem localização do sistema (volume insuficiente
  entre meses), "há recorte materialmente pior no período?" é pergunta aberta para as ferramentas; uma consulta responde.

Provas: `domain/obligation-reading.test.ts` (18), `domain/absence-of-pattern.test.ts` (5), caso novo em
`application/evidence-policy-end-to-end.test.ts` (diagnóstico → revisão → memória → agregação → pedido ao redator → mensagem).
Replay sem custo das respostas pagas da V8 pela lógica nova (`replay-round-v8.ts`, contrato LEGACY): na C07, "Existir cobrança
após cancelamento não concluído" passa a não observável com a fala como declaração, e o caminho "correto" vira não determinado; na
B o código sozinho NÃO tira a acusação do e-mail nem o elogio do SMS — isso depende da leitura do modelo no contrato novo.

Gabarito revisado ANTES da rodada (`round-v9-ground-truth.md`, escrito por Claude — não é validação humana independente): e-mail
novo sem validação adicional = não determinável (acusação inaceitável); SMS para outro número = sem acusação e sem elogio de canal
autorizado; protocolo antes da transferência = desvio de comunicação observável (mencionar ≠ informar o número); sem número
predefinido de desvios.

**Rodada real V9** (`evaluation/larissa/evaluate-round-v9.ts`; artefato `results/round-v9-paid-2026-10-02T13-39-47-453Z.json`):
- Orçamento global 16 / US$ 0,60, sem teto por fase: cada cenário recebe o global menos a reserva mínima dos seguintes (B 4, C 3).
- Configuração ISOLADA só no perfil em memória: INDICATOR_ANALYSIS, SEGMENTATION, INTERACTION_ANALYSIS, KNOWLEDGE.
- Consumo: **15 requisições, US$ 0,3444** (143.950 tokens de entrada, 63.055 de saída + raciocínio); A 6, B 6, C 3; nenhum
  bloqueio; nenhuma terceira chamada analisada.

| Cenário | Resultado | Pontos |
|---|---|---|
| A — C07 | **publicável, só reconhecimento — reprovado em cobertura/utilidade** | Sem acusação, sem elogio a execução interna como ponto principal, caminho não afirmado como completo, nada de estorno ou argumentário. Mas o ponto material (o que acontece com o cancelamento pendente) não foi levantado: a recapitulação foi dada como cumprida pela abertura da lista e a revisora não respondeu nenhum dos 52 itens englobados; 57 linhas do caminho ficaram fora do pedido de cobertura. A memória conta "Após a validação, consultar:" (21 consultas, execução em sistema) como cumprido — a revisora leu a lista como alternativas. |
| B — segunda via | **publicável — reprovado** | Sem acusação do e-mail (a revisão leu a prova como declaração) e os 4 itens do argumentário avaliados. Mas: o ponto obrigatório "confirmar fatura ou parcelamento" foi confirmado como NÃO cumprido por leitura literal (o operador confirmou "a fatura de julho") e virou orientação na mensagem; "Testar, quando possível, outro canal" virou desvio sem ler o "quando possível"; "SMS com link oficial, quando disponível e autorizado" ficou cumprido na memória; o protocolo antes da transferência só foi apontado pela revisora (linha sem resposta da análise) e, por desenho, não foi confirmado. |
| C — TMA ago | **publicável, só o resultado oficial — números certos, investigação com ferramentas NÃO demonstrada** | 357 s, meta 400, julho 382, sem causa nem "sem desvios"; limites de amostra nos detalhes. O planejador fez a pergunta do recorte, mas pediu `segment_indicator` sem dimensão — recusada — e a única rodada permitida acabou. |

**Corrigido depois da rodada — ainda NÃO revalidado com modelo:**
- `SEGMENT_DIMENSION_DEFAULT_V1`: dimensão ausente com uma só permitida pela estratégia vem da configuração (dimensão errada continua
  recusada). Replay das ferramentas (`replay-round-v9-tools.ts`, zero modelo): por assunto, nenhum recorte com volume mínimo pior que
  o conjunto; por dia, 04/08 atípico (377,8 s × base 354,3 s) — um recorte que abriria a pergunta das chamadas daquele dia.
- `CONDITION_TURNS_V1`: item lido como condição e dado como cumprido com a fala que a própria análise citou como condição do cenário
  → não observável. Replay (`replay-round-v8.ts --contract V7` sobre o artefato V9): o item "Aplicável quando houver… falha" da B sai
  dos acertos.

**Não corrigido (leitura do modelo):** confirmação por paráfrase lida literalmente; "quando possível" sem condição declarada;
"consultar" (sistema) lido como conversa; lista cumulativa lida como alternativas; recapitulação dada como cumprida sem conferir o
item do cancelamento. **Desenho:** linha avaliada só pela revisora nunca é confirmada — o protocolo da B ficou de fora por isso; o
roteiro reservou 4 requisições para a mensagem de C e só 2 foram usadas (uma rodada de planejamento a menos).

**Parecer:** nenhum cenário passou por inteiro (A e B reprovados; C correto, mas sem a investigação pedida). Sem base para piloto
controlado.

### Contrato orientado ao caso + rodada real V10 (02/10/2026, noite)

Pedido: tratar a CAUSA dos erros (modelo × contrato × código × composição), não mais uma rodada de texto. Orçamento global da tarefa
(comparação + rodada, nunca reiniciado, livro-razão `results/round-v10-budget-ledger.json` com reserva do pior caso antes de cada
envio): **16 requisições, US$ 0,3045** (teto 16 / US$ 0,60). Avaliação completa: `evaluation/larissa/round-v10-evaluation.md`
(avaliador = Claude contra os gabaritos registrados antes; não é validação humana).

**Causas encontradas no contrato atual (V7/V9), antes de qualquer chamada:**
- Unidade = LINHA da base: a análise devolvia 12–21 critérios + até 144 itens "sem avaliação"; o teto de 40 linhas por revisão
  cortava o que sobrava sem dizer se era material; uma abertura de lista com MET virava acerto global de consultas internas.
- Achado só da revisora era descartado por desenho (`REVIEW_ONLY`, nunca confirmado) — foi o que tirou o protocolo da B na V9.
- 13,4 mil caracteres de instruções com regras repetidas/contraditórias entre análise e revisão; título/abertura/condição chegavam
  em linhas separadas e a condição podia ser lida como conduta.
- Planejador recebia o NOME das ferramentas sem o contrato dos argumentos (obrigatório, valores permitidos): `segment_indicator` sem
  dimensão era recusado e a recusa encerrava a rodada como se fosse resposta.
- Parâmetros enviados: mesmo modelo/schema dos dois lados, sem temperatura/raciocínio explícitos, nada cortado (`STOP`).

**Comparação focal** (`compare-contracts-v10.ts`, 3 requisições, US$ 0,1149; mesmas transcrições, fontes, perspectivas, modelo e
parâmetros; gabarito fora do contexto; V9 como referência, não estatística): a alternativa `OBLIGATIONS_V1` (necessidade → fontes
aplicáveis → obrigações materiais COMPLETAS com ação, condição e se ela vale, itens e modo ALL/ANY/SEQUENCE, onde se cumpre, achado,
papel de cada fala CONDUCT/DECLARATION/INTENTION/CONDITION/CUSTOMER, oportunidade, materialidade, orientação da fonte + o que não
avaliou) teve 5,9 mil caracteres de instrução, custo igual ou menor (B: US$ 0,047 × 0,085) e achou **sozinha** o protocolo antes de
transferir (B); não acusou "fatura ou parcelamento", "testar outro canal" nem elogiou o SMS. Negativos: na A repetiu consulta interna
como cumprida, rotulou a declaração "abrir análise" como conduta e leu estorno × crédito como parcial; na B acusou o e-mail com falas
que ela mesma marcou como intenção/declaração e pôs "verificar/registrar" como partes feitas. O ponto material da A (cancelamento
pendente) não foi achado por nenhum dos dois. Caso sintético de paráfrases (`synthetic-paraphrase-case.ts`, gabarito
`round-v10-synthetic-ground-truth.md` registrado antes): 9/9 — sintético, não substitui as chamadas reais. Confusão registrada: a
alternativa traz princípios novos junto com a estrutura; a comparação não separa os efeitos.

**Incorporado** (prompt medido CONGELADO; o resto no código e na revisão — nada por palavra-chave):
- `CALL_ANALYSIS_PROMPT_V8` / contrato `OBLIGATIONS_V1` (`domain/obligation-analysis*.ts`): a resposta antiga (linhas) continua lida
  (`parseAnalysisProposals` decide pela forma). Identidade da obrigação ancorada na ORDEM DO DOCUMENTO das fontes (independe da ordem
  em que o modelo as citou); várias fontes = uma exigência com proveniência de todas; título literal = abertura + itens incluídos
  (sem itens, o título da seção).
- `CALL_ANALYSIS_LOGIC_V11` (`domain/obligation-verification.ts`): consequências por CÓDIGO das leituras do PRÓPRIO modelo —
  `DECLARATION_DOES_NOT_PROVE_CONDUCT` (cumprido/descumprido só com fala de conduta), `NO_CONDUCT_EVIDENCE`, `ALTERNATIVE_DONE`,
  `ITEMS_COMBINATION_UNCLEAR`, `ITEMS_CONTRADICT_FINDING`, `PART_NOT_VERIFIABLE` + integridade de sempre (citação, oportunidade,
  fora da conversa = limite). Itens de argumentário aplicável que a análise não tocou viram lacuna de cobertura para a revisão; o
  que ela declarou não avaliado vira `N-n`.
- `OBLIGATION_REVIEW_V1` (`domain/obligation-review.ts`, `application/review-obligations.ts`): revisão por obrigação (veredito +
  leitura da evidência + dependência de fora + leitura da lista), avalia lacunas e aponta obrigações materiais de fora.
- `REVIEW_DISCOVERY_CONFIRMATION_V1`: achado adverso só da revisão (aplica, na conversa) vai a UMA confirmação focal (etapa
  `CALL_CONFIRMATION`, só os achados pendentes + transcrição inteira); sem orçamento/falha = inconclusivo com o motivo
  (`CONFIRMATION_NOT_RUN`, `PENDING_CONFIRMATION`); MET só da revisão não é priorizado (`REVIEW_DISCOVERY_NOT_PRIORITIZED`). Vale
  também no pipeline por linha (revisão V8 / prompt V6 com materialidade por linha). Achado da revisora igual a uma obrigação
  existente fica registrado nela (`REVIEW_ALSO_LISTED_AS_MISSED`).
- `TOOL_ARGUMENT_CONTRACT_V1` (planejador prompt V4): especificação dos argumentos por ferramenta no prompt e no schema da resposta
  (propriedades reais, enum de ferramentas e de dimensões permitidas); argumento ausente = valor da configuração só com UMA opção
  válida, senão recusa ESTRUTURADA devolvida ao planejador; rodada só de recusas corrigíveis continua; recusada ≠ respondida.

**Rodada real** (`evaluate-round-v10.ts`, 13 requisições, US$ 0,1896; análise de A/B = resposta paga da comparação):
- **A (C07)** — consultas internas, "abrir análise" e estorno × crédito saíram dos acertos/descumprimentos (declaração, fora da
  conversa, combinação indefinida); validação, identificação, recapitulação e dúvidas confirmadas; marca "Vivo" × "Conecta" parcial
  (leitura literal da base; provável inconsistência da massa demo) sustentou o caminho "parcialmente correto". **Cancelamento
  pendente não achado.** Mensagem só de reconhecimento, com uma pressuposição leve ("respaldando a verificação do histórico").
- **B (DEMO-INT-0001-08)** — protocolo antes de transferir PARCIAL confirmado; e-mail barrado pelo código (intenção/declaração) e,
  refeito pela revisora, INCERTO na confirmação focal; os 4 itens do argumentário avaliados pela revisão ("fatura ou parcelamento"
  cumprido por paráfrase; parcial da revisora REFUTADO na confirmação). **Mensagem: abstenção `MODEL_BUDGET_EXHAUSTED`** — o código
  recusou a frase que reconhecia a parte feita do ponto parcial (o ponto chegava ao redator sem os itens), o reparo gastou a última
  requisição e a verificação dele não coube.
- **C (TMA ago/2026)** — 4 ferramentas executadas com argumentos válidos (assunto, dia fora do padrão, composição, períodos);
  04/08 atípico virou recorte não examinado (sem orçamento para analisar chamadas); mensagem só com resultado, meta e comparação.

**Corrigido depois da rodada — ainda não revalidado com modelo:** itens da obrigação entram no brief como partes da mesma exigência
(`sameList`); orientação não repete a regra que já é fonte da obrigação; duplicata da revisora registrada; título com a seção quando
a abertura não tem itens. Replay sem custo (`evaluate-round-v10.ts --replay`, mesmas respostas pagas): A e C idênticos; **B produz
mensagem** (ponto parcial + "informe também o número do protocolo antes de transferir") — replay, não saída paga.

**Parecer:** diagnóstico melhor que a V9 nos três cenários (nada interno virou acerto/erro, nenhuma acusação literal, achado da
revisão tratado), mas **nenhum cenário passou por inteiro**: A sem o ponto material e sem orientação; B sem mensagem na saída paga;
C correto e sem exame do recorte. Sem base para piloto controlado. Nunca repetir a comparação nem a rodada V10 (o livro-razão está
esgotado e o harness recusa).

### Coerência do diagnóstico, ocorrências, listas em jogo e investigação adaptativa (02/10/2026, tarde) — zero chamada paga

Corrige os defeitos que a V10 expôs sem mudar arquitetura nem Workflows (`CALL_ANALYSIS_LOGIC_V12`, `OBLIGATION_REVIEW_PROMPT_V2`,
`INDICATOR_INVESTIGATION_V7`, `ENGINE_INVESTIGATION_TOOLS_V3`, planejador prompt V5, `ENGINE_BUDGET_V2`). Nenhuma decisão de sentido
por palavra: o código confere referências, citações, estrutura, permissões, orçamento e consistência das respostas estruturadas.

**Monitoria — o diagnóstico vigente reflete a evidência final**
- `PATH_VIGENTE_V1` (`obligation-verification.ts › vigentePathOf`): quando alguma leitura da análise não se sustentou (refutada, não
  confirmada, rebaixada) ou a revisão acrescentou um achado, o caminho seguido e a justificativa VIGENTES saem das conclusões finais
  (`pathRationaleSource: FINAL_EVIDENCE`); a leitura original fica em `scenario.analysisReading` (auditoria, e é o que a revisão
  recebe para conferir). Na C07 a justificativa ainda dizia "crédito … conduta incoerente" depois que a revisão não sustentou isso —
  agora diz "Conclusão(ões) da análise que não se sustentaram e ficaram fora do diagnóstico: …". Nada é apagado por regex.
- Desvio de caminho exige etapa MATERIAL descumprida confirmada: só desvio de baixa materialidade não sustenta "etapas materiais
  faltando" (nota de auditoria).
- `CONDUCT_OCCURRENCE_V1`: a revisão diz `sameConductAs` quando duas conclusões julgam a MESMA conduta no MESMO momento; o código só
  aceita a ligação com as duas confirmadas, do mesmo lado (desvio × acerto) e com oportunidade ou turno de evidência em comum — senão
  recusa e registra (`DIFFERENT_MOMENT`, …). Cada regra continua registrada na memória (cobertura por regra) com a mesma
  `occurrence.key` (`OC-…`); `coverage.occurrences` = regras × ocorrências; a mensagem recebe UM ponto com as duas bases normativas.
- `LIST_COVERAGE_V2`: itens das listas da fonte que as obrigações usam e que ninguém avaliou vão à revisão como CONTEXTO da obrigação
  (`listItemsInPlay`, rodízio entre listas, teto 60): ela aponta em `missed` os que valiam neste caso e faltaram (confirmação focal,
  como todo achado só da revisão). Nenhum item vira falta, acerto ou "não avaliado" por estrutura — a V1 desta regra criava um
  "não avaliado" por item e, no replay da C07, marcou 58 (listas de opções, gatilhos, referência). Cobertura: encontrados ×
  mostrados × apontados.

**Indicador — investigação adaptativa com ferramentas**
- `TOOL_RESULT_VIEW_V1` (`domain/tool-result-view.ts`): resultado de ferramenta ao planejador inteiro quando cabe; senão listas
  cortadas por ITEM inteiro (JSON válido) com o que ficou de fora declarado (`omitted`), orçamento por rodada repartido com piso;
  o restante de qualquer F-n por `inspect_result` (sem nova consulta, sem IA; só aparece depois que há resultado). Antes: corte em
  3.000 caracteres no meio de uma lista. Estado explícito de cada consulta (ok, sem dados, insuficiente, recusada, falhou, não
  executada por orçamento) — só "ok" responde.
- `PLANNER_QUESTIONS_V1`: o planejador pode abrir até 2 perguntas por rodada (H1–H3) junto de consultas que as investigam; elas
  mantêm a investigação andando e, ao parar, são resolvidas só com consultas CONCLUÍDAS (estado ok) ou deixadas de lado com o
  porquê; sem decisão = deixada de lado com violação registrada. Nunca viram fato nem limitação da mensagem.
- Comparabilidade do recorte por dia como FATO (nunca decisão): desvio da base em % (`detect_anomalies`) e chamadas gravadas com
  transcrição × volume medido pelo indicador no dia (denominador). No replay da V10: "04/08: 378 s contra 354 s (+6,6%). Chamadas
  gravadas: 1; volume medido: 31."
- Nota ao colaborador sem funcionamento interno (nada de orçamento/rodadas); recorte deixado de lado COM justificativa não gera nota.

**Orçamento** — `ENGINE_BUDGET_V2`: reserva de 2 chamadas para redação + verificação que análise, revisão, confirmação e
investigação não podem gastar (24 mil tokens de entrada ≈ 2× o maior par medido nas rodadas V8–V10; 30 mil recusavam o
planejamento sob o teto de custo do ensaio); o planejador vê `modelCallsLeft`; a reescrita só começa se ela e a nova verificação
couberem (`REPAIR_SKIPPED`, vale a primeira versão).

**Provas (sem IA):** `application/diagnosis-coherence.test.ts` (falha material confirmada → ponto com regra e orientação; ação
interna nem acusação nem elogio; paráfrase; refutada fora de todos os campos com a leitura original na auditoria; só baixa
materialidade; mesma conduta em duas regras × ligação recusada; item de lista pela revisão → confirmação → redação),
`application/investigation-adaptive.test.ts` (pico além da visão compacta → recorte → H1 → `inspect_result` → parada com
justificativa, sem causa e sem chamada paga; recusa × falha × sem dados; orçamento com reserva), `composition-value.test.ts`
(reescrita que não cabe), `obligation-contract.test.ts` (rodízio das listas).

**Replay sem custo da V10** (`evaluate-round-v10.ts --replay`, mesmas respostas pagas, agora com o USO gravado — sem ele o medidor
contava a reserva máxima e recusava etapas que a rodada paga executou): A publica o mesmo texto (as respostas gravadas não viram
os itens novos da lista), com caminho vigente "não determinado" e a justificativa sem a acusação do crédito; B publica (ponto
parcial com os itens feitos/não feitos — correção anterior; a reserva não foi o fator); C com o recorte 04/08 carregando +6,6% e
1 de 31, não examinado porque o ensaio não permitia análises de chamada. A revisão de A agora receberia "Serviço cancelado, quando
aplicável" (L615) e o item do checklist (L1364) como contexto — **corrigido, ainda não revalidado com modelo**.

### Ocorrências no diagnóstico da liderança, páginas no `inspect_result` e fatos da redação (02/10/2026, fim da tarde)

**Ocorrência de conduta até a tela** (migration 108, aditiva):
- `call_criterion_assessments.occurrence_key` + `occurrence_basis` (`REVIEW_SAME_CONDUCT` | `SINGLE_RULE` | null). A chave inclui a
  chamada (`OC-<hash da chamada + regras>`): a mesma dupla de regras em outra chamada é outra ocorrência. `SINGLE_RULE` = a revisão
  podia ligar e não ligou; null = não determinável (análise antiga, contrato por linha, sem revisão) — nunca contada como única.
- `leadership-diagnostics.ts`: as contagens existentes continuam POR REGRA, com o mesmo significado (colunas do CSV com os mesmos
  nomes). À parte, `stats.occurrences`: condutas distintas avaliadas / em desvio (denominador próprio, só regras com ligação
  determinável), `sharedDeviationRules`, `undeterminedAssessedRules` e `basis` FULL/PARTIAL/NONE/EMPTY. Contagem por
  `interaction_id || occurrence_key` — nunca une chamadas. Método no cabeçalho do CSV e na tela.
- Tela de Diagnóstico: "Taxa de desvio por regra" + "Desvio por conduta" (com o aviso de análises antigas fora da taxa, ou "não dá
  para contar condutas distintas"); coluna "Condutas em desvio"; nas etapas, "N desvio(s) desta regra são a mesma conduta de outra
  regra"; na avaliação da chamada, "Mesma conduta avaliada também por: …".
- Prova contra o banco: caso K de `feedback-engine-workflow-proof` (análise → gravação → consultas → rota HTTP e CSV, com duas
  chamadas e um registro antigo).

**`inspect_result` em páginas** (`TOOL_RESULT_VIEW_V2`, ferramentas V4, planejador prompt V6): defeito reproduzido — um campo de
texto com mais de 6.000 caracteres voltava só com os primeiros 300, e nenhum deslocamento recuperava o resto. Agora:
- toda parte resumida é declarada em `omitted` com caminho navegável e tipo (`ITEMS` | `CHARS`);
- texto: janelas EXATAS de caracteres (padrão 4.000, até 6.000), `continueWith` com o deslocamento seguinte — várias páginas podem ser
  pedidas na mesma rodada e, emendadas, reproduzem o texto inteiro;
- lista: só os itens que couberam; a continuação começa no primeiro item NÃO mostrado (nada pulado quando a compactação corta antes do
  limite pedido); item maior que a página vem resumido com as partes dele declaradas;
- estados distintos: resultado inexistente, consulta sem dados (recusada/falhou/orçamento), campo inexistente, vazio, parcial,
  completo; contexto escalar do resultado original junto da página;
- a página pedida chega inteira ao planejador (não é recortada de novo pelo orçamento da rodada); nenhuma consulta refeita, nenhum
  modelo além do planejador.

**Fatos novos para a redação e a verificação** (composição V9 / verificação V8):
- `notVerifiableByRecording`: ações em sistema/registro (com "o operador disse que fez") — nunca feitas, base de elogio ou falha;
- `notAssessedInSameList` nos pontos: itens das listas da regra que ninguém avaliou — o reconhecimento não se estende à lista inteira.
  Na V10, a mensagem de A dizia "respaldando a verificação do histórico da linha" e "as orientações ficaram bem claras" sem que a
  verificação fosse observável nem os demais itens do encerramento avaliados.

Provas sem IA: `diagnosis-coherence.test.ts` (12), `investigation-adaptive.test.ts` (13, inclusive texto de ~15 mil caracteres com a
evidência no final e lista de 90 itens sem perda), `diagnostics-page.test.tsx` (6), prova de banco K.

**Rodada real V11** (`evaluate-round-v11.ts`; avaliação `round-v11-evaluation.md`, feita pelo Claude, não por humano). Nunca
repetir.
- Critérios `round-v11-ground-truth.md`, escritos antes da rodada.
- Código congelado em `round-v11-freeze.json` (120 arquivos).
- Livro-razão próprio: 15 de 17 requisições, US$ 0,2047.
- Origem: análises de A e B reaproveitadas da comparação V10 (como análise suspensa); revisão, confirmação, redação, verificação e
  planejamento rodaram novos.

Resultado:
- **A — reprovado.**
  - A revisão confirmou "Verificar: data da solicitação; falha na conclusão" como conduta na conversa: leu o RELATO do resultado da
    consulta (T7) como a consulta.
  - O cartão saiu "localizou no histórico o cancelamento…" e a mensagem só tem reconhecimentos.
  - O cancelamento pendente não foi apontado, embora os 57 itens das listas em jogo tenham chegado à revisão (`raisedByReview: 0`).
  - `notAssessedInSameList` funcionou: o reconhecimento da validação ficou em "nome e data de nascimento".
- **B — aprovado com ressalvas.**
  - Protocolo confirmado nas duas regras e uma orientação só, específica e daqui para frente.
  - A revisão não ligou as regras (`sameConductAs: null` em todas as respostas): 2 ocorrências `SINGLE_RULE`.
  - A revisão chegou a acusar o e-mail novo. A acusação ficou fora porque a análise já tinha a obrigação como não observável (regra
    de duplicidade), não por reavaliação.
- **C — não aprovado na cobertura.**
  - Números certos; mensagem = comunicado de resultado.
  - O roteiro deixou 0 análises para C (5 requisições restantes), a pergunta do recorte 04/08 fechou como `BUDGET` e o planejador não
    foi consultado de novo (1 de 2 rodadas).

Não exercitados com modelo real: `inspect_result` em páginas (o planejador não precisou) e a gravação de ocorrências no banco (a
rodada usa memória de ensaio).

### Relato × execução, divergência, necessidade central e fechamento da investigação (02/10/2026, noite) + rodada real V12

Princípio: **a transcrição prova o que foi dito e a conduta observável na conversa — nunca a execução em sistema.** "Encontrei aqui, o
pedido está aberto" comprova que isso foi dito à cliente; não comprova a consulta nem o estado. Vale para crítica e elogio, e para
diagnóstico, memória, cartão, corpo e métricas. Diagnóstico de cada problema da V11 (causa → correção mínima → prova sem API):
`scripts/feedback-engine/evaluation/larissa/round-v12-diagnosis.md`.

- **`OBLIGATION_SPEECH_EXECUTION_V1`** (revisão prompt V3, lógica `CALL_ANALYSIS_LOGIC_V13`): as conclusões vão à revisão SEM os rótulos
  da análise (onde acontece, papel das falas); a revisora lê na FONTE o ato exigido (`actPlace` IN | OUTSIDE | MIXED + `judgedPart` /
  `outsidePart`). O código só aplica consequências: OUTSIDE → não confirmado, fala preservada como DECLARADA (também com veredito
  incerto); MIXED → o status vale só para `judgedPart`, a parte operacional vira limite de cobertura; sem `actPlace` →
  `REVIEW_INCOMPLETE`. Caminho vigente: "cumprida só na parte da conversa (…); <parte operacional>: execução em sistema"; liderança:
  `stats.conversationPartOnly`.
- **`REVIEW_DIVERGENCE_V1`**: mesma obrigação, leituras diferentes (análise × `missed` da revisão, inclusive "cumprido" contestando
  "não verificável") → confirmação focal com a leitura contestada junto; confirmada substitui, refutada mantém, sem decisão =
  inconclusivo (nem a primeira leitura vence por ordem). As conclusões que a análise deixou indeterminadas vão à revisão
  (`undetermined`). Registro `divergence` no `verification`.
- **`CENTRAL_NEED_V1`**: a revisão responde a necessidade central (`need`); o código cruza com as conclusões finais das mesmas linhas
  (`GAP_CONFIRMED` só com obrigação confirmada; leitura só da revisão = `GAP_UNCONFIRMED`/`NOT_DETERMINABLE` → nota neutra ao leitor +
  fato `centralNeedOpen` com as regras LITERAIS; o texto da revisora nunca vira fato da redação).
- **Ocorrência pela parte descumprida**: `sameConductAs` compara o ato julgado (num desvio, a parte que faltou), mesmo que uma das
  obrigações peça também outras coisas. Prova de banco L (parcial "o que foi feito + protocolo" × "protocolo" = 1 ocorrência).
- **Cartão** (`FEEDBACK_COMPOSITION_V7`): só referências contidas nas frases mantidas (`CARD_NOT_IN_TEXT`).
- **`saidIn`** (redação V11 / verificação V10): cada limite de execução declarada leva a fala que a relatou; tomar o conteúdo dela como
  apurado, inclusive como premissa ("Ao identificar a pendência…"), é OVERREACH.
- **`INVESTIGATION_CLOSURE_V4`**: sem análise nova de chamada, o recorte fica aberto com as ferramentas sem IA (memória, sinais,
  contexto); tentadas todas, fica para decisão do planejador; `BUDGET` só quando o orçamento de IA acabou. `analyze_calls` some da
  lista quando não há análise disponível.
- Contrato: `listReading` obrigatório (nulo sem partes) na revisão e na confirmação; teto de saída da confirmação 16.384 (conta
  raciocínio).

Provas sem IA: `speech-execution-divergence.test.ts` (17), `investigation-closure.test.ts`, `investigation-discovery.test.ts`, prova de
banco L, replay das respostas da V11 (`results/replay-round-v11-…`: sem `actPlace` nada se confirma — a resposta antiga não vale como
leitura do ato exigido).

**Rodada real V12** (`evaluate-round-v12.ts`, por ETAPAS; gabarito `round-v12-ground-truth.md`, decisões `round-v12-decisions.md`,
avaliação `round-v12-evaluation.md` — pelo Claude, não por humano). Livro-razão próprio: **8 de 8 requisições, US$ 0,2141** de
US$ 0,30. Nunca repetir.
- **A-review** (1): "Verificar" lido fora da conversa, T7 como relato — **atende**; "abrir análise + informar prazo" lido como mista,
  só o prazo julgado — **atende**; necessidade central lida pelo ressarcimento ("crédito inadequado"), não pelo próximo passo do
  cancelamento — **não atende** no conteúdo, contida pelo código (alternativa cumprida → não observável; `GAP_UNCONFIRMED`). Revelou 2
  defeitos de código (fora da conversa + incerto; título da obrigação mista no caminho), corrigidos.
- **B-review** (2): a revisão LIGOU as duas regras do protocolo pela parte descumprida, mas omitiu `listReading` nas 4 conclusões → a
  parcial não se confirmou → ligação recusada (1 ocorrência). A confirmação foi cortada (`MAX_TOKENS`) → e-mail inconclusivo por falha
  técnica, não por decisão. Corrigidos depois (schema e teto), **não revalidados**.
- **C-plan** (2): o recorte chegou aberto com as ferramentas sem IA; o planejador parou dizendo "resolvido" pelo pico; o código recusou
  a resolução e registrou "decidiu não aprofundar" — **atende com ressalva**.
- **A-compose** (2): rascunho aprovado frase a frase, mas "só narra etapas" → reescrita não coube → **abstenção; mensagem de A não
  validada**. O rascunho tinha "Ao identificar a pendência…", aprovado pelo verificador V9.
- **A-verify** (1): o MESMO rascunho no verificador V10 com `saidIn` → F3 **OVERREACH** (n = 1).

### Boas práticas dos colegas no indicador, linha de base simples e rodada real V13 (02/10/2026, fim da noite)

**Linha de base simples** (`scripts/feedback-engine/evaluation/larissa/baseline-simple-*.md`, 7 requisições, US$ 0,0875): uma chamada
de redação + uma verificação, com a transcrição e os mesmos procedimentos. Achou os mesmos pontos principais e reintroduziu os erros que
o motor evita (insinuar falha na validação do e-mail, execução em sistema como fato, elogio exagerado, jargão no indicador). A
complexidade do motor se justifica na correção; o que distorcia as rodadas era avaliação com exigência que nenhuma base tem.

**Práticas pela linha-âncora (`PRACTICE_ANCHOR_V1`).** A identidade de uma obrigação muda entre análises (cada uma junta as linhas do
seu jeito), e a mesma prática se espalhava: das 159 leituras dos colegas de melhor resultado da Larissa, nenhuma prática alcançava os
mínimos. Agora padrões e práticas agregam pela linha-âncora da obrigação — a identidade de LINHA da base (`knowledge_criteria`, parte
antes do `#` da `verification.lineKey`), exposta como `MemoryRow.practiceKey` pelos dois repositórios — com uma leitura por chamada
(a mais grave) e o texto mais frequente. Resultado na mesma memória: 5 práticas. Corrige também a regra "em vigor" de padrões de
obrigações com várias linhas (comparada com chaves de linha). Título da seção quando a regra começa pela abertura de uma lista.

**Grupo de referência V2 e passo garantido (investigação V10).**
- Grupo pelo melhor resultado NO ASSUNTO; sem avaliações suficientes para comparar práticas, pelo melhor resultado OFICIAL do
  indicador no período (limitação dita). A segunda opção só lê a memória (nenhuma chamada de colega é analisada por ela).
- Mínimos: produto ou estratégia, o que for maior. Contrastes: REFERENCE_FOLLOWS_PERSON_MISSES, BOTH_FOLLOW, REFERENCE_ALSO_MISSES (a
  pessoa não cumpre e o grupo de melhor resultado também quase nunca — fato que impede tratar como lacuna individual) e REFERENCE_ONLY
  (o grupo cumpre e a pessoa não tem avaliação — boa prática, nunca falta).
- `REFERENCE_STEP_V1`: com "Comparação com pares" ligada e a capacidade presente, `reference_practices` é passo do diagnóstico (sem
  modelo) — com resultado bom nenhuma pergunta aberta levava o planejador a ela.
- `PEER_ANALYSIS_AUTHORIZATION_V1` (05/10/2026): chamada de COLEGA só é analisada (custa IA) com a comparação autorizada — o passo
  `reference` do contrato (estratégia publicada com pares ligados e o Workflow sem restringir a comparação). Sem isso,
  `reference_practices` pedida pelo planejador lê só a memória que já existe. Dev: uma execução sem estratégia pagou 12 análises de
  colegas pelo planejador enquanto o passo do contrato era recusado ("sem estratégia de diagnóstico publicada").
- `STRATEGY_AT_BIRTH_V1` (05/10/2026): a estratégia da execução é a em vigor no NASCIMENTO dela, por indicador, em todo caminho —
  Agenda, execução manual por colaborador e filhos de fan-out deduzem a versão pelo instante do disparo (antes ficavam sem estratégia
  porque só a matrícula por Indicador gravava o pino). Regra em `indicator-diagnosis/domain/strategy-at-birth.ts`.
- `SPEECH_EXAMPLE_V1` (05/10/2026, composição V15 / redação V18 / verificação V16): exemplo de como dizer por ponto de desenvolvimento.
  O redator propõe `examples: [{ ref: A-n, text }]` (fala ao cliente, pronta, só com o conteúdo dos fatos); o verificador confere cada um
  na mesma chamada (E-A-n: SUPPORTED/GENERALIZATION + `specific` true = fala concreta sem lacuna); checagens locais de frase valem. Aceito
  vai para `suggestedResponse` do detalhe do ponto (tela: "Como melhorar"); recusado não aparece e, sozinho, não dispara reescrita.
- `UNLOCATED_MEMORY_V2`: o que a memória sabe das chamadas do período entra junto dos recortes descobertos quando nenhum assunto foi
  localizado (antes só com a evidência vazia; examinar o dia fora do padrão apagava a conduta consistente).

**Redação (composição V9, prompt V13, verificação V11 — `REFERENCE_PRACTICES_V1`).** As práticas chegam como fatos agregados P-n:
regra literal, "entre os colegas com melhor resultado …, nas chamadas já analisadas de N deles … em que essa etapa se aplicava, ela foi
cumprida em A de B" (quantos contribuíram, nunca o tamanho do grupo) e a linha da pessoa (ou null). P-n vale em CONTEXT, GUIDANCE e
VALUE; o verificador trata como erro causa, falta insinuada com `you` null, falha individual com REFERENCE_ALSO_MISSES, frequência além
do número e nomes. Prática que orienta sem nenhuma frase que a use = lacuna de utilidade (pede a reescrita, não bloqueia).
`STRENGTH_WITH_GOOD_RESULT_V1`: com o resultado oficial bom, a conduta consistente das chamadas analisadas é reconhecível mesmo com um
recorte examinado. O prompt deixou de mandar "parar no número" e pede fatos técnicos das ferramentas só em palavras comuns.

**Análise prompt V9.** A pergunta 2 inclui as regras acionadas por SITUAÇÕES da conversa. Na C07 a análise declarou o Jeito Vivo como
fonte relacionada e não formou nenhuma obrigação dele (§19, "Quando não houver solução imediata") — o texto não bastou; o próximo passo
é estrutural (resposta por seção de situação das fontes relacionadas).

**Rodada real V13** (`evaluate-round-v13.ts`, critérios `round-v13-criteria.md` antes das chamadas, decisões
`round-v13-decisions.md`, avaliação `round-v13-evaluation.md` — pelo Claude). Livro-razão próprio: **15 requisições, US$ 0,258**.
Nunca repetir.
- **A (C07, análise nova):** publicável e correta (fatura/valor, se estava paga, crédito condicional, prazo/SMS — todos com fala);
  §19 não ligado.
- **C (TMA ago/2026):** planejador em 3 rodadas, 8 consultas (segmentação, anomalia do dia 04/08, composição, contexto/flags/memória
  e análise da chamada de 04/08, práticas dos colegas). Texto pobre — só o número — por três defeitos do meu código, corrigidos.
- **C-compose:** a MESMA investigação reproduzida com as respostas pagas (5 de 5 pedidos idênticos byte a byte), brief e redação
  corrigidos, só redação + verificação pagas: resultado oficial + conduta dela com denominador (confirmação de entendimento 5/5; prazo
  4/4) + boa prática dos colegas (confirmação da solicitação, 6 de 6). Ressalva: "cinco dias úteis/SMS" estendido às 4 chamadas, com
  fala em 2.
- **Configuração de produção:** a estratégia publicada do TMA tem "Comparação com pares" desligada e o Agent não tem
  `OPERATIONAL_COMPARISON`; na rodada as duas foram ligadas só na memória do processo.

Sonda sem custo: `probe-reference-practices.ts` (grupo e práticas pela obrigação × pela âncora, banco somente leitura).

### Firmeza do retorno, histórico por prática, referência analisada e situações (02/10/2026, madrugada) + rodada real V14

Pedido do produto: o retorno é propositivo, mas "puxa a orelha" quando a pessoa fez errado; as ferramentas chegam ao diagnóstico mais
preciso possível (onde erra, como melhorar) e o retorno gera valor.

- **Firmeza decidida pelo código** (`domain/firmness.ts`, `FEEDBACK_FIRMNESS_V1`): cada ponto de desenvolvimento ganha
  `firmness {level, basis}` — ORIENT (regra publicada depois da chamada; ou primeira vez sem impacto alto), CORRECT (regra vigente e
  impacto alto, ou a mesma prática não cumprida em ≥ 2 chamadas), INSIST (a prática já foi comunicada num retorno ENTREGUE antes da
  chamada/período e voltou a acontecer — com a data). A materialidade é leitura da análise e só influi no nível; as justificativas são
  frases do sistema. Consolidação fica com o nível mais alto. Escalonar ao gestor fica fora (escada do produto).
- **Histórico por PRÁTICA** (`generate-feedback.ts › practiceContextOf`): a reincidência da monitoria passou a contar pela linha-âncora
  (`PRACTICE_ANCHOR_V1`, uma leitura por chamada, a mais grave), não pela identidade da obrigação (que fragmentava: "1 de 1" em vez de
  "3 de 4"). Orientação anterior: `FeedbackMemoryStore.deliveredPractices` — mensagem PUBLISHABLE entregue antes da data cujo ponto
  COMUNICADO (`finding_keys`) tem a prática em `practiceKeys` (brief). Mensagens anteriores ao campo não contam (nunca se presume).
- **Redação/verificação** (composição V10, prompt V14, verificação V12): CORRECT/INSIST = dizer o que não foi feito, por que pela regra
  e o que fazer, sem transformar em sugestão nem compensar com elogio; INSIST cita a orientação anterior; firmeza sobre a conduta, nunca
  sobre a pessoa. O verificador devolve `message.firmnessRespected`; ponto CORRECT/INSIST comunicado sem frase ADJUSTMENT
  (`missingCorrection`, estrutural) ou amaciado (`softenedCorrection`) é lacuna pedida na reescrita (não bloqueia). Julgar a pessoa e
  "já foi orientado" sem base = erro. Falas de padrão do indicador viram `exampleQuotes` (o conteúdo — prazo, canal — vale só para a
  chamada da fala; achado da rodada V13).
- **Referência analisada** (investigação V11, `REFERENCE_GROUP_V3`): o grupo pelo resultado oficial (antes só memória existente) também
  analisa chamadas do assunto dos colegas — na ordem do resultado, pulando quem não tem chamada no assunto, em LARGURA (uma de cada
  colega antes da segunda), até os mínimos de chamadas e colegas; orçamento PRÓPRIO (`DEFAULT_MAX_PEER_CALL_ANALYSES` = 6), separado
  das análises da pessoa; chamada de colega pendente/falha só fica fora da referência. O grupo tem pelo menos os colegas que a
  estratégia exige para comparar. `REFERENCE_DURATION_V1` (indicador de duração): duração registrada média no assunto, pessoa × grupo
  (≥ 3 colegas), dita como aproximação, nunca causa.
- **Situações** (`SITUATION_SECTIONS_V1`, prompt da análise V10, revisão prompt V4, lógica `CALL_ANALYSIS_LOGIC_V14`): a análise declara
  `situations` (seção S-n acionada por situação, aconteceu YES/NO/UNCLEAR, fala). Com fala verificada e YES, as linhas dessa seção que
  ninguém avaliou vão à revisão (`situationsInPlay`, teto 30) — ela aponta em `missed` o que valia e faltou (confirmação focal). Cobertura
  registra declaradas × aconteceram × mostradas × apontadas. Resposta ao Jeito Vivo §19 da C07 (declarado, nunca ligado).
- Cenário de dados (dev): cópias de teste de setembro da Larissa movidas para a pessoa "Larissa Monteiro · QA (cópias de teste)"
  (`scripts/dev/larissa-scenario/move-test-copies.ts`, desfazível pelo manifesto) e cenário "TMA ruim em setembro"
  (`scripts/dev/larissa-scenario/tma-setembro.ts`: 10 contestações dela em 22–30/09 com erros de regra vigente, 10 de colegas, medição
  diária, fechamento oficial de TMA de setembro do Subgrupo — Larissa 452 s, Q3). `--reset` remove pelos ids.
- Provas: `firmness.test.ts` (13), `reference-practices.test.ts` (V3/duração), `obligation-contract.test.ts` (situações),
  prova de banco M (insistência de ponta a ponta: retorno entregue → mesma prática errada depois → INSIST com data e histórico).

- **Rodada real V14** (`evaluation/larissa/evaluate-round-v14.ts`, critérios `round-v14-criteria.md` registrados antes, decisões
  `round-v14-decisions.md`, avaliação `round-v14-evaluation.md`; livro-razão próprio, 28 requisições, US$ 0,96; nunca repetir):
  - **Monitoria (L09)**: publicável e firme — promessa de estorno com data (§34/§49), "É só aguardar" (§35/§51), recapitulação e
    confirmação (§46/§47), tom CORRECT sem amaciar e sem julgar a pessoa. Faltou a reincidência (o ponto do caminho absorvia as etapas).
  - **Indicador (TMA setembro)**: números e localização certos (contestação 534 s → 629 s), mas o planejador analisou 3 de 11 chamadas;
    "prazo" falhou em 2 de 2 e virou "desvio isolado" → mensagem sem diagnóstico de conduta. Referência com 5 chamadas de colegas
    analisadas na hora, prazo com 4 de 5 avaliações (parada pelo total, não pela prática).
- **Correções depois da V14** (zero custo, testadas): `PATTERN_CONFIRMATION_V1` (investigação V12: etapa que falhou na amostra abaixo do
  mínimo de padrão pede mais chamadas do mesmo assunto, pelo contrato, no orçamento da estratégia — `pattern-confirmation.test.ts`);
  referência para só quando CADA prática em que a pessoa falha tem a cobertura mínima (`practiceCoverageOf`); ponto consolidado
  (caminho/seção) mantém prática, tom e histórico por prática (composição V11); seções das situações resolvidas por identidade — handles
  no texto ou título apresentado sem numeração (`sectionsOfReference`, lógica V15; na V14 nenhuma chegava à revisão).
- **Validações V14B–D** (reprodução híbrida: pedido idêntico a um já pago = resposta paga; total da tarefa US$ 1,89): investigação do TMA
  com 6 de 11 chamadas e três padrões reais (recapitulação 4/5, confirmação 3/4, espera 2/3); referência consultada de novo depois da
  confirmação de padrão; composição V12 (etapa reincidente é ponto próprio; "colegas cumprem e você não" vira P-n); monitoria publicável
  e completa; TMA com rascunho certo ("colegas 6 de 6 × você 1 de 4") mas sem publicação (falha do provedor na última verificação).
  Firmeza por reincidência dita com números (prompt V15 / verificação V13) NÃO revalidada. Detalhes em `round-v14-evaluation.md`.

### Amostra do período quando o volume não localiza (05/10/2026, noite) — zero chamada paga

**Achado nas execuções reais de dev.** A localização por assunto só compara os períodos com pelo menos `minimumOverallOf` chamadas
(max(3 × mínimo por assunto, 10)) em CADA um. Denisy Feitoza (TMA de setembro, 8 chamadas em agosto × 14 em setembro), Fernanda Nunes
Alves (agosto, 2 × 6) e Icaro Elias (9 × 12) terminaram em INSUFFICIENT_DATA ou CHANGE_LOCATED_NO_CAUSE com ZERO chamadas analisadas,
com a estratégia do TMA v4 autorizando a análise (até 10 chamadas, pares ligados): sem recorte localizado nada era examinado, e a
memória "não localizada" (`UNLOCATED_MEMORY_V2`) só lê o que já existia. O feedback ficava só com o número oficial (ou abstinha).
Larissa Monteiro (11 × 10 chamadas num assunto) localizou e teve diagnóstico completo (8 de 11 chamadas, práticas dos colegas 9/9 × 1/6).

**Regra (investigação V14, `PERIOD_SAMPLE_V1`).** Quando a localização por assunto NÃO acontece por volume, o motor analisa uma
amostra das chamadas do período — se, e só se:

1. a falta de localização é de VOLUME (`localizationVolumeGapOf`): `PERIOD_VOLUME` (algum período abaixo de `minimumOverallOf`) ou
   `SUBJECT_VOLUME` (agregado comparável, mas nenhum assunto com o mínimo nos dois períodos). Nunca com um assunto localizado, sem
   métrica de chamada para a unidade, com a segmentação fora do contrato, nem para indicador com alvo e volume suficiente;
2. a análise de chamadas está autorizada pelo CONTRATO (`contract.callAnalysis`): estratégia publicada com a avaliação de chamadas
   ligada — a em vigor no nascimento da execução (`STRATEGY_AT_BIRTH_V1`) —, especialista dentro dos domínios da estratégia e Workflow
   sem restringir `INTERACTION_ANALYSIS`. Sem isso nada é listado nem analisado: fica só o registro `NOT_ALLOWED` com o motivo e a
   memória por assunto segue exatamente como antes;
3. a pessoa tem pelo menos o mínimo da estratégia (`minimumAnalyzed`, piso 3) em chamadas COM TRANSCRIÇÃO no período (senão
   `BELOW_MINIMUM`, com a limitação dita).

**Amostra determinística** (`periodSampleOf`, domínio puro): primeiro todas as chamadas do assunto com mais chamadas com transcrição
(as mesmas situações se repetem — é onde uma prática pode virar padrão), depois as dos demais assuntos em rodízio (volume decrescente,
empate pela chave), cada assunto na ordem do sistema (espalhada no período, a mesma de `segmentInteractions`). Alvo = max(amostra da
estratégia, mínimo); chamadas que a memória já analisou contam (reaproveitadas, sem custo) — só as que faltam são pedidas, nunca mais
que o espaço do teto de análises da execução (`maxInteractions` da estratégia). A análise é a MESMA da monitoria, pelo executor do
contrato (`analyze_calls`, `CALLS:PERIOD`, conta no teto de consultas); orçamento de IA que acaba no meio para ali (`MODEL_BUDGET`).
**Onde entra.** Depois do planejador e da confirmação de padrão, antes da referência: no plano do CONTRATO (estratégia em modo FIXO ou
sem ferramentas) a referência dos colegas vale para o assunto que a amostra escolheu; no plano do PLANEJADOR, `REFERENCE_STEP_V1` já
escolhe o assunto com mais chamadas avaliadas. Chamada de colega continua só com a comparação autorizada
(`PEER_ANALYSIS_AUTHORIZATION_V1`), no orçamento próprio da referência.

**Evidência e mensagem.** UMA entrada do período no lugar das entradas por assunto (que repetiriam as mesmas práticas):
`focusReason: UNLOCATED`, `sampleBasis: PERIOD_SAMPLE`, `segmentKey: PERIOD`, escopo "Nas chamadas analisadas do período",
`periodSubjects` (por assunto, com transcrição × analisadas — alimenta "Seus assuntos no período"), nota da amostra dizendo como foi
escolhida e que descreve essas chamadas, não explica a variação. Padrões são OBSERVAÇÃO: nunca `PATTERN_SUPPORTED`, nunca ponto de
desenvolvimento; desvio recorrente vai ao brief como contexto "…não foi cumprida em A de B em que se aplicava (não foi possível ligar
isso à variação do indicador)", com `ATTRIBUTION_LIMIT` nas limitações e nas notas ao leitor; conduta consistente é reconhecível com
resultado bom (como antes). Prática que um recorte descoberto já trouxe como ponto não é repetida como contexto. A amostra nunca
conta como exame de um recorte que piorou (`concludeInvestigation` › `analyzedInSlices`): um dia fora do padrão que o plano do
contrato não examinou continua `CHANGE_LOCATED_NOT_EXAMINED`, com as chamadas do período analisadas.

**Registro** (`tools.periodSample`): `version`, `gap`, `status` (SAMPLED · MEMORY_SUFFICIENT · NOT_ALLOWED · BELOW_MINIMUM · NO_ROOM ·
TOOL_BUDGET · MODEL_BUDGET), motivo, universo, mínimo, alvo, já analisadas, pedidas, analisadas agora, assunto inicial e, por assunto,
chamadas/analisadas/escolhidas. A versão nova invalida o reuso das investigações V13 (a lógica entra na chave de evidência).

**Provas** (`application/period-sample.test.ts`, modelo falso + `no-external-ai`): volume baixo + estratégia ligada → amostra
(3 de Contestação, depois Troca de plano e Troca de titularidade), padrões na evidência e no brief como observação; dia fora do padrão não
examinado continua não examinado; plano do contrato com
pares ligados (referência no assunto escolhido, colegas no orçamento próprio) e desligados (nenhuma consulta de colega); sem estratégia
(com e sem memória — idêntico à V13), avaliação desligada, Workflow restringindo, assunto localizado, abaixo do mínimo; teto de
análises, teto de consultas, orçamento de IA no meio da amostra e memória que já cobre a amostra; funções puras. NÃO revalidado com
modelo real nem com os dados de Denisy/Fernanda/Icaro.

- Amostra do período (`PERIOD_SAMPLE_V1`): descreve o período, nunca localiza a mudança — com pouco volume continua impossível dizer
  em qual assunto o resultado mudou. A amostra começa pelo assunto com mais chamadas: um assunto pequeno onde o problema se concentra
  pode ficar com uma chamada só (ou nenhuma, se o teto da estratégia for menor que o assunto principal). Só a dimensão assunto ordena a
  amostra; chamadas sem assunto registrado ficam fora dela.

### Sinal da população numérico e com sentido declarado (06/10/2026) — `POPULATION_SIGNAL_V2`

**Por quê.** O sinal da estratégia só aceitava flag de sim/não (ex.: `rechamada`), e a taxa de chamadas sinalizadas era comparada com o
sentido do PRÓPRIO indicador. Para a Nota da URA (maior é melhor), o evento que importa é a chamada com nota baixa — uma flag numérica
(`nota_ura`) com um limiar — e "mais chamadas com nota baixa" é piora, não melhora.

**Regra.**

1. `populationSignal.condition {operator, value}` só para flag NUMÉRICA (`STRATEGY_SIGNAL_CONDITION_REQUIRED`); sim/não nunca usa
   condição (`STRATEGY_SIGNAL_CONDITION_NOT_ALLOWED`). O limiar é declarado pelo admin; o sistema nunca escolhe um.
2. `populationSignal.effect` ADVERSE | FAVORABLE é obrigatório para publicar (`STRATEGY_SIGNAL_EFFECT_REQUIRED`) e nunca é deduzido do
   nome da flag. Versões publicadas antes (sem `effect`) continuam rodando com o sentido do indicador, exatamente como antes.
3. O motor resolve o sinal no catálogo (`resolveSignal`: flag ativa do tipo certo) e todas as consultas usam um predicado único
   (`signalPredicateSql`): flag verdadeira, ou valor que atende a condição.
4. A taxa de chamadas sinalizadas (`SIGNAL_RATE`) usa o sentido do sinal: ADVERSE = menor é melhor; FAVORABLE = maior é melhor. Vale na
   localização por assunto e no grupo de referência por assunto; o resultado oficial e a medição diária continuam com o sentido do
   indicador.
5. Amostra do período em indicador por sinal: assunto com mais chamadas sinalizadas primeiro, chamadas sinalizadas primeiro.

6. `ZERO_BASELINE_MATERIALITY_V1`: variação a partir de 0 no período anterior (com volume suficiente nos dois) é material — a variação
   relativa não existe com base zero e o assunto nunca entrava no foco. Achado na 1ª execução real (Larissa, setembro): Segunda via
   0/4 → 4/6 e Reparo 0/4 → 5/5 marcados como piora, foco vazio, investigação desviada para dias atípicos.
7. Organização das práticas (PRACTICE_IDENTITY/THEMES) com tempo limite de 240 s (era 120 s): estourava em metade das análises reais, e
   cada estouro reserva o teto no orçamento da execução — a investigação da Nota da URA acabou o orçamento antes das análises pedidas.

Rótulo único `signalLabelOf` ("nota_ura ≤ 2", "rechamada") na tela, na investigação e na auditoria. Provas:
`population-signal.test.ts` (sentido ADVERSE × FAVORABLE sobre os mesmos dados, condição repassada, amostra pelo sinal),
`indicator-diagnosis-v2.test.ts` (validação e runtime), `indicator-diagnostic-strategy.test.tsx` (tela).

8. `CURRENT_RULES_AFTER_ANALYSIS_V1` (investigação V16): as regras em vigor eram lidas no início da investigação, antes das práticas que
   as próprias análises organizam — o padrão agregado por elas parecia "regra que mudou na base" e era descartado (Reincidência da
   Larissa: recapitulação ausente em 3 de 4 retornos → "sem causa"). Agora são lidas depois das análises
   (`current-rules-after-analysis.test.ts`).

### Prazo conferido, fraseologia do argumentário e retorno oculto (06/10/2026)

**Por quê.** As bases mandavam "informar o prazo exibido na ferramenta": a gravação não mostra a ferramenta, então a análise nunca
podia dizer se o prazo dito estava certo. A pedido do usuário, os procedimentos passaram a definir o prazo (1 a 7 dias úteis) e a
monitoria precisa apontar o prazo errado e dizer o correto. Os argumentários foram feitos também para o feedback (como seguir e como
dizer), mas a fraseologia sugerida só chegava à análise.

**Regra.**

1. `SOURCE_DEFINED_CONTENT_V1` (análise prompt V11, revisão prompt V5): quando a fonte define o conteúdo a informar neste caso (prazo,
   valor, canal), o que foi dito é comparado com o que ela define — outro prazo, outra unidade (corridos × úteis) ou prazo vago =
   NOT_MET, com o dito e o definido na justificativa e o valor da fonte na orientação. É leitura do modelo; nenhum número é extraído
   nem comparado pelo código. Composição V19 / verificação V17: o ajuste diz o que foi dito e o correto pela regra.
2. `CALL_ANALYSIS_LOGIC_V16`: a investigação considera uma chamada já analisada pela versão da LÓGICA (`analyzedInteractionIds`),
   não pela versão da base nem do roteiro. Pela vigência isso é correto (versão nova da base não vale para chamada antiga); mudança de
   lógica, porém, exige subir a versão — senão a investigação reusa as leituras antigas (achado: TMA e Nota da URA reusaram 13 e 10
   leituras e se abstiveram).
3. `ARGUMENT_PHRASING_V1`: o `suggestedScript` do argumentário (mesma versão que a análise usou) vai ao redator como fato do ponto de
   desenvolvimento (`suggestedPhrasing`): base do exemplo de como dizer, lacunas preenchidas só com os fatos; nunca critério nem fala da
   chamada. Monitoria: `argumentPhrasingsForRun`; indicador: padrões que vêm de argumentário, versões em vigor no fim do período.
4. `HIDDEN_ARTIFACT_NOT_DELIVERED_V1`: retorno oculto do Acompanhamento não conta como ponto já entregue nem como orientação anterior —
   o mesmo critério da entrega única (`engineMessageHiddenSql`). Antes, refazer um feedback depois de ocultá-lo suprimia todos os pontos.

5. Composição V20 / verificação V18: ponto comunicado com fraseologia do argumentário e sem exemplo de como dizer aceito é lacuna de
   utilidade (`missingPhrasingExample`): pede a reescrita com a instrução, nunca bloqueia. Achado: na 1ª rodada (L06) o redator recebeu
   a fraseologia de "Aviso de consulta e retomada do atendimento" e escolheu dar exemplo só para prazo e protocolo.
5b. `ARGUMENT_SCRIPTS_ALL_IN_FORCE_V1` (`CALL_ANALYSIS_LOGIC_V17`): o bloco de argumentários tinha orçamento de 30 mil caracteres e
   eles entravam em ordem alfabética até o corte — 14 de 37 no dev; "Respeito e acolhimento observáveis na fala" e o novo "Troca de
   titularidade entre empresas — documentos de cada parte" ficavam de fora, e a monitoria da chamada de titularidade não falou da
   impaciência nem trouxe a fraseologia. Orçamento 100 mil: todos os vigentes no escopo entram (36 ≈ 81 mil caracteres); quem
   decide a aplicabilidade é a leitura da análise.
6. `CALL_IDENTIFIER_INTEGRITY_V1`: protocolo, telefone ou documento (8+ dígitos, juntos ou com ponto/hífen/espaço; datas fora) numa
   frase ou fala sugerida só vale se estiver numa fala desta chamada — integridade de dado, checada localmente
   (`IDENTIFIER_NOT_FROM_CALL`) e também pelo verificador. Achado: a sugestão da L06 usou o protocolo do exemplo da Contestação.
7. `CURRENT_PRACTICE_TITLE_V1`: o nome da prática vai ao redator do indicador pelo catálogo atual (`withCurrentPracticeTitles`); a
   investigação reaproveitada carregava o nome da época. Lacuna: o organizador nunca generaliza o nome quando uma regra de outro
   documento entra na prática ("Confirmar o entendimento da solicitação de contestação do cliente" aplicado à Segunda via → a
   coerência barrou a Nota da URA).

Provas: `argument-scripts-engine.test.ts` (fraseologia no brief e no payload do redator, sem virar critério),
`speech-example.test.ts` (identificador da regra recusado, o da chamada aceito; lacuna da fraseologia; nome atual da prática),
`INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-engine-workflow-proof` (caso P).

8. Titularidade (composição V16 / prompt V21 / verificação V19). O retorno da chamada GOLDEN-LARISSA-TITULARIDADE pegou a lista errada e a
   impaciência, mas: (a) "O processo orienta" mostrava itens do campo "evitar" do argumentário como orientação — a obrigação junta
   linhas de várias fontes e o brief as colava numa regra só, com a seção da primeira; (b) um ponto "Caminho do atendimento" juntava
   cinco condutas (no contrato de obrigações o caminho não tem evidência própria) e o redator comunicou duas — recapitulação e contato
   anterior sumiram e eram marcados como entregues; (c) títulos com o texto cru da regra. Correção: `RULE_SOURCES_V1` (uma regra por
   origem, `avoid` pelo campo do cadastro; origem lida da versão usada pela análise), caminho só com evidência própria,
   `PRACTICE_TITLE_V1` (nome curto da prática da linha principal), `ALL_DEVELOPMENTS_V1` (ponto de desenvolvimento não comunicado =
   lacuna de reescrita, só monitoria) e `STEP_DETAILS_V1` (etapa a etapa nos detalhes). Prova: `rule-sources.test.ts`.
9. `NARRATIVE_FORMATTING_V1`: listas e negrito no texto do retorno. O redator decide (`format` por frase; `**…**` só na expressão
   essencial, uma por parágrafo); o sistema monta o markdown de cada parágrafo e remove qualquer outra marca; card em texto puro; voz sem
   marcas (`toSpeakable`). Contrato com o front: cada string de `view.narrative` é markdown seguro (blocos separados por "\n\n", listas
   "- "/"1. ", só negrito inline). Prova: `narrative-formatting.test.ts`.
10. 2ª rodada da titularidade: `ADJUSTMENT_IN_CALL_V1` (ponto comunicado só como "nas próximas chamadas…" pede a reescrita com o que
   aconteceu nesta chamada), `OFFICIAL_PHRASING_V1` (fraseologia oficial do argumentário nos detalhes quando o redator não propõe o
   exemplo) e a apresentação falada do feedback inteiro (teto de 450 palavras, antes 150).
11. `OFFICIAL_RESULT_TABLE_V1`: tabela do resultado oficial no texto do indicador (sistema, nunca o redator; fora da voz).
   `recompose-published-feedbacks.ts` refaz só o texto dos feedbacks publicados reaproveitando análise/investigação (dev 06/10: 11
   feedbacks recompostos com a composição V17).
12. `LIST_CHECK_V1` + `BOLD_LIMIT_V1` (composição V18): a lista deixa de depender só do redator — o verificador aponta a relação de itens
   em texto corrido e o motor pede a reescrita; o sistema corta negrito longo ou repetido. Nenhuma estrutura obrigatória.

### Entrega única por chamada e por período (05/10/2026) — zero chamada paga

Decisão de produto: o colaborador nunca é monitorado duas vezes pela mesma chamada nem recebe dois feedbacks do mesmo indicador no
mesmo período.

- `ONE_MONITORING_PER_CALL_V1`: a chamada que já tem monitoria entregue (mensagem do motor com `delivered_at` ou feedback de
  monitoria publicado com evidência dela — inclusive de caminhos anteriores ao motor) não é analisada de novo para monitoria. "Chamar
  agente" e Orquestrador com avaliação de processo devolvem `CALL_ALREADY_MONITORED` sem chamar IA; o "Gerar feedback" se abstém com
  o mesmo motivo.
- `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`: indicador × período oficial já entregue à pessoa não é investigado de novo
  (`PERIOD_ALREADY_DELIVERED`). "Testar diagnóstico" passa `skipDeliveredPeriods: false` (simulação nunca entrega).
- Publicação: a mesma checagem roda dentro da transação, depois de `pg_advisory_xact_lock` por chave (`call:<org>:<interação>` /
  `indicator:<org>:<pessoa>:<indicador|início|fim>`) — de duas execuções concorrentes, só uma publica. O Output não entrega a mensagem
  impedida por nenhuma superfície (Acompanhamento, Notificação, Chat, Avatar) e grava `notPublished {reason, text}` na saída do nó.
- Feedback ocultado como artefato de desenvolvimento (`feedback_follow_up_hides`) não conta como entregue.
- `PRV_CLOSING_STRATEGY_SCOPE_V1`: o fechamento do PRV investiga só indicadores com estratégia de diagnóstico publicada e ativa; sem
  nenhum, `NO_INDICATOR_WITH_STRATEGY`.
- Limite: Chat/Avatar sem Acompanhamento conferem sem trava (a corrida entre duas entregas só conversacionais não é serializada).

### Produto da solicitação e aplicabilidade antes do julgamento (21/10/2026) — `PRODUCT_APPLICABILITY_V1`

Documento próprio: [produtos-e-aplicabilidade.md](produtos-e-aplicabilidade.md). Com catálogo de produtos vigente na data da chamada, a
análise devolve as solicitações (Q-n) com o produto sustentado pelas evidências e a abrangência de produto de cada obrigação; a revisão dá a
própria leitura; o código (`domain/product-applicability.ts`) aplica integridade e consequências e só deixa cobrar ou reconhecer regra cuja
aplicabilidade está estabelecida. Sem catálogo, prompt, schema, chave e resultado são os de antes.

## Limitações conhecidas

- A análise depende da estrutura da base (seções/listas); regra escrita em prosa corrida vira critério por frase normativa.
- Estrutura (Grupo/Subgrupo) é a vigente no momento da análise de cada chamada.
- Indicador: só a dimensão assunto; tendência além de período anterior × atual não é investigada; pares só existem quando há
  memória suficiente (a investigação analisa até 2 chamadas por colega de referência quando falta memória).
- Consequência inventada é barrada pelo verificador + trava final, não por lista de palavras; o avaliador aponta marcas léxicas só
  como sinal para leitura.
- A interpretação (condição, alternativas × cumulativas, oportunidade, ação observável × declarada × interna) depende da revisão
  por modelo; o código só decide a partir da resposta estruturada dela (não decide sentido por lista de palavras) e, sem revisão,
  nada é confirmado. Uma revisão que ERRE confirmando continua possível — a revisão diminui, não elimina, a falsa acusação; a
  qualidade dela com modelo real ainda não foi medida.
- Duas chamadas por chamada analisada (análise + revisão) custam mais que a V3 nos casos em que a análise não precisava de reparo.
- Revisão pendente não aparece para a liderança enquanto não for retomada (nem como "inconclusiva"); não há contador de pendências
  na tela Diagnóstico. Retomada acontece por nova tentativa do nó, por nova análise pedida (monitoria, contrato ou planejador) —
  não há varredor de pendências.
- Investigação que dependia de uma análise pendente por falha técnica repete o planejamento na nova tentativa (as análises prontas
  não são pagas de novo; as rodadas de planejamento são).
- Recortes: só no lado PIOR do indicador; semana não vira recorte; concentração por assunto/canal/hora/sinal só para indicador em
  segundos (duração registrada como aproximação); limiares de materialidade (20%, até 2 recortes por resultado, até 6 por
  investigação) decidem onde olhar, nunca causa. O plano do contrato (modo FIXO ou sem ferramentas) olha só os assuntos
  localizados — dia fora do padrão fica registrado como não examinado (`NO_TOOL`).
- Encerramento de recorte (V5): a decisão de aprofundar é do planejador real, que não foi medido; "resolvida pelo mesmo recorte"
  aceita só memória do recorte ou consulta sobre as chamadas dele (flags, contexto, análise) — drill-down por filtro (ex.:
  segmentar o assunto por hora) não encerra a pergunta das chamadas.
- (Pipeline por linha, só respostas antigas) Descartes e itens englobados por abertura de lista só são reexaminados nas seções em
  jogo e até o teto (80 descartes, 40 linhas por chamada); a revisora pode deixá-los sem resposta — fica registrado como não revisado e a análise segue PARCIAL (nada é acusado nem
  creditado por isso), mas um ponto central que ela não conteste continua fora do diagnóstico.
- A análise pode deixar muitos itens do caminho sem disposição (144 na C07 de 01/10 à tarde): o desfecho fica PARCIAL e o pedido de
  cobertura é cortado pelo teto; não há segunda rodada de cobertura.
- Contrato orientado ao caso (V8/V12): a escolha das obrigações materiais é do modelo — ponto material que nem a análise nem a
  revisão enxergam fica fora (cancelamento pendente da C07); o código cobre itens de argumentário aplicável sem avaliação, o que o
  modelo declarou não avaliado e mostra à revisão os itens das listas em jogo (`LIST_COVERAGE_V2`) — se ela não os apontar, ficam só
  contados. As consequências por código dependem do papel que o PRÓPRIO modelo deu a cada
  fala (conduta × declaração × intenção); papel errado passa.
- Confirmação focal: no máximo uma por chamada analisada; MET só da revisão não é confirmado (fica como leitura, não priorizado).
- Divergência análise × revisão na MESMA obrigação (a revisão lista "de fora" o que a análise já tem): prevalece a leitura da análise,
  com a divergência só na auditoria (`REVIEW_ALSO_LISTED_AS_MISSED`) — não há terceira leitura. Na V11 isso evitou uma acusação
  indevida (e-mail de B), mas também manteria uma leitura errada da análise.
- Fala que RELATA o resultado de uma consulta em sistema ("Encontrei aqui…") pode ser lida pelo modelo como a própria consulta
  (ACTION_IN_CALL): o código segue a leitura e a consulta conta como cumprida (V9, V10 e V11).
- Ligação "mesma conduta" (`sameConductAs`) é por obrigação: uma obrigação-lista (motivo + protocolo) e uma regra só do protocolo
  podem não ser ligadas pelo modelo; nesse caso ficam duas ocorrências (correto pelo código, sem demonstrar a ligação).
- Pergunta de chamadas de um recorte com análises zeradas fecha como `BUDGET` sem nova rodada do planejador, mesmo havendo
  ferramentas sem IA (contexto, sinais, memória) para a chamada do recorte.
- Mensagem que precisa de reparo custa 2 requisições a mais (reparo + nova verificação); sem orçamento para as duas, abstenção.
- `scenarioRole` e `itemNature` são leituras do modelo (só ordenam e orientam a revisão); a decisão continua por código.
- Aplicabilidade, onde o cumprimento acontece e a decomposição de regras compostas são LEITURAS do modelo (análise + revisão): se o
  modelo classificar errado (ex.: ler uma comunicação como execução em sistema), o código segue a leitura — a revisão é o segundo
  leitor, mas não há garantia. Nada disso foi medido com modelo real (V5/V4 nunca rodaram).
- Registros operacionais de sistemas não estão integrados: execução fora da conversa é sempre limite de cobertura.
- Argumentário: um escopo por argumentário (todos | Grupo | Subgrupo); administrador com vários Grupos cria um por Grupo; "área
  responsável" é o domínio de negócio (dono do conteúdo) — o acesso é pelo escopo das atribuições, não pela área.
- Argumentário publicado com início futuro não pode ser encerrado antes de começar (publique outra data ou aguarde).
- A tela de Argumentários foi verificada por testes de componente e pela API do servidor local; não foi aberta no navegador
  (exigiria trocar a sessão logada compartilhada).
- Critérios de documentos já extraídos antes da V7 não têm identidade gravada para as linhas de seções de contexto (que agora têm
  handle): elas recebem a identidade pela chave da linha, sem continuidade entre versões até a próxima versão publicada do documento.
- Feedbacks antigos sem view model: o título é corrigido só na leitura (Acompanhamento do colaborador e da estrutura); a Revisão,
  o contexto do chat e os Resultados do Workflow ainda mostram o campo "indicador impactado".
- Capacidades: agentes que nunca foram configurados passam a investigar SEM ferramentas (plano do contrato da estratégia, se houver);
  quem quiser o planejador precisa marcar as "Ferramentas de investigação" no Agent. Nenhum agente foi alterado.
- Leituras gravadas antes da V4 não têm confirmação e passam a contar como inconclusivas (os números da liderança caem até a
  memória ser refeita); nada foi reprocessado.
- O que um modelo real faz com o estado novo (se o planejador aprofunda um recorte quando vale, se a revisão retomada confirma o
  que deve) não foi medido — os testes usam modelo simulado.
- Fatos das ferramentas entram no diagnóstico só pelos sinais derivados por código (grupo comparável, qualidade, série); o resumo
  textual de cada ferramenta vai ao redator como contexto, sem interpretação automática adicional.
- A validação focal usou 3 chamadas de uma pessoa (dados de demonstração); não mede a operação.
- Custo por chamada analisada depende do tamanho das bases do especialista (bases de 60–70 mil caracteres custam várias vezes
  uma base de 7 mil).
