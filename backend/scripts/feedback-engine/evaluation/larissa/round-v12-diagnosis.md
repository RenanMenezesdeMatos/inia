# Rodada V12 (02/10/2026) — diagnóstico dos problemas da V11, antes de qualquer chamada

**Quem fez e como.** Claude (modelo de IA, mesma sessão das correções), lendo as respostas CRUAS da V11
(`results/round-v11-paid-2026-10-02T18-29-18-162Z.json` › `responses` e `.prompts.json`) e o código que as processou. Não é revisão
humana. Para cada problema: onde nasceu, a correção mínima e como foi verificada SEM chamada de modelo.

Categorias de causa (a mesma lista do pedido): **interpretação do modelo** · **contexto/instrução inadequados** · **contrato que mistura
conceitos** · **código que descarta, distorce ou propaga** · **configuração do teste**.

## 1. A — "Verificar: data da solicitação; falha na conclusão" confirmado como cumprido

| | |
|---|---|
| O que aconteceu | A análise (V10, reaproveitada) pôs a obrigação NA conversa (`where: IN_CONVERSATION`), com a fala T7 ("Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho…") como `CONDUCT` e a justificativa "consultou o histórico". A revisão V2 recebeu esses rótulos junto da conclusão e devolveu `ACTION_IN_CALL`, `outsideDependency: false`, `CONFIRMED`. |
| Causa | **Interpretação do modelo** (análise: relato tomado como execução) **+ contexto/instrução** (a revisão recebia o rótulo da análise e o ratificou; o prompt não separava "contar o resultado" de "executar a consulta"). |
| Correção mínima | `OBLIGATION_SPEECH_EXECUTION_V1` (revisão V3): as conclusões vão à revisão SEM `where` e SEM o papel das falas; a revisora lê na fonte o ATO EXIGIDO (`actPlace` IN/OUTSIDE/MIXED + `judgedPart`/`outsidePart`) antes da evidência; regra "relato não é execução" (a mesma fala é `STATEMENT_ABOUT_ACTION` para executar e `ACTION_IN_CALL` para informar). O código só aplica consequências: OUTSIDE → `EXECUTION_OUTSIDE_CONVERSATION` (não confirmado, fala preservada como DECLARADA); MIXED → status vale só para `judgedPart`, a parte operacional vira limite de cobertura; resposta sem `actPlace` → `REVIEW_INCOMPLETE` (nada confirmado). Nenhuma regra de verbo/palavra. |
| Verificado sem API | `application/speech-execution-divergence.test.ts`: payload sem `where`/`role`; OUTSIDE → não observável/DECLARADO com a fala; resposta no contrato antigo → incompleta; MIXED com e sem `judgedPart`. Replay das respostas pagas da V11: a revisão antiga não tem `actPlace` → nada se confirma → A e B abstêm (`NO_CONFIRMED_FINDING`) — consequência honesta: a resposta antiga não é leitura do ato exigido. |
| O que só o modelo responde | Se a revisora, sem os rótulos, lê "Verificar" como ato fora da conversa e T7 como relato. |

## 2. A — sentido inverso (obrigação de INFORMAR que cita um sistema)

| | |
|---|---|
| Risco | Ao endurecer (1), uma obrigação de comunicação ("informar o status que consta no sistema") poderia ser descartada como "fora da conversa" só por citar o sistema. |
| Causa possível | **Código**: a revisão não recebia as conclusões que a análise deixou indeterminadas, então não podia contestá-las; uma contestação "cumprido" nunca ia à confirmação. |
| Correção mínima | As conclusões não determinadas vão à revisão como contexto (`undetermined`, com o motivo); a revisão pode contestá-las em `missed` com as mesmas linhas; a leitura contestadora (inclusive "cumprido") vai à confirmação focal com `contestedReading` (ver 4). |
| Verificado sem API | Mesmo arquivo: informar com "sistema" no texto confirmado como IN; análise "fora da conversa" × revisão "cumprido" → confirmação → cumprido, uma linha, `divergence.outcome = REVIEW_READING_CONFIRMED`. |

## 3. A — necessidade central (cancelamento pendente) não teve resposta

| | |
|---|---|
| O que aconteceu | A revisão V2 recebeu os 57 itens das listas em jogo (inclusive "Serviço cancelado, quando aplicável" e "(3) explique o próximo passo e o prazo") e não apontou nenhum. O único achado próprio (R2) foi "corrigir o status" — uma EXECUÇÃO em sistema, que caiu como declaração (`DECLARATION_DOES_NOT_PROVE_CONDUCT`). |
| Causa | **Contrato que mistura conceitos**: a única saída para "faltou algo" era uma obrigação em `missed`, e a revisora exprimiu o problema do cliente como a ação operacional que o resolveria. Nenhum lugar perguntava "a necessidade do cliente teve a orientação observável que o caso exige?". |
| Correção mínima | `CENTRAL_NEED_V1`: a revisão responde `need {status, requiredGuidance, sources, heard, unknown}` — sem checklist, sem texto obrigatório; faltou orientação observável → obrigação de COMUNICAÇÃO em `missed` (nunca a execução em sistema). O código cruza com as conclusões FINAIS das obrigações que usam as mesmas linhas: `GAP_CONFIRMED` só com obrigação confirmada como não cumprida/parcial; leitura só da revisão nunca vira falha nem acerto (`GAP_UNCONFIRMED`/`NOT_DETERMINABLE` → nota ao leitor neutra + fato `centralNeedOpen` com as regras LITERAIS para a redação e o verificador). |
| Verificado sem API | Mesmo arquivo: falta confirmada → ponto na mensagem com a orientação; falta incerta → sem acusação, nota e fato; nenhuma conclusão determinada → abstenção com motivo; não determinável → regras literais mesmo sem obrigação que use a linha (correção feita durante os testes: as regras só vinham de linhas já usadas). |
| O que só o modelo responde | Se a revisora responde a necessidade pelo sentido do caso, com fontes e falas, sem forçar erro. |

## 4. B — acusação do e-mail ficou de fora só por "duplicidade"

| | |
|---|---|
| O que aconteceu | A revisão listou em `missed` o e-mail novo sem validação como NÃO CUMPRIDO; a análise tinha deixado a mesma obrigação não observável. O código viu a mesma identidade e manteve a leitura da análise (só uma nota de auditoria). |
| Causa | **Código**: a regra de duplicidade fazia a primeira leitura vencer pela ordem de execução. |
| Correção mínima | `REVIEW_DIVERGENCE_V1`: mesma identidade + status diferente = DIVERGÊNCIA; a leitura da revisão vai à confirmação focal com a leitura contestada junto ("decida pela transcrição e pela fonte, não por quem leu primeiro"). Confirmada → substitui; refutada → fica a da análise; sem decisão → a obrigação fica inconclusiva (mesmo que a análise tenha dito "cumprido"). Uma identidade, uma linha na memória, registro `divergence`. |
| Verificado sem API | Mesmo arquivo (confirmada / refutada / sem decisão, inclusive análise "cumprido" × revisão "não cumprido" sem decisão → inconclusivo, zero acerto e zero desvio); prova de banco L (divergência gravada no `verification`). |

## 5. B — "motivo + protocolo" (parcial) e "protocolo" (não cumprido) contados como duas ocorrências

| | |
|---|---|
| O que aconteceu | As 4 respostas da revisão e a da confirmação vieram com `sameConductAs: null`. |
| Causa provável | **Instrução**: o prompt V2 dizia que regras que pedem coisas diferentes não são a mesma conduta; "motivo + protocolo" pede mais que "protocolo". |
| Correção mínima | O prompt manda comparar o ATO JULGADO — num desvio, a PARTE que faltou — "mesmo que uma das obrigações completas peça também outras coisas"; atos diferentes no mesmo momento continuam sendo condutas diferentes. A conferência estrutural do código não mudou (ambas confirmadas, mesmo lado, mesmo momento). |
| Verificado sem API | Unitário (parcial + não cumprido ligados → 1 ocorrência, 2 regras, 1 ponto na mensagem); prova de banco L (chave única gravada; `memorySummary` 3 regras × 2 ocorrências, `peopleAggregates`, `processAggregates`, detalhe com as duas fontes). |
| O que só o modelo responde | Se a revisora V3 liga as duas pela parte descumprida. |

## 6. A — cartão citava uma frase recusada no corpo

| | |
|---|---|
| O que aconteceu | O verificador recusou a frase F4 (S3, "localizou no histórico…") na reescrita; o cartão continuou resumindo S1 + S3. |
| Causa | **Código**: a decisão do cartão não conferia se as referências dele sobreviveram no corpo final. |
| Correção mínima | `FEEDBACK_COMPOSITION_V7`: cartão só com referências contidas nas frases mantidas (`CARD_NOT_IN_TEXT`, com reparo; sem reparo possível, o cartão cai para a frase principal). O cartão continua livre na forma. |
| Verificado sem API | Mesmo arquivo: as MESMAS 5 respostas pagas de redação/verificação da V11 passam pelo código novo — cartão recusado, resumo = frase de S1, S3 fora. |

## 7. C — pergunta do dia 04/08 fechada por "orçamento"

| | |
|---|---|
| O que aconteceu | Meu roteiro deixou 0 análises de chamada para C; o código fechou a pergunta do recorte como `BUDGET` sem consultar o planejador de novo, embora houvesse ferramentas sem IA (memória da chamada, sinais, contexto). |
| Causa | **Configuração do teste** (alocação do roteiro) **+ código** (sem análise nova, a pergunta fechava mesmo com ferramentas gratuitas não tentadas). |
| Correção mínima | `INVESTIGATION_CLOSURE_V4`: separa disponibilidade de ferramenta, limite de análises novas, orçamento do planejador e reserva da mensagem. Sem análise nova, a pergunta fica aberta com as ferramentas sem IA ainda não tentadas; tentadas todas, fica para DECISÃO do planejador (`needsDecision`); `BUDGET` só quando o orçamento de IA acabou ou não existe ferramenta gratuita; `analyze_calls` some da lista do planejador quando não há análise disponível. Nada força o aprofundamento de 04/08. |
| Verificado sem API | `investigation-closure.test.ts` e `investigation-discovery.test.ts` (planejador simulado); replay V11: a pergunta continua aberta e o motor pede uma 2ª rodada ao planejador (sem resposta gravada → limitação "a investigação parou antes de examiná-las", honesta). |
| O que só o modelo responde | Se o planejador, com as ferramentas gratuitas oferecidas, as usa ou justifica não aprofundar. |
