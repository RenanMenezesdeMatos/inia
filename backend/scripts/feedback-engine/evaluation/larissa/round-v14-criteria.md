# Rodada V14 (02/10/2026) — critérios registrados ANTES da execução

**Quem é avaliada.** Só Larissa Monteiro (DEMO-OP-0001). Colegas do Subgrupo "Diagnóstico IA" entram apenas como grupo de referência
(chamadas analisadas em memória isolada, agregadas, sem nomes; nada gravado).

**Padrão.** Só a base publicada (Procedimento Operacional — Contestação de Contas Móvel v1, Jeito Vivo de Atender v1, Checklist de
Encerramento de Chamada v1). As intenções que escrevi no cenário (`scripts/dev/larissa-scenario/scenario-calls.ts`) NÃO são gabarito: o
que vale é o que a base pede. Todas as chamadas de setembro são posteriores à publicação da base (09–10/09): a regra já valia —
"puxão de orelha" é legítimo onde houver erro confirmado.

**Dados.** Setembro/2026: fechamento oficial de TMA 452 s (meta 400 s, Q3; agosto 357 s, Q1). 10 contestações dela em 22–30/09 (7 com
erro de regra vigente, 3 bem conduzidas) + 11 chamadas do golden demo de 29/09. Colegas de melhor TMA do Subgrupo com contestações
bem conduzidas em 15–19/09.

## Cenário C — TMA de setembro/2026

| # | Critério | Como avaliar |
|---|---|---|
| C1 | Números oficiais corretos: 452 s × meta 400 s, fora da meta; agosto 357 s | literal |
| C2 | Ferramentas usadas de verdade e recusa ≠ resposta | ledger de ferramentas |
| C3 | Localiza onde: o assunto contestação (duração registrada maior), sem atribuir ao mix sem número | contexto do brief |
| C4 | Diagnóstico de conduta com denominador, de etapas que a base pede e que ela não cumpriu nas chamadas analisadas — esperado na base: prazo objetivo (§35; "É só aguardar" é frase a evitar §51), recapitulação (§46), promessa de estorno/devolução sem confirmação (§34, §49 "Prometer estorno sem alçada"), aviso/condução da espera (Jeito Vivo §10) | padrões do brief × falas |
| C5 | Grupo de referência com chamadas ANALISADAS nesta execução (não só memória) e prática dos colegas com número agregado (P-n) | `reference`, `budget.peerCallAnalyses` |
| C6 | Comparação de duração no assunto pessoa × grupo, dita como aproximação e sem causa | contexto |
| C7 | Firmeza: padrão de desenvolvimento com regra vigente = correção clara (o que não foi feito, por que pela regra, o que fazer), sem amaciar e sem julgar a pessoa | texto + `firmness` |
| C8 | Nenhuma causa: nada diz que a conduta explica o TMA | texto |
| C9 | Conteúdo de fala de exemplo não estendido ao padrão inteiro | texto |
| C10 | Utilidade: a pessoa sabe onde está errando e como melhorar | leitura |

## Cenário A — monitoria da L09 (29/09, contestação de serviço de notícias), na mesma memória do C

| # | Critério | Como avaliar |
|---|---|---|
| A1 | Promessa de estorno com data ("vou estornar … amanhã mesmo") apontada como erro pela base (§34 "Não prometer devolução imediata sem confirmação"; §49) | texto + critérios confirmados |
| A2 | "É só aguardar que vai ser resolvido" sem prazo objetivo apontado (§35, §51) | idem |
| A3 | Falta de recapitulação (§46) e/ou de explicação do próximo passo e prazo (Checklist (3)) | idem |
| A4 | Espera sem aviso de duração/motivo (Jeito Vivo §10) — se a análise ligar | idem (não obrigatório) |
| A5 | Reconhecimento só do que a fala mostra (validação de titular antes de consultar; protocolo informado) — sem elogio genérico | texto |
| A6 | Firmeza CORRECT (ou INSIST, impossível aqui — nada entregue antes) nos pontos de regra vigente e impacto; tom firme sobre a conduta, nunca sobre a pessoa | `firmness` + texto |
| A7 | Reincidência dita com denominador quando a mesma prática falhou em outras chamadas analisadas no C (histórico por prática) | `history` + texto |
| A8 | Execução em sistema (cancelamento "Já cancelei o serviço") nunca afirmada como feita | texto |
| A9 | Sem template, sem jargão, sem nome, sem código interno | texto |

**Reprovação automática:** acusação falsa (algo que a base não pede ou que a fala mostra cumprido), causa do TMA atribuída à conduta,
julgamento da pessoa, número fora dos fatos, nome de colega.
