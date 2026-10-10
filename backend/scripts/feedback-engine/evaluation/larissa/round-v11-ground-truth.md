# Rodada V11 (02/10/2026) — critérios registrados ANTES da execução paga

**Quem escreveu e como.** Claude (modelo de IA, na mesma sessão que fez as correções), a partir do gabarito revisado da V9
(`round-v9-ground-truth.md`, inalterado) e do que a V10 deixou em aberto (`round-v10-evaluation.md`). **Não é validação humana
independente.** Nunca entra no motor (prompt, ferramentas, fontes ou testes de runtime). O sha256 deste arquivo vai no artefato da
rodada; o arquivo não é editado depois da execução.

Os FATOS das chamadas e as leituras aceitáveis/inaceitáveis de A, B e C são os do gabarito V9 revisado — valem integralmente. Abaixo,
só o que a V11 mede a mais e como cada dimensão é julgada. Fontes publicadas depois das chamadas: toda orientação é "daqui para
frente" (`CURRENT_RULE_REEVALUATION`); falar em erro/descumprimento da época reprova a dimensão de correção.

## O que é reaproveitado e o que roda de novo

- **Reaproveitado (etapa já paga, compatível):** a ANÁLISE inicial de A e de B = resposta paga da comparação de contratos da V10
  (`OBLIGATIONS_V1`, prompt `CALL_ANALYSIS_PROMPT_V8`, congelado e inalterado; mesmas fontes conferidas por hash; mesma mensagem do
  usuário). O motor a recebe como análise suspensa e retoma da revisão.
- **Roda de novo (modelo real):** revisão de A e de B com o prompt atual (`OBLIGATION_REVIEW_PROMPT_V2`: `sameConductAs` e os itens das
  listas em jogo como contexto), confirmação focal se a revisão achar algo sozinha, redação e verificação (composição V9 / verificação
  V8), planejador da investigação de C (prompt V6, ferramentas V4) e, se ele decidir, a análise de UMA terceira chamada da Larissa.
- **Nunca:** respostas antigas de revisão, redação ou planejamento (seriam respostas a instruções que não existem mais).

## A — C07 (contestação após cancelamento)

| Dimensão | Atende | Não atende |
|---|---|---|
| Cancelamento pendente (A9) | A revisão recebe os itens da lista do encerramento e do checklist (inclui "Serviço cancelado, quando aplicável" e "explique o próximo passo e o prazo") e (a) aponta a falta com leitura sustentada (condição: o cancelamento estava pendente — T7/T8; oportunidade: encerramento T12–T18), confirmada na confirmação focal; ou (b) aponta e a confirmação fica incerta com motivo; ou (c) não aponta — registrado como **não encontrado**, sem fingir avaliação | Afirmar que o cancelamento foi tratado/concluído; transformar em erro sem a condição ou sem oportunidade; elogio ao encerramento como completo enquanto a questão ficou sem avaliação |
| Execução interna | Verificar, corrigir status, abrir análise, registrar: não verificáveis, fora de elogio e de cobrança | Qualquer frase que as dê como feitas ou como base de algo ("respaldando a verificação…") |
| Diagnóstico vigente | Justificativa do caminho sem a leitura descartada (crédito "incoerente"); original só na auditoria | Acusação descartada sobrevivendo no caminho, na memória ou na mensagem |
| Alternativas | Crédito mencionado cumpre a lista de opções | "Estorno em vez de crédito" |
| Mensagem | Se houver falha material confirmada: aparece, com o que fazer e quando; reconhecimento só do que foi feito | Elogio abrangente ("encerrou bem", "as orientações ficaram claras") com questão material sem avaliação; texto só de elogios com falha confirmada |

## B — DEMO-INT-0001-08 (segunda via e transferência)

| Dimensão | Atende | Não atende |
|---|---|---|
| Protocolo (B6) | Confirmado como não informado (o número nunca é dito); se duas regras o pedem no mesmo momento, a revisão as liga (`sameConductAs`) e o código mantém UMA ocorrência com as duas fontes | Mencionar o protocolo tratado como informar; duas falhas independentes na mensagem ou na contagem de ocorrências. Se a revisão NÃO ligar: registrado como "ligação não feita pelo modelo" (as regras ficam como ocorrências separadas — correto pelo código, abaixo do esperado) |
| E-mail novo (B4) | Não determinável; nenhuma acusação | Acusação ou lembrete que insinua falha |
| Reavaliação | Orientação daqui para frente | "Você errou/deixou de cumprir" |
| Mensagem | Protocolo claro e específico (informar o NÚMERO antes de transferir/encerrar); reconhecimento sustentado opcional | Protocolo diluído, genérico ou ausente |

## C — TMA de agosto/2026

| Dimensão | Atende | Não atende |
|---|---|---|
| Números | 357 s × meta 400 s, julho 382 s, como estão | Qualquer número diferente; duração de gravação apresentada como TMA |
| 04/08 | O planejador decide com os fatos de comparabilidade (+6,6% sobre a base; 1 chamada gravada de 31 medidas) e registra a justificativa — aprofundar ou não. Se aprofundar, a análise da chamada é contada como amostra de 1 | Tratar o dia como causa; analisar a chamada e generalizar; pedir chamada paga sem justificativa |
| Mensagem | Comunicado de resultado honesto, ou orientação/reconhecimento sustentado por algo além dos números | Crítica ou "melhor prática" sem evidência; apresentar o resultado como diagnóstico aprofundado |

## Dimensões do relatório (julgadas separadamente, por cenário)

1. **Correção** — nada inaceitável no diagnóstico, na memória e no texto.
2. **Cobertura dos pontos materiais** — A9 (A), B6 (B), decisão sobre 04/08 (C).
3. **Utilidade** — a mensagem ajuda a agir melhor (o que fazer, quando) ou reconhece algo concreto e relevante.
4. **Naturalidade** — conversa de supervisor, sem auditoria, sem template, sem repetição.
5. **Rastreabilidade** — cada frase leva a ponto → regra/fala → decisão do código.

Aprovação de um cenário = Correção sem "não atende" **e** Cobertura atendida ou honestamente registrada como não encontrada. O verificador
automático ter aprovado o texto não conta como critério.
