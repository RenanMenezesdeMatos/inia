# Rodada V12 (02/10/2026) — avaliação

**Quem avaliou.** Claude (modelo de IA, mesma sessão das correções), contra `round-v12-ground-truth.md` (escrito e com hash registrado
antes da primeira chamada) e o gabarito V9 revisado. Não é validação humana. O gabarito não foi alterado depois.

**Artefatos.** Diagnóstico `round-v12-diagnosis.md`; decisões e resultados por etapa `round-v12-decisions.md` (cada decisão escrita
antes da chamada); livro-razão `results/round-v12-budget-ledger.json`; resultados `results/round-v12-<etapa>-paid-*.json` +
`.prompts.json` (respostas cruas em `responses`). **8 de 8 requisições, US$ 0,2141** (teto US$ 0,30). Livros da V10 e da V11 intactos.

**Isolamento.** Banco dev somente leitura; memória e mensagens em RAM (cada artefato: `persisted: NONE`, `otherCollaboratorsAnalyzed: 0`).
Nada publicado, entregue, notificado nem gravado. Só a Larissa (DEMO-OP-0001). **Nunca repetir a V12.**

## Origem de cada resultado

| Etapa | Origem |
|---|---|
| Análise inicial de A e B | **Reaproveitada**: resposta paga da comparação V10 (prompt `CALL_ANALYSIS_PROMPT_V8`, inalterado), como análise suspensa |
| Revisão de A (V3) | **Nova, modelo real** (1) |
| Revisão + confirmação de B (V3) | **Nova, modelo real** (2) — a confirmação voltou cortada |
| Planejamento de C (2 rodadas) | **Novo, modelo real** (2); ferramentas determinísticas sobre o banco somente leitura |
| Redação + verificação de A | **Nova, modelo real** (2); revisão REAPROVEITADA da A-review pela assinatura do pedido |
| Reverificação do rascunho de A (verificador V10) | **Nova, modelo real** (1); o rascunho é o pago da A-compose, sem alteração |
| Ocorrências, divergência, parte julgada na memória e na liderança | **Prova de banco L + testes** (a rodada não grava no banco) |

## A — C07 (contestação após cancelamento, 21/08/2026)

**Diagnóstico** (reprocessado pelo código final, sem custo — `results/round-v12-A-compose-dry-run-2026-10-02T20-16-52-695Z.json`):

| Obrigação | Leitura final |
|---|---|
| Abertura | Parcial, confirmada, baixa materialidade |
| Validação do titular · escuta (fatura, valor, pagamento) · encerramento (valor, ação, prazo, canal, protocolo) · "As informações ficaram claras?" | Cumpridas, confirmadas |
| "Verificar: data da solicitação; falha na conclusão" | **Não observável — execução em sistema**; T7 preservada como DECLARADA (relato) |
| "Abrir análise quando… + informar o prazo" | **Cumprida só na parte da conversa** (informar prazo de 5 dias úteis e retorno por SMS); abertura da análise = limite de cobertura |
| Corrigir o status | Não observável (sistema) |
| Ressarcimento (crédito × estorno) | Não observável: alternativa cumprida (crédito); a leitura "crédito inadequado" não virou acusação |
| Necessidade central | `GAP_UNCONFIRMED`: nota neutra ao leitor + regras literais para a redação |

**Mensagem:** **nenhuma** — abstenção. O rascunho foi aprovado frase a frase, mas o verificador julgou que "apenas descreve as etapas"
(`valueBeyondNarration: false`); a reescrita não coube no orçamento. Rascunho (NÃO publicado):

> Você conduziu bem a validação de segurança logo no início, confirmando a titularidade e a data de nascimento antes de consultar as
> informações da linha. Também buscou os detalhes necessários para entender o questionamento, identificando a fatura envolvida, o valor
> de R$ 59,90 e se o pagamento já havia sido realizado.
>
> Ao identificar a pendência no cancelamento, você explicou à cliente o envio do caso para a análise de faturamento, passando com
> clareza o prazo de até cinco dias úteis e o retorno por SMS.

Cartão (rascunho): "Você fez a validação de segurança adequada, levantou os detalhes da fatura contestada e explicou com clareza o prazo
de até cinco dias úteis e o retorno por SMS."

| Dimensão | Resultado |
|---|---|
| Correção — diagnóstico e memória | **Atende** (depois das 2 correções de código que a resposta real revelou). Nada interno dado como feito; caminho com a parte julgada. |
| Correção — texto | **Não validada.** O rascunho tem "Ao identificar a pendência…" (relato tomado como apuração), aprovado pelo verificador V9; o verificador V10 com `saidIn` o recusou (OVERREACH, n = 1). Não houve mensagem. |
| Cobertura (A9, próximo passo do cancelamento) | **Não encontrado pelo modelo.** A revisora leu a necessidade pelo ressarcimento; registrado como em aberto, nunca como tratado. |
| Utilidade | Rascunho baixo (só reconhecimento) — o próprio verificador apontou. |
| Naturalidade | Boa no rascunho; "conduziu bem" sem dizer por quê. |
| Rastreabilidade | Cada frase → ponto S-n → obrigação → turno; limite "Verificar" → T7 (`saidIn`). |

**A: diagnóstico aprovado; mensagem não validada** (não coube). O gabarito marca a cobertura A9 como não encontrada.

## B — DEMO-INT-0001-08 (segunda via e transferência, 10/08/2026)

| Dimensão | Resultado |
|---|---|
| Protocolo | "Antes de encerrar: protocolo" NÃO CUMPRIDO confirmado. A revisão **ligou** as duas regras do protocolo pela parte descumprida (mútuo) — mas omitiu `listReading` nas 4 conclusões, a parcial "motivo + protocolo" não se confirmou e a ligação foi recusada: **1 ocorrência, por motivo de contrato, não de conduta**. |
| E-mail novo | Divergência (análise: não observável × revisão: não cumprido) → confirmação → resposta cortada (`MAX_TOKENS`) → **inconclusivo**. Sem acusação, mas por falha técnica. |
| "Fatura ou parcelamento" | Não confirmado (mesma confirmação cortada); o trecho cortado já trazia "REFUTED", como na V11. |
| Contrato | `actPlace` 4/4; `listReading` 0/4 |

**B: atende com ressalvas** (nenhuma acusação; ligação feita pelo modelo mas sem efeito; e-mail sem decisão). Correções feitas depois
(listReading obrigatório; teto da confirmação) **não revalidadas**.

## C — TMA de agosto/2026

| Dimensão | Resultado |
|---|---|
| Números | 357 s × 400; recorte 04/08 = 377,81 × base 354,31 — intactos |
| Recorte 04/08 | Aberto na 2ª rodada com as ferramentas sem IA; o planejador parou chamando de "resolvido" pelo pico; o código recusou e registrou "decidiu não aprofundar: nada foi concluído sobre o que aconteceu nelas" |
| Causa / generalização | Nenhuma |

**C: atende com ressalva** (a decisão foi do planejador, não do orçamento; ele não usou as ferramentas oferecidas e rotulou mal a parada).
Sem nova mensagem nesta rodada (não era a pergunta).

## O que foi provado sem API × o que dependeu do modelo

- **Sem API (testes + prova de banco + replay):** consequências de cada leitura (fora/misto/incompleto), divergência (confirmada,
  refutada, sem decisão), necessidade central (confirmada, em aberto, abstenção sem conclusões), ocorrência pela parte descumprida até a
  liderança, cartão × corpo com as respostas pagas da V11, fechamento V4 da investigação, payload sem rótulos, `saidIn` no payload.
- **Só o modelo respondeu:** a revisora lê o ato exigido na fonte (sim, nas duas chamadas); liga regras pela parte descumprida (sim);
  responde a necessidade central pelo sentido (não, em A); o planejador decide sobre o recorte aberto (parou sem usar as ferramentas);
  o verificador recusa a apuração presumida quando recebe a ligação (sim, n = 1).

Os verificadores automáticos aprovarem um texto não conta como critério.
