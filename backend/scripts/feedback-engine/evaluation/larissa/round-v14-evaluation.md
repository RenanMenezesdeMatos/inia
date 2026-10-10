# Rodada V14 (02/10/2026) — avaliação

**Quem avaliou.** Claude (modelo de IA), contra `round-v14-criteria.md` (registrado antes; só a base como padrão). Não é validação
humana. Decisões: `round-v14-decisions.md`.

**Custo.** Livro-razão `results/round-v14-budget-ledger.json`: **28 requisições, US$ 0,96** (teto 44 / US$ 1,00). Medidor do motor:
659 mil tokens de entrada, 63 mil de saída; a análise de chamadas foi 9 das 28 requisições e ~42 % da entrada. Mesmo modelo do motor.
Banco somente leitura; nada publicado, entregue ou gravado. Artefato `results/round-v14-paid-2026-10-02T22-34-25-430Z.json`.

## C — TMA de setembro/2026 (mensagem publicável, **reprovada em utilidade**)

> **Cartão:** Em setembro, seu TMA oficial foi de 452 s (meta de 400 s). A duração subiu em contestação de cobrança, mas a amostra
> analisada não indica uma causa específica para a variação.
>
> Em setembro, seu Tempo Médio de Atendimento oficial fechou em 452 segundos, acima da meta de 400 segundos e do resultado de agosto,
> que foi de 357 segundos. Pela duração registrada dos atendimentos, a média no assunto contestação de cobrança subiu de 534 segundos em
> agosto para 629 segundos em setembro, com marcas mais altas nos dias 23 (705 segundos) e 28 (725 segundos).
>
> Como apenas 3 das 11 chamadas gravadas sobre contestação de cobrança foram analisadas no mês, os dados disponíveis não apontam uma
> causa direta ou um desvio recorrente para essa variação. Na confirmação de entendimento desse assunto, você verificou as dúvidas do
> cliente na chamada avaliada (1 de 1), prática que os colegas com melhor TMA no período cumpriram em 5 de 5 chamadas analisadas.

| # | Critério | Resultado |
|---|---|---|
| C1 | Números oficiais | **Atende** (452 × 400, agosto 357) |
| C2 | Ferramentas reais, recusa ≠ resposta | **Atende** — 7 consultas; `find_comparable_interactions` recusada por argumento ausente e tratada como recusa |
| C3 | Localiza onde | **Atende** — contestação 534 s → 629 s; dias 23 e 28 |
| C4 | Diagnóstico de conduta com denominador | **Não atende** — o planejador analisou só 3 das 11 contestações (a estratégia permitia 10). "Prazo" falhou em 2 de 2 aplicáveis; abaixo do mínimo de padrão (3) virou "desvio isolado" e a mensagem disse que nada apontava desvio recorrente |
| C5 | Referência com chamadas analisadas na hora | **Atende parcialmente** — 5 chamadas de colegas analisadas (`REFERENCE_GROUP_V3`), mas "prazo" ficou com 4 de 5 avaliações no grupo (a parada olhava o total de chamadas, não a prática) e só a confirmação de entendimento virou prática comparável |
| C6 | Duração pessoa × grupo | **Não comunicada** — o fato estava no brief (629 s × 363 s, 7 colegas), a mensagem não usou |
| C7 | Firmeza | Não se aplica (nenhum ponto de desenvolvimento chegou ao brief) |
| C8 | Sem causa | **Atende** |
| C9 | Fala de exemplo não generalizada | **Atende** (sem falas) |
| C10 | Utilidade | **Não atende** — ela não sabe onde está errando |

## A — monitoria da L09 (mensagem publicável, **aprovada com ressalva**)

> **Cartão:** Em casos de conta já paga, não prometa devolução imediata nem oriente apenas a aguardar: passe o prazo do processamento
> financeiro, faça a recapitulação e confirme se restaram dúvidas.
>
> Na contestação do valor de doze reais, você prometeu a devolução no cartão para o dia seguinte e encerrou informando apenas que era só
> aguardar com o número de protocolo. Em casos de conta já paga, você não deve prometer estorno imediato nem orientar apenas a esperar,
> além de ser necessário resumir os pontos acordados e checar se o cliente ainda tem dúvidas antes de finalizar. Da próxima vez, informe
> o prazo objetivo conforme a forma de pagamento e o processamento financeiro, fazendo a recapitulação da conta, do lançamento, do valor e
> da ação realizada, e pergunte se as informações ficaram claras.

| # | Critério | Resultado |
|---|---|---|
| A1 | Promessa de estorno com data | **Atende** ("você prometeu a devolução no cartão para o dia seguinte… não deve prometer estorno imediato" — §34) |
| A2 | "É só aguardar" sem prazo | **Atende** (§35/§51) |
| A3 | Recapitulação / confirmação | **Atende** (§46, §47) |
| A4 | Espera sem aviso | Não mencionado (a etapa PARCIAL foi absorvida no ponto do caminho; regras cortadas no teto de 4) |
| A5 | Reconhecimento só do que a fala mostra | Atende (sem elogio) |
| A6 | Firmeza | **Atende** — CORRECT (regra vigente, impacto alto): diz o que não foi feito, por que e o que fazer, sem "vale considerar" e sem julgar a pessoa |
| A7 | Reincidência com denominador | **Não atende** — o ponto "caminho inadequado" absorveu as etapas e descartou prática e histórico delas |
| A8 | Execução em sistema | Atende ("Já cancelei o serviço" ficou não observável) |
| A9 | Sem template/jargão/nome/código | Atende |

## Defeitos achados e corrigidos depois da rodada (zero custo; testados)

1. **Amostra pequena no assunto que piorou** → `PATTERN_CONFIRMATION_V1` (investigação V12): etapa que falhou na amostra abaixo do
   mínimo de padrão pede mais chamadas do MESMO assunto, pelo contrato, dentro do orçamento da estratégia. Teste
   `pattern-confirmation.test.ts`.
2. **Parada das análises de colegas pelo total** → a parada exige cobertura mínima de CADA prática em que a pessoa falha
   (`practiceCoverageOf`).
3. **Caminho inadequado apagava a reincidência** → consolidação mantém prática, tom e histórico por prática (composição V11).
4. **Situações (§19) nunca chegavam à revisão**: o modelo escreveu "D1:S33", "S21 / S98 (…)", "34. Conta já paga" → resolução por
   identidade (`sectionsOfReference`: handles no texto ou título apresentado sem numeração; ambíguo = nada; lógica V15).

## Validações com reprodução híbrida (05/10/2026; pedido idêntico a um já pago = resposta paga, sem custo)

Gasto total da tarefa: V14 US$ 0,96 + V14B US$ 0,77 + V14C US$ 0,04 + V14D US$ 0,12 = **US$ 1,89** (cada etapa autorizada pelo usuário).

- **V14B** (`evaluate-round-v14b.ts`, 20 requisições novas, teto US$ 0,80 atingido): a investigação fechou — confirmação de padrão pediu
  3 chamadas a mais (6 de 11 analisadas), conclusão `PATTERN_SUPPORTED` com três padrões reais: recapitulação não feita em 4 de 5,
  confirmação de entendimento em 3 de 4, espera sem aviso em 2 de 3 (prazo continua dividido em duas linhas-âncora da mesma seção:
  2 de 2 em cada — limitação). As redações foram bloqueadas pela trava. Defeito novo: a referência foi consultada pelo planejador ANTES
  das chamadas a mais ("você 1 de 1") → corrigido (referência consultada de novo depois da confirmação).
- **V14C** (4 requisições novas): TMA publicável com os três padrões, denominadores, tom de correção e orientação da regra; a prática dos
  colegas ficou só como número anexo e não foi usada. Monitoria correta, mas sem a recapitulação: a etapa reincidente estava absorvida no
  ponto do caminho → corrigido (composição V12: reincidente é ponto próprio; "colegas cumprem e você não" vira P-n).
- **V14D** (6 requisições novas): **monitoria publicável e completa** — promessa de estorno, "só aguardar", falta de recapitulação e de
  confirmação de dúvidas, com orientação; não disse a reincidência (7 das 8 chamadas anteriores) → corrigido sem custo (prompt V15 /
  verificação V13: firmeza por reincidência tem de ser dita com os números), **não revalidado**. **TMA**: o rascunho trouxe os três
  padrões e "colegas 6 de 6 × você 1 de 4"; o verificador barrou uma frase (espera "sem cumprir" com um caso parcial); a verificação
  da reescrita falhou por resposta inválida do provedor (sem nova tentativa nesta avaliação) → mensagem não publicada.
