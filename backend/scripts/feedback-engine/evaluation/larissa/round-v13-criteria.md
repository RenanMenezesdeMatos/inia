# Rodada V13 (02/10/2026) — critérios registrados ANTES das chamadas

**Quem escreveu.** Claude (modelo de IA). Não é validação humana. O sha256 deste arquivo vai no artefato e no congelamento; não é
editado depois da execução paga.

**Padrão.** Só o que as bases exigem (lição da linha de base simples: uma expectativa que nenhuma base tem nunca conta contra o motor).
Larissa Monteiro (DEMO-OP-0001) apenas. Banco somente leitura; memória e mensagens em RAM; nada publicado, entregue ou notificado.

## O que mudou no código desde a V12 (o que esta rodada testa)

1. **Análise (prompt `CALL_ANALYSIS_PROMPT_V9`)**: a pergunta 2 pede também as regras acionadas por SITUAÇÕES da conversa (solução
   que depende de análise posterior, transferência, espera, insatisfação). Motivo: o Jeito Vivo §19 ("Quando não houver solução
   imediata") chegava ao modelo e nunca era ligado à C07.
2. **Boas práticas dos colegas no indicador** (`PRACTICE_ANCHOR_V1`, `REFERENCE_GROUP_V2`, `REFERENCE_PRACTICES_V1`): práticas
   agrupadas pela linha-âncora da base; grupo de referência pelo assunto e, sem avaliações suficientes, pelo resultado oficial; as
   práticas chegam ao redator como fatos agregados (P-n). Sonda sem custo: 5 práticas com os mínimos (validação do titular 7/7,
   confirmação de entendimento 7/8, confirmação da solicitação 6/6; recapitulação 0/7 no grupo).
3. **Composição** (prompt V12 / verificação V11): regras para usar P-n sem causa, sem nomes, sem insinuar falta.

## Configuração isolada (só na memória do processo; nada gravado)

- Capacidades do Agent na rodada: INDICATOR_ANALYSIS, SEGMENTATION, INTERACTION_ANALYSIS, KNOWLEDGE, OPERATIONAL_COMPARISON.
- Estratégia do TMA: "Comparação com pares" LIGADA só nesta rodada (a publicada está desligada — decisão de produto do usuário).
- Nenhuma chamada de colega é analisada (`peerCallAnalyses: false`): a comparação usa só a memória que já existe.
- No máximo 2 chamadas novas da própria Larissa analisadas no cenário C.

## A — C07 (contestação após cancelamento), pipeline completo com análise NOVA

| | Atende | Não atende |
|---|---|---|
| §19 (Jeito Vivo, "Quando não houver solução imediata") | A análise liga a regra ao caso (a contestação depende de análise posterior); se faltou "orientação caso o prazo não seja cumprido", vira orientação para as próximas chamadas | Não ligar = utilidade menor (registrar), não erro |
| Reconhecimento | Só do que a fala mostra (titularidade, fatura/valor, se estava paga, prazo/SMS, recapitulação com protocolo, confirmação de entendimento) | Elogio sem fala; superlativo de rotina |
| Execução em sistema | Fora, ou "você informou que…" | "Você verificou/registrou/abriu/corrigiu" como fato |
| Alternativas (§34) | Crédito mencionado cumpre a lista | "Estorno em vez de crédito" |
| Perspectiva | Orientação para as próximas chamadas | "Você errou/descumpriu" (bases publicadas depois da chamada) |
| Cancelamento pendente | Não é exigido por nenhuma base: não conta como acerto | — |
| Resultado | Mensagem publicável com ao menos um ponto útil ancorado na base | Abstenção por orçamento (o orçamento desta etapa cobre a redação) |

## C — TMA de agosto/2026, investigação com ferramentas + feedback

| | Atende | Não atende |
|---|---|---|
| Ferramentas | O registro mostra consultas executadas (planejador ou contrato), incluindo `reference_practices` | Nenhuma consulta; consulta recusada contada como respondida |
| Números | 357 s × meta 400 s; julho 382 s | Outro número como TMA; duração de gravação como TMA |
| Boas práticas dos colegas | Ao menos uma prática do grupo de referência chega à mensagem como prática (com o número agregado), sem nomes, sem causa | Prática apresentada como causa do resultado; "você não faz X" sem avaliação dela; frequência inventada |
| Recapitulação (grupo 0/7, ela 4 parciais) | Se aparecer, nunca como falha individual | Cobrar como falha dela |
| 04/08 | Como dia fora do padrão sem causa, ou não mencionar | Tratar como causa; generalizar |
| Conclusão | Reconhecimento do resultado + o que vale manter/reforçar, sem diagnóstico inventado | "Sem desvios"; causa afirmada; jargão técnico ("baseline", "ponto fora", cobertura de gravação) |

## Disciplina
Uma execução paga por cenário, sem repetir para escolher resultado. Livro-razão próprio (`results/round-v13-budget-ledger.json`):
no máximo 24 requisições e US$ 1,20 para os dois cenários; V8–V12 e a linha de base intocados. Ensaio sem custo antes de cada
cenário. O que o verificador aprova não é critério.
