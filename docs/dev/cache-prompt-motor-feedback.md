# Cache de prompt no motor de feedback e no roteamento — diagnóstico (04/11/2026)

**Conclusão.** O cache implícito só tem recompensado pedido quase inteiro repetido: 13 dos 16 acertos. Pedidos distintos quase nunca acertam, e análise e revisão são distintas por natureza, porque o motor não repete chamada já analisada. A ordem do prompt agrava isso, já que chamadas diferentes só têm em comum as instruções (cerca de 4 mil de 44 mil tokens), mas corrigi-la não basta: sem cache explícito, reordenar renderia de 0 a 2%.

**Recomendação: não mexer no motor agora.** Quase toda a entrada é fixa (98,5% da análise no dev), mas o fluxo do dev não aproveita isso: na linha do tempo real, a economia líquida com cache explícito seria de 3% a 6% do custo, contra um teto de 29%. Quem decide é o número de chamadas por base em 30 minutos no fluxo real, que uma consulta gratuita mede (seção 5). Nenhuma mudança, chamada paga ou criação de cache foi feita neste diagnóstico; os dados com provedor real da seção 1 são de outra sessão.

Base: banco de dev `inia`, somente leitura, 30 dias até 04/11. Todas as chamadas usam `gemini-3.8-flash`, caminho legado. A análise de chamada só rodou em 5 dias (05, 06, 20, 21 e 22/10).

## 1. O que aconteceu

`FEEDBACK_ANALYSIS` mistura etapas muito diferentes. Os "29 mil tokens" são uma média que não descreve nenhuma delas. As etapas abaixo vêm de `metrics.calls` das execuções, cruzado com os eventos por tokens e horário.

| Etapa | Chamadas | Acertos | Entrada média | Entrada total | Tokens em cache |
| --- | ---: | ---: | ---: | ---: | ---: |
| Revisão (`CALL_REVIEW`) | 149 | 3 | 50.785 | 7,57 M | 41.319 |
| Análise (`CALL_ANALYSIS`) | 145 | 2 | 42.895 | 6,22 M | 97.901 |
| Identidade de práticas | 106 | 5 | 26.290 | 2,79 M | 122.470 |
| Temas de práticas | 75 | 0 | 3.163 | 0,24 M | 0 |
| Confirmação | 60 | 0 | 2.869 | 0,17 M | 0 |
| Sem rótulo (planejador, execuções refeitas) | 78 | 0 | 12.878 | 1,00 M | 0 |
| **Total** | **613** | **10** | 29.343 | 17,99 M | 261.690 |

O roteamento (`ORCHESTRATOR_ROUTING`) teve 276 chamadas com tokens (250 no chat, 26 em Workflow) e 6 acertos, todos no chat. O cache economizou cerca de US$ 0,18 no mês, de US$ 26,17 em `FEEDBACK_ANALYSIS`, dos quais US$ 13,31 são de entrada.

**Os 16 acertos, por tipo** (10 em `FEEDBACK_ANALYSIS`, 6 no roteamento):

| Tipo | Acertos | Evidência |
| --- | ---: | --- |
| O mesmo pedido de novo | 8 | Motor: 34.165 de 36.597, 16 s depois de um erro de rede; 31.736 de 33.615 e 66.165 de 68.127, repetidos 5,1 e 6,7 min depois. Roteamento: 5, com `cache = entrada − 2.021 a 2.025` |
| Mesmo catálogo de práticas, só 1 ou 2 regras novas | 5 | 19.141 a 26.797 tokens em cache, todos em 06/10 |
| Só o começo em comum | 3 | 3.264 de 76.566 (o tamanho das instruções da revisão com produto), 3.890 de 54.745 e, no roteamento, 4.707 de 10.093 |
| **Chamadas diferentes reaproveitando a mesma base** | **0** | esse prefixo não existe hoje |

Os 6 acertos do roteamento têm um pedido anterior compatível da mesma pessoa, até cerca de 2 minutos antes, então nada indica reuso entre pessoas.

**Pedido repetido × pedido distinto.** Separei os pedidos elegíveis (4.096 tokens ou mais) pelo pedido anterior já concluído mais parecido, em até 30 minutos. Tamanho igual é só um indício de texto igual, e pedidos de chamadas diferentes podem coincidir.

| Pedido anterior | `FEEDBACK_ANALYSIS` | Roteamento |
| --- | ---: | ---: |
| Mesmo tamanho (até 2 tokens de diferença) | 3 de 20 | 5 de 31 |
| Tamanho parecido (3 a 60 tokens) | 4 de 94 | 0 de 52 |
| Parecido, mas ainda em andamento | 1 de 11 | 0 de 2 |
| Nenhum parecido | 2 de 366 | 1 de 110 |

Uma validação com provedor real de outra sessão (`gemini-3.8-flash`, mesmo sistema de 8,2 mil tokens, [`validacao-ampliada-livro-caixa.jsonl`](../../.claude/worktrees/kb-chat-flow/docs/dev/consulta-bases-chat/resultados/validacao-ampliada-livro-caixa.jsonl), branch `claude/kb-chat-flow`, sem commit) separa melhor, porque as perguntas são conhecidas. Recontei as chamadas no arquivo:

| Situação | Chamadas | Acertos |
| --- | ---: | ---: |
| Pedido de mesmo tamanho reenviado, 33 a 81 s depois | 9 | 9 (`cache = entrada − 2.030 a 2.036`) |
| Pedido diferente, com um anterior de mesmo sistema | 14 | 0 |
| Cache explícito, chamadas do planejador | 27 | 27 (8.172 tokens, sempre) |

**Começo igual e final diferente é o caso que importaria se a base fosse para o começo, e as duas fontes divergem.** Na identidade de práticas, a execução só tinha 1 ou 2 regras novas, então o pedido é quase todo catálogo. Reconstruí o catálogo como estava em cada chamada (`assigned_at`, `created_at`) e medi o prefixo comum real com a chamada anterior:

| Em relação à chamada anterior | Chamadas | Acertos |
| --- | ---: | ---: |
| Prefixo comum ≥ 20 mil tokens, até 5 min | 19 | 3 |
| Prefixo comum ≥ 10 mil tokens, até 5 min | 27 | 4 (15%; IC 95% de 6% a 33%) |
| Prefixo comum < 4,1 mil tokens ou mais de 5 min | 73 | 1 |

A validação acima deu 0 de 14 no caso parecido, com prefixo menor (8,2 mil tokens). Não sei explicar a diferença, então uso a faixa de 0 a 15%. Só as instruções, repetidas em 294 análises e revisões, acertaram 2 vezes (0,7%).

**Na análise, repetição é exceção.** Uma execução concluída com a mesma chave [volta sem chamar o modelo](../../backend/src/modules/feedback-engine/application/analyze-call.ts:39), então o pedido só se repete depois de falha ou reexecução, como nos 3 acertos do motor acima.

**Mínimo de tamanho.** Nenhum dos 203 pedidos abaixo de 4.096 tokens acertou (122 da análise, 81 do roteamento, ou 29% deste). Isso bate com o mínimo [documentado](https://aistudio.google.com/docs/caching) para o 3.8 Flash. O mínimo vale para o pedido, não para o trecho em cache: houve acertos com 2.977 a 3.890 tokens em cache. Nos pedidos repetidos, os últimos 1,9 a 2,4 mil tokens nunca entram (2.030 a 2.036 na validação). A documentação descreve algo parecido (2.050 tokens) só para o Gemini 4.

## 2. O que varia cedo no prompt

A reconstrução usa as funções reais do motor (`renderCallAnalysisUserTurn`, `buildProcedureContext` etc.). Desde 20/10 ela bate com o gravado em 43 de 43 execuções em caracteres e 42 de 43 na ordem dos documentos.

| Etapa | Ordem do pedido (o primeiro variável em negrito) | Prefixo comum hoje (p50) | Parte fixa por chamada |
| --- | --- | ---: | ---: |
| [Análise](../../backend/src/modules/feedback-engine/domain/call-analysis-prompt.ts) | instruções → especialista → **data, assunto, motivo, sinais**, transcrição → procedimentos → argumentários → produtos | 4,2 mil de 44,3 mil | 43,7 mil (98,5%) |
| [Revisão](../../backend/src/modules/feedback-engine/domain/obligation-review.ts) | instruções → **assunto**, transcrição → procedimentos → argumentários → produtos → JSON da análise | 3,6 mil de 51,0 mil | 43,3 mil (85%) |
| [Identidade de práticas](../../backend/src/modules/feedback-engine/domain/practice-identity.ts) | instruções → **`PRÁTICAS JÁ CONHECIDAS (N)`** → catálogo → regras | 706 em 64% das chamadas; cerca de 26 mil nas outras | catálogo inteiro, enquanto N não muda |
| [Roteamento no chat](../../backend/src/modules/realtime/presentation/realtime-router.ts) | Orquestrador → persona → **contexto da tela, tratamento e perfil da pessoa** → instruções → histórico | cerca de 600 tokens | cerca de 600, mais ferramentas (cerca de 2,3 mil) |

**A análise, em média (43 execuções desde 20/10):** instruções 3.417, especialista 291, procedimentos 11.506, argumentários 27.774, produtos 655, transcrição 462. Os argumentários pesam mais que os procedimentos. As transcrições do dev são curtas; o limite é de 40 mil caracteres, cerca de 10 mil tokens. Com transcrições maiores, o percentual fixo cai, mas os tokens fixos e a economia em dólar continuam os mesmos.

**A identidade de práticas tem uma causa pontual.** O N na [primeira linha](../../backend/src/modules/feedback-engine/domain/practice-identity.ts:101) muda sempre que o catálogo cresce, e isso derruba o prefixo para 706 tokens, mesmo com o resto igual. A etapa só roda quando há regra nova para organizar (0,65 chamada por análise desde 20/10) e tende a parar quando a base estabiliza.

**Mover a base para o começo não cria um prefixo único.** Em 42 pares de chamadas seguidas, as fontes eram iguais em 16. Nos outros, o primeiro motivo da diferença foi:

| Motivo | Pares |
| --- | ---: |
| Outro agente | 13 |
| Outro conjunto de documentos | 9 |
| Mesma lista, outra ordem | 2 |
| Outro escopo de argumentários | 2 |

O conjunto muda quando a base do agente passa do orçamento de 90 mil caracteres, porque [a seleção é por relevância da chamada](../../backend/src/modules/feedback-engine/domain/document-selection.ts:40). O agente com mais execuções foi cortado nas 15 e usou 5 conjuntos; sem corte, os agentes usaram 1 só. A ordem sozinha pesa pouco, então mantê-la é aceitável.

**Roteamento: não é a base que varia.** Nas 160 perguntas reais reconstruídas, a base está no modo `NONE` e o prompt do Orquestrador é idêntico entre perguntas (516 a 630 tokens). O que varia cedo são os dados da pessoa, [logo após a persona](../../backend/src/modules/realtime/presentation/realtime-router.ts:1413).

**Cache explícito não está em uso em nenhum dos dois.** O motor declara [`supportsPromptCache: false`](../../backend/src/modules/feedback-engine/infrastructure/gateway-engine-model.ts:25) e não envia `cache`; o roteamento também não. Só o [especialista](../../backend/src/modules/assistant/application/run-specialist-tool.ts:291) declara, e `INIA_PROMPT_CACHE` está em `NONE`. Os acertos acima são todos do cache implícito do provedor.

## 3. Economia estimada

Preços [até 31/12/2026](https://aistudio.google.com/docs/pricing): entrada US$ 0,75/M, em cache US$ 0,075/M, armazenamento US$ 0,50/M por hora. **Todos dobram em 01/01/2027**, então os valores em dólar dobram e os percentuais não mudam. Referência: cada análise concluída custa hoje cerca de US$ 0,20 em `FEEDBACK_ANALYSIS` (US$ 8,58 para 43, desde 20/10), e a entrada é 48% disso.

| Cenário | Muda o texto? | Análise / revisão, por chamada | Por chamada analisada | % de US$ 0,20 |
| --- | --- | ---: | ---: | ---: |
| Teto: toda a parte fixa em cache, sem criação nem armazenamento | sim | 0,0295 / 0,0292 | **0,0587** | 29% |
| Só as instruções em cache explícito, na linha do tempo real (77% de acerto) | não | 0,0016 / 0,0015 | 0,0031 | 1,5% |
| Base antes da chamada, só cache implícito (44% com a mesma base em 30 min × 0 a 15% de acerto) | sim | 0 a 0,0018 / 0 a 0,0018 | 0 a 0,0037 | 0 a 2% |
| Base antes da chamada, ordem estável, explícito 30 min, linha do tempo real (44% de acerto) | sim | 0,0031 / 0,0030 | **0,0061** | 3% |
| O mesmo, só nas execuções em modo produto (53% de acerto, n = 30) | sim | 0,0059 / 0,0058 | 0,0116 | 6% |

As linhas de "linha do tempo real" simulam as execuções desde 20/10 e são líquidas de criação e armazenamento.

**O que define o ganho é o reuso.** Uma base usada N vezes em 30 minutos economiza, por chamada, `(0,675 − 1/N) × 43,5 mil / 1 M`. Ela se paga a partir de 2 usos:

| Chamadas por base em 30 min | Por chamada | Por chamada analisada | % de US$ 0,20 |
| ---: | ---: | ---: | ---: |
| 1 | −0,0141 | −0,0283 | −14% |
| 2 | +0,0076 | +0,0152 | 8% |
| 5 | +0,0207 | +0,0413 | 21% |
| 10 | +0,0250 | +0,0500 | 25% |
| 30 | +0,0279 | +0,0558 | 28% |

No dev, a média foi de **1,7 chamadas por base em 30 minutos** desde 20/10, e 19 de 25 janelas tiveram uma chamada só.

**Por execução.** Nas 67 execuções de Workflow do mês, a mediana é de 4 chamadas e 119 mil tokens, o que corresponde a uma chamada analisada: valem os valores da coluna "por chamada analisada". A média é de 9,1 chamadas, 268 mil tokens e US$ 0,39, e o máximo, 71 chamadas. Como cenário, uma investigação com 8 análises sobre a mesma base economizaria cerca de US$ 0,38 de US$ 1,60 (24%).

**Identidade de práticas.** Tirar o N da primeira linha renderia no máximo cerca de US$ 0,0023 por chamada (15% de acerto em cerca de 23 mil tokens), ou cerca de US$ 0,0015 por análise, e só enquanto o catálogo cresce. Cache explícito não serve aqui: o catálogo muda a cada chamada.

**Roteamento.** Mesmo com tudo que é fixo em cache (cerca de 2,9 mil tokens), seriam US$ 0,0020 de US$ 0,0067 por chamada; só com o implícito, no máximo cerca de US$ 0,0003. Não compensa.

## 4. Riscos para a qualidade

1. **Trocar a ordem muda o que o modelo lê por último.** Hoje a base fica mais perto da resposta; depois seria a transcrição. Não há dado sobre o efeito disso na cobertura, nas omissões e nas condicionais.
2. **O texto do prompt é contrato versionado.** A mudança exige nova versão de `CALL_ANALYSIS_PROMPT` e `OBLIGATION_REVIEW_PROMPT` e invalida as validações pagas já feitas.
3. **As chaves mudam.** A [`proposalKey`](../../backend/src/modules/feedback-engine/application/analyze-call.ts:275) usa o hash do prompt inteiro. Qualquer reordenação faz o motor deixar de reaproveitar análises já pagas: quem for pedido de novo é analisado de novo.
4. **Mesmo texto ainda pode ter risco.** No [A/B antigo](../../backend/src/config/env.ts:114), o braço com cache explícito recomendou menos materiais (1/6 × 4/6), em outra etapa e com amostra pequena. O ruído do modelo é grande: o mesmo pedido, repetido 20 vezes, deu de 0 a 70 observações (V1.4.6.1, outro modelo). Um teste precisa de bem mais de uma amostra por caso.
5. **Ordem estável troca os handles e tira o documento-âncora da frente.** Como a ordem sozinha explica só 2 de 42 pares, o melhor é não mexer nela.
6. **Dados e isolamento.** Só fontes podem ir para um cache nomeado, nunca transcrição ou dado de pessoa, e o JSON da análise fica depois do prefixo, para não comprometer a revisão independente. A base também não deve entrar na instrução de sistema só para caber no cache: hoje o contrato a trata como dado, não como instrução.
7. **Peças que faltam.** O [helper atual](../../backend/src/modules/assistant/infrastructure/gemini-prompt-cache.ts) só guarda instruções e ferramentas, e o registro fica em memória por processo, então cada worker criaria o próprio cache. O caminho por policy não encaminha `cachedContent`: com policy ativa ou outro provedor, o ganho some. O provedor também retém o conteúdo durante a validade.

## 5. Recomendação

**Agora: não alterar o motor.** O ganho medido no dev (3% a 6%) não justifica o risco nem a validação. A alta de preços de janeiro não muda essa conta, porque o percentual continua o mesmo. Reordenar contando só com o cache implícito está descartado: qualquer ganho real depende de cache explícito. Também não vale fazer em separado: cache só das instruções (1,5%, com o alerta do A/B antigo), tirar o N da identidade de práticas (centavos, e só enquanto o catálogo cresce) ou mexer no roteamento.

**Quando houver fluxo real: decidir por esta consulta, sem custo de IA.**

```sql
with r as (
  select agent_id, date_bin('30 min', started_at, timestamptz '2026-01-01') janela,
         md5((provenance->'documents')::text || (provenance->'argumentScripts')::text) base
  from feedback_analysis_runs
  where kind = 'CALL_ANALYSIS' and status = 'COMPLETED' and started_at >= now() - interval '30 days'
), j as (select janela, agent_id, base, count(*) n from r group by 1, 2, 3)
select count(*) janelas, sum(n) chamadas, round(avg(n), 1) por_janela,
       count(*) filter (where n = 1) janelas_de_uma, sum(n) filter (where n >= 5) chamadas_em_janela_5mais
from j;
```

| Chamadas por base em 30 min | Decisão |
| --- | --- |
| Até 2 (dev hoje: 1,5 no mês, 1,7 desde 20/10) | Encerrar o assunto |
| Cerca de 5 ou mais | Propor um A/B, com a aprovação do usuário |
| Entre os dois | Medir de novo com mais volume |

**Se o A/B for aprovado, o desenho menos arriscado é:**

- base antes da chamada, mantendo a ordem e a seleção atuais;
- cache só das fontes, criado a partir do 2º uso na janela (uso isolado perde US$ 0,014 por chamada) e compartilhado entre os workers;
- comparação com casos de omissão, condicional, produto, fontes em conflito e transcrição incompleta;
- qualquer perda mantém a mudança desligada.

Custo de referência: 5 tipos × 2 braços × 3 amostras = 30 análises, cerca de US$ 6, ou seja, **acima do teto de US$ 1 por rodada**. Uma rodada de US$ 1 cobre cerca de 5 análises, o que não basta para detectar diferença de qualidade.

## 6. Limites desta medida

- **Dev, não produção:** 5 dias de rajadas, com QA e reexecuções. O número de chamadas por base pode ser bem diferente em uso real.
- **Tokens das partes são proporcionais**, não `countTokens`: 3,78 caracteres por token em média, de 3,39 a 4,02 entre execuções. Os totais por execução são os gravados pelo provedor.
- **Antes de 20/10 a reconstrução não é fiel**, porque bases e vínculos mudaram. Os tamanhos usam só as 43 execuções desde 20/10. As contagens de acerto usam o mês inteiro.
- **Rótulo por etapa é um cruzamento**, não um campo: 78 de 613 eventos ficaram sem rótulo, porque `route_reason` não traz a etapa.
- **O catálogo reconstruído errou ao menos um par:** um acerto de 22.946 tokens aparece com prefixo reconstruído de 706. O denominador real do experimento pode ser maior, e o acerto real, menor.
- **A causa de cada erro de cache não dá para saber de fora.** A documentação não dá validade nem garantia do implícito. O schema da identidade de práticas também [varia com o catálogo e o lote](../../backend/src/modules/feedback-engine/domain/practice-identity.ts:80); não sei se ele entra no prefixo.
- **Não confirmados, porque exigiriam gasto ou documentação que não achei:** a cobrança da criação do cache (assumi o preço de entrada, como o código), o mínimo de tokens do cache explícito no 3.8 (o código diz 1.024, de setembro; a página só traz o do implícito; 8.172 funcionou na validação, o que não prova nada para as instruções sozinhas, de cerca de 3,4 mil) e a posição das ferramentas no prefixo.
- **A simulação** assume um único cache compartilhado e validade fixa, sem renovação.
- **A faixa de 0 a 15% do implícito** vem de duas amostras pequenas e divergentes, em rajadas. Não existe caso real de base antes da chamada para medir. A hipótese de que ele só acerta com o pedido quase inteiro repetido explica 13 de 16 acertos, mas não é regra documentada do provedor.

## 7. Reproduzir

Scripts e resultados em [`cache-prompt-motor-feedback/`](cache-prompt-motor-feedback/), com banco em modo leitura, rede bloqueada e saída só com números. Rode a partir de `backend/`:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx tsx ../docs/dev/cache-prompt-motor-feedback/reconstruct.mts
```

```bash
npx tsx ../docs/dev/cache-prompt-motor-feedback/catalog-lcp.mts 3.99
```

```bash
npx tsx ../docs/dev/cache-prompt-motor-feedback/kb-variance.mts
```

```bash
npx tsx ../docs/dev/cache-prompt-motor-feedback/orchestrator-lcp.mts
```
