# Rodada V11 (02/10/2026) — avaliação

**Quem avaliou.** Claude (modelo de IA, mesma sessão das correções), contra `round-v11-ground-truth.md`, escrito e com hash registrado
ANTES da execução, e contra o gabarito V9 revisado. Não é validação humana. O gabarito não foi alterado depois da rodada.

**Artefatos.**
- Resultado: `results/round-v11-paid-2026-10-02T18-29-18-162Z.json` + `.prompts.json`, com as respostas cruas do modelo em
  `responses`.
- Livro-razão próprio: `results/round-v11-budget-ledger.json`, 15 requisições, US$ 0,2047. O livro da V10 está intacto.
- Congelamento: `results/round-v11-freeze.json` (120 arquivos; manifesto `b0c1c97c…`). A execução conferiu o manifesto antes da
  primeira chamada.
- Ensaio sem custo: `results/round-v11-dry-run-2026-10-02T18-28-54-721Z.json`.

**Isolamento.** Banco somente leitura para os dados reais e memória de ensaio sobreposta. Nada foi publicado, entregue, notificado nem
gravado na memória operacional. **Nunca repetir a V11.**

## Origem de cada resultado

| Etapa | Origem |
|---|---|
| Análise inicial de A e de B | **Reaproveitada**: resposta paga da comparação de contratos da V10 (`OBLIGATIONS_V1`, prompt V8 congelado, mesmas fontes por hash). O motor a recebeu como análise suspensa e retomou da revisão. |
| Revisão de A e de B (prompt `OBLIGATION_REVIEW_PROMPT_V2`, com `sameConductAs` e `listItemsInPlay`) | **Nova, modelo real** |
| Confirmação focal de B | **Nova, modelo real** |
| Redação, verificação, reparo e coerência (composição V9 / verificação V8) | **Nova, modelo real** |
| Planejamento da investigação de C (prompt V6, ferramentas V4) | **Nova, modelo real**: 1 rodada |
| Ferramentas de C (segmentação, anomalias, composição) | Execução real e determinística, sobre o banco somente leitura |
| Terceira chamada | **Não houve**: o roteiro só permitia com 7+ requisições restantes, e sobraram 5 |
| Ocorrências na liderança (banco → consulta → rota → CSV → tela) | **Prova de banco K + testes**, com respostas de revisão simuladas. A rodada paga usa memória sobreposta e não grava no banco. |
| Paginação do `inspect_result` | **Só testes** (runtime com planejador simulado + funções puras); o planejador real não a acionou |

## A — C07 (contestação após cancelamento, 21/08/2026)

**Mensagem entregue.**
- Título: *Contestação de cobrança* · Atendimento de 21/08/2026
- Cartão: "Você validou a titularidade antes de acessar as informações da conta e localizou no histórico o cancelamento de 2 de
  julho ainda pendente."
- Texto:

> Antes de consultar os dados da linha, você validou a titularidade com a cliente pedindo o nome e a data de nascimento. Essa
> confirmação prévia resguarda o acesso a informações protegidas antes de avançar para a análise do caso. Para entender a cobrança,
> você perguntou qual era a fatura questionada, o valor que ela não reconhecia e confirmou se o pagamento já havia sido realizado.

**Notas ao leitor:**
- "Este retorno usa a versão atual do procedimento, publicada depois desta chamada: vale como orientação para as próximas chamadas."
- "O que é feito em sistemas, fora da conversa, não aparece na gravação e não foi avaliado neste retorno."

### Diagnóstico

**Desfecho:** PARCIAL. Caminho: não determinado (declarado parcialmente correto). Revisão: 7 conclusões, 6 confirmadas, 1 não
confirmada.

| Regra | Leitura do diagnóstico |
|---|---|
| O1 Abertura | Parcial, confirmado, baixa materialidade |
| O2 Titular | Cumprido |
| O3 Escuta | Cumprido |
| **O4 "Verificar: data da solicitação; falha na conclusão"** | **Cumprido e CONFIRMADO** — a revisão leu T7 ("Encontrei aqui. O pedido de cancelamento está aberto desde o dia 2 de julho…") como ACTION_IN_CALL |
| O5 Corrigir o status | Não verificável: execução em sistema |
| O6 Abrir análise | Não verificável: declarada, execução em sistema |
| O7 Crédito/estorno | Não observável. A justificativa vigente diz que a leitura do crédito "não se sustentou"; a acusação antiga sobrou só na auditoria |
| O8 Recapitulação | Cumprido |
| O9 "As informações ficaram claras?" | Cumprido |
| R2 "corrigir o status" (achado da revisão) | Não observável: DECLARATION_DOES_NOT_PROVE_CONDUCT |

**A9, cancelamento pendente.**
- A revisão recebeu os 57 itens das listas em jogo, inclusive "Serviço cancelado, quando aplicável" e "(3) explique o próximo passo e
  o prazo", e **não apontou nenhum** (`raisedByReview: 0`).
- Resultado: **não encontrado**, sem ser tratado como resolvido.

**Ocorrências:** 1 regra adversa = 1 ocorrência (O1); 5 regras cumpridas = 5 ocorrências. Nenhuma ligação proposta: todas as 7
respostas da revisão vieram com `sameConductAs: null`.

### Avaliação

| Dimensão | Resultado |
|---|---|
| Correção | **Não atende.** (1) O4: consulta interna ("Verificar" do §21) contada como cumprida e confirmada. É leitura inaceitável pelo gabarito V10/V11 e entra no caminho ("— cumprida") e na memória. (2) O cartão diz "localizou no histórico o cancelamento…": dá a consulta como feita. A fala T7 é a operadora RELATANDO o que encontrou. O verificador aprovou o cartão porque, no diagnóstico, S3 é um ponto cumprido. A frase do corpo sobre S3 caiu (UNSUPPORTED_ADDITION), mas o cartão continuou referindo S3. Sem acusação descartada sobrevivendo; crédito × estorno sem acusação. |
| Cobertura (A9) | Não encontrado — registrado honestamente (nada diz que o cancelamento foi tratado). A ampliação dos itens das listas chegou à revisão, mas o modelo não apontou a falta. |
| Utilidade | **Baixa.** Só reconhece validação e escuta; não ajuda na questão material do caso. |
| Naturalidade | Boa: conversa de supervisor, sem auditoria. Pequena imprecisão: "pedindo o nome" (ela perguntou se a linha estava no nome da cliente). |
| Rastreabilidade | Cada frase → ponto (S1/S2) → regra → turno (T3; T5, T9) → decisão. O cartão → S1 + S3 → O4 → T7. |
| Itens da mesma lista (`notAssessedInSameList`) | **Funcionou no texto:** "pedindo o nome e a data de nascimento", sem "validou completamente". CPF, número da linha e código seguro, que ninguém avaliou, não viraram elogio. |
| Execução interna (`notVerifiableByRecording`) | Corrigir status e abrir análise ficaram fora do texto. O cartão escapou pela via do O4, que o modelo não classificou como interno. |

**A: REPROVADO** (correção).

## B — DEMO-INT-0001-08 (segunda via e transferência, 10/08/2026)

**Mensagem entregue.**
- Título: *Dúvida sobre fatura e segunda via de conta com falha no aplicativo* · Atendimento de 10/08/2026
- Cartão: "Você detalhou muito bem a fatura e explicou o motivo da transferência. Nas próximas chamadas, lembre-se de informar o
  protocolo ao cliente antes de transferir ou encerrar."
- Texto:

> Ao analisar a fatura com a cliente, você detalhou os valores de forma bastante clara, explicando a mensalidade, o serviço adicional
> e a diferença proporcional pela mudança de plano no meio do ciclo.
>
> Você também teve o cuidado de explicar o motivo de direcionar o atendimento para o setor de faturamento. Nas próximas chamadas,
> quando for transferir ou encerrar a ligação, passe também o número do protocolo para o cliente antes de efetivar o encaminhamento.

**Notas ao leitor:** as mesmas de A (versão atual do procedimento; execução em sistema não avaliada).

### Diagnóstico

**Desfecho:** PARCIAL (cobertura parcial: L1390, N1 e N2 sem avaliação; algumas conclusões não confirmadas).

| Regra | Leitura do diagnóstico |
|---|---|
| O3 Leitura da conta | Cumprido |
| **O4 "Antes de transferir: informar o motivo; informar protocolo"** | **Parcial, confirmado**: T85 motivo e área; protocolo não informado |
| **O5 "Antes de encerrar qualquer chamada: informe o número do protocolo"** | **Não cumprido, confirmado** (ABSENCE_IN_CALL, oportunidade T85) |
| O1 Exceções | Não verificável: execução em sistema, declarada |
| O2 e-mail novo sem validação | Não observável |
| L1391 "fatura ou parcelamento" | A revisão disse "não cumprido"; a confirmação focal **refutou** (T33). Fora do diagnóstico e da mensagem. |

**Ponto a registrar — o e-mail (B4).**
- A revisão também listou "de fora" o e-mail novo sem validação como NÃO CUMPRIDO. É a acusação que o gabarito considera inaceitável.
- O código a tratou como segunda leitura da obrigação O2, que a análise já tinha deixado não observável
  (`REVIEW_ALSO_LISTED_AS_MISSED:R1:NOT_MET` na auditoria). A acusação não entrou no diagnóstico nem na mensagem.
- O motivo é a regra de duplicidade (prevalece a leitura da análise), não uma reavaliação da contradição.

**Ocorrências:** 2 regras adversas = **2 ocorrências**. Base `SINGLE_RULE`: a revisão existia e não ligou (`sameConductAs: null` nas 4
respostas da revisão e na da confirmação). O código fez o que deve sem a ligação, e nada foi unido por semelhança. Fica abaixo do
esperado pelo gabarito: "ligação não feita pelo modelo".

Provável fator: a ligação é por OBRIGAÇÃO. O4 é uma lista (motivo + protocolo), enquanto O5 pede só o protocolo. A instrução diz que
regras que pedem coisas diferentes não são a mesma conduta, e o modelo pode ter lido O4 inteiro como "outra coisa".

### Avaliação

| Dimensão | Resultado |
|---|---|
| Correção | Atende. Protocolo como não informado (a menção de T85 não conta como informar). Nenhuma acusação do e-mail. Orientação daqui para frente. Hipótese refutada (L1391) fora. |
| Cobertura (B6) | Atende: encontrado e confirmado. A ligação entre as duas regras não foi feita pelo modelo; a mensagem é uma orientação só, com as duas regras. |
| Utilidade | Boa: o que fazer (passar o NÚMERO do protocolo) e quando (antes de transferir ou encerrar). O reconhecimento é concreto (mensalidade, adicional, proporcional). |
| Naturalidade | Boa. O cartão repete um pouco o texto, mas sem cara de relatório. |
| Rastreabilidade | F3 → A1 + A2 → O4 (L682) + O5 (L1361) → T85/T88 → revisão CONFIRMED (ACTION_IN_CALL / ABSENCE_IN_CALL). F1 → S1 → O3. F2 → parte cumprida de O4. |

**B: APROVADO.** Ressalvas: ligação de conduta não demonstrada com modelo real; acusação do e-mail evitada por duplicidade, não por
reavaliação.

## C — TMA de agosto/2026

**Mensagem entregue.**
- Título: *Tempo Médio de Atendimento* · agosto/2026
- Cartão: "Seu Tempo Médio de Atendimento em agosto fechou em 357 segundos, dentro da meta de 400 segundos e melhor que o resultado
  de 382 segundos em julho."
- Texto:

> Em agosto, seu Tempo Médio de Atendimento ficou em 357 segundos, dentro da meta de 400 segundos e com melhora em relação aos 382
> segundos registrados em julho.

**Nota ao leitor:** "No recorte dia 04/08 o resultado ficou fora do seu padrão, mas as chamadas desse recorte não foram examinadas:
este retorno não diz o que aconteceu nelas."

### Investigação

**Rodada 1 do planejador:** pediu 3 ferramentas, todas executadas com sucesso.

| Ref | Ferramenta | Resultado |
|---|---|---|
| F1 | `segment_indicator` por assunto | Contestação 534 s (n = 10) e três assuntos com n = 1 |
| F2 | `detect_anomalies` | Pico isolado em 04/08: 378 s contra a base de 354 s (+6,6%) |
| F3 | `inspect_indicator_composition` | 254.086 s em 712 contatos |

**O que veio depois da rodada 1:**
- O código abriu o recorte R1 (dia 04/08: 1 chamada gravada de 31 medidas) e a pergunta "o que aconteceu nas chamadas de 04/08?".
- O roteiro deu a C **0 análises de chamada**: só 5 requisições restavam depois de A (6) e B (6). Por isso o motor fechou a pergunta
  como `BUDGET` e não material.
- O planejador **não foi consultado de novo**: rodadas usadas 1 de 2, `dispositions: []`, `plannerQuestions: []`. Conclusão:
  `CHANGE_LOCATED_NOT_EXAMINED`.

### Avaliação

| Dimensão | Resultado |
|---|---|
| Números | Atende: 357 × 400, julho 382, como estão; nenhuma duração de gravação apresentada como TMA. |
| Correção | Atende: 04/08 não vira causa e nada é generalizado. A mensagem é um comunicado de resultado e não se apresenta como diagnóstico. |
| Cobertura (04/08) | **Não atende.** A decisão não foi do planejador com os fatos de comparabilidade; foi o orçamento de análises (0) do meu roteiro. O registro é honesto ("não foram examinadas … o limite de análises acabou"), mas o que a V11 queria medir não aconteceu. |
| Utilidade | Baixa a média: informa o resultado; nada além dos números. |
| Naturalidade | Boa, mas cartão e texto dizem a mesma coisa quase com as mesmas palavras. |
| Rastreabilidade | Pergunta WHERE → F1/F2/F3 → R1 (origem F2) → pergunta das chamadas fechada por orçamento → nota ao leitor → mensagem só com as linhas oficiais. |

**C: NÃO APROVADO** na cobertura. A causa está na alocação de orçamento do roteiro da rodada (escrito por mim), não no motor. Ainda
assim, há um ponto do motor: com análises zeradas, a pergunta fecha como `BUDGET` sem oferecer ao planejador as ferramentas sem IA
(contexto, sinais e memória da chamada do recorte).

## Resumo

| Cenário | Correção | Cobertura | Utilidade | Naturalidade | Rastreabilidade | Veredito |
|---|---|---|---|---|---|---|
| A | Não atende (O4 interno cumprido; cartão "localizou no histórico") | Não encontrado (A9), registrado | Baixa | Boa | Boa | Reprovado |
| B | Atende | Atende (ligação não feita pelo modelo) | Boa | Boa | Boa | Aprovado com ressalvas |
| C | Atende | Não atende (decisão do orçamento, não do planejador) | Baixa/média | Boa (repetição) | Boa | Não aprovado |

Os verificadores automáticos aprovaram as três mensagens. Isso não conta como critério.
