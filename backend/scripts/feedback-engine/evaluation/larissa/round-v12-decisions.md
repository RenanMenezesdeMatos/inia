# Rodada V12 (02/10/2026) — registro de decisões das chamadas reais

Registro de DECISÃO (não pedido de aprovação), escrito antes de cada etapa paga. Limites: 8 requisições e US$ 0,30 no livro-razão
próprio (`results/round-v12-budget-ledger.json`), somando todas as etapas. Critérios: `round-v12-ground-truth.md`; diagnóstico:
`round-v12-diagnosis.md`. Congelamento: `results/round-v12-freeze.json` (gravado pelo ensaio da A-review).

## Plano de etapas (ordem e teto)

| Etapa | Pergunta semântica | Chamadas máx. | Estimativa |
|---|---|---|---|
| A-review | A revisão V3, sem os rótulos da análise, lê "Verificar" como ato fora da conversa e T7 como relato? Responde a necessidade central pelo sentido do caso? | 2 (revisão + confirmação só se o código pedir) | ≈ US$ 0,06 |
| A-compose | Só se a A-review deixar a qualidade da mensagem em jogo (cartão × corpo; necessidade central na mensagem) | 2 a 4 | ≈ US$ 0,02–0,05 |
| B-review | A revisão V3 liga "motivo + protocolo" (parcial) e "protocolo" (não cumprido) pela parte descumprida? A divergência do e-mail fica inconclusiva/refutada? | 2 | ≈ US$ 0,06 |
| C-plan | Com análise nova indisponível e as ferramentas sem IA oferecidas, o planejador as usa ou justifica não aprofundar? | 2 | ≈ US$ 0,012 |

Teto somado ≤ 8 requisições; a A-compose recebe o que sobrar depois de reservar B e C. Uma etapa que não couber não começa.

## 1. A-review — decidida antes da execução

- **Pergunta:** com o contrato V3 (conclusões sem `where`/papel das falas; `actPlace`; relato ≠ execução; `need`), a revisora lê a
  obrigação "Verificar: data da solicitação; falha na conclusão" (§21) como ato fora da conversa e T7 ("Encontrei aqui…") como relato
  do resultado? E a necessidade central (o que acontece com o cancelamento pendente) recebe resposta própria, com fontes e falas?
- **Por que o replay não basta:** as respostas pagas da V11 foram dadas ao contrato V2 — não têm `actPlace` nem `need`. O replay
  (`results/replay-round-v11-2026-10-02T20-05-00-272Z.json`) mostra só a consequência de código: tudo `REVIEW_INCOMPLETE`, A e B em
  abstenção. Os testes com modelo simulado provam o que o código faz COM cada leitura, não qual leitura o modelo dá.
- **Etapa mínima:** só a revisão (e a confirmação focal se, e somente se, o código encontrar achado/divergência conferível). Análise
  reaproveitada (comparação V10, paga). Sem redação nesta etapa.
- **O que pode mudar a implementação:** se a revisora ainda ler "Verificar" como ato NA conversa (T7 como `ACTION_IN_CALL`), a
  hipótese do diagnóstico 1 (o rótulo da análise causava a ratificação) está errada → a correção passa a ser de contrato/instrução, sem
  nova camada e sem nova tentativa paga. Se a necessidade central vier como execução em sistema, o contrato do `need` não está
  separando os conceitos.
- **Ensaio:** `results/round-v12-A-review-dry-run-2026-10-02T20-11-32-037Z.json` — 1 pedido de revisão, 124.342 caracteres (V11: 119.828);
  payload conferido: 7 conclusões sem `where` e sem papel das falas; `undetermined` = O5 (lida como execução fora da conversa) e O7
  (conclusão que não se sustentou).

### Resultado da A-review (paga: 1 requisição, US$ 0,0705 — `results/round-v12-A-review-paid-2026-10-02T20-12-12-011Z.json`)

Uma requisição só: o código não encontrou achado/divergência conferível, então não houve confirmação focal.

| Ponto (gabarito) | O que o modelo leu | Veredito |
|---|---|---|
| "Verificar" §21 | `actPlace` OUTSIDE, T7 = `STATEMENT_ABOUT_ACTION`, `outsideDependency` true, veredito UNCERTAIN ("a fala em T7 apenas relata o que foi localizado") | **Atende** (modelo) |
| Comunicação que cita a análise (O6: "abrir análise… e informar o prazo") | MIXED: `judgedPart` = "informar o prazo de até cinco dias úteis com retorno por SMS", `outsidePart` = "abrir análise de faturamento…"; confirmado | **Atende** (modelo) — a comunicação não foi descartada; a abertura não foi dada como feita |
| Necessidade central (A9) | `need` PARTIALLY_ADDRESSED, mas pelo ângulo do ressarcimento ("crédito na próxima fatura inadequado para linha em cancelamento"); o próximo passo do cancelamento só como execução em sistema (`unknown`); `missed` = "avaliar ressarcimento" PARCIAL com itens ANY | **Não atende** no conteúdo (A9 não encontrado); a inferência "crédito inadequado" é a leitura inaceitável do gabarito — **contida pelo código**: alternativa cumprida (crédito) → não observável → mesma leitura da análise (descartada como duplicata); resolução `GAP_UNCONFIRMED` → só nota neutra e regras literais |
| Contrato | 7/7 conclusões com `actPlace`, `evidenceReading`, `outsideDependency`; `need` presente | **Atende** |

**Defeitos de CÓDIGO que só a resposta real revelou** (corrigidos sem nova chamada; testes em `speech-execution-divergence.test.ts`):
1. `actPlace` OUTSIDE com veredito UNCERTAIN não aplicava a consequência: "Verificar" ficava na memória como "na conversa", com o relato
   como conduta. Agora a leitura do ato exigido vale independente do veredito (observabilidade fora da conversa, fala como DECLARADA).
2. O caminho vigente escrevia "“Abrir análise quando…” — cumprida" (título da obrigação inteira) para uma conclusão que vale só para a
   parte da conversa; e a justificativa da análise ("…abriu análise e encerrou") sobrevivia porque o status não mudou. Agora: "cumprida
   só na parte da conversa (…); <parte operacional>: execução em sistema, não verificável pela gravação", e leitura mista conta como
   mudança de alcance (caminho vigente).
3. Liderança: `stats.conversationPartOnly` (avaliadas cuja conclusão vale só para a parte da conversa) — prova de banco L.
Reprocessamento SEM custo da mesma revisão paga pelo código corrigido: `results/round-v12-A-compose-dry-run-2026-10-02T20-16-52-695Z.json`
(revisão reaproveitada pela assinatura; caminho e "Verificar" corretos; brief: 3 pontos fortes, 3 limites de cobertura, necessidade em
aberto com as regras literais e a nota neutra).

**Congelamento refeito** (`--refreeze`) por causa dessas correções — o prompt da revisão não mudou (a mesma assinatura de pedido continua
reaproveitável).

## 2. Ordem das próximas etapas — decidida agora

B-review e C-plan ANTES da A-compose: respondem as perguntas principais de B e C com teto conhecido (2 + 2); a A-compose (pergunta
secundária: qualidade/coerência da mensagem de A) fica com o que sobrar (≥ 3 requisições). Inverter arriscaria deixar B ou C sem
orçamento.

## 3. B-review — decidida antes da execução

- **Pergunta:** a revisão V3 liga "Antes de transferir: informar motivo; informar protocolo" (parcial) e "Antes de encerrar: informe o
  número do protocolo" (não cumprida) pela PARTE descumprida (`sameConductAs`)? Se ela contestar o e-mail novo (NÃO CUMPRIDO), a
  divergência vai à confirmação e não vira acusação?
- **Por que o replay não basta:** as respostas V11 de B não têm `actPlace` (tudo incompleto) e a ligação é uma leitura semântica do
  modelo — os testes provam só o que o código faz com ela (unitário + prova de banco L).
- **Etapa mínima:** revisão + confirmação focal só se o código encontrar achado/divergência conferível. Sem redação (a mensagem de B foi
  aprovada na V11; o que muda é diagnóstico e contagem).
- **O que pode mudar a implementação:** se não houver ligação de novo, a hipótese do diagnóstico 5 (instrução desencorajava) não se
  sustenta sozinha — fica registrado como limite do modelo, sem nova tentativa paga.

### Resultado da B-review (paga: 2 requisições, US$ 0,0919 — `results/round-v12-B-review-paid-2026-10-02T20-18-11-859Z.json`)

| Ponto (gabarito) | O que aconteceu | Veredito |
|---|---|---|
| Ligação do protocolo | A revisão LIGOU O4 ("antes de transferir: motivo + protocolo", parcial) ↔ O5 ("antes de encerrar: protocolo", não cumprido) — `sameConductAs` mútuo. O código recusou as duas ligações (`NOT_BOTH_CONFIRMED`): a O4 veio confirmada mas SEM `listReading` (as 4 conclusões vieram sem o campo) → `LIST_READING_UNCLEAR` → não confirmada | Modelo: **atende** (a instrução pela parte descumprida funcionou); resultado final: **atende com ressalva** — 1 ocorrência de desvio (só O5) e a parcial ficou inconclusiva por omissão de campo do modelo |
| Protocolo como não informado | O5 NÃO CUMPRIDO confirmado (`ABSENCE_IN_CALL`, oportunidade T85) | **Atende** |
| E-mail novo | A revisão contestou (NÃO CUMPRIDO) a obrigação que a análise tinha deixado não observável → DIVERGÊNCIA → foi à confirmação focal; a confirmação voltou CORTADA (`MAX_TOKENS`: 7.866 tokens de raciocínio, 312 de resposta) → JSON inválido → `UNRESOLVED` → inconclusivo | Sem acusação (**atende** o gabarito), mas por FALHA TÉCNICA, não por decisão — **não validado** |
| "Fatura ou parcelamento" (L1390/L1391) | Achados só da revisão; confirmação cortada → não confirmados (o trecho cortado já trazia L1390 REFUTED por T33, como na V11) | Sem acusação |
| Contrato | `actPlace` em 4/4; `listReading` em 0/4 | **Falha de contrato do modelo** (campo opcional no schema) |

**Correções feitas depois (sem nova chamada; registradas antes de qualquer outra etapa):**
1. `STAGE_MAX_OUTPUT_TOKENS.CALL_CONFIRMATION` 8.192 → 16.384 (o teto conta saída + raciocínio). Causa: configuração.
2. `listReading` obrigatório no schema da revisão e da confirmação (nulo quando a obrigação não tem partes). Causa: contrato — o código
   depende do campo e ele era opcional. A assinatura do pedido (prompt + mensagem) não muda: a revisão paga da A continua reaproveitável.
Teste: `speech-execution-divergence.test.ts` › "contrato da revisão e da confirmação". **Nenhuma das duas foi validada com modelo.**

**Decisão: a confirmação da B NÃO é refeita nesta rodada.** Refazer custaria ≈ US$ 0,04–0,06 e 1 requisição; com 5 restantes, C (2) e a
redação da A (≥ 3 para caber reescrita/coerência) ficariam sem espaço. O resultado atual (inconclusivo) é o seguro pelo desenho.

## 4. C-plan — decidida antes da execução

- **Pergunta:** com análise de chamada nova indisponível (0, configuração explícita) e as ferramentas sem IA oferecidas para o recorte
  de 04/08, o planejador usa alguma (memória, sinais, contexto da chamada) ou justifica não aprofundar? A pergunta nunca fecha como
  "orçamento" com ferramenta gratuita não tentada?
- **Por que o replay não basta:** na V11 houve uma rodada de planejamento só (o código fechou a pergunta antes de chegar ao
  planejador); o replay pede a 2ª rodada e não há resposta gravada. Os testes com planejador simulado provam o fechamento, não a decisão
  do planejador real.
- **Etapa mínima:** só o planejador, até 2 rodadas (a 1ª escolhe as ferramentas como na V11; a 2ª é onde a pergunta do recorte chega
  aberta). Zero análise de chamada, zero redação.
- **O que pode mudar a implementação:** se o planejador ignorar as ferramentas oferecidas sem justificar, ou insistir em análise que não
  existe, a forma como a pergunta aberta é apresentada no prompt precisa mudar.

### Resultado da C-plan (paga: 2 requisições, US$ 0,0223 — `results/round-v12-C-plan-paid-2026-10-02T20-22-22-333Z.json`)

| Ponto (gabarito) | O que aconteceu | Veredito |
|---|---|---|
| Rodada 1 | segmentação por assunto, anomalias, composição e `read_call_memory` (período: sem dados) — mesmas três ferramentas da V11 + a memória | — |
| Recorte 04/08 na rodada 2 | Apresentado ABERTO com `read_call_memory`, `get_interaction_flags`, `get_interaction_context`, sem `analyze_calls`, com "ou parar dizendo por que não vale aprofundar" e o contexto "mês dentro da meta não mostra que o recorte deixou de ter problema". O planejador PAROU (`SUFFICIENT`) declarando o recorte "resolvido" por F2 ("oscilação … dentro do limite operacional") e não usou as ferramentas | **Atende com ressalva**: decisão do planejador, não fechamento por orçamento; nenhuma causa, nenhuma generalização. Ressalva: chamou de "resolvido" o que era "não aprofundar"; o código recusou a resolução (`RESOLVED_INSUFFICIENT:CALLS:R1`) e o registro final é honesto ("o planejamento decidiu não aprofundar este recorte: nada foi concluído sobre o que aconteceu nelas") |
| Números | 357 s × 400; recorte 377,81 × base 354,31 | **Atende** |
Nenhuma mudança de código: o contrato já recusa a resolução sem evidência que responda.

## 5. A-compose — decidida antes da execução

- **Pergunta:** com o diagnóstico de A corrigido (3 pontos fortes, um deles misto — só "informar o prazo"; "Verificar", "Corrigir o status"
  e "abrir análise" como limites de cobertura; necessidade central em aberto com as regras literais), o redator e o verificador
  produzem uma mensagem que NÃO dá consulta/registro/abertura como feitos, NÃO elogia o encerramento como completo, e cujo cartão
  resume só o corpo final?
- **Por que o replay não basta:** os fatos novos (`evaluatedPart`, `centralNeedOpen`, limites mistos) nunca chegaram a um redator real;
  o replay da V11 só prova a regra do cartão sobre as frases que já existiam.
- **Etapa mínima:** redação + verificação; reescrita só se reescrita + verificação couberem; coerência só se frases saírem. Revisão e
  análise REAPROVEITADAS (o harness recusa se o motor tentar pagá-las de novo). Teto: as 3 requisições restantes.
- **O que pode mudar a implementação:** frase que dê a execução como feita aprovada pelo verificador = regra do verificador
  insuficiente para `evaluatedPart`/`notVerifiableByRecording`.

### Resultado da A-compose (paga: 2 requisições, US$ 0,0173 — `results/round-v12-A-compose-paid-2026-10-02T20-23-38-473Z.json`)

- Rascunho: 3 frases de reconhecimento + cartão; o verificador aprovou as 4 (SUPPORTED), mas julgou a mensagem "apenas descreve as
  etapas cumpridas" (`valueBeyondNarration: false`) → reescrita necessária → reescrita + verificação (2) não cabiam na 1 requisição que
  sobrava → `REPAIR_SKIPPED` → **abstenção** (`NO_SAFE_MESSAGE:MODEL_BUDGET_EXHAUSTED`). **Nenhuma mensagem; qualidade da mensagem de A
  NÃO validada.**
- Achado no rascunho (não publicado): F3 "**Ao identificar a pendência no cancelamento**, você explicou à cliente o envio do caso…" —
  toma o RELATO (T7) como apuração feita, em oração subordinada; o verificador APROVOU. Na V11 o verificador também aprovou o cartão
  "localizou no histórico". **Falha que se repete → hipótese revista:** a regra já existia (`notVerifiableByRecording`, inclusive como
  base/consequência); o que faltava era CONTEXTO — o limite chegava só com o título literal da fonte ("Verificar: data da solicitação;
  falha na conclusão") e T7 chegava solto como fato do cenário; nada ligava uma coisa à outra.
- Correção (sem chamada): cada limite de execução declarada leva `saidIn` (a fala que a relatou); redator V11 / verificador V10: a fala
  comprova o que foi dito, nunca o que foi apurado — tomar o conteúdo dela como fato, inclusive como premissa, é OVERREACH.
  Teste: `speech-execution-divergence.test.ts` (limite com `saidIn`, payload do redator e do verificador).

## 6. A-verify — decidida antes da execução (última requisição disponível)

- **Pergunta:** com `saidIn` ligando "Verificar…" à fala T7, o verificador V10 julga F3 ("Ao identificar a pendência…") como OVERREACH?
- **Por que o replay não basta:** é exatamente a leitura semântica que falhou duas vezes com modelo real; teste com modelo simulado só
  prova que a ligação chega ao verificador.
- **Etapa mínima:** 1 verificação, sobre o rascunho PAGO da A-compose, sem alteração (sha registrado no artefato), com o brief refeito
  pelo código atual. Nada de redação nova.
- **Esperado (registrado agora):** F3 OVERREACH (ou UNSUPPORTED_ADDITION) apontando a apuração; F1, F2 e o cartão SUPPORTED.
  **Falha:** F3 SUPPORTED → a hipótese "faltava a ligação" não basta; o próximo passo NÃO é outra chamada nesta rodada.
- Uma tentativa, resultado preservado qualquer que seja.

### Resultado da A-verify (paga: 1 requisição, US$ 0,0122 — `results/round-v12-A-verify-paid-2026-10-02T20-27-36-508Z.json`)

Mesmo rascunho pago (sha no artefato), verificador V10 com `saidIn`: F1 SUPPORTED, F2 SUPPORTED, **F3 OVERREACH**, cartão GENERALIZATION;
mensagem ainda "só narra etapas" (`valueBeyondNarration: false`). Na verificação anterior (V9, sem `saidIn`), F3 = SUPPORTED.
**Atende o esperado** — numa amostra de 1, sem nota explicativa do modelo: sustenta a hipótese "faltava a ligação", não prova robustez.

## Fechamento do orçamento

8/8 requisições, US$ 0,2141 de US$ 0,30 (`results/round-v12-budget-ledger.json`). Nenhuma etapa paga foi repetida. Não executado por
falta de orçamento (registrado, não validado): confirmação da B com o teto novo; redação completa de A (reescrita + verificação +
coerência) com o redator V11.
