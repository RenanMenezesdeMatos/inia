# Rodada V12 (02/10/2026) — resultados esperados e condições de falha, registrados ANTES de qualquer chamada

**Quem escreveu e como.** Claude (modelo de IA, mesma sessão das correções), a partir do gabarito V9 revisado
(`round-v9-ground-truth.md`, inalterado: fatos A1–A10 e B1–B6), da avaliação V11 e do diagnóstico `round-v12-diagnosis.md`. **Não é
validação humana.** Nunca entra no motor. O sha256 deste arquivo vai em cada artefato da rodada; o arquivo não é editado depois da
primeira chamada.

**Limites.** Só Larissa Monteiro (DEMO-OP-0001). Livro-razão próprio (`results/round-v12-budget-ledger.json`): no máximo 8 requisições
e US$ 0,30 para TUDO (reparos e retentativas incluídos), sem obrigação de gastar. Banco somente leitura; memória e mensagens em RAM;
nada publicado, entregue, notificado ou gravado na memória operacional. Código e critérios congelados por hash antes da primeira
chamada paga; se o código mudar, a mudança é registrada em `round-v12-decisions.md` antes de qualquer outra chamada.

**Reaproveitado (pago antes, compatível):** a análise inicial de A e de B (resposta paga da comparação de contratos da V10 — prompt
`CALL_ANALYSIS_PROMPT_V8`, congelado e inalterado nesta correção). A revisão e a confirmação pagas DESTA rodada são reaproveitadas pela
etapa de redação (mesma assinatura de pedido). **Nunca reaproveitado:** revisão/redação/planejamento da V11 (respondiam a instruções
que não existem mais; o replay mostrou que não preenchem o contrato V3).

Leitura de cada linha: **Atende** / **Atende com ressalva** (registrado, abaixo do esperado, sem ser erro) / **Não atende** (falha). Uma
resposta fora do contrato (ex.: sem `actPlace`) conta como falha de contrato do modelo — nunca como acerto do código.

## A-revisão — C07 (contestação após cancelamento, 21/08/2026)

Etapas pagas: revisão (prompt V3) e, só se o código encontrar achado/divergência conferível, confirmação focal.

| Ponto | Atende | Atende com ressalva | Não atende |
|---|---|---|---|
| "Verificar: data da solicitação; falha na conclusão" (§21) | `actPlace` OUTSIDE (ou MIXED cuja `judgedPart` é só comunicação); T7 lido como relato (`STATEMENT_ABOUT_ACTION`) para a execução; final: não observável, fala T7 preservada como DECLARADA | — | Confirmado como cumprido; `actPlace` IN com T7 como `ACTION_IN_CALL` para a consulta |
| Obrigações de COMUNICAÇÃO que citam o sistema/a análise (informar prazo §21; prazo/canal T12) | IN e confirmadas por T12 | Não determinadas com motivo de evidência (não por citar sistema) | Descartadas como "fora da conversa" por mencionarem sistema/análise |
| "Abrir análise quando…" (§30) e "Corrigir o status" | Nunca cumprido/confirmado; T11 como declaração; condição ≠ conduta | — | Cumprido ou confirmado; elogio "abriu a análise" |
| Necessidade central (A9: o que acontece com o cancelamento pendente) | `need` NOT_ADDRESSED ou PARTIALLY_ADDRESSED, com `requiredGuidance` sobre o próximo passo do cancelamento, fontes do caso (encerramento/recapitulação/checklist) e `heard` = falas reais (T11/T12/T14); e (a) obrigação de COMUNICAÇÃO em `missed`, confirmada (condição T7/T8, oportunidade no encerramento) → `GAP_CONFIRMED`; ou (b) não confirmada → `GAP_UNCONFIRMED` com nota neutra | `NOT_DETERMINABLE` com justificativa do que a gravação não permite saber | `ADDRESSED` (dizer que foi tratado); expressar a falta só como execução em sistema; inventar fala ouvida; erro sem condição/oportunidade |
| Crédito/estorno (§34) | Crédito mencionado cumpre a lista de alternativas | — | "Estorno em vez de crédito"; alternativa como obrigatória |
| Contrato da revisão | Toda conclusão com `actPlace`, `evidenceReading`, `outsideDependency`; `need` presente | Uma conclusão incompleta (vira `REVIEW_INCOMPLETE`, sem efeito de acerto) | Revisão inteira fora do contrato |

**Decisão depois da A-revisão (registrada em `round-v12-decisions.md`, antes de qualquer outra chamada):** a redação de A só roda se a
revisão produzir um conjunto em que a qualidade da mensagem seja a pergunta (há pelo menos uma conclusão confirmada, e a necessidade
central ou o cartão estão em jogo). Se a revisão falhar no ponto do "Verificar", NÃO se tenta de novo: a hipótese do diagnóstico 1 é
revista.

## A-redação — só se decidida

Etapas pagas: redação + verificação (+ reparo/coerência só se o código pedir, dentro do teto).

| Ponto | Atende | Não atende |
|---|---|---|
| Cartão × corpo | Cartão resume só o que ficou no corpo (refs ⊆ frases mantidas); nada de "localizou/consultou/verificou no histórico" | Cartão com algo que o corpo não diz; consulta/execução em sistema dada como feita |
| Necessidade central | Falta confirmada → aparece com o que fazer e quando, "daqui para frente" (reavaliação); falta não confirmada → nada a apresenta como resolvida, nenhum elogio de encerramento completo, nota neutra ao leitor | Elogio abrangente ("deixou tudo claro", "encerrou de forma completa") com a necessidade em aberto; acusação sem confirmação |
| Execução interna | Fora de elogio e de cobrança | Qualquer frase que dê consulta/correção/abertura de análise como feitas |
| Reconhecimento | Só do confirmado (titular T3–T5; pergunta se estava paga + crédito condicional T9–T12; prazo e canal T12; recapitulação T14; confirmação de entendimento T16) | Elogio sem conclusão confirmada; "seguiu todas as etapas" |
| Forma | Supervisor, sem auditoria, sem template; números como ditos (R$ 59,90, cinco dias úteis) | "Você errou/descumpriu" (a fonte é posterior à chamada) |

## B-revisão — DEMO-INT-0001-08 (segunda via e transferência, 10/08/2026)

Etapas pagas: revisão (V3) e confirmação focal se houver achado/divergência conferível. Sem redação (a mensagem de B foi aprovada na
V11; o que mudou é diagnóstico e contagem).

| Ponto | Atende | Atende com ressalva | Não atende |
|---|---|---|---|
| Protocolo (B6) | "Antes de transferir: motivo + protocolo" PARCIAL confirmado (motivo T85, número nunca dito) e "Antes de encerrar: protocolo" NÃO CUMPRIDO confirmado; `sameConductAs` liga as duas pela parte descumprida → UMA ocorrência, duas fontes | As duas confirmadas sem ligação ("ligação não feita pelo modelo" — o código mantém duas ocorrências, correto) | Mencionar o protocolo (T85) tratado como informar; ligar atos diferentes do mesmo momento |
| E-mail novo (B1/B4 do V9) | Não determinável; se a revisão contestar (NÃO CUMPRIDO em `missed`), a confirmação não confirma (incerta/refutada, dependência fora da fala) → final não determinável | — | Final NÃO CUMPRIDO confirmado (acusação) |
| Contrato | `actPlace` em toda conclusão; `need` presente | Uma conclusão incompleta | Revisão inteira fora do contrato |

## C-planejamento — TMA de agosto/2026

Etapas pagas: só o planejador (até 2 rodadas). Zero análise de chamada nova (configuração explícita, registrada); zero redação.

| Ponto | Atende | Não atende |
|---|---|---|
| Recorte 04/08 (1 chamada gravada de 31; +6,6% sobre a base) | O planejador recebe a pergunta aberta com as ferramentas sem IA não tentadas (`read_call_memory`, `get_interaction_flags`, `get_interaction_context`), sem `analyze_calls`; usa pelo menos uma OU declina com justificativa ligada aos fatos (comparabilidade, amostra de 1); a pergunta termina respondida/parcial/não material COM o motivo dele, ou fica para decisão com registro honesto | Pergunta fechada como `BUDGET` com ferramenta gratuita não tentada; 04/08 tratado como causa; generalização a partir de uma chamada; pedido de análise paga |
| Números | 357 s × meta 400 s; julho 382 s, intactos | Qualquer número diferente |
| Ferramentas | Argumentos aceitos ou recusa estruturada respondida pelo planejador | Repetição do mesmo pedido recusado |

## Aprovação

- **A:** atende se o "Verificar" e a necessidade central atendem (com ou sem ressalva) e nada da coluna "não atende" aparece em
  diagnóstico, memória ou mensagem. A qualidade da mensagem só é julgada se a redação rodar.
- **B:** atende se o protocolo e o e-mail atendem (ligação ausente = ressalva).
- **C:** atende se o recorte termina por decisão do planejador ou com registro honesto, sem `BUDGET` indevido.
- Os verificadores automáticos aprovarem um texto não conta como critério. Uma etapa que não couber no teto não é iniciada e não é
  declarada validada.
